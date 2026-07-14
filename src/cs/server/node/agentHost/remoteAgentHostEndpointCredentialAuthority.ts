/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash, timingSafeEqual } from 'node:crypto';

import type { CancellationToken } from 'cs/base/common/cancellation';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointCredential,
	type IRemoteAgentHostEndpointAuthenticationRequest,
	type IRemoteAgentHostEndpointAuthenticator,
	type RemoteAgentHostEndpointCredential,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import {
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelTransportGeneration,
	isEqualRemoteTunnelEndpoint,
	type IRemoteTunnelConnectionIdentity,
	type IRemoteTunnelEndpointIdentity,
	type RemoteTunnelTransportGeneration,
} from 'cs/platform/tunnel/common/remoteTunnel';

type AuthenticationRecord = Readonly<Record<string, unknown>>;

const endpointIdentityKeys = Object.freeze(['provider', 'account', 'tunnel', 'cluster', 'endpoint']);
const connectionIdentityKeys = Object.freeze([...endpointIdentityKeys, 'connection']);
const authenticationRequestKeys = Object.freeze(['connection', 'generation', 'credential']);

function authenticationError(
	code: typeof RemoteAgentHostEndpointAuthenticationErrorCode[keyof typeof RemoteAgentHostEndpointAuthenticationErrorCode],
): RemoteAgentHostEndpointAuthenticationError {
	return new RemoteAgentHostEndpointAuthenticationError(code);
}

function protocolViolation(): RemoteAgentHostEndpointAuthenticationError {
	return authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
}

function requireClosedRecord(value: unknown, expectedKeys: readonly string[]): AuthenticationRecord {
	try {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			throw protocolViolation();
		}
		const prototype = Object.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			throw protocolViolation();
		}
		const keys = Reflect.ownKeys(value);
		if (keys.length !== expectedKeys.length) {
			throw protocolViolation();
		}
		for (const key of keys) {
			if (typeof key !== 'string' || !expectedKeys.includes(key)) {
				throw protocolViolation();
			}
		}
		const result: Record<string, unknown> = Object.create(null);
		for (const key of expectedKeys) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
				throw protocolViolation();
			}
			result[key] = descriptor.value;
		}
		return result;
	} catch {
		throw protocolViolation();
	}
}

function requireString(record: AuthenticationRecord, key: string): string {
	const value = record[key];
	if (typeof value !== 'string') {
		throw protocolViolation();
	}
	return value;
}

function validateEndpointIdentity(value: unknown): IRemoteTunnelEndpointIdentity {
	const record = requireClosedRecord(value, endpointIdentityKeys);
	try {
		return createRemoteTunnelEndpointIdentity(
			requireString(record, 'provider'),
			requireString(record, 'account'),
			requireString(record, 'tunnel'),
			requireString(record, 'cluster'),
			requireString(record, 'endpoint'),
		);
	} catch {
		throw protocolViolation();
	}
}

function validateConnectionIdentity(value: unknown): IRemoteTunnelConnectionIdentity {
	const record = requireClosedRecord(value, connectionIdentityKeys);
	try {
		const endpoint = createRemoteTunnelEndpointIdentity(
			requireString(record, 'provider'),
			requireString(record, 'account'),
			requireString(record, 'tunnel'),
			requireString(record, 'cluster'),
			requireString(record, 'endpoint'),
		);
		return createRemoteTunnelConnectionIdentity(
			endpoint,
			createRemoteTunnelClientConnectionId(requireString(record, 'connection')),
		);
	} catch {
		throw protocolViolation();
	}
}

function validateGeneration(value: unknown): RemoteTunnelTransportGeneration {
	if (typeof value !== 'number') {
		throw protocolViolation();
	}
	try {
		return createRemoteTunnelTransportGeneration(value);
	} catch {
		throw protocolViolation();
	}
}

function validateCredential(value: unknown): RemoteAgentHostEndpointCredential {
	if (typeof value !== 'string') {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.InvalidCredential);
	}
	try {
		return createRemoteAgentHostEndpointCredential(value);
	} catch {
		throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.InvalidCredential);
	}
}

function validateAuthenticationRequest(value: unknown): IRemoteAgentHostEndpointAuthenticationRequest {
	const record = requireClosedRecord(value, authenticationRequestKeys);
	return Object.freeze({
		connection: validateConnectionIdentity(record.connection),
		generation: validateGeneration(record.generation),
		credential: validateCredential(record.credential),
	});
}

function isCancellationRequested(value: unknown): boolean {
	try {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			throw protocolViolation();
		}
		const cancellation = value as CancellationToken;
		const requested = cancellation.isCancellationRequested;
		if (typeof requested !== 'boolean' || typeof cancellation.onCancellationRequested !== 'function') {
			throw protocolViolation();
		}
		return requested;
	} catch {
		throw protocolViolation();
	}
}

function credentialDigest(credential: RemoteAgentHostEndpointCredential): Uint8Array {
	return createHash('sha256').update(credential, 'utf8').digest();
}

/** Owns the explicit credential authority for one exact Remote Tunnel Agent Host endpoint. */
export class RemoteAgentHostEndpointCredentialAuthority implements IRemoteAgentHostEndpointAuthenticator {
	readonly #endpoint: IRemoteTunnelEndpointIdentity;
	readonly #credentialDigest: Uint8Array;

	constructor(
		endpoint: IRemoteTunnelEndpointIdentity,
		credential: RemoteAgentHostEndpointCredential,
	) {
		if (arguments.length !== 2) {
			throw protocolViolation();
		}
		this.#endpoint = validateEndpointIdentity(endpoint);
		this.#credentialDigest = credentialDigest(validateCredential(credential));
	}

	async authenticate(
		request: IRemoteAgentHostEndpointAuthenticationRequest,
		cancellation: CancellationToken,
	): Promise<typeof RemoteAgentHostEndpointAuthenticationResult[keyof typeof RemoteAgentHostEndpointAuthenticationResult]> {
		if (isCancellationRequested(cancellation)) {
			throw authenticationError(RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted);
		}
		const validated = validateAuthenticationRequest(request);
		if (!isEqualRemoteTunnelEndpoint(this.#endpoint, validated.connection)) {
			return RemoteAgentHostEndpointAuthenticationResult.Rejected;
		}
		const candidateDigest = credentialDigest(validated.credential);
		return timingSafeEqual(this.#credentialDigest, candidateDigest)
			? RemoteAgentHostEndpointAuthenticationResult.Authenticated
			: RemoteAgentHostEndpointAuthenticationResult.Rejected;
	}
}
