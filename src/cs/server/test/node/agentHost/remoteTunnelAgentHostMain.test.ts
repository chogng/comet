/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { Event, Emitter } from 'cs/base/common/event';
import { Disposable, toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import { constObservable } from 'cs/base/common/observable';
import type { IAgent } from 'cs/platform/agentHost/common/agent';
import {
	AgentConfigurationSchemaProfile,
	type IAgentConfigurationSchema,
} from 'cs/platform/agentHost/common/configuration';
import {
	createAgentCapabilityRevision,
	createAgentCancellationId,
	createAgentChatId,
	createAgentConfigurationSchemaRevision,
	createAgentDescriptorRevision,
	createAgentHostAuthorityId,
	createAgentHostClientConnectionId,
	createAgentHostProtocolVersion,
	createAgentId,
	createAgentPackageId,
	createAgentResumeSchemaId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { IAgentPackageLifecycleSnapshot } from 'cs/platform/agentHost/common/packages';
import {
	createRemoteAgentHostEndpointCredential,
	type IRemoteAgentHostTunnelScheduler,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import type { IAgentHostAuthorityOptions } from 'cs/platform/agentHost/node/host/agentHostAuthority';
import type {
	IAgentHostCatalogStore,
	IAgentHostPersistedCatalog,
} from 'cs/platform/agentHost/node/host/agentHostCatalog';
import type {
	AgentPackageLifecycle,
	IAgentPackageHostBackingStateRequest,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	assertRemoteTunnelMutationValueDigest,
	computeRemoteTunnelMutationValueDigest,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelHostingLeaseId,
	createRemoteTunnelOperationId,
	createRemoteTunnelProtocolRevision,
	createRemoteTunnelRecordRevision,
	type IRemoteTunnelDescriptor,
	type IRemoteTunnelConnectionIdentity,
	type IRemoteTunnelEndpointDescriptor,
	type IRemoteTunnelEndpointStream,
	type IRemoteTunnelHostingLease,
	type IRemoteTunnelHostingStateChange,
	type IRemoteTunnelHostService,
	type IRemoteTunnelStartHostingRequest,
	type IRemoteTunnelStopHostingRequest,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteTunnelError, RemoteTunnelErrorCode } from 'cs/platform/tunnel/common/remoteTunnelErrors';
import {
	RemoteTunnelAgentHostMain,
	type IRemoteTunnelAgentHostMainOptions,
	type RemoteTunnelAgentHostContentResources,
} from 'cs/server/node/agentHost/remoteTunnelAgentHostMain';

const packageId = createAgentPackageId('comet');
const agentId = createAgentId('comet');
const hostAuthority = createAgentHostAuthorityId('remote-tunnel-test');
const hostProtocol = createAgentHostProtocolVersion('3');
const descriptorRevision = createAgentDescriptorRevision('remote-tunnel-test.descriptor.v1');
const capabilityRevision = createAgentCapabilityRevision('remote-tunnel-test.capabilities.v1');
const runtimeRevision = createAgentRuntimeRegistrationRevision('remote-tunnel-test.runtime.v1');
const hostDefaultsRevision = createAgentConfigurationSchemaRevision('remote-tunnel-test.host-defaults.v1');
const sessionConfigurationRevision = createAgentConfigurationSchemaRevision('remote-tunnel-test.session.v1');
const endpointCredentialText = 'remote-tunnel-product-secret';

const hostDefaultsSchema: IAgentConfigurationSchema = Object.freeze({
	profile: AgentConfigurationSchemaProfile,
	agent: agentId,
	scope: 'hostDefault',
	revision: hostDefaultsRevision,
	properties: Object.freeze([]),
});

const registration: IAgent['registration'] = Object.freeze({
	packageId,
	agentId,
	revision: runtimeRevision,
	descriptorRevision,
	capabilityRevision,
	hostDefaultsSchema,
	initialSessionConfigurationSchema: sessionConfigurationRevision,
	supportedSessionConfigurationSchemas: Object.freeze([sessionConfigurationRevision]),
	supportedToolSchemaProfiles: Object.freeze([]),
	supportedResumeSchemas: Object.freeze([createAgentResumeSchemaId('remote-tunnel-test.resume.v1')]),
	resumeMigrationEdges: Object.freeze([]),
});

const descriptor: IAgent['descriptor']['get'] extends () => infer T ? T : never = Object.freeze({
	id: agentId,
	packageId,
	revision: descriptorRevision,
	displayName: 'Remote Tunnel test Agent',
	description: 'Remote Tunnel product composition test Agent',
	capabilities: Object.freeze({
		revision: capabilityRevision,
		supportsEmptySession: false,
		supportsCreateChat: false,
		maximumChatCount: 0,
		supportsForkChat: false,
		supportsQueue: false,
		supportsSteering: false,
		supportsCancellation: false,
		supportsReleaseSession: false,
		supportsReleaseChat: false,
		supportsDeleteSession: false,
		supportsDeleteChat: false,
	}),
	models: Object.freeze([]),
	requiresAgentAuthentication: false,
});

function unusedOperation(): never {
	throw new Error('Agent operation is outside this product composition test');
}

const agent: IAgent = {
	id: agentId,
	descriptor: constObservable(descriptor),
	registration,
	onDidEmitAction: Event.None,
	configuration: {
		resolveSession: async () => unusedOperation(),
		completeSession: async () => unusedOperation(),
		prepareSessionUpdate: async () => unusedOperation(),
		commitSessionUpdate: async () => unusedOperation(),
		rollbackSessionUpdate: async () => unusedOperation(),
		acknowledgeSessionUpdate: async () => unusedOperation(),
	},
	executionProfiles: { resolve: async () => unusedOperation() },
	sessions: {
		create: async () => unusedOperation(),
		materialize: async () => unusedOperation(),
		release: async () => unusedOperation(),
		delete: async () => unusedOperation(),
	},
	chats: {
		create: async () => unusedOperation(),
		materialize: async () => unusedOperation(),
		release: async () => unusedOperation(),
		fork: async () => unusedOperation(),
		send: async () => unusedOperation(),
		steer: async () => unusedOperation(),
		cancel: async () => unusedOperation(),
		delete: async () => unusedOperation(),
	},
	interactions: { respond: async () => unusedOperation() },
	resumeStates: { migrate: async request => request.source },
};

class MemoryCatalogStore implements IAgentHostCatalogStore {
	private value: IAgentHostPersistedCatalog | undefined;
	readCount = 0;

	constructor(private readonly order: string[]) {}

	read(): Promise<IAgentHostPersistedCatalog | undefined> {
		this.readCount += 1;
		return Promise.resolve(this.value);
	}

	commit(expectedRevision: number | undefined, value: IAgentHostPersistedCatalog): Promise<void> {
		assert.equal(expectedRevision, this.value?.revision);
		this.value = value;
		this.order.push('hostCommit');
		return Promise.resolve();
	}
}

function createPackageLifecycle(order: string[]): AgentPackageLifecycle {
	let revision = 0;
	let bound = false;
	const snapshot = (): IAgentPackageLifecycleSnapshot => Object.freeze({
		revision,
		catalogRevision: 0,
		operations: Object.freeze([]),
		installedPackages: Object.freeze([]),
		activeRegistrations: Object.freeze([registration]),
		retainedBackingRecords: Object.freeze([]),
		materializedBackings: Object.freeze([]),
		installablePackages: Object.freeze([]),
	});
	return {
		bindLifecyclePort: () => {
			assert.equal(bound, false);
			bound = true;
		},
		snapshot,
		reconcileHostBackingState: async () => undefined,
		completeRestoredBundledUpdate: async () => undefined,
		beginHostBackingStateCommit: async (request: IAgentPackageHostBackingStateRequest) => {
			assert.equal(request.expectedStateRevision, revision);
			revision += 1;
			order.push('hostClose');
			let settled = false;
			return {
				complete: () => {
					assert.equal(settled, false);
					settled = true;
				},
				rollback: async () => {
					assert.equal(settled, false);
					settled = true;
				},
			};
		},
	} as unknown as AgentPackageLifecycle;
}

class TestContentResources implements RemoteTunnelAgentHostContentResources {
	open: RemoteTunnelAgentHostContentResources['open'] = async () => unusedOperation();
	release: RemoteTunnelAgentHostContentResources['release'] = async () => undefined;

	bindClientReader(): IDisposable {
		return toDisposable(() => {});
	}
}

class TestHostingLease extends Disposable implements IRemoteTunnelHostingLease {
	private readonly stateEmitter = this._register(new Emitter<IRemoteTunnelHostingStateChange>());
	private currentState: IRemoteTunnelHostingLease['state'] = 'active';
	private currentDescriptor: IRemoteTunnelDescriptor;
	private currentEndpoint: IRemoteTunnelEndpointDescriptor;
	private disposed = false;
	stopCount = 0;
	stopError: Error | undefined;
	lastStopRequest: IRemoteTunnelStopHostingRequest | undefined;

	readonly lease = createRemoteTunnelHostingLeaseId('remote-tunnel-product-lease');
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidAcceptConnection: Event<IRemoteTunnelEndpointStream> = Event.None;

	constructor(
		descriptor: IRemoteTunnelDescriptor,
		endpoint: IRemoteTunnelEndpointDescriptor,
		private readonly order: string[],
	) {
		super();
		this.currentDescriptor = descriptor;
		this.currentEndpoint = endpoint;
	}

	get descriptor(): IRemoteTunnelDescriptor { return this.currentDescriptor; }
	get endpoint(): IRemoteTunnelEndpointDescriptor { return this.currentEndpoint; }
	get state(): IRemoteTunnelHostingLease['state'] { return this.currentState; }

	async stop(request: IRemoteTunnelStopHostingRequest): Promise<IRemoteTunnelDescriptor> {
		this.stopCount += 1;
		this.lastStopRequest = request;
		this.order.push('leaseStop');
		await assertRemoteTunnelMutationValueDigest(request.mutation, Object.freeze({ kind: 'stopHosting' }));
		assert.equal(request.mutation.expectedRevision, this.currentDescriptor.revision);
		if (this.stopError !== undefined) {
			throw this.stopError;
		}
		this.currentState = 'stopping';
		this.stateEmitter.fire(Object.freeze({ state: 'stopping', descriptor: this.currentDescriptor }));
		this.currentEndpoint = Object.freeze({
			...this.currentEndpoint,
			status: 'offline',
			hostConnectionCount: 0,
		});
		this.currentDescriptor = Object.freeze({
			...this.currentDescriptor,
			endpoints: Object.freeze([this.currentEndpoint]),
		});
		this.currentState = 'stopped';
		this.stateEmitter.fire(Object.freeze({ state: 'stopped', descriptor: this.currentDescriptor }));
		return this.currentDescriptor;
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.order.push('leaseDispose');
		this.currentState = 'disposed';
		super.dispose();
	}
}

class TestHostService extends Disposable implements IRemoteTunnelHostService {
	startCount = 0;
	disposeCount = 0;
	startError: Error | undefined;
	disposeError: Error | undefined;
	lease: TestHostingLease | undefined;

	constructor(
		private readonly descriptor: IRemoteTunnelDescriptor,
		private readonly endpoint: IRemoteTunnelEndpointDescriptor,
		private readonly order: string[],
	) {
		super();
	}

	async startHosting(_request: IRemoteTunnelStartHostingRequest): Promise<IRemoteTunnelHostingLease> {
		this.startCount += 1;
		this.order.push('leaseStart');
		if (this.startError !== undefined) {
			throw this.startError;
		}
		this.lease = new TestHostingLease(this.descriptor, this.endpoint, this.order);
		return this.lease;
	}

	override dispose(): void {
		if (this.disposeCount > 0) {
			return;
		}
		this.disposeCount += 1;
		this.order.push('hostServiceDispose');
		this.lease?.dispose();
		super.dispose();
		if (this.disposeError !== undefined) {
			throw this.disposeError;
		}
	}
}

interface IFixture {
	readonly options: IRemoteTunnelAgentHostMainOptions;
	readonly order: string[];
	readonly catalogStore: MemoryCatalogStore;
	readonly hostService: TestHostService;
}

function createHostOptions(
	order: string[],
	catalogStore: MemoryCatalogStore,
): Omit<IAgentHostAuthorityOptions, 'contentResources'> {
	let sessions = 0;
	let chats = 0;
	let turns = 0;
	let cancellations = 0;
	return {
		authority: hostAuthority,
		label: Object.freeze({ kind: 'literal', value: 'Remote Tunnel test Host' }),
		supportedProtocolVersions: Object.freeze([hostProtocol]),
		capabilities: Object.freeze([]),
		implementation: Object.freeze({ name: 'remote-tunnel-product-test', build: '1' }),
		sessionTypeCatalog: { resolve: () => Object.freeze([]) },
		agentRuntimes: {
			resolve: requested => {
				assert.deepStrictEqual(requested, registration);
				return agent;
			},
			resolvePreparedActivation: (_operation, requested) => {
				assert.deepStrictEqual(requested, registration);
				return agent;
			},
		},
		packageLifecycle: createPackageLifecycle(order),
		catalogStore,
		identityFactory: {
			createSession: () => createAgentSessionId(`session-${++sessions}`),
			createChat: () => createAgentChatId(`chat-${++chats}`),
			createTurn: () => createAgentTurnId(`turn-${++turns}`),
			createCancellation: () => createAgentCancellationId(`cancellation-${++cancellations}`),
		},
		submissionPolicy: { resolve: () => unusedOperation() },
		toolSets: { prepare: async () => unusedOperation() },
		toolCallAuthority: { bindTurn: () => unusedOperation() },
		now: () => 1_000,
		reportUnexpectedError: error => assert.fail(`Unexpected Host error: ${String(error)}`),
		maximumReplayActions: 16,
	};
}

async function createFixture(): Promise<IFixture> {
	const order: string[] = [];
	const endpointIdentity = createRemoteTunnelEndpointIdentity(
		'mockTunnel',
		'account',
		'remote-tunnel-product',
		'cluster',
		'agent-host',
	);
	const protocol = createRemoteTunnelProtocolRevision(remoteAgentHostTunnelProtocolRevision);
	const endpointPublication = Object.freeze({
		identity: endpointIdentity,
		kind: AGENT_HOST_TUNNEL_ENDPOINT_KIND,
		protocol: Object.freeze({ minimum: protocol, maximum: protocol }),
		connectionScope: 'privateAuthenticated' as const,
		capabilities: Object.freeze([]),
	});
	const initialRevision = createRemoteTunnelRecordRevision('revision-before-hosting');
	const hostedRevision = createRemoteTunnelRecordRevision('revision-after-hosting');
	const endpoint: IRemoteTunnelEndpointDescriptor = Object.freeze({
		...endpointPublication,
		status: 'online',
		hostConnectionCount: 1,
	});
	const descriptor: IRemoteTunnelDescriptor = Object.freeze({
		identity: Object.freeze({
			provider: endpointIdentity.provider,
			account: endpointIdentity.account,
			tunnel: endpointIdentity.tunnel,
			cluster: endpointIdentity.cluster,
		}),
		displayName: 'Remote Tunnel product test',
		visibility: 'private',
		revision: hostedRevision,
		endpoints: Object.freeze([endpoint]),
	});
	const startHosting = Object.freeze({
		endpoint: endpointPublication,
		mutation: Object.freeze({
			kind: 'startHosting' as const,
			operation: createRemoteTunnelOperationId('remote-tunnel-product-start'),
			target: Object.freeze({ kind: 'endpoint' as const, identity: endpointIdentity }),
			expectedRevision: initialRevision,
			valueDigest: await computeRemoteTunnelMutationValueDigest(Object.freeze({
				kind: 'startHosting',
				endpoint: endpointPublication,
			})),
		}),
	});
	const catalogStore = new MemoryCatalogStore(order);
	const hostService = new TestHostService(descriptor, endpoint, order);
	const scheduler: IRemoteAgentHostTunnelScheduler = Object.freeze({
		wait: () => Promise.reject(new Error('No tunnel delay is expected')),
	});
	return {
		order,
		catalogStore,
		hostService,
		options: Object.freeze({
			host: createHostOptions(order, catalogStore),
			contentResources: new TestContentResources(),
			toolRegistry: new AgentToolRegistry(),
			toolEndpoints: new AgentToolEndpointRegistry(),
			hostService,
			startHosting,
			stopHostingOperation: createRemoteTunnelOperationId('remote-tunnel-product-stop'),
			endpointCredential: createRemoteAgentHostEndpointCredential(endpointCredentialText),
			connectionIdentity: Object.freeze({
				create: (identity: IRemoteTunnelConnectionIdentity) => createAgentHostClientConnectionId(`tunnel:${identity.connection}`),
			}),
			scheduler,
			authenticationTimeoutMilliseconds: 10_000,
			logicalConnectionGracePeriodMilliseconds: 60_000,
			maximumLogicalConnections: 16,
			maximumRetainedLogicalConnectionIdentities: 32,
		}),
	};
}

function assertBefore(order: readonly string[], first: string, second: string): void {
	const firstIndex = order.indexOf(first);
	const secondIndex = order.indexOf(second);
	assert.notEqual(firstIndex, -1, `Missing order marker: ${first}`);
	assert.notEqual(secondIndex, -1, `Missing order marker: ${second}`);
	assert.ok(firstIndex < secondIndex, `${first} must precede ${second}: ${order.join(', ')}`);
}

suite('RemoteTunnelAgentHostMain', () => {
	test('starts one exact private endpoint only after the Host is live and stops it before Host close', async () => {
		const fixture = await createFixture();
		const main = await RemoteTunnelAgentHostMain.create(fixture.options);
		assert.equal(main.state, 'running');
		assert.equal(fixture.hostService.startCount, 1);
		assert.equal(JSON.stringify(main).includes(endpointCredentialText), false);
		assertBefore(fixture.order, 'hostCommit', 'leaseStart');

		const firstShutdown = main.shutdown();
		assert.equal(main.shutdown(), firstShutdown);
		await firstShutdown;

		assert.equal(main.state, 'stopped');
		assert.equal(fixture.hostService.lease?.stopCount, 1);
		assert.equal(fixture.hostService.disposeCount, 1);
		assert.equal(fixture.hostService.lease?.lastStopRequest?.mutation.operation, fixture.options.stopHostingOperation);
		assertBefore(fixture.order, 'leaseStop', 'leaseDispose');
		assertBefore(fixture.order, 'leaseDispose', 'hostServiceDispose');
		assertBefore(fixture.order, 'hostServiceDispose', 'hostClose');
	});

	test('rejects invalid product endpoint and capacity before Host or Tunnel side effects', async () => {
		const incompatible = await createFixture();
		const revisionTwo = createRemoteTunnelProtocolRevision(2);
		const invalidEndpoint = Object.freeze({
			...incompatible.options.startHosting.endpoint,
			protocol: Object.freeze({
				minimum: revisionTwo,
				maximum: incompatible.options.startHosting.endpoint.protocol.maximum,
			}),
		});
		await assert.rejects(RemoteTunnelAgentHostMain.create(Object.freeze({
			...incompatible.options,
			startHosting: Object.freeze({
				...incompatible.options.startHosting,
				endpoint: invalidEndpoint,
			}),
		})), (error: RemoteTunnelError) => error.code === RemoteTunnelErrorCode.InvalidDescriptor);
		assert.equal(incompatible.catalogStore.readCount, 0);
		assert.equal(incompatible.hostService.startCount, 0);
		incompatible.hostService.dispose();

		const invalidCapacity = await createFixture();
		await assert.rejects(RemoteTunnelAgentHostMain.create(Object.freeze({
			...invalidCapacity.options,
			maximumLogicalConnections: 0,
		})), (error: RemoteTunnelError) => error.code === RemoteTunnelErrorCode.InvalidDescriptor);
		assert.equal(invalidCapacity.catalogStore.readCount, 0);
		assert.equal(invalidCapacity.hostService.startCount, 0);
		invalidCapacity.hostService.dispose();
	});

	test('closes the live Host when tunnel publication fails after Host startup', async () => {
		const fixture = await createFixture();
		const startError = new Error('Tunnel publication failed');
		fixture.hostService.startError = startError;

		await assert.rejects(
			RemoteTunnelAgentHostMain.create(fixture.options),
			(error: Error) => error === startError,
		);

		assert.equal(fixture.hostService.startCount, 1);
		assert.equal(fixture.hostService.disposeCount, 1);
		assertBefore(fixture.order, 'hostCommit', 'leaseStart');
		assertBefore(fixture.order, 'hostServiceDispose', 'hostClose');
	});

	test('retains an unknown stop operation for exact retry before tearing down the Host', async () => {
		const fixture = await createFixture();
		const main = await RemoteTunnelAgentHostMain.create(fixture.options);
		const lease = fixture.hostService.lease!;
		lease.stopError = new RemoteTunnelError(RemoteTunnelErrorCode.OperationUnknown, 'Stop outcome is unknown');

		await assert.rejects(
			main.shutdown(),
			(error: RemoteTunnelError) => error.code === RemoteTunnelErrorCode.OperationUnknown,
		);
		assert.equal(main.state, 'running');
		assert.equal(lease.stopCount, 1);
		assert.equal(fixture.hostService.disposeCount, 0);
		assert.equal(fixture.order.includes('hostClose'), false);
		const retainedRequest = lease.lastStopRequest;

		lease.stopError = undefined;
		await main.shutdown();
		assert.equal(main.state, 'stopped');
		assert.equal(lease.stopCount, 2);
		assert.equal(lease.lastStopRequest, retainedRequest);
		assertBefore(fixture.order, 'leaseDispose', 'hostClose');
	});

	test('retains the live composition after a determined stop rejection', async () => {
		const fixture = await createFixture();
		const main = await RemoteTunnelAgentHostMain.create(fixture.options);
		const stopError = new RemoteTunnelError(RemoteTunnelErrorCode.AuthenticationDenied, 'Stop was denied');
		const lease = fixture.hostService.lease!;
		lease.stopError = stopError;

		await assert.rejects(main.shutdown(), (error: Error) => error === stopError);
		assert.equal(main.state, 'running');
		assert.equal(lease.state, 'active');
		assert.equal(fixture.hostService.disposeCount, 0);
		assert.equal(fixture.order.includes('hostClose'), false);
		const retainedRequest = lease.lastStopRequest;

		lease.stopError = undefined;
		await main.shutdown();
		assert.equal(main.state, 'stopped');
		assert.equal(lease.stopCount, 2);
		assert.equal(lease.lastStopRequest, retainedRequest);
		assertBefore(fixture.order, 'leaseStop', 'leaseDispose');
		assertBefore(fixture.order, 'hostServiceDispose', 'hostClose');
	});
});
