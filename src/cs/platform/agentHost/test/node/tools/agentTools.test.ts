/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationToken } from 'cs/base/common/cancellation';
import { IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type {
	IAgentDescriptor,
	IAgentExecutionProfile,
	IAgentModelDescriptor,
	IAgentRuntimeRegistration,
} from 'cs/platform/agentHost/common/agent';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	AgentConfigurationSchemaProfile,
	validateAndFreezeAgentConfigurationSchema,
} from 'cs/platform/agentHost/common/configuration';
import {
	AgentToolCallId,
	createAgentCapabilityRevision,
	createAgentChatId,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSchemaProfileId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type { AgentHostToolPolicy } from 'cs/platform/agentHost/common/protocol';
import {
	AgentToolEndpointReconciliation,
	AgentToolResult,
	COMET_TOOL_SCHEMA_PROFILE,
	IAgentToolCall,
	IAgentToolExecutorEndpoint,
	IAgentToolProgress,
	IAgentToolRegistration,
	computeAgentToolMutationPayloadDigest,
	parseCometToolSchema,
	validateCometToolValue,
} from 'cs/platform/agentHost/common/tools';
import {
	type AgentToolCallAuthorization,
	AgentToolEndpointRegistry,
	AgentToolEndpointUnavailableError,
	AgentToolExecutionService,
	IAgentToolCallAuthorityPort,
	IAgentToolTimerPort,
} from 'cs/platform/agentHost/node/tools/agentToolExecution';
import {
	AgentToolCallAuthority,
	type IAgentToolPermissionPort,
} from 'cs/platform/agentHost/node/tools/agentToolCallAuthority';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import {
	AgentToolSetPreparationService,
	IAgentToolSetPreparationRequest,
} from 'cs/platform/agentHost/node/tools/agentToolSetPreparation';

const authorityId = createAgentHostAuthorityId('local');
const packageId = createAgentPackageId('test.package');
const agentId = createAgentId('test.agent');
const descriptorRevision = createAgentDescriptorRevision('test.agent.v1');
const capabilityRevision = createAgentCapabilityRevision('test.capabilities.v1');
const runtimeRevision = createAgentRuntimeRegistrationRevision('test.runtime.v1');
const modelId = createAgentModelId('test.model');
const modelRevision = createAgentModelDescriptorRevision('test.model.v1');
const profileRevision = createAgentExecutionProfileRevision('test.profile.v1');
const submissionId = createAgentSubmissionId('submission-1');
const sessionId = createAgentSessionId('session-1');
const chatId = createAgentChatId('chat-1');
const turnId = createAgentTurnId('turn-1');
const executorId = createAgentToolExecutorId('test.executor');
const contributorId = createAgentToolContributorId('test.contributor');
const clientTargetType = createAgentInteractionTargetTypeId('test.client-target');

const hostDefaultsSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'hostDefault',
	revision: 'test.host-defaults.v1',
	properties: [],
});

const sessionConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'session',
	revision: 'test.session-configuration.v1',
	properties: [],
});

const modelConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'model',
	revision: 'test.model-configuration.v1',
	properties: [],
});

const inputSchemaValue = Object.freeze({
	type: 'object',
	properties: Object.freeze({
		text: Object.freeze({ type: 'string', minimumLength: 1, maximumLength: 64 }),
	}),
	required: Object.freeze(['text']),
	additionalProperties: false,
});

const outputSchemaValue = Object.freeze({
	type: 'object',
	properties: Object.freeze({
		ok: Object.freeze({ type: 'boolean' }),
	}),
	required: Object.freeze(['ok']),
	additionalProperties: false,
});

const model: IAgentModelDescriptor = Object.freeze({
	id: modelId,
	revision: modelRevision,
	displayName: 'Test model',
	enabled: true,
	configurationSchema: modelConfigurationSchema,
	toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
	attachments: Object.freeze({
		carriers: Object.freeze(['inline'] as const),
		shapes: Object.freeze(['blob'] as const),
		mediaTypes: Object.freeze(['text/plain']),
		maximumCount: 1,
		maximumItemBytes: 1_024,
		maximumTotalBytes: 1_024,
		maximumTreeDepth: 1,
		maximumTreeEntries: 1,
		supportsClientContentForBackgroundExecution: false,
	}),
});

