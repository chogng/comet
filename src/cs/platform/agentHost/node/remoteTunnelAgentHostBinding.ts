/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationTokenSource,
	CancellationTokenNone,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable, DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import type { IAgentHostInteractionTarget } from '../common/attachments.js';
import {
	type IAgentContentBlobReadRequest,
	type IAgentContentBlobReadResult,
	type IAgentContentResourceLease,
	type IAgentContentResourceReaderOpenRequest,
	type IAgentContentResourceReaderPort,
	type IAgentContentTreeEntryReadRequest,
	type IAgentContentTreePage,
	type IAgentContentTreePageRequest,
	assertAgentContentBlobReadRequest,
	assertAgentContentBlobReadResultShape,
	assertAgentContentResourceLease,
	assertAgentContentResourceReaderOpenRequest,
	assertAgentContentTreeEntryReadRequest,
	assertAgentContentTreePage,
	assertAgentContentTreePageRequest,
} from '../common/contentResources.js';
import { AgentHostError, AgentHostErrorCode } from '../common/errors.js';
import {
	createAgentContentLeaseId,
	createAgentHostClientConnectionId,
	type AgentContentLeaseId,
	type AgentHostClientConnectionId,
} from '../common/identities.js';
import {
	remoteAgentHostProtocolActionEvent,
	remoteAgentHostProtocolProgressEvent,
	type RemoteAgentHostProtocolCommand,
} from '../common/remoteProtocol.js';
import {
	RemoteAgentHostTunnelProtocolPeer,
	type IRemoteAgentHostTunnelEvent,
} from '../common/remoteTunnelProtocolPeer.js';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointAuthenticationRequest,
	decodeRemoteAgentHostEndpointAuthenticationMessage,
	encodeRemoteAgentHostEndpointAuthenticationResult,
	validateRemoteAgentHostEndpointAuthenticationResult,
	validateRemoteAgentHostEndpointAuthenticationTimeout,
	validateRemoteAgentHostTunnelGracePeriod,
	type IRemoteAgentHostEndpointAuthenticator,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostEndpointCredential,
} from '../common/remoteTunnelAuthentication.js';
import {
	isRemoteAgentHostProtocolCommand,
	remoteAgentHostTunnelProtocolRevision,
} from '../common/remoteTunnelProtocol.js';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from '../common/protocolValues.js';
import {
	type AgentToolEndpointReconciliation,
	type AgentToolResult,
	type IAgentClientToolInvocation,
	type IAgentClientToolPublicationSnapshot,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	type IAgentToolProgress,
	assertAgentClientToolInvocation,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
} from '../common/tools.js';
import type { IAgentContentResourceClientRouter } from './content/agentContentResourceService.js';
import type { AgentHostAuthority } from './host/agentHostAuthority.js';
import {
	RemoteAgentHostProtocolServer,
	type IRemoteAgentHostClientToolPublication,
} from './remoteAgentHostProtocolServer.js';
import { AgentClientToolPublication } from './tools/agentClientToolPublication.js';
import { AgentToolEndpointRegistry } from './tools/agentToolExecution.js';
import { AgentToolRegistry } from './tools/agentToolRegistry.js';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	isEqualRemoteTunnelEndpoint,
	remoteTunnelEndpointIdentityKey,
	validateRemoteTunnelConnectionIdentity,
	validateRemoteTunnelEndpointDescriptor,
	type IRemoteTunnelConnectionIdentity,
	type IRemoteTunnelEndpointStream,
	type IRemoteTunnelHostingLease,
	type IRemoteTunnelHostService,
	type IRemoteTunnelStartHostingRequest,
	type IRemoteTunnelStreamClose,
	type RemoteTunnelTransportGeneration,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteTunnelError, RemoteTunnelErrorCode } from 'cs/platform/tunnel/common/remoteTunnelErrors';

function protocolValue(value: object): AgentHostProtocolValue {
	assertAgentHostProtocolValue(value);
	return value as unknown as AgentHostProtocolValue;
}

function invalidProtocol(field: string, value: string | number): AgentHostError {
	return new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Remote Tunnel Agent Host protocol value',
		{ field, value },
	);
}

function connectionKey(identity: IRemoteTunnelConnectionIdentity): string {
	const validated = validateRemoteTunnelConnectionIdentity(identity);
	return `${remoteTunnelEndpointIdentityKey(validated)}\u0000${validated.connection}`;
}

