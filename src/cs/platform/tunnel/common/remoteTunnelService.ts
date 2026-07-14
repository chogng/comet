/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promiseWithResolvers } from 'cs/base/common/async';
import { CancellationTokenSource } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter, type Event } from 'cs/base/common/event';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	type IDisposable,
	toDisposable,
} from 'cs/base/common/lifecycle';
import {
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelEndpointKind,
	createRemoteTunnelTransportGeneration,
	assertRemoteTunnelMutationValueDigest,
	findRemoteTunnelEndpoint,
	isEqualRemoteTunnelDescriptor,
	isEqualRemoteTunnelEndpoint,
	isEqualRemoteTunnelEndpointDescriptor,
	isEqualRemoteTunnelEndpointPublication,
	isEqualRemoteTunnelIdentity,
	isEqualRemoteTunnelMutationIdentity,
	remoteTunnelEndpointIdentityKey,
	RemoteTunnelCredentialScope,
	validateRemoteTunnelAccountDescriptor,
	validateRemoteTunnelAccountIdentity,
	validateRemoteTunnelConnectEndpoint,
	validateRemoteTunnelConnectionIdentity,
	validateRemoteTunnelCredentialReference,
	validateRemoteTunnelDescriptor,
	validateRemoteTunnelEndpointDescriptor,
	validateRemoteTunnelEndpointIdentity,
	validateRemoteTunnelEndpointPublication,
	validateRemoteTunnelIdentity,
	validateRemoteTunnelLookupDescriptor,
	validateRemoteTunnelMutationIdentity,
	validateRemoteTunnelMutationOutcome,
	validateRemoteTunnelProtocolRange,
	validateRemoteTunnelReconnectPolicy,
	type IRemoteTunnelConnectRequest,
	type IRemoteTunnelConnection,
	type IRemoteTunnelConnectionClose,
	type IRemoteTunnelConnectionIdentity,
	type IRemoteTunnelConnectionStateChange,
	type IRemoteTunnelCreateRequest,
	type IRemoteTunnelDescriptor,
	type IRemoteTunnelEndpointDescriptor,
	type IRemoteTunnelEndpointIdentity,
	type IRemoteTunnelEndpointStream,
	type IRemoteTunnelEnumerationRequest,
	type IRemoteTunnelHostService,
	type IRemoteTunnelHostingLease,
	type IRemoteTunnelHostingStateChange,
	type IRemoteTunnelIdentity,
	type IRemoteTunnelMutationIdentity,
	type IRemoteTunnelCredentialReference,
	type IRemoteTunnelProduct,
	type IRemoteTunnelProvider,
	type IRemoteTunnelProviderConnectRequest,
	type IRemoteTunnelProviderHosting,
	type IRemoteTunnelReconnectPolicy,
	type IRemoteTunnelScheduler,
	type IRemoteTunnelRelayStream,
	type IRemoteTunnelService,
	type IRemoteTunnelStartHostingRequest,
	type IRemoteTunnelStopHostingRequest,
	type IRemoteTunnelStreamClose,
	type RemoteTunnelMutationCommit,
	type RemoteTunnelConnectionState,
	type RemoteTunnelHostingState,
	type RemoteTunnelProviderId,
	type RemoteTunnelTransportGeneration,
} from './remoteTunnel.js';
import {
	isRemoteTunnelReconnectTerminalError,
	RemoteTunnelError,
	RemoteTunnelErrorCode,
} from './remoteTunnelErrors.js';

class DeterminedRemoteTunnelMutationRejection extends Error {
	constructor(readonly rejection: RemoteTunnelError) {
		super(rejection.message);
		this.name = 'DeterminedRemoteTunnelMutationRejection';
	}
}

function asRemoteTunnelError(error: unknown, code: typeof RemoteTunnelErrorCode.RelayUnavailable): RemoteTunnelError {
	if (error instanceof DeterminedRemoteTunnelMutationRejection) {
		return error.rejection;
	}
	if (error instanceof RemoteTunnelError) {
		return error;
	}
	return new RemoteTunnelError(code, 'Remote Tunnel provider operation failed');
}

async function closeAndDisposeEndpointStream(stream: IRemoteTunnelEndpointStream): Promise<void> {
	try {
		await stream.close();
	} finally {
		stream.dispose();
	}
}

function closeAndDisposeEndpointStreamAsync(stream: IRemoteTunnelEndpointStream): void {
	void closeAndDisposeEndpointStream(stream).catch(onUnexpectedError);
}

function cancelScheduledDelay(source: CancellationTokenSource | undefined): void {
	if (!source) {
		return;
	}
	source.cancel();
	source.dispose();
}

function assertProviderCapability(
	provider: IRemoteTunnelProvider,
	capability: keyof IRemoteTunnelProvider['capabilities'],
): void {
	if (!provider.capabilities[capability]) {
		throw new RemoteTunnelError(
			RemoteTunnelErrorCode.ProviderCapabilityMissing,
			'Remote Tunnel provider capability is unavailable',
			{ provider: provider.id, capability },
		);
	}
}

interface IBoundedRetentionEntry<TValue> {
	readonly value: TValue;
	terminal: boolean;
}

class BoundedRetentionMap<TValue> {
	private readonly entries = new Map<string, IBoundedRetentionEntry<TValue>>();

	constructor(private readonly maximumEntries: number, private readonly resource: string) {
		if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 4096) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel retention limit', {
				resource,
				maximumEntries,
			});
		}
	}

	get(key: string): TValue | undefined {
		return this.entries.get(key)?.value;
	}

	add(key: string, value: TValue, terminal: boolean): void {
		if (this.entries.has(key)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Remote Tunnel retention identity already exists', {
				resource: this.resource,
			});
		}
		this.makeRoom();
		this.entries.set(key, { value, terminal });
	}

	markTerminal(key: string): void {
		const entry = this.entries.get(key);
		if (entry) {
			entry.terminal = true;
		}
	}

	delete(key: string): void {
		this.entries.delete(key);
	}

	clear(): void {
		this.entries.clear();
	}

	private makeRoom(): void {
		if (this.entries.size < this.maximumEntries) {
			return;
		}
		for (const [key, entry] of this.entries) {
			if (entry.terminal) {
				this.entries.delete(key);
				return;
			}
		}
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ResourceLimit, 'Remote Tunnel retention limit is full', {
			resource: this.resource,
			maximumEntries: this.maximumEntries,
		});
	}
}

async function reconcileProviderMutation(
	provider: IRemoteTunnelProvider,
	mutation: IRemoteTunnelMutationIdentity,
	credential: IRemoteTunnelCredentialReference,
): Promise<RemoteTunnelMutationCommit> {
	let rawOutcome;
	try {
		rawOutcome = await provider.reconcileMutation(mutation, credential);
	} catch (error) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationUnknown, 'Remote Tunnel mutation outcome cannot be reconciled', {
			operation: mutation.operation,
			cause: error instanceof RemoteTunnelError ? error.code : 'providerFailure',
		});
	}
	const outcome = validateRemoteTunnelMutationOutcome(rawOutcome, mutation);
	if (outcome.kind === 'unknown') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationUnknown, 'Remote Tunnel mutation outcome remains unknown', {
			operation: mutation.operation,
		});
	}
	if (outcome.kind === 'rejected') {
		throw new DeterminedRemoteTunnelMutationRejection(outcome.error);
	}
	return outcome.commit;
}

