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
    this.cancelReaderWork();
    this.element.replaceChildren();
  }

  private cancelReaderWork() {
    this.loadVersion += 1;
    this.closePdfiumDocument(this.documentHandle);
    this.documentHandle = null;
    this.selectionController.reset();
    this.pageRenderInfoByPage.clear();
    delete this.element.dataset.pdfReaderTextChars;
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
      await this.renderPdfPages(document, version);
      if (version === this.loadVersion) {
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
  ) {
    for (let pageNumber = 1; pageNumber <= document.pageCount; pageNumber += 1) {
      if (version !== this.loadVersion) {
        return;
      }

      this.renderPdfPage(document, pageNumber, version);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    }
  }

  private renderPdfPage(
    documentHandle: PdfiumDocumentHandle,
    pageNumber: number,
    version: number,
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
      const scale = Math.max(0.2, availableWidth / pageWidth);
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
        pageCanvasWrap.append(canvas, highlightLayer);
        pageElement.append(pageMetaElement, pageCanvasWrap);

        if (version !== this.loadVersion) {
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
        this.pageRenderInfoByPage.set(pageNumber, {
          page: pageNumber,
          pageWidth,
          pageHeight,
          scale,
          canvas,
          highlightLayer,
          chars: this.extractPageTextChars(documentHandle, pagePtr),
        });
        this.renderHighlightsForPage(pageNumber);
        this.pagesElement.append(pageElement);
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
        if (!hasBox || !char.trim()) {
          continue;
        }

        const left = pdfium.pdfium.getValue(leftPtr, 'double') as number;
        const right = pdfium.pdfium.getValue(rightPtr, 'double') as number;
        const bottom = pdfium.pdfium.getValue(bottomPtr, 'double') as number;
        const top = pdfium.pdfium.getValue(topPtr, 'double') as number;
        const width = Math.max(0, right - left);
        const height = Math.max(0, top - bottom);
        if (width === 0 || height === 0) {
          continue;
        }

        chars.push({
          index,
          char,
          rect: {
            x: left,
            y: bottom,
            width,
            height,
          },
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

    if (selection?.page === page) {
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
