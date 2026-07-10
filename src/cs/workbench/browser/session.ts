import { EventEmitter } from "cs/base/common/event";
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';

export type SelectionModePhase = "off" | "multi" | "all";

export type WorkbenchSessionSnapshot = {
  webUrl: string;
  fetchSeedUrl: string;
  articles: FetchArticle[];
  selectionModePhase: SelectionModePhase;
  selectedArticleKeysInOrder: string[];
};

const DEFAULT_WORKBENCH_SESSION: WorkbenchSessionSnapshot = {
  webUrl: "",
  fetchSeedUrl: "",
  articles: [],
  selectionModePhase: "off",
  selectedArticleKeysInOrder: [],
};

let workbenchSessionState = DEFAULT_WORKBENCH_SESSION;
const onDidChangeWorkbenchSessionEmitter = new EventEmitter<void>();

function updateWorkbenchSessionState(
  reducer: (current: WorkbenchSessionSnapshot) => WorkbenchSessionSnapshot,
) {
  const nextState = reducer(workbenchSessionState);
  if (Object.is(nextState, workbenchSessionState)) {
    return;
  }

  workbenchSessionState = nextState;
  onDidChangeWorkbenchSessionEmitter.fire();
}

export function subscribeWorkbenchSession(listener: () => void) {
  return onDidChangeWorkbenchSessionEmitter.event(listener);
}

export function getWorkbenchSessionSnapshot() {
  return workbenchSessionState;
}

export function setWorkbenchWebUrl(webUrl: string) {
  updateWorkbenchSessionState((current) =>
    current.webUrl === webUrl ? current : { ...current, webUrl },
  );
}

export function setWorkbenchFetchSeedUrl(
  fetchSeedUrl: string | ((current: string) => string),
) {
  updateWorkbenchSessionState((current) => {
    const nextFetchSeedUrl =
      typeof fetchSeedUrl === "function"
        ? fetchSeedUrl(current.fetchSeedUrl)
        : fetchSeedUrl;

    return current.fetchSeedUrl === nextFetchSeedUrl
      ? current
      : { ...current, fetchSeedUrl: nextFetchSeedUrl };
  });
}

export function setWorkbenchArticles(
  articles: FetchArticle[] | ((current: FetchArticle[]) => FetchArticle[]),
) {
  updateWorkbenchSessionState((current) => {
    const nextArticles =
      typeof articles === 'function'
        ? articles(current.articles)
        : articles;

    return Object.is(current.articles, nextArticles)
      ? current
      : { ...current, articles: nextArticles };
  });
}

export function setWorkbenchSelectionModePhase(
  selectionModePhase: SelectionModePhase,
) {
  updateWorkbenchSessionState((current) =>
    current.selectionModePhase === selectionModePhase
      ? current
      : { ...current, selectionModePhase },
  );
}

export function setWorkbenchSelectedArticleKeysInOrder(
  selectedArticleKeysInOrder: string[] | ((current: string[]) => string[]),
) {
  updateWorkbenchSessionState((current) => {
    const nextSelectedArticleKeysInOrder =
      typeof selectedArticleKeysInOrder === "function"
        ? selectedArticleKeysInOrder(current.selectedArticleKeysInOrder)
        : selectedArticleKeysInOrder;

    return Object.is(
      current.selectedArticleKeysInOrder,
      nextSelectedArticleKeysInOrder,
    )
      ? current
      : {
          ...current,
          selectedArticleKeysInOrder: nextSelectedArticleKeysInOrder,
        };
  });
}
