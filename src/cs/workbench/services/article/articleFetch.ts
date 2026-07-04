import type {
  Article as DesktopArticle,
  JournalSourceOverride,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { isDateRangeValid } from 'cs/workbench/common/dateRange';
import { normalizeUrl } from 'cs/workbench/common/url';
import {
  ensureBatchSourceId,
  getConfigBatchSourceSeed,
  resolveSourceTableMetadata,
  sanitizeBatchSources,
} from 'cs/workbench/services/config/configSchema';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import { parseDesktopInvokeError } from 'cs/workbench/services/desktop/desktopError';
import type { DesktopInvokeErrorData } from 'cs/workbench/services/desktop/desktopError';

export type Article = DesktopArticle;

const manualAddressBarSourceId = 'source-manual-address-bar';

type BatchFetchSource = {
  sourceId: string;
  pageUrl: string;
  journalTitle: string;
  preferredExtractorId: string | null;
};

export type FetchLatestArticlesBatchResult =
  | { ok: true; articles: Article[] }
  | {
      ok: false;
      reason: 'desktop_unsupported' | 'empty_page_url' | 'invalid_date_range' | 'fetch_failed';
      error?: DesktopInvokeErrorData;
    };

type FetchLatestArticlesBatchParams = {
  desktopRuntime: boolean;
  batchSources: ReadonlyArray<BatchSource>;
  sourceTable: ReadonlyArray<BatchSource>;
  limit?: number;
  startDate?: string | null;
  endDate?: string | null;
  fetchStrategy?: 'network-first' | 'web-content-first' | 'compare';
  invokeDesktop: ElectronInvoke;
};

function buildManualBatchSource(url: string, sourceTable: ReadonlyArray<BatchSource>): BatchSource {
  const { articleListId, defaultJournalTitle } = resolveSourceTableMetadata(url, sourceTable);

  return {
    id: manualAddressBarSourceId,
    url,
    journalTitle: defaultJournalTitle || articleListId || '',
  };
}

function toBatchFetchSourceCandidate(
  source: BatchSource,
  index: number,
  sourceTable: ReadonlyArray<BatchSource>,
): { dedupeKey: string; candidate: BatchFetchSource } | null {
  const normalizedUrl = normalizeUrl(source.url);
  if (!normalizedUrl) return null;

  const {
    articleListId,
    defaultJournalTitle,
    preferredExtractorId: matchedPreferredExtractorId,
  } = resolveSourceTableMetadata(normalizedUrl, sourceTable);

  const sourceId = ensureBatchSourceId(source.id || articleListId, index);
  const journalTitle = source.journalTitle.trim() || defaultJournalTitle || sourceId;
  const preferredExtractorId = matchedPreferredExtractorId || null;

  return {
    dedupeKey: normalizedUrl,
    candidate: {
      sourceId,
      pageUrl: normalizedUrl,
      journalTitle,
      preferredExtractorId,
    },
  };
}

function canImproveBatchFetchSource(existing: BatchFetchSource, candidate: BatchFetchSource) {
  return (!existing.journalTitle && candidate.journalTitle) || (!existing.preferredExtractorId && candidate.preferredExtractorId);
}

export function prepareBatchSourcesForFetch(
  input: unknown,
  sourceTableInput: unknown = input,
): {
  sources: BatchFetchSource[];
} {
  const sanitized = sanitizeBatchSources(input);
  const sourceTable = sanitizeBatchSources(sourceTableInput);
  const deduped = new Map<string, BatchFetchSource>();

  for (const [index, source] of sanitized.entries()) {
    const resolved = toBatchFetchSourceCandidate(source, index, sourceTable);
    if (!resolved) continue;

    const { dedupeKey, candidate } = resolved;
    const existing = deduped.get(dedupeKey);
    if (existing) {
      if (canImproveBatchFetchSource(existing, candidate)) {
        deduped.set(dedupeKey, {
          ...existing,
          journalTitle: candidate.journalTitle,
          preferredExtractorId: candidate.preferredExtractorId,
        });
      }
      continue;
    }

    deduped.set(dedupeKey, candidate);
  }

  return {
    sources: [...deduped.values()],
  };
}

export function resolveBatchFetchSources(
  addressBarUrl: string | null | undefined,
  sourceTable: ReadonlyArray<BatchSource>,
): BatchSource[] {
  const normalizedAddressBarUrl = normalizeUrl(addressBarUrl ?? '');
  return normalizedAddressBarUrl
    ? [buildManualBatchSource(normalizedAddressBarUrl, sourceTable)]
    : [];
}

function createBatchSourceFromJournalOverride(
  override: JournalSourceOverride,
  index: number,
): BatchSource {
  return {
    id: `override-${index + 1}`,
    url: override.url,
    journalTitle: override.journalTitle?.trim() ?? '',
    preferredExtractorId: override.preferredExtractorId ?? null,
  };
}

export function resolveBatchFetchSourceTable(
  journalSourceOverrides?: readonly JournalSourceOverride[],
): BatchSource[] {
  return [
    ...getConfigBatchSourceSeed(),
    ...(journalSourceOverrides ?? []).map(createBatchSourceFromJournalOverride),
  ];
}

export async function fetchLatestArticlesBatch({
  desktopRuntime,
  batchSources,
  sourceTable,
  limit: _limit,
  startDate,
  endDate,
  fetchStrategy,
  invokeDesktop,
}: FetchLatestArticlesBatchParams): Promise<FetchLatestArticlesBatchResult> {
  if (!desktopRuntime) {
    return { ok: false, reason: 'desktop_unsupported' };
  }

  const { sources } = prepareBatchSourcesForFetch(batchSources, sourceTable);
  if (sources.length === 0) {
    return { ok: false, reason: 'empty_page_url' };
  }

  const rangeStart = startDate ?? '';
  const rangeEnd = endDate ?? '';
  if (!isDateRangeValid(rangeStart, rangeEnd)) {
    return { ok: false, reason: 'invalid_date_range' };
  }

  try {
    const articles = await invokeDesktop<Article[]>('fetch_latest_articles', {
      sources,
      startDate: startDate || null,
      endDate: endDate || null,
      fetchStrategy,
    });
    return { ok: true, articles };
  } catch (error) {
    return { ok: false, reason: 'fetch_failed', error: parseDesktopInvokeError(error) };
  }
}
