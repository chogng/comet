import { createEmptyWritingEditorDocument, normalizeWritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

import {
  EMPTY_PDF_TAB_URL,
  EMPTY_BROWSER_TAB_URL,
  SUPPORTED_EDITOR_PANE_MODES,
  type SupportedEditorPaneMode,
  type EditorTabKind,
  createEditorBrowserTabInput,
  createEditorDraftTabInput,
  createEditorPdfTabInput,
  getEditorContentTabInputResourceKey,
  getEditorPaneMode,
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

export type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
export type EditorTabResidency = 'resident' | 'dynamic';

// Content tabs only store editor input metadata. The active content tab temporarily owns one shared
// web-content surface instead of spawning a dedicated browser/view instance per tab.
export type EditorWorkspaceDraftTab = EditorDraftTabInput & {
  document: WritingEditorDocument;
  residency?: EditorTabResidency;
};

export type EditorWorkspaceBrowserTab = EditorBrowserTabInput & {
  residency?: EditorTabResidency;
};
export type EditorWorkspacePdfTab = EditorPdfTabInput & {
  residency?: EditorTabResidency;
};
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
  initial?: Partial<Pick<EditorWorkspaceDraftTab, 'id' | 'title' | 'document' | 'viewMode' | 'residency'>>,
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
    residency: initial?.residency ?? 'dynamic',
  };
}

function createNormalizedDocumentKey(document: unknown) {
  return JSON.stringify(normalizeWritingEditorDocument(document));
}

function createBrowserTab(
  url: string,
  initial?: Partial<Pick<EditorWorkspaceBrowserTab, 'id' | 'title' | 'residency'>>,
): EditorWorkspaceBrowserTab {
  return {
    ...createEditorBrowserTabInput(url, initial),
    residency: initial?.residency ?? 'dynamic',
  };
}

function createPdfTab(
  url: string,
  initial?: Partial<Pick<EditorWorkspacePdfTab, 'id' | 'title' | 'residency'>>,
): EditorWorkspacePdfTab {
  return {
    ...createEditorPdfTabInput(url, initial),
    residency: initial?.residency ?? 'dynamic',
  };
}

function normalizeWorkspaceTab(value: unknown): EditorWorkspaceTab | null {
  const candidate = value as Partial<EditorWorkspaceDraftTab> | null | undefined;
  const normalizedInput = normalizeEditorTabInput(value);
  if (!candidate || typeof candidate !== 'object' || !normalizedInput) {
    return null;
  }

  if (isEditorDraftTabInput(normalizedInput)) {
    return createDraftTab({
      id: normalizedInput.id,
      title: normalizedInput.title,
      document: candidate.document,
      viewMode: normalizedInput.viewMode,
      residency: candidate.residency === 'resident' ? 'resident' : 'dynamic',
    });
  }

  return {
    ...normalizedInput,
    residency: candidate.residency === 'resident' ? 'resident' : 'dynamic',
  };
}

function isSupportedPaneMode(
  paneMode: string,
): paneMode is SupportedEditorPaneMode {
  return SUPPORTED_EDITOR_PANE_MODES.includes(paneMode as SupportedEditorPaneMode);
}

