/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import {
	createRemoteConnectionGeneration,
	createRemoteEndpointAddress,
	createRemoteEndpointKind,
	formatRemoteAuthority,
	isEqualRemoteAuthority,
	type IRemoteAuthority,
	type IRemoteAuthorityResolver,
	type IRemoteResolvedEndpoint,
	type RemoteClientId,
	type RemoteCredential,
	type RemoteEndpointAddress,
	type RemoteEndpointKind,
	type RemoteProtocolVersion,
	type RemoteServerInstanceId,
} from '../common/remoteAuthority.js';
import type { IRemoteChannelServer } from '../common/remoteChannels.js';
import {
	RemoteManagementConnection,
	validateRemoteConnection,
	type IRemoteManagementConnectRequest,
	type IRemoteServerConnection,
	type IRemoteServerConnectionFactory,
	type IRemoteServerManagementListener,
} from '../common/remoteConnection.js';
import { validateRemoteEnvironment, type IRemoteEnvironment } from '../common/remoteEnvironment.js';
import { RemoteError, RemoteErrorCode, serializeRemoteError } from '../common/remoteErrors.js';
import type { IRemoteReconnectTransport, IRemoteTransportReconnectProvider } from '../common/remoteTransport.js';
import {
	createMockRemoteTransportPair,
	type MockRemoteTransport,
} from './mockRemoteTransport.js';

interface IMockRemoteClientRecord {
	readonly connection: RemoteManagementConnection;
	readonly resources: DisposableStore;
	readonly channelRegistrations: Map<string, IDisposable>;
	transport: MockRemoteTransport;
}

export interface IMockRemoteServerOptions {
	readonly authority: IRemoteAuthority;
	readonly endpointKind: RemoteEndpointKind;
	readonly endpointAddress: RemoteEndpointAddress;
	readonly credential: RemoteCredential;
	readonly server: RemoteServerInstanceId;
	readonly protocolVersions: readonly RemoteProtocolVersion[];
	readonly productCommit: string;
	readonly environment: IRemoteEnvironment;
}

export class MockRemoteAuthorityResolver implements IRemoteAuthorityResolver {
	readonly kind;

	constructor(
		private readonly authority: IRemoteAuthority,
		private readonly endpoint: IRemoteResolvedEndpoint,
	) {
		this.kind = authority.kind;
	}

	async resolve(authority: IRemoteAuthority): Promise<IRemoteResolvedEndpoint> {
		if (!isEqualRemoteAuthority(authority, this.authority)) {
			throw new RemoteError(RemoteErrorCode.ResolutionMismatch, 'Mock resolver does not own this authority', {
				expected: formatRemoteAuthority(this.authority),
				received: formatRemoteAuthority(authority),
			});
		}
		return this.endpoint;
	}
}

class ServerReconnectProvider implements IRemoteTransportReconnectProvider {
	async reconnect(currentGeneration: number): Promise<IRemoteReconnectTransport> {
		throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Server-side Remote connections do not initiate reconnect', {
			generation: currentGeneration,
		});
	}
}

type MockRemoteServerState = 'created' | 'running' | 'stopped' | 'disposed';

/** Explicit mock product implementing endpoint authentication and Remote management transport. */
export class MockRemoteServer extends Disposable implements IRemoteServerConnectionFactory, IRemoteServerManagementListener {
	private readonly acceptedEmitter = this._register(new EventEmitter<IRemoteServerConnection>({
		onListenerError: onUnexpectedError,
	}));
	private readonly clients = new Map<RemoteClientId, IMockRemoteClientRecord>();
	private readonly channels = new Map<string, IRemoteChannelServer>();
	private readonly serverReconnectProvider = new ServerReconnectProvider();
	private acceptedCount = 0;
	private currentState: MockRemoteServerState = 'created';

	readonly onDidAcceptConnection: Event<IRemoteServerConnection> = this.acceptedEmitter.event;

	constructor(readonly options: IMockRemoteServerOptions) {
		super();
		validateRemoteEnvironment(options.environment);
		if (options.protocolVersions.length === 0 || new Set(options.protocolVersions).size !== options.protocolVersions.length) {
			throw new RemoteError(RemoteErrorCode.ProtocolIncompatible, 'Mock Remote Server protocol catalog is invalid');
		}
	}

	get acceptedConnectionCount(): number {
		return this.acceptedCount;
	}

	get state(): MockRemoteServerState {
		return this.currentState;
	}

	async start(): Promise<void> {
		this.assertLifecycleState('created', 'start');
		this.currentState = 'running';
	}

	async stop(): Promise<void> {
		this.assertLifecycleState('running', 'stop');
		this.currentState = 'stopped';
		this.terminateClients('Mock Remote Server stopped');
	}

