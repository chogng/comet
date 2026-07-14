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
import type { IAgentCredentialReference, IAgentCredentialResolver } from 'cs/platform/agentHost/common/credentials';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentConfigurationSchemaRevision,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostOperationId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentToolCallId,
	type AgentChatId,
	type AgentHostOperationId,
	type AgentHostPayloadDigest,
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
import type { ICodexAppServerClient, ICodexAppServerFactory } from './codexAppServer.js';
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

function codexJsonSchema(node: CometToolSchemaNode): AgentHostProtocolValue {
	const schema = (values: Readonly<Record<string, AgentHostProtocolValue>>): AgentHostProtocolValue => {
		const result: Record<string, AgentHostProtocolValue> = { ...values };
		if (node.description !== undefined) {
			result.description = node.description;
		}
		return Object.freeze(result);
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
			...(node.enum === undefined ? {} : { enum: node.enum }),
		});
		case 'array': return schema({
			type: 'array',
			items: codexJsonSchema(node.items),
			...(node.minimumItems === undefined ? {} : { minItems: node.minimumItems }),
			...(node.maximumItems === undefined ? {} : { maxItems: node.maximumItems }),
		});
		case 'object': {
			const properties = Object.freeze(Object.fromEntries(
				Object.entries(node.properties).map(([name, property]) => [name, codexJsonSchema(property)]),
			));
			return schema({
				type: 'object',
				properties,
				required: node.required,
				additionalProperties: false,
			});
		}
		case 'literal': return schema({ const: node.value });
		case 'oneOf': return schema({ oneOf: Object.freeze(node.variants.map(codexJsonSchema)) });
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
	readonly resumeStates: IAgentResumeStates = { migrate: request => this.migrateResumeState(request) };

	private readonly sessionStates = new Map<AgentSessionId, ICodexSessionState>();
	private readonly operations = new Map<AgentHostOperationId, ICodexOperationState>();
	private readonly configurationTransactions = new Map<AgentHostOperationId, ICodexConfigurationTransaction>();
	private readonly terminalTurns = new Set<string>();
	private readonly activeTurnsByThread = new Map<string, ICodexActiveTurn>();
	private readonly activeTurnsByHost = new Map<string, ICodexActiveTurn>();
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
				session.chats.set(request.chat, { resume: this.parseChatResume(request.resume), materialized: true });
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

	forkChat(_request: IAgentForkChatRequest): Promise<IAgentChatBacking> {
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Codex SDK chat forking is not supported',
			{ capability: 'chats.fork' },
		));
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

	steer(_request: IAgentSteerRequest): Promise<void> {
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Codex SDK steering is not supported',
			{ capability: 'chats.steer' },
		));
	}

	async cancel(request: IAgentCancelTurnRequest): Promise<void> {
		this.requireMaterializedChat(request.session, request.chat);
		await this.runAsyncOperation(request.operation, request.payloadDigest, async () => {
			const turn = this.turnKey(request.session, request.chat, request.turn);
			const active = this.activeTurnsByHost.get(turn);
			if (active !== undefined) {
				active.cancelled = true;
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
		const dynamicTools = request.binding.toolSet.registrations.map(registration => Object.freeze({
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
		this._register(client.onNotification('item/agentMessage/delta', params => this.consumeTextDelta(params, 'text')));
		this._register(client.onNotification('item/reasoning/textDelta', params => this.consumeTextDelta(params, 'reasoning')));
		this._register(client.onNotification('item/reasoning/summaryTextDelta', params => this.consumeTextDelta(params, 'reasoning')));
		this._register(client.onNotification('turn/completed', params => this.consumeTurnCompleted(params)));
		this._register(client.onRequest('item/tool/call', params => this.executeDynamicTool(params)));
		this._register(client.onRequest('item/commandExecution/requestApproval', async () => ({ decision: 'decline' })));
		this._register(client.onRequest('item/fileChange/requestApproval', async () => ({ decision: 'decline' })));
		this._register(client.onRequest('item/permissions/requestApproval', async () => ({ permissions: {}, scope: 'turn' })));
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
		if (value.delta.length > 0) {
			this.emitResponsePart(active.request, Object.freeze({ kind, text: value.delta }));
		}
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
		this.emitResponsePart(active.request, Object.freeze({
			kind: 'toolCall',
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
			this.emitResponsePart(active.request, Object.freeze({
				kind: 'toolResult',
				call: call.id,
				status: 'completed',
				output: result.output,
			}));
			return Object.freeze({
				contentItems: Object.freeze([{ type: 'inputText', text: encodeAgentHostProtocolValue(result.output) }]),
				success: true,
			});
		}
		this.emitResponsePart(active.request, Object.freeze({
			kind: 'toolResult',
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

	private emitResponsePart(request: IAgentChatRequest, part: AgentTurnResponsePart): void {
		this.emit(Object.freeze({
			kind: 'turnProgress',
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			progress: Object.freeze({ kind: 'response', part }),
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
			active.rejectCompletion(new Error('Codex Agent disposed.'));
		}
		this.activeTurnsByHost.clear();
		this.activeTurnsByThread.clear();
		super.dispose();
	}
}
