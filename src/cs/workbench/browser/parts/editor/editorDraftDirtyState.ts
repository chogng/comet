import {
  normalizeWritingEditorDocument,
} from 'cs/editor/common/writingEditorDocument';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import type { EditorTabViewMode } from 'cs/workbench/browser/parts/editor/editorInput';

export type EditorDraftSavedState = {
  title: string;
  documentKey: string;
  viewMode: EditorTabViewMode;
};

export type EditorDraftSavedStateByInputId = Record<string, EditorDraftSavedState>;

type DraftTabLike = {
  id: string;
  kind: 'draft';
  title: string;
  document: WritingEditorDocument;
  viewMode: EditorTabViewMode;
};

type WorkspaceTabLike = {
  id: string;
  kind: string;
};

function normalizeDraftViewMode(viewMode: EditorTabViewMode) {
  return viewMode === 'draft' ? viewMode : 'draft';
}

function createDraftDocumentKey(document: WritingEditorDocument) {
  return JSON.stringify(normalizeWritingEditorDocument(document));
}

function toSavedState(value: DraftTabLike): EditorDraftSavedState {
  return {
    title: value.title,
    documentKey: createDraftDocumentKey(value.document),
    viewMode: normalizeDraftViewMode(value.viewMode),
  };
}

function isDraftTab(tab: WorkspaceTabLike): tab is DraftTabLike {
  return tab.kind === 'draft';
}

export class EditorDraftDirtyState {
  private savedStateByTabId: EditorDraftSavedStateByInputId;

  constructor(initialSavedStateByTabId: EditorDraftSavedStateByInputId = {}) {
    this.savedStateByTabId = initialSavedStateByTabId;
  }

  syncTabs(tabs: readonly WorkspaceTabLike[]) {
    const nextSavedStateByTabId: EditorDraftSavedStateByInputId = {};

    for (const tab of tabs) {
      if (!isDraftTab(tab)) {
        continue;
      }

      nextSavedStateByTabId[tab.id] = this.savedStateByTabId[tab.id] ?? toSavedState(tab);
    }

    this.savedStateByTabId = nextSavedStateByTabId;
  }

  isTabDirty(tabId: string, tabs: readonly WorkspaceTabLike[]) {
    const tab = tabs.find(
      (candidate): candidate is DraftTabLike =>
        candidate.id === tabId && isDraftTab(candidate),
    );
    if (!tab) {
      return false;
    }

    return this.isDraftTabDirty(tab);
  }

  getDirtyDraftTabIds(tabs: readonly WorkspaceTabLike[]) {
    return tabs
      .filter((tab): tab is DraftTabLike => isDraftTab(tab))
      .filter((tab) => this.isDraftTabDirty(tab))
      .map((tab) => tab.id);
  }

  markTabSaved(tabId: string, tabs: readonly WorkspaceTabLike[]) {
    const tab = tabs.find(
      (candidate): candidate is DraftTabLike =>
        candidate.id === tabId && isDraftTab(candidate),
    );
    if (!tab) {
      return false;
    }

    this.savedStateByTabId = {
      ...this.savedStateByTabId,
      [tab.id]: toSavedState(tab),
    };

    return true;
  }

  getSavedStateByTabId() {
    return this.savedStateByTabId;
  }

  private isDraftTabDirty(tab: DraftTabLike) {
    const savedState = this.savedStateByTabId[tab.id];
    if (!savedState) {
      return false;
    }

    const currentViewMode = normalizeDraftViewMode(tab.viewMode);
    if (
      tab.title !== savedState.title ||
      currentViewMode !== savedState.viewMode
    ) {
      return true;
    }

    return createDraftDocumentKey(tab.document) !== savedState.documentKey;
  }
}

export function createEditorDraftDirtyState(
  initialSavedStateByTabId?: EditorDraftSavedStateByInputId,
) {
  return new EditorDraftDirtyState(initialSavedStateByTabId);
}
