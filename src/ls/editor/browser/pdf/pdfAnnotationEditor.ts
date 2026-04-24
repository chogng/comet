import { createAnnotationId } from 'ls/editor/common/annotation';
import type { Annotation } from 'ls/editor/common/annotation';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import { PdfAnnotationStore } from 'ls/editor/browser/pdf/pdfAnnotationStore';
import type { PdfAnnotationStoreSnapshot } from 'ls/editor/browser/pdf/pdfAnnotationStore';
import { isPdfSelectionEmpty } from 'ls/editor/browser/pdf/pdfSelection';
import type { PdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import { PdfSelectionController } from 'ls/editor/browser/pdf/pdfSelectionController';
import { pdfRectToViewportRect } from 'ls/editor/browser/pdf/pdfReviewerTypes';
import type {
  PdfRect,
  PdfReviewerPageInfo,
  PdfTextChar,
} from 'ls/editor/browser/pdf/pdfReviewerTypes';
import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostService';
import { init as initPdfium } from 'ls/editor/browser/pdf/vendor/pdfium/index.js';
import type { WrappedPdfiumModule } from 'ls/editor/browser/pdf/vendor/pdfium/index.js';

import 'ls/editor/browser/pdf/media/pdfAnnotationEditor.css';

export type PdfAnnotationEditorLabels = {
  title: string;
  emptyState: string;
  openPdfFile?: string;
};

export type PdfAnnotationEditorProps = {
  url: string;
  targetId: string;
  annotationTargetId?: string;
  labels: PdfAnnotationEditorLabels;
  viewPartProps: ViewPartProps;
  annotations?: readonly Annotation[];
  selection?: PdfSelection | null;
  onAnnotationsChange?: (annotations: readonly Annotation[]) => void;
  onViewStateChange?: (viewState: PdfAnnotationEditorViewState) => void;
  onReaderStatusChange?: (status: PdfReaderRuntimeStatus) => void;
  onOpenPdfFile?: () => void | Promise<void>;
};

export type PdfAnnotationEditorViewState = Pick<
  PdfAnnotationStoreSnapshot,
  'selection' | 'draftComment'
>;

export type PdfReaderRuntimeStatus = {
  state: 'idle' | 'loading' | 'ready' | 'error';
  message: string;
  detail?: string;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

type PdfiumDocumentHandle = {
  pdfium: PdfiumModuleWithHeap;
  documentPtr: number;
  filePtr: number;
  pageCount: number;
};

type PdfiumModuleWithHeap = WrappedPdfiumModule & {
  pdfium: WrappedPdfiumModule['pdfium'] & {
    HEAPU8: Uint8Array;
  };
};

const PDF_READER_MIN_ZOOM = 0.4;
const PDF_READER_MAX_ZOOM = 3;
const PDF_READER_ZOOM_STEP = 0.1;
const PDF_READER_ZOOM_RENDER_DELAY_MS = 120;

let pdfiumModulePromise: Promise<PdfiumModuleWithHeap> | null = null;
const pdfiumWasmUrl = new URL(
  './vendor/pdfium/pdfium.wasm',
  import.meta.url,
).toString();

async function loadPdfiumModule() {
  pdfiumModulePromise ??= fetch(pdfiumWasmUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load PDFium WASM: ${response.status} ${response.statusText}`);
      }

      return await response.arrayBuffer();
    })
    .then(async (wasmBinary) => {
      const pdfium = await initPdfium({ wasmBinary });
      pdfium.PDFiumExt_Init();
      return pdfium as PdfiumModuleWithHeap;
    });

  return await pdfiumModulePromise;
}

function isFilePdfUrl(url: string) {
  try {
    return new URL(url).protocol === 'file:';
  } catch {
    return false;
  }
}

function normalizePdfError(error: unknown) {
  if (error instanceof Error) {
    const details: string[] = [];
    if (error.name && error.name !== 'Error') {
      details.push(error.name);
    }
    if (error.message) {
      details.push(error.message);
    }
    const errorWithCode = error as Error & {
      code?: string;
      details?: Record<string, unknown>;
    };
    if (errorWithCode.code) {
      details.push(`code=${errorWithCode.code}`);
    }
    if (errorWithCode.details) {
      details.push(`details=${JSON.stringify(errorWithCode.details)}`);
    }
    return details.join(' | ') || String(error);
  }

  return String(error);
}

export class PdfAnnotationEditor {
  private props: PdfAnnotationEditorProps;
  private readonly element = createElement('div', 'pdf-annotation-editor');
  private readonly surfaceElement = createElement('div', 'pdf-annotation-surface');
  private readonly readerElement = createElement('div', 'pdf-reader-view');
  private readonly pagesElement = createElement('div', 'pdf-reader-pages');
  private readonly loadingElement = createElement('div', 'pdf-reader-status');
  private readonly unavailableElement = createElement(
    'div',
    'empty-state webcontent-runtime-warning pdf-reader-unavailable',
  );
  private readonly emptyOpenElement = createElement('div', 'pdf-annotation-open-empty');
  private readonly openPdfButton = createElement('button', 'pdf-annotation-open-btn');
  private readonly overlayElement = createElement('div', 'pdf-annotation-overlay');
  private readonly badgeElement = createElement('div', 'pdf-annotation-badge');
  private readonly hintElement = createElement('div', 'pdf-annotation-hint');
  private readonly draftSectionElement = createElement('div', 'pdf-annotation-draft');
  private readonly draftMetaElement = createElement('div', 'pdf-annotation-meta');
  private readonly draftTextElement = document.createElement('textarea');
  private readonly actionRowElement = createElement('div', 'pdf-annotation-actions');
  private readonly captureSelectionButton = createElement('button', 'pdf-annotation-btn');
  private readonly saveAnnotationButton = createElement('button', 'pdf-annotation-btn is-primary');
  private readonly listElement = createElement('div', 'pdf-annotation-list');
  private readonly store = new PdfAnnotationStore();
  private readonly unsubscribeStore: () => void;
  private renderedUrl = '';
  private loadVersion = 0;
  private pageRenderVersion = 0;
  private zoomScale = 1;
  private renderedZoomScale = 1;
  private zoomRenderTimer: number | null = null;
  private documentHandle: PdfiumDocumentHandle | null = null;
  private readonly pageRenderInfoByPage = new Map<number, PdfReviewerPageInfo>();
  private readonly selectionController = new PdfSelectionController({
    pagesElement: this.pagesElement,
    pageInfoByPage: this.pageRenderInfoByPage,
    onSelectionChange: (selection) => this.store.setSelection(selection),
  });
  private readerStatus: PdfReaderRuntimeStatus = {
    state: 'idle',
    message: 'No PDF loaded',
  };

  constructor(props: PdfAnnotationEditorProps) {
    this.props = props;
    this.unsubscribeStore = this.store.subscribe(() => {
      this.renderOverlay();
      this.props.onViewStateChange?.(this.getViewState());
    });
    this.element.tabIndex = 0;
    this.element.addEventListener('keydown', this.handleKeyDown);
    this.element.addEventListener('pointerdown', this.handlePointerFocus, true);
    this.pagesElement.addEventListener('wheel', this.handleWheel, { passive: false });
    this.loadingElement.textContent = 'Loading PDF...';
    this.draftTextElement.className = 'pdf-annotation-textarea';
    this.draftTextElement.rows = 3;
    this.draftTextElement.placeholder = 'Annotation comment';
    this.draftTextElement.addEventListener('input', this.handleDraftCommentInput);
    this.captureSelectionButton.type = 'button';
    this.captureSelectionButton.textContent = 'Use Selection';
    this.captureSelectionButton.addEventListener('click', this.handleCaptureSelection);
    this.openPdfButton.type = 'button';
    this.openPdfButton.addEventListener('click', this.handleOpenPdfFile);
    this.saveAnnotationButton.type = 'button';
    this.saveAnnotationButton.textContent = 'Create Annotation';
    this.saveAnnotationButton.addEventListener('click', this.handleCreateAnnotation);
    this.actionRowElement.append(
      this.captureSelectionButton,
      this.saveAnnotationButton,
    );
    this.draftSectionElement.append(
      this.draftMetaElement,
      this.draftTextElement,
      this.actionRowElement,
    );
    this.emptyOpenElement.append(this.openPdfButton);
    this.readerElement.append(
      this.loadingElement,
      this.pagesElement,
      this.unavailableElement,
    );
    this.surfaceElement.append(this.readerElement, this.emptyOpenElement);
    this.overlayElement.append(
      this.badgeElement,
      this.hintElement,
      this.draftSectionElement,
      this.listElement,
    );
    this.element.append(this.surfaceElement, this.overlayElement);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  getSnapshot(): PdfAnnotationStoreSnapshot {
    return this.store.getSnapshot();
  }

  getViewState(): PdfAnnotationEditorViewState {
    const snapshot = this.store.getSnapshot();
    return {
      selection: snapshot.selection,
      draftComment: snapshot.draftComment,
    };
  }

  setProps(props: PdfAnnotationEditorProps) {
    this.props = props;
    this.store.setTarget(props.annotationTargetId ?? props.targetId);
    this.store.setAnnotations(props.annotations ?? []);
    this.store.setSelection(props.selection ?? null);
    this.renderReader();
    this.renderOverlay();
  }

  setSelection(selection: PdfSelection | null) {
    this.store.setSelection(selection);
  }

  restoreViewState(viewState: PdfAnnotationEditorViewState | undefined) {
    if (!viewState) {
      return;
    }

    this.store.setSelection(viewState.selection);
    this.store.setDraftComment(viewState.draftComment);
  }

  dispose() {
    this.unsubscribeStore();
    this.selectionController.dispose();
    this.element.removeEventListener('keydown', this.handleKeyDown);
    this.element.removeEventListener('pointerdown', this.handlePointerFocus, true);
    this.pagesElement.removeEventListener('wheel', this.handleWheel);
    this.cancelReaderWork();
    this.element.replaceChildren();
  }

  private cancelReaderWork() {
    this.loadVersion += 1;
    this.pageRenderVersion += 1;
    this.clearScheduledZoomRender();
    this.closePdfiumDocument(this.documentHandle);
    this.documentHandle = null;
    this.zoomScale = 1;
    this.renderedZoomScale = 1;
    this.selectionController.reset();
    this.pageRenderInfoByPage.clear();
    delete this.element.dataset.pdfReaderTextChars;
    delete this.element.dataset.pdfReaderSelectionText;
    delete this.element.dataset.pdfReaderSelectionPages;
  }

  private renderReader() {
    const url = this.props.url.trim();
    const canRenderPdf = Boolean(url && this.props.viewPartProps.electronRuntime);

    this.readerElement.hidden = !url;
    this.unavailableElement.hidden = !url || canRenderPdf;
    this.unavailableElement.textContent = this.props.viewPartProps.labels.contentUnavailable;

    const nextUrl = canRenderPdf ? url : '';
    if (!nextUrl) {
      this.loadingElement.hidden = true;
      this.pagesElement.replaceChildren();
      this.setReaderStatus({
        state: url ? 'error' : 'idle',
        message: url
          ? this.props.viewPartProps.labels.contentUnavailable
          : 'No PDF loaded',
        detail: url
          ? 'PDF preview requires the Electron runtime.'
          : undefined,
      });
    }

    if (this.renderedUrl === nextUrl) {
      return;
    }

    this.renderedUrl = nextUrl;
    this.cancelReaderWork();
    this.pagesElement.replaceChildren();

    if (!nextUrl) {
      this.loadingElement.hidden = true;
      return;
    }

    this.loadingElement.hidden = false;
    this.loadingElement.textContent = 'Loading PDF...';
    this.setReaderStatus({
      state: 'loading',
      message: 'Loading PDF...',
      detail: nextUrl,
    });
    void this.loadPdf(nextUrl, this.loadVersion);
  }

  private async loadPdf(url: string, version: number) {
    try {
      const pdfium = await loadPdfiumModule();
      if (version !== this.loadVersion) {
        return;
      }

      const pdfData = await this.loadPdfData(url);
      if (version !== this.loadVersion) {
        return;
      }

      const document = this.openPdfiumDocument(pdfium, pdfData);
      if (version !== this.loadVersion) {
        this.closePdfiumDocument(document);
        return;
      }

      this.documentHandle = document;
      this.loadingElement.textContent = `${document.pageCount} pages`;
      const pageRenderVersion = ++this.pageRenderVersion;
      await this.renderPdfPages(document, version, pageRenderVersion);
      if (version === this.loadVersion && pageRenderVersion === this.pageRenderVersion) {
        this.renderedZoomScale = this.zoomScale;
        this.renderAllHighlights();
        this.loadingElement.hidden = true;
        this.setReaderStatus({
          state: 'ready',
          message: `${document.pageCount} pages`,
          detail: url,
        });
      }
    } catch (error) {
      if (version !== this.loadVersion) {
        return;
      }

      const detail = normalizePdfError(error);
      this.loadingElement.hidden = false;
      this.loadingElement.textContent = 'PDF preview failed - see status bar.';
      this.setReaderStatus({
        state: 'error',
        message: 'PDF preview failed',
        detail,
      });
      console.error('Failed to render PDF preview with PDFium.', error);
    }
  }

  private async loadPdfData(url: string): Promise<Uint8Array> {
    if (!isFilePdfUrl(url)) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    }

    if (!nativeHostService.canInvoke()) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    }

    const result = await nativeHostService.invoke('read_pdf_file', { url });
    return new Uint8Array(result.data);
  }

  private setReaderStatus(status: PdfReaderRuntimeStatus) {
    if (
      this.readerStatus.state === status.state &&
      this.readerStatus.message === status.message &&
      this.readerStatus.detail === status.detail
    ) {
      return;
    }

    this.readerStatus = status;
    this.element.dataset.pdfReaderState = status.state;
    this.element.dataset.pdfReaderStatus = status.message;
    delete this.element.dataset.pdfReaderErrorDetail;
    delete this.loadingElement.dataset.pdfReaderErrorDetail;
    this.loadingElement.title = status.detail ?? status.message;

    if (status.detail) {
      this.element.dataset.pdfReaderErrorDetail = status.detail;
      this.loadingElement.dataset.pdfReaderErrorDetail = status.detail;
    }

    this.props.onReaderStatusChange?.(status);
  }

  getReaderStatus() {
    return this.readerStatus;
  }

  private openPdfiumDocument(
    pdfium: PdfiumModuleWithHeap,
    pdfData: Uint8Array,
  ): PdfiumDocumentHandle {
    const filePtr = pdfium.pdfium.wasmExports.malloc(pdfData.length);
    pdfium.pdfium.HEAPU8.set(pdfData, filePtr);
    const documentPtr = pdfium.FPDF_LoadMemDocument(filePtr, pdfData.length, '');

    if (!documentPtr) {
      const errorCode = pdfium.FPDF_GetLastError();
      pdfium.pdfium.wasmExports.free(filePtr);
      throw new Error(`PDFium failed to load document: error=${errorCode}`);
    }

    return {
      pdfium,
      documentPtr,
      filePtr,
      pageCount: pdfium.FPDF_GetPageCount(documentPtr),
    };
  }

  private closePdfiumDocument(document: PdfiumDocumentHandle | null) {
    if (!document) {
      return;
    }

    document.pdfium.FPDF_CloseDocument(document.documentPtr);
    document.pdfium.pdfium.wasmExports.free(document.filePtr);
  }

  private async renderPdfPages(
    document: PdfiumDocumentHandle,
    version: number,
    pageRenderVersion: number,
    target: HTMLElement | DocumentFragment = this.pagesElement,
    pageInfoByPage: Map<number, PdfReviewerPageInfo> = this.pageRenderInfoByPage,
  ) {
    for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
      if (version !== this.loadVersion || pageRenderVersion !== this.pageRenderVersion) {
        return;
      }

      this.renderPdfPage(
        document,
        pageNumber,
        version,
        pageRenderVersion,
        target,
        pageInfoByPage,
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  private renderPdfPage(
    documentHandle: PdfiumDocumentHandle,
    pageNumber: number,
    version: number,
    pageRenderVersion: number,
    target: HTMLElement | DocumentFragment,
    pageInfoByPage: Map<number, PdfReviewerPageInfo>,
  ) {
    const pagePtr = documentHandle.pdfium.FPDF_LoadPage(
      documentHandle.documentPtr,
      pageNumber - 1,
    );
    if (!pagePtr) {
      throw new Error(`PDFium failed to load page ${pageNumber}.`);
    }

    const pageElement = createElement('section', 'pdf-reader-page');
    const pageMetaElement = createElement('div', 'pdf-reader-page-meta');
    const pageCanvasWrap = createElement('div', 'pdf-reader-page-canvas-wrap');
    const canvas = document.createElement('canvas');
    const highlightLayer = createElement('div', 'pdf-reader-highlight-layer');
    const context = canvas.getContext('2d');

    if (!context) {
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
      return;
    }

    try {
      const pageWidth = documentHandle.pdfium.FPDF_GetPageWidthF(pagePtr);
      const pageHeight = documentHandle.pdfium.FPDF_GetPageHeightF(pagePtr);
      const availableWidth = Math.max(320, this.surfaceElement.clientWidth - 48);
      const scale = Math.max(0.2, availableWidth / pageWidth) * this.zoomScale;
      const outputScale = Math.max(1, window.devicePixelRatio || 1);
      const cssWidth = Math.floor(pageWidth * scale);
      const cssHeight = Math.floor(pageHeight * scale);
      const bitmapWidth = Math.max(1, Math.floor(cssWidth * outputScale));
      const bitmapHeight = Math.max(1, Math.floor(cssHeight * outputScale));
      const bitmapPtr = documentHandle.pdfium.FPDFBitmap_Create(bitmapWidth, bitmapHeight, 0);

      if (!bitmapPtr) {
        throw new Error(`PDFium failed to create bitmap for page ${pageNumber}.`);
      }

      try {
        pageElement.dataset.pdfPage = String(pageNumber);
        pageMetaElement.textContent = `Page ${pageNumber}`;
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        canvas.style.width = `${cssWidth}px`;
        canvas.style.height = `${cssHeight}px`;
        pageCanvasWrap.style.width = `${cssWidth}px`;
        pageCanvasWrap.style.height = `${cssHeight}px`;
        pageCanvasWrap.dataset.renderedWidth = String(cssWidth);
        pageCanvasWrap.dataset.renderedHeight = String(cssHeight);
        highlightLayer.style.width = `${cssWidth}px`;
        highlightLayer.style.height = `${cssHeight}px`;
        pageCanvasWrap.append(canvas, highlightLayer);
        pageElement.append(pageMetaElement, pageCanvasWrap);

        if (version !== this.loadVersion || pageRenderVersion !== this.pageRenderVersion) {
          return;
        }

        documentHandle.pdfium.FPDFBitmap_FillRect(
          bitmapPtr,
          0,
          0,
          bitmapWidth,
          bitmapHeight,
          0xFFFFFFFF,
        );
        documentHandle.pdfium.FPDF_RenderPageBitmap(
          bitmapPtr,
          pagePtr,
          0,
          0,
          bitmapWidth,
          bitmapHeight,
          0,
          16,
        );

        const bufferPtr = documentHandle.pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
        const stride = documentHandle.pdfium.FPDFBitmap_GetStride(bitmapPtr);
        const rowSize = bitmapWidth * 4;
        const pixels = new Uint8ClampedArray(rowSize * bitmapHeight);

        for (let y = 0; y < bitmapHeight; y += 1) {
          const rowStart = bufferPtr + y * stride;
          const row = documentHandle.pdfium.pdfium.HEAPU8.subarray(rowStart, rowStart + rowSize);
          pixels.set(row, y * rowSize);
        }

        context.putImageData(new ImageData(pixels, bitmapWidth, bitmapHeight), 0, 0);
        pageInfoByPage.set(pageNumber, {
          page: pageNumber,
          pageWidth,
          pageHeight,
          scale,
          canvas,
          highlightLayer,
          chars: this.extractPageTextChars(documentHandle, pagePtr),
        });
        target.append(pageElement);
      } finally {
        documentHandle.pdfium.FPDFBitmap_Destroy(bitmapPtr);
      }
    } finally {
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
    }
  }

  private extractPageTextChars(
    documentHandle: PdfiumDocumentHandle,
    pagePtr: number,
  ): readonly PdfTextChar[] {
    const textPagePtr = documentHandle.pdfium.FPDFText_LoadPage(pagePtr);
    if (!textPagePtr) {
      return [];
    }

    const pdfium = documentHandle.pdfium;
    const leftPtr = pdfium.pdfium.wasmExports.malloc(8);
    const rightPtr = pdfium.pdfium.wasmExports.malloc(8);
    const bottomPtr = pdfium.pdfium.wasmExports.malloc(8);
    const topPtr = pdfium.pdfium.wasmExports.malloc(8);

    try {
      const chars: PdfTextChar[] = [];
      const charCount = pdfium.FPDFText_CountChars(textPagePtr);
      for (let index = 0; index < charCount; index += 1) {
        const codePoint = pdfium.FPDFText_GetUnicode(textPagePtr, index);
        const char = codePoint > 0 ? String.fromCodePoint(codePoint) : '';
        const hasBox = pdfium.FPDFText_GetCharBox(
          textPagePtr,
          index,
          leftPtr,
          rightPtr,
          bottomPtr,
          topPtr,
        );
        if (!char) {
          continue;
        }

        if (!hasBox) {
          chars.push({ index, char });
          continue;
        }

        const left = pdfium.pdfium.getValue(leftPtr, 'double') as number;
        const right = pdfium.pdfium.getValue(rightPtr, 'double') as number;
        const bottom = pdfium.pdfium.getValue(bottomPtr, 'double') as number;
        const top = pdfium.pdfium.getValue(topPtr, 'double') as number;
        const width = Math.max(0, right - left);
        const height = Math.max(0, top - bottom);

        chars.push({
          index,
          char,
          rect: width > 0 && height > 0
            ? {
                x: left,
                y: bottom,
                width,
                height,
              }
            : undefined,
        });
      }

      this.element.dataset.pdfReaderTextChars = String(
        Number(this.element.dataset.pdfReaderTextChars ?? 0) + chars.length,
      );
      return chars;
    } finally {
      pdfium.pdfium.wasmExports.free(leftPtr);
      pdfium.pdfium.wasmExports.free(rightPtr);
      pdfium.pdfium.wasmExports.free(bottomPtr);
      pdfium.pdfium.wasmExports.free(topPtr);
      pdfium.FPDFText_ClosePage(textPagePtr);
    }
  }

  private renderHighlightsForPage(page: number) {
    const info = this.pageRenderInfoByPage.get(page);
    if (!info) {
      return;
    }

    info.highlightLayer.replaceChildren();
    const snapshot = this.store.getSnapshot();
    const selection = snapshot.selection;

    if (selection) {
      const selectionRange = selection.ranges.find((range) => range.page === page);
      if (selectionRange) {
        this.appendHighlightRects(
          info,
          selectionRange.rects,
          'pdf-reader-highlight is-selection',
        );
      }
    }

    for (const annotation of snapshot.annotations) {
      const ranges = annotation.anchor.ranges ?? [{
        page: annotation.anchor.page,
        rects: annotation.anchor.rects,
      }];
      for (const range of ranges) {
        if (range.page !== page) {
          continue;
        }

        this.appendHighlightRects(
          info,
          range.rects,
          'pdf-reader-highlight is-annotation',
        );
      }
    }
  }

  private appendHighlightRects(
    info: PdfReviewerPageInfo,
    rects: readonly PdfRect[],
    className: string,
  ) {
    for (const rect of rects) {
      const viewportRect = pdfRectToViewportRect(info, rect);
      const highlight = createElement('div', className);
      highlight.style.left = `${viewportRect.x}px`;
      highlight.style.top = `${viewportRect.y}px`;
      highlight.style.width = `${viewportRect.width}px`;
      highlight.style.height = `${viewportRect.height}px`;
      info.highlightLayer.append(highlight);
    }
  }

  private renderAllHighlights() {
    for (const page of this.pageRenderInfoByPage.keys()) {
      this.renderHighlightsForPage(page);
    }
  }

  private getVisiblePageAnchor() {
    const viewportRect = this.pagesElement.getBoundingClientRect();
    const viewportCenterY = viewportRect.top + viewportRect.height / 2;
    const pageElements = this.pagesElement.querySelectorAll<HTMLElement>('.pdf-reader-page');
    let nearestAnchor: { page: number; ratio: number } | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const pageElement of pageElements) {
      const page = Number(pageElement.dataset.pdfPage);
      if (!Number.isFinite(page)) {
        continue;
      }

      const rect = pageElement.getBoundingClientRect();
      if (rect.height <= 0) {
        continue;
      }

      const clampedY = Math.min(Math.max(viewportCenterY, rect.top), rect.bottom);
      const distance = Math.abs(viewportCenterY - clampedY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestAnchor = {
          page,
          ratio: Math.min(1, Math.max(0, (clampedY - rect.top) / rect.height)),
        };
      }
    }

    return nearestAnchor;
  }

  private restoreVisiblePageAnchor(anchor: { page: number; ratio: number } | null) {
    if (!anchor) {
      return;
    }

    const pageElement = this.pagesElement.querySelector<HTMLElement>(
      `.pdf-reader-page[data-pdf-page="${anchor.page}"]`,
    );
    if (!pageElement) {
      return;
    }

    const viewportRect = this.pagesElement.getBoundingClientRect();
    const viewportCenterY = viewportRect.top + viewportRect.height / 2;
    const pageRect = pageElement.getBoundingClientRect();
    const anchoredY = pageRect.top + pageRect.height * anchor.ratio;
    this.pagesElement.scrollTop += anchoredY - viewportCenterY;
  }

  private applyInstantZoomPreview() {
    if (this.renderedZoomScale <= 0 || this.zoomScale === this.renderedZoomScale) {
      return;
    }

    const anchor = this.getVisiblePageAnchor();
    const previewRatio = this.zoomScale / this.renderedZoomScale;
    const pageCanvasWraps =
      this.pagesElement.querySelectorAll<HTMLElement>('.pdf-reader-page-canvas-wrap');

    for (const pageCanvasWrap of pageCanvasWraps) {
      const renderedWidth = Number(pageCanvasWrap.dataset.renderedWidth);
      const renderedHeight = Number(pageCanvasWrap.dataset.renderedHeight);
      if (!Number.isFinite(renderedWidth) || !Number.isFinite(renderedHeight)) {
        continue;
      }

      const previewWidth = Math.max(1, Math.floor(renderedWidth * previewRatio));
      const previewHeight = Math.max(1, Math.floor(renderedHeight * previewRatio));
      pageCanvasWrap.style.width = `${previewWidth}px`;
      pageCanvasWrap.style.height = `${previewHeight}px`;

      for (const previewLayer of pageCanvasWrap.children) {
        if (!(previewLayer instanceof HTMLElement)) {
          continue;
        }
        previewLayer.style.transform = `scale(${previewRatio})`;
      }
    }

    this.pagesElement.classList.add('is-zoom-previewing');
    this.restoreVisiblePageAnchor(anchor);
  }

  private clearInstantZoomPreview() {
    const pageCanvasWraps =
      this.pagesElement.querySelectorAll<HTMLElement>('.pdf-reader-page-canvas-wrap');

    for (const pageCanvasWrap of pageCanvasWraps) {
      for (const previewLayer of pageCanvasWrap.children) {
        if (previewLayer instanceof HTMLElement) {
          previewLayer.style.transform = '';
        }
      }
    }

    this.pagesElement.classList.remove('is-zoom-previewing');
  }

  private clearScheduledZoomRender() {
    if (this.zoomRenderTimer === null) {
      return;
    }

    window.clearTimeout(this.zoomRenderTimer);
    this.zoomRenderTimer = null;
  }

  private scheduleZoomRender() {
    this.clearScheduledZoomRender();
    this.pageRenderVersion += 1;
    this.zoomRenderTimer = window.setTimeout(() => {
      this.zoomRenderTimer = null;
      void this.rerenderPdfAtCurrentZoom();
    }, PDF_READER_ZOOM_RENDER_DELAY_MS);
  }

  private async rerenderPdfAtCurrentZoom() {
    const documentHandle = this.documentHandle;
    if (!documentHandle || this.readerStatus.state !== 'ready') {
      return;
    }

    const pageRenderVersion = ++this.pageRenderVersion;
    const anchor = this.getVisiblePageAnchor();
    const nextPages = document.createDocumentFragment();
    const nextPageInfoByPage = new Map<number, PdfReviewerPageInfo>();

    this.loadingElement.hidden = false;
    this.loadingElement.textContent = `${Math.round(this.zoomScale * 100)}%`;
    this.pagesElement.classList.add('is-zooming');
    this.selectionController.reset();
    delete this.element.dataset.pdfReaderTextChars;
    this.element.dataset.pdfReaderZoom = String(this.zoomScale);

    await this.renderPdfPages(
      documentHandle,
      this.loadVersion,
      pageRenderVersion,
      nextPages,
      nextPageInfoByPage,
    );

    if (pageRenderVersion !== this.pageRenderVersion) {
      this.pagesElement.classList.remove('is-zooming');
      return;
    }

    this.pagesElement.replaceChildren(nextPages);
    this.clearInstantZoomPreview();
    this.pageRenderInfoByPage.clear();
    for (const [page, info] of nextPageInfoByPage) {
      this.pageRenderInfoByPage.set(page, info);
    }
    this.renderedZoomScale = this.zoomScale;
    this.renderAllHighlights();
    this.restoreVisiblePageAnchor(anchor);
    this.pagesElement.classList.remove('is-zooming');
    this.loadingElement.hidden = true;
  }

  private setZoomScale(nextZoomScale: number) {
    const normalizedZoomScale = Math.min(
      PDF_READER_MAX_ZOOM,
      Math.max(PDF_READER_MIN_ZOOM, Number(nextZoomScale.toFixed(2))),
    );
    if (normalizedZoomScale === this.zoomScale) {
      return;
    }

    this.zoomScale = normalizedZoomScale;
    this.loadingElement.hidden = false;
    this.loadingElement.textContent = `${Math.round(this.zoomScale * 100)}%`;
    this.element.dataset.pdfReaderZoom = String(this.zoomScale);
    this.applyInstantZoomPreview();
    this.scheduleZoomRender();
  }

  private zoomByStep(direction: 1 | -1) {
    this.setZoomScale(this.zoomScale + direction * PDF_READER_ZOOM_STEP);
  }

  private renderOverlay() {
    const snapshot = this.store.getSnapshot();
    this.renderAllHighlights();
    this.emptyOpenElement.hidden = Boolean(this.props.url.trim());
    this.openPdfButton.textContent = this.props.labels.openPdfFile ?? 'Open PDF';
    this.badgeElement.textContent = `${this.props.labels.title} Annotation`;
    this.hintElement.textContent =
      snapshot.annotations.length > 0
        ? `${snapshot.annotations.length} annotations`
        : this.props.labels.emptyState;

    const hasSelection = !isPdfSelectionEmpty(snapshot.selection);
    const selectionPageLabel = snapshot.selection && snapshot.selection.ranges.length > 1
      ? `Pages ${snapshot.selection.ranges[0]?.page ?? 1}-${snapshot.selection.ranges.at(-1)?.page ?? 1}`
      : `Page ${snapshot.selection?.page ?? 1}`;
    this.draftMetaElement.textContent = hasSelection
      ? `${selectionPageLabel} selected`
      : 'No PDF selection yet';
    if (hasSelection && snapshot.selection) {
      this.element.dataset.pdfReaderSelectionText = snapshot.selection.text;
      this.element.dataset.pdfReaderSelectionPages = snapshot.selection.ranges
        .map((range) => String(range.page))
        .join(',');
    } else {
      delete this.element.dataset.pdfReaderSelectionText;
      delete this.element.dataset.pdfReaderSelectionPages;
    }
    this.draftTextElement.value = snapshot.draftComment;
    this.saveAnnotationButton.disabled =
      !hasSelection || !snapshot.draftComment.trim();
    this.renderAnnotationList(snapshot);
  }

  private renderAnnotationList(snapshot: PdfAnnotationStoreSnapshot) {
    this.listElement.replaceChildren();

    if (snapshot.annotations.length === 0) {
      const emptyElement = createElement('div', 'pdf-annotation-list-empty');
      emptyElement.textContent = 'Annotations will appear here.';
      this.listElement.append(emptyElement);
      return;
    }

    for (const annotation of snapshot.annotations) {
      const itemElement = createElement('div', 'pdf-annotation-item');
      const titleElement = createElement('div', 'pdf-annotation-item-title');
      const bodyElement = createElement('div', 'pdf-annotation-item-body');
      titleElement.textContent = `Page ${annotation.anchor.page}`;
      bodyElement.textContent = annotation.comment;
      itemElement.append(titleElement, bodyElement);
      this.listElement.append(itemElement);
    }
  }

  private readonly handleDraftCommentInput = () => {
    this.store.setDraftComment(this.draftTextElement.value);
  };

  private readonly handleCaptureSelection = () => {
    this.renderOverlay();
  };

  private readonly handleOpenPdfFile = () => {
    void this.props.onOpenPdfFile?.();
  };

  private readonly handlePointerFocus = () => {
    this.element.focus({ preventScroll: true });
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    if (event.key === '+' || event.key === '=' || event.code === 'NumpadAdd') {
      event.preventDefault();
      this.zoomByStep(1);
      return;
    }

    if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
      event.preventDefault();
      this.zoomByStep(-1);
      return;
    }

    if (event.key === '0' || event.code === 'Numpad0') {
      event.preventDefault();
      this.setZoomScale(1);
    }
  };

  private readonly handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    this.zoomByStep(event.deltaY < 0 ? 1 : -1);
  };

  private readonly handleCreateAnnotation = () => {
    const snapshot = this.store.getSnapshot();
    const selection = snapshot.selection;
    if (!snapshot.targetId || isPdfSelectionEmpty(selection) || !selection) {
      return;
    }

    const now = new Date().toISOString();
    const ranges = selection.ranges.map((range) => ({
      page: range.page,
      rects: [...range.rects],
      quote: range.text.trim() || undefined,
      startCharIndex: range.textRange?.startCharIndex,
      endCharIndex: range.textRange?.endCharIndex,
    }));
    const nextAnnotation: Annotation = {
      id: createAnnotationId('pdf_annotation'),
      kind: 'pdf',
      targetId: snapshot.targetId,
      anchor: {
        page: selection.page,
        rects: [...selection.rects],
        quote: selection.text.trim() || undefined,
        ranges,
      },
      comment: snapshot.draftComment.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const nextAnnotations = [...snapshot.annotations, nextAnnotation];
    this.store.setAnnotations(nextAnnotations);
    this.store.setDraftComment('');
    this.store.setSelection(null);
    this.props.onAnnotationsChange?.(nextAnnotations);
  }
}

export function createPdfAnnotationEditor(props: PdfAnnotationEditorProps) {
  return new PdfAnnotationEditor(props);
}
