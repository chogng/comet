/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	createWritingEditorDocumentFromPlainText,
	writingEditorDocumentToPlainText,
} from 'cs/editor/common/writingEditorDocument';
import {
	DraftEditorInput,
	type IDraftEditorCloseService,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';

function createCloseService(confirmClose = true): IDraftEditorCloseService {
	return {
		_serviceBrand: undefined,
		confirmClose: async () => confirmClose,
	};
}

test('DraftEditorInput owns document, dirty, save, identity, and serialization state', async () => {
	const input = new DraftEditorInput({
		id: 'draft-a',
		title: 'Draft A',
		document: createWritingEditorDocumentFromPlainText('initial'),
	}, createCloseService());
	let dirtyChanges = 0;
	input.onDidChangeDirty(() => dirtyChanges += 1);

	input.setDocument(createWritingEditorDocumentFromPlainText('changed'));
	assert.equal(input.isDirty(), true);
	assert.equal(dirtyChanges, 1);
	assert.equal(await input.save(), true);
	assert.equal(input.isDirty(), false);
	assert.equal(dirtyChanges, 2);
	const serialized = input.serialize();
	assert.equal(serialized.id, 'draft-a');
	assert.equal(serialized.title, 'Draft A');
	assert.equal(writingEditorDocumentToPlainText(serialized.document), 'changed');
	input.dispose();
});

test('DraftEditorInput delegates dirty close confirmation to its feature handler', async () => {
	let allowClose = false;
	const closeService: IDraftEditorCloseService = {
		_serviceBrand: undefined,
		confirmClose: async () => allowClose,
	};
	const input = new DraftEditorInput({
		id: 'draft-a',
		document: createWritingEditorDocumentFromPlainText('initial'),
	}, closeService);
	input.setDocument(createWritingEditorDocumentFromPlainText('changed'));

	assert.equal(await input.closeHandler.confirmClose(), false);
	allowClose = true;
	assert.equal(await input.closeHandler.confirmClose(), true);
	input.dispose();
});
