import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { toDisposable } from 'cs/base/common/lifecycle';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { EditorPartBrowserToolbarActions, EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';

export type EditorModeToolbarHostContext = EditorPartBrowserToolbarActions & {
	readonly activeTab: EditorInput | null;
	readonly activePaneId: string | null;
	readonly activePane: AnyEditorPane | null;
	readonly contentElement: HTMLElement;
	readonly toolbarElement: HTMLElement;
	readonly labels: EditorPartLabels;
	readonly viewPartProps: ViewPartProps;
	readonly onOpenEditor: EditorOpenHandler;
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

export function registerEditorModeToolbar(paneId: string, factory: EditorModeToolbarFactory) {
	if (toolbarFactories.has(paneId)) {
		throw new Error(`Editor mode toolbar '${paneId}' is already registered.`);
	}
	toolbarFactories.set(paneId, factory);
	return toDisposable(() => toolbarFactories.delete(paneId));
}

export class EditorModeToolbarHost {
	private context: EditorModeToolbarHostContext;
	private activePaneId: string | null = null;
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
		this.activePaneId = null;
	}

	private updateToolbar(): void {
		if (this.activePaneId === this.context.activePaneId) {
			this.activeToolbar?.setContext(this.context);
			return;
		}

		this.activeToolbar?.dispose();
		this.activeToolbar = null;
		this.activePaneId = this.context.activePaneId;
		if (!this.activePaneId) {
			return;
		}

		const factory = toolbarFactories.get(this.activePaneId);
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
