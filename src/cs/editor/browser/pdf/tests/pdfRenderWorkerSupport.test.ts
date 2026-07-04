import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PdfiumRenderWorkerClient,
  getPdfRenderWorkerSupportStatus,
} from 'cs/editor/browser/pdf/pdfRenderWorkerSupport';
import type {
  PdfiumRenderWorkerRequest,
  PdfiumRenderWorkerResponse,
} from 'cs/editor/browser/pdf/pdfRenderWorkerSupport';

const FakeWorker = class {} as unknown as typeof Worker;

class FakePdfiumRenderWorker {
  readonly postedMessages: Array<{
    message: PdfiumRenderWorkerRequest;
    transfer: Transferable[];
  }> = [];
  didTerminate = false;
  private messageListener: ((event: MessageEvent<PdfiumRenderWorkerResponse>) => void) | null = null;
  private errorListener: ((event: ErrorEvent) => void) | null = null;

  constructor(private readonly autoRespond = true) {}

  addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
    if (type === 'message') {
      this.messageListener = listener as (event: MessageEvent<PdfiumRenderWorkerResponse>) => void;
    }
    if (type === 'error') {
      this.errorListener = listener as (event: ErrorEvent) => void;
    }
  }

  removeEventListener(type: string) {
    if (type === 'message') {
      this.messageListener = null;
    }
    if (type === 'error') {
      this.errorListener = null;
    }
  }

  postMessage(message: PdfiumRenderWorkerRequest, transfer: Transferable[] = []) {
    this.postedMessages.push({ message, transfer });
    if (this.autoRespond) {
      this.respondToMessage(message);
    }
  }

  terminate() {
    this.didTerminate = true;
  }

  fail(message: string) {
    this.errorListener?.({
      message,
    } as ErrorEvent);
  }

  private respond(response: PdfiumRenderWorkerResponse) {
    this.messageListener?.({
      data: response,
    } as MessageEvent<PdfiumRenderWorkerResponse>);
  }

  private respondToMessage(message: PdfiumRenderWorkerRequest) {
    if (message.type === 'ping') {
      this.respond({
        id: message.id,
        type: 'pong',
      });
      return;
    }

    if (message.type === 'init') {
      this.respond({
        id: message.id,
        type: 'ready',
      });
      return;
    }

    if (message.type === 'openDocument') {
      this.respond({
        id: message.id,
        type: 'documentReady',
        documentId: message.documentId,
        pageCount: 3,
      });
      return;
    }

    if (message.type === 'closeDocument') {
      this.respond({
        id: message.id,
        type: 'documentClosed',
        documentId: message.documentId,
      });
      return;
    }

    if (message.type === 'renderPage') {
      this.respond({
        id: message.id,
        type: 'pageRendered',
        documentId: message.documentId,
        pageNumber: message.pageNumber,
        bitmapWidth: message.bitmapWidth,
        bitmapHeight: message.bitmapHeight,
        pixels: new ArrayBuffer(message.bitmapWidth * message.bitmapHeight * 4),
      });
      return;
    }

    if (message.type !== 'renderTile') {
      return;
    }

    this.respond({
      id: message.id,
      type: 'tileRendered',
      documentId: message.documentId,
      pageNumber: message.pageNumber,
      bitmapWidth: message.bitmapWidth,
      bitmapHeight: message.bitmapHeight,
      pixels: new ArrayBuffer(message.bitmapWidth * message.bitmapHeight * 4),
    });
  }
}

test('getPdfRenderWorkerSupportStatus rejects missing Worker support', () => {
  const status = getPdfRenderWorkerSupportStatus({
    WebAssembly,
    MessageChannel,
  });

  assert.equal(status.supported, false);
  assert.equal(status.moduleWorkerAvailable, false);
  assert.equal(status.reason, 'Worker is unavailable.');
});

test('getPdfRenderWorkerSupportStatus rejects missing transferable ArrayBuffer support', () => {
  const status = getPdfRenderWorkerSupportStatus({
    Worker: FakeWorker,
    WebAssembly,
  });

  assert.equal(status.supported, false);
  assert.equal(status.moduleWorkerAvailable, true);
  assert.equal(status.transferableArrayBuffer, false);
  assert.equal(status.reason, 'Transferable ArrayBuffer is unavailable.');
});

test('getPdfRenderWorkerSupportStatus accepts module worker prerequisites', () => {
  const status = getPdfRenderWorkerSupportStatus({
    Worker: FakeWorker,
    WebAssembly,
    MessageChannel,
  });

  assert.equal(status.supported, true);
  assert.equal(status.moduleWorkerAvailable, true);
  assert.equal(status.transferableArrayBuffer, true);
  assert.equal(status.webAssemblyAvailable, true);
});

test('PdfiumRenderWorkerClient opens documents and renders transferable tiles', async () => {
  const worker = new FakePdfiumRenderWorker();
  const client = new PdfiumRenderWorkerClient(worker as unknown as Worker);

  try {
    await client.init();
    await client.ping();
    const pageCount = await client.openDocument(7, new Uint8Array([1, 2, 3]));
    const tile = await client.renderTile(7, {
      pageNumber: 2,
      bitmapWidth: 4,
      bitmapHeight: 5,
      startX: -10,
      startY: -20,
      sizeX: 400,
      sizeY: 500,
      rotate: 0,
      flags: 18,
    });
    const page = await client.renderPage(7, {
      pageNumber: 1,
      bitmapWidth: 8,
      bitmapHeight: 9,
      rotate: 0,
      flags: 18,
    });
    await client.closeDocument(7);

    assert.equal(pageCount, 3);
    assert.equal(tile.documentId, 7);
    assert.equal(tile.pageNumber, 2);
    assert.equal(tile.pixels.byteLength, 80);
    assert.equal(page.documentId, 7);
    assert.equal(page.pageNumber, 1);
    assert.equal(page.pixels.byteLength, 288);
    assert.deepEqual(
      worker.postedMessages.map(({ message }) => message.type),
      ['init', 'ping', 'openDocument', 'renderTile', 'renderPage', 'closeDocument'],
    );
    assert.equal(worker.postedMessages[2].transfer.length, 1);
  } finally {
    client.dispose();
  }

  assert.equal(worker.didTerminate, true);
});

test('PdfiumRenderWorkerClient rejects pending requests on worker error', async () => {
  const worker = new FakePdfiumRenderWorker(false);
  const client = new PdfiumRenderWorkerClient(worker as unknown as Worker);

  try {
    const request = client.openDocument(7, new Uint8Array([1, 2, 3]));
    worker.fail('worker exploded');

    await assert.rejects(request, /worker exploded/);
  } finally {
    client.dispose();
  }
});
