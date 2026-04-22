import {
  SUPPORTED_EDITOR_PANE_MODES,
  type EditorPaneMode,
  type EditorPlannedTabKind,
  type SupportedEditorPaneMode,
  getEditorPaneMode,
  isEmptyBrowserTabInput,
  isEmptyPdfTabInput,
  isEditorBrowserTabInput,
  isEditorDraftTabInput,
} from 'ls/workbench/browser/parts/editor/editorInput';
import type {
  DraftEditorStatusState,
} from 'ls/editor/browser/text/draftEditorStatusState';
import type {
  EditorWorkspaceTab,
} from 'ls/workbench/browser/parts/editor/editorModel';
import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import {
  createDirtyDraftTabIdSet,
  getDraftTabDisplayLabel as resolveDraftTabDisplayLabel,
  isClosableEditorTab,
  isEmptyDraftTab,
} from 'ls/workbench/browser/parts/editor/editorTabPolicy';

export type EditorGroupTabState = {
  isActive: boolean;
  isClosable: boolean;
  isDirty: boolean;
  hasLocalHistory: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export type EditorGroupTabItem = {
  id: string;
  kind: EditorPlannedTabKind;
  paneMode: EditorPaneMode;
  residency: 'resident' | 'dynamic';
  label: string;
  title: string;
  faviconUrl?: string;
  targetTabId: string | null;
  state: EditorGroupTabState;
};

export type EditorGroupModel = {
  tabs: EditorGroupTabItem[];
  activeTabId: string | null;
  activeTab: EditorWorkspaceTab | null;
};

function getTabDisplayLabel(
  tab: EditorWorkspaceTab,
  labels: EditorPartLabels,
  draftIndex: number,
  isEmpty: boolean,
  residency: EditorGroupTabItem['residency'],
) {
  const paneMode = getEditorPaneMode(tab);

  switch (paneMode) {
    case 'draft':
      return isEditorDraftTabInput(tab)
        ? resolveDraftTabDisplayLabel({
            tab,
            newTabLabel: labels.newTab,
            draftModeLabel: labels.draftMode,
            draftIndex,
            isEmpty,
            residency,
          })
        : labels.draftMode;
    case 'pdf':
      if (!isEmptyPdfTabInput(tab)) {
        return tab.title.trim() || labels.pdfMode;
      }

      return residency === 'resident' ? '' : labels.newTab;
    default:
      if (!isEmptyBrowserTabInput(tab)) {
        return tab.title.trim();
      }

      return residency === 'resident' ? '' : labels.newTab;
  }
}

function getTabDisplayTitle(
  tab: EditorWorkspaceTab,
  labels: EditorPartLabels,
  label: string,
) {
  const paneMode = getEditorPaneMode(tab);

  switch (paneMode) {
    case 'draft':
      return label || labels.draftMode;
    case 'browser':
      return label || labels.sourceMode;
    case 'pdf':
      return label || labels.pdfMode;
    default:
      return label;
  }
}

function isEmptyWorkspaceTab(tab: EditorWorkspaceTab) {
  if (isEditorDraftTabInput(tab)) {
    return isEmptyDraftTab(tab);
  }

  return isEmptyBrowserTabInput(tab) || isEmptyPdfTabInput(tab);
}

function sanitizeTabFaviconUrl(value: string | undefined) {
  return String(value ?? '').trim();
}

function resolveTabFaviconUrl(
  tab: EditorWorkspaceTab,
) {
  if (!isEditorBrowserTabInput(tab)) {
    return '';
  }

  return sanitizeTabFaviconUrl(tab.faviconUrl);
}

function getFallbackTitleForPaneMode(
  paneMode: EditorGroupTabItem['paneMode'],
  labels: EditorPartLabels,
) {
  switch (paneMode) {
    case 'draft':
      return labels.draftMode;
    case 'pdf':
      return labels.pdfMode;
    case 'file':
      return 'Read';
    case 'terminal':
      return 'Terminal';
    case 'git-changes':
      return 'Git Changes';
    default:
      return labels.sourceMode;
  }
}

function getFallbackLabelForPaneMode() {
  return '';
}

function getDefaultTabKindForPaneMode(
  paneMode: EditorGroupTabItem['paneMode'],
): EditorPlannedTabKind {
  return paneMode;
}

function isSupportedPaneMode(
  paneMode: EditorPaneMode,
): paneMode is SupportedEditorPaneMode {
  return SUPPORTED_EDITOR_PANE_MODES.includes(paneMode as SupportedEditorPaneMode);
}

export function createEditorGroupModel({
  tabs,
  activeTabId,
  activeTab,
  labels,
  draftStatusByTabId,
  dirtyDraftTabIds,
}: {
  tabs: EditorWorkspaceTab[];
  activeTabId: string | null;
  activeTab: EditorWorkspaceTab | null;
  labels: EditorPartLabels;
  draftStatusByTabId: Record<string, DraftEditorStatusState>;
  dirtyDraftTabIds: readonly string[];
}): EditorGroupModel {
  // Keep close/label behavior centralized by evaluating tab policy once per render.
  const dirtyDraftTabIdSet = createDirtyDraftTabIdSet(dirtyDraftTabIds);
  const residentTabIdByPaneMode = new Map<SupportedEditorPaneMode, string>();
  const firstTabIdByPaneMode = new Map<SupportedEditorPaneMode, string>();
  for (const tab of tabs) {
    const paneMode = getEditorPaneMode(tab);
    if (!isSupportedPaneMode(paneMode)) {
      continue;
    }

    if (!firstTabIdByPaneMode.has(paneMode)) {
      firstTabIdByPaneMode.set(paneMode, tab.id);
    }

    if (tab.residency === 'resident' && !residentTabIdByPaneMode.has(paneMode)) {
      residentTabIdByPaneMode.set(paneMode, tab.id);
    }
  }

  const draftTabIds = tabs
    .filter((tab) => isEditorDraftTabInput(tab))
    .map((tab) => tab.id);

  const toTabItem = (
    tab: EditorWorkspaceTab,
    residency: EditorGroupTabItem['residency'],
  ): EditorGroupTabItem => {
    const paneMode = getEditorPaneMode(tab);
    const draftIndex =
      isEditorDraftTabInput(tab) ? draftTabIds.indexOf(tab.id) : -1;
    const isDirty = isEditorDraftTabInput(tab)
      ? dirtyDraftTabIdSet.has(tab.id)
      : false;
    const isEmpty = isEmptyWorkspaceTab(tab);
    const label = getTabDisplayLabel(
      tab,
      labels,
      Math.max(draftIndex, 0),
      isEmpty,
      residency,
    );
    const draftStatus = isEditorDraftTabInput(tab)
      ? draftStatusByTabId[tab.id]
      : undefined;
    const canUndo = Boolean(draftStatus?.canUndo);
    const canRedo = Boolean(draftStatus?.canRedo);
    const isClosable = isClosableEditorTab(tab, dirtyDraftTabIdSet, residency);

    return {
      id: tab.id,
      kind: tab.kind,
      paneMode,
      residency,
      label,
      title: getTabDisplayTitle(tab, labels, label),
      faviconUrl: resolveTabFaviconUrl(tab),
      targetTabId: tab.id,
      state: {
        isActive: tab.id === activeTabId,
        isClosable,
        isDirty,
        hasLocalHistory: canUndo || canRedo,
        canUndo,
        canRedo,
      },
    };
  };

  const normalizedTabs = tabs.map((tab) => {
    const paneMode = getEditorPaneMode(tab);
    if (!isSupportedPaneMode(paneMode)) {
      return toTabItem(tab, 'dynamic');
    }

    const residentTabId =
      residentTabIdByPaneMode.get(paneMode) ??
      firstTabIdByPaneMode.get(paneMode);
    return toTabItem(tab, residentTabId === tab.id ? 'resident' : 'dynamic');
  });

  const presentPaneModes = new Set(
    normalizedTabs.map((tab) => tab.paneMode).filter(isSupportedPaneMode),
  );
  const residentEntries = SUPPORTED_EDITOR_PANE_MODES
    .filter((paneMode) => !presentPaneModes.has(paneMode))
    .map((paneMode) => ({
      id: `${paneMode}-entry`,
      kind: getDefaultTabKindForPaneMode(paneMode),
      paneMode,
      residency: 'resident' as const,
      label: getFallbackLabelForPaneMode(),
      title: getFallbackTitleForPaneMode(paneMode, labels),
      faviconUrl: '',
      targetTabId: null,
      state: {
        isActive: false,
        isClosable: false,
        isDirty: false,
        hasLocalHistory: false,
        canUndo: false,
        canRedo: false,
      },
    }));

  return {
    tabs: [...normalizedTabs, ...residentEntries],
    activeTabId,
    activeTab,
  };
}
