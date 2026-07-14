/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import {
	createRemoteAuthority,
	createRemoteCapabilityId,
	createRemoteClientId,
	createRemoteConnectionGeneration,
	createRemoteCredential,
	createRemoteProtocolVersion,
	createRemoteServerInstanceId,
} from 'cs/platform/remote/common/remoteAuthority';
import type {
	IRemoteChannelContext,
	IRemoteChannelServer,
	RemoteValue,
} from 'cs/platform/remote/common/remoteChannels';
import { RemoteChannelMultiplexer } from 'cs/platform/remote/common/remoteChannels';
import type {
	IRemoteManagementConnectRequest,
	IRemoteServerConnection,
} from 'cs/platform/remote/common/remoteConnection';
import { RemoteManagementConnection } from 'cs/platform/remote/common/remoteConnection';
import type { IRemoteEnvironment } from 'cs/platform/remote/common/remoteEnvironment';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import type { IRemoteTransport, IRemoteTransportClose } from 'cs/platform/remote/common/remoteTransport';
import {
	createMockRemoteEndpointValues,
	MockRemoteServer,
} from 'cs/platform/remote/node/mockRemoteServer';
import { createMockRemoteTransportPair } from 'cs/platform/remote/node/mockRemoteTransport';

class TestChannel extends Disposable implements IRemoteChannelServer {
	private readonly valueEmitter = this._register(new EventEmitter<RemoteValue>());

	constructor(private readonly prefix: string) {
		super();
	}

	async call(
		_context: IRemoteChannelContext,
		command: string,
		argument: RemoteValue | undefined,
		cancellation: CancellationToken,
	): Promise<RemoteValue> {
		switch (command) {
			case 'echo':
				return `${this.prefix}:${String(argument)}`;
			case 'pending':
				return new Promise<RemoteValue>((_resolve, reject) => {
					cancellation.onCancellationRequested(() => {
						reject(new RemoteError(RemoteErrorCode.OperationCancelled, 'Test call cancelled'));
					});
				});
			default:
				throw new RemoteError(RemoteErrorCode.CommandMissing, 'Test command is not registered', {
					command,
				});
		}
	}

	listen(_context: IRemoteChannelContext, event: string): Event<RemoteValue> {
		if (event !== 'value') {
			throw new RemoteError(RemoteErrorCode.EventMissing, 'Test event is not registered', { event });
		}
		return this.valueEmitter.event;
	}

	fire(value: RemoteValue): void {
		this.valueEmitter.fire(value);
	}
}

class SendFailingTransport extends Disposable implements IRemoteTransport {
	private readonly payloadEmitter = this._register(new EventEmitter<string>());
	private readonly closeEmitter = this._register(new EventEmitter<IRemoteTransportClose>());
	private closed = false;

	readonly onDidReceivePayload = this.payloadEmitter.event;
	readonly onDidClose = this.closeEmitter.event;

	send(_payload: string): void {
		throw new RemoteError(RemoteErrorCode.TransportUnavailable, 'Test transport send failed');
	}

	close(reason: IRemoteTransportClose): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.closeEmitter.fire(reason);
	}

	override dispose(): void {
		this.close({ kind: 'graceful' });
		super.dispose();
	}
}

function createFixture() {
	const authority = createRemoteAuthority('mock', 'server.alpha');
	const client = createRemoteClientId('client.alpha');
	const credential = createRemoteCredential('credential.alpha');
	const protocol = createRemoteProtocolVersion('1');
	const endpoint = createMockRemoteEndpointValues('remote.test/server-alpha');
	const environment: IRemoteEnvironment = {
		protocolVersion: protocol,
		operatingSystem: 'linux',
		architecture: 'x64',
		userHome: '/home/comet',
		temporaryDirectory: '/tmp',
		storageDirectory: '/home/comet/.comet',
		pathCasePolicy: 'sensitive',
		capabilities: [createRemoteCapabilityId('channels')],
		limits: {
			maximumFrameBytes: 2048,
			maximumPendingCalls: 32,
			maximumEventListeners: 32,
		},
	};
	const server = new MockRemoteServer({
		authority,
		endpointKind: endpoint.kind,
		endpointAddress: endpoint.address,
		credential,
		server: createRemoteServerInstanceId('server.instance.alpha'),
		protocolVersions: [protocol],
		productCommit: 'commit.alpha',
		environment,
	});
	const request: IRemoteManagementConnectRequest = {
		authority,
		client,
		protocolVersions: [protocol],
		productCommit: 'commit.alpha',
		locale: 'en-US',
		profile: 'profile.alpha',
	};
	return { authority, client, credential, endpoint, environment, protocol, request, server };
}

