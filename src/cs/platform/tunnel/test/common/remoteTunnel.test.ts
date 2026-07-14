/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test, type TestContext } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import {
	createMockRemoteTunnelProduct,
	MOCK_REMOTE_TUNNEL_FRAME_CAPABILITY,
	MockRemoteTunnelRelayStream,
} from 'cs/platform/tunnel/common/mockRemoteTunnelProducts';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	createRemoteTunnelAccountIdentity,
	createRemoteTunnelClientConnectionId,
	computeRemoteTunnelMutationValueDigest,
	createRemoteTunnelEndpointCapability,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelEndpointKind,
	createRemoteTunnelIdentity,
	createRemoteTunnelOperationId,
	createRemoteTunnelProtocolRevision,
	createRemoteTunnelRecordRevision,
	createRemoteTunnelValueDigest,
	validateRemoteTunnelEndpointPublication,
	type IRemoteTunnelDescriptor,
	type IRemoteTunnelEndpointIdentity,
	type IRemoteTunnelEndpointPublication,
	type IRemoteTunnelHostingLease,
	type IRemoteTunnelIdentity,
	type IRemoteTunnelMutationIdentity,
	type IRemoteTunnelScheduler,
	type RemoteTunnelScheduledDelay,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteTunnelError, RemoteTunnelErrorCode } from 'cs/platform/tunnel/common/remoteTunnelErrors';
import {
	RemoteTunnelHostService,
	RemoteTunnelProductRegistry,
	RemoteTunnelService,
} from 'cs/platform/tunnel/common/remoteTunnelService';

interface IManualTunnelWait {
	readonly delay: RemoteTunnelScheduledDelay;
	readonly completion: DeferredPromise<void>;
	cancellationSubscription: IDisposable | undefined;
}

class ManualTunnelScheduler implements IRemoteTunnelScheduler {
	private readonly waits: IManualTunnelWait[] = [];
	private readonly countWaiters = new Map<string, {
		readonly kind: RemoteTunnelScheduledDelay['kind'];
		readonly count: number;
		readonly completion: DeferredPromise<void>;
	}>();

