import { createPdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import type {
  PdfSelection,
  PdfSelectionRange,
} from 'ls/editor/browser/pdf/pdfSelection';
import {
  createPdfLayoutPage,
  createPdfLayoutSelectionRange,
  findPdfTextBoundaryAtPoint,
  findPdfTextCharAtPoint,
  findPdfTextHitTestAtPoint,
  viewportPointToPdfPoint,
} from 'ls/editor/browser/pdf/pdfLayoutModel';
import type {
  PdfLayoutPage,
} from 'ls/editor/browser/pdf/pdfLayoutModel';
import type {
  PdfReviewerPageInfo,
} from 'ls/editor/browser/pdf/pdfReviewerTypes';

type PdfSelectionBoundary = {
  page: number;
  charOffset: number;
};

export type PdfSelectionControllerOptions = {
  pagesElement: HTMLElement;
  pageInfoByPage: ReadonlyMap<number, PdfReviewerPageInfo>;
  onSelectionChange: (selection: PdfSelection | null) => void;
  onHitTestStatusChange?: (status: PdfSelectionHitTestStatus | null) => void;
  onSelectionDragChange?: (isDragging: boolean) => void;
};

export type PdfSelectionHitTestStatus = {
  page: number;
  lineIndex: number;
  lineId: string;
  charOffset: number;
  pdfX: number;
  pdfY: number;
  lineDeltaY: number;
  text: string;
};

export class PdfSelectionController {
  private readonly pagesElement: HTMLElement;
  private readonly pageInfoByPage: ReadonlyMap<number, PdfReviewerPageInfo>;
  private readonly onSelectionChange: (selection: PdfSelection | null) => void;
  private readonly onHitTestStatusChange?: (status: PdfSelectionHitTestStatus | null) => void;
  private readonly onSelectionDragChange?: (isDragging: boolean) => void;
  private readonly layoutPageByInfo = new WeakMap<PdfReviewerPageInfo, PdfLayoutPage>();
  private anchor: PdfSelectionBoundary | null = null;
  private isDraggingSelection = false;

  constructor(options: PdfSelectionControllerOptions) {
    this.pagesElement = options.pagesElement;
    this.pageInfoByPage = options.pageInfoByPage;
    this.onSelectionChange = options.onSelectionChange;
    this.onHitTestStatusChange = options.onHitTestStatusChange;
    this.onSelectionDragChange = options.onSelectionDragChange;
    this.pagesElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  dispose() {
    this.reset();
    this.pagesElement.removeEventListener('pointerdown', this.handlePointerDown);
  }

  reset() {
    this.anchor = null;
    this.setSelectionDragActive(false);
    this.onHitTestStatusChange?.(null);
    this.pagesElement.removeEventListener('pointermove', this.handlePointerMove);
    this.pagesElement.removeEventListener('pointerup', this.handlePointerUp);
    this.pagesElement.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private setSelectionDragActive(isDraggingSelection: boolean) {
    if (this.isDraggingSelection === isDraggingSelection) {
      return;
    }

    this.isDraggingSelection = isDraggingSelection;
    this.onSelectionDragChange?.(isDraggingSelection);
  }

  private findPageInfoFromEvent(event: PointerEvent) {
    const pageElement =
      (event.target as Element | null)?.closest?.('.pdf-reader-page') ??
      document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('.pdf-reader-page') ??
      this.findNearestPageElement(event);
    if (!(pageElement instanceof HTMLElement)) {
      return null;
    }

    const page = Number(pageElement.dataset.pdfPage);
    return Number.isFinite(page) ? this.pageInfoByPage.get(page) ?? null : null;
  }

  private findNearestPageElement(event: PointerEvent) {
    let nearestPageElement: HTMLElement | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;
    const pageElements = this.pagesElement.querySelectorAll<HTMLElement>('.pdf-reader-page');

    for (const pageElement of pageElements) {
      const rect = pageElement.getBoundingClientRect();
      const clampedX = Math.min(Math.max(event.clientX, rect.left), rect.right);
      const clampedY = Math.min(Math.max(event.clientY, rect.top), rect.bottom);
      const distance = Math.hypot(event.clientX - clampedX, event.clientY - clampedY);
      if (distance < nearestDistance) {
        nearestPageElement = pageElement;
        nearestDistance = distance;
      }
    }

    return nearestPageElement;
  }

  private getPageLocalElement(info: PdfReviewerPageInfo) {
    if (info.canvas.isConnected) {
      return info.canvas;
    }

    return info.highlightLayer.parentElement instanceof HTMLElement
      ? info.highlightLayer.parentElement
      : info.highlightLayer;
  }

  private getCanvasLocalPoint(info: PdfReviewerPageInfo, event: PointerEvent) {
    const localElement = this.getPageLocalElement(info);
    const localRect = localElement.getBoundingClientRect();
    const cssWidth = Number.parseFloat(localElement.style.width) || localElement.clientWidth || localRect.width;
    const cssHeight = Number.parseFloat(localElement.style.height) || localElement.clientHeight || localRect.height;
    const scaleX = localRect.width > 0 ? cssWidth / localRect.width : 1;
    const scaleY = localRect.height > 0 ? cssHeight / localRect.height : 1;
    return {
      x: (event.clientX - localRect.left) * scaleX,
      y: (event.clientY - localRect.top) * scaleY,
    };
  }

  private getLayoutPage(info: PdfReviewerPageInfo) {
    let layoutPage = this.layoutPageByInfo.get(info);
    if (!layoutPage) {
      layoutPage = createPdfLayoutPage(info);
      this.layoutPageByInfo.set(info, layoutPage);
    }

    return layoutPage;
  }

  private getPdfPoint(info: PdfReviewerPageInfo, event: PointerEvent) {
    return viewportPointToPdfPoint(
      this.getLayoutPage(info),
      info.scale,
      this.getCanvasLocalPoint(info, event),
    );
  }

  private findNearestTextBoundary(
    info: PdfReviewerPageInfo,
    event: PointerEvent,
    options: { strict?: boolean } = {},
  ) {
    return findPdfTextBoundaryAtPoint(
      this.getLayoutPage(info),
      this.getPdfPoint(info, event),
      options,
    );
  }

  private findNearestTextChar(info: PdfReviewerPageInfo, event: PointerEvent) {
    return findPdfTextCharAtPoint(
      this.getLayoutPage(info),
      this.getPdfPoint(info, event),
      { strict: true },
    );
  }

  private updateHitTestStatus(
    info: PdfReviewerPageInfo,
    event: PointerEvent,
    options: { strict?: boolean } = {},
  ) {
    const pdfPoint = this.getPdfPoint(info, event);
    const hitTest = findPdfTextHitTestAtPoint(
      this.getLayoutPage(info),
      pdfPoint,
      options,
    );
    if (!hitTest) {
      this.onHitTestStatusChange?.(null);
      return;
    }

    this.onHitTestStatusChange?.({
      page: hitTest.page,
      lineIndex: hitTest.lineIndex,
      lineId: hitTest.lineId,
      charOffset: hitTest.charOffset,
      pdfX: hitTest.point.x,
      pdfY: hitTest.point.y,
      lineDeltaY: hitTest.point.y - hitTest.lineCenterY,
      text: hitTest.lineText.trim().slice(0, 80),
    });
  }

  private createSelectionFromOffsets(
    info: PdfReviewerPageInfo,
    startCharOffset: number,
    endCharOffset: number,
  ) {
    const range = this.createRangeFromOffsets(info, startCharOffset, endCharOffset);
    if (!range) {
      return null;
    }

    return createPdfSelection(range);
  }

  private createRangeFromOffsets(
    info: PdfReviewerPageInfo,
    startCharOffset: number,
    endCharOffset: number,
  ): PdfSelectionRange | null {
    const range = createPdfLayoutSelectionRange(
      this.getLayoutPage(info),
      startCharOffset,
      endCharOffset,
    );
    if (!range) {
      return null;
    }

    return {
      page: info.page,
      rects: range.rects,
      text: range.text,
      startCharOffset: range.startCharOffset,
      endCharOffset: range.endCharOffset,
      lineIds: range.lineIds,
      textRange: range.textRange,
      textSpans: range.textSpans,
    };
  }

  private getPageInfosBetween(anchor: PdfSelectionBoundary, focus: PdfSelectionBoundary) {
    const direction =
      anchor.page < focus.page ||
      (anchor.page === focus.page && anchor.charOffset <= focus.charOffset)
        ? 1
        : -1;
    const start = direction === 1 ? anchor : focus;
    const end = direction === 1 ? focus : anchor;
    const infos: PdfReviewerPageInfo[] = [];

    for (let page = start.page; page <= end.page; page += 1) {
      const info = this.pageInfoByPage.get(page);
      if (info) {
        infos.push(info);
      }
    }

    return { infos, start, end };
  }

  private createSelectionBetween(anchor: PdfSelectionBoundary, focus: PdfSelectionBoundary) {
    if (anchor.page === focus.page) {
      const info = this.pageInfoByPage.get(anchor.page);
      if (!info) {
        return null;
      }

      const range = this.createRangeFromOffsets(info, anchor.charOffset, focus.charOffset);
      return range ? createPdfSelection(range) : null;
    }

    const { infos, start, end } = this.getPageInfosBetween(anchor, focus);
    const ranges = infos
      .map((info) => {
        if (info.page === start.page) {
          return this.createRangeFromOffsets(info, start.charOffset, this.getLayoutPage(info).chars.length);
        }
        if (info.page === end.page) {
          return this.createRangeFromOffsets(info, 0, end.charOffset);
        }
        return this.createRangeFromOffsets(info, 0, this.getLayoutPage(info).chars.length);
      })
      .filter((range): range is PdfSelectionRange => range !== null);

    const primaryRange = ranges[0];
    if (!primaryRange) {
      return null;
    }

    return createPdfSelection({
      page: primaryRange.page,
      rects: primaryRange.rects,
      text: ranges.map((range) => range.text).join('\n'),
      textRange: primaryRange.textRange,
      textSpans: primaryRange.textSpans,
      ranges,
    });
  }

  private createWordSelection(info: PdfReviewerPageInfo, charIndex: number) {
    const layoutChars = this.getLayoutPage(info).chars;
    const charPosition = layoutChars.findIndex((char) => char.index === charIndex);
    if (charPosition < 0) {
      return null;
    }

    const isWordChar = (value: string) => /[\p{L}\p{N}_-]/u.test(value);
    let startPosition = charPosition;
    let endPosition = charPosition;

    while (
      startPosition > 0 &&
      isWordChar(layoutChars[startPosition - 1]?.char ?? '')
    ) {
      startPosition -= 1;
    }

    while (
      endPosition < layoutChars.length - 1 &&
      isWordChar(layoutChars[endPosition + 1]?.char ?? '')
    ) {
      endPosition += 1;
    }

    return this.createSelectionFromOffsets(info, startPosition, endPosition + 1);
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    const info = this.findPageInfoFromEvent(event);
    if (!info || info.chars.length === 0) {
      return;
    }

    const boundary = this.findNearestTextBoundary(info, event, { strict: true });
    if (!boundary) {
      this.onHitTestStatusChange?.(null);
      return;
    }

    event.preventDefault();
    this.updateHitTestStatus(info, event, { strict: true });

    if (event.detail >= 2) {
      const char = this.findNearestTextChar(info, event);
      if (!char) {
        return;
      }
      this.onSelectionChange(this.createWordSelection(info, char.index));
      return;
    }

    this.anchor = boundary;
    this.setSelectionDragActive(true);
    this.onSelectionChange(null);
    try {
      this.pagesElement.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in smoke tests may not create a capture target.
    }
    this.pagesElement.addEventListener('pointermove', this.handlePointerMove);
    this.pagesElement.addEventListener('pointerup', this.handlePointerUp, { once: true });
    this.pagesElement.addEventListener('pointercancel', this.handlePointerUp, { once: true });
  };

  private readonly handlePointerMove = (event: PointerEvent) => {
    if (!this.anchor) {
      return;
    }

    const info = this.findPageInfoFromEvent(event);
    if (!info) {
      return;
    }

    const boundary = this.findNearestTextBoundary(info, event);
    if (!boundary) {
      this.onHitTestStatusChange?.(null);
      return;
    }

    this.updateHitTestStatus(info, event);
    this.onSelectionChange(this.createSelectionBetween(this.anchor, boundary));
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    const anchor = this.anchor;
    if (anchor) {
      const info = this.findPageInfoFromEvent(event);
      const boundary = info
        ? this.findNearestTextBoundary(info, event)
        : null;
      if (boundary) {
        this.updateHitTestStatus(info!, event);
        this.onSelectionChange(this.createSelectionBetween(anchor, boundary));
      }
    }

    this.anchor = null;
    this.setSelectionDragActive(false);
    try {
      this.pagesElement.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore capture teardown races when the pointer leaves the reader.
    }
    this.pagesElement.removeEventListener('pointermove', this.handlePointerMove);
    this.pagesElement.removeEventListener('pointerup', this.handlePointerUp);
    this.pagesElement.removeEventListener('pointercancel', this.handlePointerUp);
  };
}
