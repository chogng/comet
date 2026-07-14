/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import type { IDisposable } from 'cs/base/common/lifecycle';
import { RemoteTunnelError, RemoteTunnelErrorCode } from './remoteTunnelErrors.js';

declare const remoteTunnelIdentityBrand: unique symbol;

type RemoteTunnelIdentity<TName extends string> = string & { readonly [remoteTunnelIdentityBrand]: TName };
type RemoteTunnelCounter<TName extends string> = number & { readonly [remoteTunnelIdentityBrand]: TName };

export type RemoteTunnelProviderId = RemoteTunnelIdentity<'RemoteTunnelProviderId'>;
export type RemoteTunnelAccountId = RemoteTunnelIdentity<'RemoteTunnelAccountId'>;
export type RemoteTunnelId = RemoteTunnelIdentity<'RemoteTunnelId'>;
export type RemoteTunnelClusterId = RemoteTunnelIdentity<'RemoteTunnelClusterId'>;
export type RemoteTunnelEndpointId = RemoteTunnelIdentity<'RemoteTunnelEndpointId'>;
export type RemoteTunnelEndpointKind = RemoteTunnelIdentity<'RemoteTunnelEndpointKind'>;
export type RemoteTunnelHostingLeaseId = RemoteTunnelIdentity<'RemoteTunnelHostingLeaseId'>;
export type RemoteTunnelClientConnectionId = RemoteTunnelIdentity<'RemoteTunnelClientConnectionId'>;
export type RemoteTunnelOperationId = RemoteTunnelIdentity<'RemoteTunnelOperationId'>;
export type RemoteTunnelCredentialReferenceId = RemoteTunnelIdentity<'RemoteTunnelCredentialReferenceId'>;
export type RemoteTunnelRecordRevision = RemoteTunnelIdentity<'RemoteTunnelRecordRevision'>;
export type RemoteTunnelValueDigest = RemoteTunnelIdentity<'RemoteTunnelValueDigest'>;
export type RemoteTunnelEndpointCapability = RemoteTunnelIdentity<'RemoteTunnelEndpointCapability'>;
export type RemoteTunnelProtocolRevision = RemoteTunnelCounter<'RemoteTunnelProtocolRevision'>;
export type RemoteTunnelTransportGeneration = RemoteTunnelCounter<'RemoteTunnelTransportGeneration'>;

const namedPattern = /^[a-z][A-Za-z0-9]*(?:[.-][A-Za-z0-9]+)*$/;
const opaquePattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const digestPattern = /^sha256:[a-f0-9]{64}$/;

/** The structured endpoint kind for a Remote Server management transport. */
export const REMOTE_SERVER_TUNNEL_ENDPOINT_KIND = createRemoteTunnelEndpointKind('remoteServer');

/** The structured endpoint kind for a direct Agent Host Protocol transport. */
export const AGENT_HOST_TUNNEL_ENDPOINT_KIND = createRemoteTunnelEndpointKind('agentHost');

/** Provider capabilities used for explicit operation gating. */
export interface IRemoteTunnelProviderCapabilities {
	readonly discovery: boolean;
	readonly management: boolean;
	readonly hosting: boolean;
	readonly relay: boolean;
}

/** One exact provider account. */
export interface IRemoteTunnelAccountIdentity {
	readonly provider: RemoteTunnelProviderId;
	readonly account: RemoteTunnelAccountId;
}

/** One exact provider-owned tunnel and cluster. */
export interface IRemoteTunnelIdentity extends IRemoteTunnelAccountIdentity {
	readonly tunnel: RemoteTunnelId;
	readonly cluster: RemoteTunnelClusterId;
}

/** One exact published service endpoint. */
export interface IRemoteTunnelEndpointIdentity extends IRemoteTunnelIdentity {
	readonly endpoint: RemoteTunnelEndpointId;
}

/** One logical client connection to one exact endpoint. */
export interface IRemoteTunnelConnectionIdentity extends IRemoteTunnelEndpointIdentity {
	readonly connection: RemoteTunnelClientConnectionId;
}

/** A closed inclusive protocol revision range. */
export interface IRemoteTunnelProtocolRevisionRange {
	readonly minimum: RemoteTunnelProtocolRevision;
	readonly maximum: RemoteTunnelProtocolRevision;
}

export type RemoteTunnelVisibility = 'private' | 'account';
export type RemoteTunnelConnectionScope = 'privateAuthenticated' | 'accountAuthenticated';
export type RemoteTunnelEndpointStatus = 'online' | 'offline';

/** A bounded service endpoint descriptor returned by discovery. */
export interface IRemoteTunnelEndpointDescriptor {
	readonly identity: IRemoteTunnelEndpointIdentity;
	readonly kind: RemoteTunnelEndpointKind;
	readonly protocol: IRemoteTunnelProtocolRevisionRange;
	readonly connectionScope: RemoteTunnelConnectionScope;
	readonly capabilities: readonly RemoteTunnelEndpointCapability[];
	readonly status: RemoteTunnelEndpointStatus;
	readonly hostConnectionCount: number;
}

/** A provider-owned tunnel descriptor with structured endpoint metadata. */
export interface IRemoteTunnelDescriptor {
	readonly identity: IRemoteTunnelIdentity;
	readonly displayName: string;
	readonly visibility: RemoteTunnelVisibility;
	readonly revision: RemoteTunnelRecordRevision;
	readonly endpoints: readonly IRemoteTunnelEndpointDescriptor[];
}

/** Endpoint values supplied by its service owner before hosting. */
export interface IRemoteTunnelEndpointPublication {
	readonly identity: IRemoteTunnelEndpointIdentity;
	readonly kind: RemoteTunnelEndpointKind;
	readonly protocol: IRemoteTunnelProtocolRevisionRange;
	readonly connectionScope: RemoteTunnelConnectionScope;
	readonly capabilities: readonly RemoteTunnelEndpointCapability[];
}

export type RemoteTunnelMutationKind = 'createTunnel' | 'startHosting' | 'stopHosting';

/** The exact tunnel or endpoint targeted by one provider mutation. */
export type RemoteTunnelMutationTarget =
	| { readonly kind: 'tunnel'; readonly identity: IRemoteTunnelIdentity }
	| { readonly kind: 'endpoint'; readonly identity: IRemoteTunnelEndpointIdentity };

