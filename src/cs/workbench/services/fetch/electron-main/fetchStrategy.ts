import type { ListingCandidateExtraction } from 'cs/workbench/services/fetch/electron-main/sourceExtractors';

export type FetchStrategy = 'network-first' | 'web-content-first' | 'compare';

export type WebContentSnapshot = {
  html: string;
  webContentUrl: string;
  captureMs: number;
  isLoading: boolean;
};

export type WebContentExtractionSnapshot = {
  extraction: ListingCandidateExtraction;
  extractorId: string;
  webContentUrl: string;
  captureMs: number;
  isLoading: boolean;
  nextPageUrl: string | null;
};

export type WebContentExtractionFetchPlan = {
  requestedStrategy: FetchStrategy;
  shouldAttempt: boolean;
  webContentReuseMode: 'live-extract' | null;
  reason:
    | 'strategy_network_first'
    | 'web_content_extraction_unavailable'
    | 'extractor_unavailable'
    | 'page_not_first'
    | 'article_detail_page'
    | 'web_content_live_extract';
};

export type PageHtmlFetchPlan = {
  requestedStrategy: FetchStrategy;
  effectiveStrategy: FetchStrategy;
  selectedChannel: 'network' | 'web-content';
  webContentReuseMode: 'snapshot' | null;
  shouldStartNetworkBenchmark: boolean;
  networkStage: 'source_page' | 'source_page_network';
};

export function normalizeFetchStrategy(input: FetchStrategy | null | undefined): FetchStrategy {
  switch (input) {
    case 'compare':
      return 'compare';
    case 'web-content-first':
      return 'web-content-first';
    case 'network-first':
    default:
      return 'network-first';
  }
}

export function shouldPrepareWebContentArtifacts(input: FetchStrategy | null | undefined): boolean {
  return normalizeFetchStrategy(input) !== 'network-first';
}

export function buildWebContentExtractionFetchPlan({
  fetchStrategy,
  hasWebContentExtraction,
  hasExtractor,
  pageNumber,
  isLikelyArticleDetailPage,
}: {
  fetchStrategy: FetchStrategy | null | undefined;
  hasWebContentExtraction: boolean;
  hasExtractor: boolean;
  pageNumber: number;
  isLikelyArticleDetailPage: boolean;
}): WebContentExtractionFetchPlan {
  const requestedStrategy = normalizeFetchStrategy(fetchStrategy);
  if (requestedStrategy === 'network-first') {
    return {
      requestedStrategy,
      shouldAttempt: false,
      webContentReuseMode: null,
      reason: 'strategy_network_first',
    };
  }

  if (!hasWebContentExtraction) {
    return {
      requestedStrategy,
      shouldAttempt: false,
      webContentReuseMode: null,
      reason: 'web_content_extraction_unavailable',
    };
  }

  if (!hasExtractor) {
    return {
      requestedStrategy,
      shouldAttempt: false,
      webContentReuseMode: null,
      reason: 'extractor_unavailable',
    };
  }

  if (pageNumber !== 1) {
    return {
      requestedStrategy,
      shouldAttempt: false,
      webContentReuseMode: null,
      reason: 'page_not_first',
    };
  }

  if (isLikelyArticleDetailPage) {
    return {
      requestedStrategy,
      shouldAttempt: false,
      webContentReuseMode: null,
      reason: 'article_detail_page',
    };
  }

  return {
    requestedStrategy,
    shouldAttempt: true,
    webContentReuseMode: 'live-extract',
    reason: 'web_content_live_extract',
  };
}

export function buildPageHtmlFetchPlan({
  fetchStrategy,
  hasWebContentSnapshot,
}: {
  fetchStrategy: FetchStrategy | null | undefined;
  hasWebContentSnapshot: boolean;
}): PageHtmlFetchPlan {
  const requestedStrategy = normalizeFetchStrategy(fetchStrategy);
  const effectiveStrategy = hasWebContentSnapshot ? requestedStrategy : 'network-first';
  const selectedChannel = effectiveStrategy === 'network-first' ? 'network' : 'web-content';
  const shouldStartNetworkBenchmark = effectiveStrategy === 'compare';

  return {
    requestedStrategy,
    effectiveStrategy,
    selectedChannel,
    webContentReuseMode: selectedChannel === 'web-content' ? 'snapshot' : null,
    shouldStartNetworkBenchmark,
    networkStage: shouldStartNetworkBenchmark ? 'source_page_network' : 'source_page',
  };
}
