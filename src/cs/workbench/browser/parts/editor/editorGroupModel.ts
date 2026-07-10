import {
  type EditorPaneMode,
  type EditorPlannedTabKind,
  getEditorPaneMode,
  isEmptyBrowserTabInput,
  isEmptyPdfTabInput,
  isEditorBrowserTabInput,
  isEditorDraftTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import type {
  DraftEditorStatusState,
} from 'cs/editor/browser/text/draftEditorStatusState';
import type {
  EditorWorkspaceTab,
} from 'cs/workbench/browser/parts/editor/editorModel';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import {
  createDirtyDraftTabIdSet,
  getDraftTabDisplayLabel as resolveDraftTabDisplayLabel,
  isEmptyDraftTab,
} from 'cs/workbench/browser/parts/editor/editorTabPolicy';

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
  label: string;
  title: string;
  faviconUrl?: string;
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
          })
        : labels.draftMode;
    case 'pdf':
      if (!isEmptyPdfTabInput(tab)) {
        return tab.title.trim() || labels.pdfMode;
      }

      return labels.newTab;
    default:
      if (!isEmptyBrowserTabInput(tab)) {
        return tab.title.trim();
      }

      return labels.newTab;
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
  const draftTabIds = tabs
    .filter((tab) => isEditorDraftTabInput(tab))
    .map((tab) => tab.id);

  const toTabItem = (tab: EditorWorkspaceTab): EditorGroupTabItem => {
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
    );
    const draftStatus = isEditorDraftTabInput(tab)
      ? draftStatusByTabId[tab.id]
      : undefined;
    const canUndo = Boolean(draftStatus?.canUndo);
    const canRedo = Boolean(draftStatus?.canRedo);

    return {
      id: tab.id,
      kind: tab.kind,
      paneMode,
      label,
      title: getTabDisplayTitle(tab, labels, label),
      faviconUrl: resolveTabFaviconUrl(tab),
      state: {
        isActive: tab.id === activeTabId,
        isClosable: true,
        isDirty,
        hasLocalHistory: canUndo || canRedo,
        canUndo,
        canRedo,
      },
    };
  };

  return {
    tabs: tabs.map(toTabItem),
    activeTabId,
    activeTab,
  };
}
