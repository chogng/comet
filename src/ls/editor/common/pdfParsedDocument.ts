export type PdfArtifactSchemaVersion = 'ls.parsedDocument.v1';

export type PdfParserName = 'pdfium-lite' | 'ls-structured' | 'manual' | 'external-artifact-import';

export type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ParsedDocument = {
  schemaVersion: PdfArtifactSchemaVersion;
  documentId: string;
  fileHash: string;
  parser: {
    name: PdfParserName;
    version: string;
    optionsHash?: string;
  };
  pages: readonly ParsedPage[];
  blocks: readonly ParsedBlock[];
  passages: readonly CanonicalPassage[];
  assets: readonly ParsedAsset[];
  diagnostics: ParsedDocumentDiagnostics;
};

export type ParsedPage = {
  id: string;
  page: number;
  width: number;
  height: number;
  text: string;
  bbox: PdfRect;
  blockIds: readonly string[];
};

export type ParsedBlockType =
  | 'title'
  | 'paragraph'
  | 'list'
  | 'table'
  | 'formula'
  | 'figure'
  | 'caption'
  | 'reference'
  | 'footnote'
  | 'unknown';

export type ParsedBlock = {
  id: string;
  pageStart: number;
  pageEnd: number;
  rects: readonly PdfRect[];
  type: ParsedBlockType;
  rawText: string;
  normalizedText: string;
  readingOrder: number;
  confidence: number;
  source: {
    backend: PdfParserName;
    page: number;
    lineIds?: readonly string[];
  };
};

export type ParsedAsset = {
  id: string;
  page: number;
  type: 'image' | 'table' | 'formula' | 'other';
  rects: readonly PdfRect[];
  sourceBlockIds: readonly string[];
};

export type EvidencePointer = {
  documentId: string;
  fileHash: string;
  parserName: PdfParserName;
  parserVersion: string;
  page: number;
  blockIds: readonly string[];
  rects: readonly PdfRect[];
  quote: string;
};

export type CanonicalPassage = {
  id: string;
  documentId: string;
  text: string;
  normalizedText: string;
  blockIds: readonly string[];
  pageStart: number;
  pageEnd: number;
  evidence: EvidencePointer;
};

export type ParsedDocumentDiagnostics = {
  pageCount: number;
  blockCount: number;
  passageCount: number;
  textCharCount: number;
  parserWarnings: readonly string[];
};

export function createParsedBlockId(page: number, readingOrder: number) {
  return `pdfium_lite_p${page}_b${readingOrder + 1}`;
}

export function createCanonicalPassageId(page: number, readingOrder: number) {
  return `pdfium_lite_p${page}_passage${readingOrder + 1}`;
}
