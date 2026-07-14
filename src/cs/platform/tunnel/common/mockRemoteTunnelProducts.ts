/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationTokenSource } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import {
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelCredentialReferenceId,
	createRemoteTunnelEndpointCapability,
	createRemoteTunnelHostingLeaseId,
	createRemoteTunnelProviderId,
	createRemoteTunnelRecordRevision,
	createRemoteTunnelTransportGeneration,
	assertRemoteTunnelMutationValueDigest,
	findRemoteTunnelEndpoint,
	isEqualRemoteTunnelEndpoint,
	isEqualRemoteTunnelIdentity,
	isEqualRemoteTunnelMutationIdentity,
	remoteTunnelEndpointIdentityKey,
	remoteTunnelIdentityKey,
	RemoteTunnelCredentialScope,
	validateRemoteTunnelAccountIdentity,
	validateRemoteTunnelConnectionIdentity,
	validateRemoteTunnelCredentialReference,
	validateRemoteTunnelDescriptor,
	validateRemoteTunnelEndpointPublication,
	validateRemoteTunnelIdentity,
	validateRemoteTunnelMutationIdentity,
	type IRemoteTunnelAccountIdentity,
	type IRemoteTunnelAuthenticationProvider,
	type IRemoteTunnelCreateRequest,
	type IRemoteTunnelCredentialReference,
	type IRemoteTunnelDescriptor,
	type IRemoteTunnelEndpointDescriptor,
	type IRemoteTunnelEndpointIdentity,
	type IRemoteTunnelEndpointPublication,
	type IRemoteTunnelEndpointStream,
	type IRemoteTunnelEnumerationRequest,
	type IRemoteTunnelIdentity,
	type IRemoteTunnelMutationIdentity,
	type IRemoteTunnelProduct,
	type IRemoteTunnelProvider,
	type IRemoteTunnelProviderCapabilities,
	type IRemoteTunnelProviderConnectRequest,
	type IRemoteTunnelProviderHosting,
	type IRemoteTunnelScheduler,
	type IRemoteTunnelRelayStream,
	type IRemoteTunnelStartHostingRequest,
	type IRemoteTunnelStopHostingRequest,
	type IRemoteTunnelStreamClose,
	type RemoteTunnelMutationCommit,
	type RemoteTunnelMutationOutcome,
	type RemoteTunnelClientConnectionId,
	type RemoteTunnelProviderId,
} from './remoteTunnel.js';
import { RemoteTunnelError, RemoteTunnelErrorCode } from './remoteTunnelErrors.js';

function accountKey(account: IRemoteTunnelAccountIdentity): string {
	const validated = validateRemoteTunnelAccountIdentity(account);
	return `${validated.provider}\u0000${validated.account}`;
}

function connectionKey(identity: IRemoteTunnelProviderConnectRequest['identity']): string {
	const validated = validateRemoteTunnelConnectionIdentity(identity);
	return `${remoteTunnelEndpointIdentityKey(validated)}\u0000${validated.connection}`;
}

function committedOutcome(
	mutation: IRemoteTunnelMutationIdentity,
	commit: RemoteTunnelMutationCommit,
): RemoteTunnelMutationOutcome {
	return Object.freeze({
		kind: 'committed',
		mutation: validateRemoteTunnelMutationIdentity(mutation),
		commit,
	});
}

function rejectedOutcome(
	mutation: IRemoteTunnelMutationIdentity,
	error: RemoteTunnelError,
): RemoteTunnelMutationOutcome {
	return Object.freeze({
		kind: 'rejected',
		mutation: validateRemoteTunnelMutationIdentity(mutation),
		error,
	});
}

function unknownOutcome(mutation: IRemoteTunnelMutationIdentity): RemoteTunnelMutationOutcome {
	return Object.freeze({
		kind: 'unknown',
		mutation: validateRemoteTunnelMutationIdentity(mutation),
	});
}

interface IMockCredentialRecord {
	readonly account: IRemoteTunnelAccountIdentity;
	readonly scopes: readonly RemoteTunnelCredentialScope[];
}

/** Explicit deterministic mock of product authentication and secret resolution. */
export class MockRemoteTunnelAuthenticationProvider implements IRemoteTunnelAuthenticationProvider {
	private readonly authorizedAccounts = new Set<string>();
	private readonly revokedAccounts = new Set<string>();
	private readonly credentials = new Map<string, IMockCredentialRecord>();
	private credentialCounter = 0;

	readonly provider: RemoteTunnelProviderId;

