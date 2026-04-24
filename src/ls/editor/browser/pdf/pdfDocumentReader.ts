import type { Annotation } from 'ls/editor/common/annotation';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import { PdfAnnotationStore } from 'ls/editor/browser/pdf/pdfAnnotationStore';
import type { PdfAnnotationStoreSnapshot } from 'ls/editor/browser/pdf/pdfAnnotationStore';
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

import 'ls/editor/browser/pdf/media/pdfDocumentReader.css';

export type PdfDocumentReaderLabels = {
  title: string;
  emptyState: string;
  openPdfFile?: string;
};

export type PdfDocumentReaderProps = {
  url: string;
  targetId: string;
  annotationTargetId?: string;
  labels: PdfDocumentReaderLabels;
  viewPartProps: ViewPartProps;
  annotations?: readonly Annotation[];
  selection?: PdfSelection | null;
  onViewStateChange?: (viewState: PdfDocumentReaderViewState) => void;
  onReaderStatusChange?: (status: PdfReaderRuntimeStatus) => void;
  onOpenPdfFile?: () => void | Promise<void>;
};

export type PdfDocumentReaderViewState = Pick<
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

type PdfPageShell = {
  pageNumber: number;
  pageWidth: number;
  pageHeight: number;
  scale: number;
  cssWidth: number;
  cssHeight: number;
  pageElement: HTMLElement;
  pageCanvasWrap: HTMLElement;
  highlightLayer: HTMLElement;
  canvas: HTMLCanvasElement | null;
  renderState: 'empty' | 'rendering' | 'rendered';
  lastVisibleAt: number;
};

type PdfZoomAnchor = {
  page: number;
  ratioX: number;
  ratioY: number;
  viewportX: number;
  viewportY: number;
};

const PDF_READER_MIN_ZOOM = 0.4;
const PDF_READER_MAX_ZOOM = 3;
const PDF_READER_ZOOM_STEP = 0.1;
const PDF_READER_ZOOM_RENDER_DELAY_MS = 120;
const PDF_READER_MIN_OUTPUT_SCALE = 1.5;
const PDF_READER_MAX_OUTPUT_SCALE = 3;
const PDF_READER_MAX_BITMAP_PIXELS = 12_000_000;
const PDF_READER_VIRTUALIZATION_MARGIN_PX = 1200;
const PDF_READER_MAX_RETAINED_PAGES = 8;
const FPDF_RENDER_LCD_TEXT = 0x02;
const FPDF_RENDER_REVERSE_BYTE_ORDER = 0x10;
const PDF_RENDER_FLAGS = FPDF_RENDER_LCD_TEXT | FPDF_RENDER_REVERSE_BYTE_ORDER;

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

