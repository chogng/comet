/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { decodeBase64 } from 'cs/base/common/buffer';
import { CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import { StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import type { IAgentHostAttachment, IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentChatId,
	createAgentHostPayloadDigest,
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
	createAgentModelId,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentHostChatState } from 'cs/platform/agentHost/common/protocol';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import {
	ChatPersistenceSchemaVersion,
	ChatPersistenceStorageKey,
	parseChatPersistedState,
	serializeChatPersistedState,
} from 'cs/workbench/contrib/chat/common/chatService/chatPersistence';
import {
	ChatHostPresentationSchemaVersion,
	createChatPresentationTypeId,
} from 'cs/workbench/contrib/chat/common/chatService/chatTurnPresentations';
import type {
	IChatAttachmentProducer,
	IPendingChatAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatComposer';
import {
	ChatImageAttachmentRepresentationSchema,
	ChatSelectionAttachmentRepresentationSchema,
	ChatTextAttachmentRepresentationSchema,
	createChatImageAttachment,
	createChatSelectionAttachment,
	createChatTextAttachment,
} from 'cs/workbench/contrib/chat/common/chatService/chatOwnedAttachments';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import type { IStorageService } from 'cs/platform/storage/common/storage';

const firstChatResource = URI.from({ scheme: 'chat', path: '/first' });
const secondChatResource = URI.from({ scheme: 'chat', path: '/second' });
const testAttachmentProducerType = createAgentAttachmentProducerTypeId('test.text');
const testAttachmentRepresentation = createAgentAttachmentRepresentationSchemaId('test.text.v1');
const testHostSessionId = createAgentSessionId('session-1');
const testHostChatId = createAgentChatId('chat-1');
const testPresentationType = createChatPresentationTypeId('test.presentation.v1');

function createFixture(storageService: IStorageService = createTestChatStorageService()) {
	return {
		service: new ChatService(storageService),
	};
}

function createPendingAttachment(id: string, text = id): IPendingChatAttachment {
	return {
		id: createAgentAttachmentId(id),
		producerType: testAttachmentProducerType,
		producerStateVersion: 1,
		display: { label: text },
		state: { text },
	};
}

function createNormalizedAttachment(attachment: IPendingChatAttachment): IAgentHostAttachment {
	return {
		envelopeVersion: 1,
		id: attachment.id,
		producerType: attachment.producerType,
		display: attachment.display,
		representation: {
			schema: testAttachmentRepresentation,
			mediaType: 'text/plain',
			value: attachment.state,
		},
		metadata: [],
	};
}

function createInteractionTarget(id: string): IAgentHostInteractionTarget {
	return {
		id: createAgentInteractionTargetId(id),
		owner: createAgentInteractionTargetOwnerId('test.browser'),
		type: createAgentInteractionTargetTypeId('test.browser.document'),
		schemaVersion: 1,
		resource: `https://example.test/${id}`,
		resourceVersion: 'document-1',
		revision: createAgentInteractionTargetRevision('revision-1'),
		authority: { kind: 'host' },
		availability: 'turn',
		display: { label: id },
	};
}

function isProtocolRecord(
	value: AgentHostProtocolValue,
): value is { readonly [name: string]: AgentHostProtocolValue } {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function createAttachmentProducer(
	resolve: IChatAttachmentProducer['resolve'],
	discard: IChatAttachmentProducer['discard'] = () => {},
): IChatAttachmentProducer {
	return {
		type: testAttachmentProducerType,
		stateVersion: 1,
		validateState: state => {
			if (!isProtocolRecord(state) || typeof state.text !== 'string') {
				throw new TypeError('A test text attachment requires text.');
			}
		},
		discard,
		resolve,
	};
}

function createHostChatState(title: string): IAgentHostChatState {
	return {
		id: testHostChatId,
		createdAt: 1,
		title,
		origin: { kind: 'user' },
		model: createAgentModelId('model-1'),
		lifecycle: 'available',
		interactivity: 'full',
		status: 'completed',
		isRead: true,
		capabilities: {
			supportsRename: true,
			supportsSetModel: true,
			supportsFork: true,
			supportsRelease: true,
			supportsDelete: true,
			supportsSubmit: true,
			supportsCancel: true,
		},
		modifiedAt: 2,
		session: testHostSessionId,
		turns: [{
			id: createAgentTurnId('turn-1'),
			submission: createAgentSubmissionId('submission-1'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'0'.repeat(64)}`),
			state: 'completed',
			user: {
				text: 'Question',
				attachments: [],
				interactionTargets: [],
			},
			response: [{ kind: 'text', text: 'Answer' }],
		}],
	};
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
		() => service.setInput(firstChatResource, ''),
		/Chat model does not exist/,
	);
	assert.throws(
		() => acquiredReference.object.getSnapshot(),
		/Chat model has been disposed/,
	);

	const replacementOwner = service.createModel(firstChatResource);
	replacementOwner.dispose();
});

test('ChatService owner applies authoritative Host state only to its exact immutable binding', t => {
	const { service } = createFixture();
	const ownerReference = service.createModel(firstChatResource);
	t.after(() => ownerReference.dispose());
	const acquiredReference = service.acquireModel(firstChatResource);
	t.after(() => acquiredReference.dispose());
	const identity = { session: testHostSessionId, chat: testHostChatId };
	const initialState = createHostChatState('Initial Host title');

	ownerReference.replaceHostState(identity, initialState);
	const captured = acquiredReference.object.getSnapshot().hostState;
	assert.deepEqual(captured, initialState);
	assert.notEqual(captured, initialState);
	assert.equal(Object.isFrozen(captured), true);
	assert.equal(Object.isFrozen(captured?.turns), true);

	const nextState = createHostChatState('Updated Host title');
	ownerReference.replaceHostState(identity, nextState);
	assert.equal(acquiredReference.object.getSnapshot().hostState?.title, 'Updated Host title');
	assert.throws(
		() => ownerReference.replaceHostState(
			{ session: testHostSessionId, chat: createAgentChatId('chat-2') },
			{ ...nextState, id: createAgentChatId('chat-2') },
		),
		/already bound/,
	);
	assert.throws(
		() => ownerReference.replaceHostState(identity, {
			...nextState,
			session: createAgentSessionId('session-2'),
		}),
		/does not match model binding/,
	);
	assert.equal(acquiredReference.object.getSnapshot().hostState?.title, 'Updated Host title');
});

test('ChatService resolves an imported presentation by exact canonical response-part identity', t => {
	const storage = createTestChatStorageService();
	storage.store(
		ChatPersistenceStorageKey,
		serializeChatPersistedState({
			schemaVersion: ChatPersistenceSchemaVersion,
			revision: 0,
			chats: [{
				resource: firstChatResource.toString(true),
				composer: {
					input: '',
					revision: 0,
					attachments: [],
					interactionTargets: [],
				},
				presentations: [{
					schemaVersion: ChatHostPresentationSchemaVersion,
					session: testHostSessionId,
					chat: testHostChatId,
					turn: createAgentTurnId('turn-1'),
					responsePartIndex: 0,
					type: testPresentationType,
					value: { label: 'exact' },
				}],
			}],
			completedMigrations: [],
		}),
		StorageScope.APPLICATION,
		StorageTarget.MACHINE,
	);
	const { service } = createFixture(storage);
	const owner = service.createModel(firstChatResource);
	t.after(() => owner.dispose());
	owner.replaceHostState(
		{ session: testHostSessionId, chat: testHostChatId },
		createHostChatState('Exact presentation'),
	);

	const presentation = owner.object.getHostPresentation({
		session: testHostSessionId,
		chat: testHostChatId,
		turn: createAgentTurnId('turn-1'),
		responsePartIndex: 0,
	});
	assert.deepEqual(presentation?.value, { label: 'exact' });
	assert.equal(owner.object.getHostPresentation({
		session: testHostSessionId,
		chat: testHostChatId,
		turn: createAgentTurnId('turn-1'),
		responsePartIndex: 1,
	}), undefined);
	assert.equal(owner.object.getHostPresentation({
		session: createAgentSessionId('session-other'),
		chat: testHostChatId,
		turn: createAgentTurnId('turn-1'),
		responsePartIndex: 0,
	}), undefined);
	assert.throws(() => owner.object.getHostPresentation({
		session: testHostSessionId,
		chat: testHostChatId,
		turn: createAgentTurnId('turn-1'),
		responsePartIndex: -1,
	}), /non-negative safe integer/);
});

test('ChatService isolates composer input by resource', t => {
	const { service } = createFixture();
	const firstReference = service.createModel(firstChatResource);
	t.after(() => firstReference.dispose());
	const secondReference = service.createModel(secondChatResource);
	t.after(() => secondReference.dispose());

	service.setInput(firstChatResource, 'first input');

	assert.deepEqual(firstReference.object.getSnapshot(), {
		hostState: undefined,
		hostPresentations: [],
		input: 'first input',
		composerRevision: 1,
		pendingAttachments: [],
		interactionTargets: [],
		preparingSubmission: undefined,
		errorMessage: undefined,
	});
	assert.deepEqual(secondReference.object.getSnapshot(), {
		hostState: undefined,
		hostPresentations: [],
		input: '',
		composerRevision: 0,
		pendingAttachments: [],
		interactionTargets: [],
		preparingSubmission: undefined,
		errorMessage: undefined,
	});

	const immutableSnapshot = secondReference.object.getSnapshot();
	assert.equal(Object.isFrozen(immutableSnapshot), true);
	assert.equal(Object.isFrozen(immutableSnapshot.hostPresentations), true);
});

test('ChatService validates composer attachment and interaction-target batches atomically by resource', t => {
	const { service } = createFixture();
	const firstReference = service.createModel(firstChatResource);
	const secondReference = service.createModel(secondChatResource);
	t.after(() => firstReference.dispose());
	t.after(() => secondReference.dispose());
	const producerRegistration = service.registerAttachmentProducer(createAttachmentProducer(async ({ attachment }) => ({
		attachment: createNormalizedAttachment(attachment),
		release: async () => {},
	})));
	t.after(() => producerRegistration.dispose());

	const firstAttachment = createPendingAttachment('attachment-1');
	service.addPendingAttachments(firstChatResource, [firstAttachment]);
	assert.throws(
		() => service.addPendingAttachments(firstChatResource, [
			createPendingAttachment('attachment-2'),
			createPendingAttachment('attachment-2'),
		]),
		/duplicate attachment IDs/,
	);
	assert.deepEqual(firstReference.object.getSnapshot().pendingAttachments, [firstAttachment]);
	assert.deepEqual(secondReference.object.getSnapshot().pendingAttachments, []);

	const target = createInteractionTarget('target-1');
	service.addInteractionTargets(firstChatResource, [target]);
	assert.throws(
		() => service.addInteractionTargets(firstChatResource, [target]),
		/already bound/,
	);
	assert.deepEqual(firstReference.object.getSnapshot().interactionTargets, [target]);
	assert.deepEqual(secondReference.object.getSnapshot().interactionTargets, []);

	service.removePendingAttachment(firstChatResource, firstAttachment.id);
	service.removeInteractionTarget(firstChatResource, target.id);
	assert.deepEqual(firstReference.object.getSnapshot().pendingAttachments, []);
	assert.deepEqual(firstReference.object.getSnapshot().interactionTargets, []);
});

test('ChatService discards producer-owned composer resources only after permanent removal', async t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource, { input: 'Keep rejected content' });
	const discarded: string[] = [];
	const registration = service.registerAttachmentProducer(createAttachmentProducer(
		async ({ attachment }) => ({
			attachment: createNormalizedAttachment(attachment),
			release: async () => {},
		}),
		attachment => { discarded.push(attachment.id); },
	));
	t.after(() => registration.dispose());
	const removed = createPendingAttachment('attachment-removed');
	const cleared = createPendingAttachment('attachment-cleared');
	const submitted = createPendingAttachment('attachment-submitted');

	service.addPendingAttachments(firstChatResource, [removed, cleared]);
	service.removePendingAttachment(firstChatResource, removed.id);
	assert.deepEqual(discarded, [removed.id]);
	service.clearPendingAttachments(firstChatResource);
	assert.deepEqual(discarded, [removed.id, cleared.id]);

	service.addPendingAttachments(firstChatResource, [submitted]);
	const rejected = await service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('submission-preserved'),
		CancellationTokenNone,
	);
	await rejected.reject();
	assert.deepEqual(discarded, [removed.id, cleared.id]);
	assert.deepEqual(reference.object.getSnapshot().pendingAttachments, [submitted]);

	const accepted = await service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('submission-consumed'),
		CancellationTokenNone,
	);
	await accepted.accept();
	assert.deepEqual(discarded, [removed.id, cleared.id, submitted.id]);

	const disposed = createPendingAttachment('attachment-disposed');
	service.setInput(firstChatResource, 'Dispose this composer');
	service.addPendingAttachments(firstChatResource, [disposed]);
	reference.delete();
	assert.deepEqual(discarded, [removed.id, cleared.id, submitted.id, disposed.id]);
});

test('ChatService restores composer state after ordinary model disposal and clears it only on deletion', t => {
	const storage = createTestChatStorageService();
	const discarded: string[] = [];
	const producer = createAttachmentProducer(
		async ({ attachment }) => ({
			attachment: createNormalizedAttachment(attachment),
			release: async () => {},
		}),
		attachment => { discarded.push(attachment.id); },
	);
	const first = createFixture(storage);
	const firstRegistration = first.service.registerAttachmentProducer(producer);
	const firstOwner = first.service.createModel(firstChatResource);
	const attachment = createPendingAttachment('attachment-restored');
	const target = createInteractionTarget('target-restored');
	first.service.setInput(firstChatResource, 'Persist this composer');
	first.service.addPendingAttachments(firstChatResource, [attachment]);
	first.service.addInteractionTargets(firstChatResource, [target]);
	firstOwner.dispose();
	firstRegistration.dispose();
	assert.deepEqual(discarded, []);

	const second = createFixture(storage);
	const secondRegistration = second.service.registerAttachmentProducer(producer);
	const secondOwner = second.service.createModel(firstChatResource);
	assert.equal(secondOwner.object.getSnapshot().input, 'Persist this composer');
	assert.deepEqual(secondOwner.object.getSnapshot().pendingAttachments, [attachment]);
	assert.deepEqual(secondOwner.object.getSnapshot().interactionTargets, [target]);
	secondOwner.delete();
	secondRegistration.dispose();
	assert.deepEqual(discarded, [attachment.id]);

	const third = createFixture(storage);
	const thirdOwner = third.service.createModel(firstChatResource);
	t.after(() => thirdOwner.dispose());
	assert.equal(thirdOwner.object.getSnapshot().input, '');
	assert.deepEqual(thirdOwner.object.getSnapshot().pendingAttachments, []);
	assert.deepEqual(thirdOwner.object.getSnapshot().interactionTargets, []);
});

test('ChatService preserves the exact composer while an owner is disposed during preparation', async t => {
	const storage = createTestChatStorageService();
	const first = createFixture(storage);
	const resolutionStarted = new DeferredPromise<void>();
	const continueResolution = new DeferredPromise<void>();
	const discarded: string[] = [];
	const registration = first.service.registerAttachmentProducer(createAttachmentProducer(
		async ({ attachment }) => {
			resolutionStarted.complete();
			await continueResolution.p;
			return {
				attachment: createNormalizedAttachment(attachment),
				release: async () => {},
			};
		},
		attachment => { discarded.push(attachment.id); },
	));
	const owner = first.service.createModel(firstChatResource, { input: 'Prepare without loss' });
	const attachment = createPendingAttachment('attachment-preparing');
	first.service.addPendingAttachments(firstChatResource, [attachment]);
	const preparation = first.service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('submission-preparing-dispose'),
		CancellationTokenNone,
	);
	await resolutionStarted.p;
	assert.throws(() => owner.delete(), /cannot be deleted while preparing/);
	owner.dispose();
	continueResolution.complete();
	const prepared = await preparation;
	await prepared.reject();
	registration.dispose();
	assert.deepEqual(discarded, []);

	const second = createFixture(storage);
	const secondRegistration = second.service.registerAttachmentProducer(createAttachmentProducer(
		async ({ attachment: restored }) => ({
			attachment: createNormalizedAttachment(restored),
			release: async () => {},
		}),
	));
	const restored = second.service.createModel(firstChatResource);
	t.after(() => {
		restored.dispose();
		secondRegistration.dispose();
	});
	assert.equal(restored.object.getSnapshot().input, 'Prepare without loss');
	assert.deepEqual(restored.object.getSnapshot().pendingAttachments, [attachment]);
});

test('ChatService locks and consumes exactly the composer revision accepted by Host', async t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource, { input: 'Exact prompt' });
	t.after(() => reference.dispose());
	const resolutionStarted = new DeferredPromise<void>();
	const continueResolution = new DeferredPromise<void>();
	let releaseCount = 0;
	const registration = service.registerAttachmentProducer(createAttachmentProducer(async ({ attachment }) => {
		resolutionStarted.complete();
		await continueResolution.p;
		return {
			attachment: createNormalizedAttachment(attachment),
			release: async () => { releaseCount += 1; },
		};
	}));
	t.after(() => registration.dispose());
	const attachment = createPendingAttachment('attachment-prepare');
	const target = createInteractionTarget('target-prepare');
	service.addPendingAttachments(firstChatResource, [attachment]);
	service.addInteractionTargets(firstChatResource, [target]);
	const capturedRevision = reference.object.getSnapshot().composerRevision;

	const preparing = service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('submission-accept'),
		CancellationTokenNone,
	);
	await resolutionStarted.p;
	assert.deepEqual(reference.object.getSnapshot().preparingSubmission, {
		id: createAgentSubmissionId('submission-accept'),
		composerRevision: capturedRevision,
	});
	assert.throws(() => service.setInput(firstChatResource, 'changed'), /preparing submission/);
	assert.throws(() => service.clearPendingAttachments(firstChatResource), /preparing submission/);
	assert.throws(() => service.clearInteractionTargets(firstChatResource), /preparing submission/);
	continueResolution.complete();
	const prepared = await preparing;
	assert.equal(prepared.capture.prompt, 'Exact prompt');
	assert.equal(prepared.capture.composerRevision, capturedRevision);
	assert.deepEqual(prepared.attachments, [createNormalizedAttachment(attachment)]);
	assert.deepEqual(prepared.interactionTargets, [target]);

	await prepared.accept();
	const acceptedSnapshot = reference.object.getSnapshot();
	assert.equal(acceptedSnapshot.input, '');
	assert.deepEqual(acceptedSnapshot.pendingAttachments, []);
	assert.deepEqual(acceptedSnapshot.interactionTargets, []);
	assert.equal(acceptedSnapshot.preparingSubmission, undefined);
	assert.equal(acceptedSnapshot.composerRevision, capturedRevision + 1);
	assert.equal(releaseCount, 1);
	await assert.rejects(() => prepared.reject(), /no longer active/);
});

test('ChatService preserves the exact composer when Host rejects a prepared submission', async t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource, { input: 'Keep this prompt' });
	t.after(() => reference.dispose());
	let releaseCount = 0;
	const registration = service.registerAttachmentProducer(createAttachmentProducer(async ({ attachment }) => ({
		attachment: createNormalizedAttachment(attachment),
		release: async () => { releaseCount += 1; },
	})));
	t.after(() => registration.dispose());
	const attachment = createPendingAttachment('attachment-reject');
	const target = createInteractionTarget('target-reject');
	service.addPendingAttachments(firstChatResource, [attachment]);
	service.addInteractionTargets(firstChatResource, [target]);
	const before = reference.object.getSnapshot();

	const prepared = await service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('submission-reject'),
		CancellationTokenNone,
	);
	await prepared.reject();
	const after = reference.object.getSnapshot();
	assert.equal(after.input, before.input);
	assert.equal(after.composerRevision, before.composerRevision);
	assert.equal(after.pendingAttachments, before.pendingAttachments);
	assert.equal(after.interactionTargets, before.interactionTargets);
	assert.equal(after.preparingSubmission, undefined);
	assert.equal(releaseCount, 1);
});

test('ChatService releases every staged attachment and preserves composer state when preparation fails', async t => {
	const { service } = createFixture();
	const attachments = [
		createPendingAttachment('attachment-staged'),
		createPendingAttachment('attachment-fails'),
	];
	const reference = service.createModel(firstChatResource, {
		input: 'Preserved after failure',
		pendingAttachments: attachments,
	});
	t.after(() => reference.dispose());
	let releaseCount = 0;
	const registration = service.registerAttachmentProducer(createAttachmentProducer(async ({ attachment }) => {
		if (attachment.id === attachments[1]!.id) {
			throw new Error('resolver failed');
		}
		return {
			attachment: createNormalizedAttachment(attachment),
			release: async () => { releaseCount += 1; },
		};
	}));
	t.after(() => registration.dispose());
	const before = reference.object.getSnapshot();

	await assert.rejects(
		() => service.prepareSubmission(
			firstChatResource,
			createAgentSubmissionId('submission-fails'),
			CancellationTokenNone,
		),
		/resolver failed/,
	);
	const after = reference.object.getSnapshot();
	assert.equal(after.input, before.input);
	assert.equal(after.composerRevision, before.composerRevision);
	assert.equal(after.pendingAttachments, before.pendingAttachments);
	assert.equal(after.preparingSubmission, undefined);
	assert.equal(releaseCount, 1);
});

test('ChatService cancels preparation without creating state or leaking staged attachments', async t => {
	const { service } = createFixture();
	const reference = service.createModel(firstChatResource, { input: 'Cancelled prompt' });
	t.after(() => reference.dispose());
	const resolutionStarted = new DeferredPromise<void>();
	const continueResolution = new DeferredPromise<void>();
	let releaseCount = 0;
	const registration = service.registerAttachmentProducer(createAttachmentProducer(async ({ attachment }) => {
		resolutionStarted.complete();
		await continueResolution.p;
		return {
			attachment: createNormalizedAttachment(attachment),
			release: async () => { releaseCount += 1; },
		};
	}));
	t.after(() => registration.dispose());
	service.addPendingAttachments(firstChatResource, [createPendingAttachment('attachment-cancel')]);
	const cancellation = new CancellationTokenSource();
	t.after(() => cancellation.dispose());
	const preparing = service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('submission-cancel'),
		cancellation.token,
	);
	await resolutionStarted.p;
	cancellation.cancel();
	continueResolution.complete();

	await assert.rejects(preparing, error => error instanceof Error && error.name === 'Canceled');
	assert.equal(reference.object.getSnapshot().input, 'Cancelled prompt');
	assert.equal(reference.object.getSnapshot().pendingAttachments.length, 1);
	assert.equal(reference.object.getSnapshot().preparingSubmission, undefined);
	assert.equal(releaseCount, 1);
});

test('ChatService compare-and-set presentation updates persist only the exact expected value', t => {
	const storage = createTestChatStorageService();
	const { service } = createFixture(storage);
	const owner = service.createModel(firstChatResource);
	t.after(() => owner.dispose());
	const identity = {
		session: testHostSessionId,
		chat: testHostChatId,
		turn: createAgentTurnId('turn-1'),
		responsePartIndex: 0,
	};
	owner.replaceHostState(
		{ session: testHostSessionId, chat: testHostChatId },
		createHostChatState('Opaque presentation'),
	);
	owner.importHostPresentations(
		{ session: testHostSessionId, chat: testHostChatId },
		[{
			schemaVersion: ChatHostPresentationSchemaVersion,
			...identity,
			type: testPresentationType,
			value: { state: 'pending', version: 1 },
		}],
	);
	let changeCount = 0;
	const listener = owner.object.onDidChange(() => changeCount += 1);
	t.after(() => listener.dispose());

	service.updateHostPresentation(firstChatResource, {
		identity,
		type: testPresentationType,
		expectedValue: { state: 'pending', version: 1 },
		value: { state: 'applied', version: 2 },
	});

	assert.deepEqual(owner.object.getHostPresentation(identity)?.value, {
		state: 'applied',
		version: 2,
	});
	assert.equal(changeCount, 1);
	assert.throws(
		() => service.updateHostPresentation(firstChatResource, {
			identity,
			type: testPresentationType,
			expectedValue: { state: 'pending', version: 1 },
			value: { state: 'failed', version: 3 },
		}),
		/changed before its Feature update committed/,
	);
	assert.equal(changeCount, 1);
	const persisted = parseChatPersistedState(
		storage.get(ChatPersistenceStorageKey, StorageScope.APPLICATION),
	);
	assert.deepEqual(persisted?.chats[0]?.presentations[0]?.value, {
		state: 'applied',
		version: 2,
	});
});

test('ChatService emits permanent deletion without treating ordinary disposal as deletion', () => {
	const { service } = createFixture();
	const deleted: string[] = [];
	const listener = service.onDidDeleteModel(resource => deleted.push(resource.toString(true)));
	const ordinary = service.createModel(firstChatResource);
	ordinary.dispose();
	assert.deepEqual(deleted, []);

	const permanent = service.createModel(secondChatResource);
	permanent.delete();
	assert.deepEqual(deleted, [secondChatResource.toString(true)]);
	listener.dispose();
});

test('Chat-owned text and transcript-selection producers preserve exact capture across rejection and retry', async t => {
	const { service } = createFixture();
	const owner = service.createModel(firstChatResource, { input: 'Compare exact context' });
	t.after(() => owner.dispose());
	const mutableFragments = [{
		message: 'submission-source',
		role: 'user' as const,
		text: 'first exact fragment',
	}, {
		message: 'turn-source',
		role: 'assistant' as const,
		text: 'second exact fragment',
	}];
	const textAttachment = createChatTextAttachment('chat-text-1', 'Text', 'verbatim text\nwith spacing');
	const selectionAttachment = createChatSelectionAttachment(
		'chat-selection-1',
		'Chat Selection',
		firstChatResource,
		mutableFragments,
	);
	mutableFragments[0].text = 'mutated after capture';
	service.addPendingAttachments(firstChatResource, [textAttachment, selectionAttachment]);

	const first = await service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('chat-owned-rejected'),
		CancellationTokenNone,
	);
	assert.equal(first.attachments[0].representation.schema, ChatTextAttachmentRepresentationSchema);
	assert.equal(first.attachments[0].content?.kind, 'inline');
	assert.equal(first.attachments[0].content?.encoding, 'utf8');
	assert.equal(first.attachments[0].content?.data, 'verbatim text\nwith spacing');
	assert.equal(first.attachments[1].representation.schema, ChatSelectionAttachmentRepresentationSchema);
	assert.equal(first.attachments[1].content?.kind, 'inline');
	assert.deepEqual(JSON.parse(first.attachments[1].content?.data ?? ''), {
		fragments: [{
			message: 'submission-source',
			role: 'user',
			text: 'first exact fragment',
		}, {
			message: 'turn-source',
			role: 'assistant',
			text: 'second exact fragment',
		}],
		sourceChat: firstChatResource.toString(true),
	});
	const normalized = first.attachments;
	await first.reject();
	assert.equal(owner.object.getSnapshot().input, 'Compare exact context');
	assert.equal(owner.object.getSnapshot().pendingAttachments.length, 2);

	const retry = await service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('chat-owned-retry'),
		CancellationTokenNone,
	);
	assert.deepEqual(retry.attachments, normalized);
	await retry.accept();
	assert.equal(owner.object.getSnapshot().pendingAttachments.length, 0);
});

test('Chat-owned image producer derives dimensions and binds normalized content to exact immutable bytes', async t => {
	const { service } = createFixture();
	const owner = service.createModel(firstChatResource, { input: 'Inspect image' });
	t.after(() => owner.dispose());
	const png = decodeBase64(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK0YAAAAASUVORK5CYII=',
	);
	const expectedData = png.clone();
	const attachment = await createChatImageAttachment(
		'chat-image-1',
		'pixel.png',
		'image/png',
		png.buffer,
	);
	png.buffer.fill(0);
	service.addPendingAttachments(firstChatResource, [attachment]);

	const prepared = await service.prepareSubmission(
		firstChatResource,
		createAgentSubmissionId('chat-image-submission'),
		CancellationTokenNone,
	);
	const normalized = prepared.attachments[0];
	assert.equal(normalized.representation.schema, ChatImageAttachmentRepresentationSchema);
	assert.deepEqual(normalized.representation.value, {
		name: 'pixel.png',
		width: 1,
		height: 1,
		byteLength: expectedData.byteLength,
		digest: normalized.content?.digest,
	});
	assert.equal(normalized.content?.kind, 'inline');
	assert.equal(normalized.content?.mediaType, 'image/png');
	assert.equal(normalized.content?.encoding, 'base64');
	assert.deepEqual(decodeBase64(normalized.content?.data ?? '').buffer, expectedData.buffer);
	await prepared.accept();
});

test('Chat-owned codecs reject unknown state atomically and preserve a digest-mismatched image for correction', async t => {
	const { service } = createFixture();
	const owner = service.createModel(firstChatResource, { input: 'Validate attachments' });
	t.after(() => owner.dispose());
	const valid = createChatTextAttachment('chat-text-valid', 'Text', 'valid text');
	const invalid: IPendingChatAttachment = {
		...createChatTextAttachment('chat-text-invalid', 'Text', 'invalid text'),
		state: { text: 'invalid text', unsupported: true },
	};
	assert.throws(
		() => service.addPendingAttachments(firstChatResource, [valid, invalid]),
		/unsupported properties/,
	);
	assert.equal(owner.object.getSnapshot().pendingAttachments.length, 0);

	const png = decodeBase64(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZK0YAAAAASUVORK5CYII=',
	);
	const image = await createChatImageAttachment(
		'chat-image-tampered',
		'pixel.png',
		'image/png',
		png.buffer,
	);
	const tampered: IPendingChatAttachment = {
		...image,
		state: {
			...(image.state as Readonly<Record<string, AgentHostProtocolValue>>),
			digest: `sha256:${'0'.repeat(64)}`,
		},
	};
	service.addPendingAttachments(firstChatResource, [tampered]);
	const before = owner.object.getSnapshot();
	await assert.rejects(
		service.prepareSubmission(
			firstChatResource,
			createAgentSubmissionId('chat-image-tampered-submission'),
			CancellationTokenNone,
		),
		/digest does not match/,
	);
	const after = owner.object.getSnapshot();
	assert.equal(after.input, before.input);
	assert.equal(after.composerRevision, before.composerRevision);
	assert.equal(after.pendingAttachments, before.pendingAttachments);
	assert.equal(after.preparingSubmission, undefined);
});

test('Chat-owned producers validate restored composer state without external registration', async () => {
	const storage = createTestChatStorageService();
	const firstService = new ChatService(storage);
	const firstOwner = firstService.createModel(firstChatResource, { input: 'Restored prompt' });
	firstService.addPendingAttachments(firstChatResource, [
		createChatTextAttachment('chat-text-restored', 'Text', 'restored exact text'),
	]);
	firstOwner.dispose();

	const restoredService = new ChatService(storage);
	const restoredOwner = restoredService.createModel(firstChatResource);
	try {
		const prepared = await restoredService.prepareSubmission(
			firstChatResource,
			createAgentSubmissionId('chat-text-restored-submission'),
			CancellationTokenNone,
		);
		assert.equal(prepared.attachments[0].content?.kind, 'inline');
		assert.equal(prepared.attachments[0].content?.data, 'restored exact text');
		await prepared.accept();
	} finally {
		restoredOwner.dispose();
	}
});