	constructor(
		provider: RemoteTunnelProviderId,
		private readonly maximumCredentialReferences: number,
	) {
		this.provider = createRemoteTunnelProviderId(provider);
		if (!Number.isSafeInteger(maximumCredentialReferences)
			|| maximumCredentialReferences < 1
			|| maximumCredentialReferences > 4096) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid mock credential retention limit');
		}
	}

	/** Authorizes one exact account for deterministic tests and product mocks. */
	authorize(account: IRemoteTunnelAccountIdentity): void {
		const validated = validateRemoteTunnelAccountIdentity(account);
		if (validated.provider !== this.provider) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.AuthenticationDenied, 'Mock Tunnel account uses another provider');
		}
		const key = accountKey(validated);
		this.authorizedAccounts.add(key);
		this.revokedAccounts.delete(key);
	}

	/** Revokes future and previously minted references for one account. */
	revoke(account: IRemoteTunnelAccountIdentity): void {
		const validated = validateRemoteTunnelAccountIdentity(account);
		this.revokedAccounts.add(accountKey(validated));
	}

	async acquire(
		account: IRemoteTunnelAccountIdentity,
		scopes: readonly RemoteTunnelCredentialScope[],
	): Promise<IRemoteTunnelCredentialReference> {
		const validated = validateRemoteTunnelAccountIdentity(account);
		const key = accountKey(validated);
		if (validated.provider !== this.provider
			|| !this.authorizedAccounts.has(key)
			|| this.revokedAccounts.has(key)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.AuthenticationDenied, 'Mock Remote Tunnel account is not authorized', {
				provider: validated.provider,
				account: validated.account,
			});
		}
		const uniqueScopes = Object.freeze(Array.from(new Set(scopes)));
		if (this.credentials.size >= this.maximumCredentialReferences) {
			const oldestReference = this.credentials.keys().next().value;
			if (oldestReference) {
				this.credentials.delete(oldestReference);
			}
		}
		const reference = createRemoteTunnelCredentialReferenceId(`mock-credential-${++this.credentialCounter}`);
		this.credentials.set(reference, { account: validated, scopes: uniqueScopes });
		return Object.freeze({ ...validated, reference, scopes: uniqueScopes });
	}

	/** Returns the number of mock credential references issued to Platform. */
	getCredentialAcquisitionCount(): number {
		return this.credentialCounter;
	}

	/** Validates a mock reference at the provider boundary without revealing a secret. */
	validate(
		credential: IRemoteTunnelCredentialReference,
		account: IRemoteTunnelAccountIdentity,
		requiredScopes: readonly RemoteTunnelCredentialScope[],
	): IRemoteTunnelCredentialReference {
		const validated = validateRemoteTunnelCredentialReference(credential, account, requiredScopes);
		const record = this.credentials.get(validated.reference);
		if (!record
			|| !isEqualAccount(record.account, account)
			|| this.revokedAccounts.has(accountKey(account))) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.AuthenticationDenied, 'Mock Remote Tunnel credential was revoked');
		}
		for (const scope of requiredScopes) {
			if (!record.scopes.includes(scope)) {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.CredentialScopeDenied, 'Mock Remote Tunnel credential scope is missing', {
					scope,
				});
			}
		}
		return validated;
	}
}

function isEqualAccount(first: IRemoteTunnelAccountIdentity, second: IRemoteTunnelAccountIdentity): boolean {
	return first.provider === second.provider && first.account === second.account;
}

/** Explicit deterministic mock of one physical relay stream. */
export class MockRemoteTunnelRelayStream extends Disposable implements IRemoteTunnelRelayStream {
	private readonly frameEmitter = this._register(new EventEmitter<Uint8Array>({ onListenerError: onUnexpectedError }));
	private readonly closeEmitter = this._register(new EventEmitter<IRemoteTunnelStreamClose>({ onListenerError: onUnexpectedError }));
	private peer: MockRemoteTunnelRelayStream | undefined;
	private closed = false;
	private nextSendError: RemoteTunnelError | undefined;
	private closeCallCount = 0;
	private disposeCallCount = 0;

	readonly onDidReceiveFrame = this.frameEmitter.event;
	readonly onDidClose = this.closeEmitter.event;

	constructor(
		readonly identity: IRemoteTunnelProviderConnectRequest['identity'],
		readonly generation: IRemoteTunnelProviderConnectRequest['generation'],
		private readonly maximumFrameBytes: number,
		private readonly onFinished: (reason: IRemoteTunnelStreamClose) => void,
	) {
		super();
		validateRemoteTunnelConnectionIdentity(identity);
		createRemoteTunnelTransportGeneration(generation);
	}

	/** Connects the other exact end of this mock physical stream. */
	connectPeer(peer: MockRemoteTunnelRelayStream): void {
		if (this.peer || this.closed
			|| peer.identity.connection !== this.identity.connection
			|| peer.generation !== this.generation) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Mock Remote Tunnel stream peer does not match');
		}
		this.peer = peer;
	}

	async send(frame: Uint8Array): Promise<void> {
		if (this.closed || !this.peer || this.peer.closed) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.RelayUnavailable, 'Mock Remote Tunnel relay stream is closed');
		}
		if (frame.byteLength > this.maximumFrameBytes) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.FrameTooLarge, 'Mock Remote Tunnel relay frame is too large', {
				bytes: frame.byteLength,
				maximumBytes: this.maximumFrameBytes,
			});
		}
		if (this.nextSendError) {
			const error = this.nextSendError;
			this.nextSendError = undefined;
			throw error;
		}
		this.peer.receive(new Uint8Array(frame));
	}

	/** Rejects one send without emitting a close event. */
	rejectNextSend(error: RemoteTunnelError): void {
		if (this.closed || this.nextSendError) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Mock relay send failure is already armed');
		}
		this.nextSendError = error;
	}

	async close(): Promise<void> {
		this.closeCallCount++;
		this.terminate({ kind: 'graceful' });
	}

	terminate(reason: IRemoteTunnelStreamClose): void {
		this.finish(reason, true);
	}

	/** Simulates one abrupt external relay loss. */
	lose(error?: RemoteTunnelError): void {
		this.terminate(Object.freeze({ kind: 'lost', ...(error ? { error } : {}) }));
	}

	/** Returns explicit cleanup calls observed by this deterministic stream. */
	getCleanupCallCounts(): { readonly close: number; readonly dispose: number } {
		return Object.freeze({ close: this.closeCallCount, dispose: this.disposeCallCount });
	}

	/** Returns whether this physical stream already reached a close reason. */
	get isClosed(): boolean {
		return this.closed;
	}

	private receive(frame: Uint8Array): void {
		if (!this.closed) {
			this.frameEmitter.fire(frame);
		}
	}

	private finish(reason: IRemoteTunnelStreamClose, propagate: boolean): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		const peer = this.peer;
		this.closeEmitter.fire(reason);
		this.onFinished(reason);
		super.dispose();
		if (propagate) {
			peer?.finish(reason, false);
		}
	}

	override dispose(): void {
		this.disposeCallCount++;
		this.terminate({ kind: 'graceful' });
	}
}

