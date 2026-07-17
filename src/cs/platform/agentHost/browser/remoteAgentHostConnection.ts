/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationError,
	CancellationTokenNone,
	CancellationTokenSource,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	ClientAgentToolService,
} from './clientAgentTools.js';
import {
	ClientContentResourceService,
	type IClientContentResourceLimits,
	type IClientContentResourceService,
} from './clientContentResources.js';
import {
	type IAgentConfigurationState,
	validateAndFreezeAgentConfigurationCompletions,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from '../common/configuration.js';
import type { IAgentHostConnection } from '../common/connections.js';
import { AgentHostError, AgentHostErrorCode } from '../common/errors.js';
import {
	createAgentConfigurationSchemaRevision,
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	createAgentHostProtocolVersion,
	createAgentId,
	createAgentRuntimeRegistrationRevision,
	type AgentHostAuthorityId,
	type AgentHostClientConnectionId,
} from '../common/identities.js';
import {
	assertAgentPackageOperationOutcome,
	assertAgentPackageOperationOutcomeRequest,
	assertAgentPackageOperationRequest,
	type AgentPackageOperationOutcome,
	type IAgentPackageOperationOutcomeRequest,
	type IAgentPackageOperationRequest,
} from '../common/packages.js';
import {
	assertAgentHostReconnectResult,
	assertAgentHostSetSubscriptionsResult,
	type AgentHostChannelAction,
	type AgentHostMutationOutcome,
	type AgentHostPrepareSubmissionResult,
	type AgentHostReconnectResult,
	type IAgentHostInitializeRequest,
	type IAgentHostInitializeResult,
	type IAgentHostMutationRequest,
	type IAgentHostOperationProgress,
	type IAgentHostOperationOutcomeRequest,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostReconnectRequest,
	type IAgentHostResolveSessionConfigurationRequest,
	type IAgentHostResolveSessionConfigurationResult,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
	type IAgentHostSessionConfigurationCompletionsRequest,
	type IAgentHostSessionConfigurationCompletionsResult,
} from '../common/protocol.js';
import {
	RemoteAgentHostProtocolCommand,
} from '../common/remoteProtocol.js';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from '../common/protocolValues.js';
import type { IAgentClientToolPublicationSnapshot, IAgentToolExecutorEndpoint } from '../common/tools.js';

const currentAgentHostProtocolVersion = createAgentHostProtocolVersion('5');
const maximumRemoteAgentHostBufferedActions = 65_536;

type ProtocolRecord = Readonly<Record<string, AgentHostProtocolValue>>;

export type RemoteAgentHostTransportState = 'connected' | 'restoring' | 'terminal';

export interface IRemoteAgentHostTransportStateChange {
	readonly state: RemoteAgentHostTransportState;
	readonly generation: number;
}

export interface IRemoteAgentHostRecoveryRequest {
	readonly generation: number;
}

export interface IRemoteAgentHostClientToolEndpoint extends IAgentToolExecutorEndpoint {
	readonly connection: AgentHostClientConnectionId;
}

/** Route-specific lower transport for one remote Agent Host logical connection. */
export interface IRemoteAgentHostProtocolTransport extends IDisposable {
	readonly state: RemoteAgentHostTransportState;
	readonly generation: number;
	readonly onDidReceiveAction: Event<AgentHostChannelAction>;
	readonly onDidProgress: Event<IAgentHostOperationProgress>;
	readonly onDidChangeState: Event<IRemoteAgentHostTransportStateChange>;
	call(
		command: RemoteAgentHostProtocolCommand,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue>;
	bindClientEndpoints(
		connection: AgentHostClientConnectionId,
		contentResources: IClientContentResourceService,
		tools: IRemoteAgentHostClientToolEndpoint,
	): IDisposable;
}

export interface IRemoteAgentHostConnectionOptions {
	readonly maximumClientToolCallRecords: number;
	readonly maximumBufferedActions: number;
	readonly contentResourceLimits: IClientContentResourceLimits;
}

function invalidProtocol(field: string, value: AgentHostProtocolValue | undefined): never {
	const diagnostic = typeof value === 'number'
		? value
		: typeof value === 'string'
			? value.slice(0, 256)
			: typeof value;
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid remote Agent Host protocol value',
		{ field, value: diagnostic },
	);
}

function requireRecord(value: AgentHostProtocolValue, field: string): ProtocolRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidProtocol(field, value);
	}
	return value as ProtocolRecord;
}

function requireExactKeys(record: ProtocolRecord, required: readonly string[], field: string): void {
	if (Object.keys(record).length !== required.length) {
		invalidProtocol(field, Object.keys(record).length);
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalidProtocol(`${field}.${key}`, 'missing');
		}
	}
}

function requireString(value: AgentHostProtocolValue | undefined, field: string): string {
	if (typeof value !== 'string' || value.length === 0) {
		return invalidProtocol(field, value);
	}
	return value;
}

