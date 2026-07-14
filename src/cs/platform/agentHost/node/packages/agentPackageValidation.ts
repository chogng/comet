/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	type AgentId,
	createAgentId,
	createAgentPackageContentDigest,
	createAgentPackageId,
	createAgentPackageRevision,
} from 'cs/platform/agentHost/common/identities';
import { AgentPackageError, AgentPackageErrorCode } from 'cs/platform/agentHost/common/packageErrors';
import type {
	IAgentPackageDependency,
	IAgentPackageManifest,
	IAgentPackageOffering,
	IAgentPackagePrivilege,
	IAgentPackageTarget,
	IInstalledAgentPackage,
	IVerifiedAgentPackageDependency,
} from 'cs/platform/agentHost/common/packages';
import type { IVerifiedAgentPackage } from './agentPackageTypes.js';

const MAXIMUM_PACKAGE_TEXT_LENGTH = 2_048;

function assertBoundedText(value: unknown, field: string, packageId: string): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > MAXIMUM_PACKAGE_TEXT_LENGTH) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			`Invalid ${field}`,
			{ packageId },
		);
	}
}

function assertExactRecord(value: unknown, fields: readonly string[], description: string): void {
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
		|| Object.keys(value).length !== fields.length
		|| fields.some(field => !Object.hasOwn(value, field))
	) {
		throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, `Invalid ${description}`);
	}
}

function assertArray(value: unknown, description: string): asserts value is readonly unknown[] {
	if (!Array.isArray(value)) {
		throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, `Invalid ${description}`);
	}
}

function assertPackageWireShape(verifiedPackage: IVerifiedAgentPackage): void {
	assertExactRecord(verifiedPackage, ['offering', 'manifest', 'dependencyClosure', 'grantedPrivileges'], 'Agent package fields');
	assertExactRecord(verifiedPackage.offering, ['packageId', 'revision', 'contentDigest', 'source', 'distribution'], 'Agent package offering fields');
	createAgentPackageId(verifiedPackage.offering.packageId);
	createAgentPackageRevision(verifiedPackage.offering.revision);
	createAgentPackageContentDigest(verifiedPackage.offering.contentDigest);
	if (verifiedPackage.offering.distribution !== 'bundled' && verifiedPackage.offering.distribution !== 'user') {
		throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid Agent package distribution');
	}
	assertExactRecord(
		verifiedPackage.manifest,
		['schema', 'packageId', 'revision', 'contentDigest', 'publisher', 'target', 'execution', 'agentIds', 'dependencies', 'privileges'],
		'Agent package manifest fields',
	);
	createAgentPackageId(verifiedPackage.manifest.packageId);
	createAgentPackageRevision(verifiedPackage.manifest.revision);
	createAgentPackageContentDigest(verifiedPackage.manifest.contentDigest);
	assertExactRecord(verifiedPackage.manifest.target, ['operatingSystem', 'architecture'], 'Agent package target fields');
	assertBoundedText(verifiedPackage.manifest.target.operatingSystem, 'target operating system', verifiedPackage.offering.packageId);
	assertBoundedText(verifiedPackage.manifest.target.architecture, 'target architecture', verifiedPackage.offering.packageId);
	if (verifiedPackage.manifest.execution.kind === 'host') {
		assertExactRecord(verifiedPackage.manifest.execution, ['kind'], 'Host Agent package execution fields');
	} else if (verifiedPackage.manifest.execution.kind === 'connected') {
		assertExactRecord(verifiedPackage.manifest.execution, ['kind', 'entryPoint'], 'Connected Agent package execution fields');
		assertBoundedText(
			verifiedPackage.manifest.execution.entryPoint,
			'connected Agent entry point',
			verifiedPackage.offering.packageId,
		);
	} else {
		throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid Agent package execution');
	}
	assertArray(verifiedPackage.manifest.agentIds, 'Agent package Agent IDs');
	for (const agentId of verifiedPackage.manifest.agentIds) {
		createAgentId(agentId);
	}
	assertArray(verifiedPackage.manifest.dependencies, 'Agent package dependencies');
	for (const dependency of verifiedPackage.manifest.dependencies) {
		assertExactRecord(dependency, ['id', 'source', 'target', 'digest', 'license', 'executable'], 'Agent package dependency fields');
		createAgentPackageContentDigest(dependency.digest);
		if (typeof dependency.executable !== 'boolean') {
			throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid Agent package dependency execution mode');
		}
	}
	assertArray(verifiedPackage.dependencyClosure, 'Agent package dependency closure');
	for (const dependency of verifiedPackage.dependencyClosure) {
		assertExactRecord(
			dependency,
			['id', 'source', 'target', 'digest', 'verifiedDigest', 'license', 'executable', 'immutable'],
			'Agent package verified dependency fields',
		);
		createAgentPackageContentDigest(dependency.digest);
		createAgentPackageContentDigest(dependency.verifiedDigest);
		if (dependency.immutable !== true) {
			throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid Agent package dependency immutability');
		}
	}
	const validatePrivileges = (privileges: readonly IAgentPackagePrivilege[], description: string): void => {
		assertArray(privileges, description);
		for (const privilege of privileges) {
			assertExactRecord(privilege, ['kind', 'value'], 'Agent package privilege fields');
			if (!['process', 'filesystem', 'network', 'secret', 'toolExecutor'].includes(privilege.kind)) {
				throw new AgentPackageError(AgentPackageErrorCode.InvalidPackage, 'Invalid Agent package privilege kind');
			}
		}
	};
	validatePrivileges(verifiedPackage.manifest.privileges, 'Agent package manifest privileges');
	validatePrivileges(verifiedPackage.grantedPrivileges, 'Agent package granted privileges');
}

