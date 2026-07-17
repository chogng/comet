/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellationError } from 'cs/base/common/async';
import { CancellationError, CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';
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
	IAgentRuntimeOperationOutcomeRequest,
	IAgentRuntimeResponse,
} from './connections.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import type {
	AgentRuntimeConnectionGeneration,
	AgentRuntimeConnectionId,
} from './identities.js';
import { assertAgentHostProtocolValue } from './protocolValues.js';

/** Channel carrying one exact connected Agent Runtime generation. */
export const agentRuntimeConnectionChannelName = 'agentRuntime';

type ProtocolRecord = Readonly<Record<string, unknown>>;

function invalidChannelValue(field: string, value: unknown): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Agent Runtime channel value',
		{ field, value: diagnostic },
	);
}

function requireRecord(value: unknown, field: string): ProtocolRecord {
	assertAgentHostProtocolValue(value);
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidChannelValue(field, value);
	}
	return value as ProtocolRecord;
}

function assertConnectionIdentity(
	value: unknown,
	connection: AgentRuntimeConnectionId,
	generation: AgentRuntimeConnectionGeneration,
	field: string,
): void {
	const record = requireRecord(value, field);
	if (record.connection !== connection || record.generation !== generation) {
		invalidChannelValue(`${field}.connection`, record.connection);
	}
}

function assertCallResponse<TRequest, TValue>(
	request: IAgentRuntimeCall<TRequest>,
	value: unknown,
	field: string,
): asserts value is IAgentRuntimeResponse<TValue> {
	const record = requireRecord(value, field);
	if (
		record.connection !== request.connection
		|| record.generation !== request.generation
		|| record.call !== request.call
		|| record.registration !== request.registration
		|| record.agent !== request.agent
	) {
		invalidChannelValue(`${field}.correlation`, record.call);
	}
}

function assertInitializeResponse(
	request: IAgentRuntimeInitializeRequest,
	value: unknown,
): asserts value is IAgentRuntimeInitializeResult {
	const record = requireRecord(value, 'initialize.result');
	if (
		record.connection !== request.connection
		|| record.generation !== request.generation
		|| record.call !== request.call
	) {
		invalidChannelValue('initialize.result.correlation', record.call);
	}
}

/** Exposes one Agent Runtime connection through an environment-neutral IPC channel. */
export class AgentRuntimeConnectionChannel implements IServerChannel<string> {
	constructor(private readonly connection: IAgentRuntimeConnection) {}

