/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAbsolute, join } from 'node:path';
import { readFile } from 'node:fs/promises';

import {
	claudeAgentSdkExecutableTarget,
	CLAUDE_AGENT_SDK_VERSION,
	CLAUDE_AGENT_SDK_MODULE_TARGET,
	createClaudeAgentPackageProduct,
} from 'cs/platform/agentHost/node/agents/claude/claudeAgentPackage';
import {
	codexAgentSdkExecutableTarget,
	CODEX_AGENT_SDK_PROTOCOL_TARGET,
	CODEX_AGENT_SDK_VERSION,
	createCodexAgentPackageProduct,
} from 'cs/platform/agentHost/node/agents/codex/codexAgentPackage';
import {
	CODEX_GENERATED_PROTOCOL_FILE_COUNT,
	CODEX_GENERATED_PROTOCOL_SOURCE_DIGEST,
} from 'cs/platform/agentHost/node/agents/codex/protocol/protocolMetadata';
import type { IAgentPackageTarget } from 'cs/platform/agentHost/common/packages';
import type { ILocalAgentPackageProduct } from './agentPackageProducts.js';
import {
	createLocalAgentPackageArtifactFile,
	createLocalAgentPackageContentDigest,
	LocalAgentPackageArtifactPort,
} from './localAgentPackageArtifactPort.js';

export interface IProductAgentPackageCatalogOptions {
	readonly target: IAgentPackageTarget;
	readonly sdkArtifactRoot: string;
	readonly packageStorageRoot: string;
	readonly agentStateRoot: string;
}

export interface IProductAgentPackageCatalog {
	readonly products: readonly ILocalAgentPackageProduct[];
	readonly artifacts: LocalAgentPackageArtifactPort;
}

/** Creates the exact product-owned Agent package catalog for one desktop target. */
export async function createProductAgentPackageCatalog(
	options: IProductAgentPackageCatalogOptions,
): Promise<IProductAgentPackageCatalog> {
	for (const [name, value] of Object.entries({
		sdkArtifactRoot: options.sdkArtifactRoot,
		packageStorageRoot: options.packageStorageRoot,
		agentStateRoot: options.agentStateRoot,
	})) {
		if (!isAbsolute(value)) {
			throw new Error(`Product Agent package ${name} must be absolute.`);
		}
	}
	const sdkTarget = `${options.target.operatingSystem}-${options.target.architecture}`;
	const executableName = options.target.operatingSystem === 'win32' ? 'claude.exe' : 'claude';
	const targetRoot = join(options.sdkArtifactRoot, 'claude', sdkTarget);
	const executableArtifact = await createLocalAgentPackageArtifactFile(join(
		targetRoot,
		executableName,
	));
	const moduleArtifact = await createLocalAgentPackageArtifactFile(join(targetRoot, 'sdk.js'));
	const artifact = JSON.parse(await readFile(join(targetRoot, 'artifact.json'), 'utf8')) as unknown;
	if (
		artifact === null
		|| typeof artifact !== 'object'
		|| Array.isArray(artifact)
		|| Object.keys(artifact).length !== 5
		|| (artifact as { readonly name?: unknown }).name !== '@anthropic-ai/claude-agent-sdk'
		|| (artifact as { readonly version?: unknown }).version !== CLAUDE_AGENT_SDK_VERSION
		|| (artifact as { readonly target?: unknown }).target !== sdkTarget
		|| executableArtifact.contentDigest !== `sha256:${(artifact as { readonly executableSha256?: unknown }).executableSha256}`
		|| moduleArtifact.contentDigest !== `sha256:${(artifact as { readonly moduleSha256?: unknown }).moduleSha256}`
	) {
		throw new Error('Claude Agent SDK build artifact does not match the product package definition.');
	}
	const executableTarget = claudeAgentSdkExecutableTarget(options.target);
	const claude = createClaudeAgentPackageProduct(options.target, Object.freeze({
		contentDigest: createLocalAgentPackageContentDigest(Object.freeze([
			Object.freeze({ target: CLAUDE_AGENT_SDK_MODULE_TARGET, contentDigest: moduleArtifact.contentDigest }),
			Object.freeze({ target: executableTarget, contentDigest: executableArtifact.contentDigest }),
		])),
		module: moduleArtifact,
		executable: executableArtifact,
	}), options.agentStateRoot);
	const codexTargetRoot = join(options.sdkArtifactRoot, 'codex', sdkTarget);
	const codexExecutableName = options.target.operatingSystem === 'win32' ? 'codex.exe' : 'codex';
	const codexExecutableArtifact = await createLocalAgentPackageArtifactFile(join(
		codexTargetRoot,
		codexExecutableName,
	));
	const codexProtocolArtifact = await createLocalAgentPackageArtifactFile(join(
		codexTargetRoot,
		'protocol.json',
	));
	const codexArtifact = JSON.parse(await readFile(join(codexTargetRoot, 'artifact.json'), 'utf8')) as unknown;
	const codexProtocol = JSON.parse(await readFile(join(codexTargetRoot, 'protocol.json'), 'utf8')) as unknown;
	if (
		codexArtifact === null
		|| typeof codexArtifact !== 'object'
		|| Array.isArray(codexArtifact)
		|| Object.keys(codexArtifact).length !== 5
		|| (codexArtifact as { readonly name?: unknown }).name !== '@openai/codex'
		|| (codexArtifact as { readonly version?: unknown }).version !== CODEX_AGENT_SDK_VERSION
		|| (codexArtifact as { readonly target?: unknown }).target !== sdkTarget
		|| codexExecutableArtifact.contentDigest !== `sha256:${(codexArtifact as { readonly executableSha256?: unknown }).executableSha256}`
		|| codexProtocolArtifact.contentDigest !== `sha256:${(codexArtifact as { readonly protocolManifestSha256?: unknown }).protocolManifestSha256}`
		|| codexProtocol === null
		|| typeof codexProtocol !== 'object'
		|| Array.isArray(codexProtocol)
		|| Object.keys(codexProtocol).length !== 5
		|| (codexProtocol as { readonly schema?: unknown }).schema !== 1
		|| (codexProtocol as { readonly name?: unknown }).name !== 'codex-app-server-protocol'
		|| (codexProtocol as { readonly sdkVersion?: unknown }).sdkVersion !== CODEX_AGENT_SDK_VERSION
		|| (codexProtocol as { readonly sourceDigest?: unknown }).sourceDigest !== CODEX_GENERATED_PROTOCOL_SOURCE_DIGEST
		|| (codexProtocol as { readonly fileCount?: unknown }).fileCount !== CODEX_GENERATED_PROTOCOL_FILE_COUNT
	) {
		throw new Error('Codex SDK build artifact does not match the product package definition.');
	}
	const codex = createCodexAgentPackageProduct(options.target, Object.freeze({
		contentDigest: createLocalAgentPackageContentDigest(Object.freeze([
			Object.freeze({
				target: codexAgentSdkExecutableTarget(options.target),
				contentDigest: codexExecutableArtifact.contentDigest,
			}),
			Object.freeze({
				target: CODEX_AGENT_SDK_PROTOCOL_TARGET,
				contentDigest: codexProtocolArtifact.contentDigest,
			}),
		])),
		executable: codexExecutableArtifact,
		protocol: codexProtocolArtifact,
	}), options.agentStateRoot);
	const products = Object.freeze([claude, codex]);
	return Object.freeze({
		products,
		artifacts: new LocalAgentPackageArtifactPort({
			storageRoot: options.packageStorageRoot,
			packages: products.map(product => product.verifiedPackage),
		}),
	});
}