const agent: IAgentDescriptor = Object.freeze({
	id: agentId,
	packageId,
	revision: descriptorRevision,
	displayName: 'Test Agent',
	description: 'Exercises the canonical Tool Host services',
	capabilities: Object.freeze({
		revision: capabilityRevision,
		supportsEmptySession: true,
		supportsCreateChat: true,
		maximumChatCount: 4,
		supportsForkChat: true,
		supportsQueue: true,
		supportsSteering: true,
		supportsCancellation: true,
		supportsReleaseSession: true,
		supportsReleaseChat: true,
		supportsDeleteSession: true,
		supportsDeleteChat: true,
	}),
	models: Object.freeze([model]),
	requiresAgentAuthentication: false,
});

const runtimeRegistration: IAgentRuntimeRegistration = Object.freeze({
	packageId,
	agentId,
	revision: runtimeRevision,
	descriptorRevision,
	capabilityRevision,
	hostDefaultsSchema,
	initialSessionConfigurationSchema: sessionConfigurationSchema.revision,
	supportedSessionConfigurationSchemas: Object.freeze([sessionConfigurationSchema.revision]),
	supportedToolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
	supportedResumeSchemas: Object.freeze([]),
	resumeMigrationEdges: Object.freeze([]),
});

const executionProfile: IAgentExecutionProfile = Object.freeze({
	revision: profileRevision,
	digest: createAgentExecutionProfileDigest(`sha256:${'1'.repeat(64)}`),
	agentDescriptor: descriptorRevision,
	modelDescriptor: modelRevision,
	data: 'exact-profile',
});

interface IRegistrationOptions {
	readonly registration?: string;
	readonly tool?: string;
	readonly functionName?: string;
	readonly safety?: 'read' | 'write' | 'external';
	readonly maximumInputBytes?: number;
	readonly maximumOutputBytes?: number;
	readonly maximumContentBytes?: number;
	readonly maximumConcurrency?: number;
}

function createRegistration(options: IRegistrationOptions = {}): IAgentToolRegistration {
	const registration = options.registration ?? 'registration-1';
	const tool = options.tool ?? 'test.read';
	return {
		id: createAgentToolRegistrationId(registration),
		revision: createAgentToolRegistrationRevision(`${registration}.v1`),
		descriptor: {
			id: createAgentToolId(tool),
			revision: createAgentToolDescriptorRevision(`${tool}.v1`),
			contributor: contributorId,
			functionName: options.functionName ?? 'read_test_value',
			displayName: 'Test Tool',
			description: 'Executes one exact canonical Tool call',
			inputSchema: { profile: COMET_TOOL_SCHEMA_PROFILE, value: inputSchemaValue },
			outputSchema: { profile: COMET_TOOL_SCHEMA_PROFILE, value: outputSchemaValue },
			safety: options.safety ?? 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			targetTypes: [],
			limits: {
				maximumInputBytes: options.maximumInputBytes ?? 1_024,
				maximumOutputBytes: options.maximumOutputBytes ?? 1_024,
				maximumContentBytes: options.maximumContentBytes ?? 1_024,
				timeoutMilliseconds: 1_000,
				maximumConcurrency: options.maximumConcurrency ?? 1,
			},
		},
		executor: { kind: 'host', executor: executorId },
	};
}

function preparationRequest(
	policy: AgentHostToolPolicy,
	runtime: IAgentRuntimeRegistration = runtimeRegistration,
	selectedModel: IAgentModelDescriptor = model,
	targets: readonly IAgentHostInteractionTarget[] = Object.freeze([]),
): IAgentToolSetPreparationRequest {
	return {
		submission: submissionId,
		agent,
		runtimeRegistration: runtime,
		model: selectedModel,
		profile: executionProfile,
		targets,
		policy,
	};
}

function createClientRegistration(
	connection: ReturnType<typeof createAgentHostClientConnectionId>,
	targetTypes: readonly ReturnType<typeof createAgentInteractionTargetTypeId>[] = Object.freeze([clientTargetType]),
): IAgentToolRegistration {
	const registration = createRegistration();
	return Object.freeze({
		...registration,
		descriptor: Object.freeze({
			...registration.descriptor,
			targetTypes,
		}),
		executor: Object.freeze({
			kind: 'client',
			connection,
			executor: createAgentToolExecutorId('test.client-executor'),
		}),
	});
}

