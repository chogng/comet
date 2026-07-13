/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IStorage } from 'cs/base/parts/storage/common/storage';
import type { IAgentPackagePersistedState } from 'cs/platform/agentHost/common/packages';
import {
	assertAgentHostPersistedCatalog,
	type IAgentHostCatalogStore,
	type IAgentHostLegacyCatalogSource,
	type IAgentHostPersistedCatalog,
} from 'cs/platform/agentHost/node/host/agentHostCatalog.js';
import type {
	IAgentPackageStateStore,
} from 'cs/platform/agentHost/node/packages/agentPackageLifecycle.js';

const legacyAgentHostCatalogStorageKey = 'agentHost.catalog.v1';
const agentHostCatalogStorageKey = 'agentHost.catalog.v2';
const legacyAgentPackageStateStorageKey = 'agentHost.packages.v1';
const agentPackageStateStorageKey = 'agentHost.packages.v2';
const legacySessionsStorageKey = 'sessions.providers.default';

const agentHostCatalogFields = [
	'schemaVersion',
	'revision',
	'packageCatalogRevision',
	'hostSequence',
	'channelRevisions',
	'sessions',
	'backingRemovalOperations',
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

type ILegacyAgentPackagePersistedState = Omit<
	IAgentPackagePersistedState,
	'catalogRevision' | 'operations'
>;

type ILegacyAgentHostPersistedCatalog = Omit<
	IAgentHostPersistedCatalog,
	'packageCatalogRevision' | 'backingRemovalOperations'
>;

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
}

function migrateLegacyAgentPackageState(value: unknown): IAgentPackagePersistedState {
	assertRevisionedState(value, legacyAgentPackageStateStorageKey);
	if (hasExactFields(value, agentPackageStateFields)) {
		assertCurrentAgentPackageState(value, legacyAgentPackageStateStorageKey);
		return value;
	}
	if (
		!hasExactFields(value, legacyAgentPackageStateFields)
		|| !hasArrayFields(value, [
			'installedPackages',
			'activeRegistrations',
			'retainedBackingRecords',
			'materializedBackings',
		])
	) {
		throw new Error(
			`Invalid Agent package persisted state fields in storage key '${legacyAgentPackageStateStorageKey}'`,
		);
	}

	const legacyState = value as ILegacyAgentPackagePersistedState;
	return {
		revision: legacyState.revision,
		catalogRevision: legacyState.revision,
		operations: [],
		installedPackages: legacyState.installedPackages,
		activeRegistrations: legacyState.activeRegistrations,
		retainedBackingRecords: legacyState.retainedBackingRecords,
		materializedBackings: legacyState.materializedBackings,
	};
}

function migrateLegacyAgentHostCatalog(value: unknown): IAgentHostPersistedCatalog {
	assertRevisionedState(value, legacyAgentHostCatalogStorageKey);
	if (hasExactFields(value, agentHostCatalogFields)) {
		assertAgentHostPersistedCatalog(value as unknown as IAgentHostPersistedCatalog);
		return value as unknown as IAgentHostPersistedCatalog;
	}
	if (!hasExactFields(value, legacyAgentHostCatalogFields)) {
		throw new Error(
			`Invalid Agent Host catalog fields in storage key '${legacyAgentHostCatalogStorageKey}'`,
		);
	}

	const legacyCatalog = value as unknown as ILegacyAgentHostPersistedCatalog;
	const migratedCatalog: IAgentHostPersistedCatalog = {
		schemaVersion: legacyCatalog.schemaVersion,
		revision: legacyCatalog.revision,
		packageCatalogRevision: 0,
		hostSequence: legacyCatalog.hostSequence,
		channelRevisions: legacyCatalog.channelRevisions,
		sessions: legacyCatalog.sessions,
		backingRemovalOperations: [],
		completedMigrations: legacyCatalog.completedMigrations,
	};
	assertAgentHostPersistedCatalog(migratedCatalog);
	return migratedCatalog;
}

async function migrateAgentHostCatalog(storage: IStorage): Promise<void> {
	const currentSerialized = storage.get(agentHostCatalogStorageKey);
	if (currentSerialized !== undefined) {
		const current = parseStoredState(currentSerialized, agentHostCatalogStorageKey);
		if (!hasExactFields(current, agentHostCatalogFields)) {
			throw new Error(`Invalid Agent Host catalog fields in storage key '${agentHostCatalogStorageKey}'`);
		}
		assertAgentHostPersistedCatalog(current as unknown as IAgentHostPersistedCatalog);
		await storage.delete(legacyAgentHostCatalogStorageKey);
		return;
	}

	const legacySerialized = storage.get(legacyAgentHostCatalogStorageKey);
	if (legacySerialized === undefined) {
		return;
	}
	const migratedCatalog = migrateLegacyAgentHostCatalog(
		parseStoredState(legacySerialized, legacyAgentHostCatalogStorageKey),
	);
	await storage.set(agentHostCatalogStorageKey, migratedCatalog);
	await storage.delete(legacyAgentHostCatalogStorageKey);
}

async function migrateAgentPackageState(storage: IStorage): Promise<void> {
	const currentSerialized = storage.get(agentPackageStateStorageKey);
	if (currentSerialized !== undefined) {
		assertCurrentAgentPackageState(
			parseStoredState(currentSerialized, agentPackageStateStorageKey),
			agentPackageStateStorageKey,
		);
		await storage.delete(legacyAgentPackageStateStorageKey);
		return;
	}

	const legacySerialized = storage.get(legacyAgentPackageStateStorageKey);
	if (legacySerialized === undefined) {
		return;
	}
	const migratedState = migrateLegacyAgentPackageState(
		parseStoredState(legacySerialized, legacyAgentPackageStateStorageKey),
	);
	await storage.set(agentPackageStateStorageKey, migratedState);
	await storage.delete(legacyAgentPackageStateStorageKey);
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

	constructor(private readonly catalogStorage: IStorage) {
		super(catalogStorage, agentHostCatalogStorageKey);
	}

	private ensureMigrated(): Promise<void> {
		this.migration ??= migrateAgentHostCatalog(this.catalogStorage);
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

	constructor(private readonly packageStorage: IStorage) {
		super(packageStorage, agentPackageStateStorageKey);
	}

	private ensureMigrated(): Promise<void> {
		this.migration ??= migrateAgentPackageState(this.packageStorage);
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
