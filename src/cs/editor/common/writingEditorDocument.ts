import type { Node as ProseMirrorNode } from 'prosemirror-model';
import { createEditorNodeId, writingEditorSchema } from 'cs/editor/browser/text/schema';
import type { BlockNodeAttrs, CitationNodeAttrs, FigureRefNodeAttrs } from 'cs/editor/browser/text/schema';

export type WritingEditorMark = {
  type: string;
  attrs?: Record<string, unknown>;
};

export type WritingEditorNode = {
  type: string;
  attrs?: Record<string, unknown>;
  content?: WritingEditorNode[];
  marks?: WritingEditorMark[];
  text?: string;
};

type QueryElementLike = {
  getAttribute: (name: string) => string | null;
  textContent: string | null;
};

type QueryRootLike = {
  querySelectorAll: (selectors: string) => ArrayLike<QueryElementLike> | Iterable<QueryElementLike>;
};

export type WritingEditorDocument = WritingEditorNode;

export type WritingEditorDerivedLabels = {
  citationOrder: Map<string, number>;
  figureOrder: Map<string, number>;
};

export type WritingEditorTextUnitKind =
  | 'paragraph'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'blockquote'
  | 'figcaption';

export type WritingEditorLogicalLine = {
  lineNumber: number;
  startOffset: number;
  endOffset: number;
  text: string;
};

export type WritingEditorPosition = {
  lineNumber: number;
  column: number;
};

export type WritingEditorRange = {
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
};

export type WritingEditorTextUnit = {
  blockId: string;
  kind: WritingEditorTextUnitKind;
  text: string;
  lines: WritingEditorLogicalLine[];
};

export type WritingEditorStableEditTarget =
  | {
      blockId: string;
      expectedText?: string;
      kind: 'replaceBlock';
      text: string;
    }
  | {
      blockId: string;
      expectedText?: string;
      kind: 'replaceRange';
      from: number;
      to: number;
      text: string;
    }
  | {
      blockId: string;
      expectedText?: string;
      kind: 'replaceLine';
      line: number;
      text: string;
    }
  | {
      blockId: string;
      expectedText?: string;
      kind: 'replaceLineRange';
      line: number;
      fromColumn: number;
      toColumn: number;
      text: string;
    }
  | {
      blockId: string;
      expectedText?: string;
      kind: 'replaceMatch';
      match: string;
      occurrence?: number;
      text: string;
    };

export type WritingEditorApplyEditFailureReason =
  | 'unknown-block'
  | 'unsupported-structured-content'
  | 'expected-text-mismatch'
  | 'match-not-found';

export type WritingEditorApplyEditResult =
  | {
      ok: true;
      document: WritingEditorDocument;
      blockId: string;
      text: string;
    }
  | {
      ok: false;
      reason: WritingEditorApplyEditFailureReason;
      blockId: string;
      message: string;
    };

export type WritingEditorStableSelectionTarget = {
  blockId: string;
  kind: WritingEditorTextUnitKind;
  range: WritingEditorRange;
  startOffset: number;
  endOffset: number;
  selectedText: string;
  blockText: string;
  isCollapsed: boolean;
  isPlainTextEditable: boolean;
};

export function isWritingEditorPlainTextEditableNode(node: WritingEditorNode): boolean {
  return (node.content ?? []).every((child) => {
    if (child.type === 'text' || child.type === 'hard_break') {
      return true;
    }

    return false;
  });
}

export class WritingEditorTextModel {
  readonly blockId: string;
  readonly kind: WritingEditorTextUnitKind;
  private readonly textUnit: WritingEditorTextUnit;

  constructor(textUnit: WritingEditorTextUnit) {
    this.textUnit = textUnit;
    this.blockId = textUnit.blockId;
    this.kind = textUnit.kind;
  }

  getValue() {
    return this.textUnit.text;
  }

  getLineCount() {
    return this.textUnit.lines.length;
  }

  getLineContent(lineNumber: number) {
    const validatedPosition = this.validatePosition({ lineNumber, column: 1 });
    return this.textUnit.lines[validatedPosition.lineNumber - 1]?.text ?? '';
  }

