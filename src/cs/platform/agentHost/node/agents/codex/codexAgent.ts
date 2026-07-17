/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { observableValue, type IObservable } from 'cs/base/common/observable';
import { localize } from 'cs/nls';
import type {
	IAgent,
	IAgentAcknowledgeSessionConfigurationUpdateRequest,
	IAgentAction,
	IAgentCancelTurnRequest,
	IAgentChatBacking,
	IAgentChatRequest,
	IAgentChats,
	IAgentConfiguration,
	IAgentCreateChatOptions,
	IAgentCreateSessionOptions,
	IAgentDeleteChatRequest,
	IAgentDeleteSessionRequest,
	IAgentDescriptor,
	IAgentExecutionProfile,
	IAgentExecutionProfileRequest,
	IAgentExecutionProfiles,
	IAgentFinalizeSessionConfigurationUpdateRequest,
	IAgentForkChatRequest,
	IAgentInteractionResponseRequest,
	IAgentInteractions,
	IAgentMaterializeChatRequest,
	IAgentMaterializeSessionRequest,
	IAgentPrepareSessionConfigurationUpdateRequest,
	IAgentReleaseChatRequest,
	IAgentReleaseSessionRequest,
	IAgentResolvedSessionConfiguration,
	IAgentResolveSessionConfigurationRequest,
	IAgentResumeMigrationRequest,
	IAgentResumeState,
	IAgentResumeStates,
	IAgentRuntimeRegistration,
	IAgentSessionBacking,
	IAgentSessionConfigurationCompletionRequest,
	IAgentSessions,
	IAgentSteerRequest,
	AgentInteractionRequest,
	AgentTurnBehavior,
} from 'cs/platform/agentHost/common/agent';
import {
	resolveAgentModelConfigurationCandidate,
	resolveAgentSessionConfigurationValues,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationState,
	type IAgentConfigurationCompletion,
	type IAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type { IAgentCredentialReference, IAgentCredentialResolver } from 'cs/platform/agentHost/common/credentials';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentConfigurationSchemaRevision,
	createAgentBehaviorActivityId,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostOperationId,
	createAgentInteractionId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentPlanId,
	createAgentTaskId,
	createAgentToolCallId,
	type AgentBehaviorActivityId,
	type AgentChatId,
	type AgentHostOperationId,
	type AgentHostPayloadDigest,
	type AgentInteractionId,
	type AgentModelId,
	type AgentPackageRevision,
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
	type CometToolSchemaNode,
	type IAgentToolCall,
	type IAgentToolExecutionPort,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';
import type {
	ICodexAppServerClient,
	ICodexAppServerFactory,
} from './codexAppServer.js';
import type { RequestId } from './protocol/generated/RequestId.js';
import type { JsonValue } from './protocol/generated/serde_json/JsonValue.js';
import type { DynamicToolSpec } from './protocol/generated/v2/DynamicToolSpec.js';
import {
	CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	CODEX_AGENT_APPROVAL_POLICY_PROPERTY,
	CODEX_AGENT_CREDENTIAL_PROPERTY,
	CODEX_AGENT_ID,
	CODEX_AGENT_PACKAGE_ID,
	CODEX_AGENT_PERSONALITY_PROPERTY,
	CODEX_AGENT_REASONING_EFFORT_PROPERTY,
	CODEX_AGENT_REASONING_SUMMARY_PROPERTY,
	CODEX_AGENT_RESUME_SCHEMA,
	CODEX_AGENT_SANDBOX_MODE_PROPERTY,
	CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA,
	CODEX_AGENT_WEB_SEARCH_MODE_PROPERTY,
	createCodexAgentDescriptor,
	createCodexAgentModelConfigurationSchema,
	createCodexAgentRegistration,
	createCodexAgentRegistrationRevision,
	type CodexApprovalPolicy,
	type CodexSandboxMode,
} from './codexAgentDefinition.js';

const maximumRetainedOperations = 4_096;
const maximumRetainedTerminalTurns = 4_096;
const maximumCodexModelPages = 100;

interface ICodexModelListEntry {
	readonly id: string;
	readonly displayName: string;
	readonly description: string;
	readonly hidden: boolean;
	readonly defaultReasoningEffort: string;
	readonly supportedReasoningEfforts: readonly string[];
}

interface ICodexDiscoveredModel {
	readonly sdkValue: string;
	readonly descriptor: IAgentDescriptor['models'][number];
}

interface ICodexSessionResumeData {
	readonly kind: 'codex-app-server-session';
	readonly version: 1;
	readonly workingDirectory: string;
	readonly additionalDirectories: readonly string[];
}

interface ICodexChatResumeData {
	readonly kind: 'codex-app-server-chat';
	readonly version: 1;
	readonly threadId: string | null;
	readonly toolSchemaDigest: string | null;
}

interface ICodexSessionState {
	configuration: IAgentConfigurationState;
	readonly resume: ICodexSessionResumeData;
	materialized: boolean;
	readonly chats: Map<AgentChatId, ICodexChatState>;
}

interface ICodexChatState {
	resume: ICodexChatResumeData;
	materialized: boolean;
	latestTerminalTurn?: string;
}

interface ICodexExecutionProfileData {
	readonly kind: 'codexAppServerExecutionProfile';
	readonly model: string;
	readonly approvalPolicy: CodexApprovalPolicy;
	readonly sandboxMode: CodexSandboxMode;
	readonly webSearchMode: 'disabled' | 'cached' | 'live';
	readonly personality: 'none' | 'friendly' | 'pragmatic';
	readonly reasoningEffort: string;
	readonly reasoningSummary: 'none' | 'auto' | 'concise' | 'detailed';
	readonly credential: IAgentCredentialReference;
}

interface ICodexOperationState {
	readonly digest: AgentHostPayloadDigest;
	state: 'pending' | 'completed';
	value: AgentHostProtocolValue;
}

interface ICodexConfigurationTransaction {
	readonly digest: AgentHostPayloadDigest;
	readonly session: AgentSessionId;
	readonly current: IAgentConfigurationState;
	readonly candidate: IAgentConfigurationState;
	state: 'prepared' | 'committed' | 'rolledBack';
}

interface ICodexActiveTurn {
	readonly request: IAgentChatRequest;
	readonly chat: ICodexChatState;
	readonly completion: Promise<void>;
	resolveCompletion(): void;
	rejectCompletion(error: Error): void;
	cancelled: boolean;
	interrupt?: Promise<void>;
	appServerTurnId?: string;
	retryAttempt: number;
	contextUsedTokens: number;
	contextMaximumTokens: number;
	readonly interactions: Set<AgentInteractionId>;
}

interface ICodexPendingInteraction {
	readonly id: AgentInteractionId;
	readonly nativeRequest: RequestId;
	readonly method: string;
	readonly active: ICodexActiveTurn;
	readonly resolveNative: (value: unknown) => void;
	readonly response: (response: IAgentInteractionResponseRequest['response']) => unknown;
	readonly cancellationResponse: unknown;
}

interface ICodexFileChange {
	readonly path: string;
	readonly operation: 'create' | 'modify' | 'delete' | 'rename';
	readonly previousPath?: string;
	readonly diff: string;
}

export interface ICodexAgentOptions {
	readonly packageRevision: AgentPackageRevision;
	readonly stateDirectory: string;
	readonly appServerFactory: ICodexAppServerFactory;
	readonly toolExecution: IAgentToolExecutionPort;
	readonly credentialResolver: IAgentCredentialResolver;
}

function resourceMissing(resource: string): never {
	throw new AgentHostError(AgentHostErrorCode.ResourceMissing, 'Codex Agent resource is missing', { resource });
}

function exactRecord(value: unknown, keys: readonly string[]): value is Readonly<Record<string, unknown>> {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& keys.every(key => Object.hasOwn(value, key));
}

function protocolRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server returned an invalid value', {
			field,
			value: 'invalid',
		});
	}
	return value as Readonly<Record<string, unknown>>;
}

function codexJsonSchema(node: CometToolSchemaNode): JsonValue {
	const schema = (values: Readonly<Record<string, JsonValue>>): JsonValue => {
		const result: Record<string, JsonValue> = { ...values };
		if (node.description !== undefined) {
			result.description = node.description;
		}
		return result;
	};
	switch (node.type) {
		case 'null': return schema({ type: 'null' });
		case 'boolean': return schema({ type: 'boolean' });
		case 'number': return schema({
			type: 'number',
			...(node.minimum === undefined ? {} : { minimum: node.minimum }),
			...(node.maximum === undefined ? {} : { maximum: node.maximum }),
		});
		case 'integer': return schema({
			type: 'integer',
			...(node.minimum === undefined ? {} : { minimum: node.minimum }),
			...(node.maximum === undefined ? {} : { maximum: node.maximum }),
		});
		case 'string': return schema({
			type: 'string',
			...(node.minimumLength === undefined ? {} : { minLength: node.minimumLength }),
			...(node.maximumLength === undefined ? {} : { maxLength: node.maximumLength }),
			...(node.enum === undefined ? {} : { enum: [...node.enum] }),
		});
		case 'array': return schema({
			type: 'array',
			items: codexJsonSchema(node.items),
			...(node.minimumItems === undefined ? {} : { minItems: node.minimumItems }),
			...(node.maximumItems === undefined ? {} : { maxItems: node.maximumItems }),
		});
		case 'object': {
			const properties = Object.fromEntries(
				Object.entries(node.properties).map(([name, property]) => [name, codexJsonSchema(property)]),
			);
			return schema({
				type: 'object',
				properties,
				required: [...node.required],
				additionalProperties: false,
			});
		}
		case 'literal': return schema({ const: node.value });
		case 'oneOf': return schema({ oneOf: node.variants.map(codexJsonSchema) });
	}
}

/** OpenAI Codex app-server implementation owned directly by Agent Host Node. */
export class CodexAgent extends Disposable implements IAgent {
	readonly id = CODEX_AGENT_ID;
	descriptor!: IObservable<IAgentDescriptor>;
	registration!: IAgentRuntimeRegistration;

	private readonly actionEmitter = this._register(new Emitter<IAgentAction>());
	readonly onDidEmitAction: Event<IAgentAction> = this.actionEmitter.event;

	readonly executionProfiles: IAgentExecutionProfiles = { resolve: request => this.resolveExecutionProfile(request) };
	readonly configuration: IAgentConfiguration = {
		resolveSession: request => this.resolveSessionConfiguration(request),
		completeSession: request => this.completeSessionConfiguration(request),
		prepareSessionUpdate: request => this.prepareSessionConfigurationUpdate(request),
		commitSessionUpdate: request => this.commitSessionConfigurationUpdate(request),
		rollbackSessionUpdate: request => this.rollbackSessionConfigurationUpdate(request),
		acknowledgeSessionUpdate: request => this.acknowledgeSessionConfigurationUpdate(request),
	};
	readonly sessions: IAgentSessions = {
		create: request => this.createSession(request),
		materialize: request => this.materializeSession(request),
		release: request => this.releaseSession(request),
		delete: request => this.deleteSession(request),
	};
	readonly chats: IAgentChats = {
		create: request => this.createChat(request),
		materialize: request => this.materializeChat(request),
		release: request => this.releaseChat(request),
		fork: request => this.forkChat(request),
		send: request => this.send(request),
		steer: request => this.steer(request),
		cancel: request => this.cancel(request),
		delete: request => this.deleteChat(request),
	};
	readonly interactions: IAgentInteractions = {
		respond: request => this.respondInteraction(request),
	};
	readonly resumeStates: IAgentResumeStates = { migrate: request => this.migrateResumeState(request) };

	private respondInteraction(request: IAgentInteractionResponseRequest): Promise<void> {
		this.runOperation(request.operation, request.payloadDigest, () => {
			const pending = this.pendingInteractions.get(request.interaction);
			if (
				pending === undefined
				|| pending.active.request.session !== request.session
				|| pending.active.request.chat !== request.chat
				|| pending.active.request.turn !== request.turn
			) {
					throw new AgentHostError(
						AgentHostErrorCode.ResourceMissing,
						'Codex interaction is not active',
						{ resource: `interaction:${request.interaction}` },
					);
			}
			const nativeResponse = pending.response(request.response);
			this.pendingInteractions.delete(request.interaction);
			pending.active.interactions.delete(request.interaction);
			pending.resolveNative(nativeResponse);
			return null;
		});
		return Promise.resolve();
	}

	private readonly sessionStates = new Map<AgentSessionId, ICodexSessionState>();
	private readonly operations = new Map<AgentHostOperationId, ICodexOperationState>();
	private readonly configurationTransactions = new Map<AgentHostOperationId, ICodexConfigurationTransaction>();
	private readonly terminalTurns = new Set<string>();
	private readonly activeTurnsByThread = new Map<string, ICodexActiveTurn>();
	private readonly activeTurnsByHost = new Map<string, ICodexActiveTurn>();
	private readonly pendingInteractions = new Map<AgentInteractionId, ICodexPendingInteraction>();
	private readonly packageRevision: AgentPackageRevision;
	private readonly stateDirectory: string;
	private readonly appServerFactory: ICodexAppServerFactory;
	private readonly toolExecution: IAgentToolExecutionPort;
	private readonly credentialResolver: IAgentCredentialResolver;
	private descriptorValue: IAgentDescriptor | undefined;
	private discoveredModels: ReadonlyMap<AgentModelId, ICodexDiscoveredModel> = new Map();
	private client: ICodexAppServerClient | undefined;
	private readonly retiringClients = new Set<ICodexAppServerClient>();
	private credentialDigest: string | undefined;
	private nextToolCall = 1;

