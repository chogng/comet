/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test, TestContext } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationError, CancellationToken, CancellationTokenNone } from 'cs/base/common/cancellation';
import type { IAgentAction, IAgentChatRequest, IAgentExecutionProfile, IAgentModelDescriptor } from 'cs/platform/agentHost/common/agent';
import type { IAgentHostAttachment, IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	collectAgentConfigurationCredentialReferences,
	resolveAgentModelConfigurationCandidate,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type {
	AgentContentTreeEntry,
	IAgentContentBlobReadRequest,
	IAgentContentBlobReadResult,
	IAgentContentMaterialization,
	IAgentContentMaterializeRequest,
	IAgentContentResourceLease,
	IAgentContentResourceOpenRequest,
	IAgentContentResourcePort,
	IAgentContentTreeEntryReadRequest,
	IAgentContentTreePage,
	IAgentContentTreePageRequest,
} from 'cs/platform/agentHost/common/contentResources';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	AgentHostPayloadDigest,
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentCancellationId,
	createAgentChatId,
	createAgentContentDigest,
	createAgentContentLeaseId,
	createAgentContentMaterializationId,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageOperationId,
	createAgentResumeStateDigest,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSessionTypeId,
	createAgentSubmissionId,
	createAgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSchemaProfileId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { computeAgentHostPayloadDigest, encodeAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type {
	AgentToolEndpointReconciliation,
	AgentToolResult,
	IAgentToolCall,
	IAgentToolExecutionPort,
	IAgentToolProgress,
	IAgentToolRegistration,
	IAgentToolSet,
} from 'cs/platform/agentHost/common/tools';
import {
	COMET_AGENT_CAPABILITY_REVISION,
	COMET_AGENT_DESCRIPTOR_REVISION,
	COMET_AGENT_ID,
	COMET_AGENT_INSTRUCTION_PROFILE,
	COMET_AGENT_PACKAGE_ID,
	CometAgent,
} from 'cs/platform/agentHost/node/agents/comet/cometAgent';
import { prepareCometModelAttachments } from 'cs/platform/agentHost/node/agents/comet/cometAttachments';
import {
	COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA,
	COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY,
	COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY,
	COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY,
	COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
	COMET_SESSION_CONFIGURATION_SCHEMA,
	createCometModelConfigurationSchema,
} from 'cs/platform/agentHost/node/agents/comet/cometConfiguration';
import { CometModelError } from 'cs/platform/agentHost/node/agents/comet/cometModel';
import { COMET_AGENT_RESUME_SCHEMA } from 'cs/platform/agentHost/node/agents/comet/cometResume';
import {
	migrateLegacySessionsCatalog,
	type IAgentHostCatalogStore,
	type IAgentHostLegacyCatalogMigrationCompanion,
	type IAgentHostPersistedCatalog,
} from 'cs/platform/agentHost/node/host/agentHostCatalog';
import type {
	ICometExecutionProfileResolver,
	ICometModelRuntime,
	ICometModelStepRequest,
	ICometModelStepResult,
} from 'cs/platform/agentHost/node/agents/comet/cometModel';

const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.runtime.v1');
const modelId = createAgentModelId('comet-model');
const modelRevision = createAgentModelDescriptorRevision('comet-model.v1');
const schemaProfile = createAgentToolSchemaProfileId('comet.tools.v1');
const sessionId = createAgentSessionId('session-1');
const chatId = createAgentChatId('chat-1');
const turnId = createAgentTurnId('turn-1');
const toolId = createAgentToolId('comet.read-target');
const toolCallId = createAgentToolCallId('tool-call-1');
const hostDefaultsConfiguration = validateAndFreezeAgentConfigurationState({
	schema: COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA,
	revision: createAgentConfigurationStateRevision('comet.test.host-defaults.state.v1'),
	values: {},
});
const sessionConfiguration = validateAndFreezeAgentConfigurationState({
	schema: COMET_SESSION_CONFIGURATION_SCHEMA,
	revision: createAgentConfigurationStateRevision('comet.test.session.state.v1'),
	values: {},
});
const sessionConfigurationCandidate = validateAndFreezeAgentConfigurationCandidate(
	COMET_SESSION_CONFIGURATION_SCHEMA,
	{ schema: COMET_SESSION_CONFIGURATION_SCHEMA.revision, values: {} },
	'session',
	true,
);
const modelEndpoint = 'https://models.example.test/v1/responses';
const providerModel = 'test-provider-model';
const credentialReference = 'test-provider';
const modelConfigurationSchema = createCometModelConfigurationSchema({
	revision: createAgentConfigurationSchemaRevision('comet.test.model.v1'),
	endpoint: modelEndpoint,
	providerModel,
	credentialReference,
});
const modelConfiguration = resolveAgentModelConfigurationCandidate(
	modelConfigurationSchema,
	{ schema: modelConfigurationSchema.revision, values: {} },
);
const modelCredentials = Object.freeze(collectAgentConfigurationCredentialReferences(
	modelConfigurationSchema,
	modelConfiguration.values,
	'model',
).map(binding => binding.credential));

function createMigrationCompanion(): IAgentHostLegacyCatalogMigrationCompanion {
	let completed: AgentHostPayloadDigest | undefined;
	return {
		prepare: async () => Object.freeze([]),
		commit: async request => {
			if (completed !== undefined && completed !== request.sourceDigest) {
				throw new Error('injected companion digest conflict');
			}
			completed = request.sourceDigest;
		},
		readCompletedMigration: async () => completed,
	};
}
const toolRegistrationId = createAgentToolRegistrationId('tool-registration-1');
const targetType = createAgentInteractionTargetTypeId('browser.document');
const targetId = createAgentInteractionTargetId('target-1');

const modelDescriptor: IAgentModelDescriptor = {
	id: modelId,
	revision: modelRevision,
	displayName: 'Test model',
	enabled: true,
	configurationSchema: modelConfigurationSchema,
	toolSchemaProfiles: [schemaProfile],
	attachments: {
		carriers: ['inline', 'reference'],
		shapes: ['blob', 'tree'],
		mediaTypes: ['application/json', 'application/octet-stream', 'text/plain'],
		maximumCount: 8,
		maximumItemBytes: 1024 * 1024,
		maximumTotalBytes: 2 * 1024 * 1024,
		maximumTreeDepth: 16,
		maximumTreeEntries: 1_000,
		supportsClientContentForBackgroundExecution: false,
	},
};

function payloadDigest(character: string): AgentHostPayloadDigest {
	return createAgentHostPayloadDigest(`sha256:${character.repeat(64)}`);
}

function assertErrorCode(error: unknown, code: string): boolean {
	assert.ok(error instanceof AgentHostError);
	assert.equal(error.code, code);
	return true;
}

class TestModelRuntime implements ICometModelRuntime {
	readonly requests: ICometModelStepRequest[] = [];

	constructor(
		private readonly handler: (
			request: ICometModelStepRequest,
			token: CancellationToken,
		) => Promise<ICometModelStepResult>,
		readonly id = 'test.model-runtime',
		readonly descriptor: IAgentModelDescriptor = modelDescriptor,
	) {}

	async executeStep(request: ICometModelStepRequest, token: CancellationToken): Promise<ICometModelStepResult> {
		this.requests.push(request);
		return this.handler(request, token);
	}
}

class TestContentResources implements IAgentContentResourcePort {
	readonly calls: string[] = [];
	failMaterialization = false;
	treeEntries: readonly AgentContentTreeEntry[] = [];

	async open(request: IAgentContentResourceOpenRequest): Promise<IAgentContentResourceLease> {
		this.calls.push(`open:${request.attachment}`);
		return {
			lease: createAgentContentLeaseId(`lease-${this.calls.length}`),
			content: request.content,
		};
	}

	async readBlob(_request: IAgentContentBlobReadRequest): Promise<IAgentContentBlobReadResult> {
		throw new Error('Unexpected blob read');
	}

	async readTreePage(request: IAgentContentTreePageRequest): Promise<IAgentContentTreePage> {
		this.calls.push(`readTreePage:${request.cursor ?? 'start'}`);
		const offset = request.cursor === null ? 0 : Number(request.cursor);
		const entries = this.treeEntries.slice(offset, offset + request.maximumEntries);
		const nextOffset = offset + entries.length;
		return {
			entries,
			nextCursor: nextOffset < this.treeEntries.length ? String(nextOffset) : null,
		};
	}

	async readTreeEntry(_request: IAgentContentTreeEntryReadRequest): Promise<IAgentContentBlobReadResult> {
		throw new Error('Unexpected tree-entry read');
	}

	async materialize(request: IAgentContentMaterializeRequest): Promise<IAgentContentMaterialization> {
		this.calls.push(`materialize:${request.lease}`);
		if (this.failMaterialization) {
			throw new Error('Materialization failed');
		}
		return {
			id: createAgentContentMaterializationId(`materialization-${this.calls.length}`),
			resource: `/host/materialized/${request.lease}`,
		};
	}

	async release(lease: ReturnType<typeof createAgentContentLeaseId>): Promise<void> {
		this.calls.push(`release:${lease}`);
	}

	async releaseMaterialization(materialization: ReturnType<typeof createAgentContentMaterializationId>): Promise<void> {
		this.calls.push(`releaseMaterialization:${materialization}`);
	}
}

class TestToolExecution implements IAgentToolExecutionPort {
	readonly calls: IAgentToolCall[] = [];
	readonly cancellations: ReturnType<typeof createAgentToolCallId>[] = [];
	readonly releases: ReturnType<typeof createAgentToolCallId>[] = [];

	constructor(
		private readonly executeResult: AgentToolResult = {
			call: toolCallId,
			status: 'completed',
			output: { content: 'exact target content' },
		},
	) {}

	async execute(call: IAgentToolCall, reportProgress: (progress: IAgentToolProgress) => void): Promise<AgentToolResult> {
		this.calls.push(call);
		reportProgress({ call: call.id, sequence: 1, data: { bytes: 20 } });
		return this.executeResult;
	}

	async cancel(call: ReturnType<typeof createAgentToolCallId>): Promise<void> {
		this.cancellations.push(call);
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		const executed = this.calls.find(candidate => candidate.id === call.id);
		return executed === undefined
			? Object.freeze({ kind: 'unknown' })
			: Object.freeze({ kind: 'terminal', result: this.executeResult });
	}

	release(call: ReturnType<typeof createAgentToolCallId>): void {
		this.releases.push(call);
	}
}

interface ITestFixture {
	readonly agent: CometAgent;
	readonly model: TestModelRuntime;
	readonly contentResources: TestContentResources;
	readonly toolExecution: TestToolExecution;
	readonly actions: IAgentAction[];
	readonly profileResolverCalls: { value: number };
}

function createFixture(
	t: TestContext,
	handler: (
		request: ICometModelStepRequest,
		token: CancellationToken,
	) => Promise<ICometModelStepResult> = async () => ({
		stopReason: 'completed',
		parts: [{ kind: 'text', text: 'done' }],
	}),
): ITestFixture {
	const model = new TestModelRuntime(handler);
	const contentResources = new TestContentResources();
	const toolExecution = new TestToolExecution();
	const profileResolverCalls = { value: 0 };
	const executionProfileResolver: ICometExecutionProfileResolver = {
		async resolve() {
			profileResolverCalls.value += 1;
			return {
				modelRuntime: model.id,
				settings: { reasoning: 'standard' },
				maximumSteps: 4,
			};
		},
	};
	const agent = new CometAgent({
		runtimeRegistration,
		requiresAgentAuthentication: false,
		models: [model],
		executionProfileResolver,
		toolExecution,
		contentResources,
	});
	const actions: IAgentAction[] = [];
	const listener = agent.onDidEmitAction(action => actions.push(action));
	t.after(() => {
		listener.dispose();
		agent.dispose();
	});
	return { agent, model, contentResources, toolExecution, actions, profileResolverCalls };
}

async function resolveProfile(
	agent: CometAgent,
	submission = createAgentSubmissionId('submission-1'),
	model = modelId,
) {
	const selection = { kind: 'user' as const, value: { model }, configuration: modelConfiguration };
	const selectionDigest = await computeAgentHostPayloadDigest(selection);
	return agent.executionProfiles.resolve({
		submission,
		selection,
		selectionDigest,
		runtimeRegistration,
		sessionConfiguration,
	});
}

async function createSessionAndChat(agent: CometAgent) {
	const sessionBacking = await agent.sessions.create({
		operation: createAgentHostOperationId('create-session-1'),
		payloadDigest: payloadDigest('1'),
		session: sessionId,
		configuration: sessionConfiguration,
		workspace: {
			resource: 'workspace://test',
			label: 'Test workspace',
			folders: [{
				resource: 'file:///workspace',
				workingDirectory: '/workspace',
				name: 'workspace',
			}],
		},
	});
	const chatBacking = await agent.chats.create({
		operation: createAgentHostOperationId('create-chat-1'),
		payloadDigest: payloadDigest('2'),
		session: sessionId,
		chat: chatId,
		origin: { kind: 'user' },
	});
	return { sessionBacking, chatBacking };
}

function createToolRegistration(): IAgentToolRegistration {
	return {
		id: toolRegistrationId,
		revision: createAgentToolRegistrationRevision('tool-registration.v1'),
		descriptor: {
			id: toolId,
			revision: createAgentToolDescriptorRevision('tool-descriptor.v1'),
			contributor: createAgentToolContributorId('browser'),
			functionName: 'read_exact_target',
			displayName: 'Read exact target',
			description: 'Reads the exact accepted target',
			inputSchema: { profile: schemaProfile, value: { type: 'object' } },
			outputSchema: { profile: schemaProfile, value: { type: 'object' } },
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			targetTypes: [targetType],
			limits: {
				maximumInputBytes: 1024,
				maximumOutputBytes: 4096,
				maximumContentBytes: 4096,
				timeoutMilliseconds: 1000,
				maximumConcurrency: 1,
			},
		},
		executor: { kind: 'host', executor: createAgentToolExecutorId('browser-reader') },
	};
}

function createToolSet(
	registrations: readonly IAgentToolRegistration[] = [],
	descriptor = modelRevision,
): IAgentToolSet {
	return {
		revision: createAgentToolSetRevision('tool-set-1'),
		schemaProfile,
		runtimeRegistration,
		agentDescriptor: COMET_AGENT_DESCRIPTOR_REVISION,
		modelDescriptor: descriptor,
		registrations,
	};
}

function createTarget(): IAgentHostInteractionTarget {
	return {
		id: targetId,
		owner: createAgentInteractionTargetOwnerId('browser'),
		type: targetType,
		schemaVersion: 1,
		resource: 'browser-view://view-1',
		resourceVersion: 'document-epoch-7',
		revision: createAgentInteractionTargetRevision('target-revision-1'),
		authority: { kind: 'host' },
		availability: 'turn',
		display: { label: 'Article page' },
	};
}

function createAttachments(): readonly IAgentHostAttachment[] {
	return [
		{
			envelopeVersion: 1,
			id: createAgentAttachmentId('article-1'),
			producerType: createAgentAttachmentProducerTypeId('article.metadata'),
			display: { label: 'Article metadata' },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.article-metadata.v1'),
				mediaType: 'application/json',
				value: { title: 'Exact metadata only' },
			},
			metadata: [],
		},
		{
			envelopeVersion: 1,
			id: createAgentAttachmentId('inline-1'),
			producerType: createAgentAttachmentProducerTypeId('text'),
			display: { label: 'Inline text' },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.text.v1'),
				mediaType: 'text/plain',
				value: { kind: 'text' },
			},
			content: {
				kind: 'inline',
				mediaType: 'text/plain',
				encoding: 'utf8',
				data: 'inline',
				byteLength: 6,
				version: createAgentContentVersion('inline-v1'),
				digest: createAgentContentDigest(`sha256:${'a'.repeat(64)}`),
			},
			metadata: [],
		},
		{
			envelopeVersion: 1,
			id: createAgentAttachmentId('reference-1'),
			producerType: createAgentAttachmentProducerTypeId('file'),
			display: { label: 'Exact file' },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.file.v1'),
				mediaType: 'application/json',
				value: { name: 'data.bin' },
			},
			content: {
				kind: 'reference',
				reference: createAgentContentReferenceId('content://reference-1'),
				owner: { kind: 'host' },
				shape: 'blob',
				mediaType: 'application/octet-stream',
				bounds: { byteLength: 128, maximumReadLength: 128 },
				version: createAgentContentVersion('reference-v1'),
				digest: createAgentContentDigest(`sha256:${'b'.repeat(64)}`),
			},
			metadata: [],
		},
	];
}

