import { writingEditorDocumentToPlainText } from 'ls/editor/common/writingEditorDocument';
import {
  isEmptyBrowserTabInput,
  isEditorDraftTabInput,
  isEmptyPdfTabInput,
} from 'ls/workbench/browser/parts/editor/editorInput';
import type {
  EditorWorkspaceDraftTab,
  EditorWorkspaceTab,
} from 'ls/workbench/browser/parts/editor/editorModel';

export function createDirtyDraftTabIdSet(
  dirtyDraftTabIds: readonly string[],
): ReadonlySet<string> {
  // Shared immutable lookup used across policy checks in the same render cycle.
  return new Set(dirtyDraftTabIds);
}

export function isReusableEmptyBrowserTab(
  tab: EditorWorkspaceTab | null | undefined,
) {
  return Boolean(tab && isEmptyBrowserTabInput(tab));
}

export function isReusableEmptyDraftTab(
  tab: EditorWorkspaceTab | null | undefined,
  dirtyDraftTabIds: ReadonlySet<string>,
): tab is EditorWorkspaceDraftTab {
  if (!tab || !isEditorDraftTabInput(tab) || dirtyDraftTabIds.has(tab.id)) {
    return false;
  }

  // Reusable draft means "untitled + no textual edits".
  return (
    tab.title.trim().length === 0 &&
    writingEditorDocumentToPlainText(tab.document).length === 0
  );
}

export function isEmptyDraftTab(
  tab: EditorWorkspaceTab | null | undefined,
): tab is EditorWorkspaceDraftTab {
  return Boolean(
    tab &&
      isEditorDraftTabInput(tab) &&
      tab.title.trim().length === 0 &&
      writingEditorDocumentToPlainText(tab.document).length === 0,
  );
}

export function isReusableEmptyPdfTab(
  tab: EditorWorkspaceTab | null | undefined,
) {
  return Boolean(tab && isEmptyPdfTabInput(tab));
}

export function isClosableEditorTab(
  tab: EditorWorkspaceTab,
  dirtyDraftTabIds: ReadonlySet<string>,
  residency: 'resident' | 'dynamic',
) {
  // Close affordance is hidden only for reusable empty resident entries.
  if (isEditorDraftTabInput(tab)) {
    return residency !== 'resident' || !isReusableEmptyDraftTab(tab, dirtyDraftTabIds);
  }

  if (isEmptyBrowserTabInput(tab) || isEmptyPdfTabInput(tab)) {
    return residency !== 'resident';
  }

  return true;
}

export function getDraftTabDisplayLabel(params: {
  tab: EditorWorkspaceDraftTab;
  newTabLabel: string;
  draftModeLabel: string;
  draftIndex: number;
  isEmpty: boolean;
  residency: 'resident' | 'dynamic';
}) {
  const {
    tab,
    newTabLabel,
    draftModeLabel,
    draftIndex,
    isEmpty,
    residency,
  } = params;
  const normalizedTitle = tab.title.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  if (isEmpty) {
    return residency === 'resident' ? '' : newTabLabel;
  }

  return `${draftModeLabel} ${draftIndex + 1}`;
}
