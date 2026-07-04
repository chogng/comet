import { Fragment, Slice } from 'prosemirror-model';
import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import type { Command, Transaction } from 'prosemirror-state';

import { undo, redo, undoDepth, redoDepth } from 'prosemirror-history';
import { lift, setBlockType, toggleMark, wrapIn } from 'prosemirror-commands';
import { liftListItem, wrapInList } from 'prosemirror-schema-list';
import type { EditorView } from 'prosemirror-view';
import { createEditorNodeId, writingEditorSchema } from 'cs/editor/browser/text/schema';
import type { CitationNodeAttrs, TextStyleMarkAttrs } from 'cs/editor/browser/text/schema';

export type WritingEditorCommand = Command;

export type WritingEditorToolbarState = {
  isParagraphActive: boolean;
  activeHeadingLevel: number | null;
  isBoldActive: boolean;
  isItalicActive: boolean;
  isUnderlineActive: boolean;
  fontFamily: string | null;
  fontSize: string | null;
  textAlign: 'left' | 'center' | 'right';
  isBulletListActive: boolean;
  isOrderedListActive: boolean;
  isBlockquoteActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  availableFigureIds: string[];
};

export type InsertFigurePayload = {
  src: string;
  caption?: string;
  alt?: string;
  title?: string;
  width?: number | null;
  figureId?: string;
};

function isAncestorActive(state: EditorState, nodeName: string) {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === nodeName) {
      return true;
    }
  }

  return false;
}

function getActiveTextblock(state: EditorState) {
  const { $from } = state.selection;

  for (let depth = $from.depth; depth >= 0; depth -= 1) {
    const node = $from.node(depth);
    if (node.isTextblock) {
      return node;
    }
  }

  return $from.parent;
}

function isMarkActive(state: EditorState, markName: 'strong' | 'em' | 'underline') {
  const markType = writingEditorSchema.marks[markName];
  if (!markType) {
    return false;
  }

  const { from, to, empty } = state.selection;
  if (empty) {
    return Boolean(markType.isInSet(state.storedMarks ?? state.selection.$from.marks()));
  }

  return state.doc.rangeHasMark(from, to, markType);
}

function normalizeTextStyleValue(value: string | null | undefined) {
  const normalized = value?.trim() ?? '';
  return normalized.length > 0 ? normalized : null;
}

function normalizeTextStyleAttrs(
  attrs: Partial<TextStyleMarkAttrs>,
): TextStyleMarkAttrs {
  return {
    fontFamily: normalizeTextStyleValue(attrs.fontFamily),
    fontSize: normalizeTextStyleValue(attrs.fontSize),
  };
}

function isTextStyleEmpty(attrs: TextStyleMarkAttrs) {
  return !attrs.fontFamily && !attrs.fontSize;
}

function readTextStyleFromMarks(
  marks: readonly { type: { name: string }; attrs: Record<string, unknown> }[],
) {
  const textStyleMark = marks.find((mark) => mark.type.name === 'text_style');
  if (!textStyleMark) {
    return null;
  }

  return normalizeTextStyleAttrs({
    fontFamily: typeof textStyleMark.attrs.fontFamily === 'string'
      ? textStyleMark.attrs.fontFamily
      : null,
    fontSize: typeof textStyleMark.attrs.fontSize === 'string'
      ? textStyleMark.attrs.fontSize
      : null,
  });
}

function getStoredTextStyle(state: EditorState) {
  return readTextStyleFromMarks(state.storedMarks ?? state.selection.$from.marks());
}

function getSelectionTextStyle(state: EditorState) {
  if (state.selection.empty) {
    return getStoredTextStyle(state);
  }

  let resolvedStyle: TextStyleMarkAttrs | null = null;
  let sawText = false;

  state.doc.nodesBetween(state.selection.from, state.selection.to, (node) => {
    if (!node.isText) {
      return;
    }

    sawText = true;
    const currentStyle = readTextStyleFromMarks(node.marks) ?? {
      fontFamily: null,
      fontSize: null,
    };
    if (!resolvedStyle) {
      resolvedStyle = currentStyle;
      return;
    }

    resolvedStyle = {
      fontFamily:
        resolvedStyle.fontFamily === currentStyle.fontFamily ? resolvedStyle.fontFamily : null,
      fontSize:
        resolvedStyle.fontSize === currentStyle.fontSize ? resolvedStyle.fontSize : null,
    };
  });

  if (!sawText) {
    return getStoredTextStyle(state);
  }

  return resolvedStyle;
}

