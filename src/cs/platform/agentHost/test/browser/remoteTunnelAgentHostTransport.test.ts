/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationError, CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter } from 'cs/base/common/event';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import { RemoteTunnelAgentHostTransport } from 'cs/platform/agentHost/browser/remoteTunnelAgentHostTransport';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointCredential,
	decodeRemoteAgentHostEndpointAuthenticationMessage,
	encodeRemoteAgentHostEndpointAuthenticationResult,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostTunnelScheduledDelay,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelProtocolRevision,
	createRemoteTunnelTransportGeneration,
	type IRemoteTunnelConnection,
	type IRemoteTunnelConnectionClose,
	type IRemoteTunnelConnectionStateChange,
	type RemoteTunnelConnectionState,
	type RemoteTunnelTransportGeneration,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteTunnelError, RemoteTunnelErrorCode } from 'cs/platform/tunnel/common/remoteTunnelErrors';

interface IManualWait {
	readonly delay: RemoteAgentHostTunnelScheduledDelay;
	readonly completion: DeferredPromise<void>;
	cancellationSubscription: IDisposable | undefined;
}

class ManualAgentHostScheduler implements IRemoteAgentHostTunnelScheduler {
	readonly waits: IManualWait[] = [];

	wait(delay: RemoteAgentHostTunnelScheduledDelay, cancellation: CancellationToken): Promise<void> {
		if (cancellation.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const completion = new DeferredPromise<void>();
		const wait: IManualWait = { delay, completion, cancellationSubscription: undefined };
		wait.cancellationSubscription = cancellation.onCancellationRequested(() => {
			wait.cancellationSubscription?.dispose();
			wait.cancellationSubscription = undefined;
			if (!completion.isSettled) {
				completion.error(new CancellationError());
			}
		});
		this.waits.push(wait);
		return completion.p;
	}

	release(owner: 'client' | 'host', generation: number): void {
		const wait = this.waits.find(candidate => candidate.delay.kind === 'endpointAuthenticationTimeout'
			&& candidate.delay.owner === owner
			&& candidate.delay.generation === generation
			&& !candidate.completion.isSettled);
		assert.ok(wait);
		wait.cancellationSubscription?.dispose();
		wait.cancellationSubscription = undefined;
		wait.completion.complete(undefined);
	}
}

const endpointIdentity = createRemoteTunnelEndpointIdentity(
	'mockRelay',
	'account.alpha',
	'tunnel.alpha',
	'cluster.west',
	'agent-host',
);
const identity = createRemoteTunnelConnectionIdentity(
	endpointIdentity,
	createRemoteTunnelClientConnectionId('client.alpha'),
);

class TestTunnelConnection extends Disposable implements IRemoteTunnelConnection {
	private readonly stateEmitter = this._register(new Emitter<IRemoteTunnelConnectionStateChange>());
	private readonly generationEmitter = this._register(new Emitter<RemoteTunnelTransportGeneration>());
	private readonly frameEmitter = this._register(new Emitter<Uint8Array>());
	private readonly closeEmitter = this._register(new Emitter<IRemoteTunnelConnectionClose>());
	private stateValue: RemoteTunnelConnectionState = 'connected';
	private generationValue = createRemoteTunnelTransportGeneration(1);
	private disposed = false;
	readonly sent: Uint8Array[] = [];
	closeCallCount = 0;
	disposeCallCount = 0;

	readonly identity = identity;
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidChangeGeneration = this.generationEmitter.event;
	readonly onDidReceiveFrame = this.frameEmitter.event;
	readonly onDidClose = this.closeEmitter.event;
	readonly endpoint;

	constructor(
		protocolRevision = remoteAgentHostTunnelProtocolRevision,
		private readonly receiveSend?: (frame: Uint8Array, connection: TestTunnelConnection) => void,
	) {
		super();
		const protocol = createRemoteTunnelProtocolRevision(protocolRevision);
		this.endpoint = Object.freeze({
			identity: endpointIdentity,
			kind: AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocol: Object.freeze({ minimum: protocol, maximum: protocol }),
			connectionScope: 'privateAuthenticated' as const,
			capabilities: Object.freeze([]),
			status: 'online' as const,
			hostConnectionCount: 1,
		});
	}

