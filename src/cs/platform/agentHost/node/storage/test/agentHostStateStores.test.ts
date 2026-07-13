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
} from '../agentHostStateStores.js';

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

	test('invalid persisted state fails closed', async () => {
		const storage = await createStorage();
		try {
			await storage.set('agentHost.catalog.v1', '{');
			await assert.rejects(
				new ApplicationStorageAgentHostCatalogStore(storage).read(),
				/Invalid JSON/,
			);

			await storage.set('agentHost.packages.v1', JSON.stringify({ revision: -1 }));
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