async function executeProviderMutation(
	provider: IRemoteTunnelProvider,
	mutation: IRemoteTunnelMutationIdentity,
	credential: IRemoteTunnelCredentialReference,
	invoke: () => ReturnType<IRemoteTunnelProvider['reconcileMutation']>,
): Promise<RemoteTunnelMutationCommit> {
	let rawOutcome;
	try {
		rawOutcome = await invoke();
	} catch (error) {
		if (error instanceof RemoteTunnelError
			&& (error.code === RemoteTunnelErrorCode.AuthenticationDenied
				|| error.code === RemoteTunnelErrorCode.CredentialScopeDenied)) {
			throw error;
		}
		return reconcileProviderMutation(provider, mutation, credential);
	}
	const outcome = validateRemoteTunnelMutationOutcome(rawOutcome, mutation);
	if (outcome.kind === 'unknown') {
		return reconcileProviderMutation(provider, mutation, credential);
	}
	if (outcome.kind === 'rejected') {
		throw new DeterminedRemoteTunnelMutationRejection(outcome.error);
	}
	return outcome.commit;
}

/** Exact registry for provider and authentication products. */
export class RemoteTunnelProductRegistry extends Disposable {
	private readonly products = new Map<RemoteTunnelProviderId, IRemoteTunnelProduct>();
	private disposed = false;

	/** Registers one exact provider product. */
	register(product: IRemoteTunnelProduct): IDisposable {
		if (this.disposed) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProviderMissing, 'Remote Tunnel product registry is disposed');
		}
		const id = product.provider.id;
		if (product.id !== id || product.authentication.provider !== id) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Remote Tunnel product identities do not match', {
				product: product.id,
				provider: id,
				authentication: product.authentication.provider,
			});
		}
		if (this.products.has(id)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.DuplicateProvider, 'Remote Tunnel provider is already registered', {
				provider: id,
			});
		}
		this.products.set(id, product);
		return toDisposable(() => {
			if (this.products.get(id) === product) {
				this.products.delete(id);
			}
		});
	}

	/** Resolves one provider without probing another product. */
	get(provider: RemoteTunnelProviderId): IRemoteTunnelProduct {
		if (this.disposed) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProviderMissing, 'Remote Tunnel product registry is disposed');
		}
		const product = this.products.get(provider);
		if (!product) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProviderMissing, 'Remote Tunnel provider is not registered', {
				provider,
			});
		}
		return product;
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.products.clear();
		super.dispose();
	}
}

interface IRemoteTunnelLogicalConnectionOptions {
	readonly identity: IRemoteTunnelConnectionIdentity;
	readonly endpoint: IRemoteTunnelEndpointDescriptor;
	readonly stream: IRemoteTunnelRelayStream;
	readonly policy: IRemoteTunnelReconnectPolicy;
	readonly scheduler: IRemoteTunnelScheduler;
	readonly maximumFrameBytes: number;
	readonly reconnect: (generation: RemoteTunnelTransportGeneration) => Promise<IRemoteTunnelRelayStream>;
}