function createClientTarget(
	connection: ReturnType<typeof createAgentHostClientConnectionId>,
	id: string,
): IAgentHostInteractionTarget {
	return Object.freeze({
		id: createAgentInteractionTargetId(id),
		owner: createAgentInteractionTargetOwnerId('test.client'),
		type: clientTargetType,
		schemaVersion: 1,
		resource: `test-client://${id}`,
		resourceVersion: '1',
		revision: createAgentInteractionTargetRevision(`${id}.v1`),
		authority: Object.freeze({ kind: 'client', connection }),
		availability: 'turn',
		display: Object.freeze({ label: id }),
	});
}

type ExecuteHandler = (
	call: IAgentToolCall,
	reportProgress: (progress: IAgentToolProgress) => void,
	cancellation: CancellationToken,
) => Promise<AgentToolResult>;

class TestEndpoint implements IAgentToolExecutorEndpoint {
	readonly executeCalls: IAgentToolCall[] = [];
	readonly cancelCalls: IAgentToolCall[] = [];
	readonly reconcileCalls: IAgentToolCall[] = [];

	constructor(
		private readonly executeHandler: ExecuteHandler,
		private readonly reconcileHandler: (call: IAgentToolCall) => Promise<AgentToolEndpointReconciliation>,
	) {}

	async execute(
		call: IAgentToolCall,
		_target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		this.executeCalls.push(call);
		return this.executeHandler(call, reportProgress, cancellation);
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		this.cancelCalls.push(call);
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		this.reconcileCalls.push(call);
		return this.reconcileHandler(call);
	}
}

interface IFakeTimer {
	readonly delay: number;
	readonly callback: () => void;
	disposed: boolean;
}

class FakeTimers implements IAgentToolTimerPort {
	readonly scheduled: IFakeTimer[] = [];

	schedule(delayMilliseconds: number, callback: () => void): IDisposable {
		const timer: IFakeTimer = { delay: delayMilliseconds, callback, disposed: false };
		this.scheduled.push(timer);
		return toDisposable(() => { timer.disposed = true; });
	}

	fireActive(): void {
		const timer = this.scheduled.find(candidate => !candidate.disposed);
		assert.ok(timer);
		timer.callback();
	}
}

const authorized: IAgentToolCallAuthorityPort = {
	async authorize() {
		return { kind: 'authorized' };
	},
};

interface IExecutionFixture {
	readonly registration: IAgentToolRegistration;
	readonly endpoint: TestEndpoint;
	readonly endpointPublication: IDisposable;
	readonly endpoints: AgentToolEndpointRegistry;
	readonly preparation: AgentToolSetPreparationService;
	readonly execution: AgentToolExecutionService;
	readonly timers: FakeTimers;
	readonly toolSet: Awaited<ReturnType<AgentToolSetPreparationService['prepare']>>;
}

async function createExecutionFixture(
	registration: IAgentToolRegistration,
	endpoint: TestEndpoint,
	maximumCallRecords = 32,
): Promise<IExecutionFixture> {
	const registry = new AgentToolRegistry();
	registry.publish(registration);
	const endpoints = new AgentToolEndpointRegistry();
	const endpointPublication = endpoints.publish(registration.executor, endpoint);
	const preparation = new AgentToolSetPreparationService(authorityId, registry, endpoints, 16);
	const toolSet = await preparation.prepare(preparationRequest({ kind: 'selected', tools: [registration.descriptor.id] }));
	const timers = new FakeTimers();
	const execution = new AgentToolExecutionService({
		toolSets: preparation,
		endpoints,
		authority: authorized,
		timers,
		now: () => 1_000,
		reportUnexpectedError: error => { throw error; },
		maximumCallRecords,
	});
	return { registration, endpoint, endpointPublication, endpoints, preparation, execution, timers, toolSet };
}

