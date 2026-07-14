/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, MutableDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	createRemoteConnectionGeneration,
	formatRemoteAuthority,
	isEqualRemoteAuthority,
	type IRemoteAuthority,
	type IRemoteResolvedEndpoint,
	type RemoteClientId,
	type RemoteConnectionGeneration,
	type RemoteProtocolVersion,
	type RemoteServerInstanceId,
} from './remoteAuthority.js';
import {
	RemoteChannelMultiplexer,
	type IRemoteChannel,
	type IRemoteChannelServer,
} from './remoteChannels.js';
import { validateRemoteEnvironment, type IRemoteEnvironment } from './remoteEnvironment.js';
import {
	deserializeRemoteError,
	RemoteError,
	RemoteErrorCode,
	serializeRemoteError,
} from './remoteErrors.js';
import type {
	IRemoteReconnectTransport,
	IRemoteTransport,
	IRemoteTransportClose,
	IRemoteTransportReconnectProvider,
} from './remoteTransport.js';

export type RemoteConnectionState = 'connected' | 'reconnecting' | 'terminal' | 'disposed';

export interface IRemoteConnectionStateChange {
	readonly state: RemoteConnectionState;
	readonly generation: RemoteConnectionGeneration;
	readonly error?: RemoteError;
}

export interface IRemoteManagementConnectRequest {
	readonly authority: IRemoteAuthority;
	readonly client: RemoteClientId;
	readonly protocolVersions: readonly RemoteProtocolVersion[];
	readonly productCommit: string;
	readonly locale: string;
	readonly profile: string;
}

export interface IRemoteServerConnection extends IDisposable {
	readonly authority: IRemoteAuthority;
	readonly client: RemoteClientId;
	readonly server: RemoteServerInstanceId;
	readonly environment: IRemoteEnvironment;
	readonly generation: RemoteConnectionGeneration;
	readonly state: RemoteConnectionState;
	readonly onDidChangeState: Event<IRemoteConnectionStateChange>;
	getChannel(name: string): IRemoteChannel;
	registerChannel(name: string, channel: IRemoteChannelServer): IDisposable;
	reconnect(): Promise<void>;
	end(): Promise<void>;
}

export interface IRemoteServerConnectionFactory {
	connect(endpoint: IRemoteResolvedEndpoint, request: IRemoteManagementConnectRequest): Promise<IRemoteServerConnection>;
}

/** Owns the accepting lifecycle for one Remote Server management endpoint. */
export interface IRemoteServerManagementListener extends IDisposable {
	readonly onDidAcceptConnection: Event<IRemoteServerConnection>;
	start(): Promise<void>;
	stop(): Promise<void>;
}

export interface IRemoteManagementConnectionOptions {
	readonly authority: IRemoteAuthority;
	readonly client: RemoteClientId;
	readonly server: RemoteServerInstanceId;
	readonly environment: IRemoteEnvironment;
	readonly generation: RemoteConnectionGeneration;
	readonly transport: IRemoteTransport;
	readonly reconnectProvider: IRemoteTransportReconnectProvider;
}

