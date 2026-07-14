/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { DeferredPromise } from 'cs/base/common/async';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable, toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import {
	createRemoteServerAgentHostAddress,
	type IRemoteServerAgentHostAddress,
} from 'cs/platform/agentHost/common/remoteAgentHostAddress';
import {
	decodeRemoteAgentHostProtocolPayload,
	encodeRemoteAgentHostProtocolSuccess,
	RemoteAgentHostProtocolCommand,
	remoteAgentHostProtocolActionEvent,
	remoteServerAgentHostCapability,
	remoteServerAgentHostChannelName,
} from 'cs/platform/agentHost/common/remoteProtocol';
import {
	createAgentHostAuthorityId,
	createAgentHostChannelRevision,
	createAgentHostClientConnectionId,
	createAgentHostProtocolVersion,
	createAgentHostSequence,
} from 'cs/platform/agentHost/common/identities';
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
	createRemoteAuthority,
	createRemoteCapabilityId,
	createRemoteClientId,
	createRemoteConnectionGeneration,
	createRemoteProtocolVersion,
	createRemoteServerInstanceId,
	type IRemoteAuthority,
} from 'cs/platform/remote/common/remoteAuthority';
import type {
	IRemoteChannel,
	IRemoteChannelListener,
	IRemoteChannelServer,
	RemoteValue,
} from 'cs/platform/remote/common/remoteChannels';
import type {
	IRemoteConnectionStateChange,
	IRemoteServerConnection,
	RemoteConnectionState,
} from 'cs/platform/remote/common/remoteConnection';
import type { IRemoteEnvironment } from 'cs/platform/remote/common/remoteEnvironment';
import { RemoteError, RemoteErrorCode } from 'cs/platform/remote/common/remoteErrors';
import {
	initializeRemoteServerAgentHostSessionsContribution,
} from 'cs/sessions/contrib/providers/agentHost/browser/remoteServerAgentHost';
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
import type {
	IRemoteServerSelection,
	IRemoteServerService,
} from 'cs/workbench/services/remote/common/remoteServerService';
import { getLocaleMessages } from 'language/i18n';

const remoteAuthority = createRemoteAuthority('mock', 'agent-host.server');
const remoteClient = createRemoteClientId('agent-host.client');
const remoteProtocolVersion = createRemoteProtocolVersion('1');
const agentHostAuthority = createAgentHostAuthorityId('remote-route-test');
const agentHostConnection = createAgentHostClientConnectionId('remote-route-client');
const hostSequence = createAgentHostSequence(1);
const channelRevision = createAgentHostChannelRevision(1);
const rootChannel = getAgentHostRootChannelId();
const sessionsChannel = getAgentHostSessionsChannelId();

const contributionOptions = Object.freeze({
	implementation: Object.freeze({ name: 'remote-server-route-test', build: '1' }),
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
});

