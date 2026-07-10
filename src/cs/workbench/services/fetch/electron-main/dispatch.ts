import { load } from 'cheerio';

import type {
  Article,
	ArticlePageProof,
	FetchFailureReason,
  FetchLatestArticlesPayload,
  FetchStatus,
	FetchTargetPreference,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import type { HistoryStore } from 'cs/platform/storage/electron-main/historyStore';
import { parseDateRange, parseDateHintFromText } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';

import { cleanText } from 'cs/base/common/strings';
import { normalizeNatureMainSiteListingUrl, normalizeUrl } from 'cs/base/common/url';
import { collectCandidateDescriptorsFromSeeds as collectListingCandidateDescriptorsFromSeeds } from 'cs/workbench/services/fetch/electron-main/listing/candidates';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import { requestWithBrowserSession } from 'cs/platform/request/electron-main/requestMainService';
import {
  batchLimitMax,
  batchLimitMin,
  defaultBatchLimit,
} from 'cs/platform/configuration/common/defaultBatchSources';
import {
  createFetchTraceId,
  elapsedMs,
  getCompatFetchEnvValueOrDefault,
  shortenForLog,
  timingLog,
} from 'cs/platform/fetch/node/fetchTiming';
import { detect } from 'cs/workbench/services/fetch/electron-main/detect';
import { fetchDetail } from 'cs/workbench/services/fetch/electron-main/fetchDetail';
import { fetchListing } from 'cs/workbench/services/fetch/electron-main/fetchListing';
import { ArticleFetchService } from 'cs/workbench/services/fetch/electron-main/articleFetchService';
import type {
	FetchTargetProvider,
	FetchTargetSession,
} from 'cs/workbench/services/fetch/electron-main/fetchTargetProvider';
import { resolvePublisherProfile } from 'cs/workbench/services/fetch/electron-main/publisherResolver';
import { findListingCandidateExtractor, normalizeListingCandidateSeeds } from 'cs/workbench/services/fetch/electron-main/sourceExtractors';
import type { ListingCandidateExtraction, ListingCandidateExtractor, ListingCandidateSeed } from 'cs/workbench/services/fetch/electron-main/sourceExtractors';

import {
  FetchErrorCode,
  fetchError,
  getFetchErrorCode,
  getFetchErrorDetails,
} from 'cs/workbench/services/fetch/common/fetchErrors';
import type {
  CandidateCollectionResult,
  FetchLatestArticlesOptions,
	FetchStatusUpdate,
  PageFetchResult,
} from 'cs/workbench/services/fetch/electron-main/sourcePageFetchTypes';

const SYSTEM_BATCH_LIMIT_MAX = batchLimitMax;
const USER_BATCH_LIMIT_MIN = batchLimitMin;
const DEFAULT_USER_BATCH_LIMIT = defaultBatchLimit;
const DEFAULT_FETCH_TIMEOUT_MS = 12000;
const PAGE_FETCH_TIMEOUT_MS = 12000;
const ARTICLE_FETCH_TIMEOUT_MS = 12000;
const WEB_CONTENTS_VIEW_FETCH_TIMEOUT_MS = 3 * 60 * 1000;
const CANDIDATE_FETCH_CONCURRENCY = 12;
const EXTRACTOR_CANDIDATE_FETCH_CONCURRENCY = 8;
const SOURCE_FETCH_CONCURRENCY = 1;
const MIN_CANDIDATE_ATTEMPTS = 12;
const ATTEMPTS_PER_LIMIT = 4;
const EXTRACTOR_ATTEMPTS_MULTIPLIER = 1.25;
const EXTRACTOR_ATTEMPTS_MIN_BUFFER = 6;
const EXTRACTOR_FAST_ATTEMPTS_MULTIPLIER = 1.1;
const EXTRACTOR_FAST_ATTEMPTS_MIN_BUFFER = 4;
const DATE_HINT_HIGH_COVERAGE_THRESHOLD = 0.65;
const RETRY_PRIORITY_MIN_ORDER = 6;
const RETRY_PRIORITY_LIMIT_MULTIPLIER = 1.2;
const CANDIDATE_DATE_HINT_PARENT_DEPTH = 4;
const CANDIDATE_DATE_HINT_TEXT_MAX_LENGTH = 320;
const MIN_SORTED_DATE_HINTS_FOR_EARLY_STOP = 3;
const MIN_CONSECUTIVE_OLDER_DATE_HINTS_FOR_EARLY_STOP = 4;
const IN_RANGE_DATE_HINT_SCORE_BOOST = 40;
const HTML_FETCH_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const BROWSER_FETCH_PARTITION = WORKBENCH_SHARED_WEB_PARTITION;
const HTML_FETCH_TRANSPORT =
  getCompatFetchEnvValueOrDefault(
    'LS_FETCH_TRANSPORT',
    'READER_FETCH_TRANSPORT',
    'browser',
  ) === 'node'
		? 'node'
		: 'browser';
const MAX_PAGINATED_PAGE_COUNT = 20;

type FetchHtmlOptions = {
  timeoutMs?: number;
  traceId?: string;
  stage?: string;
  signal?: AbortSignal;
};

type FetchStorageService = AppSettingsConfigurationService & HistoryStore;

type PageSource = {
  sourceId: string;
  pageUrl: string;
  journalTitle: string;
  preferredExtractorId: string | null;
	fetchTarget: FetchTargetPreference;
};

type CheerioAcceptedNode = Parameters<ReturnType<typeof load>>[0];

function normalizeSourceId(input: unknown, index: number) {
  const cleaned = cleanText(input);
  if (cleaned) return cleaned;

  return String(index + 1);
}

function safeNormalizeUrl(value: string) {
  try {
    return normalizeUrl(value);
  } catch {
    return '';
  }
}

function resolvePayloadSourcePageUrl(source: { pageUrl?: unknown } | null | undefined) {
  return safeNormalizeUrl(cleanText(source?.pageUrl ?? ''));
}

function toTimeoutMs(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function normalizeBatchLimitValue(value: unknown, fallback: number = DEFAULT_USER_BATCH_LIMIT) {
  const parsed = Number.parseInt(String(value), 10);
  if (Number.isNaN(parsed)) {
    return Math.min(SYSTEM_BATCH_LIMIT_MAX, Math.max(USER_BATCH_LIMIT_MIN, fallback));
  }
  return Math.min(SYSTEM_BATCH_LIMIT_MAX, Math.max(USER_BATCH_LIMIT_MIN, parsed));
}

async function resolveConfiguredUserBatchLimit(storage: FetchStorageService) {
  try {
    const settings = await storage.loadSettings();
    return normalizeBatchLimitValue(settings?.defaultBatchLimit, DEFAULT_USER_BATCH_LIMIT);
  } catch {
    return DEFAULT_USER_BATCH_LIMIT;
  }
}

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null;
}

function readArticlePageProof(value: unknown): ArticlePageProof | null {
	if (!isRecord(value)) {
		return null;
	}
	if (
		typeof value.canonicalUrlMatched !== 'boolean' ||
		typeof value.titleFound !== 'boolean' ||
		typeof value.authorsFound !== 'boolean' ||
		typeof value.abstractFound !== 'boolean' ||
		typeof value.bodyFound !== 'boolean'
	) {
		return null;
	}
	return value as unknown as ArticlePageProof;
}

function resolveFetchFailureReason(error: unknown): FetchFailureReason {
	const code = getFetchErrorCode(error);
	const details = getFetchErrorDetails(error);
	const status = details?.status ?? details?.statusCode;
	if (
		code === FetchErrorCode.InteractiveTargetTimedOut ||
		status === 'TIMEOUT'
	) {
		return 'loadTimeout';
	}
	if (status === 429 || status === '429') {
		return 'rateLimited';
	}
	if (status === 403 || status === '403') {
		return 'accessDenied';
	}
	if (status === 'JAVASCRIPT_ERROR') {
		return 'javascriptError';
	}
	if (code === FetchErrorCode.ArticlePageRejected) {
		return 'articleProofFailed';
	}
	if (code === FetchErrorCode.ListingPageRejected) {
		return 'listingProofFailed';
	}
	return 'navigationFailed';
}

function buildHtmlFetchHeaders() {
  return {
    accept: HTML_FETCH_ACCEPT,
  };
}

function collectHttpErrorResponseHeaders(response: Response) {
  const responseHeaders = {
    server: cleanText(response.headers.get('server')),
    cfMitigated: cleanText(response.headers.get('cf-mitigated')),
    cfRay: cleanText(response.headers.get('cf-ray')),
  };

  return Object.values(responseHeaders).some((value) => Boolean(value)) ? responseHeaders : null;
}

async function requestHtml({
  url,
  signal,
}: {
  url: string;
  signal: AbortSignal;
}) {
	const headers = buildHtmlFetchHeaders();
	if (HTML_FETCH_TRANSPORT === 'node') {
		return {
			response: await fetch(url, { signal, headers }),
			transport: HTML_FETCH_TRANSPORT,
		};
	}

	return {
		response: await requestWithBrowserSession({
			url,
			signal,
			headers,
			partition: BROWSER_FETCH_PARTITION,
		}),
		transport: HTML_FETCH_TRANSPORT,
	};
}

function extractDateHintFromElement($: ReturnType<typeof load>, node: CheerioAcceptedNode) {
  const element = $(node);
  const directValues = [
    element.attr('datetime'),
    element.attr('content'),
    element.attr('aria-label'),
    element.attr('title'),
  ];
  for (const value of directValues) {
    const parsed = parseDateHintFromText(value);
    if (parsed) return parsed;
  }

  const nestedDateElement = element
    .find(
      'time[datetime], [datetime], [itemprop="datePublished"], meta[property="article:published_time"], meta[name="dc.date"], meta[name="prism.publicationDate"]',
    )
    .first();
  if (nestedDateElement.length > 0) {
    const nestedValues = [
      nestedDateElement.attr('datetime'),
      nestedDateElement.attr('content'),
      nestedDateElement.text(),
      nestedDateElement.attr('aria-label'),
      nestedDateElement.attr('title'),
    ];
    for (const value of nestedValues) {
      const parsed = parseDateHintFromText(value);
      if (parsed) return parsed;
    }
  }

  const text = cleanText(element.text());
  if (text && text.length <= CANDIDATE_DATE_HINT_TEXT_MAX_LENGTH) {
    return parseDateHintFromText(text);
  }

  return null;
}

function extractCandidateDateHint($: ReturnType<typeof load>, node: CheerioAcceptedNode) {
  let current = $(node);
  for (let depth = 0; depth <= CANDIDATE_DATE_HINT_PARENT_DEPTH && current.length > 0; depth += 1) {
    const currentNode = current.get(0);
    if (currentNode) {
      const parsed = extractDateHintFromElement($, currentNode);
      if (parsed) return parsed;
    }
    current = current.parent();
  }

  return null;
}

function buildGenericCandidateSeeds($: ReturnType<typeof load>) {
  return normalizeListingCandidateSeeds(
    $('a[href]')
      .toArray()
      .map((node, order) => ({
        href: cleanText($(node).attr('href')),
        order,
        dateHint: extractCandidateDateHint($, node),
      })),
  );
}

function collectCandidateDescriptorsFromSeeds(
  page: URL,
  pageUrl: string,
  dateRange: DateRange,
  seeds: ListingCandidateSeed[],
): CandidateCollectionResult {
  const result = collectListingCandidateDescriptorsFromSeeds(
    page,
    pageUrl,
    dateRange,
    normalizeListingCandidateSeeds(seeds),
    {
      inRangeDateHintScoreBoost: IN_RANGE_DATE_HINT_SCORE_BOOST,
      minSortedDateHintsForEarlyStop: MIN_SORTED_DATE_HINTS_FOR_EARLY_STOP,
      minConsecutiveOlderDateHintsForEarlyStop:
        MIN_CONSECUTIVE_OLDER_DATE_HINTS_FOR_EARLY_STOP,
    },
  );

  return {
    ...result,
    extractorId: null,
    extractorDiagnostics: null,
    paginationStopEvaluation: null,
  };
}

function evaluateExtractorPaginationStop({
  extractor,
  page,
  pageUrl,
  pageNumber,
  dateRange,
  extraction,
}: {
  extractor: ListingCandidateExtractor;
  page: URL;
  pageUrl: string;
  pageNumber: number;
  dateRange: DateRange;
  extraction: ListingCandidateExtraction;
}) {
  if (!extractor.evaluatePaginationStop) {
    return null;
  }

  return (
    extractor.evaluatePaginationStop({
      page,
      pageUrl,
      pageNumber,
      dateRange,
      extraction,
    }) ?? null
  );
}

async function collectListingCandidateDescriptors(
  page: URL,
  pageUrl: string,
  $: ReturnType<typeof load>,
  extractor: ListingCandidateExtractor | null,
  dateRange: DateRange,
  traceId: string,
  pageNumber: number,
): Promise<CandidateCollectionResult> {
  if (extractor) {
    let extracted = extractor.extract({
      page,
      pageUrl,
      $,
    });
    if (extracted && extracted.candidates.length > 0 && extractor.refineExtraction) {
      const refined = await extractor.refineExtraction({
        page,
        pageUrl,
        $,
        pageNumber,
        traceId,
        dateRange,
        extraction: extracted,
        fetchHtml,
      });
      if (refined && refined.candidates.length > 0) {
        extracted = refined;
      }
    }
    if (extracted && extracted.candidates.length > 0) {
      const paginationStopEvaluation = evaluateExtractorPaginationStop({
        extractor,
        page,
        pageUrl,
        pageNumber,
        dateRange,
        extraction: extracted,
      });
      const result = collectCandidateDescriptorsFromSeeds(
        page,
        pageUrl,
        dateRange,
        extracted.candidates,
      );
      return {
        ...result,
        extractorId: extractor.id,
        extractorDiagnostics: extracted.diagnostics ?? null,
        paginationStopEvaluation,
      };
    }

		return {
			...collectCandidateDescriptorsFromSeeds(
				page,
				pageUrl,
				dateRange,
				[],
			),
			extractorId: extractor.id,
			extractorDiagnostics: extracted?.diagnostics ?? null,
			paginationStopEvaluation: null,
		};
  }

  return collectCandidateDescriptorsFromSeeds(
    page,
    pageUrl,
    dateRange,
    buildGenericCandidateSeeds($),
  );
}

async function fetchLatestArticlesFromPageOnce({
  sourceId,
  pageUrl,
  journalTitle,
  preferredExtractorId,
  remainingLimit,
  dateRange,
  traceId,
  options,
  fetchedSourceUrls,
  seenPageUrls,
  pageNumber,
	targetSession,
	articleFetchService,
}: {
  sourceId: string;
  pageUrl: string;
  journalTitle: string;
  preferredExtractorId: string | null;
  remainingLimit: number;
  dateRange: DateRange;
  traceId: string;
  options: FetchLatestArticlesOptions;
  fetchedSourceUrls: Set<string>;
  seenPageUrls: ReadonlySet<string>;
  pageNumber: number;
	targetSession: FetchTargetSession;
	articleFetchService: ArticleFetchService;
}): Promise<PageFetchResult> {
  const page = new URL(pageUrl);
  const sourcePageType = detect(page);
  const extractor =
    sourcePageType.type === 'listing' ? findListingCandidateExtractor(page, preferredExtractorId) : null;
	const reportFetchStatus = (update: FetchStatusUpdate) => {
    const reporter = options.onFetchStatus;
    if (typeof reporter !== 'function') return;
		const publisher = resolvePublisherProfile(pageUrl);
		reporter({
			requestId: options.requestId,
      sourceId,
      pageUrl,
      pageNumber,
			publisherId: publisher.id,
			publisherAccessRisk: publisher.accessRisk,
      extractorId: extractor?.id ?? null,
			...update,
		} as FetchStatus);
  };
	reportFetchStatus({
		phase: 'loading',
		targetMode: targetSession.targetMode,
		targetId: targetSession.targetId,
		articleProof: null,
	});
  if (sourcePageType.type === 'detail') {
    return fetchDetail({
      sourceId,
      pageUrl,
      journalTitle,
      remainingLimit,
      dateRange,
			targetSession,
			articleFetchService,
			reportFetchStatus,
			backgroundTimeoutMs: ARTICLE_FETCH_TIMEOUT_MS,
			webContentsViewTimeoutMs: WEB_CONTENTS_VIEW_FETCH_TIMEOUT_MS,
    });
  }

  return fetchListing({
    sourceId,
    page,
    pageUrl,
    journalTitle,
    extractor,
    remainingLimit,
    dateRange,
    traceId,
    fetchedSourceUrls,
    seenPageUrls,
    pageNumber,
		targetSession,
		articleFetchService,
    collectListingCandidateDescriptors,
    timingLog,
    elapsedMs,
    shortenForLog,
		reportFetchStatus,
    candidatePlanConfig: {
      minCandidateAttempts: MIN_CANDIDATE_ATTEMPTS,
      attemptsPerLimit: ATTEMPTS_PER_LIMIT,
      extractorAttemptsMultiplier: EXTRACTOR_ATTEMPTS_MULTIPLIER,
      extractorAttemptsMinBuffer: EXTRACTOR_ATTEMPTS_MIN_BUFFER,
      fastExtractorAttemptsMultiplier: EXTRACTOR_FAST_ATTEMPTS_MULTIPLIER,
      fastExtractorAttemptsMinBuffer: EXTRACTOR_FAST_ATTEMPTS_MIN_BUFFER,
      dateHintHighCoverageThreshold: DATE_HINT_HIGH_COVERAGE_THRESHOLD,
      extractorCandidateFetchConcurrency: EXTRACTOR_CANDIDATE_FETCH_CONCURRENCY,
      candidateFetchConcurrency: CANDIDATE_FETCH_CONCURRENCY,
      retryPriorityMinOrder: RETRY_PRIORITY_MIN_ORDER,
      retryPriorityLimitMultiplier: RETRY_PRIORITY_LIMIT_MULTIPLIER,
			pageTimeoutMs: PAGE_FETCH_TIMEOUT_MS,
			articleTimeoutMs: ARTICLE_FETCH_TIMEOUT_MS,
			webContentsViewTimeoutMs: WEB_CONTENTS_VIEW_FETCH_TIMEOUT_MS,
    },
  });
}

export async function fetchHtml(url: string, options: FetchHtmlOptions = {}) {
  const traceId = cleanText(options.traceId) || 'fetch';
  const stage = cleanText(options.stage) || 'html';
  const timeoutMs = toTimeoutMs(options.timeoutMs, DEFAULT_FETCH_TIMEOUT_MS);
  const requestStartedAt = Date.now();
  const controller = new AbortController();
  let abortedByExternalSignal = false;
  const externalSignal = options.signal;
  const abortFromExternalSignal = () => {
    abortedByExternalSignal = true;
    controller.abort();
  };

  if (externalSignal?.aborted) {
    abortFromExternalSignal();
  } else if (externalSignal) {
    externalSignal.addEventListener('abort', abortFromExternalSignal, { once: true });
  }

  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const { response, transport } = await requestHtml({
      url,
      signal: controller.signal,
    });

    if (!response.ok) {
      const responseHeaders = collectHttpErrorResponseHeaders(response);
      timingLog(traceId, `${stage}:http_error`, {
        ms: elapsedMs(requestStartedAt),
        status: response.status,
        statusText: response.statusText,
        timeoutMs,
        transport,
        url: shortenForLog(url),
        responseHeaders,
      });
      throw fetchError(FetchErrorCode.HttpRequestFailed, {
        status: response.status,
        statusText: response.statusText,
        url,
        responseHeaders: responseHeaders ?? undefined,
      });
    }

    const html = await response.text();
    timingLog(traceId, `${stage}:ok`, {
      ms: elapsedMs(requestStartedAt),
      status: response.status,
      timeoutMs,
      transport,
      url: shortenForLog(url),
      size: html.length,
    });
    return html;
  } catch (error) {
    if (getFetchErrorCode(error)) {
      throw error;
    }

    if (isAbortError(error)) {
      if (abortedByExternalSignal) {
        timingLog(traceId, `${stage}:aborted`, {
          ms: elapsedMs(requestStartedAt),
          timeoutMs,
          url: shortenForLog(url),
        });
        throw fetchError(FetchErrorCode.HttpRequestFailed, {
          status: 'ABORTED',
          statusText: 'Request aborted',
          url,
        });
      }

      timingLog(traceId, `${stage}:timeout`, {
        ms: elapsedMs(requestStartedAt),
        timeoutMs,
        url: shortenForLog(url),
      });
      throw fetchError(FetchErrorCode.HttpRequestFailed, {
        status: 'TIMEOUT',
        statusText: `Request timed out after ${timeoutMs}ms`,
        url,
      });
    }

    timingLog(traceId, `${stage}:network_error`, {
      ms: elapsedMs(requestStartedAt),
      timeoutMs,
      url: shortenForLog(url),
      message: error instanceof Error ? error.message : String(error),
    });
    throw fetchError(FetchErrorCode.HttpRequestFailed, {
      status: 'NETWORK_ERROR',
      statusText: error instanceof Error ? error.message : String(error),
      url,
    });
  } finally {
    if (externalSignal) {
      externalSignal.removeEventListener('abort', abortFromExternalSignal);
    }
    clearTimeout(timeoutId);
  }
}