export class PdfDocumentReader {
  private props: PdfDocumentReaderProps;
  private readonly element = createElement('div', 'pdf-document-reader');
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
  private readonly store = new PdfAnnotationStore();
  private readonly unsubscribeStore: () => void;
  private renderedUrl = '';
  private loadVersion = 0;
  private pageRenderVersion = 0;
  private zoomScale = 1;
  private renderedZoomScale = 1;
  private zoomRenderTimer: number | null = null;
  private zoomAnchor: PdfZoomAnchor | null = null;
  private isRestoringZoomScroll = false;
  private visibilityRenderFrame: number | null = null;
  private readonly pageShells = new Map<number, PdfPageShell>();
  private documentHandle: PdfiumDocumentHandle | null = null;
  private readonly pageRenderInfoByPage = new Map<number, PdfReviewerPageInfo>();
  private readonly resizeObserver: ResizeObserver | null =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.scheduleVisiblePageRender());
  private readonly selectionController = new PdfSelectionController({
    pagesElement: this.pagesElement,
    pageInfoByPage: this.pageRenderInfoByPage,
    onSelectionChange: (selection) => this.store.setSelection(selection),
  });
  private readerStatus: PdfReaderRuntimeStatus = {
    state: 'idle',
    message: 'No PDF loaded',
  };

  constructor(props: PdfDocumentReaderProps) {
    this.props = props;
    this.unsubscribeStore = this.store.subscribe(() => {
      this.renderReaderChrome();
      this.props.onViewStateChange?.(this.getViewState());
    });
    this.element.tabIndex = 0;
    this.element.addEventListener('keydown', this.handleKeyDown);
    this.element.addEventListener('pointerdown', this.handlePointerFocus, true);
    this.pagesElement.addEventListener('wheel', this.handleWheel, { passive: false });
    this.pagesElement.addEventListener('scroll', this.handleReaderScroll, { passive: true });
    this.resizeObserver?.observe(this.surfaceElement);
    this.loadingElement.textContent = 'Loading PDF...';
    this.openPdfButton.type = 'button';
    this.openPdfButton.addEventListener('click', this.handleOpenPdfFile);
    this.emptyOpenElement.append(this.openPdfButton);
    this.readerElement.append(
      this.loadingElement,
      this.pagesElement,
      this.unavailableElement,
    );
    this.surfaceElement.append(this.readerElement, this.emptyOpenElement);
    this.element.append(this.surfaceElement);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  getSnapshot(): PdfAnnotationStoreSnapshot {
    return this.store.getSnapshot();
  }

  getViewState(): PdfDocumentReaderViewState {
    const snapshot = this.store.getSnapshot();
    return {
      selection: snapshot.selection,
      draftComment: snapshot.draftComment,
    };
  }

  setProps(props: PdfDocumentReaderProps) {
    this.props = props;
    this.store.setTarget(props.annotationTargetId ?? props.targetId);
    this.store.setAnnotations(props.annotations ?? []);
    this.store.setSelection(props.selection ?? null);
    this.renderReader();
    this.renderReaderChrome();
  }

  setSelection(selection: PdfSelection | null) {
    this.store.setSelection(selection);
  }

  restoreViewState(viewState: PdfDocumentReaderViewState | undefined) {
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
    this.pagesElement.removeEventListener('scroll', this.handleReaderScroll);
    this.resizeObserver?.disconnect();
    this.cancelReaderWork();
    this.element.replaceChildren();
  }

  private cancelReaderWork() {
    this.loadVersion += 1;
    this.pageRenderVersion += 1;
    this.clearScheduledZoomRender();
    this.clearScheduledVisiblePageRender();
    this.closePdfiumDocument(this.documentHandle);
    this.documentHandle = null;
    this.zoomScale = 1;
    this.renderedZoomScale = 1;
    this.zoomAnchor = null;
    this.isRestoringZoomScroll = false;
    this.selectionController.reset();
    this.pageShells.clear();
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
      this.createPdfPageShells(document, version, pageRenderVersion);
      await this.renderVisiblePdfPages(version, pageRenderVersion);
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

  private createPdfPageShells(
    documentHandle: PdfiumDocumentHandle,
    version: number,
    pageRenderVersion: number,
  ) {
    const fragment = document.createDocumentFragment();
    this.pageShells.clear();
    this.pageRenderInfoByPage.clear();
    delete this.element.dataset.pdfReaderTextChars;

    for (let pageNumber = 1; pageNumber <= documentHandle.pageCount; pageNumber += 1) {
      if (version !== this.loadVersion || pageRenderVersion !== this.pageRenderVersion) {
        return;
      }

      const pagePtr = documentHandle.pdfium.FPDF_LoadPage(
        documentHandle.documentPtr,
        pageNumber - 1,
      );
      if (!pagePtr) {
        throw new Error(`PDFium failed to load page ${pageNumber}.`);
      }

      try {
        const pageWidth = documentHandle.pdfium.FPDF_GetPageWidthF(pagePtr);
        const pageHeight = documentHandle.pdfium.FPDF_GetPageHeightF(pagePtr);
        const shell = this.createPdfPageShell(pageNumber, pageWidth, pageHeight);
        this.pageShells.set(pageNumber, shell);
        fragment.append(shell.pageElement);
      } finally {
        documentHandle.pdfium.FPDF_ClosePage(pagePtr);
      }
    }

    this.pagesElement.replaceChildren(fragment);
  }

  private createPdfPageShell(
    pageNumber: number,
    pageWidth: number,
    pageHeight: number,
  ): PdfPageShell {
    const pageElement = createElement('section', 'pdf-reader-page');
    const pageMetaElement = createElement('div', 'pdf-reader-page-meta');
    const pageCanvasWrap = createElement('div', 'pdf-reader-page-canvas-wrap');
    const highlightLayer = createElement('div', 'pdf-reader-highlight-layer');
    const geometry = this.getPageGeometry(pageWidth, pageHeight);

    pageElement.dataset.pdfPage = String(pageNumber);
    pageMetaElement.textContent = `Page ${pageNumber}`;
    pageCanvasWrap.style.width = `${geometry.cssWidth}px`;
    pageCanvasWrap.style.height = `${geometry.cssHeight}px`;
    pageCanvasWrap.dataset.renderedWidth = String(geometry.cssWidth);
    pageCanvasWrap.dataset.renderedHeight = String(geometry.cssHeight);
    highlightLayer.style.width = `${geometry.cssWidth}px`;
    highlightLayer.style.height = `${geometry.cssHeight}px`;
    pageCanvasWrap.append(highlightLayer);
    pageElement.append(pageMetaElement, pageCanvasWrap);

    return {
      pageNumber,
      pageWidth,
      pageHeight,
      scale: geometry.scale,
      cssWidth: geometry.cssWidth,
      cssHeight: geometry.cssHeight,
      pageElement,
      pageCanvasWrap,
      highlightLayer,
      canvas: null,
      renderState: 'empty',
      lastVisibleAt: 0,
    };
  }

  private getPageGeometry(pageWidth: number, pageHeight: number) {
    const availableWidth = Math.max(320, this.surfaceElement.clientWidth - 48);
    const scale = Math.max(0.2, availableWidth / pageWidth) * this.zoomScale;
    return {
      scale,
      cssWidth: Math.max(1, Math.floor(pageWidth * scale)),
      cssHeight: Math.max(1, Math.floor(pageHeight * scale)),
    };
  }

  private getOutputScale(cssWidth: number, cssHeight: number) {
    const preferredScale = Math.min(
      PDF_READER_MAX_OUTPUT_SCALE,
      Math.max(PDF_READER_MIN_OUTPUT_SCALE, window.devicePixelRatio || 1),
    );
    const cssPixels = Math.max(1, cssWidth * cssHeight);
    const bitmapBudgetScale = Math.sqrt(PDF_READER_MAX_BITMAP_PIXELS / cssPixels);
    return Math.max(1, Math.min(preferredScale, bitmapBudgetScale));
  }

  private async renderVisiblePdfPages(version: number, pageRenderVersion: number) {
    const documentHandle = this.documentHandle;
    if (!documentHandle) {
      return;
    }

    const visibleShells = this.getVisiblePageShells();
    for (const shell of visibleShells) {
      if (version !== this.loadVersion || pageRenderVersion !== this.pageRenderVersion) {
        return;
      }
      shell.lastVisibleAt = performance.now();
      await this.renderPdfPageIntoShell(documentHandle, shell, version, pageRenderVersion);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }

    this.evictDistantRenderedPages();
  }

  private getVisiblePageShells() {
    const shells = [...this.pageShells.values()];
    if (shells.length === 0) {
      return [];
    }

    const viewportRect = this.pagesElement.getBoundingClientRect();
    if (viewportRect.height <= 0) {
      return shells.slice(0, 2);
    }

    const visibleShells = shells.filter((shell) =>
      this.isShellNearViewport(shell, PDF_READER_VIRTUALIZATION_MARGIN_PX),
    );
    return visibleShells.length > 0 ? visibleShells : shells.slice(0, 2);
  }

  private isShellNearViewport(shell: PdfPageShell, margin: number) {
    const viewportRect = this.pagesElement.getBoundingClientRect();
    const pageRect = shell.pageElement.getBoundingClientRect();
    return (
      pageRect.bottom >= viewportRect.top - margin &&
      pageRect.top <= viewportRect.bottom + margin
    );
  }

  private async renderPdfPageIntoShell(
    documentHandle: PdfiumDocumentHandle,
    shell: PdfPageShell,
    version: number,
    pageRenderVersion: number,
  ) {
    if (shell.renderState !== 'empty') {
      return;
    }

    shell.renderState = 'rendering';
    const pagePtr = documentHandle.pdfium.FPDF_LoadPage(
      documentHandle.documentPtr,
      shell.pageNumber - 1,
    );
    if (!pagePtr) {
      shell.renderState = 'empty';
      throw new Error(`PDFium failed to load page ${shell.pageNumber}.`);
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
      shell.renderState = 'empty';
      return;
    }

    try {
      const outputScale = this.getOutputScale(shell.cssWidth, shell.cssHeight);
      const bitmapWidth = Math.max(1, Math.floor(shell.cssWidth * outputScale));
      const bitmapHeight = Math.max(1, Math.floor(shell.cssHeight * outputScale));
      const bitmapPtr = documentHandle.pdfium.FPDFBitmap_Create(bitmapWidth, bitmapHeight, 0);

      if (!bitmapPtr) {
        throw new Error(`PDFium failed to create bitmap for page ${shell.pageNumber}.`);
      }

      try {
        canvas.width = bitmapWidth;
        canvas.height = bitmapHeight;
        canvas.style.width = `${shell.cssWidth}px`;
        canvas.style.height = `${shell.cssHeight}px`;

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
          PDF_RENDER_FLAGS,
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
        shell.pageCanvasWrap.prepend(canvas);
        shell.canvas = canvas;
        shell.renderState = 'rendered';
        this.pageRenderInfoByPage.set(shell.pageNumber, {
          page: shell.pageNumber,
          pageWidth: shell.pageWidth,
          pageHeight: shell.pageHeight,
          scale: shell.scale,
          canvas,
          highlightLayer: shell.highlightLayer,
          chars: this.extractPageTextChars(documentHandle, pagePtr),
        });
        this.refreshRenderedTextCharCount();
        this.renderHighlightsForPage(shell.pageNumber);
      } finally {
        documentHandle.pdfium.FPDFBitmap_Destroy(bitmapPtr);
      }
    } finally {
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
      if (shell.renderState === 'rendering') {
        shell.renderState = 'empty';
      }
    }
  }

  private unloadPdfPageShell(shell: PdfPageShell) {
    shell.canvas?.remove();
    shell.canvas = null;
    shell.highlightLayer.replaceChildren();
    shell.renderState = 'empty';
    this.pageRenderInfoByPage.delete(shell.pageNumber);
    this.refreshRenderedTextCharCount();
  }

  private evictDistantRenderedPages() {
    const renderedShells = [...this.pageShells.values()]
      .filter((shell) => shell.renderState === 'rendered');
    if (renderedShells.length <= PDF_READER_MAX_RETAINED_PAGES) {
      return;
    }

    const candidates = renderedShells
      .filter((shell) => !this.isShellNearViewport(shell, PDF_READER_VIRTUALIZATION_MARGIN_PX))
      .sort((a, b) => a.lastVisibleAt - b.lastVisibleAt);
    while (
      renderedShells.length > PDF_READER_MAX_RETAINED_PAGES &&
      candidates.length > 0
    ) {
      const shell = candidates.shift();
      if (!shell) {
        break;
      }
      this.unloadPdfPageShell(shell);
      renderedShells.splice(renderedShells.indexOf(shell), 1);
    }
  }

  private refreshRenderedTextCharCount() {
    const textChars = [...this.pageRenderInfoByPage.values()]
      .reduce((total, info) => total + info.chars.length, 0);
    if (textChars > 0) {
      this.element.dataset.pdfReaderTextChars = String(textChars);
    } else {
      delete this.element.dataset.pdfReaderTextChars;
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

  private getVisiblePageAnchor(
    viewportPoint?: { clientX: number; clientY: number },
  ): PdfZoomAnchor | null {
    const viewportRect = this.pagesElement.getBoundingClientRect();
    const viewportX = viewportPoint?.clientX ?? viewportRect.left + viewportRect.width / 2;
    const viewportY = viewportPoint?.clientY ?? viewportRect.top + viewportRect.height / 2;
    const pageElements = this.pagesElement.querySelectorAll<HTMLElement>('.pdf-reader-page');
    let nearestAnchor: PdfZoomAnchor | null = null;
    let nearestDistance = Number.POSITIVE_INFINITY;

    for (const pageElement of pageElements) {
      const page = Number(pageElement.dataset.pdfPage);
      if (!Number.isFinite(page)) {
        continue;
      }

      const pageCanvasWrap = pageElement.querySelector<HTMLElement>('.pdf-reader-page-canvas-wrap');
      const rect = pageCanvasWrap?.getBoundingClientRect() ?? pageElement.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) {
        continue;
      }

      const clampedX = Math.min(Math.max(viewportX, rect.left), rect.right);
      const clampedY = Math.min(Math.max(viewportY, rect.top), rect.bottom);
      const distance = Math.hypot(viewportX - clampedX, viewportY - clampedY);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestAnchor = {
          page,
          ratioX: Math.min(1, Math.max(0, (clampedX - rect.left) / rect.width)),
          ratioY: Math.min(1, Math.max(0, (clampedY - rect.top) / rect.height)),
          viewportX,
          viewportY,
        };
      }
    }

    return nearestAnchor;
  }

  private restoreVisiblePageAnchor(anchor: PdfZoomAnchor | null) {
    if (!anchor) {
      return;
    }

    const pageElement = this.pagesElement.querySelector<HTMLElement>(
      `.pdf-reader-page[data-pdf-page="${anchor.page}"]`,
    );
    if (!pageElement) {
      return;
    }

    const pageCanvasWrap = pageElement.querySelector<HTMLElement>('.pdf-reader-page-canvas-wrap');
    const pageRect = pageCanvasWrap?.getBoundingClientRect() ?? pageElement.getBoundingClientRect();
    const anchoredX = pageRect.left + pageRect.width * anchor.ratioX;
    const anchoredY = pageRect.top + pageRect.height * anchor.ratioY;
    this.isRestoringZoomScroll = true;
    this.pagesElement.scrollLeft += anchoredX - anchor.viewportX;
    this.pagesElement.scrollTop += anchoredY - anchor.viewportY;
    window.requestAnimationFrame(() => {
      this.isRestoringZoomScroll = false;
    });
  }

  private applyInstantZoomPreview() {
    if (this.renderedZoomScale <= 0 || this.zoomScale === this.renderedZoomScale) {
      return;
    }

    const previewRatio = this.zoomScale / this.renderedZoomScale;
    const pageCanvasWraps =
      this.pagesElement.querySelectorAll<HTMLElement>('.pdf-reader-page-canvas-wrap');

    for (const pageCanvasWrap of pageCanvasWraps) {
      const renderedWidth = Number(pageCanvasWrap.dataset.renderedWidth);
      const renderedHeight = Number(pageCanvasWrap.dataset.renderedHeight);
      if (!Number.isFinite(renderedWidth) || !Number.isFinite(renderedHeight)) {
        continue;
      }

      for (const previewLayer of pageCanvasWrap.children) {
        if (!(previewLayer instanceof HTMLElement)) {
          continue;
        }
        previewLayer.style.transform = `scale(${previewRatio})`;
      }
    }

    this.pagesElement.classList.add('is-zoom-previewing');
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

  private clearScheduledVisiblePageRender() {
    if (this.visibilityRenderFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.visibilityRenderFrame);
    this.visibilityRenderFrame = null;
  }

  private scheduleVisiblePageRender() {
    if (!this.documentHandle || this.readerStatus.state !== 'ready') {
      return;
    }
    if (this.visibilityRenderFrame !== null) {
      return;
    }

    const version = this.loadVersion;
    const pageRenderVersion = this.pageRenderVersion;
    this.visibilityRenderFrame = window.requestAnimationFrame(() => {
      this.visibilityRenderFrame = null;
      void this.renderVisiblePdfPages(version, pageRenderVersion);
    });
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
    const anchor = this.zoomAnchor ?? this.getVisiblePageAnchor();

    this.loadingElement.hidden = false;
    this.loadingElement.textContent = `${Math.round(this.zoomScale * 100)}%`;
    this.pagesElement.classList.add('is-zooming');
    this.selectionController.reset();
    this.pageRenderInfoByPage.clear();
    delete this.element.dataset.pdfReaderTextChars;
    this.element.dataset.pdfReaderZoom = String(this.zoomScale);

    for (const shell of this.pageShells.values()) {
      this.unloadPdfPageShell(shell);
      const geometry = this.getPageGeometry(shell.pageWidth, shell.pageHeight);
      shell.scale = geometry.scale;
      shell.cssWidth = geometry.cssWidth;
      shell.cssHeight = geometry.cssHeight;
      shell.pageCanvasWrap.style.width = `${geometry.cssWidth}px`;
      shell.pageCanvasWrap.style.height = `${geometry.cssHeight}px`;
      shell.pageCanvasWrap.dataset.renderedWidth = String(geometry.cssWidth);
      shell.pageCanvasWrap.dataset.renderedHeight = String(geometry.cssHeight);
      shell.highlightLayer.style.width = `${geometry.cssWidth}px`;
      shell.highlightLayer.style.height = `${geometry.cssHeight}px`;
    }

    await this.renderVisiblePdfPages(this.loadVersion, pageRenderVersion);

    if (pageRenderVersion !== this.pageRenderVersion) {
      this.pagesElement.classList.remove('is-zooming');
      return;
    }

    this.clearInstantZoomPreview();
    this.renderedZoomScale = this.zoomScale;
    this.renderAllHighlights();
    this.restoreVisiblePageAnchor(anchor);
    this.pagesElement.classList.remove('is-zooming');
    this.loadingElement.hidden = true;
    this.zoomAnchor = null;
  }

  private setZoomScale(nextZoomScale: number, anchor?: PdfZoomAnchor | null) {
    const normalizedZoomScale = Math.min(
      PDF_READER_MAX_ZOOM,
      Math.max(PDF_READER_MIN_ZOOM, Number(nextZoomScale.toFixed(2))),
    );
    if (normalizedZoomScale === this.zoomScale) {
      return;
    }

    const zoomAnchor = this.zoomAnchor ?? anchor ?? this.getVisiblePageAnchor();
    this.zoomScale = normalizedZoomScale;
    this.zoomAnchor = zoomAnchor;
    this.loadingElement.hidden = false;
    this.loadingElement.textContent = `${Math.round(this.zoomScale * 100)}%`;
    this.element.dataset.pdfReaderZoom = String(this.zoomScale);
    this.applyInstantZoomPreview();
    this.scheduleZoomRender();
  }

  private zoomByStep(direction: 1 | -1, anchor?: PdfZoomAnchor | null) {
    this.setZoomScale(this.zoomScale + direction * PDF_READER_ZOOM_STEP, anchor);
  }

  private renderReaderChrome() {
    const snapshot = this.store.getSnapshot();
    this.renderAllHighlights();
    this.emptyOpenElement.hidden = Boolean(this.props.url.trim());
    this.openPdfButton.textContent = this.props.labels.openPdfFile ?? 'Open PDF';
    if (snapshot.selection && snapshot.selection.text.trim()) {
      this.element.dataset.pdfReaderSelectionText = snapshot.selection.text;
      this.element.dataset.pdfReaderSelectionPages = snapshot.selection.ranges
        .map((range) => String(range.page))
        .join(',');
    } else {
      delete this.element.dataset.pdfReaderSelectionText;
      delete this.element.dataset.pdfReaderSelectionPages;
    }
  }

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
      this.zoomByStep(1, this.getVisiblePageAnchor());
      return;
    }

    if (event.key === '-' || event.key === '_' || event.code === 'NumpadSubtract') {
      event.preventDefault();
      this.zoomByStep(-1, this.getVisiblePageAnchor());
      return;
    }

    if (event.key === '0' || event.code === 'Numpad0') {
      event.preventDefault();
      this.setZoomScale(1, this.getVisiblePageAnchor());
    }
  };

  private readonly handleWheel = (event: WheelEvent) => {
    if (!event.ctrlKey && !event.metaKey) {
      return;
    }

    event.preventDefault();
    this.zoomByStep(
      event.deltaY < 0 ? 1 : -1,
      this.getVisiblePageAnchor({ clientX: event.clientX, clientY: event.clientY }),
    );
  };

  private readonly handleReaderScroll = () => {
    if (this.isRestoringZoomScroll || this.pagesElement.classList.contains('is-zoom-previewing')) {
      return;
    }

    this.scheduleVisiblePageRender();
  };
}

export function createPdfDocumentReader(props: PdfDocumentReaderProps) {
  return new PdfDocumentReader(props);
}