export interface IRemoteTunnelAgentHostConnectionIdentityFactory {
	create(identity: IRemoteTunnelConnectionIdentity): AgentHostClientConnectionId;
}

export interface IRemoteTunnelAgentHostHostingOptions {
	readonly authority: Pick<AgentHostAuthority, 'createConnection'>;
	readonly identityFactory: IRemoteTunnelAgentHostConnectionIdentityFactory;
	readonly contentResources: IAgentContentResourceClientRouter;
	readonly toolRegistry: AgentToolRegistry;
	readonly toolEndpoints: AgentToolEndpointRegistry;
	readonly authenticator: IRemoteAgentHostEndpointAuthenticator;
	readonly scheduler: IRemoteAgentHostTunnelScheduler;
	readonly authenticationTimeoutMilliseconds: number;
	readonly logicalConnectionGracePeriodMilliseconds: number;
	readonly maximumLogicalConnections: number;
	readonly maximumRetainedLogicalConnectionIdentities: number;
}

const maximumRemoteTunnelAgentHostLogicalConnections = 4_096;
const maximumRemoteTunnelAgentHostRetainedLogicalConnectionIdentities = 65_536;

function invalidHostingOptions(): RemoteAgentHostEndpointAuthenticationError {
	return new RemoteAgentHostEndpointAuthenticationError(
		RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
	);
}

function validateHostingOptions(
	options: IRemoteTunnelAgentHostHostingOptions,
): IRemoteTunnelAgentHostHostingOptions {
	const expected = [
		'authority',
		'identityFactory',
		'contentResources',
		'toolRegistry',
		'toolEndpoints',
		'authenticator',
		'scheduler',
		'authenticationTimeoutMilliseconds',
		'logicalConnectionGracePeriodMilliseconds',
		'maximumLogicalConnections',
		'maximumRetainedLogicalConnectionIdentities',
	] as const;
	try {
		if (options === null || typeof options !== 'object' || Array.isArray(options)) {
			throw invalidHostingOptions();
		}
		const prototype = Object.getPrototypeOf(options);
		const keys = Reflect.ownKeys(options);
		if ((prototype !== Object.prototype && prototype !== null)
			|| keys.length !== expected.length
			|| keys.some(key => typeof key !== 'string' || !expected.includes(key as typeof expected[number]))) {
			throw invalidHostingOptions();
		}
		const values = new Map<typeof expected[number], unknown>();
		for (const key of expected) {
			const descriptor = Object.getOwnPropertyDescriptor(options, key);
			if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw invalidHostingOptions();
			}
			values.set(key, descriptor.value);
		}
		const authority = values.get('authority') as IRemoteTunnelAgentHostHostingOptions['authority'];
		const identityFactory = values.get('identityFactory') as IRemoteTunnelAgentHostConnectionIdentityFactory;
		const contentResources = values.get('contentResources') as IAgentContentResourceClientRouter;
		const toolRegistry = values.get('toolRegistry') as AgentToolRegistry;
		const toolEndpoints = values.get('toolEndpoints') as AgentToolEndpointRegistry;
		const authenticator = values.get('authenticator') as IRemoteAgentHostEndpointAuthenticator;
		const scheduler = values.get('scheduler') as IRemoteAgentHostTunnelScheduler;
		const authenticationTimeoutMilliseconds = values.get('authenticationTimeoutMilliseconds');
		const logicalConnectionGracePeriodMilliseconds = values.get('logicalConnectionGracePeriodMilliseconds');
		const maximumLogicalConnections = values.get('maximumLogicalConnections');
		const maximumRetainedLogicalConnectionIdentities = values.get(
			'maximumRetainedLogicalConnectionIdentities',
		);
		if (
			authority === null
			|| (typeof authority !== 'object' && typeof authority !== 'function')
			|| typeof authority.createConnection !== 'function'
			|| identityFactory === null
			|| (typeof identityFactory !== 'object' && typeof identityFactory !== 'function')
			|| typeof identityFactory.create !== 'function'
			|| contentResources === null
			|| (typeof contentResources !== 'object' && typeof contentResources !== 'function')
			|| typeof contentResources.bindClientReader !== 'function'
			|| toolRegistry === null
			|| typeof toolRegistry !== 'object'
			|| toolEndpoints === null
			|| typeof toolEndpoints !== 'object'
			|| authenticator === null
			|| (typeof authenticator !== 'object' && typeof authenticator !== 'function')
			|| typeof authenticator.authenticate !== 'function'
			|| scheduler === null
			|| (typeof scheduler !== 'object' && typeof scheduler !== 'function')
			|| typeof scheduler.wait !== 'function'
			|| typeof authenticationTimeoutMilliseconds !== 'number'
			|| typeof logicalConnectionGracePeriodMilliseconds !== 'number'
			|| typeof maximumLogicalConnections !== 'number'
			|| typeof maximumRetainedLogicalConnectionIdentities !== 'number'
			|| !Number.isSafeInteger(maximumLogicalConnections)
			|| maximumLogicalConnections < 1
			|| maximumLogicalConnections > maximumRemoteTunnelAgentHostLogicalConnections
			|| !Number.isSafeInteger(maximumRetainedLogicalConnectionIdentities)
			|| maximumRetainedLogicalConnectionIdentities < maximumLogicalConnections
			|| maximumRetainedLogicalConnectionIdentities
				> maximumRemoteTunnelAgentHostRetainedLogicalConnectionIdentities
		) {
			throw invalidHostingOptions();
		}
		return Object.freeze({
			authority,
			identityFactory,
			contentResources,
			toolRegistry,
			toolEndpoints,
			authenticator,
			scheduler,
			authenticationTimeoutMilliseconds: validateRemoteAgentHostEndpointAuthenticationTimeout(
				authenticationTimeoutMilliseconds,
			),
			logicalConnectionGracePeriodMilliseconds: validateRemoteAgentHostTunnelGracePeriod(
				logicalConnectionGracePeriodMilliseconds,
			),
			maximumLogicalConnections,
			maximumRetainedLogicalConnectionIdentities,
		});
	} catch (error) {
		if (error instanceof RemoteAgentHostEndpointAuthenticationError) {
			throw error;
		}
		throw invalidHostingOptions();
	}
}

