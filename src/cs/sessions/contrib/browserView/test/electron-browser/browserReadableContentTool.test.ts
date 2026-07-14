/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentChatId,
	createAgentHostClientConnectionId,
	createAgentId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentToolCall, IAgentToolRegistration } from 'cs/platform/agentHost/common/tools';
import {
	createBrowserPageAttachment,
	createBrowserPageAttachmentProducer,
} from 'cs/sessions/contrib/browserView/electron-browser/browserChatAttachments';
import {
	BrowserReadableContentToolEndpoint,
	createBrowserReadableContentToolRegistration,
} from 'cs/sessions/contrib/browserView/electron-browser/browserReadableContentTool';
import { createBrowserDocumentTarget } from 'cs/workbench/contrib/browserView/common/browserAgentTools';
import type {
	IBrowserViewModel,
	IBrowserViewWorkbenchService,
} from 'cs/workbench/contrib/browserView/common/browserView';
import type { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';

const connection = createAgentHostClientConnectionId('browser-test-connection');

async function sha256(value: string): Promise<string> {
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
	return `sha256:${Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}

function createHarness(text = '0123456789') {
	const reads: string[] = [];
	let documentEpoch = 'document-1';
	const model = {
		id: 'browser-view-1',
		title: 'Exact Browser Page',
		captureDocumentIdentity: async () => ({
			documentEpoch,
			url: 'https://example.com/exact',
		}),
		readReadableContent: async (expectedEpoch: string) => {
			reads.push(expectedEpoch);
			if (expectedEpoch !== documentEpoch) {
				throw new Error(`Document epoch '${expectedEpoch}' is stale.`);
			}
			return {
				documentEpoch,
				url: 'https://example.com/exact',
				title: 'Exact Browser Page',
				text,
				byteLength: new TextEncoder().encode(text).byteLength,
				digest: await sha256(text),
				truncated: false,
			};
		},
	} as IBrowserViewModel;
	const input = { model } as BrowserEditorInput;
	const browserViews = new Map([[model.id, input]]);
	const service = {
		getKnownBrowserViews: () => browserViews,
	} as IBrowserViewWorkbenchService;
	return {
		model,
		reads,
		service,
		setDocumentEpoch(value: string) {
			documentEpoch = value;
		},
	};
}

function createCall(
	registration: IAgentToolRegistration,
	target: IAgentHostInteractionTarget,
	id: string,
	input: AgentHostProtocolValue,
): IAgentToolCall {
	return Object.freeze({
		id: createAgentToolCallId(id),
		agent: createAgentId('comet'),
		registration: createAgentRuntimeRegistrationRevision('comet.embedded.v2'),
		session: createAgentSessionId('session-1'),
		chat: createAgentChatId('chat-1'),
		turn: createAgentTurnId('turn-1'),
		toolSet: createAgentToolSetRevision('tool-set-1'),
		tool: registration.descriptor.id,
		descriptor: registration.descriptor.revision,
		registrationId: registration.id,
		registrationRevision: registration.revision,
		input,
		target: target.id,
		effect: Object.freeze({ kind: 'read' }),
		deadline: Date.now() + 30_000,
	});
}

function completedOutput(result: Awaited<ReturnType<BrowserReadableContentToolEndpoint['execute']>>) {
	assert.equal(result.status, 'completed');
	if (result.status !== 'completed') {
		throw new Error('Expected a completed Browser readable-content result.');
	}
	return result.output as Readonly<Record<string, AgentHostProtocolValue>>;
}

test('Browser document target is deterministic for one exact view and document epoch', async () => {
	const harness = createHarness();
	const first = await createBrowserDocumentTarget(harness.model, connection, 'Browser Page');
	const repeated = await createBrowserDocumentTarget(harness.model, connection, 'Browser Page');
	assert.deepEqual(repeated, first);

	harness.setDocumentEpoch('document-2');
	const navigated = await createBrowserDocumentTarget(harness.model, connection, 'Browser Page');
	assert.notEqual(navigated.id, first.id);
	assert.equal(navigated.resource, first.resource);
	assert.equal(navigated.resourceVersion, 'document-2');
	assert.equal(navigated.revision, 'document-2');
});

test('Browser readable-content Tool pages one exact digest and rejects a changed continuation', async () => {
	const harness = createHarness();
	const target = await createBrowserDocumentTarget(harness.model, connection, 'Browser Page');
	const registration = createBrowserReadableContentToolRegistration(connection);
	const endpoint = new BrowserReadableContentToolEndpoint(connection, harness.service);
	const firstCall = createCall(registration, target, 'browser-call-1', {
		cursor: 0,
		maximumCharacters: 4,
		expectedDigest: null,
	});
	const first = completedOutput(await endpoint.execute(firstCall, target, () => {}, CancellationTokenNone));
	assert.deepEqual({
		text: first.text,
		cursor: first.cursor,
		nextCursor: first.nextCursor,
		totalCharacters: first.totalCharacters,
		complete: first.complete,
	}, {
		text: '0123',
		cursor: 0,
		nextCursor: 4,
		totalCharacters: 10,
		complete: false,
	});

	const secondCall = createCall(registration, target, 'browser-call-2', {
		cursor: 4,
		maximumCharacters: 4,
		expectedDigest: first.digest,
	});
	const second = completedOutput(await endpoint.execute(secondCall, target, () => {}, CancellationTokenNone));
	assert.equal(second.text, '4567');
	assert.equal(second.nextCursor, 8);
	assert.deepEqual(await endpoint.reconcile(secondCall), {
		kind: 'terminal',
		result: {
			call: secondCall.id,
			status: 'completed',
			output: second,
		},
	});

	const wrongDigestCall = createCall(registration, target, 'browser-call-3', {
		cursor: 4,
		maximumCharacters: 4,
		expectedDigest: `sha256:${'0'.repeat(64)}`,
	});
	const wrongDigest = await endpoint.execute(wrongDigestCall, target, () => {}, CancellationTokenNone);
	assert.equal(wrongDigest.status, 'failed');
	if (wrongDigest.status === 'failed') {
		assert.equal(wrongDigest.failure.code, 'invalidInput');
	}
	assert.deepEqual(harness.reads, ['document-1', 'document-1', 'document-1']);
});

test('Browser page attachment and lazy Tool both fail the exact stale epoch without active-page substitution', async () => {
	const harness = createHarness('immutable page text');
	const target = await createBrowserDocumentTarget(harness.model, connection, 'Browser Page');
	const attachment = createBrowserPageAttachment('browser-page-1', 'Browser Page', {
		browserViewId: harness.model.id,
		documentEpoch: target.resourceVersion,
		url: 'https://example.com/exact',
		title: 'Exact Browser Page',
	});
	const producer = createBrowserPageAttachmentProducer(harness.service);
	harness.setDocumentEpoch('document-2');

	await assert.rejects(producer.resolve({
		chatResource: URI.parse('chat://browser-test'),
		submissionId: createAgentSubmissionId('submission-1'),
		attachment,
		token: CancellationTokenNone,
	}), /document-1.*stale/);

	const registration = createBrowserReadableContentToolRegistration(connection);
	const endpoint = new BrowserReadableContentToolEndpoint(connection, harness.service);
	const result = await endpoint.execute(createCall(registration, target, 'browser-call-stale', {
		cursor: 0,
		maximumCharacters: 64,
		expectedDigest: null,
	}), target, () => {}, CancellationTokenNone);
	assert.equal(result.status, 'failed');
	if (result.status === 'failed') {
		assert.equal(result.failure.code, 'unavailable');
	}
	assert.deepEqual(harness.reads, ['document-1', 'document-1']);
});
