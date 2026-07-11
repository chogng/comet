/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PdfEditorPane, type PdfEditorPaneLabels } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorPane';
import {
	createEditorPaneDescriptor,
	registerEditorPaneDescriptor,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import { PdfEditorInput, PdfEditorInputSerializer } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';
import { Disposable } from 'cs/base/common/lifecycle';
import { CreatePdfEditorCommandId, PdfEditorInputScheme, createPdfEditorResource } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorResources';
import { IEditorResolverService, RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { localize } from 'cs/nls';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import 'cs/workbench/contrib/pdfEditor/browser/pdfEditor.css';
import { registerStatusbarModeRenderer } from 'cs/workbench/browser/parts/statusbar/statusbarModeRenderers';
import { renderPdfStatusbarMode } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorStatusbarRenderer';
import { registerEditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';

editorInputSerializerRegistry.register(PdfEditorInput.ID, new PdfEditorInputSerializer());
registerStatusbarModeRenderer('pdf', renderPdfStatusbarMode);
registerEditorCreationAction({
	commandId: CreatePdfEditorCommandId,
	icon: 'file-text',
	order: 30,
	getLabel: ui => ui.editorCreateFile,
});

function createPdfEditorPaneLabels(context: import('cs/workbench/browser/parts/editor/panes/editorPaneRegistry').EditorPaneResolverContext): PdfEditorPaneLabels {
	const { ui } = context;
	return {
		toolbarSources: ui.agentbarToolbarSources,
		toolbarMore: ui.agentbarToolbarMore,
		pdfTitle: ui.editorPdfTitle,
		pdfOpenFile: ui.editorPdfOpenFile,
		emptyWorkspaceBody: ui.editorEmptyWorkspaceBody,
		pdfMode: ui.editorPdfMode,
		status: {
			statusbarAriaLabel: ui.editorStatusbarAriaLabel,
			url: ui.editorStatusUrl,
		},
	};
}

function createPdfEditorPaneContext(context: import('cs/workbench/browser/parts/editor/panes/editorPaneRegistry').EditorPaneResolverContext) {
	return {
		contextMenuService: context.contextMenuService,
		contextViewProvider: context.contextViewProvider,
		labels: createPdfEditorPaneLabels(context),
		viewPartProps: context.viewPartProps,
		nativeHost: context.nativeHost,
		onOpenEditor: context.onOpenEditor,
		onOpenSources: context.onOpenSources,
	};
}

registerEditorPaneDescriptor(createEditorPaneDescriptor({
	paneId: 'pdf',
	contentClassNames: ['comet-is-mode-pdf'],
	acceptsInput: (input): input is PdfEditorInput => input instanceof PdfEditorInput,
	createPane: context => context.instantiationService.createInstance(
		PdfEditorPane,
		createPdfEditorPaneContext(context),
	),
	updatePane: (pane, context) => pane.setContext(createPdfEditorPaneContext(context)),
}));

registerAction2(class CreatePdfEditorAction extends Action2 {
	constructor() {
		super({
			id: CreatePdfEditorCommandId,
			title: localize('pdf.createAction', "Create PDF"),
			f1: true,
		});
	}

	run(accessor: Parameters<Action2['run']>[0]) {
		return accessor.get(IEditorService).openEditor({ resource: createPdfEditorResource() });
	}
});

class PdfEditorResolverContribution extends Disposable {
	constructor(@IEditorResolverService editorResolverService: IEditorResolverService) {
		super();
		this._register(editorResolverService.registerEditor(
			'*',
			{
				id: PdfEditorInput.EDITOR_ID,
				label: localize('pdf.editorLabel', "PDF"),
				priority: RegisteredEditorPriority.exclusive,
			},
			{
				canSupportResource: resource =>
					resource.scheme === PdfEditorInputScheme || resource.path.toLowerCase().endsWith('.pdf'),
			},
			{
				createEditorInput: ({ resource, options }) => ({
					editor: new PdfEditorInput({
						resource,
						url: options?.viewState?.url
							?? (resource.scheme === PdfEditorInputScheme ? undefined : resource.toString()),
					}),
				}),
			},
		));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(PdfEditorResolverContribution),
);
