/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import {
	createSdkMcpServer,
	deleteSession as deleteClaudeSession,
	query as claudeQuery,
	tool as claudeTool,
	type Options as ClaudeAgentSdkOptions,
	type PermissionMode,
	type Query,
	type ModelInfo,
	type SDKMessage,
	type SessionStore,
} from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';

import { DeferredPromise } from 'cs/base/common/async';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import {
	CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	CLAUDE_AGENT_CREDENTIAL_PROPERTY,
	CLAUDE_AGENT_ID,
	CLAUDE_AGENT_PACKAGE_ID,
	CLAUDE_AGENT_PERMISSION_MODE_PROPERTY,
	CLAUDE_AGENT_RESUME_SCHEMA,
	CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
	CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
	createClaudeAgentDescriptor,
	createClaudeAgentModelConfigurationSchema,
	createClaudeAgentRuntimeRegistration,
	createClaudeAgentRuntimeRegistrationRevision,
	type ClaudeAgentThinkingLevel,
} from 'cs/code/common/agentHost/claudeAgentPackage';
import type {
	IAgentDescriptor,
	IAgentAcknowledgeSessionConfigurationUpdateRequest,
	IAgentAction,
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
	AgentTurnResponsePart,
} from 'cs/platform/agentHost/common/agent';
import {
	resolveAgentModelConfigurationCandidate,
	resolveAgentSessionConfigurationValues,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationState,
	type IAgentConfigurationCompletion,
	type IAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type {
	AgentRuntimeConnectionState,
	AgentRuntimeDisconnectReason,
	AgentRuntimeHostOperation,
	AgentRuntimeHostOperationOutcome,
	AgentRuntimeHostOperationValue,
	AgentRuntimeOperationOutcome,
	IAgentRuntimeAction,
	IAgentRuntimeCall,
	IAgentRuntimeConnection,
	IAgentRuntimeHostOperationProgress,
	IAgentRuntimeHostOperationRequest,
	IAgentRuntimeHostOperationResponse,
	IAgentRuntimeInitializeRequest,
	IAgentRuntimeInitializeResult,
	IAgentRuntimeOperationOutcomeRequest,
	IAgentRuntimeResponse,
} from 'cs/platform/agentHost/common/connections';
import { selectAgentRuntimeProtocolVersion } from 'cs/platform/agentHost/common/connections';
import type { IAgentCredentialReference } from 'cs/platform/agentHost/common/credentials';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentConfigurationSchemaRevision,
	createAgentDescriptorRevision,
	createAgentHostOperationId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentRuntimeActionSequence,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
	createAgentRuntimeHostOperationId,
	createAgentRuntimeProtocolVersion,
	createAgentToolCallId,
	type AgentChatId,
	type AgentHostOperationId,
	type AgentHostPayloadDigest,
	type AgentModelId,
	type AgentPackageRevision,
	type AgentRuntimeCallId,
	type AgentRuntimeConnectionGeneration,
	type AgentRuntimeConnectionId,
	type AgentRuntimeHostOperationId,
	type AgentRuntimeRegistrationRevision,
	type AgentSessionId,
} from 'cs/platform/agentHost/common/identities';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	assertAgentToolResult,
	COMET_TOOL_SCHEMA_PROFILE,
	computeAgentToolMutationPayloadDigest,
	parseCometToolSchema,
	type AgentToolResult,
	type CometToolSchemaNode,
	type IAgentToolCall,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';
import { ClaudeAgentSessionStore } from './claudeAgentSessionStore.js';

const claudeRuntimeProtocolVersion = createAgentRuntimeProtocolVersion('2');
const claudeMcpServerName = 'comet';
const claudeSdkSessionIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface IClaudeAgentRuntimeRetentionLimits {
	readonly maximumRetainedOperations: number;
	readonly maximumRetainedTerminalTurns: number;
}

export const productClaudeAgentRuntimeRetentionLimits: IClaudeAgentRuntimeRetentionLimits = Object.freeze({
	maximumRetainedOperations: 4_096,
	maximumRetainedTerminalTurns: 4_096,
});

export interface IClaudeAgentRuntimeOptions extends IClaudeAgentRuntimeRetentionLimits {
	readonly packageRevision: AgentPackageRevision;
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly claudeCodeExecutable: string;
	readonly stateDirectory: string;
	readonly cacheDirectory: string;
	readonly query?: typeof claudeQuery;
	readonly deleteSession?: typeof deleteClaudeSession;
	readonly sessionStore?: SessionStore;
}

interface IClaudeChatResumeData {
	readonly kind: 'claude-agent-sdk-chat';
	readonly version: 1;
	readonly sdkSessionId: string;
	readonly started: boolean;
}

interface IClaudeSessionResumeData {
	readonly kind: 'claude-agent-sdk-session';
	readonly version: 2;
	readonly workingDirectory: string;
	readonly additionalDirectories: readonly string[];
}

interface IClaudeChatState {
	resume: IClaudeChatResumeData;
	materialized: boolean;
}

interface IClaudeSessionState {
	configuration: IAgentConfigurationState;
	readonly resume: IClaudeSessionResumeData;
	materialized: boolean;
	readonly chats: Map<AgentChatId, IClaudeChatState>;
}

interface IClaudeOperationState {
	readonly digest: AgentHostPayloadDigest;
	state: 'pending' | 'completed';
	value: AgentHostProtocolValue;
}

interface IClaudeConfigurationTransaction {
	readonly digest: AgentHostPayloadDigest;
	readonly session: AgentSessionId;
	readonly current: IAgentConfigurationState;
	readonly candidate: IAgentConfigurationState;
	state: 'prepared' | 'committed' | 'rolledBack';
}

interface IClaudeHostOperationState {
	readonly parentCall: AgentRuntimeCallId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly agent: typeof CLAUDE_AGENT_ID;
	readonly completion: DeferredPromise<AgentRuntimeHostOperationOutcome>;
}

interface IClaudeActiveTurn {
	readonly request: IAgentRuntimeCall<IAgentChatRequest>;
	readonly abortController: AbortController;
	query?: Query;
}

interface IClaudeExecutionProfileData {
	readonly kind: 'claudeAgentSdkExecutionProfile';
	readonly model: string;
	readonly permissionMode: PermissionMode;
	readonly thinkingLevel: ClaudeAgentThinkingLevel | null;
	readonly credential: IAgentCredentialReference;
}

interface IClaudeDiscoveredModel {
	readonly sdkValue: string;
	readonly supportsAutoMode: boolean;
	readonly descriptor: IAgentDescriptor['models'][number];
}

function response<TRequest, TValue>(
	request: IAgentRuntimeCall<TRequest>,
	value: TValue,
): IAgentRuntimeResponse<TValue> {
	return Object.freeze({
		connection: request.connection,
		generation: request.generation,
		call: request.call,
		registration: request.registration,
		agent: request.agent,
		value,
	});
}

function resourceMissing(resource: string): never {
	throw new AgentHostError(
		AgentHostErrorCode.ResourceMissing,
		'Claude Agent Runtime resource is missing',
		{ resource },
	);
}

function exactRecord(value: unknown, keys: readonly string[]): value is Readonly<Record<string, unknown>> {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& keys.every(key => Object.hasOwn(value, key));
}

function zodSchema(node: CometToolSchemaNode): z.ZodType {
	switch (node.type) {
		case 'null':
			return z.null();
		case 'boolean':
			return z.boolean();
		case 'number': {
			let result = z.number();
			if (node.minimum !== undefined) { result = result.min(node.minimum); }
			if (node.maximum !== undefined) { result = result.max(node.maximum); }
			return result;
		}
		case 'integer': {
			let result = z.number().int();
			if (node.minimum !== undefined) { result = result.min(node.minimum); }
			if (node.maximum !== undefined) { result = result.max(node.maximum); }
			return result;
		}
		case 'string': {
			if (node.enum !== undefined) {
				return z.enum(node.enum as [string, ...string[]]);
			}
			let result = z.string();
			if (node.minimumLength !== undefined) { result = result.min(node.minimumLength); }
			if (node.maximumLength !== undefined) { result = result.max(node.maximumLength); }
			return result;
		}
		case 'array': {
			let result = z.array(zodSchema(node.items));
			if (node.minimumItems !== undefined) { result = result.min(node.minimumItems); }
			if (node.maximumItems !== undefined) { result = result.max(node.maximumItems); }
			return result;
		}
		case 'object': {
			const required = new Set(node.required);
			const shape: Record<string, z.ZodType> = {};
			for (const [name, property] of Object.entries(node.properties)) {
				const schema = zodSchema(property);
				shape[name] = required.has(name) ? schema : schema.optional();
			}
			return z.object(shape).strict();
		}
		case 'literal':
			return z.literal(node.value);
		case 'oneOf':
			return z.union(node.variants.map(zodSchema) as [z.ZodType, z.ZodType, ...z.ZodType[]]);
	}
}

