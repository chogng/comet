/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type {
  DocumentTranslationProgress,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { Article } from 'cs/workbench/services/article/articleFetch';

let cleanupDomEnvironment: (() => void) | null = null;
let createArticleSummaryTranslationExportController: typeof import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport').createArticleSummaryTranslationExportController;
let getStatusbarStateSnapshot: typeof import('cs/workbench/browser/parts/statusbar/statusbarModel').getStatusbarStateSnapshot;
let setStatusbarState: typeof import('cs/workbench/browser/parts/statusbar/statusbarModel').setStatusbarState;
let registerToastBridge: typeof import('cs/base/browser/ui/toast/toast').registerToastBridge;
let locales: typeof import('language/locales').locales;
let BrowserDialogService: typeof import('cs/workbench/services/dialogs/browser/dialogService').BrowserDialogService;

test.before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createArticleSummaryTranslationExportController } = await import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport'));
  ({ getStatusbarStateSnapshot, setStatusbarState } = await import('cs/workbench/browser/parts/statusbar/statusbarModel'));
  ({ registerToastBridge } = await import('cs/base/browser/ui/toast/toast'));
  ({ locales } = await import('language/locales'));
  ({ BrowserDialogService } = await import('cs/workbench/services/dialogs/browser/dialogService'));
});

test.after(() => {
  registerToastBridge(null);
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createArticle(overrides: Partial<Article> = {}): Article {
  return {
    title: 'Example article',
    articleType: 'News',
    doi: null,
    authors: [],
    abstractText: 'An abstract',
    descriptionText: null,
    publishedAt: null,
    sourceUrl: 'https://example.com/article',
    fetchedAt: '2026-07-04T00:00:00.000Z',
    fetchOrder: 1,
    ...overrides,
  };
}

function createNativeHostService(
  documentApi: NonNullable<INativeHostService['document']>,
  invoke: ElectronInvoke,
): INativeHostService {
  return {
    _serviceBrand: undefined,
    canInvoke: () => true,
    invoke,
    ipc: undefined,
    windowControls: undefined,
    webContent: undefined,
    fetch: undefined,
    document: documentApi,
    toast: undefined,
  };
}

function createDesktopInvokeError(
  code: string,
  details: Record<string, unknown>,
) {
  const error = new Error(code) as Error & {
    code?: string;
    details?: Record<string, unknown>;
  };
  error.code = code;
  error.details = details;
  return error;
}

async function waitForModalButton(label: string) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const buttons = Array.from(
      document.querySelectorAll<HTMLButtonElement>('.comet-dialog-buttons button'),
    );
    const button = buttons.find(item => item.textContent === label);
    if (button) {
      return button;
    }

    await delay(0);
  }

  assert.fail(`Expected modal button "${label}" to be rendered.`);
}

function createDialogService() {
  return new BrowserDialogService();
}

test('ArticleSummaryTranslationExportController exports summaries and restores translation progress', async () => {
  const previousStatus: EditorStatusState = {
    ariaLabel: 'Status',
    paneMode: 'browser',
    summary: 'Ready',
    leftItems: [{ id: 'existing', label: 'Mode', value: 'PDF' }],
    rightItems: [],
  };
  setStatusbarState(previousStatus);

  const shownToasts: Array<{ message: string; type?: string }> = [];
  registerToastBridge({
    canHandle: () => true,
    show: (options) => {
      shownToasts.push(options);
      return shownToasts.length;
    },
  });

  let progressListener: ((progress: DocumentTranslationProgress) => void) | null = null;
  let unsubscribed = false;
  const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    progressListener?.({
      phase: 'batch',
      current: 1,
      total: 2,
      provider: 'translation:deepl',
      model: 'translate-to-zh-hans',
      message: null,
    });
    assert.equal(getStatusbarStateSnapshot().summary, 'Translating 1/2');
    return {
      articleCount: 1,
      filePath: '/tmp/articles.docx',
    };
  }) as ElectronInvoke;
  const controller = createArticleSummaryTranslationExportController({
    desktopRuntime: true,
    invokeDesktop: invoke,
    nativeHost: createNativeHostService({
      onTranslationProgress: (listener) => {
        progressListener = listener;
        return () => {
          unsubscribed = true;
          progressListener = null;
        };
      },
    }, invoke),
    dialogService: createDialogService(),
    locale: 'en',
    ui: locales.en,
    pdfDownloadDir: '/tmp',
  });

  await controller.handleExportArticleSummaries([createArticle()], true);

  assert.equal(unsubscribed, true);
  assert.deepEqual(getStatusbarStateSnapshot(), previousStatus);
  assert.equal(invoked.length, 1);
  assert.equal(invoked[0].command, 'export_articles_docx');
  assert.equal(typeof invoked[0].args?.taskId, 'string');
  assert.deepEqual(invoked[0].args, {
    taskId: invoked[0].args?.taskId,
    articles: [createArticle()],
    preferredDirectory: '/tmp',
    targetFilePath: null,
    translateSummaries: true,
    locale: 'en',
  });
  assert.equal(shownToasts.at(-1)?.type, 'success');
});

