import type {
  Article,
	ArticlePageProof,
	FetchFailureReason,
  FetchStatus,
	FetchTargetPreference,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { CandidateArticleSnapshot } from 'cs/workbench/services/fetch/electron-main/merge';
import type { ListingPaginationStopEvaluation } from 'cs/workbench/services/fetch/electron-main/sourceExtractors';
import type { FetchTargetProvider } from 'cs/workbench/services/fetch/electron-main/fetchTargetProvider';

export type FetchLatestArticlesOptions = {
	requestId: string;
	targetProvider: FetchTargetProvider;
  onFetchStatus?: (status: FetchStatus) => void;
};

export type FetchStatusUpdate =
	| {
		readonly phase: 'loading';
		readonly targetMode: FetchTargetPreference;
		readonly targetId: string | null;
		readonly articleProof: ArticlePageProof | null;
		readonly paginationStopped?: boolean;
		readonly paginationStopReason?: string | null;
	}
	| {
		readonly phase: 'targetReady';
		readonly targetMode: 'webContentsView';
		readonly targetId: string;
		readonly articleProof: ArticlePageProof | null;
		readonly paginationStopped?: boolean;
		readonly paginationStopReason?: string | null;
	}
	| {
		readonly phase: 'failed';
		readonly targetMode: FetchTargetPreference;
		readonly targetId: string | null;
		readonly failureReason: FetchFailureReason;
		readonly articleProof: ArticlePageProof | null;
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
	targetMode: FetchTargetPreference;
  articles: Article[];
  candidateAttempted: number;
  candidateResolved: number;
  candidateAccepted: number;
  usedPageOnly: boolean;
  nextPageUrl: string | null;
  stoppedByDateHint: boolean;
};