function readCall(
	fixture: Pick<IExecutionFixture, 'registration' | 'toolSet'>,
	id = 'call-1',
	input: AgentHostProtocolValue = { text: 'exact' },
): IAgentToolCall {
	return {
		id: createAgentToolCallId(id),
		agent: agentId,
		registration: runtimeRevision,
		session: sessionId,
		chat: chatId,
		turn: turnId,
		toolSet: fixture.toolSet.revision,
		tool: fixture.registration.descriptor.id,
		descriptor: fixture.registration.descriptor.revision,
		registrationId: fixture.registration.id,
		registrationRevision: fixture.registration.revision,
		input,
		effect: { kind: 'read' },
		deadline: 10_000,
	};
}

async function mutationCall(
	fixture: IExecutionFixture,
	id = 'call-1',
	operationId = 'operation-1',
): Promise<IAgentToolCall> {
	const payload = {
		...readCall(fixture, id),
		effect: {
			kind: 'mutation' as const,
			operation: createAgentHostOperationId(operationId),
		},
	};
	return {
		...payload,
		effect: {
			...payload.effect,
			payloadDigest: await computeAgentToolMutationPayloadDigest(payload),
		},
	};
}

async function flush(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}

function completed(call: AgentToolCallId, output: AgentHostProtocolValue = { ok: true }): AgentToolResult {
	return { call, status: 'completed', output };
}

suite('comet.tools.v1 schema', () => {
	test('strictly rejects constraint loss and validates values without coercion', () => {
		assert.throws(() => parseCometToolSchema({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: { type: 'string', minLength: 1 },
		}));
		const schema = parseCometToolSchema({ profile: COMET_TOOL_SCHEMA_PROFILE, value: inputSchemaValue });
		const source = { text: 'exact' };
		const value = validateCometToolValue(schema, source, 'input');
		assert.deepEqual(value, source);
		assert.notEqual(value, source);
		assert.ok(Object.isFrozen(value));
		assert.throws(() => validateCometToolValue(schema, {}, 'input'));
		assert.throws(() => validateCometToolValue(schema, { text: 1 }, 'input'));
		assert.throws(() => validateCometToolValue(schema, { text: 'exact', extra: true }, 'input'));
	});

	test('oneOf requires one exact validation branch', () => {
		const schema = parseCometToolSchema({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: { type: 'oneOf', variants: [{ type: 'number' }, { type: 'integer' }] },
		});
		assert.throws(() => validateCometToolValue(schema, 1, 'input'));
		assert.equal(validateCometToolValue(schema, 1.5, 'input'), 1.5);
	});
});

