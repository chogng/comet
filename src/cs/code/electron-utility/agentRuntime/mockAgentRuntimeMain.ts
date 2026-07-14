/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { MessageEvent } from 'electron';

import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';
import {
	localAgentRuntimeConnectMessage,
	localAgentRuntimeReadyMessage,
} from 'cs/code/common/agentHost/localAgentRuntimeProtocol';
import {
	agentRuntimeConnectionChannelName,
	AgentRuntimeConnectionChannel,
} from 'cs/platform/agentHost/common/agentRuntimeConnectionChannel';
import {
	createAgentPackageId,
	createAgentPackageRevision,
	createAgentRuntimeConnectionGeneration,
	createAgentRuntimeConnectionId,
} from 'cs/platform/agentHost/common/identities';
import {
	MockAgentRuntime,
	productMockAgentRuntimeRetentionLimits,
} from './mockAgentRuntime.js';

type ConnectMessage = Readonly<Record<'type' | 'packageId' | 'packageRevision' | 'connection' | 'generation', unknown>>;

function asConnectMessage(value: unknown): ConnectMessage {
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
		|| Object.keys(value).length !== 5
		|| !['type', 'packageId', 'packageRevision', 'connection', 'generation'].every(key => Object.hasOwn(value, key))
	) {
		throw new Error('Mock Agent Runtime received an invalid connection message.');
	}
	return value as ConnectMessage;
}

const lifetime = new DisposableStore();
let connected = false;

const onMessage = (event: MessageEvent): void => {
	const message = asConnectMessage(event.data);
	if (message.type !== localAgentRuntimeConnectMessage || connected) {
		throw new Error('Mock Agent Runtime accepts exactly one connection message.');
	}
	const port = event.ports[0];
	if (event.ports.length !== 1 || port === undefined) {
		throw new Error('Mock Agent Runtime connection requires one MessagePort.');
	}
	if (
		typeof message.packageId !== 'string'
		|| typeof message.packageRevision !== 'string'
		|| typeof message.connection !== 'string'
		|| typeof message.generation !== 'number'
	) {
		throw new Error('Mock Agent Runtime connection identities are invalid.');
	}
	connected = true;
	const runtime = lifetime.add(new MockAgentRuntime({
		packageId: createAgentPackageId(message.packageId),
		packageRevision: createAgentPackageRevision(message.packageRevision),
		connection: createAgentRuntimeConnectionId(message.connection),
		generation: createAgentRuntimeConnectionGeneration(message.generation),
		...productMockAgentRuntimeRetentionLimits,
	}));
	const ipc = lifetime.add(new MessagePortChannel(port, 'mock-agent-runtime'));
	ipc.registerChannel(agentRuntimeConnectionChannelName, new AgentRuntimeConnectionChannel(runtime));
	const onClose = (): void => {
		lifetime.dispose();
		process.exit(0);
	};
	port.once('close', onClose);
	lifetime.add(toDisposable(() => port.off('close', onClose)));
};

process.parentPort.on('message', onMessage);
lifetime.add(toDisposable(() => process.parentPort.off('message', onMessage)));
process.parentPort.postMessage({ type: localAgentRuntimeReadyMessage });
