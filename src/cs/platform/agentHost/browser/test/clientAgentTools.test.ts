/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { afterEach, beforeEach, suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { ClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	createAgentChatId,
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentClientToolPublicationSnapshot,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';

const connection = createAgentHostClientConnectionId('renderer-1');
const toolId = createAgentToolId('draft.apply-edit');
const registrationId = createAgentToolRegistrationId('draft.apply-edit.renderer-1');
const registrationRevision = createAgentToolRegistrationRevision('draft.apply-edit.registration.v1');
const descriptorRevision = createAgentToolDescriptorRevision('draft.apply-edit.descriptor.v1');
const executorId = createAgentToolExecutorId('draft.apply-edit.executor');
const targetType = createAgentInteractionTargetTypeId('draft.document');

const registration: IAgentToolRegistration = Object.freeze({
	id: registrationId,
	revision: registrationRevision,
	descriptor: Object.freeze({
		id: toolId,
		revision: descriptorRevision,
		contributor: createAgentToolContributorId('draft-editor'),
		functionName: 'draft_apply_edit',
		displayName: 'Apply Draft Edit',
		description: 'Applies one exact edit to the addressed draft.',
		inputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({
				type: 'object',
				properties: Object.freeze({ text: Object.freeze({ type: 'string' }) }),
				required: Object.freeze(['text']),
				additionalProperties: false,
			}),
		}),
		outputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({
				type: 'object',
				properties: Object.freeze({ applied: Object.freeze({ type: 'boolean' }) }),
				required: Object.freeze(['applied']),
				additionalProperties: false,
			}),
		}),
		safety: 'write',
		confirmation: 'always',
		allowsEditedInput: false,
		targetTypes: Object.freeze([targetType]),
		limits: Object.freeze({
			maximumInputBytes: 1_024,
			maximumOutputBytes: 1_024,
			maximumContentBytes: 1_024,
			timeoutMilliseconds: 30_000,
			maximumConcurrency: 1,
		}),
	}),
	executor: Object.freeze({ kind: 'client', connection, executor: executorId }),
});

const target: IAgentHostInteractionTarget = Object.freeze({
	id: createAgentInteractionTargetId('draft-target-1'),
	owner: createAgentInteractionTargetOwnerId('draft-editor'),
	type: targetType,
	schemaVersion: 1,
	resource: 'draft://document/1',
	resourceVersion: '3',
	revision: createAgentInteractionTargetRevision('draft-target-1.v3'),
	authority: Object.freeze({ kind: 'client', connection }),
	availability: 'turn',
	display: Object.freeze({ label: 'Draft 1' }),
});