/** Stable mutation identity retained across provider invocation and reconciliation. */
export interface IRemoteTunnelMutationIdentity {
	readonly kind: RemoteTunnelMutationKind;
	readonly operation: RemoteTunnelOperationId;
	readonly target: RemoteTunnelMutationTarget;
	readonly expectedRevision?: RemoteTunnelRecordRevision;
	readonly valueDigest: RemoteTunnelValueDigest;
}

/** Canonical requested value covered by one provider mutation digest. */
export type RemoteTunnelMutationValue =
	| {
		readonly kind: 'createTunnel';
		readonly displayName: string;
		readonly visibility: RemoteTunnelVisibility;
	}
	| {
		readonly kind: 'startHosting';
		readonly endpoint: IRemoteTunnelEndpointPublication;
	}
	| {
		readonly kind: 'stopHosting';
	};

/** Commit value from exact tunnel creation. */
export interface IRemoteTunnelCreateCommit {
	readonly kind: 'createTunnel';
	readonly descriptor: IRemoteTunnelDescriptor;
}

/** Commit value from atomic endpoint publication and relay attachment. */
export interface IRemoteTunnelStartHostingCommit {
	readonly kind: 'startHosting';
	readonly lease: RemoteTunnelHostingLeaseId;
	readonly descriptor: IRemoteTunnelDescriptor;
	readonly endpoint: IRemoteTunnelEndpointDescriptor;
}

/** Commit value from stopping a hosting lease while retaining its endpoint. */
export interface IRemoteTunnelStopHostingCommit {
	readonly kind: 'stopHosting';
	readonly descriptor: IRemoteTunnelDescriptor;
}

export type RemoteTunnelMutationCommit =
	| IRemoteTunnelCreateCommit
	| IRemoteTunnelStartHostingCommit
	| IRemoteTunnelStopHostingCommit;

/** Typed provider mutation outcome retained for acknowledgement reconciliation. */
export type RemoteTunnelMutationOutcome =
	| {
		readonly kind: 'committed';
		readonly mutation: IRemoteTunnelMutationIdentity;
		readonly commit: RemoteTunnelMutationCommit;
	}
	| {
		readonly kind: 'rejected';
		readonly mutation: IRemoteTunnelMutationIdentity;
		readonly error: RemoteTunnelError;
	}
	| {
		readonly kind: 'unknown';
		readonly mutation: IRemoteTunnelMutationIdentity;
	};

/** Scopes carried by typed credential references. */
export const RemoteTunnelCredentialScope = {
	ManagementRead: 'management.read',
	ManagementWrite: 'management.write',
	HostRelay: 'relay.host',
	ClientRelay: 'relay.connect',
} as const;

export type RemoteTunnelCredentialScope = typeof RemoteTunnelCredentialScope[keyof typeof RemoteTunnelCredentialScope];

/** A secret-free reference to one exact provider authorization. */
export interface IRemoteTunnelCredentialReference extends IRemoteTunnelAccountIdentity {
	readonly reference: RemoteTunnelCredentialReferenceId;
	readonly scopes: readonly RemoteTunnelCredentialScope[];
}

/** Product-owned authentication boundary used by Platform Tunnel. */
export interface IRemoteTunnelAuthenticationProvider {
	readonly provider: RemoteTunnelProviderId;
	acquire(
		account: IRemoteTunnelAccountIdentity,
		scopes: readonly RemoteTunnelCredentialScope[],
	): Promise<IRemoteTunnelCredentialReference>;
}

/** Request to create one exact tunnel record. */
export interface IRemoteTunnelCreateRequest {
	readonly identity: IRemoteTunnelIdentity;
	readonly displayName: string;
	readonly visibility: RemoteTunnelVisibility;
	readonly mutation: IRemoteTunnelMutationIdentity;
}

/** Request to enumerate descriptors for one provider account. */
export interface IRemoteTunnelEnumerationRequest {
	readonly account: IRemoteTunnelAccountIdentity;
	readonly endpointKind?: RemoteTunnelEndpointKind;
}

/** Request to publish and attach one exact endpoint atomically. */
export interface IRemoteTunnelStartHostingRequest {
	readonly endpoint: IRemoteTunnelEndpointPublication;
	readonly mutation: IRemoteTunnelMutationIdentity;
}

/** Request to stop one hosting lease without deleting its endpoint. */
export interface IRemoteTunnelStopHostingRequest {
	readonly mutation: IRemoteTunnelMutationIdentity;
}

/** Request to connect one logical client to one exact endpoint. */
export interface IRemoteTunnelConnectRequest {
	readonly endpoint: IRemoteTunnelEndpointIdentity;
	readonly kind: RemoteTunnelEndpointKind;
	readonly protocol: IRemoteTunnelProtocolRevisionRange;
	readonly connection: RemoteTunnelClientConnectionId;
	readonly reconnect: IRemoteTunnelReconnectPolicy;
}

/** Provider-facing relay request for one physical generation. */
export interface IRemoteTunnelProviderConnectRequest {
	readonly identity: IRemoteTunnelConnectionIdentity;
	readonly generation: RemoteTunnelTransportGeneration;
}

/** A bounded attempt policy for one exact logical route. */
export interface IRemoteTunnelReconnectPolicy {
	readonly maximumAttempts: number;
	readonly initialDelayMilliseconds: number;
	readonly maximumDelayMilliseconds: number;
	readonly gracePeriodMilliseconds: number;
}

/** One explicit delay owned by Tunnel reconnect or logical-connection expiry. */
export type RemoteTunnelScheduledDelay =
	| {
		readonly kind: 'reconnectAttempt';
		readonly attempt: number;
		readonly delayMilliseconds: number;
	}
	| {
		readonly kind: 'clientConnectionGraceExpiry' | 'hostConnectionGraceExpiry' | 'providerConnectionGraceExpiry';
		readonly delayMilliseconds: number;
	};

/** Injected cancellable scheduling boundary for deterministic reconnect ordering and expiry. */
export interface IRemoteTunnelScheduler {
	wait(delay: RemoteTunnelScheduledDelay, cancellation: CancellationToken): Promise<void>;
}

export type RemoteTunnelStreamCloseKind = 'lost' | 'terminal' | 'graceful';