function assertSameTarget(
	actual: IAgentPackageTarget,
	expected: IAgentPackageTarget,
	packageId: string,
): void {
	if (
		actual.operatingSystem !== expected.operatingSystem
		|| actual.architecture !== expected.architecture
	) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Agent package target does not match the Host target',
			{ packageId },
		);
	}
}

function privilegeKey(privilege: IAgentPackagePrivilege): string {
	return `${privilege.kind}\u0000${privilege.value}`;
}

function dependencyKey(dependency: IAgentPackageDependency): string {
	return dependency.id;
}

function assertUniqueAgentIds(agentIds: readonly AgentId[], packageId: string): void {
	if (agentIds.length === 0) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Agent package must declare at least one Agent ID',
			{ packageId },
		);
	}

	const seen = new Set<AgentId>();
	for (const agentId of agentIds) {
		if (seen.has(agentId)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Agent package declares a duplicate Agent ID',
				{ packageId, agentId },
			);
		}
		seen.add(agentId);
	}
}

function assertCompleteDependencyClosure(
	manifest: IAgentPackageManifest,
	closure: readonly IVerifiedAgentPackageDependency[],
): void {
	const packageId = manifest.packageId;
	if (manifest.dependencies.length === 0 || closure.length !== manifest.dependencies.length) {
		throw new AgentPackageError(
			AgentPackageErrorCode.IncompleteDependencyClosure,
			'Agent package dependency closure is incomplete',
			{ packageId },
		);
	}

	const declaredById = new Map<string, IAgentPackageDependency>();
	for (const dependency of manifest.dependencies) {
		assertBoundedText(dependency.id, 'dependency ID', packageId);
		assertBoundedText(dependency.source, 'dependency source', packageId);
		assertBoundedText(dependency.target, 'dependency target', packageId);
		assertBoundedText(dependency.license, 'dependency license', packageId);
		if (declaredById.has(dependencyKey(dependency))) {
			throw new AgentPackageError(
				AgentPackageErrorCode.IncompleteDependencyClosure,
				'Agent package declares a duplicate dependency',
				{ packageId },
			);
		}
		declaredById.set(dependencyKey(dependency), dependency);
	}

	const verifiedIds = new Set<string>();
	for (const dependency of closure) {
		const declared = declaredById.get(dependencyKey(dependency));
		if (
			!declared
			|| verifiedIds.has(dependency.id)
			|| dependency.source !== declared.source
			|| dependency.target !== declared.target
			|| dependency.digest !== declared.digest
			|| dependency.verifiedDigest !== declared.digest
			|| dependency.license !== declared.license
			|| dependency.executable !== declared.executable
			|| dependency.immutable !== true
		) {
			throw new AgentPackageError(
				AgentPackageErrorCode.IncompleteDependencyClosure,
				'Agent package dependency verification does not match its manifest',
				{ packageId },
			);
		}
		verifiedIds.add(dependency.id);
	}
}

function assertExactPrivileges(
	manifest: IAgentPackageManifest,
	grantedPrivileges: readonly IAgentPackagePrivilege[],
): void {
	const packageId = manifest.packageId;
	const declaredKeys = new Set<string>();
	for (const privilege of manifest.privileges) {
		assertBoundedText(privilege.value, 'privilege value', packageId);
		const key = privilegeKey(privilege);
		if (declaredKeys.has(key)) {
			throw new AgentPackageError(
				AgentPackageErrorCode.InvalidPackage,
				'Agent package declares a duplicate privilege',
				{ packageId },
			);
		}
		declaredKeys.add(key);
	}

	const grantedKeys = new Set(grantedPrivileges.map(privilegeKey));
	if (
		grantedKeys.size !== grantedPrivileges.length
		|| declaredKeys.size !== grantedKeys.size
		|| [...declaredKeys].some(key => !grantedKeys.has(key))
	) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Agent package granted privileges do not match its verified manifest',
			{ packageId },
		);
	}
}

