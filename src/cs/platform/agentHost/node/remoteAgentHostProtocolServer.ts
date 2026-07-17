/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { raceCancellationError } from 'cs/base/common/async';
import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import type { IAgentHostConnection } from '../common/connections.js';
import { AgentHostError, AgentHostErrorCode } from '../common/errors.js';
import {
	assertAgentPackageOperationOutcome,
	assertAgentPackageOperationOutcomeRequest,
	assertAgentPackageOperationRequest,
	type IAgentPackageOperationOutcomeRequest,
	type IAgentPackageOperationRequest,
} from '../common/packages.js';
import {
	assertAgentHostReconnectResult,
	assertAgentHostSetSubscriptionsResult,
	type AgentHostChannelAction,
	type AgentHostReconnectResult,
	type IAgentHostInitializeRequest,
	type IAgentHostMutationRequest,
	type IAgentHostOperationProgress,
	type IAgentHostOperationOutcomeRequest,
	type IAgentHostPrepareSubmissionRequest,
	type IAgentHostReconnectRequest,
	type IAgentHostResolveSessionConfigurationRequest,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
	type IAgentHostSessionConfigurationCompletionsRequest,
} from '../common/protocol.js';
import {
	RemoteAgentHostProtocolCommand,
} from '../common/remoteProtocol.js';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from '../common/protocolValues.js';
import {
	validateAndFreezeAgentClientToolPublicationSnapshot,
	type IAgentClientToolPublicationSnapshot,
} from '../common/tools.js';

export interface IRemoteAgentHostClientToolPublication {
	synchronize(snapshot: IAgentClientToolPublicationSnapshot): void;
}

/** Dispatches the common Agent Host protocol to one exact Host logical connection. */
export class RemoteAgentHostProtocolServer extends Disposable {
	readonly onDidReceiveAction: Event<AgentHostChannelAction>;
	readonly onDidProgress: Event<IAgentHostOperationProgress>;

	constructor(
		private readonly connection: IAgentHostConnection,
		private readonly clientTools: IRemoteAgentHostClientToolPublication,
	) {
		super();
		this._register(connection);
		this.onDidReceiveAction = connection.onDidReceiveAction;
		this.onDidProgress = connection.onDidProgress;
	}

	async call(
		command: RemoteAgentHostProtocolCommand,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		if (argument !== undefined) {
			assertAgentHostProtocolValue(argument);
		}
		let result: unknown;
		switch (command) {
			case RemoteAgentHostProtocolCommand.Identity:
				if (argument !== undefined) {
					throw this.invalid('identity', argument);
				}
				result = Object.freeze({
					authority: this.connection.authority,
					connection: this.connection.connection,
				});
				break;
			case RemoteAgentHostProtocolCommand.Initialize: {
				const request = this.requireArgument<IAgentHostInitializeRequest>(argument, 'initialize');
				this.assertConnection(request.connection, 'initialize.connection');
				result = await raceCancellationError(this.connection.initialize(request), cancellation);
				break;
			}
			case RemoteAgentHostProtocolCommand.Reconnect: {
				const request = this.requireArgument<IAgentHostReconnectRequest>(argument, 'reconnect');
				this.assertConnection(request.connection, 'reconnect.connection');
				result = await raceCancellationError(this.connection.reconnect(request), cancellation);
				assertAgentHostReconnectResult(request, result as AgentHostReconnectResult);
				break;
			}
			case RemoteAgentHostProtocolCommand.SetSubscriptions: {
				const request = this.requireArgument<IAgentHostSetSubscriptionsRequest>(argument, 'setSubscriptions');
				result = await raceCancellationError(this.connection.setSubscriptions(request), cancellation);
				assertAgentHostSetSubscriptionsResult(request, result as IAgentHostSetSubscriptionsResult);
				break;
			}
			case RemoteAgentHostProtocolCommand.ResolveSessionConfiguration:
				result = await raceCancellationError(this.connection.resolveSessionConfiguration(
					this.requireArgument<IAgentHostResolveSessionConfigurationRequest>(
						argument,
						'resolveSessionConfiguration',
					),
				), cancellation);
				break;
			case RemoteAgentHostProtocolCommand.CompleteSessionConfiguration:
				result = await raceCancellationError(this.connection.completeSessionConfiguration(
					this.requireArgument<IAgentHostSessionConfigurationCompletionsRequest>(
						argument,
						'completeSessionConfiguration',
					),
				), cancellation);
				break;
			case RemoteAgentHostProtocolCommand.PrepareSubmission:
				result = await raceCancellationError(this.connection.prepareSubmission(
					this.requireArgument<IAgentHostPrepareSubmissionRequest>(argument, 'prepareSubmission'),
				), cancellation);
				break;
			case RemoteAgentHostProtocolCommand.Mutate:
				result = await raceCancellationError(this.connection.mutate(
					this.requireArgument<IAgentHostMutationRequest>(argument, 'mutate'),
				), cancellation);
				break;
			case RemoteAgentHostProtocolCommand.GetOperationOutcome:
				result = await raceCancellationError(this.connection.getOperationOutcome(
					this.requireArgument<IAgentHostOperationOutcomeRequest>(argument, 'getOperationOutcome'),
				), cancellation);
				break;
			case RemoteAgentHostProtocolCommand.ExecutePackageOperation: {
				const request = this.requireArgument<IAgentPackageOperationRequest>(argument, 'executePackageOperation');
				assertAgentPackageOperationRequest(request);
				result = await raceCancellationError(this.connection.executePackageOperation(request), cancellation);
				assertAgentPackageOperationOutcome(request, result);
				break;
			}
			case RemoteAgentHostProtocolCommand.GetPackageOperationOutcome: {
				const request = this.requireArgument<IAgentPackageOperationOutcomeRequest>(
					argument,
					'getPackageOperationOutcome',
				);
				assertAgentPackageOperationOutcomeRequest(request);
				result = await raceCancellationError(this.connection.getPackageOperationOutcome(request), cancellation);
				assertAgentPackageOperationOutcome(request, result);
				break;
			}
			case RemoteAgentHostProtocolCommand.SynchronizeClientTools: {
				const snapshot = validateAndFreezeAgentClientToolPublicationSnapshot(argument);
				this.assertConnection(snapshot.connection, 'synchronizeClientTools.connection');
				this.clientTools.synchronize(snapshot);
				result = null;
				break;
			}
			default:
				throw this.invalid('command', command);
		}
		assertAgentHostProtocolValue(result);
		return result;
	}

	private requireArgument<TRequest>(
		argument: AgentHostProtocolValue | undefined,
		field: string,
	): TRequest {
		if (argument === undefined || argument === null || typeof argument !== 'object' || Array.isArray(argument)) {
			throw this.invalid(field, argument);
		}
		return argument as unknown as TRequest;
	}

	private assertConnection(connection: string, field: string): void {
		if (connection !== this.connection.connection) {
			throw this.invalid(field, connection);
		}
	}

	private invalid(field: string, value: AgentHostProtocolValue | undefined): AgentHostError {
		return new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Invalid remote Agent Host request',
			{
				field,
				value: typeof value === 'number'
					? value
					: typeof value === 'string'
						? value.slice(0, 256)
						: typeof value,
			},
		);
	}
}