function getMergedTextStyleAttrs(
  state: EditorState,
  attrs: Partial<TextStyleMarkAttrs>,
) {
  return normalizeTextStyleAttrs({
    ...getSelectionTextStyle(state),
    ...attrs,
  });
}

function createInlineNodesFromText(text: string) {
  const hardBreakType = writingEditorSchema.nodes.hard_break;
  const nodes: ProseMirrorNode[] = [];
  const lines = text.split('\n');

  lines.forEach((line, index) => {
    if (line) {
      nodes.push(writingEditorSchema.text(line));
    }

    if (index < lines.length - 1) {
      nodes.push(hardBreakType.create());
    }
  });

  return nodes;
}

function createParagraphNodesFromText(text: string) {
  const paragraphType = writingEditorSchema.nodes.paragraph;
  const normalizedText = text.replace(/\r\n/g, '\n').trim();

  if (!normalizedText) {
    return [];
  }

  return normalizedText
    .split(/\n{2,}/)
    .map((block) =>
      paragraphType.create(
        {
          blockId: createEditorNodeId('block'),
        },
        createInlineNodesFromText(block.trim()),
      ),
    );
}

function createCitationDisplayText(citationIds: string[]) {
  return `[${citationIds.join(', ')}]`;
}

export function getAvailableFigureIds(state: EditorState) {
  const figureIds: string[] = [];

  state.doc.descendants((node) => {
    if (node.type.name === 'figure') {
      const figureId = typeof node.attrs.figureId === 'string' ? node.attrs.figureId.trim() : '';
      if (figureId) {
        figureIds.push(figureId);
      }
    }
  });

  return figureIds;
}

export function getWritingEditorToolbarState(state: EditorState): WritingEditorToolbarState {
  const activeTextblock = getActiveTextblock(state);
  const textStyle = getSelectionTextStyle(state) ?? {
    fontFamily: null,
    fontSize: null,
  };

  return {
    isParagraphActive: activeTextblock.type.name === 'paragraph',
    activeHeadingLevel:
      activeTextblock.type.name === 'heading' ? Number(activeTextblock.attrs.level) || 1 : null,
    isBoldActive: isMarkActive(state, 'strong'),
    isItalicActive: isMarkActive(state, 'em'),
    isUnderlineActive: isMarkActive(state, 'underline'),
    fontFamily: textStyle.fontFamily,
    fontSize: textStyle.fontSize,
    textAlign:
      activeTextblock.attrs.textAlign === 'center' || activeTextblock.attrs.textAlign === 'right'
        ? activeTextblock.attrs.textAlign
        : 'left',
    isBulletListActive: isAncestorActive(state, 'bullet_list'),
    isOrderedListActive: isAncestorActive(state, 'ordered_list'),
    isBlockquoteActive: isAncestorActive(state, 'blockquote'),
    canUndo: undoDepth(state) > 0,
    canRedo: redoDepth(state) > 0,
    availableFigureIds: getAvailableFigureIds(state),
  };
}

export function setParagraphCommand(): WritingEditorCommand {
  return setBlockType(writingEditorSchema.nodes.paragraph);
}

export function toggleHeadingCommand(level: number): WritingEditorCommand {
  return (state, dispatch) => {
    const activeTextblock = getActiveTextblock(state);
    if (activeTextblock.type.name === 'heading' && Number(activeTextblock.attrs.level) === level) {
      return setParagraphCommand()(state, dispatch);
    }

    return setBlockType(writingEditorSchema.nodes.heading, { level })(state, dispatch);
  };
}

function toggleListCommand(listName: 'bullet_list' | 'ordered_list'): WritingEditorCommand {
  const listType = writingEditorSchema.nodes[listName];
  const listItemType = writingEditorSchema.nodes.list_item;

  return (state, dispatch) => {
    if (isAncestorActive(state, listName)) {
      return liftListItem(listItemType)(state, dispatch);
    }

    return wrapInList(listType)(state, dispatch);
  };
}

