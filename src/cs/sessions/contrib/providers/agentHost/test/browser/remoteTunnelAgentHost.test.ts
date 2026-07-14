/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentHostAuthorityId,
	createAgentHostChannelRevision,
	createAgentHostClientConnectionId,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
} from 'cs/platform/agentHost/common/identities';
import {
	createRemoteTunnelAgentHostAddress,
	type IRemoteTunnelAgentHostAddress,
} from 'cs/platform/agentHost/common/remoteAgentHostAddress';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointCredential,
	decodeRemoteAgentHostEndpointAuthenticationMessage,
	encodeRemoteAgentHostEndpointAuthenticationResult,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostEndpointCredential,
	type RemoteAgentHostTunnelScheduledDelay,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import {
	decodeRemoteAgentHostProtocolPayload,
	encodeRemoteAgentHostProtocolError,
	encodeRemoteAgentHostProtocolSuccess,
	RemoteAgentHostProtocolCommand,
} from 'cs/platform/agentHost/common/remoteProtocol';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import {
	decodeRemoteAgentHostTunnelMessage,
	encodeRemoteAgentHostTunnelMessage,
} from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import {
	getAgentHostRootChannelId,
	getAgentHostSessionsChannelId,
	type AgentHostChannelSnapshot,
	type IAgentHostInitializeRequest,
	type IAgentHostInitializeResult,
	type IAgentHostRootState,
	type IAgentHostSetSubscriptionsRequest,
	type IAgentHostSetSubscriptionsResult,
} from 'cs/platform/agentHost/common/protocol';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	REMOTE_SERVER_TUNNEL_ENDPOINT_KIND,
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelIdentity,
	createRemoteTunnelProtocolRevision,
	createRemoteTunnelRecordRevision,
	createRemoteTunnelTransportGeneration,
	type IRemoteTunnelConnectRequest,
	type IRemoteTunnelConnection,
	type IRemoteTunnelConnectionClose,
	type IRemoteTunnelConnectionStateChange,
	type IRemoteTunnelCreateRequest,
	type IRemoteTunnelDescriptor,
	type IRemoteTunnelEndpointDescriptor,
	type IRemoteTunnelEnumerationRequest,
	type IRemoteTunnelIdentity,
	type IRemoteTunnelReconnectPolicy,
	type IRemoteTunnelService,
	type RemoteTunnelClientConnectionId,
	type RemoteTunnelConnectionState,
	type RemoteTunnelTransportGeneration,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteTunnelError, RemoteTunnelErrorCode } from 'cs/platform/tunnel/common/remoteTunnelErrors';
import {
	initializeRemoteTunnelAgentHostSessionsContribution,
	type IRemoteTunnelAgentHostSessionsContributionOptions,
} from 'cs/sessions/contrib/providers/agentHost/browser/remoteTunnelAgentHost';
import {
	ISessionsProvidersService,
	SessionsProvidersService,
} from 'cs/sessions/services/sessions/browser/sessionsProvidersService';
import { IChatService } from 'cs/workbench/contrib/chat/common/chatService/chatService';
import { ChatService } from 'cs/workbench/contrib/chat/common/chatService/chatServiceImpl';
import { createTestChatStorageService } from 'cs/workbench/contrib/chat/test/common/testChatStorage';
import {
	disposeWorkbenchInstantiationService,
	registerWorkbenchService,
} from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { getLocaleMessages } from 'language/i18n';

const tunnelIdentity = createRemoteTunnelIdentity(
	'mockTunnel',
	'account-1',
	'tunnel-selected',
	'cluster-west',
);
const endpointIdentity = createRemoteTunnelEndpointIdentity(
	tunnelIdentity.provider,
	tunnelIdentity.account,
	tunnelIdentity.tunnel,
	tunnelIdentity.cluster,
	'agent-host-endpoint',
);
const protocolRevision = createRemoteTunnelProtocolRevision(remoteAgentHostTunnelProtocolRevision);
const tunnelConnectionId = createRemoteTunnelClientConnectionId('sessions-route-client');
const endpointCredential = createRemoteAgentHostEndpointCredential('endpoint-secret-unrelated-to-tunnel');
const agentHostAuthority = createAgentHostAuthorityId('remote-tunnel-route-test');
const agentHostConnection = createAgentHostClientConnectionId('remote-tunnel-route-host-client');
const hostSequence = createAgentHostSequence(1);
const channelRevision = createAgentHostChannelRevision(1);
const rootChannel = getAgentHostRootChannelId();
const sessionsChannel = getAgentHostSessionsChannelId();

