import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { PdfDocumentReader } from 'ls/editor/browser/pdf/pdfDocumentReader';
import type { INativeHostService } from 'ls/platform/native/common/native';
import { createPdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createNativeHostService(): INativeHostService {
  return {
    _serviceBrand: undefined,
    canInvoke: () => false,
    invoke: (async () => undefined) as INativeHostService['invoke'],
    ipc: undefined,
    windowControls: undefined,
    webContent: undefined,
    fetch: undefined,
    document: undefined,
    modal: undefined,
    toast: undefined,
  };
}

function createReader() {
  return new PdfDocumentReader({
    url: '',
    targetId: 'pdf-zoom-test',
    labels: {
      title: 'PDF',
      emptyState: 'Empty',
      openPdfFile: 'Open PDF',
    },
    viewPartProps: {
      browserUrl: '',
      electronRuntime: false,
      webContentRuntime: false,
      labels: {
        emptyState: 'Empty',
        contentUnavailable: 'Unavailable',
      },
    },
    nativeHost: createNativeHostService(),
  });
}

function createWheelEvent(options: {
  deltaY: number;
  ctrlKey?: boolean;
}) {
  const event = new MouseEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ctrlKey: options.ctrlKey ?? true,
  });
  Object.defineProperties(event, {
    deltaMode: {
      configurable: true,
      value: 0,
    },
    deltaY: {
      configurable: true,
      value: options.deltaY,
    },
  });
  return event as WheelEvent;
}

function getRenderDiagnostics(reader: PdfDocumentReader) {
  const diagnostics = reader.getElement().dataset.pdfReaderRenderDiagnostics;
  assert(diagnostics);
  return JSON.parse(diagnostics) as Record<string, number>;
}

test('PdfDocumentReader lets primary pointerdown on annotation highlights reach text selection', () => {
  const reader = createReader();
  const highlight = document.createElement('button');
  const parent = document.createElement('div');
  const event = new MouseEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    button: 0,
  }) as PointerEvent;
  const readerWithPrivateHandler = reader as unknown as {
    handleAnnotationHighlightPointerDown: (event: PointerEvent) => void;
  };
  let didBubble = false;

  try {
    parent.append(highlight);
    parent.addEventListener('pointerdown', () => {
      didBubble = true;
    });
    highlight.addEventListener('pointerdown', readerWithPrivateHandler.handleAnnotationHighlightPointerDown);

    highlight.dispatchEvent(event);

    assert.equal(didBubble, true);
    assert.equal(event.defaultPrevented, false);
  } finally {
    reader.dispose();
  }
});

function createTileCacheShell(pageNumber: number) {
  return {
    pageNumber,
    pageWidth: 100,
    pageHeight: 100,
    scale: 1,
    outputScale: 1,
    cssWidth: 100,
    cssHeight: 100,
    pageElement: document.createElement('section'),
    pageCanvasWrap: document.createElement('div'),
    tileLayer: document.createElement('div'),
    tileCache: new Map<string, HTMLCanvasElement>(),
    tileOutputScale: 0,
    highlightLayer: document.createElement('div'),
    canvas: null,
    renderState: 'rendered',
    lastVisibleAt: 0,
  };
}

