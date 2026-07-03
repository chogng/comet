import type {
  Article,
  FetchChannel,
  FetchStatus,
  WebContentReuseMode,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import type { CandidateArticleSnapshot } from 'ls/code/electron-main/fetch/merge';
import type { ListingPaginationStopEvaluation } from 'ls/code/electron-main/fetch/sourceExtractors';
import type {
  FetchStrategy,
  WebContentExtractionSnapshot,
  WebContentSnapshot,
} from 'ls/code/electron-main/fetch/fetchStrategy';

export type FetchLatestArticlesOptions = {
  previewExtractions?: ReadonlyMap<string, WebContentExtractionSnapshot>;
  previewSnapshots?: ReadonlyMap<string, WebContentSnapshot>;
  fetchStrategy?: FetchStrategy;
  onFetchStatus?: (status: FetchStatus) => void;
};

export type PageHtmlResult = {
  html: string;
  source: 'network' | 'web-content';
  usedRenderFallback?: boolean;
};

export type CandidateDescriptor = CandidateArticleSnapshot & {
  score: number;
  order: number;
};

export type CandidateCollectionResult = {
  candidates: CandidateDescriptor[];
  linkCount: number;
  datedCandidateCount: number;
  inRangeDateHintCount: number;
  dateFilteredCount: number;
  stoppedByDateHint: boolean;
  sortedDateHintsObserved: boolean;
  consecutiveOlderDateHints: number;
  stopDateHint: string | null;
  extractorId: string | null;
  extractorDiagnostics: Record<string, unknown> | null;
  paginationStopEvaluation: ListingPaginationStopEvaluation | null;
};

export type PageFetchResult = {
  fetchChannel: FetchChannel;
  webContentReuseMode: WebContentReuseMode | null;
  articles: Article[];
  candidateAttempted: number;
  candidateResolved: number;
  candidateAccepted: number;
  usedPageOnly: boolean;
  nextPageUrl: string | null;
  stoppedByDateHint: boolean;
};