	async call<T = unknown>(
		_context: string,
		command: string,
		arg: unknown,
		cancellationToken: CancellationToken = CancellationTokenNone,
	): Promise<T> {
		if (cancellationToken.isCancellationRequested) {
			throw new CancellationError();
		}
		assertConnectionIdentity(arg, this.connection.connection, this.connection.generation, command);

		let result: unknown;
		switch (command) {
			case 'initialize':
				result = await raceCancellationError(
					this.connection.initialize(arg as IAgentRuntimeInitializeRequest),
					cancellationToken,
				);
				assertInitializeResponse(arg as IAgentRuntimeInitializeRequest, result);
				break;
			case 'resolveSessionConfiguration':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>,
					request => this.connection.resolveSessionConfiguration(request),
					cancellationToken,
				);
				break;
			case 'completeSessionConfiguration':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>,
					request => this.connection.completeSessionConfiguration(request),
					cancellationToken,
				);
				break;
			case 'prepareSessionConfigurationUpdate':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentPrepareSessionConfigurationUpdateRequest>,
					request => this.connection.prepareSessionConfigurationUpdate(request),
					cancellationToken,
				);
				break;
			case 'commitSessionConfigurationUpdate':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>,
					request => this.connection.commitSessionConfigurationUpdate(request),
					cancellationToken,
				);
				break;
			case 'rollbackSessionConfigurationUpdate':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>,
					request => this.connection.rollbackSessionConfigurationUpdate(request),
					cancellationToken,
				);
				break;
			case 'acknowledgeSessionConfigurationUpdate':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentAcknowledgeSessionConfigurationUpdateRequest>,
					request => this.connection.acknowledgeSessionConfigurationUpdate(request),
					cancellationToken,
				);
				break;
			case 'resolveExecutionProfile':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentExecutionProfileRequest>,
					request => this.connection.resolveExecutionProfile(request),
					cancellationToken,
				);
				break;
			case 'migrateResumeState':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentResumeMigrationRequest>,
					request => this.connection.migrateResumeState(request),
					cancellationToken,
				);
				break;
			case 'createSession':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentCreateSessionOptions>,
					request => this.connection.createSession(request),
					cancellationToken,
				);
				break;
			case 'materializeSession':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentMaterializeSessionRequest>,
					request => this.connection.materializeSession(request),
					cancellationToken,
				);
				break;
			case 'releaseSession':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentReleaseSessionRequest>,
					request => this.connection.releaseSession(request),
					cancellationToken,
				);
				break;
			case 'deleteSession':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentDeleteSessionRequest>,
					request => this.connection.deleteSession(request),
					cancellationToken,
				);
				break;
			case 'createChat':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentCreateChatOptions>,
					request => this.connection.createChat(request),
					cancellationToken,
				);
				break;
			case 'materializeChat':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentMaterializeChatRequest>,
					request => this.connection.materializeChat(request),
					cancellationToken,
				);
				break;
			case 'releaseChat':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentReleaseChatRequest>,
					request => this.connection.releaseChat(request),
					cancellationToken,
				);
				break;
			case 'forkChat':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentForkChatRequest>,
					request => this.connection.forkChat(request),
					cancellationToken,
				);
				break;
			case 'send':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentChatRequest>,
					request => this.connection.send(request),
					cancellationToken,
				);
				break;
			case 'steer':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentSteerRequest>,
					request => this.connection.steer(request),
					cancellationToken,
				);
				break;
			case 'cancel':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentCancelTurnRequest>,
					request => this.connection.cancel(request),
					cancellationToken,
				);
				break;
			case 'respondInteraction':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentInteractionResponseRequest>,
					request => this.connection.respondInteraction(request),
					cancellationToken,
				);
				break;
			case 'deleteChat':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentDeleteChatRequest>,
					request => this.connection.deleteChat(request),
					cancellationToken,
				);
				break;
			case 'getOperationOutcome':
				result = await this.invokeCall(
					arg as IAgentRuntimeCall<IAgentRuntimeOperationOutcomeRequest>,
					request => this.connection.getOperationOutcome(request),
					cancellationToken,
				);
				break;
			case 'reportHostOperationProgress':
				await raceCancellationError(
					this.connection.reportHostOperationProgress(arg as IAgentRuntimeHostOperationProgress),
					cancellationToken,
				);
				result = null;
				break;
			case 'completeHostOperation':
				await raceCancellationError(
					this.connection.completeHostOperation(arg as IAgentRuntimeHostOperationResponse),
					cancellationToken,
				);
				result = null;
				break;
			default:
				invalidChannelValue('command', command);
		}

		assertAgentHostProtocolValue(result);
		return result as T;
	}

	listen<T = unknown>(_context: string, event: string, arg: unknown): Event<T> {
		if (arg !== undefined) {
			invalidChannelValue(`${event}.argument`, arg);
		}
		switch (event) {
			case 'onDidDisconnect':
				return this.checkedEvent(this.connection.onDidDisconnect, event) as Event<T>;
			case 'onDidEmitAction':
				return this.checkedEvent(this.connection.onDidEmitAction, event) as Event<T>;
			case 'onDidRequestHostOperation':
				return this.checkedEvent(this.connection.onDidRequestHostOperation, event) as Event<T>;
			default:
				return invalidChannelValue('event', event);
		}
	}

	private async invokeCall<TRequest, TValue>(
		request: IAgentRuntimeCall<TRequest>,
		invoke: (request: IAgentRuntimeCall<TRequest>) => Promise<IAgentRuntimeResponse<TValue>>,
		cancellationToken: CancellationToken,
	): Promise<IAgentRuntimeResponse<TValue>> {
		const result = await raceCancellationError(invoke(request), cancellationToken);
		assertCallResponse<TRequest, TValue>(request, result, 'runtimeCall.result');
		return result;
	}

	private checkedEvent<TValue>(source: Event<TValue>, field: string): Event<TValue> {
		return (listener, thisArgs, disposables) => source(value => {
			assertConnectionIdentity(value, this.connection.connection, this.connection.generation, field);
			listener.call(thisArgs, value);
		}, undefined, disposables);
	}
}