function createSizedCanvas(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

test('PdfDocumentReader defers zoom completion while a visible page is still rendering', async () => {
  const reader = createReader();
  const pageElement = document.createElement('section');
  const pageCanvasWrap = document.createElement('div');
  const tileLayer = document.createElement('div');
  const highlightLayer = document.createElement('div');
  const shell = {
    pageNumber: 1,
    pageWidth: 100,
    pageHeight: 100,
    scale: 1,
    outputScale: 0,
    cssWidth: 100,
    cssHeight: 100,
    pageElement,
    pageCanvasWrap,
    tileLayer,
    tileCache: new Map<string, HTMLCanvasElement>(),
    tileOutputScale: 0,
    highlightLayer,
    canvas: null,
    renderState: 'rendering',
    lastVisibleAt: 0,
  };
  const zoomReader = reader as unknown as {
    documentHandle: unknown;
    pageShells: Map<number, typeof shell>;
    readerStatus: { state: string; message: string };
    viewportModel: {
      getRenderedZoomScale: () => number;
      setZoomScale: (scale: number) => void;
    };
    zoomRenderTimer: number | null;
    rerenderPdfAtCurrentZoom: () => Promise<void>;
  };

  pageElement.className = 'pdf-reader-page';
  pageElement.dataset.pdfPage = '1';
  pageCanvasWrap.append(tileLayer, highlightLayer);
  pageElement.append(pageCanvasWrap);
  zoomReader.documentHandle = {};
  zoomReader.readerStatus = { state: 'ready', message: '1 pages' };
  zoomReader.pageShells.set(1, shell);
  zoomReader.viewportModel.setZoomScale(1.25);

  try {
    await zoomReader.rerenderPdfAtCurrentZoom();

    assert.equal(zoomReader.viewportModel.getRenderedZoomScale(), 1);
    assert.notEqual(zoomReader.zoomRenderTimer, null);
  } finally {
    zoomReader.documentHandle = null;
    reader.dispose();
  }
});

test('PdfDocumentReader computes viewport tile rect with a small overscan margin', () => {
  const reader = createReader();
  const pageElement = document.createElement('section');
  const pageCanvasWrap = document.createElement('div');
  const tileLayer = document.createElement('div');
  const highlightLayer = document.createElement('div');
  const shell = {
    pageNumber: 1,
    pageWidth: 400,
    pageHeight: 600,
    scale: 1,
    outputScale: 1,
    cssWidth: 400,
    cssHeight: 600,
    pageElement,
    pageCanvasWrap,
    tileLayer,
    tileCache: new Map<string, HTMLCanvasElement>(),
    tileOutputScale: 0,
    highlightLayer,
    canvas: null,
    renderState: 'rendered',
    lastVisibleAt: 0,
  };
  const tileReader = reader as unknown as {
    pagesElement: HTMLElement;
    getViewportTileRectForShell: (
      shell: unknown,
      margin?: number,
    ) => { x: number; y: number; width: number; height: number } | null;
  };

  try {
    Object.defineProperty(tileReader.pagesElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 300,
        bottom: 240,
        width: 300,
        height: 240,
      }),
    });
    Object.defineProperty(pageCanvasWrap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: -120,
        top: -80,
        right: 280,
        bottom: 520,
        width: 400,
        height: 600,
      }),
    });

    assert.deepEqual(tileReader.getViewportTileRectForShell(shell, 20), {
      x: 100,
      y: 60,
      width: 300,
      height: 280,
    });
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader splits viewport quality work into reusable page tiles', () => {
  const reader = createReader();
  const pageElement = document.createElement('section');
  const pageCanvasWrap = document.createElement('div');
  const tileLayer = document.createElement('div');
  const highlightLayer = document.createElement('div');
  const shell = {
    pageNumber: 1,
    pageWidth: 1200,
    pageHeight: 1200,
    scale: 1,
    outputScale: 1,
    cssWidth: 1200,
    cssHeight: 1200,
    pageElement,
    pageCanvasWrap,
    tileLayer,
    tileCache: new Map<string, HTMLCanvasElement>(),
    tileOutputScale: 0,
    highlightLayer,
    canvas: null,
    renderState: 'rendered',
    lastVisibleAt: 0,
  };
  const tileReader = reader as unknown as {
    pagesElement: HTMLElement;
    getViewportTilesForShell: (
      shell: unknown,
      margin?: number,
    ) => Array<{ key: string; x: number; y: number; width: number; height: number }>;
  };

  try {
    Object.defineProperty(tileReader.pagesElement, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: 0,
        top: 0,
        right: 740,
        bottom: 740,
        width: 740,
        height: 740,
      }),
    });
    Object.defineProperty(pageCanvasWrap, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({
        left: -430,
        top: -430,
        right: 770,
        bottom: 770,
        width: 1200,
        height: 1200,
      }),
    });

    const tiles = tileReader.getViewportTilesForShell(shell, 0);

    assert.equal(tiles.length, 9);
    assert.equal(tiles[0].key, '2:2');
    assert.deepEqual(
      tiles.map((tile) => tile.key).sort(),
      ['1:1', '1:2', '1:3', '2:1', '2:2', '2:3', '3:1', '3:2', '3:3'],
    );
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader evicts non-viewport tiles when the viewport tile budget is exceeded', () => {
  const reader = createReader();
  const oldShell = createTileCacheShell(1);
  const currentShell = createTileCacheShell(2);
  const cacheReader = reader as unknown as {
    viewportTileCacheMaxBytes: number;
    addShellViewportTile: (
      shell: typeof oldShell,
      tile: { key: string; x: number; y: number; width: number; height: number },
      canvas: HTMLCanvasElement,
      outputScale: number,
    ) => void;
    pruneViewportTileCache: (protectedTileKeys?: ReadonlySet<string>) => void;
    getViewportTileCacheKey: (shell: typeof oldShell, tileKey: string) => string;
  };

  try {
    cacheReader.viewportTileCacheMaxBytes = 10_000;
    cacheReader.addShellViewportTile(
      oldShell,
      { key: '0:0', x: 0, y: 0, width: 10, height: 10 },
      createSizedCanvas(10, 10),
      1,
    );
    cacheReader.addShellViewportTile(
      oldShell,
      { key: '1:0', x: 10, y: 0, width: 10, height: 10 },
      createSizedCanvas(10, 10),
      1,
    );
    cacheReader.addShellViewportTile(
      currentShell,
      { key: '0:0', x: 0, y: 0, width: 10, height: 10 },
      createSizedCanvas(10, 10),
      1,
    );

    cacheReader.viewportTileCacheMaxBytes = 800;
    cacheReader.pruneViewportTileCache(new Set([
      cacheReader.getViewportTileCacheKey(currentShell, '0:0'),
    ]));

    assert.equal(oldShell.tileCache.has('0:0'), false);
    assert.equal(oldShell.tileCache.has('1:0'), true);
    assert.equal(currentShell.tileCache.has('0:0'), true);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.tileCacheEntryCount, 2);
    assert.equal(diagnostics.tileCacheMemoryBytes, 800);
    assert.equal(diagnostics.tileCacheEvictionCount, 1);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader keeps current viewport tiles ahead of the tile budget', () => {
  const reader = createReader();
  const oldShell = createTileCacheShell(1);
  const currentShell = createTileCacheShell(2);
  const cacheReader = reader as unknown as {
    viewportTileCacheMaxBytes: number;
    addShellViewportTile: (
      shell: typeof oldShell,
      tile: { key: string; x: number; y: number; width: number; height: number },
      canvas: HTMLCanvasElement,
      outputScale: number,
    ) => void;
    pruneViewportTileCache: (protectedTileKeys?: ReadonlySet<string>) => void;
    getViewportTileCacheKey: (shell: typeof oldShell, tileKey: string) => string;
  };

  try {
    cacheReader.viewportTileCacheMaxBytes = 10_000;
    cacheReader.addShellViewportTile(
      oldShell,
      { key: '0:0', x: 0, y: 0, width: 10, height: 10 },
      createSizedCanvas(10, 10),
      1,
    );
    cacheReader.addShellViewportTile(
      currentShell,
      { key: '0:0', x: 0, y: 0, width: 10, height: 10 },
      createSizedCanvas(10, 10),
      1,
    );
    cacheReader.addShellViewportTile(
      currentShell,
      { key: '1:0', x: 10, y: 0, width: 10, height: 10 },
      createSizedCanvas(10, 10),
      1,
    );

    cacheReader.viewportTileCacheMaxBytes = 400;
    cacheReader.pruneViewportTileCache(new Set([
      cacheReader.getViewportTileCacheKey(currentShell, '0:0'),
      cacheReader.getViewportTileCacheKey(currentShell, '1:0'),
    ]));

    assert.equal(oldShell.tileCache.has('0:0'), false);
    assert.equal(currentShell.tileCache.has('0:0'), true);
    assert.equal(currentShell.tileCache.has('1:0'), true);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.tileCacheEntryCount, 2);
    assert.equal(diagnostics.tileCacheMemoryBytes, 800);
    assert.equal(diagnostics.tileCacheCapacityBytes, 400);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader exposes viewport tile cache memory diagnostics', () => {
  const reader = createReader();
  const shell = createTileCacheShell(1);
  const cacheReader = reader as unknown as {
    viewportTileCacheMaxBytes: number;
    addShellViewportTile: (
      targetShell: typeof shell,
      tile: { key: string; x: number; y: number; width: number; height: number },
      canvas: HTMLCanvasElement,
      outputScale: number,
    ) => void;
  };

  try {
    cacheReader.viewportTileCacheMaxBytes = 1234;
    cacheReader.addShellViewportTile(
      shell,
      { key: '0:0', x: 0, y: 0, width: 8, height: 8 },
      createSizedCanvas(8, 8),
      1,
    );

    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.tileCacheMemoryBytes, 256);
    assert.equal(diagnostics.tileCacheCapacityBytes, 1234);
    assert.equal(diagnostics.tileCacheEntryCount, 1);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader continues progressive PDFium renders across frames', async () => {
  const reader = createReader();
  let frameYields = 0;
  let startCalls = 0;
  let continueCalls = 0;
  let closeCalls = 0;
  let removedFunctionPtr = 0;
  let freedPausePtr = 0;
  const setValues: Array<[number, number, string]> = [];
  const renderReader = reader as unknown as {
    waitForNextFrame: () => Promise<void>;
    renderPdfPageBitmap: (
      documentHandle: unknown,
      bitmapPtr: number,
      pagePtr: number,
      startX: number,
      startY: number,
      sizeX: number,
      sizeY: number,
      rotate: number,
      flags: number,
    ) => Promise<void>;
  };
  const documentHandle = {
    pdfium: {
      FPDF_RenderPageBitmap_Start: (
        bitmapPtr: number,
        pagePtr: number,
        startX: number,
        startY: number,
        sizeX: number,
        sizeY: number,
        rotate: number,
        flags: number,
        pausePtr: number,
      ) => {
        startCalls += 1;
        assert.deepEqual(
          [bitmapPtr, pagePtr, startX, startY, sizeX, sizeY, rotate, flags, pausePtr],
          [11, 22, 1, 2, 300, 400, 0, 18, 1000],
        );
        return 1;
      },
      FPDF_RenderPage_Continue: (pagePtr: number, pausePtr: number) => {
        assert.equal(pagePtr, 22);
        assert.equal(pausePtr, 1000);
        continueCalls += 1;
        return continueCalls < 2 ? 1 : 2;
      },
      FPDF_RenderPage_Close: (pagePtr: number) => {
        assert.equal(pagePtr, 22);
        closeCalls += 1;
      },
      pdfium: {
        addFunction: (_callback: (pausePtr: number) => number, signature: string) => {
          assert.equal(signature, 'ii');
          return 2000;
        },
        removeFunction: (callbackPtr: number) => {
          removedFunctionPtr = callbackPtr;
        },
        setValue: (ptr: number, value: number, type: string) => {
          setValues.push([ptr, value, type]);
        },
        wasmExports: {
          malloc: (size: number) => {
            assert.equal(size, 8);
            return 1000;
          },
          free: (ptr: number) => {
            freedPausePtr = ptr;
          },
        },
      },
    },
  };

  renderReader.waitForNextFrame = async () => {
    frameYields += 1;
  };

  try {
    await renderReader.renderPdfPageBitmap(
      documentHandle,
      11,
      22,
      1,
      2,
      300,
      400,
      0,
      18,
    );

    assert.equal(startCalls, 1);
    assert.equal(continueCalls, 2);
    assert.equal(closeCalls, 1);
    assert.equal(frameYields, 2);
    assert.equal(removedFunctionPtr, 2000);
    assert.equal(freedPausePtr, 1000);
    assert.deepEqual(setValues, [
      [1000, 1, 'i32'],
      [1004, 2000, 'i32'],
    ]);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.progressiveRenderYieldCount, 2);
    assert.equal(diagnostics.progressiveRenderFallbackCount, 0);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader falls back to synchronous PDFium render without progressive hooks', async () => {
  const reader = createReader();
  let syncRenderCalls = 0;
  const renderReader = reader as unknown as {
    renderPdfPageBitmap: (
      documentHandle: unknown,
      bitmapPtr: number,
      pagePtr: number,
      startX: number,
      startY: number,
      sizeX: number,
      sizeY: number,
      rotate: number,
      flags: number,
    ) => Promise<void>;
  };
  const documentHandle = {
    pdfium: {
      FPDF_RenderPageBitmap: (
        bitmapPtr: number,
        pagePtr: number,
        startX: number,
        startY: number,
        sizeX: number,
        sizeY: number,
        rotate: number,
        flags: number,
      ) => {
        syncRenderCalls += 1;
        assert.deepEqual(
          [bitmapPtr, pagePtr, startX, startY, sizeX, sizeY, rotate, flags],
          [11, 22, 1, 2, 300, 400, 0, 18],
        );
      },
      pdfium: {
        wasmExports: {},
      },
    },
  };

  try {
    await renderReader.renderPdfPageBitmap(
      documentHandle,
      11,
      22,
      1,
      2,
      300,
      400,
      0,
      18,
    );

    assert.equal(syncRenderCalls, 1);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.progressiveRenderYieldCount, 0);
    assert.equal(diagnostics.progressiveRenderFallbackCount, 1);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader renders full pages with the PDFium worker when available', async () => {
  const reader = createReader();
  const shell = createTileCacheShell(4);
  const renderedPixels = new Uint8Array(24 * 32 * 4);
  let receivedDocumentId = 0;
  let receivedPage: Record<string, number> | null = null;
  let putImageDataCalls = 0;
  const previousImageData = globalThis.ImageData;
  const renderReader = reader as unknown as {
    pdfRenderWorkerClient: {
      renderPage: (documentId: number, pageRequest: Record<string, number>) => Promise<{
        documentId: number;
        pageNumber: number;
        bitmapWidth: number;
        bitmapHeight: number;
        pixels: ArrayBuffer;
      }>;
      dispose: () => void;
    };
    pdfRenderWorkerReady: Promise<void>;
    pdfRenderWorkerDocumentId: number;
    pdfRenderWorkerAvailable: boolean;
    tryRenderPdfPageWithWorker: (
      shell: unknown,
      bitmapWidth: number,
      bitmapHeight: number,
      context: CanvasRenderingContext2D,
    ) => Promise<boolean>;
  };

  class FakeImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }

  renderReader.pdfRenderWorkerClient = {
    renderPage: async (documentId, pageRequest) => {
      receivedDocumentId = documentId;
      receivedPage = pageRequest;
      return {
        documentId,
        pageNumber: shell.pageNumber,
        bitmapWidth: 24,
        bitmapHeight: 32,
        pixels: renderedPixels.buffer,
      };
    },
    dispose: () => {},
  };
  renderReader.pdfRenderWorkerReady = Promise.resolve();
  renderReader.pdfRenderWorkerDocumentId = 31;
  renderReader.pdfRenderWorkerAvailable = true;
  globalThis.ImageData = FakeImageData as unknown as typeof ImageData;

  try {
    const didRender = await renderReader.tryRenderPdfPageWithWorker(
      shell,
      24,
      32,
      {
        putImageData: (imageData: ImageData, x: number, y: number) => {
          putImageDataCalls += 1;
          assert.equal(x, 0);
          assert.equal(y, 0);
          assert.equal(imageData.width, 24);
          assert.equal(imageData.height, 32);
          assert.equal(imageData.data.length, 24 * 32 * 4);
        },
      } as unknown as CanvasRenderingContext2D,
    );

    assert.equal(didRender, true);
    assert.equal(receivedDocumentId, 31);
    assert.deepEqual(receivedPage, {
      pageNumber: 4,
      bitmapWidth: 24,
      bitmapHeight: 32,
      rotate: 0,
      flags: 18,
    });
    assert.equal(putImageDataCalls, 1);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.workerPageRenderCount, 1);
    assert.equal(diagnostics.workerPageRenderFallbackCount, 0);
    assert.equal(diagnostics.workerPageRenderErrorCount, 0);
  } finally {
    globalThis.ImageData = previousImageData;
    reader.dispose();
  }
});

