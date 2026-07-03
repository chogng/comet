import type { BatchSource as DesktopBatchSource } from 'ls/base/parts/sandbox/common/sandboxTypes';
import { sanitizeUrlInput } from 'ls/workbench/common/url';
import {
  batchLimitMax,
  batchLimitMin,
  defaultBatchLimit,
  getDefaultBatchSources,
} from 'ls/platform/configuration/common/defaultBatchSources';

export {
  batchLimitMax,
  batchLimitMin,
  defaultBatchLimit,
};

export type BatchSource = DesktopBatchSource;

export type ResolvedSourceTableMetadata = {
  lookupKey: string;
  articleListId: string;
  journalTitle: string;
  preferredExtractorId: string;
  defaultJournalTitle: string;
};

type SourceLookupMaps = {
  journalTitleByLookupKey: Map<string, string>;
  articleListIdByLookupKey: Map<string, string>;
  preferredExtractorIdByLookupKey: Map<string, string>;
};

function createSourceLookupKey(input: unknown) {
  const normalized = normalizeConfigSourceUrl(String(input ?? ''));
  if (!normalized) {
    return '';
  }

  try {
    const url = new URL(normalized);
    const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = url.pathname.replace(/\/+$/, '') || '/';
    return `${hostname}${pathname}`;
  } catch {
    return '';
  }
}

function normalizeConfigSourceUrl(input: string) {
  const trimmed = sanitizeUrlInput(input);
  if (!trimmed) {
    return '';
  }

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function randomIdSegment() {
  return Math.random().toString(36).slice(2, 10);
}

function createIndexedBatchSourceId(index: number) {
  return String(Math.max(0, Math.trunc(index)) + 1);
}

function createRandomBatchSourceId() {
  return `source-${Date.now().toString(36)}-${randomIdSegment()}`;
}

export function ensureBatchSourceId(input: unknown, fallbackIndex?: number) {
  const cleaned = String(input ?? '').trim();
  if (cleaned) return cleaned;

  if (Number.isInteger(fallbackIndex) && Number(fallbackIndex) >= 0) {
    return createIndexedBatchSourceId(Number(fallbackIndex));
  }

  return createRandomBatchSourceId();
}

export function createEmptyBatchSource(): BatchSource {
  return {
    id: createRandomBatchSourceId(),
    url: '',
    journalTitle: '',
    preferredExtractorId: null,
  };
}

export function normalizeBatchLimit(input: unknown, fallback: number = defaultBatchLimit): number {
  const parsed = Number.parseInt(String(input), 10);
  if (Number.isNaN(parsed)) return fallback;
  return Math.min(batchLimitMax, Math.max(batchLimitMin, parsed));
}

function createLookupMap<T extends string>(table: ReadonlyArray<{ url: string; value: T }>) {
  const map = new Map<string, T>();

  for (const item of table) {
    const lookupKey = createSourceLookupKey(item.url);
    if (!lookupKey || !item.value || map.has(lookupKey)) {
      continue;
    }

    map.set(lookupKey, item.value);
  }

  return map;
}

function normalizePreferredExtractorId(value: unknown): string | null {
  const cleaned = String(value ?? '').trim();
  return cleaned || null;
}

function createSourceLookupMaps(entries: ReadonlyArray<BatchSource>): SourceLookupMaps {
  return {
    journalTitleByLookupKey: createLookupMap(
      entries.map((item) => ({
        url: item.url,
        value: item.journalTitle.trim(),
      })),
    ),
    articleListIdByLookupKey: createLookupMap(
      entries.map((item) => ({
        url: item.url,
        value: item.id.trim(),
      })),
    ),
    preferredExtractorIdByLookupKey: createLookupMap(
      entries.map((item) => ({
        url: item.url,
        value: String(item.preferredExtractorId ?? '').trim(),
      })),
    ),
  };
}

const emptySourceLookupMaps: SourceLookupMaps = {
  journalTitleByLookupKey: new Map<string, string>(),
  articleListIdByLookupKey: new Map<string, string>(),
  preferredExtractorIdByLookupKey: new Map<string, string>(),
};

function resolveSourceLookupMaps(batchSources?: ReadonlyArray<BatchSource>): SourceLookupMaps {
  const sanitized = sanitizeBatchSources(batchSources);
  if (sanitized.length === 0) {
    return emptySourceLookupMaps;
  }

  return createSourceLookupMaps(sanitized);
}

function sanitizeBatchSourceEntry(value: unknown, index: number): BatchSource {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      id: '',
      url: '',
      journalTitle: '',
      preferredExtractorId: null,
    };
  }

  const record = value as Record<string, unknown>;
  const url = sanitizeUrlInput(String(record.url ?? ''));

  return {
    id: ensureBatchSourceId(record.id, index),
    url,
    journalTitle: String(record.journalTitle ?? '').trim(),
    preferredExtractorId: normalizePreferredExtractorId(record.preferredExtractorId),
  };
}

