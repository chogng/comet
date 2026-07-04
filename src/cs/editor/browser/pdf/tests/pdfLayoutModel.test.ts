import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createPdfLayoutPage,
  createPdfLayoutSelectionRange,
  createPdfLayoutTextIndexSelectionRange,
  findPdfTextBoundaryAtPoint,
  findPdfTextIndexBoundaryAtPoint,
  viewportPointToPdfPoint,
} from 'cs/editor/browser/pdf/pdfLayoutModel';
import type { PdfReviewerPageInfo } from 'cs/editor/browser/pdf/pdfReviewerTypes';

function createPageInfo(
  chars: PdfReviewerPageInfo['chars'],
  options: {
    pageWidth?: number;
    pageHeight?: number;
    scale?: number;
  } = {},
): PdfReviewerPageInfo {
  return {
    page: 1,
    pageWidth: options.pageWidth ?? 100,
    pageHeight: options.pageHeight ?? 100,
    scale: options.scale ?? 1,
    canvas: {} as HTMLCanvasElement,
    highlightLayer: {} as HTMLElement,
    chars,
  };
}

test('PdfLayoutModel builds line selection rects from row geometry', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 82, width: 8, height: 6 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 20, y: 78, width: 8, height: 12 },
    },
    {
      index: 2,
      char: 'c',
      rect: { x: 30, y: 82, width: 8, height: 6 },
    },
  ]));

  assert.equal(page.lines.length, 1);
  assert.equal(page.lines[0].text, 'abc');
  assert(page.lines[0].selectionRect.height > 12);
});

test('PdfLayoutModel orders lines by visual geometry instead of PDF char stream order', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'c',
      rect: { x: 10, y: 56, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'b',
      rect: { x: 10, y: 68, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 3);
  assert.deepEqual(page.lines.map((line) => line.text), ['a', 'b', 'c']);
  assert.equal(page.chars.map((char) => char.char).join(''), 'abc');
});

test('PdfLayoutModel orders characters within a line by x position', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'b',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 1);
  assert.equal(page.lines[0].text, 'ab');
  assert.equal(page.chars.map((char) => char.char).join(''), 'ab');
});

test('PdfLayoutModel preserves unpositioned spaces in visual line text', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: ' ',
    },
    {
      index: 2,
      char: 'b',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 1);
  assert.equal(page.lines[0].text, 'a b');
  assert.equal(page.chars.map((char) => char.char).join(''), 'a b');

  const range = createPdfLayoutSelectionRange(page, 0, 3);
  assert(range);
  assert.equal(range.text, 'a b');
  assert.equal(range.rects.length, 1);
});

test('PdfLayoutModel places unpositioned spaces by visual order when source order differs', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'd',
      rect: { x: 50, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'o',
      rect: { x: 60, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'g',
      rect: { x: 70, y: 80, width: 8, height: 10 },
    },
    {
      index: 3,
      char: ' ',
    },
    {
      index: 4,
      char: 'c',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 5,
      char: 'a',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
    {
      index: 6,
      char: 't',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 1);
  assert.equal(page.lines[0].text, 'cat dog');
  assert.equal(page.chars.map((char) => char.char).join(''), 'cat dog');
});

test('PdfLayoutModel reads multi-column pages down each column before crossing columns', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'x',
      rect: { x: 62, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'b',
      rect: { x: 10, y: 68, width: 8, height: 10 },
    },
    {
      index: 3,
      char: 'y',
      rect: { x: 62, y: 68, width: 8, height: 10 },
    },
    {
      index: 4,
      char: 'c',
      rect: { x: 10, y: 56, width: 8, height: 10 },
    },
    {
      index: 5,
      char: 'z',
      rect: { x: 62, y: 56, width: 8, height: 10 },
    },
  ]));

  assert.deepEqual(page.lines.map((line) => line.text), ['a', 'b', 'c', 'x', 'y', 'z']);
  assert.equal(page.chars.map((char) => char.char).join(''), 'abcxyz');

  const leftColumnRange = createPdfLayoutSelectionRange(page, 0, 3);
  assert(leftColumnRange);
  assert.equal(leftColumnRange.text, 'abc');
  assert.deepEqual(leftColumnRange.lineIds, [
    page.lines[0].id,
    page.lines[1].id,
    page.lines[2].id,
  ]);
});

