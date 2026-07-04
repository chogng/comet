import type { Annotation } from 'cs/editor/common/annotation';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { PdfAnnotationStore } from 'cs/editor/browser/pdf/pdfAnnotationStore';
import type { PdfAnnotationStoreSnapshot } from 'cs/editor/browser/pdf/pdfAnnotationStore';
import type {
  PdfSelection,
} from 'cs/editor/browser/pdf/pdfSelection';
import { PdfSelectionController } from 'cs/editor/browser/pdf/pdfSelectionController';
import type { PdfSelectionHitTestStatus } from 'cs/editor/browser/pdf/pdfSelectionController';
import { pdfRectToViewportRect } from 'cs/editor/browser/pdf/pdfReviewerTypes';
import {
  createPdfLayoutPage,
} from 'cs/editor/browser/pdf/pdfLayoutModel';
import {
  createV2PdfAnnotationFromResolvedRangesForPage,
  resolvePdfAnnotationRangesForPage,
  type PdfResolvedAnnotationRange,
} from 'cs/editor/browser/pdf/pdfAnnotationReanchor';
import {
  PdfiumRenderWorkerClient,
  getPdfRenderWorkerSupportStatus,
} from 'cs/editor/browser/pdf/pdfRenderWorkerSupport';
import type {
  PdfRenderWorkerSupportStatus,
  PdfWorkerPageRenderRequest,
  PdfWorkerTileRenderRequest,
} from 'cs/editor/browser/pdf/pdfRenderWorkerSupport';
import type {
  PdfRect,
  PdfReviewerPageInfo,
  PdfTextChar,
} from 'cs/editor/browser/pdf/pdfReviewerTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { URI } from 'cs/base/common/uri';
import { init as initPdfium } from 'cs/editor/browser/pdf/vendor/pdfium/index.js';
import type { WrappedPdfiumModule } from 'cs/editor/browser/pdf/vendor/pdfium/index.js';

import 'cs/editor/browser/pdf/media/pdfDocumentReader.css';

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
  nativeHost: INativeHostService;
  annotations?: readonly Annotation[];
  selection?: PdfSelection | null;
  onViewStateChange?: (viewState: PdfDocumentReaderViewState) => void;
  onAnnotationChange?: (annotation: Annotation) => void;
  onAnnotationDelete?: (annotationId: string) => void;
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
  hitTest?: PdfSelectionHitTestStatus;
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
  outputScale: number;
  cssWidth: number;
  cssHeight: number;
  pageElement: HTMLElement;
  pageCanvasWrap: HTMLElement;
  tileLayer: HTMLElement;
  tileCache: Map<string, HTMLCanvasElement>;
  tileOutputScale: number;
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

type PdfPageGeometry = {
  scale: number;
  cssWidth: number;
  cssHeight: number;
};

type PdfVisibleShell = {
  shell: PdfPageShell;
  priority: number;
};

type PdfRenderDiagnostics = {
  pageRenderCount: number;
  pageRenderTotalMs: number;
  pageRenderMaxMs: number;
  tileRenderCount: number;
  tileRenderTotalMs: number;
  tileRenderMaxMs: number;
  workerTileRenderCount: number;
  workerTileRenderFallbackCount: number;
  workerTileRenderErrorCount: number;
  workerPageRenderCount: number;
  workerPageRenderFallbackCount: number;
  workerPageRenderErrorCount: number;
  progressiveRenderYieldCount: number;
  progressiveRenderFallbackCount: number;
  renderBudgetYieldCount: number;
  inputPendingYieldCount: number;
  qualityDeferralCount: number;
  qualityRetryCount: number;
  renderStaleCount: number;
  tileCacheEvictionCount: number;
  textCacheHits: number;
  textCacheMisses: number;
};

type PdfRenderToken = {
  isStale: () => boolean;
};

type PdfRenderQuality = 'interactive' | 'quality';

type PdfInputPendingNavigator = Navigator & {
  scheduling?: {
    isInputPending?: (options?: { includeContinuous?: boolean }) => boolean;
  };
};

type PdfViewportTileRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type PdfViewportTile = PdfViewportTileRect & {
  key: string;
};

type PdfViewportTileCacheEntry = {
  shell: PdfPageShell;
  tileKey: string;
  canvas: HTMLCanvasElement;
  memoryBytes: number;
  lastUsedAt: number;
};

const PDF_READER_MIN_ZOOM = 0.4;
const PDF_READER_MAX_ZOOM = 3;
const PDF_READER_WHEEL_DELTA_LINE = 1;
const PDF_READER_WHEEL_DELTA_PAGE = 2;
const PDF_READER_ZOOM_LEVELS = [
  0.4,
  0.5,
  0.67,
  0.75,
  0.8,
  0.9,
  1,
  1.1,
  1.25,
  1.5,
  1.75,
  2,
  2.5,
  3,
] as const;
const PDF_READER_WHEEL_ZOOM_SENSITIVITY = 0.0015;
const PDF_READER_ZOOM_RENDER_DELAY_MS = 120;
const PDF_READER_RENDER_YIELD_TIMEOUT_MS = 32;
const PDF_READER_RENDER_TIME_SLICE_MS = 8;
const PDF_READER_PROGRESSIVE_RENDER_SLICE_MS = 4;
const PDF_READER_MIN_OUTPUT_SCALE = 1.5;
const PDF_READER_INTERACTIVE_MAX_OUTPUT_SCALE = 1;
const PDF_READER_MAX_OUTPUT_SCALE = 3;
const PDF_READER_MAX_BITMAP_PIXELS = 36_000_000;
const PDF_READER_VIEWPORT_TILE_SIZE_PX = 384;
const PDF_READER_VIEWPORT_TILE_MARGIN_PX = 96;
const PDF_READER_VIEWPORT_TILE_CACHE_MAX_BYTES = 96 * 1024 * 1024;
const PDF_READER_VIRTUALIZATION_MARGIN_PX = 1200;
const PDF_READER_VIRTUALIZATION_VIEWPORTS = 2.5;
const PDF_READER_MAX_VIRTUALIZATION_MARGIN_PX = 4200;
const PDF_READER_MAX_RETAINED_PAGES = 5;
const FPDF_RENDER_LCD_TEXT = 0x02;
const FPDF_RENDER_REVERSE_BYTE_ORDER = 0x10;
const PDF_RENDER_FLAGS = FPDF_RENDER_LCD_TEXT | FPDF_RENDER_REVERSE_BYTE_ORDER;
const PDF_RENDER_TOBE_CONTINUED = 1;
const PDF_RENDER_DONE = 2;

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

class PdfRenderScheduler {
  private frame: number | null = null;
  private generation = 0;
  private callback: ((token: PdfRenderToken) => void | Promise<void>) | null = null;
  private onError: ((error: unknown) => void) | null = null;

  cancel() {
    this.generation += 1;
    this.callback = null;
    this.onError = null;
    if (this.frame === null) {
      return;
    }

    window.cancelAnimationFrame(this.frame);
    this.frame = null;
  }

  request(
    callback: (token: PdfRenderToken) => void | Promise<void>,
    onError: (error: unknown) => void,
  ) {
    this.generation += 1;
    this.callback = callback;
    this.onError = onError;
    if (this.frame !== null) {
      return;
    }

    this.frame = window.requestAnimationFrame(() => {
      this.frame = null;
      const latestCallback = this.callback;
      const latestOnError = this.onError;
      this.callback = null;
      this.onError = null;
      if (!latestCallback || !latestOnError) {
        return;
      }
      const generation = this.generation;
      const token: PdfRenderToken = {
        isStale: () => generation !== this.generation,
      };
      void Promise.resolve(latestCallback(token)).catch(latestOnError);
    });
  }
}

class PdfViewportModel {
  private zoomScale = 1;
  private renderedZoomScale = 1;
  private zoomAnchor: PdfZoomAnchor | null = null;
  private isRestoringScroll = false;
  private lastScrollTop = 0;
  private scrollDirection: -1 | 0 | 1 = 0;

  constructor(
    private readonly pagesElement: HTMLElement,
    private readonly surfaceElement: HTMLElement,
  ) {}

  reset() {
    this.zoomScale = 1;
    this.renderedZoomScale = 1;
    this.zoomAnchor = null;
    this.isRestoringScroll = false;
    this.lastScrollTop = this.pagesElement.scrollTop;
    this.scrollDirection = 0;
  }

  getZoomScale() {
    return this.zoomScale;
  }

  setZoomScale(zoomScale: number) {
    this.zoomScale = zoomScale;
  }

  getRenderedZoomScale() {
    return this.renderedZoomScale;
  }

  setRenderedZoomScale(renderedZoomScale: number) {
    this.renderedZoomScale = renderedZoomScale;
  }

  getZoomAnchor() {
    return this.zoomAnchor;
  }

  setZoomAnchor(anchor: PdfZoomAnchor | null) {
    this.zoomAnchor = anchor;
  }

  clearZoomAnchor() {
    this.zoomAnchor = null;
  }

  getIsRestoringScroll() {
    return this.isRestoringScroll;
  }

  beginScrollRestore() {
    this.isRestoringScroll = true;
  }

  finishScrollRestoreNextFrame() {
    window.requestAnimationFrame(() => {
      this.isRestoringScroll = false;
    });
  }

  syncScrollPosition() {
    this.lastScrollTop = this.pagesElement.scrollTop;
  }

  recordUserScroll() {
    const scrollTop = this.pagesElement.scrollTop;
    if (scrollTop > this.lastScrollTop) {
      this.scrollDirection = 1;
    } else if (scrollTop < this.lastScrollTop) {
      this.scrollDirection = -1;
    }
    this.lastScrollTop = scrollTop;
  }

  getPageGeometry(pageWidth: number, pageHeight: number): PdfPageGeometry {
    const containerWidth = this.pagesElement.clientWidth || this.surfaceElement.clientWidth;
    const computedStyle = window.getComputedStyle(this.pagesElement);
    const paddingLeft = Number.parseFloat(computedStyle.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computedStyle.paddingRight) || 0;
    const availableWidth = Math.max(320, containerWidth - paddingLeft - paddingRight);
    const targetScale = Math.max(0.2, availableWidth / pageWidth) * this.zoomScale;
    const deviceScale = Math.max(1, window.devicePixelRatio || 1);
    const cssWidth = Math.max(1, Math.round(pageWidth * targetScale * deviceScale) / deviceScale);
    const scale = cssWidth / pageWidth;
    return {
      scale,
      cssWidth,
      cssHeight: Math.max(1, pageHeight * scale),
    };
  }

  getVirtualizationMargin() {
    return Math.min(
      PDF_READER_MAX_VIRTUALIZATION_MARGIN_PX,
      Math.max(
        PDF_READER_VIRTUALIZATION_MARGIN_PX,
        this.pagesElement.clientHeight * PDF_READER_VIRTUALIZATION_VIEWPORTS,
      ),
    );
  }

  getOrderedVisibleShells(shells: readonly PdfPageShell[]): PdfVisibleShell[] {
    if (shells.length === 0) {
      return [];
    }

    const viewportHeight = this.pagesElement.clientHeight;
    if (viewportHeight <= 0) {
      return shells.slice(0, 2).map((shell) => ({ shell, priority: 0 }));
    }

    const viewportTop = this.pagesElement.scrollTop;
    const viewportBottom = viewportTop + viewportHeight;
    const viewportCenter = viewportTop + viewportHeight / 2;
    const margin = this.getVirtualizationMargin();
    const direction = this.scrollDirection;
    const visibleShells = shells
      .map((shell) => {
        const pageTop = shell.pageElement.offsetTop;
        const pageBottom = pageTop + shell.pageElement.offsetHeight;
        const intersectsViewport = pageBottom >= viewportTop && pageTop <= viewportBottom;
        const isNearViewport = (
          pageBottom >= viewportTop - margin &&
          pageTop <= viewportBottom + margin
        );
        const distance = intersectsViewport
          ? Math.abs((pageTop + pageBottom) / 2 - viewportCenter)
          : pageTop > viewportBottom
            ? pageTop - viewportBottom
            : viewportTop - pageBottom;
        const isAhead = direction > 0
          ? pageTop >= viewportTop
          : direction < 0
            ? pageBottom <= viewportBottom
            : false;
        const priority = intersectsViewport ? 0 : isAhead ? 1 : 2;
        return {
          shell,
          isNearViewport,
          priority,
          distance,
        };
      })
      .filter((entry) => entry.isNearViewport)
      .sort((a, b) =>
        a.priority - b.priority ||
        a.distance - b.distance ||
        a.shell.pageNumber - b.shell.pageNumber,
      )
      .map((entry) => ({
        shell: entry.shell,
        priority: entry.priority,
      }));
    return visibleShells.length > 0
      ? visibleShells
      : shells.slice(0, 2).map((shell) => ({ shell, priority: 0 }));
  }

