/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import type { IAgentCredentialResolver } from 'cs/platform/agentHost/common/credentials';
import { createAgentPackageRevision } from 'cs/platform/agentHost/common/identities';
import type { IAgentToolExecutionPort } from 'cs/platform/agentHost/common/tools';
import type { AgentSdkDownloader } from 'cs/platform/agentHost/node/agentSdkDownloader';
import { CLAUDE_AGENT_SDK_PACKAGE, CLAUDE_AGENT_SDK_VERSION } from '../agentSdkProducts.js';
import { ClaudeAgent, productClaudeAgentRetentionLimits, type IClaudeAgentSdk } from './claudeAgent.js';

export interface IClaudeBuiltInAgentOptions {
	readonly downloader: AgentSdkDownloader;
	readonly stateRoot: string;
	readonly toolExecution: IAgentToolExecutionPort;
	readonly credentialResolver: IAgentCredentialResolver;
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Loads the exact product-selected Claude SDK and constructs its direct Agent mapping. */
export async function createClaudeBuiltInAgent(options: IClaudeBuiltInAgentOptions): Promise<ClaudeAgent> {
	if (!isAbsolute(options.stateRoot)) {
		throw new Error('Claude built-in Agent state root must be absolute.');
	}
	const sdkRoot = await options.downloader.loadSdkRoot(CLAUDE_AGENT_SDK_PACKAGE, CancellationTokenNone);
	const executableName = process.platform === 'win32' ? 'claude.exe' : 'claude';
	const executable = join(sdkRoot, executableName);
	const sdkModule = join(sdkRoot, 'sdk.js');
	const [receiptBytes, executableBytes, moduleBytes] = await Promise.all([
		readFile(join(sdkRoot, 'artifact.json')),
		readFile(executable),
		readFile(sdkModule),
	]);
	const receipt = JSON.parse(receiptBytes.toString('utf8')) as {
		readonly name?: unknown;
		readonly version?: unknown;
		readonly executableSha256?: unknown;
		readonly moduleSha256?: unknown;
	};
	if (
		receipt.name !== '@anthropic-ai/claude-agent-sdk'
		|| receipt.version !== CLAUDE_AGENT_SDK_VERSION
		|| receipt.executableSha256 !== sha256(executableBytes)
		|| receipt.moduleSha256 !== sha256(moduleBytes)
	) {
		throw new Error('Claude built-in Agent SDK receipt does not match the product selection.');
	}
	const loadedSdk = await import(pathToFileURL(sdkModule).toString()) as Partial<IClaudeAgentSdk>;
	if (
		typeof loadedSdk.createSdkMcpServer !== 'function'
		|| typeof loadedSdk.deleteSession !== 'function'
		|| typeof loadedSdk.query !== 'function'
		|| typeof loadedSdk.tool !== 'function'
	) {
		throw new Error('Claude built-in Agent SDK module has an invalid export surface.');
	}
	const stateDirectory = join(options.stateRoot, 'claude');
	return ClaudeAgent.create({
		packageRevision: createAgentPackageRevision(`built-in.claude.${CLAUDE_AGENT_SDK_VERSION}`),
		claudeCodeExecutable: executable,
		stateDirectory,
		cacheDirectory: join(stateDirectory, 'sdk-cache'),
		toolExecution: options.toolExecution,
		credentialResolver: options.credentialResolver,
		sdk: Object.freeze({
			createSdkMcpServer: loadedSdk.createSdkMcpServer,
			deleteSession: loadedSdk.deleteSession,
			query: loadedSdk.query,
			tool: loadedSdk.tool,
		}),
		...productClaudeAgentRetentionLimits,
	});
}