function validateIdentity(value: AgentHostProtocolValue): {
	readonly authority: AgentHostAuthorityId;
	readonly connection: AgentHostClientConnectionId;
} {
	const identity = requireRecord(value, 'identity');
	requireExactKeys(identity, ['authority', 'connection'], 'identity');
	return Object.freeze({
		authority: createAgentHostAuthorityId(requireString(identity.authority, 'identity.authority')),
		connection: createAgentHostClientConnectionId(requireString(identity.connection, 'identity.connection')),
	});
}

function validateResolveResult(value: AgentHostProtocolValue): IAgentHostResolveSessionConfigurationResult {
	const result = requireRecord(value, 'resolveSessionConfiguration.result');
	requireExactKeys(result, ['agent', 'runtimeRegistration', 'configuration'], 'resolveSessionConfiguration.result');
	const agent = createAgentId(requireString(result.agent, 'resolveSessionConfiguration.result.agent'));
	const runtimeRegistration = createAgentRuntimeRegistrationRevision(requireString(
		result.runtimeRegistration,
		'resolveSessionConfiguration.result.runtimeRegistration',
	));
	const configurationRecord = requireRecord(result.configuration, 'resolveSessionConfiguration.result.configuration');
	const schema = validateAndFreezeAgentConfigurationSchema(configurationRecord.schema);
	const configuration = validateAndFreezeAgentConfigurationState(
		result.configuration as unknown as IAgentConfigurationState,
		{ agent, scope: 'session' },
	);
	if (schema.agent !== agent) {
		invalidProtocol('resolveSessionConfiguration.result.configuration.schema.agent', schema.agent);
	}
	return Object.freeze({ agent, runtimeRegistration, configuration });
}

function validateCompletionResult(
	request: IAgentHostSessionConfigurationCompletionsRequest,
	value: AgentHostProtocolValue,
): IAgentHostSessionConfigurationCompletionsResult {
	const result = requireRecord(value, 'completeSessionConfiguration.result');
	requireExactKeys(
		result,
		['agent', 'runtimeRegistration', 'schema', 'completions'],
		'completeSessionConfiguration.result',
	);
	const agent = createAgentId(requireString(result.agent, 'completeSessionConfiguration.result.agent'));
	if (agent !== request.resolvedSchema.agent) {
		invalidProtocol('completeSessionConfiguration.result.agent', agent);
	}
	const runtimeRegistration = createAgentRuntimeRegistrationRevision(requireString(
		result.runtimeRegistration,
		'completeSessionConfiguration.result.runtimeRegistration',
	));
	const schema = createAgentConfigurationSchemaRevision(requireString(
		result.schema,
		'completeSessionConfiguration.result.schema',
	));
	if (schema !== request.resolvedSchema.revision || !Array.isArray(result.completions)) {
		invalidProtocol('completeSessionConfiguration.result.schema', schema);
	}
	const completions = validateAndFreezeAgentConfigurationCompletions(
		request.resolvedSchema,
		request.property,
		result.completions,
	);
	return Object.freeze({ agent, runtimeRegistration, schema, completions });
}

function validatePrepareResult(value: AgentHostProtocolValue): AgentHostPrepareSubmissionResult {
	const result = requireRecord(value, 'prepareSubmission.result');
	if (result.kind === 'rejected') {
		return value as unknown as AgentHostPrepareSubmissionResult;
	}
	if (result.kind !== 'prepared') {
		invalidProtocol('prepareSubmission.result.kind', result.kind);
	}
	const submission = requireRecord(result.submission, 'prepareSubmission.result.submission');
	const configuration = requireRecord(
		submission.sessionConfiguration,
		'prepareSubmission.result.submission.sessionConfiguration',
	);
	const schema = validateAndFreezeAgentConfigurationSchema(configuration.schema);
	validateAndFreezeAgentConfigurationState(
		submission.sessionConfiguration as unknown as IAgentConfigurationState,
		{ agent: schema.agent, scope: 'session' },
	);
	return value as unknown as AgentHostPrepareSubmissionResult;
}