/** Terminal information from one physical relay stream. */
export interface IRemoteTunnelStreamClose {
	readonly kind: RemoteTunnelStreamCloseKind;
	readonly error?: RemoteTunnelError;
}

/** One physical endpoint stream delivered to its protocol owner. */
export interface IRemoteTunnelEndpointStream extends IDisposable {
	readonly identity: IRemoteTunnelConnectionIdentity;
	readonly generation: RemoteTunnelTransportGeneration;
	readonly onDidReceiveFrame: Event<Uint8Array>;
	readonly onDidClose: Event<IRemoteTunnelStreamClose>;
	send(frame: Uint8Array): Promise<void>;
	close(): Promise<void>;
}

/** Provider relay stream with an explicit transport termination operation. */
export interface IRemoteTunnelRelayStream extends IRemoteTunnelEndpointStream {
	terminate(reason: IRemoteTunnelStreamClose): void;
}

/** Provider-owned live hosting attachment. */
export interface IRemoteTunnelProviderHosting extends IDisposable {
	readonly lease: RemoteTunnelHostingLeaseId;
	readonly descriptor: IRemoteTunnelDescriptor;
	readonly endpoint: IRemoteTunnelEndpointDescriptor;
	readonly onDidAcceptConnection: Event<IRemoteTunnelEndpointStream>;
	stop(
		request: IRemoteTunnelStopHostingRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome>;
}

/** Exact provider management and relay boundary. */
export interface IRemoteTunnelProvider {
	readonly id: RemoteTunnelProviderId;
	readonly capabilities: IRemoteTunnelProviderCapabilities;
	enumerate(
		request: IRemoteTunnelEnumerationRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<readonly IRemoteTunnelDescriptor[]>;
	lookup(
		identity: IRemoteTunnelIdentity,
		credential: IRemoteTunnelCredentialReference,
	): Promise<IRemoteTunnelDescriptor>;
	createTunnel(
		request: IRemoteTunnelCreateRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome>;
	startHosting(
		request: IRemoteTunnelStartHostingRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome>;
	getHosting(
		endpoint: IRemoteTunnelEndpointIdentity,
		lease: RemoteTunnelHostingLeaseId,
		credential: IRemoteTunnelCredentialReference,
	): Promise<IRemoteTunnelProviderHosting>;
	reconcileMutation(
		mutation: IRemoteTunnelMutationIdentity,
		credential: IRemoteTunnelCredentialReference,
	): Promise<RemoteTunnelMutationOutcome>;
	connect(
		request: IRemoteTunnelProviderConnectRequest,
		credential: IRemoteTunnelCredentialReference,
	): Promise<IRemoteTunnelRelayStream>;
}

/** One product registration for a provider and its authentication boundary. */
export interface IRemoteTunnelProduct {
	readonly id: RemoteTunnelProviderId;
	readonly provider: IRemoteTunnelProvider;
	readonly authentication: IRemoteTunnelAuthenticationProvider;
}

export type RemoteTunnelHostingState = 'active' | 'stopping' | 'stopped' | 'failed' | 'disposed';

/** Hosting state published by one exact lease. */
export interface IRemoteTunnelHostingStateChange {
	readonly state: RemoteTunnelHostingState;
	readonly descriptor: IRemoteTunnelDescriptor;
	readonly error?: RemoteTunnelError;
}

/** One live Platform-owned endpoint hosting lease. */
export interface IRemoteTunnelHostingLease extends IDisposable {
	readonly lease: RemoteTunnelHostingLeaseId;
	readonly endpoint: IRemoteTunnelEndpointDescriptor;
	readonly descriptor: IRemoteTunnelDescriptor;
	readonly state: RemoteTunnelHostingState;
	readonly onDidChangeState: Event<IRemoteTunnelHostingStateChange>;
	readonly onDidAcceptConnection: Event<IRemoteTunnelEndpointStream>;
	stop(request: IRemoteTunnelStopHostingRequest): Promise<IRemoteTunnelDescriptor>;
}

/** Platform owner for endpoint publication and hosting leases. */
export interface IRemoteTunnelHostService extends IDisposable {
	startHosting(request: IRemoteTunnelStartHostingRequest): Promise<IRemoteTunnelHostingLease>;
}

export type RemoteTunnelConnectionState = 'connected' | 'reconnecting' | 'paused' | 'closed' | 'failed';

/** State of one logical connection at its current transport generation. */
export interface IRemoteTunnelConnectionStateChange {
	readonly state: RemoteTunnelConnectionState;
	readonly generation: RemoteTunnelTransportGeneration;
	readonly error?: RemoteTunnelError;
}

/** Close information for one logical tunnel connection. */
export interface IRemoteTunnelConnectionClose {
	readonly state: 'closed' | 'failed';
	readonly generation: RemoteTunnelTransportGeneration;
	readonly error?: RemoteTunnelError;
}

/** One logical client connection preserved across relay generations. */
export interface IRemoteTunnelConnection extends IDisposable {
	readonly identity: IRemoteTunnelConnectionIdentity;
	readonly endpoint: IRemoteTunnelEndpointDescriptor;
	readonly generation: RemoteTunnelTransportGeneration;
	readonly state: RemoteTunnelConnectionState;
	readonly onDidChangeState: Event<IRemoteTunnelConnectionStateChange>;
	readonly onDidChangeGeneration: Event<RemoteTunnelTransportGeneration>;
	readonly onDidReceiveFrame: Event<Uint8Array>;
	readonly onDidClose: Event<IRemoteTunnelConnectionClose>;
	send(frame: Uint8Array): Promise<void>;
	resume(): Promise<void>;
	close(): Promise<void>;
}

/** Platform connection and discovery surface. */
export interface IRemoteTunnelService extends IDisposable {
	enumerate(request: IRemoteTunnelEnumerationRequest): Promise<readonly IRemoteTunnelDescriptor[]>;
	lookup(identity: IRemoteTunnelIdentity): Promise<IRemoteTunnelDescriptor>;
	createTunnel(request: IRemoteTunnelCreateRequest): Promise<IRemoteTunnelDescriptor>;
	connect(request: IRemoteTunnelConnectRequest): Promise<IRemoteTunnelConnection>;
}

function assertIdentity(value: string, identity: string, maximumLength: number, pattern: RegExp): string {
	if (value.length === 0 || value.length > maximumLength || !pattern.test(value)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidIdentity, `Invalid ${identity}`, {
			identity,
			value: value.slice(0, 256),
		});
	}
	return value;
}

function createNamedIdentity<TName extends string>(value: string, identity: TName): RemoteTunnelIdentity<TName> {
	return assertIdentity(value, identity, 128, namedPattern) as RemoteTunnelIdentity<TName>;
}

function createOpaqueIdentity<TName extends string>(value: string, identity: TName): RemoteTunnelIdentity<TName> {
	return assertIdentity(value, identity, 256, opaquePattern) as RemoteTunnelIdentity<TName>;
}

function createPositiveCounter<TName extends string>(value: number, identity: TName): RemoteTunnelCounter<TName> {
	if (!Number.isSafeInteger(value) || value < 1) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidIdentity, `Invalid ${identity}`, {
			identity,
			value,
		});
	}
	return value as RemoteTunnelCounter<TName>;
}

/** Creates a validated provider identity. */
export function createRemoteTunnelProviderId(value: string): RemoteTunnelProviderId {
	return createNamedIdentity(value, 'RemoteTunnelProviderId');
}

/** Creates a validated provider account identity. */
export function createRemoteTunnelAccountId(value: string): RemoteTunnelAccountId {
	return createOpaqueIdentity(value, 'RemoteTunnelAccountId');
}

/** Creates a validated tunnel record identity. */
export function createRemoteTunnelId(value: string): RemoteTunnelId {
	return createOpaqueIdentity(value, 'RemoteTunnelId');
}

/** Creates a validated provider cluster identity. */
export function createRemoteTunnelClusterId(value: string): RemoteTunnelClusterId {
	return createOpaqueIdentity(value, 'RemoteTunnelClusterId');
}

/** Creates a validated service endpoint identity. */
export function createRemoteTunnelEndpointId(value: string): RemoteTunnelEndpointId {
	return createOpaqueIdentity(value, 'RemoteTunnelEndpointId');
}

/** Creates a validated structured endpoint kind. */
export function createRemoteTunnelEndpointKind(value: string): RemoteTunnelEndpointKind {
	return createNamedIdentity(value, 'RemoteTunnelEndpointKind');
}

/** Creates a validated hosting lease identity. */
export function createRemoteTunnelHostingLeaseId(value: string): RemoteTunnelHostingLeaseId {
	return createOpaqueIdentity(value, 'RemoteTunnelHostingLeaseId');
}

/** Creates a validated logical client connection identity. */
export function createRemoteTunnelClientConnectionId(value: string): RemoteTunnelClientConnectionId {
	return createOpaqueIdentity(value, 'RemoteTunnelClientConnectionId');
}

/** Creates a validated mutation operation identity. */
export function createRemoteTunnelOperationId(value: string): RemoteTunnelOperationId {
	return createOpaqueIdentity(value, 'RemoteTunnelOperationId');
}

/** Creates a validated secret-free credential reference identity. */
export function createRemoteTunnelCredentialReferenceId(value: string): RemoteTunnelCredentialReferenceId {
	return createOpaqueIdentity(value, 'RemoteTunnelCredentialReferenceId');
}

/** Creates a validated provider record revision. */
export function createRemoteTunnelRecordRevision(value: string): RemoteTunnelRecordRevision {
	return createOpaqueIdentity(value, 'RemoteTunnelRecordRevision');
}

/** Creates a validated mutation value digest. */
export function createRemoteTunnelValueDigest(value: string): RemoteTunnelValueDigest {
	return assertIdentity(value, 'RemoteTunnelValueDigest', 71, digestPattern) as RemoteTunnelValueDigest;
}

type RemoteTunnelCanonicalValue =
	| null
	| boolean
	| number
	| string
	| readonly RemoteTunnelCanonicalValue[]
	| { readonly [key: string]: RemoteTunnelCanonicalValue };

function encodeRemoteTunnelCanonicalValue(value: RemoteTunnelCanonicalValue): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}
	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Remote Tunnel canonical number is invalid');
		}
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) {
		return `[${value.map(entry => encodeRemoteTunnelCanonicalValue(entry)).join(',')}]`;
	}
	const record = value as { readonly [key: string]: RemoteTunnelCanonicalValue };
	const entries = Object.entries(record).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
	return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${encodeRemoteTunnelCanonicalValue(entry)}`).join(',')}}`;
}

