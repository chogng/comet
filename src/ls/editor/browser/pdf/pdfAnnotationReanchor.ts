import type { Annotation, AnnotationAnchor } from 'ls/editor/common/annotation';
import type { PdfRect } from 'ls/editor/browser/pdf/pdfReviewerTypes';
import {
  createPdfLayoutSelectionRange,
  createPdfLayoutTextIndexSelectionRange,
  type PdfLayoutPage,
} from 'ls/editor/browser/pdf/pdfLayoutModel';

export type PdfResolvedAnnotationRange = {
  page: number;
  rects: readonly PdfRect[];
  quote?: string;
  source: 'text-index' | 'offset' | 'quote' | 'stored';
  rangeIndex: number;
  startCharOffset?: number;
  endCharOffset?: number;
  startCharIndex?: number;
  endCharIndex?: number;
  startTextIndex?: number;
  endTextIndex?: number;
  textSpans?: readonly {
    startTextIndex: number;
    endTextIndex: number;
  }[];
  lineIds?: readonly string[];
};

export const PDF_ANNOTATION_ANCHOR_LAYOUT_VERSION = 1;

type AnnotationAnchorRange = NonNullable<AnnotationAnchor['ranges']>[number];
type PdfLayoutSelectionRangeValue = NonNullable<ReturnType<typeof createPdfLayoutSelectionRange>>;

function mergeResolvedLayoutRanges(
  ranges: readonly PdfLayoutSelectionRangeValue[],
): PdfLayoutSelectionRangeValue | null {
  const first = ranges[0];
  if (!first) {
    return null;
  }

  const textSpans = ranges.flatMap((range) => range.textSpans);
  const startCharOffset = Math.min(...ranges.map((range) => range.startCharOffset));
  const endCharOffset = Math.max(...ranges.map((range) => range.endCharOffset));
  const startCharIndex = Math.min(...ranges.map((range) => range.textRange.startCharIndex));
  const endCharIndex = Math.max(...ranges.map((range) => range.textRange.endCharIndex));
  return {
    page: first.page,
    startCharOffset,
    endCharOffset,
    text: ranges.map((range) => range.text).join(''),
    rects: ranges.flatMap((range) => range.rects),
    lineIds: [...new Set(ranges.flatMap((range) => range.lineIds))],
    textSpans,
    textRange: {
      startCharIndex,
      endCharIndex,
    },
  };
}

function normalizeText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function isQuoteCompatible(actualText: string, quote: string | undefined) {
  if (!quote) {
    return true;
  }

  const normalizedActual = normalizeText(actualText);
  const normalizedQuote = normalizeText(quote);
  return normalizedActual === normalizedQuote || normalizedActual.includes(normalizedQuote);
}

function getPageText(page: PdfLayoutPage) {
  return page.chars.map((char) => char.char).join('');
}

function hashText(value: string) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function getRectRight(rect: PdfRect) {
  return rect.x + rect.width;
}

function getRectTop(rect: PdfRect) {
  return rect.y + rect.height;
}

function unionRects(rects: readonly PdfRect[]) {
  const first = rects[0];
  if (!first) {
    return null;
  }

  let left = first.x;
  let right = getRectRight(first);
  let bottom = first.y;
  let top = getRectTop(first);

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.x);
    right = Math.max(right, getRectRight(rect));
    bottom = Math.min(bottom, rect.y);
    top = Math.max(top, getRectTop(rect));
  }

  return {
    x: left,
    y: bottom,
    width: right - left,
    height: top - bottom,
  };
}

function getRectCenter(rect: PdfRect) {
  return {
    x: rect.x + rect.width / 2,
    y: rect.y + rect.height / 2,
  };
}

function getRectDistance(a: readonly PdfRect[], b: readonly PdfRect[]) {
  const aUnion = unionRects(a);
  const bUnion = unionRects(b);
  if (!aUnion || !bUnion) {
    return Number.POSITIVE_INFINITY;
  }

  const aCenter = getRectCenter(aUnion);
  const bCenter = getRectCenter(bUnion);
  return Math.hypot(aCenter.x - bCenter.x, aCenter.y - bCenter.y);
}

