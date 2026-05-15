import type { StorageService } from 'ls/platform/storage/common/storage';
import { appError } from 'ls/base/common/errors';
import { createConfigStore } from 'ls/platform/storage/electron-main/configStore';
import { createHistoryStore } from 'ls/platform/storage/electron-main/historyStore';
import { createLibraryStore } from 'ls/platform/storage/electron-main/libraryStore';
import { createTranslationCacheStore } from 'ls/platform/storage/electron-main/translationCacheStore';

interface StoragePaths {
  historyFile: string;
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
  const historyStore = createHistoryStore(paths.historyFile);
  const configStore = createConfigStore(paths.configFile, paths.userSettingsFile, {
    defaultLocale: options.defaultLocale,
  });
  const translationCacheStore = createTranslationCacheStore(paths.translationCacheFile);
  const libraryStore = createLibraryStore({
    libraryDbFile: paths.libraryDbFile,
    libraryFilesDir: paths.libraryFilesDir,
    ragCacheDir: paths.ragCacheDir,
  });

  return {
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
      return configStore.loadSettings();
    },

    async saveSettings(settings = {}) {
      return configStore.saveSettings(settings);
    },

    async upsertLibraryDocumentMetadata(payload) {
      const settings = await configStore.loadSettings();
      if (!settings.knowledgeBase.enabled) {
        throw appError('UNKNOWN_ERROR', {
          message: 'Knowledge base mode is disabled.',
        });
      }
      return libraryStore.upsertLibraryDocumentMetadata(payload);
    },

    async deleteLibraryDocument(payload) {
      const settings = await configStore.loadSettings();
      if (!settings.knowledgeBase.enabled) {
        throw appError('UNKNOWN_ERROR', {
          message: 'Knowledge base mode is disabled.',
        });
      }
      return libraryStore.deleteLibraryDocument(payload);
    },

    async registerLibraryDocument(payload) {
      const settings = await configStore.loadSettings();
      if (!settings.knowledgeBase.enabled) {
        throw appError('UNKNOWN_ERROR', {
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
