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
import type { IAgentHostCatalogStore, IAgentHostPersistedCatalog } from 'cs/platform/agentHost/node/host/agentHostCatalog';
import type { IAgentHostAuthorityOptions } from 'cs/platform/agentHost/node/host/agentHostAuthority';
import type {
	AgentPackageLifecycle,
	IAgentPackageHostBackingStateRequest,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import {
	createRemoteAuthority,
	createRemoteClientId,
	createRemoteConnectionGeneration,
	createRemoteProtocolVersion,
	createRemoteServerInstanceId,
	type IRemoteAuthority,
	type RemoteConnectionGeneration,
	type RemoteServerInstanceId,
} from 'cs/platform/remote/common/remoteAuthority';
import type {
	IRemoteConnectionStateChange,
	IRemoteServerConnection,
	IRemoteServerManagementListener,
	RemoteConnectionState,
} from 'cs/platform/remote/common/remoteConnection';
import type { IRemoteChannel, IRemoteChannelServer } from 'cs/platform/remote/common/remoteChannels';
import type { IRemoteEnvironment } from 'cs/platform/remote/common/remoteEnvironment';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import {
	remoteServerAgentHostCapability,
	remoteServerAgentHostChannelName,
} from 'cs/platform/agentHost/common/remoteProtocol';
import {
	RemoteAgentHostMain,
	type IRemoteServerAgentHostConnectionIdentity,
	type RemoteAgentHostContentResources,
} from 'cs/server/node/agentHost/remoteAgentHostMain';

const packageId = createAgentPackageId('comet');
const agentId = createAgentId('comet');
const hostAuthority = createAgentHostAuthorityId('remote-test');
const hostProtocol = createAgentHostProtocolVersion('3');
const descriptorRevision = createAgentDescriptorRevision('remote-test.descriptor.v1');
const capabilityRevision = createAgentCapabilityRevision('remote-test.capabilities.v1');
const runtimeRevision = createAgentRuntimeRegistrationRevision('remote-test.runtime.v1');
const hostDefaultsRevision = createAgentConfigurationSchemaRevision('remote-test.host-defaults.v1');
const sessionConfigurationRevision = createAgentConfigurationSchemaRevision('remote-test.session.v1');

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
	supportedResumeSchemas: Object.freeze([createAgentResumeSchemaId('remote-test.resume.v1')]),
	resumeMigrationEdges: Object.freeze([]),
});

