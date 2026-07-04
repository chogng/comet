export type PdfRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PdfTextChar = {
  index: number;
  char: string;
  rect?: PdfRect;
};

export type PdfReviewerPageInfo = {
  page: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  canvas: HTMLCanvasElement;
  highlightLayer: HTMLElement;
  chars: readonly PdfTextChar[];
};

export function pdfRectToViewportRect(
  info: PdfReviewerPageInfo,
  rect: PdfRect,
): PdfRect {
  return {
    x: rect.x * info.scale,
    y: (info.pageHeight - rect.y - rect.height) * info.scale,
    width: rect.width * info.scale,
    height: rect.height * info.scale,
  };
}
