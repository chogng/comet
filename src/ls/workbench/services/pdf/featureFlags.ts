export type PdfFeatureFlagId =
  | 'pdf.selection.v2'
  | 'pdf.annotation.anchorV2'
  | 'pdf.parser.pdfiumLite'
  | 'pdf.parser.lsStructured'
  | 'pdf.rag.indexPdf'
  | 'pdf.rag.evidenceJump'
  | 'pdf.externalArtifactImport';

export type PdfFeatureFlagStage = 'dev-only' | 'behind-flag' | 'default-on';

export type PdfFeatureFlagDefinition = {
  id: PdfFeatureFlagId;
  stage: PdfFeatureFlagStage;
  defaultEnabled: boolean;
  description: string;
};

export const pdfFeatureFlags: readonly PdfFeatureFlagDefinition[] = [
  {
    id: 'pdf.selection.v2',
    stage: 'behind-flag',
    defaultEnabled: true,
    description: 'PDFium text-index selection ranges with PDF-space highlight rects.',
  },
  {
    id: 'pdf.annotation.anchorV2',
    stage: 'behind-flag',
    defaultEnabled: true,
    description: 'Versioned PDF annotation anchors with text-index range metadata.',
  },
  {
    id: 'pdf.parser.pdfiumLite',
    stage: 'behind-flag',
    defaultEnabled: false,
    description: 'Lightweight local PDFium extraction artifact for RAG evidence.',
  },
  {
    id: 'pdf.parser.lsStructured',
    stage: 'dev-only',
    defaultEnabled: false,
    description: 'In-house structured parser pipeline for layout blocks.',
  },
  {
    id: 'pdf.rag.indexPdf',
    stage: 'dev-only',
    defaultEnabled: false,
    description: 'Persisted PDF passage index built from parser artifacts.',
  },
  {
    id: 'pdf.rag.evidenceJump',
    stage: 'dev-only',
    defaultEnabled: false,
    description: 'Jump from a RAG result back to PDF page evidence rects.',
  },
  {
    id: 'pdf.externalArtifactImport',
    stage: 'dev-only',
    defaultEnabled: false,
    description: 'Import user-provided parsed artifact files without executing external tools.',
  },
];

export function getPdfFeatureFlagDefinition(id: PdfFeatureFlagId) {
  return pdfFeatureFlags.find((flag) => flag.id === id) ?? null;
}

export function isPdfFeatureFlagEnabled(
  id: PdfFeatureFlagId,
  overrides: Partial<Record<PdfFeatureFlagId, boolean>> = {},
) {
  return overrides[id] ?? getPdfFeatureFlagDefinition(id)?.defaultEnabled ?? false;
}
