import assert from 'node:assert/strict';
import test from 'node:test';
import { EditorState, TextSelection } from 'prosemirror-state';
import {
  applyWritingEditorEdit,
  applyWritingEditorEdits,
  collectWritingEditorTextUnits,
  createWritingEditorDocumentModel,
  createWritingEditorTextModel,
  createEmptyWritingEditorDocument,
  getWritingEditorOffsetAt,
  getWritingEditorOffsetsForRange,
  getWritingEditorPositionAt,
  getWritingEditorTextUnitByBlockId,
  validateWritingEditorPosition,
  validateWritingEditorRange,
  writingEditorDocumentToPlainText,
} from 'cs/editor/common/writingEditorDocument';
import {
  clearInlineStylesCommand,
  clearFontFamilyCommand,
  getWritingEditorToolbarState,
  insertFigureCommand,
  setFontFamilyCommand,
  setFontSizeCommand,
  setTextAlignCommand,
  toggleBoldCommand,
  toggleItalicCommand,
  toggleUnderlineCommand,
} from 'cs/editor/browser/text/commands';
import { writingEditorSchema } from 'cs/editor/browser/text/schema';

test('citations are numbered by first appearance order', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block_intro' },
        content: [
          { type: 'text', text: 'Alpha ' },
          {
            type: 'citation',
            attrs: {
              citationIds: ['cite_b', 'cite_a'],
              displayText: '[cite_b, cite_a]',
            },
          },
          { type: 'text', text: ' then beta ' },
          {
            type: 'citation',
            attrs: {
              citationIds: ['cite_a'],
              displayText: '[cite_a]',
            },
          },
        ],
      },
    ],
  };

  assert.equal(
    writingEditorDocumentToPlainText(document),
    'Alpha [1, 2] then beta [2]',
  );
});

test('figure references resolve by figure order and fall back when missing', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block_intro' },
        content: [{ type: 'text', text: 'See ' }],
      },
      {
        type: 'figure',
        attrs: {
          blockId: 'block_figure_b',
          figureId: 'figure_b',
          src: 'https://example.com/b.png',
          alt: 'B',
          title: '',
          width: null,
        },
      },
      {
        type: 'paragraph',
        attrs: { blockId: 'block_middle' },
        content: [
          {
            type: 'figure_ref',
            attrs: {
              targetId: 'figure_b',
              label: 'Figure',
            },
          },
          { type: 'text', text: ' and ' },
          {
            type: 'figure_ref',
            attrs: {
              targetId: 'figure_missing',
              label: 'Figure',
            },
          },
        ],
      },
      {
        type: 'figure',
        attrs: {
          blockId: 'block_figure_a',
          figureId: 'figure_a',
          src: 'https://example.com/a.png',
          alt: 'A',
          title: '',
          width: null,
        },
      },
    ],
  };

  assert.equal(
    writingEditorDocumentToPlainText(document),
    'See \n\nFigure 1 and Figure ?',
  );
});

test('insertFigureCommand keeps a figure node and trailing paragraph', () => {
  let nextState = EditorState.create({
    schema: writingEditorSchema,
    doc: writingEditorSchema.nodeFromJSON(createEmptyWritingEditorDocument()),
  });

  const handled = insertFigureCommand({
    src: 'https://example.com/figure.png',
    caption: 'Figure caption',
  })(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  assert.equal(handled, true);

  const document = nextState.doc.toJSON() as {
    type: string;
    content?: Array<{ type: string; attrs?: Record<string, unknown>; content?: unknown[] }>;
  };

  assert.equal(document.type, 'doc');
  assert.equal(document.content?.length, 2);
  assert.equal(document.content?.[0]?.type, 'figure');
  assert.equal(document.content?.[1]?.type, 'paragraph');
  assert.equal(document.content?.[0]?.attrs?.src, 'https://example.com/figure.png');
  assert.equal(typeof document.content?.[0]?.attrs?.figureId, 'string');
  assert.match(String(document.content?.[0]?.attrs?.figureId), /^figure_/);
  assert.equal(document.content?.[1]?.content?.length ?? 0, 0);
});

test('text_style mark stores font family and font size on selected text', () => {
  let nextState = EditorState.create({
    schema: writingEditorSchema,
    doc: writingEditorSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'block_1' },
          content: [{ type: 'text', text: 'alpha' }],
        },
      ],
    }),
  });

  nextState = nextState.apply(
    nextState.tr.setSelection(TextSelection.create(nextState.doc, 1, 6)),
  );

  setFontFamilyCommand('IBM Plex Serif')(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });
  setFontSizeCommand('18px')(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  const document = nextState.doc.toJSON() as {
    content?: Array<{ content?: Array<{ marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }> }>;
  };
  const marks = document.content?.[0]?.content?.[0]?.marks ?? [];

  assert.equal(marks.length, 1);
  assert.equal(marks[0]?.type, 'text_style');
  assert.equal(marks[0]?.attrs?.fontFamily, 'IBM Plex Serif');
  assert.equal(marks[0]?.attrs?.fontSize, '18px');

  assert.deepEqual(getWritingEditorToolbarState(nextState).fontFamily, 'IBM Plex Serif');
  assert.deepEqual(getWritingEditorToolbarState(nextState).fontSize, '18px');
});