suite('canonical Tool registry and preparation', () => {
	test('rejects registration, Tool, and function ambiguity while availability remains independent', () => {
		const registry = new AgentToolRegistry();
		const first = createRegistration();
		registry.publish(first);
		assert.throws(() => registry.publish(createRegistration({ registration: 'registration-1', tool: 'test.other', functionName: 'other' })));
		assert.throws(() => registry.publish(createRegistration({ registration: 'registration-2', functionName: 'other' })));
		assert.throws(() => registry.publish(createRegistration({ registration: 'registration-3', tool: 'test.other' })));

		const endpoints = new AgentToolEndpointRegistry();
		assert.equal(endpoints.isAvailable(first.executor), false);
		const endpoint = new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		);
		const publication = endpoints.publish(first.executor, endpoint);
		assert.equal(endpoints.isAvailable(first.executor), true);
		publication.dispose();
		assert.equal(endpoints.isAvailable(first.executor), false);
		assert.equal(registry.snapshot().length, 1);
	});

	test('selects one equivalent connected-client registration by exact target authority', async () => {
		const firstConnection = createAgentHostClientConnectionId('renderer:first');
		const secondConnection = createAgentHostClientConnectionId('renderer:second');
		const otherConnection = createAgentHostClientConnectionId('renderer:other');
		const first = createClientRegistration(firstConnection);
		const second = createClientRegistration(secondConnection);
		const registry = new AgentToolRegistry();
		registry.publish(first);
		registry.publish(second);
		assert.deepEqual(registry.snapshot(), [first, second]);

		const endpoint = new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		);
		const endpoints = new AgentToolEndpointRegistry();
		endpoints.publish(first.executor, endpoint);
		endpoints.publish(second.executor, endpoint);
		const preparation = new AgentToolSetPreparationService(authorityId, registry, endpoints, 8);
		const firstTarget = createClientTarget(firstConnection, 'target-first');
		const secondTarget = createClientTarget(secondConnection, 'target-second');
		const selectedPolicy = Object.freeze({
			kind: 'selected' as const,
			tools: Object.freeze([first.descriptor.id]),
		});

		const firstSet = await preparation.prepare(preparationRequest(
			selectedPolicy,
			runtimeRegistration,
			model,
			[firstTarget],
		));
		assert.deepEqual(firstSet.registrations, [first]);
		const secondSet = await preparation.prepare(preparationRequest(
			selectedPolicy,
			runtimeRegistration,
			model,
			[secondTarget],
		));
		assert.deepEqual(secondSet.registrations, [second]);

		await assert.rejects(() => preparation.prepare(preparationRequest(
			selectedPolicy,
			runtimeRegistration,
			model,
			[createClientTarget(otherConnection, 'target-other')],
		)), /no exact compatible target/);
		await assert.rejects(() => preparation.prepare(preparationRequest(
			selectedPolicy,
			runtimeRegistration,
			model,
			[firstTarget, secondTarget],
		)), /multiple exact target executors/);
	});

	test('rejects equivalent target-free registrations from different clients', () => {
		const first = createClientRegistration(
			createAgentHostClientConnectionId('renderer:first-target-free'),
			Object.freeze([]),
		);
		const second = createClientRegistration(
			createAgentHostClientConnectionId('renderer:second-target-free'),
			Object.freeze([]),
		);
		const registry = new AgentToolRegistry();
		registry.publish(first);
		assert.throws(() => registry.publish(second), /Duplicate Tool registration/);
	});

	test('binds all and selected policies to distinct immutable revisions', async () => {
		const registry = new AgentToolRegistry();
		const registration = createRegistration();
		registry.publish(registration);
		const endpoints = new AgentToolEndpointRegistry();
		endpoints.publish(registration.executor, new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		));
		const preparation = new AgentToolSetPreparationService(authorityId, registry, endpoints, 4);
		const all = await preparation.prepare(preparationRequest({ kind: 'all' }));
		const selected = await preparation.prepare(preparationRequest({ kind: 'selected', tools: [registration.descriptor.id] }));
		assert.notEqual(all.revision, selected.revision);
		assert.ok(Object.isFrozen(all));
		assert.ok(Object.isFrozen(all.registrations));
		assert.equal(preparation.resolve(all.revision)?.authority, authorityId);
	});

	test('rejects empty, multi-profile, and unavailable selected resolution', async () => {
		const registration = createRegistration();
		const registry = new AgentToolRegistry();
		registry.publish(registration);
		const endpoints = new AgentToolEndpointRegistry();
		const preparation = new AgentToolSetPreparationService(authorityId, registry, endpoints, 4);
		await assert.rejects(() => preparation.prepare(preparationRequest({ kind: 'selected', tools: [registration.descriptor.id] })));

		const otherProfile = createAgentToolSchemaProfileId('comet.tools.v2');
		const emptyModel = { ...model, toolSchemaProfiles: [otherProfile] };
		await assert.rejects(() => preparation.prepare(preparationRequest({ kind: 'all' }, runtimeRegistration, emptyModel)));

		const multiRuntime = {
			...runtimeRegistration,
			supportedToolSchemaProfiles: [COMET_TOOL_SCHEMA_PROFILE, otherProfile],
		};
		const multiModel = { ...model, toolSchemaProfiles: [COMET_TOOL_SCHEMA_PROFILE, otherProfile] };
		await assert.rejects(() => preparation.prepare(preparationRequest({ kind: 'all' }, multiRuntime, multiModel)));
	});
});

