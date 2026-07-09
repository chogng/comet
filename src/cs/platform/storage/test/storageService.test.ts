/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { DisposableStore } from 'cs/base/common/lifecycle';
import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import { StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import { ApplicationStorageService } from 'cs/platform/storage/common/storageService';

test('ApplicationStorageService tracks storage targets and scope-wide change listeners', async () => {
	const storage = new Storage(new InMemoryStorageDatabase());
	const service = new ApplicationStorageService(storage);
	const disposables = new DisposableStore();
	const changedKeys: string[] = [];

	try {
		await service.init();
		service.onDidChangeValue(
			StorageScope.APPLICATION,
			undefined,
			disposables,
		)(event => changedKeys.push(event.key));

		service.store('machine-key', 'machine-value', StorageScope.APPLICATION, StorageTarget.MACHINE);
		assert.equal(service.get('machine-key', StorageScope.APPLICATION), 'machine-value');

		service.store('user-key', 'user-value', StorageScope.APPLICATION, StorageTarget.USER);
		await service.flush();

		assert.deepEqual(service.keys(StorageScope.APPLICATION, StorageTarget.MACHINE), ['machine-key']);
		assert.deepEqual(service.keys(StorageScope.APPLICATION, StorageTarget.USER), ['user-key']);
		assert.deepEqual(changedKeys, ['machine-key', 'user-key']);

		service.remove('machine-key', StorageScope.APPLICATION);
		await service.flush();

		assert.deepEqual(service.keys(StorageScope.APPLICATION, StorageTarget.MACHINE), []);
		assert.equal(service.get('machine-key', StorageScope.APPLICATION), undefined);
	} finally {
		disposables.dispose();
		await service.close();
	}
});
