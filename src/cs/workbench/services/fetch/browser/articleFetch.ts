/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	FetchTargetPreference,
  JournalSourceOverride,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
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
import {
  FetchErrorCode,
  fetchError,
  parseFetchErrorData,
  type FetchErrorData,
} from 'cs/workbench/services/fetch/common/fetchErrors';

const manualAddressBarSourceId = 'source-manual-address-bar';

type BatchFetchSource = {
  sourceId: string;
  pageUrl: string;
  journalTitle: string;
	fetchTarget: FetchTargetPreference;
};

export type FetchLatestArticlesBatchResult =
  | { ok: true; articles: FetchArticle[] }
  | { ok: false; reason: 'desktop_unsupported' }
  | {
      ok: false;
      error: FetchErrorData;
    };

type FetchLatestArticlesBatchParams = {
	requestId: string;
  desktopRuntime: boolean;
  batchSources: ReadonlyArray<BatchSource>;
  sourceTable: ReadonlyArray<BatchSource>;
  limit?: number;
  startDate?: string | null;
  endDate?: string | null;
  invokeDesktop: ElectronInvoke;
};

function buildManualBatchSource(url: string, sourceTable: ReadonlyArray<BatchSource>): BatchSource {
	const { articleListId, defaultJournalTitle, fetchTarget } = resolveSourceTableMetadata(url, sourceTable);

  return {
    id: manualAddressBarSourceId,
    url,
    journalTitle: defaultJournalTitle || articleListId || '',
		fetchTarget,
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
		fetchTarget: matchedFetchTarget,
  } = resolveSourceTableMetadata(normalizedUrl, sourceTable);

  const sourceId = ensureBatchSourceId(source.id || articleListId, index);
  const journalTitle = source.journalTitle.trim() || defaultJournalTitle || sourceId;
	const fetchTarget = matchedFetchTarget;

  return {
    dedupeKey: normalizedUrl,
    candidate: {
      sourceId,
      pageUrl: normalizedUrl,
      journalTitle,
			fetchTarget,
    },
  };
}

function canImproveBatchFetchSource(existing: BatchFetchSource, candidate: BatchFetchSource) {
  return (!existing.journalTitle && candidate.journalTitle) ||
		existing.fetchTarget !== candidate.fetchTarget;
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
					fetchTarget: candidate.fetchTarget,
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
		fetchTarget: override.fetchTarget ?? 'background',
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
	requestId,
  desktopRuntime,
  batchSources,
  sourceTable,
  limit: _limit,
  startDate,
  endDate,
  invokeDesktop,
}: FetchLatestArticlesBatchParams): Promise<FetchLatestArticlesBatchResult> {
  if (!desktopRuntime) {
    return { ok: false, reason: 'desktop_unsupported' };
  }

  const { sources } = prepareBatchSourcesForFetch(batchSources, sourceTable);
  if (sources.length === 0) {
    return { ok: false, error: parseFetchErrorData(fetchError(FetchErrorCode.BatchPageUrlsEmpty)) };
  }

  const rangeStart = startDate ?? '';
  const rangeEnd = endDate ?? '';
  if (!isDateRangeValid(rangeStart, rangeEnd)) {
    return { ok: false, error: parseFetchErrorData(fetchError(FetchErrorCode.DateRangeInvalid, { start: rangeStart, end: rangeEnd })) };
  }

  try {
    const articles = await invokeDesktop<FetchArticle[]>('fetch_latest_articles', {
		requestId,
      sources,
      startDate: startDate || null,
      endDate: endDate || null,
    });
    return { ok: true, articles };
  } catch (error) {
    return { ok: false, error: parseFetchErrorData(error) };
  }
}