function inputShape(registration: IAgentToolRegistration): z.ZodRawShape {
	const root = parseCometToolSchema(registration.descriptor.inputSchema);
	if (root.type !== 'object') {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Claude Agent SDK Tool input schema must be an object',
			{ field: 'tool.inputSchema', value: registration.descriptor.id },
		);
	}
	const required = new Set(root.required);
	const shape: Record<string, z.ZodType> = {};
	for (const [name, property] of Object.entries(root.properties)) {
		const schema = zodSchema(property);
		shape[name] = required.has(name) ? schema : schema.optional();
	}
	return shape;
}

/** Connected Claude Agent SDK runtime with Host-owned credentials and Tool execution. */
export class ClaudeAgentRuntime extends Disposable implements IAgentRuntimeConnection {
	private readonly disconnectEmitter = this._register(new Emitter<Extract<
		AgentRuntimeConnectionState,
		{ readonly kind: 'disconnected' }
	>>());
	private readonly actionEmitter = this._register(new Emitter<IAgentRuntimeAction>());
	private readonly hostOperationEmitter = this._register(new Emitter<IAgentRuntimeHostOperationRequest>());
	private readonly sessions = new Map<AgentSessionId, IClaudeSessionState>();
	private readonly operations = new Map<AgentHostOperationId, IClaudeOperationState>();
	private readonly configurationTransactions = new Map<AgentHostOperationId, IClaudeConfigurationTransaction>();
	private readonly hostOperations = new Map<AgentRuntimeHostOperationId, IClaudeHostOperationState>();
	private readonly activeTurns = new Map<string, IClaudeActiveTurn>();
	private readonly terminalTurns = new Set<string>();
	private readonly packageRevision: AgentPackageRevision;
	private readonly claudeCodeExecutable: string;
	private readonly stateDirectory: string;
	private readonly cacheDirectory: string;
	private readonly query: typeof claudeQuery;
	private readonly deleteClaudeSession: typeof deleteClaudeSession;
	private readonly sessionStore: SessionStore;
	private readonly maximumRetainedOperations: number;
	private readonly maximumRetainedTerminalTurns: number;
	private cacheRootPromise: Promise<string> | undefined;
	private stateValue: AgentRuntimeConnectionState;
	private descriptor: IAgentDescriptor | undefined;
	private registration: ReturnType<typeof createClaudeAgentRuntimeRegistration> | undefined;
	private discoveredModels: ReadonlyMap<AgentModelId, IClaudeDiscoveredModel> = new Map();
	private initializationState: 'notStarted' | 'initializing' | 'initialized' | 'failed' = 'notStarted';
	private nextActionSequence = 1;
	private nextHostOperation = 1;
	private nextToolCall = 1;

	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly onDidDisconnect = this.disconnectEmitter.event;
	readonly onDidReconnect = Event.None;
	readonly onDidEmitAction = this.actionEmitter.event;
	readonly onDidRequestHostOperation = this.hostOperationEmitter.event;

	constructor(options: IClaudeAgentRuntimeOptions) {
		super();
		if (
			!isAbsolute(options.claudeCodeExecutable)
			|| !isAbsolute(options.stateDirectory)
			|| !isAbsolute(options.cacheDirectory)
		) {
			throw new Error('Claude Agent Runtime paths must be absolute.');
		}
		this.packageRevision = options.packageRevision;
		this.connection = createAgentRuntimeConnectionId(options.connection);
		this.generation = createAgentRuntimeConnectionGeneration(options.generation);
		this.claudeCodeExecutable = options.claudeCodeExecutable;
		this.stateDirectory = options.stateDirectory;
		this.cacheDirectory = options.cacheDirectory;
		this.query = options.query ?? claudeQuery;
		this.deleteClaudeSession = options.deleteSession ?? deleteClaudeSession;
		this.sessionStore = options.sessionStore ?? new ClaudeAgentSessionStore(join(this.stateDirectory, 'sessions-v1'));
		this.maximumRetainedOperations = this.validateRetentionLimit(options.maximumRetainedOperations, 'maximumRetainedOperations');
		this.maximumRetainedTerminalTurns = this.validateRetentionLimit(options.maximumRetainedTerminalTurns, 'maximumRetainedTerminalTurns');
		this.stateValue = Object.freeze({ kind: 'connected', connection: this.connection, generation: this.generation });
	}

	get state(): AgentRuntimeConnectionState {
		return this.stateValue;
	}

