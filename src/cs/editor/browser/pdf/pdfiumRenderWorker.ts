import { init as initPdfium } from 'cs/editor/browser/pdf/vendor/pdfium/index.js';
import type { WrappedPdfiumModule } from 'cs/editor/browser/pdf/vendor/pdfium/index.js';

type PdfiumWorkerDocument = {
  documentPtr: number;
  filePtr: number;
  pageCount: number;
};

type PdfiumWorkerModule = WrappedPdfiumModule & {
  pdfium: WrappedPdfiumModule['pdfium'] & {
    HEAPU8: Uint8Array;
  };
};

type PdfiumRenderWorkerBaseRequest = {
  id: number;
};

type PdfiumRenderWorkerRequest =
  | (PdfiumRenderWorkerBaseRequest & {
      type: 'init' | 'ping';
    })
  | (PdfiumRenderWorkerBaseRequest & {
      type: 'openDocument';
      documentId: number;
      pdfData: ArrayBuffer;
    })
  | (PdfiumRenderWorkerBaseRequest & {
      type: 'closeDocument';
      documentId: number;
    })
  | (PdfiumRenderWorkerBaseRequest & {
      type: 'renderTile';
      documentId: number;
      pageNumber: number;
      bitmapWidth: number;
      bitmapHeight: number;
      startX: number;
      startY: number;
      sizeX: number;
      sizeY: number;
      rotate: number;
      flags: number;
    })
  | (PdfiumRenderWorkerBaseRequest & {
      type: 'renderPage';
      documentId: number;
      pageNumber: number;
      bitmapWidth: number;
      bitmapHeight: number;
      rotate: number;
      flags: number;
    });

type PdfiumRenderWorkerBaseResponse = {
  id: number;
  type:
    | 'ready'
    | 'pong'
    | 'documentReady'
    | 'documentClosed'
    | 'tileRendered'
    | 'pageRendered'
    | 'error';
  message?: string;
};

type PdfiumRenderWorkerResponse =
  | PdfiumRenderWorkerBaseResponse
  | (PdfiumRenderWorkerBaseResponse & {
      type: 'documentReady';
      documentId: number;
      pageCount: number;
    })
  | (PdfiumRenderWorkerBaseResponse & {
      type: 'documentClosed';
      documentId: number;
    })
  | (PdfiumRenderWorkerBaseResponse & {
      type: 'tileRendered';
      documentId: number;
      pageNumber: number;
      bitmapWidth: number;
      bitmapHeight: number;
      pixels: ArrayBuffer;
    })
  | (PdfiumRenderWorkerBaseResponse & {
      type: 'pageRendered';
      documentId: number;
      pageNumber: number;
      bitmapWidth: number;
      bitmapHeight: number;
      pixels: ArrayBuffer;
    });

type PdfiumRenderWorkerScope = {
  addEventListener: (
    type: 'message',
    listener: (event: MessageEvent<PdfiumRenderWorkerRequest>) => void,
  ) => void;
  postMessage: (message: PdfiumRenderWorkerResponse, transfer?: Transferable[]) => void;
};

let pdfiumModulePromise: Promise<PdfiumWorkerModule> | null = null;
const workerScope = globalThis as unknown as PdfiumRenderWorkerScope;
const workerDocuments = new Map<number, PdfiumWorkerDocument>();
const pdfiumWasmUrl = new URL('./vendor/pdfium/pdfium.wasm', import.meta.url).toString();

async function loadPdfiumInWorker() {
  pdfiumModulePromise ??= fetch(pdfiumWasmUrl)
    .then(async (response) => {
      if (!response.ok) {
        throw new Error(`Failed to load PDFium WASM in worker: ${response.status} ${response.statusText}`);
      }

      return await response.arrayBuffer();
    })
    .then(async (wasmBinary) => {
      const pdfium = await initPdfium({ wasmBinary });
      pdfium.PDFiumExt_Init();
      return pdfium as PdfiumWorkerModule;
    });

  return await pdfiumModulePromise;
}