suite('accepted Turn Tool authority', () => {
	test('requires one exact active accepted Turn before consulting permission', async () => {
		const registration = createRegistration();
		const registry = new AgentToolRegistry();
		registry.publish(registration);
		const endpoints = new AgentToolEndpointRegistry();
		endpoints.publish(registration.executor, new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		));
		const preparation = new AgentToolSetPreparationService(authorityId, registry, endpoints, 4);
		const toolSet = await preparation.prepare(preparationRequest({ kind: 'all' }));
		const permissionCalls: IAgentToolCall[] = [];
		const permissions: IAgentToolPermissionPort = {
			async authorize(call) {
				permissionCalls.push(call);
				return { kind: 'authorized' };
			},
		};
		const authority = new AgentToolCallAuthority(authorityId, preparation, permissions, 2);
		const fixture = { registration, toolSet };
		const exactCall = readCall(fixture);
		const prepared = preparation.resolve(toolSet.revision);
		assert.ok(prepared);

		assert.equal((await authority.authorize(exactCall, prepared, registration)).kind, 'denied');
		assert.equal(permissionCalls.length, 0);
		const binding = authority.bindTurn({
			agent: agentId,
			runtimeRegistration: runtimeRevision,
			session: sessionId,
			chat: chatId,
			turn: turnId,
			submission: submissionId,
			toolSet: toolSet.revision,
			attachments: Object.freeze([]),
		});
		assert.deepStrictEqual(authority.resolveTurnContext(exactCall), { attachments: [] });
		assert.equal((await authority.authorize(exactCall, prepared, registration)).kind, 'authorized');
		assert.equal(permissionCalls.length, 1);
		assert.equal((await authority.authorize({
			...exactCall,
			turn: createAgentTurnId('another-turn'),
		}, prepared, registration)).kind, 'denied');
		assert.equal(permissionCalls.length, 1);
		binding.dispose();
		assert.equal((await authority.authorize(exactCall, prepared, registration)).kind, 'denied');
		assert.equal(authority.resolveTurnContext(exactCall), undefined);
	});

	test('rejects duplicate Tool-set ownership and permission completed after Turn retirement', async () => {
		const registration = createRegistration();
		const registry = new AgentToolRegistry();
		registry.publish(registration);
		const endpoints = new AgentToolEndpointRegistry();
		endpoints.publish(registration.executor, new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		));
		const preparation = new AgentToolSetPreparationService(authorityId, registry, endpoints, 4);
		const toolSet = await preparation.prepare(preparationRequest({ kind: 'all' }));
		const permission = new DeferredPromise<AgentToolCallAuthorization>();
		const authority = new AgentToolCallAuthority(authorityId, preparation, {
			authorize: async () => permission.p,
		}, 1);
		const accepted = {
			agent: agentId,
			runtimeRegistration: runtimeRevision,
			session: sessionId,
			chat: chatId,
			turn: turnId,
			submission: submissionId,
			toolSet: toolSet.revision,
			attachments: Object.freeze([]),
		};
		const binding = authority.bindTurn(accepted);
		assert.throws(() => authority.bindTurn(accepted));
		assert.throws(() => authority.bindTurn({
			...accepted,
			turn: createAgentTurnId('another-turn'),
		}));
		const prepared = preparation.resolve(toolSet.revision);
		assert.ok(prepared);
		const authorization = authority.authorize(readCall({ registration, toolSet }), prepared, registration);
		await flush();
		binding.dispose();
		permission.complete({ kind: 'authorized' });
		assert.equal((await authorization).kind, 'denied');
	});
});

