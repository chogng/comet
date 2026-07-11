/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { createWritingEditorDocumentFromPlainText, writingEditorDocumentToPlainText } from 'cs/editor/common/writingEditorDocument';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { EditorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import {
	deserializeEditorGroup,
	deserializeEditorGroups,
	serializeEditorGroup,
	serializeEditorGroups,
} from 'cs/workbench/browser/parts/editor/editorGroupSerialization';
import { EditorGroup } from 'cs/workbench/browser/parts/editor/editorGroup';
import { EditorGroups } from 'cs/workbench/browser/parts/editor/editorGroups';
import {
	DraftEditorInput,
	DraftEditorInputSerializer,
	IDraftEditorCloseService,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';
import {
	PdfEditorInput,
	PdfEditorInputSerializer,
} from 'cs/workbench/contrib/pdfEditor/common/pdfEditorInput';

test('EditorInputSerializerRegistry persists typed inputs without group feature branches', () => {
	const registry = new EditorInputSerializerRegistry();
	registry.register(DraftEditorInput.ID, new DraftEditorInputSerializer());
	registry.register(PdfEditorInput.ID, new PdfEditorInputSerializer());
	const closeService = {
		_serviceBrand: undefined,
		confirmClose: async () => true,
	};
	const instantiationService = new InstantiationService(new ServiceCollection(
		[IDraftEditorCloseService, closeService],
	));
	const draft = new DraftEditorInput({
		id: 'draft-a',
		title: 'Draft A',
		document: createWritingEditorDocumentFromPlainText('body'),
	}, closeService);
	const pdf = new PdfEditorInput({
		id: 'pdf-a',
		url: 'https://example.com/paper.pdf',
	});

	const restoredDraft = registry.deserialize(registry.serialize(draft), instantiationService);
	const restoredPdf = registry.deserialize(registry.serialize(pdf), instantiationService);
	assert(restoredDraft instanceof DraftEditorInput);
	assert(restoredPdf instanceof PdfEditorInput);
	assert.equal(restoredDraft.id, 'draft-a');
	assert.equal(writingEditorDocumentToPlainText(restoredDraft.document), 'body');
	assert.equal(restoredPdf.id, 'pdf-a');
	assert.equal(restoredPdf.url, 'https://example.com/paper.pdf');

	draft.dispose();
	pdf.dispose();
	restoredDraft.dispose();
	restoredPdf.dispose();
	instantiationService.dispose();
});

test('EditorGroup serialization restores input order, active editor, and MRU by serializer', () => {
	const registry = new EditorInputSerializerRegistry();
	registry.register(PdfEditorInput.ID, new PdfEditorInputSerializer());
	const instantiationService = new InstantiationService(new ServiceCollection());
	const group = new EditorGroup('group-a');
	const first = new PdfEditorInput({ id: 'pdf-a', url: 'https://example.com/a.pdf' });
	const second = new PdfEditorInput({ id: 'pdf-b', url: 'https://example.com/b.pdf' });
	group.openEditor(first);
	group.openEditor(second);
	group.setActive(first);

	const restored = deserializeEditorGroup(
		serializeEditorGroup(group, registry),
		registry,
		instantiationService,
	);
	assert.deepEqual(restored.getEditors().map(editor => editor.resource?.path), ['pdf-a', 'pdf-b']);
	assert.equal(restored.active?.resource?.path, 'pdf-a');
	assert.deepEqual(
		restored.getMostRecentlyActiveEditors().map(editor => editor.resource?.path),
		['pdf-a', 'pdf-b'],
	);
	group.dispose();
	restored.dispose();
	instantiationService.dispose();
});

test('EditorGroups serialization restores group ownership and the active group', () => {
	const registry = new EditorInputSerializerRegistry();
	registry.register(PdfEditorInput.ID, new PdfEditorInputSerializer());
	const instantiationService = new InstantiationService(new ServiceCollection());
	const groups = new EditorGroups();
	const secondGroup = groups.createGroup('group-b');
	groups.openEditor(new PdfEditorInput({ id: 'pdf-a' }));
	groups.openEditor(new PdfEditorInput({ id: 'pdf-b' }), { groupId: secondGroup.id });

	const restored = deserializeEditorGroups(
		serializeEditorGroups(groups, registry),
		registry,
		instantiationService,
	);
	assert.equal(restored.active.id, 'group-b');
	assert.deepEqual(
		restored.getGroups().map(group => group.getEditors().map(editor => editor.resource?.path)),
		[['pdf-a'], ['pdf-b']],
	);
	groups.dispose();
	restored.dispose();
	instantiationService.dispose();
});
