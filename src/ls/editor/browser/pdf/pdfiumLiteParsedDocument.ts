import {
  createCanonicalPassageId,
  createParsedBlockId,
  type CanonicalPassage,
  type ParsedBlock,
  type ParsedDocument,
  type ParsedPage,
} from 'ls/editor/common/pdfParsedDocument';
import {
  createPdfLayoutPage,
  type PdfLayoutLine,
} from 'ls/editor/browser/pdf/pdfLayoutModel';
import type {
  PdfRect,
  PdfReviewerPageInfo,
} from 'ls/editor/browser/pdf/pdfReviewerTypes';

export const pdfiumLiteParserVersion = 'pdfium-lite.v1';

export type PdfiumLiteParsedDocumentInput = {
  documentId: string;
  fileHash: string;
  pages: readonly PdfReviewerPageInfo[];
  parserVersion?: string;
  optionsHash?: string;
};

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function createPageId(page: number) {
  return `pdfium_lite_p${page}`;
}

function cloneRect(rect: PdfRect): PdfRect {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
  };
}

function createBlockFromLine(
  line: PdfLayoutLine,
  readingOrder: number,
): ParsedBlock {
  const normalizedText = normalizeText(line.text);
  return {
    id: createParsedBlockId(line.page, readingOrder),
    pageStart: line.page,
    pageEnd: line.page,
    rects: [cloneRect(line.selectionRect)],
    type: 'paragraph',
    rawText: line.text,
    normalizedText,
    readingOrder,
    confidence: normalizedText ? 0.72 : 0.25,
    source: {
      backend: 'pdfium-lite',
      page: line.page,
      lineIds: [line.id],
    },
  };
}

function createPassageFromBlock(
  documentId: string,
  fileHash: string,
  parserVersion: string,
  block: ParsedBlock,
  readingOrder: number,
): CanonicalPassage {
  return {
    id: createCanonicalPassageId(block.pageStart, readingOrder),
    documentId,
    text: block.rawText,
    normalizedText: block.normalizedText,
    blockIds: [block.id],
    pageStart: block.pageStart,
    pageEnd: block.pageEnd,
    evidence: {
      documentId,
      fileHash,
      parserName: 'pdfium-lite',
      parserVersion,
      page: block.pageStart,
      blockIds: [block.id],
      rects: block.rects,
      quote: block.rawText,
    },
  };
}

export function createPdfiumLiteParsedDocument(
  input: PdfiumLiteParsedDocumentInput,
): ParsedDocument {
  const parserVersion = input.parserVersion ?? pdfiumLiteParserVersion;
  const pages: ParsedPage[] = [];
  const blocks: ParsedBlock[] = [];
  const passages: CanonicalPassage[] = [];

  for (const pageInfo of input.pages) {
    const layoutPage = createPdfLayoutPage(pageInfo);
    const pageBlocks = layoutPage.lines
      .map((line, index) => createBlockFromLine(line, index))
      .filter((block) => block.normalizedText);
    const pageText = layoutPage.chars.map((char) => char.char).join('');

    pages.push({
      id: createPageId(pageInfo.page),
      page: pageInfo.page,
      width: pageInfo.pageWidth,
      height: pageInfo.pageHeight,
      text: pageText,
      bbox: {
        x: 0,
        y: 0,
        width: pageInfo.pageWidth,
        height: pageInfo.pageHeight,
      },
      blockIds: pageBlocks.map((block) => block.id),
    });

    for (const block of pageBlocks) {
      blocks.push(block);
      passages.push(createPassageFromBlock(
        input.documentId,
        input.fileHash,
        parserVersion,
        block,
        passages.length,
      ));
    }
  }

  return {
    schemaVersion: 'ls.parsedDocument.v1',
    documentId: input.documentId,
    fileHash: input.fileHash,
    parser: {
      name: 'pdfium-lite',
      version: parserVersion,
      optionsHash: input.optionsHash,
    },
    pages,
    blocks,
    passages,
    assets: [],
    diagnostics: {
      pageCount: pages.length,
      blockCount: blocks.length,
      passageCount: passages.length,
      textCharCount: pages.reduce((count, page) => count + page.text.length, 0),
      parserWarnings: [],
    },
  };
}