function postWorkerResponse(response: PdfiumRenderWorkerResponse) {
  workerScope.postMessage(response);
}

function postWorkerTransferResponse(
  response: PdfiumRenderWorkerResponse,
  transfer: Transferable[],
) {
  workerScope.postMessage(response, transfer);
}

function closeWorkerDocument(pdfium: PdfiumWorkerModule, documentId: number) {
  const document = workerDocuments.get(documentId);
  if (!document) {
    return;
  }

  pdfium.FPDF_CloseDocument(document.documentPtr);
  pdfium.pdfium.wasmExports.free(document.filePtr);
  workerDocuments.delete(documentId);
}

async function openWorkerDocument(request: Extract<PdfiumRenderWorkerRequest, { type: 'openDocument' }>) {
  const pdfium = await loadPdfiumInWorker();
  closeWorkerDocument(pdfium, request.documentId);
  const pdfData = new Uint8Array(request.pdfData);
  const filePtr = pdfium.pdfium.wasmExports.malloc(pdfData.byteLength);
  pdfium.pdfium.HEAPU8.set(pdfData, filePtr);
  const documentPtr = pdfium.FPDF_LoadMemDocument(filePtr, pdfData.byteLength, '');

  if (!documentPtr) {
    const errorCode = pdfium.FPDF_GetLastError();
    pdfium.pdfium.wasmExports.free(filePtr);
    throw new Error(`PDFium worker failed to load document: error=${errorCode}`);
  }

  const pageCount = pdfium.FPDF_GetPageCount(documentPtr);
  workerDocuments.set(request.documentId, {
    documentPtr,
    filePtr,
    pageCount,
  });
  postWorkerResponse({
    id: request.id,
    type: 'documentReady',
    documentId: request.documentId,
    pageCount,
  });
}

async function closeWorkerDocumentByRequest(
  request: Extract<PdfiumRenderWorkerRequest, { type: 'closeDocument' }>,
) {
  const pdfium = await loadPdfiumInWorker();
  closeWorkerDocument(pdfium, request.documentId);
  postWorkerResponse({
    id: request.id,
    type: 'documentClosed',
    documentId: request.documentId,
  });
}

function copyPdfBitmapToArrayBuffer(
  pdfium: PdfiumWorkerModule,
  bufferPtr: number,
  stride: number,
  bitmapWidth: number,
  bitmapHeight: number,
) {
  const rowSize = bitmapWidth * 4;
  const pixels = new Uint8ClampedArray(rowSize * bitmapHeight);

  for (let y = 0; y < bitmapHeight; y += 1) {
    const rowStart = bufferPtr + y * stride;
    const row = pdfium.pdfium.HEAPU8.subarray(rowStart, rowStart + rowSize);
    pixels.set(row, y * rowSize);
  }

  return pixels.buffer;
}

async function renderWorkerTile(request: Extract<PdfiumRenderWorkerRequest, { type: 'renderTile' }>) {
  const pdfium = await loadPdfiumInWorker();
  const document = workerDocuments.get(request.documentId);
  if (!document) {
    throw new Error(`PDFium worker document is not open: id=${request.documentId}`);
  }

  const pagePtr = pdfium.FPDF_LoadPage(document.documentPtr, request.pageNumber - 1);
  if (!pagePtr) {
    throw new Error(`PDFium worker failed to load page ${request.pageNumber}.`);
  }

  const bitmapPtr = pdfium.FPDFBitmap_Create(request.bitmapWidth, request.bitmapHeight, 0);
  if (!bitmapPtr) {
    pdfium.FPDF_ClosePage(pagePtr);
    throw new Error(`PDFium worker failed to create bitmap for page ${request.pageNumber}.`);
  }

  try {
    pdfium.FPDFBitmap_FillRect(
      bitmapPtr,
      0,
      0,
      request.bitmapWidth,
      request.bitmapHeight,
      0xFFFFFFFF,
    );
    pdfium.FPDF_RenderPageBitmap(
      bitmapPtr,
      pagePtr,
      request.startX,
      request.startY,
      request.sizeX,
      request.sizeY,
      request.rotate,
      request.flags,
    );
    const bufferPtr = pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
    const stride = pdfium.FPDFBitmap_GetStride(bitmapPtr);
    const pixels = copyPdfBitmapToArrayBuffer(
      pdfium,
      bufferPtr,
      stride,
      request.bitmapWidth,
      request.bitmapHeight,
    );
    postWorkerTransferResponse({
      id: request.id,
      type: 'tileRendered',
      documentId: request.documentId,
      pageNumber: request.pageNumber,
      bitmapWidth: request.bitmapWidth,
      bitmapHeight: request.bitmapHeight,
      pixels,
    }, [pixels]);
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmapPtr);
    pdfium.FPDF_ClosePage(pagePtr);
  }
}

