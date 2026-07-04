import { EventEmitter } from "cs/base/common/event";
import type { Article } from "cs/workbench/services/article/articleFetch";

export type SelectionModePhase = "off" | "multi" | "all";

export type WorkbenchSessionSnapshot = {
  webUrl: string;
  fetchSeedUrl: string;
  articles: Article[];
  selectionModePhase: SelectionModePhase;
  selectedArticleKeysInOrder: string[];
  selectedChatArticleUrlsInOrder: string[];
};

const DEFAULT_WORKBENCH_SESSION: WorkbenchSessionSnapshot = {
  webUrl: "",
  fetchSeedUrl: "",
  articles: [],
  selectionModePhase: "off",
  selectedArticleKeysInOrder: [],
  selectedChatArticleUrlsInOrder: [],
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
  articles: Article[] | ((current: Article[]) => Article[]),
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

export function setWorkbenchSelectedChatArticleUrlsInOrder(
  selectedChatArticleUrlsInOrder: string[] | ((current: string[]) => string[]),
) {
  updateWorkbenchSessionState((current) => {
    const nextSelectedChatArticleUrlsInOrder =
      typeof selectedChatArticleUrlsInOrder === "function"
        ? selectedChatArticleUrlsInOrder(current.selectedChatArticleUrlsInOrder)
        : selectedChatArticleUrlsInOrder;

    return Object.is(
      current.selectedChatArticleUrlsInOrder,
      nextSelectedChatArticleUrlsInOrder,
    )
      ? current
      : {
          ...current,
          selectedChatArticleUrlsInOrder: nextSelectedChatArticleUrlsInOrder,
        };
  });
}