interface IMockRelayPair {
	readonly client: MockRemoteTunnelRelayStream;
	readonly server: MockRemoteTunnelRelayStream;
}

function createMockRelayPair(
	request: IRemoteTunnelProviderConnectRequest,
	maximumFrameBytes: number,
	onClientFinished: (reason: IRemoteTunnelStreamClose) => void,
): IMockRelayPair {
	const client = new MockRemoteTunnelRelayStream(
		request.identity,
		request.generation,
		maximumFrameBytes,
		onClientFinished,
	);
	const server = new MockRemoteTunnelRelayStream(
		request.identity,
		request.generation,
		maximumFrameBytes,
		() => {},
	);
	client.connectPeer(server);
	server.connectPeer(client);
	return { client, server };
}

interface IMockEndpointState {
	publication: IRemoteTunnelEndpointPublication;
	status: 'online' | 'offline';
	hostConnectionCount: number;
}

interface IMockTunnelRecord {
	readonly identity: IRemoteTunnelIdentity;
	readonly displayName: string;
	readonly visibility: 'private' | 'account';
	revision: number;
	readonly endpoints: Map<string, IMockEndpointState>;
}

interface IMockOperationRecord {
	readonly mutation: IRemoteTunnelMutationIdentity;
	readonly outcome: RemoteTunnelMutationOutcome;
}

class MockOperationLedger {
	private readonly records = new Map<string, IMockOperationRecord>();

	constructor(private readonly maximumEntries: number) {
		if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 4096) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid mock operation retention limit');
		}
	}

	find(mutation: IRemoteTunnelMutationIdentity): RemoteTunnelMutationOutcome | undefined {
		const validated = validateRemoteTunnelMutationIdentity(mutation);
		const record = this.records.get(validated.operation);
		if (!record) {
			return undefined;
		}
		if (!isEqualRemoteTunnelMutationIdentity(record.mutation, validated)) {
			return rejectedOutcome(validated, new RemoteTunnelError(
				RemoteTunnelErrorCode.OperationConflict,
				'Mock Remote Tunnel operation identity changed',
				{ operation: validated.operation },
			));
		}
		return record.outcome;
	}

	record(mutation: IRemoteTunnelMutationIdentity, outcome: RemoteTunnelMutationOutcome): void {
		const validated = validateRemoteTunnelMutationIdentity(mutation);
		if (this.records.has(validated.operation)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Mock Remote Tunnel operation already exists', {
				operation: validated.operation,
			});
		}
		this.makeRoom();
		this.records.set(validated.operation, { mutation: validated, outcome });
	}

	ensureCanRecord(): void {
		this.makeRoom();
	}

	private makeRoom(): void {
		if (this.records.size < this.maximumEntries) {
			return;
		}
		for (const [operation, record] of this.records) {
			if (record.outcome.kind !== 'unknown') {
				this.records.delete(operation);
				return;
			}
		}
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ResourceLimit, 'Mock Remote Tunnel operation ledger is full', {
			maximumEntries: this.maximumEntries,
		});
	}
}

/** Live external hosting attachment owned by the deterministic mock provider. */
export class MockRemoteTunnelProviderHosting extends Disposable implements IRemoteTunnelProviderHosting {
	private readonly connectionEmitter = this._register(new EventEmitter<IRemoteTunnelEndpointStream>({
		onListenerError: onUnexpectedError,
	}));
	private active = true;

	readonly onDidAcceptConnection = this.connectionEmitter.event;

	constructor(
		private readonly provider: MockRemoteTunnelProvider,
		readonly lease: ReturnType<typeof createRemoteTunnelHostingLeaseId>,
		readonly endpointIdentity: IRemoteTunnelEndpointIdentity,
	) {
		super();
	}

	get descriptor(): IRemoteTunnelDescriptor {
		return this.provider.snapshot(this.endpointIdentity);
	}

	get endpoint(): IRemoteTunnelEndpointDescriptor {
		return findRemoteTunnelEndpoint(this.descriptor, this.endpointIdentity);
	}

	async stop(
		request: IRemoteTunnelStopHostingRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome> {
		return this.provider.stopHosting(this, request, credential);
	}

	/** Publishes a newly accepted physical generation to the endpoint owner. */
	accept(stream: IRemoteTunnelEndpointStream): void {
		if (!this.active) {
			stream.dispose();
			return;
		}
		this.connectionEmitter.fire(stream);
	}

	/** Marks the provider attachment stopped after its descriptor commit. */
	finishStopped(): void {
		this.active = false;
	}

	/** Returns whether the external host attachment remains live. */
	isActive(): boolean {
		return this.active;
	}

	override dispose(): void {
		if (this.active) {
			this.active = false;
			this.provider.abandonHosting(this);
		}
		super.dispose();
	}
}

/** Explicit deterministic mock of provider management and relay SDKs. */
export class MockRemoteTunnelProvider extends Disposable implements IRemoteTunnelProvider {
	readonly capabilities: IRemoteTunnelProviderCapabilities = Object.freeze({
		discovery: true,
		management: true,
		hosting: true,
		relay: true,
	});