  validatePosition(position: WritingEditorPosition) {
    const maxLineNumber = this.textUnit.lines.length;
    const lineNumber = Math.min(Math.max(Math.floor(position.lineNumber) || 1, 1), maxLineNumber);
    const line = this.textUnit.lines[lineNumber - 1];
    const maxColumn = getLineMaxColumn(line);
    const column = Math.min(Math.max(Math.floor(position.column) || 1, 1), maxColumn);

    return {
      lineNumber,
      column,
    } satisfies WritingEditorPosition;
  }

  validateRange(range: WritingEditorRange) {
    const start = this.validatePosition({
      lineNumber: range.startLineNumber,
      column: range.startColumn,
    });
    const end = this.validatePosition({
      lineNumber: range.endLineNumber,
      column: range.endColumn,
    });

    return sortWritingEditorRangeEndpoints(
      start.lineNumber,
      start.column,
      end.lineNumber,
      end.column,
    ) satisfies WritingEditorRange;
  }

  getOffsetAt(position: WritingEditorPosition) {
    const validatedPosition = this.validatePosition(position);
    const line = this.textUnit.lines[validatedPosition.lineNumber - 1];

    return line.startOffset + (validatedPosition.column - 1);
  }

  getPositionAt(offset: number) {
    const normalizedOffset = Math.min(
      Math.max(Math.floor(offset) || 0, 0),
      this.textUnit.text.length,
    );

    for (const line of this.textUnit.lines) {
      if (normalizedOffset <= line.endOffset) {
        return {
          lineNumber: line.lineNumber,
          column: normalizedOffset - line.startOffset + 1,
        } satisfies WritingEditorPosition;
      }
    }

    const lastLine = this.textUnit.lines[this.textUnit.lines.length - 1];
    return {
      lineNumber: lastLine.lineNumber,
      column: getLineMaxColumn(lastLine),
    } satisfies WritingEditorPosition;
  }

  getOffsetsForRange(range: WritingEditorRange) {
    const validatedRange = this.validateRange(range);
    return {
      startOffset: this.getOffsetAt({
        lineNumber: validatedRange.startLineNumber,
        column: validatedRange.startColumn,
      }),
      endOffset: this.getOffsetAt({
        lineNumber: validatedRange.endLineNumber,
        column: validatedRange.endColumn,
      }),
    };
  }

  toJSON() {
    return this.textUnit;
  }
}

export class WritingEditorDocumentModel {
  private readonly document: WritingEditorDocument;
  private readonly textUnits: WritingEditorTextUnit[];
  private readonly modelsByBlockId: Map<string, WritingEditorTextModel>;

  constructor(document: WritingEditorDocument) {
    this.document = normalizeWritingEditorDocument(document);
    this.textUnits = collectWritingEditorTextUnits(this.document);
    this.modelsByBlockId = new Map(
      this.textUnits.map((textUnit) => [textUnit.blockId, new WritingEditorTextModel(textUnit)]),
    );
  }

  getDocument() {
    return this.document;
  }

  getTextModels() {
    return [...this.modelsByBlockId.values()];
  }

  getTextModel(blockId: string) {
    return this.modelsByBlockId.get(blockId) ?? null;
  }

  findByBlockId(blockId: string) {
    return this.getTextModel(blockId);
  }

  applyEdit(edit: WritingEditorStableEditTarget) {
    return applyWritingEditorEdit(this.document, edit);
  }

  applyEdits(edits: readonly WritingEditorStableEditTarget[]) {
    return applyWritingEditorEdits(this.document, edits);
  }
}

function sortWritingEditorRangeEndpoints(
  startLineNumber: number,
  startColumn: number,
  endLineNumber: number,
  endColumn: number,
) {
  if (
    startLineNumber < endLineNumber ||
    (startLineNumber === endLineNumber && startColumn <= endColumn)
  ) {
    return {
      startLineNumber,
      startColumn,
      endLineNumber,
      endColumn,
    };
  }

  return {
    startLineNumber: endLineNumber,
    startColumn: endColumn,
    endLineNumber: startLineNumber,
    endColumn: startColumn,
  };
}

function createTextNode(text: string): WritingEditorNode {
  return {
    type: 'text',
    text,
  };
}