function canonicalRemoteTunnelMutationValue(value: RemoteTunnelMutationValue): RemoteTunnelCanonicalValue {
	if (value.kind === 'createTunnel') {
		if (value.displayName.length === 0 || value.displayName.length > 128
			|| (value.visibility !== 'private' && value.visibility !== 'account')) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel creation value');
		}
		return {
			kind: value.kind,
			displayName: value.displayName,
			visibility: value.visibility,
		};
	}
	if (value.kind === 'startHosting') {
		const endpoint = validateRemoteTunnelEndpointPublication(value.endpoint);
		return {
			kind: value.kind,
			endpoint: {
				identity: {
					provider: endpoint.identity.provider,
					account: endpoint.identity.account,
					tunnel: endpoint.identity.tunnel,
					cluster: endpoint.identity.cluster,
					endpoint: endpoint.identity.endpoint,
				},
				kind: endpoint.kind,
				protocol: {
					minimum: endpoint.protocol.minimum,
					maximum: endpoint.protocol.maximum,
				},
				connectionScope: endpoint.connectionScope,
				capabilities: [...endpoint.capabilities].sort(),
			},
		};
	}
	if (value.kind === 'stopHosting') {
		return { kind: value.kind };
	}
	throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel mutation value kind');
}

/** Computes the exact SHA-256 digest of one normalized requested mutation value. */
export async function computeRemoteTunnelMutationValueDigest(
	value: RemoteTunnelMutationValue,
): Promise<RemoteTunnelValueDigest> {
	const encoded = encodeRemoteTunnelCanonicalValue(canonicalRemoteTunnelMutationValue(value));
	const bytes = new TextEncoder().encode(encoded);
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	const hexadecimal = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
	return createRemoteTunnelValueDigest(`sha256:${hexadecimal}`);
}