const reconnectPolicy: IRemoteTunnelReconnectPolicy = Object.freeze({
	maximumAttempts: 3,
	initialDelayMilliseconds: 10,
	maximumDelayMilliseconds: 100,
	gracePeriodMilliseconds: 1_000,
});

const rootState: IAgentHostRootState = Object.freeze({
	authority: agentHostAuthority,
	label: Object.freeze({ kind: 'literal', value: 'Remote Tunnel Agent Host' }),
	capabilities: Object.freeze({
		supportsCreateSession: false,
		supportsPackageOperations: false,
		supportsAgentAuthentication: false,
	}),
	packages: Object.freeze({
		revision: 0,
		installablePackages: Object.freeze([]),
		installedPackages: Object.freeze([]),
		activations: Object.freeze([]),
		retainedBackingRecords: Object.freeze([]),
		materializedBackings: Object.freeze([]),
	}),
	agents: Object.freeze([]),
	agentRegistrations: Object.freeze([]),
	agentDefaults: Object.freeze([]),
	sessionTypes: Object.freeze([]),
});

function createSnapshots(
	subscriptions: readonly IAgentHostSetSubscriptionsRequest['subscriptions'][number][],
): readonly AgentHostChannelSnapshot[] {
	return Object.freeze(subscriptions.map(channel => {
		if (channel === rootChannel) {
			return Object.freeze({
				channel,
				kind: 'root' as const,
				hostSequence,
				revision: channelRevision,
				state: rootState,
			});
		}
		if (channel === sessionsChannel) {
			return Object.freeze({
				channel,
				kind: 'sessions' as const,
				hostSequence,
				revision: channelRevision,
				state: Object.freeze({ sessions: Object.freeze([]) }),
			});
		}
		throw new Error(`Unexpected test Agent Host subscription '${channel}'.`);
	}));
}

interface ITestDescriptorOptions {
	readonly tunnel?: IRemoteTunnelIdentity;
	readonly endpoint?: ReturnType<typeof createRemoteTunnelEndpointIdentity>;
	readonly kind?: IRemoteTunnelEndpointDescriptor['kind'];
	readonly protocol?: IRemoteTunnelEndpointDescriptor['protocol'];
	readonly connectionScope?: IRemoteTunnelEndpointDescriptor['connectionScope'];
	readonly status?: IRemoteTunnelEndpointDescriptor['status'];
}

function createDescriptor(options: ITestDescriptorOptions = {}): IRemoteTunnelDescriptor {
	const identity = options.tunnel ?? tunnelIdentity;
	const endpoint = options.endpoint ?? endpointIdentity;
	const status = options.status ?? 'online';
	return Object.freeze({
		identity,
		displayName: 'Selected Agent Host Tunnel',
		visibility: 'private',
		revision: createRemoteTunnelRecordRevision('descriptor-1'),
		endpoints: Object.freeze([Object.freeze({
			identity: endpoint,
			kind: options.kind ?? AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocol: options.protocol ?? Object.freeze({
				minimum: protocolRevision,
				maximum: protocolRevision,
			}),
			connectionScope: options.connectionScope ?? 'privateAuthenticated',
			capabilities: Object.freeze([]),
			status,
			hostConnectionCount: status === 'online' ? 1 : 0,
		})]),
	});
}

class TestAgentHostTunnelScheduler implements IRemoteAgentHostTunnelScheduler {
	readonly delays: RemoteAgentHostTunnelScheduledDelay[] = [];

