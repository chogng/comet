import path from 'node:path';
import { promises as fs } from 'node:fs';

import type { TranslationCacheRecord } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';

export interface TranslationCacheStore {
  loadTranslationCache(keys: string[]): Promise<Record<string, string>>;
  saveTranslationCache(entries: TranslationCacheRecord[]): Promise<void>;
}

type TranslationCacheEntry = {
  value: string;
  updatedAt: string;
};

type TranslationCacheFile = {
  version: 1;
  entries: Array<TranslationCacheRecord & { updatedAt: string }>;
};

const translationCacheVersion = 1;
const maxTranslationCacheEntries = 5000;

function isNotFoundError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

async function readJson<T>(filePath: string) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

function normalizeCacheFile(payload: unknown, filePath: string): Map<string, TranslationCacheEntry> {
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as TranslationCacheFile).entries)) {
    throw new Error(`Translation cache file '${filePath}' must contain an entries array.`);
  }

  const entries = (payload as TranslationCacheFile).entries;
  const cache = new Map<string, TranslationCacheEntry>();

  for (const item of entries) {
    const key = cleanText(item?.key);
    const value = cleanText(item?.value);
    if (!key || !value) {
      continue;
    }

    cache.set(key, {
      value,
      updatedAt: typeof item.updatedAt === 'string' ? item.updatedAt : new Date(0).toISOString(),
    });
  }

  return cache;
}

function serializeCache(cache: Map<string, TranslationCacheEntry>): TranslationCacheFile {
  const entries = [...cache.entries()]
    .sort((a, b) => Date.parse(b[1].updatedAt) - Date.parse(a[1].updatedAt))
    .slice(0, maxTranslationCacheEntries)
    .map(([key, entry]) => ({
      key,
      value: entry.value,
      updatedAt: entry.updatedAt,
    }));

  return {
    version: translationCacheVersion,
    entries,
  };
}

export function createTranslationCacheStore(translationCacheFile: string): TranslationCacheStore {
  let cachePromise: Promise<Map<string, TranslationCacheEntry>> | null = null;
  let writeQueue = Promise.resolve();

  async function loadCache() {
    if (!cachePromise) {
      cachePromise = readJson<TranslationCacheFile>(
        translationCacheFile,
      ).then(payload => normalizeCacheFile(
        payload ?? { version: translationCacheVersion, entries: [] },
        translationCacheFile,
      ));
    }

    return cachePromise;
  }

  async function flushCache(cache: Map<string, TranslationCacheEntry>) {
    await writeJson(translationCacheFile, serializeCache(cache));
  }

  return {
    async loadTranslationCache(keys) {
      if (keys.length === 0) {
        return {};
      }

      const cache = await loadCache();
      const resolved: Record<string, string> = {};

      for (const key of keys) {
        const normalizedKey = cleanText(key);
        if (!normalizedKey) {
          continue;
        }

        const entry = cache.get(normalizedKey);
        if (entry) {
          resolved[normalizedKey] = entry.value;
        }
      }

      return resolved;
    },

    async saveTranslationCache(entries) {
      if (entries.length === 0) {
        return;
      }

      const cache = await loadCache();
      const updatedAt = new Date().toISOString();

      for (const item of entries) {
        const key = cleanText(item.key);
        const value = cleanText(item.value);
        if (!key || !value) {
          continue;
        }

        cache.set(key, { value, updatedAt });
      }

      writeQueue = writeQueue.then(() => flushCache(cache));
      await writeQueue;
    },
  };
}