function assertOfferingMatchesManifest(
	offering: IAgentPackageOffering,
	manifest: IAgentPackageManifest,
): void {
	if (
		offering.packageId !== manifest.packageId
		|| offering.revision !== manifest.revision
		|| offering.contentDigest !== manifest.contentDigest
	) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Agent package manifest does not match the addressed offering',
			{ packageId: offering.packageId },
		);
	}
}

function assertDistribution(verifiedPackage: IVerifiedAgentPackage): void {
	const { offering, manifest } = verifiedPackage;
	if (
		offering.distribution === 'bundled'
		&& (
			offering.packageId !== 'comet'
			|| manifest.agentIds.length !== 1
			|| manifest.agentIds[0] !== 'comet'
		)
	) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Comet is the only bundled Agent package',
			{ packageId: offering.packageId },
		);
	}
}

function freezeDependency(
	dependency: IVerifiedAgentPackageDependency,
): IVerifiedAgentPackageDependency {
	return Object.freeze({ ...dependency });
}

function freezeManifest(manifest: IAgentPackageManifest): IAgentPackageManifest {
	return Object.freeze({
		...manifest,
		target: Object.freeze({ ...manifest.target }),
		execution: Object.freeze({ ...manifest.execution }),
		agentIds: Object.freeze([...manifest.agentIds]),
		dependencies: Object.freeze(manifest.dependencies.map(dependency => Object.freeze({ ...dependency }))),
		privileges: Object.freeze(manifest.privileges.map(privilege => Object.freeze({ ...privilege }))),
	});
}

export function validateAndFreezeAgentPackage(
	verifiedPackage: IVerifiedAgentPackage,
	hostTarget: IAgentPackageTarget,
): IInstalledAgentPackage {
	assertPackageWireShape(verifiedPackage);
	const { offering, manifest } = verifiedPackage;
	assertBoundedText(offering.source, 'offering source', offering.packageId);
	assertBoundedText(manifest.publisher, 'publisher', offering.packageId);
	if (!Number.isSafeInteger(manifest.schema) || manifest.schema < 1) {
		throw new AgentPackageError(
			AgentPackageErrorCode.InvalidPackage,
			'Invalid Agent package manifest schema',
			{ packageId: offering.packageId, actual: manifest.schema },
		);
	}

	assertOfferingMatchesManifest(offering, manifest);
	assertSameTarget(manifest.target, hostTarget, offering.packageId);
	assertUniqueAgentIds(manifest.agentIds, offering.packageId);
	assertDistribution(verifiedPackage);
	assertCompleteDependencyClosure(manifest, verifiedPackage.dependencyClosure);
	assertExactPrivileges(manifest, verifiedPackage.grantedPrivileges);

	return Object.freeze({
		packageId: offering.packageId,
		revision: offering.revision,
		contentDigest: offering.contentDigest,
		source: offering.source,
		distribution: offering.distribution,
		manifest: freezeManifest(manifest),
		dependencyClosure: Object.freeze(verifiedPackage.dependencyClosure.map(freezeDependency)),
		grantedPrivileges: Object.freeze(
			verifiedPackage.grantedPrivileges.map(privilege => Object.freeze({ ...privilege })),
		),
	});
}

export function validateAndFreezeInstalledAgentPackage(
	value: unknown,
	hostTarget: IAgentPackageTarget,
): IInstalledAgentPackage {
	assertExactRecord(
		value,
		['packageId', 'revision', 'contentDigest', 'source', 'distribution', 'manifest', 'dependencyClosure', 'grantedPrivileges'],
		'installed Agent package fields',
	);
	const installedPackage = value as IInstalledAgentPackage;
	return validateAndFreezeAgentPackage({
		offering: {
			packageId: installedPackage.packageId,
			revision: installedPackage.revision,
			contentDigest: installedPackage.contentDigest,
			source: installedPackage.source,
			distribution: installedPackage.distribution,
		},
		manifest: installedPackage.manifest,
		dependencyClosure: installedPackage.dependencyClosure,
		grantedPrivileges: installedPackage.grantedPrivileges,
	}, hostTarget);
}
