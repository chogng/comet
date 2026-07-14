/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { CancellationError } from 'cs/base/common/errors';
import { Emitter, Event } from 'cs/base/common/event';
import type {
	IAgentAction,
	IAgentAcknowledgeSessionConfigurationUpdateRequest,
	IAgentCancelTurnRequest,
	IAgentChatBacking,
	IAgentChatRequest,
	IAgentCreateChatOptions,
	IAgentCreateSessionOptions,
	IAgentDeleteChatRequest,
	IAgentDeleteSessionRequest,
	IAgentExecutionProfile,
	IAgentExecutionProfileRequest,
	IAgentFinalizeSessionConfigurationUpdateRequest,
	IAgentForkChatRequest,
	IAgentMaterializeChatRequest,
	IAgentMaterializeSessionRequest,
	IAgentPrepareSessionConfigurationUpdateRequest,
	IAgentReleaseChatRequest,
	IAgentReleaseSessionRequest,
	IAgentResolvedSessionConfiguration,
	IAgentResolveSessionConfigurationRequest,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentSessionConfigurationCompletionRequest,
	IAgentSessionBacking,
	IAgentSteerRequest,
} from 'cs/platform/agentHost/common/agent';
import type { IAgentHostAttachment } from 'cs/platform/agentHost/common/attachments';
import {
	AgentConfigurationSchemaProfile,
	type IAgentConfigurationCompletion,
	type IAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type {
	IAgentCredentialReference,
	IAgentCredentialResolutionRequest,
	IAgentCredentialResolver,
} from 'cs/platform/agentHost/common/credentials';
import type {
	AgentRuntimeHostOperation,
	AgentRuntimeConnectionState,
	AgentRuntimeDisconnectReason,
	AgentRuntimeOperationOutcome,
	IAgentRuntimeAction,
	IAgentRuntimeCall,
	IAgentRuntimeConnection,
	IAgentRuntimeHostOperationProgress,
	IAgentRuntimeHostOperationRequest,
	IAgentRuntimeHostOperationResponse,
	IAgentRuntimeInitializeRequest,
	IAgentRuntimeInitializeResult,
	IAgentRuntimeReconnectEvent,
	IAgentRuntimeOperationOutcomeRequest,
	IAgentRuntimeResponse,
	IAgentRuntimeTransportLimits,
} from 'cs/platform/agentHost/common/connections';
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
	AgentChatId,
	AgentContentLeaseId,
	AgentContentMaterializationId,
	AgentSessionId,
	AgentTurnId,
	createAgentCapabilityRevision,
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentCancellationId,
	createAgentChatId,
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentContentDigest,
	createAgentContentLeaseId,
	createAgentContentMaterializationId,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPackageId,
	createAgentPackageOperationId,
	createAgentPackageRevision,
	createAgentResumeStateDigest,
	createAgentResumeSchemaId,
	createAgentRuntimeActionSequence,
	createAgentRuntimeCallId,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
	createAgentRuntimeHostOperationId,
	createAgentRuntimeProtocolVersion,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolSchemaProfileId,
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
import type {
	AgentToolEndpointReconciliation,
	AgentToolResult,
	IAgentToolCall,
	IAgentToolExecutionPort,
	IAgentToolProgress,
} from 'cs/platform/agentHost/common/tools';
import {
	connectAgentRuntime,
	IConnectedAgentRuntime,
	IConnectedAgentRuntimeOptions,
} from 'cs/platform/agentHost/node/runtime/connectedAgentRuntime';
import { ManagedAgentRuntimeConnection } from 'cs/platform/agentHost/common/managedAgentRuntimeConnection';

const connectionId = createAgentRuntimeConnectionId('runtime-connection-1');
const generation = createAgentRuntimeConnectionGeneration(7);
const protocolVersion = createAgentRuntimeProtocolVersion('2');
const packageId = createAgentPackageId('test.runtime');
const packageRevision = createAgentPackageRevision('test.runtime.v1');
const agentId = createAgentId('test.agent');
const descriptorRevision = createAgentDescriptorRevision('test.agent.v1');
const capabilityRevision = createAgentCapabilityRevision('test.capabilities.v1');
const registrationRevision = createAgentRuntimeRegistrationRevision('test.registration.v1');
const modelId = createAgentModelId('test-model');
const modelRevision = createAgentModelDescriptorRevision('test-model.v1');
const hostDefaultsSchemaRevision = createAgentConfigurationSchemaRevision('test.configuration.host.v1');
const sessionConfigurationSchemaRevision = createAgentConfigurationSchemaRevision('test.configuration.session.v1');
const resolvedSessionConfigurationSchemaRevision = createAgentConfigurationSchemaRevision('test.configuration.session.v2');
const modelConfigurationSchemaRevision = createAgentConfigurationSchemaRevision('test.configuration.model.v1');
const configurationProperty = createAgentConfigurationPropertyId('test.agent.mode');
const immutableConfigurationProperty = createAgentConfigurationPropertyId('test.agent.fixed-profile');
const modelConfigurationProperty = createAgentConfigurationPropertyId('test.agent.temperature');
const schemaProfile = createAgentToolSchemaProfileId('test.tools.v1');
const resumeSchema = createAgentResumeSchemaId('test.resume.v1');
const nextResumeSchema = createAgentResumeSchemaId('test.resume.v2');
const sessionId = createAgentSessionId('session-1');
const chatId = createAgentChatId('chat-1');
const turnId = createAgentTurnId('turn-1');
const reverseToolCallId = createAgentToolCallId('runtime-tool-call-1');
const credentialReference: IAgentCredentialReference = Object.freeze({
	provider: 'test.provider',
	scope: 'test.scope',
	reference: 'test.reference',
});
const otherCredentialReference: IAgentCredentialReference = Object.freeze({
	provider: 'test.provider',
	scope: 'test.scope',
	reference: 'test.other-reference',
});
const reverseToolRegistration = Object.freeze({
	id: createAgentToolRegistrationId('runtime-tool-registration-1'),
	revision: createAgentToolRegistrationRevision('runtime-tool-registration-1.v1'),
	descriptor: Object.freeze({
		id: createAgentToolId('runtime.tool.read'),
		revision: createAgentToolDescriptorRevision('runtime.tool.read.v1'),
		contributor: createAgentToolContributorId('runtime.tool.contributor'),
		functionName: 'read_runtime_value',
		displayName: 'Runtime read',
		description: 'Reads one exact runtime value',
		inputSchema: Object.freeze({ profile: schemaProfile, value: null }),
		outputSchema: Object.freeze({ profile: schemaProfile, value: null }),
		safety: 'read' as const,
		confirmation: 'never' as const,
		allowsEditedInput: false,
		targetTypes: Object.freeze([]),
		limits: Object.freeze({
			maximumInputBytes: 1_024,
			maximumOutputBytes: 1_024,
			maximumContentBytes: 1_024,
			timeoutMilliseconds: 1_000,
			maximumConcurrency: 1,
		}),
	}),
	executor: Object.freeze({ kind: 'host' as const, executor: createAgentToolExecutorId('runtime.tool.executor') }),
});

const configurationPropertySchema = Object.freeze({
	id: configurationProperty,
	owner: Object.freeze({ kind: 'agent' as const, agent: agentId }),
	scopes: Object.freeze(['hostDefault', 'session'] as const),
	value: Object.freeze({ type: 'string' as const, enum: Object.freeze(['balanced', 'precise']) }),
	required: true,
	default: 'balanced',
	sessionMutable: true,
	dynamicCompletion: true,
	display: Object.freeze({ label: 'Mode' }),
	persistence: 'persisted' as const,
	redaction: 'public' as const,
});

const immutableConfigurationPropertySchema = Object.freeze({
	id: immutableConfigurationProperty,
	owner: Object.freeze({ kind: 'agent' as const, agent: agentId }),
	scopes: Object.freeze(['hostDefault', 'session'] as const),
	value: Object.freeze({ type: 'string' as const, enum: Object.freeze(['stable', 'changed']) }),
	required: true,
	default: 'stable',
	sessionMutable: false,
	dynamicCompletion: false,
	display: Object.freeze({ label: 'Fixed profile' }),
	persistence: 'persisted' as const,
	redaction: 'public' as const,
});

const hostDefaultsSchema = Object.freeze({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'hostDefault' as const,
	revision: hostDefaultsSchemaRevision,
	properties: Object.freeze([configurationPropertySchema, immutableConfigurationPropertySchema]),
});

const sessionConfigurationSchema = Object.freeze({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'session' as const,
	revision: sessionConfigurationSchemaRevision,
	properties: Object.freeze([configurationPropertySchema, immutableConfigurationPropertySchema]),
});

const resolvedSessionConfigurationSchema = Object.freeze({
	...sessionConfigurationSchema,
	revision: resolvedSessionConfigurationSchemaRevision,
});

const modelConfigurationSchema = Object.freeze({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'model' as const,
	revision: modelConfigurationSchemaRevision,
	properties: Object.freeze([Object.freeze({
		id: modelConfigurationProperty,
		owner: Object.freeze({ kind: 'agent' as const, agent: agentId }),
		scopes: Object.freeze(['model'] as const),
		value: Object.freeze({ type: 'number' as const, integer: false, minimum: 0, maximum: 1 }),
		required: false,
		default: 0.5,
		sessionMutable: false,
		dynamicCompletion: false,
		display: Object.freeze({ label: 'Temperature' }),
		persistence: 'persisted' as const,
		redaction: 'public' as const,
	})]),
});

const hostDefaultsState: IAgentConfigurationState = Object.freeze({
	schema: hostDefaultsSchema,
	revision: createAgentConfigurationStateRevision('test.configuration.host.state.v1'),
	values: Object.freeze({
		[configurationProperty]: 'balanced',
		[immutableConfigurationProperty]: 'stable',
	}),
});

const sessionConfigurationState: IAgentConfigurationState = Object.freeze({
	schema: sessionConfigurationSchema,
	revision: createAgentConfigurationStateRevision('test.configuration.session.state.v1'),
	values: Object.freeze({
		[configurationProperty]: 'precise',
		[immutableConfigurationProperty]: 'stable',
	}),
});

const nextSessionConfigurationState: IAgentConfigurationState = Object.freeze({
	schema: sessionConfigurationSchema,
	revision: createAgentConfigurationStateRevision('test.configuration.session.state.v2'),
	values: Object.freeze({
		[configurationProperty]: 'balanced',
		[immutableConfigurationProperty]: 'stable',
	}),
});

const modelConfiguration = Object.freeze({
	schema: modelConfigurationSchemaRevision,
	values: Object.freeze({ [modelConfigurationProperty]: 0.25 }),
});

const sessionConfigurationCandidate = Object.freeze({
	schema: sessionConfigurationSchemaRevision,
	values: Object.freeze({
		[configurationProperty]: 'precise',
		[immutableConfigurationProperty]: 'stable',
	}),
});

const descriptor = {
	id: agentId,
	packageId,
	revision: descriptorRevision,
	displayName: 'Test Agent',
	description: 'Connected runtime test Agent',
	capabilities: {
		revision: capabilityRevision,
		supportsEmptySession: true,
		supportsCreateChat: true,
		maximumChatCount: 8,
		supportsForkChat: true,
		supportsQueue: true,
		supportsSteering: true,
		supportsCancellation: true,
		supportsReleaseSession: true,
		supportsReleaseChat: true,
		supportsDeleteSession: true,
		supportsDeleteChat: true,
	},
	models: [{
		id: modelId,
		revision: modelRevision,
		displayName: 'Test Model',
		enabled: true,
		configurationSchema: modelConfigurationSchema,
		toolSchemaProfiles: [schemaProfile],
		attachments: {
			carriers: ['inline', 'reference'] as const,
			shapes: ['blob', 'tree'] as const,
			mediaTypes: ['text/plain'],
			maximumCount: 8,
			maximumItemBytes: 1_024,
			maximumTotalBytes: 4_096,
			maximumTreeDepth: 8,
			maximumTreeEntries: 64,
			supportsClientContentForBackgroundExecution: false,
		},
	}],
	requiresAgentAuthentication: false,
} as const;

const registration = {
	packageId,
	agentId,
	revision: registrationRevision,
	descriptorRevision,
	capabilityRevision,
	hostDefaultsSchema,
	initialSessionConfigurationSchema: sessionConfigurationSchemaRevision,
	supportedSessionConfigurationSchemas: [
		sessionConfigurationSchemaRevision,
		resolvedSessionConfigurationSchemaRevision,
	],
	supportedToolSchemaProfiles: [schemaProfile],
	supportedResumeSchemas: [resumeSchema, nextResumeSchema],
	resumeMigrationEdges: [{ sourceSchema: resumeSchema, targetSchema: nextResumeSchema }],
} as const;

const defaultLimits: IAgentRuntimeTransportLimits = {
	maximumRequestBytes: 32 * 1_024,
	maximumResponseBytes: 32 * 1_024,
	maximumActionBytes: 16 * 1_024,
	maximumConcurrentCalls: 4,
};

function exactResponse<TRequest, TValue>(
	call: IAgentRuntimeCall<TRequest>,
	value: TValue,
): IAgentRuntimeResponse<TValue> {
	return {
		connection: call.connection,
		generation: call.generation,
		call: call.call,
		registration: call.registration,
		agent: call.agent,
		value,
	};
}

function assertErrorCode(error: unknown, code: AgentHostErrorCode): boolean {
	assert.ok(error instanceof AgentHostError);
	assert.equal(error.code, code);
	return true;
}

class TestRuntimeConnection implements IAgentRuntimeConnection {
	private readonly disconnectEmitter = new Emitter<Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>>();
	private readonly reconnectEmitter = new Emitter<IAgentRuntimeReconnectEvent>();
	private readonly actionEmitter = new Emitter<IAgentRuntimeAction>();
	private readonly hostOperationEmitter = new Emitter<IAgentRuntimeHostOperationRequest>();
	private stateValue: AgentRuntimeConnectionState;
	private generationValue: ReturnType<typeof createAgentRuntimeConnectionGeneration>;
	readonly connection: ReturnType<typeof createAgentRuntimeConnectionId>;

	constructor(
		runtimeConnection = connectionId,
		runtimeGeneration = generation,
	) {
		this.connection = runtimeConnection;
		this.generationValue = runtimeGeneration;
		this.stateValue = {
			kind: 'connected',
			connection: runtimeConnection,
			generation: runtimeGeneration,
		};
	}
	readonly onDidDisconnect = this.disconnectEmitter.event;
	readonly onDidReconnect = this.reconnectEmitter.event;
	readonly onDidEmitAction = this.actionEmitter.event;
	readonly onDidRequestHostOperation = this.hostOperationEmitter.event;
	readonly hostOperationProgress: IAgentRuntimeHostOperationProgress[] = [];
	readonly hostOperationResponses: IAgentRuntimeHostOperationResponse[] = [];
	readonly initializeRequests: IAgentRuntimeInitializeRequest[] = [];
	readonly resolveSessionConfigurationCalls: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>[] = [];
	readonly completeSessionConfigurationCalls: IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>[] = [];
	readonly prepareSessionConfigurationUpdateCalls: IAgentRuntimeCall<IAgentPrepareSessionConfigurationUpdateRequest>[] = [];
	readonly commitSessionConfigurationUpdateCalls: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>[] = [];
	readonly rollbackSessionConfigurationUpdateCalls: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>[] = [];
	readonly acknowledgeSessionConfigurationUpdateCalls: IAgentRuntimeCall<IAgentAcknowledgeSessionConfigurationUpdateRequest>[] = [];
	readonly resolveExecutionProfileCalls: IAgentRuntimeCall<IAgentExecutionProfileRequest>[] = [];
	readonly migrateResumeStateCalls: IAgentRuntimeCall<IAgentResumeMigrationRequest>[] = [];
	readonly createSessionCalls: IAgentRuntimeCall<IAgentCreateSessionOptions>[] = [];
	readonly materializeSessionCalls: IAgentRuntimeCall<IAgentMaterializeSessionRequest>[] = [];
	readonly releaseSessionCalls: IAgentRuntimeCall<IAgentReleaseSessionRequest>[] = [];
	readonly deleteSessionCalls: IAgentRuntimeCall<IAgentDeleteSessionRequest>[] = [];
	readonly createChatCalls: IAgentRuntimeCall<IAgentCreateChatOptions>[] = [];
	readonly materializeChatCalls: IAgentRuntimeCall<IAgentMaterializeChatRequest>[] = [];
	readonly releaseChatCalls: IAgentRuntimeCall<IAgentReleaseChatRequest>[] = [];
	readonly forkChatCalls: IAgentRuntimeCall<IAgentForkChatRequest>[] = [];
	readonly sendCalls: IAgentRuntimeCall<IAgentChatRequest>[] = [];
	readonly steerCalls: IAgentRuntimeCall<IAgentSteerRequest>[] = [];
	readonly cancelCalls: IAgentRuntimeCall<IAgentCancelTurnRequest>[] = [];
	readonly deleteChatCalls: IAgentRuntimeCall<IAgentDeleteChatRequest>[] = [];
	disposeCount = 0;
	reportHostOperationProgressHandler = async (_progress: IAgentRuntimeHostOperationProgress): Promise<void> => {};
	completeHostOperationHandler = async (_response: IAgentRuntimeHostOperationResponse): Promise<void> => {};

	initializeHandler = async (request: IAgentRuntimeInitializeRequest): Promise<IAgentRuntimeInitializeResult> => ({
		connection: request.connection,
		generation: request.generation,
		call: request.call,
		protocolVersion,
		transportLimits: request.transportLimits,
		registrations: [{ registration, descriptor }],
	});
	resolveSessionConfigurationHandler: (
		request: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>,
	) => Promise<IAgentRuntimeResponse<IAgentResolvedSessionConfiguration>> = request => Promise.resolve(exactResponse(request, {
		schema: sessionConfigurationSchema,
		values: request.request.candidate.values,
	}));
	completeSessionConfigurationHandler: (
		request: IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>,
	) => Promise<IAgentRuntimeResponse<readonly IAgentConfigurationCompletion[]>> = request => Promise.resolve(exactResponse(request, [
		{ label: 'Balanced', value: 'balanced' },
		{ label: 'Precise', value: 'precise' },
	]));
	createSessionHandler: (
		request: IAgentRuntimeCall<IAgentCreateSessionOptions>,
	) => Promise<IAgentRuntimeResponse<IAgentSessionBacking>> = request => Promise.resolve(exactResponse(request, {
		session: request.request.session,
	}));
	materializeSessionHandler: (
		request: IAgentRuntimeCall<IAgentMaterializeSessionRequest>,
	) => Promise<IAgentRuntimeResponse<null>> = request => Promise.resolve(exactResponse(request, null));
	createChatHandler: (
		request: IAgentRuntimeCall<IAgentCreateChatOptions>,
	) => Promise<IAgentRuntimeResponse<IAgentChatBacking>> = request => Promise.resolve(exactResponse(request, {
		session: request.request.session,
		chat: request.request.chat,
	}));
	materializeChatHandler: (
		request: IAgentRuntimeCall<IAgentMaterializeChatRequest>,
	) => Promise<IAgentRuntimeResponse<null>> = request => Promise.resolve(exactResponse(request, null));
	forkChatHandler: (
		request: IAgentRuntimeCall<IAgentForkChatRequest>,
	) => Promise<IAgentRuntimeResponse<IAgentChatBacking>> = request => Promise.resolve(exactResponse(request, {
		session: request.request.session,
		chat: request.request.chat,
	}));
	sendHandler: (
		request: IAgentRuntimeCall<IAgentChatRequest>,
	) => Promise<IAgentRuntimeResponse<null>> = request => {
		this.emitFor(request, 1, {
			kind: 'turnTerminal',
			session: request.request.session,
			chat: request.request.chat,
			turn: request.request.turn,
			state: 'completed',
		});
		return Promise.resolve(exactResponse(request, null));
	};
	cancelHandler: (
		request: IAgentRuntimeCall<IAgentCancelTurnRequest>,
	) => Promise<IAgentRuntimeResponse<null>> = request => Promise.resolve(exactResponse(request, null));

	get state(): AgentRuntimeConnectionState {
		return this.stateValue;
	}

	get generation(): ReturnType<typeof createAgentRuntimeConnectionGeneration> {
		return this.generationValue;
	}

	async initialize(request: IAgentRuntimeInitializeRequest): Promise<IAgentRuntimeInitializeResult> {
		this.initializeRequests.push(request);
		return this.initializeHandler(request);
	}

	async resolveSessionConfiguration(
		request: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>,
	): Promise<IAgentRuntimeResponse<IAgentResolvedSessionConfiguration>> {
		this.resolveSessionConfigurationCalls.push(request);
		return this.resolveSessionConfigurationHandler(request);
	}

	async completeSessionConfiguration(
		request: IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>,
	): Promise<IAgentRuntimeResponse<readonly IAgentConfigurationCompletion[]>> {
		this.completeSessionConfigurationCalls.push(request);
		return this.completeSessionConfigurationHandler(request);
	}

	async prepareSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentPrepareSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.prepareSessionConfigurationUpdateCalls.push(request);
		return exactResponse(request, null);
	}

	async commitSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.commitSessionConfigurationUpdateCalls.push(request);
		return exactResponse(request, null);
	}

	async rollbackSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.rollbackSessionConfigurationUpdateCalls.push(request);
		return exactResponse(request, null);
	}

	async acknowledgeSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentAcknowledgeSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.acknowledgeSessionConfigurationUpdateCalls.push(request);
		return exactResponse(request, null);
	}

	createSession(
		request: IAgentRuntimeCall<IAgentCreateSessionOptions>,
	): Promise<IAgentRuntimeResponse<IAgentSessionBacking>> {
		this.createSessionCalls.push(request);
		return this.createSessionHandler(request);
	}

	async send(request: IAgentRuntimeCall<IAgentChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.sendCalls.push(request);
		return this.sendHandler(request);
	}

	resolveExecutionProfile(
		request: IAgentRuntimeCall<IAgentExecutionProfileRequest>,
	): Promise<IAgentRuntimeResponse<IAgentExecutionProfile>> {
		this.resolveExecutionProfileCalls.push(request);
		return Promise.resolve(exactResponse(request, {
			revision: createAgentExecutionProfileRevision('profile.v1'),
			digest: createAgentExecutionProfileDigest(`sha256:${'b'.repeat(64)}`),
			agentDescriptor: descriptorRevision,
			modelDescriptor: modelRevision,
			data: '{}',
		}));
	}

	migrateResumeState(
		request: IAgentRuntimeCall<IAgentResumeMigrationRequest>,
	): Promise<IAgentRuntimeResponse<IAgentResumeState>> {
		this.migrateResumeStateCalls.push(request);
		return Promise.resolve(exactResponse(request, {
			schema: request.request.targetSchema,
			data: request.request.source.data,
		}));
	}

	materializeSession(
		request: IAgentRuntimeCall<IAgentMaterializeSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.materializeSessionCalls.push(request);
		return this.materializeSessionHandler(request);
	}

	releaseSession(
		request: IAgentRuntimeCall<IAgentReleaseSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.releaseSessionCalls.push(request);
		return Promise.resolve(exactResponse(request, null));
	}

	deleteSession(
		request: IAgentRuntimeCall<IAgentDeleteSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.deleteSessionCalls.push(request);
		return Promise.resolve(exactResponse(request, null));
	}

	createChat(
		request: IAgentRuntimeCall<IAgentCreateChatOptions>,
	): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		this.createChatCalls.push(request);
		return this.createChatHandler(request);
	}

	materializeChat(
		request: IAgentRuntimeCall<IAgentMaterializeChatRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.materializeChatCalls.push(request);
		return this.materializeChatHandler(request);
	}

	releaseChat(
		request: IAgentRuntimeCall<IAgentReleaseChatRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.releaseChatCalls.push(request);
		return Promise.resolve(exactResponse(request, null));
	}

	forkChat(
		request: IAgentRuntimeCall<IAgentForkChatRequest>,
	): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		this.forkChatCalls.push(request);
		return this.forkChatHandler(request);
	}

	steer(request: IAgentRuntimeCall<IAgentSteerRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.steerCalls.push(request);
		return Promise.resolve(exactResponse(request, null));
	}

	cancel(request: IAgentRuntimeCall<IAgentCancelTurnRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.cancelCalls.push(request);
		return this.cancelHandler(request);
	}

	deleteChat(request: IAgentRuntimeCall<IAgentDeleteChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.deleteChatCalls.push(request);
		return Promise.resolve(exactResponse(request, null));
	}

	getOperationOutcome(
		_request: IAgentRuntimeCall<IAgentRuntimeOperationOutcomeRequest>,
	): Promise<IAgentRuntimeResponse<AgentRuntimeOperationOutcome>> {
		return this.unexpected('getOperationOutcome');
	}

	async reportHostOperationProgress(progress: IAgentRuntimeHostOperationProgress): Promise<void> {
		this.hostOperationProgress.push(progress);
		await this.reportHostOperationProgressHandler(progress);
	}

	async completeHostOperation(response: IAgentRuntimeHostOperationResponse): Promise<void> {
		this.hostOperationResponses.push(response);
		await this.completeHostOperationHandler(response);
	}

	emitHostOperation(request: IAgentRuntimeHostOperationRequest): void {
		this.hostOperationEmitter.fire(request);
	}

	emitFor<TRequest>(
		call: IAgentRuntimeCall<TRequest>,
		sequence: number,
		action: IAgentAction,
	): void {
		this.actionEmitter.fire({
			connection: call.connection,
			generation: call.generation,
			sequence: createAgentRuntimeActionSequence(sequence),
			call: call.call,
			registration: call.registration,
			agent: call.agent,
			action,
		});
	}

	disconnect(reason: AgentRuntimeDisconnectReason): void {
		if (this.stateValue.kind === 'disconnected') {
			return;
		}
		const state = {
			kind: 'disconnected' as const,
			connection: this.connection,
			generation: this.generation,
			reason,
		};
		this.stateValue = state;
		this.disconnectEmitter.fire(state);
	}

	reconnect(): void {
		const previousGeneration = this.generationValue;
		this.generationValue = createAgentRuntimeConnectionGeneration(previousGeneration + 1);
		this.stateValue = {
			kind: 'connected',
			connection: this.connection,
			generation: this.generationValue,
		};
		this.reconnectEmitter.fire({
			connection: this.connection,
			previousGeneration,
			generation: this.generationValue,
		});
	}

	dispose(): void {
		this.disposeCount += 1;
		this.disconnect('disposed');
		this.disconnectEmitter.dispose();
		this.reconnectEmitter.dispose();
		this.actionEmitter.dispose();
		this.hostOperationEmitter.dispose();
	}

	private unexpected<T>(method: string): Promise<T> {
		return Promise.reject(new Error(`Unexpected TestRuntimeConnection.${method} call`));
	}
}

