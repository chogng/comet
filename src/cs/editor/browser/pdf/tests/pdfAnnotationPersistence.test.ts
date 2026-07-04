import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { Annotation } from 'cs/editor/common/annotation';
import {
  readStoredPdfAnnotations,
  writeStoredPdfAnnotations,
} from 'cs/editor/browser/pdf/pdfAnnotationPersistence';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('PDF annotation persistence preserves layout anchor fields', () => {
  const targetId = 'pdf-layout-anchor-test';
  const annotation: Annotation = {
    id: 'annotation_1',
    kind: 'pdf',
    targetId,
    anchor: {
      anchorVersion: 2,
      documentId: 'document-1',
      fileHash: 'sha256:abc',
      parserName: 'pdfium-lite',
      parserVersion: 'pdfium-lite.v1',
      page: 1,
      rects: [{ x: 1, y: 2, width: 3, height: 4 }],
      quote: 'alpha',
      ranges: [{
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
        blockIds: ['block-1'],
      }],
      fingerprint: {
        beforeText: 'before',
        afterText: 'after',
        pageTextHash: 'hash',
        layoutVersion: 1,
      },
    },
    comment: 'note',
    createdAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
  };

  try {
    writeStoredPdfAnnotations(targetId, [annotation]);

    const restored = readStoredPdfAnnotations(targetId);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].anchor.anchorVersion, 2);
    assert.equal(restored[0].anchor.documentId, 'document-1');
    assert.equal(restored[0].anchor.fileHash, 'sha256:abc');
    assert.equal(restored[0].anchor.parserName, 'pdfium-lite');
    assert.equal(restored[0].anchor.parserVersion, 'pdfium-lite.v1');
    assert.deepEqual(restored[0].anchor.ranges?.[0], annotation.anchor.ranges?.[0]);
    assert.deepEqual(restored[0].anchor.fingerprint, annotation.anchor.fingerprint);
  } finally {
    window.localStorage.removeItem(`cs.pdfAnnotations.${targetId}`);
  }
});

test('PDF annotation persistence keeps legacy rect quote anchors readable', () => {
  const targetId = 'pdf-legacy-anchor-test';
  const rawAnnotation = {
    id: 'annotation_legacy',
    kind: 'pdf',
    targetId,
    anchor: {
      page: 2,
      rects: [{ x: 5, y: 6, width: 7, height: 8 }],
      quote: 'legacy quote',
    },
    comment: '',
    createdAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
  };

  try {
    window.localStorage.setItem(
      `cs.pdfAnnotations.${targetId}`,
      JSON.stringify([rawAnnotation]),
    );

    const restored = readStoredPdfAnnotations(targetId);
    assert.equal(restored.length, 1);
    assert.equal(restored[0].anchor.anchorVersion, undefined);
    assert.equal(restored[0].anchor.page, 2);
    assert.deepEqual(restored[0].anchor.rects, rawAnnotation.anchor.rects);
    assert.equal(restored[0].anchor.quote, 'legacy quote');
    assert.equal(restored[0].anchor.ranges, undefined);
  } finally {
    window.localStorage.removeItem(`cs.pdfAnnotations.${targetId}`);
  }
});
