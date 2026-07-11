import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export type WorkbenchWindowTitleSource = {
  appName: string;
  activeEditor: EditorInput | null;
  browserPageTitle: string;
};

function normalizeTitlePart(value: string | null | undefined) {
  return value?.trim() ?? '';
}

export function resolveWorkbenchWindowTitle(source: WorkbenchWindowTitleSource) {
  const appName = normalizeTitlePart(source.appName) || 'Comet Studio';
  const activeTitle =
    normalizeTitlePart(source.browserPageTitle)
      || normalizeTitlePart(source.activeEditor?.getName());

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
