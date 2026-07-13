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

const agentHostCatalogStorageKey = 'agentHost.catalog.v1';
const agentPackageStateStorageKey = 'agentHost.packages.v1';
const legacySessionsStorageKey = 'sessions.providers.default';

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

	constructor(storage: IStorage) {
		super(storage, agentHostCatalogStorageKey);
	}

	protected validate(value: unknown): void {
		assertAgentHostPersistedCatalog(value as IAgentHostPersistedCatalog);
	}
}

export class ApplicationStorageAgentPackageStateStore
	extends RevisionedAgentHostStateStore<IAgentPackagePersistedState>
	implements IAgentPackageStateStore {

	constructor(storage: IStorage) {
		super(storage, agentPackageStateStorageKey);
	}

	protected validate(value: unknown): void {
		assertRevisionedState(value, agentPackageStateStorageKey);
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