	/** Records one Tunnel delay until the test releases it. */
	wait(delay: RemoteTunnelScheduledDelay, cancellation: CancellationToken): Promise<void> {
		if (cancellation.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const completion = new DeferredPromise<void>();
		const wait: IManualTunnelWait = { delay, completion, cancellationSubscription: undefined };
		wait.cancellationSubscription = cancellation.onCancellationRequested(() => {
			wait.cancellationSubscription?.dispose();
			wait.cancellationSubscription = undefined;
			if (!completion.isSettled) {
				completion.error(new CancellationError());
			}
		});
		this.waits.push(wait);
		for (const [key, waiter] of this.countWaiters) {
			if (this.waits.filter(candidate => candidate.delay.kind === waiter.kind).length >= waiter.count) {
				waiter.completion.complete(undefined);
				this.countWaiters.delete(key);
			}
		}
		return completion.p;
	}

	/** Waits for an exact number of scheduled delays without using time. */
	waitForCount(
		count: number,
		kind: RemoteTunnelScheduledDelay['kind'] = 'reconnectAttempt',
	): Promise<void> {
		if (this.waits.filter(wait => wait.delay.kind === kind).length >= count) {
			return Promise.resolve();
		}
		const waiter = new DeferredPromise<void>();
		this.countWaiters.set(`${kind}:${count}`, { kind, count, completion: waiter });
		return waiter.p;
	}

	/** Releases one recorded Tunnel delay. */
	async release(index: number, kind: RemoteTunnelScheduledDelay['kind'] = 'reconnectAttempt'): Promise<void> {
		const wait = this.waits.filter(candidate => candidate.delay.kind === kind)[index];
		if (!wait || wait.completion.isSettled) {
			throw new Error(`${kind} wait ${index} is unavailable`);
		}
		wait.cancellationSubscription?.dispose();
		wait.cancellationSubscription = undefined;
		wait.completion.complete(undefined);
		await wait.completion.p;
	}

	/** Returns immutable observed attempt inputs. */
	snapshot(): readonly { readonly attempt: number; readonly delayMilliseconds: number }[] {
		return this.waits.flatMap(wait => wait.delay.kind === 'reconnectAttempt' ? [{
			attempt: wait.delay.attempt,
			delayMilliseconds: wait.delay.delayMilliseconds,
		}] : []);
	}

	/** Returns unsettled delays of one exact kind. */
	pendingCount(kind: RemoteTunnelScheduledDelay['kind']): number {
		return this.waits.filter(wait => wait.delay.kind === kind && !wait.completion.isSettled).length;
	}
}

/** Resolves the next matching event and releases its subscription. */
function nextEvent<T>(event: Event<T>, predicate: (value: T) => boolean): Promise<T> {
	return new Promise(resolve => {
		let didResolveSynchronously = false;
		let subscription: ReturnType<Event<T>> | undefined;
		subscription = event(value => {
			if (predicate(value)) {
				didResolveSynchronously = true;
				subscription?.dispose();
				resolve(value);
			}
		});
		if (didResolveSynchronously) {
			subscription.dispose();
		}
	});
}

/** Creates a deterministic mutation digest for a focused scenario. */
function digest(character: string) {
	return createRemoteTunnelValueDigest(`sha256:${character.repeat(64)}`);
}

/** Creates one exact tunnel mutation identity. */
async function tunnelMutation(
	operation: string,
	identity: IRemoteTunnelIdentity,
	displayName = 'Alpha Tunnel',
	visibility: 'private' | 'account' = 'private',
): Promise<IRemoteTunnelMutationIdentity> {
	return {
		kind: 'createTunnel',
		operation: createRemoteTunnelOperationId(operation),
		target: { kind: 'tunnel', identity },
		valueDigest: await computeRemoteTunnelMutationValueDigest({ kind: 'createTunnel', displayName, visibility }),
	};
}

/** Creates one exact endpoint hosting mutation identity. */
async function endpointMutation(
	kind: 'startHosting' | 'stopHosting',
	operation: string,
	identity: IRemoteTunnelEndpointIdentity,
	expectedRevision: IRemoteTunnelDescriptor['revision'],
	publication: IRemoteTunnelEndpointPublication = endpointPublication(identity),
): Promise<IRemoteTunnelMutationIdentity> {
	return {
		kind,
		operation: createRemoteTunnelOperationId(operation),
		target: { kind: 'endpoint', identity },
		expectedRevision,
		valueDigest: await computeRemoteTunnelMutationValueDigest(
			kind === 'startHosting' ? { kind, endpoint: publication } : { kind },
		),
	};
}

/** Creates one structured private Agent Host endpoint publication. */
function endpointPublication(identity: IRemoteTunnelEndpointIdentity): IRemoteTunnelEndpointPublication {
	return {
		identity,
		kind: AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		protocol: {
			minimum: createRemoteTunnelProtocolRevision(1),
			maximum: createRemoteTunnelProtocolRevision(2),
		},
		connectionScope: 'privateAuthenticated',
		capabilities: [MOCK_REMOTE_TUNNEL_FRAME_CAPABILITY],
	};
}

suite('Remote Tunnel architecture', { concurrency: false }, () => {
	/** Creates one fully composed Platform service over explicit external mocks. */
	function createFixture(context: TestContext, options: {
		readonly maximumRetainedHostOperations?: number;
		readonly maximumRetainedConnectionIdentities?: number;
		readonly maximumActiveClientConnections?: number;
		readonly maximumActiveHostConnections?: number;
		readonly maximumRetainedHostConnectionIdentities?: number;
		readonly maximumMockLogicalConnections?: number;
		readonly connectionGracePeriodMilliseconds?: number;
	} = {}) {
		const scheduler = new ManualTunnelScheduler();
		const connectionGracePeriodMilliseconds = options.connectionGracePeriodMilliseconds ?? 1_000;
		const mock = createMockRemoteTunnelProduct({
			provider: 'mockRelay',
			maximumFrameBytes: 1024,
			maximumRetainedOperations: 32,
			maximumCredentialReferences: 64,
			maximumLogicalConnections: options.maximumMockLogicalConnections ?? 16,
			scheduler,
			logicalConnectionGracePeriodMilliseconds: connectionGracePeriodMilliseconds,
		});
		context.after(() => mock.provider.dispose());
		const registry = new RemoteTunnelProductRegistry();
		context.after(() => registry.dispose());
		const registration = registry.register(mock.product);
		context.after(() => registration.dispose());
		const tunnelService = new RemoteTunnelService(registry, scheduler, {
			maximumFrameBytes: 1024,
			maximumActiveConnections: options.maximumActiveClientConnections ?? 16,
			maximumRetainedConnectionIdentities: options.maximumRetainedConnectionIdentities ?? 16,
		});
		context.after(() => tunnelService.dispose());
		const hostService = new RemoteTunnelHostService(registry, scheduler, {
			maximumRetainedOperations: options.maximumRetainedHostOperations ?? 16,
			maximumPendingConnections: 16,
			maximumActiveConnections: options.maximumActiveHostConnections ?? 16,
			maximumRetainedConnectionIdentities: options.maximumRetainedHostConnectionIdentities ?? 16,
			connectionGracePeriodMilliseconds,
		});
		context.after(() => hostService.dispose());
		const account = createRemoteTunnelAccountIdentity('mockRelay', 'account.alpha');
		mock.authentication.authorize(account);
		const tunnel = createRemoteTunnelIdentity('mockRelay', 'account.alpha', 'tunnel.alpha', 'cluster.west');
		const endpoint = createRemoteTunnelEndpointIdentity(
			'mockRelay',
			'account.alpha',
			'tunnel.alpha',
			'cluster.west',
			'agent-host',
		);
		return { ...mock, account, endpoint, hostService, registry, scheduler, tunnel, tunnelService };
	}

	/** Creates the exact tunnel record for a fixture. */
	async function createTunnel(
		fixture: ReturnType<typeof createFixture>,
		operation = 'create-alpha',
	): Promise<IRemoteTunnelDescriptor> {
		return fixture.tunnelService.createTunnel({
			identity: fixture.tunnel,
			displayName: 'Alpha Tunnel',
			visibility: 'private',
			mutation: await tunnelMutation(operation, fixture.tunnel),
		});
	}

	/** Publishes and starts the fixture's Agent Host endpoint. */
	async function startHosting(
		fixture: ReturnType<typeof createFixture>,
		descriptor: IRemoteTunnelDescriptor,
		operation = 'host-alpha',
	): Promise<IRemoteTunnelHostingLease> {
		return fixture.hostService.startHosting({
			endpoint: endpointPublication(fixture.endpoint),
			mutation: await endpointMutation('startHosting', operation, fixture.endpoint, descriptor.revision),
		});
	}

	test('keeps structured identities and rejects service endpoint scope downgrade', () => {
		assert.throws(
			() => createRemoteTunnelIdentity('Mock Relay', 'account', 'tunnel', 'cluster'),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.InvalidIdentity,
		);
		const identity = createRemoteTunnelEndpointIdentity('mockRelay', 'account', 'tunnel', 'cluster', 'agent-host');
		assert.throws(
			() => validateRemoteTunnelEndpointPublication(fixturePublicationWithScope(identity)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.InvalidDescriptor,
		);
	});

	test('canonicalizes mutation values and rejects changed payloads before authentication', async context => {
		const fixture = createFixture(context);
		assert.equal(
			await computeRemoteTunnelMutationValueDigest({
				kind: 'createTunnel',
				displayName: 'Alpha Tunnel',
				visibility: 'private',
			}),
			createRemoteTunnelValueDigest(
				'sha256:aceeb9c60de752b5c8cf3fe84b957b1abc9ec5e9cb4711aedeefc0cba16588a5',
			),
		);
		const extraCapability = createRemoteTunnelEndpointCapability('mock.extra.v1');
		const publication = endpointPublication(fixture.endpoint);
		const firstDigest = await computeRemoteTunnelMutationValueDigest({
			kind: 'startHosting',
			endpoint: {
				...publication,
				capabilities: [MOCK_REMOTE_TUNNEL_FRAME_CAPABILITY, extraCapability],
			},
		});
		const reorderedDigest = await computeRemoteTunnelMutationValueDigest({
			kind: 'startHosting',
			endpoint: {
				...publication,
				capabilities: [extraCapability, MOCK_REMOTE_TUNNEL_FRAME_CAPABILITY],
			},
		});
		assert.equal(firstDigest, reorderedDigest);

		await assert.rejects(
			fixture.tunnelService.createTunnel({
				identity: fixture.tunnel,
				displayName: 'Changed Tunnel',
				visibility: 'private',
				mutation: await tunnelMutation('create-changed-payload', fixture.tunnel),
			}),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationConflict,
		);
		assert.equal(fixture.authentication.getCredentialAcquisitionCount(), 0);
		assert.throws(
			() => fixture.provider.snapshot(fixture.tunnel),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.TunnelMissing,
		);

		const descriptor = await createTunnel(fixture, 'create-after-changed-payload');
		const acquisitionCount = fixture.authentication.getCredentialAcquisitionCount();
		await assert.rejects(
			fixture.hostService.startHosting({
				endpoint: {
					...publication,
					capabilities: [MOCK_REMOTE_TUNNEL_FRAME_CAPABILITY, extraCapability],
				},
				mutation: await endpointMutation(
					'startHosting',
					'host-changed-payload',
					fixture.endpoint,
					descriptor.revision,
				),
			}),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationConflict,
		);
		assert.equal(fixture.authentication.getCredentialAcquisitionCount(), acquisitionCount);
		assert.deepStrictEqual(fixture.provider.snapshot(fixture.tunnel).endpoints, []);
	});

	test('keeps enumeration and exact lookup separate without another route', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		assert.equal((await fixture.tunnelService.enumerate({ account: fixture.account })).length, 1);
		fixture.provider.failNextEnumeration(new RemoteTunnelError(
			RemoteTunnelErrorCode.RelayUnavailable,
			'Mock enumeration unavailable',
		));
		await assert.rejects(
			fixture.tunnelService.enumerate({ account: fixture.account }),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.RelayUnavailable,
		);
		assert.equal((await fixture.tunnelService.lookup(fixture.tunnel)).revision, descriptor.revision);
		await assert.rejects(
			fixture.tunnelService.lookup(createRemoteTunnelIdentity(
				'mockRelay',
				'account.alpha',
				'tunnel.alpha',
				'cluster.east',
			)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.ClusterMismatch,
		);
	});

	test('reconciles committed create, host, and stop mutations after acknowledgement loss', async context => {
		const fixture = createFixture(context);
		const createMutation = await tunnelMutation('create-lost-ack', fixture.tunnel);
		fixture.provider.loseAcknowledgement(createMutation.operation);
		const descriptor = await fixture.tunnelService.createTunnel({
			identity: fixture.tunnel,
			displayName: 'Alpha Tunnel',
			visibility: 'private',
			mutation: createMutation,
		});

		const hostMutation = await endpointMutation('startHosting', 'host-lost-ack', fixture.endpoint, descriptor.revision);
		fixture.provider.loseAcknowledgement(hostMutation.operation);
		const lease = await fixture.hostService.startHosting({
			endpoint: endpointPublication(fixture.endpoint),
			mutation: hostMutation,
		});
		assert.equal(lease.state, 'active');
		assert.equal(lease.endpoint.status, 'online');

		const stopMutation = await endpointMutation('stopHosting', 'stop-lost-ack', fixture.endpoint, lease.descriptor.revision);
		fixture.provider.loseAcknowledgement(stopMutation.operation);
		const stopped = await lease.stop({ mutation: stopMutation });
		assert.equal(stopped.endpoints[0].status, 'offline');
		assert.equal(lease.state, 'stopped');
	});

	test('replays only the exact hosting mutation identity retained by Platform', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const hostMutation = await endpointMutation('startHosting', 'host-exact-replay', fixture.endpoint, descriptor.revision);
		const request = {
			endpoint: endpointPublication(fixture.endpoint),
			mutation: hostMutation,
		};
		const lease = await fixture.hostService.startHosting(request);
		assert.equal(await fixture.hostService.startHosting(request), lease);
		await assert.rejects(
			fixture.hostService.startHosting({
				...request,
				mutation: {
					...hostMutation,
					expectedRevision: createRemoteTunnelRecordRevision('revision-conflict'),
				},
			}),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationConflict,
		);

		const stopMutation = await endpointMutation('stopHosting', 'stop-exact-replay', fixture.endpoint, lease.descriptor.revision);
		const stopped = await lease.stop({ mutation: stopMutation });
		assert.equal(await lease.stop({ mutation: stopMutation }), stopped);
		await assert.rejects(
			lease.stop({
				mutation: {
					...stopMutation,
					expectedRevision: createRemoteTunnelRecordRevision('revision-conflict'),
				},
			}),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationConflict,
		);
	});

	test('retries the exact committed Host attachment after getHosting fails', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const mutation = await endpointMutation('startHosting', 'host-get-retry', fixture.endpoint, descriptor.revision);
		const request = {
			endpoint: endpointPublication(fixture.endpoint),
			mutation,
		};
		fixture.provider.failNextGetHosting(new RemoteTunnelError(
			RemoteTunnelErrorCode.RelayUnavailable,
			'Mock committed Host attachment lookup failed',
		));
		await assert.rejects(
			fixture.hostService.startHosting(request),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.RelayUnavailable,
		);
		await assert.rejects(
			fixture.hostService.startHosting({
				...request,
				mutation: { ...mutation, valueDigest: digest('c') },
			}),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationConflict,
		);
		const lease = await fixture.hostService.startHosting(request);
		assert.equal(lease.lease, 'mock-lease-1');
		assert.equal(lease.state, 'active');
	});

	test('retains the exact stop mutation identity while its outcome remains unknown', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const mutation = await endpointMutation(
			'stopHosting',
			'stop-remains-unknown',
			fixture.endpoint,
			lease.descriptor.revision,
		);
		fixture.provider.retainUnknownOutcome(mutation);
		await assert.rejects(
			lease.stop({ mutation }),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationUnknown,
		);
		await assert.rejects(
			lease.stop({ mutation: { ...mutation, valueDigest: digest('e') } }),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationConflict,
		);
		assert.equal(lease.state, 'active');
	});

