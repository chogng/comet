/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { DisposableStore } from 'cs/base/common/lifecycle';
import { InMemoryStorageDatabase, Storage } from 'cs/base/parts/storage/common/storage';
import { StorageScope, StorageTarget, WillSaveStateReason } from 'cs/platform/storage/common/storage';
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

test('ApplicationStorageService waits for shutdown save participants before closing', async () => {
	const storage = new Storage(new InMemoryStorageDatabase());
	const service = new ApplicationStorageService(storage);
	let completeSave!: () => void;
	const saveCompleted = new Promise<void>(resolve => completeSave = resolve);
	let closeCompleted = false;

	try {
		await service.init();
		service.onWillSaveState(event => {
			assert.equal(event.reason, WillSaveStateReason.SHUTDOWN);
			event.join(saveCompleted);
		});
		const closePromise = service.close().then(() => closeCompleted = true);
		await Promise.resolve();
		assert.equal(closeCompleted, false);
		completeSave();
		await closePromise;
		assert.equal(closeCompleted, true);
	} finally {
		service.dispose();
	}
});

test('ApplicationStorageService returns shutdown save participant failures', async () => {
	const storage = new Storage(new InMemoryStorageDatabase());
	const service = new ApplicationStorageService(storage);
	const saveError = new Error('Shutdown save failed.');

	try {
		await service.init();
		service.onWillSaveState(event => event.join(Promise.reject(saveError)));
		await assert.rejects(service.close(), error => error === saveError);
	} finally {
		await storage.close();
		service.dispose();
	}
});
