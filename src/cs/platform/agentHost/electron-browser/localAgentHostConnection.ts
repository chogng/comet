/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, CancellationTokenSource } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable } from 'cs/base/common/lifecycle';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import { ClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import {
	AgentHostError,
	AgentHostErrorCode,
	type IAgentHostErrorDataByCode,
} from 'cs/platform/agentHost/common/errors';
import {
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	type AgentHostAuthorityId,
	type AgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
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
	type IAgentHostOperationOutcomeRequest,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostReconnectRequest,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
} from 'cs/platform/agentHost/common/protocol';
import {
	assertAgentPackageOperationOutcome,
	assertAgentPackageOperationOutcomeRequest,
	assertAgentPackageOperationRequest,
	type AgentPackageOperationOutcome,
	type IAgentPackageOperationOutcomeRequest,
	type IAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import { assertAgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type { IAgentClientToolPublicationSnapshot } from 'cs/platform/agentHost/common/tools';

const localAgentHostErrorCode = 'AGENT_HOST_ERROR';
const localAgentHostCancellationErrorCode = 'AGENT_HOST_CANCELLED';

type ErrorRecord = Readonly<Record<string, unknown>>;

function asRecord(value: unknown): ErrorRecord | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as ErrorRecord
		: undefined;
}

function requireIdentity(value: unknown): {
	readonly authority: AgentHostAuthorityId;
	readonly connection: AgentHostClientConnectionId;
} {
	assertAgentHostProtocolValue(value);
	const identity = asRecord(value);
	if (
		identity === undefined
		|| Object.keys(identity).length !== 2
		|| typeof identity.authority !== 'string'
		|| typeof identity.connection !== 'string'
	) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Invalid local Agent Host connection identity',
			{ field: 'identity', value: typeof value },
		);
	}
	return Object.freeze({
		authority: createAgentHostAuthorityId(identity.authority),
		connection: createAgentHostClientConnectionId(identity.connection),
	});
}

function isAgentHostErrorCode(value: string): value is AgentHostErrorCode {
	return Object.values(AgentHostErrorCode).some(code => code === value);
}

function reviveConnectionError(error: unknown): unknown {
	const transportError = asRecord(error);
	if (transportError?.code === localAgentHostCancellationErrorCode) {
		return new CancellationError();
	}
	if (transportError?.code !== localAgentHostErrorCode) {
		return error;
	}

	const details = asRecord(transportError.details);
	if (
		details === undefined
		|| typeof details.code !== 'string'
		|| !isAgentHostErrorCode(details.code)
		|| typeof details.message !== 'string'
	) {
		return error;
	}
	assertAgentHostProtocolValue(details.data);
	return new AgentHostError<AgentHostErrorCode>(
		details.code,
		details.message,
		details.data as IAgentHostErrorDataByCode[AgentHostErrorCode],
	);
}

function assertConnectionRequest(
	requestConnection: AgentHostClientConnectionId,
	actualConnection: AgentHostClientConnectionId,
	field: string,
): void {
	if (requestConnection !== actualConnection) {
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Local Agent Host request addresses another logical connection',
			{ field, value: requestConnection },
		);
	}
}

/** Implements the common Agent Host connection over the desktop main-process channel. */
export class LocalAgentHostConnection extends Disposable implements IAgentHostConnection {
	private readonly lifetimeCancellation = this._register(new CancellationTokenSource());
	private readonly actionEmitter = this._register(new Emitter<AgentHostChannelAction>({ onListenerError: onUnexpectedError }));
	readonly onDidReceiveAction: Event<AgentHostChannelAction> = this.actionEmitter.event;
	readonly clientTools: ClientAgentToolService;

	private constructor(
		private readonly channel: IChannel,
		readonly authority: AgentHostAuthorityId,
		readonly connection: AgentHostClientConnectionId,
		maximumClientToolCallRecords: number,
	) {
		super();
		this.clientTools = this._register(new ClientAgentToolService(connection, {
			maximumCallRecords: maximumClientToolCallRecords,
			synchronize: snapshot => this.synchronizeClientTools(snapshot),
		}));
		this._register(this.channel.listen<unknown>('onDidReceiveAction')(action => {
			try {
				assertAgentHostProtocolValue(action);
				this.actionEmitter.fire(action as unknown as AgentHostChannelAction);
			} catch (error) {
				onUnexpectedError(error);
			}
		}));
	}

	static async create(channel: IChannel, maximumClientToolCallRecords: number): Promise<LocalAgentHostConnection> {
		let identity: unknown;
		try {
			identity = await channel.call<unknown>('identity');
		} catch (error) {
			throw reviveConnectionError(error);
		}
		const parsed = requireIdentity(identity);
		return new LocalAgentHostConnection(
			channel,
			parsed.authority,
			parsed.connection,
			maximumClientToolCallRecords,
		);
	}

	initialize(request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		assertConnectionRequest(request.connection, this.connection, 'initialize.connection');
		return this.call('initialize', request);
	}

	async reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		assertConnectionRequest(request.connection, this.connection, 'reconnect.connection');
		const result = await this.call<AgentHostReconnectResult>('reconnect', request);
		assertAgentHostReconnectResult(request, result);
		return result;
	}

	async setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		const result = await this.call<IAgentHostSetSubscriptionsResult>('setSubscriptions', request);
		assertAgentHostSetSubscriptionsResult(request, result);
		return result;
	}

	async prepareSubmission(request: IAgentHostPrepareSubmissionRequest): Promise<AgentHostPrepareSubmissionResult> {
		await this.clientTools.synchronize();
		return this.call('prepareSubmission', request);
	}

	mutate(request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		return this.call('mutate', request);
	}

	getOperationOutcome(request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		return this.call('getOperationOutcome', request);
	}

	async executePackageOperation(request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		assertAgentPackageOperationRequest(request);
		const outcome = await this.call<unknown>('executePackageOperation', request);
		assertAgentPackageOperationOutcome(request, outcome);
		return outcome;
	}

	async getPackageOperationOutcome(
		request: IAgentPackageOperationOutcomeRequest,
	): Promise<AgentPackageOperationOutcome> {
		assertAgentPackageOperationOutcomeRequest(request);
		const outcome = await this.call<unknown>('getPackageOperationOutcome', request);
		assertAgentPackageOperationOutcome(request, outcome);
		return outcome;
	}

	override dispose(): void {
		this.lifetimeCancellation.cancel();
		super.dispose();
	}

	private async call<TResult>(command: string, arg: object): Promise<TResult> {
		if (this._store.isDisposed) {
			throw new CancellationError();
		}
		assertAgentHostProtocolValue(arg);
		try {
			const result = await this.channel.call<unknown>(command, arg, this.lifetimeCancellation.token);
			assertAgentHostProtocolValue(result);
			return result as TResult;
		} catch (error) {
			throw reviveConnectionError(error);
		}
	}

	private async synchronizeClientTools(snapshot: IAgentClientToolPublicationSnapshot): Promise<void> {
		const result = await this.call<unknown>('synchronizeClientTools', snapshot);
		if (result !== null) {
			throw new AgentHostError(
				AgentHostErrorCode.InvalidProtocolValue,
				'Local Agent Host client Tool synchronization returned a non-null result',
				{ field: 'synchronizeClientTools.result', value: typeof result },
			);
		}
	}
}
