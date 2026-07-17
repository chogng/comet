/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import {
	chmodSync,
	closeSync,
	mkdtempSync,
	openSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { suite, test, type TestContext } from 'node:test';

import type {
	DurableStorageError,
	DurableStorageResult,
	IDurableStorageLimits,
	IDurableStorageService,
	IDurableStorageWriter,
} from 'cs/platform/storage/common/durableStorage';
import {
	defaultSQLiteDurableStorageLimits,
	openSQLiteDurableStorage,
} from 'cs/platform/storage/electron-main/sqliteDurableStorage';

function expectSuccess<T>(result: DurableStorageResult<T>): T {
	if (result.type === 'error') {
		assert.fail(`Expected success, received ${JSON.stringify(result.error)}.`);
	}
	return result.value;
}

function expectError(
	result: DurableStorageResult<unknown>,
	code: DurableStorageError['code'],
): DurableStorageError {
	assert.equal(result.type, 'error');
	assert.equal(result.error.code, code);
	return result.error;
}

function createDatabasePath(context: TestContext): string {
	const directory = mkdtempSync(join(tmpdir(), 'comet-durable-storage-'));
	context.after(() => rmSync(directory, { recursive: true, force: true }));
	return join(directory, 'durable.sqlite');
}

async function openService(
	context: TestContext,
	databasePath: string,
	limits?: IDurableStorageLimits,
): Promise<IDurableStorageService> {
	const service = expectSuccess(
		await openSQLiteDurableStorage(databasePath, { limits }),
	);
	context.after(() => service.dispose());
	return service;
}

async function openWriter(
	context: TestContext,
	service: IDurableStorageService,
	resource = 'opaque-resource',
): Promise<IDurableStorageWriter> {
	const writer = expectSuccess(await service.openWriter(resource));
	context.after(() => writer.release());
	return writer;
}

suite('SQLite durable storage', { concurrency: false }, () => {
	test('keeps append volatile until sync and persists only durable bytes across reopen', async context => {
		const databasePath = createDatabasePath(context);
		const firstService = await openService(context, databasePath);
		const firstWriter = await openWriter(context, firstService);

		assert.deepEqual(
			expectSuccess(
				await firstWriter.appendLog(0, new Uint8Array([1, 2, 3])),
			),
			{ offset: 0, volatileLength: 3 },
		);
		assert.deepEqual(
			expectSuccess(await firstWriter.getDurableLogLength()),
			{ durableLength: 0 },
		);
		firstWriter.release();

		const secondWriter = await openWriter(context, firstService);
		assert.equal(secondWriter.authority.generation, '2');
		assert.deepEqual(
			expectSuccess(await secondWriter.getDurableLogLength()),
			{ durableLength: 0 },
		);
		expectSuccess(
			await secondWriter.appendLog(0, new Uint8Array([4, 5, 6, 7])),
		);
		expectSuccess(await secondWriter.syncLog(4));
		secondWriter.release();
		firstService.dispose();
		expectError(
			await firstService.openWriter('other-resource'),
			'disposed',
		);

		const reopenedService = await openService(context, databasePath);
		const reopenedWriter = await openWriter(context, reopenedService);
		assert.equal(reopenedWriter.authority.generation, '3');
		assert.deepEqual(
			Array.from(
				expectSuccess(
					await reopenedWriter.readDurableLogRange({
						offset: 0,
						length: 4,
					}),
				).bytes,
			),
			[4, 5, 6, 7],
		);
	});

	test('rejects a second live writer without changing generation and release discards pending bytes', async context => {
		const databasePath = createDatabasePath(context);
		const service = await openService(context, databasePath);
		const writer = await openWriter(context, service);
		const generation = writer.authority.generation;
		expectSuccess(
			await writer.appendLog(0, new Uint8Array([11, 12, 13])),
		);

		const conflict = expectError(
			await service.openWriter('opaque-resource'),
			'generation-conflict',
		);
		assert.deepEqual(conflict, {
			code: 'generation-conflict',
			operation: 'open-writer',
			expectedGeneration: null,
			actualGeneration: generation,
		});

		writer.release();
		writer.release();
		expectError(await writer.getDurableLogLength(), 'disposed');
		const replacement = await openWriter(context, service);
		assert.equal(replacement.authority.generation, '2');
		assert.deepEqual(
			expectSuccess(await replacement.getDurableLogLength()),
			{ durableLength: 0 },
		);
	});

	test('increments persisted writer generation across backend instances and rejects the old fence', async context => {
		const databasePath = createDatabasePath(context);
		const firstService = await openService(context, databasePath);
		const firstWriter = await openWriter(context, firstService);
		expectSuccess(
			await firstWriter.appendLog(0, new Uint8Array([21, 22])),
		);

		const secondService = await openService(context, databasePath);
		const secondWriter = await openWriter(context, secondService);
		assert.equal(secondWriter.authority.generation, '2');
		assert.notEqual(
			secondWriter.authority.fenceToken,
			firstWriter.authority.fenceToken,
		);

		const lostFence = expectError(
			await firstWriter.syncLog(2),
			'fence-lost',
		);
		assert.deepEqual(lostFence, {
			code: 'fence-lost',
			operation: 'sync-log',
			expectedGeneration: '1',
			actualGeneration: '2',
		});
		assert.deepEqual(
			expectSuccess(await secondWriter.getDurableLogLength()),
			{ durableLength: 0 },
		);
	});

	test('keeps manifest CAS generation separate from writer authority', async context => {
		const databasePath = createDatabasePath(context);
		const service = await openService(context, databasePath);
		const writer = await openWriter(context, service);

		assert.deepEqual(expectSuccess(await writer.readManifest()), {
			generation: null,
			bytes: null,
		});
		const firstManifest = expectSuccess(
			await writer.compareAndSwapManifest(
				null,
				new Uint8Array([31, 32]),
			),
		);
		assert.notEqual(firstManifest.generation, writer.authority.generation);
		assert.match(firstManifest.generation ?? '', /^[0-9a-f]{64}$/);
		expectError(
			await writer.compareAndSwapManifest(
				null,
				new Uint8Array([33]),
			),
			'generation-conflict',
		);
		const secondManifest = expectSuccess(
			await writer.compareAndSwapManifest(
				firstManifest.generation,
				new Uint8Array([34, 35, 36]),
			),
		);
		assert.notEqual(secondManifest.generation, firstManifest.generation);
		const manifestGeneration = secondManifest.generation;
		writer.release();

		const nextWriter = await openWriter(context, service);
		assert.equal(nextWriter.authority.generation, '2');
		const persistedManifest = expectSuccess(
			await nextWriter.readManifest(),
		);
		assert.equal(persistedManifest.generation, manifestGeneration);
		assert.deepEqual(
			Array.from(persistedManifest.bytes ?? new Uint8Array()),
			[34, 35, 36],
		);
	});

	test('keeps the previous immutable object readable when a manifest switch loses CAS', async context => {
		const databasePath = createDatabasePath(context);
		const service = await openService(context, databasePath);
		const writer = await openWriter(context, service);

		const firstTemporary = expectSuccess(
			await writer.createTemporaryObject(),
		);
		expectSuccess(
			await writer.appendTemporaryObject(
				firstTemporary.id,
				0,
				new Uint8Array([37, 38]),
			),
		);
		expectSuccess(
			await writer.syncTemporaryObject(firstTemporary.id, 2),
		);
		const firstObject = expectSuccess(
			await writer.atomicInstallTemporaryObject(
				firstTemporary.id,
				2,
				'snapshot:revision-1',
			),
		);
		const firstManifestBytes = new TextEncoder().encode(
			JSON.stringify({
				key: firstObject.key,
				generation: firstObject.generation,
			}),
		);
		const firstManifest = expectSuccess(
			await writer.compareAndSwapManifest(null, firstManifestBytes),
		);

		const nextTemporary = expectSuccess(
			await writer.createTemporaryObject(),
		);
		expectSuccess(
			await writer.appendTemporaryObject(
				nextTemporary.id,
				0,
				new Uint8Array([39, 40, 41]),
			),
		);
		expectSuccess(
			await writer.syncTemporaryObject(nextTemporary.id, 3),
		);
		const nextObject = expectSuccess(
			await writer.atomicInstallTemporaryObject(
				nextTemporary.id,
				3,
				'snapshot:revision-2',
			),
		);
		const nextManifestBytes = new TextEncoder().encode(
			JSON.stringify({
				key: nextObject.key,
				generation: nextObject.generation,
			}),
		);
		expectError(
			await writer.compareAndSwapManifest(null, nextManifestBytes),
			'generation-conflict',
		);

		const retainedManifest = expectSuccess(await writer.readManifest());
		assert.equal(retainedManifest.generation, firstManifest.generation);
		assert.deepEqual(
			retainedManifest.bytes,
			firstManifestBytes,
		);
		assert.deepEqual(
			Array.from(
				expectSuccess(
					await writer.readObjectRange(
						firstObject.key,
						firstObject.generation,
						{ offset: 0, length: 2 },
					),
				).bytes,
			),
			[37, 38],
		);
		assert.deepEqual(
			expectSuccess(await writer.getObjectDescriptor(nextObject.key)),
			nextObject,
		);
	});

	test('conditionally truncates a durable log tail across chunk boundaries', async context => {
		const databasePath = createDatabasePath(context);
		const service = await openService(context, databasePath);
		const writer = await openWriter(context, service);
		expectSuccess(
			await writer.appendLog(0, new Uint8Array([1, 2, 3])),
		);
		expectSuccess(
			await writer.appendLog(3, new Uint8Array([4, 5, 6])),
		);
		expectSuccess(await writer.syncLog(6));

		expectError(
			await writer.truncateDurableLogTail(5, 4),
			'length-conflict',
		);
		assert.deepEqual(
			expectSuccess(await writer.truncateDurableLogTail(6, 4)),
			{ durableLength: 4 },
		);
		assert.deepEqual(
			Array.from(
				expectSuccess(
					await writer.readDurableLogRange({
						offset: 0,
						length: 4,
					}),
				).bytes,
			),
			[1, 2, 3, 4],
		);
		expectError(
			await writer.readDurableLogRange({ offset: 0, length: 5 }),
			'length-conflict',
		);
	});

	test('syncs and verifies temporary objects before immutable installation and preserves orphans', async context => {
		const databasePath = createDatabasePath(context);
		const firstService = await openService(context, databasePath);
		const firstWriter = await openWriter(context, firstService);
		const temporary = expectSuccess(
			await firstWriter.createTemporaryObject(),
		);
		expectSuccess(
			await firstWriter.appendTemporaryObject(
				temporary.id,
				0,
				new Uint8Array([41, 42]),
			),
		);
		expectSuccess(
			await firstWriter.appendTemporaryObject(
				temporary.id,
				2,
				new Uint8Array([43, 44]),
			),
		);
		assert.deepEqual(
			expectSuccess(
				await firstWriter.getTemporaryObjectDurableLength(
					temporary.id,
				),
			),
			{ durableLength: 0 },
		);
		expectError(
			await firstWriter.atomicInstallTemporaryObject(
				temporary.id,
				0,
				'snapshot:revision-1',
			),
			'length-conflict',
		);
		expectSuccess(
			await firstWriter.syncTemporaryObject(temporary.id, 4),
		);
		assert.deepEqual(
			Array.from(
				expectSuccess(
					await firstWriter.readTemporaryObjectRange(
						temporary.id,
						{ offset: 0, length: 4 },
					),
				).bytes,
			),
			[41, 42, 43, 44],
		);
		const firstObject = expectSuccess(
			await firstWriter.atomicInstallTemporaryObject(
				temporary.id,
				4,
				'snapshot:revision-1',
			),
		);
		expectError(
			await firstWriter.getTemporaryObjectDurableLength(temporary.id),
			'not-found',
		);
		const replacement = expectSuccess(
			await firstWriter.createTemporaryObject(),
		);
		expectSuccess(
			await firstWriter.appendTemporaryObject(
				replacement.id,
				0,
				new Uint8Array([45, 46]),
			),
		);
		expectSuccess(
			await firstWriter.syncTemporaryObject(replacement.id, 2),
		);
		expectError(
			await firstWriter.atomicInstallTemporaryObject(
				replacement.id,
				1,
				'snapshot:revision-1',
			),
			'length-conflict',
		);
		assert.deepEqual(
			Array.from(
				expectSuccess(
					await firstWriter.readObjectRange(
						'snapshot:revision-1',
						firstObject.generation,
						{ offset: 0, length: 4 },
					),
				).bytes,
			),
			[41, 42, 43, 44],
		);
		expectError(
			await firstWriter.atomicInstallTemporaryObject(
				replacement.id,
				2,
				'snapshot:revision-1',
			),
			'generation-conflict',
		);
		assert.deepEqual(
			expectSuccess(
				await firstWriter.getTemporaryObjectDurableLength(replacement.id),
			),
			{ durableLength: 2 },
		);
		const secondObject = expectSuccess(
			await firstWriter.atomicInstallTemporaryObject(
				replacement.id,
				2,
				'snapshot:revision-2',
			),
		);

		const orphan = expectSuccess(
			await firstWriter.createTemporaryObject(),
		);
		expectSuccess(
			await firstWriter.appendTemporaryObject(
				orphan.id,
				0,
				new Uint8Array([51, 52, 53]),
			),
		);
		expectSuccess(
			await firstWriter.syncTemporaryObject(orphan.id, 3),
		);
		const unsyncedOrphan = expectSuccess(
			await firstWriter.createTemporaryObject(),
		);
		expectSuccess(
			await firstWriter.appendTemporaryObject(
				unsyncedOrphan.id,
				0,
				new Uint8Array([54, 55]),
			),
		);
		firstWriter.release();
		firstService.dispose();

		const reopenedService = await openService(context, databasePath);
		const reopenedWriter = await openWriter(context, reopenedService);
		assert.deepEqual(
			[
				...expectSuccess(
					await reopenedWriter.listTemporaryObjects(10),
				),
			].sort((left, right) =>
				left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
			),
			[
				{ id: orphan.id, durableLength: 3 },
				{ id: unsyncedOrphan.id, durableLength: 0 },
			].sort((left, right) =>
				left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
			),
		);
		assert.deepEqual(
			Array.from(
				expectSuccess(
					await reopenedWriter.readObjectRange(
						'snapshot:revision-2',
						secondObject.generation,
						{ offset: 0, length: 2 },
					),
				).bytes,
			),
			[45, 46],
		);
		assert.deepEqual(
			expectSuccess(
				await reopenedWriter.getObjectDescriptor('snapshot:revision-1'),
			),
			firstObject,
		);
		assert.deepEqual(
			Array.from(
				expectSuccess(
					await reopenedWriter.readObjectRange(
						'snapshot:revision-1',
						firstObject.generation,
						{ offset: 0, length: 4 },
					),
				).bytes,
			),
			[41, 42, 43, 44],
		);
		expectError(
			await reopenedWriter.readObjectRange(
				'snapshot:revision-1',
				secondObject.generation,
				{ offset: 0, length: 1 },
			),
			'generation-conflict',
		);
		expectError(
			await reopenedWriter.readObjectRange(
				'snapshot:revision-1',
				null as unknown as string,
				{ offset: 0, length: 1 },
			),
			'invalid-request',
		);
		expectSuccess(
			await reopenedWriter.deleteTemporaryObject(orphan.id, 3),
		);
		expectSuccess(
			await reopenedWriter.deleteTemporaryObject(
				unsyncedOrphan.id,
				0,
			),
		);
		assert.deepEqual(
			expectSuccess(await reopenedWriter.listTemporaryObjects(10)),
			[],
		);
	});

	test('enforces byte, range, pending, object, manifest, and list limits', async context => {
		const limits: IDurableStorageLimits = {
			...defaultSQLiteDurableStorageLimits,
			maximumResourceBytes: 8,
			maximumObjectKeyBytes: 8,
			maximumAppendBytes: 4,
			maximumPendingBytes: 5,
			maximumLogBytes: 7,
			maximumReadBytes: 3,
			maximumTemporaryObjectBytes: 5,
			maximumManifestBytes: 2,
			maximumTemporaryObjectListEntries: 1,
		};
		const databasePath = createDatabasePath(context);
		const service = await openService(context, databasePath, limits);
		expectError(
			await service.openWriter('resource-too-long'),
			'resource-limit-exceeded',
		);
		const writer = await openWriter(context, service, 'resource');

		expectError(
			await writer.appendLog(0, new Uint8Array(5)),
			'resource-limit-exceeded',
		);
		expectSuccess(await writer.appendLog(0, new Uint8Array(4)));
		expectError(
			await writer.appendLog(4, new Uint8Array(2)),
			'resource-limit-exceeded',
		);
		expectSuccess(await writer.syncLog(4));
		expectError(
			await writer.appendLog(4, new Uint8Array(4)),
			'resource-limit-exceeded',
		);
		expectError(
			await writer.readDurableLogRange({ offset: 0, length: 4 }),
			'resource-limit-exceeded',
		);
		expectError(
			await writer.compareAndSwapManifest(
				null,
				new Uint8Array(3),
			),
			'resource-limit-exceeded',
		);

		const temporary = expectSuccess(
			await writer.createTemporaryObject(),
		);
		expectSuccess(
			await writer.appendTemporaryObject(
				temporary.id,
				0,
				new Uint8Array(4),
			),
		);
		expectError(
			await writer.appendTemporaryObject(
				temporary.id,
				4,
				new Uint8Array(2),
			),
			'resource-limit-exceeded',
		);
		expectError(
			await writer.atomicInstallTemporaryObject(
				temporary.id,
				0,
				'object-key-too-long',
			),
			'resource-limit-exceeded',
		);
		expectError(
			await writer.listTemporaryObjects(2),
			'resource-limit-exceeded',
		);
	});

	test('rejects in-memory and unsupported SQLite schemas and reports structural corruption', async context => {
		expectError(
			await openSQLiteDurableStorage(':memory:'),
			'unsupported',
		);
		expectError(
			await openSQLiteDurableStorage('file::memory:?cache=shared'),
			'unsupported',
		);

		const unsupportedPath = createDatabasePath(context);
		const unsupportedDatabase = new DatabaseSync(unsupportedPath);
		unsupportedDatabase.exec(
			'CREATE TABLE ForeignData(value TEXT); PRAGMA user_version = 7;',
		);
		unsupportedDatabase.close();
		expectError(
			await openSQLiteDurableStorage(unsupportedPath),
			'unsupported',
		);

		const wrongSchemaPath = createDatabasePath(context);
		const wrongSchemaDatabase = new DatabaseSync(wrongSchemaPath);
		for (const table of [
			'DurableLogChunk',
			'DurableObject',
			'DurableObjectChunk',
			'DurableResource',
			'DurableTemporaryObject',
			'DurableTemporaryObjectChunk',
		]) {
			wrongSchemaDatabase.exec(
				`CREATE TABLE ${table}(placeholder TEXT) STRICT;`,
			);
		}
		wrongSchemaDatabase.exec(
			'PRAGMA application_id = 1128551217; PRAGMA user_version = 1;',
		);
		wrongSchemaDatabase.close();
		const wrongSchema = expectError(
			await openSQLiteDurableStorage(wrongSchemaPath),
			'corruption',
		);
		assert.deepEqual(wrongSchema, {
			code: 'corruption',
			operation: 'open',
			subject: 'schema',
		});

		const corruptPath = createDatabasePath(context);
		const service = await openService(context, corruptPath);
		const writer = await openWriter(context, service);
		expectSuccess(
			await writer.appendLog(0, new Uint8Array([61, 62, 63])),
		);
		expectSuccess(await writer.syncLog(3));
		writer.release();
		service.dispose();

		const corruptDatabase = new DatabaseSync(corruptPath);
		corruptDatabase.exec(
			'UPDATE DurableResource SET log_length = log_length + 1;',
		);
		corruptDatabase.close();
		const corruptService = await openService(context, corruptPath);
		const corruptWriter = await openWriter(context, corruptService);
		expectError(
			await corruptWriter.getDurableLogLength(),
			'corruption',
		);
	});

	test('maps full databases and filesystem failures to stable errors', async context => {
		const ioRoot = mkdtempSync(join(tmpdir(), 'comet-durable-io-'));
		context.after(() =>
			rmSync(ioRoot, { recursive: true, force: true }),
		);
		const blockingFile = join(ioRoot, 'blocking-file');
		writeFileSync(blockingFile, 'not a directory');
		expectError(
			await openSQLiteDurableStorage(
				join(blockingFile, 'durable.sqlite'),
			),
			'io',
		);

		const fullPath = createDatabasePath(context);
		const initialService = await openService(context, fullPath);
		const initialWriter = await openWriter(context, initialService);
		initialWriter.release();
		initialService.dispose();
		const fullDatabase = new DatabaseSync(fullPath);
		const pageCount = (
			fullDatabase.prepare('PRAGMA page_count').get() as {
				page_count: number;
			}
		).page_count;
		fullDatabase.exec(`PRAGMA max_page_count = ${pageCount}`);
		fullDatabase.close();

		const fullService = expectSuccess(
			await openSQLiteDurableStorage(fullPath, {
				maximumDatabasePages: pageCount,
			}),
		);
		context.after(() => fullService.dispose());
		const fullWriter = await openWriter(
			context,
			fullService,
			'second-resource',
		);
		expectSuccess(
			await fullWriter.appendLog(0, new Uint8Array(64 * 1024)),
		);
		expectError(await fullWriter.syncLog(64 * 1024), 'out-of-space');
		assert.deepEqual(
			expectSuccess(
				await fullWriter.appendLog(64 * 1024, new Uint8Array()),
			),
			{ offset: 64 * 1024, volatileLength: 64 * 1024 },
		);

		const retainedPending = expectError(
			await fullWriter.syncLog(0),
			'length-conflict',
		);
		assert.deepEqual(retainedPending, {
			code: 'length-conflict',
			operation: 'sync-log',
			expectedLength: 0,
			actualLength: 64 * 1024,
		});
		fullWriter.release();
		const recoveryWriter = await openWriter(
			context,
			fullService,
			'second-resource',
		);
		assert.deepEqual(
			expectSuccess(await recoveryWriter.getDurableLogLength()),
			{ durableLength: 0 },
		);
	});

	test('maps file permission failures to a stable error', async context => {
		if (process.platform === 'win32') {
			context.skip('POSIX permission bits are required.');
			return;
		}
		const permissionRoot = mkdtempSync(
			join(tmpdir(), 'comet-durable-permission-'),
		);
		const permissionPath = join(permissionRoot, 'durable.sqlite');
		const descriptor = openSync(permissionPath, 'w');
		closeSync(descriptor);
		chmodSync(permissionPath, 0o400);
		chmodSync(permissionRoot, 0o500);
		context.after(() => {
			chmodSync(permissionRoot, 0o700);
			chmodSync(permissionPath, 0o600);
			rmSync(permissionRoot, { recursive: true, force: true });
		});
		expectError(
			await openSQLiteDurableStorage(permissionPath),
			'permission-denied',
		);
	});
});