/** Owns one logical Remote client across physical transport generations. */
export class RemoteManagementConnection extends Disposable implements IRemoteServerConnection {
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteConnectionStateChange>({
		onListenerError: onUnexpectedError,
	}));
	private readonly transportOwner = this._register(new MutableDisposable<IRemoteTransport>());
	private readonly closeSubscription = this._register(new MutableDisposable<IDisposable>());
	private readonly multiplexer: RemoteChannelMultiplexer;
	private currentState: RemoteConnectionState = 'connected';
	private currentGeneration: RemoteConnectionGeneration;
	private reconnecting = false;

	readonly authority: IRemoteAuthority;
	readonly client: RemoteClientId;
	readonly server: RemoteServerInstanceId;
	readonly environment: IRemoteEnvironment;
	readonly onDidChangeState = this.stateEmitter.event;

	constructor(private readonly options: IRemoteManagementConnectionOptions) {
		super();
		this.authority = Object.freeze({ ...options.authority });
		this.client = options.client;
		this.server = options.server;
		this.environment = validateRemoteEnvironment(options.environment);
		this.currentGeneration = createRemoteConnectionGeneration(options.generation);
		this.multiplexer = this._register(new RemoteChannelMultiplexer(
			this.authority,
			this.client,
			this.environment.limits,
		));
		this._register(this.multiplexer.onDidProtocolError(error => this.terminate(error)));
		this.attachInitialTransport(options.transport);
	}

	get generation(): RemoteConnectionGeneration {
		return this.currentGeneration;
	}

	get state(): RemoteConnectionState {
		return this.currentState;
	}

	getChannel(name: string): IRemoteChannel {
		return this.multiplexer.getChannel(name);
	}

	registerChannel(name: string, channel: IRemoteChannelServer): IDisposable {
		this.assertNotDisposed();
		return this.multiplexer.registerChannel(name, channel);
	}

	async reconnect(): Promise<void> {
		if (this.currentState === 'terminal' || this.currentState === 'disposed') {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote connection is terminal', {
				state: this.currentState,
			});
		}
		if (this.currentState !== 'reconnecting') {
			throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Remote connection has not lost its transport', {
				generation: this.currentGeneration,
			});
		}
		if (this.reconnecting) {
			throw new RemoteError(RemoteErrorCode.DuplicateOperation, 'Remote reconnect is already running', {
				generation: this.currentGeneration,
			});
		}

		this.reconnecting = true;
		try {
			const result = await this.options.reconnectProvider.reconnect(this.currentGeneration);
			if (this.currentState !== 'reconnecting') {
				result.transport.dispose();
				throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote connection ended during reconnect', {
					state: this.currentState,
				});
			}
			this.acceptReconnect(result);
		} finally {
			this.reconnecting = false;
		}
	}

	acceptReconnect(result: IRemoteReconnectTransport): void {
		if (this.currentState !== 'reconnecting') {
			result.transport.dispose();
			throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Remote connection cannot accept a transport', {
				state: this.currentState,
			});
		}

		const generation = createRemoteConnectionGeneration(result.generation);
		if (generation !== this.currentGeneration + 1) {
			result.transport.dispose();
			throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Remote reconnect generation is not contiguous', {
				expected: this.currentGeneration + 1,
				received: generation,
			});
		}

		const previousGeneration = this.currentGeneration;
		this.currentGeneration = generation;
		try {
			this.attachTransport(result.transport);
		} catch (error) {
			this.currentGeneration = previousGeneration;
			throw error;
		}
		this.publishState('connected');
	}

	async end(): Promise<void> {
		if (this.currentState === 'disposed' || this.currentState === 'terminal') {
			return;
		}
		this.finishTransport({ kind: 'graceful' });
		this.publishState('terminal');
	}

	private attachInitialTransport(transport: IRemoteTransport): void {
		this.attachTransport(transport);
	}

	private attachTransport(transport: IRemoteTransport): void {
		try {
			this.transportOwner.value = transport;
			this.closeSubscription.value = transport.onDidClose(reason => this.handleTransportClose(transport, reason));
			this.multiplexer.attach(this.currentGeneration, transport);
		} catch (error) {
			this.closeSubscription.clear();
			this.transportOwner.clear();
			throw error;
		}
	}

	private handleTransportClose(transport: IRemoteTransport, reason: IRemoteTransportClose): void {
		if (this.transportOwner.value !== transport || this.currentState === 'disposed') {
			return;
		}

		this.releaseTransport(new RemoteError(RemoteErrorCode.TransportUnavailable, 'Remote transport closed'));
		if (reason.kind === 'lost') {
			this.publishState('reconnecting');
			return;
		}

		const error = reason.error
			? deserializeRemoteError(reason.error)
			: undefined;
		this.publishState('terminal', error);
	}

	private terminate(error: RemoteError): void {
		if (this.currentState === 'terminal' || this.currentState === 'disposed') {
			return;
		}
		this.finishTransport({ kind: 'terminal', error: serializeRemoteError(error) });
		this.publishState('terminal', error);
	}

	private finishTransport(reason: IRemoteTransportClose): void {
		const transport = this.transportOwner.clearAndLeak();
		this.closeSubscription.clear();
		this.multiplexer.detach(new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote connection ended'));
		try {
			transport?.close(reason);
		} finally {
			transport?.dispose();
		}
	}

	private releaseTransport(error: RemoteError): void {
		this.closeSubscription.clear();
		this.multiplexer.detach(error);
		this.transportOwner.clear();
	}

	private publishState(state: RemoteConnectionState, error?: RemoteError): void {
		this.currentState = state;
		this.stateEmitter.fire(Object.freeze({
			state,
			generation: this.currentGeneration,
			...(error ? { error } : {}),
		}));
	}

	private assertNotDisposed(): void {
		if (this.currentState === 'disposed') {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote connection is disposed');
		}
	}

	override dispose(): void {
		if (this.currentState === 'disposed') {
			return;
		}
		this.finishTransport({ kind: 'graceful' });
		this.publishState('disposed');
		super.dispose();
	}
}

export function validateRemoteConnection(
	connection: IRemoteServerConnection,
	endpoint: IRemoteResolvedEndpoint,
	request: IRemoteManagementConnectRequest,
): void {
	if (!isEqualRemoteAuthority(connection.authority, request.authority)
		|| !isEqualRemoteAuthority(endpoint.authority, request.authority)
		|| connection.client !== request.client) {
		throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote connection identities do not match', {
			authority: formatRemoteAuthority(request.authority),
		});
	}
}
