/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener } from 'cs/base/browser/dom';
import { cloneEditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import { DraftEditorPane } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPane';
import {
	EditorPaneDescriptor,
	editorPaneRegistry,
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
import { commandService, commandsRegistry } from 'cs/platform/commands/common/commands';
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import {
	IDraftEditorService,
	type IDraftEditorService as IDraftEditorServiceContract,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import 'cs/workbench/contrib/draftEditor/browser/draftEditor.css';
import { registerStatusbarModeRenderer } from 'cs/workbench/browser/parts/statusbar/statusbarModeRenderers';
import { renderDraftStatusbarMode } from 'cs/workbench/contrib/draftEditor/browser/draftEditorStatusbarRenderer';
import { registerEditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import type { DraftEditorSurfaceActionId } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import {
	DocumentActionsCommandId,
	IDocumentActionsService,
	type IDocumentActionsService as IDocumentActionsServiceContract,
} from 'cs/workbench/services/document/common/documentActions';
import { ISettingsModel, SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import { INativeHostService } from 'cs/platform/native/common/native';
import {
	getDraftEditorCommandIds,
	getDraftEditorShortcutLabel,
	matchesShortcutLabel,
	type DraftEditorCommandId,
} from 'cs/editor/browser/text/editorCommandRegistry';
import { DraftEditorChatAttachmentsContribution } from 'cs/workbench/contrib/draftEditor/browser/draftEditorChatAttachments';
import { DraftEditorAgentToolsContribution } from 'cs/workbench/contrib/draftEditor/browser/draftEditorAgentTools';

const DraftEditorSurfaceActionIds: readonly DraftEditorSurfaceActionId[] = ['undo', 'redo'];
type DraftEditorWorkbenchCommandId = DraftEditorCommandId | 'saveDraft';
const DraftEditorWorkbenchCommandIds: readonly DraftEditorWorkbenchCommandId[] = [
	'saveDraft',
	...getDraftEditorCommandIds(),
];

function isFormControlEventTarget(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) {
		return false;
	}
	const tagName = target.tagName.toLowerCase();
	return tagName === 'input' || tagName === 'textarea' || tagName === 'select';
}

function isEditableEventTarget(target: EventTarget | null): boolean {
	return isFormControlEventTarget(target)
		|| target instanceof HTMLElement && target.isContentEditable;
}

function executeRegisteredDraftEditorCommand(commandId: DraftEditorWorkbenchCommandId): boolean {
	const result = commandService.executeCommand<boolean>(commandId);
	if (result === undefined) {
		throw new Error(`Draft Editor command '${commandId}' is not registered.`);
	}
	return result;
}

function handleDraftEditorShortcut(event: KeyboardEvent): boolean {
	if (event.defaultPrevented) {
		return false;
	}

	const isSave = (event.metaKey || event.ctrlKey)
		&& !event.shiftKey
		&& !event.altKey
		&& event.key.toLowerCase() === 's';
	if (isSave) {
		if (isFormControlEventTarget(event.target)
			|| !executeRegisteredDraftEditorCommand('saveDraft')) {
			return false;
		}
		event.preventDefault();
		return true;
	}

	if (isEditableEventTarget(event.target)) {
		return false;
	}
	const commandId = getDraftEditorCommandIds().find(candidate =>
		matchesShortcutLabel(getDraftEditorShortcutLabel(candidate), event),
	);
	if (!commandId || !executeRegisteredDraftEditorCommand(commandId)) {
		return false;
	}
	event.preventDefault();
	return true;
}

editorInputSerializerRegistry.register(DraftEditorInput.ID, new DraftEditorInputSerializer());
registerStatusbarModeRenderer('draft', renderDraftStatusbarMode);
registerEditorCreationAction({
	commandId: CreateDraftEditorCommandId,
	icon: 'draft',
	order: 10,
	getLabel: ui => ui.editorCreateDraft,
});

editorPaneRegistry.registerEditorPane(new EditorPaneDescriptor({
	paneId: DraftEditorInput.EDITOR_ID,
	modeId: 'draft',
	contentClassNames: ['comet-is-mode-draft'],
	inputConstructor: DraftEditorInput,
	paneConstructor: DraftEditorPane,
}));

export class DraftEditorActionsContribution extends Disposable {
	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IDraftEditorService private readonly draftEditorService: IDraftEditorServiceContract,
		@ISettingsModel private readonly settingsModel: SettingsModel,
		@IDocumentActionsService private readonly documentActionsService: IDocumentActionsServiceContract,
		@INativeHostService private readonly nativeHostService: INativeHostService,
	) {
		super();
		this._register(registerAction2(class CreateDraftEditorAction extends Action2 {
			constructor() {
				super({
					id: CreateDraftEditorCommandId,
					title: localize('draft.createAction', "Create Draft"),
					f1: true,
				});
			}

			run() {
				return editorService.openEditor({ resource: createDraftEditorResource() });
			}
		}));
		if (this.nativeHostService.canInvoke()) {
			const exportDraftDocument = () => this.exportActiveDraftDocument();
			this._register(registerAction2(class ExportDraftDocumentAction extends Action2 {
				constructor() {
					super({
						id: DocumentActionsCommandId.ExportDraftDocument,
						title: localize('draft.exportDocument', "Export Draft as DOCX"),
						f1: true,
					});
				}

				run() {
					return exportDraftDocument();
				}
			}));
		}
		for (const commandId of DraftEditorWorkbenchCommandIds) {
			this._register(commandsRegistry.registerCommand(commandId, () =>
				this.executeDraftEditorWorkbenchCommand(commandId),
			));
		}
		for (const actionId of DraftEditorSurfaceActionIds) {
			this._register(commandsRegistry.registerCommand(actionId, () =>
				this.executeDraftEditorSurfaceAction(actionId),
			));
		}
		this._register(addDisposableListener(document, 'keydown', event => {
			handleDraftEditorShortcut(event);
		}));
	}

	private executeDraftEditorWorkbenchCommand(commandId: DraftEditorWorkbenchCommandId): boolean {
		if (commandId === 'saveDraft') {
			return this.draftEditorService.saveActive();
		}
		const pane = this.activeDraftEditorPane;
		return pane ? pane.executeCommand(commandId) : false;
	}

	private exportActiveDraftDocument(): Promise<void> | undefined {
		const input = this.editorService.activeEditor;
		if (!(input instanceof DraftEditorInput)) {
			return undefined;
		}
		const document = this.draftEditorService.getDocument(input.resource);
		if (!document) {
			throw new Error(`Active Draft '${input.resource.toString()}' has no document.`);
		}

		return this.documentActionsService.exportDraftDocument({
			title: input.getName(),
			document,
			editorDraftStyle: cloneEditorDraftStyleSettings(
				this.settingsModel.getSnapshot().editorDraftStyle.value,
			),
		});
	}

	private executeDraftEditorSurfaceAction(actionId: DraftEditorSurfaceActionId): boolean {
		const pane = this.activeDraftEditorPane;
		return pane ? pane.executeEditorAction(actionId) : false;
	}

	private get activeDraftEditorPane(): DraftEditorPane | undefined {
		const pane = this.editorService.activeEditorPane;
		return pane instanceof DraftEditorPane ? pane : undefined;
	}
}

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
				createEditorInput: ({ resource, options }) => ({
					editor: instantiationService.createInstance(DraftEditorInput, {
						document: createEmptyWritingEditorDocument(),
						resource,
					}),
					options,
				}),
			},
		));
	}
}

registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(DraftEditorResolverContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(DraftEditorActionsContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(DraftEditorChatAttachmentsContribution),
);
registerWorkbenchContribution(() =>
	getWorkbenchInstantiationService().createInstance(DraftEditorAgentToolsContribution),
);
