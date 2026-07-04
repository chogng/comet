import assert from 'node:assert/strict';
import test from 'node:test';
import { createPdfiumLiteParsedDocument } from 'cs/editor/browser/pdf/pdfiumLiteParsedDocument';
import type { PdfReviewerPageInfo } from 'cs/editor/browser/pdf/pdfReviewerTypes';

function createPageInfo(text: string): PdfReviewerPageInfo {
  return {
    page: 1,
    pageWidth: 240,
    pageHeight: 120,
    scale: 1,
    canvas: {} as HTMLCanvasElement,
    highlightLayer: {} as HTMLElement,
    chars: [...text].map((char, index) => ({
      index,
      char,
      rect: {
        x: 12 + index * 8,
        y: 88,
        width: 7,
        height: 10,
      },
    })),
  };
}

test('createPdfiumLiteParsedDocument emits versioned passages with evidence pointers', () => {
  const artifact = createPdfiumLiteParsedDocument({
    documentId: 'document-1',
    fileHash: 'sha256:fixture',
    pages: [createPageInfo('Comet Studio PDF smoke')],
  });

  assert.equal(artifact.schemaVersion, 'cs.parsedDocument.v1');
  assert.equal(artifact.parser.name, 'pdfium-lite');
  assert.equal(artifact.pages.length, 1);
  assert.equal(artifact.blocks.length, 1);
  assert.equal(artifact.passages.length, 1);
  assert.equal(artifact.passages[0]?.text, 'Comet Studio PDF smoke');
  assert.deepEqual(artifact.passages[0]?.evidence, {
    documentId: 'document-1',
    fileHash: 'sha256:fixture',
    parserName: 'pdfium-lite',
    parserVersion: 'pdfium-lite.v1',
    page: 1,
    blockIds: [artifact.blocks[0]?.id],
    rects: artifact.blocks[0]?.rects,
    quote: 'Comet Studio PDF smoke',
  });
});
