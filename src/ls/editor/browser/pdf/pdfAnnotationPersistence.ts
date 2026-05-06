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
        startCharOffset: typeof range.startCharOffset === 'number'
          ? range.startCharOffset
          : undefined,
        endCharOffset: typeof range.endCharOffset === 'number'
          ? range.endCharOffset
          : undefined,
        startCharIndex: typeof range.startCharIndex === 'number'
          ? range.startCharIndex
          : undefined,
        endCharIndex: typeof range.endCharIndex === 'number'
          ? range.endCharIndex
          : undefined,
        startTextIndex: typeof range.startTextIndex === 'number'
          ? range.startTextIndex
          : undefined,
        endTextIndex: typeof range.endTextIndex === 'number'
          ? range.endTextIndex
          : undefined,
        textSpans: Array.isArray(range.textSpans)
          ? range.textSpans
            .filter((span): span is Record<string, unknown> => isRecord(span))
            .map((span) => ({
              startTextIndex: typeof span.startTextIndex === 'number'
                ? span.startTextIndex
                : 0,
              endTextIndex: typeof span.endTextIndex === 'number'
                ? span.endTextIndex
                : 0,
            }))
            .filter((span) => span.endTextIndex > span.startTextIndex)
          : undefined,
        lineIds: Array.isArray(range.lineIds)
          ? range.lineIds.filter((lineId): lineId is string => typeof lineId === 'string')
          : undefined,
        blockIds: Array.isArray(range.blockIds)
          ? range.blockIds.filter((blockId): blockId is string => typeof blockId === 'string')
          : undefined,
      }))
    : undefined;

  const fingerprint = isRecord(anchor.fingerprint)
    ? {
      beforeText: typeof anchor.fingerprint.beforeText === 'string'
        ? anchor.fingerprint.beforeText
        : undefined,
      afterText: typeof anchor.fingerprint.afterText === 'string'
        ? anchor.fingerprint.afterText
        : undefined,
      pageTextHash: typeof anchor.fingerprint.pageTextHash === 'string'
        ? anchor.fingerprint.pageTextHash
        : undefined,
      layoutVersion: typeof anchor.fingerprint.layoutVersion === 'number'
        ? anchor.fingerprint.layoutVersion
        : undefined,
    }
    : undefined;

  return {
    id: value.id,
    kind: 'pdf',
    mode: value.mode === 'highlight' || value.mode === 'note'
      ? value.mode
      : undefined,
    targetId,
    anchor: {
      anchorVersion: anchor.anchorVersion === 2 ? 2 : anchor.anchorVersion === 1 ? 1 : undefined,
      documentId: typeof anchor.documentId === 'string' ? anchor.documentId : undefined,
      fileHash: typeof anchor.fileHash === 'string' ? anchor.fileHash : undefined,
      parserName: typeof anchor.parserName === 'string' ? anchor.parserName : undefined,
      parserVersion: typeof anchor.parserVersion === 'string' ? anchor.parserVersion : undefined,
      page: anchor.page,
      rects,
      quote: typeof anchor.quote === 'string' ? anchor.quote : undefined,
      ranges,
      fingerprint,
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

