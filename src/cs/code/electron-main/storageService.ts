import type { StorageService } from 'cs/platform/storage/common/storage';
import { AppCommandErrorCode, appCommandError } from 'cs/base/parts/sandbox/common/appCommandErrors';
import { createConfigurationMainService } from 'cs/platform/configuration/electron-main/configurationService';
import { createHistoryStore } from 'cs/platform/storage/electron-main/historyStore';
import { createLibraryStore } from 'cs/platform/storage/electron-main/libraryStore';
import { createTranslationCacheStore } from 'cs/platform/storage/electron-main/translationCacheStore';
import { createStorageMainService } from 'cs/platform/storage/electron-main/storageMainService';

interface StoragePaths {
  historyFile: string;
  stateDbFile: string;
  configFile: string;
  userSettingsFile: string;
  translationCacheFile: string;
  libraryDbFile: string;
  libraryFilesDir: string;
  ragCacheDir: string;
}

interface StorageOptions {
  defaultLocale?: 'zh' | 'en';
}

export function createStorageService(paths: StoragePaths, options: StorageOptions = {}): StorageService {
  const storageMainService = createStorageMainService({
    stateDbFile: paths.stateDbFile,
  });
  const historyStore = createHistoryStore(paths.historyFile);
  const configurationService = createConfigurationMainService(paths.configFile, paths.userSettingsFile, {
    defaultLocale: options.defaultLocale,
  });
  const translationCacheStore = createTranslationCacheStore(paths.translationCacheFile);
  const libraryStore = createLibraryStore({
    libraryDbFile: paths.libraryDbFile,
    libraryFilesDir: paths.libraryFilesDir,
    ragCacheDir: paths.ragCacheDir,
  });

  return {
    applicationStorage: storageMainService.applicationStorage.storage,
    onDidChangeValue: storageMainService.onDidChangeValue,
    onWillSaveState: storageMainService.onWillSaveState,

    async init() {
      await storageMainService.init();
    },

    async close() {
      await Promise.all([
        storageMainService.close(),
        Promise.resolve(libraryStore.dispose()),
      ]);
    },

    get: storageMainService.get.bind(storageMainService),
    getBoolean: storageMainService.getBoolean.bind(storageMainService),
    getNumber: storageMainService.getNumber.bind(storageMainService),
    getObject: storageMainService.getObject.bind(storageMainService),
    store: storageMainService.store.bind(storageMainService),
    storeAll: storageMainService.storeAll.bind(storageMainService),
    remove: storageMainService.remove.bind(storageMainService),
    keys: storageMainService.keys.bind(storageMainService),
    log: storageMainService.log.bind(storageMainService),
    optimize: storageMainService.optimize.bind(storageMainService),
    flush: storageMainService.flush.bind(storageMainService),

    async saveFetchedArticles(items) {
      await historyStore.saveFetchedArticles(items);
    },

    async loadTranslationCache(keys) {
      return translationCacheStore.loadTranslationCache(keys);
    },

    async saveTranslationCache(entries) {
      await translationCacheStore.saveTranslationCache(entries);
    },

    async loadSettings() {
      return configurationService.loadSettings();
    },

    async saveSettings(settings = {}) {
      return configurationService.saveSettings(settings);
    },

    async upsertLibraryDocumentMetadata(payload) {
      const settings = await configurationService.loadSettings();
      if (!settings.knowledgeBase.enabled) {
        throw appCommandError(AppCommandErrorCode.UnknownError, {
          message: 'Knowledge base mode is disabled.',
        });
      }
      return libraryStore.upsertLibraryDocumentMetadata(payload);
    },

    async deleteLibraryDocument(payload) {
      const settings = await configurationService.loadSettings();
      if (!settings.knowledgeBase.enabled) {
        throw appCommandError(AppCommandErrorCode.UnknownError, {
          message: 'Knowledge base mode is disabled.',
        });
      }
      return libraryStore.deleteLibraryDocument(payload);
    },

    async registerLibraryDocument(payload) {
      const settings = await configurationService.loadSettings();
      if (!settings.knowledgeBase.enabled) {
        throw appCommandError(AppCommandErrorCode.UnknownError, {
          message: 'Knowledge base mode is disabled.',
        });
      }
      return libraryStore.registerLibraryDocument({
        ...payload,
        storageMode: settings.knowledgeBase.libraryStorageMode,
        libraryDirectory: settings.knowledgeBase.libraryDirectory,
      } as typeof payload);
    },

    async getLibraryDocumentStatus(payload) {
      return libraryStore.getLibraryDocumentStatus(payload);
    },

    async listLibraryDocuments(payload) {
      return libraryStore.listLibraryDocuments(payload);
    },

    async reindexLibraryDocument(payload) {
      return libraryStore.reindexLibraryDocument(payload);
    },
  };
}