	private constructor(options: ICodexAgentOptions) {
		super();
		if (!isAbsolute(options.stateDirectory)) {
			throw new Error('Codex Agent state path must be absolute.');
		}
		this.packageRevision = options.packageRevision;
		this.stateDirectory = options.stateDirectory;
		this.appServerFactory = options.appServerFactory;
		this.toolExecution = options.toolExecution;
		this.credentialResolver = options.credentialResolver;
	}

	static async create(options: ICodexAgentOptions): Promise<CodexAgent> {
		const agent = new CodexAgent(options);
		try {
			await agent.initialize();
			return agent;
		} catch (error) {
			agent.dispose();
			throw error;
		}
	}

	private async initialize(): Promise<void> {
		const discoveryClient = await this.appServerFactory.start();
		try {
			const catalog = await this.discoverModelCatalog(discoveryClient);
			this.descriptorValue = catalog.descriptor;
			this.descriptor = observableValue('CodexAgent.descriptor', catalog.descriptor);
			this.registration = createCodexAgentRegistration(catalog.descriptor.revision);
			this.discoveredModels = catalog.models;
		} finally {
			discoveryClient.dispose();
		}
	}

	private async discoverModelCatalog(client: ICodexAppServerClient): Promise<{
		readonly descriptor: IAgentDescriptor;
		readonly models: ReadonlyMap<AgentModelId, ICodexDiscoveredModel>;
	}> {
		const entries: ICodexModelListEntry[] = [];
		const cursors = new Set<string>();
		let cursor: string | null = null;
		let pageCount = 0;
		do {
			pageCount++;
			if (pageCount > maximumCodexModelPages) {
				throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server model catalog exceeds its page bound', {
					field: 'model/list.nextCursor',
					value: 'overflow',
				});
			}
			const response = protocolRecord(await client.request('model/list', {
				cursor,
				limit: 100,
				includeHidden: false,
			}), 'model/list');
			if (!Array.isArray(response.data) || (response.nextCursor !== null && typeof response.nextCursor !== 'string')) {
				throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server returned an invalid model page', {
					field: 'model/list',
					value: 'invalid',
				});
			}
			for (const [index, value] of response.data.entries()) {
				const model = protocolRecord(value, `model/list.data.${index}`);
				if (
					typeof model.id !== 'string' || model.id.length === 0
					|| typeof model.displayName !== 'string' || model.displayName.length === 0
					|| typeof model.description !== 'string'
					|| typeof model.hidden !== 'boolean'
					|| typeof model.defaultReasoningEffort !== 'string' || model.defaultReasoningEffort.length === 0
					|| !Array.isArray(model.supportedReasoningEfforts)
				) {
					throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server returned an invalid model', {
						field: `model/list.data.${index}`,
						value: 'invalid',
					});
				}
				const efforts = model.supportedReasoningEfforts.map((value, effortIndex) => {
					const effort = protocolRecord(value, `model/list.data.${index}.supportedReasoningEfforts.${effortIndex}`);
					if (typeof effort.reasoningEffort !== 'string' || effort.reasoningEffort.length === 0) {
						throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server returned an invalid reasoning effort', {
							field: `model/list.data.${index}.supportedReasoningEfforts.${effortIndex}`,
							value: 'invalid',
						});
					}
					return effort.reasoningEffort;
				});
				if (
					efforts.length === 0
					|| new Set(efforts).size !== efforts.length
					|| !efforts.includes(model.defaultReasoningEffort)
				) {
					throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex model reasoning efforts are inconsistent', {
						field: `model/list.data.${index}.supportedReasoningEfforts`,
						value: 'invalid',
					});
				}
				if (!model.hidden) {
					entries.push(Object.freeze({
						id: model.id,
						displayName: model.displayName,
						description: model.description,
						hidden: model.hidden,
						defaultReasoningEffort: model.defaultReasoningEffort,
						supportedReasoningEfforts: Object.freeze(efforts),
					}));
				}
			}
			cursor = response.nextCursor as string | null;
			if (cursor !== null) {
				if (cursors.has(cursor)) {
					throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server repeated a model page cursor', {
						field: 'model/list.nextCursor',
						value: 'repeated',
					});
				}
				cursors.add(cursor);
			}
		} while (cursor !== null);

		if (entries.length === 0 || new Set(entries.map(model => model.id)).size !== entries.length) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server model catalog is empty or duplicated', {
				field: 'model/list.data.id',
				value: entries.length === 0 ? 'empty' : 'duplicate',
			});
		}
		const catalogData = encodeAgentHostProtocolValue(Object.freeze({
			sdkVersion: this.packageRevision,
			models: entries,
		}));
		const catalogDigest = createHash('sha256').update(catalogData).digest('hex');
		const discovered = new Map<AgentModelId, ICodexDiscoveredModel>();
		for (const model of entries) {
			const modelDigest = createHash('sha256').update(encodeAgentHostProtocolValue(model)).digest('hex');
			const modelId = createAgentModelId(`codex:${model.id}`);
			const efforts = Object.freeze([
				model.defaultReasoningEffort,
				...model.supportedReasoningEfforts.filter(effort => effort !== model.defaultReasoningEffort),
			]);
			const descriptor = Object.freeze({
				id: modelId,
				revision: createAgentModelDescriptorRevision(`codex.app-server.model.${modelDigest}`),
				displayName: model.displayName,
				enabled: true,
				configurationSchema: createCodexAgentModelConfigurationSchema(
					createAgentConfigurationSchemaRevision(`codex.app-server.model.${modelDigest}`),
					efforts,
				),
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
			discovered.set(modelId, Object.freeze({ sdkValue: model.id, descriptor }));
		}
		const descriptor = createCodexAgentDescriptor(
			createAgentDescriptorRevision(`codex.app-server.descriptor.${catalogDigest}`),
			Object.freeze([...discovered.values()].map(model => model.descriptor)),
		);
		return Object.freeze({ descriptor, models: discovered });
	}

	resolveSessionConfiguration(request: IAgentResolveSessionConfigurationRequest): Promise<IAgentResolvedSessionConfiguration> {
		const hostDefaults = validateAndFreezeAgentConfigurationState(request.hostDefaults, {
			agent: CODEX_AGENT_ID,
			scope: 'hostDefault',
			revision: this.requireRegistration().hostDefaultsSchema.revision,
		});
		const candidate = validateAndFreezeAgentConfigurationCandidate(
			CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA,
			request.candidate,
			'session',
		);
		return Promise.resolve(Object.freeze({
			schema: CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA,
			values: resolveAgentSessionConfigurationValues(
				CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA,
				hostDefaults.values,
				candidate.values,
			),
		}));
	}

	completeSessionConfiguration(
		request: IAgentSessionConfigurationCompletionRequest,
	): Promise<readonly IAgentConfigurationCompletion[]> {
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Codex Agent configuration uses SDK enum values',
			{ capability: `configurationCompletion:${request.property}` },
		));
	}

	prepareSessionConfigurationUpdate(request: IAgentPrepareSessionConfigurationUpdateRequest): Promise<void> {
		const session = this.requireSession(request.session);
		const current = this.validateSessionConfiguration(request.current);
		const candidate = this.validateSessionConfiguration(request.candidate);
		if (current.revision !== session.configuration.revision) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.StaleConfigurationSchema,
				'Codex Agent Session configuration state is stale',
				{ expected: session.configuration.revision, received: current.revision },
			));
		}
		this.beginOperation(request.operation, request.payloadDigest);
		const existing = this.configurationTransactions.get(request.operation);
		if (existing === undefined) {
			this.configurationTransactions.set(request.operation, {
				digest: request.payloadDigest,
				session: request.session,
				current,
				candidate,
				state: 'prepared',
			});
		} else if (
			existing.digest !== request.payloadDigest
			|| existing.session !== request.session
			|| existing.candidate.revision !== candidate.revision
		) {
			this.digestConflict(request.operation, existing.digest, request.payloadDigest);
		}
		return Promise.resolve();
	}

	commitSessionConfigurationUpdate(request: IAgentFinalizeSessionConfigurationUpdateRequest): Promise<void> {
		const transaction = this.requireConfigurationTransaction(request.operation, request.payloadDigest);
		if (transaction.candidate.revision !== request.configuration) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.StaleConfigurationSchema,
				'Codex Agent Session configuration decision is stale',
				{ expected: transaction.candidate.revision, received: request.configuration },
			));
		}
		if (transaction.state === 'prepared') {
			this.requireSession(transaction.session).configuration = transaction.candidate;
			transaction.state = 'committed';
			this.completeOperation(request.operation, null);
		}
		return Promise.resolve();
	}

	rollbackSessionConfigurationUpdate(request: IAgentFinalizeSessionConfigurationUpdateRequest): Promise<void> {
		const transaction = this.configurationTransactions.get(request.operation);
		if (transaction === undefined) {
			this.beginOperation(request.operation, request.payloadDigest);
			this.completeOperation(request.operation, null);
			return Promise.resolve();
		}
		this.assertOperationDigest(request.operation, transaction.digest, request.payloadDigest);
		if (transaction.candidate.revision !== request.configuration) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.StaleConfigurationSchema,
				'Codex Agent Session rollback decision is stale',
				{ expected: transaction.candidate.revision, received: request.configuration },
			));
		}
		if (transaction.state === 'prepared') {
			transaction.state = 'rolledBack';
			this.completeOperation(request.operation, null);
		}
		return Promise.resolve();
	}

	acknowledgeSessionConfigurationUpdate(request: IAgentAcknowledgeSessionConfigurationUpdateRequest): Promise<void> {
		const transaction = this.configurationTransactions.get(request.operation);
		if (transaction !== undefined) {
			this.assertOperationDigest(request.operation, transaction.digest, request.payloadDigest);
			const expectedDecision = transaction.state === 'committed' ? 'commit' : 'rollback';
			if (transaction.state === 'prepared' || request.decision !== expectedDecision) {
				return Promise.reject(new AgentHostError(
					AgentHostErrorCode.OperationNotPending,
					'Codex Agent Session configuration decision is not terminal',
					{ operation: request.operation },
				));
			}
			this.configurationTransactions.delete(request.operation);
		}
		return Promise.resolve();
	}

	resolveExecutionProfile(request: IAgentExecutionProfileRequest): Promise<IAgentExecutionProfile> {
		const sessionConfiguration = this.validateSessionConfiguration(request.sessionConfiguration);
		if (
			request.selection.kind !== 'user'
			|| !exactRecord(request.selection.value, ['model'])
			|| typeof request.selection.value.model !== 'string'
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Codex Agent execution requires an explicit discovered model',
				{ field: 'executionProfile.selection', value: request.selection.kind },
			);
		}
		const discoveredModel = this.discoveredModels.get(createAgentModelId(request.selection.value.model));
		if (discoveredModel === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Codex Agent execution selected an unknown model',
				{ field: 'executionProfile.selection.model', value: request.selection.value.model },
			);
		}
		const modelConfiguration = resolveAgentModelConfigurationCandidate(
			discoveredModel.descriptor.configurationSchema,
			request.selection.configuration,
		);
		const approvalPolicy = sessionConfiguration.values[CODEX_AGENT_APPROVAL_POLICY_PROPERTY];
		const sandboxMode = sessionConfiguration.values[CODEX_AGENT_SANDBOX_MODE_PROPERTY];
		const webSearchMode = sessionConfiguration.values[CODEX_AGENT_WEB_SEARCH_MODE_PROPERTY];
		const personality = sessionConfiguration.values[CODEX_AGENT_PERSONALITY_PROPERTY];
		const reasoningEffort = modelConfiguration.values[CODEX_AGENT_REASONING_EFFORT_PROPERTY];
		const reasoningSummary = modelConfiguration.values[CODEX_AGENT_REASONING_SUMMARY_PROPERTY];
		const credential = modelConfiguration.values[CODEX_AGENT_CREDENTIAL_PROPERTY];
		const effortProperty = discoveredModel.descriptor.configurationSchema.properties.find(
			property => property.id === CODEX_AGENT_REASONING_EFFORT_PROPERTY,
		);
		if (
			!['untrusted', 'on-failure', 'on-request', 'never'].includes(approvalPolicy as string)
			|| !['read-only', 'workspace-write', 'danger-full-access'].includes(sandboxMode as string)
			|| !['disabled', 'cached', 'live'].includes(webSearchMode as string)
			|| !['none', 'friendly', 'pragmatic'].includes(personality as string)
			|| typeof reasoningEffort !== 'string'
			|| !['none', 'auto', 'concise', 'detailed'].includes(reasoningSummary as string)
			|| effortProperty?.value.type !== 'string'
			|| !effortProperty.value.enum?.includes(reasoningEffort)
			|| !exactRecord(credential, ['provider', 'scope', 'reference'])
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Codex Agent execution profile configuration is invalid',
				{ field: 'executionProfile', value: 'invalid' },
			);
		}
		const data = encodeAgentHostProtocolValue(Object.freeze({
			kind: 'codexAppServerExecutionProfile',
			model: discoveredModel.sdkValue,
			approvalPolicy,
			sandboxMode,
			webSearchMode,
			personality,
			reasoningEffort,
			reasoningSummary,
			credential,
		}));
		const digest = createHash('sha256').update(data).digest('hex');
		return Promise.resolve(Object.freeze({
			revision: createAgentExecutionProfileRevision(`codex-app-server:${digest}`),
			digest: createAgentExecutionProfileDigest(`sha256:${digest}`),
			agentDescriptor: this.requireDescriptor().revision,
			modelDescriptor: discoveredModel.descriptor.revision,
			data,
		}));
	}

	migrateResumeState(request: IAgentResumeMigrationRequest): Promise<IAgentResumeState> {
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Codex Agent declares no resume migration edge',
			{ capability: `resumeMigration:${request.source.schema}:${request.targetSchema}` },
		));
	}

	createSession(request: IAgentCreateSessionOptions): Promise<IAgentSessionBacking> {
		const value = this.runOperation(request.operation, request.payloadDigest, () => {
			if (this.sessionStates.has(request.session)) {
				return resourceMissing(`sessionAlreadyExists:${request.session}`);
			}
			const resume: ICodexSessionResumeData = Object.freeze({
				kind: 'codex-app-server-session',
				version: 1,
				workingDirectory: request.workspace?.folders[0]?.workingDirectory ?? this.stateDirectory,
				additionalDirectories: Object.freeze(
					request.workspace?.folders.slice(1).map(folder => folder.workingDirectory) ?? [],
				),
			});
			const directories = [resume.workingDirectory, ...resume.additionalDirectories];
			if (directories.some(directory => !isAbsolute(directory)) || new Set(directories).size !== directories.length) {
				throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex workspace path is invalid', {
					field: 'workspace.folders.workingDirectory',
					value: 'invalid',
				});
			}
			this.sessionStates.set(request.session, {
				configuration: this.validateSessionConfiguration(request.configuration),
				resume,
				materialized: true,
				chats: new Map(),
			});
			return Object.freeze({ session: request.session, resume: this.resumeState(resume) });
		});
		return Promise.resolve(value as IAgentSessionBacking);
	}

	materializeSession(request: IAgentMaterializeSessionRequest): Promise<void> {
		this.runOperation(request.operation, request.payloadDigest, () => {
			const configuration = this.validateSessionConfiguration(request.configuration);
			const existing = this.sessionStates.get(request.session);
			if (existing === undefined) {
				this.sessionStates.set(request.session, {
					configuration,
					resume: this.parseSessionResume(request.resume),
					materialized: true,
					chats: new Map(),
				});
			} else {
				existing.configuration = configuration;
				existing.materialized = true;
			}
			return null;
		});
		return Promise.resolve();
	}

	releaseSession(request: IAgentReleaseSessionRequest): Promise<void> {
		this.runOperation(request.operation, request.payloadDigest, () => {
			const session = this.requireSession(request.session);
			session.materialized = false;
			for (const chat of session.chats.values()) {
				chat.materialized = false;
			}
			return null;
		});
		return Promise.resolve();
	}

	async deleteSession(request: IAgentDeleteSessionRequest): Promise<void> {
		await this.runAsyncOperation(request.operation, request.payloadDigest, async () => {
			const session = this.sessionStates.get(request.session);
			if (session !== undefined) {
				for (const chat of session.chats.values()) {
					await this.deleteThread(chat);
				}
			}
			this.sessionStates.delete(request.session);
			this.deleteTerminalTurns(`${request.session}\u0000`);
			return null;
		});
	}

	createChat(request: IAgentCreateChatOptions): Promise<IAgentChatBacking> {
		const value = this.runOperation(request.operation, request.payloadDigest, () => this.createChatState(request.session, request.chat));
		return Promise.resolve(value as IAgentChatBacking);
	}

	materializeChat(request: IAgentMaterializeChatRequest): Promise<void> {
		this.runOperation(request.operation, request.payloadDigest, () => {
			const session = this.requireMaterializedSession(request.session);
			const existing = session.chats.get(request.chat);
			if (existing === undefined) {
				session.chats.set(request.chat, {
					resume: this.parseChatResume(request.resume),
					materialized: true,
				});
			} else {
				existing.materialized = true;
			}
			return null;
		});
		return Promise.resolve();
	}

	releaseChat(request: IAgentReleaseChatRequest): Promise<void> {
		this.runOperation(request.operation, request.payloadDigest, () => {
			this.requireChat(request.session, request.chat).materialized = false;
			return null;
		});
		return Promise.resolve();
	}

	async forkChat(request: IAgentForkChatRequest): Promise<IAgentChatBacking> {
		return this.runAsyncOperation(request.operation, request.payloadDigest, async () => {
			const session = this.requireMaterializedSession(request.session);
			if (session.chats.has(request.chat)) {
				return resourceMissing(`chatAlreadyExists:${request.session}:${request.chat}`);
			}
			const source = this.requireMaterializedChat(request.session, request.source.chat);
			if (source.resume.threadId === null || source.latestTerminalTurn !== request.source.turn) {
				throw new AgentHostError(
					AgentHostErrorCode.CapabilityUnsupported,
					'Codex can fork only the latest terminal Turn of a materialized thread',
					{ capability: 'chats.forkLatestTurn' },
				);
			}
			let client = this.client;
			const ownsClient = client === undefined;
			client ??= await this.appServerFactory.start();
			try {
				const response = protocolRecord(await client.request('thread/fork', {
					threadId: source.resume.threadId,
					excludeTurns: true,
				}), 'thread/fork');
				const thread = protocolRecord(response.thread, 'thread/fork.thread');
				if (typeof thread.id !== 'string' || thread.id.length === 0) {
					throw new AgentHostError(
						AgentHostErrorCode.InvalidProtocolValue,
						'Codex app-server returned an invalid forked thread',
						{ field: 'thread/fork.thread.id', value: 'invalid' },
					);
				}
				const resume: ICodexChatResumeData = Object.freeze({
					kind: 'codex-app-server-chat',
					version: 1,
					threadId: thread.id,
					toolSchemaDigest: source.resume.toolSchemaDigest,
				});
				session.chats.set(request.chat, {
					resume,
					materialized: true,
					latestTerminalTurn: request.source.turn,
				});
				return Object.freeze({
					session: request.session,
					chat: request.chat,
					resume: this.resumeState(resume),
				});
			} finally {
				if (ownsClient) {
					client.dispose();
				}
			}
		});
	}

	async send(request: IAgentChatRequest): Promise<void> {
		const chat = this.requireMaterializedChat(request.session, request.chat);
		if (request.attachments.length !== 0 || request.interactionTargets.length !== 0) {
			throw new AgentHostError(
				AgentHostErrorCode.CapabilityUnsupported,
				'Codex SDK does not declare attachments or interaction targets',
				{ capability: 'turn.content' },
			);
		}
		const existingOperation = this.operations.get(request.operation);
		if (existingOperation !== undefined) {
			this.assertOperationDigest(request.operation, existingOperation.digest, request.payloadDigest);
			if (existingOperation.state === 'completed') {
				return;
			}
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Codex Agent operation is already pending',
				{ operation: request.operation },
			);
		}
		const hostTurn = this.turnKey(request.session, request.chat, request.turn);
		if (this.activeTurnsByHost.has(hostTurn)) {
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Codex Turn is already active',
				{ operation: request.operation },
			);
		}
		this.beginOperation(request.operation, request.payloadDigest);
		if (this.terminalTurns.has(hostTurn)) {
			this.completeOperation(request.operation, null);
			return;
		}
		let resolveCompletion!: () => void;
		let rejectCompletion!: (error: Error) => void;
		const completion = new Promise<void>((resolve, reject) => {
			resolveCompletion = resolve;
			rejectCompletion = reject;
		});
		const active: ICodexActiveTurn = {
			request,
			chat,
			completion,
			resolveCompletion,
			rejectCompletion,
			cancelled: false,
			retryAttempt: 0,
			contextUsedTokens: 0,
			contextMaximumTokens: 0,
			interactions: new Set(),
		};
		this.activeTurnsByHost.set(hostTurn, active);
		this.emit(Object.freeze({
			kind: 'turnProgress',
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			progress: Object.freeze({ kind: 'state', state: 'running' }),
		}));

		try {
			await this.runTurn(active);
		} catch (error) {
			if (!this.terminalTurns.has(hostTurn)) {
				this.emitTerminal(request, 'failed', Object.freeze({
					kind: 'codexAppServerError',
					message: error instanceof Error ? error.message : 'Codex app-server turn failed',
				}));
			}
		} finally {
			this.activeTurnsByHost.delete(hostTurn);
			if (chat.resume.threadId !== null) {
				this.activeTurnsByThread.delete(chat.resume.threadId);
			}
			this.completeOperation(request.operation, null);
		}
	}

	async steer(request: IAgentSteerRequest): Promise<void> {
		this.requireMaterializedChat(request.session, request.chat);
		await this.runAsyncOperation(request.operation, request.payloadDigest, async () => {
			const active = this.activeTurnsByHost.get(this.turnKey(request.session, request.chat, request.turn));
			if (
				active === undefined
				|| active.chat.resume.threadId === null
				|| active.appServerTurnId === undefined
			) {
					throw new AgentHostError(
						AgentHostErrorCode.ResourceMissing,
						'Codex active Turn is missing',
						{ resource: `turn:${request.turn}` },
					);
			}
			await this.requireClient().request('turn/steer', {
				threadId: active.chat.resume.threadId,
				expectedTurnId: active.appServerTurnId,
				input: [{ type: 'text', text: request.message, text_elements: [] }],
			});
			return null;
		});
	}

	async cancel(request: IAgentCancelTurnRequest): Promise<void> {
		this.requireMaterializedChat(request.session, request.chat);
		await this.runAsyncOperation(request.operation, request.payloadDigest, async () => {
			const turn = this.turnKey(request.session, request.chat, request.turn);
			const active = this.activeTurnsByHost.get(turn);
			if (active !== undefined) {
				active.cancelled = true;
				this.cancelPendingInteractions(active, true);
			}
			if (active?.chat.resume.threadId !== null && active?.appServerTurnId !== undefined) {
				await this.interruptTurn(active, this.requireClient(), active.chat.resume.threadId, active.appServerTurnId);
			}
			if (!this.terminalTurns.has(turn)) {
				this.emitTerminal(request, 'cancelled');
			}
			active?.resolveCompletion();
			return null;
		});
	}

	async deleteChat(request: IAgentDeleteChatRequest): Promise<void> {
		await this.runAsyncOperation(request.operation, request.payloadDigest, async () => {
			const session = this.sessionStates.get(request.session);
			const chat = session?.chats.get(request.chat);
			if (session !== undefined && chat !== undefined) {
				await this.deleteThread(chat);
				session.chats.delete(request.chat);
			}
			this.deleteTerminalTurns(`${request.session}\u0000${request.chat}\u0000`);
			return null;
		});
	}

	private async runTurn(active: ICodexActiveTurn): Promise<void> {
		const request = active.request;
		const profile = this.executionProfile(request.binding.profile.data);
		const credential = this.requireCredential(request.binding.credentials, profile.credential);
		const apiKey = await this.credentialResolver.resolve({
			packageId: CODEX_AGENT_PACKAGE_ID,
			agentId: CODEX_AGENT_ID,
			runtimeRegistration: this.requireRegistration().revision,
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			credential,
		}, CancellationTokenNone);
		if (active.cancelled) {
			return;
		}
		const client = await this.authenticatedClient(apiKey);
		if (active.cancelled) {
			return;
		}
		const session = this.requireMaterializedSession(request.session);
			const dynamicTools: DynamicToolSpec[] = request.binding.toolSet.registrations.map(registration => ({
				type: 'function',
				name: registration.descriptor.functionName,
				description: registration.descriptor.description,
				inputSchema: codexJsonSchema(parseCometToolSchema(registration.descriptor.inputSchema)),
			}));
		const toolSchemaDigest = `sha256:${createHash('sha256')
			.update(encodeAgentHostProtocolValue(Object.freeze(dynamicTools)))
			.digest('hex')}`;
		let threadId = active.chat.resume.threadId;
		if (threadId === null) {
			const response = protocolRecord(await client.request('thread/start', {
				model: profile.model,
				cwd: session.resume.workingDirectory,
				runtimeWorkspaceRoots: [session.resume.workingDirectory, ...session.resume.additionalDirectories],
				approvalPolicy: profile.approvalPolicy,
				sandbox: profile.sandboxMode,
				config: { web_search: profile.webSearchMode },
				personality: profile.personality,
				dynamicTools,
			}), 'thread/start');
			const thread = protocolRecord(response.thread, 'thread/start.thread');
			if (typeof thread.id !== 'string' || thread.id.length === 0) {
				throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server returned an invalid thread', {
					field: 'thread/start.thread.id',
					value: 'invalid',
				});
			}
			threadId = thread.id;
			active.chat.resume = Object.freeze({
				...active.chat.resume,
				threadId,
				toolSchemaDigest,
			});
			this.emit(Object.freeze({
				kind: 'chatResumeStateChanged',
				session: request.session,
				chat: request.chat,
				resume: this.resumeState(active.chat.resume),
			}));
		} else {
			if (active.chat.resume.toolSchemaDigest !== toolSchemaDigest) {
				throw new AgentHostError(
					AgentHostErrorCode.InvalidProtocolValue,
					'Codex thread Tool schema does not match the accepted Turn binding',
					{
						field: 'binding.toolSet.registrations',
						value: 'changed',
					},
				);
			}
			await client.request('thread/resume', {
				threadId,
				model: profile.model,
				cwd: session.resume.workingDirectory,
				runtimeWorkspaceRoots: [session.resume.workingDirectory, ...session.resume.additionalDirectories],
				approvalPolicy: profile.approvalPolicy,
				sandbox: profile.sandboxMode,
				config: { web_search: profile.webSearchMode },
				personality: profile.personality,
				excludeTurns: true,
			});
		}
		if (active.cancelled) {
			return;
		}
		if (this.activeTurnsByThread.has(threadId)) {
			throw new AgentHostError(AgentHostErrorCode.OperationNotPending, 'Codex thread already has an active Turn', {
				operation: request.operation,
			});
		}
		this.activeTurnsByThread.set(threadId, active);
		const turnResponse = protocolRecord(await client.request('turn/start', {
			threadId,
			clientUserMessageId: request.submission,
			input: [{ type: 'text', text: request.message, text_elements: [] }],
			model: profile.model,
			effort: profile.reasoningEffort,
			summary: profile.reasoningSummary,
			personality: profile.personality,
			approvalPolicy: profile.approvalPolicy,
		}), 'turn/start');
		const turn = protocolRecord(turnResponse.turn, 'turn/start.turn');
		if (typeof turn.id !== 'string' || turn.id.length === 0) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server returned an invalid Turn', {
				field: 'turn/start.turn.id',
				value: 'invalid',
			});
		}
		if (active.appServerTurnId !== undefined && active.appServerTurnId !== turn.id) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex app-server changed the active Turn identity', {
				field: 'turn/start.turn.id',
				value: 'changed',
			});
		}
		active.appServerTurnId = turn.id;
		if (active.cancelled) {
			await this.interruptTurn(active, client, threadId, turn.id);
		}
		if (active.cancelled) {
			return;
		}
		await active.completion;
	}

	private interruptTurn(
		active: ICodexActiveTurn,
		client: ICodexAppServerClient,
		threadId: string,
		turnId: string,
	): Promise<void> {
		active.interrupt ??= client.request('turn/interrupt', { threadId, turnId }).then(() => undefined);
		return active.interrupt;
	}

	private async authenticatedClient(apiKey: string): Promise<ICodexAppServerClient> {
		const digest = createHash('sha256').update(apiKey).digest('hex');
		if (this.client !== undefined) {
			if (this.credentialDigest === digest) {
				return this.client;
			}
			if (this.activeTurnsByThread.size !== 0) {
				throw new AgentHostError(
					AgentHostErrorCode.CredentialUnauthorized,
					'Codex credential cannot rotate while an SDK Turn is active',
					{ provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER, scope: 'llm' },
				);
			}
			const retired = this.client;
			this.retiringClients.add(retired);
			this.client = undefined;
			this.credentialDigest = undefined;
			retired.dispose();
		}
		const client = await this.appServerFactory.start(apiKey);
		this.registerClient(client);
		this.client = client;
		this.credentialDigest = digest;
		return client;
	}

	private registerClient(client: ICodexAppServerClient): void {
		this._register(client.onNotification('turn/started', params => this.consumeTurnStarted(params)));
		this._register(client.onNotification('item/started', params => this.consumeItem(params, 'started')));
		this._register(client.onNotification('item/agentMessage/delta', params => this.consumeTextDelta(params, 'text')));
		this._register(client.onNotification('item/plan/delta', params => this.consumePlanDelta(params)));
		this._register(client.onNotification('item/reasoning/textDelta', params => this.consumeTextDelta(params, 'reasoning')));
		this._register(client.onNotification('item/reasoning/summaryTextDelta', params => this.consumeTextDelta(params, 'reasoning')));
		this._register(client.onNotification('item/reasoning/summaryPartAdded', params => this.consumeCorrelatedNotification(params, 'item/reasoning/summaryPartAdded')));
		this._register(client.onNotification('item/commandExecution/outputDelta', params => this.consumeTerminalDelta(params)));
		this._register(client.onNotification('item/fileChange/outputDelta', params => this.consumeNativeToolDelta(params, 'file')));
		this._register(client.onNotification('item/fileChange/patchUpdated', params => this.consumeFileChanges(params)));
		this._register(client.onNotification('item/mcpToolCall/progress', params => this.consumeNativeToolDelta(params, 'mcp')));
		this._register(client.onNotification('turn/plan/updated', params => this.consumePlan(params)));
		this._register(client.onNotification('thread/tokenUsage/updated', params => this.consumeUsage(params)));
		this._register(client.onNotification('thread/compacted', params => this.consumeCompaction(params)));
		this._register(client.onNotification('turn/diff/updated', params => this.consumeTurnDiff(params)));
		this._register(client.onNotification('error', params => this.consumeError(params)));
		this._register(client.onNotification('model/rerouted', params => this.consumeModelRerouted(params)));
		this._register(client.onNotification('thread/status/changed', params => this.consumeThreadStatus(params)));
		this._register(client.onNotification('warning', params => this.consumeWarning(params)));
		this._register(client.onNotification('item/completed', params => this.consumeItem(params, 'completed')));
		this._register(client.onNotification('turn/completed', params => this.consumeTurnCompleted(params)));
		this._register(client.onUnhandledNotification((method, params) => this.consumeUnhandledNotification(method, params)));
		this._register(client.onRequest('item/tool/call', (_id, params) => this.executeDynamicTool(params)));
		this._register(client.onRequest(
			'item/commandExecution/requestApproval',
			(id, params) => this.requestCommandApproval(id, params),
		));
		this._register(client.onRequest(
			'item/fileChange/requestApproval',
			(id, params) => this.requestFileApproval(id, params),
		));
		this._register(client.onRequest(
			'item/permissions/requestApproval',
			(id, params) => this.requestPermissionsApproval(id, params),
		));
		this._register(client.onRequest(
			'item/tool/requestUserInput',
			(id, params) => this.requestUserInput(id, params),
		));
		this._register(client.onRequest(
			'mcpServer/elicitation/request',
			(id, params) => this.requestMcpElicitation(id, params),
		));
		this._register(client.onDidExit(() => this.handleClientExit(client)));
	}

	private consumeTurnStarted(params: unknown): void {
		const value = protocolRecord(params, 'turn/started');
		const turn = protocolRecord(value.turn, 'turn/started.turn');
		if (typeof value.threadId !== 'string' || typeof turn.id !== 'string' || turn.id.length === 0) {
			throw new Error('Codex turn/started notification is invalid.');
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined) {
			return;
		}
		if (this.terminalTurns.has(this.turnKey(active.request.session, active.request.chat, active.request.turn))) {
			return;
		}
		if (active.appServerTurnId !== undefined && active.appServerTurnId !== turn.id) {
			throw new Error('Codex turn/started notification changed the active Turn identity.');
		}
		active.appServerTurnId = turn.id;
	}

	private consumeTextDelta(params: unknown, kind: 'text' | 'reasoning'): void {
		const value = protocolRecord(params, `notification.${kind}`);
		if (typeof value.threadId !== 'string' || typeof value.turnId !== 'string' || typeof value.delta !== 'string') {
			throw new Error(`Codex ${kind} notification is invalid.`);
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined || (active.appServerTurnId !== undefined && active.appServerTurnId !== value.turnId)) {
			return;
		}
		if (this.terminalTurns.has(this.turnKey(active.request.session, active.request.chat, active.request.turn))) {
			return;
		}
		if (value.delta.length > 0) {
			this.emitBehavior(active.request, Object.freeze({ kind, text: value.delta }));
		}
	}

	private consumeCorrelatedNotification(params: unknown, field: string): void {
		this.correlatedActive(params, field);
	}

	private consumeItem(params: unknown, phase: 'started' | 'completed'): void {
		const correlated = this.correlatedActive(params, `item/${phase}`);
		if (correlated === undefined) {
			return;
		}
		const item = protocolRecord(correlated.value.item, `item/${phase}.item`);
		if (typeof item.type !== 'string' || typeof item.id !== 'string' || item.id.length === 0) {
			throw new Error(`Codex item/${phase} notification is invalid.`);
		}
		const active = correlated.active;
		const state = phase === 'started' ? 'running' : this.nativeItemTerminalState(item);
		switch (item.type) {
			case 'userMessage':
			case 'agentMessage':
			case 'reasoning':
				return;
			case 'plan': {
				if (typeof item.text !== 'string') {
					throw new Error(`Codex ${item.type} item is invalid.`);
				}
				this.emitBehavior(active.request, Object.freeze({
					kind: 'plan',
					plan: createAgentPlanId(this.nativeIdentity('plan-item', item.id)),
					title: item.text,
					state: phase === 'started' ? 'running' : 'completed',
					steps: Object.freeze([]),
				}));
				return;
			}
			case 'commandExecution': {
				if (typeof item.command !== 'string' || typeof item.cwd !== 'string') {
					throw new Error('Codex commandExecution item is invalid.');
				}
				this.emitBehavior(active.request, Object.freeze({
					kind: 'nativeTool',
					activity: this.nativeActivity(item.id),
					name: localize('codex.native.command', 'Command'),
					category: 'command',
					state,
					input: Object.freeze({ command: item.command, cwd: item.cwd }),
					...(phase === 'completed' && typeof item.aggregatedOutput === 'string'
						? { output: Object.freeze({ text: item.aggregatedOutput, exitCode: typeof item.exitCode === 'number' ? item.exitCode : null }) }
						: {}),
				}));
				return;
			}
			case 'fileChange': {
				const changes = this.fileChanges(item.changes, `item/${phase}.item.changes`);
				this.emitBehavior(active.request, Object.freeze({
					kind: 'nativeTool',
					activity: this.nativeActivity(item.id),
					name: localize('codex.native.fileChanges', 'File changes'),
					category: 'file',
					state,
					input: Object.freeze({ resources: Object.freeze(changes.map(change => change.path)) }),
				}));
				if (phase === 'completed' && state === 'completed') {
					this.emitFileChangeBehaviors(active, item.id, changes);
				}
				return;
			}
			case 'mcpToolCall': {
				if (typeof item.server !== 'string' || typeof item.tool !== 'string') {
					throw new Error('Codex mcpToolCall item is invalid.');
				}
				assertAgentHostProtocolValue(item.arguments);
				const output = phase === 'completed'
					? this.optionalProtocolValue(item.error ?? item.result, 'item/completed.item.result')
					: undefined;
				this.emitBehavior(active.request, Object.freeze({
					kind: 'nativeTool',
					activity: this.nativeActivity(item.id),
					name: `${item.server}.${item.tool}`,
					category: 'mcp',
					state,
					input: item.arguments,
					...(output === undefined ? {} : { output }),
				}));
				return;
			}
			case 'dynamicToolCall':
				return;
			case 'webSearch': {
				if (typeof item.query !== 'string') {
					throw new Error('Codex webSearch item is invalid.');
				}
				const action = this.optionalProtocolValue(item.action, 'item.webSearch.action');
				this.emitBehavior(active.request, Object.freeze({
					kind: 'nativeTool',
					activity: this.nativeActivity(item.id),
					name: localize('codex.native.webSearch', 'Web search'),
					category: 'search',
					state,
					input: Object.freeze({
						query: item.query,
						...(action === undefined ? {} : { action }),
					}),
				}));
				return;
			}
			case 'collabAgentToolCall':
				this.consumeCollaborationItem(active, item, phase);
				return;
			case 'subAgentActivity':
				this.consumeSubAgentItem(active, item, phase);
				return;
			case 'hookPrompt':
				this.emitBehavior(active.request, Object.freeze({
					kind: 'nativeTool',
					activity: this.nativeActivity(item.id),
					name: localize('codex.native.hookPrompt', 'Hook prompt'),
					category: 'other',
					state,
					...(this.optionalProtocolValue(item.fragments, 'item.hookPrompt.fragments') === undefined
						? {}
						: { input: item.fragments as AgentHostProtocolValue }),
				}));
				return;
			case 'imageView':
			case 'imageGeneration':
				this.consumeImageItem(active, item, phase);
				return;
			case 'sleep': {
				if (typeof item.durationMs !== 'number' || !Number.isFinite(item.durationMs) || item.durationMs < 0) {
					throw new Error('Codex sleep item is invalid.');
				}
				this.emitBehavior(active.request, Object.freeze({
					kind: 'background',
					activity: this.nativeActivity(item.id),
					title: localize('codex.native.waiting', 'Waiting'),
					state: phase === 'started' ? 'running' : 'completed',
					detail: Object.freeze({ durationMilliseconds: item.durationMs }),
				}));
				return;
			}
			case 'enteredReviewMode':
			case 'exitedReviewMode': {
				if (typeof item.review !== 'string') {
					throw new Error(`Codex ${item.type} item is invalid.`);
				}
				this.emitBehavior(active.request, Object.freeze({
					kind: 'status',
					state: item.type === 'enteredReviewMode' ? 'paused' : 'working',
					message: item.review,
				}));
				return;
			}
			case 'contextCompaction':
				this.emitBehavior(active.request, Object.freeze({
					kind: 'context',
					usedTokens: active.contextUsedTokens,
					maximumTokens: active.contextMaximumTokens,
					compaction: phase === 'started' ? 'running' : 'completed',
				}));
				return;
			default:
				throw new Error(`Codex item type '${item.type}' is unsupported.`);
		}
	}

	private consumeCollaborationItem(
		active: ICodexActiveTurn,
		item: Readonly<Record<string, unknown>>,
		phase: 'started' | 'completed',
	): void {
		if (
			typeof item.id !== 'string'
			|| typeof item.tool !== 'string'
			|| !Array.isArray(item.receiverThreadIds)
			|| !item.receiverThreadIds.every(value => typeof value === 'string')
		) {
			throw new Error('Codex collabAgentToolCall item is invalid.');
		}
		const status = phase === 'started' ? 'running' : this.nativeItemTerminalState(item);
		let title: string;
		switch (item.tool) {
			case 'spawnAgent':
				title = localize('codex.native.spawnAgent', 'Spawn agent');
				break;
			case 'sendInput':
				title = localize('codex.native.sendAgentInput', 'Send agent input');
				break;
			case 'resumeAgent':
				title = localize('codex.native.resumeAgent', 'Resume agent');
				break;
			case 'wait':
				title = localize('codex.native.waitForAgents', 'Wait for agents');
				break;
			case 'closeAgent':
				title = localize('codex.native.closeAgent', 'Close agent');
				break;
			default:
				throw new Error(`Codex collaboration Tool '${item.tool}' is unsupported.`);
		}
		const detail = Object.freeze({
			receiverThreadIds: Object.freeze([...item.receiverThreadIds] as string[]),
			...(typeof item.prompt === 'string' ? { prompt: item.prompt } : {}),
			...(typeof item.model === 'string' ? { model: item.model } : {}),
		});
		this.emitBehavior(active.request, Object.freeze({
			kind: 'task',
			task: createAgentTaskId(this.nativeIdentity('collaboration', item.id)),
			title,
			state: status,
			detail,
		}));
	}

	private consumeSubAgentItem(
		active: ICodexActiveTurn,
		item: Readonly<Record<string, unknown>>,
		phase: 'started' | 'completed',
	): void {
		if (
			typeof item.id !== 'string'
			|| typeof item.agentThreadId !== 'string'
			|| typeof item.agentPath !== 'string'
			|| typeof item.kind !== 'string'
		) {
			throw new Error('Codex subAgentActivity item is invalid.');
		}
		const state = item.kind === 'interrupted'
			? 'cancelled'
			: phase === 'completed'
				? 'completed'
				: 'running';
		this.emitBehavior(active.request, Object.freeze({
			kind: 'task',
			task: createAgentTaskId(this.nativeIdentity('subagent', item.agentThreadId)),
			title: item.agentPath,
			state,
			detail: Object.freeze({ nativeThreadId: item.agentThreadId, activity: item.kind }),
		}));
	}

	private consumeImageItem(
		active: ICodexActiveTurn,
		item: Readonly<Record<string, unknown>>,
		phase: 'started' | 'completed',
	): void {
		if (typeof item.id !== 'string') {
			throw new Error('Codex image item is invalid.');
		}
		if (item.type === 'imageView') {
			if (typeof item.path !== 'string') {
				throw new Error('Codex imageView item is invalid.');
			}
			this.emitBehavior(active.request, Object.freeze({
				kind: 'nativeTool',
				activity: this.nativeActivity(item.id),
				name: localize('codex.native.viewImage', 'View image'),
				category: 'file',
				state: phase === 'started' ? 'running' : 'completed',
				input: Object.freeze({ path: item.path }),
			}));
			return;
		}
		if (typeof item.status !== 'string' || typeof item.result !== 'string') {
			throw new Error('Codex imageGeneration item is invalid.');
		}
		this.emitBehavior(active.request, Object.freeze({
			kind: 'background',
			activity: this.nativeActivity(item.id),
			title: localize('codex.native.generateImage', 'Generate image'),
			state: phase === 'started'
				? 'running'
				: item.status === 'failed'
					? 'failed'
					: 'completed',
			detail: Object.freeze({
				status: item.status,
				result: item.result,
				...(typeof item.savedPath === 'string' ? { savedPath: item.savedPath } : {}),
			}),
		}));
	}

	private consumeTerminalDelta(params: unknown): void {
		const correlated = this.correlatedActive(params, 'item/commandExecution/outputDelta');
		if (correlated === undefined) {
			return;
		}
		if (typeof correlated.value.itemId !== 'string' || typeof correlated.value.delta !== 'string') {
			throw new Error('Codex command output notification is invalid.');
		}
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'terminal',
			activity: this.nativeActivity(correlated.value.itemId),
			terminal: this.nativeIdentity('terminal', correlated.value.itemId),
			stream: 'stdout',
			text: correlated.value.delta,
		}));
	}

	private consumeNativeToolDelta(params: unknown, category: 'file' | 'mcp'): void {
		const correlated = this.correlatedActive(params, `item/${category}/delta`);
		if (correlated === undefined) {
			return;
		}
		const value = correlated.value;
		const text = typeof value.delta === 'string' ? value.delta : value.message;
		if (typeof value.itemId !== 'string' || typeof text !== 'string') {
			throw new Error(`Codex ${category} progress notification is invalid.`);
		}
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'nativeTool',
			activity: this.nativeActivity(value.itemId),
			name: category === 'file'
				? localize('codex.native.fileChanges', 'File changes')
				: localize('codex.native.mcpTool', 'MCP Tool'),
			category,
			state: 'running',
			output: Object.freeze({ text }),
		}));
	}

	private consumeFileChanges(params: unknown): void {
		const correlated = this.correlatedActive(params, 'item/fileChange/patchUpdated');
		if (correlated === undefined) {
			return;
		}
		if (typeof correlated.value.itemId !== 'string') {
			throw new Error('Codex file change notification is invalid.');
		}
		const changes = this.fileChanges(correlated.value.changes, 'item/fileChange/patchUpdated.changes');
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'nativeTool',
			activity: this.nativeActivity(correlated.value.itemId),
			name: localize('codex.native.fileChanges', 'File changes'),
			category: 'file',
			state: 'running',
			output: Object.freeze({
				changes: Object.freeze(changes.map(change => Object.freeze({
					path: change.path,
					operation: change.operation,
					diff: change.diff,
					...(change.previousPath === undefined ? {} : { previousPath: change.previousPath }),
				}))),
			}),
		}));
	}

	private emitFileChangeBehaviors(active: ICodexActiveTurn, itemId: string, changes: readonly ICodexFileChange[]): void {
		for (const change of changes) {
			this.emitBehavior(active.request, Object.freeze({
				kind: 'fileChange',
				activity: this.nativeActivity(itemId),
				resource: change.path,
				operation: change.operation,
				data: Object.freeze({
					diff: change.diff,
					...(change.previousPath === undefined ? {} : { previousResource: change.previousPath }),
				}),
			}));
		}
	}

	private consumePlanDelta(params: unknown): void {
		const correlated = this.correlatedActive(params, 'item/plan/delta');
		if (correlated === undefined) {
			return;
		}
		if (typeof correlated.value.delta !== 'string') {
			throw new Error('Codex plan delta notification is invalid.');
		}
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'status',
			state: 'working',
			message: correlated.value.delta,
			data: Object.freeze({ source: 'planDelta' }),
		}));
	}

	private consumePlan(params: unknown): void {
		const correlated = this.correlatedActive(params, 'turn/plan/updated');
		if (correlated === undefined) {
			return;
		}
		if (!Array.isArray(correlated.value.plan)) {
			throw new Error('Codex plan notification is invalid.');
		}
		const steps = correlated.value.plan.map((stepValue, index) => {
			const step = protocolRecord(stepValue, `turn/plan/updated.plan.${index}`);
			if (
				typeof step.step !== 'string'
				|| !['pending', 'inProgress', 'completed'].includes(String(step.status))
			) {
				throw new Error('Codex plan step is invalid.');
			}
			return Object.freeze({
				task: createAgentTaskId(this.nativeIdentity('plan-step', `${correlated.value.turnId}:${index}`)),
				title: step.step,
				state: step.status === 'inProgress' ? 'running' as const : step.status as 'pending' | 'completed',
			});
		});
		const completed = steps.length > 0 && steps.every(step => step.state === 'completed');
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'plan',
			plan: createAgentPlanId(this.nativeIdentity('turn-plan', String(correlated.value.turnId))),
			title: typeof correlated.value.explanation === 'string'
				? correlated.value.explanation
				: localize('codex.native.plan', 'Plan'),
			state: completed ? 'completed' : 'running',
			steps: Object.freeze(steps),
		}));
	}

	private consumeUsage(params: unknown): void {
		const correlated = this.correlatedActive(params, 'thread/tokenUsage/updated');
		if (correlated === undefined) {
			return;
		}
		const tokenUsage = protocolRecord(correlated.value.tokenUsage, 'thread/tokenUsage/updated.tokenUsage');
		const last = protocolRecord(tokenUsage.last, 'thread/tokenUsage/updated.tokenUsage.last');
		for (const key of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'totalTokens'] as const) {
			if (typeof last[key] !== 'number' || !Number.isInteger(last[key]) || last[key] < 0) {
				throw new Error('Codex token usage notification is invalid.');
			}
		}
		correlated.active.contextUsedTokens = last.totalTokens as number;
		if (typeof tokenUsage.modelContextWindow === 'number') {
			if (!Number.isInteger(tokenUsage.modelContextWindow) || tokenUsage.modelContextWindow < correlated.active.contextUsedTokens) {
				throw new Error('Codex context window notification is invalid.');
			}
			correlated.active.contextMaximumTokens = tokenUsage.modelContextWindow;
		}
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'usage',
			inputTokens: last.inputTokens as number,
			outputTokens: last.outputTokens as number,
			cachedInputTokens: last.cachedInputTokens as number,
			...(typeof last.reasoningOutputTokens === 'number'
				? { data: Object.freeze({ reasoningOutputTokens: last.reasoningOutputTokens }) }
				: {}),
		}));
		if (correlated.active.contextMaximumTokens > 0) {
			this.emitBehavior(correlated.active.request, Object.freeze({
				kind: 'context',
				usedTokens: correlated.active.contextUsedTokens,
				maximumTokens: correlated.active.contextMaximumTokens,
				compaction: 'none',
			}));
		}
	}

	private consumeCompaction(params: unknown): void {
		const correlated = this.correlatedActive(params, 'thread/compacted');
		if (correlated === undefined) {
			return;
		}
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'context',
			usedTokens: correlated.active.contextUsedTokens,
			maximumTokens: correlated.active.contextMaximumTokens,
			compaction: 'completed',
		}));
	}

	private consumeTurnDiff(params: unknown): void {
		const correlated = this.correlatedActive(params, 'turn/diff/updated');
		if (correlated === undefined) {
			return;
		}
		if (typeof correlated.value.diff !== 'string') {
			throw new Error('Codex Turn diff notification is invalid.');
		}
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'status',
			state: 'working',
			message: localize('codex.native.turnDiffUpdated', 'Turn diff updated'),
			data: Object.freeze({ diff: correlated.value.diff }),
		}));
	}

	private consumeError(params: unknown): void {
		const correlated = this.correlatedActive(params, 'error');
		if (correlated === undefined) {
			return;
		}
		const error = protocolRecord(correlated.value.error, 'error.error');
		const message = typeof error.message === 'string'
			? error.message
			: localize('codex.native.executionError', 'Codex execution error');
		if (correlated.value.willRetry === true) {
			correlated.active.retryAttempt += 1;
			this.emitBehavior(correlated.active.request, Object.freeze({
				kind: 'retry',
				attempt: correlated.active.retryAttempt,
				reason: message,
			}));
			return;
		}
		if (correlated.value.willRetry !== false) {
			throw new Error('Codex error notification is invalid.');
		}
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'status',
			state: 'paused',
			message,
		}));
	}

	private consumeModelRerouted(params: unknown): void {
		const correlated = this.correlatedActive(params, 'model/rerouted');
		if (correlated === undefined) {
			return;
		}
		if (typeof correlated.value.fromModel !== 'string' || typeof correlated.value.toModel !== 'string') {
			throw new Error('Codex model reroute notification is invalid.');
		}
		correlated.active.retryAttempt += 1;
		const reason = this.optionalProtocolValue(correlated.value.reason, 'model/rerouted.reason');
		this.emitBehavior(correlated.active.request, Object.freeze({
			kind: 'retry',
			attempt: correlated.active.retryAttempt,
			reason: localize(
				'codex.native.modelRerouted',
				'Model rerouted from {0} to {1}',
				correlated.value.fromModel,
				correlated.value.toModel,
			),
			...(reason === undefined ? {} : { data: Object.freeze({ reason }) }),
		}));
	}

	private consumeThreadStatus(params: unknown): void {
		const value = protocolRecord(params, 'thread/status/changed');
		if (typeof value.threadId !== 'string') {
			throw new Error('Codex thread status notification is invalid.');
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined) {
			return;
		}
		const status = protocolRecord(value.status, 'thread/status/changed.status');
		if (typeof status.type !== 'string') {
			throw new Error('Codex thread status notification is invalid.');
		}
		const state = status.type === 'active' ? 'working' : status.type === 'idle' ? 'waiting' : 'paused';
		this.emitBehavior(active.request, Object.freeze({
			kind: 'status',
			state,
			message: localize('codex.native.threadStatus', 'Codex thread {0}', status.type),
		}));
	}

	private consumeWarning(params: unknown): void {
		const value = protocolRecord(params, 'warning');
		if (typeof value.message !== 'string' || (value.threadId !== null && typeof value.threadId !== 'string')) {
			throw new Error('Codex warning notification is invalid.');
		}
		if (value.threadId === null) {
			return;
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (
			active !== undefined
			&& !this.terminalTurns.has(this.turnKey(active.request.session, active.request.chat, active.request.turn))
		) {
			this.emitBehavior(active.request, Object.freeze({
				kind: 'status',
				state: 'paused',
				message: value.message,
			}));
		}
	}

	private consumeUnhandledNotification(method: string, params: unknown): void {
		switch (method) {
			case 'thread/started':
			case 'thread/archived':
			case 'thread/deleted':
			case 'thread/unarchived':
			case 'thread/closed':
			case 'thread/name/updated':
			case 'thread/goal/updated':
			case 'thread/goal/cleared':
			case 'thread/settings/updated':
			case 'skills/changed':
			case 'mcpServer/oauthLogin/completed':
			case 'mcpServer/startupStatus/updated':
			case 'account/updated':
			case 'account/rateLimits/updated':
			case 'account/login/completed':
			case 'app/list/updated':
			case 'remoteControl/status/changed':
			case 'externalAgentConfig/import/progress':
			case 'externalAgentConfig/import/completed':
			case 'fs/changed':
			case 'fuzzyFileSearch/sessionUpdated':
			case 'fuzzyFileSearch/sessionCompleted':
			case 'windows/worldWritableWarning':
			case 'windowsSandbox/setupCompleted':
			case 'deprecationNotice':
			case 'configWarning':
				protocolRecord(params, method);
				return;
			default:
				throw new Error(`Codex app-server notification '${method}' is unsupported by the pinned mapping.`);
		}
	}

	private correlatedActive(
		params: unknown,
		field: string,
	): { readonly value: Readonly<Record<string, unknown>>; readonly active: ICodexActiveTurn } | undefined {
		const value = protocolRecord(params, field);
		if (typeof value.threadId !== 'string' || typeof value.turnId !== 'string') {
			throw new Error(`Codex ${field} notification is invalid.`);
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined || (active.appServerTurnId !== undefined && active.appServerTurnId !== value.turnId)) {
			return undefined;
		}
		if (this.terminalTurns.has(this.turnKey(active.request.session, active.request.chat, active.request.turn))) {
			return undefined;
		}
		return { value, active };
	}

	private optionalProtocolValue(value: unknown, field: string): AgentHostProtocolValue | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		try {
			assertAgentHostProtocolValue(value);
		} catch {
			throw new Error(`Codex ${field} value is invalid.`);
		}
		return value;
	}

	private nativeIdentity(kind: string, nativeId: string): string {
		return `codex-${kind}-${createHash('sha256').update(nativeId).digest('hex').slice(0, 32)}`;
	}

	private nativeActivity(nativeId: string): AgentBehaviorActivityId {
		return createAgentBehaviorActivityId(this.nativeIdentity('activity', nativeId));
	}

	private nativeItemTerminalState(
		item: Readonly<Record<string, unknown>>,
	): 'completed' | 'cancelled' | 'failed' {
		if (item.type === 'commandExecution' || item.type === 'fileChange') {
			if (item.status === 'completed') {
				return 'completed';
			}
			if (item.status === 'declined') {
				return 'cancelled';
			}
			if (item.status === 'failed') {
				return 'failed';
			}
			throw new Error(`Codex ${String(item.type)} item completed with invalid status.`);
		}
		if (item.type === 'mcpToolCall' || item.type === 'collabAgentToolCall') {
			if (item.status === 'completed') {
				return 'completed';
			}
			if (item.status === 'failed') {
				return 'failed';
			}
			throw new Error(`Codex ${String(item.type)} item completed with invalid status.`);
		}
		return 'completed';
	}

	private fileChanges(value: unknown, field: string): readonly ICodexFileChange[] {
		if (!Array.isArray(value)) {
			throw new Error(`Codex ${field} value is invalid.`);
		}
		return Object.freeze(value.map((changeValue, index) => {
			const change = protocolRecord(changeValue, `${field}.${index}`);
			const kind = protocolRecord(change.kind, `${field}.${index}.kind`);
			if (
				typeof change.path !== 'string'
				|| change.path.length === 0
				|| typeof change.diff !== 'string'
				|| typeof kind.type !== 'string'
			) {
				throw new Error(`Codex ${field}.${index} value is invalid.`);
			}
			if (kind.type === 'add') {
				return Object.freeze({ path: change.path, operation: 'create' as const, diff: change.diff });
			}
			if (kind.type === 'delete') {
				return Object.freeze({ path: change.path, operation: 'delete' as const, diff: change.diff });
			}
			if (kind.type === 'update' && (kind.move_path === null || typeof kind.move_path === 'string')) {
				return Object.freeze({
					path: change.path,
					operation: kind.move_path === null ? 'modify' as const : 'rename' as const,
					...(kind.move_path === null ? {} : { previousPath: kind.move_path }),
					diff: change.diff,
				});
			}
			throw new Error(`Codex ${field}.${index}.kind value is unsupported.`);
		}));
	}

	private consumeTurnCompleted(params: unknown): void {
		const value = protocolRecord(params, 'turn/completed');
		const turn = protocolRecord(value.turn, 'turn/completed.turn');
		if (typeof value.threadId !== 'string' || typeof turn.id !== 'string' || typeof turn.status !== 'string') {
			throw new Error('Codex turn/completed notification is invalid.');
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined || (active.appServerTurnId !== undefined && active.appServerTurnId !== turn.id)) {
			return;
		}
		this.cancelPendingInteractions(active, true);
		switch (turn.status) {
			case 'completed':
				this.emitTerminal(active.request, 'completed');
				break;
			case 'interrupted':
				this.emitTerminal(active.request, 'cancelled');
				break;
			case 'failed':
				this.emitTerminal(active.request, 'failed', Object.freeze({ kind: 'codexTurnFailed' }));
				break;
			default:
				active.rejectCompletion(new Error(`Codex completed a Turn with invalid status '${turn.status}'.`));
				return;
		}
		active.resolveCompletion();
	}

	private requestCommandApproval(id: RequestId, params: unknown): Promise<unknown> {
		const { active, value } = this.nativeRequestActive(params, 'item/commandExecution/requestApproval');
		if (typeof value.itemId !== 'string') {
			throw new Error('Codex command approval request is invalid.');
		}
		const decisions = value.availableDecisions === null || value.availableDecisions === undefined
			? Object.freeze<AgentHostProtocolValue[]>(['accept', 'acceptForSession', 'decline', 'cancel'])
			: this.protocolArray(value.availableDecisions, 'commandApproval.availableDecisions');
		const options = this.approvalOptions(decisions);
		const decisionByOption = new Map<string, AgentHostProtocolValue>(
			options.map((option, index) => [option.id, decisions[index]]),
		);
		return this.createPendingInteraction(
			id,
			'item/commandExecution/requestApproval',
			active,
			Object.freeze({
				id: this.interactionIdentity(id, 'commandApproval', active),
				kind: 'permission',
				title: localize('codex.interaction.runCommand', 'Run command'),
				description: typeof value.command === 'string'
					? value.command
					: typeof value.reason === 'string'
						? value.reason
						: localize(
							'codex.interaction.runCommand.description',
							'Codex requests permission to run a command.',
						),
				activity: this.nativeActivity(value.itemId),
				options,
				metadata: Object.freeze({
					...(typeof value.command === 'string' ? { command: value.command } : {}),
					...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
					...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
				}),
			}),
			response => {
				if (response.kind === 'cancelled') {
					return Object.freeze({ decision: 'cancel' });
				}
				if (response.kind !== 'selected') {
						throw new AgentHostError(
							AgentHostErrorCode.InvalidProtocolValue,
							'Codex command approval requires a selected option',
							{ field: 'interaction.response.kind', value: response.kind },
						);
				}
				const decision = decisionByOption.get(response.option);
				if (decision === undefined) {
					throw new AgentHostError(
							AgentHostErrorCode.InvalidProtocolValue,
							'Codex command approval selected an unknown decision',
							{ field: 'interaction.response.option', value: response.option },
						);
				}
				return Object.freeze({ decision });
			},
			Object.freeze({ decision: 'cancel' }),
		);
	}

	private requestFileApproval(id: RequestId, params: unknown): Promise<unknown> {
		const { active, value } = this.nativeRequestActive(params, 'item/fileChange/requestApproval');
		if (typeof value.itemId !== 'string') {
			throw new Error('Codex file approval request is invalid.');
		}
		const decisions = Object.freeze<AgentHostProtocolValue[]>(['accept', 'acceptForSession', 'decline', 'cancel']);
		const options = this.approvalOptions(decisions);
		const decisionByOption = new Map<string, AgentHostProtocolValue>(
			options.map((option, index) => [option.id, decisions[index]]),
		);
		return this.createPendingInteraction(
			id,
			'item/fileChange/requestApproval',
			active,
			Object.freeze({
				id: this.interactionIdentity(id, 'fileApproval', active),
				kind: 'permission',
				title: localize('codex.interaction.applyFileChanges', 'Apply file changes'),
				description: typeof value.reason === 'string'
					? value.reason
					: localize(
						'codex.interaction.applyFileChanges.description',
						'Codex requests permission to modify files.',
					),
				activity: this.nativeActivity(value.itemId),
				options,
				metadata: Object.freeze({
					...(typeof value.grantRoot === 'string' ? { grantRoot: value.grantRoot } : {}),
				}),
			}),
			response => {
				if (response.kind === 'cancelled') {
					return Object.freeze({ decision: 'cancel' });
				}
				if (response.kind !== 'selected') {
					throw new AgentHostError(
						AgentHostErrorCode.InvalidProtocolValue,
						'Codex file approval requires a selected option',
						{ field: 'interaction.response.kind', value: response.kind },
					);
				}
				const decision = decisionByOption.get(response.option);
				if (typeof decision !== 'string') {
					throw new AgentHostError(
							AgentHostErrorCode.InvalidProtocolValue,
							'Codex file approval selected an unknown decision',
							{ field: 'interaction.response.option', value: response.option },
						);
				}
				return Object.freeze({ decision });
			},
			Object.freeze({ decision: 'cancel' }),
		);
	}

	private requestPermissionsApproval(id: RequestId, params: unknown): Promise<unknown> {
		const { active, value } = this.nativeRequestActive(params, 'item/permissions/requestApproval');
		if (typeof value.itemId !== 'string') {
			throw new Error('Codex permissions approval request is invalid.');
		}
		const requested = protocolRecord(value.permissions, 'item/permissions/requestApproval.permissions');
		const granted: Record<string, AgentHostProtocolValue> = {};
		if (requested.network !== null && requested.network !== undefined) {
			assertAgentHostProtocolValue(requested.network);
			granted.network = requested.network;
		}
		if (requested.fileSystem !== null && requested.fileSystem !== undefined) {
			assertAgentHostProtocolValue(requested.fileSystem);
			granted.fileSystem = requested.fileSystem;
		}
		const options = Object.freeze([
			Object.freeze({
				id: 'allow-turn',
				label: localize('codex.interaction.allowTurn', 'Allow for this turn'),
			}),
			Object.freeze({
				id: 'allow-session',
				label: localize('codex.interaction.allowSession', 'Allow for this session'),
			}),
			Object.freeze({ id: 'decline', label: localize('codex.interaction.decline', 'Decline') }),
		]);
		return this.createPendingInteraction(
			id,
			'item/permissions/requestApproval',
			active,
			Object.freeze({
				id: this.interactionIdentity(id, 'permissionsApproval', active),
				kind: 'permission',
				title: localize('codex.interaction.grantPermissions', 'Grant additional permissions'),
				description: typeof value.reason === 'string'
					? value.reason
					: localize(
						'codex.interaction.grantPermissions.description',
						'Codex requests additional sandbox permissions.',
					),
				activity: this.nativeActivity(value.itemId),
				options,
				metadata: Object.freeze({
					permissions: Object.freeze(granted),
					...(typeof value.cwd === 'string' ? { cwd: value.cwd } : {}),
				}),
			}),
			response => {
				if (response.kind === 'cancelled' || (response.kind === 'selected' && response.option === 'decline')) {
					return Object.freeze({ permissions: Object.freeze({}), scope: 'turn' });
				}
				if (response.kind !== 'selected' || !['allow-turn', 'allow-session'].includes(response.option)) {
					throw new AgentHostError(
						AgentHostErrorCode.InvalidProtocolValue,
						'Codex permission request selected an unknown decision',
						{
							field: 'interaction.response.option',
							value: response.kind === 'selected' ? response.option : response.kind,
						},
					);
				}
				return Object.freeze({
					permissions: Object.freeze(granted),
					scope: response.option === 'allow-session' ? 'session' : 'turn',
				});
			},
			Object.freeze({ permissions: Object.freeze({}), scope: 'turn' }),
		);
	}

	private requestUserInput(id: RequestId, params: unknown): Promise<unknown> {
		const { active, value } = this.nativeRequestActive(params, 'item/tool/requestUserInput');
		if (typeof value.itemId !== 'string' || !Array.isArray(value.questions) || value.questions.length === 0) {
			throw new Error('Codex user input request is invalid.');
		}
		const properties: Record<string, AgentHostProtocolValue> = {};
		const required: string[] = [];
		const questionMetadata: AgentHostProtocolValue[] = [];
		for (const [index, questionValue] of value.questions.entries()) {
			const question = protocolRecord(questionValue, `item/tool/requestUserInput.questions.${index}`);
			if (
				typeof question.id !== 'string'
				|| question.id.length === 0
				|| typeof question.header !== 'string'
				|| typeof question.question !== 'string'
				|| typeof question.isOther !== 'boolean'
				|| typeof question.isSecret !== 'boolean'
				|| (question.options !== null && !Array.isArray(question.options))
			) {
				throw new Error('Codex user input question is invalid.');
			}
			const labels = question.options === null
				? undefined
				: question.options.map((optionValue, optionIndex) => {
					const option = protocolRecord(optionValue, `item/tool/requestUserInput.questions.${index}.options.${optionIndex}`);
					if (typeof option.label !== 'string' || typeof option.description !== 'string') {
						throw new Error('Codex user input option is invalid.');
					}
					return option.label;
				});
			properties[question.id] = Object.freeze({
				type: 'array',
				items: Object.freeze({
					type: 'string',
					...(labels === undefined ? {} : { enum: Object.freeze(labels) }),
				}),
				minItems: 1,
			});
			required.push(question.id);
			questionMetadata.push(Object.freeze({
				id: question.id,
				header: question.header,
				question: question.question,
				allowsOther: question.isOther,
				secret: question.isSecret,
			}));
		}
		return this.createPendingInteraction(
			id,
			'item/tool/requestUserInput',
			active,
			Object.freeze({
				id: this.interactionIdentity(id, 'userInput', active),
				kind: 'input',
				title: localize('codex.interaction.needsInput', 'Codex needs input'),
				description: localize(
					'codex.interaction.needsInput.description',
					'Answer the questions to continue the Codex turn.',
				),
				activity: this.nativeActivity(value.itemId),
				input: Object.freeze({
					shape: 'form',
					schema: Object.freeze({
						type: 'object',
						properties: Object.freeze(properties),
						required: Object.freeze(required),
						additionalProperties: false,
					}),
				}),
				metadata: Object.freeze({
					questions: Object.freeze(questionMetadata),
					...(typeof value.autoResolutionMs === 'number'
						? { autoResolutionMilliseconds: value.autoResolutionMs }
						: {}),
				}),
			}),
			response => this.userInputResponse(response, required),
			Object.freeze({ answers: Object.freeze({}) }),
		);
	}

	private requestMcpElicitation(id: RequestId, params: unknown): Promise<unknown> {
		const value = protocolRecord(params, 'mcpServer/elicitation/request');
		if (
			typeof value.threadId !== 'string'
			|| (value.turnId !== null && typeof value.turnId !== 'string')
			|| typeof value.serverName !== 'string'
			|| typeof value.mode !== 'string'
			|| typeof value.message !== 'string'
		) {
			throw new Error('Codex MCP elicitation request is invalid.');
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined || value.turnId === null || active.appServerTurnId !== value.turnId) {
			throw new Error('Codex MCP elicitation does not address the active Turn.');
		}
		if (value.mode === 'url') {
			if (typeof value.url !== 'string') {
				throw new Error('Codex MCP URL elicitation request is invalid.');
			}
			return this.createPendingInteraction(
				id,
				'mcpServer/elicitation/request',
				active,
				Object.freeze({
					id: this.interactionIdentity(id, 'mcpElicitation', active),
					kind: 'confirmation',
					title: value.serverName,
					description: value.message,
					options: Object.freeze([
						Object.freeze({ id: 'accept', label: localize('codex.interaction.accept', 'Accept') }),
						Object.freeze({ id: 'decline', label: localize('codex.interaction.decline', 'Decline') }),
					]),
					metadata: Object.freeze({ mode: value.mode, url: value.url }),
				}),
				response => Object.freeze({
					action: response.kind === 'selected' && response.option === 'accept'
						? 'accept'
						: response.kind === 'cancelled'
							? 'cancel'
							: 'decline',
					content: null,
					_meta: null,
				}),
				Object.freeze({ action: 'cancel', content: null, _meta: null }),
			);
		}
		const requestedSchema = this.optionalProtocolValue(value.requestedSchema, 'mcpServer/elicitation.requestedSchema');
		if (requestedSchema === undefined) {
			throw new Error('Codex MCP form elicitation has no schema.');
		}
		return this.createPendingInteraction(
			id,
			'mcpServer/elicitation/request',
			active,
			Object.freeze({
				id: this.interactionIdentity(id, 'mcpElicitation', active),
				kind: 'input',
				title: value.serverName,
				description: value.message,
				input: Object.freeze({ shape: 'form', schema: requestedSchema }),
				metadata: Object.freeze({ mode: value.mode }),
			}),
			response => {
				if (response.kind === 'cancelled') {
					return Object.freeze({ action: 'cancel', content: null, _meta: null });
				}
				if (response.kind !== 'submitted') {
					throw new AgentHostError(
						AgentHostErrorCode.InvalidProtocolValue,
						'Codex MCP elicitation requires submitted form data',
						{ field: 'interaction.response.kind', value: response.kind },
					);
				}
				return Object.freeze({ action: 'accept', content: response.value, _meta: null });
			},
			Object.freeze({ action: 'cancel', content: null, _meta: null }),
		);
	}

	private createPendingInteraction(
		nativeRequest: RequestId,
		method: string,
		active: ICodexActiveTurn,
		request: AgentInteractionRequest,
		response: ICodexPendingInteraction['response'],
		cancellationResponse: unknown,
	): Promise<unknown> {
		if (this.pendingInteractions.has(request.id)) {
			throw new Error(`Codex interaction '${request.id}' is already active.`);
		}
		return new Promise(resolveNative => {
			const pending: ICodexPendingInteraction = {
				id: request.id,
				nativeRequest,
				method,
				active,
				resolveNative,
				response,
				cancellationResponse,
			};
			this.pendingInteractions.set(request.id, pending);
			active.interactions.add(request.id);
			this.emit(Object.freeze({
				kind: 'interactionRequested',
				session: active.request.session,
				chat: active.request.chat,
				turn: active.request.turn,
				request,
			}));
		});
	}

	private cancelPendingInteractions(active: ICodexActiveTurn, emitCompletion: boolean): void {
		for (const interaction of [...active.interactions]) {
			const pending = this.pendingInteractions.get(interaction);
			if (pending === undefined) {
				throw new Error(`Codex interaction '${interaction}' is missing.`);
			}
			this.pendingInteractions.delete(interaction);
			active.interactions.delete(interaction);
			if (emitCompletion) {
				this.emit(Object.freeze({
					kind: 'interactionCompleted',
					session: active.request.session,
					chat: active.request.chat,
					turn: active.request.turn,
					interaction,
					response: Object.freeze({ kind: 'cancelled' }),
				}));
			}
			pending.resolveNative(pending.cancellationResponse);
		}
	}

	private nativeRequestActive(
		params: unknown,
		field: string,
	): { readonly active: ICodexActiveTurn; readonly value: Readonly<Record<string, unknown>> } {
		const value = protocolRecord(params, field);
		if (typeof value.threadId !== 'string' || typeof value.turnId !== 'string') {
			throw new Error(`Codex ${field} request is invalid.`);
		}
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined || active.appServerTurnId !== value.turnId) {
			throw new Error(`Codex ${field} request does not address the active Turn.`);
		}
		return { active, value };
	}

	private interactionIdentity(
		nativeRequest: RequestId,
		kind: string,
		active: ICodexActiveTurn,
	): AgentInteractionId {
		return createAgentInteractionId(this.nativeIdentity(
			`interaction-${kind}`,
			`${active.request.turn}:${typeof nativeRequest}:${String(nativeRequest)}`,
		));
	}

	private protocolArray(value: unknown, field: string): readonly AgentHostProtocolValue[] {
		if (!Array.isArray(value) || value.length === 0) {
			throw new Error(`Codex ${field} value is invalid.`);
		}
		return Object.freeze(value.map(entry => {
			assertAgentHostProtocolValue(entry);
			return entry;
		}));
	}

	private approvalOptions(decisions: readonly AgentHostProtocolValue[]) {
		return Object.freeze(decisions.map((decision, index) => Object.freeze({
			id: `decision-${index}`,
			label: this.approvalDecisionLabel(decision),
		})));
	}

	private approvalDecisionLabel(decision: AgentHostProtocolValue): string {
		if (decision === 'accept') {
			return localize('codex.interaction.allow', 'Allow');
		}
		if (decision === 'acceptForSession') {
			return localize('codex.interaction.allowSession', 'Allow for this session');
		}
		if (decision === 'decline') {
			return localize('codex.interaction.decline', 'Decline');
		}
		if (decision === 'cancel') {
			return localize('codex.interaction.cancelTurn', 'Cancel turn');
		}
		if (typeof decision === 'object' && decision !== null && !Array.isArray(decision)) {
			if (Object.hasOwn(decision, 'acceptWithExecpolicyAmendment')) {
				return localize(
					'codex.interaction.allowCommandPolicy',
					'Allow and remember command policy',
				);
			}
			if (Object.hasOwn(decision, 'applyNetworkPolicyAmendment')) {
				return localize('codex.interaction.applyNetworkPolicy', 'Apply network policy');
			}
		}
		throw new Error('Codex command approval decision is unsupported.');
	}

	private userInputResponse(
		response: IAgentInteractionResponseRequest['response'],
		questionIds: readonly string[],
	): AgentHostProtocolValue {
		if (response.kind === 'cancelled') {
			return Object.freeze({ answers: Object.freeze({}) });
		}
		if (
			response.kind !== 'submitted'
			|| response.value === null
			|| typeof response.value !== 'object'
			|| Array.isArray(response.value)
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Codex user input requires submitted form answers',
				{ field: 'interaction.response.value', value: response.kind },
			);
		}
		const submitted = response.value as Readonly<Record<string, AgentHostProtocolValue>>;
		const answers: Record<string, AgentHostProtocolValue> = {};
		for (const question of questionIds) {
			const answer = submitted[question];
			const values = typeof answer === 'string'
				? [answer]
				: Array.isArray(answer) && answer.every(value => typeof value === 'string')
					? answer
					: undefined;
			if (values === undefined || values.length === 0) {
					throw new AgentHostError(
						AgentHostErrorCode.InvalidProtocolValue,
						'Codex user input answer is missing',
						{ field: `interaction.response.value.${question}`, value: 'missing' },
					);
			}
			answers[question] = Object.freeze({ answers: Object.freeze(values) });
		}
		return Object.freeze({ answers: Object.freeze(answers) });
	}

	private async executeDynamicTool(params: unknown): Promise<unknown> {
		const value = protocolRecord(params, 'item/tool/call');
		if (
			typeof value.threadId !== 'string'
			|| typeof value.turnId !== 'string'
			|| typeof value.callId !== 'string'
			|| typeof value.tool !== 'string'
		) {
			throw new Error('Codex dynamic Tool request is invalid.');
		}
		assertAgentHostProtocolValue(value.arguments);
		const active = this.activeTurnsByThread.get(value.threadId);
		if (active === undefined || (active.appServerTurnId !== undefined && active.appServerTurnId !== value.turnId)) {
			throw new Error('Codex dynamic Tool request does not address the active Turn.');
		}
		const registration = active.request.binding.toolSet.registrations.find(
			candidate => candidate.descriptor.functionName === value.tool,
		);
		if (registration === undefined) {
			throw new Error(`Codex requested Tool '${value.tool}' outside the accepted Host Tool set.`);
		}
		const call = await this.createToolCall(active.request, registration, value.arguments);
		this.emitBehavior(active.request, Object.freeze({
			kind: 'contributedToolCall',
			call: call.id,
			tool: call.tool,
			input: call.input,
		}));
		const result = await this.toolExecution.execute(call, () => undefined);
		assertAgentToolResult(result);
		if (result.call !== call.id) {
			throw new Error('Codex Host Tool result identity changed.');
		}
		if (result.status === 'completed') {
			this.emitBehavior(active.request, Object.freeze({
				kind: 'contributedToolResult',
				call: call.id,
				status: 'completed',
				output: result.output,
			}));
			return Object.freeze({
				contentItems: Object.freeze([{ type: 'inputText', text: encodeAgentHostProtocolValue(result.output) }]),
				success: true,
			});
		}
		this.emitBehavior(active.request, Object.freeze({
			kind: 'contributedToolResult',
			call: call.id,
			status: result.status,
			output: result.failure.data,
		}));
		return Object.freeze({
			contentItems: Object.freeze([{ type: 'inputText', text: result.failure.message }]),
			success: false,
		});
	}

	private async createToolCall(
		request: IAgentChatRequest,
		registration: IAgentToolRegistration,
		input: AgentHostProtocolValue,
	): Promise<IAgentToolCall> {
		const id = createAgentToolCallId(`codex-sdk:${request.turn}:${this.nextToolCall++}`);
		const deadline = Math.min(request.binding.deadline, Date.now() + registration.descriptor.limits.timeoutMilliseconds);
		const common = Object.freeze({
			id,
			agent: CODEX_AGENT_ID,
			registration: this.requireRegistration().revision,
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			toolSet: request.binding.toolSet.revision,
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
		const operation = createAgentHostOperationId(`codex-sdk-tool:${request.turn}:${this.nextToolCall}`);
		const payloadDigest = await computeAgentToolMutationPayloadDigest({
			...common,
			effect: Object.freeze({ kind: 'mutation', operation }),
		});
		return Object.freeze({
			...common,
			effect: Object.freeze({ kind: 'mutation', operation, payloadDigest }),
		});
	}

	private async deleteThread(chat: ICodexChatState): Promise<void> {
		if (chat.resume.threadId === null) {
			return;
		}
		let client = this.client;
		let ownsClient = false;
		if (client === undefined) {
			client = await this.appServerFactory.start();
			ownsClient = true;
		}
		try {
			await client.request('thread/delete', { threadId: chat.resume.threadId });
		} finally {
			if (ownsClient) {
				client.dispose();
			}
		}
	}

	private handleClientExit(client: ICodexAppServerClient): void {
		if (this.retiringClients.delete(client)) {
			return;
		}
		if (this.client !== client) {
			return;
		}
		this.client = undefined;
		this.credentialDigest = undefined;
		for (const active of this.activeTurnsByHost.values()) {
			this.cancelPendingInteractions(active, true);
			if (!this.terminalTurns.has(this.turnKey(active.request.session, active.request.chat, active.request.turn))) {
				this.emitTerminal(active.request, 'failed', Object.freeze({ kind: 'codexAppServerDisconnected' }));
			}
			active.rejectCompletion(new Error('Codex app-server disconnected.'));
		}
	}

	private executionProfile(data: string): ICodexExecutionProfileData {
		let value: unknown;
		try {
			value = JSON.parse(data);
		} catch {
			value = undefined;
		}
		if (!exactRecord(value, [
			'kind', 'model', 'approvalPolicy', 'sandboxMode', 'webSearchMode', 'personality',
			'reasoningEffort', 'reasoningSummary', 'credential',
		])) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex execution profile is invalid', {
				field: 'binding.profile.data',
				value: 'invalid',
			});
		}
		const profile = value as unknown as ICodexExecutionProfileData;
		if (
			profile.kind !== 'codexAppServerExecutionProfile'
			|| typeof profile.model !== 'string' || profile.model.length === 0
			|| !['untrusted', 'on-failure', 'on-request', 'never'].includes(profile.approvalPolicy)
			|| !['read-only', 'workspace-write', 'danger-full-access'].includes(profile.sandboxMode)
			|| !['disabled', 'cached', 'live'].includes(profile.webSearchMode)
			|| !['none', 'friendly', 'pragmatic'].includes(profile.personality)
			|| typeof profile.reasoningEffort !== 'string' || profile.reasoningEffort.length === 0
			|| !['none', 'auto', 'concise', 'detailed'].includes(profile.reasoningSummary)
			|| !exactRecord(profile.credential, ['provider', 'scope', 'reference'])
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex execution profile is invalid', {
				field: 'binding.profile.data',
				value: 'invalid',
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
			|| credentials[0].provider !== CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER
			|| credentials[0].scope !== 'llm'
			|| credentials[0].reference !== CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE
			|| encodeAgentHostProtocolValue(credentials[0]) !== encodeAgentHostProtocolValue(expected)
		) {
			throw new AgentHostError(
				AgentHostErrorCode.CredentialUnauthorized,
				'Codex API credential is not authorized',
				{ provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER, scope: 'llm' },
			);
		}
		return credentials[0];
	}

	private requireClient(): ICodexAppServerClient {
		return this.client ?? resourceMissing('authenticatedAppServer');
	}

	private requireDescriptor(): IAgentDescriptor {
		return this.descriptorValue ?? resourceMissing('descriptor');
	}

	private requireRegistration(): ReturnType<typeof createCodexAgentRegistration> {
		const descriptor = this.requireDescriptor();
		if (
			this.registration.descriptorRevision !== descriptor.revision
			|| this.registration.revision !== createCodexAgentRegistrationRevision(descriptor.revision)
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex Agent registration does not match its descriptor', {
				field: 'agent.registration',
				value: 'mismatch',
			});
		}
		return this.registration;
	}

	private validateSessionConfiguration(value: IAgentConfigurationState): IAgentConfigurationState {
		return validateAndFreezeAgentConfigurationState(value, {
			agent: CODEX_AGENT_ID,
			scope: 'session',
			revision: CODEX_AGENT_SESSION_CONFIGURATION_SCHEMA.revision,
		});
	}

	private createChatState(sessionId: AgentSessionId, chatId: AgentChatId): IAgentChatBacking {
		const session = this.requireMaterializedSession(sessionId);
		if (session.chats.has(chatId)) {
			return resourceMissing(`chatAlreadyExists:${sessionId}:${chatId}`);
		}
		const resume: ICodexChatResumeData = Object.freeze({
			kind: 'codex-app-server-chat',
			version: 1,
			threadId: null,
			toolSchemaDigest: null,
		});
		session.chats.set(chatId, { resume, materialized: true });
		return Object.freeze({ session: sessionId, chat: chatId, resume: this.resumeState(resume) });
	}

	private parseSessionResume(resume: IAgentResumeState | undefined): ICodexSessionResumeData {
		const value = this.parseResume(resume);
		if (
			!exactRecord(value, ['kind', 'version', 'workingDirectory', 'additionalDirectories'])
			|| value.kind !== 'codex-app-server-session'
			|| value.version !== 1
			|| typeof value.workingDirectory !== 'string'
			|| !isAbsolute(value.workingDirectory)
			|| !Array.isArray(value.additionalDirectories)
			|| value.additionalDirectories.some(directory => typeof directory !== 'string' || !isAbsolute(directory))
			|| new Set([value.workingDirectory, ...value.additionalDirectories]).size !== value.additionalDirectories.length + 1
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex Session resume state is invalid', {
				field: 'resume.data',
				value: 'invalid',
			});
		}
		return Object.freeze(value as unknown as ICodexSessionResumeData);
	}

	private parseChatResume(resume: IAgentResumeState | undefined): ICodexChatResumeData {
		const value = this.parseResume(resume);
		if (
			!exactRecord(value, ['kind', 'version', 'threadId', 'toolSchemaDigest'])
			|| value.kind !== 'codex-app-server-chat'
			|| value.version !== 1
			|| (value.threadId !== null && (typeof value.threadId !== 'string' || value.threadId.length === 0))
			|| (value.toolSchemaDigest !== null && (
				typeof value.toolSchemaDigest !== 'string'
				|| !/^sha256:[0-9a-f]{64}$/.test(value.toolSchemaDigest)
			))
			|| (value.threadId === null) !== (value.toolSchemaDigest === null)
		) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex Chat resume state is invalid', {
				field: 'resume.data',
				value: 'invalid',
			});
		}
		return Object.freeze(value as unknown as ICodexChatResumeData);
	}

	private parseResume(resume: IAgentResumeState | undefined): unknown {
		if (resume === undefined || resume.schema !== CODEX_AGENT_RESUME_SCHEMA) {
			throw new AgentHostError(AgentHostErrorCode.InvalidProtocolValue, 'Codex resume schema is unsupported', {
				field: 'resume.schema',
				value: resume?.schema ?? 'missing',
			});
		}
		try {
			return JSON.parse(resume.data);
		} catch {
			return undefined;
		}
	}

	private resumeState(data: ICodexSessionResumeData | ICodexChatResumeData): IAgentResumeState {
		return Object.freeze({ schema: CODEX_AGENT_RESUME_SCHEMA, data: JSON.stringify(data) });
	}

	private requireSession(session: AgentSessionId): ICodexSessionState {
		return this.sessionStates.get(session) ?? resourceMissing(`session:${session}`);
	}

	private requireMaterializedSession(session: AgentSessionId): ICodexSessionState {
		const state = this.requireSession(session);
		if (!state.materialized) {
			return resourceMissing(`materializedSession:${session}`);
		}
		return state;
	}

	private requireChat(session: AgentSessionId, chat: AgentChatId): ICodexChatState {
		return this.requireSession(session).chats.get(chat) ?? resourceMissing(`chat:${session}:${chat}`);
	}

	private requireMaterializedChat(session: AgentSessionId, chat: AgentChatId): ICodexChatState {
		const state = this.requireMaterializedSession(session).chats.get(chat) ?? resourceMissing(`chat:${session}:${chat}`);
		if (!state.materialized) {
			return resourceMissing(`materializedChat:${session}:${chat}`);
		}
		return state;
	}

	private emitBehavior(request: IAgentChatRequest, behavior: AgentTurnBehavior): void {
		this.emit(Object.freeze({
			kind: 'turnProgress',
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			progress: Object.freeze({ kind: 'behavior', behavior }),
		}));
	}

	private emitTerminal(
		request: IAgentChatRequest | IAgentCancelTurnRequest,
		state: 'completed' | 'cancelled' | 'failed',
		data?: AgentHostProtocolValue,
	): void {
		const turn = this.turnKey(request.session, request.chat, request.turn);
		if (this.terminalTurns.has(turn)) {
			return;
		}
		this.emit(Object.freeze({
			kind: 'turnTerminal',
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			state,
			...(data === undefined ? {} : { data }),
		}));
		const chat = this.sessionStates.get(request.session)?.chats.get(request.chat);
		if (chat !== undefined) {
			chat.latestTerminalTurn = request.turn;
		}
		this.terminalTurns.add(turn);
		while (this.terminalTurns.size > maximumRetainedTerminalTurns) {
			const oldest = this.terminalTurns.values().next().value as string | undefined;
			if (oldest === undefined) {
				throw new Error('Codex terminal Turn retention is inconsistent.');
			}
			this.terminalTurns.delete(oldest);
		}
	}

	private emit(action: IAgentAction): void {
		this.actionEmitter.fire(action);
	}

	private turnKey(session: AgentSessionId, chat: AgentChatId, turn: string): string {
		return `${session}\u0000${chat}\u0000${turn}`;
	}

	private deleteTerminalTurns(prefix: string): void {
		for (const turn of this.terminalTurns) {
			if (turn.startsWith(prefix)) {
				this.terminalTurns.delete(turn);
			}
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
			if (existing.state === 'completed') {
				return existing.value as unknown as TValue;
			}
			throw new AgentHostError(AgentHostErrorCode.OperationNotPending, 'Codex Agent operation is already pending', { operation });
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
			if (existing.state === 'completed') {
				return existing.value as unknown as TValue;
			}
			throw new AgentHostError(AgentHostErrorCode.OperationNotPending, 'Codex Agent operation is already pending', { operation });
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
		let completed = [...this.operations.values()].filter(candidate => candidate.state === 'completed').length;
		while (completed > maximumRetainedOperations) {
			const oldest = [...this.operations].find(([, candidate]) => candidate.state === 'completed');
			if (oldest === undefined) {
				throw new Error('Codex operation retention is inconsistent.');
			}
			this.operations.delete(oldest[0]);
			completed -= 1;
		}
	}

	private requireConfigurationTransaction(
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
	): ICodexConfigurationTransaction {
		const transaction = this.configurationTransactions.get(operation)
			?? resourceMissing(`configurationTransaction:${operation}`);
		this.assertOperationDigest(operation, transaction.digest, digest);
		return transaction;
	}

	private assertOperationDigest(
		operation: AgentHostOperationId,
		recorded: AgentHostPayloadDigest,
		received: AgentHostPayloadDigest,
	): void {
		if (recorded !== received) {
			this.digestConflict(operation, recorded, received);
		}
	}

	private digestConflict(
		operation: AgentHostOperationId,
		recordedDigest: AgentHostPayloadDigest,
		receivedDigest: AgentHostPayloadDigest,
	): never {
		throw new AgentHostError(
			AgentHostErrorCode.OperationDigestConflict,
			'Codex Agent operation digest conflicts with the recorded operation',
			{ operation, recordedDigest, receivedDigest },
		);
	}

	override dispose(): void {
		this.client?.dispose();
		this.client = undefined;
		this.credentialDigest = undefined;
		for (const active of this.activeTurnsByHost.values()) {
			this.cancelPendingInteractions(active, false);
			active.rejectCompletion(new Error('Codex Agent disposed.'));
		}
		this.activeTurnsByHost.clear();
		this.activeTurnsByThread.clear();
		super.dispose();
	}
}
