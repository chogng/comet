/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { URI } from 'cs/base/common/uri';
import { commandService, setCommandServiceInstantiationService } from 'cs/platform/commands/common/commands';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { CreateDraftEditorCommandId, DraftEditorInputScheme } from 'cs/workbench/contrib/draftEditor/common/draftEditorResources';
import { CreatePdfEditorCommandId, PdfEditorInputScheme } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorResources';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { IEditorService, type IEditorService as IEditorServiceType } from 'cs/workbench/services/editor/common/editorService';
import { getEditorCreationActions } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import type { LocaleMessages } from 'language/locales';

import 'cs/workbench/contrib/draftEditor/browser/draftEditor.contribution';
import 'cs/workbench/contrib/pdfEditor/browser/pdfEditor.contribution';

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

test('Draft and PDF create Action2 commands open resources through IEditorService', async () => {
	const resources: URI[] = [];
	const editorService: IEditorServiceType = {
		_serviceBrand: undefined,
		openEditor: async input => {
			if (input instanceof EditorInput || !('resource' in input) || !input.resource) {
				throw new Error('Expected an untyped resource input.');
			}
			resources.push(input.resource);
			return new TestEditorInput(input.resource);
		},
		activateEditor() {},
		closeEditor: async () => false,
		getEditors: () => [],
		getActiveGroupId: () => 'group-a',
	};
	const instantiationService = new InstantiationService(new ServiceCollection(
		[IEditorService, editorService],
	), true);
	const commandServiceRegistration = setCommandServiceInstantiationService(instantiationService);

	try {
		await commandService.executeCommand(CreateDraftEditorCommandId);
		await commandService.executeCommand(CreatePdfEditorCommandId);
	} finally {
		commandServiceRegistration.dispose();
		instantiationService.dispose();
	}

	assert.deepEqual(resources.map(resource => resource.scheme), [
		DraftEditorInputScheme,
		PdfEditorInputScheme,
	]);
});
