import { load } from 'cheerio';

import type {
  Article,
  FetchChannel,
  FetchLatestArticlesPayload,
  FetchStatus,
  WebContentReuseMode,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import type { HistoryStore } from 'cs/platform/storage/electron-main/historyStore';
import { parseDateRange, parseDateHintFromText } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';

import { cleanText } from 'cs/base/common/strings';
import { normalizeNatureMainSiteListingUrl, normalizeUrl } from 'cs/base/common/url';
import { collectCandidateDescriptorsFromSeeds as collectListingCandidateDescriptorsFromSeeds } from 'cs/workbench/services/fetch/electron-main/listing/candidates';
import { buildArticleFromHtml } from 'cs/workbench/services/fetch/electron-main/parser';
import { isProbablyArticle } from 'cs/workbench/services/fetch/electron-main/acceptance';
import { hasArticlePathSignal } from 'cs/workbench/services/fetch/electron-main/articleUrlRules';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import {
  renderHtmlWithBrowserWindow,
  requestWithPreferredTransport,
} from 'cs/platform/request/electron-main/requestMainService';
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
import { buildPageHtmlFetchPlan, normalizeFetchStrategy } from 'cs/workbench/services/fetch/electron-main/fetchStrategy';
import type { WebContentExtractionSnapshot } from 'cs/workbench/services/fetch/electron-main/fetchStrategy';
import { attemptNetworkHtml, resolveNetworkAttemptResult } from 'cs/workbench/services/fetch/electron-main/networkChannel';
import type { NetworkAttemptResult } from 'cs/workbench/services/fetch/electron-main/networkChannel';

import { detect } from 'cs/workbench/services/fetch/electron-main/detect';
import { fetchDetail } from 'cs/workbench/services/fetch/electron-main/fetchDetail';
import { fetchListing } from 'cs/workbench/services/fetch/electron-main/fetchListing';
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
  PageFetchResult,
  PageHtmlResult,
} from 'cs/workbench/services/fetch/electron-main/sourcePageFetchTypes';

const SYSTEM_BATCH_LIMIT_MAX = batchLimitMax;
const USER_BATCH_LIMIT_MIN = batchLimitMin;
const DEFAULT_USER_BATCH_LIMIT = defaultBatchLimit;
const DEFAULT_FETCH_TIMEOUT_MS = 12000;
const PAGE_FETCH_TIMEOUT_MS = 12000;
const ARTICLE_FETCH_TIMEOUT_MS = 3000;
const ARTICLE_FETCH_RETRY_TIMEOUT_MS = 4200;
const ARTICLE_FETCH_RETRY_MAX_ATTEMPTS = 2;
const ARTICLE_FETCH_RETRY_BACKOFF_MS = 20;
const CANDIDATE_FETCH_CONCURRENCY = 12;
const EXTRACTOR_CANDIDATE_FETCH_CONCURRENCY = 8;
const SOURCE_FETCH_CONCURRENCY = 4;
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
const HTML_FETCH_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const HTML_FETCH_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const BROWSER_FETCH_PARTITION = WORKBENCH_SHARED_WEB_PARTITION;
const PREFER_BROWSER_FETCH =
  getCompatFetchEnvValueOrDefault(
    'LS_FETCH_TRANSPORT',
    'READER_FETCH_TRANSPORT',
    'browser',
  ) !== 'node';
const ENABLE_BROWSER_RENDER_FALLBACK =
  getCompatFetchEnvValueOrDefault(
    'LS_FETCH_RENDER_FALLBACK',
    'READER_FETCH_RENDER_FALLBACK',
    '1',
  ) !== '0';
const ARTICLE_RENDER_TIMEOUT_MS = 4500;
const PAGE_RENDER_TIMEOUT_MS = 4500;
const BROWSER_RENDER_DOM_SETTLE_MS = 180;
const RENDER_FALLBACK_MAX_ORDER = 8;
const EXTRACTOR_RENDER_FALLBACK_MAX_ORDER = 10;
const RENDER_FALLBACK_HTTP_STATUS = new Set(['401', '403', '408', '409', '423', '425', '429', '451']);
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
};

type CheerioAcceptedNode = Parameters<ReturnType<typeof load>>[0];

function describeFetchDetail(fetchChannel: FetchChannel, webContentReuseMode: WebContentReuseMode | null) {
  if (fetchChannel === 'web-content') {
    return webContentReuseMode === 'live-extract' ? 'live-web-content-dom' : 'web-content-dom-snapshot';
  }

  return 'network-fetch';
}

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

