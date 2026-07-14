/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	CancellationTokenCancelled,
	CancellationTokenNone,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointAuthenticationRequest,
	createRemoteAgentHostEndpointCredential,
	type IRemoteAgentHostEndpointAuthenticationRequest,
	type RemoteAgentHostEndpointCredential,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import {
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelTransportGeneration,
	type IRemoteTunnelEndpointIdentity,
} from 'cs/platform/tunnel/common/remoteTunnel';
import { RemoteAgentHostEndpointCredentialAuthority } from 'cs/server/node/agentHost/remoteAgentHostEndpointCredentialAuthority';

const endpoint = createRemoteTunnelEndpointIdentity(
	'mock-provider',
	'account',
	'tunnel',
	'cluster',
	'agent-host',
);
const otherEndpoint = createRemoteTunnelEndpointIdentity(
	'mock-provider',
	'account',
	'tunnel',
	'cluster',
	'other-agent-host',
);
const generation = createRemoteTunnelTransportGeneration(1);
const credentialText = 'endpoint-secret-credential-A';
const credential = createRemoteAgentHostEndpointCredential(credentialText);
const otherCredential = createRemoteAgentHostEndpointCredential('endpoint-secret-credential-B');

function authenticationRequest(
	candidate: RemoteAgentHostEndpointCredential = credential,
	requestEndpoint: IRemoteTunnelEndpointIdentity = endpoint,
): IRemoteAgentHostEndpointAuthenticationRequest {
	return createRemoteAgentHostEndpointAuthenticationRequest(
		createRemoteTunnelConnectionIdentity(
			requestEndpoint,
			createRemoteTunnelClientConnectionId('client-connection'),
		),
		generation,
		candidate,
	);
}

function assertSafeAuthenticationError(
	error: unknown,
	code: RemoteAgentHostEndpointAuthenticationErrorCode,
	forbiddenValues: readonly string[] = [],
): boolean {
	assert.ok(error instanceof RemoteAgentHostEndpointAuthenticationError);
	assert.equal(error.code, code);
	const descriptors = Object.getOwnPropertyDescriptors(error);
	const diagnostic = [
		String(error),
		error.stack ?? '',
		JSON.stringify(error),
		...Reflect.ownKeys(descriptors).map(key => {
			const descriptor = descriptors[key as keyof typeof descriptors];
			return descriptor && Object.hasOwn(descriptor, 'value') ? String(descriptor.value) : String(key);
		}),
	].join('\n');
	for (const value of forbiddenValues) {
		assert.equal(diagnostic.includes(value), false);
	}
	return true;
}

