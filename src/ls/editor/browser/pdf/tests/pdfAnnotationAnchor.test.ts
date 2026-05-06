import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfAnnotationAnchorFromSelection } from 'ls/editor/browser/pdf/pdfAnnotationAnchor';
import { createPdfSelection } from 'ls/editor/browser/pdf/pdfSelection';

test('createPdfAnnotationAnchorFromSelection preserves layout range anchors', () => {
  const selection = createPdfSelection({
    page: 1,
    rects: [{ x: 1, y: 2, width: 3, height: 4 }],
    text: 'alpha',
    startCharOffset: 10,
    endCharOffset: 15,
    lineIds: ['pdf_line_1_1'],
    textSpans: [
      { startTextIndex: 20, endTextIndex: 22 },
      { startTextIndex: 30, endTextIndex: 33 },
    ],
    textRange: {
      startCharIndex: 20,
      endCharIndex: 24,
    },
  });

  const anchor = createPdfAnnotationAnchorFromSelection(selection);

  assert.equal(anchor.anchorVersion, 2);
  assert.equal(anchor.page, 1);
  assert.equal(anchor.quote, 'alpha');
  assert.equal(anchor.ranges?.length, 1);
  assert.deepEqual(anchor.ranges?.[0], {
    page: 1,
    rects: [{ x: 1, y: 2, width: 3, height: 4 }],
    quote: 'alpha',
    startCharOffset: 10,
    endCharOffset: 15,
    startCharIndex: 20,
    endCharIndex: 24,
    startTextIndex: 20,
    endTextIndex: 25,
    textSpans: [
      { startTextIndex: 20, endTextIndex: 22 },
      { startTextIndex: 30, endTextIndex: 33 },
    ],
    lineIds: ['pdf_line_1_1'],
  });
});
