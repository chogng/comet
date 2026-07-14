/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStorage } from 'cs/base/parts/storage/common/storage';
import type { IAgentRuntimeRegistration } from 'cs/platform/agentHost/common/agent';
import {
	type IAgentConfigurationState,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import {
	type AgentCapabilityRevision,
	type AgentDescriptorRevision,
	type AgentId,
	type AgentPackageId,
	type AgentResumeSchemaId,
	type AgentRuntimeRegistrationRevision,
	type AgentToolSchemaProfileId,
	createAgentCapabilityRevision,
	createAgentConfigurationSchemaRevision,
	createAgentDescriptorRevision,
	createAgentId,
	createAgentPackageId,
	createAgentResumeSchemaId,
	createAgentRuntimeRegistrationRevision,
	createAgentToolSchemaProfileId,
} from 'cs/platform/agentHost/common/identities';
import type {
	AgentPackagePersistedOperation,
	IAgentPackagePersistedState,
	IAgentPackageActivationTransitionSide,
	IAgentPackageTarget,
	IInstalledAgentPackage,
} from 'cs/platform/agentHost/common/packages';
import type { IAgentHostSessionState } from 'cs/platform/agentHost/common/protocol';
import {
	assertAgentHostPersistedCatalog,
	type IAgentHostCatalogStore,
	type IAgentHostLegacyCatalogSource,
	type IAgentHostPersistedCatalog,
	type IAgentHostPersistedSessionRecord,
} from 'cs/platform/agentHost/node/host/agentHostCatalog.js';
import {
	type IAgentPackageStateStore,
	validateAndFreezeAgentPackagePersistedState,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle.js';
import { validateAndFreezeInstalledAgentPackage } from 'cs/platform/agentHost/node/packages/agentPackageValidation.js';

const agentHostCatalogStorageKeyV1 = 'agentHost.catalog.v1';
const agentHostCatalogStorageKeyV2 = 'agentHost.catalog.v2';
const agentHostCatalogStorageKey = 'agentHost.catalog.v3';
const agentPackageStateStorageKeyV1 = 'agentHost.packages.v1';
const agentPackageStateStorageKeyV2 = 'agentHost.packages.v2';
const agentPackageStateStorageKeyV3 = 'agentHost.packages.v3';
const agentPackageStateStorageKey = 'agentHost.packages.v4';
const legacySessionsStorageKey = 'sessions.providers.default';

const agentHostCatalogFields = [
	'schemaVersion',
	'revision',
	'packageCatalogRevision',
	'hostSequence',
	'channelRevisions',
	'agentDefaults',
	'sessions',
	'backingRemovalOperations',
	'sessionConfigurationFinalizations',
	'completedMigrations',
] as const;

const legacyAgentHostCatalogFields = [
	'schemaVersion',
	'revision',
	'hostSequence',
	'channelRevisions',
	'sessions',
	'completedMigrations',
] as const;

const agentHostCatalogV2Fields = [
	'schemaVersion',
	'revision',
	'packageCatalogRevision',
	'hostSequence',
	'channelRevisions',
	'sessions',
	'backingRemovalOperations',
	'completedMigrations',
] as const;

const agentPackageStateFields = [
	'revision',
	'catalogRevision',
	'operations',
	'installedPackages',
	'activeRegistrations',
	'retainedBackingRecords',
	'materializedBackings',
] as const;

const legacyAgentPackageStateFields = [
	'revision',
	'installedPackages',
	'activeRegistrations',
	'retainedBackingRecords',
	'materializedBackings',
] as const;

const installedAgentPackageFields = [
	'packageId',
	'revision',
	'contentDigest',
	'source',
	'distribution',
	'manifest',
	'dependencyClosure',
	'grantedPrivileges',
] as const;

const agentPackageManifestV3Fields = [
	'schema',
	'packageId',
	'revision',
	'contentDigest',
	'publisher',
	'target',
	'runtimeForm',
	'runtimeEntryPoint',
	'agentIds',
	'dependencies',
	'privileges',
] as const;

const agentPackageManifestFields = [
	'schema',
	'packageId',
	'revision',
	'contentDigest',
	'publisher',
	'target',
	'execution',
	'agentIds',
	'dependencies',
	'privileges',
] as const;

const agentPackageDependencyV3Fields = [
	'id',
	'source',
	'target',
	'digest',
	'license',
] as const;

const verifiedAgentPackageDependencyV3Fields = [
	...agentPackageDependencyV3Fields,
	'verifiedDigest',
	'immutable',
] as const;

const agentRuntimeRegistrationV2Fields = [
	'packageId',
	'agentId',
	'revision',
	'descriptorRevision',
	'capabilityRevision',
	'supportedToolSchemaProfiles',
	'supportedResumeSchemas',
	'resumeMigrationEdges',
] as const;

const agentRuntimeRegistrationFields = [
	...agentRuntimeRegistrationV2Fields,
	'hostDefaultsSchema',
	'initialSessionConfigurationSchema',
	'supportedSessionConfigurationSchemas',
] as const;

const sessionStateV2RequiredFields = [
	'id',
	'packageId',
	'agentId',
	'type',
	'createdAt',
	'title',
	'archived',
	'lifecycle',
	'status',
	'isRead',
	'modifiedAt',
	'capabilities',
	'changes',
	'chats',
] as const;

const sessionStateV2OptionalFields = ['workspace'] as const;

type IAgentHostPersistedSessionRecordV2 = Omit<IAgentHostPersistedSessionRecord, 'state'> & {
	readonly state: Omit<IAgentHostSessionState, 'configuration'>;
};

type IAgentHostCatalogV1 = Omit<
	IAgentHostPersistedCatalog,
	'schemaVersion' | 'packageCatalogRevision' | 'agentDefaults' | 'sessions' | 'backingRemovalOperations'
	| 'sessionConfigurationFinalizations'
> & {
	readonly schemaVersion: 1;
	readonly sessions: readonly IAgentHostPersistedSessionRecordV2[];
};

type IAgentHostCatalogV2 = Omit<
	IAgentHostPersistedCatalog,
	'schemaVersion' | 'agentDefaults' | 'sessions' | 'sessionConfigurationFinalizations'
> & {
	readonly schemaVersion: 1;
	readonly sessions: readonly IAgentHostPersistedSessionRecordV2[];
};

export interface IAgentRuntimeRegistrationV2 {
	readonly packageId: AgentPackageId;
	readonly agentId: AgentId;
	readonly revision: AgentRuntimeRegistrationRevision;
	readonly descriptorRevision: AgentDescriptorRevision;
	readonly capabilityRevision: AgentCapabilityRevision;
	readonly supportedToolSchemaProfiles: readonly AgentToolSchemaProfileId[];
	readonly supportedResumeSchemas: readonly AgentResumeSchemaId[];
	readonly resumeMigrationEdges: IAgentRuntimeRegistration['resumeMigrationEdges'];
}

export interface IAgentHostCatalogV2ConfigurationMigration {
	readonly agentDefaults: readonly IAgentConfigurationState[];
	readonly sessionConfigurations: readonly IAgentConfigurationState[];
}

export interface IAgentPackageV2RegistrationMigration {
	readonly source: IAgentRuntimeRegistrationV2;
	readonly target: IAgentRuntimeRegistration;
}

export interface IAgentPackageV2StorageMigration {
	readonly registrations: readonly IAgentPackageV2RegistrationMigration[];
}

export interface IApplicationStorageAgentPackageStateStoreOptions {
	readonly hostTarget: IAgentPackageTarget;
	readonly registrationMigration?: IAgentPackageV2StorageMigration;
}

type IAgentPackageStateV1 = Omit<
	IAgentPackagePersistedState,
	'catalogRevision' | 'operations' | 'activeRegistrations'
> & {
	readonly activeRegistrations: readonly IAgentRuntimeRegistrationV2[];
};

type IAgentPackageStateV2 = Omit<
	IAgentPackagePersistedState,
	'operations' | 'activeRegistrations'
> & {
	readonly operations: readonly unknown[];
	readonly activeRegistrations: readonly IAgentRuntimeRegistrationV2[];
};

interface IRevisionedState {
	readonly revision: number;
}

function parseStoredState(value: string, key: string): unknown {
	try {
		return JSON.parse(value) as unknown;
	} catch (error) {
		throw new Error(`Invalid JSON in Agent Host storage key '${key}'`, { cause: error });
	}
}

function assertRevisionedState(value: unknown, key: string): asserts value is IRevisionedState {
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
		|| !Number.isSafeInteger((value as { readonly revision?: unknown }).revision)
		|| ((value as { readonly revision: number }).revision < 0)
	) {
		throw new Error(`Invalid revision in Agent Host storage key '${key}'`);
	}
}

function hasExactFields(
	value: unknown,
	fields: readonly string[],
): value is Record<string, unknown> {
	return value !== null
		&& typeof value === 'object'
		&& !Array.isArray(value)
		&& Object.keys(value).length === fields.length
		&& fields.every(field => Object.hasOwn(value, field));
}

function hasArrayFields(
	value: Record<string, unknown>,
	fields: readonly string[],
): boolean {
	return fields.every(field => Array.isArray(value[field]));
}

function hasExactFieldsWithOptional(
	value: unknown,
	required: readonly string[],
	optional: readonly string[],
): value is Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const allowed = new Set([...required, ...optional]);
	return required.every(field => Object.hasOwn(value, field))
		&& Object.keys(value).every(field => allowed.has(field));
}

