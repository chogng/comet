/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import {
	createRemoteTunnelTransportGeneration,
	validateRemoteTunnelConnectionIdentity,
	type IRemoteTunnelConnectionIdentity,
	type RemoteTunnelTransportGeneration,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { remoteAgentHostTunnelProtocolRevision } from './remoteTunnelProtocol.js';

declare const remoteAgentHostEndpointCredentialBrand: unique symbol;

/** Opaque credential accepted only by one Agent Host endpoint authenticator. */
export type RemoteAgentHostEndpointCredential = string & {
	readonly [remoteAgentHostEndpointCredentialBrand]: 'RemoteAgentHostEndpointCredential';
};

export const remoteAgentHostEndpointCredentialMaximumBytes = 4 * 1024;
export const remoteAgentHostEndpointAuthenticationMaximumFrameBytes = 16 * 1024;
export const remoteAgentHostEndpointAuthenticationMaximumTimeoutMilliseconds = 5 * 60 * 1000;
export const remoteAgentHostTunnelMaximumGracePeriodMilliseconds = 24 * 60 * 60 * 1000;

export const RemoteAgentHostEndpointAuthenticationResult = {
	Authenticated: 'authenticated',
	Rejected: 'rejected',
} as const;

export type RemoteAgentHostEndpointAuthenticationResult =
	typeof RemoteAgentHostEndpointAuthenticationResult[keyof typeof RemoteAgentHostEndpointAuthenticationResult];

export const RemoteAgentHostEndpointAuthenticationErrorCode = {
	InvalidCredential: 'invalidCredential',
	ProtocolViolation: 'protocolViolation',
	Rejected: 'rejected',
	Interrupted: 'interrupted',
	TimedOut: 'timedOut',
} as const;

export type RemoteAgentHostEndpointAuthenticationErrorCode =
	typeof RemoteAgentHostEndpointAuthenticationErrorCode[keyof typeof RemoteAgentHostEndpointAuthenticationErrorCode];

/** Safe authentication failure containing no credential-derived metadata. */
export class RemoteAgentHostEndpointAuthenticationError extends Error {
	constructor(readonly code: RemoteAgentHostEndpointAuthenticationErrorCode) {
		super(`Remote Agent Host endpoint authentication failed: ${code}`);
		this.name = 'RemoteAgentHostEndpointAuthenticationError';
	}
}

/** One exact endpoint authentication attempt. */
export interface IRemoteAgentHostEndpointAuthenticationRequest {
	readonly connection: IRemoteTunnelConnectionIdentity;
	readonly generation: RemoteTunnelTransportGeneration;
	readonly credential: RemoteAgentHostEndpointCredential;
}

/** Verifies an endpoint credential for one exact lower identity and generation. */
export interface IRemoteAgentHostEndpointAuthenticator {
	authenticate(
		request: IRemoteAgentHostEndpointAuthenticationRequest,
		cancellation: CancellationToken,
	): Promise<RemoteAgentHostEndpointAuthenticationResult>;
}

/** One independently scheduled Agent Host authentication or semantic expiry. */
export type RemoteAgentHostTunnelScheduledDelay =
	| {
		readonly kind: 'endpointAuthenticationTimeout';
		readonly owner: 'client' | 'host';
		readonly generation: RemoteTunnelTransportGeneration;
		readonly delayMilliseconds: number;
	}
	| {
		readonly kind: 'agentHostConnectionGraceExpiry';
		readonly generation: RemoteTunnelTransportGeneration;
		readonly delayMilliseconds: number;
	};

/** Schedules cancellable endpoint authentication timeout and semantic connection expiry. */
export interface IRemoteAgentHostTunnelScheduler {
	wait(delay: RemoteAgentHostTunnelScheduledDelay, cancellation: CancellationToken): Promise<void>;
}

export type RemoteAgentHostEndpointAuthenticationMessage =
	| {
		readonly kind: 'authenticate';
		readonly protocolRevision: typeof remoteAgentHostTunnelProtocolRevision;
		readonly generation: RemoteTunnelTransportGeneration;
		readonly credential: RemoteAgentHostEndpointCredential;
	}
	| {
		readonly kind: 'authenticationResult';
		readonly protocolRevision: typeof remoteAgentHostTunnelProtocolRevision;
		readonly generation: RemoteTunnelTransportGeneration;
		readonly result: RemoteAgentHostEndpointAuthenticationResult;
	};

type AuthenticationRecord = Readonly<Record<string, unknown>>;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const credentialPattern = /^[\x21-\x7e]+$/;

function authenticationError(
	code: RemoteAgentHostEndpointAuthenticationErrorCode,
): RemoteAgentHostEndpointAuthenticationError {
	return new RemoteAgentHostEndpointAuthenticationError(code);
}

function requireRecord(value: unknown): AuthenticationRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	return value as AuthenticationRecord;
}

function requireOwnDataProperty(record: AuthenticationRecord, key: string): unknown {
	const descriptor = Object.getOwnPropertyDescriptor(record, key);
	if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	return descriptor.value;
}

function requireExactKeys(record: AuthenticationRecord, expected: readonly string[]): void {
	const keys = Reflect.ownKeys(record);
	if (keys.length !== expected.length) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	for (const key of keys) {
		if (typeof key !== 'string' || !expected.includes(key)) {
			throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
		}
	}
	for (const key of expected) {
		requireOwnDataProperty(record, key);
	}
}

