/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter } from 'cs/base/common/event';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	toDisposable,
	type IDisposable,
} from 'cs/base/common/lifecycle';
import {
	type IAgentContentBlobReadRequest,
	type IAgentContentResourceReaderOpenRequest,
	type IAgentContentTreeEntryReadRequest,
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
import { createAgentContentLeaseId, type AgentHostClientConnectionId } from '../common/identities.js';
import {
	decodeRemoteAgentHostAction,
	encodeRemoteAgentHostProtocolPayload,
	remoteAgentHostProtocolActionEvent,
	remoteAgentHostProtocolProgressEvent,
	type RemoteAgentHostProtocolCommand,
} from '../common/remoteProtocol.js';
import {
	assertAgentHostOperationProgress,
	type IAgentHostOperationProgress,
} from '../common/protocol.js';
import {
	RemoteAgentHostTunnelProtocolPeer,
	type IRemoteAgentHostTunnelEvent,
} from '../common/remoteTunnelProtocolPeer.js';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointCredential,
	decodeRemoteAgentHostEndpointAuthenticationMessage,
	encodeRemoteAgentHostEndpointAuthenticationRequest,
	validateRemoteAgentHostEndpointAuthenticationTimeout,
	type IRemoteAgentHostTunnelScheduler,
	type RemoteAgentHostEndpointCredential,
} from '../common/remoteTunnelAuthentication.js';
import { remoteAgentHostTunnelProtocolRevision } from '../common/remoteTunnelProtocol.js';
import {
	assertAgentHostProtocolValue,
	type AgentHostProtocolValue,
} from '../common/protocolValues.js';
import {
	type IAgentClientToolInvocation,
	type IAgentToolCall,
	type IAgentToolExecutorEndpoint,
	assertAgentClientToolInvocation,
	assertAgentToolCall,
	assertAgentToolEndpointReconciliation,
	assertAgentToolProgress,
	assertAgentToolResult,
} from '../common/tools.js';
import type { IClientContentResourceService } from './clientContentResources.js';
import {
	type IRemoteAgentHostClientToolEndpoint,
	type IRemoteAgentHostProtocolTransport,
	type IRemoteAgentHostTransportStateChange,
	type RemoteAgentHostTransportState,
} from './remoteAgentHostConnection.js';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	isEqualRemoteTunnelEndpoint,
	validateRemoteTunnelConnectionIdentity,
	validateRemoteTunnelEndpointDescriptor,
	type IRemoteTunnelConnection,
	type IRemoteTunnelConnectionStateChange,
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

function authenticationError(
	error: unknown,
): RemoteAgentHostEndpointAuthenticationError {
	return error instanceof RemoteAgentHostEndpointAuthenticationError
		? error
		: new RemoteAgentHostEndpointAuthenticationError(
			RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
		);
}

function invalidAuthenticationOptions(): RemoteAgentHostEndpointAuthenticationError {
	return new RemoteAgentHostEndpointAuthenticationError(
		RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
	);
}

function validateTransportOptionsRecord(
	options: IRemoteTunnelAgentHostTransportOptions,
): IRemoteTunnelAgentHostTransportOptions {
	const expected = ['credential', 'scheduler', 'authenticationTimeoutMilliseconds'] as const;
	try {
		if (options === null || typeof options !== 'object' || Array.isArray(options)) {
			throw invalidAuthenticationOptions();
		}
		const prototype = Object.getPrototypeOf(options);
		const keys = Reflect.ownKeys(options);
		if ((prototype !== Object.prototype && prototype !== null)
			|| keys.length !== expected.length
			|| keys.some(key => typeof key !== 'string' || !expected.includes(key as typeof expected[number]))) {
			throw invalidAuthenticationOptions();
		}
		const values = new Map<typeof expected[number], unknown>();
		for (const key of expected) {
			const descriptor = Object.getOwnPropertyDescriptor(options, key);
			if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw invalidAuthenticationOptions();
			}
			values.set(key, descriptor.value);
		}
		const credential = values.get('credential');
		const scheduler = values.get('scheduler');
		const authenticationTimeoutMilliseconds = values.get('authenticationTimeoutMilliseconds');
		if (
			typeof credential !== 'string'
			|| scheduler === null
			|| typeof scheduler !== 'object'
			|| typeof (scheduler as IRemoteAgentHostTunnelScheduler).wait !== 'function'
			|| typeof authenticationTimeoutMilliseconds !== 'number'
		) {
			throw invalidAuthenticationOptions();
		}
		return Object.freeze({
			credential: createRemoteAgentHostEndpointCredential(credential),
			scheduler: scheduler as IRemoteAgentHostTunnelScheduler,
			authenticationTimeoutMilliseconds: validateRemoteAgentHostEndpointAuthenticationTimeout(
				authenticationTimeoutMilliseconds,
			),
		});
	} catch (error) {
		if (error instanceof RemoteAgentHostEndpointAuthenticationError) {
			throw error;
		}
		throw invalidAuthenticationOptions();
	}
}