test('clearing font family keeps the remaining text_style attrs intact', () => {
  let nextState = EditorState.create({
    schema: writingEditorSchema,
    doc: writingEditorSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'block_1' },
          content: [{ type: 'text', text: 'alpha' }],
        },
      ],
    }),
  });

  nextState = nextState.apply(
    nextState.tr.setSelection(TextSelection.create(nextState.doc, 1, 6)),
  );

  setFontFamilyCommand('IBM Plex Serif')(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });
  setFontSizeCommand('18px')(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });
  clearFontFamilyCommand()(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  const document = nextState.doc.toJSON() as {
    content?: Array<{ content?: Array<{ marks?: Array<{ type: string; attrs?: Record<string, unknown> }> }> }>;
  };
  const marks = document.content?.[0]?.content?.[0]?.marks ?? [];

  assert.equal(marks.length, 1);
  assert.equal(marks[0]?.type, 'text_style');
  assert.equal(marks[0]?.attrs?.fontFamily, null);
  assert.equal(marks[0]?.attrs?.fontSize, '18px');

  const toolbarState = getWritingEditorToolbarState(nextState);
  assert.equal(toolbarState.fontFamily, null);
  assert.equal(toolbarState.fontSize, '18px');
});

test('clearInlineStylesCommand removes text_style and basic inline marks', () => {
  let nextState = EditorState.create({
    schema: writingEditorSchema,
    doc: writingEditorSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'block_1' },
          content: [{ type: 'text', text: 'alpha' }],
        },
      ],
    }),
  });

  nextState = nextState.apply(
    nextState.tr.setSelection(TextSelection.create(nextState.doc, 1, 6)),
  );

  toggleBoldCommand()(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });
  toggleItalicCommand()(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });
  toggleUnderlineCommand()(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });
  setFontFamilyCommand('"IBM Plex Serif", serif')(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  clearInlineStylesCommand()(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  const document = nextState.doc.toJSON() as {
    content?: Array<{ content?: Array<{ marks?: Array<{ type: string }> }> }>;
  };
  const marks = document.content?.[0]?.content?.[0]?.marks ?? [];

  assert.equal(marks.length, 0);

  const toolbarState = getWritingEditorToolbarState(nextState);
  assert.equal(toolbarState.isBoldActive, false);
  assert.equal(toolbarState.isItalicActive, false);
  assert.equal(toolbarState.isUnderlineActive, false);
  assert.equal(toolbarState.fontFamily, null);
  assert.equal(toolbarState.fontSize, null);
});

test('toggleUnderlineCommand updates inline marks and toolbar state', () => {
  let nextState = EditorState.create({
    schema: writingEditorSchema,
    doc: writingEditorSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'block_1' },
          content: [{ type: 'text', text: 'alpha' }],
        },
      ],
    }),
  });

  nextState = nextState.apply(
    nextState.tr.setSelection(TextSelection.create(nextState.doc, 1, 6)),
  );

  toggleUnderlineCommand()(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  const document = nextState.doc.toJSON() as {
    content?: Array<{ content?: Array<{ marks?: Array<{ type: string }> }> }>;
  };
  const marks = document.content?.[0]?.content?.[0]?.marks ?? [];

  assert.equal(marks.some((mark) => mark.type === 'underline'), true);
  assert.equal(getWritingEditorToolbarState(nextState).isUnderlineActive, true);
});

