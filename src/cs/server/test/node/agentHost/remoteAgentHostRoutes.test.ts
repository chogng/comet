/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationError, CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { ClientAgentToolService } from 'cs/platform/agentHost/browser/clientAgentTools';
import { ClientContentResourceService } from 'cs/platform/agentHost/browser/clientContentResources';
import { RemoteAgentHostConnection } from 'cs/platform/agentHost/browser/remoteAgentHostConnection';
import { RemoteServerAgentHostTransport } from 'cs/platform/agentHost/browser/remoteServerAgentHostTransport';
import { RemoteTunnelAgentHostTransport } from 'cs/platform/agentHost/browser/remoteTunnelAgentHostTransport';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import type { IAgentHostConnection } from 'cs/platform/agentHost/common/connections';
import { remoteServerAgentHostCapability } from 'cs/platform/agentHost/common/remoteProtocol';
import {
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointCredential,
	type IRemoteAgentHostEndpointAuthenticationRequest,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostTunnelScheduledDelay,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import {
	type IAgentContentResourceReaderPort,
} from 'cs/platform/agentHost/common/contentResources';
import {
	createAgentAttachmentId,
	createAgentChatId,
	createAgentHostActionDigest,
	createAgentHostAuthorityId,
	createAgentHostChannelId,
	createAgentHostChannelRevision,
	createAgentHostClientConnectionId,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
	createAgentId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSetRevision,
	createAgentTurnId,
	type AgentHostClientConnectionId,
} from 'cs/platform/agentHost/common/identities';
import type {
	AgentPackageOperationOutcome,
	IAgentPackageOperationOutcomeRequest,
	IAgentPackageOperationRequest,
} from 'cs/platform/agentHost/common/packages';
import type {
	AgentHostChannelAction,
	AgentHostMutationOutcome,
	AgentHostPrepareSubmissionResult,
	AgentHostReconnectResult,
	IAgentHostInitializeRequest,
	IAgentHostInitializeResult,
	IAgentHostMutationRequest,
	IAgentHostOperationOutcomeRequest,
	IAgentHostPrepareSubmissionRequest,
	IAgentHostReconnectRequest,
	IAgentHostResolveSessionConfigurationRequest,
	IAgentHostResolveSessionConfigurationResult,
	IAgentHostSessionConfigurationCompletionsRequest,
	IAgentHostSessionConfigurationCompletionsResult,
	IAgentHostSetSubscriptionsRequest,
	IAgentHostSetSubscriptionsResult,
} from 'cs/platform/agentHost/common/protocol';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	type IAgentToolRegistration,
} from 'cs/platform/agentHost/common/tools';
import type { IAgentContentResourceClientRouter } from 'cs/platform/agentHost/node/content/agentContentResourceService';
import { RemoteServerAgentHostBinding } from 'cs/server/node/agentHost/remoteAgentHostChannel';
import {
	RemoteTunnelAgentHostHostingBinding,
	type IRemoteTunnelAgentHostHostingOptions,
} from 'cs/platform/agentHost/node/remoteTunnelAgentHostBinding';
import { AgentToolEndpointRegistry } from 'cs/platform/agentHost/node/tools/agentToolExecution';
import { AgentToolRegistry } from 'cs/platform/agentHost/node/tools/agentToolRegistry';
import {
	createRemoteAuthority,
	createRemoteCapabilityId,
	createRemoteClientId,
	createRemoteCredential,
	createRemoteProtocolVersion,
	createRemoteServerInstanceId,
} from 'cs/platform/remote/common/remoteAuthority';
import type { IRemoteManagementConnectRequest } from 'cs/platform/remote/common/remoteConnection';
import type { IRemoteEnvironment } from 'cs/platform/remote/common/remoteEnvironment';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import {
	createMockRemoteEndpointValues,
	MockRemoteServer,
} from 'cs/platform/remote/node/mockRemoteServer';
import {
	createMockRemoteTunnelProduct,
} from 'cs/platform/tunnel/common/mockRemoteTunnelProducts';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	computeRemoteTunnelMutationValueDigest,
	createRemoteTunnelAccountIdentity,
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelIdentity,
	createRemoteTunnelOperationId,
	createRemoteTunnelProtocolRevision,
	type IRemoteTunnelScheduler,
	type RemoteTunnelScheduledDelay,
} from 'cs/platform/tunnel/common/remoteTunnel';
import {
	RemoteTunnelHostService,
	RemoteTunnelProductRegistry,
	RemoteTunnelService,
} from 'cs/platform/tunnel/common/remoteTunnelService';

