export type PdfSelectionRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfSelectionTextRange = {
  startCharIndex: number;
  endCharIndex: number;
};

export type PdfSelectionTextSpan = {
  startTextIndex: number;
  endTextIndex: number;
};

export type PdfSelectionAnchor = {
  page: number;
  textIndex: number;
  affinity: 'before' | 'after';
};

export type PdfSelectionRange = {
  page: number;
  rects: readonly PdfSelectionRect[];
  text: string;
  startCharOffset?: number;
  endCharOffset?: number;
  lineIds?: readonly string[];
  textRange?: PdfSelectionTextRange;
  textSpans?: readonly PdfSelectionTextSpan[];
};

export type PdfSelectionRangeV2 = {
  page: number;
  startTextIndex: number;
  endTextIndex: number;
  text: string;
  rects: readonly PdfSelectionRect[];
  lineIds?: readonly string[];
};

export type PdfSelection = {
  page: number;
  rects: readonly PdfSelectionRect[];
  text: string;
  textRange?: PdfSelectionTextRange;
  textSpans?: readonly PdfSelectionTextSpan[];
  ranges: readonly PdfSelectionRange[];
};

export function createPdfSelection(params: {
  page: number;
  rects?: readonly PdfSelectionRect[];
  text?: string;
  startCharOffset?: number;
  endCharOffset?: number;
  lineIds?: readonly string[];
  textRange?: PdfSelectionTextRange;
  textSpans?: readonly PdfSelectionTextSpan[];
  ranges?: readonly PdfSelectionRange[];
}): PdfSelection {
  const primaryRange = {
    page: params.page,
    rects: params.rects ?? [],
    text: params.text ?? '',
    startCharOffset: params.startCharOffset,
    endCharOffset: params.endCharOffset,
    lineIds: params.lineIds,
    textRange: params.textRange,
    textSpans: params.textSpans,
  };

  return {
    ...primaryRange,
    ranges: params.ranges ?? [primaryRange],
  };
}

export function isPdfSelectionEmpty(selection: PdfSelection | null | undefined) {
  if (!selection) {
    return true;
  }

  return selection.ranges.every((range) => {
    return range.rects.length === 0 && !range.text.trim();
  });
}

export function toPdfSelectionRangeV2(
  range: PdfSelectionRange,
): PdfSelectionRangeV2 | null {
  const textRange = range.textRange;
  if (!textRange) {
    return null;
  }

  return {
    page: range.page,
    startTextIndex: textRange.startCharIndex,
    // `PdfSelectionTextRange.endCharIndex` is the last selected PDFium char index.
    // V2 uses an exclusive end boundary so it can represent empty and adjacent ranges.
    endTextIndex: textRange.endCharIndex + 1,
    text: range.text,
    rects: range.rects,
    lineIds: range.lineIds,
  };
}