	private readonly records = new Map<string, IMockTunnelRecord>();
	private readonly operations: MockOperationLedger;
	private readonly hostingsByLease = new Map<string, MockRemoteTunnelProviderHosting>();
	private readonly hostingByEndpoint = new Map<string, MockRemoteTunnelProviderHosting>();
	private readonly activeConnections = new Map<string, Set<MockRemoteTunnelRelayStream>>();
	private readonly lastGenerations = new Map<string, number>();
	private readonly logicalConnectionEndpoints = new Map<string, string>();
	private readonly logicalConnectionGraceExpiries = new Map<string, {
		readonly generation: number;
		readonly cancellation: CancellationTokenSource;
	}>();
	private readonly lostAcknowledgements = new Set<string>();
	private nextEnumerationError: RemoteTunnelError | undefined;
	private nextHostAttachmentError: RemoteTunnelError | undefined;
	private nextGetHostingError: RemoteTunnelError | undefined;
	private nextRelayConnectError: RemoteTunnelError | undefined;
	private nextRelayConnectPause: {
		readonly entered: DeferredPromise<void>;
		readonly release: DeferredPromise<void>;
	} | undefined;
	private nextEarlyAcceptedConnection: RemoteTunnelClientConnectionId | undefined;
	private lastEarlyAcceptedStream: MockRemoteTunnelRelayStream | undefined;
	private leaseCounter = 0;
	private relayConnectCount = 0;

	readonly id: RemoteTunnelProviderId;

	constructor(
		provider: RemoteTunnelProviderId,
		private readonly authentication: MockRemoteTunnelAuthenticationProvider,
		private readonly maximumFrameBytes: number,
		private readonly maximumRetainedOperations: number,
		private readonly maximumLogicalConnections: number,
		private readonly scheduler: IRemoteTunnelScheduler,
		private readonly logicalConnectionGracePeriodMilliseconds: number,
	) {
		super();
		this.id = createRemoteTunnelProviderId(provider);
		this.operations = new MockOperationLedger(maximumRetainedOperations);
		if (!Number.isSafeInteger(maximumLogicalConnections)
			|| maximumLogicalConnections < 1
			|| maximumLogicalConnections > 4096
			|| !Number.isSafeInteger(logicalConnectionGracePeriodMilliseconds)
			|| logicalConnectionGracePeriodMilliseconds < 1
			|| logicalConnectionGracePeriodMilliseconds > 24 * 60 * 60 * 1_000) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid mock logical connection limit');
		}
	}