test('PdfLayoutModel keeps spanning rows before column body text', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 't',
      rect: { x: 10, y: 92, width: 80, height: 10 },
    },
    {
      index: 1,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'x',
      rect: { x: 62, y: 80, width: 8, height: 10 },
    },
    {
      index: 3,
      char: 'b',
      rect: { x: 10, y: 68, width: 8, height: 10 },
    },
    {
      index: 4,
      char: 'y',
      rect: { x: 62, y: 68, width: 8, height: 10 },
    },
  ]));

  assert.deepEqual(page.lines.map((line) => line.text), ['t', 'a', 'b', 'x', 'y']);
  assert.equal(page.chars.map((char) => char.char).join(''), 'tabxy');
});

test('PdfLayoutModel does not merge stacked rows after a superscript expands the row bbox', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: '1',
      rect: { x: 10, y: 92, width: 4, height: 4 },
    },
    {
      index: 1,
      char: 'A',
      rect: { x: 16, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'B',
      rect: { x: 16, y: 68, width: 8, height: 10 },
    },
    {
      index: 3,
      char: 'C',
      rect: { x: 16, y: 56, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 3);
  assert.deepEqual(page.lines.map((line) => line.text), ['1A', 'B', 'C']);
});

test('PdfLayoutModel clamps neighboring line selection rects to avoid overlap', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 10, y: 70, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 2);
  const upperLine = page.lines[0];
  const lowerLine = page.lines[1];
  assert(upperLine.selectionRect.y >= lowerLine.selectionRect.y + lowerLine.selectionRect.height);
});

test('PdfLayoutModel finds boundaries from viewport points through PDF coordinates', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
  ]));

  const point = viewportPointToPdfPoint(page, 1, { x: 21, y: 15 });
  assert.deepEqual(
    findPdfTextBoundaryAtPoint(page, point, { strict: true }),
    {
      page: 1,
      charOffset: 1,
    },
  );
});

test('PdfLayoutModel finds PDFium text index boundaries from viewport points', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 10,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 11,
      char: 'b',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
  ]));

  const point = viewportPointToPdfPoint(page, 1, { x: 21, y: 15 });
  assert.deepEqual(
    findPdfTextIndexBoundaryAtPoint(page, point, { strict: true }),
    {
      page: 1,
      charIndex: 11,
    },
  );
});

test('PdfLayoutModel chooses the closest row when hit bands overlap', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 10, y: 68, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 2);
  assert.deepEqual(
    findPdfTextBoundaryAtPoint(page, { x: 14, y: 73 }, { strict: true }),
    {
      page: 1,
      charOffset: 2,
    },
  );
});

test('PdfLayoutModel creates selection ranges with row-normalized rects', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 82, width: 8, height: 6 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 20, y: 78, width: 8, height: 12 },
    },
    {
      index: 2,
      char: 'c',
      rect: { x: 30, y: 82, width: 8, height: 6 },
    },
  ]));

  const range = createPdfLayoutSelectionRange(page, 0, 1);
  assert(range);
  assert.equal(range.text, 'a');
  assert.equal(range.startCharOffset, 0);
  assert.equal(range.endCharOffset, 1);
  assert.deepEqual(range.lineIds, [page.lines[0].id]);
  assert.equal(range.rects.length, 1);
  assert(range.rects[0].height > 12);
});

test('PdfLayoutModel keeps selection rows close to loose-spaced text height', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 10, y: 40, width: 8, height: 10 },
    },
  ]));

  assert.equal(page.lines.length, 2);
  assert(page.lines[0].selectionRect.height <= 14);
  assert(page.lines[1].selectionRect.height <= 14);
});

test('PdfLayoutModel expands fully selected lines to the row visual bounds', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: ' ',
    },
    {
      index: 2,
      char: 'b',
      rect: { x: 40, y: 80, width: 8, height: 10 },
    },
  ]));

  const range = createPdfLayoutSelectionRange(page, 0, 3);
  assert(range);
  assert.equal(range.rects.length, 1);
  assert(range.rects[0].x <= page.lines[0].selectionRect.x);
  assert(range.rects[0].width >= page.lines[0].selectionRect.width);
});