/** Rejects a mutation identity whose claimed digest does not cover its exact requested value. */
export async function assertRemoteTunnelMutationValueDigest(
	mutation: IRemoteTunnelMutationIdentity,
	value: RemoteTunnelMutationValue,
): Promise<void> {
	const validated = validateRemoteTunnelMutationIdentity(mutation);
	const computed = await computeRemoteTunnelMutationValueDigest(value);
	if (validated.kind !== value.kind || validated.valueDigest !== computed) {
		throw new RemoteTunnelError(
			RemoteTunnelErrorCode.OperationConflict,
			'Remote Tunnel mutation digest does not match its requested value',
			{ operation: validated.operation },
		);
	}
}

/** Creates a validated endpoint capability identity. */
export function createRemoteTunnelEndpointCapability(value: string): RemoteTunnelEndpointCapability {
	return createNamedIdentity(value, 'RemoteTunnelEndpointCapability');
}

/** Creates a positive protocol revision. */
export function createRemoteTunnelProtocolRevision(value: number): RemoteTunnelProtocolRevision {
	return createPositiveCounter(value, 'RemoteTunnelProtocolRevision');
}

/** Creates a positive transport generation. */
export function createRemoteTunnelTransportGeneration(value: number): RemoteTunnelTransportGeneration {
	return createPositiveCounter(value, 'RemoteTunnelTransportGeneration');
}

/** Creates one exact immutable account identity. */
export function createRemoteTunnelAccountIdentity(provider: string, account: string): IRemoteTunnelAccountIdentity {
	return Object.freeze({
		provider: createRemoteTunnelProviderId(provider),
		account: createRemoteTunnelAccountId(account),
	});
}

/** Creates one exact immutable tunnel identity. */
export function createRemoteTunnelIdentity(
	provider: string,
	account: string,
	tunnel: string,
	cluster: string,
): IRemoteTunnelIdentity {
	return Object.freeze({
		...createRemoteTunnelAccountIdentity(provider, account),
		tunnel: createRemoteTunnelId(tunnel),
		cluster: createRemoteTunnelClusterId(cluster),
	});
}

/** Creates one exact immutable endpoint identity. */
export function createRemoteTunnelEndpointIdentity(
	provider: string,
	account: string,
	tunnel: string,
	cluster: string,
	endpoint: string,
): IRemoteTunnelEndpointIdentity {
	return Object.freeze({
		...createRemoteTunnelIdentity(provider, account, tunnel, cluster),
		endpoint: createRemoteTunnelEndpointId(endpoint),
	});
}

/** Creates one exact immutable logical connection identity. */
export function createRemoteTunnelConnectionIdentity(
	endpoint: IRemoteTunnelEndpointIdentity,
	connection: RemoteTunnelClientConnectionId,
): IRemoteTunnelConnectionIdentity {
	return Object.freeze({
		...validateRemoteTunnelEndpointIdentity(endpoint),
		connection: createRemoteTunnelClientConnectionId(connection),
	});
}

/** Revalidates and freezes one account identity. */
export function validateRemoteTunnelAccountIdentity(identity: IRemoteTunnelAccountIdentity): IRemoteTunnelAccountIdentity {
	return createRemoteTunnelAccountIdentity(identity.provider, identity.account);
}

/** Revalidates and freezes one tunnel identity. */
export function validateRemoteTunnelIdentity(identity: IRemoteTunnelIdentity): IRemoteTunnelIdentity {
	return createRemoteTunnelIdentity(identity.provider, identity.account, identity.tunnel, identity.cluster);
}

/** Revalidates and freezes one endpoint identity. */
export function validateRemoteTunnelEndpointIdentity(identity: IRemoteTunnelEndpointIdentity): IRemoteTunnelEndpointIdentity {
	return createRemoteTunnelEndpointIdentity(
		identity.provider,
		identity.account,
		identity.tunnel,
		identity.cluster,
		identity.endpoint,
	);
}

/** Revalidates and freezes one connection identity. */
export function validateRemoteTunnelConnectionIdentity(identity: IRemoteTunnelConnectionIdentity): IRemoteTunnelConnectionIdentity {
	return createRemoteTunnelConnectionIdentity(
		validateRemoteTunnelEndpointIdentity(identity),
		createRemoteTunnelClientConnectionId(identity.connection),
	);
}

/** Returns whether two account identities are exactly equal. */
export function isEqualRemoteTunnelAccount(
	first: IRemoteTunnelAccountIdentity,
	second: IRemoteTunnelAccountIdentity,
): boolean {
	return first.provider === second.provider && first.account === second.account;
}

/** Returns whether two tunnel identities are exactly equal. */
export function isEqualRemoteTunnelIdentity(first: IRemoteTunnelIdentity, second: IRemoteTunnelIdentity): boolean {
	return isEqualRemoteTunnelAccount(first, second)
		&& first.tunnel === second.tunnel
		&& first.cluster === second.cluster;
}

/** Returns whether two endpoint identities are exactly equal. */
export function isEqualRemoteTunnelEndpoint(
	first: IRemoteTunnelEndpointIdentity,
	second: IRemoteTunnelEndpointIdentity,
): boolean {
	return isEqualRemoteTunnelIdentity(first, second) && first.endpoint === second.endpoint;
}

/** Produces an internal collision-free tunnel key. */
export function remoteTunnelIdentityKey(identity: IRemoteTunnelIdentity): string {
	const validated = validateRemoteTunnelIdentity(identity);
	return `${validated.provider}\u0000${validated.account}\u0000${validated.tunnel}\u0000${validated.cluster}`;
}

/** Produces an internal collision-free endpoint key. */
export function remoteTunnelEndpointIdentityKey(identity: IRemoteTunnelEndpointIdentity): string {
	const validated = validateRemoteTunnelEndpointIdentity(identity);
	return `${remoteTunnelIdentityKey(validated)}\u0000${validated.endpoint}`;
}