function createInlineContentFromPlainText(text: string): WritingEditorNode[] {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const segments = normalizedText.split('\n');
  const content: WritingEditorNode[] = [];

  segments.forEach((segment, index) => {
    if (segment) {
      content.push(createTextNode(segment));
    }
    if (index < segments.length - 1) {
      content.push({ type: 'hard_break' });
    }
  });

  return content;
}

export function createParagraphNode(text = ''): WritingEditorNode {
  return {
    type: 'paragraph',
    attrs: {
      blockId: createEditorNodeId('block'),
    },
    content: text ? [createTextNode(text)] : [],
  };
}

export function createEmptyWritingEditorDocument(): WritingEditorDocument {
  return {
    type: 'doc',
    content: [createParagraphNode()],
  };
}

export function createWritingEditorDocumentFromPlainText(text: string): WritingEditorDocument {
  const normalizedText = text.replace(/\r\n/g, '\n').trim();
  if (!normalizedText) {
    return createEmptyWritingEditorDocument();
  }

  return {
    type: 'doc',
    content: normalizedText
      .split(/\n{2,}/)
      .map((block) => createParagraphNode(block.trim()))
      .filter((node) => node.content && node.content.length > 0),
  };
}

export function normalizeWritingEditorDocument(value: unknown): WritingEditorDocument {
  try {
    const node = writingEditorSchema.nodeFromJSON(value);
    return node.toJSON() as WritingEditorDocument;
  } catch {
    return createEmptyWritingEditorDocument();
  }
}

export function collectWritingEditorDerivedLabels(node: ProseMirrorNode): WritingEditorDerivedLabels {
  const citationOrder = new Map<string, number>();
  const figureOrder = new Map<string, number>();
  let nextCitationNumber = 1;
  let nextFigureNumber = 1;

  node.descendants((child) => {
    if (child.type.name === 'figure') {
      const figureId = typeof child.attrs.figureId === 'string' ? child.attrs.figureId.trim() : '';
      if (figureId && !figureOrder.has(figureId)) {
        figureOrder.set(figureId, nextFigureNumber);
        nextFigureNumber += 1;
      }
    }

    if (child.type.name === 'citation') {
      const attrs = child.attrs as CitationNodeAttrs;
      for (const citationId of attrs.citationIds) {
        const normalizedCitationId = citationId.trim();
        if (!normalizedCitationId || citationOrder.has(normalizedCitationId)) {
          continue;
        }

        citationOrder.set(normalizedCitationId, nextCitationNumber);
        nextCitationNumber += 1;
      }
    }
  });

  return {
    citationOrder,
    figureOrder,
  };
}

function formatCitationLeafText(
  attrs: CitationNodeAttrs,
  derivedLabels: WritingEditorDerivedLabels,
) {
  if (attrs.citationIds.length === 0) {
    return attrs.displayText ?? '[?]';
  }

  return `[${attrs.citationIds
    .map((citationId) => derivedLabels.citationOrder.get(citationId.trim()) ?? '?')
    .join(', ')}]`;
}

function formatFigureRefLeafText(
  attrs: FigureRefNodeAttrs,
  derivedLabels: WritingEditorDerivedLabels,
) {
  const normalizedTargetId = attrs.targetId?.trim() ?? '';
  if (!normalizedTargetId) {
    return attrs.label;
  }

  return `${attrs.label} ${derivedLabels.figureOrder.get(normalizedTargetId) ?? '?'}`;
}

export function getWritingEditorLeafText(
  node: ProseMirrorNode,
  derivedLabels: WritingEditorDerivedLabels,
) {
  if (node.type.name === 'citation') {
    const attrs = node.attrs as CitationNodeAttrs;
    return formatCitationLeafText(attrs, derivedLabels);
  }

  if (node.type.name === 'figure_ref') {
    const attrs = node.attrs as FigureRefNodeAttrs;
    return formatFigureRefLeafText(attrs, derivedLabels);
  }

  if (node.type.name === 'hard_break') {
    return '\n';
  }

  return '';
}

export function getWritingEditorNodeText(
  node: ProseMirrorNode,
  derivedLabels: WritingEditorDerivedLabels,
  from = 0,
  to = node.content.size,
) {
  return node.textBetween(from, to, '\n\n', (child) =>
    getWritingEditorLeafText(child, derivedLabels),
  );
}

