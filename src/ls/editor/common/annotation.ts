export type AnnotationTargetKind = 'pdf';

export type AnnotationAnchor = {
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
    startCharIndex?: number;
    endCharIndex?: number;
  }>;
};

export type Annotation = {
  id: string;
  kind: AnnotationTargetKind;
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