/** Owns one exact logical endpoint route across physical relay generations. */
export class RemoteTunnelConnection extends Disposable implements IRemoteTunnelConnection {
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteTunnelConnectionStateChange>({
		onListenerError: onUnexpectedError,
	}));
	private readonly generationEmitter = this._register(new EventEmitter<RemoteTunnelTransportGeneration>({
		onListenerError: onUnexpectedError,
	}));
	private readonly frameEmitter = this._register(new EventEmitter<Uint8Array>({
		onListenerError: onUnexpectedError,
	}));
	private readonly closeEmitter = this._register(new EventEmitter<IRemoteTunnelConnectionClose>({
		onListenerError: onUnexpectedError,
	}));
	private readonly streamOwner = this._register(new MutableDisposable<IRemoteTunnelRelayStream>());
	private readonly streamSubscriptions = this._register(new MutableDisposable<DisposableStore>());
	private readonly policy: IRemoteTunnelReconnectPolicy;
	private currentGeneration: RemoteTunnelTransportGeneration;
	private currentState: RemoteTunnelConnectionState = 'connected';
	private reconnecting: Promise<void> | undefined;
	private reconnectDelayCancellation: CancellationTokenSource | undefined;
	private graceExpiryCancellation: CancellationTokenSource | undefined;
	private terminalError: RemoteTunnelError | undefined;
	private closedEventPublished = false;

	readonly identity: IRemoteTunnelConnectionIdentity;
	readonly endpoint: IRemoteTunnelEndpointDescriptor;
	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidChangeGeneration = this.generationEmitter.event;
	readonly onDidReceiveFrame = this.frameEmitter.event;
	readonly onDidClose = this.closeEmitter.event;

	constructor(private readonly options: IRemoteTunnelLogicalConnectionOptions) {
		super();
		this.identity = validateRemoteTunnelConnectionIdentity(options.identity);
		this.endpoint = validateRemoteTunnelEndpointDescriptor(options.endpoint);
		this.policy = validateRemoteTunnelReconnectPolicy(options.policy);
		if (!Number.isSafeInteger(options.maximumFrameBytes)
			|| options.maximumFrameBytes < 1
			|| options.maximumFrameBytes > 16 * 1024 * 1024) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel frame limit');
		}
		this.currentGeneration = createRemoteTunnelTransportGeneration(options.stream.generation);
		this.attachStream(options.stream, this.currentGeneration);
	}

	get generation(): RemoteTunnelTransportGeneration {
		return this.currentGeneration;
	}

	get state(): RemoteTunnelConnectionState {
		return this.currentState;
	}

	async send(frame: Uint8Array): Promise<void> {
		const stream = this.streamOwner.value;
		if (this.currentState !== 'connected' || !stream) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ConnectionTerminal, 'Remote Tunnel connection cannot send', {
				state: this.currentState,
			});
		}
		this.validateFrame(frame);
		try {
			await stream.send(new Uint8Array(frame));
		} catch (error) {
			const tunnelError = asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
			if (this.currentState === 'connected' && this.streamOwner.value === stream) {
				const terminal = isRemoteTunnelReconnectTerminalError(tunnelError);
				const failedStream = this.detachStream();
				try {
					failedStream?.terminate({ kind: terminal ? 'terminal' : 'lost', error: tunnelError });
				} finally {
					failedStream?.dispose();
				}
				if (terminal) {
					this.fail(tunnelError);
				} else {
					this.publishState('reconnecting', tunnelError);
					this.startGraceExpiry();
					void this.beginReconnect();
				}
			}
			throw tunnelError;
		}
	}

	async resume(): Promise<void> {
		if (this.currentState !== 'paused') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ReconnectPaused, 'Remote Tunnel connection is not paused', {
				state: this.currentState,
			});
		}
		const completedReconnect = this.reconnecting;
		if (completedReconnect) {
			await completedReconnect;
		}
		if (this.currentState !== 'paused') {
			if (this.currentState === 'failed') {
				throw this.terminalError;
			}
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ConnectionTerminal, 'Remote Tunnel connection closed before resume', {
				state: this.currentState,
			});
		}
		const reconnecting = this.beginReconnect();
		await reconnecting;
		if (this.currentState === 'paused') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ReconnectPaused, 'Remote Tunnel reconnect attempt budget is exhausted', {
				generation: this.currentGeneration,
			});
		}
		if (this.currentState === 'failed') {
			throw this.terminalError;
		}
	}

	async close(): Promise<void> {
		if (this.currentState === 'closed' || this.currentState === 'failed') {
			return;
		}
		this.cancelReconnectDelay();
		this.cancelGraceExpiry();
		const stream = this.detachStream();
		this.publishState('closed');
		try {
			await stream?.close();
		} finally {
			stream?.dispose();
			this.publishClose('closed');
		}
	}

	private validateFrame(frame: Uint8Array): void {
		if (frame.byteLength > this.options.maximumFrameBytes) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.FrameTooLarge, 'Remote Tunnel frame exceeds its negotiated limit', {
				bytes: frame.byteLength,
				maximumBytes: this.options.maximumFrameBytes,
			});
		}
	}

	private attachStream(stream: IRemoteTunnelRelayStream, generation: RemoteTunnelTransportGeneration): void {
		const identity = validateRemoteTunnelConnectionIdentity(stream.identity);
		if (!isEqualRemoteTunnelEndpoint(identity, this.identity)
			|| identity.connection !== this.identity.connection
			|| stream.generation !== generation) {
			stream.dispose();
			throw new RemoteTunnelError(RemoteTunnelErrorCode.GenerationConflict, 'Remote Tunnel relay stream identity does not match', {
				connection: this.identity.connection,
				generation,
			});
		}

		const subscriptions = new DisposableStore();
		try {
			subscriptions.add(stream.onDidReceiveFrame(frame => this.receiveFrame(stream, frame)));
			subscriptions.add(stream.onDidClose(reason => this.handleStreamClose(stream, reason)));
			this.streamSubscriptions.value = subscriptions;
			this.streamOwner.value = stream;
		} catch (error) {
			subscriptions.dispose();
			stream.dispose();
			throw error;
		}
	}

	private receiveFrame(stream: IRemoteTunnelRelayStream, frame: Uint8Array): void {
		if (this.streamOwner.value !== stream || this.currentState !== 'connected') {
			return;
		}
		try {
			this.validateFrame(frame);
		} catch (error) {
			this.fail(asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable));
			return;
		}
		this.frameEmitter.fire(new Uint8Array(frame));
	}

	private handleStreamClose(stream: IRemoteTunnelRelayStream, reason: IRemoteTunnelStreamClose): void {
		if (this.streamOwner.value !== stream || this.currentState !== 'connected') {
			return;
		}
		this.detachStream()?.dispose();
		if (reason.kind === 'lost') {
			this.publishState('reconnecting', reason.error);
			this.startGraceExpiry();
			void this.beginReconnect();
			return;
		}
		this.fail(reason.error ?? new RemoteTunnelError(
			RemoteTunnelErrorCode.ConnectionTerminal,
			'Remote Tunnel relay stream ended',
		));
	}

	private beginReconnect(): Promise<void> {
		if (this.reconnecting) {
			return this.reconnecting;
		}
		if (this.currentState === 'paused') {
			this.publishState('reconnecting');
		}
		const reconnecting = this.runReconnect();
		this.reconnecting = reconnecting;
		void reconnecting.then(
			() => {
				if (this.reconnecting === reconnecting) {
					this.reconnecting = undefined;
				}
			},
			error => {
				if (this.reconnecting === reconnecting) {
					this.reconnecting = undefined;
				}
				this.fail(asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable));
			},
		);
		return reconnecting;
	}

	private async runReconnect(): Promise<void> {
		let lastError: RemoteTunnelError | undefined;
		for (let attempt = 1; attempt <= this.policy.maximumAttempts; attempt++) {
			const delayMilliseconds = Math.min(
				this.policy.initialDelayMilliseconds * (2 ** (attempt - 1)),
				this.policy.maximumDelayMilliseconds,
			);
			const delayCancellation = new CancellationTokenSource();
			this.cancelReconnectDelay();
			this.reconnectDelayCancellation = delayCancellation;
			try {
				await this.options.scheduler.wait({
					kind: 'reconnectAttempt',
					attempt,
					delayMilliseconds,
				}, delayCancellation.token);
			} catch (error) {
				if (delayCancellation.token.isCancellationRequested) {
					return;
				}
				lastError = asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
				break;
			} finally {
				if (this.reconnectDelayCancellation === delayCancellation) {
					this.reconnectDelayCancellation = undefined;
				}
				delayCancellation.dispose();
			}
			if (this.currentState !== 'reconnecting') {
				return;
			}
			try {
				const expectedGeneration = createRemoteTunnelTransportGeneration(this.currentGeneration + 1);
				const stream = await this.options.reconnect(expectedGeneration);
				if (this.currentState !== 'reconnecting') {
					stream.dispose();
					return;
				}
				if (stream.generation !== expectedGeneration) {
					stream.dispose();
					throw new RemoteTunnelError(RemoteTunnelErrorCode.GenerationConflict, 'Remote Tunnel reconnect generation is not contiguous', {
						expected: expectedGeneration,
						received: stream.generation,
					});
				}
				this.attachStream(stream, expectedGeneration);
				this.currentGeneration = expectedGeneration;
				this.generationEmitter.fire(expectedGeneration);
				this.cancelGraceExpiry();
				this.publishState('connected');
				return;
			} catch (error) {
				lastError = asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
				if (isRemoteTunnelReconnectTerminalError(lastError)) {
					this.fail(lastError);
					return;
				}
			}
		}
		if (this.currentState === 'reconnecting') {
			this.publishState('paused', lastError ?? new RemoteTunnelError(
				RemoteTunnelErrorCode.RelayUnavailable,
				'Remote Tunnel reconnect attempt budget is exhausted',
			));
		}
	}

	private detachStream(): IRemoteTunnelRelayStream | undefined {
		this.streamSubscriptions.clear();
		return this.streamOwner.clearAndLeak();
	}

	private fail(error: RemoteTunnelError): void {
		if (this.currentState === 'failed' || this.currentState === 'closed') {
			return;
		}
		this.cancelReconnectDelay();
		this.cancelGraceExpiry();
		this.terminalError = error;
		const stream = this.detachStream();
		try {
			stream?.terminate({ kind: 'terminal', error });
		} finally {
			stream?.dispose();
		}
		this.publishState('failed', error);
		this.publishClose('failed', error);
	}

	private publishState(state: RemoteTunnelConnectionState, error?: RemoteTunnelError): void {
		this.currentState = state;
		this.stateEmitter.fire(Object.freeze({
			state,
			generation: this.currentGeneration,
			...(error ? { error } : {}),
		}));
	}

	private publishClose(state: 'closed' | 'failed', error?: RemoteTunnelError): void {
		if (this.closedEventPublished) {
			return;
		}
		this.closedEventPublished = true;
		this.closeEmitter.fire(Object.freeze({
			state,
			generation: this.currentGeneration,
			...(error ? { error } : {}),
		}));
	}

	private startGraceExpiry(): void {
		if (this.graceExpiryCancellation) {
			return;
		}
		const cancellation = new CancellationTokenSource();
		this.graceExpiryCancellation = cancellation;
		void this.options.scheduler.wait({
			kind: 'clientConnectionGraceExpiry',
			delayMilliseconds: this.policy.gracePeriodMilliseconds,
		}, cancellation.token).then(
			() => {
				if (this.graceExpiryCancellation !== cancellation) {
					return;
				}
				this.graceExpiryCancellation = undefined;
				cancellation.dispose();
				if (this.currentState === 'reconnecting' || this.currentState === 'paused') {
					this.fail(new RemoteTunnelError(
						RemoteTunnelErrorCode.ReconnectGraceExpired,
						'Remote Tunnel logical connection reconnect grace expired',
						{
							connection: this.identity.connection,
							generation: this.currentGeneration,
						},
					));
				}
			},
			error => {
				if (this.graceExpiryCancellation !== cancellation) {
					return;
				}
				this.graceExpiryCancellation = undefined;
				const cancelled = cancellation.token.isCancellationRequested;
				cancellation.dispose();
				if (!cancelled) {
					this.fail(asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable));
				}
			},
		);
	}

	private cancelReconnectDelay(): void {
		const cancellation = this.reconnectDelayCancellation;
		this.reconnectDelayCancellation = undefined;
		cancelScheduledDelay(cancellation);
	}

	private cancelGraceExpiry(): void {
		const cancellation = this.graceExpiryCancellation;
		this.graceExpiryCancellation = undefined;
		cancelScheduledDelay(cancellation);
	}

	override dispose(): void {
		if (this.currentState !== 'closed' && this.currentState !== 'failed') {
			this.cancelReconnectDelay();
			this.cancelGraceExpiry();
			const stream = this.detachStream();
			stream?.dispose();
			this.publishState('closed');
			this.publishClose('closed');
		}
		super.dispose();
	}
}