suite('Host Tool Execution Port', () => {
	test('enforces input schema and input/output byte bounds', async () => {
		const endpoint = new TestEndpoint(
			async call => completed(call.id, { ok: true, extra: true }),
			async () => ({ kind: 'unknown' }),
		);
		const fixture = await createExecutionFixture(createRegistration({ maximumInputBytes: 20 }), endpoint);
		const invalidInput = await fixture.execution.execute(readCall(fixture, 'call-invalid', {}), () => {});
		assert.equal(invalidInput.status, 'failed');
		assert.equal(invalidInput.failure.code, 'invalidInput');
		const oversizedInput = await fixture.execution.execute(readCall(fixture, 'call-large', { text: 'x'.repeat(64) }), () => {});
		assert.equal(oversizedInput.status, 'failed');
		assert.equal(oversizedInput.failure.code, 'invalidInput');
		const invalidOutput = await fixture.execution.execute(readCall(fixture, 'call-output'), () => {});
		assert.equal(invalidOutput.status, 'failed');
		assert.equal(invalidOutput.failure.code, 'invalidOutput');
		assert.equal(endpoint.executeCalls.length, 1);
	});

	test('enforces exact monotonic bounded progress', async () => {
		const endpoint = new TestEndpoint(
			async (call, reportProgress) => {
				reportProgress({ call: call.id, sequence: 2, data: { phase: 'late' } });
				return completed(call.id);
			},
			async () => ({ kind: 'unknown' }),
		);
		const fixture = await createExecutionFixture(createRegistration(), endpoint);
		const result = await fixture.execution.execute(readCall(fixture), () => {});
		assert.equal(result.status, 'failed');
		assert.equal(result.failure.code, 'failed');
	});

	test('enforces descriptor concurrency without choosing another endpoint', async () => {
		const pending = new DeferredPromise<AgentToolResult>();
		const endpoint = new TestEndpoint(
			async () => pending.p,
			async () => ({ kind: 'unknown' }),
		);
		const fixture = await createExecutionFixture(createRegistration({ maximumConcurrency: 1 }), endpoint);
		const first = fixture.execution.execute(readCall(fixture, 'call-1'), () => {});
		await flush();
		const second = await fixture.execution.execute(readCall(fixture, 'call-2'), () => {});
		assert.equal(second.status, 'failed');
		assert.equal(second.failure.code, 'unavailable');
		assert.equal(endpoint.executeCalls.length, 1);
		pending.complete(completed(createAgentToolCallId('call-1')));
		assert.equal((await first).status, 'completed');
	});

	test('cancellation is idempotent and late progress cannot reopen the terminal call', async () => {
		const pending = new DeferredPromise<AgentToolResult>();
		let progress!: (value: IAgentToolProgress) => void;
		let token!: CancellationToken;
		const endpoint = new TestEndpoint(
			async (_call, reportProgress, cancellation) => {
				progress = reportProgress;
				token = cancellation;
				return pending.p;
			},
			async () => ({ kind: 'unknown' }),
		);
		const fixture = await createExecutionFixture(createRegistration(), endpoint);
		const reported: IAgentToolProgress[] = [];
		const resultPromise = fixture.execution.execute(readCall(fixture), value => reported.push(value));
		await flush();
		await fixture.execution.cancel(createAgentToolCallId('call-1'));
		await fixture.execution.cancel(createAgentToolCallId('call-1'));
		const result = await resultPromise;
		assert.equal(result.status, 'cancelled');
		assert.equal(token.isCancellationRequested, true);
		assert.equal(endpoint.cancelCalls.length, 1);
		progress({ call: createAgentToolCallId('call-1'), sequence: 1, data: null });
		assert.deepEqual(reported, []);
	});

	test('deadline timeout cancels the exact endpoint and remains terminal', async () => {
		const pending = new DeferredPromise<AgentToolResult>();
		const endpoint = new TestEndpoint(
			async () => pending.p,
			async () => ({ kind: 'unknown' }),
		);
		const fixture = await createExecutionFixture(createRegistration(), endpoint);
		const resultPromise = fixture.execution.execute(readCall(fixture), () => {});
		await flush();
		assert.equal(fixture.timers.scheduled[0].delay, 1_000);
		fixture.timers.fireActive();
		const result = await resultPromise;
		await flush();
		assert.equal(result.status, 'timedOut');
		assert.equal(endpoint.cancelCalls.length, 1);
	});

	test('missing and disconnected exact endpoints return typed unavailable results', async () => {
		const endpoint = new TestEndpoint(
			async () => { throw new AgentToolEndpointUnavailableError('exact endpoint disconnected'); },
			async () => ({ kind: 'unknown' }),
		);
		const disconnected = await createExecutionFixture(createRegistration(), endpoint);
		const disconnectedResult = await disconnected.execution.execute(readCall(disconnected), () => {});
		assert.equal(disconnectedResult.status, 'failed');
		assert.equal(disconnectedResult.failure.code, 'unavailable');

		const missingEndpoint = new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		);
		const missing = await createExecutionFixture(createRegistration({ registration: 'registration-2' }), missingEndpoint);
		missing.endpointPublication.dispose();
		const missingResult = await missing.execution.execute(readCall(missing), () => {});
		assert.equal(missingResult.status, 'failed');
		assert.equal(missingResult.failure.code, 'unavailable');
	});

	test('reconciles the same mutation operation after uncertain execution without retry', async () => {
		const endpoint = new TestEndpoint(
			async () => { throw new Error('uncertain transport failure'); },
			async call => ({ kind: 'terminal', result: completed(call.id) }),
		);
		const fixture = await createExecutionFixture(createRegistration({ safety: 'write' }), endpoint);
		const call = await mutationCall(fixture);
		const result = await fixture.execution.execute(call, () => {});
		assert.equal(result.status, 'completed');
		assert.equal(endpoint.executeCalls.length, 1);
		assert.equal(endpoint.reconcileCalls.length, 1);
		assert.equal(endpoint.reconcileCalls[0].effect.kind, 'mutation');
		assert.equal(endpoint.reconcileCalls[0].effect.kind === 'mutation' && endpoint.reconcileCalls[0].effect.operation, call.effect.kind === 'mutation' && call.effect.operation);
	});

	test('reconciles without execution and reuses capacity only after durable release', async () => {
		const endpoint = new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		);
		const fixture = await createExecutionFixture(createRegistration(), endpoint, 1);
		const first = readCall(fixture, 'call-release-1');

		assert.deepEqual(await fixture.execution.reconcile(first), { kind: 'unknown' });
		assert.equal(endpoint.executeCalls.length, 0);
		const firstResult = await fixture.execution.execute(first, () => {});
		assert.deepEqual(await fixture.execution.reconcile(first), { kind: 'terminal', result: firstResult });
		assert.equal(endpoint.executeCalls.length, 1);

		const exhausted = await fixture.execution.execute(readCall(fixture, 'call-release-2'), () => {});
		assert.equal(exhausted.status, 'failed');
		assert.equal(exhausted.status === 'failed' && exhausted.failure.code, 'unavailable');
		assert.equal(endpoint.executeCalls.length, 1);

		fixture.execution.release(first.id);
		assert.deepEqual(await fixture.execution.reconcile(first), { kind: 'unknown' });
		const second = readCall(fixture, 'call-release-2');
		assert.equal((await fixture.execution.execute(second, () => {})).status, 'completed');
		assert.equal(endpoint.executeCalls.length, 2);
	});

	test('reports uncertain mutation disconnect and rejects a mismatched payload digest', async () => {
		let publication!: IDisposable;
		const endpoint = new TestEndpoint(
			async () => {
				publication.dispose();
				throw new AgentToolEndpointUnavailableError('disconnected');
			},
			async () => ({ kind: 'unknown' }),
		);
		const fixture = await createExecutionFixture(createRegistration({ safety: 'external' }), endpoint);
		publication = fixture.endpointPublication;
		const uncertain = await fixture.execution.execute(await mutationCall(fixture), () => {});
		assert.equal(uncertain.status, 'failed');
		assert.equal(uncertain.failure.code, 'unavailable');
		assert.equal(uncertain.failure.reconciliation, 'sameOperationRequired');
		assert.equal(endpoint.executeCalls.length, 1);

		const mismatchEndpoint = new TestEndpoint(
			async call => completed(call.id),
			async () => ({ kind: 'unknown' }),
		);
		const mismatchFixture = await createExecutionFixture(
			createRegistration({ registration: 'registration-mismatch', tool: 'test.write', functionName: 'write_test_value', safety: 'write' }),
			mismatchEndpoint,
		);
		const valid = await mutationCall(mismatchFixture, 'call-mismatch', 'operation-mismatch');
		if (valid.effect.kind !== 'mutation') {
			throw new Error('Expected a mutating Tool call');
		}
		const invalid: IAgentToolCall = {
			...valid,
			effect: {
				...valid.effect,
				payloadDigest: createAgentHostPayloadDigest(`sha256:${'f'.repeat(64)}`),
			},
		};
		const mismatch = await mismatchFixture.execution.execute(invalid, () => {});
		assert.equal(mismatch.status, 'failed');
		assert.equal(mismatch.failure.code, 'invalidInput');
		assert.equal(mismatchEndpoint.executeCalls.length, 0);
	});
});