test('PdfLayoutModel keeps neighboring selection rows visually even with small raised glyphs', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: '1',
      rect: { x: 10, y: 92, width: 4, height: 4 },
    },
    {
      index: 1,
      char: 'A',
      rect: { x: 16, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'B',
      rect: { x: 10, y: 60, width: 8, height: 10 },
    },
    {
      index: 3,
      char: 'C',
      rect: { x: 20, y: 60, width: 8, height: 10 },
    },
  ]));

  const range = createPdfLayoutSelectionRange(page, 0, 4);
  assert(range);
  assert.equal(range.rects.length, 2);
  assert(Math.abs(range.rects[0].height - range.rects[1].height) < 1);
});

test('PdfLayoutModel includes unpositioned boundary spaces in selection width', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: ' ',
    },
    {
      index: 2,
      char: 'b',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
  ]));

  const range = createPdfLayoutSelectionRange(page, 1, 2);
  assert(range);
  assert.equal(range.text, ' ');
  assert.equal(range.rects.length, 1);
  assert(range.rects[0].width > 0);
  assert(range.rects[0].x > 10);
  assert(range.rects[0].x < 30);
});

test('PdfLayoutModel creates PDFium text index selection ranges', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 0,
      char: 'a',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 1,
      char: 'b',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
    {
      index: 2,
      char: 'c',
      rect: { x: 50, y: 80, width: 8, height: 10 },
    },
    {
      index: 3,
      char: 'd',
      rect: { x: 10, y: 68, width: 8, height: 10 },
    },
    {
      index: 4,
      char: 'e',
      rect: { x: 30, y: 68, width: 8, height: 10 },
    },
    {
      index: 5,
      char: 'f',
      rect: { x: 50, y: 68, width: 8, height: 10 },
    },
  ]));

  const range = createPdfLayoutTextIndexSelectionRange(page, 1, 6);

  assert(range);
  assert.equal(range.text, 'bcdef');
  assert.equal(range.startCharOffset, 1);
  assert.equal(range.endCharOffset, 6);
  assert.equal(range.rects.length, 2);
  assert.deepEqual(range.textRange, {
    startCharIndex: 1,
    endCharIndex: 5,
  });
});

test('PdfLayoutModel records disjoint PDFium text spans for visually contiguous selections', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 10,
      char: 'c',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 11,
      char: 'a',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
    {
      index: 12,
      char: 't',
      rect: { x: 30, y: 80, width: 8, height: 10 },
    },
    {
      index: 20,
      char: 'd',
      rect: { x: 50, y: 80, width: 8, height: 10 },
    },
    {
      index: 21,
      char: 'o',
      rect: { x: 60, y: 80, width: 8, height: 10 },
    },
    {
      index: 22,
      char: 'g',
      rect: { x: 70, y: 80, width: 8, height: 10 },
    },
  ]));

  const range = createPdfLayoutSelectionRange(page, 1, 5);

  assert(range);
  assert.equal(range.text, 'atdo');
  assert.deepEqual(range.textSpans, [
    { startTextIndex: 11, endTextIndex: 13 },
    { startTextIndex: 20, endTextIndex: 22 },
  ]);
  assert.deepEqual(range.textRange, {
    startCharIndex: 11,
    endCharIndex: 21,
  });
});

test('PdfLayoutModel keeps disjoint text spans in visual selection order', () => {
  const page = createPdfLayoutPage(createPageInfo([
    {
      index: 20,
      char: 'c',
      rect: { x: 10, y: 80, width: 8, height: 10 },
    },
    {
      index: 21,
      char: 'a',
      rect: { x: 20, y: 80, width: 8, height: 10 },
    },
    {
      index: 10,
      char: 'd',
      rect: { x: 40, y: 80, width: 8, height: 10 },
    },
    {
      index: 11,
      char: 'o',
      rect: { x: 50, y: 80, width: 8, height: 10 },
    },
  ]));

  const range = createPdfLayoutSelectionRange(page, 0, 4);

  assert(range);
  assert.equal(range.text, 'cado');
  assert.deepEqual(range.textSpans, [
    { startTextIndex: 20, endTextIndex: 22 },
    { startTextIndex: 10, endTextIndex: 12 },
  ]);

  const restored = createPdfLayoutTextIndexSelectionRange(page, 20, 22);
  assert(restored);
  assert.equal(restored.text, 'ca');
});