	createResolver(): MockRemoteAuthorityResolver {
		return new MockRemoteAuthorityResolver(this.options.authority, Object.freeze({
			authority: this.options.authority,
			kind: this.options.endpointKind,
			address: this.options.endpointAddress,
			credential: this.options.credential,
			trusted: true,
		}));
	}

	registerChannel(name: string, channel: IRemoteChannelServer): IDisposable {
		if (this.currentState === 'stopped' || this.currentState === 'disposed') {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Mock Remote Server no longer accepts channels', {
				state: this.currentState,
			});
		}
		if (this.channels.has(name)) {
			throw new RemoteError(RemoteErrorCode.DuplicateChannel, 'Mock Remote Server channel is already registered', {
				channel: name,
			});
		}
		this.channels.set(name, channel);
		for (const record of this.clients.values()) {
			record.channelRegistrations.set(name, record.connection.registerChannel(name, channel));
		}

		return toDisposable(() => {
			if (this.channels.get(name) !== channel) {
				return;
			}
			this.channels.delete(name);
			for (const record of this.clients.values()) {
				record.channelRegistrations.get(name)?.dispose();
				record.channelRegistrations.delete(name);
			}
		});
	}

	async connect(
		endpoint: IRemoteResolvedEndpoint,
		request: IRemoteManagementConnectRequest,
	): Promise<IRemoteServerConnection> {
		this.assertRunning();
		this.validateHandshake(endpoint, request);
		if (this.clients.has(request.client)) {
			throw new RemoteError(RemoteErrorCode.DuplicateClient, 'Remote logical client is already connected', {
				client: request.client,
			});
		}

		const protocolVersion = this.negotiateProtocol(request.protocolVersions);
		const environment = validateRemoteEnvironment({
			...this.options.environment,
			protocolVersion,
		});
		const generation = createRemoteConnectionGeneration(1);
		const pair = createMockRemoteTransportPair();
		const resources = new DisposableStore();
		const serverConnection = resources.add(new RemoteManagementConnection({
			authority: request.authority,
			client: request.client,
			server: this.options.server,
			environment,
			generation,
			transport: pair.server,
			reconnectProvider: this.serverReconnectProvider,
		}));
		const record: IMockRemoteClientRecord = {
			connection: serverConnection,
			resources,
			channelRegistrations: new Map(),
			transport: pair.server,
		};
		let clientConnection: RemoteManagementConnection | undefined;

		try {
			for (const [name, channel] of this.channels) {
				record.channelRegistrations.set(name, serverConnection.registerChannel(name, channel));
			}
			resources.add(serverConnection.onDidChangeState(change => {
				if (change.state === 'terminal' || change.state === 'disposed') {
					this.removeClient(request.client, record);
				}
			}));
			this.clients.set(request.client, record);

			clientConnection = new RemoteManagementConnection({
				authority: request.authority,
				client: request.client,
				server: this.options.server,
				environment,
				generation,
				transport: pair.client,
				reconnectProvider: {
					reconnect: currentGeneration => this.reconnectClient(request.client, currentGeneration),
				},
			});
			validateRemoteConnection(clientConnection, endpoint, request);
			this.acceptedCount += 1;
			this.acceptedEmitter.fire(serverConnection);
			return clientConnection;
		} catch (error) {
			this.clients.delete(request.client);
			clientConnection?.dispose();
			resources.dispose();
			pair.client.dispose();
			throw error;
		}
	}

	getServerConnection(client: RemoteClientId): RemoteManagementConnection {
		const record = this.clients.get(client);
		if (!record) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote logical client is not connected', {
				client,
			});
		}
		return record.connection;
	}

	loseTransport(client: RemoteClientId): void {
		const record = this.clients.get(client);
		if (!record) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote logical client is not connected', {
				client,
			});
		}
		record.transport.close({ kind: 'lost' });
	}

	sendRawPayloadToClient(client: RemoteClientId, payload: string): void {
		const record = this.clients.get(client);
		if (!record) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote logical client is not connected', {
				client,
			});
		}
		record.transport.send(payload);
	}

	terminateClient(client: RemoteClientId, error: RemoteError): void {
		const record = this.clients.get(client);
		if (!record) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Remote logical client is not connected', {
				client,
			});
		}
		record.transport.close({ kind: 'terminal', error: serializeRemoteError(error) });
	}

	private async reconnectClient(client: RemoteClientId, currentGeneration: number): Promise<IRemoteReconnectTransport> {
		this.assertRunning();
		const record = this.clients.get(client);
		if (!record || record.connection.state === 'terminal' || record.connection.state === 'disposed') {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Remote logical client cannot reconnect', {
				client,
			});
		}
		if (record.connection.generation !== currentGeneration || record.connection.state !== 'reconnecting') {
			throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Remote reconnect does not match server generation', {
				expected: record.connection.generation,
				received: currentGeneration,
			});
		}

		const generation = currentGeneration + 1;
		const pair = createMockRemoteTransportPair();
		record.connection.acceptReconnect({ generation, transport: pair.server });
		record.transport = pair.server;
		return {
			generation,
			transport: pair.client,
		};
	}

	private validateHandshake(endpoint: IRemoteResolvedEndpoint, request: IRemoteManagementConnectRequest): void {
		if (!isEqualRemoteAuthority(request.authority, this.options.authority)
			|| !isEqualRemoteAuthority(endpoint.authority, this.options.authority)) {
			throw new RemoteError(RemoteErrorCode.ConnectionMismatch, 'Mock Remote Server authority does not match', {
				authority: formatRemoteAuthority(request.authority),
			});
		}
		if (endpoint.kind !== this.options.endpointKind || endpoint.address !== this.options.endpointAddress) {
			throw new RemoteError(RemoteErrorCode.EndpointIncompatible, 'Mock Remote endpoint does not match');
		}
		if (endpoint.credential !== this.options.credential) {
			throw new RemoteError(RemoteErrorCode.AuthenticationDenied, 'Mock Remote credential was rejected');
		}
		if (request.productCommit !== this.options.productCommit) {
			throw new RemoteError(RemoteErrorCode.EndpointIncompatible, 'Remote product commit is incompatible');
		}
		if (request.locale.length === 0 || request.locale.length > 64 || request.profile.length === 0 || request.profile.length > 128) {
			throw new RemoteError(RemoteErrorCode.ProtocolViolation, 'Remote client context is invalid');
		}
	}

	private negotiateProtocol(offered: readonly RemoteProtocolVersion[]): RemoteProtocolVersion {
		if (offered.length === 0 || new Set(offered).size !== offered.length) {
			throw new RemoteError(RemoteErrorCode.ProtocolIncompatible, 'Remote protocol offer is invalid');
		}
		for (const supported of this.options.protocolVersions) {
			if (offered.includes(supported)) {
				return supported;
			}
		}
		throw new RemoteError(RemoteErrorCode.ProtocolIncompatible, 'No Remote protocol version is compatible', {
			offered: offered.join(','),
			supported: this.options.protocolVersions.join(','),
		});
	}

	private removeClient(client: RemoteClientId, record: IMockRemoteClientRecord): void {
		if (this.clients.get(client) !== record) {
			return;
		}
		this.clients.delete(client);
		for (const registration of record.channelRegistrations.values()) {
			registration.dispose();
		}
		record.channelRegistrations.clear();
		record.resources.dispose();
	}

	private assertRunning(): void {
		if (this.currentState !== 'running') {
			throw new RemoteError(RemoteErrorCode.ConnectionTerminal, 'Mock Remote Server is not running', {
				state: this.currentState,
			});
		}
	}

	private assertLifecycleState(expected: MockRemoteServerState, operation: 'start' | 'stop'): void {
		if (this.currentState !== expected) {
			throw new RemoteError(RemoteErrorCode.DuplicateOperation, `Mock Remote Server cannot ${operation} in its current state`, {
				state: this.currentState,
			});
		}
	}

	private terminateClients(message: string): void {
		const errors: unknown[] = [];
		for (const [client, record] of [...this.clients]) {
			try {
				record.transport.close({
					kind: 'terminal',
					error: serializeRemoteError(new RemoteError(RemoteErrorCode.ConnectionTerminal, message)),
				});
			} catch (error) {
				errors.push(error);
			}
			try {
				this.removeClient(client, record);
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Mock Remote Server client termination failed');
		}
	}

	override dispose(): void {
		if (this.currentState === 'disposed') {
			return;
		}
		this.currentState = 'disposed';
		const errors: unknown[] = [];
		try {
			this.terminateClients('Mock Remote Server disposed');
		} catch (error) {
			errors.push(error);
		}
		this.channels.clear();
		try {
			super.dispose();
		} catch (error) {
			errors.push(error);
		}
		if (errors.length === 1) {
			throw errors[0];
		}
		if (errors.length > 1) {
			throw new AggregateError(errors, 'Mock Remote Server disposal failed');
		}
	}
}

export function createMockRemoteEndpointValues(address: string): {
	readonly kind: RemoteEndpointKind;
	readonly address: RemoteEndpointAddress;
} {
	return {
		kind: createRemoteEndpointKind('mock'),
		address: createRemoteEndpointAddress(address),
	};
}
