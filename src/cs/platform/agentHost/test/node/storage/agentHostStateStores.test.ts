/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import type { IAgentPackagePersistedState } from 'cs/platform/agentHost/common/packages';
import { createEmptyAgentHostCatalog } from 'cs/platform/agentHost/node/host/agentHostCatalog.js';
import {
	ApplicationStorageAgentHostCatalogStore,
	ApplicationStorageAgentPackageStateStore,
	ApplicationStorageLegacyAgentHostCatalogSource,
} from 'cs/platform/agentHost/node/storage/agentHostStateStores';

const legacyAgentHostCatalogStorageKey = 'agentHost.catalog.v1';
const agentHostCatalogStorageKey = 'agentHost.catalog.v2';
const legacyAgentPackageStateStorageKey = 'agentHost.packages.v1';
const agentPackageStateStorageKey = 'agentHost.packages.v2';

async function createStorage(): Promise<Storage> {
	const storage = new Storage(new InMemoryStorageDatabase());
	await storage.init();
	return storage;
}

function createPackageState(revision: number): IAgentPackagePersistedState {
	return {
		revision,
		catalogRevision: revision,
		operations: [],
		installedPackages: [],
		activeRegistrations: [],
		retainedBackingRecords: [],
		materializedBackings: [],
	};
}

function createLegacyPackageState(revision: number) {
	return {
		revision,
		installedPackages: [],
		activeRegistrations: [],
		retainedBackingRecords: [],
		materializedBackings: [],
	};
}

function createLegacyAgentHostCatalog(revision: number) {
	const current = createEmptyAgentHostCatalog();
	return {
		schemaVersion: current.schemaVersion,
		revision,
		hostSequence: current.hostSequence,
		channelRevisions: current.channelRevisions,
		sessions: current.sessions,
		completedMigrations: current.completedMigrations,
	};
}