test('PdfDocumentReader does not block full-page rendering while the PDFium worker is warming up', async () => {
  const reader = createReader();
  let renderPageCalls = 0;
  const renderReader = reader as unknown as {
    pdfRenderWorkerClient: {
      renderPage: () => Promise<never>;
      dispose: () => void;
    };
    pdfRenderWorkerReady: Promise<void>;
    pdfRenderWorkerDocumentId: number;
    pdfRenderWorkerAvailable: boolean;
    tryRenderPdfPageWithWorker: (
      shell: unknown,
      bitmapWidth: number,
      bitmapHeight: number,
      context: CanvasRenderingContext2D,
    ) => Promise<boolean>;
  };

  renderReader.pdfRenderWorkerClient = {
    renderPage: async () => {
      renderPageCalls += 1;
      throw new Error('Worker should not render full pages before it is ready.');
    },
    dispose: () => {},
  };
  renderReader.pdfRenderWorkerReady = new Promise(() => {});
  renderReader.pdfRenderWorkerDocumentId = 19;
  renderReader.pdfRenderWorkerAvailable = false;

  try {
    const didRender = await renderReader.tryRenderPdfPageWithWorker(
      createTileCacheShell(1),
      8,
      8,
      {
        putImageData: () => {
          throw new Error('Worker warmup fallback should not write image data.');
        },
      } as unknown as CanvasRenderingContext2D,
    );

    assert.equal(didRender, false);
    assert.equal(renderPageCalls, 0);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.workerPageRenderFallbackCount, 1);
    assert.equal(diagnostics.workerPageRenderErrorCount, 0);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader renders viewport tiles with the PDFium worker when available', async () => {
  const reader = createReader();
  const shell = createTileCacheShell(3);
  const viewportTile = { key: '1:2', x: 32, y: 64, width: 16, height: 8 };
  const renderedPixels = new Uint8Array(32 * 16 * 4);
  let receivedDocumentId = 0;
  let receivedTile: Record<string, number> | null = null;
  let putImageDataCalls = 0;
  const previousImageData = globalThis.ImageData;
  const renderReader = reader as unknown as {
    pdfRenderWorkerClient: {
      renderTile: (documentId: number, tileRequest: Record<string, number>) => Promise<{
        documentId: number;
        pageNumber: number;
        bitmapWidth: number;
        bitmapHeight: number;
        pixels: ArrayBuffer;
      }>;
      dispose: () => void;
    };
    pdfRenderWorkerReady: Promise<void>;
    pdfRenderWorkerDocumentId: number;
    pdfRenderWorkerAvailable: boolean;
    tryRenderPdfViewportTileWithWorker: (
      shell: unknown,
      tile: typeof viewportTile,
      outputScale: number,
      bitmapWidth: number,
      bitmapHeight: number,
      context: CanvasRenderingContext2D,
    ) => Promise<boolean>;
  };

  class FakeImageData {
    constructor(
      readonly data: Uint8ClampedArray,
      readonly width: number,
      readonly height: number,
    ) {}
  }

  renderReader.pdfRenderWorkerClient = {
    renderTile: async (documentId, tileRequest) => {
      receivedDocumentId = documentId;
      receivedTile = tileRequest;
      return {
        documentId,
        pageNumber: shell.pageNumber,
        bitmapWidth: 32,
        bitmapHeight: 16,
        pixels: renderedPixels.buffer,
      };
    },
    dispose: () => {},
  };
  renderReader.pdfRenderWorkerReady = Promise.resolve();
  renderReader.pdfRenderWorkerDocumentId = 17;
  renderReader.pdfRenderWorkerAvailable = true;
  globalThis.ImageData = FakeImageData as unknown as typeof ImageData;

  try {
    const didRender = await renderReader.tryRenderPdfViewportTileWithWorker(
      shell,
      viewportTile,
      2,
      32,
      16,
      {
        putImageData: (imageData: ImageData, x: number, y: number) => {
          putImageDataCalls += 1;
          assert.equal(x, 0);
          assert.equal(y, 0);
          assert.equal(imageData.width, 32);
          assert.equal(imageData.height, 16);
          assert.equal(imageData.data.length, 32 * 16 * 4);
        },
      } as unknown as CanvasRenderingContext2D,
    );

    assert.equal(didRender, true);
    assert.equal(receivedDocumentId, 17);
    assert.deepEqual(receivedTile, {
      pageNumber: 3,
      bitmapWidth: 32,
      bitmapHeight: 16,
      startX: -64,
      startY: -128,
      sizeX: 200,
      sizeY: 200,
      rotate: 0,
      flags: 18,
    });
    assert.equal(putImageDataCalls, 1);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.workerTileRenderCount, 1);
    assert.equal(diagnostics.workerTileRenderFallbackCount, 0);
    assert.equal(diagnostics.workerTileRenderErrorCount, 0);
  } finally {
    globalThis.ImageData = previousImageData;
    reader.dispose();
  }
});

