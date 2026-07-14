/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import { Emitter, Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import {
	getMockAgentPackageDefinition,
	type IMockAgentPackageDefinition,
} from 'cs/code/common/agentHost/test/mockAgentPackages';
import type {
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
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentRuntimeActionSequence,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
	createAgentRuntimeProtocolVersion,
	type AgentChatId,
	type AgentHostOperationId,
	type AgentHostPayloadDigest,
	type AgentPackageId,
	type AgentPackageRevision,
	type AgentRuntimeConnectionGeneration,
	type AgentRuntimeConnectionId,
	type AgentSessionId,
} from 'cs/platform/agentHost/common/identities';
import type { IInstalledAgentPackage } from 'cs/platform/agentHost/common/packages';
import type { IAgentRuntimeInstalledArtifactPort } from 'cs/platform/agentHost/common/runtimeSandbox';
import {
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import type {
	AgentRuntimeConnectionLaunchContext,
	IAgentRuntimeConnectionFactory,
} from 'cs/platform/agentHost/node/packages/agentPackageActivationRegistry';

const mockRuntimeProtocolVersion = createAgentRuntimeProtocolVersion('2');

export interface IMockAgentRuntimeRetentionLimits {
	readonly maximumRetainedOperations: number;
	readonly maximumRetainedTerminalTurns: number;
}

export const productMockAgentRuntimeRetentionLimits: IMockAgentRuntimeRetentionLimits = Object.freeze({
	maximumRetainedOperations: 4_096,
	maximumRetainedTerminalTurns: 4_096,
});

interface IMockChatState {
	readonly resume: IAgentResumeState;
	materialized: boolean;
}

interface IMockSessionState {
	configuration: IAgentConfigurationState;
	readonly resume: IAgentResumeState;
	materialized: boolean;
	readonly chats: Map<AgentChatId, IMockChatState>;
}

interface IMockOperationState {
	readonly digest: AgentHostPayloadDigest;
	state: 'pending' | 'completed';
	value: AgentHostProtocolValue;
}

interface IMockConfigurationTransaction {
	readonly digest: AgentHostPayloadDigest;
	readonly session: AgentSessionId;
	readonly current: IAgentConfigurationState;
	readonly candidate: IAgentConfigurationState;
	state: 'prepared' | 'committed' | 'rolledBack';
}

/** Construction values for one exact utility-process runtime generation. */
export interface IMockAgentRuntimeOptions {
	readonly packageId: AgentPackageId;
	readonly packageRevision: AgentPackageRevision;
	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly maximumRetainedOperations: number;
	readonly maximumRetainedTerminalTurns: number;
}

/** Creates deterministic in-process connections for product composition tests. */
export class MockAgentRuntimeConnectionFactory implements IAgentRuntimeConnectionFactory {
	private nextConnection = 1;

	constructor(
		private readonly installedArtifacts: Pick<IAgentRuntimeInstalledArtifactPort, 'authorizeInstalledPackage'>,
		private readonly retentionLimits: IMockAgentRuntimeRetentionLimits,
	) {}

	async create(
		installedPackage: IInstalledAgentPackage,
		_context: AgentRuntimeConnectionLaunchContext,
	): Promise<IAgentRuntimeConnection> {
		try {
			await this.installedArtifacts.authorizeInstalledPackage(installedPackage);
		} catch (error) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Installed mock Agent package does not match its connected runtime definition',
				{
					field: 'installedPackage',
					value: error instanceof Error ? error.message : installedPackage.packageId,
				},
			);
		}
		const sequence = this.nextConnection++;
		return new MockAgentRuntime({
			packageId: installedPackage.packageId,
			packageRevision: installedPackage.revision,
			connection: createAgentRuntimeConnectionId(`mock-test:${installedPackage.packageId}:${sequence}`),
			generation: createAgentRuntimeConnectionGeneration(1),
			...this.retentionLimits,
		});
	}
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
		'Mock Agent Runtime resource is missing',
		{ resource },
	);
}

