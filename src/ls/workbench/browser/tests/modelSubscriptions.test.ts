import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
  ElectronAPI,
  ElectronInvoke,
  FetchStatus,
  LibraryDocumentSummary,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import { createLibraryModel } from 'ls/workbench/browser/libraryModel';
import { WebContentNavigationModel } from 'ls/workbench/browser/webContentNavigationModel';
import { EMPTY_WEB_CONTENT_STATE } from 'ls/workbench/services/webContent/webContentNavigationService';
import { localeService } from 'ls/workbench/contrib/localization/browser/localeService';
import {
  getWorkbenchContentStateSnapshot,
  setBatchEndDate,
  setBatchStartDate,
  setFilterJournal,
  subscribeWorkbenchContentState,
} from 'ls/workbench/browser/workbenchContentState';
import {
  getWorkbenchSessionSnapshot,
  setWorkbenchArticles,
  setWorkbenchFetchSeedUrl,
  setWorkbenchSelectedArticleKeysInOrder,
  setWorkbenchSelectionModePhase,
  setWorkbenchWebUrl,
  subscribeWorkbenchSession,
} from 'ls/workbench/browser/session';
import {
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchPartDomSnapshot,
  registerWorkbenchPartDomNode,
  setAgentSidebarVisible,
  setPrimarySidebarVisible,
  setWorkbenchSidebarSizes,
  subscribeWorkbenchLayoutState,
  subscribeWorkbenchPartDom,
  WORKBENCH_CONTENT_LAYOUT_BREAKPOINT,
  WORKBENCH_PART_IDS,
} from 'ls/workbench/browser/layout';
import { Orientation } from 'ls/base/browser/ui/splitview/splitview';
import { getLayoutLimits } from 'ls/workbench/browser/layoutLimits';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
  subscribeStatusbarState,
} from 'ls/workbench/browser/parts/statusbar/statusbarModel';
import { createBatchFetchController } from 'ls/workbench/browser/batchFetchModel';
import { createDocumentActionsController } from 'ls/workbench/browser/documentActionsModel';
import type { WebContentState } from 'ls/workbench/services/webContent/webContentNavigationService';
import {
  getPdfDownloadStatus,
  markPdfDownloadFailed,
  markPdfDownloadStarted,
  subscribePdfDownloadStatus,
} from 'ls/workbench/services/document/pdfDownloadStatus';
import { SettingsModel } from 'ls/workbench/services/settings/settingsModel';
import { locales } from 'language/locales';

let cleanupDomEnvironment: (() => void) | null = null;
let originalDocumentLanguage = '';
let originalLocale: 'zh' | 'en';
let originalWorkbenchContentState = getWorkbenchContentStateSnapshot();
let originalWorkbenchSession = getWorkbenchSessionSnapshot();
let originalWorkbenchLayoutState = getWorkbenchLayoutStateSnapshot();
let originalWorkbenchPartDomSnapshot = getWorkbenchPartDomSnapshot();
let originalStatusbarState = getStatusbarStateSnapshot();

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    'then' in value &&
    typeof (value as { then?: unknown }).then === 'function'
  );
}

function createElectronApi(overrides: Partial<ElectronAPI>): ElectronAPI {
  return {
    invoke: (async () => {
      throw new Error('Unexpected invoke in model subscriptions test.');
    }) as ElectronAPI['invoke'],
    ...overrides,
  };
}

function withElectronApi<T>(electronAPI: ElectronAPI | undefined, run: () => T): T {
  const testWindow = window as typeof window & {
    electronAPI?: ElectronAPI;
  };
  const previousElectronApi = testWindow.electronAPI;
  testWindow.electronAPI = electronAPI;

  try {
    const result = run();
    if (isPromiseLike(result)) {
      return Promise.resolve(result).finally(() => {
        testWindow.electronAPI = previousElectronApi;
      }) as T;
    }

    testWindow.electronAPI = previousElectronApi;
    return result;
  } catch (error) {
    testWindow.electronAPI = previousElectronApi;
    throw error;
  }
}