class RemoteTunnelClientContentResourceReader implements IAgentContentResourceReaderPort {
	constructor(private readonly peer: RemoteAgentHostTunnelProtocolPeer) {}

	async open(
		request: IAgentContentResourceReaderOpenRequest,
		token: CancellationToken,
	): Promise<IAgentContentResourceLease> {
		assertAgentContentResourceReaderOpenRequest(request);
		const result = await this.peer.call('clientContent', 'open', protocolValue(request), token);
		assertAgentContentResourceLease(result, request);
		return result;
	}

	async readBlob(
		request: IAgentContentBlobReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentBlobReadRequest(request);
		const result = await this.peer.call('clientContent', 'readBlob', protocolValue(request), token);
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}

	async readTreePage(
		request: IAgentContentTreePageRequest,
		token: CancellationToken,
	): Promise<IAgentContentTreePage> {
		assertAgentContentTreePageRequest(request);
		const result = await this.peer.call('clientContent', 'readTreePage', protocolValue(request), token);
		assertAgentContentTreePage(result, request);
		return result;
	}

	async readTreeEntry(
		request: IAgentContentTreeEntryReadRequest,
		token: CancellationToken,
	): Promise<IAgentContentBlobReadResult> {
		assertAgentContentTreeEntryReadRequest(request);
		const result = await this.peer.call('clientContent', 'readTreeEntry', protocolValue(request), token);
		assertAgentContentBlobReadResultShape(result, request);
		return result;
	}

	async release(lease: AgentContentLeaseId, token: CancellationToken): Promise<void> {
		createAgentContentLeaseId(lease);
		const result = await this.peer.call('clientContent', 'release', lease, token);
		if (result !== null) {
			throw invalidProtocol('clientContent.release.result', typeof result);
		}
	}
}

class RemoteTunnelClientAgentToolEndpoint extends Disposable implements IAgentToolExecutorEndpoint {
	private readonly activeProgress = new Map<string, (progress: IAgentToolProgress) => void>();

	constructor(
		private readonly peer: RemoteAgentHostTunnelProtocolPeer,
		private readonly failProtocol: (error: unknown) => void,
	) {
		super();
		this._register(peer.onDidReceiveEvent(event => this.receiveEvent(event)));
	}