	test('hands an accepted stream to its owner even when it arrives before startHosting returns', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const connection = createRemoteTunnelClientConnectionId('client-before-host-return');
		fixture.provider.acceptConnectionBeforeStartReturns(connection);
		const lease = await startHosting(fixture, descriptor);
		const stream = await nextEvent(lease.onDidAcceptConnection, () => true);
		assert.equal(stream.identity.connection, connection);
		assert.equal(stream.generation, 1);
		await stream.close();
		stream.dispose();
		assert.deepStrictEqual(fixture.provider.getEarlyAcceptedConnectionCleanupCallCounts(), { close: 1, dispose: 2 });
	});

	test('closes and disposes pending accepted streams when a lease stops or disposes', async context => {
		const stoppingFixture = createFixture(context);
		const stoppingDescriptor = await createTunnel(stoppingFixture);
		stoppingFixture.provider.acceptConnectionBeforeStartReturns(
			createRemoteTunnelClientConnectionId('client-pending-stop'),
		);
		const stoppingLease = await startHosting(stoppingFixture, stoppingDescriptor);
		await stoppingLease.stop({
			mutation: await endpointMutation(
				'stopHosting',
				'stop-with-pending',
				stoppingFixture.endpoint,
				stoppingLease.descriptor.revision,
			),
		});
		assert.deepStrictEqual(
			stoppingFixture.provider.getEarlyAcceptedConnectionCleanupCallCounts(),
			{ close: 1, dispose: 1 },
		);

		const disposingFixture = createFixture(context);
		const disposingDescriptor = await createTunnel(disposingFixture);
		disposingFixture.provider.acceptConnectionBeforeStartReturns(
			createRemoteTunnelClientConnectionId('client-pending-dispose'),
		);
		const disposingLease = await startHosting(disposingFixture, disposingDescriptor);
		disposingLease.dispose();
		await Promise.resolve();
		assert.deepStrictEqual(
			disposingFixture.provider.getEarlyAcceptedConnectionCleanupCallCounts(),
			{ close: 1, dispose: 1 },
		);
	});

	test('releases terminal leases from service ownership without rewriting caller state', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		await lease.stop({
			mutation: await endpointMutation(
				'stopHosting',
				'stop-before-service-dispose',
				fixture.endpoint,
				lease.descriptor.revision,
			),
		});
		assert.equal(lease.state, 'stopped');
		fixture.hostService.dispose();
		assert.equal(lease.state, 'stopped');
	});

	test('surfaces a still-unknown outcome and preserves pre-commit state', async context => {
		const fixture = createFixture(context);
		const mutation = await tunnelMutation('create-remains-unknown', fixture.tunnel);
		fixture.provider.retainUnknownOutcome(mutation);
		await assert.rejects(
			fixture.tunnelService.createTunnel({
				identity: fixture.tunnel,
				displayName: 'Alpha Tunnel',
				visibility: 'private',
				mutation,
			}),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.OperationUnknown,
		);
		await assert.rejects(
			fixture.tunnelService.lookup(fixture.tunnel),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.TunnelMissing,
		);
	});

	test('rolls back endpoint publication when external host attachment fails', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		fixture.provider.failNextHostAttachment(new RemoteTunnelError(
			RemoteTunnelErrorCode.RelayUnavailable,
			'Mock host relay attachment failed',
		));
		await assert.rejects(
			startHosting(fixture, descriptor),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.RelayUnavailable,
		);
		assert.deepStrictEqual(fixture.provider.snapshot(fixture.tunnel), descriptor);
		const lease = await startHosting(fixture, descriptor, 'host-alpha-retry');
		assert.equal(lease.state, 'active');
		assert.equal(lease.endpoint.status, 'online');
	});

	test('carries bounded frames only through the exact compatible endpoint', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const incompatibleKind = createRemoteTunnelEndpointKind('remoteServer');
		await assert.rejects(
			fixture.tunnelService.connect(connectRequest(fixture.endpoint, 'client-wrong-kind', incompatibleKind)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.EndpointIncompatible,
		);
		assert.equal(fixture.provider.getRelayConnectCount(), 0);

		const accepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const connection = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-alpha',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		const serverStream = await accepted;
		const serverReceived = nextEvent(serverStream.onDidReceiveFrame, () => true);
		await connection.send(Uint8Array.from([1, 2, 3]));
		assert.deepStrictEqual(await serverReceived, Uint8Array.from([1, 2, 3]));
		const clientReceived = nextEvent(connection.onDidReceiveFrame, () => true);
		await serverStream.send(Uint8Array.from([4, 5]));
		assert.deepStrictEqual(await clientReceived, Uint8Array.from([4, 5]));
		await assert.rejects(
			connection.send(new Uint8Array(1025)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.FrameTooLarge,
		);
		await connection.close();
		assert.equal(connection.state, 'closed');
	});

	test('retains live delivered streams and disposes them after lost and terminal closes', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const lostAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const lostConnection = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-stream-lost',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		const lostStream = await lostAccepted;
		assert.ok(lostStream instanceof MockRemoteTunnelRelayStream);
		assert.deepStrictEqual(lostStream.getCleanupCallCounts(), { close: 0, dispose: 0 });
		fixture.provider.loseConnections(fixture.endpoint);
		assert.equal(lostConnection.state, 'reconnecting');
		assert.deepStrictEqual(lostStream.getCleanupCallCounts(), { close: 0, dispose: 1 });

		const terminalAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const terminalConnection = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-stream-terminal',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		const terminalStream = await terminalAccepted;
		assert.ok(terminalStream instanceof MockRemoteTunnelRelayStream);
		assert.deepStrictEqual(terminalStream.getCleanupCallCounts(), { close: 0, dispose: 0 });
		const terminalError = new RemoteTunnelError(
			RemoteTunnelErrorCode.ConnectionTerminal,
			'Mock endpoint protocol rejected the connection',
		);
		const closed = nextEvent(terminalConnection.onDidClose, event => event.state === 'failed');
		terminalStream.terminate({ kind: 'terminal', error: terminalError });
		assert.equal((await closed).error, terminalError);
		assert.deepStrictEqual(terminalStream.getCleanupCallCounts(), { close: 0, dispose: 1 });
	});

	test('reconnects the same route with contiguous generation and bounded backoff', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const initialAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const connection = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-reconnect',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			2,
		));
		assert.equal((await initialAccepted).generation, 1);
		const reconnectEventOrder: string[] = [];
		const generationSubscription = connection.onDidChangeGeneration(generation => {
			reconnectEventOrder.push(`generation:${generation}`);
		});
		const stateSubscription = connection.onDidChangeState(change => {
			if (change.state === 'connected') {
				reconnectEventOrder.push('state:connected');
			}
		});
		context.after(() => generationSubscription.dispose());
		context.after(() => stateSubscription.dispose());

		fixture.provider.failNextRelayConnect(new RemoteTunnelError(
			RemoteTunnelErrorCode.RelayUnavailable,
			'Mock relay reconnect failed',
		));
		const reconnected = nextEvent(connection.onDidChangeGeneration, generation => generation === 2);
		const nextAccepted = nextEvent(lease.onDidAcceptConnection, stream => stream.generation === 2);
		fixture.provider.loseConnections(fixture.endpoint);
		assert.equal(connection.state, 'reconnecting');
		await fixture.scheduler.waitForCount(1);
		fixture.scheduler.release(0);
		await fixture.scheduler.waitForCount(2);
		fixture.scheduler.release(1);
		assert.equal(await reconnected, 2);
		const serverStream = await nextAccepted;
		assert.equal(connection.generation, 2);
		assert.deepStrictEqual(fixture.scheduler.snapshot(), [
			{ attempt: 1, delayMilliseconds: 10 },
			{ attempt: 2, delayMilliseconds: 20 },
		]);
		assert.equal(fixture.scheduler.pendingCount('clientConnectionGraceExpiry'), 0);
		assert.equal(fixture.scheduler.pendingCount('hostConnectionGraceExpiry'), 0);
		assert.equal(fixture.scheduler.pendingCount('providerConnectionGraceExpiry'), 0);
		assert.deepStrictEqual(reconnectEventOrder, ['generation:2', 'state:connected']);
		assert.deepStrictEqual(serverStream.identity, connection.identity);
	});

	test('detaches and reconnects when send rejects without a provider close event', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const initialAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const connection = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-send-rejection',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await initialAccepted;
		const sendError = new RemoteTunnelError(RemoteTunnelErrorCode.RelayUnavailable, 'Mock send rejected');
		fixture.provider.failNextClientSend(fixture.endpoint, sendError);
		const reconnecting = nextEvent(connection.onDidChangeState, change => change.state === 'reconnecting');
		const reconnected = nextEvent(connection.onDidChangeGeneration, generation => generation === 2);
		const accepted = nextEvent(lease.onDidAcceptConnection, stream => stream.generation === 2);
		await assert.rejects(
			connection.send(Uint8Array.from([1])),
			(error: Error) => error === sendError,
		);
		await reconnecting;
		assert.equal(connection.state, 'reconnecting');
		await fixture.scheduler.waitForCount(1);
		fixture.scheduler.release(0);
		assert.equal(await reconnected, 2);
		assert.equal((await accepted).generation, 2);
		assert.equal(connection.state, 'connected');
	});

	test('pauses at its retry budget, resumes explicitly, and suppresses reconnect after close', async context => {
		const fixture = createFixture(context);
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const initialAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const connection = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-paused',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			1,
		));
		await initialAccepted;
		fixture.provider.failNextRelayConnect(new RemoteTunnelError(
			RemoteTunnelErrorCode.RelayUnavailable,
			'Mock relay reconnect failed',
		));
		const paused = nextEvent(connection.onDidChangeState, change => change.state === 'paused');
		fixture.provider.loseConnections(fixture.endpoint);
		await fixture.scheduler.waitForCount(1);
		fixture.scheduler.release(0);
		await paused;
		assert.equal(connection.state, 'paused');
		assert.equal(connection.generation, 1);

		const resumed = connection.resume();
		await fixture.scheduler.waitForCount(2);
		fixture.scheduler.release(1);
		await resumed;
		assert.equal(connection.state, 'connected');
		assert.equal(connection.generation, 2);
		await connection.close();
		const waitCount = fixture.scheduler.snapshot().length;
		fixture.provider.loseConnections(fixture.endpoint);
		assert.equal(fixture.scheduler.snapshot().length, waitCount);
	});

	test('reserves active client capacity before concurrent provider connection work', async context => {
		const fixture = createFixture(context, { maximumActiveClientConnections: 1 });
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const pause = fixture.provider.pauseNextRelayConnect();
		const firstConnection = fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-concurrent-one',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await pause.entered;
		const acquisitionCount = fixture.authentication.getCredentialAcquisitionCount();
		await assert.rejects(
			fixture.tunnelService.connect(connectRequest(
				fixture.endpoint,
				'client-concurrent-two',
				AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.ResourceLimit,
		);
		assert.equal(fixture.authentication.getCredentialAcquisitionCount(), acquisitionCount);
		assert.equal(fixture.provider.getRelayConnectCount(), 1);
		const accepted = nextEvent(lease.onDidAcceptConnection, () => true);
		pause.release();
		const connection = await firstConnection;
		await accepted;
		await connection.close();

		fixture.provider.failNextRelayConnect(new RemoteTunnelError(
			RemoteTunnelErrorCode.RelayUnavailable,
			'Mock initial relay connection failed',
		));
		await assert.rejects(
			fixture.tunnelService.connect(connectRequest(
				fixture.endpoint,
				'client-concurrent-failed',
				AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.RelayUnavailable,
		);
		const nextAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const next = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-concurrent-after-failure',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await nextAccepted;
		assert.equal(next.state, 'connected');
	});

	test('enforces Host active capacity independently from client and identity retention limits', async context => {
		const fixture = createFixture(context, {
			maximumActiveClientConnections: 2,
			maximumActiveHostConnections: 1,
			maximumMockLogicalConnections: 2,
		});
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const firstAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const first = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-host-cap-one',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await firstAccepted;
		await assert.rejects(
			fixture.tunnelService.connect(connectRequest(
				fixture.endpoint,
				'client-host-cap-two',
				AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.ConnectionTerminal,
		);
		assert.equal(first.state, 'connected');

		await first.close();
		const nextAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const next = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-host-cap-two',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await nextAccepted;
		assert.equal(next.state, 'connected');
	});

	test('expires lost client, Host, and provider ownership through deterministic grace deadlines', async context => {
		const fixture = createFixture(context, {
			maximumActiveClientConnections: 1,
			maximumActiveHostConnections: 1,
			maximumMockLogicalConnections: 1,
			connectionGracePeriodMilliseconds: 1_000,
		});
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const initialAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const connection = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-grace-expiry',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await initialAccepted;
		const terminal = nextEvent(connection.onDidClose, event => event.state === 'failed');
		fixture.provider.loseConnections(fixture.endpoint);
		await Promise.all([
			fixture.scheduler.waitForCount(1, 'clientConnectionGraceExpiry'),
			fixture.scheduler.waitForCount(1, 'hostConnectionGraceExpiry'),
			fixture.scheduler.waitForCount(1, 'providerConnectionGraceExpiry'),
		]);
		assert.equal(connection.state, 'reconnecting');
		await assert.rejects(
			fixture.tunnelService.connect(connectRequest(
				fixture.endpoint,
				'client-after-grace',
				AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.ResourceLimit,
		);

		await fixture.scheduler.release(0, 'clientConnectionGraceExpiry');
		const closed = await terminal;
		assert.equal(closed.error?.code, RemoteTunnelErrorCode.ReconnectGraceExpired);
		await assert.rejects(
			fixture.tunnelService.connect(connectRequest(
				fixture.endpoint,
				'client-after-grace',
				AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.ResourceLimit,
		);

		await fixture.scheduler.release(0, 'providerConnectionGraceExpiry');
		await assert.rejects(
			fixture.tunnelService.connect(connectRequest(
				fixture.endpoint,
				'client-after-grace',
				AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			)),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.ConnectionTerminal,
		);

		await fixture.scheduler.release(0, 'hostConnectionGraceExpiry');
		const nextAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const next = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-after-grace',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await nextAccepted;
		assert.equal(next.state, 'connected');
	});

	test('bounds Host operations and retired identities independently from active connections', async context => {
		const fixture = createFixture(context, {
			maximumRetainedHostOperations: 1,
			maximumRetainedConnectionIdentities: 1,
			maximumRetainedHostConnectionIdentities: 1,
		});
		const descriptor = await createTunnel(fixture);
		const lease = await startHosting(fixture, descriptor);
		const firstAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const first = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-capacity-one',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await firstAccepted;
		const secondAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const second = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-capacity-two',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await secondAccepted;
		assert.equal(second.state, 'connected');
		await first.close();
		await second.close();
		const reusedAccepted = nextEvent(lease.onDidAcceptConnection, () => true);
		const reused = await fixture.tunnelService.connect(connectRequest(
			fixture.endpoint,
			'client-capacity-one',
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		));
		await reusedAccepted;
		assert.equal(reused.state, 'connected');

		const otherTunnel = createRemoteTunnelIdentity('mockRelay', 'account.alpha', 'tunnel.beta', 'cluster.west');
		const otherEndpoint = createRemoteTunnelEndpointIdentity(
			'mockRelay',
			'account.alpha',
			'tunnel.beta',
			'cluster.west',
			'agent-host',
		);
		const otherDescriptor = await fixture.tunnelService.createTunnel({
			identity: otherTunnel,
			displayName: 'Beta Tunnel',
			visibility: 'private',
			mutation: await tunnelMutation('create-beta', otherTunnel, 'Beta Tunnel'),
		});
		await assert.rejects(
			fixture.hostService.startHosting({
				endpoint: endpointPublication(otherEndpoint),
				mutation: await endpointMutation('startHosting', 'host-beta', otherEndpoint, otherDescriptor.revision),
			}),
			(error: Error) => error instanceof RemoteTunnelError && error.code === RemoteTunnelErrorCode.ResourceLimit,
		);
		assert.deepStrictEqual(fixture.provider.snapshot(otherTunnel).endpoints, []);
	});

	/** Constructs a connect request with a deterministic bounded retry policy. */
	function connectRequest(
		endpoint: IRemoteTunnelEndpointIdentity,
		connection: string,
		kind: ReturnType<typeof createRemoteTunnelEndpointKind>,
		maximumAttempts = 2,
	) {
		return {
			endpoint,
			kind,
			protocol: {
				minimum: createRemoteTunnelProtocolRevision(1),
				maximum: createRemoteTunnelProtocolRevision(2),
			},
			connection: createRemoteTunnelClientConnectionId(connection),
			reconnect: {
				maximumAttempts,
				initialDelayMilliseconds: 10,
				maximumDelayMilliseconds: 20,
				gracePeriodMilliseconds: 1_000,
			},
		};
	}

	/** Invokes common validation for a forbidden product endpoint scope. */
	function fixturePublicationWithScope(identity: IRemoteTunnelEndpointIdentity): IRemoteTunnelEndpointPublication {
		const publication = endpointPublication(identity);
		return {
			...publication,
			connectionScope: 'accountAuthenticated',
		};
	}
});