test('ArticleSummaryTranslationExportController exports original summaries directly', async () => {
  const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    return {
      articleCount: 1,
      filePath: '/tmp/articles.docx',
    };
  }) as ElectronInvoke;
  const controller = createArticleSummaryTranslationExportController({
    desktopRuntime: true,
    invokeDesktop: invoke,
    nativeHost: createNativeHostService({
      onTranslationProgress: () => () => {},
    }, invoke),
    dialogService: createDialogService(),
    locale: 'en',
    ui: locales.en,
    pdfDownloadDir: '/tmp',
  });

  await controller.handleExportArticleSummaries([createArticle()], false);

  assert.equal(invoked.length, 1);
  assert.deepEqual(invoked[0].args, {
    taskId: invoked[0].args?.taskId,
    articles: [createArticle()],
    preferredDirectory: '/tmp',
    targetFilePath: null,
    translateSummaries: false,
    locale: 'en',
  });
});

test('ArticleSummaryTranslationExportController exports original summaries after translation failure confirmation', async () => {
  const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  let exportCallCount = 0;
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    if (command === 'export_articles_docx') {
      exportCallCount += 1;
      if (exportCallCount === 1) {
        throw createDesktopInvokeError('DOCX_TRANSLATION_FAILED', {
          filePath: '/tmp/articles.docx',
          message: 'Bad Gateway',
          translationCode: 'LLM_CONNECTION_FAILED',
          translationDetails: {
            provider: 'translation:glm',
            status: 502,
            statusText: 'Bad Gateway',
          },
        });
      }

      return {
        articleCount: 1,
        filePath: '/tmp/articles.docx',
      };
    }

    throw new Error(`Unexpected desktop command in translation failure confirmation test: ${command}`);
  }) as ElectronInvoke;
  const controller = createArticleSummaryTranslationExportController({
    desktopRuntime: true,
    invokeDesktop: invoke,
    nativeHost: createNativeHostService({
      onTranslationProgress: () => () => {},
    }, invoke),
    dialogService: createDialogService(),
    locale: 'en',
    ui: locales.en,
    pdfDownloadDir: '/tmp',
  });

  const running = controller.handleExportArticleSummaries([createArticle()], true);
  (await waitForModalButton(locales.en.translationFailureDialogExportOriginal)).click();
  await running;

  const exportCalls = invoked.filter(entry => entry.command === 'export_articles_docx');
  assert.equal(exportCalls.length, 2);
  assert.equal(exportCalls[0].args?.taskId, exportCalls[1].args?.taskId);
  assert.deepEqual(exportCalls[0].args, {
    taskId: exportCalls[0].args?.taskId,
    articles: [createArticle()],
    preferredDirectory: '/tmp',
    targetFilePath: null,
    translateSummaries: true,
    locale: 'en',
  });
  assert.deepEqual(exportCalls[1].args, {
    taskId: exportCalls[0].args?.taskId,
    articles: [createArticle()],
    preferredDirectory: '/tmp',
    targetFilePath: '/tmp/articles.docx',
    translateSummaries: false,
    locale: 'en',
  });
  assert.equal(document.querySelectorAll('.comet-dialog-box').length, 0);
});

