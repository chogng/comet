/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { VSBuffer } from 'cs/base/common/buffer';
import { getComparisonKey } from 'cs/base/common/resources';
import { URI } from 'cs/base/common/uri';
import {
	createWritingEditorDocumentFromPlainText,
	writingEditorDocumentToPlainText,
	type WritingEditorDocument,
} from 'cs/editor/common/writingEditorDocument';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import { createChatImageAttachment } from 'cs/workbench/contrib/chat/common/chatService/chatImageAttachment';
import type { IDraftEditorService } from 'cs/workbench/contrib/draftEditor/common/draftEditorService';

const firstChatResource = URI.from({ scheme: 'chat', path: '/first' });
const secondChatResource = URI.from({ scheme: 'chat', path: '/second' });
const targetDraftResource = URI.from({ scheme: 'draft', path: '/target' });
const unrelatedDraftResource = URI.from({ scheme: 'draft', path: '/unrelated' });

class TestDraftEditorService implements IDraftEditorService {
	declare readonly _serviceBrand: undefined;
	readonly activeInput = undefined;
	private readonly documents = new Map<string, WritingEditorDocument>();
	readonly writtenResources: URI[] = [];

	canSaveActive(): boolean {
		return false;
	}

	saveActive(): boolean {
		return false;
	}

	getDocument(resource: URI): WritingEditorDocument | null {
		return this.documents.get(getComparisonKey(resource)) ?? null;
	}

	setDocument(resource: URI, value: WritingEditorDocument): void {
		this.documents.set(getComparisonKey(resource), value);
		this.writtenResources.push(resource);
	}

	getActiveRequestAttachment(): undefined {
		return undefined;
	}

	addDocument(resource: URI, value: WritingEditorDocument): void {
		this.documents.set(getComparisonKey(resource), value);
	}
}

function createFixture() {
	const draftEditorService = new TestDraftEditorService();
	return {
		service: new ChatService(new NoOpNotificationService(), draftEditorService),
		draftEditorService,
	};
}

function completeWithPatch(
	service: ChatService,
	chatResource: URI,
	requestId: string,
	targetResource: URI,
	targetDocument: WritingEditorDocument,
	replacement: string,
): string {
	const blockId = targetDocument.content?.[0]?.attrs?.blockId;
	assert.ok(typeof blockId === 'string');
	const request = service.startRequest(chatResource, requestId, 'Update the draft', []);
	request.prepareCompletion({
		content: 'I prepared a patch.',
		result: null,
		patchProposal: {
			proposal: {
				patch: {
					label: 'Update paragraph',
					operations: [{
						kind: 'text-edit',
						edit: {
							blockId,
							kind: 'replaceBlock',
							text: replacement,
						},
					}],
				},
				accepted: true,
				operationsValidated: 1,
				failedOperationIndex: null,
				requiresCustomExecutor: false,
				validationError: null,
			},
			target: {
				resource: targetResource,
				document: targetDocument,
			},
		},
	}).commit();

	const reference = service.acquireModel(chatResource);
	try {
		const assistantMessage = reference.object.getSnapshot().messages.at(-1);
		assert.ok(assistantMessage?.role === 'assistant');
		return assistantMessage.id;
	} finally {
		reference.dispose();
	}
}

test('ChatService keeps a model live until its final reference is disposed', t => {
	const { service } = createFixture();
	const ownerReference = service.createModel(firstChatResource, { input: 'initial' });
	t.after(() => ownerReference.dispose());

	assert.throws(
		() => service.createModel(firstChatResource),
		/Chat model already exists/,
	);

	const acquiredReference = service.acquireModel(firstChatResource);
	t.after(() => acquiredReference.dispose());
	assert.equal(acquiredReference.object, ownerReference.object);

	ownerReference.dispose();
	assert.equal(acquiredReference.object.getSnapshot().input, 'initial');

	acquiredReference.dispose();
	assert.throws(
		() => service.acquireModel(firstChatResource),
		/Chat model does not exist/,
	);
	assert.throws(
		() => service.insertContextMessage(firstChatResource, '', []),
		/Chat model does not exist/,
	);
	assert.throws(
		() => acquiredReference.object.getSnapshot(),
		/Chat model has been disposed/,
	);

	const replacementOwner = service.createModel(firstChatResource);
	replacementOwner.dispose();
});