	wait(delay: RemoteAgentHostTunnelScheduledDelay, cancellation: CancellationToken): Promise<void> {
		this.delays.push(delay);
		if (cancellation.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		return new Promise((_resolve, reject) => {
			const listener = cancellation.onCancellationRequested(() => {
				listener.dispose();
				reject(new CancellationError());
			});
		});
	}
}

interface ITestTunnelConnectionOptions {
	readonly endpoint: IRemoteTunnelEndpointDescriptor;
	readonly connection?: RemoteTunnelClientConnectionId;
	readonly expectedCredential?: RemoteAgentHostEndpointCredential;
	readonly blockAuthentication?: boolean;
	readonly blockInitialize?: boolean;
}

class TestTunnelConnection extends Disposable implements IRemoteTunnelConnection {
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteTunnelConnectionStateChange>());
	private readonly generationEmitter = this._register(new EventEmitter<RemoteTunnelTransportGeneration>());
	private readonly receiveEmitter = this._register(new EventEmitter<Uint8Array>());
	private readonly closeEmitter = this._register(new EventEmitter<IRemoteTunnelConnectionClose>());
	private currentState: RemoteTunnelConnectionState = 'connected';
	private authenticated = false;
	private disposed = false;
	readonly authenticationStarted = new DeferredPromise<void>();
	readonly authenticationRelease = new DeferredPromise<void>();
	readonly initializeStarted = new DeferredPromise<void>();
	readonly initializeRelease = new DeferredPromise<void>();
	readonly initializeRequests: IAgentHostInitializeRequest[] = [];
	readonly generation = createRemoteTunnelTransportGeneration(1);
	readonly identity;
	readonly endpoint;
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidChangeGeneration = this.generationEmitter.event;
	readonly onDidReceiveFrame = this.receiveEmitter.event;
	readonly onDidClose = this.closeEmitter.event;
	receivedCredential: string | undefined;
	initializeFailure: AgentHostError | undefined;
	closeCount = 0;
	disposeCount = 0;

	constructor(private readonly options: ITestTunnelConnectionOptions) {
		super();
		this.endpoint = options.endpoint;
		this.identity = createRemoteTunnelConnectionIdentity(
			options.endpoint.identity,
			options.connection ?? tunnelConnectionId,
		);
		if (!options.blockAuthentication) {
			this.authenticationRelease.complete();
		}
		if (!options.blockInitialize) {
			this.initializeRelease.complete();
		}
	}

	get state(): RemoteTunnelConnectionState {
		return this.currentState;
	}