function validateGeneration(value: unknown): RemoteTunnelTransportGeneration {
	if (typeof value !== 'number') {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	try {
		return createRemoteTunnelTransportGeneration(value);
	} catch {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
}

function validateProtocolRevision(value: unknown): void {
	if (value !== remoteAgentHostTunnelProtocolRevision) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
}

function validateWireCredential(value: string): RemoteAgentHostEndpointCredential {
	try {
		return createRemoteAgentHostEndpointCredential(value);
	} catch {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
}

/** Validates one closed authenticator result. */
export function validateRemoteAgentHostEndpointAuthenticationResult(
	value: unknown,
): RemoteAgentHostEndpointAuthenticationResult {
	if (value !== RemoteAgentHostEndpointAuthenticationResult.Authenticated
		&& value !== RemoteAgentHostEndpointAuthenticationResult.Rejected) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	return value;
}

function encodeAuthenticationMessage(message: RemoteAgentHostEndpointAuthenticationMessage): Uint8Array {
	const frame = encoder.encode(JSON.stringify(message));
	if (frame.byteLength > remoteAgentHostEndpointAuthenticationMaximumFrameBytes) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	return frame;
}

/** Creates one bounded opaque endpoint credential without exposing rejected input. */
export function createRemoteAgentHostEndpointCredential(value: string): RemoteAgentHostEndpointCredential {
	if (
		typeof value !== 'string'
		|| !credentialPattern.test(value)
		|| encoder.encode(value).byteLength > remoteAgentHostEndpointCredentialMaximumBytes
	) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.InvalidCredential);
	}
	return value as RemoteAgentHostEndpointCredential;
}

/** Validates one explicit bounded endpoint authentication timeout. */
export function validateRemoteAgentHostEndpointAuthenticationTimeout(value: number): number {
	if (
		!Number.isSafeInteger(value)
		|| value < 1
		|| value > remoteAgentHostEndpointAuthenticationMaximumTimeoutMilliseconds
	) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	return value;
}

/** Validates one explicit bounded semantic reconnect grace period. */
export function validateRemoteAgentHostTunnelGracePeriod(value: number): number {
	if (
		!Number.isSafeInteger(value)
		|| value < 1
		|| value > remoteAgentHostTunnelMaximumGracePeriodMilliseconds
	) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	return value;
}

/** Creates an immutable exact authenticator request. */
export function createRemoteAgentHostEndpointAuthenticationRequest(
	connection: IRemoteTunnelConnectionIdentity,
	generation: RemoteTunnelTransportGeneration,
	credential: RemoteAgentHostEndpointCredential,
): IRemoteAgentHostEndpointAuthenticationRequest {
	try {
		return Object.freeze({
			connection: validateRemoteTunnelConnectionIdentity(connection),
			generation: createRemoteTunnelTransportGeneration(generation),
			credential: createRemoteAgentHostEndpointCredential(credential),
		});
	} catch (error) {
		if (error instanceof RemoteAgentHostEndpointAuthenticationError) {
			throw error;
		}
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
}

/** Encodes one generation-bound endpoint authentication request. */
export function encodeRemoteAgentHostEndpointAuthenticationRequest(
	generation: RemoteTunnelTransportGeneration,
	credential: RemoteAgentHostEndpointCredential,
): Uint8Array {
	return encodeAuthenticationMessage(Object.freeze({
		kind: 'authenticate',
		protocolRevision: remoteAgentHostTunnelProtocolRevision,
		generation: createRemoteTunnelTransportGeneration(generation),
		credential: createRemoteAgentHostEndpointCredential(credential),
	}));
}

/** Encodes one generation-bound endpoint authentication result. */
export function encodeRemoteAgentHostEndpointAuthenticationResult(
	generation: RemoteTunnelTransportGeneration,
	result: RemoteAgentHostEndpointAuthenticationResult,
): Uint8Array {
	return encodeAuthenticationMessage(Object.freeze({
		kind: 'authenticationResult',
		protocolRevision: remoteAgentHostTunnelProtocolRevision,
		generation: createRemoteTunnelTransportGeneration(generation),
		result: validateRemoteAgentHostEndpointAuthenticationResult(result),
	}));
}

/** Decodes one strict bounded endpoint authentication frame. */
export function decodeRemoteAgentHostEndpointAuthenticationMessage(
	frame: Uint8Array,
): RemoteAgentHostEndpointAuthenticationMessage {
	if (!(frame instanceof Uint8Array)
		|| frame.byteLength === 0
		|| frame.byteLength > remoteAgentHostEndpointAuthenticationMaximumFrameBytes) {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	let value: unknown;
	try {
		value = JSON.parse(decoder.decode(frame));
	} catch {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
	}
	const record = requireRecord(value);
	const kind = requireOwnDataProperty(record, 'kind');
	if (kind === 'authenticate') {
		requireExactKeys(record, ['kind', 'protocolRevision', 'generation', 'credential']);
		validateProtocolRevision(requireOwnDataProperty(record, 'protocolRevision'));
		const credential = requireOwnDataProperty(record, 'credential');
		if (typeof credential !== 'string') {
			throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
		}
		return Object.freeze({
			kind,
			protocolRevision: remoteAgentHostTunnelProtocolRevision,
			generation: validateGeneration(requireOwnDataProperty(record, 'generation')),
			credential: validateWireCredential(credential),
		});
	}
	if (kind === 'authenticationResult') {
		requireExactKeys(record, ['kind', 'protocolRevision', 'generation', 'result']);
		validateProtocolRevision(requireOwnDataProperty(record, 'protocolRevision'));
		return Object.freeze({
			kind,
			protocolRevision: remoteAgentHostTunnelProtocolRevision,
			generation: validateGeneration(requireOwnDataProperty(record, 'generation')),
			result: validateRemoteAgentHostEndpointAuthenticationResult(requireOwnDataProperty(record, 'result')),
		});
	}
	throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
}