function assertResumeMigrationEdges(
	edges: unknown,
	key: string,
): asserts edges is IAgentRuntimeRegistration['resumeMigrationEdges'] {
	if (!Array.isArray(edges)) {
		throw new Error(`Invalid runtime registration resume migrations in storage key '${key}'`);
	}
	for (const edge of edges) {
		if (!hasExactFields(edge, ['sourceSchema', 'targetSchema'])) {
			throw new Error(`Invalid runtime registration resume migration in storage key '${key}'`);
		}
		createAgentResumeSchemaId(edge.sourceSchema as string);
		createAgentResumeSchemaId(edge.targetSchema as string);
	}
}

function assertAgentRuntimeRegistrationV2(
	value: unknown,
	key: string,
): asserts value is IAgentRuntimeRegistrationV2 {
	if (
		!hasExactFields(value, agentRuntimeRegistrationV2Fields)
		|| !hasArrayFields(value, [
			'supportedToolSchemaProfiles',
			'supportedResumeSchemas',
			'resumeMigrationEdges',
		])
	) {
		throw new Error(`Invalid v2 runtime registration fields in storage key '${key}'`);
	}
	createAgentPackageId(value.packageId as string);
	createAgentId(value.agentId as string);
	createAgentRuntimeRegistrationRevision(value.revision as string);
	createAgentDescriptorRevision(value.descriptorRevision as string);
	createAgentCapabilityRevision(value.capabilityRevision as string);
	for (const profile of value.supportedToolSchemaProfiles as readonly string[]) {
		createAgentToolSchemaProfileId(profile);
	}
	for (const schema of value.supportedResumeSchemas as readonly string[]) {
		createAgentResumeSchemaId(schema);
	}
	assertResumeMigrationEdges(value.resumeMigrationEdges, key);
}