function createInvokeDesktop(): ElectronInvoke {
  return (async (command: string) => {
    throw new Error(`Unexpected desktop command in model subscriptions test: ${command}`);
  }) as ElectronInvoke;
}

function createFetchStatus(overrides: Partial<FetchStatus> = {}): FetchStatus {
  return {
    sourceId: 'source-1',
    pageUrl: 'https://example.com',
    pageNumber: 1,
    fetchChannel: 'network',
    extractorId: 'extractor-1',
    ...overrides,
  };
}

function createLibraryDocumentSummary(
  overrides: Partial<LibraryDocumentSummary> = {},
): LibraryDocumentSummary {
  return {
    documentId: 'doc-1',
    title: 'Document One',
    doi: null,
    authors: ['Ada Lovelace'],
    journalTitle: 'Journal',
    publishedAt: '2024-01-01',
    sourceUrl: 'https://example.com/doc-1',
    sourceId: 'source-1',
    ingestStatus: 'ready',
    fileCount: 1,
    latestFilePath: '/tmp/doc-1.pdf',
    latestDownloadedAt: '2024-01-02T00:00:00.000Z',
    latestJobType: 'extract',
    latestJobStatus: 'completed',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-02T00:00:00.000Z',
    ...overrides,
  };
}

function createWebContentState(
  overrides: Partial<WebContentState> = {},
): WebContentState {
  return {
    targetId: 'target-1',
    activeTargetId: 'target-1',
    ownership: 'active',
    layoutPhase: 'visible',
    url: 'https://example.com/active',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
    visible: true,
    ...overrides,
  };
}

function restoreWorkbenchLayoutState() {
  setPrimarySidebarVisible(originalWorkbenchLayoutState.isPrimarySidebarVisible);
  setAgentSidebarVisible(originalWorkbenchLayoutState.isAgentSidebarVisible);
  setWorkbenchSidebarSizes({
    primarySidebarSize: originalWorkbenchLayoutState.primarySidebarSize,
    agentSidebarSize: originalWorkbenchLayoutState.agentSidebarSize,
  });
}

