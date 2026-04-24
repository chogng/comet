import { createPdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import type {
  PdfSelection,
  PdfSelectionRange,
} from 'ls/editor/browser/pdf/pdfSelection';
import { pdfRectToViewportRect } from 'ls/editor/browser/pdf/pdfReviewerTypes';
import type {
  PdfReviewerPageInfo,
  PdfTextChar,
} from 'ls/editor/browser/pdf/pdfReviewerTypes';

type PdfSelectionAnchor = {
  page: number;
  charIndex: number;
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
  private anchor: PdfSelectionAnchor | null = null;

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
  }

  private findPageInfoFromEvent(event: PointerEvent) {
    const pageElement = (event.target as Element | null)?.closest?.('.pdf-reader-page');
    if (!(pageElement instanceof HTMLElement)) {
      return null;
    }

    const page = Number(pageElement.dataset.pdfPage);
    return Number.isFinite(page) ? this.pageInfoByPage.get(page) ?? null : null;
  }

  private findNearestChar(info: PdfReviewerPageInfo, event: PointerEvent) {
    const canvasRect = info.canvas.getBoundingClientRect();
    const x = event.clientX - canvasRect.left;
    const y = event.clientY - canvasRect.top;
    let nearest: PdfTextChar | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const char of info.chars) {
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

  private createSelectionFromCharRange(
    info: PdfReviewerPageInfo,
    startCharIndex: number,
    endCharIndex: number,
  ) {
    const start = Math.min(startCharIndex, endCharIndex);
    const end = Math.max(startCharIndex, endCharIndex);
    const chars = info.chars.filter((char) => char.index >= start && char.index <= end);
    if (chars.length === 0) {
      return null;
    }

    return createPdfSelection({
      page: info.page,
      rects: chars.map((char) => char.rect),
      text: chars.map((char) => char.char).join(''),
      textRange: {
        startCharIndex: start,
        endCharIndex: end,
      },
    });
  }

  private createRangeFromCharRange(
    info: PdfReviewerPageInfo,
    startCharIndex: number,
    endCharIndex: number,
  ): PdfSelectionRange | null {
    const start = Math.min(startCharIndex, endCharIndex);
    const end = Math.max(startCharIndex, endCharIndex);
    const chars = info.chars.filter((char) => char.index >= start && char.index <= end);
    if (chars.length === 0) {
      return null;
    }

    return {
      page: info.page,
      rects: chars.map((char) => char.rect),
      text: chars.map((char) => char.char).join(''),
      textRange: {
        startCharIndex: start,
        endCharIndex: end,
      },
    };
  }

  private getPageInfosBetween(anchor: PdfSelectionAnchor, focus: PdfSelectionAnchor) {
    const direction =
      anchor.page < focus.page ||
      (anchor.page === focus.page && anchor.charIndex <= focus.charIndex)
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

  private createSelectionBetween(anchor: PdfSelectionAnchor, focus: PdfSelectionAnchor) {
    if (anchor.page === focus.page) {
      const info = this.pageInfoByPage.get(anchor.page);
      return info
        ? this.createSelectionFromCharRange(info, anchor.charIndex, focus.charIndex)
        : null;
    }

    const { infos, start, end } = this.getPageInfosBetween(anchor, focus);
    const ranges = infos
      .map((info) => {
        const firstCharIndex = info.chars[0]?.index ?? 0;
        const lastCharIndex = info.chars.at(-1)?.index ?? firstCharIndex;
        if (info.page === start.page) {
          return this.createRangeFromCharRange(info, start.charIndex, lastCharIndex);
        }
        if (info.page === end.page) {
          return this.createRangeFromCharRange(info, firstCharIndex, end.charIndex);
        }
        return this.createRangeFromCharRange(info, firstCharIndex, lastCharIndex);
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

    return this.createSelectionFromCharRange(
      info,
      info.chars[startPosition]?.index ?? charIndex,
      info.chars[endPosition]?.index ?? charIndex,
    );
  }

  private readonly handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }

    const info = this.findPageInfoFromEvent(event);
    if (!info || info.chars.length === 0) {
      return;
    }

    const char = this.findNearestChar(info, event);
    if (!char) {
      return;
    }

    event.preventDefault();

    if (event.detail >= 2) {
      this.onSelectionChange(this.createWordSelection(info, char.index));
      return;
    }

    this.anchor = {
      page: info.page,
      charIndex: char.index,
    };
    this.onSelectionChange(
      this.createSelectionFromCharRange(info, char.index, char.index),
    );
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

    const char = this.findNearestChar(info, event);
    if (!char) {
      return;
    }

    this.onSelectionChange(this.createSelectionBetween(this.anchor, {
      page: info.page,
      charIndex: char.index,
    }));
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