function normalizeTabResidencies(
  tabs: EditorWorkspaceTab[],
): EditorWorkspaceTab[] {
  const firstIndexByPaneMode = new Map<SupportedEditorPaneMode, number>();
  const residentIndexByPaneMode = new Map<SupportedEditorPaneMode, number>();

  for (const [index, tab] of tabs.entries()) {
    const paneMode = getEditorPaneMode(tab);
    if (!isSupportedPaneMode(paneMode)) {
      continue;
    }

    if (!firstIndexByPaneMode.has(paneMode)) {
      firstIndexByPaneMode.set(paneMode, index);
    }

    if (tab.residency === 'resident' && !residentIndexByPaneMode.has(paneMode)) {
      residentIndexByPaneMode.set(paneMode, index);
    }
  }

  return tabs.map((tab, index) => {
    const paneMode = getEditorPaneMode(tab);
    if (!isSupportedPaneMode(paneMode)) {
      return tab;
    }

    const residentIndex =
      residentIndexByPaneMode.get(paneMode) ?? firstIndexByPaneMode.get(paneMode);
    const nextResidency: EditorTabResidency =
      residentIndex === index ? 'resident' : 'dynamic';

    return tab.residency === nextResidency
      ? tab
      : {
          ...tab,
          residency: nextResidency,
        };
  });
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
  const duplicateIdsByResourceKey = new Map<string, string[]>();
  for (const tab of state.tabs) {
    if (!isEditorBrowserTabInput(tab) && !isEditorPdfTabInput(tab)) {
      continue;
    }

    const resourceKey = getEditorContentTabInputResourceKey(tab);
    const duplicateIds = duplicateIdsByResourceKey.get(resourceKey);
    if (duplicateIds) {
      duplicateIds.push(tab.id);
      continue;
    }

    duplicateIdsByResourceKey.set(resourceKey, [tab.id]);
  }

  const retainedIds = new Set<string>();
  const replacedIdByDuplicateId = new Map<string, string>();
  for (const duplicateIds of duplicateIdsByResourceKey.values()) {
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

function ensureResidentTabs(
  tabs: EditorWorkspaceTab[],
): EditorWorkspaceTab[] {
  const nextTabs = [...tabs];
  const presentKinds = new Set(
    nextTabs.map((tab) => tab.kind).filter((kind) =>
      SUPPORTED_EDITOR_PANE_MODES.includes(kind as SupportedEditorPaneMode),
    ),
  );

  for (const paneMode of SUPPORTED_EDITOR_PANE_MODES) {
    if (presentKinds.has(paneMode)) {
      continue;
    }

    nextTabs.push(createEmptyResidentTabForKind(paneMode));
  }

  return nextTabs;
}

function normalizeEditorGroupState(
  state: EditorEditorGroupState,
): EditorEditorGroupState {
  const normalizedGroupId = normalizeEditorGroupId(state.groupId);
  const tabs = normalizeTabResidencies(ensureResidentTabs(state.tabs));
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

function createEmptyResidentTabForKind(
  kind: EditorTabKind,
): EditorWorkspaceTab {
  switch (kind) {
    case 'draft':
      return createDraftTab({
        residency: 'resident',
      });
    case 'pdf':
      return createPdfTab(EMPTY_PDF_TAB_URL, {
        residency: 'resident',
      });
    case 'browser':
    default:
      return createBrowserTab(EMPTY_BROWSER_TAB_URL, {
        residency: 'resident',
      });
  }
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
      residency: 'resident',
    });
  }

  return {
    ...input,
    residency: 'resident',
  };
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
  const tabs = normalizeTabResidencies(
    SUPPORTED_EDITOR_PANE_MODES.map((paneMode) =>
      createEmptyResidentTabForKind(paneMode),
    ),
  );
  return {
    groupId: normalizeEditorGroupId(groupId),
    tabs,
    activeTabId: tabs[0]?.id ?? null,
    mruTabIds: tabs[0] ? [tabs[0].id] : [],
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
  const initialDraftTab = createDraftTab({
    title: legacyDraftState.title,
    document: legacyDraftState.document,
    viewMode: legacyDraftState.viewMode,
  });

  return {
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [initialDraftTab],
        activeTabId: initialDraftTab.id,
        mruTabIds: [initialDraftTab.id],
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
                .map((input) => normalizeWorkspaceTab(input))
                .filter((input): input is EditorWorkspaceTab => Boolean(input))
                .map((input) => createWorkspaceTabFromStoredInput(input, draftStateByInputId))
            : Array.isArray(candidate.tabs)
              ? candidate.tabs
                  .map((tab) => normalizeWorkspaceTab(tab))
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
                .map((input) => normalizeWorkspaceTab(input))
                .filter((input): input is EditorWorkspaceTab => Boolean(input))
                .map((input) => createWorkspaceTabFromStoredInput(input, draftStateByInputId))
            : Array.isArray(rawWorkspace.tabs)
              ? rawWorkspace.tabs
                  .map((tab) => normalizeWorkspaceTab(tab))
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

function hasDerivedContentTabTitle(tab: EditorWorkspaceContentTab) {
  return tab.title.trim() === getEditorContentTabTitle(tab.url);
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
    this.updateActiveGroupState((group) => ({
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
    this.updateActiveGroupState((group) => {
      const tabIndex = group.tabs.findIndex((tab) => tab.id === tabId);
      if (tabIndex < 0) {
        return group;
      }

      const targetTab = group.tabs[tabIndex]!;
      const remainingTabsOfKind = group.tabs.filter(
        (tab) => tab.id !== tabId && tab.kind === targetTab.kind,
      );
      const shouldResetToEmptyResident = remainingTabsOfKind.length === 0;
      const replacementTab = shouldResetToEmptyResident
        ? createEmptyResidentTabForKind(targetTab.kind)
        : null;
      const nextTabs = shouldResetToEmptyResident
        ? [
            ...group.tabs.slice(0, tabIndex),
            replacementTab!,
            ...group.tabs.slice(tabIndex + 1),
          ]
        : group.tabs.filter((tab) => tab.id !== tabId);
      const nextActiveTabId =
        group.activeTabId === tabId
          ? replacementTab?.id ?? null
          : group.activeTabId;
      const nextMruTabIds = group.mruTabIds.filter((id) => id !== tabId);

      return {
        ...group,
        tabs: nextTabs,
        activeTabId: nextActiveTabId,
        mruTabIds:
          group.activeTabId === tabId && replacementTab
            ? touchMruTab(nextMruTabIds, replacementTab.id)
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
      const hasResidentDraft = group.tabs.some(
        (tab) => isEditorDraftTabInput(tab) && tab.residency === 'resident',
      );
      const nextTab = createDraftTab({
        residency: hasResidentDraft ? 'dynamic' : 'resident',
      });
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

    const reuseExisting = options.reuseExisting ?? true;
    const resourceKey = getEditorContentTabInputResourceKey({
      kind: 'browser',
      url: normalizedUrl,
    });

    this.updateTargetGroupState(target, (group) => {
      // Mirror upstream open-editor behavior: the same web content resource re-activates its tab
      // instead of creating duplicate entries in the target group strip.
      const existingTab = reuseExisting
        ? group.tabs.find(
            (tab) =>
              isEditorBrowserTabInput(tab) &&
              getEditorContentTabInputResourceKey(tab) === resourceKey,
          )
        : null;
      if (reuseExisting && existingTab) {
        return {
          ...group,
          activeTabId: existingTab.id,
          mruTabIds: touchMruTab(group.mruTabIds, existingTab.id),
        };
      }

      const hasResidentBrowser = group.tabs.some(
        (tab) => isEditorBrowserTabInput(tab) && tab.residency === 'resident',
      );
      const nextTab = createBrowserTab(normalizedUrl, {
        residency: hasResidentBrowser ? 'dynamic' : 'resident',
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
    const resourceKey = getEditorContentTabInputResourceKey({
      kind: 'pdf',
      url: normalizedUrl,
    });

    this.updateTargetGroupState(target, (group) => {
      // Keep PDF tabs aligned with web tabs: one resource maps to one tab/input entry
      // inside the target group.
      const existingTab = reuseExisting
        ? group.tabs.find(
            (tab) =>
              isEditorPdfTabInput(tab) &&
              getEditorContentTabInputResourceKey(tab) === resourceKey,
          )
        : null;
      if (reuseExisting && existingTab) {
        return {
          ...group,
          activeTabId: existingTab.id,
          mruTabIds: touchMruTab(group.mruTabIds, existingTab.id),
        };
      }

      const hasResidentPdf = group.tabs.some(
        (tab) => isEditorPdfTabInput(tab) && tab.residency === 'resident',
      );
      const nextTab = createPdfTab(normalizedUrl, {
        residency: hasResidentPdf ? 'dynamic' : 'resident',
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

  readonly updateActiveContentTabUrl = (
    url: string,
    options: {
      isLoading?: boolean;
    } = {},
  ) => {
    const normalizedUrl = url.trim();
    const isLoading = Boolean(options.isLoading);
    const activeGroup = resolveActiveGroup(this.workspaceState);
    const activeTab = resolveActiveTab(activeGroup);
    if (!activeTab || isEditorDraftTabInput(activeTab)) {
      return;
    }

    const nextTitle = isEditorBrowserTabInput(activeTab)
      ? (() => {
          const metadata = this.getBrowserTabMetadata(activeTab);
          const nextTitleSource: BrowserTabTitleSource =
            normalizedUrl === EMPTY_BROWSER_TAB_URL
              ? 'empty'
              : metadata.titleSource === 'custom'
                ? 'custom'
                : 'auto-url';
          const nextTab = {
            ...activeTab,
            url: normalizedUrl,
          } as EditorWorkspaceBrowserTab;
          // Prevent label jitter while native webview navigates/redirects: keep the
          // current tab title until loading settles or a new page-title arrives.
          const shouldKeepCurrentTitleDuringNavigation =
            nextTitleSource === 'auto-url' &&
            Boolean(activeTab.title.trim()) &&
            (metadata.titleSource === 'auto-page' || isLoading);
          const nextMetadataTitleSource = shouldKeepCurrentTitleDuringNavigation
            ? metadata.titleSource
            : nextTitleSource;
          const resolvedTitle = shouldKeepCurrentTitleDuringNavigation
            ? activeTab.title
            : resolveBrowserTabTitleFromSource(nextTab, nextTitleSource);

          this.browserTabMetadataById.set(activeTab.id, {
            // Keep the prior source while we're intentionally pinning the visible
            // title, so chained URL updates don't bounce the tab label.
            titleSource: nextMetadataTitleSource,
            lastPageTitle: shouldKeepCurrentTitleDuringNavigation
              ? sanitizeBrowserTabPageTitle(activeTab.title, normalizedUrl)
              : '',
          });
          return resolvedTitle;
        })()
      : hasDerivedContentTabTitle(activeTab)
        ? getEditorContentTabTitle(normalizedUrl)
        : activeTab.title;
    const hasFaviconToReset =
      isEditorBrowserTabInput(activeTab) &&
      activeTab.url !== normalizedUrl &&
      Boolean(sanitizeBrowserTabFaviconUrl(activeTab.faviconUrl));
    if (
      activeTab.url === normalizedUrl &&
      activeTab.title === nextTitle &&
      !hasFaviconToReset
    ) {
      return;
    }

    this.updateActiveGroupState((group) => ({
      ...group,
      tabs: group.tabs.map((tab) =>
        // When the shared web content view navigates while a content tab owns it, update that tab's
        // input so the tab title/url stay consistent with the visible editor content.
        tab.id === group.activeTabId && !isEditorDraftTabInput(tab)
          ? isEditorBrowserTabInput(tab)
            ? (() => {
                const nextBrowserTab: EditorWorkspaceBrowserTab = {
                  ...tab,
                  url: normalizedUrl,
                  title: nextTitle,
                };
                if (tab.url === normalizedUrl) {
                  return nextBrowserTab;
                }
                const { faviconUrl: _ignoredFavicon, ...tabWithoutFavicon } =
                  nextBrowserTab;
                return tabWithoutFavicon;
              })()
            : {
                ...tab,
                url: normalizedUrl,
                title: nextTitle,
              }
          : tab,
      ),
    }));
  };

  readonly updateActiveBrowserTabPageTitle = (pageTitle: string) => {
    const activeGroup = resolveActiveGroup(this.workspaceState);
    const activeTab = resolveActiveTab(activeGroup);
    if (!activeTab || !isEditorBrowserTabInput(activeTab)) {
      return;
    }

    const normalizedPageTitle = sanitizeBrowserTabPageTitle(
      pageTitle,
      activeTab.url,
    );
    if (!normalizedPageTitle) {
      return;
    }

    const metadata = this.getBrowserTabMetadata(activeTab);
    if (metadata.titleSource === 'custom') {
      return;
    }

    if (activeTab.title.trim() === normalizedPageTitle) {
      this.browserTabMetadataById.set(activeTab.id, {
        titleSource: 'auto-page',
        lastPageTitle: normalizedPageTitle,
      });
      return;
    }

    this.browserTabMetadataById.set(activeTab.id, {
      titleSource: 'auto-page',
      lastPageTitle: normalizedPageTitle,
    });
    this.updateActiveGroupState((group) => ({
      ...group,
      tabs: group.tabs.map((tab) =>
        tab.id === group.activeTabId && isEditorBrowserTabInput(tab)
          ? {
              ...tab,
              title: normalizedPageTitle,
            }
          : tab,
      ),
    }));
  };

  readonly updateActiveBrowserTabFaviconUrl = (faviconUrl: string) => {
    const activeGroup = resolveActiveGroup(this.workspaceState);
    const activeTab = resolveActiveTab(activeGroup);
    if (!activeTab || !isEditorBrowserTabInput(activeTab)) {
      return;
    }

    if (activeTab.url.trim() === EMPTY_BROWSER_TAB_URL) {
      return;
    }

    const normalizedFaviconUrl = sanitizeBrowserTabFaviconUrl(faviconUrl);
    if (!normalizedFaviconUrl) {
      return;
    }

    if (
      sanitizeBrowserTabFaviconUrl(activeTab.faviconUrl) === normalizedFaviconUrl
    ) {
      return;
    }

    this.updateActiveGroupState((group) => ({
      ...group,
      tabs: group.tabs.map((tab) =>
        tab.id === group.activeTabId && isEditorBrowserTabInput(tab)
          ? {
              ...tab,
              faviconUrl: normalizedFaviconUrl,
            }
          : tab,
      ),
    }));
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
