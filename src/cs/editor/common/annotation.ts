export type AnnotationTargetKind = 'pdf';

export type AnnotationAnchor = {
  anchorVersion?: 1 | 2;
  documentId?: string;
  fileHash?: string;
  parserName?: string;
  parserVersion?: string;
  page: number;
  rects: ReadonlyArray<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
  quote?: string;
  ranges?: ReadonlyArray<{
    page: number;
    rects: ReadonlyArray<{
      x: number;
      y: number;
      width: number;
      height: number;
    }>;
    quote?: string;
    startCharOffset?: number;
    endCharOffset?: number;
    startCharIndex?: number;
    endCharIndex?: number;
    startTextIndex?: number;
    endTextIndex?: number;
    textSpans?: ReadonlyArray<{
      startTextIndex: number;
      endTextIndex: number;
    }>;
    lineIds?: readonly string[];
    blockIds?: readonly string[];
  }>;
  fingerprint?: {
    beforeText?: string;
    afterText?: string;
    pageTextHash?: string;
    layoutVersion?: number;
  };
};

export type Annotation = {
  id: string;
  kind: AnnotationTargetKind;
  mode?: 'highlight' | 'note';
  targetId: string;
  anchor: AnnotationAnchor;
  comment: string;
  createdAt: string;
  updatedAt: string;
};

export function createAnnotationId(prefix = 'annotation') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
  }

  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