async function renderWorkerPage(request: Extract<PdfiumRenderWorkerRequest, { type: 'renderPage' }>) {
  const pdfium = await loadPdfiumInWorker();
  const document = workerDocuments.get(request.documentId);
  if (!document) {
    throw new Error(`PDFium worker document is not open: id=${request.documentId}`);
  }

  const pagePtr = pdfium.FPDF_LoadPage(document.documentPtr, request.pageNumber - 1);
  if (!pagePtr) {
    throw new Error(`PDFium worker failed to load page ${request.pageNumber}.`);
  }

  const bitmapPtr = pdfium.FPDFBitmap_Create(request.bitmapWidth, request.bitmapHeight, 0);
  if (!bitmapPtr) {
    pdfium.FPDF_ClosePage(pagePtr);
    throw new Error(`PDFium worker failed to create bitmap for page ${request.pageNumber}.`);
  }

  try {
    pdfium.FPDFBitmap_FillRect(
      bitmapPtr,
      0,
      0,
      request.bitmapWidth,
      request.bitmapHeight,
      0xFFFFFFFF,
    );
    pdfium.FPDF_RenderPageBitmap(
      bitmapPtr,
      pagePtr,
      0,
      0,
      request.bitmapWidth,
      request.bitmapHeight,
      request.rotate,
      request.flags,
    );
    const bufferPtr = pdfium.FPDFBitmap_GetBuffer(bitmapPtr);
    const stride = pdfium.FPDFBitmap_GetStride(bitmapPtr);
    const pixels = copyPdfBitmapToArrayBuffer(
      pdfium,
      bufferPtr,
      stride,
      request.bitmapWidth,
      request.bitmapHeight,
    );
    postWorkerTransferResponse({
      id: request.id,
      type: 'pageRendered',
      documentId: request.documentId,
      pageNumber: request.pageNumber,
      bitmapWidth: request.bitmapWidth,
      bitmapHeight: request.bitmapHeight,
      pixels,
    }, [pixels]);
  } finally {
    pdfium.FPDFBitmap_Destroy(bitmapPtr);
    pdfium.FPDF_ClosePage(pagePtr);
  }
}

workerScope.addEventListener('message', (event) => {
  const request = event.data;
  if (request.type === 'ping') {
    postWorkerResponse({
      id: request.id,
      type: 'pong',
    });
    return;
  }

  const operation = request.type === 'openDocument'
    ? openWorkerDocument(request)
    : request.type === 'closeDocument'
      ? closeWorkerDocumentByRequest(request)
      : request.type === 'renderTile'
        ? renderWorkerTile(request)
        : request.type === 'renderPage'
          ? renderWorkerPage(request)
          : loadPdfiumInWorker().then(() => {
              postWorkerResponse({
                id: request.id,
                type: 'ready',
              });
            });

  void operation
    .catch((error: unknown) => {
      postWorkerResponse({
        id: request.id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      });
    });
});