interface IRemoteTunnelHostingLeaseOptions {
	readonly product: IRemoteTunnelProduct;
	readonly providerHosting: IRemoteTunnelProviderHosting;
	readonly startMutation: IRemoteTunnelMutationIdentity;
	readonly scheduler: IRemoteTunnelScheduler;
	readonly maximumRetainedOperations: number;
	readonly maximumPendingConnections: number;
	readonly maximumActiveConnections: number;
	readonly maximumRetainedConnectionIdentities: number;
	readonly connectionGracePeriodMilliseconds: number;
	readonly onTerminalState: (lease: RemoteTunnelHostingLease) => void;
}

interface IHostingStopOperation {
	readonly mutation: IRemoteTunnelMutationIdentity;
	attempt: Promise<IRemoteTunnelDescriptor> | undefined;
	terminalError: RemoteTunnelError | undefined;
}

interface IHostingLogicalConnection {
	readonly key: string;
	readonly identity: IRemoteTunnelConnectionIdentity;
	generation: RemoteTunnelTransportGeneration;
	stream: IRemoteTunnelEndpointStream | undefined;
	streamCloseSubscription: IDisposable | undefined;
	graceExpiryCancellation: CancellationTokenSource | undefined;
}

function remoteTunnelLogicalConnectionKey(identity: IRemoteTunnelConnectionIdentity): string {
	return `${remoteTunnelEndpointIdentityKey(identity)}\u0000${identity.connection}`;
}

