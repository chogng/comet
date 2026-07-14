/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	createRemoteServerAgentHostAddress,
	createRemoteTunnelAgentHostAddress,
	isEqualRemoteAgentHostAddress,
	remoteAgentHostAddressKey,
	validateRemoteAgentHostAddress,
	type RemoteAgentHostAddress,
} from 'cs/platform/agentHost/common/remoteAgentHostAddress';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import { remoteServerAgentHostCapability } from 'cs/platform/agentHost/common/remoteProtocol';
import { remoteAgentHostTunnelProtocolRevision } from 'cs/platform/agentHost/common/remoteTunnelProtocol';
import {
	createRemoteAuthority,
	createRemoteCapabilityId,
} from 'cs/platform/remote/common/remoteAuthority';
import {
	AGENT_HOST_TUNNEL_ENDPOINT_KIND,
	createRemoteTunnelEndpointIdentity,
	createRemoteTunnelProtocolRevision,
	REMOTE_SERVER_TUNNEL_ENDPOINT_KIND,
} from 'cs/platform/tunnel/common/remoteTunnel';

type InvalidAddressError = AgentHostError<typeof AgentHostErrorCode.InvalidProtocolValue>;

const rawAuthority = Object.freeze({ kind: 'mock', name: 'server.alpha' });
const rawEndpoint = Object.freeze({
	provider: 'mockRelay',
	account: 'account.alpha',
	tunnel: 'tunnel.alpha',
	cluster: 'cluster.west',
	endpoint: 'agent-host',
});

/** Asserts one stable address validation failure and its rejected field. */
function assertInvalidAddress(run: () => unknown, field: string): void {
	assert.throws(run, (error: unknown) => {
		if (!(error instanceof AgentHostError)) {
			return false;
		}
		assert.equal(error.code, AgentHostErrorCode.InvalidProtocolValue);
		assert.equal((error as InvalidAddressError).data.field, field);
		return true;
	});
}