/** Revalidates and freezes one exact provider mutation identity. */
export function validateRemoteTunnelMutationIdentity(
	mutation: IRemoteTunnelMutationIdentity,
): IRemoteTunnelMutationIdentity {
	if (mutation.kind !== 'createTunnel' && mutation.kind !== 'startHosting' && mutation.kind !== 'stopHosting') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel mutation kind');
	}
	if (mutation.target.kind !== 'tunnel' && mutation.target.kind !== 'endpoint') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel mutation target');
	}
	if ((mutation.kind === 'createTunnel' && mutation.target.kind !== 'tunnel')
		|| (mutation.kind !== 'createTunnel' && mutation.target.kind !== 'endpoint')) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Remote Tunnel mutation target kind does not match', {
			kind: mutation.kind,
			targetKind: mutation.target.kind,
		});
	}
	const target: RemoteTunnelMutationTarget = mutation.target.kind === 'tunnel'
		? Object.freeze({ kind: 'tunnel', identity: validateRemoteTunnelIdentity(mutation.target.identity) })
		: Object.freeze({ kind: 'endpoint', identity: validateRemoteTunnelEndpointIdentity(mutation.target.identity) });
	return Object.freeze({
		kind: mutation.kind,
		operation: createRemoteTunnelOperationId(mutation.operation),
		target,
		...(mutation.expectedRevision
			? { expectedRevision: createRemoteTunnelRecordRevision(mutation.expectedRevision) }
			: {}),
		valueDigest: createRemoteTunnelValueDigest(mutation.valueDigest),
	});
}

/** Returns whether two provider mutation identities are exactly equal. */
export function isEqualRemoteTunnelMutationIdentity(
	first: IRemoteTunnelMutationIdentity,
	second: IRemoteTunnelMutationIdentity,
): boolean {
	const left = validateRemoteTunnelMutationIdentity(first);
	const right = validateRemoteTunnelMutationIdentity(second);
	const targetMatches = left.target.kind === right.target.kind
		&& (left.target.kind === 'tunnel'
			? isEqualRemoteTunnelIdentity(left.target.identity, right.target.identity)
			: right.target.kind === 'endpoint' && isEqualRemoteTunnelEndpoint(left.target.identity, right.target.identity));
	return left.kind === right.kind
		&& left.operation === right.operation
		&& left.expectedRevision === right.expectedRevision
		&& left.valueDigest === right.valueDigest
		&& targetMatches;
}

/** Validates a closed protocol revision range. */
export function validateRemoteTunnelProtocolRange(
	range: IRemoteTunnelProtocolRevisionRange,
): IRemoteTunnelProtocolRevisionRange {
	const minimum = createRemoteTunnelProtocolRevision(range.minimum);
	const maximum = createRemoteTunnelProtocolRevision(range.maximum);
	if (minimum > maximum) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Remote Tunnel protocol range is reversed', {
			minimum,
			maximum,
		});
	}
	return Object.freeze({ minimum, maximum });
}

/** Returns whether two protocol revision ranges overlap. */
export function isRemoteTunnelProtocolCompatible(
	endpoint: IRemoteTunnelProtocolRevisionRange,
	client: IRemoteTunnelProtocolRevisionRange,
): boolean {
	const endpointRange = validateRemoteTunnelProtocolRange(endpoint);
	const clientRange = validateRemoteTunnelProtocolRange(client);
	return Math.max(endpointRange.minimum, clientRange.minimum) <= Math.min(endpointRange.maximum, clientRange.maximum);
}

function validateEndpointCapabilities(
	capabilities: readonly RemoteTunnelEndpointCapability[],
): readonly RemoteTunnelEndpointCapability[] {
	if (capabilities.length > 64) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Too many Remote Tunnel endpoint capabilities', {
			count: capabilities.length,
		});
	}
	const seen = new Set<RemoteTunnelEndpointCapability>();
	return Object.freeze(capabilities.map(capability => {
		const validated = createRemoteTunnelEndpointCapability(capability);
		if (seen.has(validated)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Duplicate Remote Tunnel endpoint capability', {
				capability: validated,
			});
		}
		seen.add(validated);
		return validated;
	}));
}

function validateServiceEndpointSecurity(
	kind: RemoteTunnelEndpointKind,
	connectionScope: RemoteTunnelConnectionScope,
): void {
	if ((kind === REMOTE_SERVER_TUNNEL_ENDPOINT_KIND || kind === AGENT_HOST_TUNNEL_ENDPOINT_KIND)
		&& connectionScope !== 'privateAuthenticated') {
		throw new RemoteTunnelError(
			RemoteTunnelErrorCode.InvalidDescriptor,
			'Comet service endpoints require private authenticated scope',
			{ kind, connectionScope },
		);
	}
}

/** Validates endpoint publication values before a provider mutation. */
export function validateRemoteTunnelEndpointPublication(
	publication: IRemoteTunnelEndpointPublication,
): IRemoteTunnelEndpointPublication {
	const identity = validateRemoteTunnelEndpointIdentity(publication.identity);
	const kind = createRemoteTunnelEndpointKind(publication.kind);
	if (publication.connectionScope !== 'privateAuthenticated'
		&& publication.connectionScope !== 'accountAuthenticated') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel connection scope');
	}
	validateServiceEndpointSecurity(kind, publication.connectionScope);
	return Object.freeze({
		identity,
		kind,
		protocol: validateRemoteTunnelProtocolRange(publication.protocol),
		connectionScope: publication.connectionScope,
		capabilities: validateEndpointCapabilities(publication.capabilities),
	});
}

/** Returns whether two validated endpoint publications carry the same declared values. */
export function isEqualRemoteTunnelEndpointPublication(
	first: IRemoteTunnelEndpointPublication,
	second: IRemoteTunnelEndpointPublication,
): boolean {
	const left = validateRemoteTunnelEndpointPublication(first);
	const right = validateRemoteTunnelEndpointPublication(second);
	return isEqualRemoteTunnelEndpoint(left.identity, right.identity)
		&& left.kind === right.kind
		&& left.protocol.minimum === right.protocol.minimum
		&& left.protocol.maximum === right.protocol.maximum
		&& left.connectionScope === right.connectionScope
		&& left.capabilities.length === right.capabilities.length
		&& left.capabilities.every(capability => right.capabilities.includes(capability));
}

/** Validates one discovered endpoint descriptor. */
export function validateRemoteTunnelEndpointDescriptor(
	descriptor: IRemoteTunnelEndpointDescriptor,
): IRemoteTunnelEndpointDescriptor {
	const publication = validateRemoteTunnelEndpointPublication(descriptor);
	if (descriptor.status !== 'online' && descriptor.status !== 'offline') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel endpoint status');
	}
	if (!Number.isSafeInteger(descriptor.hostConnectionCount) || descriptor.hostConnectionCount < 0) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel host count', {
			hostConnectionCount: descriptor.hostConnectionCount,
		});
	}
	if ((descriptor.status === 'online' && descriptor.hostConnectionCount === 0)
		|| (descriptor.status === 'offline' && descriptor.hostConnectionCount !== 0)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Remote Tunnel endpoint status conflicts with host count', {
			status: descriptor.status,
			hostConnectionCount: descriptor.hostConnectionCount,
		});
	}
	return Object.freeze({
		...publication,
		status: descriptor.status,
		hostConnectionCount: descriptor.hostConnectionCount,
	});
}