const authority = createAgentHostAuthorityId('remote-test');
const agentHostConnectionId = createAgentHostClientConnectionId('remote-client');
const protocolVersion = createAgentHostProtocolVersion('3');
const sessionsChannel = createAgentHostChannelId('sessions');
const session = createAgentSessionId('session');
const chat = createAgentChatId('chat');
const turn = createAgentTurnId('turn');

class ImmediateTunnelScheduler implements IRemoteTunnelScheduler, IRemoteAgentHostTunnelScheduler {
	wait(
		delay: RemoteTunnelScheduledDelay | RemoteAgentHostTunnelScheduledDelay,
		cancellation: CancellationToken,
	): Promise<void> {
		if (delay.kind === 'reconnectAttempt') {
			return Promise.resolve();
		}
		if (cancellation.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		return new Promise((_resolve, reject) => {
			const subscription = cancellation.onCancellationRequested(() => {
				subscription.dispose();
				reject(new CancellationError());
			});
		});
	}
}

const connectionOptions = Object.freeze({
	maximumClientToolCallRecords: 16,
	maximumBufferedActions: 64,
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
});

const initializeRequest: IAgentHostInitializeRequest = Object.freeze({
	connection: agentHostConnectionId,
	protocolVersions: Object.freeze([protocolVersion]),
	capabilities: Object.freeze([]),
	locale: 'en-US',
	implementation: Object.freeze({ name: 'Remote route test', build: 'test' }),
	subscriptions: Object.freeze([]),
});

const channelAction: AgentHostChannelAction = Object.freeze({
	channel: sessionsChannel,
	kind: 'sessions',
	hostSequence: createAgentHostSequence(1),
	revision: createAgentHostChannelRevision(1),
	digest: createAgentHostActionDigest(`sha256:${'2'.repeat(64)}`),
	cause: Object.freeze({ kind: 'host' }),
	action: Object.freeze({
		kind: 'sessionCatalogStateChanged',
		state: Object.freeze({ sessions: Object.freeze([]) }),
	}),
});

async function stage<T>(name: string, operation: Promise<T>): Promise<T> {
	try {
		return await operation;
	} catch (error) {
		throw new Error(
			`Remote Agent Host route failed during ${name}: ${error instanceof Error ? error.message : String(error)}`,
			{ cause: error },
		);
	}
}

const toolId = createAgentToolId('remote.read');
const toolDescriptor = createAgentToolDescriptorRevision('remote.read.descriptor.v1');
const toolRegistrationId = createAgentToolRegistrationId('remote.read.registration');
const toolRegistrationRevision = createAgentToolRegistrationRevision('remote.read.registration.v1');
const toolExecutor = Object.freeze({
	kind: 'client' as const,
	connection: agentHostConnectionId,
	executor: createAgentToolExecutorId('remote.read.executor'),
});
const toolRegistration: IAgentToolRegistration = Object.freeze({
	id: toolRegistrationId,
	revision: toolRegistrationRevision,
	descriptor: Object.freeze({
		id: toolId,
		revision: toolDescriptor,
		contributor: createAgentToolContributorId('remote-test'),
		functionName: 'remote_read',
		displayName: 'Remote read',
		description: 'Exercises the exact reverse client Tool route.',
		inputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({
				type: 'object',
				properties: Object.freeze({}),
				required: Object.freeze([]),
				additionalProperties: false,
			}),
		}),
		outputSchema: Object.freeze({
			profile: COMET_TOOL_SCHEMA_PROFILE,
			value: Object.freeze({ type: 'literal', value: null }),
		}),
		safety: 'read',
		confirmation: 'never',
		allowsEditedInput: false,
		targetTypes: Object.freeze([]),
		limits: Object.freeze({
			maximumInputBytes: 1_024,
			maximumOutputBytes: 1_024,
			maximumContentBytes: 1_024,
			timeoutMilliseconds: 30_000,
			maximumConcurrency: 1,
		}),
	}),
	executor: toolExecutor,
});

