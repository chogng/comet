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
import { CodexAgent } from './codexAgent.js';
import { CodexAppServerProcessFactory } from './codexAppServer.js';
import {
	CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
	CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
	CODEX_AGENT_CATALOG_NETWORK_PRIVILEGE,
	CODEX_AGENT_ID,
	CODEX_AGENT_NETWORK_PRIVILEGE,
	CODEX_AGENT_PACKAGE_DEFINITION,
	CODEX_AGENT_PACKAGE_ID,
	CODEX_AGENT_TOOL_EXECUTOR_PRIVILEGE,
} from './codexAgentDefinition.js';
import type { IVerifiedAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageTypes';
import type { ILocalHostAgentPackageProduct } from 'cs/platform/agentHost/node/packages/agentPackageProducts';
import { CODEX_GENERATED_PROTOCOL_SDK_VERSION } from './protocol/protocolMetadata.js';

export const CODEX_AGENT_SDK_VERSION = CODEX_GENERATED_PROTOCOL_SDK_VERSION;
export const CODEX_AGENT_SDK_EXECUTABLE_TARGET = 'vendor/codex-sdk/codex';
export const CODEX_AGENT_SDK_EXECUTABLE_WINDOWS_TARGET = 'vendor/codex-sdk/codex.exe';
export const CODEX_AGENT_SDK_PROTOCOL_TARGET = 'vendor/codex-sdk/protocol.json';

export interface ICodexAgentPackageArtifact {
	readonly source: string;
	readonly contentDigest: AgentPackageContentDigest;
}

export interface ICodexAgentPackageArtifacts {
	readonly contentDigest: AgentPackageContentDigest;
	readonly executable: ICodexAgentPackageArtifact;
	readonly protocol: ICodexAgentPackageArtifact;
}

export interface ICodexAgentPackageProduct extends ILocalHostAgentPackageProduct {
	readonly execution: 'host';
	readonly definition: typeof CODEX_AGENT_PACKAGE_DEFINITION;
	readonly verifiedPackage: IVerifiedAgentPackage;
}

export function codexAgentSdkExecutableTarget(target: IAgentPackageTarget): string {
	return target.operatingSystem === 'win32'
		? CODEX_AGENT_SDK_EXECUTABLE_WINDOWS_TARGET
		: CODEX_AGENT_SDK_EXECUTABLE_TARGET;
}

/** Creates the exact Codex SDK product for one desktop target. */
export function createCodexAgentPackageProduct(
	target: IAgentPackageTarget,
	artifacts: ICodexAgentPackageArtifacts,
	stateRoot: string,
): ICodexAgentPackageProduct {
	if (!isAbsolute(stateRoot)) {
		throw new Error('Codex Agent state root must be absolute.');
	}
	const revision = createAgentPackageRevision(
		`codex.app-server.${CODEX_AGENT_SDK_VERSION}.${target.operatingSystem}.${target.architecture}`,
	);
	const executableTarget = codexAgentSdkExecutableTarget(target);
	const dependencies = Object.freeze([
		Object.freeze({
			id: 'codex-sdk-executable',
			source: artifacts.executable.source,
			target: executableTarget,
			digest: artifacts.executable.contentDigest,
			license: 'Apache-2.0',
			executable: true,
		}),
		Object.freeze({
			id: 'codex-app-server-protocol',
			source: artifacts.protocol.source,
			target: CODEX_AGENT_SDK_PROTOCOL_TARGET,
			digest: artifacts.protocol.contentDigest,
			license: 'Apache-2.0',
			executable: false,
		}),
	]);
	const privileges = Object.freeze([
		Object.freeze({ kind: 'network' as const, value: CODEX_AGENT_NETWORK_PRIVILEGE }),
		Object.freeze({ kind: 'network' as const, value: CODEX_AGENT_CATALOG_NETWORK_PRIVILEGE }),
		Object.freeze({ kind: 'secret' as const, value: 'configured.model.api-key' }),
		Object.freeze({ kind: 'toolExecutor' as const, value: CODEX_AGENT_TOOL_EXECUTOR_PRIVILEGE }),
	]);
	const offering: IAgentPackageOffering = Object.freeze({
		packageId: CODEX_AGENT_PACKAGE_ID,
		revision,
		contentDigest: createAgentPackageContentDigest(artifacts.contentDigest),
		source: artifacts.executable.source,
		distribution: 'user',
	});
	const manifest: IAgentPackageManifest = Object.freeze({
		schema: 1,
		packageId: CODEX_AGENT_PACKAGE_ID,
		revision,
		contentDigest: offering.contentDigest,
		publisher: 'Comet',
		target: Object.freeze({ ...target }),
		execution: Object.freeze({ kind: 'host' as const }),
		agentIds: Object.freeze([CODEX_AGENT_ID]),
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
		definition: CODEX_AGENT_PACKAGE_DEFINITION,
		offering,
		verifiedPackage,
		credentialBindings: Object.freeze([Object.freeze({
			provider: CODEX_AGENT_API_KEY_CREDENTIAL_PROVIDER,
			scope: 'llm',
			reference: CODEX_AGENT_API_KEY_CREDENTIAL_REFERENCE,
			privilege: 'configured.model.api-key',
		})]),
		createAgent: async (
			installedPackage: IInstalledAgentPackage,
			services: Parameters<ILocalHostAgentPackageProduct['createAgent']>[1],
		) => {
			const executable = installedPackage.dependencyClosure.find(
				dependency => dependency.target === executableTarget,
			);
			if (
				installedPackage.packageId !== offering.packageId
				|| installedPackage.revision !== offering.revision
				|| installedPackage.contentDigest !== offering.contentDigest
				|| installedPackage.manifest.execution.kind !== 'host'
				|| executable === undefined
			) {
				throw new Error('Installed Codex Agent package does not match its product offering.');
			}
			const stateDirectory = join(stateRoot, 'codex');
			const agent = await CodexAgent.create({
				packageRevision: installedPackage.revision,
				stateDirectory,
				appServerFactory: new CodexAppServerProcessFactory({
					executable: fileURLToPath(executable.source),
					stateDirectory: join(stateDirectory, 'sdk-state'),
				}),
				toolExecution: services.toolExecution,
				credentialResolver: services.credentialResolver,
			});
			return Object.freeze({ agents: Object.freeze([agent]), lifetime: agent });
		},
	});
}
