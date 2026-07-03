import path from 'node:path';
import { promises as fs } from 'node:fs';

import type { Article } from 'ls/base/parts/sandbox/common/sandboxTypes';
import type { StorageService } from 'ls/platform/storage/common/storage';

type HistoryStore = Pick<StorageService, 'saveFetchedArticles'>;

async function readJson<T>(filePath: string, fallbackValue: T) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw) as T;
  } catch {
    return fallbackValue;
  }
}

async function writeJson(filePath: string, value: unknown) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), 'utf8');
}

export function createHistoryStore(historyFile: string): HistoryStore {
  async function readHistory() {
    const payload = await readJson<Article[]>(historyFile, []);
    return Array.isArray(payload) ? payload : [];
  }

  async function writeHistory(items: Article[]) {
    await writeJson(historyFile, items);
  }

  return {
    async saveFetchedArticles(items) {
      // Note: this file currently behaves like a raw fetch history cache.
      // For article collection workflows, fetched articles should not always be retained.
      // A later review/filtering step may decide whether an article belongs to the target domain:
      // out-of-domain articles should be discarded, while in-domain articles can be promoted into
      // a persistent database. That decision, and the actual persistence, may require human-assisted
      // review and should likely only append into the long-term store when a dedicated mode is enabled.
      const previous = await readHistory();
      const next = [...items, ...previous];
      const seen = new Set<string>();
      const deduped: Article[] = [];

      for (const item of next) {
        const key = `${item.sourceId ?? ''}::${item.sourceUrl}::${item.fetchedAt}`;
        if (seen.has(key)) continue;
        seen.add(key);
        deduped.push(item);
      }

      await writeHistory(deduped);
    },
  };
}