	async execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult> {
		assertAgentToolCall(call);
		const invocation: IAgentClientToolInvocation = Object.freeze({
			call,
			...(target === undefined ? {} : { target }),
		});
		assertAgentClientToolInvocation(invocation);
		if (this.activeProgress.has(call.id)) {
			throw invalidProtocol('clientTools.execute.call', call.id);
		}
		this.activeProgress.set(call.id, reportProgress);
		try {
			const result = await this.peer.call('clientTools', 'execute', protocolValue(invocation), cancellation);
			assertAgentToolResult(result);
			if (result.call !== call.id) {
				throw invalidProtocol('clientTools.execute.result.call', result.call);
			}
			return result;
		} finally {
			this.activeProgress.delete(call.id);
		}
	}

	async cancel(call: IAgentToolCall): Promise<void> {
		assertAgentToolCall(call);
		const result = await this.peer.call('clientTools', 'cancel', protocolValue(call), CancellationTokenNone);
		if (result !== null) {
			throw invalidProtocol('clientTools.cancel.result', typeof result);
		}
	}

	async reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation> {
		assertAgentToolCall(call);
		const value = await this.peer.call('clientTools', 'reconcile', protocolValue(call), CancellationTokenNone);
		const result: unknown = value;
		assertAgentToolEndpointReconciliation(result);
		if (result.kind === 'terminal' && result.result.call !== call.id) {
			throw invalidProtocol('clientTools.reconcile.result.call', result.result.call);
		}
		return result;
	}

	override dispose(): void {
		this.activeProgress.clear();
		super.dispose();
	}

	private receiveEvent(event: IRemoteAgentHostTunnelEvent): void {
		try {
			if (event.target !== 'clientTools' || event.name !== 'onDidProgress') {
				throw invalidProtocol('event', `${event.target}.${event.name}`);
			}
			assertAgentToolProgress(event.value);
			const progress = event.value as unknown as IAgentToolProgress;
			const report = this.activeProgress.get(progress.call);
			if (report === undefined) {
				throw invalidProtocol('clientTools.progress.call', progress.call);
			}
			report(progress);
		} catch (error) {
			this.failProtocol(error);
		}
	}
}

class RemoteTunnelClientToolPublication extends Disposable implements IRemoteAgentHostClientToolPublication {
	private readonly publication = this._register(new MutableDisposable<AgentClientToolPublication>());

	constructor(
		private readonly connection: AgentHostClientConnectionId,
		private readonly registrations: AgentToolRegistry,
		private readonly endpoints: AgentToolEndpointRegistry,
		private readonly endpoint: IAgentToolExecutorEndpoint,
	) {
		super();
	}

	synchronize(snapshot: IAgentClientToolPublicationSnapshot): void {
		if (this.publication.value === undefined) {
			this.publication.value = new AgentClientToolPublication(
				this.connection,
				this.registrations,
				this.endpoints,
				this.endpoint,
			);
		}
		this.publication.value.synchronize(snapshot);
	}
}

class RemoteTunnelAgentHostServerConnection extends Disposable {
	private readonly streamBinding = this._register(new MutableDisposable<DisposableStore>());
	private readonly authenticationFrameBinding = this._register(new MutableDisposable<DisposableStore>());
	private readonly materialization = this._register(new MutableDisposable<DisposableStore>());
	private stream: IRemoteTunnelEndpointStream | undefined;
	private peer: RemoteAgentHostTunnelProtocolPeer | undefined;
	private protocol: RemoteAgentHostProtocolServer | undefined;
	private agentHostConnectionValue: AgentHostClientConnectionId | undefined;
	private authenticationCancellation: CancellationTokenSource | undefined;
	private authenticationTimeoutCancellation: CancellationTokenSource | undefined;
	private graceExpiryCancellation: CancellationTokenSource | undefined;
	private currentGeneration = 0;
	private authenticatedGeneration = 0;
	private authenticationStarted = false;
	private authenticationResponding = false;
	private terminal = false;

	constructor(
		readonly key: string,
		readonly tunnelIdentity: IRemoteTunnelConnectionIdentity,
		private readonly options: IRemoteTunnelAgentHostHostingOptions,
		private readonly claimAgentHostConnection: (connection: AgentHostClientConnectionId) => boolean,
		private readonly onTerminal: (connection: RemoteTunnelAgentHostServerConnection) => void,
	) {
		super();
	}

	get agentHostConnection(): AgentHostClientConnectionId | undefined {
		return this.agentHostConnectionValue;
	}