export function writingEditorDocumentToPlainText(document: WritingEditorDocument) {
  const node = writingEditorSchema.nodeFromJSON(normalizeWritingEditorDocument(document));
  const derivedLabels = collectWritingEditorDerivedLabels(node);

  return getWritingEditorNodeText(node, derivedLabels).trim();
}

export function getWritingEditorTextUnitKind(node: ProseMirrorNode): WritingEditorTextUnitKind | null {
  if (node.type.name === 'paragraph') {
    return 'paragraph';
  }

  if (node.type.name === 'blockquote') {
    return 'blockquote';
  }

  if (node.type.name === 'figcaption') {
    return 'figcaption';
  }

  if (node.type.name === 'heading') {
    const level = Number(node.attrs.level) || 1;
    if (level === 1) {
      return 'heading1';
    }
    if (level === 2) {
      return 'heading2';
    }
    return 'heading3';
  }

  return null;
}

function createLogicalLines(text: string): WritingEditorLogicalLine[] {
  const normalizedText = text.replace(/\r\n/g, '\n');
  const segments = normalizedText.split('\n');
  const lines: WritingEditorLogicalLine[] = [];
  let startOffset = 0;

  segments.forEach((segment, index) => {
    const lineNumber = index + 1;
    const endOffset = startOffset + segment.length;
    lines.push({
      lineNumber,
      startOffset,
      endOffset,
      text: segment,
    });
    startOffset = endOffset + 1;
  });

  return lines.length > 0
    ? lines
    : [
        {
          lineNumber: 1,
          startOffset: 0,
          endOffset: 0,
          text: '',
        },
      ];
}

export function collectWritingEditorTextUnits(document: WritingEditorDocument) {
  const node = writingEditorSchema.nodeFromJSON(normalizeWritingEditorDocument(document));
  const derivedLabels = collectWritingEditorDerivedLabels(node);
  const textUnits: WritingEditorTextUnit[] = [];

  node.descendants((child) => {
    const kind = getWritingEditorTextUnitKind(child);
    const blockId = (child.attrs as BlockNodeAttrs | null | undefined)?.blockId;
    if (!kind || typeof blockId !== 'string' || !blockId.trim()) {
      return;
    }

    const text = getWritingEditorNodeText(child, derivedLabels);
    textUnits.push({
      blockId,
      kind,
      text,
      lines: createLogicalLines(text),
    });
  });

  return textUnits;
}

function findWritableTextUnitNode(
  node: WritingEditorNode,
  blockId: string,
): WritingEditorNode | null {
  const currentBlockId = (node.attrs as BlockNodeAttrs | null | undefined)?.blockId;
  if (currentBlockId === blockId) {
    const normalized = normalizeWritingEditorDocument({
      type: 'doc',
      content: [node],
    });
    const docNode = writingEditorSchema.nodeFromJSON(normalized);
    const firstChild = docNode.firstChild;
    if (firstChild && getWritingEditorTextUnitKind(firstChild)) {
      return node;
    }
  }

  for (const child of node.content ?? []) {
    const match = findWritableTextUnitNode(child, blockId);
    if (match) {
      return match;
    }
  }

  return null;
}

export function findWritingEditorNodeByBlockId(
  document: WritingEditorDocument,
  blockId: string,
): WritingEditorNode | null {
  return findWritableTextUnitNode(normalizeWritingEditorDocument(document), blockId);
}

function updateWritableTextUnitNode(
  node: WritingEditorNode,
  blockId: string,
  nextText: string,
): WritingEditorNode {
  const currentBlockId = (node.attrs as BlockNodeAttrs | null | undefined)?.blockId;
  if (currentBlockId === blockId) {
    return {
      ...node,
      content: createInlineContentFromPlainText(nextText),
    };
  }

  if (!node.content?.length) {
    return node;
  }

  return {
    ...node,
    content: node.content.map((child) =>
      updateWritableTextUnitNode(child, blockId, nextText),
    ),
  };
}

