import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { Storage } from 'cs/base/parts/storage/common/storage';
import { SQLiteStorageDatabase } from 'cs/base/parts/storage/node/storage';

async function withStorageFile<T>(run: (storageFile: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cs-sqlite-storage-'));
  try {
    return await run(path.join(tempDir, 'state.vscdb'));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('SQLiteStorageDatabase persists storage values across instances', async () => {
  await withStorageFile(async (storageFile) => {
    const storage = new Storage(new SQLiteStorageDatabase(storageFile));
    await storage.init();

    await storage.set('title', 'Comet Studio');
    await storage.set('enabled', true);
    await storage.set('count', 42);
    await storage.set('payload', { nested: 'value' });
    await storage.close();

    const restored = new Storage(new SQLiteStorageDatabase(storageFile));
    await restored.init();

    assert.equal(restored.get('title'), 'Comet Studio');
    assert.equal(restored.getBoolean('enabled'), true);
    assert.equal(restored.getNumber('count'), 42);
    assert.deepEqual(restored.getObject('payload'), { nested: 'value' });

    await restored.close();
  });
});

test('SQLiteStorageDatabase deletes persisted values', async () => {
  await withStorageFile(async (storageFile) => {
    const storage = new Storage(new SQLiteStorageDatabase(storageFile));
    await storage.init();

    await storage.set('first', 'one');
    await storage.set('second', 'two');
    await storage.delete('first');
    await storage.close();

    const restored = new Storage(new SQLiteStorageDatabase(storageFile));
    await restored.init();

    assert.equal(restored.get('first'), undefined);
    assert.equal(restored.get('second'), 'two');

    await restored.close();
  });
});

test('SQLiteStorageDatabase supports direct batched updates', async () => {
  await withStorageFile(async (storageFile) => {
    const database = new SQLiteStorageDatabase(storageFile);
    await database.updateItems({
      insert: new Map([
        ['first', 'one'],
        ['second', 'two'],
      ]),
    });
    await database.updateItems({
      insert: new Map([['second', 'updated']]),
      delete: new Set(['first']),
    });

    const items = await database.getItems();

    assert.equal(items.get('first'), undefined);
    assert.equal(items.get('second'), 'updated');

    await database.close();
  });
});
