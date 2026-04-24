export type PdfReaderBackendKind = 'chromium-webview' | 'pdfium-wasm';

export type PdfReaderDocumentSource =
  | {
      kind: 'empty';
    }
  | {
      kind: 'url';
      url: string;
      title?: string;
    };

export type PdfReaderViewState = {
  currentPage: number;
  scale: number;
  scrollTop: number;
};

export type PdfReaderSnapshot = {
  backend: PdfReaderBackendKind;
  source: PdfReaderDocumentSource;
  viewState: PdfReaderViewState;
};

export const DEFAULT_PDF_READER_VIEW_STATE: PdfReaderViewState = {
  currentPage: 1,
  scale: 1,
  scrollTop: 0,
};

export function createPdfReaderDocumentSource(params: {
  url?: string | null;
  emptyUrl?: string;
  title?: string;
}): PdfReaderDocumentSource {
  const normalizedUrl = String(params.url ?? '').trim();
  if (!normalizedUrl || normalizedUrl === params.emptyUrl) {
    return {
      kind: 'empty',
    };
  }

  return {
    kind: 'url',
    url: normalizedUrl,
    title: params.title?.trim() || undefined,
  };
}

export function normalizePdfReaderViewState(
  value: Partial<PdfReaderViewState> | null | undefined,
): PdfReaderViewState {
  return {
    currentPage:
      typeof value?.currentPage === 'number' && value.currentPage > 0
        ? Math.floor(value.currentPage)
        : DEFAULT_PDF_READER_VIEW_STATE.currentPage,
    scale:
      typeof value?.scale === 'number' && value.scale > 0
        ? value.scale
        : DEFAULT_PDF_READER_VIEW_STATE.scale,
    scrollTop:
      typeof value?.scrollTop === 'number' && value.scrollTop > 0
        ? value.scrollTop
        : DEFAULT_PDF_READER_VIEW_STATE.scrollTop,
  };
}

export function createPdfReaderSnapshot(params: {
  backend?: PdfReaderBackendKind;
  source: PdfReaderDocumentSource;
  viewState?: Partial<PdfReaderViewState> | null;
}): PdfReaderSnapshot {
  return {
    backend: params.backend ?? 'chromium-webview',
    source: params.source,
    viewState: normalizePdfReaderViewState(params.viewState),
  };
}