	/** Makes one committed mutation return unknown once to simulate acknowledgement loss. */
	loseAcknowledgement(operation: IRemoteTunnelMutationIdentity['operation']): void {
		if (!this.lostAcknowledgements.has(operation)
			&& this.lostAcknowledgements.size >= this.maximumRetainedOperations) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ResourceLimit, 'Mock acknowledgement-loss ledger is full', {
				maximumRetainedOperations: this.maximumRetainedOperations,
			});
		}
		this.lostAcknowledgements.add(operation);
	}

	/** Retains one unresolved outcome so Platform reconciliation remains explicit. */
	retainUnknownOutcome(mutation: IRemoteTunnelMutationIdentity): void {
		const validated = validateRemoteTunnelMutationIdentity(mutation);
		this.operations.record(validated, unknownOutcome(validated));
	}

	/** Injects one deterministic enumeration failure. */
	failNextEnumeration(error: RemoteTunnelError): void {
		this.nextEnumerationError = error;
	}

	/** Injects one pre-commit host relay attachment failure. */
	failNextHostAttachment(error: RemoteTunnelError): void {
		this.nextHostAttachmentError = error;
	}

	/** Injects one physical client relay connection failure. */
	failNextRelayConnect(error: RemoteTunnelError): void {
		this.nextRelayConnectError = error;
	}

	/** Pauses the next provider relay connection at its external invocation boundary. */
	pauseNextRelayConnect(): { readonly entered: Promise<void>; release(): void } {
		if (this.nextRelayConnectPause) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Mock relay connect pause is already armed');
		}
		const entered = new DeferredPromise<void>();
		const release = new DeferredPromise<void>();
		this.nextRelayConnectPause = { entered, release };
		return Object.freeze({
			entered: entered.p,
			release: () => release.complete(undefined),
		});
	}

	/** Injects one post-commit failure while resolving the committed live Host attachment. */
	failNextGetHosting(error: RemoteTunnelError): void {
		this.nextGetHostingError = error;
	}

	/** Schedules one accepted stream after lease construction but before startHosting resolves to its caller. */
	acceptConnectionBeforeStartReturns(connection: RemoteTunnelClientConnectionId): void {
		if (this.nextEarlyAcceptedConnection) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Mock early accepted connection is already armed');
		}
		this.nextEarlyAcceptedConnection = connection;
	}

	/** Returns cleanup calls for the most recently injected early accepted stream. */
	getEarlyAcceptedConnectionCleanupCallCounts(): { readonly close: number; readonly dispose: number } {
		if (!this.lastEarlyAcceptedStream) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Mock early accepted connection is unavailable');
		}
		return this.lastEarlyAcceptedStream.getCleanupCallCounts();
	}

	/** Rejects the next send on the one active client stream for an exact endpoint. */
	failNextClientSend(endpoint: IRemoteTunnelEndpointIdentity, error: RemoteTunnelError): void {
		const connections = this.activeConnections.get(remoteTunnelEndpointIdentityKey(endpoint));
		if (!connections || connections.size !== 1) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.OperationConflict, 'Mock endpoint does not have one active client stream');
		}
		connections.values().next().value!.rejectNextSend(error);
	}

	/** Returns the observed external relay connect call count. */
	getRelayConnectCount(): number {
		return this.relayConnectCount;
	}

	async enumerate(
		request: IRemoteTunnelEnumerationRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<readonly IRemoteTunnelDescriptor[]> {
		const account = validateRemoteTunnelAccountIdentity(request.account);
		this.authentication.validate(credential, account, [RemoteTunnelCredentialScope.ManagementRead]);
		if (this.nextEnumerationError) {
			const error = this.nextEnumerationError;
			this.nextEnumerationError = undefined;
			throw error;
		}
		const result: IRemoteTunnelDescriptor[] = [];
		for (const record of this.records.values()) {
			if (!isEqualAccount(record.identity, account)) {
				continue;
			}
			const descriptor = this.descriptor(record);
			if (!request.endpointKind || descriptor.endpoints.some(endpoint => endpoint.kind === request.endpointKind)) {
				result.push(descriptor);
			}
		}
		return Object.freeze(result);
	}

	async lookup(
		identity: IRemoteTunnelIdentity,
		credential: IRemoteTunnelCredentialReference,
	): Promise<IRemoteTunnelDescriptor> {
		const validated = validateRemoteTunnelIdentity(identity);
		this.authentication.validate(credential, validated, [RemoteTunnelCredentialScope.ManagementRead]);
		return this.descriptor(this.requireRecord(validated));
	}

	async createTunnel(
		request: IRemoteTunnelCreateRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome> {
		const identity = validateRemoteTunnelIdentity(request.identity);
		const mutation = validateRemoteTunnelMutationIdentity(request.mutation);
		await assertRemoteTunnelMutationValueDigest(mutation, {
			kind: 'createTunnel',
			displayName: request.displayName,
			visibility: request.visibility,
		});
		this.authentication.validate(credential, identity, [RemoteTunnelCredentialScope.ManagementWrite]);
		const existingOperation = this.operations.find(mutation);
		if (existingOperation) {
			return existingOperation;
		}
		if (mutation.kind !== 'createTunnel'
			|| mutation.target.kind !== 'tunnel'
			|| !isEqualRemoteTunnelIdentity(mutation.target.identity, identity)
			|| mutation.expectedRevision) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.OperationConflict, 'Invalid mock Tunnel creation mutation');
		}
		const key = remoteTunnelIdentityKey(identity);
		if (this.records.has(key)) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.TunnelConflict, 'Mock Remote Tunnel already exists');
		}
		this.operations.ensureCanRecord();
		const record: IMockTunnelRecord = {
			identity,
			displayName: request.displayName,
			visibility: request.visibility,
			revision: 1,
			endpoints: new Map(),
		};
		this.records.set(key, record);
		const outcome = committedOutcome(mutation, Object.freeze({
			kind: 'createTunnel',
			descriptor: this.descriptor(record),
		}));
		this.operations.record(mutation, outcome);
		return this.maybeLoseAcknowledgement(mutation, outcome);
	}

	async startHosting(
		request: IRemoteTunnelStartHostingRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome> {
		const publication = validateRemoteTunnelEndpointPublication(request.endpoint);
		const mutation = validateRemoteTunnelMutationIdentity(request.mutation);
		await assertRemoteTunnelMutationValueDigest(mutation, { kind: 'startHosting', endpoint: publication });
		this.authentication.validate(credential, publication.identity, [
			RemoteTunnelCredentialScope.ManagementWrite,
			RemoteTunnelCredentialScope.HostRelay,
		]);
		const existingOperation = this.operations.find(mutation);
		if (existingOperation) {
			return existingOperation;
		}
		if (mutation.kind !== 'startHosting'
			|| mutation.target.kind !== 'endpoint'
			|| !isEqualRemoteTunnelEndpoint(mutation.target.identity, publication.identity)) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.OperationConflict, 'Invalid mock Tunnel hosting mutation');
		}
		const record = this.requireRecord(publication.identity);
		const revision = createRemoteTunnelRecordRevision(`revision-${record.revision}`);
		if (mutation.expectedRevision !== revision) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.RevisionConflict, 'Mock Tunnel hosting revision changed');
		}
		const endpointKey = remoteTunnelEndpointIdentityKey(publication.identity);
		if (this.hostingByEndpoint.has(endpointKey)) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.HostingConflict, 'Mock Tunnel endpoint already has a Host');
		}
		if (this.nextHostAttachmentError) {
			const error = this.nextHostAttachmentError;
			this.nextHostAttachmentError = undefined;
			const outcome = rejectedOutcome(mutation, error);
			this.operations.record(mutation, outcome);
			return outcome;
		}

		this.operations.ensureCanRecord();
		const endpointState: IMockEndpointState = {
			publication,
			status: 'online',
			hostConnectionCount: 1,
		};
		record.endpoints.set(publication.identity.endpoint, endpointState);
		record.revision++;
		const leaseId = createRemoteTunnelHostingLeaseId(`mock-lease-${++this.leaseCounter}`);
		const hosting = new MockRemoteTunnelProviderHosting(this, leaseId, publication.identity);
		this.hostingsByLease.set(leaseId, hosting);
		this.hostingByEndpoint.set(endpointKey, hosting);
		const descriptor = this.descriptor(record);
		const endpoint = findRemoteTunnelEndpoint(descriptor, publication.identity);
		const outcome = committedOutcome(mutation, Object.freeze({
			kind: 'startHosting',
			lease: leaseId,
			descriptor,
			endpoint,
		}));
		this.operations.record(mutation, outcome);
		return this.maybeLoseAcknowledgement(mutation, outcome);
	}

	async getHosting(
		endpoint: IRemoteTunnelEndpointIdentity,
		lease: ReturnType<typeof createRemoteTunnelHostingLeaseId>,
		credential: IRemoteTunnelCredentialReference,
	): Promise<IRemoteTunnelProviderHosting> {
		this.authentication.validate(credential, endpoint, [
			RemoteTunnelCredentialScope.ManagementWrite,
			RemoteTunnelCredentialScope.HostRelay,
		]);
		const hosting = this.hostingsByLease.get(lease);
		if (!hosting || !hosting.isActive() || !isEqualRemoteTunnelEndpoint(hosting.endpointIdentity, endpoint)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.HostingInactive, 'Mock Remote Tunnel hosting lease is unavailable', {
				lease,
			});
		}
		if (this.nextGetHostingError) {
			const error = this.nextGetHostingError;
			this.nextGetHostingError = undefined;
			throw error;
		}
		const earlyConnection = this.nextEarlyAcceptedConnection;
		if (earlyConnection) {
			this.nextEarlyAcceptedConnection = undefined;
			const request = Object.freeze({
				identity: createRemoteTunnelConnectionIdentity(endpoint, earlyConnection),
				generation: createRemoteTunnelTransportGeneration(1),
			});
			const pair = createMockRelayPair(request, this.maximumFrameBytes, () => {});
			this.lastEarlyAcceptedStream = pair.server;
			queueMicrotask(() => queueMicrotask(() => {
				if (hosting.isActive()) {
					hosting.accept(pair.server);
				} else {
					pair.server.dispose();
				}
			}));
		}
		return hosting;
	}

	async reconcileMutation(
		mutation: IRemoteTunnelMutationIdentity,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome> {
		const validated = validateRemoteTunnelMutationIdentity(mutation);
		const requiredScopes = validated.kind === 'createTunnel'
			? [RemoteTunnelCredentialScope.ManagementWrite]
			: [RemoteTunnelCredentialScope.ManagementWrite, RemoteTunnelCredentialScope.HostRelay];
		this.authentication.validate(credential, validated.target.identity, requiredScopes);
		return this.operations.find(validated) ?? unknownOutcome(validated);
	}

	async connect(
		request: IRemoteTunnelProviderConnectRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<IRemoteTunnelRelayStream> {
		const identity = validateRemoteTunnelConnectionIdentity(request.identity);
		const generation = createRemoteTunnelTransportGeneration(request.generation);
		this.authentication.validate(credential, identity, [
			RemoteTunnelCredentialScope.ManagementRead,
			RemoteTunnelCredentialScope.ClientRelay,
		]);
		this.relayConnectCount++;
		const pause = this.nextRelayConnectPause;
		if (pause) {
			this.nextRelayConnectPause = undefined;
			pause.entered.complete(undefined);
			await pause.release.p;
		}
		if (this.nextRelayConnectError) {
			const error = this.nextRelayConnectError;
			this.nextRelayConnectError = undefined;
			throw error;
		}
		const record = this.requireRecord(identity);
		const endpoint = findRemoteTunnelEndpoint(this.descriptor(record), identity);
		const endpointKey = remoteTunnelEndpointIdentityKey(identity);
		const hosting = this.hostingByEndpoint.get(endpointKey);
		if (endpoint.status !== 'online' || !hosting?.isActive()) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.EndpointOffline, 'Mock Remote Tunnel endpoint is offline', {
				endpoint: identity.endpoint,
			});
		}
		const logicalKey = connectionKey(identity);
		const previousGeneration = this.lastGenerations.get(logicalKey);
		const expectedGeneration = previousGeneration === undefined ? 1 : previousGeneration + 1;
		if (generation !== expectedGeneration) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.GenerationConflict, 'Mock Remote Tunnel generation is not contiguous', {
				expected: expectedGeneration,
				received: generation,
			});
		}
		if (previousGeneration === undefined && this.lastGenerations.size >= this.maximumLogicalConnections) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ResourceLimit, 'Mock Remote Tunnel logical connection limit is full', {
				maximumLogicalConnections: this.maximumLogicalConnections,
			});
		}
		this.cancelLogicalConnectionGraceExpiry(logicalKey);
		this.lastGenerations.set(logicalKey, generation);
		this.logicalConnectionEndpoints.set(logicalKey, endpointKey);
		let client: MockRemoteTunnelRelayStream;
		const pair = createMockRelayPair(request, this.maximumFrameBytes, reason => {
			const connections = this.activeConnections.get(endpointKey);
			connections?.delete(client);
			if (connections?.size === 0) {
				this.activeConnections.delete(endpointKey);
			}
			if (reason.kind === 'lost') {
				this.startLogicalConnectionGraceExpiry(logicalKey, generation);
			} else {
				this.releaseLogicalConnection(logicalKey);
			}
		});
		client = pair.client;
		let connections = this.activeConnections.get(endpointKey);
		if (!connections) {
			connections = new Set();
			this.activeConnections.set(endpointKey, connections);
		}
		connections.add(client);
		hosting.accept(pair.server);
		if (client.isClosed) {
			throw new RemoteTunnelError(
				RemoteTunnelErrorCode.ConnectionTerminal,
				'Mock Remote Tunnel Host rejected the relay connection',
				{ connection: identity.connection },
			);
		}
		return client;
	}

	/** Abruptly loses every current physical stream for one exact endpoint. */
	loseConnections(endpoint: IRemoteTunnelEndpointIdentity): void {
		const connections = Array.from(this.activeConnections.get(remoteTunnelEndpointIdentityKey(endpoint)) ?? []);
		for (const connection of connections) {
			connection.lose(new RemoteTunnelError(RemoteTunnelErrorCode.RelayUnavailable, 'Mock relay transport was lost'));
		}
	}

	private startLogicalConnectionGraceExpiry(logicalKey: string, generation: number): void {
		this.cancelLogicalConnectionGraceExpiry(logicalKey);
		const cancellation = new CancellationTokenSource();
		this.logicalConnectionGraceExpiries.set(logicalKey, { generation, cancellation });
		void this.scheduler.wait({
			kind: 'providerConnectionGraceExpiry',
			delayMilliseconds: this.logicalConnectionGracePeriodMilliseconds,
		}, cancellation.token).then(
			() => {
				const expiry = this.logicalConnectionGraceExpiries.get(logicalKey);
				if (expiry?.cancellation !== cancellation || expiry.generation !== generation) {
					return;
				}
				this.logicalConnectionGraceExpiries.delete(logicalKey);
				cancellation.dispose();
				if (this.lastGenerations.get(logicalKey) === generation) {
					this.lastGenerations.delete(logicalKey);
					this.logicalConnectionEndpoints.delete(logicalKey);
				}
			},
			error => {
				const expiry = this.logicalConnectionGraceExpiries.get(logicalKey);
				if (expiry?.cancellation !== cancellation) {
					return;
				}
				this.logicalConnectionGraceExpiries.delete(logicalKey);
				const cancelled = cancellation.token.isCancellationRequested;
				cancellation.dispose();
				if (!cancelled) {
					onUnexpectedError(error);
					this.lastGenerations.delete(logicalKey);
					this.logicalConnectionEndpoints.delete(logicalKey);
				}
			},
		);
	}

	private cancelLogicalConnectionGraceExpiry(logicalKey: string): void {
		const expiry = this.logicalConnectionGraceExpiries.get(logicalKey);
		if (!expiry) {
			return;
		}
		this.logicalConnectionGraceExpiries.delete(logicalKey);
		expiry.cancellation.cancel();
		expiry.cancellation.dispose();
	}

	private releaseLogicalConnection(logicalKey: string): void {
		this.cancelLogicalConnectionGraceExpiry(logicalKey);
		this.lastGenerations.delete(logicalKey);
		this.logicalConnectionEndpoints.delete(logicalKey);
	}

	/** Returns the current provider descriptor for one exact tunnel. */
	snapshot(identity: IRemoteTunnelIdentity): IRemoteTunnelDescriptor {
		return this.descriptor(this.requireRecord(identity));
	}

	async stopHosting(
		hosting: MockRemoteTunnelProviderHosting,
		request: IRemoteTunnelStopHostingRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome> {
		const mutation = validateRemoteTunnelMutationIdentity(request.mutation);
		await assertRemoteTunnelMutationValueDigest(mutation, { kind: 'stopHosting' });
		this.authentication.validate(credential, hosting.endpointIdentity, [
			RemoteTunnelCredentialScope.ManagementWrite,
			RemoteTunnelCredentialScope.HostRelay,
		]);
		const existingOperation = this.operations.find(mutation);
		if (existingOperation) {
			return existingOperation;
		}
		if (mutation.kind !== 'stopHosting'
			|| mutation.target.kind !== 'endpoint'
			|| !isEqualRemoteTunnelEndpoint(mutation.target.identity, hosting.endpointIdentity)) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.OperationConflict, 'Invalid mock Tunnel stop mutation');
		}
		const record = this.requireRecord(hosting.endpointIdentity);
		const revision = createRemoteTunnelRecordRevision(`revision-${record.revision}`);
		if (mutation.expectedRevision !== revision) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.RevisionConflict, 'Mock Tunnel stop revision changed');
		}
		if (!hosting.isActive()) {
			return this.recordRejection(mutation, RemoteTunnelErrorCode.HostingInactive, 'Mock Tunnel hosting is already inactive');
		}
		this.operations.ensureCanRecord();
		this.finishHosting(record, hosting, new RemoteTunnelError(
			RemoteTunnelErrorCode.EndpointOffline,
			'Mock Tunnel endpoint stopped hosting',
		));
		const descriptor = this.descriptor(record);
		const outcome = committedOutcome(mutation, Object.freeze({ kind: 'stopHosting', descriptor }));
		this.operations.record(mutation, outcome);
		return this.maybeLoseAcknowledgement(mutation, outcome);
	}

	/** Handles abrupt disposal of a live mock provider hosting attachment. */
	abandonHosting(hosting: MockRemoteTunnelProviderHosting): void {
		const key = remoteTunnelEndpointIdentityKey(hosting.endpointIdentity);
		if (this.hostingByEndpoint.get(key) !== hosting) {
			return;
		}
		const record = this.requireRecord(hosting.endpointIdentity);
		this.finishHosting(record, hosting, new RemoteTunnelError(
			RemoteTunnelErrorCode.ConnectionTerminal,
			'Mock Tunnel provider hosting was disposed',
		));
	}

	private finishHosting(
		record: IMockTunnelRecord,
		hosting: MockRemoteTunnelProviderHosting,
		error: RemoteTunnelError,
	): void {
		const endpointState = record.endpoints.get(hosting.endpointIdentity.endpoint);
		if (endpointState) {
			endpointState.status = 'offline';
			endpointState.hostConnectionCount = 0;
			record.revision++;
		}
		hosting.finishStopped();
		this.hostingByEndpoint.delete(remoteTunnelEndpointIdentityKey(hosting.endpointIdentity));
		this.hostingsByLease.delete(hosting.lease);
		const connections = Array.from(this.activeConnections.get(remoteTunnelEndpointIdentityKey(hosting.endpointIdentity)) ?? []);
		for (const connection of connections) {
			connection.terminate({ kind: 'terminal', error });
		}
		const endpointKey = remoteTunnelEndpointIdentityKey(hosting.endpointIdentity);
		for (const [logicalKey, logicalEndpoint] of this.logicalConnectionEndpoints) {
			if (logicalEndpoint === endpointKey) {
				this.releaseLogicalConnection(logicalKey);
			}
		}
	}

	private maybeLoseAcknowledgement(
		mutation: IRemoteTunnelMutationIdentity,
		outcome: RemoteTunnelMutationOutcome,
	): RemoteTunnelMutationOutcome {
		if (!this.lostAcknowledgements.delete(mutation.operation)) {
			return outcome;
		}
		return unknownOutcome(mutation);
	}

	private recordRejection(
		mutation: IRemoteTunnelMutationIdentity,
		code: typeof RemoteTunnelErrorCode[keyof typeof RemoteTunnelErrorCode],
		message: string,
	): RemoteTunnelMutationOutcome {
		const outcome = rejectedOutcome(mutation, new RemoteTunnelError(code, message));
		this.operations.record(mutation, outcome);
		return outcome;
	}

	private requireRecord(identity: IRemoteTunnelIdentity): IMockTunnelRecord {
		const validated = validateRemoteTunnelIdentity(identity);
		const record = this.records.get(remoteTunnelIdentityKey(validated));
		if (record) {
			return record;
		}
		for (const candidate of this.records.values()) {
			if (isEqualAccount(candidate.identity, validated)
				&& candidate.identity.tunnel === validated.tunnel
				&& candidate.identity.cluster !== validated.cluster) {
				throw new RemoteTunnelError(RemoteTunnelErrorCode.ClusterMismatch, 'Mock Remote Tunnel cluster does not match', {
					tunnel: validated.tunnel,
					cluster: validated.cluster,
				});
			}
		}
		throw new RemoteTunnelError(RemoteTunnelErrorCode.TunnelMissing, 'Mock Remote Tunnel does not exist', {
			tunnel: validated.tunnel,
		});
	}

	private descriptor(record: IMockTunnelRecord): IRemoteTunnelDescriptor {
		const endpoints = Array.from(record.endpoints.values(), endpoint => Object.freeze({
			...endpoint.publication,
			status: endpoint.status,
			hostConnectionCount: endpoint.hostConnectionCount,
		}));
		return validateRemoteTunnelDescriptor({
			identity: record.identity,
			displayName: record.displayName,
			visibility: record.visibility,
			revision: createRemoteTunnelRecordRevision(`revision-${record.revision}`),
			endpoints,
		});
	}

	override dispose(): void {
		for (const hosting of Array.from(this.hostingsByLease.values())) {
			hosting.dispose();
		}
		for (const connections of this.activeConnections.values()) {
			for (const connection of Array.from(connections)) {
				connection.dispose();
			}
		}
		this.hostingsByLease.clear();
		this.hostingByEndpoint.clear();
		this.activeConnections.clear();
		for (const logicalKey of [...this.logicalConnectionGraceExpiries.keys()]) {
			this.cancelLogicalConnectionGraceExpiry(logicalKey);
		}
		this.lastGenerations.clear();
		this.logicalConnectionEndpoints.clear();
		this.lostAcknowledgements.clear();
		super.dispose();
	}
}