	async send(frame: Uint8Array): Promise<void> {
		if (this.currentState !== 'connected') {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.ConnectionTerminal,
				'Test Remote Tunnel connection is closed',
			);
		}
		if (!this.authenticated) {
			await this.authenticate(frame);
			return;
		}
		const message = decodeRemoteAgentHostTunnelMessage(frame);
		if (message.kind !== 'request' || message.target !== 'host') {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.ProtocolViolation,
				'Test Remote Tunnel received an invalid Agent Host request',
			);
		}
		let payload: string;
		switch (message.command) {
			case RemoteAgentHostProtocolCommand.Identity:
				assert.equal(message.argument, undefined);
				payload = encodeRemoteAgentHostProtocolSuccess(Object.freeze({
					authority: agentHostAuthority,
					connection: agentHostConnection,
				}));
				break;
			case RemoteAgentHostProtocolCommand.Initialize:
				payload = await this.initialize(message.argument);
				break;
			case RemoteAgentHostProtocolCommand.SetSubscriptions:
				payload = this.setSubscriptions(message.argument);
				break;
			default:
				payload = encodeRemoteAgentHostProtocolError(new AgentHostError(
					AgentHostErrorCode.InvalidProtocolValue,
					'Test Agent Host command is not registered',
					{ field: 'command', value: message.command },
				));
		}
		this.receiveEmitter.fire(encodeRemoteAgentHostTunnelMessage(Object.freeze({
			kind: 'response',
			id: message.id,
			payload,
		})));
	}

	resume(): Promise<void> {
		return Promise.reject(new RemoteTunnelError(
			RemoteTunnelErrorCode.ReconnectPaused,
			'Test Remote Tunnel connection cannot resume',
		));
	}

	async close(): Promise<void> {
		this.closeCount += 1;
		if (this.currentState === 'closed' || this.currentState === 'failed') {
			return;
		}
		this.currentState = 'closed';
		this.stateEmitter.fire(Object.freeze({ state: 'closed', generation: this.generation }));
		this.closeEmitter.fire(Object.freeze({ state: 'closed', generation: this.generation }));
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.disposeCount += 1;
		super.dispose();
	}

	private async authenticate(frame: Uint8Array): Promise<void> {
		const message = decodeRemoteAgentHostEndpointAuthenticationMessage(frame);
		if (message.kind !== 'authenticate' || message.generation !== this.generation) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.ProtocolViolation,
				'Test Remote Tunnel received an invalid authentication request',
			);
		}
		this.receivedCredential = message.credential;
		this.authenticationStarted.complete();
		await this.authenticationRelease.p;
		const result = message.credential === (this.options.expectedCredential ?? endpointCredential)
			? RemoteAgentHostEndpointAuthenticationResult.Authenticated
			: RemoteAgentHostEndpointAuthenticationResult.Rejected;
		this.authenticated = result === RemoteAgentHostEndpointAuthenticationResult.Authenticated;
		this.receiveEmitter.fire(encodeRemoteAgentHostEndpointAuthenticationResult(this.generation, result));
	}

	private async initialize(argument: string | undefined): Promise<string> {
		assert.equal(typeof argument, 'string');
		const request = decodeRemoteAgentHostProtocolPayload(argument as string) as unknown as IAgentHostInitializeRequest;
		this.initializeRequests.push(request);
		this.initializeStarted.complete();
		await this.initializeRelease.p;
		if (this.initializeFailure !== undefined) {
			return encodeRemoteAgentHostProtocolError(this.initializeFailure);
		}
		assert.equal(request.connection, agentHostConnection);
		assert.deepStrictEqual(request.protocolVersions, [createAgentHostProtocolVersion('2')]);
		assert.deepStrictEqual(request.subscriptions, [rootChannel, sessionsChannel]);
		const result: IAgentHostInitializeResult = Object.freeze({
			protocolVersion: createAgentHostProtocolVersion('2'),
			capabilities: Object.freeze([]),
			implementation: Object.freeze({ name: 'remote-tunnel-test-host', build: '1' }),
			hostSequence,
			snapshots: createSnapshots(request.subscriptions),
			missingChannels: Object.freeze([]),
		});
		return encodeRemoteAgentHostProtocolSuccess(result);
	}

	private setSubscriptions(argument: string | undefined): string {
		assert.equal(typeof argument, 'string');
		const request = decodeRemoteAgentHostProtocolPayload(argument as string) as unknown as IAgentHostSetSubscriptionsRequest;
		const result: IAgentHostSetSubscriptionsResult = Object.freeze({
			hostSequence,
			snapshots: createSnapshots(request.subscriptions),
			missingChannels: Object.freeze([]),
		});
		return encodeRemoteAgentHostProtocolSuccess(result);
	}
}

class TestRemoteTunnelService implements IRemoteTunnelService {
	readonly lookupRequests: IRemoteTunnelIdentity[] = [];
	readonly connectRequests: IRemoteTunnelConnectRequest[] = [];
	disposeCount = 0;

	constructor(
		private readonly descriptor: IRemoteTunnelDescriptor,
		private readonly connection?: IRemoteTunnelConnection,
	) {}

	enumerate(_request: IRemoteTunnelEnumerationRequest): Promise<readonly IRemoteTunnelDescriptor[]> {
		return Promise.reject(new Error('Test Remote Tunnel enumeration is not used.'));
	}

	async lookup(identity: IRemoteTunnelIdentity): Promise<IRemoteTunnelDescriptor> {
		this.lookupRequests.push(identity);
		return this.descriptor;
	}

	createTunnel(_request: IRemoteTunnelCreateRequest): Promise<IRemoteTunnelDescriptor> {
		return Promise.reject(new Error('Test Remote Tunnel creation is not used.'));
	}

	async connect(request: IRemoteTunnelConnectRequest): Promise<IRemoteTunnelConnection> {
		this.connectRequests.push(request);
		if (this.connection === undefined) {
			throw new Error('Test Remote Tunnel connection is unavailable.');
		}
		return this.connection;
	}