/** Deterministic connected runtime used only by explicitly installed mock packages. */
export class MockAgentRuntime extends Disposable implements IAgentRuntimeConnection {
	private readonly definition: IMockAgentPackageDefinition;
	private readonly packageRevision: AgentPackageRevision;
	private readonly disconnectEmitter = this._register(new Emitter<Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>>());
	private readonly actionEmitter = this._register(new Emitter<IAgentRuntimeAction>());
	private readonly hostOperationEmitter = this._register(new Emitter<IAgentRuntimeHostOperationRequest>());
	private readonly sessions = new Map<AgentSessionId, IMockSessionState>();
	private readonly operations = new Map<AgentHostOperationId, IMockOperationState>();
	private readonly configurationTransactions = new Map<AgentHostOperationId, IMockConfigurationTransaction>();
	private readonly terminalTurns = new Set<string>();
	private stateValue: AgentRuntimeConnectionState;
	private initialized = false;
	private nextActionSequence = 1;
	private readonly maximumRetainedOperations: number;
	private readonly maximumRetainedTerminalTurns: number;

	readonly connection: AgentRuntimeConnectionId;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly onDidDisconnect = this.disconnectEmitter.event;
	readonly onDidReconnect = Event.None;
	readonly onDidEmitAction = this.actionEmitter.event;
	readonly onDidRequestHostOperation = this.hostOperationEmitter.event;

	constructor(options: IMockAgentRuntimeOptions) {
		super();
		this.definition = getMockAgentPackageDefinition(options.packageId);
		this.packageRevision = options.packageRevision;
		this.connection = options.connection;
		this.generation = options.generation;
		this.maximumRetainedOperations = this.validateRetentionLimit(
			options.maximumRetainedOperations,
			'maximumRetainedOperations',
		);
		this.maximumRetainedTerminalTurns = this.validateRetentionLimit(
			options.maximumRetainedTerminalTurns,
			'maximumRetainedTerminalTurns',
		);
		this.stateValue = Object.freeze({
			kind: 'connected',
			connection: options.connection,
			generation: options.generation,
		});
	}

	get state(): AgentRuntimeConnectionState {
		return this.stateValue;
	}

