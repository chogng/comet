import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStorageService } from 'ls/code/electron-main/storageService';
import { StorageScope, StorageTarget } from 'ls/platform/storage/common/storage';

async function withStoragePaths<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'ls-storage-service-'));
  try {
    return await run(tempDir);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

function createPaths(tempDir: string) {
  return {
    historyFile: path.join(tempDir, 'history.json'),
    stateDbFile: path.join(tempDir, 'state.vscdb'),
    configFile: path.join(tempDir, 'config.json'),
    userSettingsFile: path.join(tempDir, 'settings.json'),
    translationCacheFile: path.join(tempDir, 'translation-cache.json'),
    libraryDbFile: path.join(tempDir, 'library.sqlite'),
    libraryFilesDir: path.join(tempDir, 'library-files'),
    ragCacheDir: path.join(tempDir, 'rag-cache'),
  };
}

test('createStorageService wires application state storage to state.vscdb', async () => {
  await withStoragePaths(async (tempDir) => {
    const paths = createPaths(tempDir);
    const storage = createStorageService(paths);
    await storage.init();

    await storage.applicationStorage.set('workspace.lastActive', 'draft');
    storage.store(
      'workspace.lastScopeWrite',
      'application',
      StorageScope.APPLICATION,
      StorageTarget.MACHINE,
    );
    await storage.flush();
    await storage.close();

    const restored = createStorageService(paths);
    await restored.init();

    assert.equal(restored.applicationStorage.get('workspace.lastActive'), 'draft');
    assert.equal(
      restored.get('workspace.lastScopeWrite', StorageScope.APPLICATION),
      'application',
    );

    await restored.close();
  });
});
