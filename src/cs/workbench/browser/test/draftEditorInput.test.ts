/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Event } from 'cs/base/common/event';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import {
	createWritingEditorDocumentFromPlainText,
	writingEditorDocumentToPlainText,
} from 'cs/editor/common/writingEditorDocument';
import {
	DraftEditorInput,
	type IDraftEditorCloseService,
} from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';
import { DraftEditorPane } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPane';
import { DraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';
import { EditorGroupModel } from 'cs/workbench/common/editor/editorGroupModel';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type {
	IEditorGroup,
	IEditorGroupsOpenOptions,
	IEditorGroupsService,
} from 'cs/workbench/services/editor/common/editorGroupsService';
import { ChatRequestAttachmentKind } from 'cs/workbench/contrib/chat/common/chatRequest';
import { locales } from 'language/locales';

function createCloseService(confirmClose = true): IDraftEditorCloseService {
	return {
		_serviceBrand: undefined,
		confirmClose: async () => confirmClose,
	};
}

class TestEditorGroupsService implements IEditorGroupsService {
	declare readonly _serviceBrand: undefined;
	readonly mainPart = {
		activeEditorPane: undefined,
		openEditor: async () => {},
		revealEditor() {},
		focusPrimaryInput() {},
	};
	readonly onDidChange = Event.None;
	activeGroup: IEditorGroup;

	constructor(private readonly groups: IEditorGroup[], activeGroup: IEditorGroup) {
		this.activeGroup = activeGroup;
	}

	initialize(): void {}

	getGroups(): readonly IEditorGroup[] { return this.groups; }
	getGroup(groupId: string): IEditorGroup | undefined { return this.groups.find(group => group.id === groupId); }
	createGroup(): IEditorGroup { throw new Error('Test editor groups are fixed.'); }
	removeGroup(): void { throw new Error('Test editor groups are fixed.'); }
	activateGroup(group: IEditorGroup): void { this.activeGroup = group; }
	findEditor(editor: EditorInput) {
		const group = this.groups.find(candidate => candidate.contains(editor));
		return group ? { group, editor } : undefined;
	}
	openEditor(editor: EditorInput, options: IEditorGroupsOpenOptions = {}) {
		const group = options.groupId ? this.getGroup(options.groupId) : this.activeGroup;
		if (!group) {
			throw new Error(`Test editor group '${options.groupId}' does not exist.`);
		}
		const existing = group.getEditors().find(candidate => candidate.matches(editor));
		return {
			editor: group.openEditor(editor, { active: options.active }),
			group,
			newInGroup: !existing,
		};
	}
	closeEditor(editor: EditorInput): Promise<boolean> {
		const match = this.findEditor(editor);
		return match ? match.group.closeEditor(match.editor) : Promise.resolve(false);
	}
}

function createDraftEditorService(groups: EditorGroupModel[], activeGroup: EditorGroupModel) {
	return new DraftEditorService(new TestEditorGroupsService(groups, activeGroup));
}

function createPane() {
	return new DraftEditorPane(
		{} as never,
		{} as never,
		{} as never,
		{ getLocaleMessages: () => locales.en } as never,
		{ getLocale: () => 'en', subscribe: () => () => {} } as never,
	);
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

test('DraftEditorPane renders external document updates for its active input', () => {
	const input = new DraftEditorInput({
		id: 'draft-external-update',
		document: createWritingEditorDocumentFromPlainText('initial document'),
	}, createCloseService());
	const pane = createPane();
	try {
		pane.setInput(input, undefined, {}, CancellationTokenNone);
		assert.equal(pane.getElement().querySelector('.ProseMirror')?.textContent, 'initial document');

		input.setDocument(createWritingEditorDocumentFromPlainText('externally updated document'));
		assert.equal(pane.getElement().querySelector('.ProseMirror')?.textContent, 'externally updated document');
	} finally {
		pane.dispose();
		input.dispose();
	}
});

test('DraftEditorPane releases its old input subscription when the input is cleared', () => {
	const firstInput = new DraftEditorInput({
		id: 'draft-first',
		document: createWritingEditorDocumentFromPlainText('first document'),
	}, createCloseService());
	const secondInput = new DraftEditorInput({
		id: 'draft-second',
		document: createWritingEditorDocumentFromPlainText('second document'),
	}, createCloseService());
	const pane = createPane();
	try {
		pane.setInput(firstInput, undefined, {}, CancellationTokenNone);
		pane.clearInput();
		assert.equal(pane.getElement().childElementCount, 0);
		firstInput.setDocument(createWritingEditorDocumentFromPlainText('stale update'));
		assert.equal(pane.getElement().childElementCount, 0);

		pane.setInput(secondInput, undefined, {}, CancellationTokenNone);
		assert.equal(pane.getElement().querySelector('.ProseMirror')?.textContent, 'second document');
		secondInput.setDocument(createWritingEditorDocumentFromPlainText('current update'));
		assert.equal(pane.getElement().querySelector('.ProseMirror')?.textContent, 'current update');
	} finally {
		pane.dispose();
		firstInput.dispose();
		secondInput.dispose();
	}
});

test('DraftEditorService reads and patches the explicitly addressed open Draft resource', () => {
	const firstGroup = new EditorGroupModel('draft-resource-first-group');
	const secondGroup = new EditorGroupModel('draft-resource-second-group');
	const first = new DraftEditorInput({
		id: 'draft-resource-first',
		document: createWritingEditorDocumentFromPlainText('first document'),
	}, createCloseService());
	const second = new DraftEditorInput({
		id: 'draft-resource-second',
		document: createWritingEditorDocumentFromPlainText('second document'),
	}, createCloseService());
	firstGroup.openEditor(first);
	secondGroup.openEditor(second);
	const service = createDraftEditorService([firstGroup, secondGroup], firstGroup);
	const missingResource = URI.parse('draft:/missing');

	try {
		const secondDocument = service.getDocument(second.resource);
		assert(secondDocument);
		assert.notEqual(secondDocument, second.document);
		assert.equal(
			writingEditorDocumentToPlainText(secondDocument),
			'second document',
		);
		service.setDocument(
			second.resource,
			createWritingEditorDocumentFromPlainText('patched second document'),
		);
		assert.deepEqual({
			first: writingEditorDocumentToPlainText(first.document),
			second: writingEditorDocumentToPlainText(second.document),
			missing: service.getDocument(missingResource),
		}, {
			first: 'first document',
			second: 'patched second document',
			missing: null,
		});
		assert.throws(
			() => service.setDocument(missingResource, createWritingEditorDocumentFromPlainText('wrong target')),
			/Draft editor resource 'draft:\/missing' is not open\./,
		);
		assert.equal(writingEditorDocumentToPlainText(first.document), 'first document');
	} finally {
		firstGroup.dispose();
		secondGroup.dispose();
		first.dispose();
		second.dispose();
	}
});

test('DraftEditorService snapshots only the active bound Draft Pane selection', () => {
	const group = new EditorGroupModel('draft-attachment-group');
	const first = new DraftEditorInput({
		id: 'draft-attachment-first',
		title: 'First Draft',
		document: createWritingEditorDocumentFromPlainText('alpha beta'),
	}, createCloseService());
	const second = new DraftEditorInput({
		id: 'draft-attachment-second',
		title: 'Second Draft',
		document: createWritingEditorDocumentFromPlainText('gamma delta'),
	}, createCloseService());
	group.openEditor(first);
	group.openEditor(second, { active: false });
	const service = createDraftEditorService([group], group);
	const pane = createPane();

	try {
		pane.setInput(first, undefined, {}, CancellationTokenNone);
		const initialSelection = pane.getStableSelectionTarget();
		assert(initialSelection);
		pane.restoreViewState({
			scrollPosition: { scrollLeft: 0, scrollTop: 0 },
			selectionTarget: {
				...initialSelection,
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 1,
					endColumn: 6,
				},
				startOffset: 0,
				endOffset: 5,
				selectedText: 'alpha',
				isCollapsed: false,
			},
			shouldFocus: false,
		});

		const attachment = service.getActiveRequestAttachment();
		assert(attachment);
		assert.deepEqual(attachment, {
			kind: ChatRequestAttachmentKind.Editor,
			id: `editor:${first.resource.toString()}`,
			name: 'First Draft',
			resource: first.resource,
			document: first.document,
			selection: {
				blockId: initialSelection.blockId,
				startOffset: 0,
				endOffset: 5,
			},
		});
		assert.deepEqual(Object.keys(attachment.selection!), [
			'blockId',
			'startOffset',
			'endOffset',
		]);

		pane.clearInput();
		assert.equal(service.getActiveRequestAttachment(), undefined);

		group.setActive(second);
		pane.setInput(second, undefined, {}, CancellationTokenNone);
		assert.equal(service.getActiveRequestAttachment()?.resource, second.resource);
		group.setActive(first);
		assert.equal(service.getActiveRequestAttachment(), undefined);
	} finally {
		pane.dispose();
		group.dispose();
		first.dispose();
		second.dispose();
	}
});
