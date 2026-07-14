/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import {
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	type AgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointCredential,
	decodeRemoteAgentHostEndpointAuthenticationMessage,
	encodeRemoteAgentHostEndpointAuthenticationRequest,
	type IRemoteAgentHostEndpointAuthenticationRequest,
	type IRemoteAgentHostEndpointAuthenticator,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostTunnelScheduledDelay,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import type { IAgentContentResourceClientRouter } from 'cs/platform/agentHost/node/content/agentContentResourceService';
import {
	RemoteTunnelAgentHostHostingBinding,
	type IRemoteTunnelAgentHostHostingOptions,
} from 'cs/platform/agentHost/node/remoteTunnelAgentHostBinding';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelHostingLeaseId,
	createRemoteTunnelProtocolRevision,
	createRemoteTunnelRecordRevision,
	createRemoteTunnelTransportGeneration,
	createRemoteTunnelIdentity,
	type IRemoteTunnelDescriptor,
	type IRemoteTunnelEndpointStream,
	type IRemoteTunnelHostingLease,
	type IRemoteTunnelHostingStateChange,
	type IRemoteTunnelStopHostingRequest,
	type IRemoteTunnelStreamClose,
	type RemoteTunnelHostingState,
} from 'cs/platform/tunnel/common/remoteTunnel';

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

	hasPending(kind: RemoteAgentHostTunnelScheduledDelay['kind'], generation: number): boolean {
		return this.waits.some(wait => wait.delay.kind === kind
			&& wait.delay.generation === generation
			&& !wait.completion.isSettled);
	}

	release(kind: RemoteAgentHostTunnelScheduledDelay['kind'], generation: number): void {
		const wait = this.waits.find(candidate => candidate.delay.kind === kind
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
const tunnelIdentity = createRemoteTunnelIdentity(
	'mockRelay',
	'account.alpha',
	'tunnel.alpha',
	'cluster.west',
);
const protocolRevision = createRemoteTunnelProtocolRevision(remoteAgentHostTunnelProtocolRevision);
const endpoint = Object.freeze({
	identity: endpointIdentity,
	kind: AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	protocol: Object.freeze({ minimum: protocolRevision, maximum: protocolRevision }),
	connectionScope: 'privateAuthenticated' as const,
	capabilities: Object.freeze([]),
	status: 'online' as const,
	hostConnectionCount: 1,
});
const descriptor: IRemoteTunnelDescriptor = Object.freeze({
	identity: tunnelIdentity,
	displayName: 'Agent Host endpoint test',
	visibility: 'private',
	revision: createRemoteTunnelRecordRevision('revision.alpha'),
	endpoints: Object.freeze([endpoint]),
});

class TestHostingLease extends Disposable implements IRemoteTunnelHostingLease {
	private readonly stateEmitter = this._register(new Emitter<IRemoteTunnelHostingStateChange>());
	private readonly connectionEmitter = this._register(new Emitter<IRemoteTunnelEndpointStream>());
	private stateValue: RemoteTunnelHostingState = 'active';
	readonly lease = createRemoteTunnelHostingLeaseId('lease.alpha');
	readonly endpoint = endpoint;
	readonly descriptor = descriptor;
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidAcceptConnection = this.connectionEmitter.event;

	get state(): RemoteTunnelHostingState {
		return this.stateValue;
	}

	accept(stream: IRemoteTunnelEndpointStream): void {
		this.connectionEmitter.fire(stream);
	}

	async stop(_request: IRemoteTunnelStopHostingRequest): Promise<IRemoteTunnelDescriptor> {
		this.stateValue = 'stopped';
		this.stateEmitter.fire(Object.freeze({ state: 'stopped', descriptor }));
		return descriptor;
	}

	override dispose(): void {
		if (this.stateValue === 'disposed') {
			return;
		}
		this.stateValue = 'disposed';
		super.dispose();
	}
}

class TestEndpointStream extends Disposable implements IRemoteTunnelEndpointStream {
	private readonly frameEmitter = this._register(new Emitter<Uint8Array>());
	private readonly closeEmitter = this._register(new Emitter<IRemoteTunnelStreamClose>());
	private closed = false;
	readonly sent: Uint8Array[] = [];
	closeCallCount = 0;
	disposeCallCount = 0;
	readonly identity;
	readonly generation;
	readonly onDidReceiveFrame = this.frameEmitter.event;
	readonly onDidClose = this.closeEmitter.event;

	constructor(
		connection: string,
		generation: number,
		private readonly onSend: (generation: number) => void = () => {},
	) {
		super();
		this.identity = createRemoteTunnelConnectionIdentity(
			endpointIdentity,
			createRemoteTunnelClientConnectionId(connection),
		);
		this.generation = createRemoteTunnelTransportGeneration(generation);
	}

	async send(frame: Uint8Array): Promise<void> {
		if (this.closed) {
			throw new Error('Test stream is closed');
		}
		this.sent.push(new Uint8Array(frame));
		this.onSend(this.generation);
	}

	async close(): Promise<void> {
		this.closeCallCount++;
		this.finish(Object.freeze({ kind: 'graceful' }));
	}

	receive(frame: Uint8Array): void {
		if (!this.closed) {
			this.frameEmitter.fire(new Uint8Array(frame));
		}
	}

	lose(): void {
		this.finish(Object.freeze({ kind: 'lost' }));
	}

	override dispose(): void {
		this.disposeCallCount++;
		this.finish(Object.freeze({ kind: 'graceful' }));
	}

	private finish(reason: IRemoteTunnelStreamClose): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.closeEmitter.fire(reason);
		super.dispose();
	}
}

class TestAgentHostConnection extends Disposable implements IAgentHostConnection {
	readonly authority = createAgentHostAuthorityId('remote-tunnel-test');
	readonly onDidReceiveAction = Event.None as IAgentHostConnection['onDidReceiveAction'];

	constructor(readonly connection: AgentHostClientConnectionId) {
		super();
	}

	initialize(): Promise<never> { return Promise.reject(new Error('Unexpected initialize')); }
	reconnect(): Promise<never> { return Promise.reject(new Error('Unexpected reconnect')); }
	setSubscriptions(): Promise<never> { return Promise.reject(new Error('Unexpected subscriptions')); }
	resolveSessionConfiguration(): Promise<never> { return Promise.reject(new Error('Unexpected resolution')); }
	completeSessionConfiguration(): Promise<never> { return Promise.reject(new Error('Unexpected completion')); }
	prepareSubmission(): Promise<never> { return Promise.reject(new Error('Unexpected prepare')); }
	mutate(): Promise<never> { return Promise.reject(new Error('Unexpected mutation')); }
	getOperationOutcome(): Promise<never> { return Promise.reject(new Error('Unexpected outcome')); }
	executePackageOperation(): Promise<never> { return Promise.reject(new Error('Unexpected package operation')); }
	getPackageOperationOutcome(): Promise<never> { return Promise.reject(new Error('Unexpected package outcome')); }
}

class RecordingAuthenticator implements IRemoteAgentHostEndpointAuthenticator {
	readonly requests: IRemoteAgentHostEndpointAuthenticationRequest[] = [];

	constructor(
		private readonly acceptedCredential: ReturnType<typeof createRemoteAgentHostEndpointCredential>,
		private readonly order: string[],
	) {}

	async authenticate(
		request: IRemoteAgentHostEndpointAuthenticationRequest,
		_cancellation: CancellationToken,
	): Promise<RemoteAgentHostEndpointAuthenticationResult> {
		this.requests.push(request);
		this.order.push(`authenticate:${request.generation}`);
		return request.credential === this.acceptedCredential
			? RemoteAgentHostEndpointAuthenticationResult.Authenticated
			: RemoteAgentHostEndpointAuthenticationResult.Rejected;
	}
}

interface IFixture {
	readonly lease: TestHostingLease;
	readonly scheduler: ManualAgentHostScheduler;
	readonly authenticator: RecordingAuthenticator;
	readonly binding: RemoteTunnelAgentHostHostingBinding;
	readonly order: string[];
	readonly counters: {
		authorityConnections: number;
		identityCreations: number;
		contentBindings: number;
	};
}

const acceptedCredential = createRemoteAgentHostEndpointCredential('accepted-endpoint-secret');
const rejectedCredential = createRemoteAgentHostEndpointCredential('rejected-endpoint-secret');
const agentHostConnection = createAgentHostClientConnectionId('remote-tunnel-client');

function createFixture(maximumLogicalConnections = 4): IFixture {
	const lease = new TestHostingLease();
	const scheduler = new ManualAgentHostScheduler();
	const order: string[] = [];
	const authenticator = new RecordingAuthenticator(acceptedCredential, order);
	const counters = { authorityConnections: 0, identityCreations: 0, contentBindings: 0 };
	const contentResources: IAgentContentResourceClientRouter = {
		bindClientReader: () => {
			counters.contentBindings++;
			order.push('content');
			return toDisposable(() => {});
		},
	};
	const options: IRemoteTunnelAgentHostHostingOptions = Object.freeze({
		authority: Object.freeze({
			createConnection: (connection: AgentHostClientConnectionId) => {
				counters.authorityConnections++;
				order.push('authority');
				return new TestAgentHostConnection(connection);
			},
		}),
		identityFactory: Object.freeze({
			create: () => {
				counters.identityCreations++;
				order.push('identity');
				return agentHostConnection;
			},
		}),
		contentResources,
		toolRegistry: new AgentToolRegistry(),
		toolEndpoints: new AgentToolEndpointRegistry(),
		authenticator,
		scheduler,
		authenticationTimeoutMilliseconds: 1_000,
		logicalConnectionGracePeriodMilliseconds: 10_000,
		maximumLogicalConnections,
		maximumRetainedLogicalConnectionIdentities: 16,
	});
	return {
		lease,
		scheduler,
		authenticator,
		binding: new RemoteTunnelAgentHostHostingBinding(lease, options),
		order,
		counters,
	};
}

function sendAuthentication(
	stream: TestEndpointStream,
	credential: ReturnType<typeof createRemoteAgentHostEndpointCredential>,
): void {
	stream.receive(encodeRemoteAgentHostEndpointAuthenticationRequest(stream.generation, credential));
}

async function flushUntil(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 20; attempt++) {
		if (predicate()) {
			return;
		}
		await Promise.resolve();
	}
	assert.fail('Expected deterministic asynchronous work to settle');
}

