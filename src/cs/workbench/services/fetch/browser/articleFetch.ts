/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { JournalSourceOverride } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { isWithinDateRange, parseDateHintFromText, parseDateRange } from 'cs/base/common/date';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import { isDateRangeValid } from 'cs/workbench/common/dateRange';
import { normalizeUrl } from 'cs/workbench/common/url';
import {
  ensureBatchSourceId,
  getConfigBatchSourceSeed,
  resolveSourceTableMetadata,
  sanitizeBatchSources,
} from 'cs/workbench/services/config/configSchema';
import type { BatchSource } from 'cs/workbench/services/config/configSchema';
import type { ArticleDetail, ArticleListCatalog, ArticleListItem, ArticleListSource, ArticlePage, IFetchService, JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
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
};

export type FetchLatestArticlesBatchResult =
  | { ok: true; articles: FetchArticle[] }
  | {
      ok: false;
      error: FetchErrorData;
    };

export type FetchLatestArticlesBatchParams = {
  batchSources: ReadonlyArray<BatchSource>;
  sourceTable: ReadonlyArray<BatchSource>;
  limit?: number;
  startDate?: string | null;
  endDate?: string | null;
  fetchService: IFetchService;
  token?: CancellationToken;
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
  } = resolveSourceTableMetadata(normalizedUrl, sourceTable);

  const sourceId = ensureBatchSourceId(source.id || articleListId, index);
  const journalTitle = source.journalTitle.trim() || defaultJournalTitle || sourceId;

  return {
    dedupeKey: normalizedUrl,
    candidate: {
      sourceId,
      pageUrl: normalizedUrl,
      journalTitle,
    },
  };
}

function canImproveBatchFetchSource(existing: BatchFetchSource, candidate: BatchFetchSource) {
	return !existing.journalTitle && candidate.journalTitle;
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
  batchSources,
  sourceTable,
  limit,
  startDate,
  endDate,
  fetchService,
  token = CancellationTokenNone,
}: FetchLatestArticlesBatchParams): Promise<FetchLatestArticlesBatchResult> {
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
		const range = parseDateRange(startDate, endDate);
		const articles: FetchArticle[] = [];
		const seenArticleIds = new Set<string>();
		const failedSources: Record<string, unknown>[] = [];
		const maximum = limit ?? 50;
		for (const source of sources) {
			if (articles.length >= maximum) {
				break;
			}
			try {
				const { journal, source: articleListSource, page } = await resolveArticleListSource(fetchService, source.pageUrl, token);
				for (const item of getPageItems(page, fetchService)) {
					if (articles.length >= maximum || seenArticleIds.has(item.articleId)) {
						continue;
					}
					const date = parseDateHintFromText(item.publishedAt);
					if (!isWithinDateRange(date, range)) {
						continue;
					}
					const detail = await fetchService.fetchArticle(item.articleId, token);
					seenArticleIds.add(item.articleId);
					articles.push(toFetchArticle(detail, journal, articleListSource.id, articles.length + 1));
				}
			} catch (error) {
				failedSources.push({ sourceId: source.sourceId, pageUrl: source.pageUrl, error: error instanceof Error ? error.message : String(error) });
			}
		}
		if (articles.length === 0) {
			if (failedSources.length > 0) {
				throw fetchError(FetchErrorCode.BatchSourceFetchFailed, { failedSources });
			}
			if (range.start || range.end) {
				throw fetchError(FetchErrorCode.BatchNoMatchInDateRange, { startDate: range.start, endDate: range.end });
			}
			throw fetchError(FetchErrorCode.BatchNoValidArticles);
		}
		return { ok: true, articles };
	} catch (error) {
		return { ok: false, error: parseFetchErrorData(error) };
	}
}

async function resolveArticleListSource(fetchService: IFetchService, pageUrl: string, token: CancellationToken): Promise<{ journal: JournalDescriptor; source: ArticleListSource; page: ArticlePage }> {
	const normalizedPageUrl = normalizeUrl(pageUrl);
	for (const journal of fetchService.getJournals()) {
		await fetchService.discoverArticleListSources(journal.id, token);
		const source = findArticleListSource(fetchService.getArticleListCatalog(journal.id), normalizedPageUrl);
		if (!source) {
			continue;
		}
		await fetchService.fetchArticleListSource(source.id, token);
		const page = fetchService.getArticlePages(source.id)[0];
		if (!page) {
			throw new Error(`Article list source "${source.id}" did not produce a page.`);
		}
		return { journal, source, page };
	}
	throw new Error(`No discovered article list source matches "${pageUrl}".`);
}

function findArticleListSource(catalog: ArticleListCatalog | undefined, normalizedPageUrl: string): ArticleListSource | undefined {
	if (!catalog) {
		return undefined;
	}
	for (const entry of catalog.entries) {
		const sources = entry.kind === 'group' ? entry.sources : [entry];
		const source = sources.find(candidate => normalizeUrl(candidate.url.toString(true)) === normalizedPageUrl);
		if (source) {
			return source;
		}
	}
	return undefined;
}

function getPageItems(page: ArticlePage, fetchService: IFetchService): ArticleListItem[] {
	return [...page.groups.flatMap(group => group.itemIds), ...page.ungroupedItemIds]
		.map(itemId => fetchService.getArticleListItem(itemId))
		.filter((item): item is ArticleListItem => !!item);
}

function toFetchArticle(
	detail: ArticleDetail,
	journal: JournalDescriptor,
	articleListSourceId: string,
	fetchOrder: number,
): FetchArticle {
	return {
		sourceUri: detail.url.toJSON(),
		canonicalUri: detail.url.toJSON(),
		doi: detail.doi,
		title: detail.title,
		publication: {
			id: detail.publication.journalId ?? journal.id,
			title: detail.publication.title,
			publisherId: journal.providerId,
			publisherTitle: journal.providerId,
		},
		articleKind: 'other',
		sourceArticleType: detail.articleType,
		authors: detail.authors.map(author => ({ name: author.name })),
		abstract: detail.abstract,
		sections: [],
		figures: [],
		references: [],
		publishedAt: detail.publishedAt,
		fetchedAt: new Date().toISOString(),
		fetchOrder,
		articleListSourceId,
	};
}