/** Complete explicit mock product with independent auth, provider, and relay seams. */
export interface IMockRemoteTunnelProduct {
	readonly product: IRemoteTunnelProduct;
	readonly authentication: MockRemoteTunnelAuthenticationProvider;
	readonly provider: MockRemoteTunnelProvider;
}

/** Creates one deterministic external Tunnel product. */
export function createMockRemoteTunnelProduct(options: {
	readonly provider: string;
	readonly maximumFrameBytes: number;
	readonly maximumRetainedOperations: number;
	readonly maximumCredentialReferences: number;
	readonly maximumLogicalConnections: number;
	readonly scheduler: IRemoteTunnelScheduler;
	readonly logicalConnectionGracePeriodMilliseconds: number;
}): IMockRemoteTunnelProduct {
	const providerId = createRemoteTunnelProviderId(options.provider);
	const authentication = new MockRemoteTunnelAuthenticationProvider(
		providerId,
		options.maximumCredentialReferences,
	);
	const provider = new MockRemoteTunnelProvider(
		providerId,
		authentication,
		options.maximumFrameBytes,
		options.maximumRetainedOperations,
		options.maximumLogicalConnections,
		options.scheduler,
		options.logicalConnectionGracePeriodMilliseconds,
	);
	return Object.freeze({
		product: Object.freeze({ id: providerId, provider, authentication }),
		authentication,
		provider,
	});
}

/** Capability used by mock endpoints that accept opaque bounded frames. */
export const MOCK_REMOTE_TUNNEL_FRAME_CAPABILITY = createRemoteTunnelEndpointCapability('mock.frames.v1');
