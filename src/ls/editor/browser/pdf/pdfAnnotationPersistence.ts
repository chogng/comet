import type { Annotation } from 'ls/editor/common/annotation';

const PDF_ANNOTATION_STORAGE_PREFIX = 'ls.pdfAnnotations';

function getPdfAnnotationStorageKey(targetId: string) {
  return `${PDF_ANNOTATION_STORAGE_PREFIX}.${targetId}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object';
}

function isAnnotationRangeRecord(
  value: unknown,
): value is Record<string, unknown> & { page: number } {
  return isRecord(value) && typeof value.page === 'number';
}

function normalizeAnnotation(value: unknown, targetId: string): Annotation | null {
  if (!isRecord(value)) {
    return null;
  }

  const anchor = value.anchor;
  if (
    typeof value.id !== 'string' ||
    value.kind !== 'pdf' ||
    typeof value.comment !== 'string' ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string' ||
    !isRecord(anchor) ||
    typeof anchor.page !== 'number' ||
    !Array.isArray(anchor.rects)
  ) {
    return null;
  }

  const rects = anchor.rects
    .filter((rect): rect is Record<string, unknown> => isRecord(rect))
    .map(normalizeRect);

  const ranges = Array.isArray(anchor.ranges)
    ? anchor.ranges
      .filter(isAnnotationRangeRecord)
      .map((range) => ({
        page: range.page,
        rects: Array.isArray(range.rects)
          ? range.rects
            .filter((rect): rect is Record<string, unknown> => isRecord(rect))
            .map(normalizeRect)
          : [],
        quote: typeof range.quote === 'string' ? range.quote : undefined,
        startCharIndex: typeof range.startCharIndex === 'number'
          ? range.startCharIndex
          : undefined,
        endCharIndex: typeof range.endCharIndex === 'number'
          ? range.endCharIndex
          : undefined,
      }))
    : undefined;

  return {
    id: value.id,
    kind: 'pdf',
    targetId,
    anchor: {
      page: anchor.page,
      rects,
      quote: typeof anchor.quote === 'string' ? anchor.quote : undefined,
      ranges,
    },
    comment: value.comment,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function normalizeRect(rect: Record<string, unknown>) {
  return {
    x: typeof rect.x === 'number' ? rect.x : 0,
    y: typeof rect.y === 'number' ? rect.y : 0,
    width: typeof rect.width === 'number' ? rect.width : 0,
    height: typeof rect.height === 'number' ? rect.height : 0,
  };
}

export function readStoredPdfAnnotations(targetId: string): readonly Annotation[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const rawValue = window.localStorage.getItem(getPdfAnnotationStorageKey(targetId));
    if (!rawValue) {
      return [];
    }

    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) {
      return [];
    }

    return parsedValue
      .map((annotation) => normalizeAnnotation(annotation, targetId))
      .filter((annotation): annotation is Annotation => annotation !== null);
  } catch {
    return [];
  }
}

export function writeStoredPdfAnnotations(
  targetId: string,
  annotations: readonly Annotation[],
) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (annotations.length === 0) {
      window.localStorage.removeItem(getPdfAnnotationStorageKey(targetId));
      return;
    }

    window.localStorage.setItem(
      getPdfAnnotationStorageKey(targetId),
      JSON.stringify(annotations),
    );
  } catch {
    // Ignore local storage failures so the PDF surface still works in restricted runtimes.
  }
}