class TestRuntimeToolExecution implements IAgentToolExecutionPort {
	readonly calls: IAgentToolCall[] = [];
	readonly cancellations: IAgentToolCall['id'][] = [];
	readonly reconciliations: IAgentToolCall[] = [];
	readonly releases: IAgentToolCall['id'][] = [];
	result: AgentToolResult | undefined;
	progressData: IAgentToolProgress['data'] = { phase: 'running' };
	executeHandler: ((call: IAgentToolCall) => Promise<AgentToolResult>) | undefined;
	cancelHandler: ((call: IAgentToolCall['id']) => Promise<void>) | undefined;

	async execute(call: IAgentToolCall, reportProgress: (progress: IAgentToolProgress) => void): Promise<AgentToolResult> {
		this.calls.push(call);
		reportProgress({ call: call.id, sequence: 1, data: this.progressData });
		if (this.executeHandler !== undefined) {
			return this.executeHandler(call);
		}
		return this.result ?? { call: call.id, status: 'completed', output: null };
	}

	async cancel(call: IAgentToolCall['id']): Promise<void> {
		this.cancellations.push(call);
		await this.cancelHandler?.(call);
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		this.reconciliations.push(call);
		const result = this.result;
		return result === undefined ? { kind: 'unknown' } : { kind: 'terminal', result };
	}

