import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type {
  PdfDownloadResult,
  WebContentPdfDownloadPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { DocumentActionsControllerContext } from 'cs/workbench/browser/documentActionsModel';
import type { Article } from 'cs/workbench/services/article/articleFetch';

let cleanupDomEnvironment: (() => void) | null = null;
let createDocumentActionsController: typeof import('cs/workbench/browser/documentActionsModel').createDocumentActionsController;
let locales: typeof import('language/locales').locales;

test.before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createDocumentActionsController } = await import('cs/workbench/browser/documentActionsModel'));
  ({ locales } = await import('language/locales'));
});

test.after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createInvokeDesktop(): ElectronInvoke {
  return (async (command: string) => {
    throw new Error(`Unexpected desktop command in document actions model test: ${command}`);
  }) as ElectronInvoke;
}

function createSuccessfulDownloadInvoke(
  payloads: WebContentPdfDownloadPayload[],
): ElectronInvoke {
  return (async (command: string, payload?: Record<string, unknown>) => {
    assert.equal(command, 'web_content_download_pdf');
    payloads.push(payload as WebContentPdfDownloadPayload);
    return {
      filePath: 'C:\\Downloads\\article.pdf',
      sourceUrl: String((payload as WebContentPdfDownloadPayload | undefined)?.downloadUrl ?? ''),
      libraryRegistration: null,
    } satisfies PdfDownloadResult;
  }) as ElectronInvoke;
}

function createNoopToastApi(): NonNullable<INativeHostService['toast']> {
  return {
    show: () => {},
    dismiss: () => {},
    getState: async () => ({ items: [] }),
    onStateChange: () => () => {},
    reportLayout: () => {},
    setHovering: () => {},
  };
}

function createNativeHostService(
  overrides: Partial<INativeHostService> = {},
): INativeHostService {
  return {
    _serviceBrand: undefined,
    canInvoke: () => true,
    invoke: createInvokeDesktop(),
    ipc: undefined,
    windowControls: undefined,
    webContent: undefined,
    fetch: undefined,
    document: undefined,
    toast: undefined,
    ...overrides,
  };
}

function createDocumentActionsContext(
  overrides: Partial<DocumentActionsControllerContext> = {},
): DocumentActionsControllerContext {
  const invokeDesktop = overrides.invokeDesktop ?? createInvokeDesktop();
  return {
    desktopRuntime: true,
    invokeDesktop,
    nativeHost: createNativeHostService({
      invoke: invokeDesktop,
      toast: createNoopToastApi(),
    }),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [],
    createBrowserTab: () => {},
    onExportArticleSummaries: () => {},
    activeDraftExport: null,
    ...overrides,
  };
}

function createArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: 'Example article',
    articleType: 'News',
    doi: null,
    authors: [],
    abstractText: null,
    descriptionText: null,
    publishedAt: null,
    sourceUrl: 'https://example.com/article',
    fetchedAt: '2026-07-04T00:00:00.000Z',
    fetchOrder: 1,
    ...overrides,
  };
}