test('setTextAlignCommand stores alignment on textblocks and reports it in toolbar state', () => {
  let nextState = EditorState.create({
    schema: writingEditorSchema,
    doc: writingEditorSchema.nodeFromJSON({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { blockId: 'block_1' },
          content: [{ type: 'text', text: 'alpha' }],
        },
        {
          type: 'paragraph',
          attrs: { blockId: 'block_2' },
          content: [{ type: 'text', text: 'beta' }],
        },
      ],
    }),
  });

  nextState = nextState.apply(
    nextState.tr.setSelection(TextSelection.create(nextState.doc, 1, nextState.doc.content.size - 1)),
  );

  setTextAlignCommand('center')(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  const document = nextState.doc.toJSON() as {
    content?: Array<{ attrs?: Record<string, unknown> }>;
  };

  assert.equal(document.content?.[0]?.attrs?.textAlign, 'center');
  assert.equal(document.content?.[1]?.attrs?.textAlign, 'center');
  assert.equal(getWritingEditorToolbarState(nextState).textAlign, 'center');

  setTextAlignCommand('left')(nextState, (transaction) => {
    nextState = nextState.apply(transaction);
  });

  const resetDocument = nextState.doc.toJSON() as {
    content?: Array<{ attrs?: Record<string, unknown> }>;
  };

  assert.equal(resetDocument.content?.[0]?.attrs?.textAlign, null);
  assert.equal(resetDocument.content?.[1]?.attrs?.textAlign, null);
  assert.equal(getWritingEditorToolbarState(nextState).textAlign, 'left');
});

test('collectWritingEditorTextUnits exports stable text units with logical line offsets', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { blockId: 'block_heading', level: 2 },
        content: [{ type: 'text', text: 'Section title' }],
      },
      {
        type: 'bullet_list',
        attrs: { blockId: 'block_list' },
        content: [
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                attrs: { blockId: 'block_item_a' },
                content: [
                  { type: 'text', text: 'First item' },
                  { type: 'hard_break' },
                  { type: 'text', text: 'continued' },
                ],
              },
            ],
          },
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                attrs: { blockId: 'block_item_b' },
                content: [
                  { type: 'text', text: 'See ' },
                  {
                    type: 'citation',
                    attrs: {
                      citationIds: ['cite_1'],
                      displayText: '[cite_1]',
                    },
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        type: 'figure',
        attrs: {
          blockId: 'block_figure',
          figureId: 'figure_a',
          src: 'https://example.com/a.png',
          alt: 'A',
          title: '',
          width: null,
        },
        content: [
          {
            type: 'figcaption',
            attrs: { blockId: 'block_caption' },
            content: [{ type: 'text', text: 'Figure caption' }],
          },
        ],
      },
    ],
  };

  const textUnits = collectWritingEditorTextUnits(document);

  assert.deepEqual(
    textUnits.map(({ blockId, kind, text }) => ({ blockId, kind, text })),
    [
      {
        blockId: 'block_heading',
        kind: 'heading2',
        text: 'Section title',
      },
      {
        blockId: 'block_item_a',
        kind: 'paragraph',
        text: 'First item\ncontinued',
      },
      {
        blockId: 'block_item_b',
        kind: 'paragraph',
        text: 'See [1]',
      },
      {
        blockId: 'block_caption',
        kind: 'figcaption',
        text: 'Figure caption',
      },
    ],
  );

  assert.deepEqual(textUnits[1]?.lines, [
    {
      lineNumber: 1,
      startOffset: 0,
      endOffset: 10,
      text: 'First item',
    },
    {
      lineNumber: 2,
      startOffset: 11,
      endOffset: 20,
      text: 'continued',
    },
  ]);
});

test('block-local position and range helpers behave like Monaco coordinates', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block_lines' },
        content: [
          { type: 'text', text: 'Alpha' },
          { type: 'hard_break' },
          { type: 'text', text: 'Beta' },
        ],
      },
    ],
  };

  assert.equal(getWritingEditorTextUnitByBlockId(document, 'block_lines')?.text, 'Alpha\nBeta');
  assert.equal(getWritingEditorTextUnitByBlockId(document, 'missing_block'), null);

  assert.deepEqual(
    validateWritingEditorPosition(document, 'block_lines', { lineNumber: 9, column: 99 }),
    { lineNumber: 2, column: 5 },
  );

  assert.equal(
    getWritingEditorOffsetAt(document, 'block_lines', { lineNumber: 2, column: 3 }),
    8,
  );

  assert.deepEqual(
    getWritingEditorPositionAt(document, 'block_lines', 8),
    { lineNumber: 2, column: 3 },
  );

  assert.deepEqual(
    validateWritingEditorRange(document, 'block_lines', {
      startLineNumber: 2,
      startColumn: 4,
      endLineNumber: 1,
      endColumn: 2,
    }),
    {
      startLineNumber: 1,
      startColumn: 2,
      endLineNumber: 2,
      endColumn: 4,
    },
  );

  assert.deepEqual(
    getWritingEditorOffsetsForRange(document, 'block_lines', {
      startLineNumber: 1,
      startColumn: 2,
      endLineNumber: 2,
      endColumn: 4,
    }),
    {
      startOffset: 1,
      endOffset: 9,
    },
  );
});