test('ChatService isolates input, messages, and article checks by resource', t => {
	const { service } = createFixture();
	const firstReference = service.createModel(firstChatResource);
	t.after(() => firstReference.dispose());
	const secondReference = service.createModel(secondChatResource);
	t.after(() => secondReference.dispose());

	service.setInput(firstChatResource, 'first input');
	service.insertContextMessage(firstChatResource, 'first context', []);
	service.setArticleChecked(firstChatResource, 'article-1', true);
	service.setArticleChecked(secondChatResource, 'article-2', true);

	assert.deepEqual(firstReference.object.getSnapshot(), {
		input: 'first input',
		messages: [{
			id: firstReference.object.getSnapshot().messages[0]!.id,
			role: 'user',
			content: 'first context',
			imageAttachments: [],
		}],
		activeRequest: undefined,
		errorMessage: undefined,
		checkedArticleIds: ['article-1'],
	});
	assert.deepEqual(secondReference.object.getSnapshot(), {
		input: '',
		messages: [],
		activeRequest: undefined,
		errorMessage: undefined,
		checkedArticleIds: ['article-2'],
	});

	service.removeArticleChecks(firstChatResource, ['article-1', 'article-2']);
	assert.deepEqual(firstReference.object.getSnapshot().checkedArticleIds, []);
	assert.deepEqual(secondReference.object.getSnapshot().checkedArticleIds, ['article-2']);

	const immutableSnapshot = secondReference.object.getSnapshot();
	assert.equal(Object.isFrozen(immutableSnapshot), true);
	assert.equal(Object.isFrozen(immutableSnapshot.checkedArticleIds), true);
	assert.throws(
		() => (immutableSnapshot.checkedArticleIds as string[]).push('article-3'),
		TypeError,
	);
	assert.deepEqual(secondReference.object.getSnapshot().checkedArticleIds, ['article-2']);
});

test('ChatService preserves validated image bytes on context and request messages', t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource);
	t.after(() => reference.dispose());
	const image = createChatImageAttachment(
		'image-1',
		'Browser.jpeg',
		'image/jpeg',
		VSBuffer.fromString('image-bytes'),
	);

	service.insertContextMessage(firstChatResource, 'Browser context', [image]);
	const request = service.startRequest(
		firstChatResource,
		'image-request',
		'Inspect the image',
		[image],
	);
	const snapshot = reference.object.getSnapshot();
	assert.deepEqual(snapshot.messages.map(message => message.imageAttachments), [[image], [image]]);
	assert.equal(Object.isFrozen(snapshot.messages[0]?.imageAttachments), true);
	assert.equal(Object.isFrozen(snapshot.messages[0]?.imageAttachments[0]), true);
	request.rollback();

	assert.throws(
		() => service.insertContextMessage(firstChatResource, 'Invalid image', [{
			...image,
			data: 'not base64',
		}]),
		/invalid base64 data/i,
	);
});

test('ChatService preserves Article check order without duplicate notifications', t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource);
	t.after(() => reference.dispose());
	let changeCount = 0;
	const subscription = reference.object.onDidChange(() => changeCount += 1);
	t.after(() => subscription.dispose());

	service.setArticleChecked(firstChatResource, 'article-1', true);
	service.setArticleChecked(firstChatResource, 'article-2', true);
	service.setArticleChecked(firstChatResource, 'article-1', true);
	service.setArticleChecked(firstChatResource, 'article-3', false);
	service.setArticleChecked(firstChatResource, 'article-1', false);
	service.setArticleChecked(firstChatResource, 'article-1', false);

	assert.deepEqual({
		checkedArticleIds: reference.object.getSnapshot().checkedArticleIds,
		changeCount,
	}, {
		checkedArticleIds: ['article-2'],
		changeCount: 3,
	});
});

test('ChatService commits only the exact active request id', t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource, { input: 'before submit' });
	t.after(() => reference.dispose());

	const firstRequest = service.startRequest(firstChatResource, 'request-1', '  First prompt  ', []);
	let snapshot = reference.object.getSnapshot();
	assert.deepEqual(snapshot.activeRequest, { id: 'request-1', prompt: 'First prompt' });
	assert.equal(snapshot.input, '');
	assert.equal(snapshot.messages.at(-1)?.content, 'First prompt');

	assert.throws(
		() => service.startRequest(firstChatResource, 'request-2', 'Second prompt', []),
		/already active/,
	);
	assert.throws(
		() => firstRequest.prepareCompletion({
			content: '   ',
			result: null,
			patchProposal: null,
		}),
		/completion content must not be empty/,
	);
	assert.deepEqual(reference.object.getSnapshot().activeRequest, {
		id: 'request-1',
		prompt: 'First prompt',
	});

	firstRequest.prepareCompletion({
		content: '  Completed  ',
		result: null,
		patchProposal: null,
	}).commit();
	snapshot = reference.object.getSnapshot();
	assert.equal(snapshot.activeRequest, undefined);
	assert.equal(snapshot.messages.at(-1)?.content, 'Completed');

	const retryRequest = service.startRequest(firstChatResource, 'request-3', 'Retry prompt', []);
	retryRequest.prepareFailure('  backend failed  ').commit();
	snapshot = reference.object.getSnapshot();
	assert.equal(snapshot.activeRequest, undefined);
	assert.equal(snapshot.input, 'Retry prompt');
	assert.equal(snapshot.errorMessage, 'backend failed');
});