/** Publishes one exact provider hosting attachment as a Platform lease. */
export class RemoteTunnelHostingLease extends Disposable implements IRemoteTunnelHostingLease {
	private readonly stateEmitter = this._register(new EventEmitter<IRemoteTunnelHostingStateChange>({
		onListenerError: onUnexpectedError,
	}));
	private readonly connectionEmitter = this._register(new EventEmitter<IRemoteTunnelEndpointStream>({
		onListenerError: error => this.failHosting(asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable)),
	}));
	private readonly stopOperations: BoundedRetentionMap<IHostingStopOperation>;
	private readonly retiredConnections: BoundedRetentionMap<true>;
	private readonly connections = new Map<string, IHostingLogicalConnection>();
	private readonly pendingConnections: IRemoteTunnelEndpointStream[] = [];
	private currentDescriptor: IRemoteTunnelDescriptor;
	private currentEndpoint: IRemoteTunnelEndpointDescriptor;
	private currentState: RemoteTunnelHostingState = 'active';
	private connectionOwnerSubscribed = false;

	readonly onDidChangeState = this.stateEmitter.event;
	readonly onDidAcceptConnection: Event<IRemoteTunnelEndpointStream> = (listener, thisArgs, disposables) => {
		if (this.connectionOwnerSubscribed) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.HostingConflict,
				'Remote Tunnel hosting lease already has a connection owner',
				{ lease: this.lease },
			);
		}
		this.connectionOwnerSubscribed = true;
		const emitterSubscription = this.connectionEmitter.event(listener, thisArgs);
		const ownership = toDisposable(() => {
			emitterSubscription.dispose();
			this.connectionOwnerSubscribed = false;
		});
		if (disposables instanceof DisposableStore) {
			disposables.add(ownership);
		} else {
			disposables?.push(ownership);
		}
		this.flushPendingConnections();
		return ownership;
	};

	constructor(private readonly options: IRemoteTunnelHostingLeaseOptions) {
		super();
		this.stopOperations = new BoundedRetentionMap(
			options.maximumRetainedOperations,
			'hostingStopOperations',
		);
		this.retiredConnections = new BoundedRetentionMap(
			options.maximumRetainedConnectionIdentities,
			'hostingLogicalConnectionIdentities',
		);
		if (!Number.isSafeInteger(options.maximumPendingConnections)
			|| options.maximumPendingConnections < 1
			|| options.maximumPendingConnections > 4096
			|| !Number.isSafeInteger(options.maximumActiveConnections)
			|| options.maximumActiveConnections < 1
			|| options.maximumActiveConnections > 4096
			|| !Number.isSafeInteger(options.connectionGracePeriodMilliseconds)
			|| options.connectionGracePeriodMilliseconds < 1
			|| options.connectionGracePeriodMilliseconds > 24 * 60 * 60 * 1_000) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel Host connection limits');
		}
		this.currentDescriptor = validateRemoteTunnelDescriptor(options.providerHosting.descriptor);
		this.currentEndpoint = validateRemoteTunnelEndpointDescriptor(options.providerHosting.endpoint);
		if (!isEqualRemoteTunnelEndpoint(this.currentEndpoint.identity, options.providerHosting.endpoint.identity)
			|| this.currentEndpoint.status !== 'online') {
			options.providerHosting.dispose();
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider hosting endpoint is invalid');
		}
		this._register(options.providerHosting);
		this._register(options.providerHosting.onDidAcceptConnection(stream => this.acceptConnection(stream)));
	}

	get endpoint(): IRemoteTunnelEndpointDescriptor {
		return this.currentEndpoint;
	}

	get lease() {
		return this.options.providerHosting.lease;
	}

	get descriptor(): IRemoteTunnelDescriptor {
		return this.currentDescriptor;
	}

	get state(): RemoteTunnelHostingState {
		return this.currentState;
	}

	get startOperation(): string {
		return this.options.startMutation.operation;
	}

	async stop(request: IRemoteTunnelStopHostingRequest): Promise<IRemoteTunnelDescriptor> {
		const mutation = validateRemoteTunnelMutationIdentity(request.mutation);
		if (mutation.kind !== 'stopHosting'
			|| mutation.target.kind !== 'endpoint'
			|| !isEqualRemoteTunnelEndpoint(mutation.target.identity, this.currentEndpoint.identity)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Remote Tunnel stop operation targets another endpoint', {
				operation: mutation.operation,
			});
		}
		await assertRemoteTunnelMutationValueDigest(mutation, { kind: 'stopHosting' });
		const existing = this.stopOperations.get(mutation.operation);
		if (existing) {
			if (!isEqualRemoteTunnelMutationIdentity(existing.mutation, mutation)) {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Remote Tunnel stop operation identity changed', {
					operation: mutation.operation,
				});
			}
			if (existing.attempt) {
				return existing.attempt;
			}
			if (existing.terminalError) {
				throw existing.terminalError;
			}
			return this.beginStopAttempt(existing);
		}
		if (this.currentState === 'stopped') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.HostingInactive, 'Remote Tunnel hosting lease is already stopped');
		}
		if (this.currentState !== 'active') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.HostingInactive, 'Remote Tunnel hosting lease is not active', {
				state: this.currentState,
			});
		}
		const entry: IHostingStopOperation = { mutation, attempt: undefined, terminalError: undefined };
		this.stopOperations.add(mutation.operation, entry, false);
		return this.beginStopAttempt(entry);
	}

	private beginStopAttempt(entry: IHostingStopOperation): Promise<IRemoteTunnelDescriptor> {
		const operation = promiseWithResolvers<IRemoteTunnelDescriptor>();
		entry.attempt = operation.promise;
		void operation.promise.catch(() => {});
		void this.stopHosting({ mutation: entry.mutation }).then(
			descriptor => {
				this.stopOperations.markTerminal(entry.mutation.operation);
				operation.resolve(descriptor);
			},
			error => {
				const tunnelError = asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
				if (entry.attempt === operation.promise) {
					entry.attempt = undefined;
				}
				if (error instanceof DeterminedRemoteTunnelMutationRejection
					|| tunnelError.code !== RemoteTunnelErrorCode.OperationUnknown) {
					entry.terminalError = tunnelError;
					this.stopOperations.markTerminal(entry.mutation.operation);
				}
				operation.reject(tunnelError);
			},
		);
		return operation.promise;
	}

	private async stopHosting(request: IRemoteTunnelStopHostingRequest): Promise<IRemoteTunnelDescriptor> {
		this.publishState('stopping');
		try {
			await this.closeConnections(true);
			const account = validateRemoteTunnelAccountIdentity(this.currentDescriptor.identity);
			const credential = validateRemoteTunnelCredentialReference(
				await this.options.product.authentication.acquire(account, [
					RemoteTunnelCredentialScope.ManagementWrite,
					RemoteTunnelCredentialScope.HostRelay,
				]),
				account,
				[RemoteTunnelCredentialScope.ManagementWrite, RemoteTunnelCredentialScope.HostRelay],
			);
			const commit = await executeProviderMutation(
				this.options.product.provider,
				request.mutation,
				credential,
				() => this.options.providerHosting.stop(request, credential),
			);
			if (commit.kind !== 'stopHosting') {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned another Remote Tunnel mutation commit', {
					operation: request.mutation.operation,
				});
			}
			const descriptor = validateRemoteTunnelLookupDescriptor(commit.descriptor, this.currentDescriptor.identity);
			const endpoint = findRemoteTunnelEndpoint(descriptor, this.currentEndpoint.identity);
			if (endpoint.status !== 'offline') {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Stopped Remote Tunnel endpoint remains online', {
					endpoint: endpoint.identity.endpoint,
				});
			}
			this.currentDescriptor = descriptor;
			this.currentEndpoint = endpoint;
			this.publishState('stopped');
			this.options.onTerminalState(this);
			return descriptor;
		} catch (error) {
			const tunnelError = asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
			this.publishState('active', tunnelError);
			throw error instanceof DeterminedRemoteTunnelMutationRejection ? error : tunnelError;
		}
	}

	private acceptConnection(stream: IRemoteTunnelEndpointStream): void {
		if (this.currentState !== 'active') {
			closeAndDisposeEndpointStreamAsync(stream);
			return;
		}
		let identity: IRemoteTunnelConnectionIdentity;
		let generation: RemoteTunnelTransportGeneration;
		try {
			identity = validateRemoteTunnelConnectionIdentity(stream.identity);
			generation = createRemoteTunnelTransportGeneration(stream.generation);
			if (!isEqualRemoteTunnelEndpoint(identity, this.currentEndpoint.identity)) {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider accepted another Remote Tunnel endpoint', {
					endpoint: identity.endpoint,
				});
			}
		} catch (error) {
			closeAndDisposeEndpointStreamAsync(stream);
			const tunnelError = asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
			this.failHosting(tunnelError);
			return;
		}
		const key = remoteTunnelLogicalConnectionKey(identity);
		let connection = this.connections.get(key);
		if (connection) {
			if (connection.stream !== undefined || generation !== connection.generation + 1) {
				closeAndDisposeEndpointStreamAsync(stream);
				return;
			}
			this.cancelConnectionGraceExpiry(connection);
		} else {
			if (generation !== 1 || this.retiredConnections.get(key)) {
				closeAndDisposeEndpointStreamAsync(stream);
				return;
			}
			if (this.connections.size >= this.options.maximumActiveConnections) {
				closeAndDisposeEndpointStreamAsync(stream);
				return;
			}
			connection = {
				key,
				identity,
				generation,
				stream: undefined,
				streamCloseSubscription: undefined,
				graceExpiryCancellation: undefined,
				};
				this.connections.set(key, connection);
			}
			const acceptedConnection = connection;
			try {
				acceptedConnection.generation = generation;
				acceptedConnection.stream = stream;
				acceptedConnection.streamCloseSubscription = stream.onDidClose(reason => {
					this.handleConnectionClose(acceptedConnection, stream, reason);
				});
			} catch (error) {
				this.retireConnection(acceptedConnection);
			closeAndDisposeEndpointStreamAsync(stream);
			this.failHosting(asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable));
			return;
		}
		if (this.connectionOwnerSubscribed) {
			this.connectionEmitter.fire(stream);
			return;
		}
		if (this.pendingConnections.length >= this.options.maximumPendingConnections) {
			closeAndDisposeEndpointStreamAsync(stream);
			this.failHosting(new RemoteTunnelError(
				RemoteTunnelErrorCode.ResourceLimit,
				'Remote Tunnel pending connection limit is full',
				{ maximumPendingConnections: this.options.maximumPendingConnections },
			));
			return;
		}
		this.pendingConnections.push(stream);
	}

	private flushPendingConnections(): void {
		while (this.connectionOwnerSubscribed
			&& this.currentState === 'active'
			&& this.pendingConnections.length > 0) {
			const stream = this.pendingConnections.shift()!;
			const connection = this.connections.get(remoteTunnelLogicalConnectionKey(stream.identity));
			if (connection?.stream === stream) {
				this.connectionEmitter.fire(stream);
			}
		}
		if (this.currentState !== 'active') {
			this.closeConnectionsAsync(true);
		}
	}

	private handleConnectionClose(
		connection: IHostingLogicalConnection,
		stream: IRemoteTunnelEndpointStream,
		reason: IRemoteTunnelStreamClose,
	): void {
		if (this.connections.get(connection.key) !== connection || connection.stream !== stream) {
			return;
		}
		connection.streamCloseSubscription?.dispose();
		connection.streamCloseSubscription = undefined;
		connection.stream = undefined;
		this.removePendingConnection(stream);
		stream.dispose();
		if (reason.kind === 'lost' && this.currentState === 'active') {
			this.startConnectionGraceExpiry(connection);
			return;
		}
		this.retireConnection(connection);
	}

	private startConnectionGraceExpiry(connection: IHostingLogicalConnection): void {
		this.cancelConnectionGraceExpiry(connection);
		const cancellation = new CancellationTokenSource();
		connection.graceExpiryCancellation = cancellation;
		void this.options.scheduler.wait({
			kind: 'hostConnectionGraceExpiry',
			delayMilliseconds: this.options.connectionGracePeriodMilliseconds,
		}, cancellation.token).then(
			() => {
				if (connection.graceExpiryCancellation !== cancellation) {
					return;
				}
				connection.graceExpiryCancellation = undefined;
				cancellation.dispose();
				if (this.connections.get(connection.key) === connection && connection.stream === undefined) {
					this.retireConnection(connection);
				}
			},
			error => {
				if (connection.graceExpiryCancellation !== cancellation) {
					return;
				}
				connection.graceExpiryCancellation = undefined;
				const cancelled = cancellation.token.isCancellationRequested;
				cancellation.dispose();
				if (!cancelled) {
					this.failHosting(asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable));
				}
			},
		);
	}

	private cancelConnectionGraceExpiry(connection: IHostingLogicalConnection): void {
		const cancellation = connection.graceExpiryCancellation;
		connection.graceExpiryCancellation = undefined;
		cancelScheduledDelay(cancellation);
	}

	private retireConnection(connection: IHostingLogicalConnection): void {
		if (this.connections.get(connection.key) !== connection) {
			return;
		}
		this.connections.delete(connection.key);
		this.cancelConnectionGraceExpiry(connection);
		connection.streamCloseSubscription?.dispose();
		connection.streamCloseSubscription = undefined;
		if (connection.stream) {
			this.removePendingConnection(connection.stream);
		}
		connection.stream = undefined;
		if (!this.retiredConnections.get(connection.key)) {
			this.retiredConnections.add(connection.key, true, true);
		}
	}

	private removePendingConnection(stream: IRemoteTunnelEndpointStream): void {
		const index = this.pendingConnections.indexOf(stream);
		if (index !== -1) {
			this.pendingConnections.splice(index, 1);
		}
	}

	private detachConnections(retainIdentities: boolean): IRemoteTunnelEndpointStream[] {
		this.pendingConnections.length = 0;
		const streams: IRemoteTunnelEndpointStream[] = [];
		for (const connection of [...this.connections.values()]) {
			this.connections.delete(connection.key);
			this.cancelConnectionGraceExpiry(connection);
			connection.streamCloseSubscription?.dispose();
			connection.streamCloseSubscription = undefined;
			if (connection.stream) {
				streams.push(connection.stream);
				connection.stream = undefined;
			}
			if (retainIdentities && !this.retiredConnections.get(connection.key)) {
				this.retiredConnections.add(connection.key, true, true);
			}
		}
		return streams;
	}

	private async closeConnections(retainIdentities: boolean): Promise<void> {
		const streams = this.detachConnections(retainIdentities);
		await Promise.all(streams.map(stream => closeAndDisposeEndpointStream(stream)));
	}

	private closeConnectionsAsync(retainIdentities: boolean): void {
		for (const stream of this.detachConnections(retainIdentities)) {
			closeAndDisposeEndpointStreamAsync(stream);
		}
	}

	private failHosting(error: RemoteTunnelError): void {
		if (this.currentState === 'failed' || this.currentState === 'disposed' || this.currentState === 'stopped') {
			return;
		}
		this.publishState('failed', error);
		this.options.onTerminalState(this);
		this.closeConnectionsAsync(true);
		this.options.providerHosting.dispose();
	}

	private publishState(state: RemoteTunnelHostingState, error?: RemoteTunnelError): void {
		this.currentState = state;
		this.stateEmitter.fire(Object.freeze({
			state,
			descriptor: this.currentDescriptor,
			...(error ? { error } : {}),
		}));
	}

	override dispose(): void {
		if (this.currentState !== 'disposed') {
			this.currentState = 'disposed';
			this.options.onTerminalState(this);
		}
		this.connectionOwnerSubscribed = false;
		this.closeConnectionsAsync(false);
		this.retiredConnections.clear();
		this.stopOperations.clear();
		super.dispose();
	}
}

