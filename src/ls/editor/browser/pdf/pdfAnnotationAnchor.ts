import type { AnnotationAnchor } from 'ls/editor/common/annotation';
import type {
  PdfSelection,
  PdfSelectionRange,
} from 'ls/editor/browser/pdf/pdfSelection';
import { toPdfSelectionRangeV2 } from 'ls/editor/browser/pdf/pdfSelection';

function createAnchorRange(range: PdfSelectionRange): NonNullable<AnnotationAnchor['ranges']>[number] {
  const rangeV2 = toPdfSelectionRangeV2(range);
  return {
    page: range.page,
    rects: range.rects,
    quote: range.text,
    startCharOffset: range.startCharOffset,
    endCharOffset: range.endCharOffset,
    startCharIndex: range.textRange?.startCharIndex,
    endCharIndex: range.textRange?.endCharIndex,
    startTextIndex: rangeV2?.startTextIndex,
    endTextIndex: rangeV2?.endTextIndex,
    textSpans: range.textSpans,
    lineIds: range.lineIds,
  };
}

export function createPdfAnnotationAnchorFromSelection(
  selection: PdfSelection,
): AnnotationAnchor {
  const ranges = selection.ranges.map(createAnchorRange);
  return {
    anchorVersion: 2,
    page: selection.page,
    rects: selection.rects,
    quote: selection.text,
    ranges,
  };
}