suite('Agent Host application storage', () => {
	test('catalog commits require exact monotonic revisions', async () => {
		const storage = await createStorage();
		try {
			const store = new ApplicationStorageAgentHostCatalogStore(storage);
			const initial = createEmptyAgentHostCatalog();
			await store.commit(undefined, initial);
			assert.deepEqual(await store.read(), initial);

			const next = { ...initial, revision: 1 };
			await store.commit(0, next);
			assert.deepEqual(await store.read(), next);

			await assert.rejects(
				store.commit(0, { ...next, revision: 1 }),
				/storage revision conflict/,
			);
			await assert.rejects(
				store.commit(1, { ...next, revision: 3 }),
				/requires revision 2/,
			);
		} finally {
			storage.dispose();
		}
	});

	test('migrates the exact pre-package-ledger catalog to v2 before continuing its CAS revision', async () => {
		const storage = await createStorage();
		try {
			const legacyCatalog = createLegacyAgentHostCatalog(4);
			await storage.set(legacyAgentHostCatalogStorageKey, JSON.stringify(legacyCatalog));
			const store = new ApplicationStorageAgentHostCatalogStore(storage);
			const expected = {
				...legacyCatalog,
				packageCatalogRevision: 0,
				backingRemovalOperations: [],
			};

			assert.deepEqual(await store.read(), expected);
			assert.equal(storage.get(legacyAgentHostCatalogStorageKey), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentHostCatalogStorageKey)!), expected);

			await store.commit(4, { ...expected, revision: 5 });
			assert.equal((await store.read())?.revision, 5);
		} finally {
			storage.dispose();
		}
	});

	test('keeps a current v2 catalog authoritative when stale v1 cleanup was interrupted', async () => {
		const storage = await createStorage();
		try {
			const stale = createLegacyAgentHostCatalog(3);
			const current = { ...createEmptyAgentHostCatalog(), revision: 8, packageCatalogRevision: 6 };
			await storage.set(legacyAgentHostCatalogStorageKey, JSON.stringify(stale));
			await storage.set(agentHostCatalogStorageKey, JSON.stringify(current));

			assert.deepEqual(await new ApplicationStorageAgentHostCatalogStore(storage).read(), current);
			assert.equal(storage.get(legacyAgentHostCatalogStorageKey), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('rejects a malformed v1 catalog without writing v2 or deleting the source', async () => {
		const storage = await createStorage();
		try {
			const invalid = { ...createLegacyAgentHostCatalog(2), unexpected: true };
			await storage.set(legacyAgentHostCatalogStorageKey, JSON.stringify(invalid));

			await assert.rejects(
				new ApplicationStorageAgentHostCatalogStore(storage).read(),
				/Invalid Agent Host catalog fields/,
			);
			assert.equal(storage.get(legacyAgentHostCatalogStorageKey), JSON.stringify(invalid));
			assert.equal(storage.get(agentHostCatalogStorageKey), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('concurrent package commits have one exact winner', async () => {
		const storage = await createStorage();
		try {
			const store = new ApplicationStorageAgentPackageStateStore(storage);
			await store.commit(undefined, createPackageState(0));
			const results = await Promise.allSettled([
				store.commit(0, createPackageState(1)),
				store.commit(0, createPackageState(1)),
			]);
			assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected']);
			assert.equal((await store.read())?.revision, 1);
		} finally {
			storage.dispose();
		}
	});

	test('migrates the exact pre-ledger package state to v2 before continuing its CAS revision', async () => {
		const storage = await createStorage();
		try {
			const legacyState = createLegacyPackageState(4);
			await storage.set(legacyAgentPackageStateStorageKey, JSON.stringify(legacyState));
			const store = new ApplicationStorageAgentPackageStateStore(storage);
			const expected = {
				...legacyState,
				catalogRevision: 4,
				operations: [],
			};

			assert.deepEqual(await store.read(), expected);
			assert.equal(storage.get(legacyAgentPackageStateStorageKey), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentPackageStateStorageKey)!), expected);

			await store.commit(4, createPackageState(5));
			assert.equal((await store.read())?.revision, 5);
		} finally {
			storage.dispose();
		}
	});

	test('moves an already ledger-shaped v1 state without rewriting its revisions', async () => {
		const storage = await createStorage();
		try {
			const state = {
				...createPackageState(8),
				catalogRevision: 5,
			};
			await storage.set(legacyAgentPackageStateStorageKey, JSON.stringify(state));

			assert.deepEqual(await new ApplicationStorageAgentPackageStateStore(storage).read(), state);
			assert.equal(storage.get(legacyAgentPackageStateStorageKey), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentPackageStateStorageKey)!), state);
		} finally {
			storage.dispose();
		}
	});

	test('keeps v2 authoritative and only removes a stale v1 source after an interrupted cleanup', async () => {
		const storage = await createStorage();
		try {
			const stale = createLegacyPackageState(3);
			const current = {
				...createPackageState(9),
				catalogRevision: 7,
			};
			await storage.set(legacyAgentPackageStateStorageKey, JSON.stringify(stale));
			await storage.set(agentPackageStateStorageKey, JSON.stringify(current));

			assert.deepEqual(await new ApplicationStorageAgentPackageStateStore(storage).read(), current);
			assert.equal(storage.get(legacyAgentPackageStateStorageKey), undefined);
			assert.deepEqual(JSON.parse(storage.get(agentPackageStateStorageKey)!), current);
		} finally {
			storage.dispose();
		}
	});

	test('rejects a malformed v1 source without writing v2 or deleting the source', async () => {
		const storage = await createStorage();
		try {
			const invalid = {
				...createLegacyPackageState(2),
				unexpected: true,
			};
			await storage.set(legacyAgentPackageStateStorageKey, JSON.stringify(invalid));

			await assert.rejects(
				new ApplicationStorageAgentPackageStateStore(storage).read(),
				/Invalid Agent package persisted state fields/,
			);
			assert.equal(storage.get(legacyAgentPackageStateStorageKey), JSON.stringify(invalid));
			assert.equal(storage.get(agentPackageStateStorageKey), undefined);
		} finally {
			storage.dispose();
		}
	});

	test('invalid persisted state fails closed', async () => {
		const storage = await createStorage();
		try {
			await storage.set(agentHostCatalogStorageKey, '{');
			await assert.rejects(
				new ApplicationStorageAgentHostCatalogStore(storage).read(),
				/Invalid JSON/,
			);

			await storage.set(agentPackageStateStorageKey, JSON.stringify({
				...createPackageState(0),
				revision: -1,
			}));
			await assert.rejects(
				new ApplicationStorageAgentPackageStateStore(storage).read(),
				/Invalid revision/,
			);
		} finally {
			storage.dispose();
		}
	});

	test('legacy source owns only the exact one-shot migration key', async () => {
		const storage = await createStorage();
		try {
			const source = new ApplicationStorageLegacyAgentHostCatalogSource(storage);
			await storage.set('sessions.providers.default', '{"version":3}');
			assert.equal(await source.read('sessions.providers.default'), '{"version":3}');
			await source.delete('sessions.providers.default');
			assert.equal(await source.read('sessions.providers.default'), undefined);
		} finally {
			storage.dispose();
		}
	});
});