function assertCurrentAgentRuntimeRegistration(
	value: unknown,
	key: string,
): asserts value is IAgentRuntimeRegistration {
	if (
		!hasExactFields(value, agentRuntimeRegistrationFields)
		|| !hasArrayFields(value, [
			'supportedSessionConfigurationSchemas',
			'supportedToolSchemaProfiles',
			'supportedResumeSchemas',
			'resumeMigrationEdges',
		])
	) {
		throw new Error(`Invalid runtime registration fields in storage key '${key}'`);
	}
	createAgentPackageId(value.packageId as string);
	const agent = createAgentId(value.agentId as string);
	createAgentRuntimeRegistrationRevision(value.revision as string);
	createAgentDescriptorRevision(value.descriptorRevision as string);
	createAgentCapabilityRevision(value.capabilityRevision as string);
	validateAndFreezeAgentConfigurationSchema(value.hostDefaultsSchema, {
		agent,
		scope: 'hostDefault',
	});
	const initialSessionConfigurationSchema = createAgentConfigurationSchemaRevision(
		value.initialSessionConfigurationSchema as string,
	);
	const supportedSessionConfigurationSchemas = (
		value.supportedSessionConfigurationSchemas as readonly string[]
	).map(createAgentConfigurationSchemaRevision);
	if (!supportedSessionConfigurationSchemas.includes(initialSessionConfigurationSchema)) {
		throw new Error(`Runtime registration initial Session configuration is unsupported in storage key '${key}'`);
	}
	for (const profile of value.supportedToolSchemaProfiles as readonly string[]) {
		createAgentToolSchemaProfileId(profile);
	}
	for (const schema of value.supportedResumeSchemas as readonly string[]) {
		createAgentResumeSchemaId(schema);
	}
	assertResumeMigrationEdges(value.resumeMigrationEdges, key);
}

function validateCurrentInstalledAgentPackage(
	value: unknown,
	key: string,
	hostTarget: IAgentPackageTarget,
): IInstalledAgentPackage {
	try {
		return validateAndFreezeInstalledAgentPackage(value, hostTarget);
	} catch (error) {
		throw new Error(`Invalid installed Agent package in storage key '${key}'`, { cause: error });
	}
}

function migrateInstalledAgentPackageV3(
	value: unknown,
	key: string,
	hostTarget: IAgentPackageTarget,
): IInstalledAgentPackage {
	if (
		!hasExactFields(value, installedAgentPackageFields)
		|| !Array.isArray(value.dependencyClosure)
		|| !Array.isArray(value.grantedPrivileges)
	) {
		throw new Error(`Invalid installed Agent package fields in storage key '${key}'`);
	}
	if (hasExactFields(value.manifest, agentPackageManifestFields)) {
		return validateCurrentInstalledAgentPackage(value, key, hostTarget);
	}
	if (!hasExactFields(value.manifest, agentPackageManifestV3Fields)) {
		throw new Error(`Invalid v3 Agent package manifest fields in storage key '${key}'`);
	}
	const manifest = value.manifest;
	if (
		!Array.isArray(manifest.agentIds)
		|| !Array.isArray(manifest.dependencies)
		|| !Array.isArray(manifest.privileges)
		|| (manifest.runtimeForm !== 'embedded' && manifest.runtimeForm !== 'connected')
		|| typeof manifest.runtimeEntryPoint !== 'string'
		|| manifest.runtimeEntryPoint.length === 0
		|| manifest.runtimeEntryPoint.length > 2_048
		|| (manifest.runtimeForm === 'embedded' && value.distribution !== 'bundled')
	) {
		throw new Error(`Invalid v3 Agent package manifest in storage key '${key}'`);
	}
	const runtimeEntryPoint = manifest.runtimeEntryPoint;
	const dependencyTargets = manifest.dependencies.map(dependency => {
		if (
			!hasExactFields(dependency, agentPackageDependencyV3Fields)
			|| typeof dependency.target !== 'string'
		) {
			throw new Error(`Invalid v3 Agent package dependency in storage key '${key}'`);
		}
		return dependency.target;
	});
	if (dependencyTargets.filter(target => target === runtimeEntryPoint).length !== 1) {
		throw new Error(`Invalid v3 Agent package runtime entry point in storage key '${key}'`);
	}
	const executable = (target: unknown): boolean => (
		manifest.runtimeForm === 'connected' && target !== runtimeEntryPoint
	);
	const dependencies = manifest.dependencies.map(dependency => Object.freeze({
		...dependency,
		executable: executable(dependency.target),
	}));
	const dependencyClosure = value.dependencyClosure.map(dependency => {
		if (
			!hasExactFields(dependency, verifiedAgentPackageDependencyV3Fields)
			|| typeof dependency.target !== 'string'
		) {
			throw new Error(`Invalid v3 verified Agent package dependency in storage key '${key}'`);
		}
		return Object.freeze({
			...dependency,
			executable: executable(dependency.target),
		});
	});
	const migrated = {
		...value,
		manifest: {
			schema: manifest.schema,
			packageId: manifest.packageId,
			revision: manifest.revision,
			contentDigest: manifest.contentDigest,
			publisher: manifest.publisher,
			target: manifest.target,
			execution: manifest.runtimeForm === 'embedded'
				? { kind: 'host' as const }
				: { kind: 'connected' as const, entryPoint: runtimeEntryPoint },
			agentIds: manifest.agentIds,
			dependencies,
			privileges: manifest.privileges,
		},
		dependencyClosure,
	};
	return validateCurrentInstalledAgentPackage(migrated, key, hostTarget);
}