function isTimeoutRequestError(error: unknown) {
  if (getFetchErrorCode(error) !== FetchErrorCode.HttpRequestFailed) return false;
  return cleanText(getFetchErrorDetails(error)?.status) === 'TIMEOUT';
}

function isAbortedRequestError(error: unknown) {
  if (getFetchErrorCode(error) !== FetchErrorCode.HttpRequestFailed) return false;
  return cleanText(getFetchErrorDetails(error)?.status) === 'ABORTED';
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function hasUsableWebContentPageHtml(html: string) {
  const trimmed = typeof html === 'string' ? html.trim() : '';
  if (!trimmed) return false;
  return /<(?:html|body|a)\b/i.test(trimmed);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildHtmlFetchHeaders() {
  return {
    'user-agent': HTML_FETCH_USER_AGENT,
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

function logBrowserLoadFailure({
  traceId,
  stage,
  partition,
  requestedUrl,
  currentUrl,
  failedUrl,
  errorCode,
  errorDescription,
  isMainFrame,
}: {
  traceId: string;
  stage: string;
  partition: string;
  requestedUrl: string;
  currentUrl: string;
  failedUrl: string;
  errorCode: number;
  errorDescription: string;
  isMainFrame: boolean;
}) {
  if (errorCode === -3 || /^ERR_ABORTED$/i.test(errorDescription)) {
    return;
  }

  timingLog(traceId, `${stage}:did_fail_load`, {
    partition,
    requestedUrl: shortenForLog(requestedUrl),
    currentUrl: shortenForLog(currentUrl),
    failedUrl: shortenForLog(failedUrl),
    errorCode,
    errorDescription,
    isMainFrame,
  });
}

async function requestHtmlWithPreferredTransport({
  traceId,
  stage,
  url,
  signal,
}: {
  traceId: string;
  stage: string;
  url: string;
  signal: AbortSignal;
}) {
  return requestWithPreferredTransport({
    url,
    signal,
    headers: buildHtmlFetchHeaders(),
    browser: {
      enabled: PREFER_BROWSER_FETCH,
      partition: BROWSER_FETCH_PARTITION,
      onFallback: ({ partition, message }) => {
        timingLog(traceId, `${stage}:browser_fallback`, {
          url: shortenForLog(url),
          partition,
          message,
        });
      },
    },
  });
}

function toErrorStatusCode(error: unknown) {
  return cleanText(getFetchErrorDetails(error)?.status);
}

function canAttemptRenderedFallback({
  candidateOrder,
  extractorId,
}: {
  candidateOrder: number;
  extractorId: string | null;
}) {
  if (!ENABLE_BROWSER_RENDER_FALLBACK) return false;
  if (extractorId) return candidateOrder <= EXTRACTOR_RENDER_FALLBACK_MAX_ORDER;
  return candidateOrder <= RENDER_FALLBACK_MAX_ORDER;
}

function shouldRenderCandidateAfterError({
  error,
  candidateOrder,
  extractorId,
}: {
  error: unknown;
  candidateOrder: number;
  extractorId: string | null;
}) {
  if (!canAttemptRenderedFallback({ candidateOrder, extractorId })) {
    return false;
  }

  const status = toErrorStatusCode(error);
  return status === 'TIMEOUT' || status === 'NETWORK_ERROR' || RENDER_FALLBACK_HTTP_STATUS.has(status);
}

function shouldRenderPageAfterError(error: unknown) {
  if (!ENABLE_BROWSER_RENDER_FALLBACK) return false;
  const status = toErrorStatusCode(error);
  return status === 'TIMEOUT' || status === 'NETWORK_ERROR' || RENDER_FALLBACK_HTTP_STATUS.has(status);
}

function shouldConfirmRenderedArticle({
  article,
  candidateUrl,
}: {
  article: Article;
  candidateUrl: string;
}) {
  if (!isProbablyArticle(candidateUrl, article)) {
    return true;
  }

  const pathname = new URL(candidateUrl).pathname.toLowerCase();
  if (!hasArticlePathSignal(pathname)) {
    return false;
  }

  const title = cleanText(article.title);
  const weakMetadata =
    !article.doi && !article.publishedAt && !article.abstractText && !article.descriptionText;
  const genericTitle = title.length < 12 || /^(?:shell|loading|article|home)$/i.test(title);
  return weakMetadata && genericTitle;
}

async function fetchRenderedHtml(url: string, options: FetchHtmlOptions = {}) {
  const traceId = cleanText(options.traceId) || 'fetch';
  const stage = cleanText(options.stage) || 'html_render';
  const timeoutMs = toTimeoutMs(options.timeoutMs, ARTICLE_RENDER_TIMEOUT_MS);
  const requestStartedAt = Date.now();

  try {
    const rendered = await renderHtmlWithBrowserWindow({
      url,
      partition: BROWSER_FETCH_PARTITION,
      timeoutMs,
      settleMs: BROWSER_RENDER_DOM_SETTLE_MS,
      signal: options.signal,
      userAgent: HTML_FETCH_USER_AGENT,
      acceptHeader: HTML_FETCH_ACCEPT,
      onDidFailLoad: (details) => {
        logBrowserLoadFailure({
          traceId,
          stage,
          ...details,
        });
      },
    });

    timingLog(traceId, `${stage}:ok`, {
      ms: elapsedMs(requestStartedAt),
      timeoutMs,
      transport: 'browser-render',
      url: shortenForLog(url),
      finalUrl: shortenForLog(rendered.finalUrl),
      size: rendered.html.length,
    });
    return rendered.html;
  } catch (error) {
    if (getFetchErrorCode(error) === FetchErrorCode.HttpRequestFailed) {
      const details = getFetchErrorDetails(error);
      const status = cleanText(details?.status);
      if (status === 'ABORTED') {
        timingLog(traceId, `${stage}:aborted`, {
          ms: elapsedMs(requestStartedAt),
          timeoutMs,
          transport: 'browser-render',
          url: shortenForLog(url),
        });
      } else if (status === 'TIMEOUT') {
        timingLog(traceId, `${stage}:timeout`, {
          ms: elapsedMs(requestStartedAt),
          timeoutMs,
          transport: 'browser-render',
          url: shortenForLog(url),
        });
      } else if (status === 'NETWORK_ERROR') {
        timingLog(traceId, `${stage}:network_error`, {
          ms: elapsedMs(requestStartedAt),
          timeoutMs,
          transport: 'browser-render',
          url: shortenForLog(url),
          message: cleanText(details?.statusText) || describeError(error),
        });
      }

      throw error;
    }

    timingLog(traceId, `${stage}:network_error`, {
      ms: elapsedMs(requestStartedAt),
      timeoutMs,
      transport: 'browser-render',
      url: shortenForLog(url),
      message: error instanceof Error ? error.message : String(error),
    });
    throw fetchError(FetchErrorCode.HttpRequestFailed, {
      status: 'NETWORK_ERROR',
      statusText: error instanceof Error ? error.message : String(error),
      url,
    });
  }
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
  }

  return collectCandidateDescriptorsFromSeeds(
    page,
    pageUrl,
    dateRange,
    buildGenericCandidateSeeds($),
  );
}

async function collectListingCandidateDescriptorsFromWebContentExtraction({
  page,
  pageUrl,
  extractor,
  dateRange,
  traceId,
  pageNumber,
  previewExtraction,
}: {
  page: URL;
  pageUrl: string;
  extractor: ListingCandidateExtractor;
  dateRange: DateRange;
  traceId: string;
  pageNumber: number;
  previewExtraction: WebContentExtractionSnapshot;
}): Promise<CandidateCollectionResult | null> {
  if (previewExtraction.extractorId !== extractor.id) {
    return null;
  }

  let extracted = previewExtraction.extraction;
  if (!extracted || extracted.candidates.length === 0) {
    return null;
  }

  if (extractor.refineExtraction) {
    const refined = await extractor.refineExtraction({
      page,
      pageUrl,
      $: load(''),
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

  const result = collectCandidateDescriptorsFromSeeds(
    page,
    pageUrl,
    dateRange,
    extracted.candidates,
  );
  const paginationStopEvaluation = evaluateExtractorPaginationStop({
    extractor,
    page,
    pageUrl,
    pageNumber,
    dateRange,
    extraction: extracted,
  });

  return {
    ...result,
    extractorId: extractor.id,
    extractorDiagnostics: {
      ...(extracted.diagnostics ?? {}),
      previewCaptureMs: previewExtraction.captureMs,
      previewNextPageUrl: previewExtraction.nextPageUrl,
      webContentUrl: previewExtraction.webContentUrl,
      source: 'web-content',
      webContentReuseMode: 'live-extract',
    },
    paginationStopEvaluation,
  };
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
}): Promise<PageFetchResult> {
  const page = new URL(pageUrl);
  const sourcePageType = detect(page);
  const extractor =
    sourcePageType.type === 'listing' ? findListingCandidateExtractor(page, preferredExtractorId) : null;
  let fetchStatusReported = false;
  const reportFetchStatus = (
    fetchChannel: FetchChannel,
    webContentReuseMode: WebContentReuseMode | null,
    overrides: Partial<FetchStatus> = {},
  ) => {
    const reporter = options.onFetchStatus;
    if (typeof reporter !== 'function') return;

    reporter({
      sourceId,
      pageUrl,
      pageNumber,
      fetchChannel,
      fetchDetail: describeFetchDetail(fetchChannel, webContentReuseMode),
      webContentReuseMode,
      extractorId: extractor?.id ?? null,
      ...overrides,
    });
  };
  const reportInitialFetchStatus = (
    fetchChannel: FetchChannel,
    webContentReuseMode: WebContentReuseMode | null,
  ) => {
    if (fetchStatusReported) return;
    reportFetchStatus(fetchChannel, webContentReuseMode);
    fetchStatusReported = true;
  };
  if (sourcePageType.type === 'detail') {
    return fetchDetail({
      sourceId,
      pageUrl,
      journalTitle,
      remainingLimit,
      dateRange,
      sourcePageType,
      resolvePageHtml,
      reportFetchStatus: reportInitialFetchStatus,
      timingLog,
      elapsedMs,
      shortenForLog,
      traceId,
      pageNumber,
      options,
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
    options,
    fetchedSourceUrls,
    seenPageUrls,
    pageNumber,
    sourcePageType,
    resolvePageHtml,
    collectListingCandidateDescriptors,
    collectListingCandidateDescriptorsFromWebContentExtraction,
    fetchRenderedHtml,
    fetchCandidateHtmlWithRetry,
    shouldRenderCandidateAfterError,
    shouldConfirmRenderedArticle,
    canAttemptRenderedFallback,
    timingLog,
    elapsedMs,
    shortenForLog,
    reportFetchStatus: (fetchChannel, webContentReuseMode, overrides) => {
      if (overrides) {
        reportFetchStatus(fetchChannel, webContentReuseMode, overrides);
        return;
      }
      reportInitialFetchStatus(fetchChannel, webContentReuseMode);
    },
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
      pageRenderTimeoutMs: PAGE_RENDER_TIMEOUT_MS,
      articleRenderTimeoutMs: ARTICLE_RENDER_TIMEOUT_MS,
    },
  });
}

async function fetchCandidateHtmlWithRetry(
  candidateUrl: string,
  traceId: string,
  candidateOrder: number,
  signal?: AbortSignal,
  allowTimeoutRetry = true,
) {
  const maxAttempts = allowTimeoutRetry ? ARTICLE_FETCH_RETRY_MAX_ATTEMPTS : 1;
  let attempt = 1;
  let timeoutMs = ARTICLE_FETCH_TIMEOUT_MS;

  while (attempt <= maxAttempts) {
    if (signal?.aborted) {
      throw fetchError(FetchErrorCode.HttpRequestFailed, {
        status: 'ABORTED',
        statusText: 'Request aborted',
        url: candidateUrl,
      });
    }

    const stage = attempt === 1 ? `candidate#${candidateOrder}` : `candidate#${candidateOrder}:retry${attempt - 1}`;
    try {
      return await fetchHtml(candidateUrl, {
        timeoutMs,
        traceId,
        stage,
        signal,
      });
    } catch (error) {
      if (isAbortedRequestError(error)) {
        throw error;
      }

      const canRetry = allowTimeoutRetry && isTimeoutRequestError(error) && attempt < maxAttempts;
      if (!canRetry) {
        throw error;
      }

      const nextAttempt = attempt + 1;
      const nextTimeoutMs = Math.max(timeoutMs, ARTICLE_FETCH_RETRY_TIMEOUT_MS);
      timingLog(traceId, 'candidate:retry_scheduled', {
        candidateOrder,
        attempt,
        nextAttempt,
        timeoutMs,
        nextTimeoutMs,
        allowTimeoutRetry,
        backoffMs: ARTICLE_FETCH_RETRY_BACKOFF_MS,
        url: shortenForLog(candidateUrl),
      });

      if (ARTICLE_FETCH_RETRY_BACKOFF_MS > 0) {
        await sleep(ARTICLE_FETCH_RETRY_BACKOFF_MS);
      }

      attempt = nextAttempt;
      timeoutMs = nextTimeoutMs;
    }
  }

  throw fetchError(FetchErrorCode.HttpRequestFailed, {
    status: 'RETRY_EXHAUSTED',
    statusText: 'Candidate fetch retries exhausted',
    url: candidateUrl,
  });
}

async function resolvePageHtml(
  pageUrl: string,
  traceId: string,
  options: FetchLatestArticlesOptions,
): Promise<PageHtmlResult> {
  const webContentSnapshot = options.previewSnapshots?.get(pageUrl) ?? null;
  const pageHtmlFetchPlan = buildPageHtmlFetchPlan({
    fetchStrategy: options.fetchStrategy,
    hasWebContentSnapshot: Boolean(webContentSnapshot),
  });
  let networkAttemptPromise: Promise<NetworkAttemptResult> | null = null;

  const startNetworkAttempt = () => {
    if (!networkAttemptPromise) {
      networkAttemptPromise = attemptNetworkHtml(
        {
          pageUrl,
          traceId,
          stage: pageHtmlFetchPlan.networkStage,
          benchmarkStage: pageHtmlFetchPlan.shouldStartNetworkBenchmark ? 'source:page_benchmark_done' : null,
          pageFetchTimeoutMs: PAGE_FETCH_TIMEOUT_MS,
        },
        {
          fetchHtml,
          describeError,
        },
      );
    }

    return networkAttemptPromise;
  };

  const useNetwork = async (reason: string) => {
    const attemptResult = await startNetworkAttempt();
    return resolveNetworkAttemptResult(
      {
        pageUrl,
        traceId,
        reason,
        attemptResult,
        renderStage: 'source_page_render_on_error',
        pageRenderTimeoutMs: PAGE_RENDER_TIMEOUT_MS,
      },
      {
        fetchRenderedHtml,
        shouldRenderPageAfterError,
        describeError,
        toErrorStatusCode,
      },
    );
  };

  timingLog(traceId, 'source:page_strategy', {
    requestedStrategy: pageHtmlFetchPlan.requestedStrategy,
    effectiveStrategy: pageHtmlFetchPlan.effectiveStrategy,
    hasWebContentSnapshot: Boolean(webContentSnapshot),
    webContentCaptureMs: webContentSnapshot?.captureMs ?? null,
    webContentSize: webContentSnapshot?.html.length ?? null,
    webContentIsLoading: webContentSnapshot?.isLoading ?? null,
  });

  if (pageHtmlFetchPlan.selectedChannel === 'network' || !webContentSnapshot) {
    return useNetwork('network_only');
  }

  if (pageHtmlFetchPlan.shouldStartNetworkBenchmark) {
    timingLog(traceId, 'source:page_benchmark_started', {
      against: 'network',
      url: shortenForLog(pageUrl),
    });
    void startNetworkAttempt();
  }

  if (!hasUsableWebContentPageHtml(webContentSnapshot.html)) {
    timingLog(traceId, 'source:page_web_content_skipped', {
      reason: 'web_content_html_invalid',
      webContentUrl: shortenForLog(webContentSnapshot.webContentUrl),
      captureMs: webContentSnapshot.captureMs,
      size: webContentSnapshot.html.length,
    });
    return useNetwork('web_content_html_invalid');
  }

  if (webContentSnapshot.isLoading) {
    timingLog(traceId, 'source:page_web_content_loading', {
      webContentUrl: shortenForLog(webContentSnapshot.webContentUrl),
      captureMs: webContentSnapshot.captureMs,
      size: webContentSnapshot.html.length,
    });
  }

  timingLog(traceId, 'source_page_web_content:ok', {
    ms: webContentSnapshot.captureMs,
    size: webContentSnapshot.html.length,
    url: shortenForLog(pageUrl),
    webContentUrl: shortenForLog(webContentSnapshot.webContentUrl),
  });
  timingLog(traceId, 'source:page_selected', {
    selected: 'web-content',
    reason: pageHtmlFetchPlan.effectiveStrategy,
    size: webContentSnapshot.html.length,
    captureMs: webContentSnapshot.captureMs,
    url: shortenForLog(pageUrl),
  });

  return {
    html: webContentSnapshot.html,
    source: 'web-content',
  };
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
    const { response, transport } = await requestHtmlWithPreferredTransport({
      traceId,
      stage,
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

export async function fetchArticle(urlValue: unknown, storage: FetchStorageService) {
  const traceId = createFetchTraceId('single');
  const totalStartedAt = Date.now();
  const normalized = normalizeUrl(urlValue);
  timingLog(traceId, 'fetch_article:start', {
    url: shortenForLog(normalized),
  });

  try {
    let html = '';
    let usedRenderedHtml = false;
    try {
      html = await fetchHtml(normalized, {
        traceId,
        stage: 'single_page',
      });
    } catch (error) {
      if (!ENABLE_BROWSER_RENDER_FALLBACK) {
        throw error;
      }

      html = await fetchRenderedHtml(normalized, {
        timeoutMs: ARTICLE_RENDER_TIMEOUT_MS,
        traceId,
        stage: 'single_page_render',
      });
      usedRenderedHtml = true;
    }

    const parseStartedAt = Date.now();
    let article = buildArticleFromHtml(normalized, html);
    if (
      !usedRenderedHtml &&
      shouldConfirmRenderedArticle({
        article,
        candidateUrl: normalized,
      })
    ) {
      try {
        const renderedHtml = await fetchRenderedHtml(normalized, {
          timeoutMs: ARTICLE_RENDER_TIMEOUT_MS,
          traceId,
          stage: 'single_page_render_after_parse',
        });
        const renderedArticle = buildArticleFromHtml(normalized, renderedHtml);
        if (isProbablyArticle(normalized, renderedArticle)) {
          article = renderedArticle;
          usedRenderedHtml = true;
        }
      } catch {
        // Keep the raw article parse if render fallback cannot improve it.
      }
    }
    timingLog(traceId, 'fetch_article:parsed', {
      ms: elapsedMs(parseStartedAt),
      hasTitle: Boolean(article.title),
      hasDoi: Boolean(article.doi),
      hasAbstract: Boolean(article.abstractText),
      hasDescription: Boolean(article.descriptionText),
      authorCount: article.authors.length,
      publishedAt: article.publishedAt,
      rendered: usedRenderedHtml,
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
    }
  }

  return [...deduped.values()];
}

async function fetchLatestArticlesFromPage(
  sourceId: string,
  pageUrl: string,
  journalTitle: string,
  preferredExtractorId: string | null,
  perSourceLimit: number,
  dateRange: DateRange,
  traceId: string,
  options: FetchLatestArticlesOptions,
): Promise<Article[]> {
  const sourceStartedAt = Date.now();
  timingLog(traceId, 'source:start', {
    sourceId,
    pageUrl: shortenForLog(pageUrl),
    preferredExtractorId,
    perSourceLimit,
    dateStart: dateRange.start,
    dateEnd: dateRange.end,
  });

  try {
    const fetched: Article[] = [];
    const fetchedSourceUrls = new Set<string>();
    const seenPageUrls = new Set<string>();
    let pageCount = 0;
    let totalCandidateAttempted = 0;
    let totalCandidateResolved = 0;
    let totalCandidateAccepted = 0;
    let usedPageOnly = false;
    let lastFetchChannel: FetchChannel = 'network';
    let lastPreviewReuseMode: WebContentReuseMode | null = null;
    let currentPageUrl: string | null = pageUrl;

    while (currentPageUrl && fetched.length < perSourceLimit && pageCount < MAX_PAGINATED_PAGE_COUNT) {
      const normalizedPageUrl = new URL(currentPageUrl).toString();
      if (seenPageUrls.has(normalizedPageUrl)) {
        timingLog(traceId, 'source:pagination_loop_detected', {
          pageCount,
          pageUrl: shortenForLog(normalizedPageUrl),
        });
        break;
      }

      seenPageUrls.add(normalizedPageUrl);
      pageCount += 1;

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
      });

      lastFetchChannel = pageResult.fetchChannel;
      lastPreviewReuseMode = pageResult.webContentReuseMode;
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
      fetchChannel: lastFetchChannel,
      webContentReuseMode: lastPreviewReuseMode,
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
    timingLog(traceId, 'source:failed', {
      totalMs: elapsedMs(sourceStartedAt),
      message: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function fetchLatestArticles(
  payload: FetchLatestArticlesPayload = {},
  storage: FetchStorageService,
  options: FetchLatestArticlesOptions = {},
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
  const fetchStrategy = normalizeFetchStrategy(options.fetchStrategy ?? payload.fetchStrategy);
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
    fetchStrategy,
    previewSnapshotCount: options.previewSnapshots?.size ?? 0,
    previewExtractionCount: options.previewExtractions?.size ?? 0,
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