test('PdfDocumentReader does not block viewport tile rendering while the PDFium worker is warming up', async () => {
  const reader = createReader();
  let renderTileCalls = 0;
  const renderReader = reader as unknown as {
    pdfRenderWorkerClient: {
      renderTile: () => Promise<never>;
      dispose: () => void;
    };
    pdfRenderWorkerReady: Promise<void>;
    pdfRenderWorkerDocumentId: number;
    pdfRenderWorkerAvailable: boolean;
    tryRenderPdfViewportTileWithWorker: (
      shell: unknown,
      tile: { key: string; x: number; y: number; width: number; height: number },
      outputScale: number,
      bitmapWidth: number,
      bitmapHeight: number,
      context: CanvasRenderingContext2D,
    ) => Promise<boolean>;
  };

  renderReader.pdfRenderWorkerClient = {
    renderTile: async () => {
      renderTileCalls += 1;
      throw new Error('Worker should not render before it is ready.');
    },
    dispose: () => {},
  };
  renderReader.pdfRenderWorkerReady = new Promise(() => {});
  renderReader.pdfRenderWorkerDocumentId = 9;
  renderReader.pdfRenderWorkerAvailable = false;

  try {
    const didRender = await renderReader.tryRenderPdfViewportTileWithWorker(
      createTileCacheShell(1),
      { key: '0:0', x: 0, y: 0, width: 8, height: 8 },
      1,
      8,
      8,
      {
        putImageData: () => {
          throw new Error('Worker warmup fallback should not write image data.');
        },
      } as unknown as CanvasRenderingContext2D,
    );

    assert.equal(didRender, false);
    assert.equal(renderTileCalls, 0);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.workerTileRenderFallbackCount, 1);
    assert.equal(diagnostics.workerTileRenderErrorCount, 0);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader disables the PDFium worker after a tile render failure', async () => {
  const reader = createReader();
  const shell = createTileCacheShell(1);
  let disposeCalls = 0;
  const originalWarn = console.warn;
  const renderReader = reader as unknown as {
    pdfRenderWorkerClient: {
      renderTile: () => Promise<never>;
      dispose: () => void;
    } | null;
    pdfRenderWorkerReady: Promise<void> | null;
    pdfRenderWorkerDocumentId: number;
    pdfRenderWorkerAvailable: boolean;
    tryRenderPdfViewportTileWithWorker: (
      shell: unknown,
      tile: { key: string; x: number; y: number; width: number; height: number },
      outputScale: number,
      bitmapWidth: number,
      bitmapHeight: number,
      context: CanvasRenderingContext2D,
    ) => Promise<boolean>;
  };

  renderReader.pdfRenderWorkerClient = {
    renderTile: async () => {
      throw new Error('worker render failed');
    },
    dispose: () => {
      disposeCalls += 1;
    },
  };
  renderReader.pdfRenderWorkerReady = Promise.resolve();
  renderReader.pdfRenderWorkerDocumentId = 22;
  renderReader.pdfRenderWorkerAvailable = true;
  console.warn = () => {};

  try {
    const didRender = await renderReader.tryRenderPdfViewportTileWithWorker(
      shell,
      { key: '0:0', x: 0, y: 0, width: 8, height: 8 },
      1,
      8,
      8,
      {
        putImageData: () => {
          throw new Error('Worker failure should not write image data.');
        },
      } as unknown as CanvasRenderingContext2D,
    );

    assert.equal(didRender, false);
    assert.equal(disposeCalls, 1);
    assert.equal(renderReader.pdfRenderWorkerClient, null);
    assert.equal(renderReader.pdfRenderWorkerReady, null);
    assert.equal(renderReader.pdfRenderWorkerAvailable, false);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.workerTileRenderCount, 0);
    assert.equal(diagnostics.workerTileRenderErrorCount, 1);
  } finally {
    console.warn = originalWarn;
    reader.dispose();
  }
});

