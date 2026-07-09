import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createStorageService } from 'cs/code/electron-main/storageService';
import { StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import { createDefaultTranslationSettings } from 'cs/workbench/services/translation/config';

async function withStoragePaths<T>(run: (tempDir: string) => Promise<T>) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'cs-storage-service-'));
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

test('createStorageService stores provider api keys outside config json', async () => {
  await withStoragePaths(async (tempDir) => {
    const paths = createPaths(tempDir);
    const storage = createStorageService(paths);
    await storage.init();
    const translation = createDefaultTranslationSettings();
    translation.activeProvider = 'custom';
    translation.providers.custom = {
      apiKey: 'custom-key',
      baseUrl: 'https://custom.example/v1',
      model: 'custom-model',
      models: ['custom-model'],
    };

    await storage.saveSettings({ translation });
    await storage.close();

    const savedConfig = JSON.parse(await readFile(paths.configFile, 'utf8'));
    assert.equal(savedConfig.translation.providers.custom.apiKey, undefined);

    const restored = createStorageService(paths);
    await restored.init();
    const restoredSettings = await restored.loadSettings();
    assert.equal(restoredSettings.translation.providers.custom.apiKey, 'custom-key');

    await restored.close();
  });
});