function createToolCall(): IAgentToolCall {
	return Object.freeze({
		id: createAgentToolCallId('remote-tool-call'),
		agent: createAgentId('comet'),
		registration: createAgentRuntimeRegistrationRevision('comet.remote.v1'),
		session,
		chat,
		turn,
		toolSet: createAgentToolSetRevision('tool-set.v1'),
		tool: toolId,
		descriptor: toolDescriptor,
		registrationId: toolRegistrationId,
		registrationRevision: toolRegistrationRevision,
		input: Object.freeze({}),
		effect: Object.freeze({ kind: 'read' }),
		deadline: Date.now() + 30_000,
	});
}

class TestClientToolEndpoint implements IAgentToolExecutorEndpoint {
	async execute(
		call: IAgentToolCall,
		_target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		_cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		reportProgress(Object.freeze({
			call: call.id,
			sequence: 1,
			data: Object.freeze({ phase: 'client' }),
		}));
		return Object.freeze({ call: call.id, status: 'completed', output: null });
	}

	async cancel(_call: IAgentToolCall): Promise<void> {}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		return Object.freeze({
			kind: 'terminal',
			result: Object.freeze({ call: call.id, status: 'completed', output: null }),
		});
	}
}

class TestAgentHostConnection extends Disposable implements IAgentHostConnection {
	private readonly actionEmitter = this._register(new Emitter<AgentHostChannelAction>());
	readonly authority = authority;
	readonly onDidReceiveAction: Event<AgentHostChannelAction> = this.actionEmitter.event;
	readonly reconnectRequests: IAgentHostReconnectRequest[] = [];

	constructor(readonly connection: AgentHostClientConnectionId = agentHostConnectionId) {
		super();
	}

	async initialize(_request: IAgentHostInitializeRequest): Promise<IAgentHostInitializeResult> {
		return Object.freeze({
			protocolVersion,
			capabilities: Object.freeze([]),
			implementation: Object.freeze({ name: 'Remote test Host', build: 'test' }),
			hostSequence: createAgentHostSequence(0),
			snapshots: Object.freeze([]),
			missingChannels: Object.freeze([]),
		});
	}

	async reconnect(request: IAgentHostReconnectRequest): Promise<AgentHostReconnectResult> {
		this.reconnectRequests.push(request);
		return Object.freeze({
			kind: 'replay',
			fromHostSequence: request.lastHostSequence,
			throughHostSequence: request.lastHostSequence,
			actions: Object.freeze([]),
			missingChannels: Object.freeze([]),
		});
	}

	async setSubscriptions(request: IAgentHostSetSubscriptionsRequest): Promise<IAgentHostSetSubscriptionsResult> {
		return Object.freeze({
			hostSequence: createAgentHostSequence(0),
			snapshots: Object.freeze([]),
			missingChannels: Object.freeze(request.subscriptions.map(channel => Object.freeze({
				channel,
				reason: 'notFound' as const,
			}))),
		});
	}

	resolveSessionConfiguration(
		_request: IAgentHostResolveSessionConfigurationRequest,
	): Promise<IAgentHostResolveSessionConfigurationResult> {
		return Promise.reject(new Error('Unexpected configuration resolution'));
	}

	completeSessionConfiguration(
		_request: IAgentHostSessionConfigurationCompletionsRequest,
	): Promise<IAgentHostSessionConfigurationCompletionsResult> {
		return Promise.reject(new Error('Unexpected configuration completion'));
	}

	prepareSubmission(_request: IAgentHostPrepareSubmissionRequest): Promise<AgentHostPrepareSubmissionResult> {
		return Promise.reject(new Error('Unexpected submission preparation'));
	}

	async mutate(_request: IAgentHostMutationRequest): Promise<AgentHostMutationOutcome> {
		return Object.freeze({ kind: 'unknown' });
	}