test('PdfDocumentReader yields between missing viewport tiles', async () => {
  const reader = createReader();
  const pageElement = document.createElement('section');
  const pageCanvasWrap = document.createElement('div');
  const tileLayer = document.createElement('div');
  const highlightLayer = document.createElement('div');
  const shell = {
    pageNumber: 1,
    pageWidth: 1200,
    pageHeight: 1200,
    scale: 1,
    outputScale: 1,
    cssWidth: 1200,
    cssHeight: 1200,
    pageElement,
    pageCanvasWrap,
    tileLayer,
    tileCache: new Map<string, HTMLCanvasElement>(),
    tileOutputScale: 0,
    highlightLayer,
    canvas: null,
    renderState: 'rendered',
    lastVisibleAt: 0,
  };
  const renderedTiles: string[] = [];
  let frameYields = 0;
  const originalPerformanceNow = performance.now;
  const renderTimestamps = [0, 10, 16, 20, 31, 40, 56];
  const tileReader = reader as unknown as {
    loadVersion: number;
    pageRenderVersion: number;
    getViewportTilesForShell: () => Array<{ key: string; x: number; y: number; width: number; height: number }>;
    getOutputScale: () => number;
    isShellRenderedAtCurrentGeometry: () => boolean;
    renderPdfViewportTileIntoCanvas: (
      documentHandle: unknown,
      shell: unknown,
      tile: { key: string },
      outputScale: number,
    ) => HTMLCanvasElement;
    yieldForPendingUserInput: () => Promise<void>;
    yieldForRenderBudget: (sliceStartedAt: number) => Promise<number>;
    waitForNextFrame: () => Promise<void>;
    renderPdfPageViewportTiles: (
      documentHandle: unknown,
      shell: unknown,
      version: number,
      pageRenderVersion: number,
    ) => Promise<boolean>;
  };
  const documentHandle = {
    pdfium: {
      FPDF_LoadPage: () => 1,
      FPDF_ClosePage: () => {},
    },
    documentPtr: 1,
  };

  tileReader.getViewportTilesForShell = () => [
    { key: '1:1', x: 512, y: 512, width: 512, height: 512 },
    { key: '1:0', x: 512, y: 0, width: 512, height: 512 },
    { key: '0:1', x: 0, y: 512, width: 512, height: 512 },
  ];
  tileReader.getOutputScale = () => 2;
  tileReader.isShellRenderedAtCurrentGeometry = () => false;
  tileReader.yieldForPendingUserInput = async () => {};
  tileReader.yieldForRenderBudget = async (sliceStartedAt) => sliceStartedAt;
  tileReader.renderPdfViewportTileIntoCanvas = (_documentHandle, _shell, tile) => {
    assert.equal(tileLayer.childElementCount, 0);
    renderedTiles.push(tile.key);
    return document.createElement('canvas');
  };
  tileReader.waitForNextFrame = async () => {
    frameYields += 1;
  };

  try {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => renderTimestamps.shift() ?? 31,
    });
    const didRender = await tileReader.renderPdfPageViewportTiles(
      documentHandle,
      shell,
      tileReader.loadVersion,
      tileReader.pageRenderVersion,
    );

    assert.equal(didRender, true);
    assert.deepEqual(renderedTiles, ['1:1', '1:0', '0:1']);
    assert.equal(frameYields, 2);
    assert.equal(tileLayer.childElementCount, 3);
    assert.equal(shell.tileCache.size, 3);
    const diagnostics = getRenderDiagnostics(reader);
    assert.equal(diagnostics.tileRenderCount, 3);
    assert.equal(diagnostics.tileRenderTotalMs, 33);
    assert.equal(diagnostics.tileRenderAverageMs, 11);
    assert.equal(diagnostics.tileRenderMaxMs, 16);
  } finally {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: originalPerformanceNow,
    });
    reader.dispose();
  }
});

