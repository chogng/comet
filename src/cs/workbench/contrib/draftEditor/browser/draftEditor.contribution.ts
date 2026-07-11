/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftEditorPane, type DraftEditorPaneLabels } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPane';
import {
	createEditorPaneDescriptor,
	registerEditorPaneDescriptor,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import { DraftEditorInput, DraftEditorInputSerializer } from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';
import { Disposable } from 'cs/base/common/lifecycle';
import { createEmptyWritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { CreateDraftEditorCommandId, DraftEditorInputScheme, createDraftEditorResource } from 'cs/workbench/contrib/draftEditor/common/draftEditorResources';
import { IEditorResolverService, RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { localize } from 'cs/nls';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import 'cs/workbench/contrib/draftEditor/browser/draftEditor.css';
import { registerStatusbarModeRenderer } from 'cs/workbench/browser/parts/statusbar/statusbarModeRenderers';
import { renderDraftStatusbarMode } from 'cs/workbench/contrib/draftEditor/browser/draftEditorStatusbarRenderer';
import { registerEditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import type { LocaleMessages } from 'language/locales';

editorInputSerializerRegistry.register(DraftEditorInput.ID, new DraftEditorInputSerializer());
registerStatusbarModeRenderer('draft', renderDraftStatusbarMode);
registerEditorCreationAction({
	commandId: CreateDraftEditorCommandId,
	icon: 'draft',
	order: 10,
	getLabel: ui => ui.editorCreateDraft,
});

function createDraftEditorPaneLabels(ui: LocaleMessages): DraftEditorPaneLabels {
	return {
		toolbarMore: ui.agentbarToolbarMore,
		draftBodyPlaceholder: ui.editorDraftBodyPlaceholder,
		draftMode: ui.editorDraftMode,
		editorModalConfirm: ui.editorModalConfirm,
		editorModalCancel: ui.editorModalCancel,
		textGroup: ui.editorRibbonText,
		formatGroup: ui.editorRibbonFormat,
		insertGroup: ui.editorRibbonInsert,
		historyGroup: ui.editorRibbonHistory,
		paragraph: ui.editorParagraph,
		heading1: ui.editorHeading1,
		heading2: ui.editorHeading2,
		heading3: ui.editorHeading3,
		bold: ui.editorBold,
		italic: ui.editorItalic,
		underline: ui.editorUnderline,
		fontFamily: ui.editorFontFamily,
		fontSize: ui.editorFontSize,
		defaultTextStyle: ui.editorDefaultTextStyle,
		alignLeft: ui.editorAlignLeft,
		alignCenter: ui.editorAlignCenter,
		alignRight: ui.editorAlignRight,
		clearInlineStyles: ui.editorClearInlineStyles,
		bulletList: ui.editorBulletList,
		orderedList: ui.editorOrderedList,
		blockquote: ui.editorBlockquote,
		undo: ui.editorUndo,
		redo: ui.editorRedo,
		insertCitation: ui.editorInsertCitation,
		insertFigure: ui.editorInsertFigure,
		insertFigureRef: ui.editorInsertFigureRef,
		citationPrompt: ui.editorCitationPrompt,
		figureUrlPrompt: ui.editorFigureUrlPrompt,
		figureCaptionPrompt: ui.editorFigureCaptionPrompt,
		figureRefPrompt: ui.editorFigureRefPrompt,
		fontFamilyPrompt: ui.editorFontFamilyPrompt,
		fontSizePrompt: ui.editorFontSizePrompt,
		status: {
			statusbarAriaLabel: ui.editorStatusbarAriaLabel,
			words: ui.editorStatusWords,
			characters: ui.editorStatusCharacters,
			paragraphs: ui.editorStatusParagraphs,
			selection: ui.editorStatusSelection,
			block: ui.editorStatusBlock,
			line: ui.editorStatusLine,
			column: ui.editorStatusColumn,
			blockFigure: ui.editorStatusFigure,
			ready: ui.statusReady,
		},
	};
}

function createDraftEditorPaneContext(context: import('cs/workbench/browser/parts/editor/panes/editorPaneRegistry').EditorPaneResolverContext) {
	return {
		contextMenuService: context.contextMenuService,
		contextViewProvider: context.contextViewProvider,
		labels: createDraftEditorPaneLabels(context.ui),
		dialogService: context.dialogService,
	};
}

registerEditorPaneDescriptor(createEditorPaneDescriptor({
	paneId: 'draft',
	contentClassNames: ['comet-is-mode-draft'],
	acceptsInput: (input): input is DraftEditorInput => input instanceof DraftEditorInput,
	createPane: context => context.instantiationService.createInstance(
		DraftEditorPane,
		createDraftEditorPaneContext(context),
	),
	updatePane: (pane, context) => pane.setContext(createDraftEditorPaneContext(context)),
}));

registerAction2(class CreateDraftEditorAction extends Action2 {
	constructor() {
		super({
			id: CreateDraftEditorCommandId,
			title: localize('draft.createAction', "Create Draft"),
			f1: true,
		});
	}

	run(accessor: Parameters<Action2['run']>[0]) {
		return accessor.get(IEditorService).openEditor({ resource: createDraftEditorResource() });
	}
});

class DraftEditorResolverContribution extends Disposable {
	constructor(
		@IEditorResolverService editorResolverService: IEditorResolverService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this._register(editorResolverService.registerEditor(
			`${DraftEditorInputScheme}:/**`,
			{
				id: DraftEditorInput.EDITOR_ID,
				label: localize('draft.editorLabel', "Draft"),
				priority: RegisteredEditorPriority.exclusive,
			},
			{ canSupportResource: resource => resource.scheme === DraftEditorInputScheme },
			{
				createEditorInput: ({ resource }) => ({
					editor: instantiationService.createInstance(DraftEditorInput, {
						document: createEmptyWritingEditorDocument(),
						resource,
					}),
				}),
			},
		));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(DraftEditorResolverContribution),
);