function restoreWorkbenchPartDomSnapshot() {
  const partIds = Array.from(
    new Set(Object.values(WORKBENCH_PART_IDS)),
  ) as Array<(typeof WORKBENCH_PART_IDS)[keyof typeof WORKBENCH_PART_IDS]>;

  for (const partId of partIds) {
    registerWorkbenchPartDomNode(partId, originalWorkbenchPartDomSnapshot[partId]);
  }
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  originalDocumentLanguage = document.documentElement.lang;
  originalLocale = localeService.getLocale();
  originalWorkbenchContentState = getWorkbenchContentStateSnapshot();
  originalWorkbenchSession = getWorkbenchSessionSnapshot();
  originalWorkbenchLayoutState = getWorkbenchLayoutStateSnapshot();
  originalWorkbenchPartDomSnapshot = getWorkbenchPartDomSnapshot();
  originalStatusbarState = getStatusbarStateSnapshot();
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

afterEach(() => {
  localeService.applyLocale(originalLocale);
  document.documentElement.lang = originalDocumentLanguage;
  setBatchStartDate(originalWorkbenchContentState.batchStartDate);
  setBatchEndDate(originalWorkbenchContentState.batchEndDate);
  setFilterJournal(originalWorkbenchContentState.filterJournal);
  setWorkbenchWebUrl(originalWorkbenchSession.webUrl);
  setWorkbenchFetchSeedUrl(originalWorkbenchSession.fetchSeedUrl);
  setWorkbenchArticles(originalWorkbenchSession.articles);
  setWorkbenchSelectionModePhase(originalWorkbenchSession.selectionModePhase);
  setWorkbenchSelectedArticleKeysInOrder(
    originalWorkbenchSession.selectedArticleKeysInOrder,
  );
  restoreWorkbenchLayoutState();
  restoreWorkbenchPartDomSnapshot();
  setStatusbarState(originalStatusbarState);
  document.body.replaceChildren();
});

test('localeService subscriptions can be disposed independently', () => {
  const receivedLocales: Array<'zh' | 'en'> = [];
  const disposeListener = localeService.subscribe(() => {
    receivedLocales.push(localeService.getLocale());
  });

  localeService.applyLocale(originalLocale === 'en' ? 'zh' : 'en');
  disposeListener();
  localeService.applyLocale(originalLocale);

  assert.equal(receivedLocales.length, 1);
});

test('workbenchContentState subscriptions stop after disposal', () => {
  let notificationCount = 0;
  const disposeListener = subscribeWorkbenchContentState(() => {
    notificationCount += 1;
  });

  setFilterJournal('nature');
  disposeListener();
  setFilterJournal('');

  assert.equal(notificationCount, 1);
  assert.equal(getWorkbenchContentStateSnapshot().filterJournal, '');
});

test('workbenchSession subscriptions stop after disposal', () => {
  let notificationCount = 0;
  const disposeListener = subscribeWorkbenchSession(() => {
    notificationCount += 1;
  });

  setWorkbenchWebUrl('https://example.com');
  disposeListener();
  setWorkbenchWebUrl('');

  assert.equal(notificationCount, 1);
  assert.equal(getWorkbenchSessionSnapshot().webUrl, '');
});

test('BatchFetchController unsubscribes from fetch status after dispose', () => {
  let fetchStatusListener: ((status: FetchStatus) => void) | undefined;
  let removed = false;

  withElectronApi(createElectronApi({
    fetch: {
      onFetchStatus(listener) {
        fetchStatusListener = listener;
        return () => {
          removed = true;
          if (fetchStatusListener === listener) {
            fetchStatusListener = undefined;
          }
        };
      },
    } as NonNullable<ElectronAPI['fetch']>,
  }), () => {
    const controller = createBatchFetchController({
      desktopRuntime: true,
      addressBarUrl: '',
      batchSources: [],
      sameDomainOnly: false,
      batchStartDate: '',
      batchEndDate: '',
      invokeDesktop: createInvokeDesktop(),
      ui: locales.en,
      onBeforeFetch: () => {},
      onFetchSuccess: () => {},
    });
    const sourceTexts: string[] = [];
    const disposeListener = controller.subscribe(() => {
      sourceTexts.push(controller.getSnapshot().titlebarFetchSourceText);
    });

    controller.start();
    assert(fetchStatusListener);

    fetchStatusListener(createFetchStatus({
      fetchChannel: 'web-content',
      webContentReuseMode: 'live-extract',
    }));
    disposeListener();
    controller.dispose();

    assert.equal(sourceTexts[0], 'Source: live web content DOM');
    assert.equal(removed, true);
    assert.equal(fetchStatusListener, undefined);
  });
});

test('DocumentActionsController subscriptions stop after disposal', () => {
  const controller = createDocumentActionsController({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [],
    activeDraftExport: null,
  });
  const snapshotValues: boolean[] = [];
  const disposeListener = controller.subscribe(() => {
    snapshotValues.push(controller.getSnapshot().canExportDocx);
  });

  controller.setContext({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [],
    activeDraftExport: {
      title: 'Draft',
      document: {
        type: 'doc',
        content: [],
      },
    },
  });
  disposeListener();
  controller.dispose();
  controller.setContext({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
    isSelectionModeEnabled: false,
    selectedArticleOrderLookup: new Map(),
    exportableArticles: [],
    activeDraftExport: null,
  });

  assert.deepEqual(snapshotValues, [true]);
});

test('LibraryModel subscriptions stop after listener disposal and model dispose', () => {
  const model = createLibraryModel({
    desktopRuntime: false,
    invokeDesktop: createInvokeDesktop(),
  });
  const itemCounts: number[] = [];
  const disposeListener = model.subscribe(() => {
    itemCounts.push(model.getSnapshot().librarySnapshot.items.length);
  });

  model.upsertDocumentSummary(createLibraryDocumentSummary());
  disposeListener();
  model.removeDocumentSummary('doc-1');
  model.dispose();
  model.dispose();
  model.upsertDocumentSummary(
    createLibraryDocumentSummary({
      documentId: 'doc-2',
      sourceUrl: 'https://example.com/doc-2',
    }),
  );

  assert.deepEqual(itemCounts, [1]);
  assert.equal(model.getSnapshot().librarySnapshot.items.length, 1);
});

test('WebContentNavigationModel subscriptions stop after listener disposal', async () => {
  let webContentStateListener: ((state: WebContentState) => void) | undefined;

  await withElectronApi(createElectronApi({
    webContent: {
      activate() {},
      async getState() {
        return createWebContentState({
          url: 'https://example.com/initial',
        });
      },
      onStateChange(listener) {
        webContentStateListener = listener;
        return () => {
          if (webContentStateListener === listener) {
            webContentStateListener = undefined;
          }
        };
      },
    } as NonNullable<ElectronAPI['webContent']>,
  }), async () => {
    const model = new WebContentNavigationModel();
    const browserUrls: string[] = [];
    let webUrl = '';
    let fetchSeedUrl = '';
    const disposeListener = model.subscribe(() => {
      browserUrls.push(model.getSnapshot().browserUrl);
    });

    await model.activateTarget('target-1');
    const disconnect = model.connectWebContentState({
      webContentRuntime: true,
      setWebUrl: (value) => {
        webUrl = value;
      },
      setFetchSeedUrl: (value) => {
        fetchSeedUrl =
          typeof value === 'function' ? value(fetchSeedUrl) : value;
      },
    });

    await flushMicrotasks();
    disposeListener();
    assert(webContentStateListener);

    webContentStateListener(
      createWebContentState({
        url: 'https://example.com/next',
        canGoBack: true,
      }),
    );

    assert.deepEqual(browserUrls, ['', 'https://example.com/initial']);
    assert.equal(model.getSnapshot().browserUrl, 'https://example.com/next');
    assert.equal(webUrl, 'https://example.com/next');
    assert.equal(fetchSeedUrl, 'https://example.com/initial');

    disconnect();
  });
});

test('WebContentNavigationModel does not activate a default web content target for null tabs', async () => {
  const activatedTargetIds: Array<string | null | undefined> = [];
  let setWebUrlCalls = 0;
  let setFetchSeedUrlCalls = 0;

  await withElectronApi(createElectronApi({
    webContent: {
      activate(targetId?: string | null) {
        activatedTargetIds.push(targetId);
      },
      async getState() {
        return createWebContentState();
      },
      onStateChange() {
        return () => {};
      },
    } as unknown as NonNullable<ElectronAPI['webContent']>,
  }), async () => {
    const model = new WebContentNavigationModel();

    await model.activateTarget(null, {
      setWebUrl: () => {
        setWebUrlCalls += 1;
      },
      setFetchSeedUrl: () => {
        setFetchSeedUrlCalls += 1;
      },
    });

    assert.deepEqual(activatedTargetIds, []);
    assert.equal(setWebUrlCalls, 0);
    assert.equal(setFetchSeedUrlCalls, 0);
    assert.deepEqual(model.getSnapshot().webContentState, EMPTY_WEB_CONTENT_STATE);
  });
});

test('SettingsModel subscriptions stop after disposal', () => {
  const model = new SettingsModel([]);
  const sameDomainOnlyValues: boolean[] = [];
  const disposeListener = model.subscribe(() => {
    sameDomainOnlyValues.push(model.getSnapshot().sameDomainOnly);
  });

  model.setSameDomainOnly(!model.getSnapshot().sameDomainOnly);
  disposeListener();
  model.setUseMica(!model.getSnapshot().useMica);

  assert.equal(sameDomainOnlyValues.length, 1);
});

test('pdfDownloadStatus subscriptions stop after disposal', () => {
  const pageUrl = 'https://example.com/pdf-download/subscriptions';
  let notificationCount = 0;
  const disposeListener = subscribePdfDownloadStatus(() => {
    notificationCount += 1;
  });

  markPdfDownloadStarted(pageUrl);
  disposeListener();
  markPdfDownloadFailed(pageUrl, 'network error');

  assert.equal(notificationCount, 1);
  assert.equal(getPdfDownloadStatus(pageUrl).lastError, 'network error');
});

test('statusbarModel subscriptions stop after disposal', () => {
  let notificationCount = 0;
  const disposeListener = subscribeStatusbarState(() => {
    notificationCount += 1;
  });

  setStatusbarState({
    ariaLabel: 'Status',
    paneMode: 'browser',
    modeLabel: 'Source',
    summary: 'Ready',
    leftItems: [],
    rightItems: [],
  });
  disposeListener();
  setStatusbarState({
    ariaLabel: 'Status',
    paneMode: 'pdf',
    modeLabel: 'PDF',
    summary: 'Updated',
    leftItems: [],
    rightItems: [],
  });

  assert.equal(notificationCount, 1);
  assert.equal(getStatusbarStateSnapshot().summary, 'Updated');
});

test('workbenchLayout subscriptions stop after disposal', () => {
  let notificationCount = 0;
  const disposeListener = subscribeWorkbenchLayoutState(() => {
    notificationCount += 1;
  });

  setPrimarySidebarVisible(!originalWorkbenchLayoutState.isPrimarySidebarVisible);
  disposeListener();
  setPrimarySidebarVisible(originalWorkbenchLayoutState.isPrimarySidebarVisible);

  assert.equal(notificationCount, 1);
  assert.equal(
    getWorkbenchLayoutStateSnapshot().isPrimarySidebarVisible,
    originalWorkbenchLayoutState.isPrimarySidebarVisible,
  );
});

test('setWorkbenchSidebarSizes clamps with horizontal limits on narrow viewport', () => {
  const previousInnerWidth = window.innerWidth;
  const horizontalLimits = getLayoutLimits(Orientation.HORIZONTAL);

  try {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: WORKBENCH_CONTENT_LAYOUT_BREAKPOINT,
    });

    setWorkbenchSidebarSizes({
      primarySidebarSize: 0,
      agentSidebarSize: 0,
    });

    const nextState = getWorkbenchLayoutStateSnapshot();
    assert.equal(
      nextState.primarySidebarSize,
      horizontalLimits.primarySidebar.minimum,
    );
    assert.equal(
      nextState.agentSidebarSize,
      horizontalLimits.agentSidebar.minimum,
    );
  } finally {
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: previousInnerWidth,
    });
  }
});

