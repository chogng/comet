/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { chmod, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import type { MessageEvent } from 'electron';

import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';
import {
	CLAUDE_AGENT_PACKAGE_ID,
	CLAUDE_AGENT_RUNTIME_ENTRY_POINT,
	claudeAgentSdkExecutableTarget,
} from 'cs/code/common/agentHost/claudeAgentPackage';
import {
	localAgentRuntimeArtifactEnvironment,
	localAgentRuntimeConnectMessage,
	localAgentRuntimeReadyMessage,
	localAgentRuntimeStateEnvironment,
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
type ConnectMessage = Readonly<Record<'type' | 'packageId' | 'packageRevision' | 'connection' | 'generation', unknown>>;

function asConnectMessage(value: unknown): ConnectMessage {
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
		|| Object.keys(value).length !== 5
		|| !['type', 'packageId', 'packageRevision', 'connection', 'generation'].every(key => Object.hasOwn(value, key))
	) {
		throw new Error('Claude Agent Runtime received an invalid connection message.');
	}
	return value as ConnectMessage;
}

function runtimeArtifacts(): Readonly<Record<string, string>> {
	const serialized = process.env[localAgentRuntimeArtifactEnvironment];
	let value: unknown;
	try { value = serialized === undefined ? undefined : JSON.parse(serialized); } catch { value = undefined; }
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Claude Agent Runtime artifact authority is invalid.');
	}
	const artifacts: Record<string, string> = {};
	for (const [target, artifactPath] of Object.entries(value)) {
		if (typeof artifactPath !== 'string' || !isAbsolute(artifactPath)) {
			throw new Error('Claude Agent Runtime artifact path is invalid.');
		}
		artifacts[target] = artifactPath;
	}
	return Object.freeze(artifacts);
}

const artifacts = runtimeArtifacts();
const executableTarget = claudeAgentSdkExecutableTarget(Object.freeze({
	operatingSystem: process.platform,
	architecture: process.arch,
}));
if (
	Object.keys(artifacts).length !== 2
	|| artifacts[CLAUDE_AGENT_RUNTIME_ENTRY_POINT] === undefined
	|| artifacts[executableTarget] === undefined
) {
	throw new Error('Claude Agent Runtime artifact authority does not match its exact package closure.');
}
const claudeCodeExecutable = artifacts[executableTarget];
const stateDirectory = process.env[localAgentRuntimeStateEnvironment];
if (claudeCodeExecutable === undefined || stateDirectory === undefined || !isAbsolute(stateDirectory)) {
	throw new Error('Claude Agent Runtime launch authority is incomplete.');
}
const cacheDirectory = join(stateDirectory, 'sdk-cache');
let cacheMetadata;
try {
	cacheMetadata = await lstat(cacheDirectory);
} catch (error) {
	if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
		throw error;
	}
}
if (cacheMetadata !== undefined) {
	if (!cacheMetadata.isDirectory() || cacheMetadata.isSymbolicLink()) {
		throw new Error('Claude Agent Runtime cache must be a real directory.');
	}
	const canonicalCacheDirectory = await realpath(cacheDirectory);
	if (canonicalCacheDirectory !== cacheDirectory) {
		throw new Error('Claude Agent Runtime cache has the wrong canonical address.');
	}
	await rm(canonicalCacheDirectory, { recursive: true });
}
await mkdir(cacheDirectory, { recursive: true, mode: 0o700 });
await chmod(cacheDirectory, 0o700);
process.env.CLAUDE_CONFIG_DIR = cacheDirectory;
process.env.HOME = cacheDirectory;
if (process.platform === 'win32') {
	process.env.USERPROFILE = cacheDirectory;
}
const {
	ClaudeAgentRuntime,
	productClaudeAgentRuntimeRetentionLimits,
} = await import('./claudeAgentRuntime.js');

const lifetime = new DisposableStore();
let connected = false;

const onMessage = (event: MessageEvent): void => {
	const message = asConnectMessage(event.data);
	if (message.type !== localAgentRuntimeConnectMessage || connected) {
		throw new Error('Claude Agent Runtime accepts exactly one connection message.');
	}
	const port = event.ports[0];
	if (event.ports.length !== 1 || port === undefined) {
		throw new Error('Claude Agent Runtime connection requires one MessagePort.');
	}
	if (
		typeof message.packageId !== 'string'
		|| typeof message.packageRevision !== 'string'
		|| typeof message.connection !== 'string'
		|| typeof message.generation !== 'number'
		|| createAgentPackageId(message.packageId) !== CLAUDE_AGENT_PACKAGE_ID
	) {
		throw new Error('Claude Agent Runtime connection identities are invalid.');
	}
	connected = true;
	const runtime = lifetime.add(new ClaudeAgentRuntime({
		packageRevision: createAgentPackageRevision(message.packageRevision),
		connection: createAgentRuntimeConnectionId(message.connection),
		generation: createAgentRuntimeConnectionGeneration(message.generation),
		claudeCodeExecutable,
		stateDirectory,
		cacheDirectory,
		...productClaudeAgentRuntimeRetentionLimits,
	}));
	const ipc = lifetime.add(new MessagePortChannel(port, 'claude-agent-runtime'));
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