	release(call: IAgentToolCall['id']): void {
		this.releases.push(call);
	}
}

class TestRuntimeCredentialResolver implements IAgentCredentialResolver {
	readonly calls: IAgentCredentialResolutionRequest[] = [];
	readonly tokens: CancellationToken[] = [];
	value = 'resolved-test-secret';
	resolveHandler = async (_request: IAgentCredentialResolutionRequest, _token: CancellationToken): Promise<string> => this.value;

	async resolve(request: IAgentCredentialResolutionRequest, token: CancellationToken): Promise<string> {
		this.calls.push(request);
		this.tokens.push(token);
		return this.resolveHandler(request, token);
	}
}

class TestRuntimeContentResources implements IAgentContentResourcePort {
	readonly opens: IAgentContentResourceOpenRequest[] = [];
	readonly blobReads: IAgentContentBlobReadRequest[] = [];
	readonly blobReadTokens: CancellationToken[] = [];
	readonly releases: string[] = [];
	readonly materializations: string[] = [];
	readonly releasedMaterializations: string[] = [];
	releaseHandler = async (_lease: AgentContentLeaseId): Promise<void> => {};
	releaseMaterializationHandler = async (_materialization: AgentContentMaterializationId): Promise<void> => {};
	blobReadHandler = async (request: IAgentContentBlobReadRequest): Promise<IAgentContentBlobReadResult> => {
		const data = Buffer.from('x'.repeat(request.length)).toString('base64');
		return { offset: request.offset, byteLength: request.length, data, encoding: 'base64', endOfContent: true };
	};

	async open(request: IAgentContentResourceOpenRequest, _token: CancellationToken): Promise<IAgentContentResourceLease> {
		this.opens.push(request);
		return { lease: createAgentContentLeaseId(`lease-${this.opens.length}`), content: request.content };
	}

	async readBlob(request: IAgentContentBlobReadRequest, token: CancellationToken): Promise<IAgentContentBlobReadResult> {
		this.blobReads.push(request);
		this.blobReadTokens.push(token);
		return this.blobReadHandler(request);
	}

	async readTreePage(_request: IAgentContentTreePageRequest, _token: CancellationToken): Promise<IAgentContentTreePage> {
		const entries: readonly AgentContentTreeEntry[] = [];
		return { entries, nextCursor: null };
	}

	async readTreeEntry(request: IAgentContentTreeEntryReadRequest, token: CancellationToken): Promise<IAgentContentBlobReadResult> {
		return this.readBlob(request, token);
	}

	async release(lease: ReturnType<typeof createAgentContentLeaseId>, _token: CancellationToken): Promise<void> {
		this.releases.push(lease);
		await this.releaseHandler(lease);
	}

	async materialize(request: IAgentContentMaterializeRequest, _token: CancellationToken): Promise<IAgentContentMaterialization> {
		this.materializations.push(request.lease);
		return {
			id: createAgentContentMaterializationId(`materialization-${this.materializations.length}`),
			resource: `/host/runtime/${request.lease}`,
		};
	}

	async releaseMaterialization(
		materialization: ReturnType<typeof createAgentContentMaterializationId>,
		_token: CancellationToken,
	): Promise<void> {
		this.releasedMaterializations.push(materialization);
		await this.releaseMaterializationHandler(materialization);
	}
}

function runtimeOptions(
	connection: IAgentRuntimeConnection,
	limits: IAgentRuntimeTransportLimits = defaultLimits,
	toolExecution: IAgentToolExecutionPort = new TestRuntimeToolExecution(),
	contentResources: IAgentContentResourcePort = new TestRuntimeContentResources(),
	credentialResolver: IAgentCredentialResolver = new TestRuntimeCredentialResolver(),
): IConnectedAgentRuntimeOptions {
	return {
		connection,
		toolExecution,
		contentResources,
		credentialResolver,
		protocolVersions: [protocolVersion],
		transportLimits: limits,
		packageId,
		packageRevision,
		authorizedAgents: [agentId],
		implementation: { name: 'Comet test Host', build: 'test-build' },
	};
}

