/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	createRemoteAuthorityKind,
	createRemoteAuthorityName,
	createRemoteCapabilityId,
	isEqualRemoteAuthority,
	type IRemoteAuthority,
	type RemoteCapabilityId,
} from 'cs/platform/remote/common/remoteAuthority';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	createRemoteTunnelAccountId,
	createRemoteTunnelClusterId,
	createRemoteTunnelEndpointId,
	createRemoteTunnelEndpointKind,
	createRemoteTunnelId,
	createRemoteTunnelProtocolRevision,
	createRemoteTunnelProviderId,
	isEqualRemoteTunnelEndpoint,
	remoteTunnelEndpointIdentityKey,
	type IRemoteTunnelEndpointIdentity,
	type RemoteTunnelEndpointKind,
	type RemoteTunnelProtocolRevision,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import { remoteServerAgentHostCapability } from './remoteProtocol.js';
import { remoteAgentHostTunnelProtocolRevision } from './remoteTunnelProtocol.js';

/** One exact Remote Server route that advertises the Agent Host channel. */
export interface IRemoteServerAgentHostAddress {
	readonly kind: 'remoteServer';
	readonly authority: IRemoteAuthority;
	readonly capability: RemoteCapabilityId;
}

/** One exact Remote Tunnel Agent Host endpoint and protocol revision. */
export interface IRemoteTunnelAgentHostAddress {
	readonly kind: 'remoteTunnel';
	readonly endpoint: IRemoteTunnelEndpointIdentity;
	readonly endpointKind: RemoteTunnelEndpointKind;
	readonly protocolRevision: RemoteTunnelProtocolRevision;
}

/** Closed product address selecting one remote Agent Host route. */
export type RemoteAgentHostAddress = IRemoteServerAgentHostAddress | IRemoteTunnelAgentHostAddress;

type AddressRecord = Readonly<Record<string, unknown>>;

function diagnostic(value: unknown): string | number {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : String(value);
	}
	if (typeof value === 'string') {
		return value.slice(0, 256);
	}
	return value === null ? 'null' : typeof value;
}

function invalidAddress(field: string, value: unknown): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid Remote Agent Host address',
		{ field, value: diagnostic(value) },
	);
}

function requireRecord(value: unknown, field: string): AddressRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidAddress(field, value);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return invalidAddress(`${field}.prototype`, prototype);
	}
	return value as AddressRecord;
}

function requireOwnDataProperty(record: AddressRecord, key: string, field: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		return invalidAddress(field, descriptor ? 'accessor' : 'missing');
	}
	return descriptor.value;
}

function requireExactKeys(record: AddressRecord, expected: readonly string[], field: string): void {
	const keys = Reflect.ownKeys(record);
	if (keys.length !== expected.length) {
		invalidAddress(`${field}.keys`, keys.length);
	}
	for (const key of keys) {
		if (typeof key !== 'string' || !expected.includes(key)) {
			invalidAddress(`${field}.keys`, key);
		}
	}
	for (const key of expected) {
		requireOwnDataProperty(record, key, `${field}.${key}`);
	}
}

function requireString(value: unknown, field: string): string {
	if (typeof value !== 'string') {
		return invalidAddress(field, value);
	}
	return value;
}

function createValidatedIdentity<T>(
	value: unknown,
	field: string,
	create: (value: string) => T,
): T {
	const text = requireString(value, field);
	try {
		return create(text);
	} catch {
		return invalidAddress(field, text);
	}
}

function validateAuthority(value: unknown): IRemoteAuthority {
	const authority = requireRecord(value, 'address.authority');
	requireExactKeys(authority, ['kind', 'name'], 'address.authority');
	return Object.freeze({
		kind: createValidatedIdentity(
			requireOwnDataProperty(authority, 'kind', 'address.authority.kind'),
			'address.authority.kind',
			createRemoteAuthorityKind,
		),
		name: createValidatedIdentity(
			requireOwnDataProperty(authority, 'name', 'address.authority.name'),
			'address.authority.name',
			createRemoteAuthorityName,
		),
	});
}

function validateEndpoint(value: unknown): IRemoteTunnelEndpointIdentity {
	const endpoint = requireRecord(value, 'address.endpoint');
	requireExactKeys(
		endpoint,
		['provider', 'account', 'tunnel', 'cluster', 'endpoint'],
		'address.endpoint',
	);
	return Object.freeze({
		provider: createValidatedIdentity(
			requireOwnDataProperty(endpoint, 'provider', 'address.endpoint.provider'),
			'address.endpoint.provider',
			createRemoteTunnelProviderId,
		),
		account: createValidatedIdentity(
			requireOwnDataProperty(endpoint, 'account', 'address.endpoint.account'),
			'address.endpoint.account',
			createRemoteTunnelAccountId,
		),
		tunnel: createValidatedIdentity(
			requireOwnDataProperty(endpoint, 'tunnel', 'address.endpoint.tunnel'),
			'address.endpoint.tunnel',
			createRemoteTunnelId,
		),
		cluster: createValidatedIdentity(
			requireOwnDataProperty(endpoint, 'cluster', 'address.endpoint.cluster'),
			'address.endpoint.cluster',
			createRemoteTunnelClusterId,
		),
		endpoint: createValidatedIdentity(
			requireOwnDataProperty(endpoint, 'endpoint', 'address.endpoint.endpoint'),
			'address.endpoint.endpoint',
			createRemoteTunnelEndpointId,
		),
	});
}

