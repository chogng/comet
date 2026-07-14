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
} from 'cs/platform/agentHost/common/packages';
import type { IAgentHostSessionState } from 'cs/platform/agentHost/common/protocol';
import {
	assertAgentHostPersistedCatalog,
	type IAgentHostCatalogStore,
	type IAgentHostLegacyCatalogSource,
	type IAgentHostPersistedCatalog,
	type IAgentHostPersistedSessionRecord,
} from 'cs/platform/agentHost/node/host/agentHostCatalog.js';
import type {
	IAgentPackageStateStore,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle.js';

const agentHostCatalogStorageKeyV1 = 'agentHost.catalog.v1';
const agentHostCatalogStorageKeyV2 = 'agentHost.catalog.v2';
const agentHostCatalogStorageKey = 'agentHost.catalog.v3';
const agentPackageStateStorageKeyV1 = 'agentHost.packages.v1';
const agentPackageStateStorageKeyV2 = 'agentHost.packages.v2';
const agentPackageStateStorageKey = 'agentHost.packages.v3';
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

function visitRuntimeTransitionRegistrations(
	operation: unknown,
	key: string,
	visit: (registration: unknown) => IAgentRuntimeRegistration,
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
			installedPackage: value.installedPackage as IAgentPackageActivationTransitionSide['installedPackage'],
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

function assertCurrentAgentPackageState(
	value: unknown,
	key: string,
): asserts value is IAgentPackagePersistedState {
	assertRevisionedState(value, key);
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
		throw new Error(`Invalid Agent package persisted state fields in storage key '${key}'`);
	}
	const state = value as unknown as IAgentPackagePersistedState;
	for (const registration of state.activeRegistrations) {
		assertCurrentAgentRuntimeRegistration(registration, key);
	}
	for (const operation of state.operations) {
		visitRuntimeTransitionRegistrations(operation, key, registration => {
			assertCurrentAgentRuntimeRegistration(registration, key);
			return registration;
		});
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
				visitRuntimeTransitionRegistrations(operation, agentPackageStateStorageKeyV1, migrateRegistration)
			))),
			installedPackages: source.installedPackages,
			activeRegistrations: Object.freeze(source.activeRegistrations.map(migrateRegistration)),
			retainedBackingRecords: source.retainedBackingRecords,
			materializedBackings: source.materializedBackings,
		};
		assertCurrentAgentPackageState(migrated, agentPackageStateStorageKey);
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
			installedPackages: source.installedPackages,
			activeRegistrations: Object.freeze(source.activeRegistrations.map(migrateRegistration)),
			retainedBackingRecords: source.retainedBackingRecords,
			materializedBackings: source.materializedBackings,
		};
		assertCurrentAgentPackageState(migrated, agentPackageStateStorageKey);
		return migrated;
	}
	throw new Error(`Invalid Agent package persisted state fields in storage key '${agentPackageStateStorageKeyV1}'`);
}

function migrateAgentPackageStateV2(
	value: unknown,
	migration: IAgentPackageV2StorageMigration | undefined,
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
			visitRuntimeTransitionRegistrations(operation, agentPackageStateStorageKeyV2, migrateRegistration)
		))),
		installedPackages: source.installedPackages,
		activeRegistrations: Object.freeze(source.activeRegistrations.map(migrateRegistration)),
		retainedBackingRecords: source.retainedBackingRecords,
		materializedBackings: source.materializedBackings,
	};
	assertCurrentAgentPackageState(migrated, agentPackageStateStorageKey);
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
	migration: IAgentPackageV2StorageMigration | undefined,
): Promise<void> {
	const currentSerialized = storage.get(agentPackageStateStorageKey);
	if (currentSerialized !== undefined) {
		assertCurrentAgentPackageState(
			parseStoredState(currentSerialized, agentPackageStateStorageKey),
			agentPackageStateStorageKey,
		);
		await storage.delete(agentPackageStateStorageKeyV2);
		await storage.delete(agentPackageStateStorageKeyV1);
		return;
	}

	const v2Serialized = storage.get(agentPackageStateStorageKeyV2);
	if (v2Serialized !== undefined) {
		const migrated = migrateAgentPackageStateV2(
			parseStoredState(v2Serialized, agentPackageStateStorageKeyV2),
			migration,
		);
		await storage.set(agentPackageStateStorageKey, migrated);
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
		migration,
	);
	await storage.set(agentPackageStateStorageKey, migrated);
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
		private readonly registrationMigration?: IAgentPackageV2StorageMigration,
	) {
		super(packageStorage, agentPackageStateStorageKey);
	}

	private ensureMigrated(): Promise<void> {
		this.migration ??= migrateAgentPackageState(this.packageStorage, this.registrationMigration);
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
		assertCurrentAgentPackageState(value, agentPackageStateStorageKey);
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
