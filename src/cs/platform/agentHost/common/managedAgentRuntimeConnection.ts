/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import type {
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
	IAgentInteractionResponseRequest,
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
} from './agent.js';
import type { IAgentConfigurationCompletion } from './configuration.js';
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
	IAgentRuntimeReconnectEvent,
	IAgentRuntimeOperationOutcomeRequest,
	IAgentRuntimeResponse,
} from './connections.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import {
	createAgentRuntimeActionSequence,
	createAgentRuntimeConnectionGeneration,
	type AgentRuntimeConnectionGeneration,
	type AgentRuntimeConnectionId,
} from './identities.js';
import { encodeAgentHostProtocolValue } from './protocolValues.js';

export interface IManagedAgentRuntimeConnectionOptions {
	readonly connection: AgentRuntimeConnectionId;
	readonly createGeneration: (
		connection: AgentRuntimeConnectionId,
		generation: AgentRuntimeConnectionGeneration,
	) => Promise<IAgentRuntimeConnection>;
}

interface IManagedAgentRuntimeGeneration {
	readonly connection: IAgentRuntimeConnection;
	readonly generation: AgentRuntimeConnectionGeneration;
	readonly lost: DeferredPromise<void>;
	readonly lifetime: DisposableStore;
}

interface IManagedAgentRuntimeInitialization {
	readonly request: IAgentRuntimeInitializeRequest;
	readonly authority: string;
}

function unavailable(connection: AgentRuntimeConnectionId, generation: AgentRuntimeConnectionGeneration): AgentHostError {
	return new AgentHostError(
		AgentHostErrorCode.ResourceMissing,
		'Connected Agent Runtime generation is unavailable',
		{ resource: `agentRuntime:${connection}:${generation}` },
	);
}

function invalidGeneration(field: string, value: unknown): AgentHostError {
	return new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Managed Agent Runtime generation is invalid',
		{ field, value: typeof value === 'string' || typeof value === 'number' ? value : typeof value },
	);
}

function initializationAuthority(result: IAgentRuntimeInitializeResult): string {
	return encodeAgentHostProtocolValue(Object.freeze({
		call: result.call,
		protocolVersion: result.protocolVersion,
		transportLimits: result.transportLimits,
		registrations: result.registrations,
	}));
}

/**
 * Owns one logical Agent Runtime connection and replaces only its exact transport generation.
 * A replacement is accepted only after it negotiates the identical runtime authority.
 */
export class ManagedAgentRuntimeConnection extends Disposable implements IAgentRuntimeConnection {
	private readonly disconnectEmitter = this._register(new Emitter<Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>>());
	private readonly reconnectEmitter = this._register(new Emitter<IAgentRuntimeReconnectEvent>());
	private readonly actionEmitter = this._register(new Emitter<IAgentRuntimeAction>());
	private readonly hostOperationEmitter = this._register(new Emitter<IAgentRuntimeHostOperationRequest>());
	private generationValue = createAgentRuntimeConnectionGeneration(1);
	private lastLostGeneration: AgentRuntimeConnectionGeneration | undefined;
	private stateValue: AgentRuntimeConnectionState;
	private current: IManagedAgentRuntimeGeneration | undefined;
	private initialization: IManagedAgentRuntimeInitialization | undefined;
	private restart: Promise<void> | undefined;
	private lastActionSequence = 0;
	private generationActionOffset = 0;
	private disposedValue = false;

	readonly connection: AgentRuntimeConnectionId;
	readonly onDidDisconnect = this.disconnectEmitter.event;
	readonly onDidReconnect: Event<IAgentRuntimeReconnectEvent> = this.reconnectEmitter.event;
	readonly onDidEmitAction = this.actionEmitter.event;
	readonly onDidRequestHostOperation = this.hostOperationEmitter.event;

	private constructor(private readonly options: IManagedAgentRuntimeConnectionOptions) {
		super();
		this.connection = options.connection;
		this.stateValue = Object.freeze({
			kind: 'connected',
			connection: this.connection,
			generation: this.generationValue,
		});
	}

	static async create(options: IManagedAgentRuntimeConnectionOptions): Promise<ManagedAgentRuntimeConnection> {
		const managed = new ManagedAgentRuntimeConnection(options);
		let generation: IAgentRuntimeConnection | undefined;
		try {
			generation = await options.createGeneration(managed.connection, managed.generationValue);
			managed.bindGeneration(generation);
			return managed;
		} catch (error) {
			generation?.dispose();
			managed.dispose();
			throw error;
		}
	}

	get generation(): AgentRuntimeConnectionGeneration {
		return this.generationValue;
	}

	get state(): AgentRuntimeConnectionState {
		return this.stateValue;
	}

	async initialize(request: IAgentRuntimeInitializeRequest): Promise<IAgentRuntimeInitializeResult> {
		if (this.initialization !== undefined) {
			throw invalidGeneration('initialize.state', 'repeated');
		}
		const result = await this.invokeCurrent(request, connection => connection.initialize(request));
		this.initialization = Object.freeze({ request, authority: initializationAuthority(result) });
		return result;
	}