	dispose(): void {
		this.disposeCount += 1;
	}
}

function createContributionOptions(
	scheduler: IRemoteAgentHostTunnelScheduler,
	overrides: Partial<IRemoteTunnelAgentHostSessionsContributionOptions> = {},
): IRemoteTunnelAgentHostSessionsContributionOptions {
	return Object.freeze({
		implementation: Object.freeze({ name: 'remote-tunnel-route-test', build: '1' }),
		maximumClientToolCallRecords: 4,
		maximumBufferedActions: 4,
		contentResourceLimits: Object.freeze({
			maximumBlobBytes: 4_096,
			maximumTreeBytes: 8_192,
			maximumTreeEntries: 32,
			maximumTreeDepth: 8,
			maximumReadLength: 1_024,
			maximumOpenLeases: 8,
			maximumConcurrentOperations: 4,
			maximumTotalReadBytes: 8_192,
			maximumTreePageEntries: 32,
			maximumTreePages: 32,
			maximumLeaseDurationMilliseconds: 60_000,
		}),
		tunnelConnection: tunnelConnectionId,
		tunnelReconnect: reconnectPolicy,
		endpointCredential,
		endpointAuthenticationScheduler: scheduler,
		endpointAuthenticationTimeoutMilliseconds: 5_000,
		...overrides,
	});
}

function registerSessionsFixture(): {
	readonly providers: SessionsProvidersService;
	dispose(): void;
} {
	disposeWorkbenchInstantiationService();
	const providers = new SessionsProvidersService();
	const localeService: IWorkbenchLocaleService = {
		_serviceBrand: undefined,
		getLocale: () => 'en',
		subscribe: () => () => {},
		applyLocale: () => {},
		updateLocalePreference: async () => {},
		syncDocumentLanguage: () => {},
		initialize: async () => 'en',
	};
	const languageService: IWorkbenchLanguageService = {
		_serviceBrand: undefined,
		detectInitialLocale: () => 'en',
		getLocaleMessages,
		toDocumentLang: () => 'en',
	};
	registerWorkbenchService(IChatService, new ChatService(createTestChatStorageService()));
	registerWorkbenchService(ISessionsProvidersService, providers);
	registerWorkbenchService(IWorkbenchLocaleService, localeService);
	registerWorkbenchService(IWorkbenchLanguageService, languageService);
	return {
		providers,
		dispose: () => {
			disposeWorkbenchInstantiationService();
			providers.dispose();
		},
	};
}

async function settleDisposal(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
}

