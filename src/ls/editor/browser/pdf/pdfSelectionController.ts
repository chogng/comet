import { createPdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import type {
  PdfSelection,
  PdfSelectionRange,
} from 'ls/editor/browser/pdf/pdfSelection';
import { pdfRectToViewportRect } from 'ls/editor/browser/pdf/pdfReviewerTypes';
import type {
  PdfRect,
  PdfReviewerPageInfo,
  PdfTextChar,
} from 'ls/editor/browser/pdf/pdfReviewerTypes';

type PdfSelectionBoundary = {
  page: number;
  charOffset: number;
};

export type PdfSelectionControllerOptions = {
  pagesElement: HTMLElement;
  pageInfoByPage: ReadonlyMap<number, PdfReviewerPageInfo>;
  onSelectionChange: (selection: PdfSelection | null) => void;
};

export class PdfSelectionController {
  private readonly pagesElement: HTMLElement;
  private readonly pageInfoByPage: ReadonlyMap<number, PdfReviewerPageInfo>;
  private readonly onSelectionChange: (selection: PdfSelection | null) => void;
  private anchor: PdfSelectionBoundary | null = null;

  constructor(options: PdfSelectionControllerOptions) {
    this.pagesElement = options.pagesElement;
    this.pageInfoByPage = options.pageInfoByPage;
    this.onSelectionChange = options.onSelectionChange;
    this.pagesElement.addEventListener('pointerdown', this.handlePointerDown);
  }

  dispose() {
    this.reset();
    this.pagesElement.removeEventListener('pointerdown', this.handlePointerDown);
  }

  reset() {
    this.anchor = null;
    this.pagesElement.removeEventListener('pointermove', this.handlePointerMove);
    this.pagesElement.removeEventListener('pointerup', this.handlePointerUp);
    this.pagesElement.removeEventListener('pointercancel', this.handlePointerUp);
  }

  private findPageInfoFromEvent(event: PointerEvent) {
    const pageElement =
      (event.target as Element | null)?.closest?.('.pdf-reader-page') ??
      document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.pdf-reader-page') ??
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

  private getCanvasLocalPoint(info: PdfReviewerPageInfo, event: PointerEvent) {
    const canvasRect = info.canvas.getBoundingClientRect();
    const cssWidth = Number.parseFloat(info.canvas.style.width) || info.canvas.clientWidth || canvasRect.width;
    const cssHeight = Number.parseFloat(info.canvas.style.height) || info.canvas.clientHeight || canvasRect.height;
    const scaleX = canvasRect.width > 0 ? cssWidth / canvasRect.width : 1;
    const scaleY = canvasRect.height > 0 ? cssHeight / canvasRect.height : 1;
    return {
      x: (event.clientX - canvasRect.left) * scaleX,
      y: (event.clientY - canvasRect.top) * scaleY,
    };
  }

  private findNearestTextBoundary(info: PdfReviewerPageInfo, event: PointerEvent) {
    const { x, y } = this.getCanvasLocalPoint(info, event);
    let nearestBoundary: PdfSelectionBoundary | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (let position = 0; position < info.chars.length; position += 1) {
      const char = info.chars[position];
      if (!char.rect) {
        continue;
      }

      const rect = pdfRectToViewportRect(info, char.rect);
      const centerX = rect.x + rect.width / 2;
      const contains =
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height;
      if (contains) {
        return {
          page: info.page,
          charOffset: position + (x < centerX ? 0 : 1),
        };
      }

      const centerY = rect.y + rect.height / 2;
      const distance = Math.hypot(centerX - x, centerY - y);
      if (distance < nearestDistance) {
        nearestBoundary = {
          page: info.page,
          charOffset: position + (x < centerX ? 0 : 1),
        };
        nearestDistance = distance;
      }
    }

    return nearestBoundary;
  }

  private findNearestTextChar(info: PdfReviewerPageInfo, event: PointerEvent) {
    const { x, y } = this.getCanvasLocalPoint(info, event);
    let nearest: PdfTextChar | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const char of info.chars) {
      if (!char.rect) {
        continue;
      }

      const rect = pdfRectToViewportRect(info, char.rect);
      const contains =
        x >= rect.x &&
        x <= rect.x + rect.width &&
        y >= rect.y &&
        y <= rect.y + rect.height;
      if (contains) {
        return char;
      }

      const centerX = rect.x + rect.width / 2;
      const centerY = rect.y + rect.height / 2;
      const distance = Math.hypot(centerX - x, centerY - y);
      if (distance < nearestDistance) {
        nearest = char;
        nearestDistance = distance;
      }
    }

    return nearest;
  }

  private mergeTextRects(info: PdfReviewerPageInfo, chars: readonly PdfTextChar[]) {
    const rects = chars.flatMap((char) => (char.rect ? [char.rect] : []));
    const mergedRects: PdfRect[] = [];

    for (const rect of rects) {
      const previous = mergedRects.at(-1);
      if (!previous || !this.canMergeTextRects(previous, rect)) {
        mergedRects.push({ ...rect });
        continue;
      }

      const left = Math.min(previous.x, rect.x);
      const bottom = Math.min(previous.y, rect.y);
      const right = Math.max(previous.x + previous.width, rect.x + rect.width);
      const top = Math.max(previous.y + previous.height, rect.y + rect.height);
      previous.x = left;
      previous.y = bottom;
      previous.width = right - left;
      previous.height = top - bottom;
    }

    return mergedRects.map((rect) => this.expandHighlightRect(info, rect));
  }

  private canMergeTextRects(previous: PdfRect, next: PdfRect) {
    const previousCenterY = previous.y + previous.height / 2;
    const nextCenterY = next.y + next.height / 2;
    const lineHeight = Math.max(previous.height, next.height, 1);
    const verticalDistance = Math.abs(previousCenterY - nextCenterY);
    if (verticalDistance > lineHeight * 1.2) {
      return false;
    }

    const gap = next.x - (previous.x + previous.width);
    const generousWordGap = lineHeight * 6;
    return gap >= -lineHeight * 0.35 && gap <= generousWordGap;
  }

  private expandHighlightRect(info: PdfReviewerPageInfo, rect: PdfRect): PdfRect {
    const inset = Math.min(rect.height * 0.12, 1.5 / info.scale);
    return {
      x: rect.x,
      y: Math.max(0, rect.y - inset),
      width: rect.width,
      height: rect.height + inset * 2,
    };
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
    const start = Math.max(0, Math.min(startCharOffset, endCharOffset));
    const end = Math.min(info.chars.length, Math.max(startCharOffset, endCharOffset));
    const chars = info.chars.slice(start, end);
    if (chars.length === 0) {
      return null;
    }

    return {
      page: info.page,
      rects: this.mergeTextRects(info, chars),
      text: chars.map((char) => char.char).join(''),
      textRange: {
        startCharIndex: chars[0]?.index ?? 0,
        endCharIndex: chars.at(-1)?.index ?? chars[0]?.index ?? 0,
      },
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
      return info
        ? this.createSelectionFromOffsets(info, anchor.charOffset, focus.charOffset)
        : null;
    }

    const { infos, start, end } = this.getPageInfosBetween(anchor, focus);
    const ranges = infos
      .map((info) => {
        if (info.page === start.page) {
          return this.createRangeFromOffsets(info, start.charOffset, info.chars.length);
        }
        if (info.page === end.page) {
          return this.createRangeFromOffsets(info, 0, end.charOffset);
        }
        return this.createRangeFromOffsets(info, 0, info.chars.length);
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
      ranges,
    });
  }

  private createWordSelection(info: PdfReviewerPageInfo, charIndex: number) {
    const charPosition = info.chars.findIndex((char) => char.index === charIndex);
    if (charPosition < 0) {
      return null;
    }

    const isWordChar = (value: string) => /[\p{L}\p{N}_-]/u.test(value);
    let startPosition = charPosition;
    let endPosition = charPosition;

    while (
      startPosition > 0 &&
      isWordChar(info.chars[startPosition - 1]?.char ?? '')
    ) {
      startPosition -= 1;
    }

    while (
      endPosition < info.chars.length - 1 &&
      isWordChar(info.chars[endPosition + 1]?.char ?? '')
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

    const boundary = this.findNearestTextBoundary(info, event);
    if (!boundary) {
      return;
    }

    event.preventDefault();

    if (event.detail >= 2) {
      const char = this.findNearestTextChar(info, event);
      if (!char) {
        return;
      }
      this.onSelectionChange(this.createWordSelection(info, char.index));
      return;
    }

    this.anchor = boundary;
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
      return;
    }

    this.onSelectionChange(this.createSelectionBetween(this.anchor, boundary));
  };

  private readonly handlePointerUp = (event: PointerEvent) => {
    this.anchor = null;
    try {
      this.pagesElement.releasePointerCapture(event.pointerId);
    } catch {
      // Ignore capture teardown races when the pointer leaves the reader.
    }
    this.pagesElement.removeEventListener('pointermove', this.handlePointerMove);
  };
}
