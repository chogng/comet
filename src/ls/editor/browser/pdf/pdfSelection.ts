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

export type PdfSelectionRange = {
  page: number;
  rects: readonly PdfSelectionRect[];
  text: string;
  textRange?: PdfSelectionTextRange;
};

export type PdfSelection = {
  page: number;
  rects: readonly PdfSelectionRect[];
  text: string;
  textRange?: PdfSelectionTextRange;
  ranges: readonly PdfSelectionRange[];
};

export function createPdfSelection(params: {
  page: number;
  rects?: readonly PdfSelectionRect[];
  text?: string;
  textRange?: PdfSelectionTextRange;
  ranges?: readonly PdfSelectionRange[];
}): PdfSelection {
  const primaryRange = {
    page: params.page,
    rects: params.rects ?? [],
    text: params.text ?? '',
    textRange: params.textRange,
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