test('DocumentActionsController opens article details in a browser tab', async () => {
  const openedUrls: string[] = [];
  const controller = createDocumentActionsController({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    nativeHost: createNativeHostService(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [],
    createBrowserTab: (url) => {
      openedUrls.push(url);
    },
    onExportArticleSummaries: () => {},
    activeDraftExport: null,
  });

  await controller.handleOpenArticleDetails(createArticle({
    sourceUrl: 'https://www.nature.com/articles/example',
  }));

  controller.dispose();
  assert.deepEqual(openedUrls, ['https://www.nature.com/articles/example']);
});

test('DocumentActionsController delegates article summary export', async () => {
  const article = createArticle({
    sourceUrl: 'https://www.nature.com/articles/export',
  });
  const delegatedExports: Array<{
    articles: readonly Article[];
    translateSummaries: boolean;
  }> = [];
  const controller = createDocumentActionsController({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    nativeHost: createNativeHostService(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [article],
    createBrowserTab: () => {},
    onExportArticleSummaries: (articles, translateSummaries) => {
      delegatedExports.push({ articles, translateSummaries });
    },
    activeDraftExport: null,
  });

  await controller.handleExportDocx();

  controller.dispose();
  assert.deepEqual(delegatedExports, [{
    articles: [article],
    translateSummaries: true,
  }]);
});

test('DocumentActionsController prefixes PDF titles by fetch order outside selection mode', async () => {
  const payloads: WebContentPdfDownloadPayload[] = [];
  const invokeDesktop = createSuccessfulDownloadInvoke(payloads);
  const controller = createDocumentActionsController(createDocumentActionsContext({
    invokeDesktop,
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
  }));

  await controller.handleSharedPdfDownload(createArticle({
    title: 'Second article',
    sourceUrl: 'https://example.com/articles/second',
    fetchOrder: 2,
  }));

  controller.dispose();
  assert.equal(payloads[0]?.articleTitle, '2. Second article');
});

test('DocumentActionsController numbers batch PDF titles by batch order', async () => {
  const payloads: WebContentPdfDownloadPayload[] = [];
  const invokeDesktop = createSuccessfulDownloadInvoke(payloads);
  const controller = createDocumentActionsController(createDocumentActionsContext({
    invokeDesktop,
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
  }));

  await controller.handleDownloadAllArticles([
    createArticle({
      title: 'Checked first',
      sourceUrl: 'https://example.com/articles/checked-first',
      fetchOrder: 7,
    }),
    createArticle({
      title: 'Checked second',
      sourceUrl: 'https://example.com/articles/checked-second',
      fetchOrder: 8,
    }),
  ]);

  controller.dispose();
  assert.deepEqual(
    payloads.map((payload) => payload.articleTitle),
    ['1. Checked first', '2. Checked second'],
  );
});

test('DocumentActionsController cancels an active batch PDF download task', async () => {
  const downloadPayloads: WebContentPdfDownloadPayload[] = [];
  const cancelPayloads: Array<{ taskId?: string }> = [];
  let rejectDownload: ((error: unknown) => void) | null = null;
  const invokeDesktop = (async (command: string, payload?: Record<string, unknown>) => {
    if (command === 'web_content_download_pdf') {
      downloadPayloads.push(payload as WebContentPdfDownloadPayload);
      return await new Promise<PdfDownloadResult>((_resolve, reject) => {
        rejectDownload = reject;
      });
    }

    if (command === 'cancel_document_task') {
      cancelPayloads.push(payload as { taskId?: string });
      rejectDownload?.(new Error('Canceled'));
      return true;
    }

    throw new Error(`Unexpected desktop command in cancellation test: ${command}`);
  }) as ElectronInvoke;
  const controller = createDocumentActionsController(createDocumentActionsContext({
    invokeDesktop,
  }));

  const running = controller.handleDownloadAllArticles([
    createArticle({
      title: 'Cancelable article',
      sourceUrl: 'https://example.com/articles/cancelable',
    }),
  ]);
  await delay(0);

  await controller.handleDownloadAllArticles([
    createArticle({
      title: 'Cancelable article',
      sourceUrl: 'https://example.com/articles/cancelable',
    }),
  ]);
  await running;

  controller.dispose();
  assert.equal(typeof downloadPayloads[0]?.taskId, 'string');
  assert.deepEqual(cancelPayloads, [{ taskId: downloadPayloads[0]?.taskId }]);
  assert.equal(controller.getSnapshot().downloadAllProgress, null);
});

test('DocumentActionsController uses selected order for PDF titles when enabled in selection mode', async () => {
  const payloads: WebContentPdfDownloadPayload[] = [];
  const invokeDesktop = createSuccessfulDownloadInvoke(payloads);
  const article = createArticle({
    title: 'Selected article',
    sourceUrl: 'https://example.com/articles/selected',
    fetchedAt: '2026-07-04T00:00:02.000Z',
    fetchOrder: 7,
  });
  const controller = createDocumentActionsController(createDocumentActionsContext({
    invokeDesktop,
    pdfFileNameUseSelectionOrder: true,
    isSelectionModeEnabled: true,
    selectedArticleOrderLookup: new Map([
      [`${article.sourceUrl}::${article.fetchedAt}`, 1],
    ]),
  }));

  await controller.handleSharedPdfDownload(article);

  controller.dispose();
  assert.equal(payloads[0]?.articleTitle, '1. Selected article');
});
