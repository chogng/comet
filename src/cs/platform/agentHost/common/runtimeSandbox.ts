/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	AgentPackageContentDigest,
	AgentPackageId,
	AgentPackageRevision,
} from './identities.js';
import type {
	IAgentPackagePrivilege,
	IAgentPackageTarget,
	IInstalledAgentPackage,
	IVerifiedAgentPackageDependency,
} from './packages.js';
import { encodeAgentHostProtocolValue } from './protocolValues.js';

/** Resolves only package-store artifacts covered by one durable installed authorization receipt. */
export interface IAgentRuntimeInstalledArtifactPort {
	authorizeInstalledPackage(installedPackage: IInstalledAgentPackage): Promise<void>;
	resolveRuntimeEntryPoint(installedPackage: IInstalledAgentPackage): Promise<string>;
}

export interface IAgentRuntimeSandboxArtifactAuthority {
	readonly id: string;
	readonly source: string;
	readonly target: string;
	readonly digest: AgentPackageContentDigest;
	readonly verifiedDigest: AgentPackageContentDigest;
	readonly license: string;
	readonly executable: boolean;
	readonly immutable: true;
}

export interface IAgentRuntimeSandboxAuthority {
	readonly packageId: AgentPackageId;
	readonly packageRevision: AgentPackageRevision;
	readonly packageContentDigest: AgentPackageContentDigest;
	readonly packageSource: string;
	readonly target: IAgentPackageTarget;
	readonly runtimeEntryPoint: string;
	readonly artifacts: readonly IAgentRuntimeSandboxArtifactAuthority[];
	readonly process: string;
	readonly filesystem: readonly string[];
	readonly network: readonly string[];
	readonly secret: readonly string[];
	readonly toolExecutor: readonly string[];
}

function requireBoundedText(value: string, description: string): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > 16 * 1024) {
		throw new Error(`Invalid Agent runtime sandbox ${description}.`);
	}
	return value;
}

function exactPrivilegeKeys(privileges: readonly IAgentPackagePrivilege[]): Set<string> {
	if (!Array.isArray(privileges)) {
		throw new Error('Invalid Agent runtime sandbox privileges.');
	}
	const keys = new Set<string>();
	for (const privilege of privileges) {
		if (
			privilege === null
			|| typeof privilege !== 'object'
			|| Array.isArray(privilege)
			|| Object.keys(privilege).length !== 2
			|| !Object.hasOwn(privilege, 'kind')
			|| !Object.hasOwn(privilege, 'value')
			|| !['process', 'filesystem', 'network', 'secret', 'toolExecutor'].includes(privilege.kind)
		) {
			throw new Error('Invalid Agent runtime sandbox privilege.');
		}
		const value = requireBoundedText(privilege.value, 'privilege value');
		const key = `${privilege.kind}\u0000${value}`;
		if (keys.has(key)) {
			throw new Error('Duplicate Agent runtime sandbox privilege.');
		}
		keys.add(key);
	}
	return keys;
}

function assertExactPrivileges(
	declared: readonly IAgentPackagePrivilege[],
	granted: readonly IAgentPackagePrivilege[],
): void {
	const declaredKeys = exactPrivilegeKeys(declared);
	const grantedKeys = exactPrivilegeKeys(granted);
	if (
		declaredKeys.size !== grantedKeys.size
		|| [...declaredKeys].some(key => !grantedKeys.has(key))
	) {
		throw new Error('Agent runtime sandbox grants do not match the verified manifest.');
	}
}

function exactArtifact(dependency: IVerifiedAgentPackageDependency): IAgentRuntimeSandboxArtifactAuthority {
	if (
		dependency === null
		|| typeof dependency !== 'object'
		|| dependency.immutable !== true
		|| typeof dependency.executable !== 'boolean'
		|| dependency.digest !== dependency.verifiedDigest
	) {
		throw new Error('Invalid Agent runtime sandbox artifact authority.');
	}
	return Object.freeze({
		id: requireBoundedText(dependency.id, 'artifact ID'),
		source: requireBoundedText(dependency.source, 'artifact source'),
		target: requireBoundedText(dependency.target, 'artifact target'),
		digest: dependency.digest,
		verifiedDigest: dependency.verifiedDigest,
		license: requireBoundedText(dependency.license, 'artifact license'),
		executable: dependency.executable,
		immutable: true,
	});
}

/** Derives the complete connected-process authority only from one verified installed record. */
export function createAgentRuntimeSandboxAuthority(
	installedPackage: IInstalledAgentPackage,
	requiredProcessAuthority: string,
): IAgentRuntimeSandboxAuthority {
	if (
		installedPackage.distribution !== 'user'
		|| installedPackage.manifest.execution.kind !== 'connected'
		|| installedPackage.packageId !== installedPackage.manifest.packageId
		|| installedPackage.revision !== installedPackage.manifest.revision
		|| installedPackage.contentDigest !== installedPackage.manifest.contentDigest
	) {
		throw new Error('Agent runtime sandbox package identity is invalid.');
	}
	const target = installedPackage.manifest.target;
	if (
		target === null
		|| typeof target !== 'object'
		|| Array.isArray(target)
		|| Object.keys(target).length !== 2
	) {
		throw new Error('Agent runtime sandbox target is invalid.');
	}
	const exactTarget = Object.freeze({
		operatingSystem: requireBoundedText(target.operatingSystem, 'operating system'),
		architecture: requireBoundedText(target.architecture, 'architecture'),
	});
	assertExactPrivileges(installedPackage.manifest.privileges, installedPackage.grantedPrivileges);
	const processAuthorities = installedPackage.grantedPrivileges
		.filter(privilege => privilege.kind === 'process')
		.map(privilege => privilege.value);
	if (
		processAuthorities.length !== 1
		|| processAuthorities[0] !== requireBoundedText(requiredProcessAuthority, 'process authority')
	) {
		throw new Error('Agent runtime sandbox process authority is not exact.');
	}
	if (!Array.isArray(installedPackage.dependencyClosure) || installedPackage.dependencyClosure.length === 0) {
		throw new Error('Agent runtime sandbox artifact closure is empty.');
	}
	const artifacts = Object.freeze(installedPackage.dependencyClosure.map(exactArtifact));
	const runtimeEntryPoint = requireBoundedText(
		installedPackage.manifest.execution.entryPoint,
		'runtime entry point',
	);
	if (artifacts.filter(artifact => artifact.target === runtimeEntryPoint).length !== 1) {
		throw new Error('Agent runtime sandbox entry point has no unique verified artifact.');
	}
	const authorityValues = (kind: IAgentPackagePrivilege['kind']): readonly string[] => Object.freeze(
		installedPackage.grantedPrivileges
			.filter(privilege => privilege.kind === kind)
			.map(privilege => privilege.value)
			.sort(),
	);
	return Object.freeze({
		packageId: installedPackage.packageId,
		packageRevision: installedPackage.revision,
		packageContentDigest: installedPackage.contentDigest,
		packageSource: requireBoundedText(installedPackage.source, 'package source'),
		target: exactTarget,
		runtimeEntryPoint,
		artifacts,
		process: processAuthorities[0],
		filesystem: authorityValues('filesystem'),
		network: authorityValues('network'),
		secret: authorityValues('secret'),
		toolExecutor: authorityValues('toolExecutor'),
	});
}

export function isEqualAgentRuntimeSandboxAuthority(
	left: IAgentRuntimeSandboxAuthority,
	right: IAgentRuntimeSandboxAuthority,
): boolean {
	return encodeAgentHostProtocolValue(left) === encodeAgentHostProtocolValue(right);
}
