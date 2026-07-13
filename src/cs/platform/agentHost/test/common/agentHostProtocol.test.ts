/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { AgentHostChannelStateReducer, IAgentHostChannelAction } from 'cs/platform/agentHost/common/channelState';
import { selectAgentRuntimeProtocolVersion } from 'cs/platform/agentHost/common/connections';
import type { IAgentHostConnection, IAgentRuntimeConnection } from 'cs/platform/agentHost/common/connections';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	AgentHostOperationId,
	createAgentChatId,
	createAgentHostActionDigest,
	createAgentHostAuthorityId,
	createAgentHostChannelId,
	createAgentHostChannelRevision,
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
	createAgentRuntimeProtocolVersion,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { AgentHostOperationOutcomeRegistry } from 'cs/platform/agentHost/common/operations';
import {
	AgentHostReconnectResult,
	IAgentHostRootState,
	assertAgentHostChatState,
	assertAgentHostReconnectResult,
	assertAgentHostSetSubscriptionsResult,
	getAgentHostRootChannelId,
	selectAgentHostProtocolVersion,
} from 'cs/platform/agentHost/common/protocol';
import { computeAgentHostPayloadDigest } from 'cs/platform/agentHost/common/protocolValues';

interface ICounterState {
	readonly value: number;
}

interface ICounterAction {
	readonly add: number;
}

type ConnectionsRemainSeparate = IAgentHostConnection extends IAgentRuntimeConnection
	? false
	: IAgentRuntimeConnection extends IAgentHostConnection
		? false
		: true;