/** Returns whether two endpoint descriptors carry the same identity, publication, and status. */
export function isEqualRemoteTunnelEndpointDescriptor(
	first: IRemoteTunnelEndpointDescriptor,
	second: IRemoteTunnelEndpointDescriptor,
): boolean {
	const left = validateRemoteTunnelEndpointDescriptor(first);
	const right = validateRemoteTunnelEndpointDescriptor(second);
	return isEqualRemoteTunnelEndpointPublication(left, right)
		&& left.status === right.status
		&& left.hostConnectionCount === right.hostConnectionCount;
}

/** Validates and deeply freezes one tunnel descriptor. */
export function validateRemoteTunnelDescriptor(descriptor: IRemoteTunnelDescriptor): IRemoteTunnelDescriptor {
	const identity = validateRemoteTunnelIdentity(descriptor.identity);
	if (descriptor.displayName.length === 0 || descriptor.displayName.length > 128) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel display name', {
			length: descriptor.displayName.length,
		});
	}
	if (descriptor.visibility !== 'private' && descriptor.visibility !== 'account') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel visibility');
	}
	if (descriptor.endpoints.length > 64) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Too many Remote Tunnel endpoints', {
			count: descriptor.endpoints.length,
		});
	}
	const endpointIds = new Set<RemoteTunnelEndpointId>();
	const endpoints = Object.freeze(descriptor.endpoints.map(endpoint => {
		const validated = validateRemoteTunnelEndpointDescriptor(endpoint);
		if (!isEqualRemoteTunnelIdentity(validated.identity, identity)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Endpoint belongs to another Remote Tunnel', {
				endpoint: validated.identity.endpoint,
			});
		}
		if (endpointIds.has(validated.identity.endpoint)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Duplicate Remote Tunnel endpoint', {
				endpoint: validated.identity.endpoint,
			});
		}
		endpointIds.add(validated.identity.endpoint);
		return validated;
	}));
	return Object.freeze({
		identity,
		displayName: descriptor.displayName,
		visibility: descriptor.visibility,
		revision: createRemoteTunnelRecordRevision(descriptor.revision),
		endpoints,
	});
}

/** Returns whether two complete provider descriptors carry the same durable values. */
export function isEqualRemoteTunnelDescriptor(
	first: IRemoteTunnelDescriptor,
	second: IRemoteTunnelDescriptor,
): boolean {
	const left = validateRemoteTunnelDescriptor(first);
	const right = validateRemoteTunnelDescriptor(second);
	if (!isEqualRemoteTunnelIdentity(left.identity, right.identity)
		|| left.displayName !== right.displayName
		|| left.visibility !== right.visibility
		|| left.revision !== right.revision
		|| left.endpoints.length !== right.endpoints.length) {
		return false;
	}
	return left.endpoints.every(endpoint => {
		const other = right.endpoints.find(candidate => candidate.identity.endpoint === endpoint.identity.endpoint);
		return other !== undefined && isEqualRemoteTunnelEndpointDescriptor(endpoint, other);
	});
}

/** Finds one exact endpoint without interpreting labels or ports. */
export function findRemoteTunnelEndpoint(
	descriptor: IRemoteTunnelDescriptor,
	identity: IRemoteTunnelEndpointIdentity,
): IRemoteTunnelEndpointDescriptor {
	const validatedDescriptor = validateRemoteTunnelDescriptor(descriptor);
	const validatedIdentity = validateRemoteTunnelEndpointIdentity(identity);
	if (!isEqualRemoteTunnelIdentity(validatedDescriptor.identity, validatedIdentity)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ClusterMismatch, 'Remote Tunnel descriptor identity does not match endpoint', {
			tunnel: validatedIdentity.tunnel,
			cluster: validatedIdentity.cluster,
		});
	}
	const endpoint = validatedDescriptor.endpoints.find(candidate => candidate.identity.endpoint === validatedIdentity.endpoint);
	if (!endpoint) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.EndpointMissing, 'Remote Tunnel endpoint is not published', {
			endpoint: validatedIdentity.endpoint,
		});
	}
	return endpoint;
}

/** Validates a provider mutation outcome against the exact submitted identity. */
export function validateRemoteTunnelMutationOutcome(
	outcome: RemoteTunnelMutationOutcome,
	mutation: IRemoteTunnelMutationIdentity,
): RemoteTunnelMutationOutcome {
	const expected = validateRemoteTunnelMutationIdentity(mutation);
	const received = validateRemoteTunnelMutationIdentity(outcome.mutation);
	if (!isEqualRemoteTunnelMutationIdentity(received, expected)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider reconciled another Remote Tunnel mutation', {
			operation: expected.operation,
		});
	}
	if (outcome.kind === 'unknown') {
		return Object.freeze({ kind: 'unknown', mutation: expected });
	}
	if (outcome.kind === 'rejected') {
		if (!(outcome.error instanceof RemoteTunnelError)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned an invalid Remote Tunnel rejection', {
				operation: expected.operation,
			});
		}
		return Object.freeze({ kind: 'rejected', mutation: expected, error: outcome.error });
	}
	if (outcome.kind !== 'committed' || outcome.commit.kind !== expected.kind) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned an invalid Remote Tunnel commit kind', {
			operation: expected.operation,
		});
	}

	if (outcome.commit.kind === 'createTunnel') {
		if (expected.target.kind !== 'tunnel') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Tunnel creation committed for another target kind');
		}
		return Object.freeze({
			kind: 'committed',
			mutation: expected,
			commit: Object.freeze({
				kind: 'createTunnel',
				descriptor: validateRemoteTunnelLookupDescriptor(outcome.commit.descriptor, expected.target.identity),
			}),
		});
	}

	if (expected.target.kind !== 'endpoint') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Endpoint mutation committed for another target kind');
	}
	const descriptor = validateRemoteTunnelLookupDescriptor(outcome.commit.descriptor, expected.target.identity);
	const endpoint = findRemoteTunnelEndpoint(descriptor, expected.target.identity);
	if (outcome.commit.kind === 'startHosting') {
		const committedEndpoint = validateRemoteTunnelEndpointDescriptor(outcome.commit.endpoint);
		if (!isEqualRemoteTunnelEndpoint(committedEndpoint.identity, expected.target.identity)
			|| !isEqualRemoteTunnelEndpointDescriptor(committedEndpoint, endpoint)
			|| committedEndpoint.status !== 'online'
			|| endpoint.status !== 'online') {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned an invalid hosting commit', {
				operation: expected.operation,
			});
		}
		return Object.freeze({
			kind: 'committed',
			mutation: expected,
			commit: Object.freeze({
				kind: 'startHosting',
				lease: createRemoteTunnelHostingLeaseId(outcome.commit.lease),
				descriptor,
				endpoint,
			}),
		});
	}

	if (endpoint.status !== 'offline') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned an online endpoint after hosting stop', {
			operation: expected.operation,
		});
	}
	return Object.freeze({
		kind: 'committed',
		mutation: expected,
		commit: Object.freeze({ kind: 'stopHosting', descriptor }),
	});
}