suite('Remote Tunnel Agent Host Sessions contribution', { concurrency: false }, () => {
	test('rejects malformed addresses and invalid endpoint credentials before lookup', async () => {
		const scheduler = new TestAgentHostTunnelScheduler();
		const service = new TestRemoteTunnelService(createDescriptor());
		const address = createRemoteTunnelAgentHostAddress(
			endpointIdentity,
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocolRevision,
		);

		const malformedAddress = Object.freeze({ ...address, extra: true }) as IRemoteTunnelAgentHostAddress;
		await assert.rejects(
			initializeRemoteTunnelAgentHostSessionsContribution(
				malformedAddress,
				service,
				createContributionOptions(scheduler),
			),
			/Invalid Remote Agent Host address/,
		);
		assert.equal(service.lookupRequests.length, 0);

		await assert.rejects(
			initializeRemoteTunnelAgentHostSessionsContribution(
				address,
				service,
				createContributionOptions(scheduler, {
					endpointCredential: '' as RemoteAgentHostEndpointCredential,
				}),
			),
			(error: Error) => error instanceof RemoteAgentHostEndpointAuthenticationError
				&& error.code === RemoteAgentHostEndpointAuthenticationErrorCode.InvalidCredential,
		);
		assert.equal(service.lookupRequests.length, 0);
	});

	test('revalidates exact identity, kind, protocol, security scope, and online status before connect', async () => {
		const scheduler = new TestAgentHostTunnelScheduler();
		const address = createRemoteTunnelAgentHostAddress(
			endpointIdentity,
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocolRevision,
		);
		const otherTunnel = createRemoteTunnelIdentity(
			tunnelIdentity.provider,
			tunnelIdentity.account,
			'another-tunnel',
			tunnelIdentity.cluster,
		);
		const otherEndpoint = createRemoteTunnelEndpointIdentity(
			otherTunnel.provider,
			otherTunnel.account,
			otherTunnel.tunnel,
			otherTunnel.cluster,
			endpointIdentity.endpoint,
		);
		const nextRevision = createRemoteTunnelProtocolRevision(protocolRevision + 1);
		const descriptors = [
			createDescriptor({ tunnel: otherTunnel, endpoint: otherEndpoint }),
			createDescriptor({ kind: REMOTE_SERVER_TUNNEL_ENDPOINT_KIND }),
			createDescriptor({
				protocol: Object.freeze({ minimum: nextRevision, maximum: nextRevision }),
			}),
			createDescriptor({ connectionScope: 'accountAuthenticated' }),
			createDescriptor({ status: 'offline' }),
		];

		for (const descriptor of descriptors) {
			const service = new TestRemoteTunnelService(descriptor);
			await assert.rejects(initializeRemoteTunnelAgentHostSessionsContribution(
				address,
				service,
				createContributionOptions(scheduler),
			));
			assert.equal(service.lookupRequests.length, 1);
			assert.equal(service.connectRequests.length, 0);
		}
	});

	test('uses the exact address and injected endpoint credential before common provider registration', async () => {
		const fixture = registerSessionsFixture();
		const scheduler = new TestAgentHostTunnelScheduler();
		const descriptor = createDescriptor();
		const connection = new TestTunnelConnection({
			endpoint: descriptor.endpoints[0],
			blockAuthentication: true,
			blockInitialize: true,
		});
		const service = new TestRemoteTunnelService(descriptor, connection);
		const address = createRemoteTunnelAgentHostAddress(
			endpointIdentity,
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocolRevision,
		);
		try {
			const starting = initializeRemoteTunnelAgentHostSessionsContribution(
				address,
				service,
				createContributionOptions(scheduler),
			);
			await connection.authenticationStarted.p;
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.equal(connection.receivedCredential, endpointCredential);
			assert.notEqual(connection.receivedCredential, tunnelIdentity.tunnel);
			assert.deepStrictEqual(service.lookupRequests, [tunnelIdentity]);
			assert.deepStrictEqual(service.connectRequests, [Object.freeze({
				endpoint: endpointIdentity,
				kind: AGENT_HOST_TUNNEL_ENDPOINT_KIND,
				protocol: Object.freeze({ minimum: protocolRevision, maximum: protocolRevision }),
				connection: tunnelConnectionId,
				reconnect: reconnectPolicy,
			})]);

			connection.authenticationRelease.complete();
			await connection.initializeStarted.p;
			assert.equal(fixture.providers.getProviders().length, 0);
			connection.initializeRelease.complete();
			await starting;

			assert.equal(connection.initializeRequests.length, 1);
			assert.equal(fixture.providers.getProviders().length, 1);
			assert.equal(fixture.providers.getProviders()[0].label, 'Remote Tunnel Agent Host');
			assert.deepStrictEqual(scheduler.delays, [Object.freeze({
				kind: 'endpointAuthenticationTimeout',
				owner: 'client',
				generation: createRemoteTunnelTransportGeneration(1),
				delayMilliseconds: 5_000,
			})]);
			assert.equal(service.disposeCount, 0);
		} finally {
			fixture.dispose();
			await settleDisposal();
		}
		assert.equal(connection.closeCount, 1);
		assert.equal(connection.disposeCount, 1);
		assert.equal(service.disposeCount, 0);
	});

	test('rejects the injected wrong endpoint credential without exposing it or registering a provider', async () => {
		const fixture = registerSessionsFixture();
		const scheduler = new TestAgentHostTunnelScheduler();
		const descriptor = createDescriptor();
		const connection = new TestTunnelConnection({ endpoint: descriptor.endpoints[0] });
		const service = new TestRemoteTunnelService(descriptor, connection);
		const address = createRemoteTunnelAgentHostAddress(
			endpointIdentity,
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocolRevision,
		);
		const wrongCredential = createRemoteAgentHostEndpointCredential('synthetic-wrong-endpoint-secret');
		try {
			await assert.rejects(
				initializeRemoteTunnelAgentHostSessionsContribution(
					address,
					service,
					createContributionOptions(scheduler, { endpointCredential: wrongCredential }),
				),
				(error: Error) => {
					assert.ok(error instanceof RemoteAgentHostEndpointAuthenticationError);
					assert.equal(error.code, RemoteAgentHostEndpointAuthenticationErrorCode.Rejected);
					assert.equal(JSON.stringify(error).includes(wrongCredential), false);
					assert.equal(error.message.includes(wrongCredential), false);
					return true;
				},
			);
			assert.equal(connection.receivedCredential, wrongCredential);
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.equal(connection.closeCount, 1);
			assert.equal(connection.disposeCount, 1);
		} finally {
			fixture.dispose();
		}
	});

	test('closes a mismatched dedicated connection before endpoint authentication', async () => {
		const fixture = registerSessionsFixture();
		const scheduler = new TestAgentHostTunnelScheduler();
		const descriptor = createDescriptor();
		const connection = new TestTunnelConnection({
			endpoint: descriptor.endpoints[0],
			connection: createRemoteTunnelClientConnectionId('another-logical-client'),
		});
		const service = new TestRemoteTunnelService(descriptor, connection);
		const address = createRemoteTunnelAgentHostAddress(
			endpointIdentity,
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocolRevision,
		);
		try {
			await assert.rejects(
				initializeRemoteTunnelAgentHostSessionsContribution(
					address,
					service,
					createContributionOptions(scheduler),
				),
				(error: Error) => error instanceof RemoteTunnelError
					&& error.code === RemoteTunnelErrorCode.ProtocolViolation,
			);
			assert.equal(connection.receivedCredential, undefined);
			assert.equal(connection.closeCount, 1);
			assert.equal(connection.disposeCount, 1);
			assert.equal(fixture.providers.getProviders().length, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('cleans the dedicated route when common Host negotiation fails', async () => {
		const fixture = registerSessionsFixture();
		const scheduler = new TestAgentHostTunnelScheduler();
		const descriptor = createDescriptor();
		const connection = new TestTunnelConnection({ endpoint: descriptor.endpoints[0] });
		connection.initializeFailure = new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Synthetic Host negotiation failure',
			{ field: 'initialize', value: 'failed' },
		);
		const service = new TestRemoteTunnelService(descriptor, connection);
		const address = createRemoteTunnelAgentHostAddress(
			endpointIdentity,
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocolRevision,
		);
		try {
			await assert.rejects(
				initializeRemoteTunnelAgentHostSessionsContribution(
					address,
					service,
					createContributionOptions(scheduler),
				),
				(error: Error) => error instanceof AgentHostError
					&& error.code === AgentHostErrorCode.InvalidProtocolValue,
			);
			await settleDisposal();
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.equal(connection.closeCount, 1);
			assert.equal(connection.disposeCount, 1);
		} finally {
			fixture.dispose();
		}
	});

	test('unregisters the common provider when the dedicated lower connection closes', async () => {
		const fixture = registerSessionsFixture();
		const scheduler = new TestAgentHostTunnelScheduler();
		const descriptor = createDescriptor();
		const connection = new TestTunnelConnection({ endpoint: descriptor.endpoints[0] });
		const service = new TestRemoteTunnelService(descriptor, connection);
		const address = createRemoteTunnelAgentHostAddress(
			endpointIdentity,
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocolRevision,
		);
		try {
			await initializeRemoteTunnelAgentHostSessionsContribution(
				address,
				service,
				createContributionOptions(scheduler),
			);
			const provider = fixture.providers.getProviders()[0];
			assert.ok(provider);

			await connection.close();
			await settleDisposal();
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.throws(() => provider.getSessions(), /is disposed/);
			assert.equal(connection.disposeCount, 1);
			assert.equal(service.disposeCount, 0);
		} finally {
			fixture.dispose();
		}
	});
});