	accept(stream: IRemoteTunnelEndpointStream): void {
		if (this.terminal || this.stream !== undefined) {
			this.rejectStream(stream);
			return;
		}
		let identity: IRemoteTunnelConnectionIdentity;
		try {
			identity = validateRemoteTunnelConnectionIdentity(stream.identity);
		} catch {
			this.rejectStream(stream);
			return;
		}
		if (
			connectionKey(identity) !== this.key
			|| stream.generation !== this.currentGeneration + 1
		) {
			this.rejectStream(stream);
			return;
		}
		const binding = new DisposableStore();
		binding.add(stream.onDidClose(reason => this.closeStream(stream, reason)));
		this.stream = stream;
		this.currentGeneration = stream.generation;
		this.streamBinding.value = binding;
		this.beginAuthentication(stream);
	}

	override dispose(): void {
		if (!this.terminal) {
			this.terminal = true;
			this.cancelAuthentication();
			this.cancelGraceExpiry();
			this.closeOwnedStream();
		}
		super.dispose();
	}

	private beginAuthentication(stream: IRemoteTunnelEndpointStream): void {
		const frameBinding = new DisposableStore();
		frameBinding.add(stream.onDidReceiveFrame(frame => this.receiveAuthenticationFrame(stream, frame)));
		const authenticationCancellation = new CancellationTokenSource();
		const timeoutCancellation = new CancellationTokenSource();
		this.authenticationStarted = false;
		this.authenticationResponding = false;
		this.authenticationCancellation = authenticationCancellation;
		this.authenticationTimeoutCancellation = timeoutCancellation;
		this.authenticationFrameBinding.value = frameBinding;
		let timeout: Promise<void>;
		try {
			timeout = this.options.scheduler.wait(Object.freeze({
				kind: 'endpointAuthenticationTimeout',
				owner: 'host',
				generation: stream.generation,
				delayMilliseconds: this.options.authenticationTimeoutMilliseconds,
			}), timeoutCancellation.token);
		} catch {
			this.authenticationTimedOut(stream, timeoutCancellation);
			return;
		}
		void timeout.then(
			() => this.authenticationTimedOut(stream, timeoutCancellation),
			() => {
				if (!timeoutCancellation.token.isCancellationRequested) {
					this.authenticationTimedOut(stream, timeoutCancellation);
				}
			},
		);
	}

	private receiveAuthenticationFrame(stream: IRemoteTunnelEndpointStream, frame: Uint8Array): void {
		if (this.stream !== stream || this.authenticationStarted || this.authenticationResponding) {
			this.rejectAuthentication(stream);
			return;
		}
		try {
			const message = decodeRemoteAgentHostEndpointAuthenticationMessage(frame);
			if (message.kind !== 'authenticate' || message.generation !== stream.generation) {
				this.rejectAuthentication(stream);
				return;
			}
			this.authenticationStarted = true;
			const cancellation = this.authenticationCancellation;
			if (cancellation === undefined) {
				this.rejectAuthentication(stream);
				return;
			}
			void this.authenticate(stream, message.credential, cancellation).catch(() => {
				this.rejectAuthentication(stream);
			});
		} catch {
			this.rejectAuthentication(stream);
		}
	}

	private async authenticate(
		stream: IRemoteTunnelEndpointStream,
		credential: RemoteAgentHostEndpointCredential,
		cancellation: CancellationTokenSource,
	): Promise<void> {
		let result: RemoteAgentHostEndpointAuthenticationResult;
		try {
			result = validateRemoteAgentHostEndpointAuthenticationResult(await this.options.authenticator.authenticate(
				createRemoteAgentHostEndpointAuthenticationRequest(
					stream.identity,
					stream.generation,
					credential,
				),
				cancellation.token,
			));
		} catch {
			if (!cancellation.token.isCancellationRequested) {
				this.rejectAuthentication(stream);
			}
			return;
		}
		if (
			cancellation.token.isCancellationRequested
			|| this.terminal
			|| this.stream !== stream
			|| this.currentGeneration !== stream.generation
		) {
			return;
		}
		if (result !== RemoteAgentHostEndpointAuthenticationResult.Authenticated) {
			this.rejectAuthentication(stream);
			return;
		}
		try {
			if (this.agentHostConnectionValue === undefined) {
				if (stream.generation !== 1) {
					this.rejectAuthentication(stream);
					return;
				}
				this.materialize();
			}
			const peer = this.peer;
			if (peer === undefined || this.protocol === undefined || peer.generation !== undefined) {
				this.rejectAuthentication(stream);
				return;
			}
			this.authenticationResponding = true;
			this.clearAuthenticationFrameAndAuthenticator();
			peer.attach(stream);
			this.authenticatedGeneration = stream.generation;
			await stream.send(encodeRemoteAgentHostEndpointAuthenticationResult(
				stream.generation,
				RemoteAgentHostEndpointAuthenticationResult.Authenticated,
			));
		} catch {
			this.terminate();
			return;
		}
		if (this.terminal || this.stream !== stream) {
			return;
		}
		this.clearAuthenticationTimeout();
		this.authenticationResponding = false;
		this.cancelGraceExpiry();
	}