/** Shared remote Agent Host connection used by Remote Server and Remote Tunnel routes. */
export class RemoteAgentHostConnection extends Disposable implements IAgentHostConnection {
	private readonly lifetimeCancellation = this._register(new CancellationTokenSource());
	private readonly actionEmitter = this._register(new EventEmitter<AgentHostChannelAction>({
		onListenerError: onUnexpectedError,
	}));
	private readonly progressEmitter = this._register(new EventEmitter<IAgentHostOperationProgress>({
		onListenerError: onUnexpectedError,
	}));
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteAgentHostTransportStateChange>({
		onListenerError: onUnexpectedError,
	}));
	private readonly recoveryEmitter = this._register(new EventEmitter<IRemoteAgentHostRecoveryRequest>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidReceiveAction = this.actionEmitter.event;
	readonly onDidProgress = this.progressEmitter.event;
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidRequireRecovery = this.recoveryEmitter.event;
	readonly clientTools: ClientAgentToolService;
	readonly contentResources: IClientContentResourceService;
	private connectionState: RemoteAgentHostTransportState = 'connected';
	private stateGeneration: number;
	private semanticGeneration: number;
	private recoveryGeneration: number | undefined;
	private readonly bufferedActions: AgentHostChannelAction[] = [];

	private constructor(
		private readonly transport: IRemoteAgentHostProtocolTransport,
		readonly authority: AgentHostAuthorityId,
		readonly connection: AgentHostClientConnectionId,
		private readonly options: IRemoteAgentHostConnectionOptions,
	) {
		super();
		if (transport.state !== 'connected') {
			throw new Error('Remote Agent Host transport is not connected.');
		}
		this.semanticGeneration = transport.generation;
		this.stateGeneration = transport.generation;
		this._register(transport);
		this.contentResources = new ClientContentResourceService(
			connection,
			options.contentResourceLimits,
		);
		this.clientTools = this._register(new ClientAgentToolService(connection, {
			maximumCallRecords: options.maximumClientToolCallRecords,
			synchronize: snapshot => this.synchronizeClientTools(snapshot),
		}));
		this._register(transport.bindClientEndpoints(connection, this.contentResources, this.clientTools));
		this._register(transport.onDidReceiveAction(action => this.receiveAction(action)));
		this._register(transport.onDidProgress(progress => {
			if (this.connectionState === 'connected') {
				this.progressEmitter.fire(progress);
			}
		}));
		this._register(transport.onDidChangeState(change => this.changeTransportState(change)));
	}

	get state(): RemoteAgentHostTransportState {
		return this.connectionState;
	}

	static async create(
		transport: IRemoteAgentHostProtocolTransport,
		options: IRemoteAgentHostConnectionOptions,
	): Promise<RemoteAgentHostConnection> {
		try {
			if (
				!Number.isSafeInteger(options.maximumBufferedActions)
				|| options.maximumBufferedActions <= 0
				|| options.maximumBufferedActions > maximumRemoteAgentHostBufferedActions
			) {
				throw new Error(
					`Remote Agent Host maximum buffered actions must be between 1 and ${maximumRemoteAgentHostBufferedActions}.`,
				);
			}
			const identity = validateIdentity(await transport.call(
				RemoteAgentHostProtocolCommand.Identity,
				undefined,
				CancellationTokenNone,
			));
			return new RemoteAgentHostConnection(
				transport,
				identity.authority,
				identity.connection,
				options,
			);
		} catch (error) {
			transport.dispose();
			throw error;
		}
	}

	async initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		this.assertConnection(request.connection, 'initialize.connection');
		if (request.protocolVersions.length !== 1 || request.protocolVersions[0] !== currentAgentHostProtocolVersion) {
			invalidProtocol('initialize.protocolVersions', request.protocolVersions.length);
		}
		const result = await this.call<IAgentHostInitializeResult>(RemoteAgentHostProtocolCommand.Initialize, request);
		if (result.protocolVersion !== currentAgentHostProtocolVersion) {
			invalidProtocol('initialize.result.protocolVersion', result.protocolVersion);
		}
		return result;
	}

	async reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		this.assertConnection(request.connection, 'reconnect.connection');
		const result = await this.call<AgentHostReconnectResult>(RemoteAgentHostProtocolCommand.Reconnect, request);
		assertAgentHostReconnectResult(request, result);
		return result;
	}

	/** Completes semantic recovery and releases actions received by the restored transport in exact arrival order. */
	completeRecovery(generation: number): boolean {
		if (this.recoveryGeneration !== generation) {
			return false;
		}
		if (
			this.connectionState !== 'restoring'
			|| this.transport.state !== 'connected'
			|| this.transport.generation !== generation
			|| generation <= this.semanticGeneration
		) {
			throw new Error(`Remote Agent Host generation '${generation}' is not awaiting semantic recovery.`);
		}
		for (let index = 0; index < this.bufferedActions.length; index++) {
			this.actionEmitter.fire(this.bufferedActions[index]);
		}
		if (
			this.recoveryGeneration !== generation
			|| this.transport.state !== 'connected'
			|| this.transport.generation !== generation
		) {
			return false;
		}
		this.bufferedActions.length = 0;
		this.semanticGeneration = generation;
		this.recoveryGeneration = undefined;
		this.setState('connected', generation);
		return true;
	}

	async setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		const result = await this.call<IAgentHostSetSubscriptionsResult>(
			RemoteAgentHostProtocolCommand.SetSubscriptions,
			request,
		);
		assertAgentHostSetSubscriptionsResult(request, result);
		return result;
	}

	async resolveSessionConfiguration(
		request: IAgentHostResolveSessionConfigurationRequest,
	): Promise<IAgentHostResolveSessionConfigurationResult> {
		return validateResolveResult(await this.call(
			RemoteAgentHostProtocolCommand.ResolveSessionConfiguration,
			request,
		));
	}

	async completeSessionConfiguration(
		request: IAgentHostSessionConfigurationCompletionsRequest,
	): Promise<IAgentHostSessionConfigurationCompletionsResult> {
		return validateCompletionResult(request, await this.call(
			RemoteAgentHostProtocolCommand.CompleteSessionConfiguration,
			request,
		));
	}

	async prepareSubmission(request: IAgentHostPrepareSubmissionRequest): Promise<AgentHostPrepareSubmissionResult> {
		await this.clientTools.synchronize();
		return validatePrepareResult(await this.call(RemoteAgentHostProtocolCommand.PrepareSubmission, request));
	}

	mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		return this.call(RemoteAgentHostProtocolCommand.Mutate, request);
	}

	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		return this.call(RemoteAgentHostProtocolCommand.GetOperationOutcome, request);
	}

	async executePackageOperation(request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		assertAgentPackageOperationRequest(request);
		const outcome = await this.call<AgentPackageOperationOutcome>(
			RemoteAgentHostProtocolCommand.ExecutePackageOperation,
			request,
		);
		assertAgentPackageOperationOutcome(request, outcome);
		return outcome;
	}

	async getPackageOperationOutcome(
		request: IAgentPackageOperationOutcomeRequest,
	): Promise<AgentPackageOperationOutcome> {
		assertAgentPackageOperationOutcomeRequest(request);
		const outcome = await this.call<AgentPackageOperationOutcome>(
			RemoteAgentHostProtocolCommand.GetPackageOperationOutcome,
			request,
		);
		assertAgentPackageOperationOutcome(request, outcome);
		return outcome;
	}

	override dispose(): void {
		this.lifetimeCancellation.cancel();
		super.dispose();
	}

	private async call<TResult>(
		command: RemoteAgentHostProtocolCommand,
		argument: object,
	): Promise<TResult>;
	private async call(
		command: RemoteAgentHostProtocolCommand,
		argument: object,
	): Promise<AgentHostProtocolValue> {
		if (this._store.isDisposed || this.connectionState === 'terminal') {
			throw new CancellationError();
		}
		assertAgentHostProtocolValue(argument);
		return this.transport.call(
			command,
			argument as unknown as AgentHostProtocolValue,
			this.lifetimeCancellation.token,
		);
	}

	private async synchronizeClientTools(snapshot: IAgentClientToolPublicationSnapshot): Promise<void> {
		const result = await this.call<AgentHostProtocolValue>(
			RemoteAgentHostProtocolCommand.SynchronizeClientTools,
			snapshot,
		);
		if (result !== null) {
			invalidProtocol('synchronizeClientTools.result', result);
		}
	}

	private assertConnection(connection: AgentHostClientConnectionId, field: string): void {
		if (connection !== this.connection) {
			invalidProtocol(field, connection);
		}
	}

	private receiveAction(action: AgentHostChannelAction): void {
		if (this.connectionState === 'connected') {
			this.actionEmitter.fire(action);
			return;
		}
		if (this.connectionState === 'restoring') {
			if (this.bufferedActions.length === this.options.maximumBufferedActions) {
				this.terminate(this.transport.generation);
				return;
			}
			this.bufferedActions.push(action);
		}
	}

	private changeTransportState(change: IRemoteAgentHostTransportStateChange): void {
		if (this.connectionState === 'terminal') {
			return;
		}
		if (change.state === 'terminal') {
			this.terminate(change.generation);
			return;
		}
		if (change.state === 'restoring') {
			this.bufferedActions.length = 0;
			this.recoveryGeneration = undefined;
			this.setState('restoring', change.generation);
			return;
		}
		if (this.connectionState !== 'restoring' || change.generation <= this.semanticGeneration) {
			this.terminate(change.generation);
			return;
		}
		this.recoveryGeneration = change.generation;
		this.recoveryEmitter.fire(Object.freeze({ generation: change.generation }));
	}

	private setState(state: RemoteAgentHostTransportState, generation: number): void {
		if (this.connectionState === state && this.stateGeneration === generation) {
			return;
		}
		this.connectionState = state;
		this.stateGeneration = generation;
		this.stateEmitter.fire(Object.freeze({ state, generation }));
	}

	private terminate(generation: number): void {
		if (this.connectionState === 'terminal') {
			return;
		}
		this.bufferedActions.length = 0;
		this.recoveryGeneration = undefined;
		this.lifetimeCancellation.cancel();
		this.transport.dispose();
		this.setState('terminal', generation);
	}
}
