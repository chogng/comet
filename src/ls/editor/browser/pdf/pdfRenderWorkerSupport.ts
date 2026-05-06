export type PdfRenderWorkerSupportStatus = {
  supported: boolean;
  reason?: string;
  moduleWorkerAvailable: boolean;
  transferableArrayBuffer: boolean;
  webAssemblyAvailable: boolean;
};

export type PdfiumRenderWorkerRequest =
  | {
      id: number;
      type: 'init' | 'ping';
    }
  | {
      id: number;
      type: 'openDocument';
      documentId: number;
      pdfData: ArrayBuffer;
    }
  | {
      id: number;
      type: 'closeDocument';
      documentId: number;
    }
  | {
      id: number;
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
    }
  | {
      id: number;
      type: 'renderPage';
      documentId: number;
      pageNumber: number;
      bitmapWidth: number;
      bitmapHeight: number;
      rotate: number;
      flags: number;
    };

export type PdfiumRenderWorkerResponse =
  | {
      id: number;
      type: 'ready' | 'pong' | 'documentClosed';
      documentId?: number;
    }
  | {
      id: number;
      type: 'documentReady';
      documentId: number;
      pageCount: number;
    }
  | {
      id: number;
      type: 'tileRendered';
      documentId: number;
      pageNumber: number;
      bitmapWidth: number;
      bitmapHeight: number;
      pixels: ArrayBuffer;
    }
  | {
      id: number;
      type: 'pageRendered';
      documentId: number;
      pageNumber: number;
      bitmapWidth: number;
      bitmapHeight: number;
      pixels: ArrayBuffer;
    }
  | {
      id: number;
      type: 'error';
      message?: string;
    };

type PdfiumRenderWorkerRequestPayload<T = PdfiumRenderWorkerRequest> =
  T extends { id: number } ? Omit<T, 'id'> : never;

export type PdfWorkerTileRenderRequest = Omit<
  Extract<PdfiumRenderWorkerRequest, { type: 'renderTile' }>,
  'id' | 'type' | 'documentId'
>;

export type PdfWorkerPageRenderRequest = Omit<
  Extract<PdfiumRenderWorkerRequest, { type: 'renderPage' }>,
  'id' | 'type' | 'documentId'
>;

type PdfRenderWorkerGlobal = {
  Worker?: typeof Worker;
  WebAssembly?: typeof WebAssembly;
  MessageChannel?: typeof MessageChannel;
  URL?: typeof URL;
};

function canTransferArrayBuffer(globalScope: PdfRenderWorkerGlobal) {
  if (typeof globalScope.MessageChannel !== 'function') {
    return false;
  }

  const channel = new globalScope.MessageChannel();
  const buffer = new ArrayBuffer(1);
  try {
    channel.port1.postMessage(buffer, [buffer]);
    return buffer.byteLength === 0;
  } catch {
    return false;
  } finally {
    channel.port1.close();
    channel.port2.close();
  }
}

export function getPdfRenderWorkerSupportStatus(
  globalScope: PdfRenderWorkerGlobal = globalThis,
): PdfRenderWorkerSupportStatus {
  const moduleWorkerAvailable = typeof globalScope.Worker === 'function';
  const webAssemblyAvailable = typeof globalScope.WebAssembly === 'object';
  const transferableArrayBuffer = canTransferArrayBuffer(globalScope);

  if (!moduleWorkerAvailable) {
    return {
      supported: false,
      reason: 'Worker is unavailable.',
      moduleWorkerAvailable,
      transferableArrayBuffer,
      webAssemblyAvailable,
    };
  }

  if (!webAssemblyAvailable) {
    return {
      supported: false,
      reason: 'WebAssembly is unavailable.',
      moduleWorkerAvailable,
      transferableArrayBuffer,
      webAssemblyAvailable,
    };
  }

  if (!transferableArrayBuffer) {
    return {
      supported: false,
      reason: 'Transferable ArrayBuffer is unavailable.',
      moduleWorkerAvailable,
      transferableArrayBuffer,
      webAssemblyAvailable,
    };
  }

  return {
    supported: true,
    moduleWorkerAvailable,
    transferableArrayBuffer,
    webAssemblyAvailable,
  };
}

