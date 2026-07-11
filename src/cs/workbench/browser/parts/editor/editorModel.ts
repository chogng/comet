import { createEmptyWritingEditorDocument, normalizeWritingEditorDocument, writingEditorDocumentToPlainText } from 'cs/editor/common/writingEditorDocument';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

import {
  EMPTY_PDF_TAB_URL,
  EMPTY_BROWSER_TAB_URL,
  createEditorBrowserTabInput,
  createEditorDraftTabInput,
  createEditorPdfTabInput,
  getEditorContentTabInputOpenKey,
  isEmptyBrowserTabInput,
  isEmptyPdfTabInput,
  isEditorBrowserTabInput,
  isEditorDraftTabInput,
  isEditorPdfTabInput,
  normalizeEditorTabInput,
  toEditorTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import type {
  EditorBrowserTabInput,
  EditorDraftTabInput,
  EditorTabInput,
  EditorPdfTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import {
  createEditorDraftDirtyState,
} from 'cs/workbench/browser/parts/editor/editorDraftDirtyState';
import type {
  EditorDraftSavedState,
  EditorDraftSavedStateByInputId,
} from 'cs/workbench/browser/parts/editor/editorDraftDirtyState';
import { createEditorLiveDraftState } from 'cs/workbench/browser/parts/editor/editorLiveState';
import { createEditorStorage } from 'cs/workbench/browser/parts/editor/editorStorage';
import type { StoredWritingWorkspaceState } from 'cs/workbench/browser/parts/editor/editorStorage';
import {
  createEditorGroupId,
  DEFAULT_EDITOR_GROUP_ID,
  normalizeEditorGroupId,
} from 'cs/workbench/browser/editorGroupIdentity';
import {
  normalizeSerializedEditorViewStateEntries,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type {
  EditorViewStateKey,
  SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import { getEditorContentTabTitle } from 'cs/workbench/browser/parts/editor/editorUrlPresentation';
import type { BrowserEditorPaneState } from 'cs/workbench/browser/parts/editor/panes/browserEditorPane';

export type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

// Content tabs only store editor input metadata. The active content tab temporarily owns one shared
// web-content surface instead of spawning a dedicated browser/view instance per tab.
export type EditorWorkspaceDraftTab = EditorDraftTabInput & {
  document: WritingEditorDocument;
};

export type EditorWorkspaceBrowserTab = EditorBrowserTabInput;
export type EditorWorkspacePdfTab = EditorPdfTabInput;
export type EditorWorkspaceContentTab =
  | EditorWorkspaceBrowserTab
  | EditorWorkspacePdfTab;

export type EditorWorkspaceTab =
  | EditorWorkspaceDraftTab
  | EditorWorkspaceContentTab;

export type EditorEditorGroupState = {
  groupId: string;
  tabs: EditorWorkspaceTab[];
  activeTabId: string | null;
  mruTabIds: string[];
};

export type EditorWorkspaceState = {
  groups: EditorEditorGroupState[];
  activeGroupId: string | null;
  viewStateEntries: SerializedEditorViewStateEntry[];
};

export type EditorModelSnapshot = {
  groups: EditorEditorGroupState[];
  activeGroupId: string;
  groupId: string;
  tabs: EditorWorkspaceTab[];
  dirtyDraftTabIds: string[];
  activeTabId: string | null;
  mruTabIds: string[];
  activeTab: EditorWorkspaceTab | null;
  viewStateEntries: SerializedEditorViewStateEntry[];
};

export type EditorGroupTarget = {
  groupId?: string;
  activateGroup?: boolean;
};

export type CreateContentTabOptions = {
  id?: string;
  reuseExisting?: boolean;
};

type EditorModelListener = () => void;

type ResolvedEditorGroupTarget = {
  groupId: string;
  activateGroup: boolean;
};

type BrowserTabTitleSource =
  | 'custom'
  | 'auto-page'
  | 'auto-url'
  | 'empty';

type BrowserTabMetadata = {
  titleSource: BrowserTabTitleSource;
  lastPageTitle: string;
};

function createDraftTab(
  initial?: Partial<Pick<EditorWorkspaceDraftTab, 'id' | 'title' | 'document' | 'viewMode'>>,
): EditorWorkspaceDraftTab {
  return {
    ...createEditorDraftTabInput({
      id: initial?.id,
      title: initial?.title,
      viewMode: initial?.viewMode,
    }),
    document: normalizeWritingEditorDocument(
      initial?.document ?? createEmptyWritingEditorDocument(),
    ),
  };
}

function createNormalizedDocumentKey(document: unknown) {
  return JSON.stringify(normalizeWritingEditorDocument(document));
}

function createBrowserTab(
  url: string,
  initial?: Partial<Pick<EditorWorkspaceBrowserTab, 'id' | 'title'>>,
): EditorWorkspaceBrowserTab {
  return createEditorBrowserTabInput(url, initial);
}

function createPdfTab(
  url: string,
  initial?: Partial<Pick<EditorWorkspacePdfTab, 'id' | 'title'>>,
): EditorWorkspacePdfTab {
  return createEditorPdfTabInput(url, initial);
}

function normalizeWorkspaceTab(value: unknown): EditorWorkspaceTab | null {
  const candidate = value as Partial<EditorWorkspaceDraftTab> | null | undefined;
  const normalizedInput = normalizeEditorTabInput(value);
  if (!candidate || typeof candidate !== 'object' || !normalizedInput) {
    return null;
  }

  if (isEditorDraftTabInput(normalizedInput)) {
    const tab = createDraftTab({
      id: normalizedInput.id,
      title: normalizedInput.title,
      document: candidate.document,
      viewMode: normalizedInput.viewMode,
    });
    return tab;
  }

  return normalizedInput;
}

function getPreferredDuplicateTabId(
  tabs: EditorWorkspaceTab[],
  tabIds: readonly string[],
  activeTabId: string | null,
  mruTabIds: readonly string[],
) {
  if (activeTabId && tabIds.includes(activeTabId)) {
    return activeTabId;
  }

  const mruTabId = mruTabIds.find((tabId) => tabIds.includes(tabId));
  if (mruTabId) {
    return mruTabId;
  }

  return tabIds.find((tabId) => tabs.some((tab) => tab.id === tabId)) ?? null;
}

function dedupeContentTabs(
  state: EditorEditorGroupState,
): EditorEditorGroupState {
  const duplicateIdsByOpenKey = new Map<string, string[]>();
  for (const tab of state.tabs) {
    if (!isEditorPdfTabInput(tab)) {
      continue;
    }

    const openKey = getEditorContentTabInputOpenKey(tab);
    const duplicateIds = duplicateIdsByOpenKey.get(openKey);
    if (duplicateIds) {
      duplicateIds.push(tab.id);
      continue;
    }

    duplicateIdsByOpenKey.set(openKey, [tab.id]);
  }

  const retainedIds = new Set<string>();
  const replacedIdByDuplicateId = new Map<string, string>();
  for (const duplicateIds of duplicateIdsByOpenKey.values()) {
    if (duplicateIds.length === 1) {
      retainedIds.add(duplicateIds[0]!);
      continue;
    }

    const retainedId = getPreferredDuplicateTabId(
      state.tabs,
      duplicateIds,
      state.activeTabId,
      state.mruTabIds,
    );
    if (!retainedId) {
      continue;
    }

    retainedIds.add(retainedId);
    for (const duplicateId of duplicateIds) {
      if (duplicateId !== retainedId) {
        replacedIdByDuplicateId.set(duplicateId, retainedId);
      }
    }
  }

  if (replacedIdByDuplicateId.size === 0) {
    return state;
  }

  const nextTabs = state.tabs.filter((tab) => {
    if (!isEditorBrowserTabInput(tab) && !isEditorPdfTabInput(tab)) {
      return true;
    }

    return retainedIds.has(tab.id);
  });

  return {
    ...state,
    tabs: nextTabs,
    activeTabId: state.activeTabId
      ? replacedIdByDuplicateId.get(state.activeTabId) ?? state.activeTabId
      : null,
    mruTabIds: toUniqueIds(
      state.mruTabIds.map((tabId) =>
        replacedIdByDuplicateId.get(tabId) ?? tabId,
      ),
    ),
  };
}

function normalizeEditorGroupState(
  state: EditorEditorGroupState,
): EditorEditorGroupState {
  const normalizedGroupId = normalizeEditorGroupId(state.groupId);
  const tabs = state.tabs;
  const tabIdSet = new Set(tabs.map((tab) => tab.id));
  const normalizedMruTabIds = toUniqueIds(
    [...state.mruTabIds, ...tabs.map((tab) => tab.id)].filter((tabId) =>
      tabIdSet.has(tabId),
    ),
  );

  const activeTabId =
    state.activeTabId && tabIdSet.has(state.activeTabId)
      ? state.activeTabId
      : normalizedMruTabIds[0] ?? tabs[0]?.id ?? null;

  return {
    groupId: normalizedGroupId,
    tabs,
    activeTabId,
    mruTabIds: activeTabId
      ? touchMruTab(normalizedMruTabIds, activeTabId)
      : normalizedMruTabIds,
  };
}

type StoredDraftState = Partial<
  Pick<EditorWorkspaceDraftTab, 'title' | 'document' | 'viewMode'>
>;

function normalizeStoredDraftState(value: unknown): StoredDraftState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<EditorWorkspaceDraftTab>;
  return {
    title: typeof candidate.title === 'string' ? candidate.title : undefined,
    document: candidate.document,
    viewMode: candidate.viewMode === 'draft' ? candidate.viewMode : undefined,
  };
}

function normalizeStoredDraftStateByInputId(
  value: StoredWritingWorkspaceState['draftStateByInputId'],
) {
  if (!value || typeof value !== 'object') {
    return {} as Record<string, StoredDraftState>;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([tabId, draftState]) => {
      const normalizedDraftState = normalizeStoredDraftState(draftState);
      return normalizedDraftState ? [[tabId, normalizedDraftState]] : [];
    }),
  ) as Record<string, StoredDraftState>;
}

function normalizeStoredSavedDraftState(
  value: unknown,
): EditorDraftSavedState | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const candidate = value as Partial<EditorWorkspaceDraftTab> & {
    documentKey?: unknown;
  };
  if (typeof candidate.title !== 'string') {
    return null;
  }

  return {
    title: candidate.title,
    documentKey:
      typeof candidate.documentKey === 'string'
        ? candidate.documentKey
        : createNormalizedDocumentKey(candidate.document),
    viewMode: candidate.viewMode === 'draft' ? candidate.viewMode : 'draft',
  };
}

function normalizeStoredSavedDraftStateByInputId(
  value: StoredWritingWorkspaceState['savedDraftStateByInputId'],
) {
  if (!value || typeof value !== 'object') {
    return {} as EditorDraftSavedStateByInputId;
  }

  return Object.fromEntries(
    Object.entries(value).flatMap(([tabId, savedState]) => {
      const normalizedSavedState = normalizeStoredSavedDraftState(savedState);
      return normalizedSavedState ? [[tabId, normalizedSavedState]] : [];
    }),
  ) as EditorDraftSavedStateByInputId;
}

function createWorkspaceTabFromStoredInput(
  input: EditorWorkspaceTab,
  draftStateByInputId: Record<string, StoredDraftState>,
): EditorWorkspaceTab {
  if (isEditorDraftTabInput(input)) {
    const draftState = draftStateByInputId[input.id];
    return createDraftTab({
      id: input.id,
      title: draftState?.title ?? input.title,
      document: draftState?.document,
      viewMode: draftState?.viewMode ?? input.viewMode,
    });
  }

  return input;
}

function restoreWorkspaceTab(
  value: unknown,
  draftStateByInputId: Record<string, StoredDraftState>,
): EditorWorkspaceTab | null {
  const input = normalizeWorkspaceTab(value);
  if (!input) {
    return null;
  }

  const tab = createWorkspaceTabFromStoredInput(input, draftStateByInputId);
  const residency = (value as { residency?: unknown } | null)?.residency;
  if (residency !== 'resident') {
    return tab;
  }

  if (isEditorDraftTabInput(tab)) {
    return !tab.title.trim() && !writingEditorDocumentToPlainText(tab.document)
      ? null
      : tab;
  }

  return isEmptyBrowserTabInput(tab) || isEmptyPdfTabInput(tab)
    ? null
    : tab;
}

function toUniqueIds(values: ReadonlyArray<string>) {
  return Array.from(new Set(values));
}

function touchMruTab(mruTabIds: ReadonlyArray<string>, tabId: string) {
  return [tabId, ...mruTabIds.filter((value) => value !== tabId)];
}

function reorderTabsById<T extends { id: string }>(
  tabs: T[],
  tabId: string,
  targetSlotIndex: number,
): T[] {
  const sourceIndex = tabs.findIndex((tab) => tab.id === tabId);
  if (sourceIndex < 0) {
    return tabs;
  }

  const nextTabs = [...tabs];
  const [movedTab] = nextTabs.splice(sourceIndex, 1);
  if (!movedTab) {
    return tabs;
  }

  const normalizedTargetSlotIndex = Math.max(
    0,
    Math.min(targetSlotIndex, tabs.length),
  );
  const insertionIndex =
    normalizedTargetSlotIndex > sourceIndex
      ? normalizedTargetSlotIndex - 1
      : normalizedTargetSlotIndex;
  if (insertionIndex === sourceIndex) {
    return tabs;
  }

  nextTabs.splice(insertionIndex, 0, movedTab);
  return nextTabs;
}

function createEmptyEditorGroupState(groupId: string): EditorEditorGroupState {
  return {
    groupId: normalizeEditorGroupId(groupId),
    tabs: [],
    activeTabId: null,
    mruTabIds: [],
  };
}

function ensureWorkspaceGroup(
  workspaceState: EditorWorkspaceState,
  groupId: string,
): EditorWorkspaceState {
  const normalizedGroupId = normalizeEditorGroupId(groupId);
  if (workspaceState.groups.some((group) => group.groupId === normalizedGroupId)) {
    return workspaceState;
  }

  return {
    ...workspaceState,
    groups: [...workspaceState.groups, createEmptyEditorGroupState(normalizedGroupId)],
  };
}

function normalizeWorkspaceState(
  state: EditorWorkspaceState,
): EditorWorkspaceState {
  const normalizedGroups = toUniqueIds(
    state.groups.map((group) => normalizeEditorGroupId(group.groupId)),
  ).map((groupId) =>
    normalizeEditorGroupState(
      state.groups.find((group) => normalizeEditorGroupId(group.groupId) === groupId) ??
        createEmptyEditorGroupState(groupId),
    ),
  );
  const groups =
    normalizedGroups.length > 0
      ? normalizedGroups
      : [
          normalizeEditorGroupState(createEmptyEditorGroupState(DEFAULT_EDITOR_GROUP_ID)),
        ];
  const activeGroupId = groups.some((group) => group.groupId === state.activeGroupId)
    ? (state.activeGroupId as string)
    : groups[0].groupId;
  const groupIdSet = new Set(groups.map((group) => group.groupId));

  return {
    groups,
    activeGroupId,
    viewStateEntries: normalizeSerializedEditorViewStateEntries(
      state.viewStateEntries,
    ).filter((entry) => groupIdSet.has(entry.key.groupId)),
  };
}

function migrateLegacyWorkspaceState(
  storage = createEditorStorage(),
): EditorWorkspaceState {
  const legacyDraftState = storage.readLegacyDraftState();
  const hasLegacyDraft = Boolean(
    legacyDraftState.title.trim() ||
      writingEditorDocumentToPlainText(legacyDraftState.document),
  );
  const initialDraftTab = hasLegacyDraft
    ? createDraftTab({
        title: legacyDraftState.title,
        document: legacyDraftState.document,
        viewMode: legacyDraftState.viewMode,
      })
    : null;

  return {
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: initialDraftTab ? [initialDraftTab] : [],
        activeTabId: initialDraftTab?.id ?? null,
        mruTabIds: initialDraftTab ? [initialDraftTab.id] : [],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  };
}

function readStoredWorkspaceState(
  storage = createEditorStorage(),
): {
  workspaceState: EditorWorkspaceState;
  savedDraftStateByInputId: EditorDraftSavedStateByInputId;
} {
  const rawWorkspace = storage.readWorkspaceState();
  if (!rawWorkspace) {
    return {
      workspaceState: migrateLegacyWorkspaceState(storage),
      savedDraftStateByInputId: {},
    };
  }

  try {
    const draftStateByInputId = normalizeStoredDraftStateByInputId(
      rawWorkspace.draftStateByInputId,
    );
    const savedDraftStateByInputId = normalizeStoredSavedDraftStateByInputId(
      rawWorkspace.savedDraftStateByInputId,
    );
    const groups = Array.isArray(rawWorkspace.groups)
      ? rawWorkspace.groups.flatMap((group) => {
          if (!group || typeof group !== 'object') {
            return [];
          }

          const candidate = group as {
            groupId?: unknown;
            inputs?: unknown;
            tabs?: unknown;
            activeTabId?: unknown;
            mruTabIds?: unknown;
          };
          const tabs = Array.isArray(candidate.inputs)
            ? candidate.inputs
                .map((input) => restoreWorkspaceTab(input, draftStateByInputId))
                .filter((input): input is EditorWorkspaceTab => Boolean(input))
            : Array.isArray(candidate.tabs)
              ? candidate.tabs
                  .map((tab) => restoreWorkspaceTab(tab, draftStateByInputId))
                  .filter((tab): tab is EditorWorkspaceTab => Boolean(tab))
              : [];
          const activeTabId =
            typeof candidate.activeTabId === 'string'
              ? candidate.activeTabId
              : null;
          const mruTabIds = Array.isArray(candidate.mruTabIds)
            ? candidate.mruTabIds.filter(
                (tabId): tabId is string => typeof tabId === 'string',
              )
            : [];

          return [
            {
              groupId:
                typeof candidate.groupId === 'string'
                  ? candidate.groupId
                  : DEFAULT_EDITOR_GROUP_ID,
              tabs,
              activeTabId,
              mruTabIds,
            } satisfies EditorEditorGroupState,
          ];
        })
      : (() => {
          const tabs = Array.isArray(rawWorkspace.inputs)
            ? rawWorkspace.inputs
                .map((input) => restoreWorkspaceTab(input, draftStateByInputId))
                .filter((input): input is EditorWorkspaceTab => Boolean(input))
            : Array.isArray(rawWorkspace.tabs)
              ? rawWorkspace.tabs
                  .map((tab) => restoreWorkspaceTab(tab, draftStateByInputId))
                  .filter((tab): tab is EditorWorkspaceTab => Boolean(tab))
              : [];
          const activeTabId =
            typeof rawWorkspace.activeTabId === 'string'
              ? rawWorkspace.activeTabId
              : null;
          const groupId =
            typeof rawWorkspace.groupId === 'string'
              ? rawWorkspace.groupId
              : DEFAULT_EDITOR_GROUP_ID;
          const mruTabIds = Array.isArray(rawWorkspace.mruTabIds)
            ? rawWorkspace.mruTabIds.filter(
                (tabId): tabId is string => typeof tabId === 'string',
              )
            : [];

          return [
            {
              groupId,
              tabs,
              activeTabId,
              mruTabIds,
            } satisfies EditorEditorGroupState,
          ];
        })();
    const activeGroupId =
      typeof rawWorkspace.activeGroupId === 'string'
        ? rawWorkspace.activeGroupId
        : typeof rawWorkspace.groupId === 'string'
          ? rawWorkspace.groupId
          : DEFAULT_EDITOR_GROUP_ID;
    const viewStateEntries = normalizeSerializedEditorViewStateEntries(
      rawWorkspace.viewStateEntries,
    );

    return {
      workspaceState: normalizeWorkspaceState({
        groups: groups.map((group) => dedupeContentTabs(group)),
        activeGroupId,
        viewStateEntries,
      }),
      savedDraftStateByInputId,
    };
  } catch {
    return {
      workspaceState: migrateLegacyWorkspaceState(storage),
      savedDraftStateByInputId: {},
    };
  }
}

function resolveActiveGroup(workspaceState: EditorWorkspaceState) {
  return (
    workspaceState.groups.find((group) => group.groupId === workspaceState.activeGroupId) ??
    workspaceState.groups[0]
  );
}

function resolveActiveTab(groupState: EditorEditorGroupState) {
  return (
    groupState.tabs.find((tab) => tab.id === groupState.activeTabId) ??
    groupState.tabs[0] ??
    null
  );
}

function resolveContextDraftTab(
  groupState: EditorEditorGroupState,
  activeTab: EditorWorkspaceTab | null,
) {
  if (isEditorDraftTabInput(activeTab)) {
    return activeTab;
  }

  const tabById = new Map(groupState.tabs.map((tab) => [tab.id, tab] as const));
  return (
    groupState.mruTabIds
      .map((tabId) => tabById.get(tabId))
      .find((tab): tab is EditorWorkspaceDraftTab => isEditorDraftTabInput(tab)) ??
    null
  );
}

export function toEditorWorkspaceTabInput(tab: EditorWorkspaceTab): EditorTabInput {
  return toEditorTabInput(tab);
}

function inferBrowserTabTitleSource(
  tab: EditorWorkspaceBrowserTab,
): BrowserTabTitleSource {
  const normalizedUrl = tab.url.trim();
  const normalizedTitle = tab.title.trim();
  if (normalizedUrl === EMPTY_BROWSER_TAB_URL) {
    return 'empty';
  }

  if (!normalizedTitle || normalizedTitle === getEditorContentTabTitle(normalizedUrl)) {
    return 'auto-url';
  }

  return 'custom';
}

function sanitizeBrowserTabPageTitle(
  pageTitle: string,
  tabUrl: string,
) {
  const normalizedPageTitle = pageTitle.trim();
  if (!normalizedPageTitle) {
    return '';
  }

  if (
    /^about:blank$/i.test(normalizedPageTitle) ||
    /^https?:\/\/about:blank$/i.test(normalizedPageTitle)
  ) {
    return '';
  }

  return tabUrl.trim() === EMPTY_BROWSER_TAB_URL ? '' : normalizedPageTitle;
}

function sanitizeBrowserTabFaviconUrl(value: unknown) {
  return String(value ?? '').trim();
}

function resolveBrowserTabTitleFromSource(
  tab: EditorWorkspaceBrowserTab,
  titleSource: BrowserTabTitleSource,
) {
  if (titleSource === 'empty') {
    return '';
  }

  if (titleSource === 'auto-url') {
    return getEditorContentTabTitle(tab.url);
  }

  return tab.title;
}

function createEditorModelSnapshot(
  workspaceState: EditorWorkspaceState,
  draftDirtyState: ReturnType<typeof createEditorDraftDirtyState>,
): EditorModelSnapshot {
  const activeGroup = resolveActiveGroup(workspaceState);
  const activeTab = resolveActiveTab(activeGroup);
  const dirtyDraftTabIds = draftDirtyState.getDirtyDraftTabIds(
    activeGroup.tabs,
  );

  return {
    groups: workspaceState.groups,
    activeGroupId: activeGroup.groupId,
    groupId: activeGroup.groupId,
    tabs: activeGroup.tabs,
    dirtyDraftTabIds,
    activeTabId: activeGroup.activeTabId,
    mruTabIds: activeGroup.mruTabIds,
    activeTab,
    viewStateEntries: workspaceState.viewStateEntries,
  };
}

export class EditorModel {
  private workspaceState: EditorWorkspaceState;
  private snapshot: EditorModelSnapshot;
  private readonly draftDirtyState: ReturnType<typeof createEditorDraftDirtyState>;
  private readonly liveDraftState = createEditorLiveDraftState();
  private readonly storage = createEditorStorage();
  private readonly browserTabMetadataById = new Map<string, BrowserTabMetadata>();
  private listeners = new Set<EditorModelListener>();

  constructor(
    initialState: EditorWorkspaceState,
    initialSavedDraftStateByInputId: EditorDraftSavedStateByInputId = {},
  ) {
    this.workspaceState = normalizeWorkspaceState(initialState);
    this.syncBrowserTabMetadata();
    this.draftDirtyState = createEditorDraftDirtyState(
      initialSavedDraftStateByInputId,
    );
    this.syncDraftDirtyState();
    this.syncLiveDraftState();
    this.snapshot = createEditorModelSnapshot(
      this.workspaceState,
      this.draftDirtyState,
    );
    this.storage.save(this.createPersistedState());
  }

  readonly subscribe = (listener: EditorModelListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  readonly getSnapshot = () => this.snapshot;
  readonly getDraftBody = () => this.liveDraftState.getContextDraftBody();
  readonly getDraftDocument = () => this.liveDraftState.getActiveDraftDocument();
  readonly getDirtyDraftTabIds = (tabIds?: readonly string[]) => {
    const tabs = tabIds
      ? this.snapshot.tabs.filter((tab) => tabIds.includes(tab.id))
      : this.snapshot.tabs;
    return this.draftDirtyState.getDirtyDraftTabIds(tabs);
  };
  readonly canSaveActiveDraft = () => {
    const activeTab = this.snapshot.activeTab;
    return Boolean(activeTab && isEditorDraftTabInput(activeTab));
  };
  readonly saveDraftTab = (tabId: string) => {
    if (!this.draftDirtyState.isTabDirty(tabId, this.snapshot.tabs)) {
      return false;
    }

    const didSave = this.draftDirtyState.markTabSaved(tabId, this.snapshot.tabs);
    if (!didSave) {
      return false;
    }

    this.snapshot = createEditorModelSnapshot(
      this.workspaceState,
      this.draftDirtyState,
    );
    this.storage.save(this.createPersistedState());
    this.emitChange();
    return true;
  };
  readonly saveActiveDraft = () => {
    const activeTab = this.snapshot.activeTab;
    if (!activeTab || !isEditorDraftTabInput(activeTab)) {
      return false;
    }

    if (!this.draftDirtyState.isTabDirty(activeTab.id, this.snapshot.tabs)) {
      return true;
    }

    return this.saveDraftTab(activeTab.id);
  };

  readonly createGroup = (
    options: {
      groupId?: string;
      activate?: boolean;
    } = {},
  ) => {
    const nextGroupId = normalizeEditorGroupId(
      options.groupId ?? createEditorGroupId(),
    );
    const shouldActivate = options.activate ?? true;
    const groupExists = this.workspaceState.groups.some(
      (group) => group.groupId === nextGroupId,
    );

    if (groupExists) {
      if (shouldActivate) {
        this.activateGroup(nextGroupId);
      }

      return nextGroupId;
    }

    this.updateWorkspaceState((workspaceState) => {
      const nextWorkspaceState = ensureWorkspaceGroup(workspaceState, nextGroupId);
      return {
        ...nextWorkspaceState,
        activeGroupId: shouldActivate
          ? nextGroupId
          : nextWorkspaceState.activeGroupId,
      };
    });

    return nextGroupId;
  };

  readonly activateGroup = (groupId: string) => {
    const normalizedGroupId = normalizeEditorGroupId(groupId);
    if (
      this.workspaceState.activeGroupId === normalizedGroupId ||
      !this.workspaceState.groups.some((group) => group.groupId === normalizedGroupId)
    ) {
      return;
    }

    this.updateWorkspaceState((workspaceState) => ({
      ...workspaceState,
      activeGroupId: normalizedGroupId,
    }));
  };

  readonly activateTab = (tabId: string) => {
    const targetGroup = this.workspaceState.groups.find(group =>
      group.tabs.some(tab => tab.id === tabId),
    );
    if (!targetGroup) {
      return;
    }

    this.updateTargetGroupState({ groupId: targetGroup.groupId, activateGroup: true }, group => ({
      ...group,
      activeTabId: tabId,
      mruTabIds: touchMruTab(group.mruTabIds, tabId),
    }));
  };

  readonly reorderTab = (
    tabId: string,
    targetSlotIndex: number,
  ) => {
    this.updateActiveGroupState((group) => {
      const nextTabs = reorderTabsById(
        group.tabs,
        tabId,
        targetSlotIndex,
      );
      if (
        nextTabs.length === group.tabs.length &&
        nextTabs.every((tab, index) => tab === group.tabs[index])
      ) {
        return group;
      }

      return {
        ...group,
        tabs: nextTabs,
      };
    });
  };

  readonly closeTab = (tabId: string) => {
    const targetGroup = this.workspaceState.groups.find(group =>
      group.tabs.some(tab => tab.id === tabId),
    );
    if (!targetGroup) {
      return;
    }

    this.updateTargetGroupState({ groupId: targetGroup.groupId, activateGroup: false }, group => {
      const tabIndex = group.tabs.findIndex((tab) => tab.id === tabId);
      if (tabIndex < 0) {
        return group;
      }

      const nextTabs = group.tabs.filter((tab) => tab.id !== tabId);
      const nextMruTabIds = group.mruTabIds.filter((id) => id !== tabId);
      const nextActiveTabId = group.activeTabId === tabId
        ? nextMruTabIds[0] ?? nextTabs[Math.min(tabIndex, nextTabs.length - 1)]?.id ?? null
        : group.activeTabId;

      return {
        ...group,
        tabs: nextTabs,
        activeTabId: nextActiveTabId,
        mruTabIds: nextActiveTabId
          ? touchMruTab(nextMruTabIds, nextActiveTabId)
          : nextMruTabIds,
      };
    });
  };

  readonly closeOtherTabs = (tabId: string) => {
    const activeGroup = resolveActiveGroup(this.workspaceState);
    if (!activeGroup.tabs.some((tab) => tab.id === tabId)) {
      return;
    }

    if (activeGroup.tabs.length === 1 && activeGroup.tabs[0]?.id === tabId) {
      return;
    }

    this.updateActiveGroupState((group) => ({
      ...group,
      tabs: group.tabs.filter((tab) => tab.id === tabId),
      activeTabId: tabId,
      mruTabIds: group.mruTabIds.filter((id) => id === tabId),
    }));
  };

  readonly closeAllTabs = () => {
    const activeGroup = resolveActiveGroup(this.workspaceState);
    if (activeGroup.tabs.length === 0) {
      return;
    }

    this.updateActiveGroupState((group) => createEmptyEditorGroupState(group.groupId));
  };

  readonly createDraftTab = (target: EditorGroupTarget = {}) => {
    this.updateTargetGroupState(target, (group) => {
      const nextTab = createDraftTab();
      return {
        ...group,
        tabs: [...group.tabs, nextTab],
        activeTabId: nextTab.id,
        mruTabIds: touchMruTab(group.mruTabIds, nextTab.id),
      };
    });
  };

  readonly createBrowserTab = (
    url: string,
    target: EditorGroupTarget = {},
    options: CreateContentTabOptions = {},
  ) => {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) {
      return;
    }

    const existingGroup = options.id
      ? this.workspaceState.groups.find(group =>
          group.tabs.some(tab => isEditorBrowserTabInput(tab) && tab.id === options.id),
        )
      : undefined;
    if (existingGroup && options.id) {
      this.activateTab(options.id);
      return;
    }

    this.updateTargetGroupState(target, (group) => {
      const nextTab = createBrowserTab(normalizedUrl, {
        id: options.id,
      });
      return {
        ...group,
        tabs: [...group.tabs, nextTab],
        activeTabId: nextTab.id,
        mruTabIds: touchMruTab(group.mruTabIds, nextTab.id),
      };
    });
  };

  readonly createPdfTab = (
    url: string,
    target: EditorGroupTarget = {},
    options: CreateContentTabOptions = {},
  ) => {
    const normalizedUrl = url.trim() || EMPTY_PDF_TAB_URL;

    const reuseExisting = options.reuseExisting ?? true;
    const openKey = getEditorContentTabInputOpenKey({
      kind: 'pdf',
      url: normalizedUrl,
    });

    this.updateTargetGroupState(target, (group) => {
      const existingTab = reuseExisting
        ? group.tabs.find(
            (tab) =>
              isEditorPdfTabInput(tab) &&
              getEditorContentTabInputOpenKey(tab) === openKey,
          )
        : null;
      if (reuseExisting && existingTab) {
        return {
          ...group,
          activeTabId: existingTab.id,
          mruTabIds: touchMruTab(group.mruTabIds, existingTab.id),
        };
      }

      const nextTab = createPdfTab(normalizedUrl, {
        id: options.id,
      });
      return {
        ...group,
        tabs: [...group.tabs, nextTab],
        activeTabId: nextTab.id,
        mruTabIds: touchMruTab(group.mruTabIds, nextTab.id),
      };
    });
  };

  readonly setDraftDocument = (value: WritingEditorDocument) => {
    const normalizedDocument = normalizeWritingEditorDocument(value);
    const activeGroup = resolveActiveGroup(this.workspaceState);
    const currentActiveDraftTab =
      activeGroup.tabs.find(
        (tab): tab is EditorWorkspaceDraftTab =>
          tab.id === activeGroup.activeTabId && isEditorDraftTabInput(tab),
      ) ?? null;

    if (
      currentActiveDraftTab &&
      createNormalizedDocumentKey(currentActiveDraftTab.document) ===
        createNormalizedDocumentKey(normalizedDocument)
    ) {
      return;
    }

    this.updateActiveGroupState(
      (group) => ({
        ...group,
        tabs: group.tabs.map((tab) =>
          tab.id === group.activeTabId && isEditorDraftTabInput(tab)
            ? {
                ...tab,
                document: normalizedDocument,
              }
            : tab,
        ),
      }),
      { persist: 'debounced' },
    );
  };

  readonly updateBrowserTabState = (state: BrowserEditorPaneState) => {
    const targetGroup = this.workspaceState.groups.find((group) =>
      group.tabs.some((tab) => tab.id === state.tabId),
    );
    const targetTab = targetGroup?.tabs.find((tab) => tab.id === state.tabId);
    if (!targetGroup || !targetTab || !isEditorBrowserTabInput(targetTab)) {
      return;
    }

    const normalizedUrl = state.url.trim();
    const metadata = this.getBrowserTabMetadata(targetTab);
    const nextTitleSource: BrowserTabTitleSource =
      normalizedUrl === EMPTY_BROWSER_TAB_URL
        ? 'empty'
        : metadata.titleSource === 'custom'
          ? 'custom'
          : 'auto-url';
    const shouldKeepCurrentTitleDuringNavigation =
      nextTitleSource === 'auto-url' &&
      Boolean(targetTab.title.trim()) &&
      (metadata.titleSource === 'auto-page' || state.loading);
    const urlTitle = shouldKeepCurrentTitleDuringNavigation
      ? targetTab.title
      : resolveBrowserTabTitleFromSource(
          { ...targetTab, url: normalizedUrl },
          nextTitleSource,
        );
    const normalizedPageTitle = sanitizeBrowserTabPageTitle(
      state.title,
      normalizedUrl,
    );
    const acceptsPageTitle =
      metadata.titleSource !== 'custom' && Boolean(normalizedPageTitle);
    const nextTitle = acceptsPageTitle ? normalizedPageTitle : urlTitle;
    const normalizedFaviconUrl = sanitizeBrowserTabFaviconUrl(state.favicon);

    this.browserTabMetadataById.set(state.tabId, {
      titleSource: acceptsPageTitle
        ? 'auto-page'
        : shouldKeepCurrentTitleDuringNavigation
          ? metadata.titleSource
          : nextTitleSource,
      lastPageTitle: acceptsPageTitle
        ? normalizedPageTitle
        : shouldKeepCurrentTitleDuringNavigation
          ? sanitizeBrowserTabPageTitle(targetTab.title, normalizedUrl)
          : '',
    });

    this.updateTargetGroupState(
      { groupId: targetGroup.groupId, activateGroup: false },
      (group) => ({
        ...group,
        tabs: group.tabs.map((tab) => {
          if (tab.id !== state.tabId || !isEditorBrowserTabInput(tab)) {
            return tab;
          }

          const nextTab: EditorWorkspaceBrowserTab = {
            ...tab,
            url: normalizedUrl,
            title: nextTitle,
          };
          if (normalizedUrl !== EMPTY_BROWSER_TAB_URL && normalizedFaviconUrl) {
            nextTab.faviconUrl = normalizedFaviconUrl;
          } else if (tab.url !== normalizedUrl) {
            delete nextTab.faviconUrl;
          }
          return nextTab;
        }),
      }),
    );
  };

  readonly renameTab = (tabId: string, title: string) => {
    const nextTitle = title.trim();
    if (!nextTitle) {
      return;
    }

    const activeGroup = resolveActiveGroup(this.workspaceState);
    const targetTab = activeGroup.tabs.find((tab) => tab.id === tabId);
    if (!targetTab || targetTab.title === nextTitle) {
      return;
    }

    if (isEditorBrowserTabInput(targetTab)) {
      this.browserTabMetadataById.set(targetTab.id, {
        titleSource: 'custom',
        lastPageTitle: '',
      });
    }

    this.updateActiveGroupState((group) => ({
      ...group,
      tabs: group.tabs.map((tab) =>
        tab.id === tabId
          ? {
              ...tab,
              title: nextTitle,
            }
          : tab,
      ),
    }));
  };

  readonly setEditorViewState = (
    key: EditorViewStateKey,
    state: unknown,
  ) => {
    this.updateWorkspaceState((currentState) => ({
      ...currentState,
      viewStateEntries: [
        ...currentState.viewStateEntries.filter(
          (entry) =>
            entry.key.groupId !== key.groupId ||
            entry.key.paneId !== key.paneId ||
            entry.key.resourceKey !== key.resourceKey,
        ),
        {
          key,
          state,
        },
      ],
    }));
  };

  readonly deleteEditorViewState = (key: EditorViewStateKey) => {
    this.updateWorkspaceState((currentState) => ({
      ...currentState,
      viewStateEntries: currentState.viewStateEntries.filter(
        (entry) =>
          entry.key.groupId !== key.groupId ||
          entry.key.paneId !== key.paneId ||
          entry.key.resourceKey !== key.resourceKey,
      ),
    }));
  };

  readonly dispose = () => {
    this.storage.dispose();
    this.listeners.clear();
  };

  private emitChange() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private syncBrowserTabMetadata() {
    const browserTabs = this.workspaceState.groups
      .flatMap((group) => group.tabs)
      .filter((tab): tab is EditorWorkspaceBrowserTab => isEditorBrowserTabInput(tab));
    const browserTabIdSet = new Set(browserTabs.map((tab) => tab.id));

    for (const tabId of this.browserTabMetadataById.keys()) {
      if (!browserTabIdSet.has(tabId)) {
        this.browserTabMetadataById.delete(tabId);
      }
    }

    for (const tab of browserTabs) {
      if (this.browserTabMetadataById.has(tab.id)) {
        continue;
      }

      this.browserTabMetadataById.set(tab.id, {
        titleSource: inferBrowserTabTitleSource(tab),
        lastPageTitle: '',
      });
    }
  }

  private getBrowserTabMetadata(
    tab: EditorWorkspaceBrowserTab,
  ): BrowserTabMetadata {
    const existing = this.browserTabMetadataById.get(tab.id);
    if (existing) {
      return existing;
    }

    const nextMetadata = {
      titleSource: inferBrowserTabTitleSource(tab),
      lastPageTitle: '',
    } satisfies BrowserTabMetadata;
    this.browserTabMetadataById.set(tab.id, nextMetadata);
    return nextMetadata;
  }

  private updateWorkspaceState(
    updater: (state: EditorWorkspaceState) => EditorWorkspaceState,
    options: { persist?: 'immediate' | 'debounced' } = {},
  ) {
    this.workspaceState = normalizeWorkspaceState(updater(this.workspaceState));
    this.syncBrowserTabMetadata();
    this.syncDraftDirtyState();
    this.syncLiveDraftState();
    this.snapshot = createEditorModelSnapshot(
      this.workspaceState,
      this.draftDirtyState,
    );
    if (options.persist === 'debounced') {
      this.storage.scheduleSave(this.createPersistedState());
    } else {
      this.storage.save(this.createPersistedState());
    }
    this.emitChange();
  }

  private updateActiveGroupState(
    updater: (group: EditorEditorGroupState) => EditorEditorGroupState,
    options: { persist?: 'immediate' | 'debounced' } = {},
  ) {
    this.updateResolvedGroupState(
      {
        groupId: this.workspaceState.activeGroupId ?? DEFAULT_EDITOR_GROUP_ID,
        activateGroup: true,
      },
      updater,
      options,
    );
  }

  private updateTargetGroupState(
    target: EditorGroupTarget,
    updater: (group: EditorEditorGroupState) => EditorEditorGroupState,
    options: { persist?: 'immediate' | 'debounced' } = {},
  ) {
    this.updateResolvedGroupState(
      this.resolveTargetGroup(target),
      updater,
      options,
    );
  }

  private updateResolvedGroupState(
    target: ResolvedEditorGroupTarget,
    updater: (group: EditorEditorGroupState) => EditorEditorGroupState,
    options: { persist?: 'immediate' | 'debounced' } = {},
  ) {
    this.updateWorkspaceState(
      (workspaceState) => {
        const nextWorkspaceState = ensureWorkspaceGroup(
          workspaceState,
          target.groupId,
        );

        return {
          ...nextWorkspaceState,
          activeGroupId: target.activateGroup
            ? target.groupId
            : nextWorkspaceState.activeGroupId,
          groups: nextWorkspaceState.groups.map((group) =>
            group.groupId === target.groupId ? updater(group) : group,
          ),
        };
      },
      options,
    );
  }

  private resolveTargetGroup(
    target: EditorGroupTarget,
  ): ResolvedEditorGroupTarget {
    const groupId = normalizeEditorGroupId(
      target.groupId ?? this.workspaceState.activeGroupId,
    );

    return {
      groupId,
      activateGroup:
        target.activateGroup ?? groupId === this.workspaceState.activeGroupId,
    };
  }

  private syncLiveDraftState() {
    const activeGroup = resolveActiveGroup(this.workspaceState);
    const activeTab = resolveActiveTab(activeGroup);
    const activeDraftTab = isEditorDraftTabInput(activeTab) ? activeTab : null;
    const contextDraftTab = resolveContextDraftTab(activeGroup, activeTab);
    this.liveDraftState.sync({
      activeDraftDocument: activeDraftTab?.document ?? null,
      contextDraftDocument: contextDraftTab?.document ?? null,
    });
  }

  private syncDraftDirtyState() {
    this.draftDirtyState.syncTabs(
      this.workspaceState.groups.flatMap((group) => group.tabs),
    );
  }

  private createPersistedState() {
    const activeGroup = resolveActiveGroup(this.workspaceState);
    const activeTab = resolveActiveTab(activeGroup);

    return {
      workspaceState: {
        groups: this.workspaceState.groups,
        activeGroupId: this.workspaceState.activeGroupId,
        viewStateEntries: this.workspaceState.viewStateEntries,
      },
      contextDraftTab: resolveContextDraftTab(activeGroup, activeTab),
      savedDraftStateByInputId: this.draftDirtyState.getSavedStateByTabId(),
    };
  }
}

export function createEditorModel(
  initialState?: EditorWorkspaceState,
) {
  if (initialState) {
    return new EditorModel(initialState);
  }

  const restoredState = readStoredWorkspaceState();
  return new EditorModel(
    restoredState.workspaceState,
    restoredState.savedDraftStateByInputId,
  );
}