function dedupeBatchSources(sources: BatchSource[]): BatchSource[] {
  const deduped = new Map<string, BatchSource>();

  for (const source of sources) {
    const key = createSourceLookupKey(source.url) || source.url;
    const previous = deduped.get(key);
    if (!previous) {
      deduped.set(key, source);
      continue;
    }
    deduped.set(key, {
      ...previous,
      id: source.id || previous.id,
      journalTitle: source.journalTitle || previous.journalTitle,
      preferredExtractorId: source.preferredExtractorId || previous.preferredExtractorId,
    });
  }

  return [...deduped.values()];
}

export function sanitizeBatchSources(input: unknown): BatchSource[] {
  const values = Array.isArray(input) ? input : [];
  const normalized = values
    .map((value, index) => sanitizeBatchSourceEntry(value, index))
    .filter((source) => source.url);
  return dedupeBatchSources(normalized);
}

export function normalizeBatchSources(
  input: unknown,
  fallback: ReadonlyArray<BatchSource>,
): BatchSource[] {
  if (Array.isArray(input)) {
    return sanitizeBatchSources(input);
  }

  return sanitizeBatchSources(fallback);
}

export function resolveSourceTableMetadata(
  input: unknown,
  batchSources?: ReadonlyArray<BatchSource>,
): ResolvedSourceTableMetadata {
  const lookupKey = createSourceLookupKey(input);
  if (!lookupKey) {
    return {
      lookupKey: '',
      articleListId: '',
      journalTitle: '',
      preferredExtractorId: '',
      defaultJournalTitle: '',
    };
  }

  const lookupMaps = resolveSourceLookupMaps(batchSources);
  const articleListId = lookupMaps.articleListIdByLookupKey.get(lookupKey) ?? '';
  const journalTitle = lookupMaps.journalTitleByLookupKey.get(lookupKey) ?? '';
  const preferredExtractorId = lookupMaps.preferredExtractorIdByLookupKey.get(lookupKey) ?? '';

  return {
    lookupKey,
    articleListId,
    journalTitle,
    preferredExtractorId,
    defaultJournalTitle: journalTitle || articleListId,
  };
}

export function resolveDefaultJournalTitleFromSourceUrl(
  input: unknown,
  batchSources?: ReadonlyArray<BatchSource>,
) {
  return resolveSourceTableMetadata(input, batchSources).defaultJournalTitle;
}

type ConfigBatchSourceResolution = {
  batchSources: BatchSource[];
};

const configBatchSourceSeed: ReadonlyArray<BatchSource> = getDefaultBatchSources();

export function getConfigBatchSourceSeed(): BatchSource[] {
  return configBatchSourceSeed.map((source) => ({
    id: source.id,
    url: source.url,
    journalTitle: source.journalTitle,
    preferredExtractorId: normalizePreferredExtractorId(source.preferredExtractorId),
  }));
}

function createConfigBatchSourceResolution(
  input: unknown,
  fallback: ReadonlyArray<BatchSource> = configBatchSourceSeed,
): ConfigBatchSourceResolution {
  return {
    batchSources: normalizeBatchSources(input, fallback),
  };
}

export function resolveConfigBatchSources(
  input: unknown,
  fallback: ReadonlyArray<BatchSource> = configBatchSourceSeed,
): BatchSource[] {
  return createConfigBatchSourceResolution(input, fallback).batchSources;
}