export function createPdfiumRenderWorker() {
  return new Worker(
    new URL('./pdfiumRenderWorker.ts', import.meta.url),
    {
      name: 'pdfium-render-worker',
      type: 'module',
    },
  );
}

export class PdfiumRenderWorkerClient {
  private nextRequestId = 1;
  private readonly pendingRequests = new Map<
    number,
    {
      resolve: (response: PdfiumRenderWorkerResponse) => void;
      reject: (error: Error) => void;
    }
  >();

  constructor(private readonly worker: Worker = createPdfiumRenderWorker()) {
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
  }

  dispose() {
    this.worker.removeEventListener('message', this.handleMessage);
    this.worker.removeEventListener('error', this.handleError);
    this.rejectPendingRequests(new Error('PDFium render worker disposed.'));
    this.worker.terminate();
  }

  async init() {
    const response = await this.request({
      type: 'init',
    });
    this.assertResponseType(response, 'ready');
  }

  async ping() {
    const response = await this.request({
      type: 'ping',
    });
    this.assertResponseType(response, 'pong');
  }

  async openDocument(documentId: number, pdfData: Uint8Array) {
    const pdfDataCopy = pdfData.slice();
    const response = await this.request({
      type: 'openDocument',
      documentId,
      pdfData: pdfDataCopy.buffer,
    }, [pdfDataCopy.buffer]);
    this.assertResponseType(response, 'documentReady');
    return response.pageCount;
  }

  async closeDocument(documentId: number) {
    const response = await this.request({
      type: 'closeDocument',
      documentId,
    });
    this.assertResponseType(response, 'documentClosed');
  }

  async renderTile(documentId: number, tile: PdfWorkerTileRenderRequest) {
    const response = await this.request({
      ...tile,
      type: 'renderTile',
      documentId,
    });
    this.assertResponseType(response, 'tileRendered');
    return response;
  }

  async renderPage(documentId: number, page: PdfWorkerPageRenderRequest) {
    const response = await this.request({
      ...page,
      type: 'renderPage',
      documentId,
    });
    this.assertResponseType(response, 'pageRendered');
    return response;
  }

  private assertResponseType<T extends PdfiumRenderWorkerResponse['type']>(
    response: PdfiumRenderWorkerResponse,
    type: T,
  ): asserts response is Extract<PdfiumRenderWorkerResponse, { type: T }> {
    if (response.type !== type) {
      throw new Error(`Unexpected PDFium worker response: ${response.type}`);
    }
  }

  private request(
    request: PdfiumRenderWorkerRequestPayload,
    transfer: Transferable[] = [],
  ) {
    const id = this.nextRequestId;
    this.nextRequestId += 1;
    const message = {
      ...request,
      id,
    } as PdfiumRenderWorkerRequest;
    return new Promise<PdfiumRenderWorkerResponse>((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.worker.postMessage(message, transfer);
    });
  }

  private readonly handleMessage = (event: MessageEvent<PdfiumRenderWorkerResponse>) => {
    const response = event.data;
    const pending = this.pendingRequests.get(response.id);
    if (!pending) {
      return;
    }

    this.pendingRequests.delete(response.id);
    if (response.type === 'error') {
      pending.reject(new Error(response.message ?? 'PDFium render worker failed.'));
      return;
    }

    pending.resolve(response);
  };

  private readonly handleError = (event: ErrorEvent) => {
    this.rejectPendingRequests(new Error(event.message || 'PDFium render worker error.'));
  };

  private rejectPendingRequests(error: Error) {
    for (const pending of this.pendingRequests.values()) {
      pending.reject(error);
    }
    this.pendingRequests.clear();
  }
}