export function toggleBulletListCommand(): WritingEditorCommand {
  return toggleListCommand('bullet_list');
}

export function toggleOrderedListCommand(): WritingEditorCommand {
  return toggleListCommand('ordered_list');
}

export function toggleBlockquoteCommand(): WritingEditorCommand {
  return (state, dispatch) => {
    if (isAncestorActive(state, 'blockquote')) {
      return lift(state, dispatch);
    }

    return wrapIn(writingEditorSchema.nodes.blockquote)(state, dispatch);
  };
}

export function toggleBoldCommand(): WritingEditorCommand {
  return toggleMark(writingEditorSchema.marks.strong);
}

export function toggleItalicCommand(): WritingEditorCommand {
  return toggleMark(writingEditorSchema.marks.em);
}

export function toggleUnderlineCommand(): WritingEditorCommand {
  return toggleMark(writingEditorSchema.marks.underline);
}

export function setTextAlignCommand(
  textAlign: 'left' | 'center' | 'right',
): WritingEditorCommand {
  return (state, dispatch) => {
    const textblockPositions = new Map<number, ProseMirrorNode>();

    for (const range of state.selection.ranges) {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
        if (node.isTextblock && (node.type.name === 'paragraph' || node.type.name === 'heading')) {
          textblockPositions.set(pos, node);
        }
      });
    }

    if (textblockPositions.size === 0) {
      const { $from } = state.selection;
      for (let depth = $from.depth; depth >= 0; depth -= 1) {
        const node = $from.node(depth);
        if (node.isTextblock && (node.type.name === 'paragraph' || node.type.name === 'heading')) {
          textblockPositions.set($from.before(depth), node);
          break;
        }
      }
    }

    if (textblockPositions.size === 0) {
      return false;
    }

    if (!dispatch) {
      return true;
    }

    let transaction = state.tr;
    for (const [pos, node] of textblockPositions.entries()) {
      transaction = transaction.setNodeMarkup(pos, node.type, {
        ...node.attrs,
        textAlign: textAlign === 'left' ? null : textAlign,
      });
    }

    dispatch(transaction.scrollIntoView());
    return true;
  };
}

export function setTextStyleCommand(
  attrs: Partial<TextStyleMarkAttrs>,
): WritingEditorCommand {
  return (state, dispatch) => {
    const markType = writingEditorSchema.marks.text_style;
    const nextAttrs = getMergedTextStyleAttrs(state, attrs);
    if (!dispatch) {
      return true;
    }

    let transaction = state.tr;

    if (state.selection.empty) {
      transaction = transaction.removeStoredMark(markType);
      if (!isTextStyleEmpty(nextAttrs)) {
        transaction = transaction.addStoredMark(markType.create(nextAttrs));
      }

      dispatch(transaction);
      return true;
    }

    for (const range of state.selection.ranges) {
      transaction = transaction.removeMark(range.$from.pos, range.$to.pos, markType);
      if (!isTextStyleEmpty(nextAttrs)) {
        transaction = transaction.addMark(
          range.$from.pos,
          range.$to.pos,
          markType.create(nextAttrs),
        );
      }
    }

    dispatch(transaction.scrollIntoView());
    return true;
  };
}

export function setFontFamilyCommand(fontFamily: string): WritingEditorCommand {
  return setTextStyleCommand({
    fontFamily,
  });
}

export function clearFontFamilyCommand(): WritingEditorCommand {
  return setTextStyleCommand({
    fontFamily: null,
  });
}

export function setFontSizeCommand(fontSize: string): WritingEditorCommand {
  return setTextStyleCommand({
    fontSize,
  });
}

export function clearFontSizeCommand(): WritingEditorCommand {
  return setTextStyleCommand({
    fontSize: null,
  });
}

