import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { INativeHostService } from 'cs/platform/native/common/native';
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
    activeDraftExport: null,
  });

  await controller.handleOpenArticleDetails(createArticle({
    sourceUrl: 'https://www.nature.com/articles/example',
  }));

  controller.dispose();
  assert.deepEqual(openedUrls, ['https://www.nature.com/articles/example']);
});