suite('RemoteAgentHostEndpointCredentialAuthority', () => {
	test('authenticates only the bound endpoint and credential', async () => {
		const authority = new RemoteAgentHostEndpointCredentialAuthority(endpoint, credential);

		assert.equal(
			await authority.authenticate(authenticationRequest(), CancellationTokenNone),
			RemoteAgentHostEndpointAuthenticationResult.Authenticated,
		);
		assert.equal(
			await authority.authenticate(authenticationRequest(otherCredential), CancellationTokenNone),
			RemoteAgentHostEndpointAuthenticationResult.Rejected,
		);
		assert.equal(
			await authority.authenticate(authenticationRequest(credential, otherEndpoint), CancellationTokenNone),
			RemoteAgentHostEndpointAuthenticationResult.Rejected,
		);
	});

	test('does not expose the credential or its digest through object snapshots or keys', () => {
		const authority = new RemoteAgentHostEndpointCredentialAuthority(endpoint, credential);

		assert.deepEqual(Reflect.ownKeys(authority), []);
		assert.equal(JSON.stringify(authority), '{}');
		assert.equal(String(authority).includes(credentialText), false);
	});

	test('reports cancellation as a secret-free interrupted authentication', async () => {
		let credentialRead = false;
		const request = { ...authenticationRequest() };
		Object.defineProperty(request, 'credential', {
			enumerable: true,
			get: () => {
				credentialRead = true;
				throw new Error(credentialText);
			},
		});
		const authority = new RemoteAgentHostEndpointCredentialAuthority(endpoint, credential);

		await assert.rejects(
			authority.authenticate(
				request as unknown as IRemoteAgentHostEndpointAuthenticationRequest,
				CancellationTokenCancelled,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.Interrupted,
				[credentialText],
			),
		);
		assert.equal(credentialRead, false);
	});

	test('rejects malformed cancellation tokens before credential comparison', async () => {
		const authority = new RemoteAgentHostEndpointCredentialAuthority(endpoint, credential);
		const malformedCancellation = Object.freeze({
			isCancellationRequested: false,
		}) as unknown as CancellationToken;

		await assert.rejects(
			authority.authenticate(authenticationRequest(), malformedCancellation),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
	});

	test('requires closed constructor arguments without reading accessors', () => {
		let endpointRead = false;
		const accessorEndpoint = { ...endpoint };
		Object.defineProperty(accessorEndpoint, 'endpoint', {
			enumerable: true,
			get: () => {
				endpointRead = true;
				throw new Error(credentialText);
			},
		});
		assert.throws(
			() => new RemoteAgentHostEndpointCredentialAuthority(
				accessorEndpoint as unknown as IRemoteTunnelEndpointIdentity,
				credential,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		assert.equal(endpointRead, false);

		const inheritedEndpoint = Object.assign(Object.create({ inherited: true }), endpoint);
		assert.throws(
			() => new RemoteAgentHostEndpointCredentialAuthority(inheritedEndpoint, credential),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		assert.throws(
			() => new RemoteAgentHostEndpointCredentialAuthority(
				{ ...endpoint, extra: true } as IRemoteTunnelEndpointIdentity,
				credential,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		assert.throws(
			() => Reflect.construct(RemoteAgentHostEndpointCredentialAuthority, [endpoint]),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		assert.throws(
			() => Reflect.construct(RemoteAgentHostEndpointCredentialAuthority, [endpoint, credential, 'extra']),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
	});

	test('rejects invalid constructor credentials without disclosing their value', () => {
		const invalidCredential = 'endpoint secret credential that must stay private';

		assert.throws(
			() => new RemoteAgentHostEndpointCredentialAuthority(
				endpoint,
				invalidCredential as RemoteAgentHostEndpointCredential,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.InvalidCredential,
				[invalidCredential],
			),
		);
	});

	test('requires a closed request and connection identity before authentication', async () => {
		const authority = new RemoteAgentHostEndpointCredentialAuthority(endpoint, credential);
		const valid = authenticationRequest();
		let credentialRead = false;
		const accessorRequest = { ...valid };
		Object.defineProperty(accessorRequest, 'credential', {
			enumerable: true,
			get: () => {
				credentialRead = true;
				throw new Error(credentialText);
			},
		});
		await assert.rejects(
			authority.authenticate(
				accessorRequest as unknown as IRemoteAgentHostEndpointAuthenticationRequest,
				CancellationTokenNone,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		assert.equal(credentialRead, false);

		const inheritedRequest = Object.assign(Object.create({ inherited: true }), valid);
		await assert.rejects(
			authority.authenticate(inheritedRequest, CancellationTokenNone),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		await assert.rejects(
			authority.authenticate(
				{ ...valid, extra: true } as IRemoteAgentHostEndpointAuthenticationRequest,
				CancellationTokenNone,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		await assert.rejects(
			authority.authenticate(
				{ ...valid, generation: 0 } as IRemoteAgentHostEndpointAuthenticationRequest,
				CancellationTokenNone,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);

		let endpointRead = false;
		const accessorConnection = { ...valid.connection };
		Object.defineProperty(accessorConnection, 'endpoint', {
			enumerable: true,
			get: () => {
				endpointRead = true;
				throw new Error(credentialText);
			},
		});
		await assert.rejects(
			authority.authenticate(
				{ ...valid, connection: accessorConnection } as IRemoteAgentHostEndpointAuthenticationRequest,
				CancellationTokenNone,
			),
			error => assertSafeAuthenticationError(
				error,
				RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation,
				[credentialText],
			),
		);
		assert.equal(endpointRead, false);
	});
});