interface IHostingStartOperation {
	readonly mutation: IRemoteTunnelMutationIdentity;
	attempt: Promise<IRemoteTunnelHostingLease> | undefined;
	terminalError: RemoteTunnelError | undefined;
}

/** Bounded retention policy for Host mutation reconciliation. */
export interface IRemoteTunnelHostServiceOptions {
	readonly maximumRetainedOperations: number;
	readonly maximumPendingConnections: number;
	readonly maximumActiveConnections: number;
	readonly maximumRetainedConnectionIdentities: number;
	readonly connectionGracePeriodMilliseconds: number;
}

/** Owns endpoint publication and active hosting leases. */
export class RemoteTunnelHostService extends Disposable implements IRemoteTunnelHostService {
	private readonly activeLeases = new Map<string, RemoteTunnelHostingLease>();
	private readonly startOperations: BoundedRetentionMap<IHostingStartOperation>;
	private disposed = false;

	constructor(
		private readonly products: RemoteTunnelProductRegistry,
		private readonly scheduler: IRemoteTunnelScheduler,
		private readonly options: IRemoteTunnelHostServiceOptions,
	) {
		super();
		if (!Number.isSafeInteger(options.maximumPendingConnections)
			|| options.maximumPendingConnections < 1
			|| options.maximumPendingConnections > 4096
			|| !Number.isSafeInteger(options.maximumActiveConnections)
			|| options.maximumActiveConnections < 1
			|| options.maximumActiveConnections > 4096
			|| !Number.isSafeInteger(options.connectionGracePeriodMilliseconds)
			|| options.connectionGracePeriodMilliseconds < 1
			|| options.connectionGracePeriodMilliseconds > 24 * 60 * 60 * 1_000) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel Host connection limits');
		}
		this.startOperations = new BoundedRetentionMap(options.maximumRetainedOperations, 'hostingStartOperations');
	}

	async startHosting(request: IRemoteTunnelStartHostingRequest): Promise<IRemoteTunnelHostingLease> {
		if (this.disposed) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.HostingInactive, 'Remote Tunnel host service is disposed');
		}
		const endpoint = validateRemoteTunnelEndpointPublication(request.endpoint);
		const mutation = validateRemoteTunnelMutationIdentity(request.mutation);
		if (mutation.kind !== 'startHosting'
			|| mutation.target.kind !== 'endpoint'
			|| !isEqualRemoteTunnelEndpoint(mutation.target.identity, endpoint.identity)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Remote Tunnel hosting operation targets another endpoint', {
				operation: mutation.operation,
			});
		}
		if (!mutation.expectedRevision) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.RevisionConflict, 'Remote Tunnel hosting requires an expected revision');
		}
		await assertRemoteTunnelMutationValueDigest(mutation, { kind: 'startHosting', endpoint });
		const endpointKey = remoteTunnelEndpointIdentityKey(endpoint.identity);
		const existingOperation = this.startOperations.get(mutation.operation);
		if (existingOperation) {
			if (!isEqualRemoteTunnelMutationIdentity(existingOperation.mutation, mutation)) {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Remote Tunnel hosting operation identity changed', {
					operation: mutation.operation,
				});
			}
			if (existingOperation.attempt) {
				return existingOperation.attempt;
			}
			if (existingOperation.terminalError) {
				throw existingOperation.terminalError;
			}
			return this.beginStartAttempt(existingOperation, { endpoint, mutation });
		}
		if (this.activeLeases.has(endpointKey)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.HostingConflict, 'Remote Tunnel endpoint already has an active Host', {
				endpoint: endpoint.identity.endpoint,
			});
		}
		const entry: IHostingStartOperation = { mutation, attempt: undefined, terminalError: undefined };
		this.startOperations.add(mutation.operation, entry, false);
		return this.beginStartAttempt(entry, { endpoint, mutation });
	}

	private beginStartAttempt(
		entry: IHostingStartOperation,
		request: IRemoteTunnelStartHostingRequest,
	): Promise<IRemoteTunnelHostingLease> {
		const operation = promiseWithResolvers<IRemoteTunnelHostingLease>();
		entry.attempt = operation.promise;
		void operation.promise.catch(() => {});
		void this.startProviderHosting(request).then(
			operation.resolve,
			error => {
				const tunnelError = asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
				if (entry.attempt === operation.promise) {
					entry.attempt = undefined;
				}
				if (error instanceof DeterminedRemoteTunnelMutationRejection) {
					entry.terminalError = tunnelError;
					this.startOperations.markTerminal(entry.mutation.operation);
				}
				operation.reject(tunnelError);
			},
		);
		return operation.promise;
	}

	private async startProviderHosting(
		request: IRemoteTunnelStartHostingRequest,
	): Promise<IRemoteTunnelHostingLease> {
		const product = this.products.get(request.endpoint.identity.provider);
		assertProviderCapability(product.provider, 'management');
		assertProviderCapability(product.provider, 'hosting');
		const account = validateRemoteTunnelAccountIdentity(request.endpoint.identity);
		const credential = validateRemoteTunnelCredentialReference(
			await product.authentication.acquire(account, [
				RemoteTunnelCredentialScope.ManagementWrite,
				RemoteTunnelCredentialScope.HostRelay,
			]),
			account,
			[RemoteTunnelCredentialScope.ManagementWrite, RemoteTunnelCredentialScope.HostRelay],
		);
		const commit = await executeProviderMutation(
			product.provider,
			request.mutation,
			credential,
			() => product.provider.startHosting(request, credential),
		);
		if (commit.kind !== 'startHosting') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned another Remote Tunnel mutation commit', {
				operation: request.mutation.operation,
			});
		}
		const providerHosting = await product.provider.getHosting(
			request.endpoint.identity,
			commit.lease,
			credential,
		);
		let lease: RemoteTunnelHostingLease;
		try {
			const descriptor = validateRemoteTunnelLookupDescriptor(
				providerHosting.descriptor,
				request.endpoint.identity,
			);
			const endpoint = findRemoteTunnelEndpoint(descriptor, request.endpoint.identity);
			const providerEndpoint = validateRemoteTunnelEndpointDescriptor(providerHosting.endpoint);
			if (providerHosting.lease !== commit.lease
				|| !isEqualRemoteTunnelDescriptor(descriptor, commit.descriptor)
				|| !isEqualRemoteTunnelEndpointDescriptor(providerEndpoint, commit.endpoint)
				|| !isEqualRemoteTunnelEndpointDescriptor(endpoint, commit.endpoint)
				|| !isEqualRemoteTunnelEndpointPublication(request.endpoint, endpoint)
				|| endpoint.status !== 'online') {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider committed another endpoint publication', {
					endpoint: endpoint.identity.endpoint,
				});
			}
			lease = new RemoteTunnelHostingLease({
				product,
				providerHosting,
				startMutation: request.mutation,
				scheduler: this.scheduler,
				maximumRetainedOperations: this.options.maximumRetainedOperations,
				maximumPendingConnections: this.options.maximumPendingConnections,
				maximumActiveConnections: this.options.maximumActiveConnections,
				maximumRetainedConnectionIdentities: this.options.maximumRetainedConnectionIdentities,
				connectionGracePeriodMilliseconds: this.options.connectionGracePeriodMilliseconds,
				onTerminalState: candidate => this.removeLease(candidate),
			});
		} catch (error) {
			providerHosting.dispose();
			throw error;
		}
		const endpointKey = remoteTunnelEndpointIdentityKey(request.endpoint.identity);
		if (this.disposed || this.activeLeases.has(endpointKey)) {
			lease.dispose();
			throw new RemoteTunnelError(RemoteTunnelErrorCode.HostingConflict, 'Remote Tunnel Host changed during publication', {
				endpoint: request.endpoint.identity.endpoint,
			});
		}
		this.activeLeases.set(endpointKey, lease);
		return lease;
	}

	private removeLease(lease: RemoteTunnelHostingLease): void {
		const key = remoteTunnelEndpointIdentityKey(lease.endpoint.identity);
		if (this.activeLeases.get(key) === lease) {
			this.activeLeases.delete(key);
		}
		const operation = this.startOperations.get(lease.startOperation);
		if (operation) {
			operation.attempt = undefined;
			operation.terminalError = new RemoteTunnelError(
				RemoteTunnelErrorCode.HostingInactive,
				'Remote Tunnel hosting operation no longer has an active lease',
				{ operation: lease.startOperation },
			);
			this.startOperations.markTerminal(lease.startOperation);
		}
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		const activeLeases = Array.from(this.activeLeases.values());
		this.activeLeases.clear();
		this.startOperations.clear();
		for (const lease of activeLeases) {
			lease.dispose();
		}
		super.dispose();
	}
}
/** Bounded transport and retired-identity limits for one Tunnel service. */
export interface IRemoteTunnelServiceOptions {
	readonly maximumFrameBytes: number;
	readonly maximumActiveConnections: number;
	readonly maximumRetainedConnectionIdentities: number;
}