  isShellNearViewport(shell: PdfPageShell, margin: number) {
    const viewportTop = this.pagesElement.scrollTop;
    const viewportBottom = viewportTop + this.pagesElement.clientHeight;
    const pageTop = shell.pageElement.offsetTop;
    const pageBottom = pageTop + shell.pageElement.offsetHeight;
    return (
      pageBottom >= viewportTop - margin &&
      pageTop <= viewportBottom + margin
    );
  }
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
  private readonly annotationPanelElement = createElement('aside', 'pdf-annotation-panel');
  private readonly annotationPanelTitleElement = createElement('div', 'pdf-annotation-panel-title');
  private readonly annotationPanelCloseButton = createElement('button', 'pdf-annotation-panel-close');
  private readonly annotationPanelQuoteElement = createElement('div', 'pdf-annotation-panel-quote');
  private readonly annotationPanelCommentInput = createElement('textarea', 'pdf-annotation-panel-comment');
  private readonly annotationPanelSaveButton = createElement('button', 'pdf-annotation-panel-save');
  private readonly annotationPanelDeleteButton = createElement('button', 'pdf-annotation-panel-delete');
  private readonly store = new PdfAnnotationStore();
  private readonly unsubscribeStore: () => void;
  private selectedAnnotationId: string | null = null;
  private renderedUrl = '';
  private loadVersion = 0;
  private pageRenderVersion = 0;
  private zoomRenderTimer: number | null = null;
  private viewportQualityRenderFrame: number | null = null;
  private readonly viewportModel = new PdfViewportModel(this.pagesElement, this.surfaceElement);
  private readonly renderScheduler = new PdfRenderScheduler();
  private readonly pageShells = new Map<number, PdfPageShell>();
  private readonly workerSupportStatus: PdfRenderWorkerSupportStatus;
  private readonly viewportTileCache = new Map<string, PdfViewportTileCacheEntry>();
  private viewportTileCacheAccessSequence = 0;
  private viewportTileCacheMemoryBytes = 0;
  private viewportTileCacheMaxBytes = PDF_READER_VIEWPORT_TILE_CACHE_MAX_BYTES;
  private documentHandle: PdfiumDocumentHandle | null = null;
  private pdfRenderWorkerClient: PdfiumRenderWorkerClient | null = null;
  private pdfRenderWorkerReady: Promise<void> | null = null;
  private pdfRenderWorkerDocumentId = 0;
  private pdfRenderWorkerAvailable = false;
  private readonly pageRenderInfoByPage = new Map<number, PdfReviewerPageInfo>();
  private readonly pageTextCharsByPage = new Map<number, readonly PdfTextChar[]>();
  private isSelectingText = false;
  private lastChromeSnapshot: PdfAnnotationStoreSnapshot | null = null;
  private lastChromeSelectedAnnotationId: string | null = null;
  private readonly pendingAnnotationAnchorMigrations = new Map<string, Annotation>();
  private isAnnotationAnchorMigrationFlushScheduled = false;
  private renderDiagnostics: PdfRenderDiagnostics = {
    pageRenderCount: 0,
    pageRenderTotalMs: 0,
    pageRenderMaxMs: 0,
    tileRenderCount: 0,
    tileRenderTotalMs: 0,
    tileRenderMaxMs: 0,
    workerTileRenderCount: 0,
    workerTileRenderFallbackCount: 0,
    workerTileRenderErrorCount: 0,
    workerPageRenderCount: 0,
    workerPageRenderFallbackCount: 0,
    workerPageRenderErrorCount: 0,
    progressiveRenderYieldCount: 0,
    progressiveRenderFallbackCount: 0,
    renderBudgetYieldCount: 0,
    inputPendingYieldCount: 0,
    qualityDeferralCount: 0,
    qualityRetryCount: 0,
    renderStaleCount: 0,
    tileCacheEvictionCount: 0,
    textCacheHits: 0,
    textCacheMisses: 0,
  };
  private readonly resizeObserver: ResizeObserver | null =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => this.handleReaderResize());
  private readonly selectionController = new PdfSelectionController({
    pagesElement: this.pagesElement,
    pageInfoByPage: this.pageRenderInfoByPage,
    onSelectionChange: (selection) => this.store.setSelection(selection),
    onHitTestStatusChange: (hitTest) => this.updateHitTestStatus(hitTest),
    onSelectionDragChange: (isDragging) => this.handleSelectionDragChange(isDragging),
  });
  private readerStatus: PdfReaderRuntimeStatus = {
    state: 'idle',
    message: 'No PDF loaded',
  };

  constructor(props: PdfDocumentReaderProps) {
    this.props = props;
    this.workerSupportStatus = getPdfRenderWorkerSupportStatus();
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
    this.annotationPanelCloseButton.type = 'button';
    this.annotationPanelCloseButton.textContent = 'Close';
    this.annotationPanelCloseButton.addEventListener('click', this.handleAnnotationPanelClose);
    this.annotationPanelSaveButton.type = 'button';
    this.annotationPanelSaveButton.textContent = 'Save';
    this.annotationPanelSaveButton.addEventListener('click', this.handleAnnotationPanelSave);
    this.annotationPanelDeleteButton.type = 'button';
    this.annotationPanelDeleteButton.textContent = 'Delete';
    this.annotationPanelDeleteButton.addEventListener('click', this.handleAnnotationPanelDelete);
    const annotationPanelHeader = createElement('div', 'pdf-annotation-panel-header');
    const annotationPanelActions = createElement('div', 'pdf-annotation-panel-actions');
    annotationPanelHeader.append(
      this.annotationPanelTitleElement,
      this.annotationPanelCloseButton,
    );
    annotationPanelActions.append(
      this.annotationPanelDeleteButton,
      this.annotationPanelSaveButton,
    );
    this.annotationPanelCommentInput.rows = 5;
    this.annotationPanelCommentInput.placeholder = 'Add a note';
    this.annotationPanelElement.hidden = true;
    this.annotationPanelElement.append(
      annotationPanelHeader,
      this.annotationPanelQuoteElement,
      this.annotationPanelCommentInput,
      annotationPanelActions,
    );
    this.emptyOpenElement.append(this.openPdfButton);
    this.readerElement.append(
      this.loadingElement,
      this.pagesElement,
      this.unavailableElement,
    );
    this.surfaceElement.append(
      this.readerElement,
      this.emptyOpenElement,
      this.annotationPanelElement,
    );
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
    this.annotationPanelCloseButton.removeEventListener('click', this.handleAnnotationPanelClose);
    this.annotationPanelSaveButton.removeEventListener('click', this.handleAnnotationPanelSave);
    this.annotationPanelDeleteButton.removeEventListener('click', this.handleAnnotationPanelDelete);
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
    this.clearScheduledViewportQualityRender();
    this.renderScheduler.cancel();
    this.clearInstantZoomPreview();
    this.disposePdfRenderWorker();
    this.closePdfiumDocument(this.documentHandle);
    this.documentHandle = null;
    this.viewportModel.reset();
    this.selectionController.reset();
    this.clearViewportTileCache();
    this.pageShells.clear();
    this.pageRenderInfoByPage.clear();
    this.pageTextCharsByPage.clear();
    this.pendingAnnotationAnchorMigrations.clear();
    this.isAnnotationAnchorMigrationFlushScheduled = false;
    this.resetRenderDiagnostics();
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

      this.preparePdfRenderWorker(pdfData, version);
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
        this.viewportModel.setRenderedZoomScale(this.viewportModel.getZoomScale());
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

      this.disposePdfRenderWorker();
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

    if (!this.props.nativeHost.canInvoke()) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch PDF: ${response.status} ${response.statusText}`);
      }

      return new Uint8Array(await response.arrayBuffer());
    }

    const result = await this.props.nativeHost.invoke('read_pdf_file', {
      resource: URI.parse(url, true).toJSON(),
    });
    return new Uint8Array(result.data);
  }

  private setReaderStatus(status: PdfReaderRuntimeStatus) {
    const nextStatus = {
      ...status,
      hitTest: status.hitTest ?? this.readerStatus.hitTest,
    };
    if (
      this.readerStatus.state === nextStatus.state &&
      this.readerStatus.message === nextStatus.message &&
      this.readerStatus.detail === nextStatus.detail &&
      this.readerStatus.hitTest === nextStatus.hitTest
    ) {
      return;
    }

    this.readerStatus = nextStatus;
    this.element.dataset.pdfReaderState = nextStatus.state;
    this.element.dataset.pdfReaderStatus = nextStatus.message;
    delete this.element.dataset.pdfReaderErrorDetail;
    delete this.loadingElement.dataset.pdfReaderErrorDetail;
    this.loadingElement.title = nextStatus.detail ?? nextStatus.message;

    if (nextStatus.detail) {
      this.element.dataset.pdfReaderErrorDetail = nextStatus.detail;
      this.loadingElement.dataset.pdfReaderErrorDetail = nextStatus.detail;
    }

    this.props.onReaderStatusChange?.(nextStatus);
  }

  private updateHitTestStatus(hitTest: PdfSelectionHitTestStatus | null) {
    const nextStatus: PdfReaderRuntimeStatus = hitTest
      ? {
          ...this.readerStatus,
          hitTest,
        }
      : {
          state: this.readerStatus.state,
          message: this.readerStatus.message,
          detail: this.readerStatus.detail,
        };
    if (
      this.readerStatus.state === nextStatus.state &&
      this.readerStatus.message === nextStatus.message &&
      this.readerStatus.detail === nextStatus.detail &&
      this.readerStatus.hitTest === nextStatus.hitTest
    ) {
      return;
    }

    this.readerStatus = nextStatus;
    this.props.onReaderStatusChange?.(nextStatus);
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

  private preparePdfRenderWorker(pdfData: Uint8Array, version: number) {
    this.disposePdfRenderWorker();
    if (!this.workerSupportStatus.supported) {
      this.publishRenderDiagnostics();
      return;
    }

    const client = new PdfiumRenderWorkerClient();
    const documentId = this.pdfRenderWorkerDocumentId + 1;
    this.pdfRenderWorkerClient = client;
    this.pdfRenderWorkerDocumentId = documentId;
    this.pdfRenderWorkerAvailable = false;
    this.pdfRenderWorkerReady = (async () => {
      try {
        await client.init();
        await client.openDocument(documentId, pdfData);
        if (
          version !== this.loadVersion ||
          this.pdfRenderWorkerClient !== client ||
          this.pdfRenderWorkerDocumentId !== documentId
        ) {
          client.dispose();
          return;
        }

        this.pdfRenderWorkerAvailable = true;
        this.publishRenderDiagnostics();
      } catch (error) {
        if (this.pdfRenderWorkerClient === client) {
          this.pdfRenderWorkerClient = null;
          this.pdfRenderWorkerReady = null;
          this.pdfRenderWorkerAvailable = false;
          this.recordWorkerTileRenderError();
        }
        client.dispose();
        console.warn('PDFium render worker is unavailable; falling back to main-thread rendering.', error);
      }
    })();
  }

  private disposePdfRenderWorker() {
    const client = this.pdfRenderWorkerClient;
    this.pdfRenderWorkerClient = null;
    this.pdfRenderWorkerReady = null;
    this.pdfRenderWorkerAvailable = false;
    if (client) {
      client.dispose();
    }
    this.publishRenderDiagnostics();
  }

  private createPdfPageShells(
    documentHandle: PdfiumDocumentHandle,
    version: number,
    pageRenderVersion: number,
  ) {
    const fragment = document.createDocumentFragment();
    this.pageShells.clear();
    this.pageRenderInfoByPage.clear();
    this.pageTextCharsByPage.clear();
    this.resetRenderDiagnostics();
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
    const tileLayer = createElement('div', 'pdf-reader-page-tile-layer');
    const highlightLayer = createElement('div', 'pdf-reader-highlight-layer');
    const geometry = this.getPageGeometry(pageWidth, pageHeight);

    pageElement.dataset.pdfPage = String(pageNumber);
    pageMetaElement.textContent = `Page ${pageNumber}`;
    pageCanvasWrap.style.width = `${geometry.cssWidth}px`;
    pageCanvasWrap.style.height = `${geometry.cssHeight}px`;
    pageCanvasWrap.dataset.renderedWidth = String(geometry.cssWidth);
    pageCanvasWrap.dataset.renderedHeight = String(geometry.cssHeight);
    tileLayer.style.width = `${geometry.cssWidth}px`;
    tileLayer.style.height = `${geometry.cssHeight}px`;
    highlightLayer.style.width = `${geometry.cssWidth}px`;
    highlightLayer.style.height = `${geometry.cssHeight}px`;
    pageCanvasWrap.append(tileLayer, highlightLayer);
    pageElement.append(pageMetaElement, pageCanvasWrap);

    return {
      pageNumber,
      pageWidth,
      pageHeight,
      scale: geometry.scale,
      outputScale: 0,
      cssWidth: geometry.cssWidth,
      cssHeight: geometry.cssHeight,
      pageElement,
      pageCanvasWrap,
      tileLayer,
      tileCache: new Map(),
      tileOutputScale: 0,
      highlightLayer,
      canvas: null,
      renderState: 'empty',
      lastVisibleAt: 0,
    };
  }

  private getPageGeometry(pageWidth: number, pageHeight: number): PdfPageGeometry {
    return this.viewportModel.getPageGeometry(pageWidth, pageHeight);
  }

  private getRenderedShellSize(shell: PdfPageShell) {
    const renderedWidth = Number(shell.pageCanvasWrap.dataset.renderedWidth);
    const renderedHeight = Number(shell.pageCanvasWrap.dataset.renderedHeight);
    if (
      Number.isFinite(renderedWidth) &&
      renderedWidth > 0 &&
      Number.isFinite(renderedHeight) &&
      renderedHeight > 0
    ) {
      return {
        width: renderedWidth,
        height: renderedHeight,
      };
    }

    return {
      width: shell.cssWidth,
      height: shell.cssHeight,
    };
  }

  private setShellLayoutSize(
    shell: PdfPageShell,
    geometry: PdfPageGeometry,
  ) {
    shell.pageCanvasWrap.style.width = `${geometry.cssWidth}px`;
    shell.pageCanvasWrap.style.height = `${geometry.cssHeight}px`;
  }

  private setShellTargetGeometry(
    shell: PdfPageShell,
    geometry: PdfPageGeometry,
  ) {
    if (
      Math.abs(shell.scale - geometry.scale) > 0.001 ||
      Math.abs(shell.cssWidth - geometry.cssWidth) > 1 ||
      Math.abs(shell.cssHeight - geometry.cssHeight) > 1
    ) {
      this.clearShellViewportTiles(shell);
    }
    shell.scale = geometry.scale;
    shell.cssWidth = geometry.cssWidth;
    shell.cssHeight = geometry.cssHeight;
    this.setShellLayoutSize(shell, geometry);
    this.syncPageInfoGeometry(shell);
  }

  private syncPageInfoGeometry(shell: PdfPageShell) {
    const info = this.pageRenderInfoByPage.get(shell.pageNumber);
    if (!info) {
      return;
    }

    this.pageRenderInfoByPage.set(shell.pageNumber, {
      ...info,
      pageWidth: shell.pageWidth,
      pageHeight: shell.pageHeight,
      scale: shell.scale,
      canvas: shell.canvas ?? info.canvas,
      highlightLayer: shell.highlightLayer,
    });
  }

  private commitShellGeometry(
    shell: PdfPageShell,
    geometry: PdfPageGeometry,
  ) {
    this.setShellTargetGeometry(shell, geometry);
    shell.pageCanvasWrap.dataset.renderedWidth = String(geometry.cssWidth);
    shell.pageCanvasWrap.dataset.renderedHeight = String(geometry.cssHeight);
    shell.tileLayer.style.width = `${geometry.cssWidth}px`;
    shell.tileLayer.style.height = `${geometry.cssHeight}px`;
    shell.highlightLayer.style.width = `${geometry.cssWidth}px`;
    shell.highlightLayer.style.height = `${geometry.cssHeight}px`;
  }

  private isShellRenderedAtCurrentGeometry(
    shell: PdfPageShell,
    requiredOutputScale = 1,
  ) {
    const renderedSize = this.getRenderedShellSize(shell);
    return (
      shell.renderState === 'rendered' &&
      Math.abs(renderedSize.width - shell.cssWidth) <= 1 &&
      Math.abs(renderedSize.height - shell.cssHeight) <= 1 &&
      shell.outputScale >= requiredOutputScale - 0.01
    );
  }

  private clearShellViewportTiles(shell: PdfPageShell) {
    for (const key of shell.tileCache.keys()) {
      this.deleteViewportTileCacheEntry(shell, key);
    }
    shell.tileCache.clear();
    shell.tileOutputScale = 0;
    shell.tileLayer.replaceChildren();
  }

  private clearAllShellViewportTiles() {
    for (const shell of this.pageShells.values()) {
      this.clearShellViewportTiles(shell);
    }
  }

  private clearViewportTileCache() {
    for (const entry of this.viewportTileCache.values()) {
      entry.canvas.remove();
    }
    this.viewportTileCache.clear();
    this.viewportTileCacheAccessSequence = 0;
    this.viewportTileCacheMemoryBytes = 0;
    this.publishRenderDiagnostics();
  }

  private getViewportTileCacheKey(shell: PdfPageShell, tileKey: string) {
    return `${shell.pageNumber}:${tileKey}`;
  }

  private getViewportTileMemoryBytes(canvas: HTMLCanvasElement) {
    return Math.max(0, canvas.width) * Math.max(0, canvas.height) * 4;
  }

  private nextViewportTileCacheAccess() {
    this.viewportTileCacheAccessSequence += 1;
    return this.viewportTileCacheAccessSequence;
  }

  private touchViewportTileCacheEntry(shell: PdfPageShell, tileKey: string) {
    const entry = this.viewportTileCache.get(this.getViewportTileCacheKey(shell, tileKey));
    if (!entry) {
      return;
    }
    entry.lastUsedAt = this.nextViewportTileCacheAccess();
  }

  private addShellViewportTile(
    shell: PdfPageShell,
    tile: PdfViewportTile,
    canvas: HTMLCanvasElement,
    outputScale: number,
  ) {
    const cacheKey = this.getViewportTileCacheKey(shell, tile.key);
    const previousEntry = this.viewportTileCache.get(cacheKey);
    if (previousEntry) {
      this.viewportTileCacheMemoryBytes -= previousEntry.memoryBytes;
      previousEntry.canvas.remove();
    }

    shell.tileCache.set(tile.key, canvas);
    shell.tileOutputScale = outputScale;
    this.viewportTileCache.set(cacheKey, {
      shell,
      tileKey: tile.key,
      canvas,
      memoryBytes: this.getViewportTileMemoryBytes(canvas),
      lastUsedAt: this.nextViewportTileCacheAccess(),
    });
    this.viewportTileCacheMemoryBytes += this.viewportTileCache.get(cacheKey)?.memoryBytes ?? 0;
    this.pruneViewportTileCache();
    this.publishRenderDiagnostics();
  }

  private deleteViewportTileCacheEntry(shell: PdfPageShell, tileKey: string) {
    const cacheKey = this.getViewportTileCacheKey(shell, tileKey);
    const entry = this.viewportTileCache.get(cacheKey);
    if (!entry) {
      return false;
    }

    this.viewportTileCache.delete(cacheKey);
    this.viewportTileCacheMemoryBytes = Math.max(
      0,
      this.viewportTileCacheMemoryBytes - entry.memoryBytes,
    );
    entry.canvas.remove();
    return true;
  }

  private getCurrentViewportTileCacheKeys() {
    const protectedKeys = new Set<string>();
    for (const { shell, priority } of this.getVisiblePageShells()) {
      if (priority !== 0) {
        continue;
      }
      for (const tile of this.getViewportTilesForShell(shell)) {
        if (shell.tileCache.has(tile.key)) {
          protectedKeys.add(this.getViewportTileCacheKey(shell, tile.key));
        }
      }
    }
    return protectedKeys;
  }

  private pruneViewportTileCache(protectedTileKeys = this.getCurrentViewportTileCacheKeys()) {
    if (this.viewportTileCacheMemoryBytes <= this.viewportTileCacheMaxBytes) {
      return;
    }

    const candidates = [...this.viewportTileCache.entries()]
      .filter(([cacheKey]) => !protectedTileKeys.has(cacheKey))
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

    for (const [cacheKey, entry] of candidates) {
      if (this.viewportTileCacheMemoryBytes <= this.viewportTileCacheMaxBytes) {
        break;
      }

      this.viewportTileCache.delete(cacheKey);
      this.viewportTileCacheMemoryBytes = Math.max(
        0,
        this.viewportTileCacheMemoryBytes - entry.memoryBytes,
      );
      entry.shell.tileCache.delete(entry.tileKey);
      entry.canvas.remove();
      this.renderDiagnostics.tileCacheEvictionCount += 1;
    }

    this.publishRenderDiagnostics();
  }

  private clearShellInstantZoomPreview(shell: PdfPageShell) {
    let didClearPreview = false;
    this.clearShellPreviewCanvases(shell);
    for (const previewLayer of shell.pageCanvasWrap.children) {
      if (previewLayer instanceof HTMLElement) {
        if (previewLayer.style.transform) {
          previewLayer.style.transform = '';
          didClearPreview = true;
        }
      }
    }
    if (shell.highlightLayer.style.transform) {
      didClearPreview = true;
    }
    shell.highlightLayer.style.width = `${shell.cssWidth}px`;
    shell.highlightLayer.style.height = `${shell.cssHeight}px`;
    return didClearPreview;
  }

  private updateInstantZoomPreviewClass() {
    const hasPreview = [...this.pageShells.values()].some((shell) =>
      [...shell.pageCanvasWrap.children].some((previewLayer) =>
        previewLayer instanceof HTMLElement &&
        !previewLayer.classList.contains('pdf-reader-page-preview-canvas') &&
        Boolean(previewLayer.style.transform),
      ),
    );
    this.pagesElement.classList.toggle('is-zoom-previewing', hasPreview);
  }

  private clearShellPreviewCanvases(shell: PdfPageShell) {
    for (const previewCanvas of shell.pageCanvasWrap.querySelectorAll('.pdf-reader-page-preview-canvas')) {
      previewCanvas.remove();
    }
  }

  private createShellPreviewCanvas(sourceCanvas: HTMLCanvasElement | null) {
    if (!sourceCanvas?.isConnected || !sourceCanvas.style.transform) {
      return null;
    }

    return {
      canvas: sourceCanvas,
      transform: sourceCanvas.style.transform,
    };
  }

  private fadeOutShellPreviewCanvas(
    shell: PdfPageShell,
    previewCanvas: { canvas: HTMLCanvasElement; transform: string } | null,
  ) {
    if (!previewCanvas) {
      return;
    }

    const { canvas } = previewCanvas;
    this.clearShellPreviewCanvases(shell);
    canvas.classList.add('pdf-reader-page-preview-canvas');
    canvas.classList.remove('is-fading');
    canvas.style.transform = previewCanvas.transform;
    canvas.setAttribute('aria-hidden', 'true');
    shell.pageCanvasWrap.append(canvas);
    const removePreviewCanvas = () => canvas.remove();
    canvas.addEventListener('transitionend', removePreviewCanvas, { once: true });
    window.setTimeout(removePreviewCanvas, 140);
    window.requestAnimationFrame(() => {
      if (canvas.isConnected) {
        canvas.classList.add('is-fading');
      }
    });
  }

  private getOutputScale(
    cssWidth: number,
    cssHeight: number,
    quality: PdfRenderQuality = 'quality',
  ) {
    const deviceScale = window.devicePixelRatio || 1;
    const preferredScale = quality === 'interactive'
      ? Math.min(PDF_READER_INTERACTIVE_MAX_OUTPUT_SCALE, Math.max(1, deviceScale))
      : Math.min(
          PDF_READER_MAX_OUTPUT_SCALE,
          Math.max(PDF_READER_MIN_OUTPUT_SCALE, deviceScale),
        );
    const cssPixels = Math.max(1, cssWidth * cssHeight);
    const bitmapBudgetScale = Math.sqrt(PDF_READER_MAX_BITMAP_PIXELS / cssPixels);
    return Math.max(1, Math.min(preferredScale, bitmapBudgetScale));
  }

  private async waitForNextFrame() {
    await new Promise<void>((resolve) => {
      let didResolve = false;
      let timeout: number | null = null;
      const resolveOnce = () => {
        if (didResolve) {
          return;
        }
        didResolve = true;
        if (timeout !== null) {
          window.clearTimeout(timeout);
        }
        resolve();
      };
      // Electron smoke and backgrounded windows can delay rAF long enough to
      // suspend the PDF render queue, so keep a short timer as the yield floor.
      timeout = window.setTimeout(resolveOnce, PDF_READER_RENDER_YIELD_TIMEOUT_MS);
      window.requestAnimationFrame(resolveOnce);
    });
  }

  private hasPendingUserInput() {
    const scheduling = (navigator as PdfInputPendingNavigator).scheduling;
    return Boolean(scheduling?.isInputPending?.({ includeContinuous: true }));
  }

  private async yieldForPendingUserInput() {
    if (this.hasPendingUserInput()) {
      this.recordInputPendingYield();
      await this.waitForNextFrame();
    }
  }

  private async yieldForRenderBudget(sliceStartedAt: number) {
    if (performance.now() - sliceStartedAt >= PDF_READER_RENDER_TIME_SLICE_MS) {
      this.recordRenderBudgetYield();
      await this.waitForNextFrame();
      return performance.now();
    }

    return sliceStartedAt;
  }

  private isVisibleRenderStale(renderToken?: PdfRenderToken) {
    const isStale = Boolean(renderToken?.isStale());
    if (isStale) {
      this.recordStaleRender();
    }
    return isStale;
  }

  private async renderVisiblePdfPages(
    version: number,
    pageRenderVersion: number,
    renderToken?: PdfRenderToken,
    options: {
      maxPriority?: number;
      quality?: PdfRenderQuality;
    } = {},
  ) {
    const documentHandle = this.documentHandle;
    if (!documentHandle) {
      return;
    }

    const visibleShells = this.getVisiblePageShells()
      .filter(({ priority }) =>
        options.maxPriority === undefined || priority <= options.maxPriority,
      );
    let didCommitViewportRender = false;
    let didYieldAfterViewportRender = false;
    let renderSliceStartedAt = performance.now();

    for (const { shell, priority } of visibleShells) {
      if (
        version !== this.loadVersion ||
        pageRenderVersion !== this.pageRenderVersion ||
        this.isVisibleRenderStale(renderToken)
      ) {
        return;
      }
      await this.yieldForPendingUserInput();
      renderSliceStartedAt = await this.yieldForRenderBudget(renderSliceStartedAt);
      if (
        version !== this.loadVersion ||
        pageRenderVersion !== this.pageRenderVersion ||
        this.isVisibleRenderStale(renderToken)
      ) {
        return;
      }
      if (
        priority > 0 &&
        didCommitViewportRender &&
        !didYieldAfterViewportRender
      ) {
        await this.waitForNextFrame();
        didYieldAfterViewportRender = true;
        if (
          version !== this.loadVersion ||
          pageRenderVersion !== this.pageRenderVersion ||
          this.isVisibleRenderStale(renderToken)
        ) {
          return;
        }
      }
      shell.lastVisibleAt = performance.now();
      const didCommitRender = await this.renderPdfPageIntoShell(
        documentHandle,
        shell,
        version,
        pageRenderVersion,
        {
          quality: options.quality ?? 'quality',
        },
      );
      if (
        version !== this.loadVersion ||
        pageRenderVersion !== this.pageRenderVersion ||
        this.isVisibleRenderStale(renderToken)
      ) {
        return;
      }
      if (didCommitRender) {
        if (priority === 0) {
          didCommitViewportRender = true;
        } else {
          await this.waitForNextFrame();
          if (
            version !== this.loadVersion ||
            pageRenderVersion !== this.pageRenderVersion ||
            this.isVisibleRenderStale(renderToken)
          ) {
            return;
          }
        }
      }
    }

    this.evictDistantRenderedPages();
  }

  private getVisiblePageShells() {
    const shells = [...this.pageShells.values()];
    return this.viewportModel.getOrderedVisibleShells(shells);
  }

  private hasRenderingVisibleShell() {
    return this.getVisiblePageShells().some(({ shell }) => shell.renderState === 'rendering');
  }

  private isShellNearViewport(shell: PdfPageShell, margin: number) {
    return this.viewportModel.isShellNearViewport(shell, margin);
  }

  private async renderPdfPageIntoShell(
    documentHandle: PdfiumDocumentHandle,
    shell: PdfPageShell,
    version: number,
    pageRenderVersion: number,
    options: { quality?: PdfRenderQuality } = {},
  ) {
    if (shell.renderState === 'rendering') {
      return false;
    }

    const outputScale = this.getOutputScale(
      shell.cssWidth,
      shell.cssHeight,
      options.quality ?? 'quality',
    );

    if (this.isShellRenderedAtCurrentGeometry(shell, outputScale)) {
      if (this.clearShellInstantZoomPreview(shell)) {
        this.updateInstantZoomPreviewClass();
      }
      this.clearShellPreviewCanvases(shell);
      this.clearShellViewportTiles(shell);
      return false;
    }

    const previousRenderState = shell.renderState;
    const previousCanvas = shell.canvas;
    shell.renderState = 'rendering';
    const pagePtr = documentHandle.pdfium.FPDF_LoadPage(
      documentHandle.documentPtr,
      shell.pageNumber - 1,
    );
    if (!pagePtr) {
      shell.renderState = previousRenderState;
      throw new Error(`PDFium failed to load page ${shell.pageNumber}.`);
    }

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');

    if (!context) {
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
      shell.renderState = previousRenderState;
      return false;
    }

    let didCommitRender = false;
    const renderStartedAt = performance.now();
    try {
      const bitmapWidth = Math.max(1, Math.round(shell.cssWidth * outputScale));
      const bitmapHeight = Math.max(1, Math.round(shell.cssHeight * outputScale));

      canvas.width = bitmapWidth;
      canvas.height = bitmapHeight;
      canvas.style.width = `${shell.cssWidth}px`;
      canvas.style.height = `${shell.cssHeight}px`;

      if (version !== this.loadVersion || pageRenderVersion !== this.pageRenderVersion) {
        return false;
      }

      if (!await this.tryRenderPdfPageWithWorker(shell, bitmapWidth, bitmapHeight, context)) {
        const bitmapPtr = documentHandle.pdfium.FPDFBitmap_Create(bitmapWidth, bitmapHeight, 0);
        if (!bitmapPtr) {
          throw new Error(`PDFium failed to create bitmap for page ${shell.pageNumber}.`);
        }

        try {
          documentHandle.pdfium.FPDFBitmap_FillRect(
            bitmapPtr,
            0,
            0,
            bitmapWidth,
            bitmapHeight,
            0xFFFFFFFF,
          );
          await this.renderPdfPageBitmap(
            documentHandle,
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
          this.copyPdfBitmapToCanvas(
            documentHandle,
            bufferPtr,
            stride,
            bitmapWidth,
            bitmapHeight,
            context,
          );
        } finally {
          documentHandle.pdfium.FPDFBitmap_Destroy(bitmapPtr);
        }
      }

      if (version !== this.loadVersion || pageRenderVersion !== this.pageRenderVersion) {
        return false;
      }

      const previewCanvas = this.createShellPreviewCanvas(previousCanvas);
      const didClearPreview = this.clearShellInstantZoomPreview(shell);
      this.clearShellViewportTiles(shell);
      if (previousCanvas?.isConnected) {
        previousCanvas.replaceWith(canvas);
      } else {
        shell.pageCanvasWrap.prepend(canvas);
      }
      shell.canvas = canvas;
      shell.outputScale = outputScale;
      this.commitShellGeometry(shell, {
        scale: shell.scale,
        cssWidth: shell.cssWidth,
        cssHeight: shell.cssHeight,
      });
      shell.renderState = 'rendered';
      didCommitRender = true;
      this.pageRenderInfoByPage.set(shell.pageNumber, {
        page: shell.pageNumber,
        pageWidth: shell.pageWidth,
        pageHeight: shell.pageHeight,
        scale: shell.scale,
        canvas,
        highlightLayer: shell.highlightLayer,
        chars: this.getPageTextChars(documentHandle, pagePtr, shell.pageNumber),
      });
      this.refreshRenderedTextCharCount();
      this.renderHighlightsForPage(shell.pageNumber);
      if (didClearPreview) {
        this.updateInstantZoomPreviewClass();
      }
      this.fadeOutShellPreviewCanvas(shell, previewCanvas);
      this.recordPageRenderDuration(performance.now() - renderStartedAt);
    } finally {
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
      if (!didCommitRender && shell.renderState === 'rendering') {
        shell.renderState = previousRenderState;
      }
    }
    return didCommitRender;
  }

  private copyPdfBitmapToCanvas(
    documentHandle: PdfiumDocumentHandle,
    bufferPtr: number,
    stride: number,
    bitmapWidth: number,
    bitmapHeight: number,
    context: CanvasRenderingContext2D,
  ) {
    const rowSize = bitmapWidth * 4;
    const pixels = new Uint8ClampedArray(rowSize * bitmapHeight);

    for (let y = 0; y < bitmapHeight; y += 1) {
      const rowStart = bufferPtr + y * stride;
      const row = documentHandle.pdfium.pdfium.HEAPU8.subarray(rowStart, rowStart + rowSize);
      pixels.set(row, y * rowSize);
    }

    context.putImageData(new ImageData(pixels, bitmapWidth, bitmapHeight), 0, 0);
  }

  private async tryRenderPdfPageWithWorker(
    shell: PdfPageShell,
    bitmapWidth: number,
    bitmapHeight: number,
    context: CanvasRenderingContext2D,
  ) {
    const client = this.pdfRenderWorkerClient;
    const workerReady = this.pdfRenderWorkerReady;
    const documentId = this.pdfRenderWorkerDocumentId;
    if (!client || !workerReady || documentId <= 0 || !this.pdfRenderWorkerAvailable) {
      this.recordWorkerPageRenderFallback();
      return false;
    }

    try {
      await workerReady;
      if (this.pdfRenderWorkerClient !== client) {
        this.recordWorkerPageRenderFallback();
        return false;
      }

      const workerPage: PdfWorkerPageRenderRequest = {
        pageNumber: shell.pageNumber,
        bitmapWidth,
        bitmapHeight,
        rotate: 0,
        flags: PDF_RENDER_FLAGS,
      };
      const renderedPage = await client.renderPage(documentId, workerPage);
      if (
        renderedPage.documentId !== documentId ||
        renderedPage.pageNumber !== shell.pageNumber ||
        renderedPage.bitmapWidth !== bitmapWidth ||
        renderedPage.bitmapHeight !== bitmapHeight ||
        renderedPage.pixels.byteLength !== bitmapWidth * bitmapHeight * 4
      ) {
        throw new Error(`PDFium render worker returned an invalid page for page ${shell.pageNumber}.`);
      }

      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(renderedPage.pixels),
          bitmapWidth,
          bitmapHeight,
        ),
        0,
        0,
      );
      this.recordWorkerPageRender();
      return true;
    } catch (error) {
      if (this.pdfRenderWorkerClient === client) {
        this.pdfRenderWorkerClient = null;
        this.pdfRenderWorkerReady = null;
        this.pdfRenderWorkerAvailable = false;
        client.dispose();
      }
      this.recordWorkerPageRenderError();
      console.warn('PDFium render worker page failed; falling back to main-thread rendering.', error);
      return false;
    }
  }

  private canRenderPdfPageBitmapProgressively(documentHandle: PdfiumDocumentHandle) {
    const pdfium = documentHandle.pdfium;
    const runtime = pdfium.pdfium;
    return (
      typeof pdfium.FPDF_RenderPageBitmap_Start === 'function' &&
      typeof pdfium.FPDF_RenderPage_Continue === 'function' &&
      typeof pdfium.FPDF_RenderPage_Close === 'function' &&
      typeof runtime.addFunction === 'function' &&
      typeof runtime.removeFunction === 'function' &&
      typeof runtime.setValue === 'function' &&
      typeof runtime.wasmExports?.malloc === 'function' &&
      typeof runtime.wasmExports?.free === 'function'
    );
  }

  private async renderPdfPageBitmap(
    documentHandle: PdfiumDocumentHandle,
    bitmapPtr: number,
    pagePtr: number,
    startX: number,
    startY: number,
    sizeX: number,
    sizeY: number,
    rotate: number,
    flags: number,
  ) {
    if (!this.canRenderPdfPageBitmapProgressively(documentHandle)) {
      this.recordProgressiveRenderFallback();
      documentHandle.pdfium.FPDF_RenderPageBitmap(
        bitmapPtr,
        pagePtr,
        startX,
        startY,
        sizeX,
        sizeY,
        rotate,
        flags,
      );
      return;
    }

    const pdfium = documentHandle.pdfium;
    const runtime = pdfium.pdfium;
    let sliceStartedAt = performance.now();
    const pauseCallbackPtr = runtime.addFunction(() => {
      return performance.now() - sliceStartedAt >= PDF_READER_PROGRESSIVE_RENDER_SLICE_MS
        ? 1
        : 0;
    }, 'ii');
    const pausePtr = runtime.wasmExports.malloc(8);
    let didStartProgressiveRender = false;

    try {
      runtime.setValue(pausePtr, 1, 'i32');
      runtime.setValue(pausePtr + 4, pauseCallbackPtr, 'i32');
      let renderStatus = pdfium.FPDF_RenderPageBitmap_Start(
        bitmapPtr,
        pagePtr,
        startX,
        startY,
        sizeX,
        sizeY,
        rotate,
        flags,
        pausePtr,
      );
      didStartProgressiveRender = true;

      while (renderStatus === PDF_RENDER_TOBE_CONTINUED) {
        this.recordProgressiveRenderYield();
        await this.waitForNextFrame();
        sliceStartedAt = performance.now();
        renderStatus = pdfium.FPDF_RenderPage_Continue(pagePtr, pausePtr);
      }

      if (renderStatus !== PDF_RENDER_DONE) {
        throw new Error(`PDFium progressive render failed: status=${renderStatus}`);
      }
    } finally {
      if (didStartProgressiveRender) {
        pdfium.FPDF_RenderPage_Close(pagePtr);
      }
      runtime.removeFunction(pauseCallbackPtr);
      runtime.wasmExports.free(pausePtr);
    }
  }

  private getViewportTileRectForShell(
    shell: PdfPageShell,
    margin = PDF_READER_VIEWPORT_TILE_MARGIN_PX,
  ): PdfViewportTileRect | null {
    const pageRect = shell.pageCanvasWrap.getBoundingClientRect();
    const viewportRect = this.pagesElement.getBoundingClientRect();
    const left = Math.max(0, viewportRect.left - pageRect.left - margin);
    const top = Math.max(0, viewportRect.top - pageRect.top - margin);
    const right = Math.min(
      shell.cssWidth,
      viewportRect.right - pageRect.left + margin,
    );
    const bottom = Math.min(
      shell.cssHeight,
      viewportRect.bottom - pageRect.top + margin,
    );
    const width = Math.ceil(right - left);
    const height = Math.ceil(bottom - top);

    if (width <= 0 || height <= 0) {
      return null;
    }

    return {
      x: Math.floor(left),
      y: Math.floor(top),
      width,
      height,
    };
  }

  private getViewportTilesForShell(
    shell: PdfPageShell,
    margin = PDF_READER_VIEWPORT_TILE_MARGIN_PX,
  ): PdfViewportTile[] {
    const tileRect = this.getViewportTileRectForShell(shell, margin);
    if (!tileRect) {
      return [];
    }

    const tileSize = PDF_READER_VIEWPORT_TILE_SIZE_PX;
    const startColumn = Math.floor(tileRect.x / tileSize);
    const endColumn = Math.floor((tileRect.x + tileRect.width - 1) / tileSize);
    const startRow = Math.floor(tileRect.y / tileSize);
    const endRow = Math.floor((tileRect.y + tileRect.height - 1) / tileSize);
    const viewportCenterX = tileRect.x + tileRect.width / 2;
    const viewportCenterY = tileRect.y + tileRect.height / 2;
    const tiles: PdfViewportTile[] = [];

    for (let row = startRow; row <= endRow; row += 1) {
      for (let column = startColumn; column <= endColumn; column += 1) {
        const x = column * tileSize;
        const y = row * tileSize;
        const width = Math.min(tileSize, shell.cssWidth - x);
        const height = Math.min(tileSize, shell.cssHeight - y);
        if (width <= 0 || height <= 0) {
          continue;
        }
        tiles.push({
          key: `${column}:${row}`,
          x,
          y,
          width,
          height,
        });
      }
    }

    tiles.sort((a, b) => {
      const aCenterX = a.x + a.width / 2;
      const aCenterY = a.y + a.height / 2;
      const bCenterX = b.x + b.width / 2;
      const bCenterY = b.y + b.height / 2;
      const aDistance = Math.abs(aCenterX - viewportCenterX) + Math.abs(aCenterY - viewportCenterY);
      const bDistance = Math.abs(bCenterX - viewportCenterX) + Math.abs(bCenterY - viewportCenterY);
      return aDistance - bDistance;
    });

    return tiles;
  }

  private async renderVisiblePdfPageTiles(
    version: number,
    pageRenderVersion: number,
    renderToken?: PdfRenderToken,
  ) {
    const documentHandle = this.documentHandle;
    if (!documentHandle) {
      return;
    }

    const visibleShells = this.getVisiblePageShells()
      .filter(({ priority, shell }) =>
        priority === 0 && shell.renderState === 'rendered',
      );
    for (const { shell } of visibleShells) {
      if (
        version !== this.loadVersion ||
        pageRenderVersion !== this.pageRenderVersion ||
        this.isVisibleRenderStale(renderToken)
      ) {
        return;
      }
      await this.renderPdfPageViewportTiles(
        documentHandle,
        shell,
        version,
        pageRenderVersion,
        renderToken,
      );
      if (
        version !== this.loadVersion ||
        pageRenderVersion !== this.pageRenderVersion ||
        this.isVisibleRenderStale(renderToken)
      ) {
        return;
      }
    }
  }

  private async renderPdfPageViewportTiles(
    documentHandle: PdfiumDocumentHandle,
    shell: PdfPageShell,
    version: number,
    pageRenderVersion: number,
    renderToken?: PdfRenderToken,
  ) {
    const tiles = this.getViewportTilesForShell(shell);
    if (tiles.length === 0) {
      this.clearShellViewportTiles(shell);
      return false;
    }

    const outputScale = this.getOutputScale(shell.cssWidth, shell.cssHeight, 'quality');
    if (
      shell.outputScale >= outputScale - 0.01 &&
      this.isShellRenderedAtCurrentGeometry(shell, outputScale)
    ) {
      this.clearShellViewportTiles(shell);
      return false;
    }
    if (Math.abs(shell.tileOutputScale - outputScale) > 0.01) {
      this.clearShellViewportTiles(shell);
      shell.tileOutputScale = outputScale;
    }

    const visibleTileKeys = new Set(tiles.map((tile) => tile.key));
    for (const key of shell.tileCache.keys()) {
      if (!visibleTileKeys.has(key)) {
        this.deleteViewportTileCacheEntry(shell, key);
        shell.tileCache.delete(key);
      } else {
        this.touchViewportTileCacheEntry(shell, key);
      }
    }

    const missingTiles = tiles.filter((tile) => !shell.tileCache.has(tile.key));
    const renderedTiles: Array<{ tile: PdfViewportTile; canvas: HTMLCanvasElement }> = [];
    let renderSliceStartedAt = performance.now();
    for (let tileIndex = 0; tileIndex < missingTiles.length; tileIndex += 1) {
      const tile = missingTiles[tileIndex];
      await this.yieldForPendingUserInput();
      renderSliceStartedAt = await this.yieldForRenderBudget(renderSliceStartedAt);
      if (
        version !== this.loadVersion ||
        pageRenderVersion !== this.pageRenderVersion ||
        this.isVisibleRenderStale(renderToken)
      ) {
        return false;
      }
      const tileRenderStartedAt = performance.now();
      const canvas = await this.renderPdfViewportTileIntoCanvas(
        documentHandle,
        shell,
        tile,
        outputScale,
      );
      this.recordTileRenderDuration(performance.now() - tileRenderStartedAt);

      if (
        version !== this.loadVersion ||
        pageRenderVersion !== this.pageRenderVersion ||
          this.isVisibleRenderStale(renderToken)
        ) {
        return false;
      }

      renderedTiles.push({ tile, canvas });
      if (tileIndex < missingTiles.length - 1) {
        await this.waitForNextFrame();
      }
    }

    if (renderedTiles.length === 0) {
      return false;
    }
    if (
      version !== this.loadVersion ||
      pageRenderVersion !== this.pageRenderVersion ||
      this.isVisibleRenderStale(renderToken)
    ) {
      return false;
    }

    const fragment = document.createDocumentFragment();
    for (const { tile, canvas } of renderedTiles) {
      fragment.append(canvas);
      this.addShellViewportTile(shell, tile, canvas, outputScale);
    }
    shell.tileLayer.append(fragment);
    shell.tileLayer.style.width = `${shell.cssWidth}px`;
    shell.tileLayer.style.height = `${shell.cssHeight}px`;
    return true;
  }

  private async renderPdfViewportTileIntoCanvas(
    documentHandle: PdfiumDocumentHandle,
    shell: PdfPageShell,
    tile: PdfViewportTile,
    outputScale: number,
  ) {
    const canvas = document.createElement('canvas');
    const bitmapWidth = Math.max(1, Math.ceil(tile.width * outputScale));
    const bitmapHeight = Math.max(1, Math.ceil(tile.height * outputScale));

    canvas.width = bitmapWidth;
    canvas.height = bitmapHeight;
    canvas.dataset.pdfTileKey = tile.key;
    canvas.style.left = `${tile.x}px`;
    canvas.style.top = `${tile.y}px`;
    canvas.style.width = `${tile.width}px`;
    canvas.style.height = `${tile.height}px`;

    const context = canvas.getContext('2d');
    if (!context) {
      return canvas;
    }

    if (await this.tryRenderPdfViewportTileWithWorker(
      shell,
      tile,
      outputScale,
      bitmapWidth,
      bitmapHeight,
      context,
    )) {
      return canvas;
    }

    const pagePtr = documentHandle.pdfium.FPDF_LoadPage(
      documentHandle.documentPtr,
      shell.pageNumber - 1,
    );
    if (!pagePtr) {
      throw new Error(`PDFium failed to load page ${shell.pageNumber}.`);
    }

    const bitmapPtr = documentHandle.pdfium.FPDFBitmap_Create(bitmapWidth, bitmapHeight, 0);

    if (!bitmapPtr) {
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
      throw new Error(`PDFium failed to create viewport tile for page ${shell.pageNumber}.`);
    }

    try {
      documentHandle.pdfium.FPDFBitmap_FillRect(
        bitmapPtr,
        0,
        0,
        bitmapWidth,
        bitmapHeight,
        0xFFFFFFFF,
      );
      await this.renderPdfPageBitmap(
        documentHandle,
        bitmapPtr,
        pagePtr,
        -Math.floor(tile.x * outputScale),
        -Math.floor(tile.y * outputScale),
        Math.max(1, Math.floor(shell.cssWidth * outputScale)),
        Math.max(1, Math.floor(shell.cssHeight * outputScale)),
        0,
        PDF_RENDER_FLAGS,
      );

      const bufferPtr = documentHandle.pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
      const stride = documentHandle.pdfium.FPDFBitmap_GetStride(bitmapPtr);
      this.copyPdfBitmapToCanvas(
        documentHandle,
        bufferPtr,
        stride,
        bitmapWidth,
        bitmapHeight,
        context,
      );
    } finally {
      documentHandle.pdfium.FPDFBitmap_Destroy(bitmapPtr);
      documentHandle.pdfium.FPDF_ClosePage(pagePtr);
    }

    return canvas;
  }

  private async tryRenderPdfViewportTileWithWorker(
    shell: PdfPageShell,
    tile: PdfViewportTile,
    outputScale: number,
    bitmapWidth: number,
    bitmapHeight: number,
    context: CanvasRenderingContext2D,
  ) {
    const client = this.pdfRenderWorkerClient;
    const workerReady = this.pdfRenderWorkerReady;
    const documentId = this.pdfRenderWorkerDocumentId;
    if (!client || !workerReady || documentId <= 0 || !this.pdfRenderWorkerAvailable) {
      this.recordWorkerTileRenderFallback();
      return false;
    }

    try {
      await workerReady;
      if (this.pdfRenderWorkerClient !== client) {
        this.recordWorkerTileRenderFallback();
        return false;
      }

      const workerTile: PdfWorkerTileRenderRequest = {
        pageNumber: shell.pageNumber,
        bitmapWidth,
        bitmapHeight,
        startX: -Math.floor(tile.x * outputScale),
        startY: -Math.floor(tile.y * outputScale),
        sizeX: Math.max(1, Math.floor(shell.cssWidth * outputScale)),
        sizeY: Math.max(1, Math.floor(shell.cssHeight * outputScale)),
        rotate: 0,
        flags: PDF_RENDER_FLAGS,
      };
      const renderedTile = await client.renderTile(documentId, workerTile);
      if (
        renderedTile.documentId !== documentId ||
        renderedTile.pageNumber !== shell.pageNumber ||
        renderedTile.bitmapWidth !== bitmapWidth ||
        renderedTile.bitmapHeight !== bitmapHeight ||
        renderedTile.pixels.byteLength !== bitmapWidth * bitmapHeight * 4
      ) {
        throw new Error(`PDFium render worker returned an invalid tile for page ${shell.pageNumber}.`);
      }

      context.putImageData(
        new ImageData(
          new Uint8ClampedArray(renderedTile.pixels),
          bitmapWidth,
          bitmapHeight,
        ),
        0,
        0,
      );
      this.recordWorkerTileRender();
      return true;
    } catch (error) {
      if (this.pdfRenderWorkerClient === client) {
        this.pdfRenderWorkerClient = null;
        this.pdfRenderWorkerReady = null;
        this.pdfRenderWorkerAvailable = false;
        client.dispose();
      }
      this.recordWorkerTileRenderError();
      console.warn('PDFium render worker tile failed; falling back to main-thread rendering.', error);
      return false;
    }
  }

  private unloadPdfPageShell(shell: PdfPageShell) {
    shell.canvas?.remove();
    shell.canvas = null;
    shell.outputScale = 0;
    this.clearShellViewportTiles(shell);
    shell.highlightLayer.replaceChildren();
    shell.renderState = 'empty';
    this.syncPageInfoGeometry(shell);
    this.refreshRenderedTextCharCount();
  }

  private evictDistantRenderedPages() {
    const renderedShells = [...this.pageShells.values()]
      .filter((shell) => shell.renderState === 'rendered');
    if (renderedShells.length <= PDF_READER_MAX_RETAINED_PAGES) {
      return;
    }

    const candidates = renderedShells
      .filter((shell) => !this.isShellNearViewport(shell, this.viewportModel.getVirtualizationMargin()))
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

  private resetRenderDiagnostics() {
    this.renderDiagnostics = {
      pageRenderCount: 0,
      pageRenderTotalMs: 0,
      pageRenderMaxMs: 0,
      tileRenderCount: 0,
      tileRenderTotalMs: 0,
      tileRenderMaxMs: 0,
      workerTileRenderCount: 0,
      workerTileRenderFallbackCount: 0,
      workerTileRenderErrorCount: 0,
      workerPageRenderCount: 0,
      workerPageRenderFallbackCount: 0,
      workerPageRenderErrorCount: 0,
      progressiveRenderYieldCount: 0,
      progressiveRenderFallbackCount: 0,
      renderBudgetYieldCount: 0,
      inputPendingYieldCount: 0,
      qualityDeferralCount: 0,
      qualityRetryCount: 0,
      renderStaleCount: 0,
      tileCacheEvictionCount: 0,
      textCacheHits: 0,
      textCacheMisses: 0,
    };
    delete this.element.dataset.pdfReaderRenderDiagnostics;
  }

  private publishRenderDiagnostics() {
    const {
      pageRenderCount,
      pageRenderTotalMs,
      pageRenderMaxMs,
      tileRenderCount,
      tileRenderTotalMs,
      tileRenderMaxMs,
      workerTileRenderCount,
      workerTileRenderFallbackCount,
      workerTileRenderErrorCount,
      workerPageRenderCount,
      workerPageRenderFallbackCount,
      workerPageRenderErrorCount,
      progressiveRenderYieldCount,
      progressiveRenderFallbackCount,
      renderBudgetYieldCount,
      inputPendingYieldCount,
      qualityDeferralCount,
      qualityRetryCount,
      renderStaleCount,
      tileCacheEvictionCount,
      textCacheHits,
      textCacheMisses,
    } = this.renderDiagnostics;
    this.element.dataset.pdfReaderRenderDiagnostics = JSON.stringify({
      pageRenderCount,
      pageRenderTotalMs: Math.round(pageRenderTotalMs),
      pageRenderAverageMs: pageRenderCount > 0
        ? Math.round(pageRenderTotalMs / pageRenderCount)
        : 0,
      pageRenderMaxMs: Math.round(pageRenderMaxMs),
      tileRenderCount,
      tileRenderTotalMs: Math.round(tileRenderTotalMs),
      tileRenderAverageMs: tileRenderCount > 0
        ? Math.round(tileRenderTotalMs / tileRenderCount)
        : 0,
      tileRenderMaxMs: Math.round(tileRenderMaxMs),
      workerTileRenderCount,
      workerTileRenderFallbackCount,
      workerTileRenderErrorCount,
      workerPageRenderCount,
      workerPageRenderFallbackCount,
      workerPageRenderErrorCount,
      progressiveRenderYieldCount,
      progressiveRenderFallbackCount,
      renderBudgetYieldCount,
      inputPendingYieldCount,
      qualityDeferralCount,
      qualityRetryCount,
      renderStaleCount,
      tileCacheMemoryBytes: Math.round(this.viewportTileCacheMemoryBytes),
      tileCacheCapacityBytes: this.viewportTileCacheMaxBytes,
      tileCacheEntryCount: this.viewportTileCache.size,
      tileCacheEvictionCount,
      workerSupported: this.workerSupportStatus.supported ? 1 : 0,
      workerReady: this.pdfRenderWorkerAvailable ? 1 : 0,
      workerTransferSupported: this.workerSupportStatus.transferableArrayBuffer ? 1 : 0,
      workerWebAssemblySupported: this.workerSupportStatus.webAssemblyAvailable ? 1 : 0,
      textCacheHits,
      textCacheMisses,
    });
  }

  private recordPageRenderDuration(durationMs: number) {
    this.renderDiagnostics.pageRenderCount += 1;
    this.renderDiagnostics.pageRenderTotalMs += durationMs;
    this.renderDiagnostics.pageRenderMaxMs = Math.max(
      this.renderDiagnostics.pageRenderMaxMs,
      durationMs,
    );
    this.publishRenderDiagnostics();
  }

  private recordTileRenderDuration(durationMs: number) {
    this.renderDiagnostics.tileRenderCount += 1;
    this.renderDiagnostics.tileRenderTotalMs += durationMs;
    this.renderDiagnostics.tileRenderMaxMs = Math.max(
      this.renderDiagnostics.tileRenderMaxMs,
      durationMs,
    );
    this.publishRenderDiagnostics();
  }

  private recordWorkerTileRender() {
    this.renderDiagnostics.workerTileRenderCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordWorkerTileRenderFallback() {
    this.renderDiagnostics.workerTileRenderFallbackCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordWorkerTileRenderError() {
    this.renderDiagnostics.workerTileRenderErrorCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordWorkerPageRender() {
    this.renderDiagnostics.workerPageRenderCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordWorkerPageRenderFallback() {
    this.renderDiagnostics.workerPageRenderFallbackCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordWorkerPageRenderError() {
    this.renderDiagnostics.workerPageRenderErrorCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordProgressiveRenderYield() {
    this.renderDiagnostics.progressiveRenderYieldCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordProgressiveRenderFallback() {
    this.renderDiagnostics.progressiveRenderFallbackCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordRenderBudgetYield() {
    this.renderDiagnostics.renderBudgetYieldCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordInputPendingYield() {
    this.renderDiagnostics.inputPendingYieldCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordQualityDeferral() {
    this.renderDiagnostics.qualityDeferralCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordQualityRetry() {
    this.renderDiagnostics.qualityRetryCount += 1;
    this.publishRenderDiagnostics();
  }

  private recordStaleRender() {
    this.renderDiagnostics.renderStaleCount += 1;
    this.publishRenderDiagnostics();
  }

  private getPageTextChars(
    documentHandle: PdfiumDocumentHandle,
    pagePtr: number,
    pageNumber: number,
  ) {
    const cachedChars = this.pageTextCharsByPage.get(pageNumber);
    if (cachedChars) {
      this.renderDiagnostics.textCacheHits += 1;
      this.publishRenderDiagnostics();
      return cachedChars;
    }

    this.renderDiagnostics.textCacheMisses += 1;
    const chars = this.extractPageTextChars(documentHandle, pagePtr);
    this.pageTextCharsByPage.set(pageNumber, chars);
    this.publishRenderDiagnostics();
    return chars;
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
    const layoutPage = createPdfLayoutPage(info);

    if (selection) {
      const selectionRange = selection.ranges.find((range) => range.page === page);
      if (selectionRange) {
        info.highlightLayer.dataset.selectionSource = 'layout';
        info.highlightLayer.dataset.selectionRectCount = String(selectionRange.rects.length);
        this.appendHighlightRects(
          info,
          selectionRange.rects,
          'pdf-reader-highlight is-selection',
        );
      }
    }

    for (const annotation of snapshot.annotations) {
      const ranges = resolvePdfAnnotationRangesForPage(annotation, layoutPage);
      this.queueResolvedAnnotationAnchorMigration(annotation, layoutPage, ranges);
      for (const range of ranges) {
        this.appendAnnotationHighlightRects(
          info,
          range.rects,
          annotation,
          annotation.mode === 'note'
            ? 'pdf-reader-highlight is-annotation is-note'
            : 'pdf-reader-highlight is-annotation',
        );
      }
    }
  }

  private queueResolvedAnnotationAnchorMigration(
    annotation: Annotation,
    layoutPage: ReturnType<typeof createPdfLayoutPage>,
    ranges: readonly PdfResolvedAnnotationRange[],
  ) {
    if (!this.props.onAnnotationChange) {
      return;
    }

    const migratedAnnotation = createV2PdfAnnotationFromResolvedRangesForPage(
      annotation,
      layoutPage,
      ranges,
    );
    if (!migratedAnnotation) {
      return;
    }

    this.pendingAnnotationAnchorMigrations.set(annotation.id, migratedAnnotation);
    if (this.isAnnotationAnchorMigrationFlushScheduled) {
      return;
    }

    this.isAnnotationAnchorMigrationFlushScheduled = true;
    window.queueMicrotask(() => {
      this.isAnnotationAnchorMigrationFlushScheduled = false;
      const migrations = [...this.pendingAnnotationAnchorMigrations.values()];
      this.pendingAnnotationAnchorMigrations.clear();
      for (const migrated of migrations) {
        this.props.onAnnotationChange?.(migrated);
      }
    });
  }

  private appendHighlightRects(
    info: PdfReviewerPageInfo,
    rects: readonly PdfRect[],
    className: string,
  ) {
    if (className.includes('is-selection')) {
      this.appendSelectionHighlightRects(info, rects, className);
      return;
    }

    for (const rect of rects) {
      const viewportRect = pdfRectToViewportRect(info, rect);
      const left = Math.floor(viewportRect.x);
      const top = Math.floor(viewportRect.y);
      const right = Math.ceil(viewportRect.x + viewportRect.width);
      const bottom = Math.ceil(viewportRect.y + viewportRect.height);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      if (!Number.isFinite(left) || !Number.isFinite(top) || width === 0 || height === 0) {
        continue;
      }
      const highlight = createElement('div', className);
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${width}px`;
      highlight.style.height = `${height}px`;
      info.highlightLayer.append(highlight);
    }
  }

  private appendSelectionHighlightRects(
    info: PdfReviewerPageInfo,
    rects: readonly PdfRect[],
    className: string,
  ) {
    type ViewRect = { left: number; top: number; right: number; bottom: number };
    const viewRects: ViewRect[] = [];

    for (const rect of rects) {
      const viewportRect = pdfRectToViewportRect(info, rect);
      const left = viewportRect.x;
      const top = viewportRect.y;
      const right = viewportRect.x + viewportRect.width;
      const bottom = viewportRect.y + viewportRect.height;
      if (
        !Number.isFinite(left) ||
        !Number.isFinite(top) ||
        !Number.isFinite(right) ||
        !Number.isFinite(bottom) ||
        right <= left ||
        bottom <= top
      ) {
        continue;
      }
      viewRects.push({ left, top, right, bottom });
    }

    if (viewRects.length === 0) {
      return;
    }

    const getMedian = (values: readonly number[]) => {
      const sorted = values
        .filter((value) => Number.isFinite(value) && value > 0)
        .slice()
        .sort((a, b) => a - b);
      if (sorted.length === 0) {
        return 0;
      }
      const middle = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[middle - 1]! + sorted[middle]!) / 2
        : sorted[middle]!;
    };

    const getCenterY = (rect: ViewRect) => (rect.top + rect.bottom) / 2;
    const medianHeight = Math.max(1, getMedian(viewRects.map((rect) => rect.bottom - rect.top)));
    const yTolerance = Math.max(medianHeight * 0.65, 2);

    type RowCluster = {
      rects: ViewRect[];
      top: number;
      bottom: number;
      centerY: number;
    };

    const sortedRects = [...viewRects].sort((a, b) =>
      getCenterY(a) - getCenterY(b) ||
      a.top - b.top ||
      a.left - b.left,
    );

    const rows: RowCluster[] = [];
    for (const rect of sortedRects) {
      const centerY = getCenterY(rect);
      const lastRow = rows.at(-1);
      if (lastRow && Math.abs(centerY - lastRow.centerY) <= yTolerance) {
        lastRow.rects.push(rect);
        lastRow.top = Math.min(lastRow.top, rect.top);
        lastRow.bottom = Math.max(lastRow.bottom, rect.bottom);
        const count = lastRow.rects.length;
        lastRow.centerY = (lastRow.centerY * (count - 1) + centerY) / count;
        continue;
      }

      rows.push({
        rects: [rect],
        top: rect.top,
        bottom: rect.bottom,
        centerY,
      });
    }

    const maxWidth = Math.max(0, Math.round(info.pageWidth * info.scale));
    const maxHeight = Math.max(0, Math.round(info.pageHeight * info.scale));
    const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

    type RowRender = {
      top: number;
      bottom: number;
      segments: Array<{ left: number; right: number }>;
    };

    const rowsToRender: RowRender[] = [];
    for (const row of rows) {
      let top = Math.floor(row.top);
      let bottom = Math.ceil(row.bottom);
      top = clamp(top, 0, maxHeight);
      bottom = clamp(bottom, 0, maxHeight);
      if (bottom <= top) {
        bottom = clamp(top + 1, 0, maxHeight);
      }

      const segments = row.rects
        .map((rect) => {
          let left = Math.floor(rect.left);
          let right = Math.ceil(rect.right);
          left = clamp(left, 0, maxWidth);
          right = clamp(right, 0, maxWidth);
          if (right <= left) {
            right = clamp(left + 1, 0, maxWidth);
          }
          return { left, right };
        })
        .filter((segment) => segment.right > segment.left)
        .sort((a, b) => a.left - b.left || a.right - b.right);

      if (segments.length === 0) {
        continue;
      }

      const segmentGaps: number[] = [];
      for (let index = 1; index < segments.length; index += 1) {
        const previous = segments[index - 1];
        const current = segments[index];
        if (!previous || !current) {
          continue;
        }

        const gap = current.left - previous.right;
        if (Number.isFinite(gap) && gap > 0) {
          segmentGaps.push(gap);
        }
      }
      const medianSegmentGap = getMedian(segmentGaps);
      const rowMergeGap = Math.max(
        8,
        Math.min(
          Math.max(medianHeight * 3.2, medianSegmentGap * 6, 24),
          Math.max(maxWidth * 0.08, 8),
        ),
      );
      const mergedSegments: Array<{ left: number; right: number }> = [];
      for (const segment of segments) {
        const last = mergedSegments.at(-1);
        if (last && segment.left <= last.right + rowMergeGap) {
          last.right = Math.max(last.right, segment.right);
          continue;
        }
        mergedSegments.push({ left: segment.left, right: segment.right });
      }

      rowsToRender.push({
        top,
        bottom,
        segments: mergedSegments,
      });
    }

    if (rowsToRender.length === 0) {
      return;
    }

    rowsToRender.sort((a, b) => a.top - b.top || a.bottom - b.bottom);

    // Remove 1px seams and overlaps introduced by per-rect rounding. Keep genuine paragraph gaps intact.
    for (let index = 1; index < rowsToRender.length; index += 1) {
      const previous = rowsToRender[index - 1];
      const current = rowsToRender[index];
      if (!previous || !current) {
        continue;
      }

      const gap = current.top - previous.bottom;
      if (gap <= 1) {
        current.top = previous.bottom;
        if (current.bottom <= current.top) {
          current.bottom = clamp(current.top + 1, 0, maxHeight);
        }
      }
    }

    for (const row of rowsToRender) {
      const height = row.bottom - row.top;
      if (height <= 0) {
        continue;
      }
      for (const segment of row.segments) {
        const width = segment.right - segment.left;
        if (width <= 0) {
          continue;
        }
        const highlight = createElement('div', className);
        highlight.style.left = `${segment.left}px`;
        highlight.style.top = `${row.top}px`;
        highlight.style.width = `${width}px`;
        highlight.style.height = `${height}px`;
        info.highlightLayer.append(highlight);
      }
    }
  }

  private appendAnnotationHighlightRects(
    info: PdfReviewerPageInfo,
    rects: readonly PdfRect[],
    annotation: Annotation,
    className: string,
  ) {
    const selectedClassName = annotation.id === this.selectedAnnotationId
      ? `${className} is-selected`
      : className;
    for (const rect of rects) {
      const viewportRect = pdfRectToViewportRect(info, rect);
      const left = Math.floor(viewportRect.x);
      const top = Math.floor(viewportRect.y);
      const right = Math.ceil(viewportRect.x + viewportRect.width);
      const bottom = Math.ceil(viewportRect.y + viewportRect.height);
      const width = Math.max(0, right - left);
      const height = Math.max(0, bottom - top);
      if (!Number.isFinite(left) || !Number.isFinite(top) || width === 0 || height === 0) {
        continue;
      }
      const highlight = createElement('button', selectedClassName);
      highlight.type = 'button';
      highlight.dataset.pdfAnnotationId = annotation.id;
      highlight.setAttribute('aria-label', annotation.mode === 'note' ? 'Open note' : 'Open highlight');
      highlight.title = annotation.comment || annotation.anchor.quote || 'Annotation';
      highlight.style.left = `${left}px`;
      highlight.style.top = `${top}px`;
      highlight.style.width = `${width}px`;
      highlight.style.height = `${height}px`;
      highlight.addEventListener('pointerdown', this.handleAnnotationHighlightPointerDown);
      highlight.addEventListener('click', this.handleAnnotationHighlightClick);
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
    this.viewportModel.beginScrollRestore();
    this.pagesElement.scrollLeft += anchoredX - anchor.viewportX;
    this.pagesElement.scrollTop += anchoredY - anchor.viewportY;
    this.viewportModel.syncScrollPosition();
    this.viewportModel.finishScrollRestoreNextFrame();
  }

  private applyInstantZoomPreview() {
    if (this.viewportModel.getRenderedZoomScale() <= 0) {
      return;
    }

    let isPreviewing = false;

    for (const shell of this.pageShells.values()) {
      const { pageCanvasWrap, highlightLayer } = shell;
      const renderedSize = this.getRenderedShellSize(shell);
      const previewGeometry = this.getPageGeometry(shell.pageWidth, shell.pageHeight);
      const scaleX = previewGeometry.cssWidth / renderedSize.width;
      const scaleY = previewGeometry.cssHeight / renderedSize.height;
      const shouldScale =
        shell.canvas !== null &&
        Number.isFinite(scaleX) &&
        Number.isFinite(scaleY) &&
        (Math.abs(scaleX - 1) > 0.001 || Math.abs(scaleY - 1) > 0.001);

      this.setShellLayoutSize(shell, previewGeometry);

      if (!shouldScale) {
        highlightLayer.style.width = `${previewGeometry.cssWidth}px`;
        highlightLayer.style.height = `${previewGeometry.cssHeight}px`;
        for (const previewLayer of pageCanvasWrap.children) {
          if (previewLayer instanceof HTMLElement) {
            previewLayer.style.transform = '';
          }
        }
        continue;
      }

      highlightLayer.style.width = `${renderedSize.width}px`;
      highlightLayer.style.height = `${renderedSize.height}px`;
      for (const previewLayer of pageCanvasWrap.children) {
        if (!(previewLayer instanceof HTMLElement)) {
          continue;
        }
        previewLayer.style.transform = `scale(${scaleX}, ${scaleY})`;
      }
      isPreviewing = true;
    }

    this.pagesElement.classList.toggle('is-zoom-previewing', isPreviewing);
  }

  private clearInstantZoomPreview() {
    for (const shell of this.pageShells.values()) {
      this.clearShellInstantZoomPreview(shell);
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

  private clearScheduledViewportQualityRender() {
    if (this.viewportQualityRenderFrame === null) {
      return;
    }

    window.cancelAnimationFrame(this.viewportQualityRenderFrame);
    this.viewportQualityRenderFrame = null;
  }

  private handleSelectionDragChange(isSelectingText: boolean) {
    if (this.isSelectingText === isSelectingText) {
      return;
    }

    this.isSelectingText = isSelectingText;
    if (isSelectingText) {
      this.renderScheduler.cancel();
      return;
    }

    this.scheduleVisiblePageRender();
  }

  private scheduleVisiblePageRender() {
    if (!this.documentHandle || this.readerStatus.state !== 'ready' || this.isSelectingText) {
      return;
    }

    const version = this.loadVersion;
    const pageRenderVersion = this.pageRenderVersion;
    this.renderScheduler.request(
      async (renderToken) => {
        const shouldDeferQuality = this.hasPendingUserInput();
        if (shouldDeferQuality) {
          this.recordQualityDeferral();
        }
        if (!shouldDeferQuality) {
          await this.renderVisiblePdfPageTiles(version, pageRenderVersion, renderToken);
          if (
            version !== this.loadVersion ||
            pageRenderVersion !== this.pageRenderVersion ||
            this.isVisibleRenderStale(renderToken)
          ) {
            return;
          }
        }
        await this.renderVisiblePdfPages(version, pageRenderVersion, renderToken, {
          quality: shouldDeferQuality ? 'interactive' : 'quality',
        });
        if (
          shouldDeferQuality &&
          version === this.loadVersion &&
          pageRenderVersion === this.pageRenderVersion &&
          !this.isVisibleRenderStale(renderToken)
        ) {
          this.scheduleViewportQualityRender(pageRenderVersion);
        }
      },
      (error: unknown) => {
        console.error('Failed to render visible PDF pages.', error);
      },
    );
  }

  private scheduleViewportQualityRender(pageRenderVersion: number) {
    if (!this.documentHandle || this.readerStatus.state !== 'ready' || this.isSelectingText) {
      return;
    }

    const version = this.loadVersion;
    if (this.hasPendingUserInput()) {
      if (this.viewportQualityRenderFrame !== null) {
        return;
      }
      this.recordQualityRetry();
      this.viewportQualityRenderFrame = window.requestAnimationFrame(() => {
        this.viewportQualityRenderFrame = null;
        if (version !== this.loadVersion || pageRenderVersion !== this.pageRenderVersion) {
          return;
        }
        this.scheduleViewportQualityRender(pageRenderVersion);
      });
      return;
    }

    this.clearScheduledViewportQualityRender();
    this.renderScheduler.request(
      async (renderToken) => {
        if (
          version !== this.loadVersion ||
          pageRenderVersion !== this.pageRenderVersion ||
          this.isVisibleRenderStale(renderToken)
        ) {
          return;
        }
        if (this.hasPendingUserInput()) {
          this.scheduleViewportQualityRender(pageRenderVersion);
          return;
        }
        await this.renderVisiblePdfPages(version, pageRenderVersion, renderToken, {
          maxPriority: 0,
          quality: 'quality',
        });
        if (
          version !== this.loadVersion ||
          pageRenderVersion !== this.pageRenderVersion ||
          this.isVisibleRenderStale(renderToken)
        ) {
          return;
        }
        if (this.hasPendingUserInput()) {
          this.scheduleViewportQualityRender(pageRenderVersion);
          return;
        }
        await this.renderVisiblePdfPageTiles(version, pageRenderVersion, renderToken);
        if (
          version === this.loadVersion &&
          pageRenderVersion === this.pageRenderVersion &&
          !this.isVisibleRenderStale(renderToken)
        ) {
          this.scheduleVisiblePageRender();
        }
      },
      (error: unknown) => {
        console.error('Failed to render high-quality PDF viewport pages.', error);
      },
    );
  }

  private scheduleZoomRender() {
    this.clearScheduledZoomRender();
    this.clearScheduledViewportQualityRender();
    this.pageRenderVersion += 1;
    this.renderScheduler.cancel();
    this.clearAllShellViewportTiles();
    this.zoomRenderTimer = window.setTimeout(() => {
      this.zoomRenderTimer = null;
      void this.rerenderPdfAtCurrentZoom().catch((error: unknown) => {
        this.handleZoomRenderError(error);
      });
    }, PDF_READER_ZOOM_RENDER_DELAY_MS);
  }

  private handleZoomRenderError(error: unknown) {
    this.pagesElement.classList.remove('is-zooming');
    this.loadingElement.hidden = true;
    this.viewportModel.clearZoomAnchor();
    this.updateInstantZoomPreviewClass();
    console.error('Failed to rerender PDF at the requested zoom level.', error);
  }

  private relayoutPdfPreview(anchor: PdfZoomAnchor | null) {
    this.loadingElement.hidden = false;
    this.loadingElement.textContent = `${Math.round(this.viewportModel.getZoomScale() * 100)}%`;
    this.element.dataset.pdfReaderZoom = String(this.viewportModel.getZoomScale());
    this.applyInstantZoomPreview();
    this.restoreVisiblePageAnchor(anchor);
    this.scheduleZoomRender();
  }

  private handleReaderResize = () => {
    if (!this.documentHandle || this.readerStatus.state !== 'ready') {
      this.scheduleVisiblePageRender();
      return;
    }

    const anchor = this.viewportModel.getZoomAnchor() ?? this.getVisiblePageAnchor();
    this.viewportModel.setZoomAnchor(anchor);
    this.relayoutPdfPreview(anchor);
  };

  private async rerenderPdfAtCurrentZoom() {
    const documentHandle = this.documentHandle;
    if (!documentHandle || this.readerStatus.state !== 'ready') {
      return;
    }

    if (this.hasRenderingVisibleShell()) {
      this.scheduleZoomRender();
      return;
    }

    const pageRenderVersion = ++this.pageRenderVersion;
    const anchor = this.viewportModel.getZoomAnchor() ?? this.getVisiblePageAnchor();

    this.loadingElement.hidden = false;
    this.loadingElement.textContent = `${Math.round(this.viewportModel.getZoomScale() * 100)}%`;
    this.pagesElement.classList.add('is-zooming');
    this.selectionController.reset();
    this.element.dataset.pdfReaderZoom = String(this.viewportModel.getZoomScale());

    for (const shell of this.pageShells.values()) {
      const geometry = this.getPageGeometry(shell.pageWidth, shell.pageHeight);
      this.setShellTargetGeometry(shell, geometry);
    }

    await this.renderVisiblePdfPages(
      this.loadVersion,
      pageRenderVersion,
      undefined,
      {
        maxPriority: 0,
        quality: 'interactive',
      },
    );

    if (pageRenderVersion !== this.pageRenderVersion) {
      this.pagesElement.classList.remove('is-zooming');
      return;
    }

    this.viewportModel.setRenderedZoomScale(this.viewportModel.getZoomScale());
    this.renderAllHighlights();
    this.updateInstantZoomPreviewClass();
    this.restoreVisiblePageAnchor(anchor);
    this.pagesElement.classList.remove('is-zooming');
    this.loadingElement.hidden = true;
    this.viewportModel.clearZoomAnchor();
    this.scheduleViewportQualityRender(pageRenderVersion);
  }

  private setZoomScale(nextZoomScale: number, anchor?: PdfZoomAnchor | null) {
    const normalizedZoomScale = Math.min(
      PDF_READER_MAX_ZOOM,
      Math.max(PDF_READER_MIN_ZOOM, Number(nextZoomScale.toFixed(3))),
    );
    if (normalizedZoomScale === this.viewportModel.getZoomScale()) {
      return;
    }

    const zoomAnchor = anchor ?? this.viewportModel.getZoomAnchor() ?? this.getVisiblePageAnchor();
    this.viewportModel.setZoomScale(normalizedZoomScale);
    this.viewportModel.setZoomAnchor(zoomAnchor);
    this.relayoutPdfPreview(zoomAnchor);
  }

  private zoomByStep(direction: 1 | -1, anchor?: PdfZoomAnchor | null) {
    const levels = PDF_READER_ZOOM_LEVELS;
    const zoomScale = this.viewportModel.getZoomScale();
    const currentLevelIndex = levels.findIndex((level) => level === zoomScale);
    if (currentLevelIndex >= 0) {
      this.setZoomScale(
        levels[Math.min(
          levels.length - 1,
          Math.max(0, currentLevelIndex + direction),
        )],
        anchor,
      );
      return;
    }

    const nextLevel = direction > 0
      ? levels.find((level) => level > zoomScale)
      : [...levels].reverse().find((level) => level < zoomScale);
    if (nextLevel === undefined) {
      this.setZoomScale(direction > 0 ? PDF_READER_MAX_ZOOM : PDF_READER_MIN_ZOOM, anchor);
      return;
    }

    this.setZoomScale(nextLevel, anchor);
  }

  private getSelectedAnnotation(snapshot = this.store.getSnapshot()) {
    if (!this.selectedAnnotationId) {
      return null;
    }

    return snapshot.annotations.find((annotation) => {
      return annotation.id === this.selectedAnnotationId;
    }) ?? null;
  }

  private selectAnnotation(annotationId: string | null) {
    if (this.selectedAnnotationId === annotationId) {
      return;
    }

    this.selectedAnnotationId = annotationId;
    this.renderReaderChrome();
  }

  private getAnnotationQuote(annotation: Annotation) {
    return annotation.anchor.quote
      ?? annotation.anchor.ranges?.find((range) => range.quote)?.quote
      ?? '';
  }

  private renderAnnotationPanel(snapshot: PdfAnnotationStoreSnapshot) {
    const annotation = this.getSelectedAnnotation(snapshot);
    if (!annotation) {
      this.annotationPanelElement.hidden = true;
      return;
    }

    const quote = this.getAnnotationQuote(annotation);
    this.annotationPanelElement.hidden = false;
    this.annotationPanelTitleElement.textContent = annotation.mode === 'note'
      ? 'Note'
      : 'Highlight';
    this.annotationPanelQuoteElement.textContent = quote;
    this.annotationPanelQuoteElement.hidden = !quote;
    if (this.annotationPanelCommentInput.value !== annotation.comment) {
      this.annotationPanelCommentInput.value = annotation.comment;
    }
  }

  private getSelectionPages(selection: PdfSelection | null) {
    return new Set(selection?.ranges.map((range) => range.page) ?? []);
  }

  private renderSelectionDataset(snapshot: PdfAnnotationStoreSnapshot) {
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

  private isSelectionOnlyChromeUpdate(snapshot: PdfAnnotationStoreSnapshot) {
    const lastSnapshot = this.lastChromeSnapshot;
    return Boolean(
      lastSnapshot &&
      lastSnapshot.targetId === snapshot.targetId &&
      lastSnapshot.annotations === snapshot.annotations &&
      lastSnapshot.draftComment === snapshot.draftComment &&
      this.lastChromeSelectedAnnotationId === this.selectedAnnotationId,
    );
  }

  private renderSelectionOnlyChrome(snapshot: PdfAnnotationStoreSnapshot) {
    const pages = this.getSelectionPages(this.lastChromeSnapshot?.selection ?? null);
    for (const page of this.getSelectionPages(snapshot.selection)) {
      pages.add(page);
    }
    for (const page of pages) {
      this.renderHighlightsForPage(page);
    }
    this.renderSelectionDataset(snapshot);
  }

  private renderReaderChrome() {
    const snapshot = this.store.getSnapshot();
    if (this.selectedAnnotationId && !this.getSelectedAnnotation(snapshot)) {
      this.selectedAnnotationId = null;
    }

    if (this.isSelectionOnlyChromeUpdate(snapshot)) {
      this.renderSelectionOnlyChrome(snapshot);
    } else {
      this.renderAllHighlights();
      this.renderAnnotationPanel(snapshot);
      this.emptyOpenElement.hidden = Boolean(this.props.url.trim());
      this.openPdfButton.textContent = this.props.labels.openPdfFile ?? 'Open PDF';
      this.renderSelectionDataset(snapshot);
    }

    this.lastChromeSnapshot = snapshot;
    this.lastChromeSelectedAnnotationId = this.selectedAnnotationId;
  }

  private readonly handleOpenPdfFile = () => {
    void this.props.onOpenPdfFile?.();
  };

  private readonly handleAnnotationHighlightPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  private readonly handleAnnotationHighlightClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    if (!(target instanceof HTMLElement)) {
      return;
    }

    const annotationId = target.dataset.pdfAnnotationId;
    if (annotationId) {
      this.selectAnnotation(annotationId);
    }
  };

  private readonly handleAnnotationPanelClose = () => {
    this.selectAnnotation(null);
  };

  private readonly handleAnnotationPanelSave = () => {
    const annotation = this.getSelectedAnnotation();
    if (!annotation) {
      return;
    }

    const updatedAnnotation: Annotation = {
      ...annotation,
      comment: this.annotationPanelCommentInput.value.trim(),
      updatedAt: new Date().toISOString(),
    };
    this.props.onAnnotationChange?.(updatedAnnotation);
  };

  private readonly handleAnnotationPanelDelete = () => {
    const annotation = this.getSelectedAnnotation();
    if (!annotation) {
      return;
    }

    this.selectedAnnotationId = null;
    this.props.onAnnotationDelete?.(annotation.id);
    this.renderReaderChrome();
  };

  private readonly handlePointerFocus = () => {
    this.element.focus({ preventScroll: true });
  };

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.selectedAnnotationId) {
      event.preventDefault();
      this.selectAnnotation(null);
      return;
    }

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
    const deltaMultiplier = event.deltaMode === PDF_READER_WHEEL_DELTA_PAGE
      ? this.pagesElement.clientHeight
      : event.deltaMode === PDF_READER_WHEEL_DELTA_LINE
        ? 40
        : 1;
    const deltaY = event.deltaY * deltaMultiplier;
    const anchor = this.getVisiblePageAnchor({
      clientX: event.clientX,
      clientY: event.clientY,
    });

    const zoomFactor = Math.exp(-deltaY * PDF_READER_WHEEL_ZOOM_SENSITIVITY);
    this.setZoomScale(this.viewportModel.getZoomScale() * zoomFactor, anchor);
  };

  private readonly handleReaderScroll = () => {
    if (this.viewportModel.getIsRestoringScroll()) {
      return;
    }

    this.viewportModel.recordUserScroll();
    this.scheduleVisiblePageRender();
  };
}

export function createPdfDocumentReader(props: PdfDocumentReaderProps) {
  return new PdfDocumentReader(props);
}
