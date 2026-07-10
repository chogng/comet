/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { URI } from 'cs/base/common/uri';
import {
  getFetchArticleSourceUrl,
  type FetchArticle,
} from 'cs/base/parts/sandbox/common/fetchArticle';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type {
  PdfDownloadResult,
  WebContentPdfDownloadPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import type { DocumentActionsControllerContext } from 'cs/workbench/browser/documentActionsModel';
import type { EditorOpenRequest } from 'cs/workbench/services/editor/common/editorOpenTypes';

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

function createDocumentActionsContext(
  overrides: Partial<DocumentActionsControllerContext> = {},
): DocumentActionsControllerContext {
  const invokeDesktop = overrides.invokeDesktop ?? createInvokeDesktop();
  return {
    desktopRuntime: true,
    invokeDesktop,
    notificationService: new NoOpNotificationService(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [],
    onOpenEditor: () => {},
    onExportArticleSummaries: () => {},
    activeDraftExport: null,
    ...overrides,
  };
}

function createArticle(overrides: Partial<FetchArticle> = {}): FetchArticle {
  return {
    title: 'Example article',
    publication: {
      id: 'example-journal',
      title: 'Example Journal',
      publisherId: 'example-publisher',
      publisherTitle: 'Example Publisher',
    },
    articleKind: 'news',
    sourceArticleType: 'News',
    authors: [{ name: 'Example Author' }],
    abstract: 'An abstract',
    sections: [],
    figures: [],
    references: [],
    sourceUri: URI.parse('https://example.com/article').toJSON(),
    fetchedAt: '2026-07-04T00:00:00.000Z',
    fetchOrder: 1,
    ...overrides,
  };
}

test('DocumentActionsController opens article details in a browser tab', async () => {
  const openRequests: EditorOpenRequest[] = [];
  const controller = createDocumentActionsController({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    notificationService: new NoOpNotificationService(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [],
    onOpenEditor: (request) => {
      openRequests.push(request);
    },
    onExportArticleSummaries: () => {},
    activeDraftExport: null,
  });

  await controller.handleOpenArticleDetails(createArticle({
    sourceUri: URI.parse('https://www.nature.com/articles/example').toJSON(),
  }));

  controller.dispose();
  assert.equal(openRequests.length, 1);
  const [request] = openRequests;
  assert.equal(request?.kind, 'browser');
  assert.equal(request.disposition, 'reveal-or-open');
  assert.equal(request.options?.viewState?.url, 'https://www.nature.com/articles/example');
  assert.ok(request.resource);
  assert.ok(BrowserViewUri.getId(request.resource));
});

test('DocumentActionsController delegates article summary export', async () => {
  const article = createArticle({
    sourceUri: URI.parse('https://www.nature.com/articles/export').toJSON(),
  });
  const delegatedExports: Array<{
    articles: readonly FetchArticle[];
    translateSummaries: boolean;
  }> = [];
  const controller = createDocumentActionsController({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    notificationService: new NoOpNotificationService(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [article],
    onOpenEditor: () => {},
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
    sourceUri: URI.parse('https://example.com/articles/second').toJSON(),
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
      sourceUri: URI.parse('https://example.com/articles/checked-first').toJSON(),
      fetchOrder: 7,
    }),
    createArticle({
      title: 'Checked second',
      sourceUri: URI.parse('https://example.com/articles/checked-second').toJSON(),
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
      sourceUri: URI.parse('https://example.com/articles/cancelable').toJSON(),
    }),
  ]);
  await delay(0);

  await controller.handleDownloadAllArticles([
    createArticle({
      title: 'Cancelable article',
      sourceUri: URI.parse('https://example.com/articles/cancelable').toJSON(),
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
    sourceUri: URI.parse('https://example.com/articles/selected').toJSON(),
    fetchedAt: '2026-07-04T00:00:02.000Z',
    fetchOrder: 7,
  });
  const controller = createDocumentActionsController(createDocumentActionsContext({
    invokeDesktop,
    pdfFileNameUseSelectionOrder: true,
    isSelectionModeEnabled: true,
    selectedArticleOrderLookup: new Map([
      [`${getFetchArticleSourceUrl(article)}::${article.fetchedAt}`, 1],
    ]),
  }));

  await controller.handleSharedPdfDownload(article);

  controller.dispose();
  assert.equal(payloads[0]?.articleTitle, '1. Selected article');
});