function sessionRequest(index: number): IAgentCreateSessionOptions {
	return {
		operation: createAgentHostOperationId(`create-session-${index}`),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${String(index % 10).repeat(64)}`),
		session: createAgentSessionId(`session-${index}`),
		configuration: sessionConfigurationState,
	};
}

function turnRequest(turn: string): IAgentChatRequest {
	return {
		operation: createAgentHostOperationId(`send-${turn}`),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
		session: sessionId,
		chat: chatId,
		turn: createAgentTurnId(turn),
		submission: createAgentSubmissionId(`submission-${turn}`),
		message: 'Exact request',
		attachments: [],
		interactionTargets: [],
		binding: {
			profile: {
				revision: createAgentExecutionProfileRevision('profile.v1'),
				digest: createAgentExecutionProfileDigest(`sha256:${'b'.repeat(64)}`),
				agentDescriptor: descriptorRevision,
				modelDescriptor: modelRevision,
				data: '{}',
			},
			modelConfiguration,
			credentials: [],
			runtimeRegistration: registrationRevision,
			toolSet: {
				revision: createAgentToolSetRevision('tool-set.v1'),
				schemaProfile,
				runtimeRegistration: registrationRevision,
				agentDescriptor: descriptorRevision,
				modelDescriptor: modelRevision,
				registrations: [],
			},
			deadline: 10_000,
			cancellation: createAgentCancellationId(`cancellation-${turn}`),
			outputConstraints: { format: 'text' },
		},
	};
}

function reverseTurnRequest(turn: string): {
	readonly request: IAgentChatRequest;
	readonly attachment: IAgentHostAttachment;
	readonly toolCall: IAgentToolCall;
} {
	const base = turnRequest(turn);
	const attachment: IAgentHostAttachment = Object.freeze({
		envelopeVersion: 1,
		id: createAgentAttachmentId(`runtime-attachment-${turn}`),
		producerType: createAgentAttachmentProducerTypeId('runtime.file'),
		display: Object.freeze({ label: 'Runtime file' }),
		representation: Object.freeze({
			schema: createAgentAttachmentRepresentationSchemaId('runtime.file.v1'),
			mediaType: 'application/json',
			value: Object.freeze({ name: 'runtime.txt' }),
		}),
		content: Object.freeze({
			kind: 'reference',
			reference: createAgentContentReferenceId(`runtime-content-${turn}`),
			owner: Object.freeze({ kind: 'host' }),
			shape: 'blob',
			mediaType: 'text/plain',
			bounds: Object.freeze({ byteLength: 4, maximumReadLength: 4 }),
			version: createAgentContentVersion(`runtime-content-${turn}.v1`),
			digest: createAgentContentDigest(`sha256:${'c'.repeat(64)}`),
		}),
		metadata: Object.freeze([]),
	});
	const request: IAgentChatRequest = Object.freeze({
		...base,
		attachments: Object.freeze([attachment]),
		binding: Object.freeze({
			...base.binding,
			credentials: Object.freeze([credentialReference]),
			toolSet: Object.freeze({
				...base.binding.toolSet,
				registrations: Object.freeze([reverseToolRegistration]),
			}),
		}),
	});
	const toolCall: IAgentToolCall = Object.freeze({
		id: reverseToolCallId,
		agent: agentId,
		registration: registrationRevision,
		session: request.session,
		chat: request.chat,
		turn: request.turn,
		toolSet: request.binding.toolSet.revision,
		tool: reverseToolRegistration.descriptor.id,
		descriptor: reverseToolRegistration.descriptor.revision,
		registrationId: reverseToolRegistration.id,
		registrationRevision: reverseToolRegistration.revision,
		input: Object.freeze({ key: 'exact' }),
		effect: Object.freeze({ kind: 'read' }),
		deadline: request.binding.deadline,
	});
	return { request, attachment, toolCall };
}

function hostOperation(
	call: IAgentRuntimeCall<IAgentChatRequest>,
	operation: string,
	request: AgentRuntimeHostOperation,
): IAgentRuntimeHostOperationRequest {
	return Object.freeze({
		connection: call.connection,
		generation: call.generation,
		operation: createAgentRuntimeHostOperationId(operation),
		parentCall: call.call,
		registration: call.registration,
		agent: call.agent,
		request,
	});
}

function emitTerminal(
	connection: TestRuntimeConnection,
	parent: IAgentRuntimeCall<{
		readonly session: AgentSessionId;
		readonly chat: AgentChatId;
		readonly turn: AgentTurnId;
	}>,
	sequence = 1,
): void {
	connection.emitFor(parent, sequence, {
		kind: 'turnTerminal',
		session: parent.request.session,
		chat: parent.request.chat,
		turn: parent.request.turn,
		state: 'completed',
	});
}

async function flush(): Promise<void> {
	await new Promise<void>(resolve => setImmediate(resolve));
}

async function connect(
	connection: TestRuntimeConnection,
	limits = defaultLimits,
	toolExecution: IAgentToolExecutionPort = new TestRuntimeToolExecution(),
	contentResources: IAgentContentResourcePort = new TestRuntimeContentResources(),
	credentialResolver: IAgentCredentialResolver = new TestRuntimeCredentialResolver(),
): Promise<IConnectedAgentRuntime> {
	return connectAgentRuntime(runtimeOptions(
		connection,
		limits,
		toolExecution,
		contentResources,
		credentialResolver,
	));
}

suite('ConnectedAgentRuntime', { concurrency: false }, () => {
	test('projects the complete Agent configuration, profile, resume, Session, Chat, and Turn lifecycle', async () => {
		const connection = new TestRuntimeConnection();
		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		const context = (name: string, digit: string) => ({
			operation: createAgentHostOperationId(name),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${digit.repeat(64)}`),
		});
		const resolvedConfiguration = await agent.configuration.resolveSession({
			runtimeRegistration: registrationRevision,
			hostDefaults: hostDefaultsState,
			candidate: sessionConfigurationCandidate,
		});
		assert.deepEqual(resolvedConfiguration, {
			schema: sessionConfigurationSchema,
			values: {
				[configurationProperty]: 'precise',
				[immutableConfigurationProperty]: 'stable',
			},
		});
		const completions = await agent.configuration.completeSession({
			runtimeRegistration: registrationRevision,
			hostDefaults: hostDefaultsState,
			candidate: sessionConfigurationCandidate,
			resolvedSchema: sessionConfigurationSchema,
			property: configurationProperty,
			query: '',
			limit: 2,
		});
		assert.deepEqual(completions, [
			{ label: 'Balanced', value: 'balanced' },
			{ label: 'Precise', value: 'precise' },
		]);
		const commitConfigurationContext = context('configuration-commit', 'e');
		await agent.configuration.prepareSessionUpdate({
			...commitConfigurationContext,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			current: sessionConfigurationState,
			candidate: nextSessionConfigurationState,
		});
		await agent.configuration.commitSessionUpdate({
			...commitConfigurationContext,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
		});
		await agent.configuration.acknowledgeSessionUpdate({
			...commitConfigurationContext,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
			decision: 'commit',
		});
		const rollbackConfigurationContext = context('configuration-rollback', 'f');
		await agent.configuration.prepareSessionUpdate({
			...rollbackConfigurationContext,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			current: sessionConfigurationState,
			candidate: nextSessionConfigurationState,
		});
		await agent.configuration.rollbackSessionUpdate({
			...rollbackConfigurationContext,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
		});
		await agent.configuration.acknowledgeSessionUpdate({
			...rollbackConfigurationContext,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
			decision: 'rollback',
		});

		const profile = await agent.executionProfiles.resolve({
			submission: createAgentSubmissionId('submission-profile'),
			selection: { kind: 'user', value: { model: modelId }, configuration: modelConfiguration },
			selectionDigest: createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`),
			runtimeRegistration: registrationRevision,
			sessionConfiguration: sessionConfigurationState,
		});
		assert.equal(profile.modelDescriptor, modelRevision);

		const migrated = await agent.resumeStates.migrate({
			operation: createAgentPackageOperationId('migrate-resume-1'),
			backing: { packageId, agentId, sessionId },
			source: { schema: resumeSchema, data: '{"cursor":1}' },
			sourceDigest: createAgentResumeStateDigest(`sha256:${'2'.repeat(64)}`),
			targetSchema: nextResumeSchema,
		});
		assert.deepEqual(migrated, { schema: nextResumeSchema, data: '{"cursor":1}' });

		const createdSession = await agent.sessions.create({
			...context('create-session-complete', '3'),
			session: sessionId,
			configuration: sessionConfigurationState,
		});
		assert.deepEqual(createdSession, { session: sessionId });
		await agent.sessions.materialize({
			...context('materialize-session-complete', '4'),
			session: sessionId,
			configuration: sessionConfigurationState,
			resume: { schema: resumeSchema, data: '{}' },
		});

		const createdChat = await agent.chats.create({
			...context('create-chat-complete', '5'),
			session: sessionId,
			chat: chatId,
			origin: { kind: 'user' },
		});
		assert.deepEqual(createdChat, { session: sessionId, chat: chatId });
		await agent.chats.materialize({
			...context('materialize-chat-complete', '6'),
			session: sessionId,
			chat: chatId,
			resume: { schema: resumeSchema, data: '{}' },
		});
		const forkedChatId = createAgentChatId('chat-forked');
		const forked = await agent.chats.fork({
			...context('fork-chat-complete', '7'),
			session: sessionId,
			chat: forkedChatId,
			source: { chat: chatId, turn: turnId },
		});
		assert.deepEqual(forked, { session: sessionId, chat: forkedChatId });

		await agent.chats.send(turnRequest(turnId));
		await agent.chats.steer({
			...context('steer-turn-complete', '8'),
			session: sessionId,
			chat: chatId,
			turn: turnId,
			message: 'Use the exact evidence.',
		});
		await agent.chats.cancel({
			...context('cancel-turn-complete', '9'),
			session: sessionId,
			chat: chatId,
			turn: turnId,
		});
		await agent.chats.release({
			...context('release-chat-complete', 'a'),
			session: sessionId,
			chat: chatId,
		});
		await agent.chats.delete({
			...context('delete-chat-complete', 'b'),
			session: sessionId,
			chat: chatId,
		});
		await agent.sessions.release({
			...context('release-session-complete', 'c'),
			session: sessionId,
		});
		await agent.sessions.delete({
			...context('delete-session-complete', 'd'),
			session: sessionId,
		});

		for (const calls of [
			connection.resolveSessionConfigurationCalls,
			connection.completeSessionConfigurationCalls,
			connection.commitSessionConfigurationUpdateCalls,
			connection.rollbackSessionConfigurationUpdateCalls,
			connection.resolveExecutionProfileCalls,
			connection.migrateResumeStateCalls,
			connection.createSessionCalls,
			connection.materializeSessionCalls,
			connection.createChatCalls,
			connection.materializeChatCalls,
			connection.forkChatCalls,
			connection.sendCalls,
			connection.steerCalls,
			connection.cancelCalls,
			connection.releaseChatCalls,
			connection.deleteChatCalls,
			connection.releaseSessionCalls,
			connection.deleteSessionCalls,
		]) {
			assert.equal(calls.length, 1);
			assert.equal(calls[0].connection, connectionId);
			assert.equal(calls[0].generation, generation);
			assert.equal(calls[0].registration, registrationRevision);
			assert.equal(calls[0].agent, agentId);
		}
		assert.equal(connection.prepareSessionConfigurationUpdateCalls.length, 2);
		for (const call of connection.prepareSessionConfigurationUpdateCalls) {
			assert.equal(call.connection, connectionId);
			assert.equal(call.generation, generation);
			assert.equal(call.registration, registrationRevision);
			assert.equal(call.agent, agentId);
		}
		assert.deepEqual(
			connection.acknowledgeSessionConfigurationUpdateCalls.map(call => call.request.decision),
			['commit', 'rollback'],
		);
		for (const call of connection.acknowledgeSessionConfigurationUpdateCalls) {
			assert.equal(call.connection, connectionId);
			assert.equal(call.generation, generation);
			assert.equal(call.registration, registrationRevision);
			assert.equal(call.agent, agentId);
			assert.equal(call.request.session, sessionId);
			assert.equal(call.request.configuration, nextSessionConfigurationState.revision);
		}

		runtime.dispose();
		assert.equal(connection.disposeCount, 1);
	});

	test('rejects Agent Runtime protocol v1 before initialization', async () => {
		const connection = new TestRuntimeConnection();
		await assert.rejects(
			connectAgentRuntime({
				...runtimeOptions(connection),
				protocolVersions: [createAgentRuntimeProtocolVersion('1')],
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.deepEqual(connection.initializeRequests, []);
		assert.equal(connection.disposeCount, 1);
	});

	test('rejects inconsistent Host, Session, and model configuration registration', async () => {
		const foreignAgent = createAgentId('foreign.agent');
		const cases = [
			{
				name: 'initial Session schema',
				code: AgentHostErrorCode.InvalidProtocolValue,
				registration: {
					...registration,
					initialSessionConfigurationSchema: createAgentConfigurationSchemaRevision('unsupported.session.v1'),
				},
				descriptor,
			},
			{
				name: 'unknown configuration field',
				code: AgentHostErrorCode.InvalidProtocolValue,
				registration: {
					...registration,
					unknownConfigurationField: true,
				},
				descriptor,
			},
			{
				name: 'Host defaults owner',
				code: AgentHostErrorCode.InvalidConfigurationSchema,
				registration: {
					...registration,
					hostDefaultsSchema: { ...hostDefaultsSchema, agent: foreignAgent },
				},
				descriptor,
			},
			{
				name: 'model schema owner',
				code: AgentHostErrorCode.InvalidConfigurationSchema,
				registration,
				descriptor: {
					...descriptor,
					models: [{
						...descriptor.models[0],
						configurationSchema: { ...modelConfigurationSchema, agent: foreignAgent },
					}],
				},
			},
		] as const;

		for (const candidate of cases) {
			const connection = new TestRuntimeConnection();
			connection.initializeHandler = async request => ({
				connection: request.connection,
				generation: request.generation,
				call: request.call,
				protocolVersion,
				transportLimits: request.transportLimits,
				registrations: [{
					registration: candidate.registration,
					descriptor: candidate.descriptor,
				}],
			});

			await assert.rejects(
				connect(connection),
				error => assertErrorCode(error, candidate.code),
				candidate.name,
			);
			assert.equal(connection.disposeCount, 1, candidate.name);
		}
	});

	test('accepts a supported resolved Session schema distinct from the initial candidate schema', async () => {
		const connection = new TestRuntimeConnection();
		connection.resolveSessionConfigurationHandler = request => Promise.resolve(exactResponse(request, {
			schema: resolvedSessionConfigurationSchema,
			values: request.request.candidate.values,
		}));
		const runtime = await connect(connection);

		const resolved = await runtime.agents[0].configuration.resolveSession({
			runtimeRegistration: registrationRevision,
			hostDefaults: hostDefaultsState,
			candidate: sessionConfigurationCandidate,
		});

		assert.equal(resolved.schema.revision, resolvedSessionConfigurationSchemaRevision);
		assert.deepEqual(resolved.values, sessionConfigurationCandidate.values);
		assert.equal(connection.resolveSessionConfigurationCalls.length, 1);
		assert.equal(connection.disposeCount, 0);
		runtime.dispose();
	});

	test('rejects a structurally valid resolved Session schema that was not registered', async () => {
		const connection = new TestRuntimeConnection();
		connection.resolveSessionConfigurationHandler = request => Promise.resolve(exactResponse(request, {
			schema: {
				...sessionConfigurationSchema,
				revision: createAgentConfigurationSchemaRevision('test.configuration.session.unsupported'),
			},
			values: request.request.candidate.values,
		}));
		const runtime = await connect(connection);

		await assert.rejects(
			runtime.agents[0].configuration.resolveSession({
				runtimeRegistration: registrationRevision,
				hostDefaults: hostDefaultsState,
				candidate: sessionConfigurationCandidate,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(connection.resolveSessionConfigurationCalls.length, 1);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('rejects an incomplete resolved Session configuration without skipping required values', async () => {
		const connection = new TestRuntimeConnection();
		connection.resolveSessionConfigurationHandler = request => Promise.resolve(exactResponse(request, {
			schema: sessionConfigurationSchema,
			values: { [configurationProperty]: 'precise' },
		}));
		const runtime = await connect(connection);

		await assert.rejects(
			runtime.agents[0].configuration.resolveSession({
				runtimeRegistration: registrationRevision,
				hostDefaults: hostDefaultsState,
				candidate: sessionConfigurationCandidate,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidConfigurationValue),
		);
		assert.equal(connection.resolveSessionConfigurationCalls.length, 1);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('rejects a Session update that changes an immutable property before runtime side effects', async () => {
		const connection = new TestRuntimeConnection();
		const runtime = await connect(connection);
		const changed = Object.freeze({
			schema: sessionConfigurationSchema,
			revision: createAgentConfigurationStateRevision('test.configuration.session.state.v3'),
			values: Object.freeze({
				[configurationProperty]: 'balanced',
				[immutableConfigurationProperty]: 'changed',
			}),
		});

		await assert.rejects(
			runtime.agents[0].configuration.prepareSessionUpdate({
				operation: createAgentHostOperationId('configuration-immutable'),
				payloadDigest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
				runtimeRegistration: registrationRevision,
				session: sessionId,
				current: sessionConfigurationState,
				candidate: changed,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.deepEqual(connection.prepareSessionConfigurationUpdateCalls, []);
		assert.equal(connection.disposeCount, 0);
		await runtime.agents[0].sessions.create(sessionRequest(11));
		runtime.dispose();
	});

	test('invalidates when completion results exceed the exact requested limit', async () => {
		const connection = new TestRuntimeConnection();
		const runtime = await connect(connection);

		await assert.rejects(
			runtime.agents[0].configuration.completeSession({
				runtimeRegistration: registrationRevision,
				hostDefaults: hostDefaultsState,
				candidate: sessionConfigurationCandidate,
				resolvedSchema: sessionConfigurationSchema,
				property: configurationProperty,
				query: '',
				limit: 1,
			}),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(connection.completeSessionConfigurationCalls.length, 1);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('negotiates one generation and projects the exact runtime-published Agent pair', async () => {
		const connection = new TestRuntimeConnection();
		connection.createSessionHandler = async call => {
			connection.emitFor(call, 1, {
				kind: 'sessionResumeStateChanged',
				session: call.request.session,
				resume: { schema: resumeSchema, data: '{"cursor":1}' },
			});
			return exactResponse(call, {
				session: call.request.session,
				resume: { schema: resumeSchema, data: '{"cursor":1}' },
			});
		};
		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		const actions: IAgentAction[] = [];
		const listener = agent.onDidEmitAction(action => actions.push(action));

		assert.equal(runtime.protocolVersion, protocolVersion);
		assert.deepEqual(runtime.transportLimits, defaultLimits);
		assert.equal(agent.id, agentId);
		assert.deepEqual(agent.descriptor.get(), descriptor);
		assert.deepEqual(agent.registration, registration);
		assert.ok(Object.isFrozen(agent.descriptor.get()));
		assert.ok(Object.isFrozen(agent.registration));
		assert.deepEqual(connection.initializeRequests, [{
			connection: connectionId,
			generation,
			call: createAgentRuntimeCallId('runtime-call-1'),
			protocolVersions: [protocolVersion],
			transportLimits: defaultLimits,
			packageId,
			packageRevision,
			authorizedAgents: [agentId],
			implementation: { name: 'Comet test Host', build: 'test-build' },
		}]);

		const request = sessionRequest(1);
		const backing = await agent.sessions.create(request);
		assert.deepEqual(backing, {
			session: request.session,
			resume: { schema: resumeSchema, data: '{"cursor":1}' },
		});
		assert.equal(connection.createSessionCalls[0].generation, generation);
		assert.equal(connection.createSessionCalls[0].call, createAgentRuntimeCallId('runtime-call-2'));
		assert.equal(connection.createSessionCalls[0].registration, registrationRevision);
		assert.equal(connection.createSessionCalls[0].agent, agentId);
		assert.deepEqual(connection.createSessionCalls[0].request, request);
		assert.deepEqual(actions, [{
			kind: 'sessionResumeStateChanged',
			session: request.session,
			resume: { schema: resumeSchema, data: '{"cursor":1}' },
		}]);

		listener.dispose();
		runtime.dispose();
		assert.equal(connection.disposeCount, 1);
	});

	test('rejects a successful chat.send response that arrives before its exact terminal action', async () => {
		const connection = new TestRuntimeConnection();
		connection.sendHandler = async call => exactResponse(call, null);
		const runtime = await connect(connection);

		await assert.rejects(
			runtime.agents[0].chats.send(turnRequest('missing-terminal')),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('accepts the exact Turn terminal from its concurrent chat.cancel call', async () => {
		const connection = new TestRuntimeConnection();
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		const pendingCancel = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		connection.cancelHandler = () => pendingCancel.p;
		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		const request = turnRequest('cancel-terminal');
		const send = agent.chats.send(request);
		const cancel = agent.chats.cancel({
			operation: createAgentHostOperationId('cancel-terminal-operation'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'d'.repeat(64)}`),
			session: request.session,
			chat: request.chat,
			turn: request.turn,
		});
		const cancelCall = connection.cancelCalls[0];
		emitTerminal(connection, cancelCall);

		pendingCancel.complete(exactResponse(cancelCall, null));
		await cancel;
		const sendCall = connection.sendCalls[0];
		pendingSend.complete(exactResponse(sendCall, null));
		await send;
		assert.equal(connection.disposeCount, 0);
		runtime.dispose();
	});

	test('resolves an authorized credential for only its exact active parent Turn', async () => {
		const connection = new TestRuntimeConnection();
		const credentialResolver = new TestRuntimeCredentialResolver();
		const runtime = await connect(
			connection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			new TestRuntimeContentResources(),
			credentialResolver,
		);
		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pending.p;
		const reverse = reverseTurnRequest('credential-success');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		const operation = hostOperation(parent, 'runtime-host-credential-success', {
			kind: 'credential.resolve',
			credential: credentialReference,
		});

		connection.emitHostOperation(operation);
		await flush();

		assert.deepEqual(credentialResolver.calls, [{
			packageId,
			agentId,
			runtimeRegistration: registrationRevision,
			session: reverse.request.session,
			chat: reverse.request.chat,
			turn: reverse.request.turn,
			credential: credentialReference,
		}]);
		assert.equal(Object.isFrozen(credentialResolver.calls[0]), true);
		assert.equal(Object.isFrozen(credentialResolver.calls[0].credential), true);
		assert.notStrictEqual(credentialResolver.calls[0].credential, credentialReference);
		assert.equal(credentialResolver.tokens.length, 1);
		assert.equal(credentialResolver.tokens[0].isCancellationRequested, false);
		assert.deepEqual(connection.hostOperationResponses, [{
			connection: connectionId,
			generation,
			operation: operation.operation,
			parentCall: parent.call,
			registration: registrationRevision,
			agent: agentId,
			outcome: { kind: 'completed', value: credentialResolver.value },
		}]);
		connection.emitHostOperation(operation);
		await flush();
		assert.equal(credentialResolver.calls.length, 1);
		assert.equal(connection.hostOperationResponses.length, 2);
		assert.strictEqual(connection.hostOperationResponses[1], connection.hostOperationResponses[0]);

		emitTerminal(connection, parent);
		pending.complete(exactResponse(parent, null));
		await send;
		assert.equal(credentialResolver.tokens[0].isCancellationRequested, false);
		runtime.dispose();
	});

	test('rejects credential resolution from a retired Turn before resolver side effects', async () => {
		const connection = new TestRuntimeConnection();
		const credentialResolver = new TestRuntimeCredentialResolver();
		const runtime = await connect(
			connection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			new TestRuntimeContentResources(),
			credentialResolver,
		);
		const retiredRequest = reverseTurnRequest('credential-retired').request;
		await runtime.agents[0].chats.send(retiredRequest);
		const retiredParent = connection.sendCalls[0];
		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pending.p;
		const activeSend = runtime.agents[0].chats.send(reverseTurnRequest('credential-active').request);

		connection.emitHostOperation(hostOperation(retiredParent, 'runtime-host-credential-retired', {
			kind: 'credential.resolve',
			credential: credentialReference,
		}));

		await assert.rejects(activeSend, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(credentialResolver.calls, []);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('rejects unbound and cross-registration credential resolution before resolver side effects', async () => {
		for (const kind of ['reference', 'registration'] as const) {
			const connection = new TestRuntimeConnection();
			const credentialResolver = new TestRuntimeCredentialResolver();
			const runtime = await connect(
				connection,
				defaultLimits,
				new TestRuntimeToolExecution(),
				new TestRuntimeContentResources(),
				credentialResolver,
			);
			const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
			connection.sendHandler = () => pending.p;
			const reverse = reverseTurnRequest(`credential-invalid-${kind}`);
			const send = runtime.agents[0].chats.send(reverse.request);
			const parent = connection.sendCalls[0];
			const operation = hostOperation(parent, `runtime-host-credential-invalid-${kind}`, {
				kind: 'credential.resolve',
				credential: kind === 'reference' ? otherCredentialReference : credentialReference,
			});
			connection.emitHostOperation(kind === 'registration'
				? {
					...operation,
					registration: createAgentRuntimeRegistrationRevision('test.registration.other'),
				}
				: operation);

			await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
			assert.deepEqual(credentialResolver.calls, [], kind);
			assert.equal(connection.hostOperationResponses.length, 0, kind);
			assert.equal(connection.disposeCount, 1, kind);
			runtime.dispose();
		}
	});

	test('rejects unknown credential operation fields before resolver side effects', async () => {
		const invalidRequests = [
			{
				kind: 'credential.resolve',
				credential: credentialReference,
				unknownOperationField: true,
			},
			{
				kind: 'credential.resolve',
				credential: {
					...credentialReference,
					unknownCredentialField: true,
				},
			},
		] as const;

		for (const [index, invalidRequest] of invalidRequests.entries()) {
			const connection = new TestRuntimeConnection();
			const credentialResolver = new TestRuntimeCredentialResolver();
			const runtime = await connect(
				connection,
				defaultLimits,
				new TestRuntimeToolExecution(),
				new TestRuntimeContentResources(),
				credentialResolver,
			);
			const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
			connection.sendHandler = () => pending.p;
			const reverse = reverseTurnRequest(`credential-fields-${index}`);
			const send = runtime.agents[0].chats.send(reverse.request);
			connection.emitHostOperation(hostOperation(
				connection.sendCalls[0],
				`runtime-host-credential-fields-${index}`,
				invalidRequest as unknown as AgentRuntimeHostOperation,
			));

			await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
			assert.deepEqual(credentialResolver.calls, []);
			assert.equal(connection.hostOperationResponses.length, 0);
			assert.equal(connection.disposeCount, 1);
			runtime.dispose();
		}
	});

	test('rejects malformed or duplicate Turn credential bindings before runtime transport', async () => {
		const credentialBindings = [
			Object.freeze([
				credentialReference,
				credentialReference,
			]),
			Object.freeze([{
				...credentialReference,
				unknownCredentialField: true,
			}]),
		] as const;

		for (const [index, credentials] of credentialBindings.entries()) {
			const connection = new TestRuntimeConnection();
			const runtime = await connect(connection);
			const reverse = reverseTurnRequest(`credential-binding-${index}`);
			const request = {
				...reverse.request,
				binding: {
					...reverse.request.binding,
					credentials,
				},
			} as IAgentChatRequest;

			await assert.rejects(
				runtime.agents[0].chats.send(request),
				error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
			);
			assert.deepEqual(connection.sendCalls, []);
			assert.equal(connection.disposeCount, 0);
			runtime.dispose();
		}
	});

	test('sanitizes credential resolver failures before reverse diagnostics', async () => {
		const diagnosticSecret = 'resolver-diagnostic-secret';
		const connection = new TestRuntimeConnection();
		const credentialResolver = new TestRuntimeCredentialResolver();
		credentialResolver.resolveHandler = async () => {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				diagnosticSecret,
				{ field: diagnosticSecret, value: diagnosticSecret },
			);
		};
		const runtime = await connect(
			connection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			new TestRuntimeContentResources(),
			credentialResolver,
		);
		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pending.p;
		const reverse = reverseTurnRequest('credential-failure');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-credential-failure', {
			kind: 'credential.resolve',
			credential: credentialReference,
		}));
		await flush();

		assert.equal(connection.hostOperationResponses.length, 1);
		assert.deepEqual(connection.hostOperationResponses[0].outcome, {
			kind: 'failed',
			code: AgentHostErrorCode.ResourceMissing,
			message: 'Agent credential resolution failed',
			data: { resource: 'agentCredential' },
		});
		assert.equal(JSON.stringify(connection.hostOperationResponses[0]).includes(diagnosticSecret), false);

		emitTerminal(connection, parent);
		pending.complete(exactResponse(parent, null));
		await send;
		runtime.dispose();
	});

	test('does not copy resolved credentials into transport-failure diagnostics', async () => {
		const connection = new TestRuntimeConnection();
		const credentialResolver = new TestRuntimeCredentialResolver();
		connection.completeHostOperationHandler = async () => {
			throw new Error(`credential transport rejected: ${credentialResolver.value}`);
		};
		const runtime = await connect(
			connection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			new TestRuntimeContentResources(),
			credentialResolver,
		);
		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pending.p;
		const reverse = reverseTurnRequest('credential-transport-failure');
		const send = runtime.agents[0].chats.send(reverse.request);
		connection.emitHostOperation(hostOperation(
			connection.sendCalls[0],
			'runtime-host-credential-transport-failure',
			{ kind: 'credential.resolve', credential: credentialReference },
		));

		await assert.rejects(send, error => {
			assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue);
			assert.ok(error instanceof AgentHostError);
			assert.equal(JSON.stringify({ message: error.message, data: error.data }).includes(credentialResolver.value), false);
			return true;
		});
		assert.equal(connection.hostOperationResponses.length, 1);
		assert.deepEqual(connection.hostOperationResponses[0].outcome, {
			kind: 'completed',
			value: credentialResolver.value,
		});
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('rejects an oversized resolved credential before reverse response transport', async () => {
		const connection = new TestRuntimeConnection();
		const credentialResolver = new TestRuntimeCredentialResolver();
		credentialResolver.value = `credential-${'s'.repeat(4_096)}`;
		const limits: IAgentRuntimeTransportLimits = {
			...defaultLimits,
			maximumResponseBytes: 3_500,
		};
		const runtime = await connect(
			connection,
			limits,
			new TestRuntimeToolExecution(),
			new TestRuntimeContentResources(),
			credentialResolver,
		);
		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pending.p;
		const reverse = reverseTurnRequest('credential-response-bound');
		const send = runtime.agents[0].chats.send(reverse.request);
		connection.emitHostOperation(hostOperation(
			connection.sendCalls[0],
			'runtime-host-credential-response-bound',
			{ kind: 'credential.resolve', credential: credentialReference },
		));

		await assert.rejects(send, error => {
			assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue);
			assert.ok(error instanceof AgentHostError);
			assert.equal(JSON.stringify({ message: error.message, data: error.data }).includes(credentialResolver.value), false);
			return true;
		});
		assert.deepEqual(connection.hostOperationResponses, []);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('retires pending credential resolution after terminal, cancel, release, or disconnect', async () => {
		for (const trigger of ['terminal', 'cancel', 'releaseChat', 'releaseSession', 'disconnect'] as const) {
			const connection = new TestRuntimeConnection();
			const credentialResolver = new TestRuntimeCredentialResolver();
			const lateSecret = new DeferredPromise<string>();
			credentialResolver.resolveHandler = () => lateSecret.p;
			const runtime = await connect(
				connection,
				defaultLimits,
				new TestRuntimeToolExecution(),
				new TestRuntimeContentResources(),
				credentialResolver,
			);
			const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
			connection.sendHandler = () => pending.p;
			const reverse = reverseTurnRequest(`credential-cancel-${trigger}`);
			const send = runtime.agents[0].chats.send(reverse.request);
			const sendCompletion = send.then(
				() => ({ kind: 'completed' } as const),
				error => ({ kind: 'failed', error } as const),
			);
			const parent = connection.sendCalls[0];
			connection.emitHostOperation(hostOperation(parent, `runtime-host-credential-cancel-${trigger}`, {
				kind: 'credential.resolve',
				credential: credentialReference,
			}));
			await flush();

			assert.equal(credentialResolver.tokens.length, 1, trigger);
			assert.equal(credentialResolver.tokens[0].isCancellationRequested, false, trigger);
			const lifecycleContext = {
				operation: createAgentHostOperationId(`credential-cancel-${trigger}`),
				payloadDigest: createAgentHostPayloadDigest(`sha256:${'e'.repeat(64)}`),
			};
			switch (trigger) {
				case 'terminal':
					emitTerminal(connection, parent);
					break;
				case 'cancel':
					await runtime.agents[0].chats.cancel({
						...lifecycleContext,
						session: reverse.request.session,
						chat: reverse.request.chat,
						turn: reverse.request.turn,
					});
					break;
				case 'releaseChat':
					await runtime.agents[0].chats.release({
						...lifecycleContext,
						session: reverse.request.session,
						chat: reverse.request.chat,
					});
					break;
				case 'releaseSession':
					await runtime.agents[0].sessions.release({
						...lifecycleContext,
						session: reverse.request.session,
					});
					break;
				case 'disconnect':
					connection.disconnect('processExited');
					break;
			}

			assert.equal(credentialResolver.tokens[0].isCancellationRequested, true, trigger);
			lateSecret.complete(credentialResolver.value);
			await flush();
			assert.equal(
				connection.hostOperationResponses.some(response =>
					response.outcome.kind === 'completed' && response.outcome.value === credentialResolver.value
				),
				false,
				trigger,
			);
			if (trigger === 'disconnect') {
				const completion = await sendCompletion;
				assert.equal(completion.kind, 'failed');
				assertErrorCode(completion.error, AgentHostErrorCode.ResourceMissing);
			} else {
				if (trigger !== 'terminal') {
					emitTerminal(connection, parent);
				}
				pending.complete(exactResponse(parent, null));
				assert.deepEqual(await sendCompletion, { kind: 'completed' });
			}
			runtime.dispose();
		}
	});

	test('cancels and retires an exact pending Tool child when its terminal parent responds', async () => {
		const connection = new TestRuntimeConnection();
		const toolExecution = new TestRuntimeToolExecution();
		const pendingTool = new DeferredPromise<AgentToolResult>();
		const pendingCancellation = new DeferredPromise<void>();
		toolExecution.executeHandler = () => pendingTool.p;
		toolExecution.cancelHandler = call => {
			pendingTool.complete({ call, status: 'completed', output: null });
			return pendingCancellation.p;
		};
		const runtime = await connect(connection, defaultLimits, toolExecution);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('pending-tool-parent');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-pending-tool', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		}));
		await flush();
		emitTerminal(connection, parent);

		pendingSend.complete(exactResponse(parent, null));
		await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(toolExecution.cancellations, [reverse.toolCall.id]);
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		pendingCancellation.complete();
	});

	test('waits only for exact Tool execution terminal while abandoning an unsettled cancel acknowledgement', async () => {
		const connection = new TestRuntimeConnection();
		const toolExecution = new TestRuntimeToolExecution();
		const pendingTool = new DeferredPromise<AgentToolResult>();
		const pendingCancellation = new DeferredPromise<void>();
		toolExecution.executeHandler = () => pendingTool.p;
		toolExecution.cancelHandler = () => pendingCancellation.p;
		const runtime = await connect(connection, defaultLimits, toolExecution);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('pending-cancel-ack');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-pending-cancel-execute', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		}));
		await flush();
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-pending-cancel-ack', {
			kind: 'tool.cancel',
			call: reverse.toolCall,
		}));
		await flush();
		emitTerminal(connection, parent);
		pendingSend.complete(exactResponse(parent, null));
		await flush();
		assert.deepEqual(toolExecution.releases, []);
		assert.deepEqual(toolExecution.cancellations, [reverse.toolCall.id]);

		pendingTool.complete({ call: reverse.toolCall.id, status: 'completed', output: null });
		await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		runtime.dispose();
		pendingCancellation.complete(undefined);
	});

	test('rejects and retires when the parent response races a reverse response delivery rejection', async () => {
		const connection = new TestRuntimeConnection();
		const responseDelivery = new DeferredPromise<void>();
		connection.completeHostOperationHandler = () => responseDelivery.p;
		const toolExecution = new TestRuntimeToolExecution();
		const runtime = await connect(connection, defaultLimits, toolExecution);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('response-delivery-race');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-response-delivery-race', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		}));
		await flush();
		assert.equal(connection.hostOperationResponses.length, 1);
		emitTerminal(connection, parent);

		pendingSend.complete(exactResponse(parent, null));
		responseDelivery.error(new Error('reverse response delivery rejected'));
		await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
	});

	test('abandons an unsettled reverse response delivery after exact Tool execution terminates', async () => {
		const connection = new TestRuntimeConnection();
		const responseDelivery = new DeferredPromise<void>();
		connection.completeHostOperationHandler = () => responseDelivery.p;
		const toolExecution = new TestRuntimeToolExecution();
		const runtime = await connect(connection, defaultLimits, toolExecution);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('unsettled-response-delivery');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-unsettled-response-delivery', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		}));
		await flush();
		assert.equal(connection.hostOperationResponses.length, 1);
		emitTerminal(connection, parent);

		pendingSend.complete(exactResponse(parent, null));
		await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
	});

	test('cancels and cleans an exact pending content child when its terminal parent responds', async () => {
		const connection = new TestRuntimeConnection();
		const contentResources = new TestRuntimeContentResources();
		const runtime = await connect(
			connection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			contentResources,
		);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('pending-content-parent');
		const content = reverse.attachment.content;
		assert.ok(content?.kind === 'reference');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		const lease = createAgentContentLeaseId('lease-1');
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-pending-content-open', {
			kind: 'content.open',
			request: {
				session: reverse.request.session,
				chat: reverse.request.chat,
				turn: reverse.request.turn,
				attachment: reverse.attachment.id,
				content,
			},
		}));
		await flush();

		const pendingRead = new DeferredPromise<IAgentContentBlobReadResult>();
		contentResources.blobReadHandler = () => pendingRead.p;
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-pending-content-read', {
			kind: 'content.readBlob',
			request: { lease, offset: 0, length: 4 },
		}));
		await flush();
		const readCancellation = contentResources.blobReadTokens[0].onCancellationRequested(() => {
			pendingRead.error(new CancellationError());
		});
		emitTerminal(connection, parent);

		pendingSend.complete(exactResponse(parent, null));
		await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		readCancellation.dispose();
		assert.equal(contentResources.blobReadTokens[0].isCancellationRequested, true);
		assert.deepEqual(contentResources.releases, [lease]);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
		assert.deepEqual(contentResources.releases, [lease]);
	});

	test('fails the exact parent after attempting every owned content release once', async () => {
		const connection = new TestRuntimeConnection();
		const contentResources = new TestRuntimeContentResources();
		const runtime = await connect(
			connection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			contentResources,
		);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('content-release-failure');
		const content = reverse.attachment.content;
		assert.ok(content?.kind === 'reference');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		const lease = createAgentContentLeaseId('lease-1');
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-release-failure-open', {
			kind: 'content.open',
			request: {
				session: reverse.request.session,
				chat: reverse.request.chat,
				turn: reverse.request.turn,
				attachment: reverse.attachment.id,
				content,
			},
		}));
		await flush();
		const materialization = createAgentContentMaterializationId('materialization-1');
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-release-failure-materialize', {
			kind: 'content.materialize',
			request: { lease },
		}));
		await flush();
		contentResources.releaseHandler = async () => {
			throw new Error('lease release failed');
		};
		contentResources.releaseMaterializationHandler = async () => {
			throw new Error('materialization release failed');
		};
		emitTerminal(connection, parent);

		pendingSend.complete(exactResponse(parent, null));
		await assert.rejects(send, error => error instanceof AggregateError);
		assert.deepEqual(contentResources.releasedMaterializations, [materialization]);
		assert.deepEqual(contentResources.releases, [lease]);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
		await flush();
		assert.deepEqual(contentResources.releasedMaterializations, [materialization]);
		assert.deepEqual(contentResources.releases, [lease]);
	});

	test('rejects an oversized reverse Tool progress envelope before transport', async () => {
		const connection = new TestRuntimeConnection();
		const toolExecution = new TestRuntimeToolExecution();
		toolExecution.progressData = { text: 'x'.repeat(4_096) };
		const limits: IAgentRuntimeTransportLimits = {
			...defaultLimits,
			maximumActionBytes: 512,
		};
		const runtime = await connect(connection, limits, toolExecution);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('oversized-progress');
		const send = runtime.agents[0].chats.send(reverse.request);
		connection.emitHostOperation(hostOperation(connection.sendCalls[0], 'runtime-host-oversized-progress', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		}));

		await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(connection.hostOperationProgress, []);
		assert.deepEqual(toolExecution.cancellations, [reverse.toolCall.id]);
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('immediately cancels and invalidates when reverse Tool progress transport rejects', async () => {
		const connection = new TestRuntimeConnection();
		connection.reportHostOperationProgressHandler = async () => {
			throw new Error('progress transport rejected');
		};
		const toolExecution = new TestRuntimeToolExecution();
		const pendingTool = new DeferredPromise<AgentToolResult>();
		toolExecution.executeHandler = () => pendingTool.p;
		toolExecution.cancelHandler = async call => {
			pendingTool.complete({ call, status: 'completed', output: null });
		};
		const runtime = await connect(connection, defaultLimits, toolExecution);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('rejected-progress');
		const send = runtime.agents[0].chats.send(reverse.request);
		connection.emitHostOperation(hostOperation(connection.sendCalls[0], 'runtime-host-rejected-progress', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		}));

		await assert.rejects(send, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.equal(connection.hostOperationProgress.length, 1);
		assert.deepEqual(toolExecution.cancellations, [reverse.toolCall.id]);
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		assert.equal(connection.disposeCount, 1);
		runtime.dispose();
	});

	test('routes exact reverse Tool operations and retires reconciliation state with the parent Turn', async () => {
		const connection = new TestRuntimeConnection();
		const toolExecution = new TestRuntimeToolExecution();
		const contentResources = new TestRuntimeContentResources();
		const runtime = await connect(connection, defaultLimits, toolExecution, contentResources);
		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pending.p;
		const reverse = reverseTurnRequest('reverse-tool');
		const expectedResult: AgentToolResult = Object.freeze({
			call: reverse.toolCall.id,
			status: 'completed',
			output: Object.freeze({ value: 'exact' }),
		});
		toolExecution.result = expectedResult;
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		const execute = hostOperation(parent, 'runtime-host-tool-execute', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		});

		connection.emitHostOperation(execute);
		await flush();
		assert.deepEqual(toolExecution.calls, [reverse.toolCall]);
		assert.deepEqual(connection.hostOperationProgress, [{
			connection: connectionId,
			generation,
			operation: execute.operation,
			parentCall: parent.call,
			registration: registrationRevision,
			agent: agentId,
			progress: { call: reverse.toolCall.id, sequence: 1, data: { phase: 'running' } },
		}]);
		assert.deepEqual(connection.hostOperationResponses[0].outcome, {
			kind: 'completed',
			value: expectedResult,
		});

		connection.emitHostOperation(execute);
		await flush();
		assert.equal(toolExecution.calls.length, 1);
		assert.equal(connection.hostOperationResponses.length, 2);
		assert.strictEqual(connection.hostOperationResponses[1], connection.hostOperationResponses[0]);

		const reconcile = hostOperation(parent, 'runtime-host-tool-reconcile', {
			kind: 'tool.reconcile',
			call: reverse.toolCall,
		});
		connection.emitHostOperation(reconcile);
		await flush();
		assert.deepEqual(toolExecution.reconciliations, [reverse.toolCall]);
		assert.deepEqual(connection.hostOperationResponses[2].outcome, {
			kind: 'completed',
			value: { kind: 'terminal', result: expectedResult },
		});

		const cancel = hostOperation(parent, 'runtime-host-tool-cancel', {
			kind: 'tool.cancel',
			call: reverse.toolCall,
		});
		connection.emitHostOperation(cancel);
		await flush();
		assert.deepEqual(toolExecution.cancellations, [reverse.toolCall.id]);

		emitTerminal(connection, parent);
		pending.complete(exactResponse(parent, null));
		await send;
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);

		connection.emitHostOperation(reconcile);
		await flush();
		assert.equal(connection.disposeCount, 1);
		assert.equal(connection.hostOperationResponses.length, 4);
		assert.equal(toolExecution.calls.length, 1);
		assert.equal(toolExecution.reconciliations.length, 1);
		assert.deepEqual(toolExecution.releases, [reverse.toolCall.id]);
		runtime.dispose();
	});

	test('routes exact reverse content leases and materializations only for accepted Turn attachments', async () => {
		const connection = new TestRuntimeConnection();
		const toolExecution = new TestRuntimeToolExecution();
		const contentResources = new TestRuntimeContentResources();
		const runtime = await connect(connection, defaultLimits, toolExecution, contentResources);
		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pending.p;
		const reverse = reverseTurnRequest('reverse-content');
		const content = reverse.attachment.content;
		assert.ok(content?.kind === 'reference');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		const lease = createAgentContentLeaseId('lease-1');

		connection.emitHostOperation(hostOperation(parent, 'runtime-host-content-open', {
			kind: 'content.open',
			request: {
				session: reverse.request.session,
				chat: reverse.request.chat,
				turn: reverse.request.turn,
				attachment: reverse.attachment.id,
				content,
			},
		}));
		await flush();
		assert.equal(contentResources.opens.length, 1);
		assert.deepEqual(connection.hostOperationResponses[0].outcome, {
			kind: 'completed',
			value: { lease, content },
		});

		connection.emitHostOperation(hostOperation(parent, 'runtime-host-content-read', {
			kind: 'content.readBlob',
			request: { lease, offset: 0, length: 4 },
		}));
		await flush();
		assert.deepEqual(connection.hostOperationResponses[1].outcome, {
			kind: 'completed',
			value: { offset: 0, byteLength: 4, data: 'eHh4eA==', encoding: 'base64', endOfContent: true },
		});

		const materialization = createAgentContentMaterializationId('materialization-1');
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-content-materialize', {
			kind: 'content.materialize',
			request: { lease },
		}));
		await flush();
		assert.deepEqual(connection.hostOperationResponses[2].outcome, {
			kind: 'completed',
			value: { id: materialization, resource: `/host/runtime/${lease}` },
		});

		connection.emitHostOperation(hostOperation(parent, 'runtime-host-content-release-materialization', {
			kind: 'content.releaseMaterialization',
			materialization,
		}));
		await flush();
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-content-release', {
			kind: 'content.release',
			lease,
		}));
		await flush();
		assert.deepEqual(contentResources.releasedMaterializations, [materialization]);
		assert.deepEqual(contentResources.releases, [lease]);

		emitTerminal(connection, parent);
		pending.complete(exactResponse(parent, null));
		await send;
		assert.deepEqual(contentResources.releasedMaterializations, [materialization]);
		assert.deepEqual(contentResources.releases, [lease]);
		runtime.dispose();
	});

	test('cancels the exact reverse content operation and releases owned resources when its parent Turn retires', async () => {
		const connection = new TestRuntimeConnection();
		const contentResources = new TestRuntimeContentResources();
		const runtime = await connect(
			connection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			contentResources,
		);
		const pendingSend = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = () => pendingSend.p;
		const reverse = reverseTurnRequest('reverse-content-cancel');
		const content = reverse.attachment.content;
		assert.ok(content?.kind === 'reference');
		const send = runtime.agents[0].chats.send(reverse.request);
		const parent = connection.sendCalls[0];
		const lease = createAgentContentLeaseId('lease-1');
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-content-cancel-open', {
			kind: 'content.open',
			request: {
				session: reverse.request.session,
				chat: reverse.request.chat,
				turn: reverse.request.turn,
				attachment: reverse.attachment.id,
				content,
			},
		}));
		await flush();
		connection.emitHostOperation(hostOperation(parent, 'runtime-host-content-cancel-materialize', {
			kind: 'content.materialize',
			request: { lease },
		}));
		await flush();

		const pendingRead = new DeferredPromise<IAgentContentBlobReadResult>();
		contentResources.blobReadHandler = () => pendingRead.p;
		const read = hostOperation(parent, 'runtime-host-content-cancel-read', {
			kind: 'content.readBlob',
			request: { lease, offset: 0, length: 4 },
		});
		connection.emitHostOperation(read);
		await flush();
		assert.equal(contentResources.blobReadTokens[0].isCancellationRequested, false);

		const cancel = hostOperation(parent, 'runtime-host-content-cancel', {
			kind: 'content.cancel',
			target: read.operation,
		});
		connection.emitHostOperation(cancel);
		await flush();
		assert.equal(contentResources.blobReadTokens[0].isCancellationRequested, true);
		assert.deepEqual(
			connection.hostOperationResponses.find(response => response.operation === cancel.operation)?.outcome,
			{ kind: 'completed', value: null },
		);

		pendingRead.error(new CancellationError());
		await flush();
		assert.deepEqual(
			connection.hostOperationResponses.find(response => response.operation === read.operation)?.outcome,
			{ kind: 'cancelled' },
		);
		emitTerminal(connection, parent);
		pendingSend.complete(exactResponse(parent, null));
		await send;
		assert.deepEqual(contentResources.releasedMaterializations, [
			createAgentContentMaterializationId('materialization-1'),
		]);
		assert.deepEqual(contentResources.releases, [lease]);
		runtime.dispose();
	});

	test('rejects reverse Tool and content requests outside the exact accepted parent Turn before side effects', async () => {
		const toolConnection = new TestRuntimeConnection();
		const toolExecution = new TestRuntimeToolExecution();
		const toolRuntime = await connect(toolConnection, defaultLimits, toolExecution);
		const toolPending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		toolConnection.sendHandler = () => toolPending.p;
		const reverseTool = reverseTurnRequest('reverse-invalid-tool');
		const toolSend = toolRuntime.agents[0].chats.send(reverseTool.request);
		const wrongTurnCall: IAgentToolCall = {
			...reverseTool.toolCall,
			turn: createAgentTurnId('wrong-turn'),
		};
		toolConnection.emitHostOperation(hostOperation(toolConnection.sendCalls[0], 'runtime-host-invalid-tool', {
			kind: 'tool.execute',
			call: wrongTurnCall,
		}));
		await assert.rejects(toolSend, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(toolExecution.calls, []);
		assert.equal(toolConnection.disposeCount, 1);
		toolRuntime.dispose();

		const contentConnection = new TestRuntimeConnection();
		const contentResources = new TestRuntimeContentResources();
		const contentRuntime = await connect(
			contentConnection,
			defaultLimits,
			new TestRuntimeToolExecution(),
			contentResources,
		);
		const contentPending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		contentConnection.sendHandler = () => contentPending.p;
		const reverseContent = reverseTurnRequest('reverse-invalid-content');
		const acceptedContent = reverseContent.attachment.content;
		assert.ok(acceptedContent?.kind === 'reference');
		const contentSend = contentRuntime.agents[0].chats.send(reverseContent.request);
		contentConnection.emitHostOperation(hostOperation(contentConnection.sendCalls[0], 'runtime-host-invalid-content', {
			kind: 'content.open',
			request: {
				session: reverseContent.request.session,
				chat: reverseContent.request.chat,
				turn: reverseContent.request.turn,
				attachment: reverseContent.attachment.id,
				content: { ...acceptedContent, version: createAgentContentVersion('wrong-version') },
			},
		}));
		await assert.rejects(contentSend, error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue));
		assert.deepEqual(contentResources.opens, []);
		assert.equal(contentConnection.disposeCount, 1);
		contentRuntime.dispose();
	});

	test('rejects mismatched negotiation correlation, descriptors, versions, and limits', async () => {
		const cases: readonly {
			readonly name: string;
			readonly mutate: (
				request: IAgentRuntimeInitializeRequest,
				result: IAgentRuntimeInitializeResult,
			) => IAgentRuntimeInitializeResult;
		}[] = [
			{
				name: 'generation',
				mutate: (_request, result) => ({
					...result,
					generation: createAgentRuntimeConnectionGeneration(8),
				}),
			},
			{
				name: 'descriptor registration pair',
				mutate: (_request, result) => ({
					...result,
					registrations: [{
						registration,
						descriptor: { ...descriptor, revision: createAgentDescriptorRevision('wrong.v1') },
					}],
				}),
			},
			{
				name: 'protocol version',
				mutate: (_request, result) => ({
					...result,
					protocolVersion: createAgentRuntimeProtocolVersion('3'),
				}),
			},
			{
				name: 'transport limit',
				mutate: (request, result) => ({
					...result,
					transportLimits: {
						...result.transportLimits,
						maximumActionBytes: request.transportLimits.maximumActionBytes + 1,
					},
				}),
			},
		];

		for (const candidate of cases) {
			const connection = new TestRuntimeConnection();
			connection.initializeHandler = async request => candidate.mutate(request, {
				connection: request.connection,
				generation: request.generation,
				call: request.call,
				protocolVersion,
				transportLimits: request.transportLimits,
				registrations: [{ registration, descriptor }],
			});
			await assert.rejects(
				connect(connection),
				error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
				candidate.name,
			);
			assert.equal(connection.disposeCount, 1, candidate.name);
		}
	});

	test('terminally invalidates the adapter when a response does not echo its exact call', async () => {
		const connection = new TestRuntimeConnection();
		connection.createSessionHandler = async call => ({
			...exactResponse(call, { session: call.request.session }),
			call: createAgentRuntimeCallId('wrong-call'),
		});
		const runtime = await connect(connection);
		const agent = runtime.agents[0];

		await assert.rejects(
			agent.sessions.create(sessionRequest(2)),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(connection.disposeCount, 1);
		await assert.rejects(
			agent.sessions.create(sessionRequest(3)),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(connection.createSessionCalls.length, 1);

		runtime.dispose();
		assert.equal(connection.disposeCount, 1);
	});

	test('forwards canonical ordered progress and rejects an action sequence gap', async () => {
		const connection = new TestRuntimeConnection();
		connection.sendHandler = async call => {
			connection.emitFor(call, 1, {
				kind: 'turnProgress',
				session: call.request.session,
				chat: call.request.chat,
				turn: call.request.turn,
				progress: { kind: 'state', state: 'accepted' },
			});
			connection.emitFor(call, 2, {
				kind: 'turnProgress',
				session: call.request.session,
				chat: call.request.chat,
				turn: call.request.turn,
				progress: { kind: 'response', part: { kind: 'text', text: 'Exact output' } },
			});
			connection.emitFor(call, 3, {
				kind: 'turnTerminal',
				session: call.request.session,
				chat: call.request.chat,
				turn: call.request.turn,
				state: 'completed',
			});
			return exactResponse(call, null);
		};
		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		const actions: IAgentAction[] = [];
		const listener = agent.onDidEmitAction(action => actions.push(action));

		await agent.chats.send(turnRequest(turnId));
		assert.deepEqual(actions.map(action => action.kind), [
			'turnProgress',
			'turnProgress',
			'turnTerminal',
		]);
		assert.deepEqual(actions[1], {
			kind: 'turnProgress',
			session: sessionId,
			chat: chatId,
			turn: turnId,
			progress: { kind: 'response', part: { kind: 'text', text: 'Exact output' } },
		});

		const pending = new DeferredPromise<IAgentRuntimeResponse<null>>();
		connection.sendHandler = _call => pending.p;
		const second = agent.chats.send(turnRequest('turn-2'));
		assert.equal(connection.sendCalls.length, 2);
		connection.emitFor(connection.sendCalls[1], 5, {
			kind: 'turnProgress',
			session: sessionId,
			chat: chatId,
			turn: createAgentTurnId('turn-2'),
			progress: { kind: 'state', state: 'running' },
		});
		await assert.rejects(
			second,
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(connection.disposeCount, 1);
		assert.equal(actions.length, 3);

		listener.dispose();
		runtime.dispose();
	});

	test('rejects pending and future calls after an explicit disconnect without failover', async () => {
		const connection = new TestRuntimeConnection();
		const response = new DeferredPromise<IAgentRuntimeResponse<IAgentSessionBacking>>();
		connection.createSessionHandler = () => response.p;
		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		const pending = agent.sessions.create(sessionRequest(4));

		assert.equal(connection.createSessionCalls.length, 1);
		connection.disconnect('processExited');
		await assert.rejects(
			pending,
			error => assertErrorCode(error, AgentHostErrorCode.ResourceMissing),
		);
		await assert.rejects(
			agent.sessions.create(sessionRequest(5)),
			error => assertErrorCode(error, AgentHostErrorCode.ResourceMissing),
		);
		assert.equal(connection.createSessionCalls.length, 1);

		response.complete(exactResponse(connection.createSessionCalls[0], {
			session: connection.createSessionCalls[0].request.session,
		}));
		connection.emitFor(connection.createSessionCalls[0], 1, {
			kind: 'sessionResumeStateChanged',
			session: connection.createSessionCalls[0].request.session,
			resume: { schema: resumeSchema, data: '{}' },
		});
		runtime.dispose();
		runtime.dispose();
		assert.equal(connection.disposeCount, 1);
	});

	test('commits a successful lifecycle response before its generation drain opens recovery', async () => {
		const connection = new TestRuntimeConnection();
		const response = new DeferredPromise<IAgentRuntimeResponse<IAgentSessionBacking>>();
		connection.createSessionHandler = () => response.p;
		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		const request = sessionRequest(1);
		const creation = agent.sessions.create(request);
		const call = connection.createSessionCalls[0];

		response.complete(exactResponse(call, { session: request.session }));
		connection.reconnect();
		const recoveryBarrier = agent.sessions.delete({
			operation: createAgentHostOperationId('wait-for-create-recovery'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'1'.repeat(64)}`),
			session: createAgentSessionId('unknown-recovery-session'),
		});

		assert.deepEqual(await creation, { session: request.session });
		await recoveryBarrier;
		assert.equal(connection.materializeSessionCalls.length, 1);
		assert.equal(connection.materializeSessionCalls[0].generation, connection.generation);
		assert.equal(connection.materializeSessionCalls[0].request.session, request.session);

		runtime.dispose();
	});

	test('replays an unacknowledged rollback with its prepared candidate identity after reconnect', async () => {
		const connection = new TestRuntimeConnection();
		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		await agent.sessions.create(sessionRequest(1));
		const operation = createAgentHostOperationId('configuration-rollback-reconnect');
		const payloadDigest = createAgentHostPayloadDigest(`sha256:${'2'.repeat(64)}`);
		await agent.configuration.prepareSessionUpdate({
			operation,
			payloadDigest,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			current: sessionConfigurationState,
			candidate: nextSessionConfigurationState,
		});
		await agent.configuration.rollbackSessionUpdate({
			operation,
			payloadDigest,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
		});

		connection.reconnect();
		await agent.sessions.delete({
			operation: createAgentHostOperationId('wait-for-rollback-recovery'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'3'.repeat(64)}`),
			session: createAgentSessionId('unknown-rollback-session'),
		});

		assert.equal(connection.materializeSessionCalls.length, 1);
		assert.equal(
			connection.materializeSessionCalls[0].request.configuration.revision,
			sessionConfigurationState.revision,
		);
		assert.equal(connection.prepareSessionConfigurationUpdateCalls.length, 2);
		assert.equal(connection.rollbackSessionConfigurationUpdateCalls.length, 2);
		assert.deepEqual(connection.rollbackSessionConfigurationUpdateCalls[1].request, {
			operation,
			payloadDigest,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
		});

		runtime.dispose();
	});

	test('chains superseded recoveries behind every prior generation drain and advances queued calls to the latest generation', async () => {
		const logicalConnection = createAgentRuntimeConnectionId('managed-overlapping-recovery-runtime');
		const generations: TestRuntimeConnection[] = [];
		const reconnects: IAgentRuntimeReconnectEvent[] = [];
		const managed = await ManagedAgentRuntimeConnection.create({
			connection: logicalConnection,
			createGeneration: (runtimeConnection, runtimeGeneration) => {
				const candidate = new TestRuntimeConnection(runtimeConnection, runtimeGeneration);
				generations.push(candidate);
				return Promise.resolve(candidate);
			},
		});
		const reconnectListener = managed.onDidReconnect(event => reconnects.push(event));
		const toolExecution = new TestRuntimeToolExecution();
		const toolResult = new DeferredPromise<AgentToolResult>();
		toolExecution.executeHandler = _call => toolResult.p;
		const runtime = await connectAgentRuntime(runtimeOptions(
			managed,
			defaultLimits,
			toolExecution,
		));
		const agent = runtime.agents[0];
		await agent.sessions.create(sessionRequest(1));
		await agent.chats.create({
			operation: createAgentHostOperationId('create-chat-overlapping-recovery'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'4'.repeat(64)}`),
			session: sessionId,
			chat: chatId,
			origin: { kind: 'user' },
		});

		const lostResponse = new DeferredPromise<IAgentRuntimeResponse<null>>();
		const sendStarted = new DeferredPromise<void>();
		generations[0].sendHandler = () => {
			sendStarted.complete(undefined);
			return lostResponse.p;
		};
		const reverse = reverseTurnRequest('overlapping-recovery-lost');
		const lostSend = agent.chats.send(reverse.request);
		let lostSendFailure: unknown;
		let lostSendSettled = false;
		const lostSendCompletion = lostSend.then(
			() => {
				lostSendSettled = true;
			},
			error => {
				lostSendSettled = true;
				lostSendFailure = error;
			},
		);
		await sendStarted.p;
		const parent = generations[0].sendCalls[0];
		generations[0].emitHostOperation(hostOperation(parent, 'runtime-host-overlapping-recovery', {
			kind: 'tool.execute',
			call: reverse.toolCall,
		}));
		await flush();
		assert.equal(toolExecution.calls.length, 1);

		generations[0].disconnect('processExited');
		await flush();
		assert.deepEqual(reconnects[0], {
			connection: logicalConnection,
			previousGeneration: createAgentRuntimeConnectionGeneration(1),
			generation: createAgentRuntimeConnectionGeneration(2),
		});
		const queuedCreation = agent.sessions.create(sessionRequest(2));
		let queuedCreationResult: IAgentSessionBacking | undefined;
		let queuedCreationFailure: unknown;
		let queuedCreationSettled = false;
		const queuedCreationCompletion = queuedCreation.then(
			value => {
				queuedCreationSettled = true;
				queuedCreationResult = value;
			},
			error => {
				queuedCreationSettled = true;
				queuedCreationFailure = error;
			},
		);
		generations[1].disconnect('processExited');
		await flush();
		assert.deepEqual(reconnects[1], {
			connection: logicalConnection,
			previousGeneration: createAgentRuntimeConnectionGeneration(2),
			generation: createAgentRuntimeConnectionGeneration(3),
		});
		await flush();
		assert.equal(generations[1].materializeSessionCalls.length, 0);
		assert.equal(generations[1].createSessionCalls.length, 0);
		assert.equal(generations[2].materializeSessionCalls.length, 0);
		assert.equal(generations[2].createSessionCalls.length, 0);

		toolResult.complete({ call: reverse.toolCall.id, status: 'completed', output: null });
		await flush();
		assert.equal(lostSendSettled, true);
		assert.equal(queuedCreationSettled, true);
		assertErrorCode(lostSendFailure, AgentHostErrorCode.ResourceMissing);
		assert.deepEqual((lostSendFailure as AgentHostError).data, {
			resource: `agentRuntime:${logicalConnection}:1`,
		});
		assert.equal(queuedCreationFailure, undefined);
		assert.deepEqual(queuedCreationResult, { session: createAgentSessionId('session-2') });
		await Promise.all([lostSendCompletion, queuedCreationCompletion]);
		assert.equal(generations[2].materializeSessionCalls.length, 1);
		assert.equal(generations[2].materializeChatCalls.length, 1);
		assert.equal(generations[2].createSessionCalls.length, 1);
		assert.equal(generations[2].createSessionCalls[0].request.session, createAgentSessionId('session-2'));

		reconnectListener.dispose();
		runtime.dispose();
	});

	test('commits lifecycle resume actions only with successful backing materialization', async () => {
		const connection = new TestRuntimeConnection();
		let sequence = 0;
		const emitSessionResume = (
			call: IAgentRuntimeCall<{ readonly session: AgentSessionId }>,
			data: string,
		): void => {
			sequence += 1;
			connection.emitFor(call, sequence, {
				kind: 'sessionResumeStateChanged',
				session: call.request.session,
				resume: { schema: resumeSchema, data },
			});
		};
		const emitChatResume = (
			call: IAgentRuntimeCall<{ readonly session: AgentSessionId; readonly chat: AgentChatId }>,
			data: string,
		): void => {
			sequence += 1;
			connection.emitFor(call, sequence, {
				kind: 'chatResumeStateChanged',
				session: call.request.session,
				chat: call.request.chat,
				resume: { schema: resumeSchema, data },
			});
		};
		connection.createSessionHandler = call => {
			emitSessionResume(call, 'session-create-action');
			return Promise.resolve(exactResponse(call, {
				session: call.request.session,
				resume: { schema: resumeSchema, data: 'session-create-backing' },
			}));
		};
		connection.materializeSessionHandler = call => {
			emitSessionResume(call, 'session-materialize-action');
			return Promise.resolve(exactResponse(call, null));
		};
		connection.createChatHandler = call => {
			emitChatResume(call, 'chat-create-action');
			return Promise.resolve(exactResponse(call, {
				session: call.request.session,
				chat: call.request.chat,
				resume: { schema: resumeSchema, data: 'chat-create-backing' },
			}));
		};
		connection.materializeChatHandler = call => {
			emitChatResume(call, 'chat-materialize-action');
			return Promise.resolve(exactResponse(call, null));
		};
		const failedFork = createAgentChatId('chat-4');
		connection.forkChatHandler = call => {
			const failed = call.request.chat === failedFork;
			emitChatResume(call, failed ? 'chat-failed-fork-action' : 'chat-fork-action');
			if (failed) {
				return Promise.reject(new Error('fork backing failed'));
			}
			return Promise.resolve(exactResponse(call, {
				session: call.request.session,
				chat: call.request.chat,
				resume: { schema: resumeSchema, data: 'chat-fork-backing' },
			}));
		};

		const runtime = await connect(connection);
		const agent = runtime.agents[0];
		await agent.sessions.create(sessionRequest(1));
		const materializedSession = createAgentSessionId('session-2');
		await agent.sessions.materialize({
			operation: createAgentHostOperationId('materialize-session-resume-action'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'5'.repeat(64)}`),
			session: materializedSession,
			configuration: sessionConfigurationState,
			resume: { schema: resumeSchema, data: 'session-materialize-request' },
		});
		await agent.chats.create({
			operation: createAgentHostOperationId('create-chat-resume-action'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'6'.repeat(64)}`),
			session: sessionId,
			chat: chatId,
			origin: { kind: 'user' },
		});
		const materializedChat = createAgentChatId('chat-2');
		await agent.chats.materialize({
			operation: createAgentHostOperationId('materialize-chat-resume-action'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'7'.repeat(64)}`),
			session: sessionId,
			chat: materializedChat,
			resume: { schema: resumeSchema, data: 'chat-materialize-request' },
		});
		const forkedChat = createAgentChatId('chat-3');
		const forkRequest = (chat: AgentChatId, operation: string, digit: string): IAgentForkChatRequest => ({
			operation: createAgentHostOperationId(operation),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${digit.repeat(64)}`),
			session: sessionId,
			chat,
			source: { chat: chatId, turn: turnId },
		});
		await agent.chats.fork(forkRequest(forkedChat, 'fork-chat-resume-action', '8'));
		await assert.rejects(
			agent.chats.fork(forkRequest(failedFork, 'fork-chat-resume-action-failed', '9')),
			/fork backing failed/,
		);

		connection.materializeSessionHandler = call => Promise.resolve(exactResponse(call, null));
		connection.materializeChatHandler = call => Promise.resolve(exactResponse(call, null));
		connection.reconnect();
		await agent.sessions.delete({
			operation: createAgentHostOperationId('wait-for-resume-recovery'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'a'.repeat(64)}`),
			session: createAgentSessionId('unknown-resume-session'),
		});

		const recoveredSessions = connection.materializeSessionCalls
			.filter(call => call.generation === connection.generation)
			.map(call => [call.request.session, call.request.resume?.data]);
		assert.deepEqual(recoveredSessions, [
			[sessionId, 'session-create-action'],
			[materializedSession, 'session-materialize-action'],
		]);
		const recoveredChats = connection.materializeChatCalls
			.filter(call => call.generation === connection.generation)
			.map(call => [call.request.chat, call.request.resume?.data]);
		assert.deepEqual(recoveredChats, [
			[chatId, 'chat-create-action'],
			[materializedChat, 'chat-materialize-action'],
			[forkedChat, 'chat-fork-action'],
		]);
		assert.equal(recoveredChats.some(([chat]) => chat === failedFork), false);

		runtime.dispose();
	});

	test('rematerializes committed Session and Chat state across generations without replaying a lost Turn', async () => {
		const logicalConnection = createAgentRuntimeConnectionId('managed-test-runtime');
		const generations: TestRuntimeConnection[] = [];
		const managed = await ManagedAgentRuntimeConnection.create({
			connection: logicalConnection,
			createGeneration: (connection, runtimeGeneration) => {
				const runtime = new TestRuntimeConnection(connection, runtimeGeneration);
				generations.push(runtime);
				return Promise.resolve(runtime);
			},
		});
		const runtime = await connectAgentRuntime(runtimeOptions(managed));
		const agent = runtime.agents[0];
		await agent.sessions.create(sessionRequest(1));
		await agent.chats.create({
			operation: createAgentHostOperationId('create-chat-reconnect'),
			payloadDigest: createAgentHostPayloadDigest(`sha256:${'c'.repeat(64)}`),
			session: sessionId,
			chat: chatId,
			origin: { kind: 'user' },
		});
		const configurationOperation = createAgentHostOperationId('configuration-reconnect');
		const configurationDigest = createAgentHostPayloadDigest(`sha256:${'d'.repeat(64)}`);
		await agent.configuration.prepareSessionUpdate({
			operation: configurationOperation,
			payloadDigest: configurationDigest,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			current: sessionConfigurationState,
			candidate: nextSessionConfigurationState,
		});
		await agent.configuration.commitSessionUpdate({
			operation: configurationOperation,
			payloadDigest: configurationDigest,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
		});

		const firstSendStarted = new DeferredPromise<void>();
		const lostResponse = new DeferredPromise<IAgentRuntimeResponse<null>>();
		generations[0].sendHandler = () => {
			firstSendStarted.complete(undefined);
			return lostResponse.p;
		};
		const lostSend = agent.chats.send(turnRequest('generation-one-lost'));
		await firstSendStarted.p;

		const secondGeneration = new Promise<unknown>(resolve => Event.once(managed.onDidReconnect)(resolve));
		generations[0].disconnect('processExited');
		await assert.rejects(lostSend, error => {
			assertErrorCode(error, AgentHostErrorCode.ResourceMissing);
			assert.deepEqual((error as AgentHostError).data, {
				resource: `agentRuntime:${logicalConnection}:1`,
			});
			return true;
		});
		assert.deepEqual(await secondGeneration, {
			connection: logicalConnection,
			previousGeneration: createAgentRuntimeConnectionGeneration(1),
			generation: createAgentRuntimeConnectionGeneration(2),
		});
		assert.equal(generations[1].sendCalls.length, 0);
		generations[1].sendHandler = call => {
			assert.equal(generations[1].materializeSessionCalls.length, 1);
			assert.equal(generations[1].prepareSessionConfigurationUpdateCalls.length, 1);
			assert.equal(generations[1].commitSessionConfigurationUpdateCalls.length, 1);
			assert.equal(generations[1].materializeChatCalls.length, 1);
			generations[1].emitFor(call, 1, {
				kind: 'turnTerminal',
				session: call.request.session,
				chat: call.request.chat,
				turn: call.request.turn,
				state: 'completed',
			});
			return Promise.resolve(exactResponse(call, null));
		};
		await agent.chats.send(turnRequest('generation-two'));

		const thirdGeneration = new Promise<unknown>(resolve => Event.once(managed.onDidReconnect)(resolve));
		generations[1].disconnect('processExited');
		assert.deepEqual(await thirdGeneration, {
			connection: logicalConnection,
			previousGeneration: createAgentRuntimeConnectionGeneration(2),
			generation: createAgentRuntimeConnectionGeneration(3),
		});
		generations[2].sendHandler = call => {
			assert.equal(generations[2].materializeSessionCalls.length, 1);
			assert.equal(generations[2].prepareSessionConfigurationUpdateCalls.length, 1);
			assert.equal(generations[2].commitSessionConfigurationUpdateCalls.length, 1);
			assert.equal(generations[2].materializeChatCalls.length, 1);
			generations[2].emitFor(call, 1, {
				kind: 'turnTerminal',
				session: call.request.session,
				chat: call.request.chat,
				turn: call.request.turn,
				state: 'completed',
			});
			return Promise.resolve(exactResponse(call, null));
		};
		await agent.chats.send(turnRequest('generation-three'));
		await agent.configuration.acknowledgeSessionUpdate({
			operation: configurationOperation,
			payloadDigest: configurationDigest,
			runtimeRegistration: registrationRevision,
			session: sessionId,
			configuration: nextSessionConfigurationState.revision,
			decision: 'commit',
		});

		assert.deepEqual(generations.map(candidate => candidate.generation), [1, 2, 3]);
		assert.deepEqual(generations.slice(1).map(candidate => candidate.materializeSessionCalls[0].request), [
			{
				operation: generations[1].materializeSessionCalls[0].request.operation,
				payloadDigest: generations[1].materializeSessionCalls[0].request.payloadDigest,
				session: sessionId,
				configuration: sessionConfigurationState,
			},
			{
				operation: generations[2].materializeSessionCalls[0].request.operation,
				payloadDigest: generations[2].materializeSessionCalls[0].request.payloadDigest,
				session: sessionId,
				configuration: sessionConfigurationState,
			},
		]);
		assert.deepEqual(generations.slice(1).map(candidate => candidate.materializeChatCalls[0].request), [
			{
				operation: generations[1].materializeChatCalls[0].request.operation,
				payloadDigest: generations[1].materializeChatCalls[0].request.payloadDigest,
				session: sessionId,
				chat: chatId,
			},
			{
				operation: generations[2].materializeChatCalls[0].request.operation,
				payloadDigest: generations[2].materializeChatCalls[0].request.payloadDigest,
				session: sessionId,
				chat: chatId,
			},
		]);

		runtime.dispose();
	});

	test('enforces negotiated concurrency and request, response, and action byte limits', async () => {
		const limits: IAgentRuntimeTransportLimits = {
			maximumRequestBytes: 4_096,
			maximumResponseBytes: 4_096,
			maximumActionBytes: 2_048,
			maximumConcurrentCalls: 1,
		};
		const concurrentConnection = new TestRuntimeConnection();
		const pendingResponse = new DeferredPromise<IAgentRuntimeResponse<IAgentSessionBacking>>();
		concurrentConnection.createSessionHandler = () => pendingResponse.p;
		const concurrentRuntime = await connect(concurrentConnection, limits);
		const first = concurrentRuntime.agents[0].sessions.create(sessionRequest(6));
		await assert.rejects(
			concurrentRuntime.agents[0].sessions.create(sessionRequest(7)),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(concurrentConnection.createSessionCalls.length, 1);
		concurrentConnection.disconnect('transportClosed');
		await assert.rejects(first);
		concurrentRuntime.dispose();

		const requestConnection = new TestRuntimeConnection();
		const requestRuntime = await connect(requestConnection, limits);
		const oversizedRequest = {
			...sessionRequest(8),
			workspace: {
				resource: 'workspace:test',
				label: 'x'.repeat(8_192),
				folders: [],
			},
		};
		await assert.rejects(
			requestRuntime.agents[0].sessions.create(oversizedRequest),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(requestConnection.createSessionCalls.length, 0);
		requestRuntime.dispose();

		const responseConnection = new TestRuntimeConnection();
		responseConnection.createSessionHandler = async call => exactResponse(call, {
			session: call.request.session,
			resume: { schema: resumeSchema, data: 'x'.repeat(8_192) },
		});
		const responseRuntime = await connect(responseConnection, limits);
		await assert.rejects(
			responseRuntime.agents[0].sessions.create(sessionRequest(9)),
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(responseConnection.disposeCount, 1);

		const actionConnection = new TestRuntimeConnection();
		const actionResponse = new DeferredPromise<IAgentRuntimeResponse<IAgentSessionBacking>>();
		actionConnection.createSessionHandler = () => actionResponse.p;
		const actionRuntime = await connect(actionConnection, limits);
		const actionCall = actionRuntime.agents[0].sessions.create(sessionRequest(10));
		actionConnection.emitFor(actionConnection.createSessionCalls[0], 1, {
			kind: 'sessionResumeStateChanged',
			session: actionConnection.createSessionCalls[0].request.session,
			resume: { schema: resumeSchema, data: 'x'.repeat(8_192) },
		});
		await assert.rejects(
			actionCall,
			error => assertErrorCode(error, AgentHostErrorCode.InvalidProtocolValue),
		);
		assert.equal(actionConnection.disposeCount, 1);
		actionRuntime.dispose();
	});
});