/** Projects one IPC channel as the exact connected Agent Runtime generation. */
export class AgentRuntimeConnectionChannelClient extends Disposable implements IAgentRuntimeConnection {
	private readonly disconnectEmitter = this._register(new Emitter<Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>>());
	private readonly actionEmitter = this._register(new Emitter<IAgentRuntimeAction>());
	private readonly hostOperationEmitter = this._register(new Emitter<IAgentRuntimeHostOperationRequest>());
	private stateValue: AgentRuntimeConnectionState;

	readonly onDidDisconnect = this.disconnectEmitter.event;
	readonly onDidReconnect = Event.None;
	readonly onDidEmitAction = this.actionEmitter.event;
	readonly onDidRequestHostOperation = this.hostOperationEmitter.event;

	constructor(
		private readonly channel: IChannel,
		readonly connection: AgentRuntimeConnectionId,
		readonly generation: AgentRuntimeConnectionGeneration,
		transport: IDisposable,
	) {
		super();
		this.stateValue = Object.freeze({ kind: 'connected', connection, generation });
		this._register(this.channel.listen<Extract<AgentRuntimeConnectionState, { readonly kind: 'disconnected' }>>('onDidDisconnect')(event => {
			this.assertEventIdentity(event, 'onDidDisconnect');
			this.terminate(event.reason);
		}));
		this._register(this.channel.listen<IAgentRuntimeAction>('onDidEmitAction')(event => {
			this.assertEventIdentity(event, 'onDidEmitAction');
			this.actionEmitter.fire(event);
		}));
		this._register(this.channel.listen<IAgentRuntimeHostOperationRequest>('onDidRequestHostOperation')(event => {
			this.assertEventIdentity(event, 'onDidRequestHostOperation');
			this.hostOperationEmitter.fire(event);
		}));
		this._register(transport);
	}

	get state(): AgentRuntimeConnectionState {
		return this.stateValue;
	}

	async initialize(request: IAgentRuntimeInitializeRequest): Promise<IAgentRuntimeInitializeResult> {
		this.assertConnectedRequest(request, 'initialize');
		const result = await this.channel.call<IAgentRuntimeInitializeResult>('initialize', request);
		assertInitializeResponse(request, result);
		return result;
	}

	resolveSessionConfiguration(request: IAgentRuntimeCall<IAgentResolveSessionConfigurationRequest>): Promise<IAgentRuntimeResponse<IAgentResolvedSessionConfiguration>> {
		return this.invoke('resolveSessionConfiguration', request);
	}

	completeSessionConfiguration(request: IAgentRuntimeCall<IAgentSessionConfigurationCompletionRequest>): Promise<IAgentRuntimeResponse<readonly IAgentConfigurationCompletion[]>> {
		return this.invoke('completeSessionConfiguration', request);
	}

	prepareSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentPrepareSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('prepareSessionConfigurationUpdate', request);
	}

	commitSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('commitSessionConfigurationUpdate', request);
	}

	rollbackSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentFinalizeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('rollbackSessionConfigurationUpdate', request);
	}

	acknowledgeSessionConfigurationUpdate(request: IAgentRuntimeCall<IAgentAcknowledgeSessionConfigurationUpdateRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('acknowledgeSessionConfigurationUpdate', request);
	}

	resolveExecutionProfile(request: IAgentRuntimeCall<IAgentExecutionProfileRequest>): Promise<IAgentRuntimeResponse<IAgentExecutionProfile>> {
		return this.invoke('resolveExecutionProfile', request);
	}

	migrateResumeState(request: IAgentRuntimeCall<IAgentResumeMigrationRequest>): Promise<IAgentRuntimeResponse<IAgentResumeState>> {
		return this.invoke('migrateResumeState', request);
	}

	createSession(request: IAgentRuntimeCall<IAgentCreateSessionOptions>): Promise<IAgentRuntimeResponse<IAgentSessionBacking>> {
		return this.invoke('createSession', request);
	}

	materializeSession(request: IAgentRuntimeCall<IAgentMaterializeSessionRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('materializeSession', request);
	}

	releaseSession(request: IAgentRuntimeCall<IAgentReleaseSessionRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('releaseSession', request);
	}

	deleteSession(request: IAgentRuntimeCall<IAgentDeleteSessionRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('deleteSession', request);
	}

	createChat(request: IAgentRuntimeCall<IAgentCreateChatOptions>): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		return this.invoke('createChat', request);
	}

	materializeChat(request: IAgentRuntimeCall<IAgentMaterializeChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('materializeChat', request);
	}

	releaseChat(request: IAgentRuntimeCall<IAgentReleaseChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('releaseChat', request);
	}

	forkChat(request: IAgentRuntimeCall<IAgentForkChatRequest>): Promise<IAgentRuntimeResponse<IAgentChatBacking>> {
		return this.invoke('forkChat', request);
	}

	send(request: IAgentRuntimeCall<IAgentChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('send', request);
	}

	steer(request: IAgentRuntimeCall<IAgentSteerRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('steer', request);
	}

	cancel(request: IAgentRuntimeCall<IAgentCancelTurnRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('cancel', request);
	}

	respondInteraction(request: IAgentRuntimeCall<IAgentInteractionResponseRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('respondInteraction', request);
	}

	deleteChat(request: IAgentRuntimeCall<IAgentDeleteChatRequest>): Promise<IAgentRuntimeResponse<null>> {
		return this.invoke('deleteChat', request);
	}

	getOperationOutcome(request: IAgentRuntimeCall<IAgentRuntimeOperationOutcomeRequest>): Promise<IAgentRuntimeResponse<AgentRuntimeOperationOutcome>> {
		return this.invoke('getOperationOutcome', request);
	}

	async reportHostOperationProgress(progress: IAgentRuntimeHostOperationProgress): Promise<void> {
		this.assertConnectedRequest(progress, 'reportHostOperationProgress');
		const result = await this.channel.call<null>('reportHostOperationProgress', progress);
		if (result !== null) {
			invalidChannelValue('reportHostOperationProgress.result', result);
		}
	}

	async completeHostOperation(response: IAgentRuntimeHostOperationResponse): Promise<void> {
		this.assertConnectedRequest(response, 'completeHostOperation');
		const result = await this.channel.call<null>('completeHostOperation', response);
		if (result !== null) {
			invalidChannelValue('completeHostOperation.result', result);
		}
	}

	/** Marks an externally observed transport or process loss for this generation. */
	disconnect(reason: Exclude<AgentRuntimeDisconnectReason, 'disposed'>): void {
		this.terminate(reason);
	}

	private async invoke<TRequest, TValue>(
		command: string,
		request: IAgentRuntimeCall<TRequest>,
	): Promise<IAgentRuntimeResponse<TValue>> {
		this.assertConnectedRequest(request, command);
		const result = await this.channel.call<IAgentRuntimeResponse<TValue>>(command, request);
		assertCallResponse<TRequest, TValue>(request, result, `${command}.result`);
		return result;
	}

	private assertConnectedRequest(
		request: { readonly connection: AgentRuntimeConnectionId; readonly generation: AgentRuntimeConnectionGeneration },
		field: string,
	): void {
		if (this.stateValue.kind !== 'connected') {
			invalidChannelValue(`${field}.state`, this.stateValue.kind);
		}
		assertConnectionIdentity(request, this.connection, this.generation, field);
	}

	private assertEventIdentity(
		event: { readonly connection: AgentRuntimeConnectionId; readonly generation: AgentRuntimeConnectionGeneration },
		field: string,
	): void {
		assertConnectionIdentity(event, this.connection, this.generation, field);
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
