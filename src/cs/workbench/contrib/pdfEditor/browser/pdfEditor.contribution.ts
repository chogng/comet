/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { PdfEditorPane } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorPane';
import {
	EditorPaneDescriptor,
	editorPaneRegistry,
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
import { PdfEditorChatAttachmentsContribution } from 'cs/workbench/contrib/pdfEditor/browser/pdfChatAttachments';

editorInputSerializerRegistry.register(PdfEditorInput.ID, new PdfEditorInputSerializer());
registerStatusbarModeRenderer('pdf', renderPdfStatusbarMode);
registerEditorCreationAction({
	commandId: CreatePdfEditorCommandId,
	icon: 'file-text',
	order: 30,
	getLabel: ui => ui.editorCreateFile,
});

editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
	paneId: PdfEditorInput.EDITOR_ID,
	modeId: 'pdf',
	contentClassNames: ['comet-is-mode-pdf'],
	inputConstructor: PdfEditorInput,
	paneConstructor: PdfEditorPane,
}));

export class PdfEditorActionsContribution extends Disposable {
	constructor(@IEditorService editorService: IEditorService) {
		super();
		this._register(registerAction2(class CreatePdfEditorAction extends Action2 {
			constructor() {
				super({
					id: CreatePdfEditorCommandId,
					title: localize('pdf.createAction', "Create PDF"),
					f1: true,
				});
			}

			run() {
				return editorService.openEditor({ resource: createPdfEditorResource() });
			}
		}));
	}
}

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
					options,
				}),
			},
		));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(PdfEditorResolverContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(PdfEditorActionsContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(PdfEditorChatAttachmentsContribution),
);
