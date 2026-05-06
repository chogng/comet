import assert from 'node:assert/strict';
import test from 'node:test';
import type { Annotation } from 'ls/editor/common/annotation';
import {
  createV2PdfAnnotationFromResolvedRangesForPage,
  resolvePdfAnnotationRangesForPage,
} from 'ls/editor/browser/pdf/pdfAnnotationReanchor';
import { createPdfLayoutPage } from 'ls/editor/browser/pdf/pdfLayoutModel';
import type { PdfReviewerPageInfo } from 'ls/editor/browser/pdf/pdfReviewerTypes';

function createPageInfo(
  text: string,
  options: { xOffset?: number; xStep?: number; y?: number } = {},
): PdfReviewerPageInfo {
  const xOffset = options.xOffset ?? 10;
  const xStep = options.xStep ?? 8;
  const y = options.y ?? 80;
  return {
    page: 1,
    pageWidth: 200,
    pageHeight: 100,
    scale: 1,
    canvas: {} as HTMLCanvasElement,
    highlightLayer: {} as HTMLElement,
    chars: [...text].map((char, index) => ({
      index,
      char,
      rect: {
        x: xOffset + index * xStep,
        y,
        width: 7,
        height: 10,
      },
    })),
  };
}

function createLegacyAnnotation(): Annotation {
  return {
    id: 'annotation-1',
    kind: 'pdf',
    mode: 'highlight',
    targetId: 'paper.pdf',
    anchor: {
      anchorVersion: 1,
      page: 1,
      rects: [{ x: 1, y: 1, width: 1, height: 1 }],
      quote: 'beta',
    },
    comment: '',
    createdAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
  };
}

function createAnnotation(anchorRange: NonNullable<Annotation['anchor']['ranges']>[number]): Annotation {
  return {
    id: 'annotation-1',
    kind: 'pdf',
    mode: 'highlight',
    targetId: 'paper.pdf',
    anchor: {
      page: anchorRange.page,
      rects: anchorRange.rects,
      quote: anchorRange.quote,
      ranges: [anchorRange],
    },
    comment: '',
    createdAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
  };
}

test('resolvePdfAnnotationRangesForPage migrates legacy rect quote anchors to v2 text anchors', () => {
  const page = createPdfLayoutPage(createPageInfo('alpha beta', { xOffset: 20, xStep: 9 }));
  const annotation = createLegacyAnnotation();

  const resolved = resolvePdfAnnotationRangesForPage(annotation, page);
  const migrated = createV2PdfAnnotationFromResolvedRangesForPage(annotation, page, resolved);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.source, 'quote');
  assert.equal(resolved[0]?.quote, 'beta');
  assert.notDeepEqual(resolved[0]?.rects, annotation.anchor.rects);
  assert(migrated);
  assert.equal(migrated.anchor.anchorVersion, 2);
  assert.equal(migrated.anchor.ranges?.[0]?.startTextIndex, 6);
  assert.equal(migrated.anchor.ranges?.[0]?.endTextIndex, 10);
  assert.equal(migrated.anchor.fingerprint?.layoutVersion, 1);
  assert.equal(typeof migrated.anchor.fingerprint?.pageTextHash, 'string');

  const relayoutPage = createPdfLayoutPage(createPageInfo('alpha beta', { xOffset: 40, xStep: 10 }));
  const relayoutResolved = resolvePdfAnnotationRangesForPage(migrated, relayoutPage);
  assert.equal(relayoutResolved[0]?.source, 'text-index');
  assert.notDeepEqual(relayoutResolved[0]?.rects, annotation.anchor.rects);
  assert((relayoutResolved[0]?.rects[0]?.x ?? 0) > 90);
});

test('resolvePdfAnnotationRangesForPage rebuilds annotation rects from char offsets', () => {
  const page = createPdfLayoutPage(createPageInfo('alpha beta'));
  const annotation = createAnnotation({
    page: 1,
    rects: [{ x: 1, y: 1, width: 1, height: 1 }],
    quote: 'beta',
    startCharOffset: 6,
    endCharOffset: 10,
  });

  const resolved = resolvePdfAnnotationRangesForPage(annotation, page);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.source, 'offset');
  assert.equal(resolved[0]?.quote, 'beta');
  assert.notDeepEqual(resolved[0]?.rects, annotation.anchor.ranges?.[0]?.rects);
});

test('resolvePdfAnnotationRangesForPage falls back to quote when text anchors drift', () => {
  const page = createPdfLayoutPage(createPageInfo('alpha beta'));
  const annotation = createAnnotation({
    page: 1,
    rects: [{ x: 1, y: 1, width: 1, height: 1 }],
    quote: 'beta',
    startCharOffset: 0,
    endCharOffset: 4,
    startTextIndex: 0,
    endTextIndex: 4,
  });

  const resolved = resolvePdfAnnotationRangesForPage(annotation, page);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.source, 'quote');
  assert.equal(resolved[0]?.quote, 'beta');
});

test('resolvePdfAnnotationRangesForPage chooses the closest repeated quote match', () => {
  const page = createPdfLayoutPage(createPageInfo('alpha beta alpha beta'));
  const storedRects = [{ x: 98, y: 80, width: 39, height: 10 }];
  const annotation = createAnnotation({
    page: 1,
    rects: storedRects,
    quote: 'alpha',
    startCharOffset: 6,
    endCharOffset: 10,
  });

  const resolved = resolvePdfAnnotationRangesForPage(annotation, page);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.source, 'quote');
  assert.equal(resolved[0]?.quote, 'alpha');
  assert((resolved[0]?.rects[0]?.x ?? 0) > 90);
});

test('resolvePdfAnnotationRangesForPage uses saved char indices to choose repeated quote matches', () => {
  const page = createPdfLayoutPage(createPageInfo('alpha beta alpha beta'));
  const annotation = createAnnotation({
    page: 1,
    rects: [],
    quote: 'alpha',
    startCharOffset: 6,
    endCharOffset: 10,
    lineIds: ['pdf_line_1_1'],
    startCharIndex: 12,
    endCharIndex: 16,
  });

  const resolved = resolvePdfAnnotationRangesForPage(annotation, page);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.source, 'quote');
  assert((resolved[0]?.rects[0]?.x ?? 0) > 90);
});

test('resolvePdfAnnotationRangesForPage preserves stored rects when it cannot reanchor', () => {
  const page = createPdfLayoutPage(createPageInfo('alpha beta'));
  const storedRects = [{ x: 1, y: 1, width: 1, height: 1 }];
  const annotation = createAnnotation({
    page: 1,
    rects: storedRects,
    quote: 'missing',
    startCharOffset: 0,
    endCharOffset: 4,
  });

  const resolved = resolvePdfAnnotationRangesForPage(annotation, page);

  assert.equal(resolved.length, 1);
  assert.equal(resolved[0]?.source, 'stored');
  assert.deepEqual(resolved[0]?.rects, storedRects);
  assert.equal(createV2PdfAnnotationFromResolvedRangesForPage(annotation, page, resolved), null);
});
