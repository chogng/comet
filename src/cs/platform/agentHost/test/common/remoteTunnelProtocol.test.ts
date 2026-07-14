/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import { decodeRemoteAgentHostTunnelMessage } from 'cs/platform/agentHost/common/remoteTunnelProtocol';

const encoder = new TextEncoder();
const secretMarker = 'REMOTE_TUNNEL_PROTOCOL_SECRET';
const secret = `${secretMarker}_机密_🔑_MUST_NOT_LEAK`;

function assertRedactedProtocolError(
	frame: Readonly<Record<string, unknown>>,
	expectedData: Readonly<{ field: string; value: string | number }>,
): void {
	assert.throws(
		() => decodeRemoteAgentHostTunnelMessage(encoder.encode(JSON.stringify(frame))),
		(error: unknown) => {
			assert.ok(error instanceof AgentHostError);
			assert.equal(error.code, AgentHostErrorCode.InvalidProtocolValue);
			assert.deepStrictEqual(error.data, expectedData);
			assert.equal(JSON.stringify(error).includes(secretMarker), false);
			return true;
		},
	);
}

suite('Remote Tunnel Agent Host protocol diagnostics', () => {
	test('redacts request arguments and response and event payloads', () => {
		assertRedactedProtocolError(
			{
				kind: 'request',
				id: 1,
				target: 'host',
				command: 'initialize',
				argument: { [secret]: secret },
			},
			{ field: 'frame.argument', value: 'type=object' },
		);
		assertRedactedProtocolError(
			{
				kind: 'response',
				id: 1,
				payload: [secret],
			},
			{ field: 'frame.payload', value: 'type=array' },
		);
		assertRedactedProtocolError(
			{
				kind: 'event',
				target: 'host',
				name: 'state',
				payload: { [secret]: secret },
			},
			{ field: 'frame.payload', value: 'type=object' },
		);
	});

	test('redacts unknown keys and invalid event field values', () => {
		assertRedactedProtocolError(
			{
				kind: 'cancel',
				id: 1,
				[secret]: true,
			},
			{
				field: 'frame.key',
				value: `type=string;utf8ByteLength=${encoder.encode(secret).byteLength}`,
			},
		);
		assertRedactedProtocolError(
			{
				kind: 'event',
				target: secret,
				name: 'state',
				payload: 'payload',
			},
			{
				field: 'frame.target',
				value: `type=string;utf8ByteLength=${encoder.encode(secret).byteLength}`,
			},
		);
	});
});
