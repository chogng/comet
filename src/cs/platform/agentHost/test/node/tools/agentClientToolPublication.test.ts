/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { afterEach, beforeEach, suite, test } from 'node:test';

import { DisposableStore } from 'cs/base/common/lifecycle';
import {
	type AgentHostClientConnectionId,
	type AgentInteractionTargetTypeId,
	createAgentHostClientConnectionId,
	createAgentInteractionTargetTypeId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
} from 'cs/platform/agentHost/common/identities';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type IAgentClientToolPublicationSnapshot,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';
import { AgentClientToolPublication } from 'cs/platform/agentHost/node/tools/agentClientToolPublication';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';

const connection = createAgentHostClientConnectionId('client-publication-test');

function createRegistration(
	suffix: string,
	options: {
		readonly tool?: string;
		readonly functionName?: string;
		readonly executorKind?: 'client' | 'host';
		readonly connection?: AgentHostClientConnectionId;
		readonly targetTypes?: readonly AgentInteractionTargetTypeId[];
	} = {},
): IAgentToolRegistration {
	const executor = createAgentToolExecutorId(`executor.${suffix}`);
	return Object.freeze({
		id: createAgentToolRegistrationId(`registration.${suffix}`),
		revision: createAgentToolRegistrationRevision(`registration.${suffix}.v1`),
		descriptor: Object.freeze({
			id: createAgentToolId(options.tool ?? `tool.${suffix}`),
			revision: createAgentToolDescriptorRevision(`descriptor.${suffix}.v1`),
			contributor: createAgentToolContributorId(`contributor.${suffix}`),
			functionName: options.functionName ?? `tool_${suffix}`,
			displayName: `Tool ${suffix}`,
			description: `Exact Tool registration ${suffix}.`,
			inputSchema: Object.freeze({
				profile: COMET_TOOL_SCHEMA_PROFILE,
				value: Object.freeze({
					type: 'object',
					properties: Object.freeze({}),
					required: Object.freeze([]),
					additionalProperties: false,
				}),
			}),
			outputSchema: Object.freeze({
				profile: COMET_TOOL_SCHEMA_PROFILE,
				value: Object.freeze({ type: 'literal', value: null }),
			}),
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			targetTypes: Object.freeze([...(options.targetTypes ?? [])]),
			limits: Object.freeze({
				maximumInputBytes: 1_024,
				maximumOutputBytes: 1_024,
				maximumContentBytes: 1_024,
				timeoutMilliseconds: 30_000,
				maximumConcurrency: 1,
			}),
		}),
		executor: options.executorKind === 'host'
			? Object.freeze({ kind: 'host' as const, executor })
			: Object.freeze({ kind: 'client' as const, connection: options.connection ?? connection, executor }),
	});
}

const endpoint: IAgentToolExecutorEndpoint = Object.freeze({
	execute: async (call: IAgentToolCall) => Object.freeze({ call: call.id, status: 'completed' as const, output: null }),
	cancel: async () => {},
	reconcile: async () => Object.freeze({ kind: 'unknown' }),
});

function snapshot(revision: number, registrations: readonly IAgentToolRegistration[]): IAgentClientToolPublicationSnapshot {
	return Object.freeze({ connection, revision, registrations: Object.freeze([...registrations]) });
}

