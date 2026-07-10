import { writingEditorDocumentToPlainText } from 'cs/editor/common/writingEditorDocument';
import {
  isEmptyBrowserTabInput,
  isEditorDraftTabInput,
  isEmptyPdfTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import type {
  EditorWorkspaceDraftTab,
  EditorWorkspaceTab,
} from 'cs/workbench/browser/parts/editor/editorModel';

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

export function getDraftTabDisplayLabel(params: {
  tab: EditorWorkspaceDraftTab;
  newTabLabel: string;
  draftModeLabel: string;
  draftIndex: number;
  isEmpty: boolean;
}) {
  const {
    tab,
    newTabLabel,
    draftModeLabel,
    draftIndex,
    isEmpty,
  } = params;
  const normalizedTitle = tab.title.trim();
  if (normalizedTitle) {
    return normalizedTitle;
  }

  if (isEmpty) {
    return newTabLabel;
  }

  return `${draftModeLabel} ${draftIndex + 1}`;
}