function countLineIdMatches(
  rangeLineIds: readonly string[] | undefined,
  resolvedLineIds: readonly string[],
) {
  if (!rangeLineIds || rangeLineIds.length === 0) {
    return 0;
  }

  const resolvedLineIdSet = new Set(resolvedLineIds);
  return rangeLineIds.reduce((count, lineId) => {
    return count + (resolvedLineIdSet.has(lineId) ? 1 : 0);
  }, 0);
}

function getCharIndexDistance(range: AnnotationAnchorRange, resolvedRange: PdfLayoutSelectionRangeValue) {
  const startDistance = typeof range.startCharIndex === 'number'
    ? Math.abs(range.startCharIndex - resolvedRange.textRange.startCharIndex)
    : 0;
  const endDistance = typeof range.endCharIndex === 'number'
    ? Math.abs(range.endCharIndex - resolvedRange.textRange.endCharIndex)
    : 0;
  return startDistance + endDistance;
}

function createResolvedRange(
  rangeIndex: number,
  resolvedRange: PdfLayoutSelectionRangeValue,
  source: PdfResolvedAnnotationRange['source'],
): PdfResolvedAnnotationRange {
  return {
    page: resolvedRange.page,
    rects: resolvedRange.rects,
    quote: resolvedRange.text,
    source,
    rangeIndex,
    startCharOffset: resolvedRange.startCharOffset,
    endCharOffset: resolvedRange.endCharOffset,
    startCharIndex: resolvedRange.textRange.startCharIndex,
    endCharIndex: resolvedRange.textRange.endCharIndex,
    startTextIndex: resolvedRange.textRange.startCharIndex,
    endTextIndex: resolvedRange.textRange.endCharIndex + 1,
    textSpans: resolvedRange.textSpans,
    lineIds: resolvedRange.lineIds,
  };
}

function resolveRangeByTextIndex(
  page: PdfLayoutPage,
  range: AnnotationAnchorRange,
  rangeIndex: number,
): PdfResolvedAnnotationRange | null {
  if (range.textSpans && range.textSpans.length > 0) {
    const resolvedRanges: PdfLayoutSelectionRangeValue[] = [];
    for (const span of range.textSpans) {
      const resolvedSpan = createPdfLayoutTextIndexSelectionRange(
        page,
        span.startTextIndex,
        span.endTextIndex,
      );
      if (!resolvedSpan) {
        return null;
      }
      resolvedRanges.push(resolvedSpan);
    }

    const resolvedRange = mergeResolvedLayoutRanges(resolvedRanges);
    if (!resolvedRange || !isQuoteCompatible(resolvedRange.text, range.quote)) {
      return null;
    }

    return createResolvedRange(rangeIndex, resolvedRange, 'text-index');
  }

  if (
    typeof range.startTextIndex !== 'number' ||
    typeof range.endTextIndex !== 'number'
  ) {
    return null;
  }

  const resolvedRange = createPdfLayoutTextIndexSelectionRange(
    page,
    range.startTextIndex,
    range.endTextIndex,
  );
  if (!resolvedRange || !isQuoteCompatible(resolvedRange.text, range.quote)) {
    return null;
  }

  return createResolvedRange(rangeIndex, resolvedRange, 'text-index');
}

function resolveRangeByOffset(
  page: PdfLayoutPage,
  range: AnnotationAnchorRange,
  rangeIndex: number,
): PdfResolvedAnnotationRange | null {
  if (
    typeof range.startCharOffset !== 'number' ||
    typeof range.endCharOffset !== 'number'
  ) {
    return null;
  }

  const resolvedRange = createPdfLayoutSelectionRange(
    page,
    range.startCharOffset,
    range.endCharOffset,
  );
  if (!resolvedRange || !isQuoteCompatible(resolvedRange.text, range.quote)) {
    return null;
  }

  return {
    ...createResolvedRange(rangeIndex, resolvedRange, 'offset'),
  };
}