	async getOperationOutcome(_request: IAgentHostOperationOutcomeRequest): Promise<AgentHostMutationOutcome> {
		return Object.freeze({ kind: 'unknown' });
	}

	async executePackageOperation(_request: IAgentPackageOperationRequest): Promise<AgentPackageOperationOutcome> {
		return Object.freeze({ kind: 'unknown' });
	}

	async getPackageOperationOutcome(_request: IAgentPackageOperationOutcomeRequest): Promise<AgentPackageOperationOutcome> {
		return Object.freeze({ kind: 'unknown' });
	}

	fireAction(action: AgentHostChannelAction): void {
		this.actionEmitter.fire(action);
	}
}

class TestContentResourceRouter implements IAgentContentResourceClientRouter {
	reader: IAgentContentResourceReaderPort | undefined;
	connection: AgentHostClientConnectionId | undefined;

	bindClientReader(connection: AgentHostClientConnectionId, reader: IAgentContentResourceReaderPort) {
		if (this.reader !== undefined) {
			throw new Error('Duplicate client content reader');
		}
		this.connection = connection;
		this.reader = reader;
		return toDisposable(() => {
			this.connection = undefined;
			this.reader = undefined;
		});
	}
}

async function exerciseRoute(
	connection: RemoteAgentHostConnection,
	host: TestAgentHostConnection,
	contentRouter: TestContentResourceRouter,
	toolRegistry: AgentToolRegistry,
	toolEndpoints: AgentToolEndpointRegistry,
	restoreTransport: (restored: DeferredPromise<number>) => Promise<void>,
): Promise<void> {
	assert.equal(connection.authority, authority);
	assert.equal(connection.connection, agentHostConnectionId);
	assert.deepEqual(await stage('initialize', connection.initialize(initializeRequest)), {
		protocolVersion,
		capabilities: [],
		implementation: { name: 'Remote test Host', build: 'test' },
		hostSequence: 0,
		snapshots: [],
		missingChannels: [],
	});

	const action = new DeferredPromise<AgentHostChannelAction>();
	const actionListener = connection.onDidReceiveAction(value => action.complete(value));
	host.fireAction(channelAction);
	assert.deepEqual(await action.p, channelAction);
	actionListener.dispose();

	assert.equal(contentRouter.connection, agentHostConnectionId);
	const publication = await connection.contentResources.publishBlob({
		mediaType: 'text/plain',
		bytes: new TextEncoder().encode('remote'),
	});
	const reader = contentRouter.reader;
	assert.ok(reader);
	const lease = await stage('content open', reader.open(Object.freeze({
		session,
		chat,
		turn,
		attachment: createAgentAttachmentId('attachment'),
		content: publication.content,
		limits: Object.freeze({
			maximumReadLength: publication.content.bounds.maximumReadLength,
			maximumTotalReadBytes: 4_096,
			maximumTreePageEntries: 16,
			maximumTreePages: 16,
			maximumConcurrentOperations: 2,
			deadline: Date.now() + 30_000,
		}),
	}), CancellationTokenNone));
	assert.equal((await stage('content read', reader.readBlob({
		lease: lease.lease,
		offset: 0,
		length: 6,
	}, CancellationTokenNone))).data, 'cmVtb3Rl');
	await reader.release(lease.lease, CancellationTokenNone);
	publication.release();

	const clientTool = new TestClientToolEndpoint();
	const toolPublication = connection.clientTools.publish(toolRegistration, clientTool);
	await stage('client Tool publication', connection.clientTools.synchronize());
	assert.deepEqual(toolRegistry.snapshot(), [toolRegistration]);
	const hostTool = toolEndpoints.resolve(toolExecutor);
	assert.ok(hostTool);
	const progress: IAgentToolProgress[] = [];
	const call = createToolCall();
	assert.deepEqual(await stage('client Tool execution', hostTool.execute(
		call,
		undefined,
		value => progress.push(value),
		CancellationTokenNone,
	)), { call: call.id, status: 'completed', output: null });
	assert.deepEqual(progress, [{ call: call.id, sequence: 1, data: { phase: 'client' } }]);
	toolPublication.dispose();
	await stage('client Tool removal', connection.clientTools.synchronize());

	const recovery = new DeferredPromise<number>();
	const recoveryListener = connection.onDidRequireRecovery(event => recovery.complete(event.generation));
	await restoreTransport(recovery);
	assert.equal(await recovery.p, 2);
	recoveryListener.dispose();
	assert.equal(connection.state, 'restoring');
	let liveActionDelivered = false;
	const liveAction = new DeferredPromise<AgentHostChannelAction>();
	const liveActionListener = connection.onDidReceiveAction(value => {
		liveActionDelivered = true;
		liveAction.complete(value);
	});
	host.fireAction(channelAction);
	assert.equal(liveActionDelivered, false);
	assert.deepEqual(await connection.reconnect(Object.freeze({
		connection: agentHostConnectionId,
		lastHostSequence: createAgentHostSequence(0),
		subscriptions: Object.freeze([]),
	})), {
		kind: 'replay',
		fromHostSequence: 0,
		throughHostSequence: 0,
		actions: [],
		missingChannels: [],
	});
	connection.completeRecovery(2);
	assert.deepEqual(await liveAction.p, channelAction);
	assert.equal(connection.state, 'connected');
	liveActionListener.dispose();
	assert.equal(host.reconnectRequests.length, 1);
}