test('PdfDocumentReader yields before tile rendering when user input is pending', async () => {
  const reader = createReader();
  let frameYields = 0;
  let didRenderTile = false;
  const tileReader = reader as unknown as {
    loadVersion: number;
    pageRenderVersion: number;
    getViewportTilesForShell: () => Array<{ key: string; x: number; y: number; width: number; height: number }>;
    getOutputScale: () => number;
    isShellRenderedAtCurrentGeometry: () => boolean;
    hasPendingUserInput: () => boolean;
    waitForNextFrame: () => Promise<void>;
    renderPdfViewportTileIntoCanvas: () => HTMLCanvasElement;
    renderPdfPageViewportTiles: (
      documentHandle: unknown,
      shell: unknown,
      version: number,
      pageRenderVersion: number,
    ) => Promise<boolean>;
  };
  const shell = {
    pageNumber: 1,
    cssWidth: 1200,
    cssHeight: 1200,
    outputScale: 1,
    tileCache: new Map<string, HTMLCanvasElement>(),
    tileOutputScale: 0,
    tileLayer: document.createElement('div'),
  };

  tileReader.getViewportTilesForShell = () => [
    { key: '2:2', x: 768, y: 768, width: 384, height: 384 },
  ];
  tileReader.getOutputScale = () => 2;
  tileReader.isShellRenderedAtCurrentGeometry = () => false;
  tileReader.hasPendingUserInput = () => !didRenderTile;
  tileReader.waitForNextFrame = async () => {
    frameYields += 1;
  };
  tileReader.renderPdfViewportTileIntoCanvas = () => {
    didRenderTile = true;
    return document.createElement('canvas');
  };

  try {
    await tileReader.renderPdfPageViewportTiles(
      {},
      shell,
      tileReader.loadVersion,
      tileReader.pageRenderVersion,
    );

    assert.equal(frameYields, 1);
    assert.equal(didRenderTile, true);
    assert.equal(getRenderDiagnostics(reader).inputPendingYieldCount, 1);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader yields before tile rendering when the render slice is spent', async () => {
  const reader = createReader();
  let frameYields = 0;
  let didRenderTile = false;
  const tileReader = reader as unknown as {
    loadVersion: number;
    pageRenderVersion: number;
    getViewportTilesForShell: () => Array<{ key: string; x: number; y: number; width: number; height: number }>;
    getOutputScale: () => number;
    isShellRenderedAtCurrentGeometry: () => boolean;
    hasPendingUserInput: () => boolean;
    yieldForRenderBudget: (sliceStartedAt: number) => Promise<number>;
    waitForNextFrame: () => Promise<void>;
    renderPdfViewportTileIntoCanvas: () => HTMLCanvasElement;
    renderPdfPageViewportTiles: (
      documentHandle: unknown,
      shell: unknown,
      version: number,
      pageRenderVersion: number,
    ) => Promise<boolean>;
  };
  const shell = {
    pageNumber: 1,
    cssWidth: 1200,
    cssHeight: 1200,
    outputScale: 1,
    tileCache: new Map<string, HTMLCanvasElement>(),
    tileOutputScale: 0,
    tileLayer: document.createElement('div'),
  };

  tileReader.getViewportTilesForShell = () => [
    { key: '2:2', x: 768, y: 768, width: 384, height: 384 },
  ];
  tileReader.getOutputScale = () => 2;
  tileReader.isShellRenderedAtCurrentGeometry = () => false;
  tileReader.hasPendingUserInput = () => false;
  tileReader.yieldForRenderBudget = async () => {
    frameYields += 1;
    return performance.now();
  };
  tileReader.waitForNextFrame = async () => {};
  tileReader.renderPdfViewportTileIntoCanvas = () => {
    didRenderTile = true;
    return document.createElement('canvas');
  };

  try {
    await tileReader.renderPdfPageViewportTiles(
      {},
      shell,
      tileReader.loadVersion,
      tileReader.pageRenderVersion,
    );

    assert.equal(frameYields, 1);
    assert.equal(didRenderTile, true);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader records render budget yields without relying on real time', async () => {
  const reader = createReader();
  let frameYields = 0;
  const originalPerformanceNow = performance.now;
  const timestamps = [9, 12];
  const budgetReader = reader as unknown as {
    yieldForRenderBudget: (sliceStartedAt: number) => Promise<number>;
    waitForNextFrame: () => Promise<void>;
  };

  budgetReader.waitForNextFrame = async () => {
    frameYields += 1;
  };

  try {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: () => timestamps.shift() ?? 12,
    });

    const nextSliceStartedAt = await budgetReader.yieldForRenderBudget(0);

    assert.equal(frameYields, 1);
    assert.equal(nextSliceStartedAt, 12);
    assert.equal(getRenderDiagnostics(reader).renderBudgetYieldCount, 1);
  } finally {
    Object.defineProperty(performance, 'now', {
      configurable: true,
      value: originalPerformanceNow,
    });
    reader.dispose();
  }
});

test('PdfDocumentReader pauses visible PDF rendering while text selection is dragging', () => {
  const reader = createReader();
  let renderRequests = 0;
  let renderCancels = 0;
  const renderReader = reader as unknown as {
    documentHandle: unknown;
    readerStatus: { state: string; message: string };
    renderScheduler: {
      request: (callback: unknown, onError: unknown) => void;
      cancel: () => void;
    };
    handleSelectionDragChange: (isDragging: boolean) => void;
    scheduleVisiblePageRender: () => void;
  };

  renderReader.documentHandle = {};
  renderReader.readerStatus = { state: 'ready', message: '1 pages' };
  renderReader.renderScheduler = {
    request: () => {
      renderRequests += 1;
    },
    cancel: () => {
      renderCancels += 1;
    },
  };

  try {
    renderReader.handleSelectionDragChange(true);
    renderReader.scheduleVisiblePageRender();

    assert.equal(renderCancels, 1);
    assert.equal(renderRequests, 0);

    renderReader.handleSelectionDragChange(false);

    assert.equal(renderRequests, 1);
  } finally {
    renderReader.documentHandle = null;
    reader.dispose();
  }
});

