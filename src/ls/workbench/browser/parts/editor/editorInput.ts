import { getEditorContentTabTitle } from 'ls/workbench/browser/parts/editor/editorUrlPresentation';
import { URI } from 'ls/base/common/uri';

export type EditorTabViewMode = 'draft';

export type EditorDraftTabInput = {
  id: string;
  kind: 'draft';
  title: string;
  viewMode: EditorTabViewMode;
};

export type EditorBrowserTabInput = {
  id: string;
  kind: 'browser';
  title: string;
  url: string;
  faviconUrl?: string;
};

export type EditorPdfTabInput = {
  id: string;
  kind: 'pdf';
  title: string;
  url: string;
};

export type EditorContentTabInput =
  | EditorBrowserTabInput
  | EditorPdfTabInput;

export type EditorTabInput =
  | EditorDraftTabInput
  | EditorContentTabInput;

export type EditorTabKind = EditorTabInput['kind'];
export type SupportedEditorPaneMode = 'draft' | 'browser' | 'pdf';

export const SUPPORTED_EDITOR_TAB_KINDS = [
  'draft',
  'browser',
  'pdf',
] as const;

export const SUPPORTED_EDITOR_PANE_MODES = [
  'draft',
  'browser',
  'pdf',
] as const satisfies readonly SupportedEditorPaneMode[];

// Planned tab kinds are declared here for forward compatibility.
// They are intentionally not wired into runtime tab creation/normalization yet.
export type EditorFutureTabKind =
  | 'file'
  | 'terminal'
  | 'git-changes';

export type EditorFuturePaneMode =
  | 'file'
  | 'terminal'
  | 'git-changes';

export type EditorPaneMode =
  | SupportedEditorPaneMode
  | EditorFuturePaneMode;

export const PLANNED_EDITOR_TAB_KINDS = [
  'file',
  'terminal',
  'git-changes',
] as const;

export const PLANNED_EDITOR_PANE_MODES = [
  'file',
  'terminal',
  'git-changes',
] as const satisfies readonly EditorFuturePaneMode[];

export const EMPTY_BROWSER_TAB_URL = 'about:blank';
export const EMPTY_PDF_TAB_URL = EMPTY_BROWSER_TAB_URL;

export type EditorFileTabInput = {
  id: string;
  kind: 'file';
  title: string;
  resourceUri?: string;
};

export type EditorTerminalTabInput = {
  id: string;
  kind: 'terminal';
  title: string;
  terminalSessionId?: string;
};

export type EditorGitChangesTabInput = {
  id: string;
  kind: 'git-changes';
  title: string;
  repositoryUri?: string;
};

export type EditorFutureTabInput =
  | EditorFileTabInput
  | EditorTerminalTabInput
  | EditorGitChangesTabInput;

export type EditorPlannedTabInput =
  | EditorTabInput
  | EditorFutureTabInput;

export type EditorPlannedTabKind = EditorPlannedTabInput['kind'];

const DEFAULT_VIEW_MODE: EditorTabViewMode = 'draft';

export function createEditorTabInputId(prefix: 'draft' | 'browser' | 'pdf') {
  const randomPart = Math.random().toString(36).slice(2, 8);
  return `ls-${prefix}-tab-${Date.now().toString(36)}-${randomPart}`;
}

export function getEditorPaneMode(
  input: Pick<EditorTabInput, 'kind'>,
): SupportedEditorPaneMode;
export function getEditorPaneMode(
  input: Pick<EditorPlannedTabInput, 'kind'>,
): EditorPaneMode;
export function getEditorPaneMode(
  input: Pick<EditorPlannedTabInput, 'kind'>,
): EditorPaneMode {
  switch (input.kind) {
    case 'draft':
      return 'draft';
    case 'browser':
      return 'browser';
    case 'pdf':
      return 'pdf';
    case 'file':
      return 'file';
    case 'terminal':
      return 'terminal';
    case 'git-changes':
      return 'git-changes';
    default:
      return 'browser';
  }
}

export function createEditorDraftTabInput(
  initial?: Partial<Pick<EditorDraftTabInput, 'id' | 'title' | 'viewMode'>>,
): EditorDraftTabInput {
  return {
    id: initial?.id ?? createEditorTabInputId('draft'),
    kind: 'draft',
    title: initial?.title ?? '',
    viewMode: initial?.viewMode === 'draft' ? initial.viewMode : DEFAULT_VIEW_MODE,
  };
}