/** Explicit credential and scheduling policy for one direct tunnel transport. */
export interface IRemoteTunnelAgentHostTransportOptions {
	readonly credential: RemoteAgentHostEndpointCredential;
	readonly scheduler: IRemoteAgentHostTunnelScheduler;
	readonly authenticationTimeoutMilliseconds: number;
}

/** Carries the common Agent Host protocol over one exact Remote Tunnel logical connection. */
export class RemoteTunnelAgentHostTransport extends Disposable implements IRemoteAgentHostProtocolTransport {
	private readonly actionEmitter = this._register(new EventEmitter<ReturnType<typeof decodeRemoteAgentHostAction>>({
		onListenerError: error => this.failProtocol(error),
	}));
	private readonly progressEmitter = this._register(new EventEmitter<IAgentHostOperationProgress>({
		onListenerError: error => this.failProtocol(error),
	}));
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteAgentHostTransportStateChange>({
		onListenerError: error => this.failProtocol(error),
	}));
	private readonly authenticationBinding = this._register(new MutableDisposable<DisposableStore>());
	private readonly lifetimeCancellation = this._register(new CancellationTokenSource());
	private readonly peer: RemoteAgentHostTunnelProtocolPeer;
	private contentResources: IClientContentResourceService | undefined;
	private tools: IAgentToolExecutorEndpoint | undefined;
	private clientEndpointsBound = false;
	private authenticationCancellation: CancellationTokenSource | undefined;
	private authenticationTimeoutCancellation: CancellationTokenSource | undefined;
	private lastAuthenticatedGeneration = 0;
	private lastAuthenticationGeneration = 0;
	private failed = false;
	private transportState: RemoteAgentHostTransportState = 'restoring';
	private transportStateGeneration = 0;
	private closePromise: Promise<void> | undefined;
	private lowerConnectionDisposed = false;
	private readonly options: IRemoteTunnelAgentHostTransportOptions;

	readonly onDidReceiveAction = this.actionEmitter.event;
	readonly onDidProgress = this.progressEmitter.event;
	readonly onDidChangeState = this.stateEmitter.event;

	private constructor(
		private readonly tunnelConnection: IRemoteTunnelConnection,
		options: IRemoteTunnelAgentHostTransportOptions,
	) {
		super();
		this.assertConnection();
		this.options = validateTransportOptionsRecord(options);
		this.peer = this._register(new RemoteAgentHostTunnelProtocolPeer({
			call: (target, command, argument, cancellation) => this.callClientEndpoint(
				target,
				command,
				argument,
				cancellation,
			),
		}));
		this._register(this.peer.onDidReceiveEvent(event => this.receiveEvent(event)));
		this._register(this.peer.onDidProtocolError(error => this.failProtocol(error)));
		this._register(tunnelConnection.onDidChangeState(change => this.changeState(change)));
		this._register(tunnelConnection.onDidClose(close => {
			this.cancelAuthentication();
			this.setState('terminal', close.generation);
			this.peer.detach(close.error ?? new RemoteTunnelError(
				RemoteTunnelErrorCode.ConnectionTerminal,
				'Remote Tunnel Agent Host connection closed',
				{ state: close.state, generation: close.generation },
			));
			this.disposeLowerConnection();
		}));
	}

	/** Authenticates generation one before exposing the direct tunnel transport. */
	static async create(
		tunnelConnection: IRemoteTunnelConnection,
		options: IRemoteTunnelAgentHostTransportOptions,
		cancellation: CancellationToken,
	): Promise<RemoteTunnelAgentHostTransport> {
		let transport: RemoteTunnelAgentHostTransport;
		try {
			transport = new RemoteTunnelAgentHostTransport(tunnelConnection, options);
		} catch (error) {
			try {
				await tunnelConnection.close();
			} catch {
				// Constructor validation remains the public failure.
			} finally {
				tunnelConnection.dispose();
			}
			throw error;
		}
		try {
			await transport.authenticateGeneration(tunnelConnection.generation, cancellation);
			return transport;
		} catch (error) {
			const failure = authenticationError(error);
			transport.failed = true;
			transport.setState('terminal', tunnelConnection.generation);
			try {
				await transport.closeOwnedConnection();
			} catch {
				// The authentication failure remains the public result.
			} finally {
				transport.dispose();
			}
			throw failure;
		}
	}

	get generation(): number {
		return this.tunnelConnection.generation;
	}

	get state(): RemoteAgentHostTransportState {
		return this.transportState;
	}

	call(
		command: RemoteAgentHostProtocolCommand,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		if (this.failed || this.transportState !== 'connected' || this.tunnelConnection.state !== 'connected') {
			return Promise.reject(new RemoteTunnelError(
				RemoteTunnelErrorCode.ConnectionTerminal,
				'Remote Tunnel Agent Host transport is unavailable',
				{ state: this.tunnelConnection.state },
			));
		}
		return this.peer.call('host', command, argument, cancellation);
	}

	bindClientEndpoints(
		connection: AgentHostClientConnectionId,
		contentResources: IClientContentResourceService,
		tools: IRemoteAgentHostClientToolEndpoint,
	): IDisposable {
		if (this.clientEndpointsBound) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.ProtocolViolation,
				'Remote Tunnel Agent Host client endpoints are already bound',
			);
		}
		if (contentResources.connection !== connection || tools.connection !== connection) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.ProtocolViolation,
				'Remote Tunnel Agent Host client endpoints address another connection',
			);
		}
		this.clientEndpointsBound = true;
		this.contentResources = contentResources;
		this.tools = tools;
		return toDisposable(() => {
			this.contentResources = undefined;
			this.tools = undefined;
		});
	}

	override dispose(): void {
		if (this._store.isDisposed) {
			return;
		}
		this.lifetimeCancellation.cancel();
		this.cancelAuthentication();
		this.peer.detach(new RemoteAgentHostEndpointAuthenticationError(
			RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
		));
		void this.closeOwnedConnection().catch(() => {
			onUnexpectedError(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		});
		super.dispose();
	}

	private assertConnection(): void {
		const identity = validateRemoteTunnelConnectionIdentity(this.tunnelConnection.identity);
		const endpoint = validateRemoteTunnelEndpointDescriptor(this.tunnelConnection.endpoint);
		if (
			this.tunnelConnection.state !== 'connected'
			|| endpoint.kind !== AGENT_HOST_TUNNEL_ENDPOINT_KIND
			|| endpoint.connectionScope !== 'privateAuthenticated'
			|| endpoint.status !== 'online'
			|| !isEqualRemoteTunnelEndpoint(identity, endpoint.identity)
			|| endpoint.protocol.minimum > remoteAgentHostTunnelProtocolRevision
			|| endpoint.protocol.maximum < remoteAgentHostTunnelProtocolRevision
		) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.EndpointIncompatible,
				'Remote Tunnel endpoint cannot carry the Agent Host protocol',
				{ endpoint: endpoint.identity.endpoint },
			);
		}
	}

	private changeState(change: IRemoteTunnelConnectionStateChange): void {
		if (change.state === 'reconnecting' || change.state === 'paused') {
			this.cancelAuthentication();
			const interruption = change.error ?? new RemoteTunnelError(
				RemoteTunnelErrorCode.RelayUnavailable,
				'Remote Tunnel Agent Host transport generation was interrupted',
				{ generation: change.generation },
			);
			this.peer.detach(interruption);
			if (this.lastAuthenticatedGeneration === 0) {
				this.failAuthentication(new RemoteAgentHostEndpointAuthenticationError(
					RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
				));
				return;
			}
			this.setState('restoring', change.generation);
			return;
		}
		if (change.state === 'closed' || change.state === 'failed') {
			this.cancelAuthentication();
			this.setState('terminal', change.generation);
			this.peer.detach(change.error ?? new RemoteTunnelError(
				RemoteTunnelErrorCode.ConnectionTerminal,
				'Remote Tunnel Agent Host connection is terminal',
				{ state: change.state, generation: change.generation },
			));
			return;
		}
		if (
			this.transportState !== 'restoring'
			|| change.generation !== this.lastAuthenticationGeneration + 1
			|| this.tunnelConnection.generation !== change.generation
		) {
			this.failProtocol(new RemoteTunnelError(
				RemoteTunnelErrorCode.GenerationConflict,
				'Remote Tunnel Agent Host generation is not the next authentication generation',
				{ generation: change.generation },
			));
			return;
		}
		void this.authenticateGeneration(change.generation, this.lifetimeCancellation.token).catch(error => {
			if (this.isInterruptedRestoration(error, change.generation)) {
				return;
			}
			this.failAuthentication(error);
		});
	}

	private authenticateGeneration(
		generation: RemoteTunnelTransportGeneration,
		cancellation: CancellationToken,
	): Promise<void> {
		if (
			this.failed
			|| cancellation.isCancellationRequested
			|| this.lifetimeCancellation.token.isCancellationRequested
			|| this.authenticationCancellation !== undefined
			|| this.tunnelConnection.state !== 'connected'
			|| this.tunnelConnection.generation !== generation
			|| generation !== this.lastAuthenticationGeneration + 1
		) {
			return Promise.reject(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		}
		this.lastAuthenticationGeneration = generation;
		const completion = new DeferredPromise<void>();
		const binding = new DisposableStore();
		const authenticationCancellation = new CancellationTokenSource();
		const timeoutCancellation = new CancellationTokenSource();
		let settled = false;
		const cleanup = (): void => {
			if (this.authenticationBinding.value === binding) {
				this.authenticationBinding.clear();
			} else {
				binding.dispose();
			}
			if (this.authenticationCancellation === authenticationCancellation) {
				this.authenticationCancellation = undefined;
			}
			if (this.authenticationTimeoutCancellation === timeoutCancellation) {
				this.authenticationTimeoutCancellation = undefined;
			}
			timeoutCancellation.cancel();
			timeoutCancellation.dispose();
			authenticationCancellation.dispose();
		};
		const reject = (error: unknown): void => {
			if (settled) {
				return;
			}
			settled = true;
			cleanup();
			completion.error(authenticationError(error));
		};
		const accept = (): void => {
			if (settled) {
				return;
			}
			if (
				this.failed
				|| this.tunnelConnection.state !== 'connected'
				|| this.tunnelConnection.generation !== generation
				|| this.peer.generation !== undefined
			) {
				reject(new RemoteAgentHostEndpointAuthenticationError(
					RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
				));
				return;
			}
			settled = true;
			cleanup();
			try {
				this.peer.attach(this.tunnelConnection);
			} catch (error) {
				completion.error(authenticationError(error));
				return;
			}
			this.lastAuthenticatedGeneration = generation;
			this.setState('connected', generation);
			completion.complete(undefined);
		};

		binding.add(this.tunnelConnection.onDidReceiveFrame(frame => {
			try {
				const message = decodeRemoteAgentHostEndpointAuthenticationMessage(frame);
				if (message.kind !== 'authenticationResult' || message.generation !== generation) {
					throw new RemoteAgentHostEndpointAuthenticationError(
						RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
					);
				}
				if (message.result === RemoteAgentHostEndpointAuthenticationResult.Rejected) {
					reject(new RemoteAgentHostEndpointAuthenticationError(
						RemoteAgentHostEndpointAuthenticationErrorCode.Rejected,
					));
					return;
				}
				accept();
			} catch (error) {
				reject(error);
			}
		}));
		binding.add(cancellation.onCancellationRequested(() => authenticationCancellation.cancel()));
		binding.add(this.lifetimeCancellation.token.onCancellationRequested(
			() => authenticationCancellation.cancel(),
		));
		binding.add(authenticationCancellation.token.onCancellationRequested(() => {
			reject(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		}));
		this.authenticationCancellation = authenticationCancellation;
		this.authenticationTimeoutCancellation = timeoutCancellation;
		this.authenticationBinding.value = binding;
		let timeout: Promise<void>;
		try {
			timeout = this.options.scheduler.wait(Object.freeze({
				kind: 'endpointAuthenticationTimeout',
				owner: 'client',
				generation,
				delayMilliseconds: this.options.authenticationTimeoutMilliseconds,
			}), timeoutCancellation.token);
		} catch (error) {
			reject(error);
			return completion.p;
		}
		void timeout.then(
			() => reject(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.TimedOut,
			)),
			() => {
				if (!timeoutCancellation.token.isCancellationRequested) {
					reject(new RemoteAgentHostEndpointAuthenticationError(
						RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
					));
				}
			},
		);
		try {
			void this.tunnelConnection.send(encodeRemoteAgentHostEndpointAuthenticationRequest(
				generation,
				this.options.credential,
			)).catch(() => reject(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			)));
		} catch (error) {
			reject(error);
		}
		return completion.p;
	}

	private isInterruptedRestoration(error: unknown, generation: RemoteTunnelTransportGeneration): boolean {
		return error instanceof RemoteAgentHostEndpointAuthenticationError
			&& error.code === RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted
			&& this.lastAuthenticatedGeneration > 0
			&& (generation < this.lastAuthenticationGeneration
				|| (this.lastAuthenticationGeneration === generation
					&& this.transportState === 'restoring'
					&& (this.tunnelConnection.state === 'reconnecting'
						|| this.tunnelConnection.state === 'paused')));
	}

	private cancelAuthentication(): void {
		this.authenticationCancellation?.cancel();
	}

	private failAuthentication(error: unknown): void {
		if (this.failed) {
			return;
		}
		this.failed = true;
		const failure = authenticationError(error);
		this.cancelAuthentication();
		this.peer.detach(failure);
		this.setState('terminal', this.tunnelConnection.generation);
		void this.closeOwnedConnection().catch(() => {
			onUnexpectedError(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		});
	}

	private closeOwnedConnection(): Promise<void> {
		if (this.lowerConnectionDisposed) {
			return Promise.resolve();
		}
		if (this.closePromise === undefined) {
			this.closePromise = this.tunnelConnection.close().finally(() => this.disposeLowerConnection());
		}
		return this.closePromise;
	}

	private disposeLowerConnection(): void {
		if (this.lowerConnectionDisposed) {
			return;
		}
		this.lowerConnectionDisposed = true;
		this.tunnelConnection.dispose();
	}

	private async callClientEndpoint(
		target: 'host' | 'clientContent' | 'clientTools',
		command: string,
		argument: AgentHostProtocolValue | undefined,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		if (argument === undefined) {
			throw invalidProtocol(`${target}.${command}.argument`, 'missing');
		}
		if (target === 'clientContent') {
			return this.callClientContent(command, argument, cancellation);
		}
		if (target === 'clientTools') {
			return this.callClientTool(command, argument, cancellation);
		}
		const error = invalidProtocol('request.target', target);
		this.failProtocol(error);
		throw error;
	}

	private async callClientContent(
		command: string,
		argument: AgentHostProtocolValue,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		const resources = this.contentResources;
		if (resources === undefined) {
			throw invalidProtocol('clientContent.binding', 'missing');
		}
		switch (command) {
			case 'open': {
				assertAgentContentResourceReaderOpenRequest(argument);
				const request = argument as unknown as IAgentContentResourceReaderOpenRequest;
				const result = protocolValue(await resources.open(request, cancellation));
				assertAgentContentResourceLease(result, request);
				return result;
			}
			case 'readBlob': {
				assertAgentContentBlobReadRequest(argument);
				const request = argument as unknown as IAgentContentBlobReadRequest;
				const result = protocolValue(await resources.readBlob(request, cancellation));
				assertAgentContentBlobReadResultShape(result, request);
				return result;
			}
			case 'readTreePage': {
				assertAgentContentTreePageRequest(argument);
				const request = argument as unknown as IAgentContentTreePageRequest;
				const result = protocolValue(await resources.readTreePage(request, cancellation));
				assertAgentContentTreePage(result, request);
				return result;
			}
			case 'readTreeEntry': {
				assertAgentContentTreeEntryReadRequest(argument);
				const request = argument as unknown as IAgentContentTreeEntryReadRequest;
				const result = protocolValue(await resources.readTreeEntry(request, cancellation));
				assertAgentContentBlobReadResultShape(result, request);
				return result;
			}
			case 'release':
				if (typeof argument !== 'string') {
					throw invalidProtocol('clientContent.release', typeof argument);
				}
				await resources.release(createAgentContentLeaseId(argument), cancellation);
				return null;
			default: {
				const error = invalidProtocol('clientContent.command', command);
				this.failProtocol(error);
				throw error;
			}
		}
	}

	private async callClientTool(
		command: string,
		argument: AgentHostProtocolValue,
		cancellation: CancellationToken,
	): Promise<AgentHostProtocolValue> {
		const tools = this.tools;
		if (tools === undefined) {
			throw invalidProtocol('clientTools.binding', 'missing');
		}
		switch (command) {
			case 'execute': {
				assertAgentClientToolInvocation(argument);
				const invocation = argument as unknown as IAgentClientToolInvocation;
				let progressDelivery = Promise.resolve();
				const result = await tools.execute(
					invocation.call,
					invocation.target,
					progress => {
						try {
							assertAgentToolProgress(progress);
							progressDelivery = progressDelivery.then(() => this.peer.sendEvent(
								'clientTools',
								'onDidProgress',
								protocolValue(progress),
							));
							void progressDelivery.catch(error => this.failProtocol(error));
						} catch (error) {
							this.failProtocol(error);
							throw error;
						}
					},
					cancellation,
				);
				await progressDelivery;
				assertAgentToolResult(result);
				return protocolValue(result);
			}
			case 'cancel':
				assertAgentToolCall(argument);
				await tools.cancel(argument as unknown as IAgentToolCall);
				return null;
			case 'reconcile': {
				assertAgentToolCall(argument);
				const result = await tools.reconcile(argument as unknown as IAgentToolCall);
				assertAgentToolEndpointReconciliation(result);
				return protocolValue(result);
			}
			default: {
				const error = invalidProtocol('clientTools.command', command);
				this.failProtocol(error);
				throw error;
			}
		}
	}

	private receiveEvent(event: IRemoteAgentHostTunnelEvent): void {
		if (event.target === 'host' && event.name === remoteAgentHostProtocolActionEvent) {
			try {
				this.actionEmitter.fire(decodeRemoteAgentHostAction(
					encodeRemoteAgentHostProtocolPayload(event.value),
				));
			} catch (error) {
				this.failProtocol(error);
			}
			return;
		}
		if (event.target === 'host' && event.name === remoteAgentHostProtocolProgressEvent) {
			try {
				assertAgentHostOperationProgress(event.value);
				this.progressEmitter.fire(event.value);
			} catch (error) {
				this.failProtocol(error);
			}
			return;
		}
		this.failProtocol(invalidProtocol('event', `${event.target}.${event.name}`));
	}

	private failProtocol(error: unknown): void {
		if (this.failed) {
			return;
		}
		this.failed = true;
		this.cancelAuthentication();
		this.setState('terminal', this.tunnelConnection.generation);
		onUnexpectedError(error);
		this.peer.detach(error);
		void this.closeOwnedConnection().catch(() => {
			onUnexpectedError(new RemoteAgentHostEndpointAuthenticationError(
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
			));
		});
	}

	private setState(state: RemoteAgentHostTransportState, generation: number): void {
		if (this.transportState === state && this.transportStateGeneration === generation) {
			return;
		}
		this.transportState = state;
		this.transportStateGeneration = generation;
		this.stateEmitter.fire(Object.freeze({ state, generation }));
	}
}