function authenticationResult(stream: TestEndpointStream) {
	assert.equal(stream.sent.length, 1);
	return decodeRemoteAgentHostEndpointAuthenticationMessage(stream.sent[0]);
}

suite('RemoteTunnelAgentHostHostingBinding authentication', () => {
	test('rejects a wrong credential before identity or Host connection creation', async () => {
		const fixture = createFixture();
		const stream = new TestEndpointStream('wrong-credential', 1);
		fixture.lease.accept(stream);
		sendAuthentication(stream, rejectedCredential);
		await flushUntil(() => stream.sent.length === 1);

		assert.deepStrictEqual(authenticationResult(stream), {
			kind: 'authenticationResult',
			protocolRevision: 3,
			generation: 1,
			result: 'rejected',
		});
		assert.deepStrictEqual(fixture.counters, {
			authorityConnections: 0,
			identityCreations: 0,
			contentBindings: 0,
		});
		assert.equal(fixture.authenticator.requests.length, 1);
		fixture.binding.dispose();
	});

	test('authenticates generations one and two before materialization or restoration and cancels grace', async () => {
		const fixture = createFixture();
		const first = new TestEndpointStream('restored-client', 1, generation => {
			fixture.order.push(`send:${generation}`);
		});
		fixture.lease.accept(first);
		assert.deepStrictEqual(fixture.order, []);
		sendAuthentication(first, acceptedCredential);
		await flushUntil(() => first.sent.length === 1);
		assert.equal(authenticationResult(first).kind, 'authenticationResult');
		assert.deepStrictEqual(fixture.order, [
			'authenticate:1',
			'identity',
			'authority',
			'content',
			'send:1',
		]);
		assert.equal(fixture.counters.authorityConnections, 1);

		first.lose();
		assert.equal(fixture.scheduler.hasPending('agentHostConnectionGraceExpiry', 1), true);
		const second = new TestEndpointStream('restored-client', 2, generation => {
			fixture.order.push(`send:${generation}`);
		});
		fixture.lease.accept(second);
		assert.equal(fixture.authenticator.requests.length, 1);
		sendAuthentication(second, acceptedCredential);
		await flushUntil(() => second.sent.length === 1);
		assert.deepStrictEqual(fixture.authenticator.requests.map(request => request.generation), [1, 2]);
		assert.equal(fixture.counters.authorityConnections, 1);
		assert.equal(fixture.scheduler.hasPending('agentHostConnectionGraceExpiry', 1), false);
		assert.deepStrictEqual(fixture.order.slice(-2), ['authenticate:2', 'send:2']);

		second.lose();
		assert.equal(fixture.scheduler.hasPending('agentHostConnectionGraceExpiry', 2), true);
		fixture.scheduler.release('agentHostConnectionGraceExpiry', 2);
		await Promise.resolve();
		const expired = new TestEndpointStream('restored-client', 3);
		fixture.lease.accept(expired);
		await Promise.resolve();
		assert.equal(expired.closeCallCount, 1);
		assert.equal(fixture.authenticator.requests.length, 2);
		fixture.binding.dispose();
	});

	test('enforces the logical connection cap before Host creation', async () => {
		const fixture = createFixture(1);
		const admitted = new TestEndpointStream('admitted-client', 1);
		const rejected = new TestEndpointStream('over-cap-client', 1);
		fixture.lease.accept(admitted);
		fixture.lease.accept(rejected);
		await Promise.resolve();
		assert.equal(rejected.closeCallCount, 1);
		assert.equal(fixture.counters.authorityConnections, 0);

		sendAuthentication(admitted, acceptedCredential);
		await flushUntil(() => admitted.sent.length === 1);
		assert.equal(fixture.counters.authorityConnections, 1);
		fixture.binding.dispose();
	});

	test('rejects an unauthenticated generation when the explicit Host timeout expires', async () => {
		const fixture = createFixture();
		const stream = new TestEndpointStream('timed-out-client', 1);
		fixture.lease.accept(stream);
		assert.equal(fixture.scheduler.hasPending('endpointAuthenticationTimeout', 1), true);
		fixture.scheduler.release('endpointAuthenticationTimeout', 1);
		await flushUntil(() => stream.sent.length === 1);
		const result = authenticationResult(stream);
		assert.equal(result.kind, 'authenticationResult');
		assert.equal(result.result, RemoteAgentHostEndpointAuthenticationResult.Rejected);
		assert.equal(fixture.counters.authorityConnections, 0);
		fixture.binding.dispose();
	});

	test('rejects symbol and accessor additions at the Hosting options boundary', () => {
		const fixture = createFixture();
		fixture.binding.dispose();
		const lease = new TestHostingLease();
		const symbol = Symbol('extra');
		const invalid = {
			authority: Object.freeze({ createConnection: () => new TestAgentHostConnection(agentHostConnection) }),
			identityFactory: Object.freeze({ create: () => agentHostConnection }),
			contentResources: Object.freeze({ bindClientReader: () => toDisposable(() => {}) }),
			toolRegistry: new AgentToolRegistry(),
			toolEndpoints: new AgentToolEndpointRegistry(),
			authenticator: fixture.authenticator,
			scheduler: fixture.scheduler,
			authenticationTimeoutMilliseconds: 1_000,
			logicalConnectionGracePeriodMilliseconds: 10_000,
			maximumLogicalConnections: 1,
			maximumRetainedLogicalConnectionIdentities: 1,
			[symbol]: true,
		};
		assert.throws(
			() => new RemoteTunnelAgentHostHostingBinding(lease, invalid),
			(error: unknown) => error instanceof RemoteAgentHostEndpointAuthenticationError
				&& error.code === RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
		);
		lease.dispose();
	});
});