	initialize(request: IAgentRuntimeInitializeRequest): Promise<IAgentRuntimeInitializeResult> {
		this.assertConnected();
		if (this.initialized) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Mock Agent Runtime was already initialized',
				{ field: 'initialize', value: 'repeated' },
			));
		}
		if (
			request.connection !== this.connection
			|| request.generation !== this.generation
			|| request.packageId !== this.definition.packageId
			|| request.packageRevision !== this.packageRevision
			|| request.authorizedAgents.length !== 1
			|| request.authorizedAgents[0] !== this.definition.agentId
		) {
			return Promise.reject(new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Mock Agent Runtime initialization authority does not match',
				{ field: 'initialize.authority', value: request.packageId },
			));
		}
		const protocolVersion = selectAgentRuntimeProtocolVersion(
			request.protocolVersions,
			Object.freeze([mockRuntimeProtocolVersion]),
		);
		this.initialized = true;
		return Promise.resolve(Object.freeze({
			connection: request.connection,
			generation: request.generation,
			call: request.call,
			protocolVersion,
			transportLimits: Object.freeze({ ...request.transportLimits }),
			registrations: Object.freeze([Object.freeze({
				registration: this.definition.registration,
				descriptor: this.definition.descriptor,
			})]),
		}));
	}

	resolveSessionConfiguration(
		request: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>,
	): Promise<IAgentRuntimeResponse<IAgentResolvedSessionConfiguration>> {
		this.assertCall(request);
		const hostDefaults = validateAndFreezeAgentConfigurationState(request.request.hostDefaults, {
			agent: this.definition.agentId,
			scope: 'hostDefault',
			revision: this.definition.registration.hostDefaultsSchema.revision,
		});
		const candidate = validateAndFreezeAgentConfigurationCandidate(
			this.definition.sessionConfigurationSchema,
			request.request.candidate,
			'session',
		);
		return Promise.resolve(response(request, Object.freeze({
			schema: this.definition.sessionConfigurationSchema,
			values: resolveAgentSessionConfigurationValues(
				this.definition.sessionConfigurationSchema,
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
			'Mock Agent configuration uses static enum values',
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
				'Mock Agent Session configuration state is stale',
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
				'Mock Agent Session configuration decision is stale',
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
				'Mock Agent Session rollback decision is stale',
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
					'Mock Agent Session configuration decision is not terminal',
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
		const modelConfiguration = resolveAgentModelConfigurationCandidate(
			this.definition.modelConfigurationSchema,
			request.request.selection.configuration,
		);
		const data = encodeAgentHostProtocolValue(Object.freeze({
			kind: 'mockAgentExecutionProfile',
			agent: this.definition.agentId,
			selection: request.request.selection.value,
			sessionConfiguration: sessionConfiguration.values,
			modelConfiguration: modelConfiguration.values,
		}));
		const digest = createHash('sha256').update(data).digest('hex');
		return Promise.resolve(response(request, Object.freeze({
			revision: createAgentExecutionProfileRevision(`mock:${digest}`),
			digest: createAgentExecutionProfileDigest(`sha256:${digest}`),
			agentDescriptor: this.definition.descriptor.revision,
			modelDescriptor: this.definition.descriptor.models[0].revision,
			data,
		})));
	}

	migrateResumeState(
		request: IAgentRuntimeCall<IAgentResumeMigrationRequest>,
	): Promise<IAgentRuntimeResponse<IAgentResumeState>> {
		this.assertCall(request);
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.CapabilityUnsupported,
			'Mock Agent Runtime declares no resume migration edge',
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
			const resume = this.resumeState('session', request.request.session);
			this.sessions.set(request.request.session, {
				configuration: this.validateSessionConfiguration(request.request.configuration),
				resume,
				materialized: true,
				chats: new Map(),
			});
			return Object.freeze({ session: request.request.session, resume });
		});
		return Promise.resolve(response(request, value as unknown as IAgentSessionBacking));
	}

	materializeSession(
		request: IAgentRuntimeCall<IAgentMaterializeSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			const configuration = this.validateSessionConfiguration(request.request.configuration);
			const existing = this.sessions.get(request.request.session);
			if (existing === undefined) {
				const resume = request.request.resume ?? this.resumeState('session', request.request.session);
				this.assertResume(resume);
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
			for (const chat of session.chats.values()) {
				chat.materialized = false;
			}
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	deleteSession(
		request: IAgentRuntimeCall<IAgentDeleteSessionRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			this.sessions.delete(request.request.session);
			this.deleteTerminalTurns(`${request.request.session}\u0000`);
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	createChat(
		request: IAgentRuntimeCall<IAgentCreateChatOptions>,
	): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		this.assertCall(request);
		const value = this.runOperation(request.request.operation, request.request.payloadDigest, () => (
			this.createChatState(request.request.session, request.request.chat)
		));
		return Promise.resolve(response(request, value as unknown as IAgentChatBacking));
	}

	materializeChat(
		request: IAgentRuntimeCall<IAgentMaterializeChatRequest>,
	): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			const session = this.requireMaterializedSession(request.request.session);
			const existing = session.chats.get(request.request.chat);
			if (existing === undefined) {
				const resume = request.request.resume ?? this.resumeState('chat', request.request.chat);
				this.assertResume(resume);
				session.chats.set(request.request.chat, { resume, materialized: true });
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

	forkChat(
		request: IAgentRuntimeCall<IAgentForkChatRequest>,
	): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		this.assertCall(request);
		const value = this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			this.requireChat(request.request.session, request.request.source.chat);
			return this.createChatState(request.request.session, request.request.chat);
		});
		return Promise.resolve(response(request, value as unknown as IAgentChatBacking));
	}

	send(request: IAgentRuntimeCall<IAgentChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.requireMaterializedChat(request.request.session, request.request.chat);
		const operation = this.operations.get(request.request.operation);
		if (operation !== undefined) {
			this.assertOperationDigest(request.request.operation, operation.digest, request.request.payloadDigest);
			if (operation.state === 'completed') {
				return Promise.resolve(response(request, null));
			}
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Mock Agent Runtime operation is already pending',
				{ operation: request.request.operation },
			);
		}
		this.beginOperation(request.request.operation, request.request.payloadDigest);
		const turn = this.turnKey(request.request.session, request.request.chat, request.request.turn);
		if (!this.terminalTurns.has(turn)) {
			this.emit(request, Object.freeze({
				kind: 'turnProgress',
				session: request.request.session,
				chat: request.request.chat,
				turn: request.request.turn,
				progress: Object.freeze({ kind: 'state', state: 'running' }),
			}));
			this.emit(request, Object.freeze({
				kind: 'turnProgress',
				session: request.request.session,
				chat: request.request.chat,
				turn: request.request.turn,
				progress: Object.freeze({
					kind: 'response',
					part: Object.freeze({
						kind: 'text',
						text: `${this.definition.displayName} mock runtime completed the turn.`,
					}),
				}),
			}));
			this.emit(request, Object.freeze({
				kind: 'turnTerminal',
				session: request.request.session,
				chat: request.request.chat,
				turn: request.request.turn,
				state: 'completed',
			}));
			this.recordTerminalTurn(turn);
		}
		this.completeOperation(request.request.operation, null);
		return Promise.resolve(response(request, null));
	}

	steer(request: IAgentRuntimeCall<IAgentSteerRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.requireMaterializedChat(request.request.session, request.request.chat);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => null);
		return Promise.resolve(response(request, null));
	}

	cancel(request: IAgentRuntimeCall<IAgentCancelTurnRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.requireMaterializedChat(request.request.session, request.request.chat);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			const turn = this.turnKey(request.request.session, request.request.chat, request.request.turn);
			if (!this.terminalTurns.has(turn)) {
				this.emit(request, Object.freeze({
					kind: 'turnTerminal',
					session: request.request.session,
					chat: request.request.chat,
					turn: request.request.turn,
					state: 'cancelled',
				}));
				this.recordTerminalTurn(turn);
			}
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	deleteChat(request: IAgentRuntimeCall<IAgentDeleteChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		this.assertCall(request);
		this.runOperation(request.request.operation, request.request.payloadDigest, () => {
			this.sessions.get(request.request.session)?.chats.delete(request.request.chat);
			this.deleteTerminalTurns(`${request.request.session}\u0000${request.request.chat}\u0000`);
			return null;
		});
		return Promise.resolve(response(request, null));
	}

	getOperationOutcome(
		request: IAgentRuntimeCall<IAgentRuntimeOperationOutcomeRequest>,
	): Promise<IAgentRuntimeResponse<AgentRuntimeOperationOutcome>> {
		this.assertCall(request);
		const operation = this.operations.get(request.request.operation);
		let outcome: AgentRuntimeOperationOutcome;
		if (operation === undefined) {
			outcome = Object.freeze({ kind: 'unknown' });
		} else if (operation.digest !== request.request.digest) {
			outcome = Object.freeze({ kind: 'conflict', recordedDigest: operation.digest });
		} else if (operation.state === 'pending') {
			outcome = Object.freeze({ kind: 'pending' });
		} else {
			outcome = Object.freeze({ kind: 'completed', value: operation.value });
		}
		return Promise.resolve(response(request, outcome));
	}

	reportHostOperationProgress(progress: IAgentRuntimeHostOperationProgress): Promise<void> {
		this.assertConnectedEnvelope(progress);
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.OperationNotFound,
			'Mock Agent Runtime has no active Host operation',
			{ operation: progress.operation },
		));
	}

	completeHostOperation(result: IAgentRuntimeHostOperationResponse): Promise<void> {
		this.assertConnectedEnvelope(result);
		return Promise.reject(new AgentHostError(
			AgentHostErrorCode.OperationNotFound,
			'Mock Agent Runtime has no active Host operation',
			{ operation: result.operation },
		));
	}

	private validateRetentionLimit(value: number, field: keyof IMockAgentRuntimeRetentionLimits): number {
		if (!Number.isSafeInteger(value) || value <= 0) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Mock Agent Runtime retention limit is invalid',
				{ field, value },
			);
		}
		return value;
	}

	private validateSessionConfiguration(value: IAgentConfigurationState): IAgentConfigurationState {
		return validateAndFreezeAgentConfigurationState(value, {
			agent: this.definition.agentId,
			scope: 'session',
			revision: this.definition.sessionConfigurationSchema.revision,
		});
	}

	private createChatState(sessionId: AgentSessionId, chatId: AgentChatId): IAgentChatBacking {
		const session = this.requireMaterializedSession(sessionId);
		if (session.chats.has(chatId)) {
			return resourceMissing(`chatAlreadyExists:${sessionId}:${chatId}`);
		}
		const resume = this.resumeState('chat', chatId);
		session.chats.set(chatId, { resume, materialized: true });
		return Object.freeze({ session: sessionId, chat: chatId, resume });
	}

	private requireSession(sessionId: AgentSessionId): IMockSessionState {
		return this.sessions.get(sessionId) ?? resourceMissing(`session:${sessionId}`);
	}

	private requireMaterializedSession(sessionId: AgentSessionId): IMockSessionState {
		const session = this.requireSession(sessionId);
		if (!session.materialized) {
			return resourceMissing(`materializedSession:${sessionId}`);
		}
		return session;
	}

	private requireChat(sessionId: AgentSessionId, chatId: AgentChatId): IMockChatState {
		return this.requireSession(sessionId).chats.get(chatId) ?? resourceMissing(`chat:${sessionId}:${chatId}`);
	}

	private requireMaterializedChat(sessionId: AgentSessionId, chatId: AgentChatId): IMockChatState {
		const chat = this.requireMaterializedSession(sessionId).chats.get(chatId)
			?? resourceMissing(`chat:${sessionId}:${chatId}`);
		if (!chat.materialized) {
			return resourceMissing(`materializedChat:${sessionId}:${chatId}`);
		}
		return chat;
	}

	private resumeState(kind: 'session' | 'chat', identity: string): IAgentResumeState {
		return Object.freeze({
			schema: this.definition.registration.supportedResumeSchemas[0],
			data: JSON.stringify({ kind: `mock-${kind}`, identity }),
		});
	}

	private assertResume(resume: IAgentResumeState): void {
		if (!this.definition.registration.supportedResumeSchemas.includes(resume.schema)) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Mock Agent Runtime resume schema is unsupported',
				{ field: 'resume.schema', value: resume.schema },
			);
		}
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
			if (oldest === undefined) {
				throw new AgentHostError(
					AgentHostErrorCode.InvalidProtocolValue,
					'Mock Agent Runtime terminal Turn retention is inconsistent',
					{ field: 'terminalTurns', value: this.terminalTurns.size },
				);
			}
			this.terminalTurns.delete(oldest);
		}
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
			throw new AgentHostError(
				AgentHostErrorCode.OperationNotPending,
				'Mock Agent Runtime operation is already pending',
				{ operation },
			);
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
		this.evictCompletedOperations();
	}

	private evictCompletedOperations(): void {
		let completedCount = 0;
		for (const operation of this.operations.values()) {
			if (operation.state === 'completed') {
				completedCount += 1;
			}
		}
		while (completedCount > this.maximumRetainedOperations) {
			let evicted = false;
			for (const [operationId, operation] of this.operations) {
				if (operation.state === 'completed') {
					this.operations.delete(operationId);
					completedCount -= 1;
					evicted = true;
					break;
				}
			}
			if (!evicted) {
				throw new AgentHostError(
					AgentHostErrorCode.InvalidProtocolValue,
					'Mock Agent Runtime operation retention is inconsistent',
					{ field: 'operations', value: completedCount },
				);
			}
		}
	}

	private requireConfigurationTransaction(
		operation: AgentHostOperationId,
		digest: AgentHostPayloadDigest,
	): IMockConfigurationTransaction {
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
			'Mock Agent Runtime operation digest conflicts with the recorded operation',
			{ operation, recordedDigest, receivedDigest },
		);
	}

	private assertCall<TRequest>(request: IAgentRuntimeCall<TRequest>): void {
		this.assertConnectedEnvelope(request);
		if (
			!this.initialized
			|| request.registration !== this.definition.registration.revision
			|| request.agent !== this.definition.agentId
		) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Mock Agent Runtime call authority does not match',
				{ field: 'runtimeCall.authority', value: request.agent },
			);
		}
	}

	private assertConnectedEnvelope(
		value: { readonly connection: AgentRuntimeConnectionId; readonly generation: AgentRuntimeConnectionGeneration },
	): void {
		this.assertConnected();
		if (value.connection !== this.connection || value.generation !== this.generation) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Mock Agent Runtime connection generation does not match',
				{ field: 'connection', value: value.connection },
			);
		}
	}

	private assertConnected(): void {
		if (this.stateValue.kind !== 'connected') {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Mock Agent Runtime is disconnected',
				{ field: 'state', value: this.stateValue.kind },
			);
		}
	}

	disconnect(reason: Exclude<AgentRuntimeDisconnectReason, 'disposed'>): void {
		this.terminate(reason);
	}

	private terminate(reason: AgentRuntimeDisconnectReason): void {
		if (this.stateValue.kind === 'disconnected') {
			return;
		}
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
