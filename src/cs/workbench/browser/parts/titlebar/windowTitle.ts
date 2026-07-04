import type { EditorWorkspaceTab } from 'cs/workbench/browser/parts/editor/editorModel';

export type WorkbenchWindowTitlePage = 'content' | 'settings';

export type WorkbenchWindowTitleSource = {
  appName: string;
  activePage: WorkbenchWindowTitlePage;
  settingsTitle: string;
  activeEditorTab: Pick<EditorWorkspaceTab, 'kind' | 'title'> | null;
  browserPageTitle: string;
};

function normalizeTitlePart(value: string | null | undefined) {
  return value?.trim() ?? '';
}

export function resolveWorkbenchWindowTitle(source: WorkbenchWindowTitleSource) {
  const appName = normalizeTitlePart(source.appName) || 'Comet Studio';
  const activeTitle =
    source.activePage === 'settings'
      ? normalizeTitlePart(source.settingsTitle)
      : source.activeEditorTab?.kind === 'browser'
        ? normalizeTitlePart(source.browserPageTitle) ||
          normalizeTitlePart(source.activeEditorTab.title)
        : normalizeTitlePart(source.activeEditorTab?.title);

  return activeTitle && activeTitle !== appName
    ? `${activeTitle} - ${appName}`
    : appName;
}

export function syncWorkbenchWindowTitle(
  source: WorkbenchWindowTitleSource,
  targetDocument: Document = document,
) {
  const nextTitle = resolveWorkbenchWindowTitle(source);
  if (targetDocument.title !== nextTitle) {
    targetDocument.title = nextTitle;
  }
}