function visitActivationTransitionRegistrations(
	operation: unknown,
	key: string,
	visit: (registration: unknown) => IAgentRuntimeRegistration,
	visitInstalledPackage: (installedPackage: unknown) => IInstalledAgentPackage,
): AgentPackagePersistedOperation {
	if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) {
		throw new Error(`Invalid Agent package operation in storage key '${key}'`);
	}
	if (!Object.hasOwn(operation, 'activationTransition')) {
		return operation as AgentPackagePersistedOperation;
	}
	const transition = (operation as { readonly activationTransition?: unknown }).activationTransition;
	if (!hasExactFields(transition, ['previous', 'next'])) {
		throw new Error(`Invalid Agent package activation transition in storage key '${key}'`);
	}
	const migrateSide = (value: unknown): IAgentPackageActivationTransitionSide | null => {
		if (value === null) {
			return null;
		}
		if (!hasExactFields(value, ['installedPackage', 'registrations']) || !Array.isArray(value.registrations)) {
			throw new Error(`Invalid Agent package activation transition side in storage key '${key}'`);
		}
		return {
			installedPackage: visitInstalledPackage(value.installedPackage),
			registrations: value.registrations.map(visit),
		};
	};
	return {
		...operation,
		activationTransition: {
			previous: migrateSide(transition.previous),
			next: migrateSide(transition.next),
		},
	} as AgentPackagePersistedOperation;
}

function migrateAgentPackageOperationV3(
	operation: unknown,
	key: string,
	visitRegistration: (registration: unknown) => IAgentRuntimeRegistration,
	hostTarget: IAgentPackageTarget,
): AgentPackagePersistedOperation {
	if (operation === null || typeof operation !== 'object' || Array.isArray(operation)) {
		throw new Error(`Invalid Agent package operation in storage key '${key}'`);
	}
	if (!Object.hasOwn(operation, 'runtimeTransition')) {
		return visitActivationTransitionRegistrations(
			operation,
			key,
			visitRegistration,
			installedPackage => migrateInstalledAgentPackageV3(installedPackage, key, hostTarget),
		);
	}
	if (Object.hasOwn(operation, 'activationTransition')) {
		throw new Error(`Mixed Agent package transition fields in storage key '${key}'`);
	}
	const transition = (operation as { readonly runtimeTransition?: unknown }).runtimeTransition;
	if (!hasExactFields(transition, ['previous', 'next'])) {
		throw new Error(`Invalid v3 Agent package runtime transition in storage key '${key}'`);
	}
	const migrateSide = (value: unknown): IAgentPackageActivationTransitionSide | null => {
		if (value === null) {
			return null;
		}
		if (!hasExactFields(value, ['installedPackage', 'registrations']) || !Array.isArray(value.registrations)) {
			throw new Error(`Invalid v3 Agent package runtime transition side in storage key '${key}'`);
		}
		return {
			installedPackage: migrateInstalledAgentPackageV3(value.installedPackage, key, hostTarget),
			registrations: value.registrations.map(visitRegistration),
		};
	};
	const phase = (() => {
		switch ((operation as { readonly phase?: unknown }).phase) {
			case 'runtimePrepared': return 'activationPrepared' as const;
			case 'runtimeCommitted': return 'activationCommitted' as const;
			case 'catalogCommitted': return 'catalogCommitted' as const;
			default: throw new Error(`Invalid v3 Agent package runtime transition phase in storage key '${key}'`);
		}
	})();
	const operationFields = Object.fromEntries(Object.entries(operation).filter(([field]) => (
		field !== 'runtimeTransition' && field !== 'phase'
	)));
	return {
		...operationFields,
		phase,
		activationTransition: {
			previous: migrateSide(transition.previous),
			next: migrateSide(transition.next),
		},
	} as AgentPackagePersistedOperation;
}

function assertCurrentAgentPackageState(
	value: unknown,
	key: string,
	hostTarget: IAgentPackageTarget,
): asserts value is IAgentPackagePersistedState {
	assertRevisionedState(value, key);
	try {
		validateAndFreezeAgentPackagePersistedState(value as IAgentPackagePersistedState, hostTarget);
	} catch (error) {
		throw new Error(`Invalid Agent package persisted state in storage key '${key}'`, { cause: error });
	}
}

