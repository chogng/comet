import {
  getEditorPaneMode,
  isEditorDraftTabInput,
  isEditorPdfTabInput,
} from 'ls/workbench/browser/parts/editor/editorInput';
import type {
  EditorWorkspaceDraftTab,
  EditorWorkspaceTab,
} from 'ls/workbench/browser/parts/editor/editorModel';
import { collectWritingEditorStats } from 'ls/editor/common/writingEditorDocument';
import type { WritingEditorSurfaceLabels } from 'ls/editor/browser/text/editor';
import type { DraftEditorStatusState } from 'ls/editor/browser/text/draftEditorStatusState';

export type EditorStatusLabels = {
  statusbarAriaLabel: string;
  words: string;
  characters: string;
  paragraphs: string;
  selection: string;
  block: string;
  line: string;
  column: string;
  url: string;
  blockFigure: string;
  ready: string;
};

type DraftStatusResolverLabels = Pick<
  WritingEditorSurfaceLabels,
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
> &
  Pick<EditorStatusLabels, 'blockFigure'>;

export type EditorStatusContextLabels = DraftStatusResolverLabels &
  Pick<WritingEditorSurfaceLabels, 'undo' | 'redo'> &
  Pick<
    EditorStatusLabels,
    | 'statusbarAriaLabel'
    | 'words'
    | 'characters'
    | 'paragraphs'
    | 'selection'
    | 'block'
    | 'line'
    | 'column'
    | 'url'
    | 'ready'
  > & {
    draftMode: string;
    sourceMode: string;
    pdfMode: string;
  };

export type EditorStatusItemTone = 'default' | 'accent' | 'muted' | 'error';

export type EditorStatusItem = {
  id: string;
  label: string;
  value: string;
  tone?: EditorStatusItemTone;
  title?: string;
  commandId?: 'undo' | 'redo';
  commandEnabled?: boolean;
};

export type EditorContentStatusState = {
  message: string;
  detail?: string;
  tone?: EditorStatusItemTone;
};

export type EditorStatusState = {
  ariaLabel: string;
  paneMode: 'empty' | 'draft' | 'browser' | 'pdf';
  modeLabel?: string;
  summary?: string;
  leftItems: readonly EditorStatusItem[];
  rightItems: readonly EditorStatusItem[];
};

function normalizeLegacyHeadingLabel(
  label: string,
  labels: Pick<DraftStatusResolverLabels, 'heading1' | 'heading2' | 'heading3'>,
) {
  const normalized = label.trim().toUpperCase();
  if (normalized === 'H1') {
    return labels.heading1;
  }
  if (normalized === 'H2') {
    return labels.heading2;
  }
  if (normalized === 'H3') {
    return labels.heading3;
  }
  return label;
}

function formatBlockValue(
  statusState: DraftEditorStatusState,
  labels: Pick<DraftStatusResolverLabels, 'heading1' | 'heading2' | 'heading3'>,
) {
  const normalizedLabel = normalizeLegacyHeadingLabel(statusState.activeBlockLabel, labels);
  if (!statusState.activeBlockIndex) {
    return normalizedLabel;
  }

  return `${normalizedLabel} #${statusState.activeBlockIndex}`;
}

function createDraftFallbackStatusState(
  tab: EditorWorkspaceDraftTab,
  labels: DraftStatusResolverLabels,
): DraftEditorStatusState {
  const stats = collectWritingEditorStats(tab.document);

  return {
    wordCount: stats.wordCount,
    characterCount: stats.characterCount,
    paragraphCount: stats.paragraphCount,
    selectionCharacterCount: 0,
    activeBlockLabel: labels.paragraph,
    activeBlockIndex: null,
    currentLine: 1,
    currentColumn: 1,
    canUndo: false,
    canRedo: false,
  };
}

function formatStatusUrl(url: string) {
  const normalizedUrl = url.trim();
  if (!normalizedUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    return `${parsedUrl.host}${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;
  } catch {
    return normalizedUrl;
  }
}

function createDraftEditorStatus(
  tab: EditorWorkspaceDraftTab,
  labels: EditorStatusContextLabels,
  draftStatusState?: DraftEditorStatusState,
): EditorStatusState {
  const statusState = draftStatusState ?? createDraftFallbackStatusState(tab, labels);
  const leftItems: EditorStatusItem[] = [
    {
      id: 'block',
      label: labels.block,
      value: formatBlockValue(statusState, labels),
    },
    {
      id: 'line',
      label: labels.line,
      value: String(statusState.currentLine),
    },
    {
      id: 'column',
      label: labels.column,
      value: String(statusState.currentColumn),
    },
  ];

  if (statusState.selectionCharacterCount > 0) {
    leftItems.push({
      id: 'selection',
      label: labels.selection,
      value: String(statusState.selectionCharacterCount),
      tone: 'accent',
    });
  }

  return {
    ariaLabel: labels.statusbarAriaLabel,
    paneMode: 'draft',
    modeLabel: labels.draftMode,
    leftItems,
    rightItems: [
      {
        id: 'words',
        label: labels.words,
        value: String(statusState.wordCount),
      },
      {
        id: 'characters',
        label: labels.characters,
        value: String(statusState.characterCount),
      },
      {
        id: 'paragraphs',
        label: labels.paragraphs,
        value: String(statusState.paragraphCount),
      },
      {
        id: 'undo',
        label: labels.undo,
        value: statusState.canUndo ? labels.ready : '-',
        tone: statusState.canUndo ? 'accent' : 'muted',
        commandId: 'undo',
        commandEnabled: statusState.canUndo,
      },
      {
        id: 'redo',
        label: labels.redo,
        value: statusState.canRedo ? labels.ready : '-',
        tone: statusState.canRedo ? 'accent' : 'muted',
        commandId: 'redo',
        commandEnabled: statusState.canRedo,
      },
    ],
  };
}

function createContentEditorStatus(
  tab: Extract<EditorWorkspaceTab, { kind: 'browser' | 'pdf' }>,
  labels: EditorStatusContextLabels,
  contentStatus?: EditorContentStatusState,
): EditorStatusState {
  const paneMode = getEditorPaneMode(tab);
  const leftItems: EditorStatusItem[] = [];
  if (contentStatus?.message) {
    leftItems.push({
      id: `${paneMode}-status`,
      label: paneMode === 'pdf' ? labels.pdfMode : labels.sourceMode,
      value: contentStatus.message,
      tone: contentStatus.tone ?? 'default',
      title: contentStatus.detail,
    });
  }

  return {
    ariaLabel: labels.statusbarAriaLabel,
    paneMode,
    modeLabel: isEditorPdfTabInput(tab) ? labels.pdfMode : labels.sourceMode,
    leftItems,
    rightItems: [
      {
        id: 'url',
        label: labels.url,
        value: formatStatusUrl(tab.url),
      },
    ],
  };
}

export function createEditorStatus(
  activeTab: EditorWorkspaceTab | null,
  labels: EditorStatusContextLabels,
  draftStatusState?: DraftEditorStatusState,
  contentStatus?: EditorContentStatusState,
): EditorStatusState {
  if (!activeTab) {
    return {
      ariaLabel: labels.statusbarAriaLabel,
      paneMode: 'empty',
      summary: labels.ready,
      leftItems: [],
      rightItems: [],
    };
  }

  if (isEditorDraftTabInput(activeTab)) {
    return createDraftEditorStatus(activeTab, labels, draftStatusState);
  }

  return createContentEditorStatus(activeTab, labels, contentStatus);
}
