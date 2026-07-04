import assert from 'node:assert/strict';
import test from 'node:test';

import { EDITOR_LAYOUT_SPEC, cssPxToTwips } from 'cs/base/common/editorFormat';
import { createDefaultEditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import { buildEditorDocxBuffer, buildEditorDocxFileName } from 'cs/code/electron-main/document/editorDocxSerializer';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';

const ONE_BY_ONE_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+X7x8AAAAASUVORK5CYII=';

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

test('buildEditorDocxFileName sanitizes unsafe title characters', () => {
  assert.equal(
    buildEditorDocxFileName({ title: 'My:/Draft*?' }),
    'My Draft.docx',
  );
});

test('buildEditorDocxBuffer serializes editor formatting, lists, references, and figures', async () => {
  const document: WritingEditorDocument = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: {
          level: 1,
          blockId: 'block_heading_1',
          textAlign: 'center',
        },
        content: [{ type: 'text', text: 'Draft Title' }],
      },
      {
        type: 'paragraph',
        attrs: {
          blockId: 'block_paragraph_1',
          textAlign: 'right',
        },
        content: [
          {
            type: 'text',
            text: 'Styled',
            marks: [
              { type: 'strong' },
              { type: 'em' },
              { type: 'underline' },
              {
                type: 'text_style',
                attrs: {
                  fontFamily: '"宋体", "SimSun", serif',
                  fontSize: '16px',
                },
              },
            ],
          },
          { type: 'text', text: ' ' },
          {
            type: 'citation',
            attrs: {
              citationIds: ['cite-1'],
              displayText: '[cite-1]',
            },
          },
        ],
      },
      {
        type: 'blockquote',
        attrs: {
          blockId: 'block_quote_1',
        },
        content: [
          {
            type: 'paragraph',
            attrs: {
              blockId: 'block_quote_para_1',
              textAlign: null,
            },
            content: [{ type: 'text', text: 'Quoted paragraph' }],
          },
        ],
      },
      {
        type: 'bullet_list',
        attrs: {
          blockId: 'block_bullet_1',
        },
        content: [
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                attrs: {
                  blockId: 'block_bullet_item_1',
                  textAlign: null,
                },
                content: [{ type: 'text', text: 'Bullet item' }],
              },
            ],
          },
        ],
      },
      {
        type: 'ordered_list',
        attrs: {
          blockId: 'block_ordered_1',
        },
        content: [
          {
            type: 'list_item',
            content: [
              {
                type: 'paragraph',
                attrs: {
                  blockId: 'block_ordered_item_1',
                  textAlign: null,
                },
                content: [{ type: 'text', text: 'Ordered item' }],
              },
            ],
          },
        ],
      },
      {
        type: 'figure',
        attrs: {
          blockId: 'block_figure_1',
          figureId: 'figure_1',
          src: ONE_BY_ONE_PNG_DATA_URL,
          alt: 'Sample figure',
          title: 'Figure Title',
          width: 320,
        },
        content: [
          {
            type: 'figcaption',
            attrs: {
              blockId: 'block_caption_1',
            },
            content: [{ type: 'text', text: 'Figure caption' }],
          },
        ],
      },
      {
        type: 'paragraph',
        attrs: {
          blockId: 'block_ref_1',
          textAlign: null,
        },
        content: [
          {
            type: 'figure_ref',
            attrs: {
              targetId: 'figure_1',
              label: 'Figure',
            },
          },
        ],
      },
    ],
  };

  const buffer = await buildEditorDocxBuffer({
    document,
    title: 'Draft Title',
    locale: 'zh',
  });
  const topLevelBlockGapTwips = cssPxToTwips(EDITOR_LAYOUT_SPEC.topLevelBlockGapPx);
  const blockquotePaddingTwips = cssPxToTwips(EDITOR_LAYOUT_SPEC.blockquotePaddingLeftPx);
  const listIndentTwips = cssPxToTwips(EDITOR_LAYOUT_SPEC.listIndentPx);
  const zipText = buffer.toString('utf8');
  const bookmarkMatch = zipText.match(/<w:bookmarkStart w:id="(\d+)" w:name="([^"]+)"/);

  assert.match(zipText, /word\/document\.xml/);
  assert.match(zipText, /word\/numbering\.xml/);
  assert.match(zipText, /word\/media\/image1\.png/);
  assert.match(zipText, /<w:b\/>/);
  assert.match(zipText, /<w:i\/>/);
  assert.match(zipText, /<w:u w:val="single"\/>/);
  assert.match(zipText, /<w:sz w:val="24"\/>/);
  assert.match(zipText, new RegExp(`w:before="${topLevelBlockGapTwips}"`));
  assert.match(zipText, /w:before="150"/);
  assert.match(zipText, new RegExp(`w:left="${blockquotePaddingTwips}"`));
  assert.match(zipText, new RegExp(`w:left="${listIndentTwips}" w:hanging="180"`));
  assert.match(zipText, /<w:numPr>/);
  assert.match(zipText, /<w:pBdr>/);
  assert.match(zipText, /<w:tbl>/);
  assert.match(zipText, /<w:tblCellMar><w:top w:w="180" w:type="dxa"\/><w:left w:w="180" w:type="dxa"\/><w:bottom w:w="180" w:type="dxa"\/><w:right w:w="180" w:type="dxa"\/><\/w:tblCellMar>/);
  assert.match(zipText, /<w:shd w:val="clear" w:color="auto" w:fill="F7FAFD"\/>/);
  assert.match(zipText, /w:color="D8E2ED"/);
  assert.match(zipText, /w:fill="E5EDF2"/);
  assert.match(zipText, /w:fill="F8EEDB"/);
  assert.match(zipText, /w:space="2" w:color="E5EDF2"/);
  assert.match(zipText, /w:space="2" w:color="F8EEDB"/);
  assert.match(zipText, /Figure 1/);
  assert.match(zipText, /\[1\]/);
  assert.match(zipText, /<wp:inline/);
  assert.match(zipText, /Figure caption/);
  assert.ok(bookmarkMatch);
  assert.match(zipText, new RegExp(`<w:bookmarkEnd w:id="${bookmarkMatch[1]}"\\/>`));
  assert.match(
    zipText,
    new RegExp(`<w:hyperlink w:anchor="${escapeRegExp(bookmarkMatch[2])}" w:history="1">`),
  );
});