	resolveSessionConfiguration(request: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>): Promise<IAgentRuntimeResponse<IAgentResolvedSessionConfiguration>> {
		return this.invokeCurrent(request, connection => connection.resolveSessionConfiguration(request));
	}

	completeSessionConfiguration(request: IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>): Promise<IAgentRuntimeResponse<readonly IAgentConfigurationCompletion[]>> {
		return this.invokeCurrent(request, connection => connection.completeSessionConfiguration(request));
	}

	prepareSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentPrepareSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.prepareSessionConfigurationUpdate(request));
	}

	commitSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.commitSessionConfigurationUpdate(request));
	}

	rollbackSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.rollbackSessionConfigurationUpdate(request));
	}

	acknowledgeSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentAcknowledgeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.acknowledgeSessionConfigurationUpdate(request));
	}

	resolveExecutionProfile(request: IAgentRuntimeCall<IAgentExecutionProfileRequest>): Promise<IAgentRuntimeResponse<IAgentExecutionProfile>> {
		return this.invokeCurrent(request, connection => connection.resolveExecutionProfile(request));
	}

	migrateResumeState(request: IAgentRuntimeCall<IAgentResumeMigrationRequest>): Promise<IAgentRuntimeResponse<IAgentResumeState>> {
		return this.invokeCurrent(request, connection => connection.migrateResumeState(request));
	}

	createSession(request: IAgentRuntimeCall<IAgentCreateSessionOptions>): Promise<IAgentRuntimeResponse<IAgentSessionBacking>> {
		return this.invokeCurrent(request, connection => connection.createSession(request));
	}

	materializeSession(request: IAgentRuntimeCall<IAgentMaterializeSessionRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.materializeSession(request));
	}

	releaseSession(request: IAgentRuntimeCall<IAgentReleaseSessionRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.releaseSession(request));
	}

	deleteSession(request: IAgentRuntimeCall<IAgentDeleteSessionRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.deleteSession(request));
	}

	createChat(request: IAgentRuntimeCall<IAgentCreateChatOptions>): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		return this.invokeCurrent(request, connection => connection.createChat(request));
	}

	materializeChat(request: IAgentRuntimeCall<IAgentMaterializeChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.materializeChat(request));
	}

	releaseChat(request: IAgentRuntimeCall<IAgentReleaseChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.releaseChat(request));
	}

	forkChat(request: IAgentRuntimeCall<IAgentForkChatRequest>): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		return this.invokeCurrent(request, connection => connection.forkChat(request));
	}

	send(request: IAgentRuntimeCall<IAgentChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.send(request));
	}

	steer(request: IAgentRuntimeCall<IAgentSteerRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.steer(request));
	}

	cancel(request: IAgentRuntimeCall<IAgentCancelTurnRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.cancel(request));
	}

	respondInteraction(request: IAgentRuntimeCall<IAgentInteractionResponseRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.respondInteraction(request));
	}

	deleteChat(request: IAgentRuntimeCall<IAgentDeleteChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invokeCurrent(request, connection => connection.deleteChat(request));
	}

	getOperationOutcome(request: IAgentRuntimeCall<IAgentRuntimeOperationOutcomeRequest>): Promise<IAgentRuntimeResponse<AgentRuntimeOperationOutcome>> {
		return this.invokeCurrent(request, connection => connection.getOperationOutcome(request));
	}

	reportHostOperationProgress(progress: IAgentRuntimeHostOperationProgress): Promise<void> {
		if (this.isLostGeneration(progress)) {
			return Promise.resolve();
		}
		return this.invokeCurrent(progress, connection => connection.reportHostOperationProgress(progress));
	}

	completeHostOperation(response: IAgentRuntimeHostOperationResponse): Promise<void> {
		if (this.isLostGeneration(response)) {
			return Promise.resolve();
		}
		return this.invokeCurrent(response, connection => connection.completeHostOperation(response));
	}

	private async invokeCurrent<T>(
		envelope: { readonly connection: AgentRuntimeConnectionId; readonly generation: AgentRuntimeConnectionGeneration },
		invoke: (connection: IAgentRuntimeConnection) => Promise<T>,
	): Promise<T> {
		const current = this.current;
		if (
			current === undefined
			|| envelope.connection !== this.connection
			|| envelope.generation !== this.generationValue
			|| current.generation !== this.generationValue
		) {
			throw unavailable(this.connection, this.generationValue);
		}
		const lost = current.lost.p.then(() => {
			throw unavailable(this.connection, current.generation);
		});
		return Promise.race([Promise.resolve().then(() => invoke(current.connection)), lost]);
	}

	private isLostGeneration(
		envelope: { readonly connection: AgentRuntimeConnectionId; readonly generation: AgentRuntimeConnectionGeneration },
	): boolean {
		return envelope.connection === this.connection
			&& this.lastLostGeneration !== undefined
			&& envelope.generation <= this.lastLostGeneration;
	}

	private bindGeneration(connection: IAgentRuntimeConnection): void {
		if (
			connection.connection !== this.connection
			|| connection.generation !== this.generationValue
			|| connection.state.kind !== 'connected'
			|| connection.state.connection !== this.connection
			|| connection.state.generation !== this.generationValue
		) {
			throw invalidGeneration('generation.identity', connection.state.kind);
		}
		const lifetime = new DisposableStore();
		const generation: IManagedAgentRuntimeGeneration = {
			connection,
			generation: this.generationValue,
			lost: new DeferredPromise<void>(),
			lifetime,
		};
		lifetime.add(connection);
		lifetime.add(connection.onDidDisconnect(event => this.handleGenerationDisconnect(generation, event)));
		lifetime.add(connection.onDidEmitAction(action => this.handleAction(generation, action)));
		lifetime.add(connection.onDidRequestHostOperation(request => {
			if (this.current === generation) {
				this.hostOperationEmitter.fire(request);
			}
		}));
		this.current = generation;
		this.stateValue = Object.freeze({
			kind: 'connected',
			connection: this.connection,
			generation: this.generationValue,
		});
	}

	private handleAction(generation: IManagedAgentRuntimeGeneration, action: IAgentRuntimeAction): void {
		if (this.current !== generation) {
			return;
		}
		const sequence = createAgentRuntimeActionSequence(this.generationActionOffset + action.sequence);
		this.lastActionSequence = sequence;
		this.actionEmitter.fire(Object.freeze({ ...action, sequence }));
	}

	private handleGenerationDisconnect(
		generation: IManagedAgentRuntimeGeneration,
		event: Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>,
	): void {
		if (this.current !== generation || this.disposedValue) {
			return;
		}
		if (
			event.connection !== this.connection
			|| event.generation !== generation.generation
			|| event.reason === 'disposed'
		) {
			this.terminate('protocolViolation');
			return;
		}
		this.current = undefined;
		this.lastLostGeneration = generation.generation;
		generation.lost.complete(undefined);
		generation.lifetime.dispose();
		if (this.initialization === undefined) {
			this.terminate(event.reason);
			return;
		}
		this.restart = this.restartGeneration();
		void this.restart.catch(error => {
			this.terminate(error instanceof AgentHostError && error.code === AgentHostErrorCode.InvalidProtocolValue
				? 'protocolViolation'
				: event.reason);
		});
	}

	private async restartGeneration(): Promise<void> {
		const next = createAgentRuntimeConnectionGeneration(this.generationValue + 1);
		if (!Number.isSafeInteger(next)) {
			throw invalidGeneration('generation.next', next);
		}
		const initialization = this.initialization;
		if (initialization === undefined) {
			throw unavailable(this.connection, this.generationValue);
		}
		let connection: IAgentRuntimeConnection | undefined;
		try {
			connection = await this.options.createGeneration(this.connection, next);
			if (this.disposedValue) {
				connection.dispose();
				return;
			}
			if (
				connection.connection !== this.connection
				|| connection.generation !== next
				|| connection.state.kind !== 'connected'
			) {
				throw invalidGeneration('generation.reconnectIdentity', connection.state.kind);
			}
			const request: IAgentRuntimeInitializeRequest = Object.freeze({
				...initialization.request,
				generation: next,
			});
			const result = await connection.initialize(request);
			if (this.disposedValue) {
				connection.dispose();
				connection = undefined;
				return;
			}
			if (
				result.connection !== this.connection
				|| result.generation !== next
				|| initializationAuthority(result) !== initialization.authority
			) {
				throw invalidGeneration('initialize.reconnectAuthority', result.generation);
			}
			const previousGeneration = this.generationValue;
			this.generationValue = next;
			this.generationActionOffset = this.lastActionSequence;
			this.bindGeneration(connection);
			this.reconnectEmitter.fire(Object.freeze({
				connection: this.connection,
				previousGeneration,
				generation: next,
			}));
			connection = undefined;
			this.restart = undefined;
		} catch (error) {
			connection?.dispose();
			throw error instanceof Error ? error : unavailable(this.connection, this.generationValue);
		}
	}

	private terminate(reason: AgentRuntimeDisconnectReason): void {
		if (this.stateValue.kind === 'disconnected') {
			return;
		}
		const current = this.current;
		this.current = undefined;
		if (current !== undefined) {
			current.lost.complete(undefined);
			current.lifetime.dispose();
		}
		const state = Object.freeze({
			kind: 'disconnected' as const,
			connection: this.connection,
			generation: this.generationValue,
			reason,
		});
		this.stateValue = state;
		this.disconnectEmitter.fire(state);
	}

	override dispose(): void {
		if (this.disposedValue) {
			return;
		}
		this.disposedValue = true;
		this.terminate('disposed');
		super.dispose();
	}
}