async function connectFixture(fixture: ReturnType<typeof createFixture>) {
	const endpoint = await fixture.server.createResolver().resolve(fixture.authority);
	return fixture.server.connect(endpoint, fixture.request);
}

suite('Mock Remote Server vertical slice', { concurrency: false }, () => {
	test('enforces one-shot listener startup, stop, and disposal', async context => {
		const fixture = createFixture();
		context.after(() => fixture.server.dispose());
		const endpoint = await fixture.server.createResolver().resolve(fixture.authority);

		assert.equal(fixture.server.state, 'created');
		await assert.rejects(
			fixture.server.connect(endpoint, fixture.request),
			(error: Error) => error instanceof RemoteError
				&& error.code === RemoteErrorCode.ConnectionTerminal
				&& error.data.state === 'created',
		);
		await assert.rejects(
			fixture.server.stop(),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.DuplicateOperation,
		);

		await fixture.server.start();
		assert.equal(fixture.server.state, 'running');
		const connection = await fixture.server.connect(endpoint, fixture.request);
		context.after(() => connection.dispose());

		await fixture.server.stop();
		assert.equal(fixture.server.state, 'stopped');
		assert.equal(connection.state, 'terminal');
		assert.throws(
			() => fixture.server.getServerConnection(fixture.client),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ConnectionMismatch,
		);
		await assert.rejects(
			fixture.server.connect(endpoint, fixture.request),
			(error: Error) => error instanceof RemoteError
				&& error.code === RemoteErrorCode.ConnectionTerminal
				&& error.data.state === 'stopped',
		);
		await assert.rejects(
			fixture.server.start(),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.DuplicateOperation,
		);
		await assert.rejects(
			fixture.server.stop(),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.DuplicateOperation,
		);

		fixture.server.dispose();
		assert.equal(fixture.server.state, 'disposed');
		await assert.rejects(
			fixture.server.start(),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.DuplicateOperation,
		);
	});

	test('negotiates exact endpoint authentication and rejects incompatible inputs', async context => {
		const fixture = createFixture();
		context.after(() => fixture.server.dispose());
		const endpoint = await fixture.server.createResolver().resolve(fixture.authority);
		await fixture.server.start();

		await assert.rejects(
			fixture.server.connect({ ...endpoint, credential: createRemoteCredential('credential.wrong') }, fixture.request),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.AuthenticationDenied,
		);
		await assert.rejects(
			fixture.server.connect(endpoint, { ...fixture.request, protocolVersions: [createRemoteProtocolVersion('2')] }),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ProtocolIncompatible,
		);
		assert.equal(fixture.server.acceptedConnectionCount, 0);

		let acceptedConnection: IRemoteServerConnection | undefined;
		const acceptedSubscription = fixture.server.onDidAcceptConnection(connection => {
			acceptedConnection = connection;
		});
		context.after(() => acceptedSubscription.dispose());
		const connection = await fixture.server.connect(endpoint, fixture.request);
		context.after(() => connection.dispose());
		assert.equal(connection.environment.protocolVersion, fixture.protocol);
		assert.equal(fixture.server.acceptedConnectionCount, 1);
		assert.equal(acceptedConnection, fixture.server.getServerConnection(fixture.client));
		assert.notEqual(acceptedConnection, connection);
		await assert.rejects(
			fixture.server.connect(endpoint, fixture.request),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.DuplicateClient,
		);
	});

	test('treats a cancellation received after terminal response as a best-effort no-op', context => {
		const fixture = createFixture();
		context.after(() => fixture.server.dispose());
		const pair = createMockRemoteTransportPair();
		context.after(() => pair.client.dispose());
		context.after(() => pair.server.dispose());
		const multiplexer = new RemoteChannelMultiplexer(
			fixture.authority,
			fixture.client,
			fixture.environment.limits,
		);
		context.after(() => multiplexer.dispose());
		const protocolErrors: RemoteError[] = [];
		const errorSubscription = multiplexer.onDidProtocolError(error => protocolErrors.push(error));
		context.after(() => errorSubscription.dispose());
		multiplexer.attach(createRemoteConnectionGeneration(1), pair.server);

		pair.client.send(JSON.stringify({
			generation: 1,
			message: { kind: 'cancel', id: 7 },
		}));
		assert.deepStrictEqual(protocolErrors, []);
	});

	test('bounds incoming calls independently of the peer outgoing-call limit', context => {
		const fixture = createFixture();
		context.after(() => fixture.server.dispose());
		const pair = createMockRemoteTransportPair();
		context.after(() => pair.client.dispose());
		context.after(() => pair.server.dispose());
		const multiplexer = new RemoteChannelMultiplexer(
			fixture.authority,
			fixture.client,
			{ ...fixture.environment.limits, maximumPendingCalls: 1 },
		);
		context.after(() => multiplexer.dispose());
		const channel = new TestChannel('bounded');
		context.after(() => channel.dispose());
		const registration = multiplexer.registerChannel('bounded', channel);
		context.after(() => registration.dispose());
		multiplexer.attach(createRemoteConnectionGeneration(1), pair.server);

		const responses: unknown[] = [];
		const responseSubscription = pair.client.onDidReceivePayload(payload => responses.push(JSON.parse(payload)));
		context.after(() => responseSubscription.dispose());
		pair.client.send(JSON.stringify({
			generation: 1,
			message: { kind: 'call', id: 1, channel: 'bounded', name: 'pending' },
		}));
		pair.client.send(JSON.stringify({
			generation: 1,
			message: { kind: 'call', id: 2, channel: 'bounded', name: 'echo', argument: 'value' },
		}));

		assert.equal(responses.length, 1);
		assert.deepStrictEqual(responses[0], {
			generation: 1,
			message: {
				kind: 'callError',
				id: 2,
				error: {
					code: RemoteErrorCode.ProtocolViolation,
					data: {},
				},
			},
		});
	});

	test('turns a synchronous transport send failure into reconnecting state', async context => {
		const fixture = createFixture();
		context.after(() => fixture.server.dispose());
		const connection = new RemoteManagementConnection({
			authority: fixture.authority,
			client: fixture.client,
			server: createRemoteServerInstanceId('server.send-failure'),
			environment: fixture.environment,
			generation: createRemoteConnectionGeneration(1),
			transport: new SendFailingTransport(),
			reconnectProvider: {
				async reconnect() {
					throw new RemoteError(RemoteErrorCode.TransportUnavailable, 'Test reconnect unavailable');
				},
			},
		});
		context.after(() => connection.dispose());

		await assert.rejects(
			connection.getChannel('service').call('echo'),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.TransportUnavailable,
		);
		assert.equal(connection.state, 'reconnecting');
	});

	test('multiplexes isolated channels, reverse calls, events, cancellation, and disposal', async context => {
		const fixture = createFixture();
		context.after(() => fixture.server.dispose());
		const alpha = new TestChannel('alpha');
		const beta = new TestChannel('beta');
		context.after(() => alpha.dispose());
		context.after(() => beta.dispose());
		const alphaRegistration = fixture.server.registerChannel('alpha', alpha);
		const betaRegistration = fixture.server.registerChannel('beta', beta);
		context.after(() => alphaRegistration.dispose());
		context.after(() => betaRegistration.dispose());
		await fixture.server.start();
		const connection = await connectFixture(fixture);
		context.after(() => connection.dispose());

		assert.equal(await connection.getChannel('alpha').call('echo', 'value'), 'alpha:value');
		assert.equal(await connection.getChannel('beta').call('echo', 'value'), 'beta:value');
		await assert.rejects(
			connection.getChannel('missing').call('echo', 'value'),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ChannelMissing,
		);
		await assert.rejects(
			connection.getChannel('alpha').call('missing'),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.CommandMissing,
		);

		const reverse = new TestChannel('reverse');
		context.after(() => reverse.dispose());
		const reverseRegistration = connection.registerChannel('reverse', reverse);
		context.after(() => reverseRegistration.dispose());
		assert.equal(
			await fixture.server.getServerConnection(fixture.client).getChannel('reverse').call('echo', 'value'),
			'reverse:value',
		);

		const received = new DeferredPromise<RemoteValue>();
		const listener = connection.getChannel('alpha').listen('value');
		context.after(() => listener.dispose());
		const eventSubscription = listener.onDidReceive(value => received.complete(value));
		context.after(() => eventSubscription.dispose());
		alpha.fire('first');
		assert.equal(await received.p, 'first');
		listener.dispose();
		alpha.fire('second');

		const missingListener = connection.getChannel('alpha').listen('missing');
		context.after(() => missingListener.dispose());
		const missingEventError = new DeferredPromise<RemoteError>();
		const missingEventSubscription = missingListener.onDidError(error => missingEventError.complete(error));
		context.after(() => missingEventSubscription.dispose());
		assert.equal((await missingEventError.p).code, RemoteErrorCode.EventMissing);

		const invalidValueListener = connection.getChannel('alpha').listen('value');
		context.after(() => invalidValueListener.dispose());
		const invalidValueError = new DeferredPromise<RemoteError>();
		const invalidValueSubscription = invalidValueListener.onDidError(error => invalidValueError.complete(error));
		context.after(() => invalidValueSubscription.dispose());
		alpha.fire(undefined as unknown as RemoteValue);
		assert.equal((await invalidValueError.p).code, RemoteErrorCode.ProtocolViolation);
		assert.equal(connection.state, 'connected');

		const cancellation = new CancellationTokenSource();
		context.after(() => cancellation.dispose());
		const pending = connection.getChannel('alpha').call('pending', undefined, cancellation.token);
		cancellation.cancel();
		await assert.rejects(
			pending,
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.OperationCancelled,
		);

		assert.throws(
			() => fixture.server.registerChannel('alpha', alpha),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.DuplicateChannel,
		);
	});

	test('preserves logical identity across contiguous reconnect and rejects terminal reconnect', async context => {
		const fixture = createFixture();
		context.after(() => fixture.server.dispose());
		const channel = new TestChannel('server');
		context.after(() => channel.dispose());
		const channelRegistration = fixture.server.registerChannel('service', channel);
		context.after(() => channelRegistration.dispose());
		await fixture.server.start();
		const connection = await connectFixture(fixture);
		context.after(() => connection.dispose());
		const states: string[] = [];
		const stateSubscription = connection.onDidChangeState(change => states.push(`${change.state}:${change.generation}`));
		context.after(() => stateSubscription.dispose());

		fixture.server.loseTransport(fixture.client);
		assert.equal(connection.state, 'reconnecting');
		await connection.reconnect();
		assert.equal(connection.state, 'connected');
		assert.equal(connection.generation, 2);
		assert.equal(connection.client, fixture.client);
		assert.equal(fixture.server.acceptedConnectionCount, 1);
		assert.equal(await connection.getChannel('service').call('echo', 'after'), 'server:after');

		fixture.server.terminateClient(
			fixture.client,
			new RemoteError(RemoteErrorCode.AuthenticationDenied, 'Connection authority expired'),
		);
		assert.equal(connection.state, 'terminal');
		await assert.rejects(
			connection.reconnect(),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ConnectionTerminal,
		);
		assert.deepStrictEqual(states, ['reconnecting:1', 'connected:2', 'terminal:2']);
	});

	test('makes malformed and oversized framing explicit and terminal', async context => {
		const malformedFixture = createFixture();
		context.after(() => malformedFixture.server.dispose());
		await malformedFixture.server.start();
		const malformedConnection = await connectFixture(malformedFixture);
		context.after(() => malformedConnection.dispose());
		malformedFixture.server.sendRawPayloadToClient(malformedFixture.client, '{not-json');
		assert.equal(malformedConnection.state, 'terminal');

		const oversizedFixture = createFixture();
		context.after(() => oversizedFixture.server.dispose());
		await oversizedFixture.server.start();
		const oversizedConnection = await connectFixture(oversizedFixture);
		context.after(() => oversizedConnection.dispose());
		await assert.rejects(
			oversizedConnection.getChannel('service').call('echo', 'x'.repeat(4096)),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.FrameTooLarge,
		);
	});
});