const connectionsRemainSeparate: ConnectionsRemainSeparate = true;
const operation = createAgentHostOperationId('operation-1');
const payloadDigest = createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`);

function actionDigest(character: string) {
	return createAgentHostActionDigest(`sha256:${character.repeat(64)}`);
}

function createCounterAction(
	channel: ReturnType<typeof createAgentHostChannelId>,
	hostSequence: number,
	revision: number,
	digestCharacter: string,
	add: number,
): IAgentHostChannelAction<'counter', ICounterAction> {
	return {
		channel,
		kind: 'counter',
		hostSequence: createAgentHostSequence(hostSequence),
		revision: createAgentHostChannelRevision(revision),
		digest: actionDigest(digestCharacter),
		cause: { kind: 'operation', operation, payloadDigest },
		action: { add },
	};
}

function assertErrorCode(error: unknown, code: string): boolean {
	assert.ok(error instanceof AgentHostError);
	assert.equal(error.code, code);
	return true;
}

suite('Agent Host protocol core', { concurrency: false }, () => {
	test('selects exactly one offered protocol version by Host preference', () => {
		const version1 = createAgentHostProtocolVersion('1');
		const version2 = createAgentHostProtocolVersion('2');
		const version3 = createAgentHostProtocolVersion('3');

		assert.equal(selectAgentHostProtocolVersion([version1, version2], [version3, version2]), version2);
		assert.throws(
			() => selectAgentHostProtocolVersion([version1], [version2, version3]),
			error => assertErrorCode(error, AgentHostErrorCode.UnsupportedProtocolVersion),
		);
	});

	test('selects the connected Agent Runtime protocol independently', () => {
		const version1 = createAgentRuntimeProtocolVersion('1');
		const version2 = createAgentRuntimeProtocolVersion('2');
		assert.equal(selectAgentRuntimeProtocolVersion([version1, version2], [version2]), version2);
		assert.throws(
			() => selectAgentRuntimeProtocolVersion([version1], [version2]),
			error => assertErrorCode(error, AgentHostErrorCode.UnsupportedProtocolVersion),
		);
	});

	test('applies only contiguous channel revisions and discards exact duplicates', () => {
		const channel = createAgentHostChannelId('test:counter');
		const reducer = new AgentHostChannelStateReducer(
			channel,
			'counter',
			(state: ICounterState, action: ICounterAction): ICounterState => ({ value: state.value + action.add }),
		);
		reducer.applySnapshot({
			channel,
			kind: 'counter',
			hostSequence: createAgentHostSequence(10),
			revision: createAgentHostChannelRevision(2),
			state: { value: 4 },
		});

		const revision3 = createCounterAction(channel, 12, 3, '2', 3);
		const revision4 = createCounterAction(channel, 13, 4, '3', 5);
		assert.deepStrictEqual(reducer.applyAction(revision3), {
			kind: 'applied',
			state: { value: 7 },
			hostSequence: createAgentHostSequence(12),
			revision: createAgentHostChannelRevision(3),
		});
		assert.equal(reducer.applyAction(revision3).kind, 'duplicate');
		assert.equal(reducer.applyAction(revision4).kind, 'applied');
		assert.equal(reducer.applyAction(revision3).kind, 'duplicate');
		assert.deepStrictEqual(reducer.state, { value: 12 });
	});

	test('treats an action covered by an authoritative snapshot as a duplicate', () => {
		const channel = createAgentHostChannelId('test:snapshot-covered');
		const reducer = new AgentHostChannelStateReducer(
			channel,
			'counter',
			(state: ICounterState, action: ICounterAction): ICounterState => ({ value: state.value + action.add }),
		);
		reducer.applySnapshot({
			channel,
			kind: 'counter',
			hostSequence: createAgentHostSequence(20),
			revision: createAgentHostChannelRevision(5),
			state: { value: 9 },
		});

		assert.equal(reducer.applyAction(createCounterAction(channel, 20, 5, '4', 100)).kind, 'duplicate');
		assert.deepStrictEqual(reducer.state, { value: 9 });
	});

	test('stops on a revision gap and resumes only from a fresh snapshot', () => {
		const channel = createAgentHostChannelId('test:gap');
		const reducer = new AgentHostChannelStateReducer(
			channel,
			'counter',
			(state: ICounterState, action: ICounterAction): ICounterState => ({ value: state.value + action.add }),
		);
		reducer.applySnapshot({
			channel,
			kind: 'counter',
			hostSequence: createAgentHostSequence(1),
			revision: createAgentHostChannelRevision(0),
			state: { value: 0 },
		});

		const gap = reducer.applyAction(createCounterAction(channel, 3, 2, '5', 2));
		assert.equal(gap.kind, 'snapshotRequired');
		assert.equal(gap.kind === 'snapshotRequired' ? gap.reason : undefined, 'gap');
		assert.equal(reducer.requiresFreshSnapshot, true);
		assert.equal(reducer.applyAction(createCounterAction(channel, 2, 1, '6', 1)).kind, 'snapshotRequired');
		assert.deepStrictEqual(reducer.state, { value: 0 });

		reducer.applySnapshot({
			channel,
			kind: 'counter',
			hostSequence: createAgentHostSequence(3),
			revision: createAgentHostChannelRevision(2),
			state: { value: 2 },
		});
		assert.equal(reducer.requiresFreshSnapshot, false);
		assert.equal(reducer.applyAction(createCounterAction(channel, 4, 3, '7', 3)).kind, 'applied');
		assert.deepStrictEqual(reducer.state, { value: 5 });
	});

	test('requires a fresh snapshot for a conflicting action at an applied revision', () => {
		const channel = createAgentHostChannelId('test:conflict');
		const reducer = new AgentHostChannelStateReducer(
			channel,
			'counter',
			(state: ICounterState, action: ICounterAction): ICounterState => ({ value: state.value + action.add }),
		);
		reducer.applySnapshot({
			channel,
			kind: 'counter',
			hostSequence: createAgentHostSequence(1),
			revision: createAgentHostChannelRevision(0),
			state: { value: 0 },
		});
		reducer.applyAction(createCounterAction(channel, 2, 1, '8', 1));

		const conflict = reducer.applyAction(createCounterAction(channel, 2, 1, '9', 1));
		assert.equal(conflict.kind, 'snapshotRequired');
		assert.equal(conflict.kind === 'snapshotRequired' ? conflict.reason : undefined, 'conflict');
		assert.deepStrictEqual(reducer.state, { value: 1 });
	});

	test('validates one complete exact subscription replacement result', () => {
		const rootChannel = getAgentHostRootChannelId();
		const sessionChannel = createAgentHostChannelId('session:session-1');
		const request = { subscriptions: [rootChannel, sessionChannel] };
		const rootState: IAgentHostRootState = {
			authority: createAgentHostAuthorityId('local'),
			label: { kind: 'literal', value: 'Local' },
			capabilities: {
				supportsCreateSession: false,
				supportsPackageOperations: false,
				supportsAgentAuthentication: false,
			},
			packages: {
				revision: 0,
				installablePackages: [],
				installedPackages: [],
				activations: [],
				retainedBackingRecords: [],
				materializedBackings: [],
			},
			agents: [],
			sessionTypes: [],
		};
		const result = {
			hostSequence: createAgentHostSequence(12),
			snapshots: [{
				channel: rootChannel,
				kind: 'root' as const,
				hostSequence: createAgentHostSequence(12),
				revision: createAgentHostChannelRevision(3),
				state: rootState,
			}],
			missingChannels: [{ channel: sessionChannel, reason: 'deleted' as const }],
		};

		assert.doesNotThrow(() => assertAgentHostSetSubscriptionsResult(request, result));
		assert.doesNotThrow(() => assertAgentHostSetSubscriptionsResult({ subscriptions: [] }, {
			hostSequence: createAgentHostSequence(12),
			snapshots: [],
			missingChannels: [],
		}));
		for (const invalid of [
			{ request: { subscriptions: [rootChannel, rootChannel] }, result },
			{ request, result: { ...result, missingChannels: [] } },
			{ request, result: { ...result, snapshots: [{ ...result.snapshots[0], hostSequence: createAgentHostSequence(11) }] } },
			{ request, result: { ...result, snapshots: [...result.snapshots, result.snapshots[0]] } },
		]) {
			assert.throws(
				() => assertAgentHostSetSubscriptionsResult(invalid.request, invalid.result),
				error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
			);
		}
	});

	test('validates complete replay or complete fresh snapshot reconnect results', () => {
		const rootChannel = getAgentHostRootChannelId();
		const sessionChannel = createAgentHostChannelId('session:session-1');
		const request = {
			connection: createAgentHostClientConnectionId('client-1'),
			lastHostSequence: createAgentHostSequence(10),
			subscriptions: [rootChannel, sessionChannel],
		};
		const rootState: IAgentHostRootState = {
			authority: createAgentHostAuthorityId('local'),
			label: { kind: 'literal', value: 'Local' },
			capabilities: {
				supportsCreateSession: true,
				supportsPackageOperations: true,
				supportsAgentAuthentication: false,
			},
			packages: {
				revision: 0,
				installablePackages: [],
				installedPackages: [],
				activations: [],
				retainedBackingRecords: [],
				materializedBackings: [],
			},
			agents: [],
			sessionTypes: [],
		};
		const replay: AgentHostReconnectResult = {
			kind: 'replay',
			fromHostSequence: createAgentHostSequence(10),
			throughHostSequence: createAgentHostSequence(12),
			actions: [{
				channel: rootChannel,
				kind: 'root',
				hostSequence: createAgentHostSequence(11),
				revision: createAgentHostChannelRevision(2),
				digest: actionDigest('a'),
				cause: { kind: 'host' },
				action: { kind: 'rootStateChanged', state: rootState },
			}],
			missingChannels: [{ channel: sessionChannel, reason: 'deleted' }],
		};
		assert.doesNotThrow(() => assertAgentHostReconnectResult(request, replay));

		const snapshots: AgentHostReconnectResult = {
			kind: 'snapshots',
			hostSequence: createAgentHostSequence(12),
			snapshots: [{
				channel: rootChannel,
				kind: 'root',
				hostSequence: createAgentHostSequence(12),
				revision: createAgentHostChannelRevision(3),
				state: rootState,
			}],
			missingChannels: [{ channel: sessionChannel, reason: 'deleted' }],
		};
		assert.doesNotThrow(() => assertAgentHostReconnectResult(request, snapshots));
		assert.throws(
			() => assertAgentHostReconnectResult(request, { ...replay, fromHostSequence: createAgentHostSequence(9) }),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.throws(
			() => assertAgentHostReconnectResult(request, { ...snapshots, missingChannels: [] }),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.throws(
			() => assertAgentHostReconnectResult(request, {
				...replay,
				missingChannels: [
					{ channel: rootChannel, reason: 'deleted' },
					{ channel: sessionChannel, reason: 'deleted' },
				],
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
	});

	test('reconciles one operation ID only with its bound payload digest', () => {
		const registry = new AgentHostOperationOutcomeRegistry<AgentHostOperationId, { readonly value: string }>();
		const operationId = createAgentHostOperationId('operation-registry-1');
		const digest1 = createAgentHostPayloadDigest(`sha256:${'b'.repeat(64)}`);
		const digest2 = createAgentHostPayloadDigest(`sha256:${'c'.repeat(64)}`);

		assert.deepStrictEqual(registry.reconcile(operationId, digest1), { kind: 'unknown' });
		assert.deepStrictEqual(registry.begin(operationId, digest1), { kind: 'execute' });
		assert.deepStrictEqual(registry.begin(operationId, digest1), { kind: 'pending' });
		assert.deepStrictEqual(registry.reconcile(operationId, digest1), { kind: 'pending' });
		assert.deepStrictEqual(registry.commit(operationId, digest1, { value: 'first' }), { value: 'first' });
		assert.deepStrictEqual(registry.begin(operationId, digest1), { kind: 'committed', outcome: { value: 'first' } });
		assert.deepStrictEqual(registry.commit(operationId, digest1, { value: 'second' }), { value: 'first' });
		assert.throws(
			() => registry.begin(operationId, digest2),
			error => assertErrorCode(error, AgentHostErrorCode.OperationDigestConflict),
		);
	});

	test('computes the same canonical payload digest regardless of object key order', async () => {
		const first = await computeAgentHostPayloadDigest({ z: 2, nested: { b: true, a: 'value' } });
		const second = await computeAgentHostPayloadDigest({ nested: { a: 'value', b: true }, z: 2 });
		const changed = await computeAgentHostPayloadDigest({ nested: { a: 'other', b: true }, z: 2 });

		assert.equal(first, second);
		assert.notEqual(first, changed);
		assert.match(first, /^sha256:[a-f0-9]{64}$/);
	});

	test('accepts only the typed canonical Chat transcript shape', () => {
		const turn = {
			id: createAgentTurnId('turn-1'),
			submission: createAgentSubmissionId('submission-1'),
			payloadDigest,
			state: 'completed',
			user: { text: 'Question', attachments: [], interactionTargets: [] },
			response: [{ kind: 'text', text: 'Answer' }],
		};
		const chat = {
			id: createAgentChatId('chat-1'),
			session: createAgentSessionId('session-1'),
			createdAt: 1,
			modifiedAt: 2,
			title: 'Chat',
			origin: { kind: 'user' },
			model: null,
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
				supportsCancel: false,
			},
			turns: [turn],
		};

		assert.doesNotThrow(() => assertAgentHostChatState(chat));
		assert.throws(
			() => assertAgentHostChatState({ ...chat, turns: [{ ...turn, response: [{ text: 'untyped' }] }] }),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
	});

	test('keeps product-client and Agent-runtime connections as distinct contracts', () => {
		assert.equal(connectionsRemainSeparate, true);
	});
});