suite('Remote Agent Host routes', { concurrency: false }, () => {
	test('binds the Agent Host protocol and reverse endpoints over one Remote Server connection', async () => {
		const remoteAuthority = createRemoteAuthority('mock', 'agent-host.server');
		const remoteClient = createRemoteClientId('agent-host.client');
		const remoteProtocol = createRemoteProtocolVersion('1');
		const endpoint = createMockRemoteEndpointValues('remote.test/agent-host');
		const environment: IRemoteEnvironment = Object.freeze({
			protocolVersion: remoteProtocol,
			operatingSystem: 'linux',
			architecture: 'x64',
			userHome: '/home/comet',
			temporaryDirectory: '/tmp',
			storageDirectory: '/home/comet/.comet',
			pathCasePolicy: 'sensitive',
			capabilities: Object.freeze([
				createRemoteCapabilityId('channels'),
				remoteServerAgentHostCapability,
			]),
			limits: Object.freeze({
				maximumFrameBytes: 16 * 1024 * 1024,
				maximumPendingCalls: 64,
				maximumEventListeners: 64,
			}),
		});
		const server = new MockRemoteServer({
			authority: remoteAuthority,
			endpointKind: endpoint.kind,
			endpointAddress: endpoint.address,
			credential: createRemoteCredential('agent-host.credential'),
			server: createRemoteServerInstanceId('agent-host.server.instance'),
			protocolVersions: [remoteProtocol],
			productCommit: 'test-commit',
			environment,
		});
		await server.start();
		const request: IRemoteManagementConnectRequest = Object.freeze({
			authority: remoteAuthority,
			client: remoteClient,
			protocolVersions: [remoteProtocol],
			productCommit: 'test-commit',
			locale: 'en-US',
			profile: 'default',
		});
		const resolved = await server.createResolver().resolve(remoteAuthority);
		const clientConnection = await server.connect(resolved, request);
		const host = new TestAgentHostConnection();
		const contentRouter = new TestContentResourceRouter();
		const toolRegistry = new AgentToolRegistry();
		const toolEndpoints = new AgentToolEndpointRegistry();
		let authorityConnections = 0;
		const binding = new RemoteServerAgentHostBinding(
			{
				createConnection: (connection: AgentHostClientConnectionId) => {
					authorityConnections += 1;
					assert.equal(connection, agentHostConnectionId);
					return host;
				},
			},
			agentHostConnectionId,
			server.getServerConnection(remoteClient),
			contentRouter,
			toolRegistry,
			toolEndpoints,
		);
		const mismatchedTransport = new RemoteServerAgentHostTransport(clientConnection);
		const foreignConnection = createAgentHostClientConnectionId('foreign-remote-client');
		const exactContent = new ClientContentResourceService(
			agentHostConnectionId,
			connectionOptions.contentResourceLimits,
		);
		const foreignContent = new ClientContentResourceService(
			foreignConnection,
			connectionOptions.contentResourceLimits,
		);
		const exactTools = new ClientAgentToolService(agentHostConnectionId, {
			maximumCallRecords: 1,
			synchronize: async () => {},
		});
		const foreignTools = new ClientAgentToolService(foreignConnection, {
			maximumCallRecords: 1,
			synchronize: async () => {},
		});
		try {
			const isConnectionMismatch = (error: unknown): boolean => error instanceof RemoteError
				&& error.code === RemoteErrorCode.ConnectionMismatch;
			assert.throws(() => mismatchedTransport.bindClientEndpoints(
				agentHostConnectionId,
				foreignContent,
				exactTools,
			), isConnectionMismatch);
			assert.throws(() => mismatchedTransport.bindClientEndpoints(
				agentHostConnectionId,
				exactContent,
				foreignTools,
			), isConnectionMismatch);
		} finally {
			exactTools.dispose();
			foreignTools.dispose();
			mismatchedTransport.dispose();
		}
		const connection = await stage('Remote Server connection creation', RemoteAgentHostConnection.create(
			new RemoteServerAgentHostTransport(clientConnection),
			connectionOptions,
		));
		try {
			await exerciseRoute(
				connection,
				host,
				contentRouter,
				toolRegistry,
				toolEndpoints,
				async () => {
					server.loseTransport(remoteClient);
					assert.equal(clientConnection.state, 'reconnecting');
					await clientConnection.reconnect();
				},
			);
			assert.equal(clientConnection.generation, 2);
			assert.equal(authorityConnections, 1);
			assert.equal(server.acceptedConnectionCount, 1);
		} finally {
			connection.dispose();
			binding.dispose();
			clientConnection.dispose();
			server.dispose();
		}
	});

	test('binds the Agent Host protocol across contiguous Remote Tunnel relay generations', async () => {
		const scheduler = new ImmediateTunnelScheduler();
		const product = createMockRemoteTunnelProduct({
			provider: 'mockTunnel',
			maximumFrameBytes: 16 * 1024 * 1024,
			maximumRetainedOperations: 32,
			maximumCredentialReferences: 32,
			maximumLogicalConnections: 32,
			scheduler,
			logicalConnectionGracePeriodMilliseconds: 60_000,
		});
		const products = new RemoteTunnelProductRegistry();
		const productRegistration = products.register(product.product);
		const account = createRemoteTunnelAccountIdentity('mockTunnel', 'account');
		product.authentication.authorize(account);
		const tunnelIdentity = createRemoteTunnelIdentity(
			'mockTunnel',
			'account',
			'agent-host-tunnel',
			'cluster',
		);
		const tunnelService = new RemoteTunnelService(
			products,
			scheduler,
			{
				maximumFrameBytes: 16 * 1024 * 1024,
				maximumActiveConnections: 32,
				maximumRetainedConnectionIdentities: 32,
			},
		);
		const hostService = new RemoteTunnelHostService(products, scheduler, {
			maximumRetainedOperations: 32,
			maximumPendingConnections: 32,
			maximumActiveConnections: 32,
			maximumRetainedConnectionIdentities: 32,
			connectionGracePeriodMilliseconds: 60_000,
		});
		const descriptor = await tunnelService.createTunnel(Object.freeze({
			identity: tunnelIdentity,
			displayName: 'Agent Host test',
			visibility: 'private',
			mutation: Object.freeze({
				kind: 'createTunnel',
				operation: createRemoteTunnelOperationId('create-agent-host-tunnel'),
				target: Object.freeze({ kind: 'tunnel', identity: tunnelIdentity }),
				valueDigest: await computeRemoteTunnelMutationValueDigest({
					kind: 'createTunnel',
					displayName: 'Agent Host test',
					visibility: 'private',
				}),
			}),
		}));
		const endpointIdentity = createRemoteTunnelEndpointIdentity(
			'mockTunnel',
			'account',
			'agent-host-tunnel',
			'cluster',
			'agent-host',
		);
		const tunnelProtocol = createRemoteTunnelProtocolRevision(remoteAgentHostTunnelProtocolRevision);
		const endpointPublication = Object.freeze({
			identity: endpointIdentity,
			kind: AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocol: Object.freeze({ minimum: tunnelProtocol, maximum: tunnelProtocol }),
			connectionScope: 'privateAuthenticated' as const,
			capabilities: Object.freeze([]),
		});
		const startRequest = Object.freeze({
			endpoint: endpointPublication,
			mutation: Object.freeze({
				kind: 'startHosting' as const,
				operation: createRemoteTunnelOperationId('host-agent-host-endpoint'),
				target: Object.freeze({ kind: 'endpoint' as const, identity: endpointIdentity }),
				expectedRevision: descriptor.revision,
				valueDigest: await computeRemoteTunnelMutationValueDigest({
					kind: 'startHosting',
					endpoint: endpointPublication,
				}),
			}),
		});
		const host = new TestAgentHostConnection();
		const contentRouter = new TestContentResourceRouter();
		const toolRegistry = new AgentToolRegistry();
		const toolEndpoints = new AgentToolEndpointRegistry();
		let authorityConnections = 0;
		let identityCreations = 0;
		const endpointCredential = createRemoteAgentHostEndpointCredential('remote-route-endpoint-secret');
		const authenticatedGenerations: number[] = [];
		const hostingOptions: IRemoteTunnelAgentHostHostingOptions = Object.freeze({
			authority: {
				createConnection: (connection: AgentHostClientConnectionId) => {
					authorityConnections += 1;
					assert.equal(connection, agentHostConnectionId);
					return host;
				},
			},
			identityFactory: {
				create: () => {
					identityCreations += 1;
					return agentHostConnectionId;
				},
			},
			contentResources: contentRouter,
			toolRegistry,
			toolEndpoints,
			authenticator: {
				authenticate: async (request: IRemoteAgentHostEndpointAuthenticationRequest) => {
					authenticatedGenerations.push(request.generation);
					return request.credential === endpointCredential
						? RemoteAgentHostEndpointAuthenticationResult.Authenticated
						: RemoteAgentHostEndpointAuthenticationResult.Rejected;
				},
			},
			scheduler,
			authenticationTimeoutMilliseconds: 10_000,
			logicalConnectionGracePeriodMilliseconds: 60_000,
			maximumLogicalConnections: 32,
			maximumRetainedLogicalConnectionIdentities: 32,
		});
		const hosting = await RemoteTunnelAgentHostHostingBinding.start(hostService, startRequest, hostingOptions);
		const tunnelConnection = await tunnelService.connect(Object.freeze({
			endpoint: endpointIdentity,
			kind: AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			protocol: Object.freeze({ minimum: tunnelProtocol, maximum: tunnelProtocol }),
			connection: createRemoteTunnelClientConnectionId('agent-host-client'),
			reconnect: Object.freeze({
				maximumAttempts: 2,
				initialDelayMilliseconds: 1,
				maximumDelayMilliseconds: 1,
				gracePeriodMilliseconds: 60_000,
			}),
		}));
		const transport = await stage('Remote Tunnel endpoint authentication', RemoteTunnelAgentHostTransport.create(
			tunnelConnection,
			Object.freeze({
				credential: endpointCredential,
				scheduler,
				authenticationTimeoutMilliseconds: 10_000,
			}),
			CancellationTokenNone,
		));
		const connection = await stage('Remote Tunnel connection creation', RemoteAgentHostConnection.create(
			transport,
			connectionOptions,
		));
		try {
			await exerciseRoute(
				connection,
				host,
				contentRouter,
				toolRegistry,
				toolEndpoints,
				async restored => {
					product.provider.loseConnections(endpointIdentity);
					await restored.p;
				},
			);
			assert.equal(tunnelConnection.generation, 2);
			assert.equal(product.provider.getRelayConnectCount(), 2);
			assert.equal(authorityConnections, 1);
			assert.equal(identityCreations, 1);
			assert.deepStrictEqual(authenticatedGenerations, [1, 2]);
		} finally {
			connection.dispose();
			hosting.dispose();
			hostService.dispose();
			tunnelService.dispose();
			productRegistration.dispose();
			products.dispose();
			product.provider.dispose();
		}
	});
});
