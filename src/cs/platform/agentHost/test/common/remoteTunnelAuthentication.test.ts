/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	RemoteAgentHostEndpointAuthenticationError,
	RemoteAgentHostEndpointAuthenticationErrorCode,
	RemoteAgentHostEndpointAuthenticationResult,
	createRemoteAgentHostEndpointAuthenticationRequest,
	createRemoteAgentHostEndpointCredential,
	decodeRemoteAgentHostEndpointAuthenticationMessage,
	encodeRemoteAgentHostEndpointAuthenticationRequest,
	encodeRemoteAgentHostEndpointAuthenticationResult,
} from 'cs/platform/agentHost/common/remoteTunnelAuthentication';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import {
	createRemoteTunnelConnectionIdentity,
	createRemoteTunnelClientConnectionId,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelTransportGeneration,
} from 'cs/platform/tunnel/common/remoteTunnel';

const encoder = new TextEncoder();
const credentialText = 'endpoint-secret-that-must-not-leak';
const credential = createRemoteAgentHostEndpointCredential(credentialText);
const identity = createRemoteTunnelConnectionIdentity(
	createRemoteTunnelEndpointIdentity(
		'mockRelay',
		'account.alpha',
		'tunnel.alpha',
		'cluster.west',
		'agent-host',
	),
	createRemoteTunnelClientConnectionId('client.alpha'),
);
const generation = createRemoteTunnelTransportGeneration(1);

suite('Remote Tunnel Agent Host endpoint authentication', () => {
	test('uses only revision three and round-trips exact generation-bound frames', () => {
		assert.equal(remoteAgentHostTunnelProtocolRevision, 3);
		assert.deepStrictEqual(
			decodeRemoteAgentHostEndpointAuthenticationMessage(
				encodeRemoteAgentHostEndpointAuthenticationRequest(generation, credential),
			),
			{
				kind: 'authenticate',
				protocolRevision: 3,
				generation,
				credential,
			},
		);
		assert.deepStrictEqual(
			decodeRemoteAgentHostEndpointAuthenticationMessage(
				encodeRemoteAgentHostEndpointAuthenticationResult(
					generation,
					RemoteAgentHostEndpointAuthenticationResult.Authenticated,
				),
			),
			{
				kind: 'authenticationResult',
				protocolRevision: 3,
				generation,
				result: 'authenticated',
			},
		);

		const request = createRemoteAgentHostEndpointAuthenticationRequest(identity, generation, credential);
		assert.deepStrictEqual(request, { connection: identity, generation, credential });
		assert.ok(Object.isFrozen(request));
	});

	test('rejects revision two, extra fields, and malformed credentials without secret diagnostics', () => {
		const invalidFrames = [
			{
				kind: 'authenticate',
				protocolRevision: 2,
				generation: 1,
				credential: credentialText,
			},
			{
				kind: 'authenticate',
				protocolRevision: 3,
				generation: 1,
				credential: credentialText,
				extra: true,
			},
			{
				kind: 'authenticate',
				protocolRevision: 3,
				generation: 1,
				credential: 'contains a space',
			},
		];
		for (const value of invalidFrames) {
			assert.throws(
				() => decodeRemoteAgentHostEndpointAuthenticationMessage(encoder.encode(JSON.stringify(value))),
				(error: unknown) => {
					assert.ok(error instanceof RemoteAgentHostEndpointAuthenticationError);
					assert.equal(error.code, RemoteAgentHostEndpointAuthenticationErrorCode.ProtocolViolation);
					assert.equal(JSON.stringify(error).includes(credentialText), false);
					assert.equal(error.message.includes(credentialText), false);
					return true;
				},
			);
		}

		assert.throws(
			() => createRemoteAgentHostEndpointCredential('contains a space'),
			(error: unknown) => {
				assert.ok(error instanceof RemoteAgentHostEndpointAuthenticationError);
				assert.equal(error.code, RemoteAgentHostEndpointAuthenticationErrorCode.InvalidCredential);
				assert.equal(JSON.stringify(error).includes('contains a space'), false);
				return true;
			},
		);
	});
});
