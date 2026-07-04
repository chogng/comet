/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

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

test.before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createArticleSummaryTranslationExportController } = await import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport'));
  ({ getStatusbarStateSnapshot, setStatusbarState } = await import('cs/workbench/browser/parts/statusbar/statusbarModel'));
  ({ registerToastBridge } = await import('cs/base/browser/ui/toast/toast'));
  ({ locales } = await import('language/locales'));
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
    locale: 'en',
    ui: locales.en,
    pdfDownloadDir: '/tmp',
  });

  await controller.handleExportArticleSummaries([createArticle()]);

  assert.equal(unsubscribed, true);
  assert.deepEqual(getStatusbarStateSnapshot(), previousStatus);
  assert.deepEqual(invoked, [{
    command: 'export_articles_docx',
    args: {
      articles: [createArticle()],
      preferredDirectory: '/tmp',
      locale: 'en',
    },
  }]);
  assert.equal(shownToasts.at(-1)?.type, 'success');
});