const descriptor: IAgent['descriptor']['get'] extends () => infer T ? T : never = Object.freeze({
	id: agentId,
	packageId,
	revision: descriptorRevision,
	displayName: 'Remote test Agent',
	description: 'Remote Server composition test Agent',
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
	throw new Error('Agent operation is outside this composition test');
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
	commitCount = 0;

	read(): Promise<IAgentHostPersistedCatalog | undefined> {
		this.readCount += 1;
		return Promise.resolve(this.value);
	}

	commit(expectedRevision: number | undefined, value: IAgentHostPersistedCatalog): Promise<void> {
		this.commitCount += 1;
		assert.equal(expectedRevision, this.value?.revision);
		this.value = value;
		return Promise.resolve();
	}
}

function createPackageLifecycle(): AgentPackageLifecycle {
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

class TestContentResources implements RemoteAgentHostContentResources {
	readonly bindings = new Map<string, number>();
	bindCount = 0;
	releaseCount = 0;

	open: RemoteAgentHostContentResources['open'] = async () => unusedOperation();
	release: RemoteAgentHostContentResources['release'] = async () => undefined;

	bindClientReader(connection: ReturnType<typeof createAgentHostClientConnectionId>): IDisposable {
		assert.equal(this.bindings.has(connection), false);
		this.bindCount += 1;
		this.bindings.set(connection, 1);
		return toDisposable(() => {
			assert.equal(this.bindings.delete(connection), true);
			this.releaseCount += 1;
		});
	}
}

class TestManagementListener extends Disposable implements IRemoteServerManagementListener {
	activeAcceptanceSubscriptions = 0;
	private readonly acceptedEmitter = this._register(new Emitter<IRemoteServerConnection>({
		onWillAddFirstListener: () => {
			this.activeAcceptanceSubscriptions += 1;
		},
		onDidRemoveLastListener: () => {
			this.activeAcceptanceSubscriptions -= 1;
		},
	}));
	readonly onDidAcceptConnection = this.acceptedEmitter.event;
	startCount = 0;
	stopCount = 0;
	disposed = false;

	start(): Promise<void> {
		this.startCount += 1;
		return Promise.resolve();
	}

	stop(): Promise<void> {
		this.stopCount += 1;
		return Promise.resolve();
	}

	accept(connection: IRemoteServerConnection): void {
		this.acceptedEmitter.fire(connection);
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		super.dispose();
	}
}

class StartFailingManagementListener extends TestManagementListener {
	constructor(private readonly startError: Error) {
		super();
	}

	override start(): Promise<void> {
		this.startCount += 1;
		return Promise.reject(this.startError);
	}
}

const remoteEnvironment: IRemoteEnvironment = Object.freeze({
	protocolVersion: createRemoteProtocolVersion('1'),
	operatingSystem: 'linux',
	architecture: 'x64',
	userHome: '/home/test',
	temporaryDirectory: '/tmp',
	storageDirectory: '/home/test/.comet',
	pathCasePolicy: 'sensitive',
	capabilities: Object.freeze([remoteServerAgentHostCapability]),
	limits: Object.freeze({
		maximumFrameBytes: 64 * 1024,
		maximumPendingCalls: 32,
		maximumEventListeners: 32,
	}),
});

class TestRemoteConnection extends Disposable implements IRemoteServerConnection {
	private readonly stateEmitter = this._register(new Emitter<IRemoteConnectionStateChange>());
	private currentState: RemoteConnectionState = 'connected';
	private currentGeneration: RemoteConnectionGeneration = createRemoteConnectionGeneration(1);
	readonly channels = new Map<string, IRemoteChannelServer>();
	endCount = 0;
	registerChannelCount = 0;
	readonly onDidChangeState = this.stateEmitter.event;

	constructor(
		readonly authority: IRemoteAuthority,
		readonly client: ReturnType<typeof createRemoteClientId>,
		readonly server: RemoteServerInstanceId,
		readonly environment: IRemoteEnvironment = remoteEnvironment,
	) {
		super();
	}

	get generation(): RemoteConnectionGeneration { return this.currentGeneration; }
	get state(): RemoteConnectionState { return this.currentState; }

	getChannel(_name: string): IRemoteChannel {
		return unusedOperation();
	}

	registerChannel(name: string, channel: IRemoteChannelServer): IDisposable {
		assert.equal(this.channels.has(name), false);
		this.registerChannelCount += 1;
		this.channels.set(name, channel);
		return toDisposable(() => {
			assert.equal(this.channels.delete(name), true);
		});
	}

	reconnect(): Promise<void> {
		return Promise.reject(new Error('Reconnect transport is outside this composition test'));
	}

	end(): Promise<void> {
		this.endCount += 1;
		this.changeState('terminal');
		return Promise.resolve();
	}

	changeState(state: RemoteConnectionState): void {
		this.currentState = state;
		this.stateEmitter.fire(Object.freeze({ state, generation: this.currentGeneration }));
	}

	override dispose(): void {
		if (this.currentState === 'disposed') {
			return;
		}
		this.changeState('disposed');
		super.dispose();
	}
}

function createHostOptions(
	errors: unknown[],
	catalogStore: IAgentHostCatalogStore,
): Omit<IAgentHostAuthorityOptions, 'contentResources'> {
	let sessions = 0;
	let chats = 0;
	let turns = 0;
	let cancellations = 0;
	return {
		authority: hostAuthority,
		label: Object.freeze({ kind: 'literal', value: 'Remote test Host' }),
		supportedProtocolVersions: Object.freeze([hostProtocol]),
		capabilities: Object.freeze([]),
		implementation: Object.freeze({ name: 'remote-test-host', build: '1' }),
		sessionTypeCatalog: { resolve: () => Object.freeze([]) },
		agentRuntimes: {
			resolve: requested => {
				assert.deepStrictEqual(requested, registration);
				return agent;
			},
			resolvePreparedActivation: (_operationId, requested) => {
				assert.deepStrictEqual(requested, registration);
				return agent;
			},
		},
		packageLifecycle: createPackageLifecycle(),
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
		reportUnexpectedError: error => errors.push(error),
		maximumReplayActions: 16,
	};
}

async function createMain(
	remoteAuthority: IRemoteAuthority,
	remoteServer: RemoteServerInstanceId,
	listener: TestManagementListener,
	contentResources: TestContentResources,
	errors: unknown[],
	maximumClientBindings: number,
	connectionIdentity: IRemoteServerAgentHostConnectionIdentity,
): Promise<RemoteAgentHostMain> {
	return RemoteAgentHostMain.create({
		remoteAuthority,
		remoteServer,
		managementListener: listener,
		maximumClientBindings,
		host: createHostOptions(errors, new MemoryCatalogStore()),
		contentResources,
		toolRegistry: new AgentToolRegistry(),
		toolEndpoints: new AgentToolEndpointRegistry(),
		connectionIdentity,
	});
}

const defaultConnectionIdentity: IRemoteServerAgentHostConnectionIdentity = Object.freeze({
	create: (connection: IRemoteServerConnection) => createAgentHostClientConnectionId(`remote:${connection.client}`),
});

suite('RemoteAgentHostMain', () => {
	test('rejects invalid client binding capacities before Host or listener side effects', async () => {
		for (const maximumClientBindings of [0, 4097]) {
			const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
			const remoteServer = createRemoteServerInstanceId('server-1');
			const listener = new TestManagementListener();
			const contentResources = new TestContentResources();
			const catalogStore = new MemoryCatalogStore();
			const errors: unknown[] = [];
			await assert.rejects(
				RemoteAgentHostMain.create({
					remoteAuthority,
					remoteServer,
					managementListener: listener,
					maximumClientBindings,
					host: createHostOptions(errors, catalogStore),
					contentResources,
					toolRegistry: new AgentToolRegistry(),
					toolEndpoints: new AgentToolEndpointRegistry(),
					connectionIdentity: defaultConnectionIdentity,
				}),
				(error: Error) => error.message === 'Remote Agent Host client binding capacity must be a safe integer between 1 and 4096',
			);
			assert.equal(catalogStore.readCount, 0);
			assert.equal(catalogStore.commitCount, 0);
			assert.equal(listener.activeAcceptanceSubscriptions, 0);
			assert.equal(listener.startCount, 0);
			assert.equal(listener.stopCount, 0);
			assert.equal(listener.disposed, false);
			assert.equal(contentResources.bindCount, 0);
			assert.deepStrictEqual(errors, []);
			listener.dispose();
		}
	});

	test('disposes a listener whose start rejects without issuing stop', async () => {
		const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
		const remoteServer = createRemoteServerInstanceId('server-1');
		const startError = new Error('Test listener startup failed');
		const listener = new StartFailingManagementListener(startError);
		const contentResources = new TestContentResources();
		const catalogStore = new MemoryCatalogStore();
		const errors: unknown[] = [];

		await assert.rejects(
			RemoteAgentHostMain.create({
				remoteAuthority,
				remoteServer,
				managementListener: listener,
				maximumClientBindings: 16,
				host: createHostOptions(errors, catalogStore),
				contentResources,
				toolRegistry: new AgentToolRegistry(),
				toolEndpoints: new AgentToolEndpointRegistry(),
				connectionIdentity: defaultConnectionIdentity,
			}),
			(error: Error) => error === startError,
		);

		assert.equal(listener.startCount, 1);
		assert.equal(listener.stopCount, 0);
		assert.equal(listener.activeAcceptanceSubscriptions, 0);
		assert.equal(listener.disposed, true);
		assert.equal(contentResources.bindCount, 0);
		assert.deepStrictEqual(errors, []);
	});

	test('reserves capacity before identity and Host side effects and releases disposed clients once', async () => {
		const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
		const remoteServer = createRemoteServerInstanceId('server-1');
		const listener = new TestManagementListener();
		const contentResources = new TestContentResources();
		const errors: unknown[] = [];
		let identityCreations = 0;
		const identity: IRemoteServerAgentHostConnectionIdentity = {
			create: connection => {
				identityCreations += 1;
				return createAgentHostClientConnectionId(
					connection.client === createRemoteClientId('client-capacity-one')
						? 'agent-host-capacity-one'
						: 'agent-host-capacity-next',
				);
			},
		};
		const main = await createMain(
			remoteAuthority,
			remoteServer,
			listener,
			contentResources,
			errors,
			1,
			identity,
		);
		const first = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-capacity-one'),
			remoteServer,
		);
		const rejected = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-capacity-rejected'),
			remoteServer,
		);
		const next = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-capacity-next'),
			remoteServer,
		);

		listener.accept(first);
		assert.equal(identityCreations, 1);
		assert.equal(first.registerChannelCount, 1);
		assert.equal(contentResources.bindCount, 1);
		listener.accept(rejected);
		assert.equal(rejected.state, 'terminal');
		assert.equal(rejected.endCount, 1);
		assert.equal(rejected.registerChannelCount, 0);
		assert.equal(identityCreations, 1);
		assert.equal(contentResources.bindCount, 1);
		assert.equal(first.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(contentResources.bindings.size, 1);
		assert.equal(errors.length, 1);
		assert.ok(errors[0] instanceof RemoteError);
		assert.equal(errors[0].code, RemoteErrorCode.ConnectionTerminal);

		first.dispose();
		assert.equal(contentResources.releaseCount, 1);
		assert.equal(contentResources.bindings.size, 0);
		listener.accept(next);
		assert.equal(identityCreations, 2);
		assert.equal(next.registerChannelCount, 1);
		assert.equal(contentResources.bindCount, 2);
		assert.equal(contentResources.bindings.has('agent-host-capacity-next'), true);

		await main.shutdown();
		assert.equal(contentResources.releaseCount, 2);
		rejected.dispose();
		next.dispose();
	});

	test('keeps synchronous reentrant accepts within the reserved capacity', async () => {
		const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
		const remoteServer = createRemoteServerInstanceId('server-1');
		const listener = new TestManagementListener();
		const contentResources = new TestContentResources();
		const errors: unknown[] = [];
		const second = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-reentrant-two'),
			remoteServer,
		);
		let identityCreations = 0;
		let nestedAccepted = false;
		const identity: IRemoteServerAgentHostConnectionIdentity = {
			create: connection => {
				identityCreations += 1;
				if (!nestedAccepted) {
					nestedAccepted = true;
					listener.accept(second);
				}
				return createAgentHostClientConnectionId(`agent-host:${connection.client}`);
			},
		};
		const main = await createMain(
			remoteAuthority,
			remoteServer,
			listener,
			contentResources,
			errors,
			1,
			identity,
		);
		const first = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-reentrant-one'),
			remoteServer,
		);

		listener.accept(first);
		assert.equal(identityCreations, 1);
		assert.equal(first.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(second.state, 'terminal');
		assert.equal(second.registerChannelCount, 0);
		assert.equal(contentResources.bindCount, 1);
		assert.equal(contentResources.bindings.size, 1);
		assert.equal(errors.length, 1);
		assert.ok(errors[0] instanceof RemoteError);
		assert.equal(errors[0].code, RemoteErrorCode.ConnectionTerminal);

		await main.shutdown();
		first.dispose();
		second.dispose();
	});

	test('rejects duplicate identities and requires awaited Host shutdown', async () => {
		const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
		const remoteServer = createRemoteServerInstanceId('server-1');
		const listener = new TestManagementListener();
		const contentResources = new TestContentResources();
		const errors: unknown[] = [];
		let identityCreations = 0;
		const duplicateIdentity = createAgentHostClientConnectionId('agent-host-duplicate');
		const identity: IRemoteServerAgentHostConnectionIdentity = {
			create: () => {
				identityCreations += 1;
				return duplicateIdentity;
			},
		};
		const main = await createMain(
			remoteAuthority,
			remoteServer,
			listener,
			contentResources,
			errors,
			2,
			identity,
		);
		const client = createRemoteClientId('client-duplicate-one');
		const first = new TestRemoteConnection(remoteAuthority, client, remoteServer);
		const duplicateRemote = new TestRemoteConnection(remoteAuthority, client, remoteServer);
		const duplicateAgentHost = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-duplicate-two'),
			remoteServer,
		);

		listener.accept(first);
		listener.accept(duplicateRemote);
		assert.equal(identityCreations, 1);
		assert.equal(duplicateRemote.state, 'terminal');
		assert.equal(duplicateRemote.registerChannelCount, 0);
		listener.accept(duplicateAgentHost);
		assert.equal(identityCreations, 2);
		assert.equal(duplicateAgentHost.state, 'terminal');
		assert.equal(duplicateAgentHost.registerChannelCount, 0);
		assert.equal(contentResources.bindCount, 1);
		assert.equal(first.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(errors.length, 2);
		for (const error of errors) {
			assert.ok(error instanceof RemoteError);
			assert.equal(error.code, RemoteErrorCode.ConnectionMismatch);
		}
		first.changeState('terminal');
		const reused = new TestRemoteConnection(remoteAuthority, client, remoteServer);
		listener.accept(reused);
		assert.equal(identityCreations, 3);
		assert.equal(reused.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(contentResources.bindCount, 2);

		assert.throws(
			() => main.dispose(),
			(error: Error) => error.message === 'Remote Agent Host requires awaited shutdown',
		);
		assert.equal(main.state, 'running');
		assert.equal(listener.stopCount, 0);
		assert.equal(listener.disposed, false);
		assert.equal(reused.channels.has(remoteServerAgentHostChannelName), true);

		await main.shutdown();
		assert.equal(main.state, 'stopped');
		assert.equal(listener.stopCount, 1);
		assert.equal(listener.activeAcceptanceSubscriptions, 0);
		assert.equal(listener.disposed, true);
		assert.equal(first.channels.size, 0);
		assert.equal(contentResources.bindings.size, 0);
		assert.equal(contentResources.releaseCount, 2);
		first.dispose();
		duplicateRemote.dispose();
		duplicateAgentHost.dispose();
		reused.dispose();
	});

	test('owns one binding per accepted client across reconnect and releases terminal clients before Host shutdown', async () => {
		const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
		const remoteServer = createRemoteServerInstanceId('server-1');
		const listener = new TestManagementListener();
		const contentResources = new TestContentResources();
		const errors: unknown[] = [];
		const main = await createMain(
			remoteAuthority,
			remoteServer,
			listener,
			contentResources,
			errors,
			16,
			defaultConnectionIdentity,
		);
		const first = new TestRemoteConnection(remoteAuthority, createRemoteClientId('client-1'), remoteServer);
		const second = new TestRemoteConnection(remoteAuthority, createRemoteClientId('client-2'), remoteServer);

		assert.equal(main.state, 'running');
		assert.equal(listener.startCount, 1);
		listener.accept(first);
		listener.accept(second);
		assert.equal(first.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(second.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(contentResources.bindings.size, 2);

		first.changeState('reconnecting');
		first.changeState('connected');
		assert.equal(first.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(contentResources.bindings.size, 2);

		first.changeState('terminal');
		assert.equal(first.channels.has(remoteServerAgentHostChannelName), false);
		assert.equal(second.channels.has(remoteServerAgentHostChannelName), true);
		assert.equal(contentResources.bindings.size, 1);

		await main.shutdown();
		await main.shutdown();
		assert.equal(main.state, 'stopped');
		assert.equal(listener.stopCount, 1);
		assert.equal(listener.disposed, true);
		assert.equal(second.channels.has(remoteServerAgentHostChannelName), false);
		assert.equal(contentResources.bindings.size, 0);
		assert.deepStrictEqual(errors, []);

		first.dispose();
		second.dispose();
	});

	test('rejects a connection for another Remote Server before registering the Agent Host channel', async () => {
		const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
		const remoteServer = createRemoteServerInstanceId('server-1');
		const listener = new TestManagementListener();
		const contentResources = new TestContentResources();
		const errors: unknown[] = [];
		const main = await createMain(
			remoteAuthority,
			remoteServer,
			listener,
			contentResources,
			errors,
			16,
			defaultConnectionIdentity,
		);
		const connection = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-1'),
			createRemoteServerInstanceId('server-2'),
		);

		listener.accept(connection);
		assert.equal(connection.endCount, 1);
		assert.equal(connection.channels.size, 0);
		assert.equal(contentResources.bindings.size, 0);
		assert.equal(errors.length, 1);

		await main.shutdown();
		connection.dispose();
	});

	test('rejects a connection without the advertised Agent Host capability before registering the channel', async () => {
		const remoteAuthority = createRemoteAuthority('ssh', 'example.test');
		const remoteServer = createRemoteServerInstanceId('server-1');
		const listener = new TestManagementListener();
		const contentResources = new TestContentResources();
		const errors: unknown[] = [];
		const main = await createMain(
			remoteAuthority,
			remoteServer,
			listener,
			contentResources,
			errors,
			16,
			defaultConnectionIdentity,
		);
		const connection = new TestRemoteConnection(
			remoteAuthority,
			createRemoteClientId('client-1'),
			remoteServer,
			Object.freeze({ ...remoteEnvironment, capabilities: Object.freeze([]) }),
		);

		listener.accept(connection);
		assert.equal(connection.endCount, 1);
		assert.equal(connection.channels.size, 0);
		assert.equal(contentResources.bindings.size, 0);
		assert.equal(errors.length, 1);

		await main.shutdown();
		connection.dispose();
	});
});