	async initialize(request: IAgentRuntimeInitializeRequest): Promise<IAgentRuntimeInitializeResult> {
		this.assertConnected();
		if (this.initializationState !== 'notStarted') {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent Runtime was already initialized',
				{ field: 'initialize', value: 'repeated' },
			);
		}
		if (
			request.connection !== this.connection
			|| request.generation !== this.generation
			|| request.packageId !== CLAUDE_AGENT_PACKAGE_ID
			|| request.packageRevision !== this.packageRevision
			|| request.authorizedAgents.length !== 1
			|| request.authorizedAgents[0] !== CLAUDE_AGENT_ID
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent Runtime initialization authority does not match',
				{ field: 'initialize.authority', value: request.packageId },
			);
		}
		const protocolVersion = selectAgentRuntimeProtocolVersion(
			request.protocolVersions,
			Object.freeze([claudeRuntimeProtocolVersion]),
		);
		this.initializationState = 'initializing';
		try {
			const catalog = await this.discoverModelCatalog();
			this.descriptor = catalog.descriptor;
			this.registration = createClaudeAgentRuntimeRegistration(catalog.descriptor.revision);
			this.discoveredModels = catalog.models;
			this.initializationState = 'initialized';
		} catch (error) {
			this.initializationState = 'failed';
			throw error;
		}
		return Object.freeze({
			connection: request.connection,
			generation: request.generation,
			call: request.call,
			protocolVersion,
			transportLimits: Object.freeze({ ...request.transportLimits }),
			registrations: Object.freeze([Object.freeze({
				registration: this.registration,
				descriptor: this.descriptor,
			})]),
		});
	}

	private async discoverModelCatalog(): Promise<{
		readonly descriptor: IAgentDescriptor;
		readonly models: ReadonlyMap<AgentModelId, IClaudeDiscoveredModel>;
	}> {
		const cacheDirectory = await this.resolveModelCatalogCache();
		const closePrompt = new DeferredPromise<void>();
		const prompt = (async function* () {
			await closePrompt.p;
		})();
		const query = this.query({
			prompt,
			options: {
				cwd: cacheDirectory,
				env: this.claudeDiscoveryEnvironment(cacheDirectory),
				pathToClaudeCodeExecutable: this.claudeCodeExecutable,
				persistSession: false,
				settingSources: [],
				skills: [],
				tools: [],
			},
		});
		let sdkModels: ModelInfo[];
		try {
			sdkModels = await query.supportedModels();
		} finally {
			closePrompt.complete();
			query.close();
		}
		if (!Array.isArray(sdkModels) || sdkModels.length === 0) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent SDK returned an empty model catalog',
				{ field: 'supportedModels', value: 'empty' },
			);
		}

		const allowedEffortLevels = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
		const canonicalSource = sdkModels.map((model, index) => {
			if (
				typeof model.value !== 'string'
				|| model.value.length === 0
				|| typeof model.displayName !== 'string'
				|| model.displayName.length === 0
				|| typeof model.description !== 'string'
				|| (model.resolvedModel !== undefined && (
					typeof model.resolvedModel !== 'string' || model.resolvedModel.length === 0
				))
				|| (model.supportsEffort !== undefined && typeof model.supportsEffort !== 'boolean')
				|| (model.supportsAdaptiveThinking !== undefined && typeof model.supportsAdaptiveThinking !== 'boolean')
				|| (model.supportsFastMode !== undefined && typeof model.supportsFastMode !== 'boolean')
				|| (model.supportsAutoMode !== undefined && typeof model.supportsAutoMode !== 'boolean')
				|| (model.supportedEffortLevels !== undefined && (
					!Array.isArray(model.supportedEffortLevels)
					|| model.supportedEffortLevels.some(level => !allowedEffortLevels.has(level))
					|| new Set(model.supportedEffortLevels).size !== model.supportedEffortLevels.length
				))
				|| ((model.supportedEffortLevels?.length ?? 0) > 0) !== (model.supportsEffort === true)
			) {
				throw new AgentHostError(
					AgentHostErrorCode.InvalidProtocolValue,
					'Claude Agent SDK returned an invalid model entry',
					{ field: `supportedModels.${index}`, value: 'invalid' },
				);
			}
			return Object.freeze({
				value: model.value,
				...(model.resolvedModel === undefined ? {} : { resolvedModel: model.resolvedModel }),
				displayName: model.displayName,
				description: model.description,
				supportsEffort: model.supportsEffort === true,
				supportedEffortLevels: Object.freeze([...(model.supportedEffortLevels ?? [])]),
				supportsAdaptiveThinking: model.supportsAdaptiveThinking === true,
				supportsFastMode: model.supportsFastMode === true,
				supportsAutoMode: model.supportsAutoMode === true,
			});
		});
		if (new Set(canonicalSource.map(model => model.value)).size !== canonicalSource.length) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent SDK returned duplicate model identities',
				{ field: 'supportedModels.value', value: 'duplicate' },
			);
		}

		const catalogData = encodeAgentHostProtocolValue(Object.freeze({
			sdkVersion: this.packageRevision,
			models: canonicalSource,
		}));
		const catalogDigest = createHash('sha256').update(catalogData).digest('hex');
		const discovered = new Map<AgentModelId, IClaudeDiscoveredModel>();
		for (const model of canonicalSource) {
			const modelData = encodeAgentHostProtocolValue(model);
			const modelDigest = createHash('sha256').update(modelData).digest('hex');
			const modelId = createAgentModelId(`claude:${model.value}`);
			const effortLevels = model.supportedEffortLevels;
			const thinkingLevels: ClaudeAgentThinkingLevel[] = [
				'none',
				...(model.supportsAdaptiveThinking ? ['adaptive' as const] : []),
				...effortLevels,
			];
			const configurationSchema = createClaudeAgentModelConfigurationSchema(
				createAgentConfigurationSchemaRevision(`claude.agent-sdk.model.${modelDigest}`),
				Object.freeze(thinkingLevels),
			);
			const descriptor = Object.freeze({
				id: modelId,
				revision: createAgentModelDescriptorRevision(`claude.agent-sdk.model.${modelDigest}`),
				displayName: model.displayName,
				enabled: true,
				configurationSchema,
				toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
				attachments: Object.freeze({
					carriers: Object.freeze([]),
					shapes: Object.freeze([]),
					mediaTypes: Object.freeze([]),
					maximumCount: 0,
					maximumItemBytes: 0,
					maximumTotalBytes: 0,
					maximumTreeDepth: 0,
					maximumTreeEntries: 0,
					supportsClientContentForBackgroundExecution: false,
				}),
			});
			discovered.set(modelId, Object.freeze({
				sdkValue: model.value,
				supportsAutoMode: model.supportsAutoMode,
				descriptor,
			}));
		}
		const descriptor = createClaudeAgentDescriptor(
			createAgentDescriptorRevision(`claude.agent-sdk.descriptor.${catalogDigest}`),
			Object.freeze([...discovered.values()].map(model => model.descriptor)),
		);
		return Object.freeze({ descriptor, models: discovered });
	}

	resolveSessionConfiguration(
		request: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>,
	): Promise<IAgentRuntimeResponse<IAgentResolvedSessionConfiguration>> {
		this.assertCall(request);
		const hostDefaults = validateAndFreezeAgentConfigurationState(request.request.hostDefaults, {
			agent: CLAUDE_AGENT_ID,
			scope: 'hostDefault',
			revision: this.requireRegistration().hostDefaultsSchema.revision,
		});
		const candidate = validateAndFreezeAgentConfigurationCandidate(
			CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
			request.request.candidate,
			'session',
		);
		return Promise.resolve(response(request, Object.freeze({
			schema: CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
			values: resolveAgentSessionConfigurationValues(
				CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA,
				hostDefaults.values,
				candidate.values,
			),
		})));
	}

	completeSessionConfiguration(
		request: IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>,
	): Promise<IAgentRuntimeResponse<readonly IAgentConfigurationCompletion[]>> {
		this.assertCall(request);
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Claude Agent configuration uses static enum values',
			{ capability: `configurationCompletion:${request.request.property}` },
		));
	}

	prepareSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentPrepareSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		const session = this.requireSession(request.request.session);
		const current = this.validateSessionConfiguration(request.request.current);
		const candidate = this.validateSessionConfiguration(request.request.candidate);
		if (current.revision !== session.configuration.revision) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.StaleConfigurationSchema,
				'Claude Agent Session configuration state is stale',
				{ expected: session.configuration.revision, received: current.revision },
			));
		}
		this.beginOperation(request.request.operation, request.request.payloadDigest);
		const existing = this.configurationTransactions.get(request.request.operation);
		if (existing === undefined) {
			this.configurationTransactions.set(request.request.operation, {
				digest: request.request.payloadDigest,
				session: request.request.session,
				current,
				candidate,
				state: 'prepared',
			});
		} else if (
			existing.digest !== request.request.payloadDigest
			|| existing.session !== request.request.session
			|| existing.candidate.revision !== candidate.revision
		) {
			this.digestConflict(request.request.operation, existing.digest, request.request.payloadDigest);
		}
		return Promise.resolve(response(request, null));
	}

	commitSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		const transaction = this.requireConfigurationTransaction(request.request.operation, request.request.payloadDigest);
		if (transaction.candidate.revision !== request.request.configuration) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.StaleConfigurationSchema,
				'Claude Agent Session configuration decision is stale',
				{ expected: transaction.candidate.revision, received: request.request.configuration },
			));
		}
		if (transaction.state === 'prepared') {
			this.requireSession(transaction.session).configuration = transaction.candidate;
			transaction.state = 'committed';
			this.completeOperation(request.request.operation, null);
		}
		return Promise.resolve(response(request, null));
	}

	rollbackSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		const transaction = this.configurationTransactions.get(request.request.operation);
		if (transaction === undefined) {
			this.beginOperation(request.request.operation, request.request.payloadDigest);
			this.completeOperation(request.request.operation, null);
			return Promise.resolve(response(request, null));
		}
		this.assertOperationDigest(request.request.operation, transaction.digest, request.request.payloadDigest);
		if (transaction.candidate.revision !== request.request.configuration) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.StaleConfigurationSchema,
				'Claude Agent Session rollback decision is stale',
				{ expected: transaction.candidate.revision, received: request.request.configuration },
			));
		}
		if (transaction.state === 'prepared') {
			transaction.state = 'rolledBack';
			this.completeOperation(request.request.operation, null);
		}
		return Promise.resolve(response(request, null));
	}

	acknowledgeSessionConfigurationUpdate(
		request: IAgentRuntimeCall<IAgentAcknowledgeSessionConfigurationUpdateRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		const transaction = this.configurationTransactions.get(request.request.operation);
		if (transaction !== undefined) {
			this.assertOperationDigest(request.request.operation, transaction.digest, request.request.payloadDigest);
			const expectedDecision = transaction.state === 'committed' ? 'commit' : 'rollback';
			if (transaction.state === 'prepared' || request.request.decision !== expectedDecision) {
				return Promise.reject(new AgentHostError(
					AgentHostErrorCode.OperationNotPending,
					'Claude Agent Session configuration decision is not terminal',
					{ operation: request.request.operation },
				));
			}
			this.configurationTransactions.delete(request.request.operation);
		}
		return Promise.resolve(response(request, null));
	}

	resolveExecutionProfile(
		request: IAgentRuntimeCall<IAgentExecutionProfileRequest>,
	): Promise<IAgentRuntimeResponse<IAgentExecutionProfile>> {
		this.assertCall(request);
		const sessionConfiguration = this.validateSessionConfiguration(request.request.sessionConfiguration);
		if (
			request.request.selection.kind !== 'user'
			|| !exactRecord(request.request.selection.value, ['model'])
			|| typeof request.request.selection.value.model !== 'string'
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent execution requires an explicit discovered model',
				{ field: 'executionProfile.selection', value: request.request.selection.kind },
			);
		}
		const discoveredModel = this.discoveredModels.get(createAgentModelId(request.request.selection.value.model));
		if (discoveredModel === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent execution selected an unknown model',
				{ field: 'executionProfile.selection.model', value: request.request.selection.value.model },
			);
		}
		const modelConfiguration = resolveAgentModelConfigurationCandidate(
			discoveredModel.descriptor.configurationSchema,
			request.request.selection.configuration,
		);
		const permissionMode = sessionConfiguration.values[CLAUDE_AGENT_PERMISSION_MODE_PROPERTY];
		const thinkingLevel = modelConfiguration.values[CLAUDE_AGENT_THINKING_LEVEL_PROPERTY] ?? null;
		const credential = modelConfiguration.values[CLAUDE_AGENT_CREDENTIAL_PROPERTY];
		const thinkingProperty = discoveredModel.descriptor.configurationSchema.properties.find(
			property => property.id === CLAUDE_AGENT_THINKING_LEVEL_PROPERTY,
		);
		if (
			!['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'].includes(permissionMode as string)
			|| (permissionMode === 'auto' && !discoveredModel.supportsAutoMode)
			|| (thinkingLevel !== null && typeof thinkingLevel !== 'string')
			|| thinkingProperty?.value.type !== 'string'
			|| (thinkingLevel !== null && !thinkingProperty.value.enum?.includes(thinkingLevel))
			|| !exactRecord(credential, ['provider', 'scope', 'reference'])
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent execution profile configuration is invalid',
				{ field: 'executionProfile', value: 'invalid' },
			);
		}
		const data = encodeAgentHostProtocolValue(Object.freeze({
			kind: 'claudeAgentSdkExecutionProfile',
			model: discoveredModel.sdkValue,
			permissionMode,
			thinkingLevel,
			credential,
		}));
		const digest = createHash('sha256').update(data).digest('hex');
		return Promise.resolve(response(request, Object.freeze({
			revision: createAgentExecutionProfileRevision(`claude-agent-sdk:${digest}`),
			digest: createAgentExecutionProfileDigest(`sha256:${digest}`),
			agentDescriptor: this.requireDescriptor().revision,
			modelDescriptor: discoveredModel.descriptor.revision,
			data,
		})));
	}

	migrateResumeState(
		request: IAgentRuntimeCall<IAgentResumeMigrationRequest>,
	): Promise<IAgentRuntimeResponse<IAgentResumeState>> {
		this.assertCall(request);
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Claude Agent Runtime declares no resume migration edge',
			{ capability: `resumeMigration:${request.request.source.schema}:${request.request.targetSchema}` },
		));
	}

	createSession(
		request: IAgentRuntimeCall<IAgentCreateSessionOptions>,
	): Promise<IAgentRuntimeResponse<IAgentSessionBacking>> {
		this.assertCall(request);
		const value = this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			if (this.sessions.has(request.request.session)) {
				return resourceMissing(`sessionAlreadyExists:${request.request.session}`);
			}
			const resume: IClaudeSessionResumeData = Object.freeze({
				kind: 'claude-agent-sdk-session',
				version: 2,
				workingDirectory: request.request.workspace?.folders[0]?.workingDirectory ?? this.stateDirectory,
				additionalDirectories: Object.freeze(
					request.request.workspace?.folders.slice(1).map(folder => folder.workingDirectory) ?? [],
				),
			});
			const workspaceDirectories = [resume.workingDirectory, ...resume.additionalDirectories];
			if (
				workspaceDirectories.some(directory => !isAbsolute(directory))
				|| new Set(workspaceDirectories).size !== workspaceDirectories.length
			) {
				throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude workspace path is invalid', {
					field: 'workspace.folders.workingDirectory', value: 'invalid',
				});
			}
			this.sessions.set(request.request.session, {
				configuration: this.validateSessionConfiguration(request.request.configuration),
				resume,
				materialized: true,
				chats: new Map(),
			});
			return Object.freeze({ session: request.request.session, resume: this.resumeState(resume) });
		});
		return Promise.resolve(response(request, value as IAgentSessionBacking));
	}

	materializeSession(
		request: IAgentRuntimeCall<IAgentMaterializeSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			const configuration = this.validateSessionConfiguration(request.request.configuration);
			const existing = this.sessions.get(request.request.session);
			if (existing === undefined) {
				const resume = this.parseSessionResume(request.request.resume);
				this.sessions.set(request.request.session, {
					configuration,
					resume,
					materialized: true,
					chats: new Map(),
				});
			} else {
				existing.configuration = configuration;
				existing.materialized = true;
			}
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	releaseSession(
		request: IAgentRuntimeCall<IAgentReleaseSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			const session = this.requireSession(request.request.session);
			session.materialized = false;
			for (const chat of session.chats.values()) { chat.materialized = false; }
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	async deleteSession(
		request: IAgentRuntimeCall<IAgentDeleteSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		await this.runAsyncOperation(request.request.operation, request.request.payloadDigest, async () => {
			const session = this.sessions.get(request.request.session);
			if (session !== undefined) {
				for (const chat of session.chats.values()) {
					await this.deleteChatBacking(session, chat);
					await this.clearSdkCache(chat.resume.sdkSessionId);
				}
			}
			this.sessions.delete(request.request.session);
			this.deleteTerminalTurns(`${request.request.session}\u0000`);
			return null;
		});
		return response(request, null);
	}

	createChat(
		request: IAgentRuntimeCall<IAgentCreateChatOptions>,
	): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		this.assertCall(request);
		const value = this.runOperation(request.request.operation, request.request.payloadDigest, () => (
			this.createChatState(request.request.session, request.request.chat)
		));
		return Promise.resolve(response(request, value as IAgentChatBacking));
	}

	materializeChat(
		request: IAgentRuntimeCall<IAgentMaterializeChatRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			const session = this.requireMaterializedSession(request.request.session);
			const existing = session.chats.get(request.request.chat);
			if (existing === undefined) {
				session.chats.set(request.request.chat, {
					resume: this.parseChatResume(request.request.resume),
					materialized: true,
				});
			} else {
				existing.materialized = true;
			}
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	releaseChat(
		request: IAgentRuntimeCall<IAgentReleaseChatRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			this.requireChat(request.request.session, request.request.chat).materialized = false;
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	forkChat(request: IAgentRuntimeCall<IAgentForkChatRequest>): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		this.assertCall(request);
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Claude Agent SDK chat forking is not supported',
			{ capability: 'chats.fork' },
		));
	}

	async send(request: IAgentRuntimeCall<IAgentChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		const chat = this.requireMaterializedChat(request.request.session, request.request.chat);
		if (request.request.attachments.length !== 0 || request.request.interactionTargets.length !== 0) {
			throw new AgentHostError(
				AgentHostErrorCode.CapabilityUnsupported,
				'Claude Agent SDK runtime does not declare attachments or interaction targets',
				{ capability: 'turn.content' },
			);
		}
		const operation = this.operations.get(request.request.operation);
		if (operation !== undefined) {
			this.assertOperationDigest(request.request.operation, operation.digest, request.request.payloadDigest);
			if (operation.state === 'completed') { return response(request, null); }
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Claude Agent Runtime operation is already pending',
				{ operation: request.request.operation },
			);
		}
		const turn = this.turnKey(request.request.session, request.request.chat, request.request.turn);
		if (this.activeTurns.has(turn)) {
			throw new AgentHostError(AgentHostErrorCode.OperationNotPending, 'Claude Turn is already active', {
				operation: request.request.operation,
			});
		}
		this.beginOperation(request.request.operation, request.request.payloadDigest);
		if (this.terminalTurns.has(turn)) {
			this.completeOperation(request.request.operation, null);
			return response(request, null);
		}
		const active: IClaudeActiveTurn = {
			request,
			abortController: new AbortController(),
		};
		this.activeTurns.set(turn, active);
		this.emit(request, Object.freeze({
			kind: 'turnProgress',
			session: request.request.session,
			chat: request.request.chat,
			turn: request.request.turn,
			progress: Object.freeze({ kind: 'state', state: 'running' }),
		}));

		try {
			await this.runClaudeTurn(active, chat);
		} catch {
			if (!this.terminalTurns.has(turn)) {
				this.emitTerminal(request, active.abortController.signal.aborted ? 'cancelled' : 'failed', {
					kind: 'claudeAgentSdkError',
					message: 'Claude Agent SDK turn failed',
				});
			}
		} finally {
			active.query?.close();
			this.activeTurns.delete(turn);
			this.completeOperation(request.request.operation, null);
		}
		return response(request, null);
	}

	steer(request: IAgentRuntimeCall<IAgentSteerRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Claude Agent SDK steering is not supported',
			{ capability: 'chats.steer' },
		));
	}

	cancel(request: IAgentRuntimeCall<IAgentCancelTurnRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.requireMaterializedChat(request.request.session, request.request.chat);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			const turn = this.turnKey(request.request.session, request.request.chat, request.request.turn);
			const active = this.activeTurns.get(turn);
			if (active !== undefined) {
				active.abortController.abort();
				active.query?.close();
				this.cancelHostOperations(active.request.call);
			}
			if (!this.terminalTurns.has(turn)) {
				this.emitTerminal(request, 'cancelled');
			}
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	async deleteChat(request: IAgentRuntimeCall<IAgentDeleteChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		await this.runAsyncOperation(request.request.operation, request.request.payloadDigest, async () => {
			const session = this.sessions.get(request.request.session);
			const chat = session?.chats.get(request.request.chat);
			if (session !== undefined && chat !== undefined) {
				await this.deleteChatBacking(session, chat);
				await this.clearSdkCache(chat.resume.sdkSessionId);
				session.chats.delete(request.request.chat);
			}
			this.deleteTerminalTurns(`${request.request.session}\u0000${request.request.chat}\u0000`);
			return null;
		});
		return response(request, null);
	}

	getOperationOutcome(
		request: IAgentRuntimeCall<IAgentRuntimeOperationOutcomeRequest>,
	): Promise<IAgentRuntimeResponse<AgentRuntimeOperationOutcome>> {
		this.assertCall(request);
		const operation = this.operations.get(request.request.operation);
		const outcome: AgentRuntimeOperationOutcome = operation === undefined
			? Object.freeze({ kind: 'unknown' })
			: operation.digest !== request.request.digest
				? Object.freeze({ kind: 'conflict', recordedDigest: operation.digest })
				: operation.state === 'pending'
					? Object.freeze({ kind: 'pending' })
					: Object.freeze({ kind: 'completed', value: operation.value });
		return Promise.resolve(response(request, outcome));
	}

	reportHostOperationProgress(progress: IAgentRuntimeHostOperationProgress): Promise<void> {
		this.assertConnectedEnvelope(progress);
		const operation = this.hostOperations.get(progress.operation);
		if (
			operation === undefined
			|| operation.parentCall !== progress.parentCall
			|| operation.registration !== progress.registration
			|| operation.agent !== progress.agent
		) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.OperationNotFound,
				'Claude Agent Runtime has no matching Host operation',
				{ operation: progress.operation },
			));
		}
		return Promise.resolve();
	}

	completeHostOperation(result: IAgentRuntimeHostOperationResponse): Promise<void> {
		this.assertConnectedEnvelope(result);
		const operation = this.hostOperations.get(result.operation);
		if (
			operation === undefined
			|| operation.parentCall !== result.parentCall
			|| operation.registration !== result.registration
			|| operation.agent !== result.agent
		) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.OperationNotFound,
				'Claude Agent Runtime has no matching Host operation',
				{ operation: result.operation },
			));
		}
		this.hostOperations.delete(result.operation);
		operation.completion.complete(result.outcome);
		return Promise.resolve();
	}

	private async runClaudeTurn(active: IClaudeActiveTurn, chat: IClaudeChatState): Promise<void> {
		const request = active.request;
		const profile = this.executionProfile(request.request.binding.profile.data);
		const credential = this.requireCredential(request.request.binding.credentials, profile.credential);
		const apiKey = await this.requestHostValue(request, {
			kind: 'credential.resolve',
			credential,
		});
		if (typeof apiKey !== 'string') {
			throw new AgentHostError(
				AgentHostErrorCode.CredentialUnavailable,
				'Claude API credential is unavailable',
				{ provider: credential.provider, scope: credential.scope },
			);
		}
		const registrationsBySdkName = new Map<string, IAgentToolRegistration>();
		const sdkTools = request.request.binding.toolSet.registrations.map(registration => {
			const sdkName = `mcp__${claudeMcpServerName}__${registration.descriptor.functionName}`;
			if (registrationsBySdkName.has(sdkName)) {
				throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude SDK Tool names are not unique', {
					field: 'tool.functionName', value: registration.descriptor.functionName,
				});
			}
			registrationsBySdkName.set(sdkName, registration);
			return claudeTool(
				registration.descriptor.functionName,
				registration.descriptor.description,
				inputShape(registration),
				async input => this.executeTool(request, registration, input),
			);
		});
		const permissionMode = profile.permissionMode;
		const sdkCacheDirectory = await this.resolveSdkCache(chat.resume.sdkSessionId);
		const options: ClaudeAgentSdkOptions = {
			abortController: active.abortController,
			additionalDirectories: [...this.requireSession(request.request.session).resume.additionalDirectories],
			allowDangerouslySkipPermissions: permissionMode === 'bypassPermissions',
			canUseTool: async (toolName, input) => registrationsBySdkName.has(toolName)
				? Object.freeze({ behavior: 'allow', updatedInput: input })
				: Object.freeze({ behavior: 'deny', message: `Tool "${toolName}" is outside the accepted Host Tool set.` }),
			cwd: this.requireSession(request.request.session).resume.workingDirectory,
			env: this.claudeEnvironment(apiKey, sdkCacheDirectory),
			includePartialMessages: false,
			mcpServers: {
				[claudeMcpServerName]: createSdkMcpServer({
					name: claudeMcpServerName,
					version: '1.0.0',
					tools: sdkTools,
					alwaysLoad: true,
				}),
			},
			model: profile.model,
			pathToClaudeCodeExecutable: this.claudeCodeExecutable,
			permissionMode,
			persistSession: true,
			resume: chat.resume.started ? chat.resume.sdkSessionId : undefined,
			sandbox: {
				enabled: true,
				failIfUnavailable: true,
				allowUnsandboxedCommands: false,
				network: {
					allowedDomains: ['api.anthropic.com'],
					allowManagedDomainsOnly: true,
					allowLocalBinding: false,
					allowAllUnixSockets: false,
				},
			},
			sessionId: chat.resume.started ? undefined : chat.resume.sdkSessionId,
			sessionStore: this.sessionStore,
			sessionStoreFlush: 'eager',
			settingSources: [],
			skills: [],
			strictMcpConfig: true,
			systemPrompt: { type: 'preset', preset: 'claude_code' },
			tools: [],
			...(profile.thinkingLevel === null
				? {}
				: {
					thinking: profile.thinkingLevel === 'none'
						? Object.freeze({ type: 'disabled' as const })
						: Object.freeze({ type: 'adaptive' as const }),
				}),
			...(profile.thinkingLevel !== null
				&& ['low', 'medium', 'high', 'xhigh', 'max'].includes(profile.thinkingLevel)
				? { effort: profile.thinkingLevel as 'low' | 'medium' | 'high' | 'xhigh' | 'max' }
				: {}),
		};
		const stream = this.query({ prompt: request.request.message, options });
		active.query = stream;
		let terminal = false;
		for await (const message of stream) {
			terminal = this.consumeSdkMessage(request, chat, message) || terminal;
		}
		if (!terminal && !this.terminalTurns.has(this.turnKey(request.request.session, request.request.chat, request.request.turn))) {
			throw new Error('Claude Agent SDK ended without a terminal result.');
		}
	}

	private consumeSdkMessage(
		request: IAgentRuntimeCall<IAgentChatRequest>,
		chat: IClaudeChatState,
		message: SDKMessage,
	): boolean {
		if (message.type === 'system' && message.subtype === 'init') {
			if (message.session_id !== chat.resume.sdkSessionId) {
				throw new Error('Claude Agent SDK session identity changed.');
			}
			if (!chat.resume.started) {
				chat.resume = Object.freeze({ ...chat.resume, started: true });
				this.emit(request, Object.freeze({
					kind: 'chatResumeStateChanged',
					session: request.request.session,
					chat: request.request.chat,
					resume: this.resumeState(chat.resume),
				}));
			}
			return false;
		}
		if (message.type === 'assistant' && message.parent_tool_use_id === null) {
			for (const block of message.message.content) {
				if (block.type === 'text' && block.text.length > 0) {
					this.emitResponsePart(request, Object.freeze({ kind: 'text', text: block.text }));
				} else if (block.type === 'thinking' && block.thinking.length > 0) {
					this.emitResponsePart(request, Object.freeze({ kind: 'reasoning', text: block.thinking }));
				}
			}
			return false;
		}
		if (message.type === 'result') {
			if (message.subtype === 'success') {
				this.emitTerminal(request, 'completed');
			} else {
				this.emitTerminal(request, 'failed', Object.freeze({
					kind: 'claudeAgentSdkResult',
					subtype: message.subtype,
					terminalReason: message.terminal_reason ?? null,
				}));
			}
			return true;
		}
		return false;
	}

	private async executeTool(
		request: IAgentRuntimeCall<IAgentChatRequest>,
		registration: IAgentToolRegistration,
		input: Record<string, unknown>,
	): Promise<{ content: Array<{ type: 'text'; text: string }>; isError?: boolean }> {
		assertAgentHostProtocolValue(input);
		const call = await this.createToolCall(request, registration, input);
		this.emitResponsePart(request, Object.freeze({
			kind: 'toolCall',
			call: call.id,
			tool: call.tool,
			input: call.input,
		}));
		const value = await this.requestHostValue(request, { kind: 'tool.execute', call });
		assertAgentToolResult(value);
		const result: AgentToolResult = value;
		if (result.call !== call.id) {
			throw new Error('Claude Host Tool result identity changed.');
		}
		if (result.status === 'completed') {
			this.emitResponsePart(request, Object.freeze({
				kind: 'toolResult',
				call: call.id,
				status: 'completed',
				output: result.output,
			}));
			return { content: [{ type: 'text', text: encodeAgentHostProtocolValue(result.output) }] };
		}
		this.emitResponsePart(request, Object.freeze({
			kind: 'toolResult',
			call: call.id,
			status: result.status,
			output: result.failure.data,
		}));
		return { content: [{ type: 'text', text: result.failure.message }], isError: true };
	}

	private async createToolCall(
		request: IAgentRuntimeCall<IAgentChatRequest>,
		registration: IAgentToolRegistration,
		input: AgentHostProtocolValue,
	): Promise<IAgentToolCall> {
		const id = createAgentToolCallId(`claude-sdk:${request.request.turn}:${this.nextToolCall++}`);
		const deadline = Math.min(
			request.request.binding.deadline,
			Date.now() + registration.descriptor.limits.timeoutMilliseconds,
		);
		const common = Object.freeze({
			id,
			agent: CLAUDE_AGENT_ID,
			registration: this.requireRegistration().revision,
			session: request.request.session,
			chat: request.request.chat,
			turn: request.request.turn,
			toolSet: request.request.binding.toolSet.revision,
			tool: registration.descriptor.id,
			descriptor: registration.descriptor.revision,
			registrationId: registration.id,
			registrationRevision: registration.revision,
			input,
			deadline,
		});
		if (registration.descriptor.safety === 'read') {
			return Object.freeze({ ...common, effect: Object.freeze({ kind: 'read' }) });
		}
		const operation = createAgentHostOperationId(`claude-sdk-tool:${request.request.turn}:${this.nextToolCall}`);
		const payloadDigest = await computeAgentToolMutationPayloadDigest({
			...common,
			effect: Object.freeze({ kind: 'mutation', operation }),
		});
		return Object.freeze({
			...common,
			effect: Object.freeze({ kind: 'mutation', operation, payloadDigest }),
		});
	}

	private async deleteChatBacking(session: IClaudeSessionState, chat: IClaudeChatState): Promise<void> {
		if (chat.resume.started) {
			await this.deleteClaudeSession(chat.resume.sdkSessionId, {
				dir: session.resume.workingDirectory,
				sessionStore: this.sessionStore,
			});
		}
	}

	private async clearSdkCache(sdkSessionId: string): Promise<void> {
		if (!claudeSdkSessionIdPattern.test(sdkSessionId)) {
			throw new Error('Claude Agent SDK cache Session identity is invalid.');
		}
		const cacheRoot = await this.cacheRoot();
		const cacheDirectory = join(cacheRoot, sdkSessionId);
		let metadata;
		try {
			metadata = await lstat(cacheDirectory);
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return;
			}
			throw error;
		}
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Claude Agent SDK cache must be a real directory.');
		}
		const canonicalCacheDirectory = await realpath(cacheDirectory);
		if (canonicalCacheDirectory !== cacheDirectory) {
			throw new Error('Claude Agent SDK cache has the wrong canonical address.');
		}
		await rm(canonicalCacheDirectory, { recursive: true });
	}

	private async resolveSdkCache(sdkSessionId: string): Promise<string> {
		if (!claudeSdkSessionIdPattern.test(sdkSessionId)) {
			throw new Error('Claude Agent SDK cache Session identity is invalid.');
		}
		const cacheRoot = await this.cacheRoot();
		const cacheDirectory = join(cacheRoot, sdkSessionId);
		await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
		const metadata = await lstat(cacheDirectory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Claude Agent SDK cache must be a real directory.');
		}
		const canonicalCacheDirectory = await realpath(cacheDirectory);
		if (canonicalCacheDirectory !== cacheDirectory) {
			throw new Error('Claude Agent SDK cache has the wrong canonical address.');
		}
		await chmod(canonicalCacheDirectory, 0o700);
		return canonicalCacheDirectory;
	}

	private async resolveModelCatalogCache(): Promise<string> {
		const cacheRoot = await this.cacheRoot();
		const cacheDirectory = join(cacheRoot, 'model-catalog');
		await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
		const metadata = await lstat(cacheDirectory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Claude Agent SDK model catalog cache must be a real directory.');
		}
		const canonicalCacheDirectory = await realpath(cacheDirectory);
		if (canonicalCacheDirectory !== cacheDirectory) {
			throw new Error('Claude Agent SDK model catalog cache has the wrong canonical address.');
		}
		await chmod(canonicalCacheDirectory, 0o700);
		return canonicalCacheDirectory;
	}

	private cacheRoot(): Promise<string> {
		this.cacheRootPromise ??= this.resolveCacheRoot();
		return this.cacheRootPromise;
	}

	private async resolveCacheRoot(): Promise<string> {
		await mkdir(this.cacheDirectory, { recursive: true, mode: 0o700 });
		const metadata = await lstat(this.cacheDirectory);
		if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
			throw new Error('Claude Agent SDK cache root must be a real directory.');
		}
		const cacheRoot = await realpath(this.cacheDirectory);
		if (cacheRoot !== this.cacheDirectory) {
			throw new Error('Claude Agent SDK cache root has the wrong canonical address.');
		}
		await chmod(cacheRoot, 0o700);
		return cacheRoot;
	}

	private async requestHostValue(
		parent: IAgentRuntimeCall<IAgentChatRequest>,
		request: AgentRuntimeHostOperation,
	): Promise<AgentRuntimeHostOperationValue> {
		const operation = createAgentRuntimeHostOperationId(
			`claude-sdk-host:${parent.request.turn}:${this.nextHostOperation++}`,
		);
		const completion = new DeferredPromise<AgentRuntimeHostOperationOutcome>();
		this.hostOperations.set(operation, {
			parentCall: parent.call,
			registration: this.requireRegistration().revision,
			agent: CLAUDE_AGENT_ID,
			completion,
		});
		this.hostOperationEmitter.fire(Object.freeze({
			connection: this.connection,
			generation: this.generation,
			operation,
			parentCall: parent.call,
			registration: this.requireRegistration().revision,
			agent: CLAUDE_AGENT_ID,
			request,
		}));
		const outcome = await completion.p;
		if (outcome.kind === 'completed') {
			return outcome.value;
		}
		if (outcome.kind === 'cancelled') {
			throw new Error('Claude Host operation was cancelled.');
		}
		throw new Error(outcome.message);
	}

	private cancelHostOperations(parentCall: AgentRuntimeCallId): void {
		for (const operation of this.hostOperations.values()) {
			if (operation.parentCall === parentCall) {
				operation.completion.complete(Object.freeze({ kind: 'cancelled' }));
			}
		}
	}

	private executionProfile(data: string): IClaudeExecutionProfileData {
		let value: unknown;
		try { value = JSON.parse(data); } catch { value = undefined; }
		if (!exactRecord(value, ['kind', 'model', 'permissionMode', 'thinkingLevel', 'credential'])) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude execution profile is invalid', {
				field: 'binding.profile.data', value: 'invalid',
			});
		}
		const profile = value as unknown as IClaudeExecutionProfileData;
		if (
			profile.kind !== 'claudeAgentSdkExecutionProfile'
			|| typeof profile.model !== 'string'
			|| profile.model.length === 0
			|| !['default', 'acceptEdits', 'bypassPermissions', 'plan', 'auto'].includes(profile.permissionMode)
			|| (profile.thinkingLevel !== null
				&& !['none', 'adaptive', 'low', 'medium', 'high', 'xhigh', 'max'].includes(profile.thinkingLevel))
			|| !exactRecord(profile.credential, ['provider', 'scope', 'reference'])
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude execution profile is invalid', {
				field: 'binding.profile.data', value: 'invalid',
			});
		}
		return profile;
	}

	private requireCredential(
		credentials: readonly IAgentCredentialReference[],
		expected: IAgentCredentialReference,
	): IAgentCredentialReference {
		if (
			credentials.length !== 1
			|| credentials[0].provider !== CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER
			|| credentials[0].scope !== 'llm'
			|| credentials[0].reference !== CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE
			|| encodeAgentHostProtocolValue(credentials[0]) !== encodeAgentHostProtocolValue(expected)
		) {
			throw new AgentHostError(
				AgentHostErrorCode.CredentialUnauthorized,
				'Claude API credential is not authorized',
				{ provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER, scope: 'llm' },
			);
		}
		return credentials[0];
	}

	private claudeEnvironment(apiKey: string, sdkCacheDirectory: string): Readonly<Record<string, string>> {
		const environment: Record<string, string> = {
			ANTHROPIC_API_KEY: apiKey,
			CLAUDE_AGENT_SDK_CLIENT_APP: 'comet-studio/0.1.0',
			CLAUDE_CONFIG_DIR: sdkCacheDirectory,
			HOME: sdkCacheDirectory,
		};
		if (process.platform === 'win32') {
			environment.USERPROFILE = sdkCacheDirectory;
			environment.SYSTEMROOT = 'C:\\Windows';
		} else {
			environment.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
		}
		return Object.freeze(environment);
	}

	private claudeDiscoveryEnvironment(sdkCacheDirectory: string): Readonly<Record<string, string>> {
		const environment: Record<string, string> = {
			CLAUDE_AGENT_SDK_CLIENT_APP: 'comet-studio/0.1.0',
			CLAUDE_CONFIG_DIR: sdkCacheDirectory,
			HOME: sdkCacheDirectory,
		};
		if (process.platform === 'win32') {
			environment.USERPROFILE = sdkCacheDirectory;
			environment.SYSTEMROOT = 'C:\\Windows';
		} else {
			environment.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';
		}
		return Object.freeze(environment);
	}

	private requireDescriptor(): IAgentDescriptor {
		if (this.descriptor === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent Runtime descriptor is unavailable before initialization',
				{ field: 'runtime.descriptor', value: 'uninitialized' },
			);
		}
		return this.descriptor;
	}

	private requireRegistration(): ReturnType<typeof createClaudeAgentRuntimeRegistration> {
		const descriptor = this.requireDescriptor();
		if (
			this.registration === undefined
			|| this.registration.descriptorRevision !== descriptor.revision
			|| this.registration.revision !== createClaudeAgentRuntimeRegistrationRevision(descriptor.revision)
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Claude Agent Runtime registration is unavailable before initialization',
				{ field: 'runtime.registration', value: 'uninitialized' },
			);
		}
		return this.registration;
	}

	private validateSessionConfiguration(value: IAgentConfigurationState): IAgentConfigurationState {
		return validateAndFreezeAgentConfigurationState(value, {
			agent: CLAUDE_AGENT_ID,
			scope: 'session',
			revision: CLAUDE_AGENT_SESSION_CONFIGURATION_SCHEMA.revision,
		});
	}

	private createChatState(sessionId: AgentSessionId, chatId: AgentChatId): IAgentChatBacking {
		const session = this.requireMaterializedSession(sessionId);
		if (session.chats.has(chatId)) { return resourceMissing(`chatAlreadyExists:${sessionId}:${chatId}`); }
		const resume: IClaudeChatResumeData = Object.freeze({
			kind: 'claude-agent-sdk-chat',
			version: 1,
			sdkSessionId: randomUUID(),
			started: false,
		});
		session.chats.set(chatId, { resume, materialized: true });
		return Object.freeze({ session: sessionId, chat: chatId, resume: this.resumeState(resume) });
	}

	private parseSessionResume(resume: IAgentResumeState | undefined): IClaudeSessionResumeData {
		const value = this.parseResume(resume);
		if (
			!exactRecord(value, ['kind', 'version', 'workingDirectory', 'additionalDirectories'])
			|| value.kind !== 'claude-agent-sdk-session'
			|| value.version !== 2
			|| typeof value.workingDirectory !== 'string'
			|| !isAbsolute(value.workingDirectory)
			|| !Array.isArray(value.additionalDirectories)
			|| value.additionalDirectories.some(directory => typeof directory !== 'string' || !isAbsolute(directory))
			|| new Set([value.workingDirectory, ...value.additionalDirectories]).size !== value.additionalDirectories.length + 1
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude Session resume state is invalid', {
				field: 'resume.data', value: 'invalid',
			});
		}
		return Object.freeze(value as unknown as IClaudeSessionResumeData);
	}

	private parseChatResume(resume: IAgentResumeState | undefined): IClaudeChatResumeData {
		const value = this.parseResume(resume);
		if (
			!exactRecord(value, ['kind', 'version', 'sdkSessionId', 'started'])
			|| value.kind !== 'claude-agent-sdk-chat'
			|| value.version !== 1
			|| typeof value.sdkSessionId !== 'string'
			|| !claudeSdkSessionIdPattern.test(value.sdkSessionId)
			|| typeof value.started !== 'boolean'
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude Chat resume state is invalid', {
				field: 'resume.data', value: 'invalid',
			});
		}
		return Object.freeze(value as unknown as IClaudeChatResumeData);
	}

	private parseResume(resume: IAgentResumeState | undefined): unknown {
		if (resume === undefined || resume.schema !== CLAUDE_AGENT_RESUME_SCHEMA) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude resume schema is unsupported', {
				field: 'resume.schema', value: resume?.schema ?? 'missing',
			});
		}
		try { return JSON.parse(resume.data); } catch { return undefined; }
	}

	private resumeState(data: IClaudeSessionResumeData | IClaudeChatResumeData): IAgentResumeState {
		return Object.freeze({ schema: CLAUDE_AGENT_RESUME_SCHEMA, data: JSON.stringify(data) });
	}

	private requireSession(sessionId: AgentSessionId): IClaudeSessionState {
		return this.sessions.get(sessionId) ?? resourceMissing(`session:${sessionId}`);
	}

	private requireMaterializedSession(sessionId: AgentSessionId): IClaudeSessionState {
		const session = this.requireSession(sessionId);
		if (!session.materialized) { return resourceMissing(`materializedSession:${sessionId}`); }
		return session;
	}

	private requireChat(sessionId: AgentSessionId, chatId: AgentChatId): IClaudeChatState {
		return this.requireSession(sessionId).chats.get(chatId) ?? resourceMissing(`chat:${sessionId}:${chatId}`);
	}

	private requireMaterializedChat(sessionId: AgentSessionId, chatId: AgentChatId): IClaudeChatState {
		const chat = this.requireMaterializedSession(sessionId).chats.get(chatId)
			?? resourceMissing(`chat:${sessionId}:${chatId}`);
		if (!chat.materialized) { return resourceMissing(`materializedChat:${sessionId}:${chatId}`); }
		return chat;
	}

	private emitResponsePart(request: IAgentRuntimeCall<IAgentChatRequest>, part: AgentTurnResponsePart): void {
		this.emit(request, Object.freeze({
			kind: 'turnProgress',
			session: request.request.session,
			chat: request.request.chat,
			turn: request.request.turn,
			progress: Object.freeze({ kind: 'response', part }),
		}));
	}

	private emitTerminal(
		request: IAgentRuntimeCall<IAgentChatRequest | IAgentCancelTurnRequest>,
		state: 'completed' | 'cancelled' | 'failed',
		data?: AgentHostProtocolValue,
	): void {
		const turn = this.turnKey(request.request.session, request.request.chat, request.request.turn);
		if (this.terminalTurns.has(turn)) { return; }
		this.emit(request, Object.freeze({
			kind: 'turnTerminal',
			session: request.request.session,
			chat: request.request.chat,
			turn: request.request.turn,
			state,
			...(data === undefined ? {} : { data }),
		}));
		this.recordTerminalTurn(turn);
	}

	private emit<TRequest>(request: IAgentRuntimeCall<TRequest>, action: IAgentAction): void {
		this.actionEmitter.fire(Object.freeze({
			connection: this.connection,
			generation: this.generation,
			sequence: createAgentRuntimeActionSequence(this.nextActionSequence++),
			call: request.call,
			registration: request.registration,
			agent: request.agent,
			action,
		}));
	}

	private turnKey(session: AgentSessionId, chat: AgentChatId, turn: string): string {
		return `${session}\u0000${chat}\u0000${turn}`;
	}

	private recordTerminalTurn(turn: string): void {
		this.terminalTurns.add(turn);
		while (this.terminalTurns.size > this.maximumRetainedTerminalTurns) {
			const oldest = this.terminalTurns.values().next().value as string | undefined;
			if (oldest === undefined) { throw new Error('Claude terminal Turn retention is inconsistent.'); }
			this.terminalTurns.delete(oldest);
		}
	}

	private deleteTerminalTurns(prefix: string): void {
		for (const turn of this.terminalTurns) {
			if (turn.startsWith(prefix)) { this.terminalTurns.delete(turn); }
		}
	}

	private runOperation<TValue extends AgentHostProtocolValue | object>(
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
		run: () => TValue,
	): TValue {
		const existing = this.operations.get(operation);
		if (existing !== undefined) {
			this.assertOperationDigest(operation, existing.digest, digest);
			if (existing.state === 'completed') { return existing.value as unknown as TValue; }
			throw new AgentHostError(AgentHostErrorCode.OperationNotPending, 'Claude Agent Runtime operation is already pending', { operation });
		}
		this.beginOperation(operation, digest);
		try {
			const value = run();
			assertAgentHostProtocolValue(value);
			this.completeOperation(operation, value);
			return value;
		} catch (error) {
			this.operations.delete(operation);
			throw error;
		}
	}

	private async runAsyncOperation<TValue extends AgentHostProtocolValue | object>(
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
		run: () => Promise<TValue>,
	): Promise<TValue> {
		const existing = this.operations.get(operation);
		if (existing !== undefined) {
			this.assertOperationDigest(operation, existing.digest, digest);
			if (existing.state === 'completed') { return existing.value as unknown as TValue; }
			throw new AgentHostError(AgentHostErrorCode.OperationNotPending, 'Claude Agent Runtime operation is already pending', { operation });
		}
		this.beginOperation(operation, digest);
		try {
			const value = await run();
			assertAgentHostProtocolValue(value);
			this.completeOperation(operation, value);
			return value;
		} catch (error) {
			this.operations.delete(operation);
			throw error;
		}
	}

	private beginOperation(operation: AgentHostOperationId, digest: AgentHostPayloadDigest): void {
		const existing = this.operations.get(operation);
		if (existing !== undefined) {
			this.assertOperationDigest(operation, existing.digest, digest);
			return;
		}
		this.operations.set(operation, { digest, state: 'pending', value: null });
	}

	private completeOperation(operation: AgentHostOperationId, value: AgentHostProtocolValue | object): void {
		assertAgentHostProtocolValue(value);
		const record = this.operations.get(operation) ?? resourceMissing(`operation:${operation}`);
		record.state = 'completed';
		record.value = value;
		this.operations.delete(operation);
		this.operations.set(operation, record);
		let completedCount = [...this.operations.values()].filter(candidate => candidate.state === 'completed').length;
		while (completedCount > this.maximumRetainedOperations) {
			const oldest = [...this.operations].find(([, candidate]) => candidate.state === 'completed');
			if (oldest === undefined) { throw new Error('Claude operation retention is inconsistent.'); }
			this.operations.delete(oldest[0]);
			completedCount -= 1;
		}
	}

	private requireConfigurationTransaction(
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
	): IClaudeConfigurationTransaction {
		const transaction = this.configurationTransactions.get(operation)
			?? resourceMissing(`configurationTransaction:${operation}`);
		this.assertOperationDigest(operation, transaction.digest, digest);
		return transaction;
	}

	private assertOperationDigest(operation: AgentHostOperationId, recorded: AgentHostPayloadDigest, received: AgentHostPayloadDigest): void {
		if (recorded !== received) { this.digestConflict(operation, recorded, received); }
	}

	private digestConflict(
		operation: AgentHostOperationId,
		recordedDigest: AgentHostPayloadDigest,
		receivedDigest: AgentHostPayloadDigest,
	): never {
		throw new AgentHostError(
			AgentHostErrorCode.OperationDigestConflict,
			'Claude Agent Runtime operation digest conflicts with the recorded operation',
			{ operation, recordedDigest, receivedDigest },
		);
	}

	private validateRetentionLimit(value: number, field: keyof IClaudeAgentRuntimeRetentionLimits): number {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude Agent Runtime retention limit is invalid', {
				field, value,
			});
		}
		return value;
	}

	private assertCall<TRequest>(request: IAgentRuntimeCall<TRequest>): void {
		this.assertConnectedEnvelope(request);
		if (
			this.initializationState !== 'initialized'
			|| request.registration !== this.requireRegistration().revision
			|| request.agent !== CLAUDE_AGENT_ID
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude Agent Runtime call authority does not match', {
				field: 'runtimeCall.authority', value: request.agent,
			});
		}
	}

	private assertConnectedEnvelope(value: {
		readonly connection: AgentRuntimeConnectionId;
		readonly generation: AgentRuntimeConnectionGeneration;
	}): void {
		this.assertConnected();
		if (value.connection !== this.connection || value.generation !== this.generation) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude Agent Runtime connection generation does not match', {
				field: 'connection', value: value.connection,
			});
		}
	}

	private assertConnected(): void {
		if (this.stateValue.kind !== 'connected') {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Claude Agent Runtime is disconnected', {
				field: 'state', value: this.stateValue.kind,
			});
		}
	}

	disconnect(reason: Exclude<AgentRuntimeDisconnectReason, 'disposed'>): void {
		this.terminate(reason);
	}

	private terminate(reason: AgentRuntimeDisconnectReason): void {
		if (this.stateValue.kind === 'disconnected') { return; }
		for (const active of this.activeTurns.values()) {
			active.abortController.abort();
			active.query?.close();
		}
		for (const operation of this.hostOperations.values()) {
			operation.completion.complete(Object.freeze({ kind: 'cancelled' }));
		}
		this.hostOperations.clear();
		const state = Object.freeze({
			kind: 'disconnected' as const,
			connection: this.connection,
			generation: this.generation,
			reason,
		});
		this.stateValue = state;
		this.disconnectEmitter.fire(state);
		super.dispose();
	}

	override dispose(): void {
		this.terminate('disposed');
	}
}