function createEditorContentTabInput<K extends EditorContentTabInput['kind']>(
  kind: K,
  url: string,
  initial?: Partial<Pick<Extract<EditorContentTabInput, { kind: K }>, 'id' | 'title'>>,
): Extract<EditorContentTabInput, { kind: K }> {
  const normalizedUrl = url.trim();
  const derivedTitle = getEditorContentTabTitle(normalizedUrl);
  const normalizedInitialTitle = initial?.title?.trim() ?? '';
  const resolvedTitle =
    normalizedUrl === EMPTY_BROWSER_TAB_URL
      ? ''
      : normalizedInitialTitle || derivedTitle;

  return {
    id: initial?.id ?? createEditorTabInputId(kind),
    kind,
    title: resolvedTitle,
    url: normalizedUrl,
  } as Extract<EditorContentTabInput, { kind: K }>;
}

export function createEditorBrowserTabInput(
  url: string,
  initial?: Partial<Pick<EditorBrowserTabInput, 'id' | 'title' | 'faviconUrl'>>,
): EditorBrowserTabInput {
  const base = createEditorContentTabInput('browser', url, initial);
  const normalizedFaviconUrl = String(initial?.faviconUrl ?? '').trim();

  return normalizedFaviconUrl
    ? {
        ...base,
        faviconUrl: normalizedFaviconUrl,
      }
    : base;
}

export function createEditorPdfTabInput(
  url: string,
  initial?: Partial<Pick<EditorPdfTabInput, 'id' | 'title'>>,
): EditorPdfTabInput {
  return createEditorContentTabInput('pdf', url, initial);
}

export function isEditorDraftTabInput(
  input: EditorTabInput | null | undefined,
): input is EditorDraftTabInput {
  return input?.kind === 'draft';
}

export function isEditorBrowserTabInput(
  input: EditorTabInput | null | undefined,
): input is EditorBrowserTabInput {
  return input?.kind === 'browser';
}

export function isEmptyBrowserTabInput(
  input: EditorTabInput | null | undefined,
): input is EditorBrowserTabInput {
  return isEditorBrowserTabInput(input) && input.url === EMPTY_BROWSER_TAB_URL;
}

export function isEmptyPdfTabInput(
  input: EditorTabInput | null | undefined,
): input is EditorPdfTabInput {
  return isEditorPdfTabInput(input) && input.url === EMPTY_PDF_TAB_URL;
}

export function isEditorPdfTabInput(
  input: EditorTabInput | null | undefined,
): input is EditorPdfTabInput {
  return input?.kind === 'pdf';
}

export function isEditorContentTabInput(
  input: EditorTabInput | null | undefined,
): input is EditorContentTabInput {
  return input?.kind === 'browser' || input?.kind === 'pdf';
}

export function normalizeEditorTabInput(value: unknown): EditorTabInput | null {
  const candidate = value as Partial<EditorTabInput> | null | undefined;
  const rawCandidate = value as { kind?: unknown; url?: unknown } | null | undefined;
  const legacyKind = rawCandidate?.kind;
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string') {
    return null;
  }

  if (candidate.kind === 'draft') {
    return createEditorDraftTabInput({
      id: candidate.id,
      title: typeof candidate.title === 'string' ? candidate.title : '',
      viewMode: candidate.viewMode,
    });
  }

  if (
    (candidate.kind === 'browser' || legacyKind === 'web') &&
    typeof rawCandidate?.url === 'string'
  ) {
    return createEditorBrowserTabInput(rawCandidate.url, {
      id: candidate.id,
      title: typeof candidate.title === 'string' ? candidate.title : '',
      faviconUrl:
        typeof (candidate as { faviconUrl?: unknown }).faviconUrl === 'string'
          ? (candidate as { faviconUrl?: string }).faviconUrl
          : '',
    });
  }

  if (candidate.kind === 'pdf' && typeof rawCandidate?.url === 'string') {
    return createEditorPdfTabInput(rawCandidate.url, {
      id: candidate.id,
      title: typeof candidate.title === 'string' ? candidate.title : '',
    });
  }

  return null;
}

export function toEditorTabInput(input: EditorTabInput): EditorTabInput {
  if (isEditorDraftTabInput(input)) {
    return createEditorDraftTabInput(input);
  }

  if (isEditorPdfTabInput(input)) {
    return createEditorPdfTabInput(input.url, input);
  }

  return createEditorBrowserTabInput(input.url, input);
}

export function getEditorContentTabInputResourceKey(
  input: Pick<EditorContentTabInput, 'kind' | 'url'>,
) {
  return `${input.kind}:${URI.parse(input.url.trim(), true).toString()}`;
}

export function getEditorTabInputResourceKey(input: EditorTabInput) {
  if (isEditorDraftTabInput(input)) {
    return `draft:${input.id}`;
  }

  return getEditorContentTabInputResourceKey(input);
}
