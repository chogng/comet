/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DraftEditorPane } from 'cs/workbench/browser/parts/editor/panes/draftEditorPane';
import {
	createEditorPaneDescriptor,
	registerEditorPaneDescriptor,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import { DraftEditorInput, DraftEditorInputSerializer } from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';
import { Disposable } from 'cs/base/common/lifecycle';
import { createEmptyWritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import { CreateDraftEditorCommandId, DraftEditorInputScheme, createDraftEditorResource } from 'cs/workbench/common/editor/editorResources';
import { IEditorResolverService, RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import { registerWorkbenchContribution } from 'cs/workbench/common/contributions';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { localize } from 'cs/nls';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { getEditorInputId } from 'cs/workbench/browser/parts/editor/editorGroupModel';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';

editorInputSerializerRegistry.register(DraftEditorInput.ID, new DraftEditorInputSerializer());

registerEditorPaneDescriptor(createEditorPaneDescriptor({
	paneId: 'draft',
	contentClassNames: ['comet-is-mode-draft'],
	acceptsInput: (input): input is DraftEditorInput => input instanceof DraftEditorInput,
	createPane: (input, context) => new DraftEditorPane(input, {
		contextMenuService: context.contextMenuService,
		contextViewProvider: context.contextViewProvider,
		labels: context.labels,
		dialogService: context.dialogService,
		onStatusChange: (draftInput, status) => context.onDraftStatusChange(getEditorInputId(draftInput), status),
	}),
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
