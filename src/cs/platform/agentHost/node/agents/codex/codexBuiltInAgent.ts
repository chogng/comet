/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import type { IAgentCredentialResolver } from 'cs/platform/agentHost/common/credentials';
import { createAgentPackageRevision } from 'cs/platform/agentHost/common/identities';
import type { IAgentToolExecutionPort } from 'cs/platform/agentHost/common/tools';
import type { AgentSdkDownloader } from 'cs/platform/agentHost/node/agentSdkDownloader';
import { CODEX_AGENT_SDK_PACKAGE, CODEX_AGENT_SDK_VERSION } from '../agentSdkProducts.js';
import { CodexAgent } from './codexAgent.js';
import { CodexAppServerProcessFactory } from './codexAppServer.js';
import {
	CODEX_GENERATED_PROTOCOL_FILE_COUNT,
	CODEX_GENERATED_PROTOCOL_SOURCE_DIGEST,
} from './protocol/protocolMetadata.js';

export interface ICodexBuiltInAgentOptions {
	readonly downloader: AgentSdkDownloader;
	readonly stateRoot: string;
	readonly toolExecution: IAgentToolExecutionPort;
	readonly credentialResolver: IAgentCredentialResolver;
}

function sha256(value: Uint8Array): string {
	return createHash('sha256').update(value).digest('hex');
}

/** Loads the exact product-selected Codex SDK and constructs its direct Agent mapping. */
export async function createCodexBuiltInAgent(options: ICodexBuiltInAgentOptions): Promise<CodexAgent> {
	if (!isAbsolute(options.stateRoot)) {
		throw new Error('Codex built-in Agent state root must be absolute.');
	}
	const sdkRoot = await options.downloader.loadSdkRoot(CODEX_AGENT_SDK_PACKAGE, CancellationTokenNone);
	const executable = join(sdkRoot, process.platform === 'win32' ? 'codex.exe' : 'codex');
	const protocolPath = join(sdkRoot, 'protocol.json');
	const [receiptBytes, executableBytes, protocolBytes] = await Promise.all([
		readFile(join(sdkRoot, 'artifact.json')),
		readFile(executable),
		readFile(protocolPath),
	]);
	const receipt = JSON.parse(receiptBytes.toString('utf8')) as {
		readonly name?: unknown;
		readonly version?: unknown;
		readonly executableSha256?: unknown;
		readonly protocolManifestSha256?: unknown;
	};
	const protocol = JSON.parse(protocolBytes.toString('utf8')) as {
		readonly schema?: unknown;
		readonly name?: unknown;
		readonly sdkVersion?: unknown;
		readonly sourceDigest?: unknown;
		readonly fileCount?: unknown;
	};
	if (
		receipt.name !== '@openai/codex'
		|| receipt.version !== CODEX_AGENT_SDK_VERSION
		|| receipt.executableSha256 !== sha256(executableBytes)
		|| receipt.protocolManifestSha256 !== sha256(protocolBytes)
		|| protocol.schema !== 1
		|| protocol.name !== 'codex-app-server-protocol'
		|| protocol.sdkVersion !== CODEX_AGENT_SDK_VERSION
		|| protocol.sourceDigest !== CODEX_GENERATED_PROTOCOL_SOURCE_DIGEST
		|| protocol.fileCount !== CODEX_GENERATED_PROTOCOL_FILE_COUNT
	) {
		throw new Error('Codex built-in Agent SDK receipt does not match the generated protocol.');
	}
	const stateDirectory = join(options.stateRoot, 'codex');
	return CodexAgent.create({
		packageRevision: createAgentPackageRevision(`built-in.codex.${CODEX_AGENT_SDK_VERSION}`),
		stateDirectory,
		appServerFactory: new CodexAppServerProcessFactory({
			executable,
			stateDirectory: join(stateDirectory, 'sdk-state'),
		}),
		toolExecution: options.toolExecution,
		credentialResolver: options.credentialResolver,
	});
}