/** Validates exact kind, compatibility, and online state for a connection. */
export function validateRemoteTunnelConnectEndpoint(
	descriptor: IRemoteTunnelDescriptor,
	request: IRemoteTunnelConnectRequest,
): IRemoteTunnelEndpointDescriptor {
	const endpoint = findRemoteTunnelEndpoint(descriptor, request.endpoint);
	const kind = createRemoteTunnelEndpointKind(request.kind);
	if (endpoint.kind !== kind || !isRemoteTunnelProtocolCompatible(endpoint.protocol, request.protocol)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.EndpointIncompatible, 'Remote Tunnel endpoint is incompatible', {
			endpoint: endpoint.identity.endpoint,
			expectedKind: kind,
			receivedKind: endpoint.kind,
		});
	}
	if (endpoint.status !== 'online') {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.EndpointOffline, 'Remote Tunnel endpoint is offline', {
			endpoint: endpoint.identity.endpoint,
		});
	}
	return endpoint;
}

/** Validates reconnect limits without choosing another route. */
export function validateRemoteTunnelReconnectPolicy(
	policy: IRemoteTunnelReconnectPolicy,
): IRemoteTunnelReconnectPolicy {
	if (!Number.isSafeInteger(policy.maximumAttempts) || policy.maximumAttempts < 1 || policy.maximumAttempts > 64
		|| !Number.isSafeInteger(policy.initialDelayMilliseconds) || policy.initialDelayMilliseconds < 0
		|| !Number.isSafeInteger(policy.maximumDelayMilliseconds) || policy.maximumDelayMilliseconds < 0
		|| policy.initialDelayMilliseconds > policy.maximumDelayMilliseconds
		|| !Number.isSafeInteger(policy.gracePeriodMilliseconds) || policy.gracePeriodMilliseconds < 1
		|| policy.gracePeriodMilliseconds > 24 * 60 * 60 * 1_000) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.InvalidDescriptor, 'Invalid Remote Tunnel reconnect policy');
	}
	return Object.freeze({
		maximumAttempts: policy.maximumAttempts,
		initialDelayMilliseconds: policy.initialDelayMilliseconds,
		maximumDelayMilliseconds: policy.maximumDelayMilliseconds,
		gracePeriodMilliseconds: policy.gracePeriodMilliseconds,
	});
}

/** Validates a credential reference for one exact account and scope set. */
export function validateRemoteTunnelCredentialReference(
	credential: IRemoteTunnelCredentialReference,
	account: IRemoteTunnelAccountIdentity,
	requiredScopes: readonly RemoteTunnelCredentialScope[],
): IRemoteTunnelCredentialReference {
	const expectedAccount = validateRemoteTunnelAccountIdentity(account);
	const credentialAccount = validateRemoteTunnelAccountIdentity(credential);
	if (!isEqualRemoteTunnelAccount(expectedAccount, credentialAccount)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.AuthenticationDenied, 'Remote Tunnel credential addresses another account', {
			provider: expectedAccount.provider,
			account: expectedAccount.account,
		});
	}
	const scopes = new Set<RemoteTunnelCredentialScope>();
	for (const scope of credential.scopes) {
		if (!Object.values(RemoteTunnelCredentialScope).includes(scope) || scopes.has(scope)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.AuthenticationDenied, 'Invalid Remote Tunnel credential scopes');
		}
		scopes.add(scope);
	}
	for (const scope of requiredScopes) {
		if (!scopes.has(scope)) {
			throw new RemoteTunnelError(RemoteTunnelErrorCode.CredentialScopeDenied, 'Remote Tunnel credential scope is missing', {
				scope,
			});
		}
	}
	return Object.freeze({
		...credentialAccount,
		reference: createRemoteTunnelCredentialReferenceId(credential.reference),
		scopes: Object.freeze(Array.from(scopes)),
	});
}

/** Validates that a provider result belongs to the exact requested account. */
export function validateRemoteTunnelAccountDescriptor(
	descriptor: IRemoteTunnelDescriptor,
	account: IRemoteTunnelAccountIdentity,
): IRemoteTunnelDescriptor {
	const validated = validateRemoteTunnelDescriptor(descriptor);
	if (!isEqualRemoteTunnelAccount(validated.identity, account)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned another Remote Tunnel account', {
			provider: account.provider,
			account: account.account,
		});
	}
	return validated;
}

/** Validates that a provider result is the one exact requested tunnel. */
export function validateRemoteTunnelLookupDescriptor(
	descriptor: IRemoteTunnelDescriptor,
	identity: IRemoteTunnelIdentity,
): IRemoteTunnelDescriptor {
	const validated = validateRemoteTunnelDescriptor(descriptor);
	if (!isEqualRemoteTunnelIdentity(validated.identity, identity)) {
		throw new RemoteTunnelError(RemoteTunnelErrorCode.ProtocolViolation, 'Provider returned another Remote Tunnel', {
			tunnel: identity.tunnel,
			cluster: identity.cluster,
		});
	}
	return validated;
}
