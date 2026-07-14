/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	createRemoteAuthority,
	createRemoteCapabilityId,
	createRemoteClientId,
	createRemoteConnectionGeneration,
	createRemoteCredential,
	createRemoteEndpointAddress,
	createRemoteEndpointKind,
	createRemoteProtocolVersion,
	createRemoteServerInstanceId,
	type IRemoteAuthority,
	type IRemoteAuthorityResolverService,
	type IRemoteResolvedEndpoint,
} from 'cs/platform/remote/common/remoteAuthority';
import type { IRemoteChannel, IRemoteChannelServer } from 'cs/platform/remote/common/remoteChannels';
import type {
	IRemoteConnectionStateChange,
	IRemoteManagementConnectRequest,
	IRemoteServerConnection,
	IRemoteServerConnectionFactory,
	RemoteConnectionState,
} from 'cs/platform/remote/common/remoteConnection';
import type { IRemoteEnvironment } from 'cs/platform/remote/common/remoteEnvironment';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import { RemoteServerService } from 'cs/workbench/services/remote/browser/remoteServerService';

class ControlledResolver implements IRemoteAuthorityResolverService {
	readonly result = new DeferredPromise<IRemoteResolvedEndpoint>();
	resolveCount = 0;

	async resolve(): Promise<IRemoteResolvedEndpoint> {
		this.resolveCount += 1;
		return this.result.p;
	}
}

class TestConnection extends Disposable implements IRemoteServerConnection {
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteConnectionStateChange>());
	readonly client = createRemoteClientId('client.alpha');
	readonly server = createRemoteServerInstanceId('server.instance.alpha');
	private currentGeneration = createRemoteConnectionGeneration(1);
	readonly environment: IRemoteEnvironment;
	readonly onDidChangeState = this.stateEmitter.event;
	state: RemoteConnectionState = 'connected';
	reconnectCount = 0;
	reconnectRequest: () => Promise<void> = async () => {};
	ended = false;
	disposed = false;

	constructor(readonly authority: IRemoteAuthority) {
		super();
		this.environment = {
			protocolVersion: createRemoteProtocolVersion('1'),
			operatingSystem: 'linux',
			architecture: 'x64',
			userHome: '/home/comet',
			temporaryDirectory: '/tmp',
			storageDirectory: '/home/comet/.comet',
			pathCasePolicy: 'sensitive',
			capabilities: [createRemoteCapabilityId('channels')],
			limits: {
				maximumFrameBytes: 2048,
				maximumPendingCalls: 16,
				maximumEventListeners: 16,
			},
		};
	}

	get generation() {
		return this.currentGeneration;
	}

	getChannel(_name: string): IRemoteChannel {
		throw new RemoteError(RemoteErrorCode.ChannelMissing, 'Test connection has no channels');
	}

	registerChannel(_name: string, _channel: IRemoteChannelServer): IDisposable {
		throw new RemoteError(RemoteErrorCode.ChannelMissing, 'Test connection has no channels');
	}

	async reconnect(): Promise<void> {
		this.reconnectCount += 1;
		await this.reconnectRequest();
		if (this.state !== 'reconnecting') {
			throw new RemoteError(RemoteErrorCode.GenerationConflict, 'Test connection is not reconnecting');
		}
		this.currentGeneration = createRemoteConnectionGeneration(this.currentGeneration + 1);
		this.publishState('connected');
	}

	async end(): Promise<void> {
		this.ended = true;
		this.publishState('terminal');
	}

	emitReconnecting(): void {
		this.publishState('reconnecting');
	}

	override dispose(): void {
		this.disposed = true;
		this.state = 'disposed';
		super.dispose();
	}

	private publishState(state: RemoteConnectionState): void {
		this.state = state;
		this.stateEmitter.fire(Object.freeze({ state, generation: this.currentGeneration }));
	}
}

class CountingConnectionFactory implements IRemoteServerConnectionFactory {
	connectCount = 0;

	constructor(private readonly connection: IRemoteServerConnection) {}

	async connect(
		_endpoint: IRemoteResolvedEndpoint,
		_request: IRemoteManagementConnectRequest,
	): Promise<IRemoteServerConnection> {
		this.connectCount += 1;
		return this.connection;
	}
}

function createEndpoint(authority: IRemoteAuthority): IRemoteResolvedEndpoint {
	return {
		authority,
		kind: createRemoteEndpointKind('mock'),
		address: createRemoteEndpointAddress('remote.test/server-alpha'),
		credential: createRemoteCredential('credential.alpha'),
		trusted: true,
	};
}