	get generation(): RemoteTunnelTransportGeneration {
		return this.generationValue;
	}

	get state(): RemoteTunnelConnectionState {
		return this.stateValue;
	}

	async send(frame: Uint8Array): Promise<void> {
		this.sent.push(new Uint8Array(frame));
		this.receiveSend?.(frame, this);
	}

	async resume(): Promise<void> {}

	async close(): Promise<void> {
		this.closeCallCount++;
		if (this.stateValue === 'closed' || this.stateValue === 'failed') {
			return;
		}
		this.stateValue = 'closed';
		const change = Object.freeze({ state: 'closed' as const, generation: this.generationValue });
		this.stateEmitter.fire(change);
		this.closeEmitter.fire(change);
	}

	transition(state: RemoteTunnelConnectionState, generation: number): void {
		const nextGeneration = createRemoteTunnelTransportGeneration(generation);
		if (nextGeneration !== this.generationValue) {
			this.generationValue = nextGeneration;
			this.generationEmitter.fire(nextGeneration);
		}
		this.stateValue = state;
		this.stateEmitter.fire(Object.freeze({ state, generation: nextGeneration }));
	}

	receive(frame: Uint8Array): void {
		this.frameEmitter.fire(new Uint8Array(frame));
	}

	override dispose(): void {
		this.disposeCallCount++;
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		super.dispose();
	}
}

const credentialText = 'direct-endpoint-secret';
const credential = createRemoteAgentHostEndpointCredential(credentialText);

function options(scheduler: IRemoteAgentHostTunnelScheduler) {
	return Object.freeze({ credential, scheduler, authenticationTimeoutMilliseconds: 1_000 });
}

function authenticateEveryGeneration(frame: Uint8Array, connection: TestTunnelConnection): void {
	const message = decodeRemoteAgentHostEndpointAuthenticationMessage(frame);
	assert.equal(message.kind, 'authenticate');
	connection.receive(encodeRemoteAgentHostEndpointAuthenticationResult(
		message.generation,
		RemoteAgentHostEndpointAuthenticationResult.Authenticated,
	));
}

suite('RemoteTunnelAgentHostTransport authentication', () => {
	test('binds the authentication listener before sending and owns lower close plus dispose', async () => {
		const scheduler = new ManualAgentHostScheduler();
		const lower = new TestTunnelConnection(remoteAgentHostTunnelProtocolRevision, authenticateEveryGeneration);
		const transport = await RemoteTunnelAgentHostTransport.create(
			lower,
			options(scheduler),
			CancellationTokenNone,
		);
		assert.equal(transport.state, 'connected');
		assert.equal(transport.generation, 1);
		assert.equal(lower.sent.length, 1);

		transport.dispose();
		await Promise.resolve();
		assert.equal(lower.closeCallCount, 1);
		assert.equal(lower.disposeCallCount, 1);
	});

	test('reauthenticates every connected generation and ignores a superseded interrupted attempt', async () => {
		const scheduler = new ManualAgentHostScheduler();
		const lower = new TestTunnelConnection(remoteAgentHostTunnelProtocolRevision, (frame, connection) => {
			const message = decodeRemoteAgentHostEndpointAuthenticationMessage(frame);
			assert.equal(message.kind, 'authenticate');
			if (message.generation !== 2) {
				connection.receive(encodeRemoteAgentHostEndpointAuthenticationResult(
					message.generation,
					RemoteAgentHostEndpointAuthenticationResult.Authenticated,
				));
			}
		});
		const transport = await RemoteTunnelAgentHostTransport.create(
			lower,
			options(scheduler),
			CancellationTokenNone,
		);
		const states: string[] = [];
		const subscription = transport.onDidChangeState(change => states.push(`${change.state}:${change.generation}`));

		lower.transition('reconnecting', 1);
		lower.transition('connected', 2);
		lower.transition('reconnecting', 2);
		lower.transition('connected', 3);
		await Promise.resolve();
		await Promise.resolve();

		assert.equal(transport.state, 'connected');
		assert.equal(transport.generation, 3);
		assert.equal(lower.closeCallCount, 0);
		assert.deepStrictEqual(lower.sent.map(frame => {
			const message = decodeRemoteAgentHostEndpointAuthenticationMessage(frame);
			return message.generation;
		}), [1, 2, 3]);
		assert.deepStrictEqual(states, ['restoring:1', 'restoring:2', 'connected:3']);

		subscription.dispose();
		transport.dispose();
		await Promise.resolve();
	});

	test('rejects wrong credentials and timeouts with safe errors while cleaning up the lower connection', async () => {
		const rejectedScheduler = new ManualAgentHostScheduler();
		const rejectedLower = new TestTunnelConnection(remoteAgentHostTunnelProtocolRevision, (frame, connection) => {
			const message = decodeRemoteAgentHostEndpointAuthenticationMessage(frame);
			assert.equal(message.kind, 'authenticate');
			connection.receive(encodeRemoteAgentHostEndpointAuthenticationResult(
				message.generation,
				RemoteAgentHostEndpointAuthenticationResult.Rejected,
			));
		});
		await assert.rejects(
			RemoteTunnelAgentHostTransport.create(
				rejectedLower,
				options(rejectedScheduler),
				CancellationTokenNone,
			),
			(error: unknown) => {
				assert.ok(error instanceof RemoteAgentHostEndpointAuthenticationError);
				assert.equal(error.code, RemoteAgentHostEndpointAuthenticationErrorCode.Rejected);
				assert.equal(JSON.stringify(error).includes(credentialText), false);
				return true;
			},
		);
		assert.deepStrictEqual(
			{ close: rejectedLower.closeCallCount, dispose: rejectedLower.disposeCallCount },
			{ close: 1, dispose: 1 },
		);

		const timeoutScheduler = new ManualAgentHostScheduler();
		const timeoutLower = new TestTunnelConnection();
		const creation = RemoteTunnelAgentHostTransport.create(
			timeoutLower,
			options(timeoutScheduler),
			CancellationTokenNone,
		);
		timeoutScheduler.release('client', 1);
		await assert.rejects(
			creation,
			(error: unknown) => error instanceof RemoteAgentHostEndpointAuthenticationError
				&& error.code === RemoteAgentHostEndpointAuthenticationErrorCode.TimedOut,
		);
		assert.deepStrictEqual(
			{ close: timeoutLower.closeCallCount, dispose: timeoutLower.disposeCallCount },
			{ close: 1, dispose: 1 },
		);
	});

	test('preserves pre-auth endpoint incompatibility and rejects accessor options', async () => {
		const incompatible = new TestTunnelConnection(2);
		await assert.rejects(
			RemoteTunnelAgentHostTransport.create(
				incompatible,
				options(new ManualAgentHostScheduler()),
				CancellationTokenNone,
			),
			(error: unknown) => error instanceof RemoteTunnelError
				&& error.code === RemoteTunnelErrorCode.EndpointIncompatible,
		);
		assert.deepStrictEqual(
			{ close: incompatible.closeCallCount, dispose: incompatible.disposeCallCount },
			{ close: 1, dispose: 1 },
		);

		const accessorLower = new TestTunnelConnection();
		const scheduler = new ManualAgentHostScheduler();
		const accessorOptions = {
			get credential() {
				return credential;
			},
			scheduler,
			authenticationTimeoutMilliseconds: 1_000,
		};
		await assert.rejects(
			RemoteTunnelAgentHostTransport.create(
				accessorLower,
				accessorOptions,
				CancellationTokenNone,
			),
			(error: unknown) => error instanceof RemoteAgentHostEndpointAuthenticationError
				&& error.code === RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
		);
		assert.deepStrictEqual(
			{ close: accessorLower.closeCallCount, dispose: accessorLower.disposeCallCount },
			{ close: 1, dispose: 1 },
		);
	});
});