function sameOrderedValues(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameResumeMigrationEdges(
	left: IAgentRuntimeRegistration['resumeMigrationEdges'],
	right: IAgentRuntimeRegistration['resumeMigrationEdges'],
): boolean {
	return left.length === right.length && left.every((edge, index) => (
		edge.sourceSchema === right[index].sourceSchema
		&& edge.targetSchema === right[index].targetSchema
	));
}

function sameAgentRuntimeRegistrationV2(
	left: IAgentRuntimeRegistrationV2,
	right: IAgentRuntimeRegistrationV2,
): boolean {
	return left.packageId === right.packageId
		&& left.agentId === right.agentId
		&& left.revision === right.revision
		&& left.descriptorRevision === right.descriptorRevision
		&& left.capabilityRevision === right.capabilityRevision
		&& sameOrderedValues(left.supportedToolSchemaProfiles, right.supportedToolSchemaProfiles)
		&& sameOrderedValues(left.supportedResumeSchemas, right.supportedResumeSchemas)
		&& sameResumeMigrationEdges(left.resumeMigrationEdges, right.resumeMigrationEdges);
}

function createRegistrationMigration(
	migration: IAgentPackageV2StorageMigration | undefined,
): (registration: unknown) => IAgentRuntimeRegistration {
	const declarations = migration?.registrations ?? [];
	for (const [index, declaration] of declarations.entries()) {
		assertAgentRuntimeRegistrationV2(declaration.source, agentPackageStateStorageKeyV2);
		assertCurrentAgentRuntimeRegistration(declaration.target, agentPackageStateStorageKey);
		if (
			declarations.slice(0, index).some(candidate => sameAgentRuntimeRegistrationV2(
				candidate.source,
				declaration.source,
			))
			||
			declaration.source.packageId !== declaration.target.packageId
			|| declaration.source.agentId !== declaration.target.agentId
			|| declaration.source.capabilityRevision !== declaration.target.capabilityRevision
			|| declaration.source.revision === declaration.target.revision
			|| declaration.source.descriptorRevision === declaration.target.descriptorRevision
			|| !sameOrderedValues(
				declaration.source.supportedToolSchemaProfiles,
				declaration.target.supportedToolSchemaProfiles,
			)
			|| !sameOrderedValues(
				declaration.source.supportedResumeSchemas,
				declaration.target.supportedResumeSchemas,
			)
			|| !sameResumeMigrationEdges(
				declaration.source.resumeMigrationEdges,
				declaration.target.resumeMigrationEdges,
			)
		) {
			throw new Error('Agent package v2 registration migration does not preserve its exact runtime identity');
		}
	}
	return registration => {
		assertAgentRuntimeRegistrationV2(registration, agentPackageStateStorageKeyV2);
		const declaration = declarations.find(candidate => sameAgentRuntimeRegistrationV2(
			registration,
			candidate.source,
		));
		if (declaration === undefined) {
			throw new Error(
				`Agent package v2 registration migration is not declared for '${registration.packageId}/${registration.agentId}'`,
			);
		}
		return declaration.target;
	};
}

function validateCatalogConfigurationMigration(
	migration: IAgentHostCatalogV2ConfigurationMigration | undefined,
	key: string,
): {
	readonly agentDefaults: readonly IAgentConfigurationState[];
	readonly sessionConfigurations: ReadonlyMap<AgentId, IAgentConfigurationState>;
} {
	if (migration === undefined) {
		throw new Error(`Agent Host catalog migration for storage key '${key}' requires exact configuration state`);
	}
	const agentDefaults = migration.agentDefaults.map(state => validateAndFreezeAgentConfigurationState(state, {
		agent: state.schema.agent,
		scope: 'hostDefault',
	}));
	const defaultAgents = new Set<AgentId>();
	for (const state of agentDefaults) {
		if (defaultAgents.has(state.schema.agent)) {
			throw new Error(`Duplicate Agent-default migration state for '${state.schema.agent}'`);
		}
		defaultAgents.add(state.schema.agent);
	}
	const sessionConfigurations = new Map<AgentId, IAgentConfigurationState>();
	for (const state of migration.sessionConfigurations) {
		const configuration = validateAndFreezeAgentConfigurationState(state, {
			agent: state.schema.agent,
			scope: 'session',
		});
		if (
			!defaultAgents.has(configuration.schema.agent)
			|| sessionConfigurations.has(configuration.schema.agent)
		) {
			throw new Error(`Invalid Session configuration migration state for '${configuration.schema.agent}'`);
		}
		sessionConfigurations.set(configuration.schema.agent, configuration);
	}
	return {
		agentDefaults: Object.freeze(agentDefaults),
		sessionConfigurations,
	};
}

function migrateCatalogSessionRecords(
	records: readonly IAgentHostPersistedSessionRecordV2[],
	configurations: ReadonlyMap<AgentId, IAgentConfigurationState>,
	key: string,
): readonly IAgentHostPersistedSessionRecord[] {
	return Object.freeze(records.map(record => {
		if (
			!hasExactFieldsWithOptional(record, ['state', 'chats'], ['resume'])
			|| !Array.isArray(record.chats)
			|| !hasExactFieldsWithOptional(
				record.state,
				sessionStateV2RequiredFields,
				sessionStateV2OptionalFields,
			)
		) {
			throw new Error(`Invalid v2 Agent Host Session record in storage key '${key}'`);
		}
		const agent = createAgentId(record.state.agentId as string);
		const configuration = configurations.get(agent);
		if (configuration === undefined) {
			throw new Error(`Agent Host catalog migration has no Session configuration for '${agent}'`);
		}
		return Object.freeze({
			state: Object.freeze({
				...record.state,
				configuration,
			}) as IAgentHostSessionState,
			...(record.resume === undefined ? {} : { resume: record.resume }),
			chats: record.chats,
		});
	}));
}

function migrateAgentHostCatalogV1(
	value: unknown,
	migration: IAgentHostCatalogV2ConfigurationMigration | undefined,
): IAgentHostPersistedCatalog {
	assertRevisionedState(value, agentHostCatalogStorageKeyV1);
	const configuration = validateCatalogConfigurationMigration(migration, agentHostCatalogStorageKeyV1);
	if (hasExactFields(value, agentHostCatalogV2Fields)) {
		if (value.schemaVersion !== 1 || !Array.isArray(value.sessions)) {
			throw new Error(`Invalid Agent Host catalog fields in storage key '${agentHostCatalogStorageKeyV1}'`);
		}
		const source = value as unknown as IAgentHostCatalogV2;
		const migrated: IAgentHostPersistedCatalog = {
			schemaVersion: 2,
			revision: source.revision,
			packageCatalogRevision: source.packageCatalogRevision,
			hostSequence: source.hostSequence,
			channelRevisions: source.channelRevisions,
			agentDefaults: configuration.agentDefaults,
			sessions: migrateCatalogSessionRecords(
				source.sessions,
				configuration.sessionConfigurations,
				agentHostCatalogStorageKeyV1,
			),
			backingRemovalOperations: source.backingRemovalOperations,
			sessionConfigurationFinalizations: Object.freeze([]),
			completedMigrations: source.completedMigrations,
		};
		assertAgentHostPersistedCatalog(migrated);
		return migrated;
	}
	if (hasExactFields(value, legacyAgentHostCatalogFields)) {
		if (value.schemaVersion !== 1 || !Array.isArray(value.sessions)) {
			throw new Error(`Invalid Agent Host catalog fields in storage key '${agentHostCatalogStorageKeyV1}'`);
		}
		const source = value as unknown as IAgentHostCatalogV1;
		const migrated: IAgentHostPersistedCatalog = {
			schemaVersion: 2,
			revision: source.revision,
			packageCatalogRevision: 0,
			hostSequence: source.hostSequence,
			channelRevisions: source.channelRevisions,
			agentDefaults: configuration.agentDefaults,
			sessions: migrateCatalogSessionRecords(
				source.sessions,
				configuration.sessionConfigurations,
				agentHostCatalogStorageKeyV1,
			),
			backingRemovalOperations: Object.freeze([]),
			sessionConfigurationFinalizations: Object.freeze([]),
			completedMigrations: source.completedMigrations,
		};
		assertAgentHostPersistedCatalog(migrated);
		return migrated;
	}
	throw new Error(`Invalid Agent Host catalog fields in storage key '${agentHostCatalogStorageKeyV1}'`);
}

function migrateAgentHostCatalogV2(
	value: unknown,
	migration: IAgentHostCatalogV2ConfigurationMigration | undefined,
): IAgentHostPersistedCatalog {
	assertRevisionedState(value, agentHostCatalogStorageKeyV2);
	if (
		!hasExactFields(value, agentHostCatalogV2Fields)
		|| value.schemaVersion !== 1
		|| !Array.isArray(value.sessions)
	) {
		throw new Error(`Invalid Agent Host catalog fields in storage key '${agentHostCatalogStorageKeyV2}'`);
	}
	const source = value as unknown as IAgentHostCatalogV2;
	const configuration = validateCatalogConfigurationMigration(migration, agentHostCatalogStorageKeyV2);
	const migrated: IAgentHostPersistedCatalog = {
		schemaVersion: 2,
		revision: source.revision,
		packageCatalogRevision: source.packageCatalogRevision,
		hostSequence: source.hostSequence,
		channelRevisions: source.channelRevisions,
		agentDefaults: configuration.agentDefaults,
		sessions: migrateCatalogSessionRecords(
			source.sessions,
			configuration.sessionConfigurations,
			agentHostCatalogStorageKeyV2,
		),
		backingRemovalOperations: source.backingRemovalOperations,
		sessionConfigurationFinalizations: Object.freeze([]),
		completedMigrations: source.completedMigrations,
	};
	assertAgentHostPersistedCatalog(migrated);
	return migrated;
}

function migrateAgentPackageStateV1(
	value: unknown,
	migration: IAgentPackageV2StorageMigration | undefined,
	hostTarget: IAgentPackageTarget,
): IAgentPackagePersistedState {
	assertRevisionedState(value, agentPackageStateStorageKeyV1);
	const migrateRegistration = createRegistrationMigration(migration);
	if (hasExactFields(value, agentPackageStateFields)) {
		if (!hasArrayFields(value, [
			'operations',
			'installedPackages',
			'activeRegistrations',
			'retainedBackingRecords',
			'materializedBackings',
		])) {
			throw new Error(`Invalid Agent package persisted state fields in storage key '${agentPackageStateStorageKeyV1}'`);
		}
		const source = value as unknown as IAgentPackageStateV2;
		const migrated: IAgentPackagePersistedState = {
			revision: source.revision,
			catalogRevision: source.catalogRevision,
			operations: Object.freeze(source.operations.map(operation => (
				migrateAgentPackageOperationV3(operation, agentPackageStateStorageKeyV1, migrateRegistration, hostTarget)
			))),
			installedPackages: Object.freeze(source.installedPackages.map(installedPackage => (
				migrateInstalledAgentPackageV3(installedPackage, agentPackageStateStorageKeyV1, hostTarget)
			))),
			activeRegistrations: Object.freeze(source.activeRegistrations.map(migrateRegistration)),
			retainedBackingRecords: source.retainedBackingRecords,
			materializedBackings: source.materializedBackings,
		};
		assertCurrentAgentPackageState(migrated, agentPackageStateStorageKey, hostTarget);
		return migrated;
	}
	if (hasExactFields(value, legacyAgentPackageStateFields)) {
		if (!hasArrayFields(value, [
			'installedPackages',
			'activeRegistrations',
			'retainedBackingRecords',
			'materializedBackings',
		])) {
			throw new Error(`Invalid Agent package persisted state fields in storage key '${agentPackageStateStorageKeyV1}'`);
		}
		const source = value as unknown as IAgentPackageStateV1;
		const migrated: IAgentPackagePersistedState = {
			revision: source.revision,
			catalogRevision: source.revision,
			operations: Object.freeze([]),
			installedPackages: Object.freeze(source.installedPackages.map(installedPackage => (
				migrateInstalledAgentPackageV3(installedPackage, agentPackageStateStorageKeyV1, hostTarget)
			))),
			activeRegistrations: Object.freeze(source.activeRegistrations.map(migrateRegistration)),
			retainedBackingRecords: source.retainedBackingRecords,
			materializedBackings: source.materializedBackings,
		};
		assertCurrentAgentPackageState(migrated, agentPackageStateStorageKey, hostTarget);
		return migrated;
	}
	throw new Error(`Invalid Agent package persisted state fields in storage key '${agentPackageStateStorageKeyV1}'`);
}

function migrateAgentPackageStateV2(
	value: unknown,
	migration: IAgentPackageV2StorageMigration | undefined,
	hostTarget: IAgentPackageTarget,
): IAgentPackagePersistedState {
	assertRevisionedState(value, agentPackageStateStorageKeyV2);
	if (
		!hasExactFields(value, agentPackageStateFields)
		|| !hasArrayFields(value, [
			'operations',
			'installedPackages',
			'activeRegistrations',
			'retainedBackingRecords',
			'materializedBackings',
		])
	) {
		throw new Error(`Invalid Agent package persisted state fields in storage key '${agentPackageStateStorageKeyV2}'`);
	}
	const source = value as unknown as IAgentPackageStateV2;
	const migrateRegistration = createRegistrationMigration(migration);
	const migrated: IAgentPackagePersistedState = {
		revision: source.revision,
		catalogRevision: source.catalogRevision,
		operations: Object.freeze(source.operations.map(operation => (
			migrateAgentPackageOperationV3(operation, agentPackageStateStorageKeyV2, migrateRegistration, hostTarget)
		))),
		installedPackages: Object.freeze(source.installedPackages.map(installedPackage => (
			migrateInstalledAgentPackageV3(installedPackage, agentPackageStateStorageKeyV2, hostTarget)
		))),
		activeRegistrations: Object.freeze(source.activeRegistrations.map(migrateRegistration)),
		retainedBackingRecords: source.retainedBackingRecords,
		materializedBackings: source.materializedBackings,
	};
	assertCurrentAgentPackageState(migrated, agentPackageStateStorageKey, hostTarget);
	return migrated;
}

function migrateAgentPackageStateV3(
	value: unknown,
	hostTarget: IAgentPackageTarget,
): IAgentPackagePersistedState {
	assertRevisionedState(value, agentPackageStateStorageKeyV3);
	if (
		!hasExactFields(value, agentPackageStateFields)
		|| !hasArrayFields(value, [
			'operations',
			'installedPackages',
			'activeRegistrations',
			'retainedBackingRecords',
			'materializedBackings',
		])
	) {
		throw new Error(`Invalid Agent package persisted state fields in storage key '${agentPackageStateStorageKeyV3}'`);
	}
	const source = value as unknown as IAgentPackagePersistedState;
	const validateRegistration = (registration: unknown): IAgentRuntimeRegistration => {
		assertCurrentAgentRuntimeRegistration(registration, agentPackageStateStorageKeyV3);
		return registration;
	};
	const migrated: IAgentPackagePersistedState = {
		revision: source.revision,
		catalogRevision: source.catalogRevision,
		operations: Object.freeze(source.operations.map(operation => (
			migrateAgentPackageOperationV3(operation, agentPackageStateStorageKeyV3, validateRegistration, hostTarget)
		))),
		installedPackages: Object.freeze(source.installedPackages.map(installedPackage => (
			migrateInstalledAgentPackageV3(installedPackage, agentPackageStateStorageKeyV3, hostTarget)
		))),
		activeRegistrations: Object.freeze(source.activeRegistrations.map(validateRegistration)),
		retainedBackingRecords: source.retainedBackingRecords,
		materializedBackings: source.materializedBackings,
	};
	assertCurrentAgentPackageState(migrated, agentPackageStateStorageKey, hostTarget);
	return migrated;
}

async function migrateAgentHostCatalog(
	storage: IStorage,
	migration: IAgentHostCatalogV2ConfigurationMigration | undefined,
): Promise<void> {
	const currentSerialized = storage.get(agentHostCatalogStorageKey);
	if (currentSerialized !== undefined) {
		const current = parseStoredState(currentSerialized, agentHostCatalogStorageKey);
		if (!hasExactFields(current, agentHostCatalogFields)) {
			throw new Error(`Invalid Agent Host catalog fields in storage key '${agentHostCatalogStorageKey}'`);
		}
		assertAgentHostPersistedCatalog(current as unknown as IAgentHostPersistedCatalog);
		await storage.delete(agentHostCatalogStorageKeyV2);
		await storage.delete(agentHostCatalogStorageKeyV1);
		return;
	}

	const v2Serialized = storage.get(agentHostCatalogStorageKeyV2);
	if (v2Serialized !== undefined) {
		const migrated = migrateAgentHostCatalogV2(
			parseStoredState(v2Serialized, agentHostCatalogStorageKeyV2),
			migration,
		);
		await storage.set(agentHostCatalogStorageKey, migrated);
		await storage.delete(agentHostCatalogStorageKeyV2);
		await storage.delete(agentHostCatalogStorageKeyV1);
		return;
	}

	const v1Serialized = storage.get(agentHostCatalogStorageKeyV1);
	if (v1Serialized === undefined) {
		return;
	}
	const migrated = migrateAgentHostCatalogV1(
		parseStoredState(v1Serialized, agentHostCatalogStorageKeyV1),
		migration,
	);
	await storage.set(agentHostCatalogStorageKey, migrated);
	await storage.delete(agentHostCatalogStorageKeyV1);
}

async function migrateAgentPackageState(
	storage: IStorage,
	options: IApplicationStorageAgentPackageStateStoreOptions,
): Promise<void> {
	const currentSerialized = storage.get(agentPackageStateStorageKey);
	if (currentSerialized !== undefined) {
		assertCurrentAgentPackageState(
			parseStoredState(currentSerialized, agentPackageStateStorageKey),
			agentPackageStateStorageKey,
			options.hostTarget,
		);
		await storage.delete(agentPackageStateStorageKeyV3);
		await storage.delete(agentPackageStateStorageKeyV2);
		await storage.delete(agentPackageStateStorageKeyV1);
		return;
	}

	const v3Serialized = storage.get(agentPackageStateStorageKeyV3);
	if (v3Serialized !== undefined) {
		const migrated = migrateAgentPackageStateV3(
			parseStoredState(v3Serialized, agentPackageStateStorageKeyV3),
			options.hostTarget,
		);
		await storage.set(agentPackageStateStorageKey, migrated);
		await storage.delete(agentPackageStateStorageKeyV3);
		await storage.delete(agentPackageStateStorageKeyV2);
		await storage.delete(agentPackageStateStorageKeyV1);
		return;
	}

	const v2Serialized = storage.get(agentPackageStateStorageKeyV2);
	if (v2Serialized !== undefined) {
		const migrated = migrateAgentPackageStateV2(
			parseStoredState(v2Serialized, agentPackageStateStorageKeyV2),
			options.registrationMigration,
			options.hostTarget,
		);
		await storage.set(agentPackageStateStorageKey, migrated);
		await storage.delete(agentPackageStateStorageKeyV3);
		await storage.delete(agentPackageStateStorageKeyV2);
		await storage.delete(agentPackageStateStorageKeyV1);
		return;
	}

	const v1Serialized = storage.get(agentPackageStateStorageKeyV1);
	if (v1Serialized === undefined) {
		return;
	}
	const migrated = migrateAgentPackageStateV1(
		parseStoredState(v1Serialized, agentPackageStateStorageKeyV1),
		options.registrationMigration,
		options.hostTarget,
	);
	await storage.set(agentPackageStateStorageKey, migrated);
	await storage.delete(agentPackageStateStorageKeyV3);
	await storage.delete(agentPackageStateStorageKeyV1);
}

abstract class RevisionedAgentHostStateStore<TState extends IRevisionedState> {
	private commitTail = Promise.resolve();

	protected constructor(
		private readonly storage: IStorage,
		private readonly key: string,
	) { }

	protected readStoredState(): TState | undefined {
		const serialized = this.storage.get(this.key);
		if (serialized === undefined) {
			return undefined;
		}
		const state = parseStoredState(serialized, this.key);
		assertRevisionedState(state, this.key);
		this.validate(state);
		return state as TState;
	}

	protected abstract validate(value: unknown): void;

	async read(): Promise<TState | undefined> {
		await this.commitTail;
		return this.readStoredState();
	}

	commit(expectedRevision: number | undefined, state: TState): Promise<void> {
		const commit = this.commitTail.then(async () => {
			assertRevisionedState(state, this.key);
			this.validate(state);
			const existing = this.readStoredState();
			if (existing?.revision !== expectedRevision) {
				throw new Error(
					`Agent Host storage revision conflict for '${this.key}': expected ${expectedRevision ?? 'absent'}, found ${existing?.revision ?? 'absent'}`,
				);
			}
			const nextRevision = expectedRevision === undefined ? 0 : expectedRevision + 1;
			if (state.revision !== nextRevision) {
				throw new Error(
					`Agent Host storage key '${this.key}' requires revision ${nextRevision}, received ${state.revision}`,
				);
			}
			await this.storage.set(this.key, JSON.stringify(state));
		});
		this.commitTail = commit.catch(() => undefined);
		return commit;
	}
}

export class ApplicationStorageAgentHostCatalogStore
	extends RevisionedAgentHostStateStore<IAgentHostPersistedCatalog>
	implements IAgentHostCatalogStore {
	private migration: Promise<void> | undefined;

	constructor(
		private readonly catalogStorage: IStorage,
		private readonly configurationMigration?: IAgentHostCatalogV2ConfigurationMigration,
	) {
		super(catalogStorage, agentHostCatalogStorageKey);
	}

	private ensureMigrated(): Promise<void> {
		this.migration ??= migrateAgentHostCatalog(this.catalogStorage, this.configurationMigration);
		return this.migration;
	}

	override async read(): Promise<IAgentHostPersistedCatalog | undefined> {
		await this.ensureMigrated();
		return super.read();
	}

	override async commit(
		expectedRevision: number | undefined,
		state: IAgentHostPersistedCatalog,
	): Promise<void> {
		await this.ensureMigrated();
		await super.commit(expectedRevision, state);
	}

	protected validate(value: unknown): void {
		if (!hasExactFields(value, agentHostCatalogFields)) {
			throw new Error(`Invalid Agent Host catalog fields in storage key '${agentHostCatalogStorageKey}'`);
		}
		assertAgentHostPersistedCatalog(value as unknown as IAgentHostPersistedCatalog);
	}
}

export class ApplicationStorageAgentPackageStateStore
	extends RevisionedAgentHostStateStore<IAgentPackagePersistedState>
	implements IAgentPackageStateStore {
	private migration: Promise<void> | undefined;

	constructor(
		private readonly packageStorage: IStorage,
		private readonly options: IApplicationStorageAgentPackageStateStoreOptions,
	) {
		super(packageStorage, agentPackageStateStorageKey);
	}

	private ensureMigrated(): Promise<void> {
		this.migration ??= migrateAgentPackageState(this.packageStorage, this.options);
		return this.migration;
	}

	override async read(): Promise<IAgentPackagePersistedState | undefined> {
		await this.ensureMigrated();
		return super.read();
	}

	override async commit(
		expectedRevision: number | undefined,
		state: IAgentPackagePersistedState,
	): Promise<void> {
		await this.ensureMigrated();
		await super.commit(expectedRevision, state);
	}

	protected validate(value: unknown): void {
		assertCurrentAgentPackageState(value, agentPackageStateStorageKey, this.options.hostTarget);
	}
}

export class ApplicationStorageLegacyAgentHostCatalogSource
	implements IAgentHostLegacyCatalogSource {

	constructor(private readonly storage: IStorage) { }

	async read(key: typeof legacySessionsStorageKey): Promise<string | undefined> {
		if (key !== legacySessionsStorageKey) {
			throw new Error(`Unsupported legacy Agent Host storage key '${key}'`);
		}
		return this.storage.get(key);
	}

	async delete(key: typeof legacySessionsStorageKey): Promise<void> {
		if (key !== legacySessionsStorageKey) {
			throw new Error(`Unsupported legacy Agent Host storage key '${key}'`);
		}
		await this.storage.delete(key);
	}
}