interface IActiveRemoteTunnelConnection {
	readonly connection: RemoteTunnelConnection;
	closeSubscription: IDisposable | undefined;
}

/** Implements exact discovery and logical connection composition. */
export class RemoteTunnelService extends Disposable implements IRemoteTunnelService {
	private readonly retiredConnectionIdentities: BoundedRetentionMap<true>;
	private readonly connectingConnections = new Set<string>();
	private readonly activeConnections = new Map<string, IActiveRemoteTunnelConnection>();
	private disposed = false;

	constructor(
		private readonly products: RemoteTunnelProductRegistry,
		private readonly scheduler: IRemoteTunnelScheduler,
		private readonly options: IRemoteTunnelServiceOptions,
	) {
		super();
		if (!Number.isSafeInteger(options.maximumFrameBytes)
			|| options.maximumFrameBytes < 1
			|| options.maximumFrameBytes > 16 * 1024 * 1024
			|| !Number.isSafeInteger(options.maximumActiveConnections)
			|| options.maximumActiveConnections < 1
			|| options.maximumActiveConnections > 4096) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel service limits');
		}
		this.retiredConnectionIdentities = new BoundedRetentionMap(
			options.maximumRetainedConnectionIdentities,
			'retiredLogicalConnectionIdentities',
		);
	}

	async enumerate(request: IRemoteTunnelEnumerationRequest): Promise<readonly IRemoteTunnelDescriptor[]> {
		this.assertActive();
		const account = validateRemoteTunnelAccountIdentity(request.account);
		const endpointKind = request.endpointKind
			? createRemoteTunnelEndpointKind(request.endpointKind)
			: undefined;
		const product = this.products.get(account.provider);
		assertProviderCapability(product.provider, 'discovery');
		const credential = await this.acquireCredential(product, account, [RemoteTunnelCredentialScope.ManagementRead]);
		const descriptors = await product.provider.enumerate({ account, ...(endpointKind ? { endpointKind } : {}) }, credential);
		const seenTunnels = new Map<string, string>();
		return Object.freeze(descriptors.map(descriptor => {
			const validated = validateRemoteTunnelAccountDescriptor(descriptor, account);
			const previousCluster = seenTunnels.get(validated.identity.tunnel);
			if (previousCluster !== undefined) {
				throw new RemoteTunnelError(
					previousCluster === validated.identity.cluster
						? RemoteTunnelErrorCode.InvalidDescriptor
						: RemoteTunnelErrorCode.ClusterMismatch,
					'Duplicate Remote Tunnel identity returned by enumeration',
					{ tunnel: validated.identity.tunnel },
				);
			}
			seenTunnels.set(validated.identity.tunnel, validated.identity.cluster);
			if (endpointKind && !validated.endpoints.some(endpoint => endpoint.kind === endpointKind)) {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider ignored endpoint-scoped discovery', {
					provider: account.provider,
					endpointKind,
				});
			}
			return validated;
		}));
	}

	async lookup(identity: IRemoteTunnelIdentity): Promise<IRemoteTunnelDescriptor> {
		this.assertActive();
		const validatedIdentity = validateRemoteTunnelIdentity(identity);
		return this.lookupWithScopes(validatedIdentity, [RemoteTunnelCredentialScope.ManagementRead]);
	}

	async createTunnel(request: IRemoteTunnelCreateRequest): Promise<IRemoteTunnelDescriptor> {
		this.assertActive();
		const identity = validateRemoteTunnelIdentity(request.identity);
		const mutation = validateRemoteTunnelMutationIdentity(request.mutation);
		if (mutation.kind !== 'createTunnel'
			|| mutation.target.kind !== 'tunnel'
			|| !isEqualRemoteTunnelIdentity(mutation.target.identity, identity)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Remote Tunnel creation operation targets another tunnel', {
				operation: mutation.operation,
			});
		}
		if (mutation.expectedRevision) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.RevisionConflict, 'Remote Tunnel creation cannot expect an existing revision');
		}
		if (request.displayName.length === 0 || request.displayName.length > 128) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel display name');
		}
		if (request.visibility !== 'private' && request.visibility !== 'account') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel visibility');
		}
		await assertRemoteTunnelMutationValueDigest(mutation, {
			kind: 'createTunnel',
			displayName: request.displayName,
			visibility: request.visibility,
		});
		const product = this.products.get(identity.provider);
		assertProviderCapability(product.provider, 'management');
		const credential = await this.acquireCredential(product, identity, [RemoteTunnelCredentialScope.ManagementWrite]);
		let commit: RemoteTunnelMutationCommit;
		try {
			commit = await executeProviderMutation(
				product.provider,
				mutation,
				credential,
				() => product.provider.createTunnel({
					identity,
					displayName: request.displayName,
					visibility: request.visibility,
					mutation,
				}, credential),
			);
		} catch (error) {
			throw asRemoteTunnelError(error, RemoteTunnelErrorCode.RelayUnavailable);
		}
		if (commit.kind !== 'createTunnel') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned another Remote Tunnel mutation commit', {
				operation: mutation.operation,
			});
		}
		return validateRemoteTunnelLookupDescriptor(commit.descriptor, identity);
	}

	async connect(request: IRemoteTunnelConnectRequest): Promise<IRemoteTunnelConnection> {
		this.assertActive();
		const endpoint = validateRemoteTunnelEndpointIdentity(request.endpoint);
		const normalizedRequest: IRemoteTunnelConnectRequest = Object.freeze({
			endpoint,
			kind: createRemoteTunnelEndpointKind(request.kind),
			protocol: validateRemoteTunnelProtocolRange(request.protocol),
			connection: request.connection,
			reconnect: validateRemoteTunnelReconnectPolicy(request.reconnect),
		});
		const identity = createRemoteTunnelConnectionIdentity(endpoint, request.connection);
		const connectionKey = `${remoteTunnelEndpointIdentityKey(endpoint)}\u0000${identity.connection}`;
		if (this.connectingConnections.has(connectionKey)
			|| this.activeConnections.has(connectionKey)
			|| this.retiredConnectionIdentities.get(connectionKey)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Remote Tunnel logical connection identity was already used', {
				connection: identity.connection,
			});
		}
		if (this.activeConnections.size + this.connectingConnections.size >= this.options.maximumActiveConnections) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ResourceLimit, 'Remote Tunnel active connection limit is full', {
				maximumActiveConnections: this.options.maximumActiveConnections,
			});
		}
		this.connectingConnections.add(connectionKey);
		let stream: IRemoteTunnelRelayStream;
		let endpointDescriptor: IRemoteTunnelEndpointDescriptor;
		try {
			const connected = await this.connectGeneration(normalizedRequest, createRemoteTunnelTransportGeneration(1));
			stream = connected.stream;
			endpointDescriptor = connected.endpoint;
		} finally {
			this.connectingConnections.delete(connectionKey);
		}
		if (this.disposed) {
			stream.dispose();
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ConnectionTerminal, 'Remote Tunnel service disposed during connect');
		}
		let connection: RemoteTunnelConnection;
		try {
			connection = new RemoteTunnelConnection({
				identity,
				endpoint: endpointDescriptor,
				stream,
				policy: normalizedRequest.reconnect,
				scheduler: this.scheduler,
				maximumFrameBytes: this.options.maximumFrameBytes,
				reconnect: async generation => (await this.connectGeneration(normalizedRequest, generation)).stream,
			});
		} catch (error) {
			stream.dispose();
			throw error;
		}
		const active: IActiveRemoteTunnelConnection = { connection, closeSubscription: undefined };
		this.activeConnections.set(connectionKey, active);
		active.closeSubscription = connection.onDidClose(() => {
			const current = this.activeConnections.get(connectionKey);
			if (current?.connection === connection) {
				this.activeConnections.delete(connectionKey);
				current.closeSubscription?.dispose();
			}
			this.retainConnectionIdentity(connectionKey);
		});
		if (connection.state === 'closed' || connection.state === 'failed') {
			this.activeConnections.delete(connectionKey);
			active.closeSubscription.dispose();
			this.retainConnectionIdentity(connectionKey);
		}
		return connection;
	}

	private retainConnectionIdentity(connectionKey: string): void {
		if (!this.retiredConnectionIdentities.get(connectionKey)) {
			this.retiredConnectionIdentities.add(connectionKey, true, true);
		}
	}

	private async lookupWithScopes(
		identity: IRemoteTunnelIdentity,
		scopes: readonly (typeof RemoteTunnelCredentialScope)[keyof typeof RemoteTunnelCredentialScope][],
	): Promise<IRemoteTunnelDescriptor> {
		const product = this.products.get(identity.provider);
		assertProviderCapability(product.provider, 'discovery');
		const credential = await this.acquireCredential(product, identity, scopes);
		return validateRemoteTunnelLookupDescriptor(await product.provider.lookup(identity, credential), identity);
	}

	private async connectGeneration(
		request: IRemoteTunnelConnectRequest,
		generation: RemoteTunnelTransportGeneration,
	): Promise<{ readonly endpoint: IRemoteTunnelEndpointDescriptor; readonly stream: IRemoteTunnelRelayStream }> {
		const product = this.products.get(request.endpoint.provider);
		assertProviderCapability(product.provider, 'discovery');
		assertProviderCapability(product.provider, 'relay');
		const scopes = [RemoteTunnelCredentialScope.ManagementRead, RemoteTunnelCredentialScope.ClientRelay] as const;
		const credential = await this.acquireCredential(product, request.endpoint, scopes);
		const descriptor = validateRemoteTunnelLookupDescriptor(
			await product.provider.lookup(request.endpoint, credential),
			request.endpoint,
		);
		const endpoint = validateRemoteTunnelConnectEndpoint(descriptor, request);
		const providerRequest: IRemoteTunnelProviderConnectRequest = Object.freeze({
			identity: createRemoteTunnelConnectionIdentity(request.endpoint, request.connection),
			generation,
		});
		const stream = await product.provider.connect(providerRequest, credential);
		const streamIdentity = validateRemoteTunnelConnectionIdentity(stream.identity);
		if (!isEqualRemoteTunnelEndpoint(streamIdentity, providerRequest.identity)
			|| streamIdentity.connection !== providerRequest.identity.connection
			|| stream.generation !== generation) {
			stream.dispose();
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned another Remote Tunnel relay stream', {
				connection: request.connection,
				generation,
			});
		}
		return Object.freeze({ endpoint, stream });
	}

	private async acquireCredential(
		product: IRemoteTunnelProduct,
		account: IRemoteTunnelIdentity | IRemoteTunnelEndpointIdentity | IRemoteTunnelEnumerationRequest['account'],
		scopes: readonly (typeof RemoteTunnelCredentialScope)[keyof typeof RemoteTunnelCredentialScope][],
	) {
		const accountIdentity = validateRemoteTunnelAccountIdentity(account);
		return validateRemoteTunnelCredentialReference(
			await product.authentication.acquire(accountIdentity, scopes),
			accountIdentity,
			scopes,
		);
	}

	private assertActive(): void {
		if (this.disposed) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ConnectionTerminal, 'Remote Tunnel service is disposed');
		}
	}

	override dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		const activeConnections = Array.from(this.activeConnections.values());
		this.connectingConnections.clear();
		this.activeConnections.clear();
		this.retiredConnectionIdentities.clear();
		for (const active of activeConnections) {
			active.closeSubscription?.dispose();
			active.connection.dispose();
		}
		super.dispose();
	}
}