suite('AgentClientToolPublication', { concurrency: false }, () => {
	let disposables: DisposableStore;

	beforeEach(() => {
		disposables = new DisposableStore();
	});

	afterEach(() => {
		disposables.dispose();
	});

	test('atomically publishes contiguous snapshots and removes exact endpoint availability', () => {
		const registrations = new AgentToolRegistry();
		const endpoints = new AgentToolEndpointRegistry();
		const publication = disposables.add(new AgentClientToolPublication(
			connection,
			registrations,
			endpoints,
			endpoint,
		));
		const clientRegistration = createRegistration('client');
		const first = snapshot(1, [clientRegistration]);

		publication.synchronize(first);
		publication.synchronize(first);
		assert.deepEqual(registrations.snapshot(), [clientRegistration]);
		assert.equal(endpoints.resolve(clientRegistration.executor), endpoint);

		publication.synchronize(snapshot(2, []));
		assert.deepEqual(registrations.snapshot(), []);
		assert.equal(endpoints.resolve(clientRegistration.executor), undefined);
	});

	test('rejects conflicting and skipped revisions without consuming publication state', () => {
		const registrations = new AgentToolRegistry();
		const endpoints = new AgentToolEndpointRegistry();
		const publication = disposables.add(new AgentClientToolPublication(
			connection,
			registrations,
			endpoints,
			endpoint,
		));
		const clientRegistration = createRegistration('client');

		publication.synchronize(snapshot(1, [clientRegistration]));
		assert.throws(() => publication.synchronize(snapshot(1, [])), /conflicts with recorded content/);
		assert.throws(() => publication.synchronize(snapshot(3, [])), /expected revision '2'/);
		assert.deepEqual(registrations.snapshot(), [clientRegistration]);
		assert.equal(endpoints.resolve(clientRegistration.executor), endpoint);
	});

	test('removes only one client when equivalent semantic registrations share canonical IDs', () => {
		const secondConnection = createAgentHostClientConnectionId('client-publication-test-2');
		const targetType = createAgentInteractionTargetTypeId('test.shared-target');
		const registrations = new AgentToolRegistry();
		const endpoints = new AgentToolEndpointRegistry();
		const firstPublication = disposables.add(new AgentClientToolPublication(
			connection,
			registrations,
			endpoints,
			endpoint,
		));
		const secondPublication = disposables.add(new AgentClientToolPublication(
			secondConnection,
			registrations,
			endpoints,
			endpoint,
		));
		const firstRegistration = createRegistration('shared', {
			connection,
			targetTypes: Object.freeze([targetType]),
		});
		const secondRegistration = createRegistration('shared', {
			connection: secondConnection,
			targetTypes: Object.freeze([targetType]),
		});

		firstPublication.synchronize(Object.freeze({
			connection,
			revision: 1,
			registrations: Object.freeze([firstRegistration]),
		}));
		secondPublication.synchronize(Object.freeze({
			connection: secondConnection,
			revision: 1,
			registrations: Object.freeze([secondRegistration]),
		}));
		assert.deepEqual(registrations.snapshot(), [firstRegistration, secondRegistration]);
		assert.equal(endpoints.resolve(firstRegistration.executor), endpoint);
		assert.equal(endpoints.resolve(secondRegistration.executor), endpoint);

		firstPublication.dispose();
		assert.deepEqual(registrations.snapshot(), [secondRegistration]);
		assert.equal(endpoints.resolve(firstRegistration.executor), undefined);
		assert.equal(endpoints.resolve(secondRegistration.executor), endpoint);
	});

	test('keeps Host registrations and the prior endpoint state exact when replacement conflicts', () => {
		const registrations = new AgentToolRegistry();
		const endpoints = new AgentToolEndpointRegistry();
		const publication = disposables.add(new AgentClientToolPublication(
			connection,
			registrations,
			endpoints,
			endpoint,
		));
		const hostRegistration = createRegistration('host', { executorKind: 'host' });
		disposables.add(registrations.publish(hostRegistration));
		const conflictingClient = createRegistration('conflict', {
			tool: hostRegistration.descriptor.id,
			functionName: 'distinct_conflicting_function',
		});

		assert.throws(
			() => publication.synchronize(snapshot(1, [conflictingClient])),
			/Ambiguous Tool identity/,
		);
		assert.deepEqual(registrations.snapshot(), [hostRegistration]);
		assert.equal(endpoints.resolve(conflictingClient.executor), undefined);

		const clientRegistration = createRegistration('accepted');
		publication.synchronize(snapshot(1, [clientRegistration]));
		assert.deepEqual(registrations.snapshot(), [hostRegistration, clientRegistration]);
		assert.equal(endpoints.resolve(clientRegistration.executor), endpoint);

		publication.dispose();
		assert.deepEqual(registrations.snapshot(), [hostRegistration]);
		assert.equal(endpoints.resolve(clientRegistration.executor), undefined);
	});
});