export function clearInlineStylesCommand(): WritingEditorCommand {
  return (state, dispatch) => {
    if (!dispatch) {
      return true;
    }

    const strongMark = writingEditorSchema.marks.strong;
    const emMark = writingEditorSchema.marks.em;
    const textStyleMark = writingEditorSchema.marks.text_style;
    const underlineMark = writingEditorSchema.marks.underline;
    let transaction = state.tr;

    if (state.selection.empty) {
      transaction = transaction
        .removeStoredMark(strongMark)
        .removeStoredMark(emMark)
        .removeStoredMark(underlineMark)
        .removeStoredMark(textStyleMark);
      dispatch(transaction);
      return true;
    }

    for (const range of state.selection.ranges) {
      transaction = transaction
        .removeMark(range.$from.pos, range.$to.pos, strongMark)
        .removeMark(range.$from.pos, range.$to.pos, emMark)
        .removeMark(range.$from.pos, range.$to.pos, underlineMark)
        .removeMark(range.$from.pos, range.$to.pos, textStyleMark);
    }

    dispatch(transaction.scrollIntoView());
    return true;
  };
}

export function undoCommand(): WritingEditorCommand {
  return undo;
}

export function redoCommand(): WritingEditorCommand {
  return redo;
}

export function insertPlainTextCommand(text: string): WritingEditorCommand {
  return (state, dispatch) => {
    const paragraphs = createParagraphNodesFromText(text);
    if (paragraphs.length === 0 || !dispatch) {
      return paragraphs.length > 0;
    }

    const transaction = state.tr.replaceSelection(
      new Slice(Fragment.fromArray(paragraphs), 0, 0),
    );
    dispatch(transaction.scrollIntoView());
    return true;
  };
}

export function insertCitationCommand(
  citationIds: string[],
  displayText = createCitationDisplayText(citationIds),
): WritingEditorCommand {
  return (state, dispatch) => {
    if (citationIds.length === 0 || !dispatch) {
      return citationIds.length > 0;
    }

    const citationNode = writingEditorSchema.nodes.citation.create({
      citationIds,
      displayText,
    } satisfies CitationNodeAttrs);

    dispatch(state.tr.replaceSelectionWith(citationNode, false).scrollIntoView());
    return true;
  };
}

export function insertFigureRefCommand(targetId: string, label = 'Figure'): WritingEditorCommand {
  return (state, dispatch) => {
    const normalizedTargetId = targetId.trim();
    if (!normalizedTargetId || !dispatch) {
      return Boolean(normalizedTargetId);
    }

    const figureRefNode = writingEditorSchema.nodes.figure_ref.create({
      targetId: normalizedTargetId,
      label,
    });

    dispatch(state.tr.replaceSelectionWith(figureRefNode, false).scrollIntoView());
    return true;
  };
}

export function insertFigureCommand({
  src,
  caption = '',
  alt = '',
  title = '',
  width = null,
  figureId,
}: InsertFigurePayload): WritingEditorCommand {
  return (state, dispatch) => {
    const normalizedSrc = src.trim();
    if (!normalizedSrc || !dispatch) {
      return Boolean(normalizedSrc);
    }

    const figcaptionType = writingEditorSchema.nodes.figcaption;
    const figureType = writingEditorSchema.nodes.figure;
    const paragraphType = writingEditorSchema.nodes.paragraph;
    const normalizedCaption = caption.trim();
    const figureNode = figureType.create(
      {
        blockId: createEditorNodeId('block'),
        figureId: figureId?.trim() || createEditorNodeId('figure'),
        src: normalizedSrc,
        alt: alt.trim() || normalizedCaption,
        title: title.trim(),
        width,
      },
      normalizedCaption
        ? [
            figcaptionType.create(
              {
                blockId: createEditorNodeId('block'),
              },
              createInlineNodesFromText(normalizedCaption),
            ),
          ]
        : undefined,
    );
    const trailingParagraph = paragraphType.create({
      blockId: createEditorNodeId('block'),
    });

    dispatch(
      state.tr
        .replaceSelection(new Slice(Fragment.fromArray([figureNode, trailingParagraph]), 0, 0))
        .scrollIntoView(),
    );
    return true;
  };
}

export function runWritingEditorCommand(view: EditorView | null, command: WritingEditorCommand) {
  if (!view) {
    return false;
  }

  const handled = command(view.state, (transaction: Transaction) => view.dispatch(transaction));
  if (handled) {
    view.focus();
  }

  return handled;
}