const rootState: IAgentHostRootState = Object.freeze({
	authority: agentHostAuthority,
	label: Object.freeze({ kind: 'literal', value: 'Remote Server Agent Host' }),
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

class TestRemoteChannelListener extends Disposable implements IRemoteChannelListener {
	private readonly receiveEmitter = this._register(new EventEmitter<RemoteValue>());
	private readonly errorEmitter = this._register(new EventEmitter<RemoteError>());
	readonly onDidReceive = this.receiveEmitter.event;
	readonly onDidError = this.errorEmitter.event;

	constructor(private readonly release: () => void) {
		super();
	}

	override dispose(): void {
		this.release();
		super.dispose();
	}
}

class TestAgentHostRemoteChannel implements IRemoteChannel {
	readonly initializeStarted = new DeferredPromise<void>();
	readonly initializeRelease = new DeferredPromise<void>();
	readonly initializeRequests: IAgentHostInitializeRequest[] = [];
	initializeFailure: Error | undefined;
	private readonly actionListeners = new Set<TestRemoteChannelListener>();

	constructor(blockInitialize: boolean) {
		if (!blockInitialize) {
			this.initializeRelease.complete();
		}
	}

	get activeActionListenerCount(): number {
		return this.actionListeners.size;
	}

	async call<TResult extends RemoteValue = RemoteValue>(
		command: string,
		argument?: RemoteValue,
		_cancellation?: CancellationToken,
	): Promise<TResult> {
		switch (command) {
			case RemoteAgentHostProtocolCommand.Identity:
				assert.equal(argument, undefined);
				return encodeRemoteAgentHostProtocolSuccess(Object.freeze({
					authority: agentHostAuthority,
					connection: agentHostConnection,
				})) as TResult;
			case RemoteAgentHostProtocolCommand.Initialize: {
				assert.equal(typeof argument, 'string');
				const request = decodeRemoteAgentHostProtocolPayload(argument as string) as unknown as IAgentHostInitializeRequest;
				this.initializeRequests.push(request);
				this.initializeStarted.complete();
				await this.initializeRelease.p;
				if (this.initializeFailure !== undefined) {
					throw this.initializeFailure;
				}
				assert.equal(request.connection, agentHostConnection);
				assert.deepStrictEqual(request.protocolVersions, [createAgentHostProtocolVersion('2')]);
				assert.deepStrictEqual(request.subscriptions, [rootChannel, sessionsChannel]);
				const result: IAgentHostInitializeResult = Object.freeze({
					protocolVersion: createAgentHostProtocolVersion('2'),
					capabilities: Object.freeze([]),
					implementation: Object.freeze({ name: 'remote-server-test-host', build: '1' }),
					hostSequence,
					snapshots: createSnapshots(request.subscriptions),
					missingChannels: Object.freeze([]),
				});
				return encodeRemoteAgentHostProtocolSuccess(result) as TResult;
			}
			case RemoteAgentHostProtocolCommand.SetSubscriptions: {
				assert.equal(typeof argument, 'string');
				const request = decodeRemoteAgentHostProtocolPayload(argument as string) as unknown as IAgentHostSetSubscriptionsRequest;
				const result: IAgentHostSetSubscriptionsResult = Object.freeze({
					hostSequence,
					snapshots: createSnapshots(request.subscriptions),
					missingChannels: Object.freeze([]),
				});
				return encodeRemoteAgentHostProtocolSuccess(result) as TResult;
			}
			default:
				throw new RemoteError(RemoteErrorCode.CommandMissing, 'Test Agent Host command is not registered', {
					command,
				});
		}
	}

	listen(event: string, argument?: RemoteValue): IRemoteChannelListener {
		if (event !== remoteAgentHostProtocolActionEvent || argument !== undefined) {
			throw new RemoteError(RemoteErrorCode.EventMissing, 'Test Agent Host event is not registered', {
				event,
			});
		}
		let listener: TestRemoteChannelListener;
		listener = new TestRemoteChannelListener(() => this.actionListeners.delete(listener));
		this.actionListeners.add(listener);
		return listener;
	}
}

class TestRemoteServerConnection extends Disposable implements IRemoteServerConnection {
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteConnectionStateChange>());
	private readonly reverseChannels = new Map<string, IRemoteChannelServer>();
	private currentState: RemoteConnectionState = 'connected';
	readonly client = remoteClient;
	readonly server = createRemoteServerInstanceId('agent-host.server.instance');
	readonly generation = createRemoteConnectionGeneration(1);
	readonly environment: IRemoteEnvironment;
	readonly onDidChangeState = this.stateEmitter.event;
	endCount = 0;
	disposeCount = 0;

	constructor(
		readonly authority: IRemoteAuthority,
		readonly agentHostChannel: TestAgentHostRemoteChannel,
		capabilities: readonly ReturnType<typeof createRemoteCapabilityId>[],
	) {
		super();
		this.environment = Object.freeze({
			protocolVersion: remoteProtocolVersion,
			operatingSystem: 'linux',
			architecture: 'x64',
			userHome: '/home/comet',
			temporaryDirectory: '/tmp',
			storageDirectory: '/home/comet/.comet',
			pathCasePolicy: 'sensitive',
			capabilities: Object.freeze([...capabilities]),
			limits: Object.freeze({
				maximumFrameBytes: 64 * 1_024,
				maximumPendingCalls: 32,
				maximumEventListeners: 32,
			}),
		});
	}

	get state(): RemoteConnectionState {
		return this.currentState;
	}

	get activeReverseChannelCount(): number {
		return this.reverseChannels.size;
	}

	getChannel(name: string): IRemoteChannel {
		if (name !== remoteServerAgentHostChannelName) {
			throw new RemoteError(RemoteErrorCode.ChannelMissing, 'Test Remote channel is not registered', { name });
		}
		return this.agentHostChannel;
	}

	registerChannel(name: string, channel: IRemoteChannelServer): IDisposable {
		if (this.reverseChannels.has(name)) {
			throw new RemoteError(RemoteErrorCode.DuplicateChannel, 'Test reverse channel is already registered', { name });
		}
		this.reverseChannels.set(name, channel);
		return toDisposable(() => {
			if (this.reverseChannels.get(name) === channel) {
				this.reverseChannels.delete(name);
			}
		});
	}

	reconnect(): Promise<void> {
		throw new Error('Test Remote Server connection is not reconnecting.');
	}

	async end(): Promise<void> {
		this.endCount += 1;
		if (this.currentState === 'connected') {
			this.currentState = 'terminal';
			this.stateEmitter.fire(Object.freeze({ state: this.currentState, generation: this.generation }));
		}
	}

	override dispose(): void {
		this.disposeCount += 1;
		this.currentState = 'disposed';
		super.dispose();
	}
}

class TestRemoteServerService implements IRemoteServerService {
	declare readonly _serviceBrand: undefined;
	private connected = false;
	connectCount = 0;
	disconnectCount = 0;

	constructor(
		readonly selection: IRemoteServerSelection,
		private readonly returnedConnection: IRemoteServerConnection,
		private readonly publishedConnection: IRemoteServerConnection | undefined,
		private readonly publishedEnvironment: IRemoteEnvironment | undefined,
	) {}

	get connection(): IRemoteServerConnection | undefined {
		return this.connected ? this.publishedConnection : undefined;
	}

	get environment(): IRemoteEnvironment | undefined {
		return this.connected ? this.publishedEnvironment : undefined;
	}

	async connect(): Promise<IRemoteServerConnection> {
		this.connectCount += 1;
		this.connected = true;
		return this.returnedConnection;
	}

	async disconnect(): Promise<void> {
		this.disconnectCount += 1;
		await this.returnedConnection.end();
	}
}

function createSelection(authority: IRemoteAuthority): IRemoteServerSelection {
	return Object.freeze({
		authority,
		client: remoteClient,
		protocolVersions: Object.freeze([remoteProtocolVersion]),
		productCommit: 'test-commit',
		locale: 'en-US',
		profile: 'default',
	});
}

function createService(
	connection: TestRemoteServerConnection,
	selectionAuthority: IRemoteAuthority,
): TestRemoteServerService {
	return new TestRemoteServerService(
		createSelection(selectionAuthority),
		connection,
		connection,
		connection.environment,
	);
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

suite('Remote Server Agent Host Sessions contribution', { concurrency: false }, () => {
	test('rejects a closed-address or selected-authority mismatch before Remote Server connect', async () => {
		const channel = new TestAgentHostRemoteChannel(false);
		const connection = new TestRemoteServerConnection(
			remoteAuthority,
			channel,
			[remoteServerAgentHostCapability],
		);
		const mismatchedService = createService(
			connection,
			createRemoteAuthority('mock', 'another.server'),
		);
		const address = createRemoteServerAgentHostAddress(remoteAuthority, remoteServerAgentHostCapability);

		await assert.rejects(
			initializeRemoteServerAgentHostSessionsContribution(address, mismatchedService, contributionOptions),
			(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ConnectionMismatch,
		);
		assert.equal(mismatchedService.connectCount, 0);

		const malformedAddress = Object.freeze({ ...address, extra: true }) as IRemoteServerAgentHostAddress;
		const matchingService = createService(connection, remoteAuthority);
		await assert.rejects(
			initializeRemoteServerAgentHostSessionsContribution(malformedAddress, matchingService, contributionOptions),
			/Invalid Remote Agent Host address/,
		);
		assert.equal(matchingService.connectCount, 0);
	});

	test('rejects a non-Agent-Host address capability before Remote Server connect', async () => {
		const channel = new TestAgentHostRemoteChannel(false);
		const connection = new TestRemoteServerConnection(
			remoteAuthority,
			channel,
			[remoteServerAgentHostCapability],
		);
		const service = createService(connection, remoteAuthority);
		const address = Object.freeze({
			kind: 'remoteServer' as const,
			authority: remoteAuthority,
			capability: createRemoteCapabilityId('anotherCapability'),
		}) as IRemoteServerAgentHostAddress;

		await assert.rejects(
			initializeRemoteServerAgentHostSessionsContribution(address, service, contributionOptions),
			/Invalid Remote Agent Host address/,
		);
		assert.equal(service.connectCount, 0);
	});

	test('does not register a provider when the connected environment omits Agent Host', async () => {
		const fixture = registerSessionsFixture();
		try {
			const channel = new TestAgentHostRemoteChannel(false);
			const connection = new TestRemoteServerConnection(
				remoteAuthority,
				channel,
				[createRemoteCapabilityId('channels')],
			);
			const service = createService(connection, remoteAuthority);
			const address = createRemoteServerAgentHostAddress(remoteAuthority, remoteServerAgentHostCapability);

			await assert.rejects(
				initializeRemoteServerAgentHostSessionsContribution(address, service, contributionOptions),
				(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ChannelMissing,
			);
			assert.equal(service.connectCount, 1);
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.equal(channel.activeActionListenerCount, 0);
			assert.equal(connection.activeReverseChannelCount, 0);
			assert.equal(connection.endCount, 0);
			assert.equal(connection.disposeCount, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('rejects a connected service state mismatch before provider registration', async () => {
		const fixture = registerSessionsFixture();
		try {
			const channel = new TestAgentHostRemoteChannel(false);
			const connection = new TestRemoteServerConnection(
				remoteAuthority,
				channel,
				[remoteServerAgentHostCapability],
			);
			const service = new TestRemoteServerService(
				createSelection(remoteAuthority),
				connection,
				undefined,
				connection.environment,
			);
			const address = createRemoteServerAgentHostAddress(remoteAuthority, remoteServerAgentHostCapability);

			await assert.rejects(
				initializeRemoteServerAgentHostSessionsContribution(address, service, contributionOptions),
				(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ConnectionMismatch,
			);
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.equal(channel.activeActionListenerCount, 0);
			assert.equal(connection.activeReverseChannelCount, 0);
			assert.equal(connection.endCount, 0);
			assert.equal(connection.disposeCount, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('registers the common provider only after exact Host negotiation and releases only route resources', async () => {
		const fixture = registerSessionsFixture();
		const channel = new TestAgentHostRemoteChannel(true);
		const connection = new TestRemoteServerConnection(
			remoteAuthority,
			channel,
			[remoteServerAgentHostCapability],
		);
		const service = createService(connection, remoteAuthority);
		const address = createRemoteServerAgentHostAddress(remoteAuthority, remoteServerAgentHostCapability);
		try {
			const starting = initializeRemoteServerAgentHostSessionsContribution(address, service, contributionOptions);
			await channel.initializeStarted.p;
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.equal(connection.activeReverseChannelCount, 2);

			channel.initializeRelease.complete();
			await starting;
			assert.equal(service.connectCount, 1);
			assert.equal(channel.initializeRequests.length, 1);
			assert.equal(channel.activeActionListenerCount, 1);
			assert.equal(fixture.providers.getProviders().length, 1);
			const provider = fixture.providers.getProviders()[0];
			assert.equal(provider.label, 'Remote Server Agent Host');

			fixture.dispose();
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.throws(() => provider.getSessions(), /is disposed/);
			assert.equal(channel.activeActionListenerCount, 0);
			assert.equal(connection.activeReverseChannelCount, 0);
			assert.equal(connection.state, 'connected');
			assert.equal(connection.endCount, 0);
			assert.equal(connection.disposeCount, 0);
			assert.equal(service.disconnectCount, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('cleans route resources when Host negotiation fails without ending the Remote Server connection', async () => {
		const fixture = registerSessionsFixture();
		try {
			const channel = new TestAgentHostRemoteChannel(false);
			channel.initializeFailure = new RemoteError(RemoteErrorCode.ProtocolViolation, 'Host negotiation failed');
			const connection = new TestRemoteServerConnection(
				remoteAuthority,
				channel,
				[remoteServerAgentHostCapability],
			);
			const service = createService(connection, remoteAuthority);
			const address = createRemoteServerAgentHostAddress(remoteAuthority, remoteServerAgentHostCapability);

			await assert.rejects(
				initializeRemoteServerAgentHostSessionsContribution(address, service, contributionOptions),
				(error: Error) => error instanceof RemoteError && error.code === RemoteErrorCode.ProtocolViolation,
			);
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.equal(channel.activeActionListenerCount, 0);
			assert.equal(connection.activeReverseChannelCount, 0);
			assert.equal(connection.state, 'connected');
			assert.equal(connection.endCount, 0);
			assert.equal(connection.disposeCount, 0);
			assert.equal(service.disconnectCount, 0);
		} finally {
			fixture.dispose();
		}
	});

	test('unregisters and disposes the common provider when the service-owned Remote Server connection becomes terminal', async () => {
		const fixture = registerSessionsFixture();
		try {
			const channel = new TestAgentHostRemoteChannel(false);
			const connection = new TestRemoteServerConnection(
				remoteAuthority,
				channel,
				[remoteServerAgentHostCapability],
			);
			const service = createService(connection, remoteAuthority);
			const address = createRemoteServerAgentHostAddress(remoteAuthority, remoteServerAgentHostCapability);
			await initializeRemoteServerAgentHostSessionsContribution(address, service, contributionOptions);
			const provider = fixture.providers.getProviders()[0];
			assert.ok(provider);

			await connection.end();
			assert.equal(fixture.providers.getProviders().length, 0);
			assert.throws(() => provider.getSessions(), /is disposed/);
			assert.equal(channel.activeActionListenerCount, 0);
			assert.equal(connection.activeReverseChannelCount, 0);
			assert.equal(connection.endCount, 1);
			assert.equal(connection.disposeCount, 0);
			assert.equal(service.disconnectCount, 0);
		} finally {
			fixture.dispose();
		}
	});
});