test('workbenchPartDom subscriptions stop after disposal', () => {
  const element = document.createElement('div');
  let notificationCount = 0;
  const disposeListener = subscribeWorkbenchPartDom(() => {
    notificationCount += 1;
  });

  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, element);
  disposeListener();
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, null);

  assert.equal(notificationCount, 1);
  assert.equal(getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.editor], null);
});

test('workbenchState subscriptions stop after disposal', async () => {
  const {
    getWorkbenchStateSnapshot,
    setWorkbenchActivePage,
    subscribeWorkbenchState,
  } = await import('ls/workbench/browser/workbench');
  const originalWorkbenchState = getWorkbenchStateSnapshot();
  let notificationCount = 0;
  const nextPage = originalWorkbenchState.activePage === 'content' ? 'settings' : 'content';

  try {
    const disposeListener = subscribeWorkbenchState(() => {
      notificationCount += 1;
    });

    setWorkbenchActivePage(nextPage);
    disposeListener();
    setWorkbenchActivePage(originalWorkbenchState.activePage);

    assert.equal(notificationCount, 1);
    assert.equal(getWorkbenchStateSnapshot().activePage, originalWorkbenchState.activePage);
  } finally {
    setWorkbenchActivePage(originalWorkbenchState.activePage);
  }
});

test('resolveWorkbenchStatusbarVisibility returns the toggle state directly', async () => {
  const { resolveWorkbenchStatusbarVisibility } = await import(
    'ls/workbench/browser/workbench'
  );

  assert.equal(resolveWorkbenchStatusbarVisibility(true), true);
  assert.equal(resolveWorkbenchStatusbarVisibility(false), false);
});