test('buildEditorDocxBuffer keeps list numbering when a list item starts with a figure card', async () => {
  const document: WritingEditorDocument = {
    type: 'doc',
    content: [
      {
        type: 'bullet_list',
        attrs: {
          blockId: 'block_bullet_figure_1',
        },
        content: [
          {
            type: 'list_item',
            content: [
              {
                type: 'figure',
                attrs: {
                  blockId: 'block_figure_list_1',
                  figureId: 'figure_list_1',
                  src: ONE_BY_ONE_PNG_DATA_URL,
                  alt: 'List figure',
                  title: 'List Figure',
                  width: 240,
                },
                content: [
                  {
                    type: 'figcaption',
                    attrs: {
                      blockId: 'block_caption_list_1',
                    },
                    content: [{ type: 'text', text: 'List figure caption' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const buffer = await buildEditorDocxBuffer({
    document,
    title: 'List Figure Draft',
    locale: 'zh',
  });
  const listIndentTwips = cssPxToTwips(EDITOR_LAYOUT_SPEC.listIndentPx);
  const zipText = buffer.toString('utf8');

  assert.match(
    zipText,
    new RegExp(
      `<w:p><w:pPr><w:jc w:val="left"\\/><w:spacing w:after="0"\\/><w:ind w:left="${listIndentTwips}" w:hanging="180"\\/><w:numPr><w:ilvl w:val="0"\\/><w:numId w:val="1"\\/><\\/w:numPr><\\/w:pPr><w:r><w:t xml:space="preserve"> <\\/w:t><\\/w:r><\\/w:p><w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"\\/><w:tblInd w:w="${listIndentTwips}" w:type="dxa"\\/>`,
    ),
  );
  assert.match(zipText, /List figure caption/);
});

test('buildEditorDocxBuffer applies editor draft paragraph spacing overrides', async () => {
  const document: WritingEditorDocument = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        attrs: {
          blockId: 'block_paragraph_spacing_1',
          textAlign: null,
        },
        content: [{ type: 'text', text: 'Paragraph 1' }],
      },
      {
        type: 'paragraph',
        attrs: {
          blockId: 'block_paragraph_spacing_2',
          textAlign: null,
        },
        content: [{ type: 'text', text: 'Paragraph 2' }],
      },
    ],
  };

  const baseStyle = createDefaultEditorDraftStyleSettings().defaultBodyStyle;
  const buffer = await buildEditorDocxBuffer({
    document,
    title: 'Spacing Draft',
    locale: 'en',
    editorDraftStyle: {
      defaultBodyStyle: {
        ...baseStyle,
        fontSizeValue: '16px',
        lineHeight: 1.5,
        paragraphSpacingBeforePt: 8,
        paragraphSpacingAfterPt: 12,
      },
    },
  });
  const zipText = buffer.toString('utf8');

  assert.match(zipText, /<w:spacing w:after="240" w:line="360" w:lineRule="auto"\/>/);
  assert.match(zipText, /<w:spacing w:before="160" w:after="240" w:line="360" w:lineRule="auto"\/>/);
});
