import { EventEmitter } from 'cs/base/common/event';
import type { Article } from 'cs/workbench/services/article/articleFetch';
import { buildDefaultBatchDateRange } from 'cs/workbench/common/dateRange';

export type WorkbenchContentStateSnapshot = {
  batchStartDate: string;
  batchEndDate: string;
  filterJournal: string;
};

export type WorkbenchContentDerivedState = {
  filteredArticles: Article[];
  hasData: boolean;
};

type WorkbenchContentStateUpdater = (
  current: WorkbenchContentStateSnapshot,
) => WorkbenchContentStateSnapshot;

const defaultBatchDateRange = buildDefaultBatchDateRange();
const DEFAULT_WORKBENCH_CONTENT_STATE_SNAPSHOT: WorkbenchContentStateSnapshot = {
  batchStartDate: defaultBatchDateRange.startDate,
  batchEndDate: defaultBatchDateRange.endDate,
  filterJournal: '',
};

let workbenchContentStateSnapshot = DEFAULT_WORKBENCH_CONTENT_STATE_SNAPSHOT;
const onDidChangeWorkbenchContentStateEmitter = new EventEmitter<void>();

function updateWorkbenchContentState(updater: WorkbenchContentStateUpdater) {
  const nextSnapshot = updater(workbenchContentStateSnapshot);
  if (Object.is(nextSnapshot, workbenchContentStateSnapshot)) {
    return;
  }

  workbenchContentStateSnapshot = nextSnapshot;
  onDidChangeWorkbenchContentStateEmitter.fire();
}

export function subscribeWorkbenchContentState(listener: () => void) {
  return onDidChangeWorkbenchContentStateEmitter.event(listener);
}

export function getWorkbenchContentStateSnapshot() {
  return workbenchContentStateSnapshot;
}

export function setBatchStartDate(nextBatchStartDate: string) {
  updateWorkbenchContentState((current) => {
    if (current.batchStartDate === nextBatchStartDate) {
      return current;
    }

    return {
      ...current,
      batchStartDate: nextBatchStartDate,
    };
  });
}

export function setBatchEndDate(nextBatchEndDate: string) {
  updateWorkbenchContentState((current) => {
    if (current.batchEndDate === nextBatchEndDate) {
      return current;
    }

    return {
      ...current,
      batchEndDate: nextBatchEndDate,
    };
  });
}

export function setFilterJournal(nextFilterJournal: string) {
  updateWorkbenchContentState((current) => {
    if (current.filterJournal === nextFilterJournal) {
      return current;
    }

    return {
      ...current,
      filterJournal: nextFilterJournal,
    };
  });
}

export function resetWorkbenchContentFilters() {
  setFilterJournal('');
}

export function selectFilteredArticles(
  snapshot: WorkbenchContentStateSnapshot,
  articles: ReadonlyArray<Article>,
) {
  const journal = snapshot.filterJournal.trim().toLowerCase();
  if (!journal) {
    return articles.slice();
  }

  return articles.filter(
    (article) =>
      article.sourceUrl.toLowerCase().includes(journal) ||
      String(article.journalTitle ?? '')
        .toLowerCase()
        .includes(journal),
  );
}

export function selectHasData(articles: ReadonlyArray<Article>) {
  return articles.length > 0;
}

export function selectWorkbenchContentDerivedState(
  snapshot: WorkbenchContentStateSnapshot,
  articles: ReadonlyArray<Article>,
): WorkbenchContentDerivedState {
  return {
    filteredArticles: selectFilteredArticles(snapshot, articles),
    hasData: selectHasData(articles),
  };
}