function validateRemoteServerAddress(address: AddressRecord): IRemoteServerAgentHostAddress {
	requireExactKeys(address, ['kind', 'authority', 'capability'], 'address');
	const capability = createValidatedIdentity(
		requireOwnDataProperty(address, 'capability', 'address.capability'),
		'address.capability',
		createRemoteCapabilityId,
	);
	if (capability !== remoteServerAgentHostCapability) {
		invalidAddress('address.capability', capability);
	}
	return Object.freeze({
		kind: 'remoteServer',
		authority: validateAuthority(requireOwnDataProperty(address, 'authority', 'address.authority')),
		capability,
	});
}

function validateRemoteTunnelAddress(address: AddressRecord): IRemoteTunnelAgentHostAddress {
	requireExactKeys(address, ['kind', 'endpoint', 'endpointKind', 'protocolRevision'], 'address');
	const endpointKind = createValidatedIdentity(
		requireOwnDataProperty(address, 'endpointKind', 'address.endpointKind'),
		'address.endpointKind',
		createRemoteTunnelEndpointKind,
	);
	if (endpointKind !== AGENT_HOST_TUNNEL_ENDPOINT_KIND) {
		invalidAddress('address.endpointKind', endpointKind);
	}
	const protocolValue = requireOwnDataProperty(address, 'protocolRevision', 'address.protocolRevision');
	if (typeof protocolValue !== 'number') {
		return invalidAddress('address.protocolRevision', protocolValue);
	}
	let protocolRevision: RemoteTunnelProtocolRevision;
	try {
		protocolRevision = createRemoteTunnelProtocolRevision(protocolValue);
	} catch {
		return invalidAddress('address.protocolRevision', protocolValue);
	}
	if (protocolRevision !== remoteAgentHostTunnelProtocolRevision) {
		invalidAddress('address.protocolRevision', protocolRevision);
	}
	return Object.freeze({
		kind: 'remoteTunnel',
		endpoint: validateEndpoint(requireOwnDataProperty(address, 'endpoint', 'address.endpoint')),
		endpointKind,
		protocolRevision,
	});
}

/** Creates one immutable Remote Server Agent Host address from explicit route values. */
export function createRemoteServerAgentHostAddress(
	authority: IRemoteAuthority,
	capability: RemoteCapabilityId,
): IRemoteServerAgentHostAddress {
	return validateRemoteServerAddress({ kind: 'remoteServer', authority, capability });
}

/** Creates one immutable Remote Tunnel Agent Host address from explicit route values. */
export function createRemoteTunnelAgentHostAddress(
	endpoint: IRemoteTunnelEndpointIdentity,
	endpointKind: RemoteTunnelEndpointKind,
	protocolRevision: RemoteTunnelProtocolRevision,
): IRemoteTunnelAgentHostAddress {
	return validateRemoteTunnelAddress({
		kind: 'remoteTunnel',
		endpoint,
		endpointKind,
		protocolRevision,
	});
}

/** Revalidates and freezes one closed Remote Agent Host address. */
export function validateRemoteAgentHostAddress(address: unknown): RemoteAgentHostAddress {
	const record = requireRecord(address, 'address');
	const kind = requireString(requireOwnDataProperty(record, 'kind', 'address.kind'), 'address.kind');
	if (kind === 'remoteServer') {
		return validateRemoteServerAddress(record);
	}
	if (kind === 'remoteTunnel') {
		return validateRemoteTunnelAddress(record);
	}
	return invalidAddress('address.kind', kind);
}

/** Returns whether two validated Remote Agent Host addresses select the same exact route. */
export function isEqualRemoteAgentHostAddress(
	first: RemoteAgentHostAddress,
	second: RemoteAgentHostAddress,
): boolean {
	const left = validateRemoteAgentHostAddress(first);
	const right = validateRemoteAgentHostAddress(second);
	if (left.kind === 'remoteServer') {
		return right.kind === 'remoteServer'
			&& left.capability === right.capability
			&& isEqualRemoteAuthority(left.authority, right.authority);
	}
	return right.kind === 'remoteTunnel'
		&& left.endpointKind === right.endpointKind
		&& left.protocolRevision === right.protocolRevision
		&& isEqualRemoteTunnelEndpoint(left.endpoint, right.endpoint);
}

/** Produces one collision-free key for a validated Remote Agent Host address. */
export function remoteAgentHostAddressKey(address: RemoteAgentHostAddress): string {
	const validated = validateRemoteAgentHostAddress(address);
	if (validated.kind === 'remoteServer') {
		return `${validated.kind}\u0000${validated.authority.kind}\u0000${validated.authority.name}\u0000${validated.capability}`;
	}
	return `${validated.kind}\u0000${remoteTunnelEndpointIdentityKey(validated.endpoint)}\u0000${validated.endpointKind}\u0000${validated.protocolRevision}`;
}