suite('RemoteServerService', { concurrency: false }, () => {
	test('shares one connection for concurrent consumers of the selected authority', async context => {
		const authority = createRemoteAuthority('mock', 'server.alpha');
		const resolver = new ControlledResolver();
		const connection = new TestConnection(authority);
		const factory = new CountingConnectionFactory(connection);
		const service = new RemoteServerService({
			selection: {
				authority,
				client: connection.client,
				protocolVersions: [createRemoteProtocolVersion('1')],
				productCommit: 'commit.alpha',
				locale: 'en-US',
				profile: 'profile.alpha',
			},
			resolver,
			connectionFactory: factory,
		});
		context.after(() => service.dispose());

		const first = service.connect();
		const second = service.connect();
		assert.strictEqual(first, second);
		assert.equal(resolver.resolveCount, 1);
		resolver.result.complete(createEndpoint(authority));
		assert.strictEqual(await first, connection);
		assert.strictEqual(await second, connection);
		assert.equal(factory.connectCount, 1);
		assert.strictEqual(service.connection, connection);
		assert.strictEqual(service.environment, connection.environment);

		await service.disconnect();
		assert.equal(connection.ended, true);
	});

	test('reconnects exactly once for each interrupted generation', async context => {
		const authority = createRemoteAuthority('mock', 'server.alpha');
		const resolver = new ControlledResolver();
		const connection = new TestConnection(authority);
		const firstStarted = new DeferredPromise<void>();
		const firstRelease = new DeferredPromise<void>();
		connection.reconnectRequest = async () => {
			firstStarted.complete();
			await firstRelease.p;
		};
		const service = new RemoteServerService({
			selection: {
				authority,
				client: connection.client,
				protocolVersions: [createRemoteProtocolVersion('1')],
				productCommit: 'commit.alpha',
				locale: 'en-US',
				profile: 'profile.alpha',
			},
			resolver,
			connectionFactory: new CountingConnectionFactory(connection),
		});
		context.after(() => service.dispose());
		const connected = service.connect();
		resolver.result.complete(createEndpoint(authority));
		await connected;

		connection.emitReconnecting();
		connection.emitReconnecting();
		await firstStarted.p;
		assert.equal(connection.reconnectCount, 1);
		firstRelease.complete();
		const firstConnected = new DeferredPromise<void>();
		const firstListener = connection.onDidChangeState(change => {
			if (change.state === 'connected') {
				firstConnected.complete();
			}
		});
		await firstConnected.p;
		firstListener.dispose();

		const secondStarted = new DeferredPromise<void>();
		connection.reconnectRequest = async () => secondStarted.complete();
		connection.emitReconnecting();
		await secondStarted.p;
		assert.equal(connection.reconnectCount, 2);
		assert.equal(connection.generation, 3);
	});

	test('ends the connection when the generation reconnect fails without retrying', async context => {
		const authority = createRemoteAuthority('mock', 'server.alpha');
		const resolver = new ControlledResolver();
		const connection = new TestConnection(authority);
		connection.reconnectRequest = async () => {
			throw new RemoteError(RemoteErrorCode.TransportUnavailable, 'Reconnect failed');
		};
		const service = new RemoteServerService({
			selection: {
				authority,
				client: connection.client,
				protocolVersions: [createRemoteProtocolVersion('1')],
				productCommit: 'commit.alpha',
				locale: 'en-US',
				profile: 'profile.alpha',
			},
			resolver,
			connectionFactory: new CountingConnectionFactory(connection),
		});
		context.after(() => service.dispose());
		const connected = service.connect();
		resolver.result.complete(createEndpoint(authority));
		await connected;

		const terminal = new DeferredPromise<void>();
		connection.onDidChangeState(change => {
			if (change.state === 'terminal') {
				terminal.complete();
			}
		});
		connection.emitReconnecting();
		connection.emitReconnecting();
		await terminal.p;
		assert.equal(connection.reconnectCount, 1);
		assert.equal(connection.ended, true);
		assert.equal(connection.state, 'terminal');
	});

	test('rejects a connection for another authority and disposes it', async context => {
		const selectedAuthority = createRemoteAuthority('mock', 'server.alpha');
		const resolver = new ControlledResolver();
		const connection = new TestConnection(createRemoteAuthority('mock', 'server.beta'));
		const service = new RemoteServerService({
			selection: {
				authority: selectedAuthority,
				client: connection.client,
				protocolVersions: [createRemoteProtocolVersion('1')],
				productCommit: 'commit.alpha',
				locale: 'en-US',
				profile: 'profile.alpha',
			},
			resolver,
			connectionFactory: new CountingConnectionFactory(connection),
		});
		context.after(() => service.dispose());

		const result = service.connect();
		resolver.result.complete(createEndpoint(selectedAuthority));
		await assert.rejects(
			result,
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ConnectionMismatch,
		);
		assert.equal(connection.disposed, true);
		assert.strictEqual(service.connect(), result);
	});
});
