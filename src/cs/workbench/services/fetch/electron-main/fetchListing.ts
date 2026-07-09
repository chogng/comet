import { load } from 'cheerio';
import type {
  Article,
  FetchChannel,
  FetchStatus,
  WebContentReuseMode,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { isWithinDateRange } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';

import { hasStrongArticleSignals, isProbablyArticle } from 'cs/workbench/services/fetch/electron-main/acceptance';
import {
  applyCandidateArticleType,
  buildArticleFromCandidate,
} from 'cs/workbench/services/fetch/electron-main/merge';
import { buildArticleFromHtml } from 'cs/workbench/services/fetch/electron-main/parser';
import { planCandidateFetch } from 'cs/workbench/services/fetch/electron-main/listing/planning';
import { buildWebContentExtractionFetchPlan } from 'cs/workbench/services/fetch/electron-main/fetchStrategy';
import type { SourcePageTypeResult } from 'cs/workbench/services/fetch/electron-main/detect';
import type { ListingCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors';
import type {
  CandidateCollectionResult,
  FetchLatestArticlesOptions,
  PageFetchResult,
  PageHtmlResult,
} from 'cs/workbench/services/fetch/electron-main/sourcePageFetchTypes';

export async function fetchListing({
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
  reportFetchStatus,
  candidatePlanConfig,
}: {
  sourceId: string;
  page: URL;
  pageUrl: string;
  journalTitle: string;
  extractor: ListingCandidateExtractor | null;
  remainingLimit: number;
  dateRange: DateRange;
  traceId: string;
  options: FetchLatestArticlesOptions;
  fetchedSourceUrls: Set<string>;
  seenPageUrls: ReadonlySet<string>;
  pageNumber: number;
  sourcePageType: SourcePageTypeResult;
  resolvePageHtml: (
    pageUrl: string,
    traceId: string,
    options: FetchLatestArticlesOptions,
  ) => Promise<PageHtmlResult>;
  collectListingCandidateDescriptors: (
    page: URL,
    pageUrl: string,
    $: ReturnType<typeof load>,
    extractor: ListingCandidateExtractor | null,
    dateRange: DateRange,
    traceId: string,
    pageNumber: number,
  ) => Promise<CandidateCollectionResult>;
  collectListingCandidateDescriptorsFromWebContentExtraction: (args: {
    page: URL;
    pageUrl: string;
    extractor: ListingCandidateExtractor;
    dateRange: DateRange;
    traceId: string;
    pageNumber: number;
    previewExtraction: NonNullable<FetchLatestArticlesOptions['previewExtractions']> extends ReadonlyMap<
      string,
      infer T
    >
      ? T
      : never;
  }) => Promise<CandidateCollectionResult | null>;
  fetchRenderedHtml: (url: string, options?: { timeoutMs?: number; traceId?: string; stage?: string; signal?: AbortSignal }) => Promise<string>;
  fetchCandidateHtmlWithRetry: (
    candidateUrl: string,
    traceId: string,
    candidateOrder: number,
    signal?: AbortSignal,
    allowTimeoutRetry?: boolean,
  ) => Promise<string>;
  shouldRenderCandidateAfterError: (args: {
    error: unknown;
    candidateOrder: number;
    extractorId: string | null;
  }) => boolean;
  shouldConfirmRenderedArticle: (args: {
    article: Article;
    candidateUrl: string;
  }) => boolean;
  canAttemptRenderedFallback: (args: { candidateOrder: number; extractorId: string | null }) => boolean;
  timingLog: (traceId: string, event: string, data?: Record<string, unknown>) => void;
  elapsedMs: (startedAt: number) => number;
  shortenForLog: (value: string) => string;
  reportFetchStatus: (
    fetchChannel: FetchChannel,
    webContentReuseMode: WebContentReuseMode | null,
    overrides?: Partial<FetchStatus>,
  ) => void;
  candidatePlanConfig: {
    minCandidateAttempts: number;
    attemptsPerLimit: number;
    extractorAttemptsMultiplier: number;
    extractorAttemptsMinBuffer: number;
    fastExtractorAttemptsMultiplier: number;
    fastExtractorAttemptsMinBuffer: number;
    dateHintHighCoverageThreshold: number;
    extractorCandidateFetchConcurrency: number;
    candidateFetchConcurrency: number;
    retryPriorityMinOrder: number;
    retryPriorityLimitMultiplier: number;
    pageRenderTimeoutMs: number;
    articleRenderTimeoutMs: number;
  };
}): Promise<PageFetchResult> {
  const fetched: Article[] = [];
  let fetchChannel: FetchChannel = 'network';
  let webContentReuseMode: WebContentReuseMode | null = null;
  let candidateCollection: CandidateCollectionResult | null = null;
  let $: ReturnType<typeof load> | null = null;
  let webContentNextPageUrl: string | null = null;

  const webContentExtraction = options.previewExtractions?.get(pageUrl) ?? null;
  const webContentExtractionPlan = buildWebContentExtractionFetchPlan({
    fetchStrategy: options.fetchStrategy,
    hasWebContentExtraction: Boolean(webContentExtraction),
    hasExtractor: Boolean(extractor),
    pageNumber,
    isLikelyArticleDetailPage: sourcePageType.type === 'detail' || sourcePageType.hasArticlePath,
  });

  if (webContentExtraction && !webContentExtractionPlan.shouldAttempt) {
    timingLog(traceId, 'source:page_web_content_extract_skipped', {
      pageNumber,
      reason: webContentExtractionPlan.reason,
      requestedStrategy: webContentExtractionPlan.requestedStrategy,
      webContentUrl: shortenForLog(webContentExtraction.webContentUrl),
      extractorId: extractor?.id ?? null,
    });
  }

  if (webContentExtractionPlan.shouldAttempt && webContentExtraction && extractor) {
    candidateCollection = await collectListingCandidateDescriptorsFromWebContentExtraction({
      page,
      pageUrl,
      extractor,
      dateRange,
      traceId,
      pageNumber,
      previewExtraction: webContentExtraction,
    });
    if (candidateCollection && candidateCollection.candidates.length > 0) {
      fetchChannel = 'web-content';
      webContentReuseMode = webContentExtractionPlan.webContentReuseMode;
      webContentNextPageUrl = webContentExtraction.nextPageUrl;
      timingLog(traceId, 'source:page_web_content_extract_applied', {
        pageNumber,
        extractorId: webContentExtraction.extractorId,
        requestedStrategy: webContentExtractionPlan.requestedStrategy,
        candidateCount: candidateCollection.candidates.length,
        captureMs: webContentExtraction.captureMs,
        nextPageUrl: shortenForLog(webContentNextPageUrl ?? ''),
        webContentUrl: shortenForLog(webContentExtraction.webContentUrl),
        reuseMode: 'live-web-content-dom',
        historicalCache: false,
      });
    }
  }

  if (!candidateCollection) {
    const pageResult = await resolvePageHtml(pageUrl, traceId, options);
    fetchChannel = pageResult.source;
    webContentReuseMode = pageResult.source === 'web-content' ? 'snapshot' : null;
    reportFetchStatus(fetchChannel, webContentReuseMode);
    let html = pageResult.html;
    const pageParseStartedAt = Date.now();
    let pageArticle = buildArticleFromHtml(pageUrl, html);
    $ = load(html);
    timingLog(traceId, 'source:page_parsed', {
      pageNumber,
      ms: elapsedMs(pageParseStartedAt),
      fetchChannel: pageResult.source,
      webContentReuseMode,
      hasTitle: Boolean(pageArticle.title),
      hasDoi: Boolean(pageArticle.doi),
      hasAbstract: Boolean(pageArticle.abstractText),
      hasDescription: Boolean(pageArticle.descriptionText),
      publishedAt: pageArticle.publishedAt,
    });

    if (
      sourcePageType.hasArticlePath &&
      hasStrongArticleSignals(pageUrl, pageArticle) &&
      isWithinDateRange(pageArticle.publishedAt, dateRange)
    ) {
      pageArticle.sourceId = sourceId;
      if (journalTitle) {
        pageArticle.journalTitle = journalTitle;
      }
      fetchedSourceUrls.add(pageArticle.sourceUrl);
      fetched.push(pageArticle);
      timingLog(traceId, 'source:page_accepted', {
        pageNumber,
        sourceUrl: shortenForLog(pageArticle.sourceUrl),
      });
      if (fetched.length >= remainingLimit) {
        return {
          fetchChannel,
          webContentReuseMode,
          articles: fetched,
          candidateAttempted: 0,
          candidateResolved: 0,
          candidateAccepted: 0,
          usedPageOnly: true,
          nextPageUrl: null,
          stoppedByDateHint: false,
        };
      }
    }

    candidateCollection = await collectListingCandidateDescriptors(
      page,
      pageUrl,
      $,
      extractor,
      dateRange,
      traceId,
      pageNumber,
    );
    if (
      candidateCollection.candidates.length === 0 &&
      pageResult.source === 'network' &&
      !pageResult.usedRenderFallback
    ) {
      try {
        const renderedPageHtml = await fetchRenderedHtml(pageUrl, {
          timeoutMs: candidatePlanConfig.pageRenderTimeoutMs,
          traceId,
          stage: 'source_page_render',
        });
        html = renderedPageHtml;
        pageArticle = buildArticleFromHtml(pageUrl, html);
        $ = load(html);
        candidateCollection = await collectListingCandidateDescriptors(
          page,
          pageUrl,
          $,
          extractor,
          dateRange,
          traceId,
          pageNumber,
        );
        timingLog(traceId, 'source:page_render_applied', {
          pageNumber,
          candidateCount: candidateCollection.candidates.length,
          hasTitle: Boolean(pageArticle.title),
          hasAbstract: Boolean(pageArticle.abstractText),
          hasDescription: Boolean(pageArticle.descriptionText),
          publishedAt: pageArticle.publishedAt,
        });
      } catch (error) {
        timingLog(traceId, 'source:page_render_skipped', {
          pageNumber,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  reportFetchStatus(fetchChannel, webContentReuseMode);

  const resolvedCandidateCollection = candidateCollection!;
  let {
    candidates,
    linkCount,
    datedCandidateCount,
    inRangeDateHintCount,
    dateFilteredCount,
    stoppedByDateHint,
    sortedDateHintsObserved,
    consecutiveOlderDateHints,
    stopDateHint,
    extractorId,
    extractorDiagnostics,
    paginationStopEvaluation,
  } = resolvedCandidateCollection;

  if (extractorId) {
    timingLog(traceId, 'source:candidate_extractor_selected', {
      pageNumber,
      extractorId,
      ...extractorDiagnostics,
    });
  }

  if (stoppedByDateHint) {
    timingLog(traceId, 'source:candidate_date_early_stop', {
      pageNumber,
      stopDateHint,
      dateStart: dateRange.start,
      datedCandidateCount,
      consecutiveOlderDateHints,
    });
  }

  const stoppedByPaginationPolicy = Boolean(paginationStopEvaluation?.shouldStop);
  if (stoppedByPaginationPolicy) {
    reportFetchStatus(fetchChannel, webContentReuseMode, {
      paginationStopped: true,
      paginationStopReason: paginationStopEvaluation?.reason ?? 'extractor_policy',
    });
    timingLog(traceId, 'source:pagination_policy_stop', {
      pageNumber,
      reason: paginationStopEvaluation?.reason ?? 'extractor_policy',
      ...(paginationStopEvaluation?.diagnostics ?? {}),
    });
  }

  const candidatePlan = planCandidateFetch(candidates, {
    extractorId,
    remainingLimit,
    datedCandidateCount,
    inRangeDateHintCount,
    hasDateRangeFilter: Boolean(dateRange.start || dateRange.end),
    minCandidateAttempts: candidatePlanConfig.minCandidateAttempts,
    attemptsPerLimit: candidatePlanConfig.attemptsPerLimit,
    extractorAttemptsMultiplier: candidatePlanConfig.extractorAttemptsMultiplier,
    extractorAttemptsMinBuffer: candidatePlanConfig.extractorAttemptsMinBuffer,
    fastExtractorAttemptsMultiplier: candidatePlanConfig.fastExtractorAttemptsMultiplier,
    fastExtractorAttemptsMinBuffer: candidatePlanConfig.fastExtractorAttemptsMinBuffer,
    dateHintHighCoverageThreshold: candidatePlanConfig.dateHintHighCoverageThreshold,
    extractorCandidateFetchConcurrency: candidatePlanConfig.extractorCandidateFetchConcurrency,
    candidateFetchConcurrency: candidatePlanConfig.candidateFetchConcurrency,
    retryPriorityMinOrder: candidatePlanConfig.retryPriorityMinOrder,
    retryPriorityLimitMultiplier: candidatePlanConfig.retryPriorityLimitMultiplier,
  });
  const maxAttempts = candidatePlan.candidatesToFetch.length;
  const candidateSlotsRemaining = Math.max(remainingLimit - fetched.length, 0);
  timingLog(traceId, 'source:candidates_ready', {
    pageNumber,
    linkCount,
    candidateCount: candidates.length,
    prioritizedCount: candidatePlan.prioritizedCandidates.length,
    attemptBudget: candidatePlan.attemptBudget,
    attemptBudgetMode: candidatePlan.attemptBudgetMode,
    defaultAttemptBudget: candidatePlan.defaultAttemptBudget,
    extractorAttemptBudget: candidatePlan.extractorAttemptBudget,
    fastExtractorAttemptBudget: candidatePlan.fastExtractorAttemptBudget,
    datedCandidateCount,
    inRangeDateHintCount,
    dateHintCoverageRatio: candidatePlan.dateHintCoverageRatio,
    dateFilteredCount,
    stoppedByDateHint,
    sortedDateHintsObserved,
    consecutiveOlderDateHints,
    retryEligibleMaxOrder: candidatePlan.retryEligibleMaxOrder,
    candidateFetchConcurrency: candidatePlan.candidateFetchConcurrency,
  });

  let candidateAttempted = 0;
  let candidateResolved = 0;
  let candidateAccepted = 0;
  let candidateSettled = 0;
  let acceptedSinceLastBatchLog = 0;
  let nextCandidateIndex = 0;
  let nextBatchLogAt = Math.min(candidatePlan.candidateFetchConcurrency, maxAttempts);
  const acceptedCandidates: Array<{ candidateOrder: number; article: Article }> = [];
  const inFlightControllers = new Map<number, AbortController>();
  const settledCandidateOrders = new Set<number>();
  const totalAcceptedCount = () => fetched.length + acceptedCandidates.length;
  const abortInFlightCandidatesAfterOrder = (maxCandidateOrderToKeep: number) => {
    for (const [candidateOrder, controller] of inFlightControllers) {
      if (candidateOrder <= maxCandidateOrderToKeep) continue;
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  };
  const resolveAcceptedCutoffOrder = () => {
    if (candidateSlotsRemaining <= 0 || acceptedCandidates.length < candidateSlotsRemaining) {
      return null;
    }

    const sortedAcceptedOrders = acceptedCandidates
      .map((item) => item.candidateOrder)
      .sort((a, b) => a - b);
    return sortedAcceptedOrders[candidateSlotsRemaining - 1] ?? null;
  };
  const hasSettledAllCandidatesThroughOrder = (maxCandidateOrder: number) => {
    for (let order = 1; order <= maxCandidateOrder; order += 1) {
      if (!settledCandidateOrders.has(order)) {
        return false;
      }
    }
    return true;
  };
  const maybeStopAfterResolvingLeadingCandidates = () => {
    const cutoffOrder = resolveAcceptedCutoffOrder();
    if (cutoffOrder === null) return;
    if (!hasSettledAllCandidatesThroughOrder(cutoffOrder)) return;

    stopLaunching = true;
    abortInFlightCandidatesAfterOrder(cutoffOrder);
  };

  const maybeLogCandidateBatch = (force = false) => {
    if (candidateSettled === 0) return;

    const lastBatchUpperBound = Math.max(0, nextBatchLogAt - candidatePlan.candidateFetchConcurrency);
    const canLogRegularBatch = candidateSettled >= nextBatchLogAt;
    const canLogPartialBatch = force && candidateSettled > lastBatchUpperBound;
    if (!canLogRegularBatch && !canLogPartialBatch) return;

    const batchStartOrder = lastBatchUpperBound + 1;
    const batchSize = Math.min(candidatePlan.candidateFetchConcurrency, candidateSettled - lastBatchUpperBound);
    timingLog(traceId, 'source:candidate_batch_done', {
      pageNumber,
      batchStartOrder,
      batchSize,
      candidateResolved,
      acceptedInBatch: acceptedSinceLastBatchLog,
      totalFetched: totalAcceptedCount(),
    });
    acceptedSinceLastBatchLog = 0;

    while (nextBatchLogAt <= candidateSettled) {
      nextBatchLogAt += candidatePlan.candidateFetchConcurrency;
    }
  };

  const workerCount = Math.min(candidatePlan.candidateFetchConcurrency, maxAttempts);
  let stopLaunching = false;
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (true) {
        if (stopLaunching) break;

        const currentIndex = nextCandidateIndex;
        nextCandidateIndex += 1;
        if (currentIndex >= maxAttempts) break;

        candidateAttempted += 1;
        const candidateOrder = currentIndex + 1;
        const candidate = candidatePlan.candidatesToFetch[currentIndex];
        let accepted = false;
        const requestController = new AbortController();
        inFlightControllers.set(candidateOrder, requestController);

        try {
          const candidateArticle = buildArticleFromCandidate(candidate);
          if (candidateArticle && isProbablyArticle(candidate.url, candidateArticle)) {
            timingLog(traceId, 'candidate:parsed', {
              pageNumber,
              candidateOrder,
              ms: 0,
              score: candidate.score,
              url: shortenForLog(candidate.url),
              hasTitle: Boolean(candidateArticle.title),
              hasDoi: Boolean(candidateArticle.doi),
              hasAbstract: Boolean(candidateArticle.abstractText),
              hasDescription: Boolean(candidateArticle.descriptionText),
              publishedAt: candidateArticle.publishedAt,
              rendered: false,
              prefetched: true,
            });
            candidateResolved += 1;

            if (!isWithinDateRange(candidateArticle.publishedAt, dateRange)) {
              continue;
            }
            if (fetchedSourceUrls.has(candidateArticle.sourceUrl)) {
              continue;
            }

            candidateArticle.sourceId = sourceId;
            if (journalTitle) {
              candidateArticle.journalTitle = journalTitle;
            }

            fetchedSourceUrls.add(candidateArticle.sourceUrl);
            acceptedCandidates.push({
              candidateOrder,
              article: candidateArticle,
            });
            accepted = true;
            candidateAccepted += 1;
            continue;
          }

          const allowTimeoutRetry = Boolean(
            extractorId ||
              (candidateOrder <= candidatePlan.retryEligibleMaxOrder && candidate.dateHint === null),
          );
          let articleHtml = '';
          let usedRenderedHtml = false;
          try {
            articleHtml = await fetchCandidateHtmlWithRetry(
              candidate.url,
              traceId,
              candidateOrder,
              requestController.signal,
              allowTimeoutRetry,
            );
          } catch (error) {
            if (!shouldRenderCandidateAfterError({ error, candidateOrder, extractorId })) {
              throw error;
            }

            articleHtml = await fetchRenderedHtml(candidate.url, {
              timeoutMs: candidatePlanConfig.articleRenderTimeoutMs,
              traceId,
              stage: `candidate#${candidateOrder}:render`,
              signal: requestController.signal,
            });
            usedRenderedHtml = true;
          }

          const parseStartedAt = Date.now();
          let article = buildArticleFromHtml(candidate.url, articleHtml);
          applyCandidateArticleType(article, candidate.articleType);
          if (
            !usedRenderedHtml &&
            shouldConfirmRenderedArticle({
              article,
              candidateUrl: candidate.url,
            })
          ) {
            if (canAttemptRenderedFallback({ candidateOrder, extractorId })) {
              try {
                const renderedArticleHtml = await fetchRenderedHtml(candidate.url, {
                  timeoutMs: candidatePlanConfig.articleRenderTimeoutMs,
                  traceId,
                  stage: `candidate#${candidateOrder}:render_after_parse`,
                  signal: requestController.signal,
                });
                const renderedArticle = buildArticleFromHtml(candidate.url, renderedArticleHtml);
                applyCandidateArticleType(renderedArticle, candidate.articleType);
                if (isProbablyArticle(candidate.url, renderedArticle)) {
                  article = renderedArticle;
                  usedRenderedHtml = true;
                  timingLog(traceId, 'candidate:render_promoted', {
                    pageNumber,
                    candidateOrder,
                    url: shortenForLog(candidate.url),
                  });
                } else {
                  continue;
                }
              } catch {
                continue;
              }
            } else {
              continue;
            }
          }
          if (candidate.descriptionText) {
            article.descriptionText = candidate.descriptionText;
          }
          timingLog(traceId, 'candidate:parsed', {
            pageNumber,
            candidateOrder,
            ms: elapsedMs(parseStartedAt),
            score: candidate.score,
            url: shortenForLog(candidate.url),
            hasTitle: Boolean(article.title),
            hasDoi: Boolean(article.doi),
            hasAbstract: Boolean(article.abstractText),
            hasDescription: Boolean(article.descriptionText),
            publishedAt: article.publishedAt,
            rendered: usedRenderedHtml,
          });
          candidateResolved += 1;

          if (!isProbablyArticle(candidate.url, article)) continue;
          if (!isWithinDateRange(article.publishedAt, dateRange)) continue;
          if (fetchedSourceUrls.has(article.sourceUrl)) continue;

          article.sourceId = sourceId;
          if (journalTitle) {
            article.journalTitle = journalTitle;
          }

          fetchedSourceUrls.add(article.sourceUrl);
          acceptedCandidates.push({
            candidateOrder,
            article,
          });
          accepted = true;
          candidateAccepted += 1;
        } catch {
          // Ignore individual candidate failures and continue draining the queue.
        } finally {
          inFlightControllers.delete(candidateOrder);
          settledCandidateOrders.add(candidateOrder);
          candidateSettled += 1;
          if (accepted) {
            acceptedSinceLastBatchLog += 1;
          }
          maybeStopAfterResolvingLeadingCandidates();
          maybeLogCandidateBatch();
        }
      }
    }),
  );
  maybeLogCandidateBatch(true);

  for (const item of acceptedCandidates.sort((a, b) => a.candidateOrder - b.candidateOrder)) {
    if (fetched.length >= remainingLimit) break;
    fetched.push(item.article);
  }

  const nextPageUrl =
    fetched.length < remainingLimit && !stoppedByDateHint && !stoppedByPaginationPolicy
      ? webContentNextPageUrl && !seenPageUrls.has(webContentNextPageUrl)
        ? webContentNextPageUrl
        : extractor?.findNextPageUrl && $
          ? extractor.findNextPageUrl({
              page,
              pageUrl,
              $,
              seenPageUrls,
            })
          : null
      : null;

  return {
    fetchChannel,
    webContentReuseMode,
    articles: fetched,
    candidateAttempted,
    candidateResolved,
    candidateAccepted,
    usedPageOnly: false,
    nextPageUrl,
    stoppedByDateHint: stoppedByDateHint || stoppedByPaginationPolicy,
  };
}