test('ChatService publishes a prepared terminal request state only when committed', t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource);
	t.after(() => reference.dispose());
	const request = service.startRequest(firstChatResource, 'request-prepared', 'Prepared prompt', []);
	let changeCount = 0;
	const listener = reference.object.onDidChange(() => changeCount += 1);
	t.after(() => listener.dispose());

	const prepared = request.prepareCompletion({
		content: 'Prepared response',
		result: null,
		patchProposal: null,
	});
	assert.equal(reference.object.getSnapshot().activeRequest?.id, 'request-prepared');
	assert.equal(prepared.snapshot.activeRequest, undefined);
	assert.equal(prepared.snapshot.messages.at(-1)?.content, 'Prepared response');
	assert.equal(changeCount, 0);

	prepared.commit();
	assert.equal(reference.object.getSnapshot(), prepared.snapshot);
	assert.equal(changeCount, 1);
	assert.throws(() => prepared.commit(), /already committed/);
});

test('ChatService rolls an uncommitted request transaction back to its exact initial snapshot', t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource, {
		input: 'Unsent input',
		errorMessage: 'Previous failure',
		checkedArticleIds: ['article-before'],
	});
	t.after(() => reference.dispose());
	const initialSnapshot = reference.object.getSnapshot();
	const request = service.startRequest(firstChatResource, 'request-rollback', 'Transient prompt', []);
	service.setArticleChecked(firstChatResource, 'article-during', true);
	request.prepareCompletion({
		content: 'Uncommitted response',
		result: null,
		patchProposal: null,
	});

	request.rollback();

	assert.equal(reference.object.getSnapshot(), initialSnapshot);
	assert.throws(() => request.rollback(), /no longer active/);
	const retry = service.startRequest(firstChatResource, 'request-retry', 'Retry prompt', []);
	retry.prepareFailure('Retry failed').commit();
	assert.equal(reference.object.getSnapshot().activeRequest, undefined);
});

test('ChatService applies a patch only to its addressed unchanged target snapshot', t => {
	const { service, draftEditorService } = createFixture();
	const ownerReference = service.createModel(firstChatResource);
	t.after(() => ownerReference.dispose());

	const targetDocument = createWritingEditorDocumentFromPlainText('Original target');
	const unrelatedDocument = createWritingEditorDocumentFromPlainText('Unrelated active draft');
	draftEditorService.addDocument(targetDraftResource, targetDocument);
	draftEditorService.addDocument(unrelatedDraftResource, unrelatedDocument);

	const messageId = completeWithPatch(
		service,
		firstChatResource,
		'request-1',
		targetDraftResource,
		targetDocument,
		'Updated target',
	);
	service.applyPatch(firstChatResource, messageId);

	assert.deepEqual(
		draftEditorService.writtenResources.map(resource => resource.toString()),
		[targetDraftResource.toString()],
	);
	assert.equal(
		writingEditorDocumentToPlainText(draftEditorService.getDocument(targetDraftResource)!),
		'Updated target',
	);
	assert.equal(
		writingEditorDocumentToPlainText(draftEditorService.getDocument(unrelatedDraftResource)!),
		'Unrelated active draft',
	);
	const appliedMessage = ownerReference.object.getSnapshot().messages.at(-1);
	assert.equal(appliedMessage?.role === 'assistant' && appliedMessage.patchProposal?.isApplied, true);
});

test('ChatService rejects a patch when its addressed draft changed after proposal creation', t => {
	const { service, draftEditorService } = createFixture();
	const ownerReference = service.createModel(firstChatResource);
	t.after(() => ownerReference.dispose());

	const targetSnapshot = createWritingEditorDocumentFromPlainText('Original target');
	draftEditorService.addDocument(targetDraftResource, targetSnapshot);
	const messageId = completeWithPatch(
		service,
		firstChatResource,
		'request-1',
		targetDraftResource,
		targetSnapshot,
		'Overwritten target',
	);
	const changedDocument = createWritingEditorDocumentFromPlainText('Changed outside Chat');
	targetSnapshot.content = changedDocument.content;

	service.applyPatch(firstChatResource, messageId);

	assert.deepEqual(draftEditorService.writtenResources, []);
	assert.equal(
		writingEditorDocumentToPlainText(draftEditorService.getDocument(targetDraftResource)!),
		'Changed outside Chat',
	);
	const rejectedMessage = ownerReference.object.getSnapshot().messages.at(-1);
	assert.equal(rejectedMessage?.role, 'assistant');
	assert.match(
		rejectedMessage?.role === 'assistant'
			? rejectedMessage.patchProposal?.applyError ?? ''
			: '',
		/draft changed/i,
	);
});