test('document and text models expose Monaco-style accessors', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block_alpha' },
        content: [{ type: 'text', text: 'Alpha' }],
      },
      {
        type: 'blockquote',
        attrs: { blockId: 'block_quote' },
        content: [
          { type: 'text', text: 'Line 1' },
          { type: 'hard_break' },
          { type: 'text', text: 'Line 2' },
        ],
      },
    ],
  };

  const documentModel = createWritingEditorDocumentModel(document);
  const quoteModel = createWritingEditorTextModel(document, 'block_quote');

  assert.equal(documentModel.getTextModels().length, 2);
  assert.equal(documentModel.findByBlockId('block_alpha')?.getValue(), 'Alpha');
  assert.equal(documentModel.getTextModel('missing_block'), null);

  assert.equal(quoteModel.kind, 'blockquote');
  assert.equal(quoteModel.getValue(), 'Line 1\nLine 2');
  assert.equal(quoteModel.getLineCount(), 2);
  assert.equal(quoteModel.getLineContent(2), 'Line 2');
  assert.deepEqual(quoteModel.validatePosition({ lineNumber: 7, column: 99 }), {
    lineNumber: 2,
    column: 7,
  });
  assert.deepEqual(quoteModel.getPositionAt(0), { lineNumber: 1, column: 1 });
  assert.equal(quoteModel.getOffsetAt({ lineNumber: 2, column: 2 }), 8);
  assert.deepEqual(
    quoteModel.validateRange({
      startLineNumber: 2,
      startColumn: 4,
      endLineNumber: 1,
      endColumn: 3,
    }),
    {
      startLineNumber: 1,
      startColumn: 3,
      endLineNumber: 2,
      endColumn: 4,
    },
  );
});

test('applyWritingEditorEdit updates a plain-text block via stable coordinates', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block_plain' },
        content: [
          { type: 'text', text: 'Alpha' },
          { type: 'hard_break' },
          { type: 'text', text: 'Beta' },
        ],
      },
    ],
  };

  const result = applyWritingEditorEdit(document, {
    blockId: 'block_plain',
    kind: 'replaceLineRange',
    line: 2,
    fromColumn: 2,
    toColumn: 4,
    text: 'OO',
    expectedText: 'Alpha\nBeta',
  });

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(writingEditorDocumentToPlainText(result.document), 'Alpha\nBOOa');
});

test('applyWritingEditorEdits applies sequential edits against the updated document', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block_plain' },
        content: [{ type: 'text', text: 'Alpha Beta' }],
      },
    ],
  };

  const result = applyWritingEditorEdits(document, [
    {
      blockId: 'block_plain',
      kind: 'replaceMatch',
      match: 'Alpha',
      text: 'Gamma',
      expectedText: 'Alpha Beta',
    },
    {
      blockId: 'block_plain',
      kind: 'replaceRange',
      from: 6,
      to: 10,
      text: 'Delta',
      expectedText: 'Gamma Beta',
    },
  ]);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(writingEditorDocumentToPlainText(result.document), 'Gamma Delta');
});

test('applyWritingEditorEdit rejects blocks with structured inline content', () => {
  const document = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: { blockId: 'block_structured' },
        content: [
          { type: 'text', text: 'See ' },
          {
            type: 'citation',
            attrs: {
              citationIds: ['cite_1'],
              displayText: '[cite_1]',
            },
          },
        ],
      },
    ],
  };

  const result = applyWritingEditorEdit(document, {
    blockId: 'block_structured',
    kind: 'replaceBlock',
    text: 'Flat text',
  });

  assert.deepEqual(result, {
    ok: false,
    reason: 'unsupported-structured-content',
    blockId: 'block_structured',
    message:
      'Block "block_structured" contains structured inline content and cannot be edited as plain text.',
  });
});