async function createTurnRequest(
	agent: CometAgent,
	options: {
		readonly attachments?: readonly IAgentHostAttachment[];
		readonly interactionTargets?: readonly IAgentHostInteractionTarget[];
		readonly toolSet?: IAgentToolSet;
		readonly operation?: string;
		readonly digestCharacter?: string;
		readonly session?: ReturnType<typeof createAgentSessionId>;
		readonly chat?: ReturnType<typeof createAgentChatId>;
		readonly turn?: ReturnType<typeof createAgentTurnId>;
		readonly submission?: ReturnType<typeof createAgentSubmissionId>;
		readonly profile?: IAgentExecutionProfile;
	} = {},
): Promise<IAgentChatRequest> {
	const submission = options.submission ?? createAgentSubmissionId('submission-1');
	return {
		operation: createAgentHostOperationId(options.operation ?? 'send-turn-1'),
		payloadDigest: payloadDigest(options.digestCharacter ?? '3'),
		session: options.session ?? sessionId,
		chat: options.chat ?? chatId,
		turn: options.turn ?? turnId,
		submission,
		message: 'Use only the accepted context.',
		attachments: options.attachments ?? [],
		interactionTargets: options.interactionTargets ?? [],
		binding: {
			profile: options.profile ?? await resolveProfile(agent, submission),
			modelConfiguration,
			credentials: modelCredentials,
			runtimeRegistration,
			toolSet: options.toolSet ?? createToolSet(),
			deadline: 10_000,
			cancellation: createAgentCancellationId('cancellation-1'),
			outputConstraints: { format: 'text' },
		},
	};
}