function resolveEditedText(
  textModel: WritingEditorTextModel,
  edit: WritingEditorStableEditTarget,
):
  | {
      ok: true;
      text: string;
    }
  | {
      ok: false;
      reason: WritingEditorApplyEditFailureReason;
      message: string;
    } {
  const currentText = textModel.getValue();
  if (edit.expectedText !== undefined && edit.expectedText !== currentText) {
    return {
      ok: false,
      reason: 'expected-text-mismatch' as const,
      message: `Expected text mismatch for block "${edit.blockId}".`,
    };
  }

  switch (edit.kind) {
    case 'replaceBlock':
      return { ok: true as const, text: edit.text };
    case 'replaceRange':
      return {
        ok: true as const,
        text: currentText.slice(0, edit.from) + edit.text + currentText.slice(edit.to),
      };
    case 'replaceLine': {
      const line = textModel.validatePosition({ lineNumber: edit.line, column: 1 }).lineNumber;
      const offsets = textModel.getOffsetsForRange({
        startLineNumber: line,
        startColumn: 1,
        endLineNumber: line,
        endColumn: textModel.getLineContent(line).length + 1,
      });
      return {
        ok: true as const,
        text:
          currentText.slice(0, offsets.startOffset) +
          edit.text +
          currentText.slice(offsets.endOffset),
      };
    }
    case 'replaceLineRange': {
      const offsets = textModel.getOffsetsForRange({
        startLineNumber: edit.line,
        startColumn: edit.fromColumn,
        endLineNumber: edit.line,
        endColumn: edit.toColumn,
      });
      return {
        ok: true as const,
        text:
          currentText.slice(0, offsets.startOffset) +
          edit.text +
          currentText.slice(offsets.endOffset),
      };
    }
    case 'replaceMatch': {
      const occurrence = Math.max(edit.occurrence ?? 1, 1);
      let fromIndex = 0;
      let matchIndex = -1;
      for (let index = 0; index < occurrence; index += 1) {
        matchIndex = currentText.indexOf(edit.match, fromIndex);
        if (matchIndex < 0) {
          return {
            ok: false as const,
            reason: 'match-not-found' as const,
            message: `Match "${edit.match}" not found in block "${edit.blockId}".`,
          };
        }
        fromIndex = matchIndex + edit.match.length;
      }
      return {
        ok: true as const,
        text:
          currentText.slice(0, matchIndex) +
          edit.text +
          currentText.slice(matchIndex + edit.match.length),
      };
    }
  }
}

export function applyWritingEditorEdit(
  document: WritingEditorDocument,
  edit: WritingEditorStableEditTarget,
): WritingEditorApplyEditResult {
  const normalizedDocument = normalizeWritingEditorDocument(document);
  const documentModel = createWritingEditorDocumentModel(normalizedDocument);
  const textModel = documentModel.getTextModel(edit.blockId);
  if (!textModel) {
    return {
      ok: false,
      reason: 'unknown-block',
      blockId: edit.blockId,
      message: `Unknown writing editor blockId "${edit.blockId}".`,
    };
  }

  const targetNode = findWritableTextUnitNode(normalizedDocument, edit.blockId);
  if (!targetNode || !isWritingEditorPlainTextEditableNode(targetNode)) {
    return {
      ok: false,
      reason: 'unsupported-structured-content',
      blockId: edit.blockId,
      message: `Block "${edit.blockId}" contains structured inline content and cannot be edited as plain text.`,
    };
  }

  const resolvedEdit = resolveEditedText(textModel, edit);
  if (!resolvedEdit.ok) {
    return {
      ok: false,
      reason: resolvedEdit.reason,
      blockId: edit.blockId,
      message: resolvedEdit.message,
    };
  }

  const nextText = resolvedEdit.text;

  return {
    ok: true,
    blockId: edit.blockId,
    text: nextText,
    document: updateWritableTextUnitNode(normalizedDocument, edit.blockId, nextText),
  };
}

export function applyWritingEditorEdits(
  document: WritingEditorDocument,
  edits: readonly WritingEditorStableEditTarget[],
): WritingEditorApplyEditResult {
  let nextDocument = normalizeWritingEditorDocument(document);
  let lastResult: WritingEditorApplyEditResult = {
    ok: true,
    blockId: '',
    text: '',
    document: nextDocument,
  };

  for (const edit of edits) {
    const result = applyWritingEditorEdit(nextDocument, edit);
    if (!result.ok) {
      return result;
    }
    nextDocument = result.document;
    lastResult = result;
  }

  return {
    ok: true,
    blockId: lastResult.blockId,
    text: lastResult.text,
    document: nextDocument,
  };
}

