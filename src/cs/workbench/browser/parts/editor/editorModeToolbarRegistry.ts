/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { LocaleMessages } from 'language/locales';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';

export type EditorModeToolbarHostContext = {
	readonly ui: LocaleMessages;
	readonly instantiationService: IInstantiationService;
	readonly activeTab: EditorInput | null;
	readonly activePaneModeId: string | null;
	readonly activePane: AnyEditorPane | null;
	readonly contentElement: HTMLElement;
	readonly toolbarElement: HTMLElement;
	readonly viewPartProps: ViewPartProps;
};

export interface EditorModeToolbar {
	getElement(): HTMLElement;
	setContext(context: EditorModeToolbarHostContext): void;
	focusPrimaryInput?(): void;
	dispose(): void;
}

export type EditorModeToolbarFactory = (
	context: EditorModeToolbarHostContext,
	dropdownServices: DropdownContextServices,
) => EditorModeToolbar;

const toolbarFactories = new Map<string, EditorModeToolbarFactory>();

export function registerEditorModeToolbar(modeId: string, factory: EditorModeToolbarFactory) {
	if (toolbarFactories.has(modeId)) {
		throw new Error(`Editor mode toolbar '${modeId}' is already registered.`);
	}
	toolbarFactories.set(modeId, factory);
	return toDisposable(() => toolbarFactories.delete(modeId));
}

export class EditorModeToolbarHost {
	private context: EditorModeToolbarHostContext;
	private activePaneModeId: string | null = null;
	private activeToolbar: EditorModeToolbar | null = null;

	constructor(
		context: EditorModeToolbarHostContext,
		private readonly dropdownServices: DropdownContextServices,
	) {
		this.context = context;
		this.updateToolbar();
	}

	getElement(): HTMLElement | null {
		return this.activeToolbar?.getElement() ?? null;
	}

	setContext(context: EditorModeToolbarHostContext): void {
		this.context = context;
		this.updateToolbar();
	}

	focusPrimaryInput(): boolean {
		if (!this.activeToolbar?.focusPrimaryInput) {
			return false;
		}
		this.activeToolbar.focusPrimaryInput();
		return true;
	}

	dispose(): void {
		this.activeToolbar?.dispose();
		this.activeToolbar = null;
		this.activePaneModeId = null;
	}

	private updateToolbar(): void {
		if (this.activePaneModeId === this.context.activePaneModeId) {
			this.activeToolbar?.setContext(this.context);
			return;
		}

		this.activeToolbar?.dispose();
		this.activeToolbar = null;
		this.activePaneModeId = this.context.activePaneModeId;
		if (!this.activePaneModeId) {
			return;
		}

		const factory = toolbarFactories.get(this.activePaneModeId);
		if (factory) {
			this.activeToolbar = factory(this.context, this.dropdownServices);
		}
	}
}

export function createEditorModeToolbarHost(
	context: EditorModeToolbarHostContext,
	dropdownServices: DropdownContextServices,
) {
	return new EditorModeToolbarHost(context, dropdownServices);
}
