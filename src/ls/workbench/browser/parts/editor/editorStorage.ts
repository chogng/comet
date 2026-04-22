import { createEmptyWritingEditorDocument, createWritingEditorDocumentFromPlainText, normalizeWritingEditorDocument, writingEditorDocumentToPlainText } from 'ls/editor/common/writingEditorDocument';
import type { WritingEditorDocument } from 'ls/editor/common/writingEditorDocument';

import {
  isEditorDraftTabInput,
  toEditorTabInput,
} from 'ls/workbench/browser/parts/editor/editorInput';
import type { EditorTabViewMode } from 'ls/workbench/browser/parts/editor/editorInput';
import type {
  EditorEditorGroupState,
  EditorWorkspaceDraftTab,
  EditorWorkspaceState,
} from 'ls/workbench/browser/parts/editor/editorModel';
import type {
  EditorDraftSavedStateByInputId,
} from 'ls/workbench/browser/parts/editor/editorDraftDirtyState';

export type StoredWritingWorkspaceState = {
  groups?: unknown;
  activeGroupId?: unknown;
  tabs?: unknown;
  inputs?: unknown;
  groupId?: unknown;
  activeTabId?: unknown;
  mruTabIds?: unknown;
  draftStateByInputId?: unknown;
  savedDraftStateByInputId?: unknown;
  viewStateEntries?: unknown;
};

type StoredWritingLegacyDraftState = {
  title: string;
  document: WritingEditorDocument;
  viewMode: EditorTabViewMode;
};

type StoredWritingDraftState = {
  title: string;
  document: WritingEditorDocument;
  viewMode: EditorTabViewMode;
};

type EditorPersistedState = {
  workspaceState: Pick<
    EditorWorkspaceState,
    'groups' | 'activeGroupId' | 'viewStateEntries'
  >;
  contextDraftTab: EditorWorkspaceDraftTab | null;
  savedDraftStateByInputId: EditorDraftSavedStateByInputId;
};

type EditorStorageOptions = {
  debounceMs?: number;
};

const DEFAULT_VIEW_MODE: EditorTabViewMode = 'draft';
const DEFAULT_PERSIST_DEBOUNCE_MS = 250;

const storageKeys = {
  title: 'ls.writingDraft.title',
  body: 'ls.writingDraft.body',
  document: 'ls.writingDraft.document',
  viewMode: 'ls.writingDraft.viewMode',
  workspace: 'ls.writingWorkspace.state',
} as const;

function readStoredValue(key: string): string {
  if (typeof window === 'undefined') {
    return '';
  }

  try {
    return window.localStorage.getItem(key) ?? '';
  } catch {
    return '';
  }
}

function writeStoredValue(key: string, value: string) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (value) {
      window.localStorage.setItem(key, value);
      return;
    }

    window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures so the editor still works in restricted runtimes.
  }
}

function readStoredViewMode(): EditorTabViewMode {
  const value = readStoredValue(storageKeys.viewMode);
  if (value === 'draft') {
    return value;
  }

  if (value === 'split') {
    return DEFAULT_VIEW_MODE;
  }

  return DEFAULT_VIEW_MODE;
}

function readStoredDocument(): WritingEditorDocument {
  const rawDocument = readStoredValue(storageKeys.document);
  if (rawDocument) {
    try {
      return normalizeWritingEditorDocument(JSON.parse(rawDocument));
    } catch {
      return createEmptyWritingEditorDocument();
    }
  }

  const legacyBody = readStoredValue(storageKeys.body);
  return legacyBody
    ? createWritingEditorDocumentFromPlainText(legacyBody)
    : createEmptyWritingEditorDocument();
}

function createStoredDraftStateByInputId(
  workspaceState: Pick<EditorWorkspaceState, 'groups'>,
) {
  return Object.fromEntries(
    workspaceState.groups
      .flatMap((group) => group.tabs)
      .filter((tab): tab is EditorWorkspaceDraftTab => isEditorDraftTabInput(tab))
      .map((tab) => [
        tab.id,
        {
          title: tab.title,
          document: tab.document,
          viewMode: tab.viewMode,
        } satisfies StoredWritingDraftState,
      ]),
  );
}

function serializeStoredGroup(group: EditorEditorGroupState) {
  return {
    groupId: group.groupId,
    inputs: group.tabs.map((tab) => ({
      ...toEditorTabInput(tab),
      residency: tab.residency,
    })),
    activeTabId: group.activeTabId,
    mruTabIds: group.mruTabIds,
  };
}

function persistState({
  workspaceState,
  contextDraftTab,
  savedDraftStateByInputId,
}: EditorPersistedState) {
  const draftStateByInputId = createStoredDraftStateByInputId(workspaceState);
  writeStoredValue(
    storageKeys.workspace,
    JSON.stringify({
      groups: workspaceState.groups.map((group) => serializeStoredGroup(group)),
      activeGroupId: workspaceState.activeGroupId,
      draftStateByInputId,
      savedDraftStateByInputId,
      viewStateEntries: workspaceState.viewStateEntries,
    }),
  );
  writeStoredValue(storageKeys.title, contextDraftTab?.title ?? '');
  writeStoredValue(
    storageKeys.document,
    contextDraftTab ? JSON.stringify(contextDraftTab.document) : '',
  );
  writeStoredValue(
    storageKeys.body,
    contextDraftTab ? writingEditorDocumentToPlainText(contextDraftTab.document) : '',
  );
  writeStoredValue(storageKeys.viewMode, contextDraftTab?.viewMode ?? DEFAULT_VIEW_MODE);
}

export class EditorStorage {
  private readonly debounceMs: number;
  private persistTimer: number | null = null;
  private pendingState: EditorPersistedState | null = null;

  constructor(options: EditorStorageOptions = {}) {
    this.debounceMs = options.debounceMs ?? DEFAULT_PERSIST_DEBOUNCE_MS;
  }

  readWorkspaceState() {
    const rawWorkspace = readStoredValue(storageKeys.workspace);
    if (!rawWorkspace) {
      return null;
    }

    try {
      return JSON.parse(rawWorkspace) as StoredWritingWorkspaceState;
    } catch {
      return null;
    }
  }

  readLegacyDraftState(): StoredWritingLegacyDraftState {
    return {
      title: readStoredValue(storageKeys.title),
      document: readStoredDocument(),
      viewMode: readStoredViewMode(),
    };
  }

  save(state: EditorPersistedState) {
    this.clearPendingPersist();
    persistState(state);
  }

  scheduleSave(state: EditorPersistedState) {
    if (typeof window === 'undefined') {
      return;
    }

    this.pendingState = state;
    if (this.persistTimer !== null) {
      window.clearTimeout(this.persistTimer);
    }

    this.persistTimer = window.setTimeout(() => {
      const nextState = this.pendingState;
      this.persistTimer = null;
      this.pendingState = null;
      if (nextState) {
        persistState(nextState);
      }
    }, this.debounceMs);
  }

  dispose() {
    const nextState = this.pendingState;
    this.clearPendingPersist();
    if (nextState) {
      persistState(nextState);
    }
  }

  private clearPendingPersist() {
    if (this.persistTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.persistTimer);
    }

    this.persistTimer = null;
    this.pendingState = null;
  }
}

export function createEditorStorage(options?: EditorStorageOptions) {
  return new EditorStorage(options);
}
