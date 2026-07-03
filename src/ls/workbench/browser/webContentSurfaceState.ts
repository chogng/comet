import { isEditorContentTabInput } from 'ls/workbench/browser/parts/editor/editorInput';
import type {
  EditorWorkspaceContentTab,
  EditorWorkspaceTab,
} from 'ls/workbench/browser/parts/editor/editorModel';
import type { WebContentState } from 'ls/platform/browserView/common/browserView';

export type WebContentSurfaceOwner = 'shared-content' | 'editor-content-tab';

export type WebContentSurfaceSnapshot = {
  activeContentTab: EditorWorkspaceContentTab | null;
  activeContentTabId: string | null;
  activeContentTabUrl: string;
  owner: WebContentSurfaceOwner;
};

export function resolveActiveContentTab(
  activeTab: EditorWorkspaceTab | null,
): EditorWorkspaceContentTab | null {
  return isEditorContentTabInput(activeTab) ? activeTab : null;
}

// Mirror the upstream editor split: tabs select a target, while the active editor pane renders one shared web-content surface.
export function createWebContentSurfaceSnapshot(
  activeTab: EditorWorkspaceTab | null,
): WebContentSurfaceSnapshot {
  const activeContentTab = resolveActiveContentTab(activeTab);

  return {
    activeContentTab,
    activeContentTabId: activeContentTab?.id ?? null,
    activeContentTabUrl: activeContentTab?.url ?? '',
    owner: activeContentTab ? 'editor-content-tab' : 'shared-content',
  };
}

export function shouldNavigateSharedContentFromTab(
  snapshot: WebContentSurfaceSnapshot,
  browserUrl: string,
) {
  return (
    snapshot.owner === 'editor-content-tab' &&
    Boolean(snapshot.activeContentTabUrl) &&
    snapshot.activeContentTabUrl !== browserUrl
  );
}

export function shouldSyncContentTabFromSharedContent(
  snapshot: WebContentSurfaceSnapshot,
  browserUrl: string,
) {
  return (
    snapshot.owner === 'editor-content-tab' &&
    Boolean(browserUrl) &&
    snapshot.activeContentTabUrl !== browserUrl
  );
}

export function shouldSyncActiveContentTabFromBrowserUrl(
  snapshot: WebContentSurfaceSnapshot,
  browserUrl: string,
  previousBrowserUrl: string,
  previousActiveContentTabId: string | null,
) {
  const isSameActiveContentTab =
    previousActiveContentTabId === snapshot.activeContentTabId;

  return (
    isSameActiveContentTab &&
    Boolean(snapshot.activeContentTabId) &&
    snapshot.activeContentTabUrl === previousBrowserUrl &&
    shouldSyncContentTabFromSharedContent(snapshot, browserUrl)
  );
}

export function shouldSyncActiveContentTabMetadataFromWebContentState(
  snapshot: WebContentSurfaceSnapshot,
  webContentState: Pick<WebContentState, 'ownership' | 'targetId' | 'activeTargetId'>,
) {
  return (
    snapshot.owner === 'editor-content-tab' &&
    Boolean(snapshot.activeContentTabId) &&
    webContentState.ownership === 'active' &&
    webContentState.targetId === snapshot.activeContentTabId &&
    webContentState.activeTargetId === snapshot.activeContentTabId
  );
}

export function resolveContentSourceUrl(
  snapshot: WebContentSurfaceSnapshot,
  browserUrl: string,
  webUrl: string,
) {
  return snapshot.activeContentTabUrl || browserUrl || webUrl;
}