test('ArticleSummaryTranslationExportController retries translation after translation failure confirmation', async () => {
  const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  let exportCallCount = 0;
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    if (command === 'export_articles_docx') {
      exportCallCount += 1;
      if (exportCallCount === 1) {
        throw createDesktopInvokeError('DOCX_TRANSLATION_FAILED', {
          filePath: '/tmp/articles.docx',
          message: 'Gateway Timeout',
          translationCode: 'LLM_CONNECTION_FAILED',
          translationDetails: {
            provider: 'translation:glm',
            status: 504,
            statusText: 'Gateway Timeout',
          },
        });
      }

      return {
        articleCount: 1,
        filePath: '/tmp/articles.docx',
      };
    }

    throw new Error(`Unexpected desktop command in translation retry confirmation test: ${command}`);
  }) as ElectronInvoke;
  const controller = createArticleSummaryTranslationExportController({
    desktopRuntime: true,
    invokeDesktop: invoke,
    nativeHost: createNativeHostService({
      onTranslationProgress: () => () => {},
    }, invoke),
    dialogService: createDialogService(),
    locale: 'en',
    ui: locales.en,
    pdfDownloadDir: '/tmp',
  });

  const running = controller.handleExportArticleSummaries([createArticle()], true);
  (await waitForModalButton(locales.en.translationFailureDialogRetry)).click();
  await running;

  const exportCalls = invoked.filter(entry => entry.command === 'export_articles_docx');
  assert.equal(exportCalls.length, 2);
  assert.equal(exportCalls[0].args?.taskId, exportCalls[1].args?.taskId);
  assert.deepEqual(exportCalls[1].args, {
    taskId: exportCalls[0].args?.taskId,
    articles: [createArticle()],
    preferredDirectory: '/tmp',
    targetFilePath: '/tmp/articles.docx',
    translateSummaries: true,
    locale: 'en',
  });
  assert.equal(document.querySelectorAll('.comet-dialog-box').length, 0);
});

test('ArticleSummaryTranslationExportController cancels while translation failure confirmation is open', async () => {
  const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    if (command === 'export_articles_docx') {
      throw createDesktopInvokeError('DOCX_TRANSLATION_FAILED', {
        filePath: '/tmp/articles.docx',
        message: 'Gateway Timeout',
        translationCode: 'LLM_CONNECTION_FAILED',
        translationDetails: {
          provider: 'translation:glm',
          status: 504,
          statusText: 'Gateway Timeout',
        },
      });
    }

    if (command === 'cancel_document_task') {
      return true;
    }

    throw new Error(`Unexpected desktop command in translation confirmation cancellation test: ${command}`);
  }) as ElectronInvoke;
  const controller = createArticleSummaryTranslationExportController({
    desktopRuntime: true,
    invokeDesktop: invoke,
    nativeHost: createNativeHostService({
      onTranslationProgress: () => () => {},
    }, invoke),
    dialogService: createDialogService(),
    locale: 'en',
    ui: locales.en,
    pdfDownloadDir: '/tmp',
  });

  const running = controller.handleExportArticleSummaries([createArticle()], true);
  await waitForModalButton(locales.en.translationFailureDialogRetry);
  await controller.handleExportArticleSummaries([createArticle()], true);
  await running;

  const exportArgs = invoked.find(entry => entry.command === 'export_articles_docx')?.args;
  const cancelArgs = invoked.find(entry => entry.command === 'cancel_document_task')?.args;
  assert.deepEqual(cancelArgs, { taskId: exportArgs?.taskId });
  assert.equal(document.querySelectorAll('.comet-dialog-box').length, 0);
  assert.equal(controller.getSnapshot().translationExportProgress, null);
});

test('ArticleSummaryTranslationExportController cancels an active export task', async () => {
  const previousStatus: EditorStatusState = {
    ariaLabel: 'Status',
    paneMode: 'browser',
    summary: 'Ready',
    leftItems: [],
    rightItems: [],
  };
  setStatusbarState(previousStatus);

  let rejectExport: ((error: unknown) => void) | null = null;
  const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
  const invoke = (async (command: string, args?: Record<string, unknown>) => {
    invoked.push({ command, args });
    if (command === 'export_articles_docx') {
      return await new Promise((_resolve, reject) => {
        rejectExport = reject;
      });
    }
    if (command === 'cancel_document_task') {
      rejectExport?.(new Error('Canceled'));
      return true;
    }
    throw new Error(`Unexpected desktop command in article summary cancellation test: ${command}`);
  }) as ElectronInvoke;
  const controller = createArticleSummaryTranslationExportController({
    desktopRuntime: true,
    invokeDesktop: invoke,
    nativeHost: createNativeHostService({
      onTranslationProgress: () => () => {},
    }, invoke),
    dialogService: createDialogService(),
    locale: 'en',
    ui: locales.en,
    pdfDownloadDir: '/tmp',
  });

  const running = controller.handleExportArticleSummaries([createArticle()], true);
  await delay(0);
  await controller.handleExportArticleSummaries([createArticle()], true);
  await running;

  controller.dispose();
  const exportArgs = invoked.find((entry) => entry.command === 'export_articles_docx')?.args;
  const cancelArgs = invoked.find((entry) => entry.command === 'cancel_document_task')?.args;
  assert.equal(typeof exportArgs?.taskId, 'string');
  assert.deepEqual(cancelArgs, { taskId: exportArgs?.taskId });
  assert.equal(controller.getSnapshot().translationExportProgress, null);
  assert.deepEqual(getStatusbarStateSnapshot(), previousStatus);
});
