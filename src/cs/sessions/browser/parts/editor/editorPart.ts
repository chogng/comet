/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IStorageService } from 'cs/platform/storage/common/storage';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import {
	getWorkbenchPartDomNode,
	registerWorkbenchPartDomNode,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import {
	MainEditorPart,
	type EditorPartLabels,
	type IEditorPartsConstructionOwner,
} from 'cs/workbench/browser/parts/editor/editorPart';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import {
	resetStatusbarState,
	setStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

import 'cs/workbench/browser/parts/editor/media/editor.css';
import 'cs/sessions/browser/parts/editor/media/editorPart.css';
import 'cs/workbench/browser/parts/editor/media/tabsTitleControl.css';

export class SessionsMainEditorPart extends MainEditorPart {
	readonly id = SESSION_PART_IDS.editor;

	constructor(
		editorGroupsService: IEditorPartsConstructionOwner,
		@IDialogService dialogService: IDialogService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@IWorkbenchCommandService commandService: IWorkbenchCommandService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IContextViewService contextViewService: IContextViewService,
		@IWorkbenchLocaleService localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService languageService: IWorkbenchLanguageService,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super(
			editorGroupsService,
			$<HTMLElementTagNameMap['section']>('section.comet-panel.comet-editor-panel.comet-session-editor-panel'),
			dialogService,
			instantiationService,
			storageService,
			commandService,
			contextMenuService,
			contextViewService,
			localeService,
			languageService,
		);
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, this.getElement());
		this._register(this.layoutService.onDidChangeLayoutState(() => {
			this.refreshPresentation();
		}));
	}

	revealEditor(expandedEditorSize?: number): void {
		this.layoutService.setEditorCollapsed(false, expandedEditorSize);
	}

	protected get editorCollapsed(): boolean {
		return this.layoutService.getLayoutState().isEditorCollapsed;
	}

	protected toggleEditorCollapsed(): void {
		this.layoutService.toggleEditorCollapsed();
	}

	protected updateEditorStatus(status: EditorStatusState): void {
		setStatusbarState(status);
	}

	protected override onDidResolveLabels(labels: EditorPartLabels): void {
		resetStatusbarState(labels.status);
	}

	override dispose(): void {
		if (getWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor) === this.getElement()) {
			registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, null);
		}
		super.dispose();
	}
}