export function getWritingEditorTextUnitByBlockId(
  document: WritingEditorDocument,
  blockId: string,
) {
  return createWritingEditorDocumentModel(document)
    .getTextModel(blockId)
    ?.toJSON() ?? null;
}

function getLineMaxColumn(line: WritingEditorLogicalLine) {
  return line.text.length + 1;
}

export function createWritingEditorTextModel(
  document: WritingEditorDocument,
  blockId: string,
) {
  const textModel = createWritingEditorDocumentModel(document).getTextModel(blockId);
  if (!textModel) {
    throw new Error(`Unknown writing editor blockId "${blockId}".`);
  }

  return textModel;
}

export function createWritingEditorDocumentModel(document: WritingEditorDocument) {
  return new WritingEditorDocumentModel(document);
}

export function validateWritingEditorPosition(
  document: WritingEditorDocument,
  blockId: string,
  position: WritingEditorPosition,
) {
  return createWritingEditorTextModel(document, blockId).validatePosition(position);
}

export function getWritingEditorOffsetAt(
  document: WritingEditorDocument,
  blockId: string,
  position: WritingEditorPosition,
) {
  return createWritingEditorTextModel(document, blockId).getOffsetAt(position);
}

export function getWritingEditorPositionAt(
  document: WritingEditorDocument,
  blockId: string,
  offset: number,
) {
  return createWritingEditorTextModel(document, blockId).getPositionAt(offset);
}

export function validateWritingEditorRange(
  document: WritingEditorDocument,
  blockId: string,
  range: WritingEditorRange,
) {
  return createWritingEditorTextModel(document, blockId).validateRange(range);
}

export function getWritingEditorOffsetsForRange(
  document: WritingEditorDocument,
  blockId: string,
  range: WritingEditorRange,
) {
  return createWritingEditorTextModel(document, blockId).getOffsetsForRange(range);
}

export function collectWritingEditorStats(document: WritingEditorDocument) {
  const node = writingEditorSchema.nodeFromJSON(normalizeWritingEditorDocument(document));
  const plainText = writingEditorDocumentToPlainText(document);
  const characterCount = plainText.replace(/\s+/g, '').length;
  const wordCount = plainText ? plainText.split(/\s+/).filter(Boolean).length : 0;
  let paragraphCount = 0;

  node.descendants((child) => {
    if (
      child.type.name === 'paragraph' ||
      child.type.name === 'heading' ||
      child.type.name === 'blockquote' ||
      child.type.name === 'figure'
    ) {
      paragraphCount += 1;
    }
  });

  return {
    characterCount,
    wordCount,
    paragraphCount,
  };
}

export function syncWritingEditorDerivedLabels(root: QueryRootLike, documentNode: ProseMirrorNode) {
  const derivedLabels = collectWritingEditorDerivedLabels(documentNode);

  for (const element of Array.from(root.querySelectorAll('[data-citation-ids]') as ArrayLike<QueryElementLike>)) {
    const citationIds = (element.getAttribute('data-citation-ids') ?? '')
      .split(',')
      .map((segment) => segment.trim())
      .filter(Boolean);

    element.textContent = formatCitationLeafText(
      {
        citationIds,
        displayText: null,
      },
      derivedLabels,
    );
  }

  for (const element of Array.from(root.querySelectorAll('[data-target-id]') as ArrayLike<QueryElementLike>)) {
    const targetId = element.getAttribute('data-target-id');
    const label = element.textContent?.split(/\s+/)[0] || 'Figure';

    element.textContent = formatFigureRefLeafText(
      {
        targetId,
        label,
      },
      derivedLabels,
    );
  }
}

export function withParagraphBlockId(attrs: Record<string, unknown> | null | undefined) {
  return {
    ...(attrs ?? {}),
    blockId: (attrs as BlockNodeAttrs | null | undefined)?.blockId ?? createEditorNodeId('block'),
  };
}