	private materialize(): void {
		const agentHostConnection = createAgentHostClientConnectionId(
			this.options.identityFactory.create(this.tunnelIdentity),
		);
		if (!this.claimAgentHostConnection(agentHostConnection)) {
			throw new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Rejected,
			);
		}
		this.agentHostConnectionValue = agentHostConnection;
		const materialization = new DisposableStore();
		try {
			const peer = materialization.add(new RemoteAgentHostTunnelProtocolPeer({
				call: (target, command, argument, cancellation) => this.callHost(
					target,
					command,
					argument,
					cancellation,
				),
			}));
			const toolEndpoint = materialization.add(new RemoteTunnelClientAgentToolEndpoint(
				peer,
				error => this.failProtocol(error),
			));
			const toolPublication = materialization.add(new RemoteTunnelClientToolPublication(
				agentHostConnection,
				this.options.toolRegistry,
				this.options.toolEndpoints,
				toolEndpoint,
			));
			const protocol = materialization.add(new RemoteAgentHostProtocolServer(
				this.options.authority.createConnection(agentHostConnection),
				toolPublication,
			));
			materialization.add(this.options.contentResources.bindClientReader(
				agentHostConnection,
				new RemoteTunnelClientContentResourceReader(peer),
			));
			materialization.add(protocol.onDidReceiveAction(action => {
				const stream = this.stream;
				if (
					stream === undefined
					|| this.authenticationResponding
					|| this.authenticatedGeneration !== stream.generation
					|| peer.generation !== stream.generation
				) {
					return;
				}
				void peer.sendEvent(
					'host',
					remoteAgentHostProtocolActionEvent,
					protocolValue(action),
				).catch(error => this.failProtocol(error));
			}));
			materialization.add(protocol.onDidProgress(progress => {
				const stream = this.stream;
				if (
					stream === undefined
					|| this.authenticationResponding
					|| this.authenticatedGeneration !== stream.generation
					|| peer.generation !== stream.generation
				) {
					return;
				}
				void peer.sendEvent(
					'host',
					remoteAgentHostProtocolProgressEvent,
					protocolValue(progress),
				).catch(error => this.failProtocol(error));
			}));
			materialization.add(peer.onDidProtocolError(error => this.failProtocol(error)));
			this.peer = peer;
			this.protocol = protocol;
			this.materialization.value = materialization;
		} catch (error) {
			materialization.dispose();
			throw error;
		}
	}

	private callHost(
		target: 'host' | 'clientContent' | 'clientTools',
		command: string,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		const protocol = this.protocol;
		if (protocol === undefined || target !== 'host' || !isRemoteAgentHostProtocolCommand(command)) {
			const error = invalidProtocol('request', `${target}.${command}`);
			this.failProtocol(error);
			return Promise.reject(error);
		}
		return protocol.call(command as RemoteAgentHostProtocolCommand, argument, cancellation);
	}

	private rejectAuthentication(stream: IRemoteTunnelEndpointStream): void {
		if (this.terminal || this.stream !== stream || this.authenticationResponding) {
			return;
		}
		this.authenticationResponding = true;
		this.clearAuthenticationFrameAndAuthenticator();
		void stream.send(encodeRemoteAgentHostEndpointAuthenticationResult(
			stream.generation,
			RemoteAgentHostEndpointAuthenticationResult.Rejected,
		)).catch(() => {}).finally(() => {
			this.clearAuthenticationTimeout();
			this.terminate();
		});
	}

	private authenticationTimedOut(
		stream: IRemoteTunnelEndpointStream,
		timeoutCancellation: CancellationTokenSource,
	): void {
		if (
			this.authenticationTimeoutCancellation !== timeoutCancellation
			|| timeoutCancellation.token.isCancellationRequested
			|| this.stream !== stream
		) {
			return;
		}
		if (this.authenticationResponding) {
			this.terminate();
			return;
		}
		this.rejectAuthentication(stream);
	}

	private clearAuthenticationFrameAndAuthenticator(): void {
		this.authenticationFrameBinding.clear();
		const cancellation = this.authenticationCancellation;
		this.authenticationCancellation = undefined;
		cancellation?.cancel();
		cancellation?.dispose();
		this.authenticationStarted = false;
	}

	private clearAuthenticationTimeout(): void {
		const cancellation = this.authenticationTimeoutCancellation;
		this.authenticationTimeoutCancellation = undefined;
		cancellation?.cancel();
		cancellation?.dispose();
	}

	private cancelAuthentication(): void {
		this.clearAuthenticationFrameAndAuthenticator();
		this.clearAuthenticationTimeout();
		this.authenticationResponding = false;
	}

	private closeStream(stream: IRemoteTunnelEndpointStream, reason: IRemoteTunnelStreamClose): void {
		if (this.stream !== stream) {
			return;
		}
		this.streamBinding.clear();
		this.cancelAuthentication();
		this.stream = undefined;
		if (this.peer?.generation === stream.generation) {
			this.peer.detach(reason.error ?? new RemoteTunnelError(
				RemoteTunnelErrorCode.RelayUnavailable,
				'Remote Tunnel Agent Host endpoint stream closed',
				{ kind: reason.kind, generation: stream.generation },
			));
		}
		stream.dispose();
		if (reason.kind === 'lost' && this.agentHostConnectionValue !== undefined) {
			this.startGraceExpiry(stream.generation);
			return;
		}
		this.terminate();
	}

	private startGraceExpiry(generation: RemoteTunnelTransportGeneration): void {
		if (this.graceExpiryCancellation !== undefined || this.terminal) {
			return;
		}
		const cancellation = new CancellationTokenSource();
		this.graceExpiryCancellation = cancellation;
		let expiry: Promise<void>;
		try {
			expiry = this.options.scheduler.wait(Object.freeze({
				kind: 'agentHostConnectionGraceExpiry',
				generation,
				delayMilliseconds: this.options.logicalConnectionGracePeriodMilliseconds,
			}), cancellation.token);
		} catch {
			this.terminate();
			return;
		}
		void expiry.then(
			() => {
				if (this.graceExpiryCancellation === cancellation) {
					this.terminate();
				}
			},
			() => {
				if (this.graceExpiryCancellation === cancellation
					&& !cancellation.token.isCancellationRequested) {
					this.terminate();
				}
			},
		);
	}

	private cancelGraceExpiry(): void {
		const cancellation = this.graceExpiryCancellation;
		this.graceExpiryCancellation = undefined;
		cancellation?.cancel();
		cancellation?.dispose();
	}

	private failProtocol(error: unknown): void {
		if (this.terminal) {
			return;
		}
		onUnexpectedError(error);
		this.peer?.detach(error);
		this.terminate();
	}

	private terminate(): void {
		if (this.terminal) {
			return;
		}
		this.terminal = true;
		this.cancelAuthentication();
		this.cancelGraceExpiry();
		this.closeOwnedStream();
		this.onTerminal(this);
	}

	private closeOwnedStream(): void {
		const stream = this.stream;
		this.stream = undefined;
		this.streamBinding.clear();
		if (stream === undefined) {
			return;
		}
		if (this.peer?.generation === stream.generation) {
			this.peer.detach(new RemoteTunnelError(
				RemoteTunnelErrorCode.ConnectionTerminal,
				'Remote Tunnel Agent Host server connection terminated',
				{ generation: stream.generation },
			));
		}
		void stream.close().catch(() => {
			onUnexpectedError(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		}).finally(() => stream.dispose());
	}

	private rejectStream(stream: IRemoteTunnelEndpointStream): void {
		void stream.close().catch(() => {
			onUnexpectedError(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		}).finally(() => stream.dispose());
	}
}

/** Binds one Agent Host endpoint hosting lease to exact logical Host connections. */
export class RemoteTunnelAgentHostHostingBinding extends Disposable {
	private readonly connections = new Map<string, RemoteTunnelAgentHostServerConnection>();
	private readonly agentHostConnections = new Map<AgentHostClientConnectionId, string>();
	private readonly terminalConnectionKeys = new Set<string>();
	private readonly options: IRemoteTunnelAgentHostHostingOptions;

	constructor(
		private readonly lease: IRemoteTunnelHostingLease,
		options: IRemoteTunnelAgentHostHostingOptions,
	) {
		super();
		this.options = validateHostingOptions(options);
		this.assertLease();
		this._register(lease);
		this._register(lease.onDidAcceptConnection(stream => this.accept(stream)));
		this._register(lease.onDidChangeState(change => {
			if (change.state === 'failed') {
				onUnexpectedError(change.error ?? new RemoteTunnelError(
					RemoteTunnelErrorCode.HostingInactive,
					'Remote Tunnel Agent Host hosting lease failed',
				));
			}
			if (change.state !== 'active') {
				this.disposeConnections();
			}
		}));
	}

	static async start(
		hostService: IRemoteTunnelHostService,
		request: IRemoteTunnelStartHostingRequest,
		options: IRemoteTunnelAgentHostHostingOptions,
	): Promise<RemoteTunnelAgentHostHostingBinding> {
		const validatedOptions = validateHostingOptions(options);
		const lease = await hostService.startHosting(request);
		try {
			return new RemoteTunnelAgentHostHostingBinding(lease, validatedOptions);
		} catch (error) {
			lease.dispose();
			throw error;
		}
	}

	override dispose(): void {
		this.disposeConnections();
		super.dispose();
	}

	private assertLease(): void {
		const endpoint = validateRemoteTunnelEndpointDescriptor(this.lease.endpoint);
		if (
			this.lease.state !== 'active'
			|| endpoint.kind !== AGENT_HOST_TUNNEL_ENDPOINT_KIND
			|| endpoint.connectionScope !== 'privateAuthenticated'
			|| endpoint.status !== 'online'
			|| endpoint.protocol.minimum > remoteAgentHostTunnelProtocolRevision
			|| endpoint.protocol.maximum < remoteAgentHostTunnelProtocolRevision
		) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.EndpointIncompatible,
				'Remote Tunnel hosting lease cannot carry the Agent Host protocol',
				{ endpoint: endpoint.identity.endpoint },
			);
		}
	}

	private accept(stream: IRemoteTunnelEndpointStream): void {
		if (this._store.isDisposed || this.lease.state !== 'active') {
			this.rejectStream(stream);
			return;
		}
		let identity: IRemoteTunnelConnectionIdentity;
		try {
			identity = validateRemoteTunnelConnectionIdentity(stream.identity);
		} catch {
			this.rejectStream(stream);
			return;
		}
		if (!isEqualRemoteTunnelEndpoint(identity, this.lease.endpoint.identity)) {
			this.rejectStream(stream);
			return;
		}
		const key = connectionKey(identity);
		if (this.terminalConnectionKeys.has(key)) {
			this.rejectStream(stream);
			return;
		}
		const existing = this.connections.get(key);
		if (existing !== undefined) {
			existing.accept(stream);
			return;
		}
		if (
			stream.generation !== 1
			|| this.connections.size >= this.options.maximumLogicalConnections
			|| this.connections.size + this.terminalConnectionKeys.size
				>= this.options.maximumRetainedLogicalConnectionIdentities
		) {
			this.rejectStream(stream);
			return;
		}
		const connection = new RemoteTunnelAgentHostServerConnection(
			key,
			identity,
			this.options,
			agentHostConnection => this.claimAgentHostConnection(key, agentHostConnection),
			terminal => this.removeConnection(terminal),
		);
		this.connections.set(key, connection);
		connection.accept(stream);
	}

	private claimAgentHostConnection(key: string, connection: AgentHostClientConnectionId): boolean {
		if (this.agentHostConnections.has(connection)) {
			return false;
		}
		this.agentHostConnections.set(connection, key);
		return true;
	}

	private removeConnection(connection: RemoteTunnelAgentHostServerConnection): void {
		if (this.connections.get(connection.key) !== connection) {
			return;
		}
		this.connections.delete(connection.key);
		const agentHostConnection = connection.agentHostConnection;
		if (agentHostConnection !== undefined) {
			this.agentHostConnections.delete(agentHostConnection);
		}
		this.terminalConnectionKeys.add(connection.key);
		connection.dispose();
	}

	private rejectStream(stream: IRemoteTunnelEndpointStream): void {
		void stream.close().catch(() => {
			onUnexpectedError(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		}).finally(() => stream.dispose());
	}

	private disposeConnections(): void {
		const connections = [...this.connections.values()];
		this.connections.clear();
		this.agentHostConnections.clear();
		this.terminalConnectionKeys.clear();
		for (const connection of connections) {
			connection.dispose();
		}
	}
}
