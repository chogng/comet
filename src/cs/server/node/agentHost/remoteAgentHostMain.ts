/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable,
	toDisposable,
} from 'cs/base/common/lifecycle';
import type { IAgentContentResourcePort } from 'cs/platform/agentHost/common/contentResources';
import {
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	type AgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import { remoteServerAgentHostCapability } from 'cs/platform/agentHost/common/remoteProtocol';
import type { IAgentContentResourceClientRouter } from 'cs/platform/agentHost/node/content/agentContentResourceService';
import {
	AgentHostAuthority,
	type IAgentHostAuthorityOptions,
} from 'cs/platform/agentHost/node/host/agentHostAuthority';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import {
	formatRemoteAuthority,
	isEqualRemoteAuthority,
	type IRemoteAuthority,
	type RemoteClientId,
	type RemoteServerInstanceId,
} from 'cs/platform/remote/common/remoteAuthority';
import type {
	IRemoteServerConnection,
	IRemoteServerManagementListener,
} from 'cs/platform/remote/common/remoteConnection';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import { RemoteServerAgentHostBinding } from './remoteAgentHostChannel.js';

/** Assigns the explicit Agent Host logical identity for one accepted Remote client. */
export interface IRemoteServerAgentHostConnectionIdentity {
	create(connection: IRemoteServerConnection): AgentHostClientConnectionId;
}

export type RemoteAgentHostContentResources =
	Pick<IAgentContentResourcePort, 'open' | 'release'>
	& IAgentContentResourceClientRouter;

export interface IRemoteAgentHostMainOptions {
	readonly remoteAuthority: IRemoteAuthority;
	readonly remoteServer: RemoteServerInstanceId;
	readonly managementListener: IRemoteServerManagementListener;
	readonly maximumClientBindings: number;
	readonly host: Omit<IAgentHostAuthorityOptions, 'contentResources'>;
	readonly contentResources: RemoteAgentHostContentResources;
	readonly toolRegistry: AgentToolRegistry;
	readonly toolEndpoints: AgentToolEndpointRegistry;
	readonly connectionIdentity: IRemoteServerAgentHostConnectionIdentity;
}

export type RemoteAgentHostMainState = 'starting' | 'running' | 'stopping' | 'stopped';

function validateMaximumClientBindings(value: number): void {
	if (!Number.isSafeInteger(value) || value < 1 || value > 4096) {
		throw new Error('Remote Agent Host client binding capacity must be a safe integer between 1 and 4096');
	}
}

interface IRemoteAgentHostClientBinding {
	readonly connection: IRemoteServerConnection;
	readonly agentHostConnection: AgentHostClientConnectionId;
	readonly lifetime: DisposableStore;
}

function shutdownRequest(options: IRemoteAgentHostMainOptions) {
	const value = JSON.stringify(Object.freeze({
		kind: 'remoteServerAgentHostShutdown',
		host: options.host.authority,
		remoteAuthority: formatRemoteAuthority(options.remoteAuthority),
		remoteServer: options.remoteServer,
	}));
	const digest = createHash('sha256').update(value).digest('hex');
	return Object.freeze({
		operation: createAgentHostOperationId(`shutdown:${digest}`),
		payloadDigest: createAgentHostPayloadDigest(`sha256:${digest}`),
	});
}

/** Owns one Remote Server Agent Host authority, accepted-client bindings, and shutdown order. */
export class RemoteAgentHostMain extends Disposable {
	private readonly acceptance = this._register(new MutableDisposable<IDisposable>());
	private readonly bindingsByRemoteClient = new Map<RemoteClientId, IRemoteAgentHostClientBinding>();
	private readonly bindingsByAgentHostClient = new Map<AgentHostClientConnectionId, IRemoteAgentHostClientBinding>();
	private readonly remoteClientReservations = new Set<RemoteClientId>();
	private readonly agentHostClientReservations = new Set<AgentHostClientConnectionId>();
	private readonly maximumClientBindings: number;
	private authority: AgentHostAuthority | undefined;
	private currentState: RemoteAgentHostMainState = 'starting';
	private managementListenerStarted = false;
	private shutdownPromise: Promise<void> | undefined;

	private constructor(
		private readonly options: IRemoteAgentHostMainOptions,
		maximumClientBindings: number,
	) {
		super();
		this.maximumClientBindings = maximumClientBindings;
		this._register(options.managementListener);
		this._register(toDisposable(() => this.disposeClientBindings()));
	}

	static async create(options: IRemoteAgentHostMainOptions): Promise<RemoteAgentHostMain> {
		const maximumClientBindings = options.maximumClientBindings;
		validateMaximumClientBindings(maximumClientBindings);
		const result = new RemoteAgentHostMain(options, maximumClientBindings);
		try {
			await result.initialize();
			return result;
		} catch (error) {
			try {
				await result.shutdown();
			} catch (cleanupError) {
				throw new AggregateError([error, cleanupError], 'Remote Agent Host startup and cleanup both failed');
			}
			throw error;
		}
	}

	get state(): RemoteAgentHostMainState {
		return this.currentState;
	}

	shutdown(): Promise<void> {
		if (this.currentState === 'stopped') {
			this.shutdownPromise ??= Promise.resolve();
			return this.shutdownPromise;
		}
		this.shutdownPromise ??= this.doShutdown();
		return this.shutdownPromise;
	}

	private async initialize(): Promise<void> {
		const authority = this._register(await AgentHostAuthority.create(Object.freeze({
			...this.options.host,
			contentResources: this.options.contentResources,
		})));
		this.authority = authority;
		this.acceptance.value = this.options.managementListener.onDidAcceptConnection(connection => {
			this.acceptConnection(connection);
		});
		await this.options.managementListener.start();
		this.managementListenerStarted = true;
		this.currentState = 'running';
	}

	private acceptConnection(connection: IRemoteServerConnection): void {
		let remoteClientReserved = false;
		let reservedAgentHostClient: AgentHostClientConnectionId | undefined;
		try {
			this.assertAcceptableConnection(connection);
			this.reserveRemoteClient(connection.client);
			remoteClientReserved = true;
			const authority = this.authority;
			if (authority === undefined) {
				throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote Agent Host authority is not live');
			}
			const agentHostConnection = createAgentHostClientConnectionId(
				this.options.connectionIdentity.create(connection),
			);
			if (this.bindingsByAgentHostClient.has(agentHostConnection)
				|| this.agentHostClientReservations.has(agentHostConnection)) {
				throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Agent Host logical client identity is already bound', {
					connection: agentHostConnection,
				});
			}
			this.agentHostClientReservations.add(agentHostConnection);
			reservedAgentHostClient = agentHostConnection;

			const lifetime = new DisposableStore();
			try {
				const record: IRemoteAgentHostClientBinding = {
					connection,
					agentHostConnection,
					lifetime,
				};
				lifetime.add(new RemoteServerAgentHostBinding(
					authority,
					agentHostConnection,
					connection,
					this.options.contentResources,
					this.options.toolRegistry,
					this.options.toolEndpoints,
				));
				if (connection.state === 'terminal' || connection.state === 'disposed') {
					throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote connection ended during Agent Host binding', {
						state: connection.state,
					});
				}
				lifetime.add(connection.onDidChangeState(change => {
					if (change.state === 'terminal' || change.state === 'disposed') {
						this.releaseClientBinding(record);
					}
				}));
				this.bindingsByRemoteClient.set(connection.client, record);
				this.bindingsByAgentHostClient.set(agentHostConnection, record);
			} catch (error) {
				lifetime.dispose();
				throw error;
			}
		} catch (error) {
			this.rejectConnection(connection, error);
		} finally {
			if (reservedAgentHostClient !== undefined) {
				this.agentHostClientReservations.delete(reservedAgentHostClient);
			}
			if (remoteClientReserved) {
				this.remoteClientReservations.delete(connection.client);
			}
		}
	}

	private reserveRemoteClient(client: RemoteClientId): void {
		if (this.bindingsByRemoteClient.size + this.remoteClientReservations.size >= this.maximumClientBindings) {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote Agent Host client binding capacity is full', {
				maximumClientBindings: this.maximumClientBindings,
			});
		}
		this.remoteClientReservations.add(client);
	}

	private assertAcceptableConnection(connection: IRemoteServerConnection): void {
		if (this.currentState !== 'starting' && this.currentState !== 'running') {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote Agent Host is not accepting connections', {
				state: this.currentState,
			});
		}
		if (connection.state !== 'connected') {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Accepted Remote connection is not connected', {
				state: connection.state,
			});
		}
		if (!connection.environment.capabilities.includes(remoteServerAgentHostCapability)) {
			throw new RemoteError(RemoteErrorCode.ChannelMissing, 'Accepted Remote connection does not advertise Agent Host');
		}
		if (
			!isEqualRemoteAuthority(connection.authority, this.options.remoteAuthority)
			|| connection.server !== this.options.remoteServer
		) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Accepted Remote connection belongs to another server', {
				authority: formatRemoteAuthority(connection.authority),
				server: connection.server,
			});
		}
		if (this.bindingsByRemoteClient.has(connection.client)
			|| this.remoteClientReservations.has(connection.client)) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote logical client is already bound', {
				client: connection.client,
			});
		}
	}

	private rejectConnection(connection: IRemoteServerConnection, error: unknown): void {
		void connection.end().catch(endError => this.options.host.reportUnexpectedError(endError));
		this.options.host.reportUnexpectedError(error);
	}

	private releaseClientBinding(record: IRemoteAgentHostClientBinding): void {
		if (this.bindingsByRemoteClient.get(record.connection.client) !== record) {
			return;
		}
		this.bindingsByRemoteClient.delete(record.connection.client);
		if (this.bindingsByAgentHostClient.get(record.agentHostConnection) === record) {
			this.bindingsByAgentHostClient.delete(record.agentHostConnection);
		}
		record.lifetime.dispose();
	}

	private disposeClientBindings(): void {
		const errors: unknown[] = [];
		for (const record of [...this.bindingsByRemoteClient.values()]) {
			try {
				this.releaseClientBinding(record);
			} catch (error) {
				errors.push(error);
			}
		}
		this.bindingsByRemoteClient.clear();
		this.bindingsByAgentHostClient.clear();
		this.remoteClientReservations.clear();
		this.agentHostClientReservations.clear();
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Remote Agent Host client binding disposal failed');
		}
	}

	private async doShutdown(): Promise<void> {
		this.currentState = 'stopping';
		this.acceptance.clear();
		const errors: unknown[] = [];
		if (this.managementListenerStarted) {
			try {
				await this.options.managementListener.stop();
			} catch (error) {
				errors.push(error);
			}
		}
		try {
			this.disposeClientBindings();
		} catch (error) {
			errors.push(error);
		}
		try {
			await this.authority?.close(shutdownRequest(this.options));
		} catch (error) {
			errors.push(error);
		}
		try {
			super.dispose();
		} catch (error) {
			errors.push(error);
		}
		this.currentState = 'stopped';
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Remote Agent Host shutdown failed');
		}
	}

	override dispose(): void {
		if (this.currentState === 'stopped') {
			return;
		}
		throw new Error('Remote Agent Host requires awaited shutdown');
	}
}