function resolveRangeByQuote(
  page: PdfLayoutPage,
  range: AnnotationAnchorRange,
  quote: string | undefined,
  rangeIndex: number,
): PdfResolvedAnnotationRange | null {
  if (!quote) {
    return null;
  }

  const pageText = getPageText(page);
  let bestCandidate: {
    range: NonNullable<ReturnType<typeof createPdfLayoutSelectionRange>>;
    lineMatchCount: number;
    charIndexDistance: number;
    rectDistance: number;
    startCharOffset: number;
  } | null = null;
  let startCharOffset = pageText.indexOf(quote);

  while (startCharOffset >= 0) {
    const resolvedRange = createPdfLayoutSelectionRange(
      page,
      startCharOffset,
      startCharOffset + quote.length,
    );
    if (resolvedRange) {
      const candidate = {
        range: resolvedRange,
        lineMatchCount: countLineIdMatches(range.lineIds, resolvedRange.lineIds),
        charIndexDistance: getCharIndexDistance(range, resolvedRange),
        rectDistance: getRectDistance(range.rects, resolvedRange.rects),
        startCharOffset,
      };

      if (
        !bestCandidate ||
        candidate.lineMatchCount > bestCandidate.lineMatchCount ||
        (
          candidate.lineMatchCount === bestCandidate.lineMatchCount &&
          candidate.rectDistance < bestCandidate.rectDistance
        ) ||
        (
          candidate.lineMatchCount === bestCandidate.lineMatchCount &&
          candidate.rectDistance === bestCandidate.rectDistance &&
          candidate.charIndexDistance < bestCandidate.charIndexDistance
        ) ||
        (
          candidate.lineMatchCount === bestCandidate.lineMatchCount &&
          candidate.rectDistance === bestCandidate.rectDistance &&
          candidate.charIndexDistance === bestCandidate.charIndexDistance &&
          candidate.startCharOffset < bestCandidate.startCharOffset
        )
      ) {
        bestCandidate = candidate;
      }
    }

    startCharOffset = pageText.indexOf(quote, startCharOffset + 1);
  }

  if (!bestCandidate) {
    return null;
  }

  return {
    ...createResolvedRange(rangeIndex, bestCandidate.range, 'quote'),
  };
}

function createLegacyRange(annotation: Annotation): AnnotationAnchorRange {
  return {
    page: annotation.anchor.page,
    rects: annotation.anchor.rects,
    quote: annotation.anchor.quote,
  };
}

function createAnchorRanges(annotation: Annotation): readonly AnnotationAnchorRange[] {
  return annotation.anchor.ranges ?? [createLegacyRange(annotation)];
}

function getFingerprintWindow(pageText: string, startCharOffset: number, endCharOffset: number) {
  const beforeStart = Math.max(0, startCharOffset - 32);
  const afterEnd = Math.min(pageText.length, endCharOffset + 32);
  return {
    beforeText: pageText.slice(beforeStart, startCharOffset),
    afterText: pageText.slice(endCharOffset, afterEnd),
  };
}

function createFingerprint(
  page: PdfLayoutPage,
  resolvedRange: PdfResolvedAnnotationRange,
): NonNullable<AnnotationAnchor['fingerprint']> | undefined {
  if (
    typeof resolvedRange.startCharOffset !== 'number' ||
    typeof resolvedRange.endCharOffset !== 'number'
  ) {
    return undefined;
  }

  const pageText = getPageText(page);
  const { beforeText, afterText } = getFingerprintWindow(
    pageText,
    resolvedRange.startCharOffset,
    resolvedRange.endCharOffset,
  );
  return {
    beforeText,
    afterText,
    pageTextHash: hashText(pageText),
    layoutVersion: PDF_ANNOTATION_ANCHOR_LAYOUT_VERSION,
  };
}

function hasV2RangeAnchor(range: AnnotationAnchorRange) {
  return (
    typeof range.startTextIndex === 'number' &&
    typeof range.endTextIndex === 'number' &&
    typeof range.startCharOffset === 'number' &&
    typeof range.endCharOffset === 'number'
  );
}

