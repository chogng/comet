import type { EditorState } from 'prosemirror-state';
import { redoDepth, undoDepth } from 'prosemirror-history';
import {
  collectWritingEditorDerivedLabels,
  collectWritingEditorStats,
  getWritingEditorNodeText,
} from 'cs/editor/common/writingEditorDocument';
import type { WritingEditorSurfaceLabels } from 'cs/editor/browser/text/editor';

type DraftStatusResolverLabels = Pick<
  WritingEditorSurfaceLabels,
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'bulletList'
  | 'orderedList'
  | 'blockquote'
> & {
  blockFigure: string;
};

export type DraftEditorStatusState = {
  wordCount: number;
  characterCount: number;
  paragraphCount: number;
  selectionCharacterCount: number;
  activeBlockLabel: string;
  activeBlockIndex: number | null;
  currentLine: number;
  currentColumn: number;
  canUndo: boolean;
  canRedo: boolean;
};

const statusTrackedBlockNodeNames = new Set([
  'paragraph',
  'heading',
  'blockquote',
  'bullet_list',
  'ordered_list',
  'figure',
]);

type ActiveTextblockInfo = {
  node: EditorState['selection']['$head']['parent'];
  offset: number;
};

type ActiveBlockInfo = {
  label: string;
  blockId: string | null;
};

function isAncestorActive(state: EditorState, nodeName: string) {
  const { $head } = state.selection;

  for (let depth = $head.depth; depth > 0; depth -= 1) {
    if ($head.node(depth).type.name === nodeName) {
      return true;
    }
  }

  return false;
}

function findAncestorBlockId(state: EditorState, nodeName: string) {
  const { $head } = state.selection;

  for (let depth = $head.depth; depth > 0; depth -= 1) {
    const node = $head.node(depth);
    if (node.type.name === nodeName) {
      const blockId = node.attrs.blockId;
      return typeof blockId === 'string' && blockId.trim() ? blockId : null;
    }
  }

  return null;
}

function getActiveTextblock(state: EditorState): ActiveTextblockInfo {
  const { $head } = state.selection;

  for (let depth = $head.depth; depth >= 0; depth -= 1) {
    const node = $head.node(depth);
    if (node.isTextblock) {
      return {
        node,
        offset: $head.pos - $head.start(depth),
      };
    }
  }

  return {
    node: $head.parent,
    offset: $head.parentOffset,
  };
}

function getBlockIndex(state: EditorState, blockId: string | null) {
  if (!blockId) {
    return null;
  }

  let currentIndex = 0;
  let matchedIndex: number | null = null;

  state.doc.descendants((node) => {
    if (!statusTrackedBlockNodeNames.has(node.type.name)) {
      return;
    }

    currentIndex += 1;
    const candidateBlockId = node.attrs.blockId;
    if (
      matchedIndex === null &&
      typeof candidateBlockId === 'string' &&
      candidateBlockId === blockId
    ) {
      matchedIndex = currentIndex;
    }
  });

  return matchedIndex;
}

function getBlockLocation(state: EditorState) {
  const activeTextblock = getActiveTextblock(state);
  const derivedLabels = collectWritingEditorDerivedLabels(state.doc);
  const textBeforeCursor = getWritingEditorNodeText(
    activeTextblock.node,
    derivedLabels,
    0,
    activeTextblock.offset,
  );
  const lines = textBeforeCursor.split('\n');
  const currentLine = Math.max(lines.length, 1);
  const currentColumn = (lines[lines.length - 1]?.length ?? 0) + 1;

  return {
    currentLine,
    currentColumn,
  };
}

function getSelectionCharacterCount(state: EditorState) {
  let selectionCharacterCount = 0;

  for (const range of state.selection.ranges) {
    const rawSelectionText = state.doc.textBetween(range.$from.pos, range.$to.pos, '\n\n', ' ');
    selectionCharacterCount += rawSelectionText.replace(/\s+/g, '').length;
  }

  return selectionCharacterCount;
}

function getActiveBlockInfo(state: EditorState, labels: DraftStatusResolverLabels): ActiveBlockInfo {
  if (isAncestorActive(state, 'figure')) {
    return {
      label: labels.blockFigure,
      blockId: findAncestorBlockId(state, 'figure'),
    };
  }

  if (isAncestorActive(state, 'ordered_list')) {
    return {
      label: labels.orderedList,
      blockId: findAncestorBlockId(state, 'ordered_list'),
    };
  }

  if (isAncestorActive(state, 'bullet_list')) {
    return {
      label: labels.bulletList,
      blockId: findAncestorBlockId(state, 'bullet_list'),
    };
  }

  if (isAncestorActive(state, 'blockquote')) {
    return {
      label: labels.blockquote,
      blockId: findAncestorBlockId(state, 'blockquote'),
    };
  }

  const activeTextblock = getActiveTextblock(state).node;
  const blockId = activeTextblock.attrs.blockId;
  const normalizedBlockId =
    typeof blockId === 'string' && blockId.trim() ? blockId : null;
  if (activeTextblock.type.name === 'heading') {
    const headingLevel = Number(activeTextblock.attrs.level) || 1;
    if (headingLevel === 1) {
      return {
        label: labels.heading1,
        blockId: normalizedBlockId,
      };
    }
    if (headingLevel === 2) {
      return {
        label: labels.heading2,
        blockId: normalizedBlockId,
      };
    }
    return {
      label: labels.heading3,
      blockId: normalizedBlockId,
    };
  }

  return {
    label: labels.paragraph,
    blockId: normalizedBlockId,
  };
}

export function createDraftEditorStatusState(
  state: EditorState,
  labels: DraftStatusResolverLabels,
): DraftEditorStatusState {
  const stats = collectWritingEditorStats(state.doc.toJSON());
  const activeBlock = getActiveBlockInfo(state, labels);
  const blockLocation = getBlockLocation(state);

  return {
    wordCount: stats.wordCount,
    characterCount: stats.characterCount,
    paragraphCount: stats.paragraphCount,
    selectionCharacterCount: getSelectionCharacterCount(state),
    activeBlockLabel: activeBlock.label,
    activeBlockIndex: getBlockIndex(state, activeBlock.blockId),
    currentLine: blockLocation.currentLine,
    currentColumn: blockLocation.currentColumn,
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
  };
}

export function areDraftEditorStatusStatesEqual(
  previous: DraftEditorStatusState | undefined,
  next: DraftEditorStatusState,
) {
  if (!previous) {
    return false;
  }

  return (
    previous.wordCount === next.wordCount &&
    previous.characterCount === next.characterCount &&
    previous.paragraphCount === next.paragraphCount &&
    previous.selectionCharacterCount === next.selectionCharacterCount &&
    previous.activeBlockLabel === next.activeBlockLabel &&
    previous.activeBlockIndex === next.activeBlockIndex &&
    previous.currentLine === next.currentLine &&
    previous.currentColumn === next.currentColumn &&
    previous.canUndo === next.canUndo &&
    previous.canRedo === next.canRedo
  );
}