test('PdfDocumentReader defers viewport quality catch-up while user input is pending', () => {
  const reader = createReader();
  let hasPendingInput = true;
  let renderRequests = 0;
  const frameCallbacks: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const renderReader = reader as unknown as {
    documentHandle: unknown;
    pageRenderVersion: number;
    readerStatus: { state: string; message: string };
    hasPendingUserInput: () => boolean;
    renderScheduler: {
      request: (callback: unknown, onError: unknown) => void;
      cancel: () => void;
    };
    scheduleViewportQualityRender: (pageRenderVersion: number) => void;
  };

  renderReader.documentHandle = {};
  renderReader.readerStatus = { state: 'ready', message: '1 pages' };
  renderReader.hasPendingUserInput = () => hasPendingInput;
  renderReader.renderScheduler = {
    request: () => {
      renderRequests += 1;
    },
    cancel: () => {},
  };
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  };
  window.cancelAnimationFrame = () => {};

  try {
    renderReader.scheduleViewportQualityRender(renderReader.pageRenderVersion);
    renderReader.scheduleViewportQualityRender(renderReader.pageRenderVersion);

    assert.equal(renderRequests, 0);
    assert.equal(frameCallbacks.length, 1);
    assert.equal(getRenderDiagnostics(reader).qualityRetryCount, 1);

    hasPendingInput = false;
    frameCallbacks[0](performance.now());

    assert.equal(renderRequests, 1);
  } finally {
    renderReader.documentHandle = null;
    reader.dispose();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test('PdfDocumentReader does not start queued viewport quality catch-up when input becomes pending', async () => {
  const reader = createReader();
  let hasPendingInput = false;
  let didQueueRender = false;
  let queuedRender: (renderToken: { isStale: () => boolean }) => Promise<void> = async () => {
    throw new Error('Expected viewport quality render to be queued.');
  };
  let didRenderTiles = false;
  let didRenderPages = false;
  const frameCallbacks: FrameRequestCallback[] = [];
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const renderReader = reader as unknown as {
    documentHandle: unknown;
    pageRenderVersion: number;
    readerStatus: { state: string; message: string };
    hasPendingUserInput: () => boolean;
    renderScheduler: {
      request: (
        callback: (renderToken: { isStale: () => boolean }) => Promise<void>,
        onError: (error: unknown) => void,
      ) => void;
      cancel: () => void;
    };
    renderVisiblePdfPageTiles: () => Promise<void>;
    renderVisiblePdfPages: () => Promise<void>;
    scheduleViewportQualityRender: (pageRenderVersion: number) => void;
  };

  renderReader.documentHandle = {};
  renderReader.readerStatus = { state: 'ready', message: '1 pages' };
  renderReader.hasPendingUserInput = () => hasPendingInput;
  renderReader.renderScheduler = {
    request: (callback) => {
      didQueueRender = true;
      queuedRender = callback;
    },
    cancel: () => {},
  };
  renderReader.renderVisiblePdfPageTiles = async () => {
    didRenderTiles = true;
  };
  renderReader.renderVisiblePdfPages = async () => {
    didRenderPages = true;
  };
  window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    frameCallbacks.push(callback);
    return frameCallbacks.length;
  };
  window.cancelAnimationFrame = () => {};

  try {
    renderReader.scheduleViewportQualityRender(renderReader.pageRenderVersion);
    assert.equal(didQueueRender, true);

    hasPendingInput = true;
    await queuedRender({ isStale: () => false });

    assert.equal(didRenderTiles, false);
    assert.equal(didRenderPages, false);
    assert.equal(frameCallbacks.length, 1);
    assert.equal(getRenderDiagnostics(reader).qualityRetryCount, 1);
  } finally {
    renderReader.documentHandle = null;
    reader.dispose();
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});

test('PdfDocumentReader commits full-page quality before viewport tile catch-up', async () => {
  const reader = createReader();
  const renderOrder: string[] = [];
  let queuedRender: (renderToken: { isStale: () => boolean }) => Promise<void> = async () => {};
  const renderReader = reader as unknown as {
    documentHandle: unknown;
    pageRenderVersion: number;
    readerStatus: { state: string; message: string };
    hasPendingUserInput: () => boolean;
    renderScheduler: {
      request: (
        callback: (renderToken: { isStale: () => boolean }) => Promise<void>,
        onError: (error: unknown) => void,
      ) => void;
      cancel: () => void;
    };
    renderVisiblePdfPageTiles: () => Promise<void>;
    renderVisiblePdfPages: (
      version: number,
      pageRenderVersion: number,
      renderToken: unknown,
      options: { maxPriority?: number; quality?: 'interactive' | 'quality' },
    ) => Promise<void>;
    scheduleVisiblePageRender: () => void;
    scheduleViewportQualityRender: (pageRenderVersion: number) => void;
  };

  renderReader.documentHandle = {};
  renderReader.readerStatus = { state: 'ready', message: '1 pages' };
  renderReader.hasPendingUserInput = () => false;
  renderReader.renderScheduler = {
    request: (callback) => {
      queuedRender = callback;
    },
    cancel: () => {},
  };
  renderReader.renderVisiblePdfPages = async (_version, _pageRenderVersion, _renderToken, options) => {
    renderOrder.push(`pages:${options.maxPriority}:${options.quality}`);
  };
  renderReader.renderVisiblePdfPageTiles = async () => {
    renderOrder.push('tiles');
  };
  renderReader.scheduleVisiblePageRender = () => {
    renderOrder.push('visible');
  };

  try {
    renderReader.scheduleViewportQualityRender(renderReader.pageRenderVersion);
    await queuedRender({ isStale: () => false });

    assert.deepEqual(renderOrder, ['pages:0:quality', 'tiles', 'visible']);
  } finally {
    renderReader.documentHandle = null;
    reader.dispose();
  }
});

test('PdfDocumentReader uses interactive visible rendering while user input is pending', async () => {
  const reader = createReader();
  let didRenderTiles = false;
  let scheduledViewportQuality = 0;
  let visibleRenderQuality: 'interactive' | 'quality' | undefined;
  let queuedRender: (renderToken: { isStale: () => boolean }) => Promise<void> = async () => {};
  const renderReader = reader as unknown as {
    documentHandle: unknown;
    pageRenderVersion: number;
    readerStatus: { state: string; message: string };
    hasPendingUserInput: () => boolean;
    renderScheduler: {
      request: (
        callback: (renderToken: { isStale: () => boolean }) => Promise<void>,
        onError: (error: unknown) => void,
      ) => void;
      cancel: () => void;
    };
    renderVisiblePdfPageTiles: () => Promise<void>;
    renderVisiblePdfPages: (
      version: number,
      pageRenderVersion: number,
      renderToken: unknown,
      options: { quality?: 'interactive' | 'quality' },
    ) => Promise<void>;
    scheduleViewportQualityRender: (pageRenderVersion: number) => void;
    scheduleVisiblePageRender: () => void;
  };

  renderReader.documentHandle = {};
  renderReader.readerStatus = { state: 'ready', message: '1 pages' };
  renderReader.hasPendingUserInput = () => true;
  renderReader.renderScheduler = {
    request: (callback) => {
      queuedRender = callback;
    },
    cancel: () => {},
  };
  renderReader.renderVisiblePdfPageTiles = async () => {
    didRenderTiles = true;
  };
  renderReader.renderVisiblePdfPages = async (_version, _pageRenderVersion, _renderToken, options) => {
    visibleRenderQuality = options.quality;
  };
  renderReader.scheduleViewportQualityRender = () => {
    scheduledViewportQuality += 1;
  };

  try {
    renderReader.scheduleVisiblePageRender();
    await queuedRender({ isStale: () => false });

    assert.equal(didRenderTiles, false);
    assert.equal(visibleRenderQuality, 'interactive');
    assert.equal(scheduledViewportQuality, 1);
    assert.equal(getRenderDiagnostics(reader).qualityDeferralCount, 1);
  } finally {
    renderReader.documentHandle = null;
    reader.dispose();
  }
});

test('PdfDocumentReader refreshes only changed selection pages for selection-only updates', () => {
  const reader = createReader();
  const renderedPages: number[] = [];
  let fullHighlightRenders = 0;
  const chromeReader = reader as unknown as {
    renderAllHighlights: () => void;
    renderHighlightsForPage: (page: number) => void;
  };

  chromeReader.renderAllHighlights = () => {
    fullHighlightRenders += 1;
  };
  chromeReader.renderHighlightsForPage = (page) => {
    renderedPages.push(page);
  };

  try {
    reader.setSelection(createPdfSelection({
      page: 1,
      rects: [{ x: 0, y: 0, width: 10, height: 10 }],
      text: 'a',
    }));
    reader.setSelection(createPdfSelection({
      page: 2,
      rects: [{ x: 0, y: 0, width: 10, height: 10 }],
      text: 'b',
    }));

    assert.equal(fullHighlightRenders, 0);
    assert.deepEqual(renderedPages, [1, 1, 2]);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader keeps common wide pages sharp on high-DPI displays', () => {
  const reader = createReader();
  const outputScaleReader = reader as unknown as {
    getOutputScale: (
      cssWidth: number,
      cssHeight: number,
      quality?: 'interactive' | 'quality',
    ) => number;
  };
  const originalDevicePixelRatio = window.devicePixelRatio;

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 2,
    });

    assert.equal(outputScaleReader.getOutputScale(1950, 2760), 2);
    assert.equal(outputScaleReader.getOutputScale(1950, 2760, 'interactive'), 1);
    assert.equal(outputScaleReader.getOutputScale(8000, 8000), 1);
  } finally {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: originalDevicePixelRatio,
    });
    reader.dispose();
  }
});