suite('CometAgent', { concurrency: false }, () => {
	test('publishes stable Comet identity and resolves one exact retry-stable profile', async t => {
		const fixture = createFixture(t);
		const descriptor = fixture.agent.descriptor.get();
		assert.equal(fixture.agent.id, COMET_AGENT_ID);
		assert.equal(fixture.agent.registration.packageId, COMET_AGENT_PACKAGE_ID);
		assert.equal(fixture.agent.registration.agentId, COMET_AGENT_ID);
		assert.equal(descriptor.revision, COMET_AGENT_DESCRIPTOR_REVISION);
		assert.equal(descriptor.revision, 'comet.descriptor.v2');
		assert.equal(descriptor.capabilities.revision, COMET_AGENT_CAPABILITY_REVISION);
		assert.equal(fixture.agent.registration.hostDefaultsSchema, COMET_HOST_DEFAULT_CONFIGURATION_SCHEMA);
		assert.equal(
			fixture.agent.registration.initialSessionConfigurationSchema,
			COMET_SESSION_CONFIGURATION_SCHEMA.revision,
		);
		assert.ok(fixture.agent.registration.supportedSessionConfigurationSchemas.includes(
			fixture.agent.registration.initialSessionConfigurationSchema,
		));
		assert.deepEqual(descriptor.models[0].configurationSchema, modelConfigurationSchema);
		assert.deepEqual(fixture.agent.registration.supportedResumeSchemas, [COMET_AGENT_RESUME_SCHEMA]);

		const submission = createAgentSubmissionId('profile-submission');
		const profile = await resolveProfile(fixture.agent, submission);
		const repeated = await resolveProfile(fixture.agent, submission);
		assert.deepEqual(repeated, profile);
		assert.equal(fixture.profileResolverCalls.value, 1);
		assert.deepEqual(JSON.parse(profile.data), {
			instructionProfile: COMET_AGENT_INSTRUCTION_PROFILE,
			maximumSteps: 4,
			modelRuntime: 'test.model-runtime',
			settings: { reasoning: 'standard' },
			version: 1,
		});

		const otherSelection = {
			kind: 'user' as const,
			value: { model: 'another-model' },
			configuration: modelConfiguration,
		};
		await assert.rejects(
			fixture.agent.executionProfiles.resolve({
				submission,
				selection: otherSelection,
				selectionDigest: await computeAgentHostPayloadDigest(otherSelection),
				runtimeRegistration,
				sessionConfiguration,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.OperationDigestConflict),
		);

		await assert.rejects(
			fixture.agent.resumeStates.migrate({
				operation: createAgentPackageOperationId('migration-1'),
				backing: { packageId: COMET_AGENT_PACKAGE_ID, agentId: COMET_AGENT_ID, sessionId },
				source: { schema: COMET_AGENT_RESUME_SCHEMA, data: '{}' },
				sourceDigest: createAgentResumeStateDigest(`sha256:${'c'.repeat(64)}`),
				targetSchema: COMET_AGENT_RESUME_SCHEMA,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.CapabilityUnsupported),
		);
	});

	test('resolves the exact Comet Session configuration surface', async t => {
		const fixture = createFixture(t);
		const resolved = await fixture.agent.configuration.resolveSession({
			runtimeRegistration,
			hostDefaults: hostDefaultsConfiguration,
			candidate: sessionConfigurationCandidate,
		});
		assert.equal(resolved.schema, COMET_SESSION_CONFIGURATION_SCHEMA);
		assert.deepEqual(resolved.values, {});
		assert.ok(Object.isFrozen(resolved));
		assert.ok(Object.isFrozen(resolved.values));

		await assert.rejects(
			fixture.agent.configuration.resolveSession({
				runtimeRegistration,
				hostDefaults: hostDefaultsConfiguration,
				candidate: {
					schema: createAgentConfigurationSchemaRevision('comet.session.stale'),
					values: {},
				},
			}),
			error => assertErrorCode(error, AgentHostErrorCode.StaleConfigurationSchema),
		);
	});

	test('retains exact configuration state across Session create and materialize', async t => {
		const fixture = createFixture(t);
		const createdConfiguration = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.created'),
			values: {},
		});
		const createProbe = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.create-probe'),
			values: {},
		});
		const backing = await fixture.agent.sessions.create({
			operation: createAgentHostOperationId('configuration-create-session'),
			payloadDigest: payloadDigest('0'),
			session: sessionId,
			configuration: createdConfiguration,
		});
		const createProbeOperation = createAgentHostOperationId('configuration-create-probe');
		const createProbeDigest = payloadDigest('1');
		await fixture.agent.configuration.prepareSessionUpdate({
			operation: createProbeOperation,
			payloadDigest: createProbeDigest,
			runtimeRegistration,
			session: sessionId,
			current: createdConfiguration,
			candidate: createProbe,
		});
		await fixture.agent.configuration.rollbackSessionUpdate({
			operation: createProbeOperation,
			payloadDigest: createProbeDigest,
			runtimeRegistration,
			session: sessionId,
			configuration: createProbe.revision,
		});

		await fixture.agent.sessions.release({
			operation: createAgentHostOperationId('configuration-release-session'),
			payloadDigest: payloadDigest('2'),
			session: sessionId,
		});
		const materializedConfiguration = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.materialized'),
			values: {},
		});
		assert.ok(backing.resume);
		await fixture.agent.sessions.materialize({
			operation: createAgentHostOperationId('configuration-materialize-session'),
			payloadDigest: payloadDigest('3'),
			session: sessionId,
			configuration: materializedConfiguration,
			resume: backing.resume,
		});
		const materializeProbe = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.materialize-probe'),
			values: {},
		});
		const materializeProbeOperation = createAgentHostOperationId('configuration-materialize-probe');
		const materializeProbeDigest = payloadDigest('4');
		await fixture.agent.configuration.prepareSessionUpdate({
			operation: materializeProbeOperation,
			payloadDigest: materializeProbeDigest,
			runtimeRegistration,
			session: sessionId,
			current: materializedConfiguration,
			candidate: materializeProbe,
		});
		await fixture.agent.configuration.rollbackSessionUpdate({
			operation: materializeProbeOperation,
			payloadDigest: materializeProbeDigest,
			runtimeRegistration,
			session: sessionId,
			configuration: materializeProbe.revision,
		});
	});

	test('commits one prepared Session configuration and rejects rollback afterward', async t => {
		const fixture = createFixture(t);
		const current = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.commit-current'),
			values: {},
		});
		const candidate = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.commit-candidate'),
			values: {},
		});
		await fixture.agent.sessions.create({
			operation: createAgentHostOperationId('configuration-commit-create'),
			payloadDigest: payloadDigest('5'),
			session: sessionId,
			configuration: current,
		});
		const operation = createAgentHostOperationId('configuration-commit');
		const digest = payloadDigest('6');
		await fixture.agent.configuration.prepareSessionUpdate({
			operation,
			payloadDigest: digest,
			runtimeRegistration,
			session: sessionId,
			current,
			candidate,
		});
		const finalize = {
			operation,
			payloadDigest: digest,
			runtimeRegistration,
			session: sessionId,
			configuration: candidate.revision,
		};
		await fixture.agent.configuration.commitSessionUpdate(finalize);
		await fixture.agent.configuration.commitSessionUpdate(finalize);
		await assert.rejects(
			fixture.agent.configuration.rollbackSessionUpdate(finalize),
			error => assertErrorCode(error, AgentHostErrorCode.OperationNotPending),
		);
		await fixture.agent.configuration.acknowledgeSessionUpdate({ ...finalize, decision: 'commit' });

		const probe = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.commit-probe'),
			values: {},
		});
		const probeOperation = createAgentHostOperationId('configuration-commit-probe');
		const probeDigest = payloadDigest('7');
		await fixture.agent.configuration.prepareSessionUpdate({
			operation: probeOperation,
			payloadDigest: probeDigest,
			runtimeRegistration,
			session: sessionId,
			current: candidate,
			candidate: probe,
		});
		const probeFinalization = {
			operation: probeOperation,
			payloadDigest: probeDigest,
			runtimeRegistration,
			session: sessionId,
			configuration: probe.revision,
		};
		await fixture.agent.configuration.rollbackSessionUpdate(probeFinalization);
		await fixture.agent.configuration.acknowledgeSessionUpdate({ ...probeFinalization, decision: 'rollback' });
	});

	test('rolls one prepared Session configuration back and rejects commit afterward', async t => {
		const fixture = createFixture(t);
		const current = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.rollback-current'),
			values: {},
		});
		const candidate = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.rollback-candidate'),
			values: {},
		});
		await fixture.agent.sessions.create({
			operation: createAgentHostOperationId('configuration-rollback-create'),
			payloadDigest: payloadDigest('8'),
			session: sessionId,
			configuration: current,
		});
		const operation = createAgentHostOperationId('configuration-rollback');
		const digest = payloadDigest('9');
		await fixture.agent.configuration.prepareSessionUpdate({
			operation,
			payloadDigest: digest,
			runtimeRegistration,
			session: sessionId,
			current,
			candidate,
		});
		const finalize = {
			operation,
			payloadDigest: digest,
			runtimeRegistration,
			session: sessionId,
			configuration: candidate.revision,
		};
		await fixture.agent.configuration.rollbackSessionUpdate(finalize);
		await fixture.agent.configuration.rollbackSessionUpdate(finalize);
		await assert.rejects(
			fixture.agent.configuration.commitSessionUpdate(finalize),
			error => assertErrorCode(error, AgentHostErrorCode.OperationNotPending),
		);
		await fixture.agent.configuration.acknowledgeSessionUpdate({ ...finalize, decision: 'rollback' });

		const probe = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.rollback-probe'),
			values: {},
		});
		const probeOperation = createAgentHostOperationId('configuration-rollback-probe');
		const probeDigest = payloadDigest('a');
		await fixture.agent.configuration.prepareSessionUpdate({
			operation: probeOperation,
			payloadDigest: probeDigest,
			runtimeRegistration,
			session: sessionId,
			current,
			candidate: probe,
		});
		const probeFinalization = {
			operation: probeOperation,
			payloadDigest: probeDigest,
			runtimeRegistration,
			session: sessionId,
			configuration: probe.revision,
		};
		await fixture.agent.configuration.rollbackSessionUpdate(probeFinalization);
		await fixture.agent.configuration.acknowledgeSessionUpdate({ ...probeFinalization, decision: 'rollback' });
	});

	test('acknowledges an unapplied rollback intent and rejects unknown commit or mismatched finalization', async t => {
		const fixture = createFixture(t);
		await assert.rejects(
			fixture.agent.configuration.commitSessionUpdate({
				operation: createAgentHostOperationId('configuration-finalize-unknown'),
				payloadDigest: payloadDigest('b'),
				runtimeRegistration,
				session: sessionId,
				configuration: sessionConfiguration.revision,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.OperationNotPending),
		);

		await fixture.agent.sessions.create({
			operation: createAgentHostOperationId('configuration-finalize-create'),
			payloadDigest: payloadDigest('c'),
			session: sessionId,
			configuration: sessionConfiguration,
		});
		const candidate = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.finalize-candidate'),
			values: {},
		});
		await fixture.agent.configuration.rollbackSessionUpdate({
			operation: createAgentHostOperationId('configuration-finalize-unapplied-rollback'),
			payloadDigest: payloadDigest('e'),
			runtimeRegistration,
			session: sessionId,
			configuration: candidate.revision,
		});
		const operation = createAgentHostOperationId('configuration-finalize-mismatch');
		const digest = payloadDigest('d');
		await fixture.agent.configuration.prepareSessionUpdate({
			operation,
			payloadDigest: digest,
			runtimeRegistration,
			session: sessionId,
			current: sessionConfiguration,
			candidate,
		});
		await assert.rejects(
			fixture.agent.configuration.commitSessionUpdate({
				operation,
				payloadDigest: digest,
				runtimeRegistration,
				session: sessionId,
				configuration: createAgentConfigurationStateRevision('comet.test.session.wrong-finalize'),
			}),
			error => assertErrorCode(error, AgentHostErrorCode.OperationNotPending),
		);
	});

	test('idempotently acknowledges an already-cleaned configuration terminal record after cold materialization', async t => {
		const source = createFixture(t);
		const backing = await source.agent.sessions.create({
			operation: createAgentHostOperationId('configuration-cold-acknowledgement-create'),
			payloadDigest: payloadDigest('a'),
			session: sessionId,
			configuration: sessionConfiguration,
		});
		assert.ok(backing.resume);
		const restored = createFixture(t);
		await restored.agent.sessions.materialize({
			operation: createAgentHostOperationId('configuration-cold-acknowledgement-materialize'),
			payloadDigest: payloadDigest('b'),
			session: sessionId,
			configuration: sessionConfiguration,
			resume: backing.resume,
		});
		await restored.agent.configuration.acknowledgeSessionUpdate({
			operation: createAgentHostOperationId('configuration-cold-acknowledgement'),
			payloadDigest: payloadDigest('c'),
			runtimeRegistration,
			session: sessionId,
			configuration: createAgentConfigurationStateRevision('comet.test.session.cold-acknowledgement'),
			decision: 'commit',
		});
		const internal = restored.agent as unknown as {
			readonly sessionConfigurationTransactions: ReadonlyMap<unknown, unknown>;
		};
		assert.equal(internal.sessionConfigurationTransactions.size, 0);
	});

	test('pins an unacknowledged Session configuration through retention and reconciles a lost acknowledgement', async t => {
		const fixture = createFixture(t);
		const maximumRetainedOperations = 16_384;
		const churnSession = createAgentSessionId('session-configuration-retention-churn');
		await fixture.agent.sessions.create({
			operation: createAgentHostOperationId('configuration-retention-create'),
			payloadDigest: payloadDigest('f'),
			session: sessionId,
			configuration: sessionConfiguration,
		});
		await fixture.agent.sessions.create({
			operation: createAgentHostOperationId('configuration-retention-churn-create'),
			payloadDigest: payloadDigest('0'),
			session: churnSession,
			configuration: sessionConfiguration,
		});
		const retainedOperation = createAgentHostOperationId('configuration-retention-unacknowledged');
		const retainedDigest = payloadDigest('e');
		const retainedCandidate = validateAndFreezeAgentConfigurationState({
			schema: COMET_SESSION_CONFIGURATION_SCHEMA,
			revision: createAgentConfigurationStateRevision('comet.test.session.retention.unacknowledged'),
			values: {},
		});
		await fixture.agent.configuration.prepareSessionUpdate({
			operation: retainedOperation,
			payloadDigest: retainedDigest,
			runtimeRegistration,
			session: sessionId,
			current: sessionConfiguration,
			candidate: retainedCandidate,
		});
		const retainedFinalization = Object.freeze({
			operation: retainedOperation,
			payloadDigest: retainedDigest,
			runtimeRegistration,
			session: sessionId,
			configuration: retainedCandidate.revision,
		});
		await fixture.agent.configuration.commitSessionUpdate(retainedFinalization);

		let current = sessionConfiguration;
		const churn = async (phase: string): Promise<void> => {
			for (let index = 0; index <= maximumRetainedOperations; index += 1) {
				const operation = createAgentHostOperationId(`configuration-retention-${phase}-${index}`);
				const digest = createAgentHostPayloadDigest(`sha256:${index.toString(16).padStart(64, '0')}`);
				const candidate = validateAndFreezeAgentConfigurationState({
					schema: COMET_SESSION_CONFIGURATION_SCHEMA,
					revision: createAgentConfigurationStateRevision(`comet.test.session.retention.${phase}.${index}`),
					values: {},
				});
				await fixture.agent.configuration.prepareSessionUpdate({
					operation,
					payloadDigest: digest,
					runtimeRegistration,
					session: churnSession,
					current,
					candidate,
				});
				const finalization = Object.freeze({
					operation,
					payloadDigest: digest,
					runtimeRegistration,
					session: churnSession,
					configuration: candidate.revision,
				});
				await fixture.agent.configuration.commitSessionUpdate(finalization);
				await fixture.agent.configuration.acknowledgeSessionUpdate({
					...finalization,
					decision: 'commit',
				});
				current = candidate;
			}
		};
		await churn('before-acknowledgement');

		const internal = fixture.agent as unknown as {
			readonly operations: { readonly records: ReadonlyMap<unknown, unknown> };
			readonly sessionConfigurationTransactions: ReadonlyMap<string, Readonly<Record<string, unknown>>>;
		};
		assert.ok(internal.operations.records.size <= maximumRetainedOperations);
		assert.equal(internal.sessionConfigurationTransactions.size, 1);
		assert.deepEqual(
			Object.keys(internal.sessionConfigurationTransactions.get(retainedOperation) ?? {}).sort(),
			['configuration', 'decision', 'digest', 'session', 'status'],
		);
		await fixture.agent.configuration.commitSessionUpdate(retainedFinalization);
		const acknowledgement = Object.freeze({ ...retainedFinalization, decision: 'commit' as const });
		await fixture.agent.configuration.acknowledgeSessionUpdate(acknowledgement);
		assert.equal(internal.sessionConfigurationTransactions.size, 0);

		await churn('after-acknowledgement');
		await fixture.agent.configuration.acknowledgeSessionUpdate(acknowledgement);
		assert.ok(internal.operations.records.size <= maximumRetainedOperations);
	});

	test('binds the exact resolved model configuration and credential references to each model step', async t => {
		const fixture = createFixture(t, async request => {
			assert.deepEqual(request.modelConfiguration, {
				schema: modelConfigurationSchema.revision,
				values: {
					[COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY]: modelEndpoint,
					[COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY]: providerModel,
					[COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY]: {
						provider: COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
						scope: 'llm',
						reference: credentialReference,
					},
				},
			});
			assert.deepEqual(request.credentials, [{
				provider: COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
				scope: 'llm',
				reference: credentialReference,
			}]);
			assert.equal(request.runtimeRegistration, runtimeRegistration);
			return { stopReason: 'completed', parts: [{ kind: 'text', text: 'configured' }] };
		});
		await createSessionAndChat(fixture.agent);
		await fixture.agent.chats.send(await createTurnRequest(fixture.agent));
		assert.equal(fixture.model.requests.length, 1);
	});

	test('keeps Session and equal-status Chat backing exact across release, materialize, fork, and delete', async t => {
		const fixture = createFixture(t);
		const backing = await createSessionAndChat(fixture.agent);
		const repeatedSession = await fixture.agent.sessions.create({
			operation: createAgentHostOperationId('create-session-1'),
			payloadDigest: payloadDigest('1'),
			session: sessionId,
			configuration: sessionConfiguration,
		});
		assert.deepEqual(repeatedSession, backing.sessionBacking);
		await assert.rejects(
			fixture.agent.sessions.create({
				operation: createAgentHostOperationId('create-session-1'),
				payloadDigest: payloadDigest('f'),
				session: sessionId,
				configuration: sessionConfiguration,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.OperationDigestConflict),
		);
		const repeatedChat = await fixture.agent.chats.create({
			operation: createAgentHostOperationId('create-chat-1'),
			payloadDigest: payloadDigest('2'),
			session: sessionId,
			chat: chatId,
			origin: { kind: 'user' },
		});
		assert.deepEqual(repeatedChat, backing.chatBacking);

		await fixture.agent.chats.send(await createTurnRequest(fixture.agent));
		const forkId = createAgentChatId('chat-fork');
		const forkBacking = await fixture.agent.chats.fork({
			operation: createAgentHostOperationId('fork-chat-1'),
			payloadDigest: payloadDigest('4'),
			session: sessionId,
			chat: forkId,
			source: { chat: chatId, turn: turnId },
		});
		assert.deepEqual(JSON.parse(forkBacking.resume!.data).origin, {
			kind: 'fork',
			parentChat: chatId,
			parentTurn: turnId,
		});

		await fixture.agent.chats.delete({
			operation: createAgentHostOperationId('delete-chat-1'),
			payloadDigest: payloadDigest('5'),
			session: sessionId,
			chat: chatId,
		});
		const replacementId = createAgentChatId('chat-replacement');
		await fixture.agent.chats.create({
			operation: createAgentHostOperationId('create-chat-2'),
			payloadDigest: payloadDigest('6'),
			session: sessionId,
			chat: replacementId,
			origin: { kind: 'user' },
		});

		await fixture.agent.chats.release({
			operation: createAgentHostOperationId('release-fork-1'),
			payloadDigest: payloadDigest('7'),
			session: sessionId,
			chat: forkId,
		});
		await assert.rejects(
			fixture.agent.chats.materialize({
				operation: createAgentHostOperationId('materialize-fork-stale'),
				payloadDigest: payloadDigest('e'),
				session: sessionId,
				chat: forkId,
				resume: { schema: COMET_AGENT_RESUME_SCHEMA, data: '{}' },
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		await fixture.agent.chats.materialize({
			operation: createAgentHostOperationId('materialize-fork-1'),
			payloadDigest: payloadDigest('8'),
			session: sessionId,
			chat: forkId,
			resume: forkBacking.resume,
		});
		await fixture.agent.sessions.release({
			operation: createAgentHostOperationId('release-session-1'),
			payloadDigest: payloadDigest('9'),
			session: sessionId,
		});
		await fixture.agent.sessions.materialize({
			operation: createAgentHostOperationId('materialize-session-1'),
			payloadDigest: payloadDigest('a'),
			session: sessionId,
			configuration: sessionConfiguration,
			resume: backing.sessionBacking.resume,
		});
		await fixture.agent.sessions.delete({
			operation: createAgentHostOperationId('delete-session-1'),
			payloadDigest: payloadDigest('b'),
			session: sessionId,
		});
		await assert.rejects(
			fixture.agent.chats.create({
				operation: createAgentHostOperationId('create-after-delete'),
				payloadDigest: payloadDigest('c'),
				session: sessionId,
				chat: createAgentChatId('chat-after-delete'),
				origin: { kind: 'user' },
			}),
			error => assertErrorCode(error, AgentHostErrorCode.ResourceMissing),
		);
	});

	test('restores exact canonical model history and Turn boundaries from a cold Chat resume', async t => {
		const source = createFixture(t, async () => ({
			stopReason: 'completed',
			parts: [
				{ kind: 'reasoning', text: 'Durable reasoning summary.' },
				{ kind: 'text', text: 'Durable answer.' },
			],
			usage: { inputTokens: 7, outputTokens: 5 },
			checkpoint: { providerTurn: 'cold-resume-1' },
		}));
		const backing = await createSessionAndChat(source.agent);
		await source.agent.chats.send(await createTurnRequest(source.agent));
		const resumeAction = source.actions
			.filter((action): action is Extract<IAgentAction, { kind: 'chatResumeStateChanged' }> => action.kind === 'chatResumeStateChanged')
			.at(-1);
		assert.ok(resumeAction);
		const resumeData = JSON.parse(resumeAction.resume.data);
		assert.equal(resumeData.baseMessageLength, 0);
		assert.deepEqual(resumeData.messages, [
			{ role: 'user', turn: turnId, text: 'Use only the accepted context.' },
			{
				role: 'assistant',
				turn: turnId,
				parts: [
					{ kind: 'reasoning', text: 'Durable reasoning summary.' },
					{ kind: 'text', text: 'Durable answer.' },
				],
			},
		]);
		assert.deepEqual(resumeData.turns, [{
			turn: turnId,
			messageLength: 2,
			checkpoint: { present: true, value: { providerTurn: 'cold-resume-1' } },
		}]);

		const restored = createFixture(t, async request => {
			assert.deepEqual(request.messages, [
				{ role: 'user', turn: turnId, text: 'Use only the accepted context.' },
				{
					role: 'assistant',
					turn: turnId,
					parts: [
						{ kind: 'reasoning', text: 'Durable reasoning summary.' },
						{ kind: 'text', text: 'Durable answer.' },
					],
				},
				{
					role: 'user',
					turn: createAgentTurnId('turn-2'),
					text: 'Use only the accepted context.',
				},
			]);
			assert.deepEqual(request.checkpoint, { providerTurn: 'cold-resume-1' });
			return { stopReason: 'completed', parts: [{ kind: 'text', text: 'Continued.' }] };
		});
		await restored.agent.sessions.materialize({
			operation: createAgentHostOperationId('cold-materialize-session'),
			payloadDigest: payloadDigest('d'),
			session: sessionId,
			configuration: sessionConfiguration,
			resume: backing.sessionBacking.resume,
		});
		const malformedResumeData = structuredClone(resumeData);
		malformedResumeData.turns[0].messageLength = 1;
		await assert.rejects(
			restored.agent.chats.materialize({
				operation: createAgentHostOperationId('cold-materialize-chat-invalid'),
				payloadDigest: payloadDigest('e'),
				session: sessionId,
				chat: chatId,
				resume: {
					schema: COMET_AGENT_RESUME_SCHEMA,
					data: JSON.stringify(malformedResumeData),
				},
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		await restored.agent.chats.materialize({
			operation: createAgentHostOperationId('cold-materialize-chat'),
			payloadDigest: payloadDigest('f'),
			session: sessionId,
			chat: chatId,
			resume: resumeAction.resume,
		});

		const forkId = createAgentChatId('chat-cold-fork');
		const forkBacking = await restored.agent.chats.fork({
			operation: createAgentHostOperationId('cold-fork-chat'),
			payloadDigest: payloadDigest('0'),
			session: sessionId,
			chat: forkId,
			source: { chat: chatId, turn: turnId },
		});
		const forkResumeData = JSON.parse(forkBacking.resume!.data);
		assert.equal(forkResumeData.baseMessageLength, 2);
		assert.deepEqual(forkResumeData.messages, resumeData.messages);
		assert.deepEqual(forkResumeData.turns, []);

		await restored.agent.chats.send(await createTurnRequest(restored.agent, {
			operation: 'send-turn-2',
			digestCharacter: 'a',
			turn: createAgentTurnId('turn-2'),
			submission: createAgentSubmissionId('submission-2'),
		}));
		assert.equal(restored.model.requests.length, 1);
	});

	test('cold-materializes directly encoded legacy Comet history while Host state retains images', async t => {
		const legacySession = createAgentSessionId('legacy-cold');
		const legacyChat = createAgentChatId('legacy-cold');
		const serialized = JSON.stringify({
			version: 3,
			sessions: [{
				conversationId: legacySession,
				createdAt: '2026-01-01T00:00:00.000Z',
				updatedAt: '2026-01-01T00:01:00.000Z',
				sessionTitle: 'Imported',
				chatTitle: 'Imported Chat',
				status: 'completed',
				workspace: { kind: 'workspace-less' },
				modelId: null,
				chatState: {
					input: 'uncommitted composer text',
					errorMessage: null,
					messages: [
						{
							id: 'turn-legacy',
							role: 'user',
							content: 'Legacy question',
							imageAttachments: [{ id: 'legacy-image', name: 'image.png', mimeType: 'image/png', data: 'aA==' }],
							includeInAgentHistory: true,
						},
						{
							id: 'answer-legacy',
							role: 'assistant',
							content: 'Legacy answer',
							imageAttachments: [],
							includeInAgentHistory: true,
							articleList: null,
							result: null,
							patchProposal: null,
						},
					],
				},
			}],
		});
		let catalog: IAgentHostPersistedCatalog | undefined;
		const store: IAgentHostCatalogStore = {
			read: async () => catalog,
			commit: async (expectedRevision, state) => {
				assert.equal(expectedRevision, undefined);
				catalog = state;
			},
		};
		let source: string | undefined = serialized;
		await migrateLegacySessionsCatalog({
			source: {
				read: async () => source,
				delete: async () => {
					source = undefined;
				},
			},
			store,
			companion: createMigrationCompanion(),
			packageId: COMET_AGENT_PACKAGE_ID,
			agentId: COMET_AGENT_ID,
			sessionType: createAgentSessionTypeId('comet.session'),
			resumeSchema: COMET_AGENT_RESUME_SCHEMA,
			agentDefaults: [hostDefaultsConfiguration],
			sessionConfiguration,
		});
		const record = catalog?.sessions[0];
		assert.deepEqual(catalog?.agentDefaults, [hostDefaultsConfiguration]);
		assert.ok(record?.resume);
		assert.deepEqual(record.state.configuration, sessionConfiguration);
		assert.ok(record.chats[0].resume);
		assert.equal(record.chats[0].state.turns[0].user.attachments[0].id, createAgentAttachmentId('legacy-image'));

		const restored = createFixture(t, async request => {
			assert.deepEqual(request.messages, [
				{ role: 'user', turn: createAgentTurnId('turn-legacy'), text: 'Legacy question' },
				{
					role: 'assistant',
					turn: createAgentTurnId('turn-legacy'),
					parts: [{ kind: 'text', text: 'Legacy answer' }],
				},
				{ role: 'user', turn: createAgentTurnId('turn-2'), text: 'Use only the accepted context.' },
			]);
			return { stopReason: 'completed', parts: [{ kind: 'text', text: 'Continued after import.' }] };
		});
		await restored.agent.sessions.materialize({
			operation: createAgentHostOperationId('legacy-materialize-session'),
			payloadDigest: payloadDigest('c'),
			session: legacySession,
			configuration: sessionConfiguration,
			resume: record.resume,
		});
		await restored.agent.chats.materialize({
			operation: createAgentHostOperationId('legacy-materialize-chat'),
			payloadDigest: payloadDigest('d'),
			session: legacySession,
			chat: legacyChat,
			resume: record.chats[0].resume,
		});
		await restored.agent.chats.send(await createTurnRequest(restored.agent, {
			operation: 'legacy-send-turn-2',
			digestCharacter: 'e',
			session: legacySession,
			chat: legacyChat,
			turn: createAgentTurnId('turn-2'),
			submission: createAgentSubmissionId('legacy-submission-2'),
		}));
		assert.equal(restored.model.requests.length, 1);
	});

	test('reconciles one Host operation across exact Session and Chat subeffects', async t => {
		const fixture = createFixture(t);
		const createOperation = createAgentHostOperationId('atomic-create-1');
		const createDigest = payloadDigest('4');
		const secondChatId = createAgentChatId('chat-2');
		await fixture.agent.sessions.create({
			operation: createOperation,
			payloadDigest: createDigest,
			session: sessionId,
			configuration: sessionConfiguration,
		});
		const firstChat = await fixture.agent.chats.create({
			operation: createOperation,
			payloadDigest: createDigest,
			session: sessionId,
			chat: chatId,
			origin: { kind: 'user' },
		});
		const secondChat = await fixture.agent.chats.create({
			operation: createOperation,
			payloadDigest: createDigest,
			session: sessionId,
			chat: secondChatId,
			origin: { kind: 'user' },
		});
		assert.equal(firstChat.chat, chatId);
		assert.equal(secondChat.chat, secondChatId);
		assert.deepEqual(await fixture.agent.chats.create({
			operation: createOperation,
			payloadDigest: createDigest,
			session: sessionId,
			chat: secondChatId,
			origin: { kind: 'user' },
		}), secondChat);
		await assert.rejects(
			fixture.agent.chats.create({
				operation: createOperation,
				payloadDigest: payloadDigest('5'),
				session: sessionId,
				chat: createAgentChatId('chat-conflict'),
				origin: { kind: 'user' },
			}),
			error => assertErrorCode(error, AgentHostErrorCode.OperationDigestConflict),
		);

		const deleteOperation = createAgentHostOperationId('atomic-delete-1');
		const deleteDigest = payloadDigest('6');
		const deleteFirst = {
			operation: deleteOperation,
			payloadDigest: deleteDigest,
			session: sessionId,
			chat: chatId,
		};
		const deleteSecond = { ...deleteFirst, chat: secondChatId };
		await fixture.agent.chats.delete(deleteFirst);
		await fixture.agent.chats.delete(deleteSecond);
		await fixture.agent.sessions.delete({
			operation: deleteOperation,
			payloadDigest: deleteDigest,
			session: sessionId,
		});
		await fixture.agent.chats.delete(deleteFirst);
		await fixture.agent.chats.delete(deleteSecond);
		await fixture.agent.sessions.delete({
			operation: deleteOperation,
			payloadDigest: deleteDigest,
			session: sessionId,
		});
	});

	test('materializes normalized attachments and executes exact canonical Tool calls', async t => {
		let handlerCalls = 0;
		const fixture = createFixture(t, async request => {
			handlerCalls += 1;
			if (request.step === 0) {
				assert.deepEqual(request.attachments.map(attachment => attachment.content?.kind ?? 'none'), [
					'none',
					'inline',
					'materialized',
				]);
				assert.equal(request.attachments[0].attachment.producerType, 'article.metadata');
				assert.equal(request.attachments[0].content, undefined);
				assert.equal(request.attachments[2].content?.kind, 'materialized');
				return {
					stopReason: 'toolCalls',
					parts: [
						{ kind: 'reasoning', text: 'Need the exact target.' },
						{
							kind: 'toolCall',
							call: {
								id: toolCallId,
								registrationId: toolRegistrationId,
								input: { target: targetId },
								target: targetId,
								effect: { kind: 'read' },
							},
						},
					],
					checkpoint: { providerTurn: 'checkpoint-1' },
				};
			}
			assert.deepEqual(fixture.toolExecution.releases, []);
			const lastMessage = request.messages.at(-1);
			assert.equal(lastMessage?.role, 'tool');
			assert.deepEqual(
				lastMessage?.role === 'tool' ? lastMessage.result : undefined,
				{ call: toolCallId, status: 'completed', output: { content: 'exact target content' } },
			);
			return {
				stopReason: 'completed',
				parts: [{ kind: 'text', text: 'Answer from exact target.' }],
				usage: { inputTokens: 12, outputTokens: 6 },
				checkpoint: { providerTurn: 'checkpoint-2' },
			};
		});
		await createSessionAndChat(fixture.agent);
		await fixture.agent.chats.send(await createTurnRequest(fixture.agent, {
			attachments: createAttachments(),
			interactionTargets: [createTarget()],
			toolSet: createToolSet([createToolRegistration()]),
		}));

		assert.equal(handlerCalls, 2);
		assert.equal(fixture.toolExecution.calls.length, 1);
		assert.deepEqual(fixture.toolExecution.releases, [toolCallId]);
		assert.deepEqual(fixture.toolExecution.calls[0], {
			id: toolCallId,
			agent: COMET_AGENT_ID,
			registration: runtimeRegistration,
			session: sessionId,
			chat: chatId,
			turn: turnId,
			toolSet: createAgentToolSetRevision('tool-set-1'),
			tool: toolId,
			descriptor: createAgentToolDescriptorRevision('tool-descriptor.v1'),
			registrationId: toolRegistrationId,
			registrationRevision: createAgentToolRegistrationRevision('tool-registration.v1'),
			input: { target: targetId },
			target: targetId,
			effect: { kind: 'read' },
			deadline: 10_000,
		});
		assert.deepEqual(fixture.contentResources.calls, [
			'open:reference-1',
			'materialize:lease-1',
			'releaseMaterialization:materialization-2',
			'release:lease-1',
		]);
		assert.deepEqual(
			fixture.actions
				.filter((action): action is Extract<IAgentAction, { kind: 'turnProgress' }> => action.kind === 'turnProgress')
				.map(action => {
					return action.progress.kind === 'response'
						? `response:${action.progress.part.kind}`
						: `${action.progress.kind}:${action.progress.state}`;
				}),
			['state:running', 'response:reasoning', 'response:toolCall', 'response:toolResult', 'response:text'],
		);
		const resumeAction = fixture.actions
			.filter((action): action is Extract<IAgentAction, { kind: 'chatResumeStateChanged' }> => action.kind === 'chatResumeStateChanged')
			.at(-1);
		assert.deepEqual(
			resumeAction === undefined ? undefined : JSON.parse(resumeAction.resume.data).usage,
			[{ inputTokens: 12, outputTokens: 6 }],
		);
		const terminal = fixture.actions.at(-1);
		assert.equal(terminal?.kind, 'turnTerminal');
		assert.equal(
			terminal?.kind === 'turnTerminal' ? terminal.state : undefined,
			'completed',
		);
	});

	test('fails unsupported attachment media before content or model side effects', async t => {
		const fixture = createFixture(t);
		await createSessionAndChat(fixture.agent);
		const invalidAttachment: IAgentHostAttachment = {
			envelopeVersion: 1,
			id: createAgentAttachmentId('unsupported-1'),
			producerType: createAgentAttachmentProducerTypeId('binary'),
			display: { label: 'Unsupported' },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.binary.v1'),
				mediaType: 'video/mp4',
				value: { kind: 'binary' },
			},
			metadata: [],
		};
		await fixture.agent.chats.send(await createTurnRequest(fixture.agent, {
			attachments: [invalidAttachment],
		}));
		assert.equal(fixture.model.requests.length, 0);
		assert.deepEqual(fixture.contentResources.calls, []);
		const terminal = fixture.actions.at(-1);
		assert.equal(terminal?.kind, 'turnTerminal');
		assert.equal(terminal?.kind === 'turnTerminal' ? terminal.state : undefined, 'failed');
	});

	test('carries the exact verified tree manifest with one materialized Directory', async () => {
		const contentResources = new TestContentResources();
		const bytes = new TextEncoder().encode('tree file');
		const fileDigest = createAgentContentDigest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
		const entries: readonly AgentContentTreeEntry[] = Object.freeze([{
			kind: 'file',
			path: 'file.txt',
			mediaType: 'text/plain',
			byteLength: bytes.byteLength,
			version: createAgentContentVersion(fileDigest),
			digest: fileDigest,
		}]);
		contentResources.treeEntries = entries;
		const manifestDigest = createAgentContentDigest(
			`sha256:${createHash('sha256').update(encodeAgentHostProtocolValue(entries)).digest('hex')}`,
		);
		const content = {
			kind: 'reference' as const,
			reference: createAgentContentReferenceId('tree-reference-1'),
			owner: { kind: 'host' as const },
			shape: 'tree' as const,
			bounds: {
				byteLength: bytes.byteLength,
				maximumReadLength: bytes.byteLength,
				treeDepth: 1,
				treeEntryCount: 1,
			},
			version: createAgentContentVersion(manifestDigest),
			digest: manifestDigest,
		};
		const prepared = await prepareCometModelAttachments([{
			envelopeVersion: 1,
			id: createAgentAttachmentId('tree-1'),
			producerType: createAgentAttachmentProducerTypeId('files.directory'),
			display: { label: 'Directory' },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.directory.v1'),
				mediaType: 'application/json',
				value: { name: 'Directory' },
			},
			content,
			metadata: [],
		}], modelDescriptor.attachments, {
			session: sessionId,
			chat: chatId,
			turn: turnId,
		}, contentResources, CancellationTokenNone);
		assert.deepEqual(prepared.attachments[0].content, {
			kind: 'materialized',
			content,
			resource: '/host/materialized/lease-1',
			treeEntries: entries,
		});
		await prepared.release();
		assert.deepEqual(contentResources.calls, [
			'open:tree-1',
			'readTreePage:start',
			'materialize:lease-1',
			'releaseMaterialization:materialization-3',
			'release:lease-1',
		]);
	});

	test('releases every opened content lease when attachment materialization fails', async () => {
		const contentResources = new TestContentResources();
		contentResources.failMaterialization = true;
		const referenceAttachment = createAttachments()[2];
		await assert.rejects(
			prepareCometModelAttachments(
				[referenceAttachment],
				modelDescriptor.attachments,
				{ session: sessionId, chat: chatId, turn: turnId },
				contentResources,
				CancellationTokenNone,
			),
			/Materialization failed/,
		);
		assert.deepEqual(contentResources.calls, [
			'open:reference-1',
			'materialize:lease-1',
			'release:lease-1',
		]);
	});

	test('fails an unmapped model Tool call without invoking another registration', async t => {
		const fixture = createFixture(t, async () => ({
			stopReason: 'toolCalls',
			parts: [{
				kind: 'toolCall',
				call: {
					id: toolCallId,
					registrationId: createAgentToolRegistrationId('missing-registration'),
					input: {},
					effect: { kind: 'read' },
				},
			}],
		}));
		await createSessionAndChat(fixture.agent);
		await fixture.agent.chats.send(await createTurnRequest(fixture.agent, {
			toolSet: createToolSet([createToolRegistration()]),
		}));
		assert.equal(fixture.toolExecution.calls.length, 0);
		const terminal = fixture.actions.at(-1);
		assert.equal(terminal?.kind, 'turnTerminal');
		assert.equal(terminal?.kind === 'turnTerminal' ? terminal.state : undefined, 'failed');
	});

	test('preserves typed model error code and data at the Turn boundary', async t => {
		const fixture = createFixture(t, async () => {
			throw new CometModelError(
				'invalidProviderResponse',
				'Provider returned malformed function arguments',
				{ field: 'response.output.0.arguments', value: 'malformed-json' },
			);
		});
		await createSessionAndChat(fixture.agent);
		await fixture.agent.chats.send(await createTurnRequest(fixture.agent));
		const terminal = fixture.actions.at(-1);
		assert.equal(terminal?.kind, 'turnTerminal');
		assert.equal(terminal?.kind === 'turnTerminal' ? terminal.state : undefined, 'failed');
		assert.deepEqual(terminal?.kind === 'turnTerminal' ? terminal.data : undefined, {
			code: 'invalidProviderResponse',
			message: 'Provider returned malformed function arguments',
			data: { field: 'response.output.0.arguments', value: 'malformed-json' },
		});
	});

	test('cancels the exact active Turn without scheduler timing', async t => {
		const started = new DeferredPromise<void>();
		const fixture = createFixture(t, async (_request, token) => {
			started.complete();
			await new Promise<void>((_resolve, reject) => {
				token.onCancellationRequested(() => reject(new CancellationError()));
			});
			throw new Error('Unreachable');
		});
		await createSessionAndChat(fixture.agent);
		const request = await createTurnRequest(fixture.agent);
		const send = fixture.agent.chats.send(request);
		await started.p;
		const cancelRequest = {
			operation: createAgentHostOperationId('cancel-turn-1'),
			payloadDigest: payloadDigest('d'),
			session: sessionId,
			chat: chatId,
			turn: turnId,
		};
		await fixture.agent.chats.cancel(cancelRequest);
		await send;
		await fixture.agent.chats.cancel(cancelRequest);
		const terminal = fixture.actions.at(-1);
		assert.equal(terminal?.kind, 'turnTerminal');
		assert.equal(terminal?.kind === 'turnTerminal' ? terminal.state : undefined, 'cancelled');
		assert.deepEqual(fixture.toolExecution.cancellations, []);
	});
});