suite('RemoteAgentHostAddress', () => {
	test('validates and freezes an exact Remote Server route', () => {
		const raw = {
			kind: 'remoteServer',
			authority: rawAuthority,
			capability: 'agentHost',
		};
		const address = validateRemoteAgentHostAddress(raw);

		assert.deepStrictEqual(address, raw);
		assert.notStrictEqual(address, raw);
		assert.ok(Object.isFrozen(address));
		assert.equal(address.kind, 'remoteServer');
		if (address.kind === 'remoteServer') {
			assert.notStrictEqual(address.authority, raw.authority);
			assert.ok(Object.isFrozen(address.authority));
		} else {
			assert.fail('Expected a Remote Server address.');
		}

		const created = createRemoteServerAgentHostAddress(
			createRemoteAuthority('mock', 'server.alpha'),
			remoteServerAgentHostCapability,
		);
		assert.equal(isEqualRemoteAgentHostAddress(address, created), true);
		assert.equal(
			remoteAgentHostAddressKey(address),
			'remoteServer\u0000mock\u0000server.alpha\u0000agentHost',
		);
	});

	test('validates and freezes an exact Remote Tunnel Agent Host route', () => {
		const raw = {
			kind: 'remoteTunnel',
			endpoint: rawEndpoint,
			endpointKind: 'agentHost',
			protocolRevision: remoteAgentHostTunnelProtocolRevision,
		};
		const address = validateRemoteAgentHostAddress(raw);

		assert.deepStrictEqual(address, raw);
		assert.notStrictEqual(address, raw);
		assert.ok(Object.isFrozen(address));
		assert.equal(address.kind, 'remoteTunnel');
		if (address.kind === 'remoteTunnel') {
			assert.notStrictEqual(address.endpoint, raw.endpoint);
			assert.ok(Object.isFrozen(address.endpoint));
		} else {
			assert.fail('Expected a Remote Tunnel address.');
		}

		const created = createRemoteTunnelAgentHostAddress(
			createRemoteTunnelEndpointIdentity(
				'mockRelay',
				'account.alpha',
				'tunnel.alpha',
				'cluster.west',
				'agent-host',
			),
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			createRemoteTunnelProtocolRevision(remoteAgentHostTunnelProtocolRevision),
		);
		assert.equal(isEqualRemoteAgentHostAddress(address, created), true);
		assert.equal(
			remoteAgentHostAddressKey(address),
			`remoteTunnel\u0000mockRelay\u0000account.alpha\u0000tunnel.alpha\u0000cluster.west\u0000agent-host\u0000agentHost\u0000${remoteAgentHostTunnelProtocolRevision}`,
		);
	});

	test('binds equality and keys to every route identity component', () => {
		const server = createRemoteServerAgentHostAddress(
			createRemoteAuthority('mock', 'server.alpha'),
			remoteServerAgentHostCapability,
		);
		const otherServer = createRemoteServerAgentHostAddress(
			createRemoteAuthority('mock', 'server.beta'),
			remoteServerAgentHostCapability,
		);
		assert.equal(isEqualRemoteAgentHostAddress(server, otherServer), false);
		assert.notEqual(remoteAgentHostAddressKey(server), remoteAgentHostAddressKey(otherServer));

		const tunnel = createRemoteTunnelAgentHostAddress(
			createRemoteTunnelEndpointIdentity(
				'mockRelay',
				'account.alpha',
				'tunnel.alpha',
				'cluster.west',
				'agent-host',
			),
			AGENT_HOST_TUNNEL_ENDPOINT_KIND,
			createRemoteTunnelProtocolRevision(remoteAgentHostTunnelProtocolRevision),
		);
		const changedEndpoints = [
			createRemoteTunnelEndpointIdentity(
				'otherRelay', 'account.alpha', 'tunnel.alpha', 'cluster.west', 'agent-host',
			),
			createRemoteTunnelEndpointIdentity(
				'mockRelay', 'account.beta', 'tunnel.alpha', 'cluster.west', 'agent-host',
			),
			createRemoteTunnelEndpointIdentity(
				'mockRelay', 'account.alpha', 'tunnel.beta', 'cluster.west', 'agent-host',
			),
			createRemoteTunnelEndpointIdentity(
				'mockRelay', 'account.alpha', 'tunnel.alpha', 'cluster.east', 'agent-host',
			),
			createRemoteTunnelEndpointIdentity(
				'mockRelay', 'account.alpha', 'tunnel.alpha', 'cluster.west', 'agent-host-beta',
			),
		];
		for (const endpoint of changedEndpoints) {
			const changed = createRemoteTunnelAgentHostAddress(
				endpoint,
				AGENT_HOST_TUNNEL_ENDPOINT_KIND,
				createRemoteTunnelProtocolRevision(remoteAgentHostTunnelProtocolRevision),
			);
			assert.equal(isEqualRemoteAgentHostAddress(tunnel, changed), false);
			assert.notEqual(remoteAgentHostAddressKey(tunnel), remoteAgentHostAddressKey(changed));
		}
		assert.equal(isEqualRemoteAgentHostAddress(server, tunnel), false);
		assert.notEqual(remoteAgentHostAddressKey(server), remoteAgentHostAddressKey(tunnel));
	});

	test('rejects extra, missing, malformed, and unsupported Remote Server values', () => {
		const base = {
			kind: 'remoteServer',
			authority: rawAuthority,
			capability: 'agentHost',
		};
		assertInvalidAddress(() => validateRemoteAgentHostAddress({ ...base, extra: true }), 'address.keys');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			authority: { ...rawAuthority, extra: true },
		}), 'address.authority.keys');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			kind: base.kind,
			authority: base.authority,
		}), 'address.keys');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			authority: { kind: 'Mock', name: rawAuthority.name },
		}), 'address.authority.kind');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			capability: 'terminal',
		}), 'address.capability');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({ ...base, kind: 'remote-server' }), 'address.kind');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({ ...base, kind: 1 }), 'address.kind');

		let accessed = false;
		const accessorKind = Object.defineProperty({
			authority: base.authority,
			capability: base.capability,
		}, 'kind', {
			enumerable: true,
			get: () => {
				accessed = true;
				return base.kind;
			},
		});
		assertInvalidAddress(() => validateRemoteAgentHostAddress(accessorKind), 'address.kind');
		assert.equal(accessed, false);
	});

	test('rejects extra, malformed, non-Agent-Host, and unsupported tunnel values', () => {
		const base = {
			kind: 'remoteTunnel',
			endpoint: rawEndpoint,
			endpointKind: 'agentHost',
			protocolRevision: remoteAgentHostTunnelProtocolRevision,
		};
		assertInvalidAddress(() => validateRemoteAgentHostAddress({ ...base, extra: true }), 'address.keys');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			endpoint: { ...rawEndpoint, extra: true },
		}), 'address.endpoint.keys');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			endpoint: {
				provider: rawEndpoint.provider,
				account: rawEndpoint.account,
				tunnel: rawEndpoint.tunnel,
				cluster: rawEndpoint.cluster,
			},
		}), 'address.endpoint.keys');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			endpoint: { ...rawEndpoint, provider: 'MockRelay' },
		}), 'address.endpoint.provider');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			endpoint: [],
		}), 'address.endpoint');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			endpointKind: REMOTE_SERVER_TUNNEL_ENDPOINT_KIND,
		}), 'address.endpointKind');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({ ...base, endpointKind: '' }), 'address.endpointKind');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({ ...base, protocolRevision: 0 }), 'address.protocolRevision');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({
			...base,
			protocolRevision: remoteAgentHostTunnelProtocolRevision + 1,
		}), 'address.protocolRevision');
		assertInvalidAddress(() => validateRemoteAgentHostAddress({ ...base, protocolRevision: '2' }), 'address.protocolRevision');
	});

	test('revalidates equality and key inputs instead of accepting asserted shapes', () => {
		const server = createRemoteServerAgentHostAddress(
			createRemoteAuthority('mock', 'server.alpha'),
			remoteServerAgentHostCapability,
		);
		const extraAddress = { ...server, extra: true };
		const wrongCapability: RemoteAgentHostAddress = {
			...server,
			capability: createRemoteCapabilityId('terminal'),
		};

		assertInvalidAddress(() => remoteAgentHostAddressKey(extraAddress), 'address.keys');
		assertInvalidAddress(
			() => isEqualRemoteAgentHostAddress(server, wrongCapability),
			'address.capability',
		);
	});
});