export async function fetchArticle(
	urlValue: unknown,
	storage: FetchStorageService,
	options: {
		requestId: string;
		fetchTarget: FetchTargetPreference;
		targetProvider: FetchTargetProvider;
		onFetchStatus?: (status: FetchStatus) => void;
	},
) {
  const traceId = createFetchTraceId('single');
  const totalStartedAt = Date.now();
  const normalized = normalizeUrl(urlValue);
  timingLog(traceId, 'fetch_article:start', {
    url: shortenForLog(normalized),
  });

  try {
		const publisher = resolvePublisherProfile(normalized);
		const targetSession = options.targetProvider.createSession(
			{
				sourceId: 'single',
				pageUrl: normalized,
				fetchTarget: options.fetchTarget,
			},
			{
				onWebContentsViewRequired: (targetId, pageUrl) => {
					options.onFetchStatus?.({
						requestId: options.requestId,
						sourceId: 'single',
						pageUrl,
						pageNumber: 1,
						publisherId: publisher.id,
						publisherAccessRisk: publisher.accessRisk,
						extractorId: null,
						phase: 'targetRequired',
						targetMode: 'webContentsView',
						targetId,
						articleProof: null,
					});
				},
			},
		);
		const parseStartedAt = Date.now();
		const result = await new ArticleFetchService().fetch({
			pageUrl: normalized,
			targetSession,
			backgroundTimeoutMs: ARTICLE_FETCH_TIMEOUT_MS,
			webContentsViewTimeoutMs: WEB_CONTENTS_VIEW_FETCH_TIMEOUT_MS,
		});
		const article = result.article;
    timingLog(traceId, 'fetch_article:parsed', {
      ms: elapsedMs(parseStartedAt),
      hasTitle: Boolean(article.title),
      hasDoi: Boolean(article.doi),
      hasAbstract: Boolean(article.abstractText),
      hasDescription: Boolean(article.descriptionText),
      authorCount: article.authors.length,
      publishedAt: article.publishedAt,
			targetMode: targetSession.targetMode,
			proof: result.proof,
    });

    const saveStartedAt = Date.now();
    await storage.saveFetchedArticles([article]);
    timingLog(traceId, 'fetch_article:saved', {
      ms: elapsedMs(saveStartedAt),
      count: 1,
    });
    timingLog(traceId, 'fetch_article:done', {
      totalMs: elapsedMs(totalStartedAt),
    });
    return article;
  } catch (error) {
    timingLog(traceId, 'fetch_article:failed', {
      totalMs: elapsedMs(totalStartedAt),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function normalizePageSources(payload: FetchLatestArticlesPayload): PageSource[] {
  const payloadSources = Array.isArray(payload.sources) ? payload.sources : [];
  const mapped = payloadSources
    .map((item, index) => {
      const pageUrl = resolvePayloadSourcePageUrl(item);
      if (!pageUrl) return null;

      const normalizedPageUrl = normalizeNatureMainSiteListingUrl(pageUrl);

      return {
        sourceId: normalizeSourceId(item?.sourceId, index),
        pageUrl: normalizedPageUrl,
        journalTitle: cleanText(item?.journalTitle),
        preferredExtractorId: cleanText(item?.preferredExtractorId) || null,
				fetchTarget: item?.fetchTarget === 'webContentsView'
					? 'webContentsView'
					: 'background',
      } satisfies PageSource;
    })
    .filter((source): source is PageSource => Boolean(source));
  const deduped = new Map<string, PageSource>();

  for (const source of mapped) {
    const existing = deduped.get(source.pageUrl);
    if (!existing) {
      deduped.set(source.pageUrl, source);
      continue;
    }

    if (!existing.journalTitle && source.journalTitle) {
      deduped.set(source.pageUrl, source);
      continue;
    }

    if (!existing.preferredExtractorId && source.preferredExtractorId) {
      deduped.set(source.pageUrl, source);
			continue;
		}

		if (existing.fetchTarget !== source.fetchTarget) {
			deduped.set(source.pageUrl, source);
    }
  }

  return [...deduped.values()];
}

async function fetchLatestArticlesFromPage(
  sourceId: string,
  pageUrl: string,
  journalTitle: string,
  preferredExtractorId: string | null,
	fetchTarget: FetchTargetPreference,
  perSourceLimit: number,
  dateRange: DateRange,
  traceId: string,
  options: FetchLatestArticlesOptions,
): Promise<Article[]> {
  const sourceStartedAt = Date.now();
	let activePageNumber = 1;
	let activePageUrl = pageUrl;
	let targetSession: FetchTargetSession | null = null;
  timingLog(traceId, 'source:start', {
    sourceId,
    pageUrl: shortenForLog(pageUrl),
    preferredExtractorId,
		fetchTarget,
    perSourceLimit,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
  });

  try {
		const articleFetchService = new ArticleFetchService();
		targetSession = options.targetProvider.createSession(
			{
				sourceId,
				pageUrl,
				fetchTarget,
			},
			{
				onWebContentsViewRequired: (targetId, targetPageUrl) => {
					const reporter = options.onFetchStatus;
					if (!reporter) {
						return;
					}
					const publisher = resolvePublisherProfile(targetPageUrl);
					reporter({
						requestId: options.requestId,
						sourceId,
						pageUrl: targetPageUrl,
						pageNumber: activePageNumber,
						publisherId: publisher.id,
						publisherAccessRisk: publisher.accessRisk,
						extractorId: preferredExtractorId,
						phase: 'targetRequired',
						targetMode: 'webContentsView',
						targetId,
						articleProof: null,
					});
				},
			},
		);
    const fetched: Article[] = [];
    const fetchedSourceUrls = new Set<string>();
    const seenPageUrls = new Set<string>();
    let pageCount = 0;
    let totalCandidateAttempted = 0;
    let totalCandidateResolved = 0;
    let totalCandidateAccepted = 0;
    let usedPageOnly = false;
		let lastTargetMode: FetchTargetPreference = fetchTarget;
    let currentPageUrl: string | null = pageUrl;

    while (currentPageUrl && fetched.length < perSourceLimit && pageCount < MAX_PAGINATED_PAGE_COUNT) {
      const normalizedPageUrl = new URL(currentPageUrl).toString();
			activePageUrl = normalizedPageUrl;
      if (seenPageUrls.has(normalizedPageUrl)) {
        timingLog(traceId, 'source:pagination_loop_detected', {
          pageCount,
          pageUrl: shortenForLog(normalizedPageUrl),
        });
        break;
      }

      seenPageUrls.add(normalizedPageUrl);
      pageCount += 1;
			activePageNumber = pageCount;

      const pageResult = await fetchLatestArticlesFromPageOnce({
        sourceId,
        pageUrl: normalizedPageUrl,
        journalTitle,
        preferredExtractorId,
        remainingLimit: perSourceLimit - fetched.length,
        dateRange,
        traceId,
        options,
        fetchedSourceUrls,
        seenPageUrls,
        pageNumber: pageCount,
			targetSession,
			articleFetchService,
      });

			lastTargetMode = pageResult.targetMode;
      totalCandidateAttempted += pageResult.candidateAttempted;
      totalCandidateResolved += pageResult.candidateResolved;
      totalCandidateAccepted += pageResult.candidateAccepted;
      usedPageOnly = usedPageOnly || pageResult.usedPageOnly;

      for (const article of pageResult.articles) {
        if (fetched.length >= perSourceLimit) break;
        fetched.push(article);
      }

      if (fetched.length >= perSourceLimit) {
        break;
      }

      if (!pageResult.nextPageUrl) {
        break;
      }

      timingLog(traceId, 'source:pagination_continue', {
        currentPageNumber: pageCount,
        nextPageUrl: shortenForLog(pageResult.nextPageUrl),
        fetchedCount: fetched.length,
      });
      currentPageUrl = pageResult.nextPageUrl;
    }

    if (pageCount >= MAX_PAGINATED_PAGE_COUNT && currentPageUrl && fetched.length < perSourceLimit) {
      timingLog(traceId, 'source:pagination_page_limit_reached', {
        pageCount,
        maxPageCount: MAX_PAGINATED_PAGE_COUNT,
        fetchedCount: fetched.length,
      });
    }

    timingLog(traceId, 'source:done', {
      totalMs: elapsedMs(sourceStartedAt),
			targetMode: lastTargetMode,
      pageCount,
      fetchedCount: fetched.length,
      candidateAttempted: totalCandidateAttempted,
      candidateResolved: totalCandidateResolved,
      candidateAccepted: totalCandidateAccepted,
      usedPageOnly,
      paginated: pageCount > 1,
    });
    return fetched;
  } catch (error) {
		const details = getFetchErrorDetails(error);
		const publisher = resolvePublisherProfile(activePageUrl);
		options.onFetchStatus?.({
			requestId: options.requestId,
			sourceId,
			pageUrl: activePageUrl,
			pageNumber: activePageNumber,
			publisherId: publisher.id,
			publisherAccessRisk: publisher.accessRisk,
			extractorId: preferredExtractorId,
			phase: 'failed',
			targetMode: targetSession?.targetMode ?? fetchTarget,
			targetId: targetSession?.targetId ?? null,
			failureReason: resolveFetchFailureReason(error),
			articleProof: readArticlePageProof(details?.proof),
		});
    timingLog(traceId, 'source:failed', {
      totalMs: elapsedMs(sourceStartedAt),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchLatestArticles(
	payload: FetchLatestArticlesPayload,
  storage: FetchStorageService,
	options: FetchLatestArticlesOptions,
) {
  const traceId = createFetchTraceId('batch');
  const totalStartedAt = Date.now();
  const pageSources = normalizePageSources(payload);
  if (pageSources.length === 0) {
    throw fetchError(FetchErrorCode.BatchPageUrlsEmpty);
  }

  const configuredUserLimit = await resolveConfiguredUserBatchLimit(storage);
  // Per-source cap comes only from persisted user settings.
  const perSourceLimit = configuredUserLimit;
  const dateRange = parseDateRange(payload.startDate ?? null, payload.endDate ?? null);
  const fetched: Article[] = [];
  const seenSourceUrls = new Set<string>();
  const failedSources: Array<Record<string, unknown>> = [];
  let rawFetchedCount = 0;
  timingLog(traceId, 'batch:start', {
    sourceCount: pageSources.length,
    perSourceLimit,
    configuredUserLimit,
    systemLimit: SYSTEM_BATCH_LIMIT_MAX,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
		fetchTargets: pageSources.map(source => ({
			sourceId: source.sourceId,
			fetchTarget: source.fetchTarget,
		})),
  });

  for (let index = 0; index < pageSources.length; index += SOURCE_FETCH_CONCURRENCY) {
    const batch = pageSources.slice(index, index + SOURCE_FETCH_CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (source) => {
        try {
          const pageArticles = await fetchLatestArticlesFromPage(
            source.sourceId,
            source.pageUrl,
            source.journalTitle,
            source.preferredExtractorId,
				source.fetchTarget,
            perSourceLimit,
            dateRange,
            `${traceId}:${source.sourceId}`,
            options,
          );

          return {
            ok: true as const,
            source,
            articles: pageArticles,
          };
        } catch (error) {
          return {
            ok: false as const,
            source,
            error,
          };
        }
      }),
    );

    for (const result of settled) {
      if (result.ok) {
        const { articles } = result;
        rawFetchedCount += articles.length;
        timingLog(traceId, 'batch:source_ok', {
          sourceId: result.source.sourceId,
          sourceUrl: shortenForLog(result.source.pageUrl),
          fetchedCount: articles.length,
        });
        for (const article of articles) {
          const dedupeKey = `${article.sourceId ?? ''}::${article.sourceUrl}`;
          if (seenSourceUrls.has(dedupeKey)) continue;
          seenSourceUrls.add(dedupeKey);
          fetched.push(article);
        }
        continue;
      }

      const { source, error } = result;
      timingLog(traceId, 'batch:source_failed', {
        sourceId: source.sourceId,
        sourceUrl: shortenForLog(source.pageUrl),
        message: error instanceof Error ? error.message : String(error),
      });
      if (getFetchErrorCode(error)) {
        failedSources.push({
          sourceId: source.sourceId,
          pageUrl: source.pageUrl,
          code: getFetchErrorCode(error),
          details: getFetchErrorDetails(error),
        });
      } else {
        failedSources.push({
          sourceId: source.sourceId,
          pageUrl: source.pageUrl,
          code: 'UNKNOWN_ERROR',
          details: { message: error instanceof Error ? error.message : String(error) },
        });
      }
    }
  }

  if (fetched.length === 0) {
    timingLog(traceId, 'batch:failed_no_articles', {
      totalMs: elapsedMs(totalStartedAt),
      failedSourceCount: failedSources.length,
      dateStart: dateRange.start,
      dateEnd: dateRange.end,
    });
    if (failedSources.length > 0) {
      throw fetchError(FetchErrorCode.BatchSourceFetchFailed, { failedSources });
    }

    if (dateRange.start || dateRange.end) {
      throw fetchError(FetchErrorCode.BatchNoMatchInDateRange, {
        startDate: dateRange.start,
        endDate: dateRange.end,
      });
    }

    throw fetchError(FetchErrorCode.BatchNoValidArticles);
  }

  timingLog(traceId, 'batch:done', {
    totalMs: elapsedMs(totalStartedAt),
    sourceCount: pageSources.length,
    rawFetchedCount,
    dedupedCount: fetched.length,
    dedupeDropped: Math.max(0, rawFetchedCount - fetched.length),
    failedSourceCount: failedSources.length,
    historySave: 'skipped',
  });
  fetched.forEach((article, index) => {
    article.fetchOrder = index + 1;
  });
  return fetched;
}
