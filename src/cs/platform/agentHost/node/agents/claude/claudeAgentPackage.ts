/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	createAgentPackageContentDigest,
	createAgentPackageRevision,
	type AgentPackageContentDigest,
} from 'cs/platform/agentHost/common/identities';
import type {
	IAgentPackageManifest,
	IAgentPackageOffering,
	IAgentPackageTarget,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import type { ILocalHostAgentPackageProduct } from 'cs/platform/agentHost/node/packages/agentPackageProducts';
import { CLAUDE_AGENT_SDK_VERSION } from '../agentSdkProducts.js';
import { ClaudeAgent, productClaudeAgentRetentionLimits, type IClaudeAgentSdk } from './claudeAgent.js';
import {
	CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	CLAUDE_AGENT_ID,
	CLAUDE_AGENT_NETWORK_PRIVILEGE,
	CLAUDE_AGENT_PACKAGE_DEFINITION,
	CLAUDE_AGENT_PACKAGE_ID,
	CLAUDE_AGENT_TOOL_EXECUTOR_PRIVILEGE,
} from './claudeAgentDefinition.js';

export const CLAUDE_AGENT_SDK_EXECUTABLE_TARGET = 'vendor/claude-agent-sdk/claude';
export const CLAUDE_AGENT_SDK_EXECUTABLE_WINDOWS_TARGET = 'vendor/claude-agent-sdk/claude.exe';
export const CLAUDE_AGENT_SDK_MODULE_TARGET = 'vendor/claude-agent-sdk/sdk.js';

export interface IClaudeAgentPackageArtifact {
	readonly source: string;
	readonly contentDigest: AgentPackageContentDigest;
}

export interface IClaudeAgentPackageArtifacts {
	readonly contentDigest: AgentPackageContentDigest;
	readonly module: IClaudeAgentPackageArtifact;
	readonly executable: IClaudeAgentPackageArtifact;
}

export interface IClaudeAgentPackageProduct extends ILocalHostAgentPackageProduct {
	readonly execution: 'host';
	readonly definition: typeof CLAUDE_AGENT_PACKAGE_DEFINITION;
	readonly verifiedPackage: IVerifiedAgentPackage;
}

export function claudeAgentSdkExecutableTarget(target: IAgentPackageTarget): string {
	return target.operatingSystem === 'win32'
		? CLAUDE_AGENT_SDK_EXECUTABLE_WINDOWS_TARGET
		: CLAUDE_AGENT_SDK_EXECUTABLE_TARGET;
}

/** Creates the exact Claude SDK product for one desktop target. */
export function createClaudeAgentPackageProduct(
	target: IAgentPackageTarget,
	artifacts: IClaudeAgentPackageArtifacts,
	stateRoot: string,
): IClaudeAgentPackageProduct {
	if (!isAbsolute(stateRoot)) {
		throw new Error('Claude Agent state root must be absolute.');
	}
	const revision = createAgentPackageRevision(
		`claude.agent-sdk.${CLAUDE_AGENT_SDK_VERSION}.${target.operatingSystem}.${target.architecture}`,
	);
	const executableTarget = claudeAgentSdkExecutableTarget(target);
	const dependencies = Object.freeze([Object.freeze({
		id: 'claude.agent-sdk-module',
		source: artifacts.module.source,
		target: CLAUDE_AGENT_SDK_MODULE_TARGET,
		digest: artifacts.module.contentDigest,
		license: 'Anthropic Commercial Terms',
		executable: false,
	}), Object.freeze({
		id: 'claude.agent-sdk-executable',
		source: artifacts.executable.source,
		target: executableTarget,
		digest: artifacts.executable.contentDigest,
		license: 'Anthropic Commercial Terms',
		executable: true,
	})]);
	const privileges = Object.freeze([
		Object.freeze({ kind: 'network' as const, value: CLAUDE_AGENT_NETWORK_PRIVILEGE }),
		Object.freeze({ kind: 'secret' as const, value: 'configured.model.api-key' }),
		Object.freeze({ kind: 'toolExecutor' as const, value: CLAUDE_AGENT_TOOL_EXECUTOR_PRIVILEGE }),
	]);
	const offering: IAgentPackageOffering = Object.freeze({
		packageId: CLAUDE_AGENT_PACKAGE_ID,
		revision,
		contentDigest: createAgentPackageContentDigest(artifacts.contentDigest),
		source: artifacts.executable.source,
		distribution: 'user',
	});
	const manifest: IAgentPackageManifest = Object.freeze({
		schema: 1,
		packageId: CLAUDE_AGENT_PACKAGE_ID,
		revision,
		contentDigest: offering.contentDigest,
		publisher: 'Comet',
		target: Object.freeze({ ...target }),
		execution: Object.freeze({ kind: 'host' as const }),
		agentIds: Object.freeze([CLAUDE_AGENT_ID]),
		dependencies,
		privileges,
	});
	const verifiedPackage: IVerifiedAgentPackage = Object.freeze({
		offering,
		manifest,
		dependencyClosure: Object.freeze(dependencies.map(dependency => Object.freeze({
			...dependency,
			verifiedDigest: dependency.digest,
			immutable: true as const,
		}))),
		grantedPrivileges: privileges,
	});
	return Object.freeze({
		execution: 'host' as const,
		definition: CLAUDE_AGENT_PACKAGE_DEFINITION,
		offering,
		verifiedPackage,
		credentialBindings: Object.freeze([Object.freeze({
			provider: CLAUDE_AGENT_API_KEY_CREDENTIAL_PROVIDER,
			scope: 'llm',
			reference: CLAUDE_AGENT_API_KEY_CREDENTIAL_REFERENCE,
			privilege: 'configured.model.api-key',
		})]),
		createAgent: async (
			installedPackage: IInstalledAgentPackage,
			services: Parameters<ILocalHostAgentPackageProduct['createAgent']>[1],
		) => {
			const sdkModule = installedPackage.dependencyClosure.find(
				dependency => dependency.target === CLAUDE_AGENT_SDK_MODULE_TARGET,
			);
			const executable = installedPackage.dependencyClosure.find(
				dependency => dependency.target === executableTarget,
			);
			if (
				installedPackage.packageId !== offering.packageId
				|| installedPackage.revision !== offering.revision
				|| installedPackage.contentDigest !== offering.contentDigest
				|| installedPackage.manifest.execution.kind !== 'host'
				|| sdkModule === undefined
				|| executable === undefined
			) {
				throw new Error('Installed Claude Agent package does not match its product offering.');
			}
			const loadedSdk = await import(sdkModule.source) as Partial<IClaudeAgentSdk>;
			if (
				typeof loadedSdk.createSdkMcpServer !== 'function'
				|| typeof loadedSdk.deleteSession !== 'function'
				|| typeof loadedSdk.query !== 'function'
				|| typeof loadedSdk.tool !== 'function'
			) {
				throw new Error('Installed Claude Agent SDK module has an invalid export surface.');
			}
			const sdk: IClaudeAgentSdk = Object.freeze({
				createSdkMcpServer: loadedSdk.createSdkMcpServer,
				deleteSession: loadedSdk.deleteSession,
				query: loadedSdk.query,
				tool: loadedSdk.tool,
			});
			const stateDirectory = join(stateRoot, 'claude');
			const agent = await ClaudeAgent.create({
				packageRevision: installedPackage.revision,
				claudeCodeExecutable: fileURLToPath(executable.source),
				stateDirectory,
				cacheDirectory: join(stateDirectory, 'sdk-cache'),
				toolExecution: services.toolExecution,
				credentialResolver: services.credentialResolver,
				sdk,
				...productClaudeAgentRetentionLimits,
			});
			return Object.freeze({ agents: Object.freeze([agent]), lifetime: agent });
		},
	});
}
