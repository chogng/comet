import { load } from 'cheerio';
import type { Article, FetchChannel, WebContentReuseMode } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { isWithinDateRange } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';

import { hasStrongArticleSignals } from 'cs/workbench/services/fetch/electron-main/acceptance';
import { buildArticleFromHtml } from 'cs/workbench/services/fetch/electron-main/parser';
import type { SourcePageTypeResult } from 'cs/workbench/services/fetch/electron-main/detect';
import type {
  FetchLatestArticlesOptions,
  PageFetchResult,
  PageHtmlResult,
} from 'cs/workbench/services/fetch/electron-main/sourcePageFetchTypes';

export async function fetchDetail({
  sourceId,
  pageUrl,
  journalTitle,
  remainingLimit,
  dateRange,
  sourcePageType,
  resolvePageHtml,
  reportFetchStatus,
  timingLog,
  elapsedMs,
  shortenForLog,
  traceId,
  pageNumber,
  options,
}: {
  sourceId: string;
  pageUrl: string;
  journalTitle: string;
  remainingLimit: number;
  dateRange: DateRange;
  sourcePageType: SourcePageTypeResult;
  resolvePageHtml: (
    pageUrl: string,
    traceId: string,
    options: FetchLatestArticlesOptions,
  ) => Promise<PageHtmlResult>;
  reportFetchStatus: (fetchChannel: FetchChannel, webContentReuseMode: WebContentReuseMode | null) => void;
  timingLog: (traceId: string, event: string, data?: Record<string, unknown>) => void;
  elapsedMs: (startedAt: number) => number;
  shortenForLog: (value: string) => string;
  traceId: string;
  pageNumber: number;
  options: FetchLatestArticlesOptions;
}): Promise<PageFetchResult> {
  const fetched: Article[] = [];
  const pageResult = await resolvePageHtml(pageUrl, traceId, options);
  const fetchChannel = pageResult.source;
  const webContentReuseMode = pageResult.source === 'web-content' ? 'snapshot' : null;
  reportFetchStatus(fetchChannel, webContentReuseMode);

  const html = pageResult.html;
  const pageParseStartedAt = Date.now();
  const pageArticle = buildArticleFromHtml(pageUrl, html);
  load(html);
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

  timingLog(traceId, 'source:page_detail_only', {
    pageNumber,
    sourceUrl: shortenForLog(pageUrl),
    reason: sourcePageType.reason,
    pageAccepted: fetched.length > 0,
  });
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