function areAnchorsEqual(a: AnnotationAnchor, b: AnnotationAnchor) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function areRangesEqual(a: AnnotationAnchorRange, b: AnnotationAnchorRange) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function resolvePdfAnnotationRangesForPage(
  annotation: Annotation,
  page: PdfLayoutPage,
): readonly PdfResolvedAnnotationRange[] {
  const ranges = createAnchorRanges(annotation);
  const resolvedRanges: PdfResolvedAnnotationRange[] = [];

  for (const [rangeIndex, range] of ranges.entries()) {
    if (range.page !== page.page) {
      continue;
    }

    const resolvedByTextIndex = resolveRangeByTextIndex(page, range, rangeIndex);
    if (resolvedByTextIndex) {
      resolvedRanges.push(resolvedByTextIndex);
      continue;
    }

    const resolvedByOffset = resolveRangeByOffset(page, range, rangeIndex);
    if (resolvedByOffset) {
      resolvedRanges.push(resolvedByOffset);
      continue;
    }

    const resolvedByQuote = resolveRangeByQuote(
      page,
      range,
      range.quote ?? annotation.anchor.quote,
      rangeIndex,
    );
    if (resolvedByQuote) {
      resolvedRanges.push(resolvedByQuote);
      continue;
    }

    resolvedRanges.push({
      page: range.page,
      rects: range.rects,
      quote: range.quote,
      source: 'stored',
      rangeIndex,
    });
  }

  return resolvedRanges;
}

export function createV2PdfAnnotationFromResolvedRangesForPage(
  annotation: Annotation,
  page: PdfLayoutPage,
  resolvedRanges: readonly PdfResolvedAnnotationRange[],
): Annotation | null {
  const successfulRanges = resolvedRanges.filter((range) => range.source !== 'stored');
  if (successfulRanges.length === 0) {
    return null;
  }

  const existingRanges = createAnchorRanges(annotation);
  const resolvedRangeByIndex = new Map(
    successfulRanges.map((range) => [range.rangeIndex, range]),
  );
  let didChangeRange = annotation.anchor.ranges === undefined;
  const nextRanges = existingRanges.map((range, index): AnnotationAnchorRange => {
    const resolvedRange = resolvedRangeByIndex.get(index);
    if (!resolvedRange) {
      return range;
    }

    const nextRange: AnnotationAnchorRange = {
      ...range,
      page: resolvedRange.page,
      rects: range.rects.length > 0 ? range.rects : resolvedRange.rects,
      quote: range.quote ?? resolvedRange.quote,
      startCharOffset: resolvedRange.startCharOffset,
      endCharOffset: resolvedRange.endCharOffset,
      startCharIndex: resolvedRange.startCharIndex,
      endCharIndex: resolvedRange.endCharIndex,
      startTextIndex: resolvedRange.startTextIndex,
      endTextIndex: resolvedRange.endTextIndex,
      textSpans: resolvedRange.textSpans,
      lineIds: resolvedRange.lineIds,
    };

    if (!hasV2RangeAnchor(range) || !areRangesEqual(range, nextRange)) {
      didChangeRange = true;
    }

    return nextRange;
  });

  const primaryResolvedRange =
    successfulRanges.find((range) => range.page === annotation.anchor.page) ?? successfulRanges[0];
  const fingerprint = primaryResolvedRange
    ? createFingerprint(page, primaryResolvedRange)
    : annotation.anchor.fingerprint;
  const nextAnchor: AnnotationAnchor = {
    ...annotation.anchor,
    anchorVersion: 2,
    ranges: nextRanges,
    fingerprint: fingerprint ?? annotation.anchor.fingerprint,
  };

  if (
    annotation.anchor.anchorVersion !== 2 ||
    !annotation.anchor.fingerprint ||
    didChangeRange
  ) {
    return areAnchorsEqual(annotation.anchor, nextAnchor)
      ? null
      : {
        ...annotation,
        anchor: nextAnchor,
      };
  }

  return null;
}