const call: IAgentToolCall = Object.freeze({
	id: createAgentToolCallId('tool-call-1'),
	agent: createAgentId('comet'),
	registration: createAgentRuntimeRegistrationRevision('comet.embedded.v1'),
	session: createAgentSessionId('session-1'),
	chat: createAgentChatId('chat-1'),
	turn: createAgentTurnId('turn-1'),
	toolSet: createAgentToolSetRevision('tool-set-1'),
	tool: toolId,
	descriptor: descriptorRevision,
	registrationId,
	registrationRevision,
	input: Object.freeze({ text: 'replacement' }),
	target: target.id,
	effect: Object.freeze({
		kind: 'mutation',
		operation: createAgentHostOperationId('tool-operation-1'),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`),
	}),
	deadline: 10_000,
});

class TestEndpoint implements IAgentToolExecutorEndpoint {
	readonly executeCalls: Array<{
		readonly call: IAgentToolCall;
		readonly target: IAgentHostInteractionTarget | undefined;
		readonly cancellation: CancellationToken;
	}> = [];
	readonly cancelCalls: IAgentToolCall[] = [];
	readonly reconcileCalls: IAgentToolCall[] = [];

	constructor(
		private readonly result: (call: IAgentToolCall) => AgentToolResult | Promise<AgentToolResult> = current => Object.freeze({
			call: current.id,
			status: 'completed',
			output: Object.freeze({ applied: true }),
		}),
	) {}

	async execute(
		current: IAgentToolCall,
		acceptedTarget: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		this.executeCalls.push({ call: current, target: acceptedTarget, cancellation });
		reportProgress(Object.freeze({ call: current.id, sequence: 1, data: Object.freeze({ phase: 'apply' }) }));
		return this.result(current);
	}

	async cancel(current: IAgentToolCall): Promise<void> {
		this.cancelCalls.push(current);
	}

	async reconcile(current: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		this.reconcileCalls.push(current);
		return Object.freeze({ kind: 'unknown' });
	}
}

suite('ClientAgentToolService', { concurrency: false }, () => {
	let disposables: DisposableStore;

	beforeEach(() => {
		disposables = new DisposableStore();
	});

	afterEach(() => {
		disposables.dispose();
	});

	test('publishes contiguous exact snapshots and dispatches the accepted target', async () => {
		const snapshots: IAgentClientToolPublicationSnapshot[] = [];
		const service = disposables.add(new ClientAgentToolService(connection, {
			maximumCallRecords: 8,
			synchronize: snapshot => {
				snapshots.push(snapshot);
				return Promise.resolve();
			},
		}));
		const endpoint = new TestEndpoint();
		const publication = disposables.add(service.publish(registration, endpoint));
		await service.synchronize();
		assert.deepEqual(snapshots, [Object.freeze({
			connection,
			revision: 1,
			registrations: Object.freeze([registration]),
		})]);

		const progress: IAgentToolProgress[] = [];
		assert.deepEqual(
			await service.execute(call, target, value => progress.push(value), CancellationTokenNone),
			{ call: call.id, status: 'completed', output: { applied: true } },
		);
		assert.deepEqual(endpoint.executeCalls, [{ call, target, cancellation: CancellationTokenNone }]);
		assert.deepEqual(progress, [{ call: call.id, sequence: 1, data: { phase: 'apply' } }]);

		publication.dispose();
		await service.synchronize();
		assert.equal(snapshots[1].revision, 2);
		assert.deepEqual(snapshots[1].registrations, []);
	});

	test('rejects duplicate publication and executor results with another call identity', async () => {
		const service = disposables.add(new ClientAgentToolService(connection, {
			maximumCallRecords: 8,
			synchronize: () => Promise.resolve(),
		}));
		const wrongResultEndpoint = new TestEndpoint(() => Object.freeze({
			call: createAgentToolCallId('another-call'),
			status: 'completed',
			output: Object.freeze({ applied: true }),
		}));
		disposables.add(service.publish(registration, wrongResultEndpoint));
		assert.throws(() => service.publish(registration, new TestEndpoint()), /Duplicate client Tool registration/);
		await assert.rejects(
			service.execute(call, target, () => {}, CancellationTokenNone),
			/does not address call/,
		);
	});

	test('validates exact target authority and forwards cancellation once', async () => {
		const service = disposables.add(new ClientAgentToolService(connection, {
			maximumCallRecords: 8,
			synchronize: () => Promise.resolve(),
		}));
		const pending = new DeferredPromise<AgentToolResult>();
		const endpoint = new TestEndpoint(() => pending.p);
		disposables.add(service.publish(registration, endpoint));
		await assert.rejects(
			service.execute(call, Object.freeze({
				...target,
				authority: Object.freeze({
					kind: 'client',
					connection: createAgentHostClientConnectionId('renderer-2'),
				}),
			}), () => {}, CancellationTokenNone),
			/target is not exact/,
		);
		const execution = service.execute(call, target, () => {}, CancellationTokenNone);
		await Promise.resolve();
		await service.cancel(call);
		await service.cancel(call);
		assert.deepEqual(endpoint.cancelCalls, [call]);
		pending.complete(Object.freeze({
			call: call.id,
			status: 'cancelled',
			failure: Object.freeze({
				code: 'cancelled',
				message: 'Cancelled by the Host',
				reconciliation: 'terminal',
			}),
		}));
		assert.deepEqual(await execution, {
			call: call.id,
			status: 'cancelled',
			failure: {
				code: 'cancelled',
				message: 'Cancelled by the Host',
				reconciliation: 'terminal',
			},
		});
	});
});
