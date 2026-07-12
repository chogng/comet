/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { URI } from 'cs/base/common/uri';
import { commandService, commandsRegistry, setCommandServiceInstantiationService } from 'cs/platform/commands/common/commands';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { CreateDraftEditorCommandId, DraftEditorInputScheme } from 'cs/workbench/contrib/draftEditor/common/draftEditorResources';
import { CreatePdfEditorCommandId, PdfEditorInputScheme } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorResources';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { IEditorService, type IEditorService as IEditorServiceType } from 'cs/workbench/services/editor/common/editorService';
import { getEditorCreationActions } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import type { LocaleMessages } from 'language/locales';
import { DraftEditorActionsContribution } from 'cs/workbench/contrib/draftEditor/browser/draftEditor.contribution';
import { DraftEditorPane } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPane';
import type { DraftEditorCommandId } from 'cs/editor/browser/text/editorCommandRegistry';
import type { DraftEditorSurfaceActionId } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import type { IDraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import { PdfEditorActionsContribution } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditor.contribution';
import type { IEditorPane } from 'cs/workbench/common/editor';
import { locales } from 'language/locales';


test('Editor creation actions are contributed by editor features', () => {
	const actions = getEditorCreationActions({
		editorCreateDraft: 'Draft',
		editorCreateFile: 'PDF',
	} as LocaleMessages);
	assert.deepEqual(
		actions.map(action => action.commandId),
		[CreateDraftEditorCommandId, CreatePdfEditorCommandId],
	);
});

class TestEditorInput extends EditorInput {
	constructor(readonly resource: URI) {
		super();
	}

	get typeId(): string {
		return 'test.editorInput';
	}
}

function createDraftEditorService(saveActive = () => false): IDraftEditorService {
	return {
		_serviceBrand: undefined,
		activeInput: undefined,
		canSaveActive: () => false,
		saveActive,
		getDocument: () => null,
		setDocument() {},
		getActiveRequestAttachment: () => undefined,
	};
}

test('Draft and PDF create Action2 commands open resources through IEditorService', async () => {
	const resources: URI[] = [];
	const editorService: IEditorServiceType = {
		_serviceBrand: undefined,
		activeEditorPane: undefined,
		activeEditor: undefined,
		openEditor: async input => {
			if (input instanceof EditorInput || !('resource' in input) || !input.resource) {
				throw new Error('Expected an untyped resource input.');
			}
			resources.push(input.resource);
			return new TestEditorInput(input.resource);
		},
		activateEditor: async () => {},
		closeEditor: async () => false,
		getEditors: () => [],
		getActiveGroupId: () => 'group-a',
	};
	const instantiationService = new InstantiationService(new ServiceCollection(
		[IEditorService, editorService],
	), true);
	const commandServiceRegistration = setCommandServiceInstantiationService(instantiationService);
	const draftActions = new DraftEditorActionsContribution(editorService, createDraftEditorService());
	const pdfActions = new PdfEditorActionsContribution(editorService);

	try {
		await commandService.executeCommand(CreateDraftEditorCommandId);
		await commandService.executeCommand(CreatePdfEditorCommandId);
	} finally {
		pdfActions.dispose();
		draftActions.dispose();
		commandServiceRegistration.dispose();
		instantiationService.dispose();
	}

	assert.deepEqual(resources.map(resource => resource.scheme), [
		DraftEditorInputScheme,
		PdfEditorInputScheme,
	]);
});

test('Draft contribution owns active Draft commands without a Sessions Part target', () => {
	const executedCommands: string[] = [];
	class TestDraftEditorPane extends DraftEditorPane {
		constructor() {
			super(
				{} as never,
				{} as never,
				{} as never,
				{ getLocaleMessages: () => locales.en } as never,
				{ getLocale: () => 'en', subscribe: () => () => {} } as never,
			);
		}

		override canExecuteCommand(_commandId: DraftEditorCommandId): boolean {
			return true;
		}

		override executeCommand(commandId: DraftEditorCommandId): boolean {
			executedCommands.push(commandId);
			return true;
		}

		override executeEditorAction(actionId: DraftEditorSurfaceActionId): boolean {
			executedCommands.push(actionId);
			return true;
		}
	}

	const pane = new TestDraftEditorPane();
	let activeEditorPane: IEditorPane | undefined = pane;
	const editorService = {
		_serviceBrand: undefined,
		get activeEditorPane() { return activeEditorPane; },
		activeEditor: undefined,
		openEditor: async () => new TestEditorInput(URI.parse('test:/draft-command')),
		activateEditor: async () => {},
		closeEditor: async () => false,
		getEditors: () => [],
		getActiveGroupId: () => 'group-a',
	} satisfies IEditorServiceType;
	let saveCount = 0;
	const contribution = new DraftEditorActionsContribution(
		editorService,
		createDraftEditorService(() => {
			saveCount += 1;
			return true;
		}),
	);
	const accessor = {
		get: () => {
			throw new Error('Draft command handlers must use constructor-injected services.');
		},
	} as ServicesAccessor;
	const commandInvocationService = new InstantiationService(new ServiceCollection(), true);
	const commandServiceRegistration = setCommandServiceInstantiationService(commandInvocationService);

	try {
		assert.equal(commandsRegistry.getCommand('saveDraft')?.handler(accessor), true);
		assert.equal(commandsRegistry.getCommand('insertCitation')?.handler(accessor), true);
		assert.equal(commandsRegistry.getCommand('undo')?.handler(accessor), true);
		const shortcutEvent = new KeyboardEvent('keydown', {
			key: 'f',
			ctrlKey: true,
			shiftKey: true,
			bubbles: true,
			cancelable: true,
		});
		document.body.dispatchEvent(shortcutEvent);
		assert.equal(shortcutEvent.defaultPrevented, true);
		activeEditorPane = { focus() {} };
		assert.equal(commandsRegistry.getCommand('insertFigure')?.handler(accessor), false);
		assert.deepEqual({ saveCount, executedCommands }, {
			saveCount: 1,
			executedCommands: ['insertCitation', 'undo', 'insertFigure'],
		});
	} finally {
		commandServiceRegistration.dispose();
		commandInvocationService.dispose();
		contribution.dispose();
		pane.dispose();
	}

	assert.equal(commandsRegistry.getCommand('saveDraft'), null);
	assert.equal(commandsRegistry.getCommand('insertCitation'), null);
	assert.equal(commandsRegistry.getCommand('undo'), null);
});