test('PdfDocumentReader keeps page preview scaling uniform after CSS pixel snapping', () => {
  const reader = createReader();
  const geometryReader = reader as unknown as {
    getPageGeometry: (
      pageWidth: number,
      pageHeight: number,
    ) => { scale: number; cssWidth: number; cssHeight: number };
  };
  const originalDevicePixelRatio = window.devicePixelRatio;

  try {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: 1.5,
    });

    const geometry = geometryReader.getPageGeometry(536, 693);

    assert.equal(geometry.cssWidth * 1.5, Math.round(geometry.cssWidth * 1.5));
    assert.ok(
      Math.abs((geometry.cssWidth / 536) - (geometry.cssHeight / 693)) < 1e-12,
    );
    assert.equal(geometry.scale, geometry.cssWidth / 536);
  } finally {
    Object.defineProperty(window, 'devicePixelRatio', {
      configurable: true,
      value: originalDevicePixelRatio,
    });
    reader.dispose();
  }
});

test('PdfDocumentReader applies continuous wheel zoom without waiting for a step threshold', () => {
  const reader = createReader();
  const zoomReader = reader as unknown as {
    viewportModel: {
      getZoomScale: () => number;
    };
    zoomRenderTimer: number | null;
  };
  const pagesElement = reader.getElement().querySelector('.pdf-reader-pages');
  assert(pagesElement);

  try {
    pagesElement.dispatchEvent(createWheelEvent({
      deltaY: -20,
    }));

    const zoomScale = zoomReader.viewportModel.getZoomScale();
    assert(zoomScale > 1);
    assert(zoomScale < 1.1);
    assert.notEqual(zoomReader.zoomRenderTimer, null);
  } finally {
    reader.dispose();
  }
});

test('PdfDocumentReader can limit zoom rerender work to viewport pages', async () => {
  const reader = createReader();
  const viewportShell = {
    pageNumber: 1,
    renderState: 'empty',
  };
  const preloadShell = {
    pageNumber: 2,
    renderState: 'empty',
  };
  const renderedPages: number[] = [];
  const renderReader = reader as unknown as {
    documentHandle: unknown;
    getVisiblePageShells: () => Array<{
      shell: typeof viewportShell;
      priority: number;
    }>;
    renderPdfPageIntoShell: (
      documentHandle: unknown,
      shell: typeof viewportShell,
      version: number,
      pageRenderVersion: number,
      options?: { quality?: 'interactive' | 'quality' },
    ) => Promise<boolean>;
    evictDistantRenderedPages: () => void;
    renderVisiblePdfPages: (
      version: number,
      pageRenderVersion: number,
      renderToken?: unknown,
      options?: {
        maxPriority?: number;
        quality?: 'interactive' | 'quality';
      },
    ) => Promise<void>;
  };

  renderReader.documentHandle = {};
  renderReader.getVisiblePageShells = () => [
    { shell: viewportShell, priority: 0 },
    { shell: preloadShell, priority: 1 },
  ];
  renderReader.renderPdfPageIntoShell = async (_documentHandle, shell) => {
    renderedPages.push(shell.pageNumber);
    return true;
  };
  renderReader.evictDistantRenderedPages = () => {};

  try {
    await renderReader.renderVisiblePdfPages(0, 0, undefined, { maxPriority: 0 });

    assert.deepEqual(renderedPages, [1]);
  } finally {
    renderReader.documentHandle = null;
    reader.dispose();
  }
});
