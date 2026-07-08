import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
  FetchStatus,
  LibraryDocumentSummary,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronAPI,
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { appError } from 'cs/base/common/errors';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createLibraryModel } from 'cs/workbench/browser/libraryModel';
import { WebContentNavigationModel } from 'cs/workbench/browser/webContentNavigationModel';
import { EMPTY_WEB_CONTENT_STATE } from 'cs/workbench/services/webContent/webContentNavigationService';
import { localeService } from 'cs/workbench/services/localization/browser/localeService';
import {
  getWorkbenchContentStateSnapshot,
  setBatchEndDate,
  setBatchStartDate,
  setFilterJournal,
  subscribeWorkbenchContentState,
} from 'cs/workbench/browser/workbenchContentState';
import {
  getWorkbenchSessionSnapshot,
  setWorkbenchArticles,
  setWorkbenchFetchSeedUrl,
  setWorkbenchSelectedArticleKeysInOrder,
  setWorkbenchSelectedChatArticleUrlsInOrder,
  setWorkbenchSelectionModePhase,
  setWorkbenchWebUrl,
  subscribeWorkbenchSession,
} from 'cs/workbench/browser/session';
import {
  getWorkbenchLayoutStateSnapshot,
  getWorkbenchPartDomSnapshot,
  registerWorkbenchPartDomNode,
  setAgentSidebarVisible,
  setEditorCollapsed,
  setPrimarySidebarVisible,
  setWorkbenchSidebarSizes,
  subscribeWorkbenchLayoutState,
  subscribeWorkbenchPartDom,
  WORKBENCH_CONTENT_LAYOUT_BREAKPOINT,
  WORKBENCH_PART_IDS,
} from 'cs/workbench/browser/layout';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
  subscribeStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';
import { createBatchFetchController } from 'cs/workbench/browser/batchFetchModel';
import { createDocumentActionsController } from 'cs/workbench/browser/documentActionsModel';
import type { WebContentState } from 'cs/platform/browserView/common/browserView';
import {
  getPdfDownloadStatus,
  markPdfDownloadFailed,
  markPdfDownloadStarted,
  subscribePdfDownloadStatus,
} from 'cs/workbench/services/document/pdfDownloadStatus';
import { SettingsModel } from 'cs/workbench/services/settings/settingsModel';
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

function createRejectingInvokeDesktop(error: unknown): ElectronInvoke {
  return (async () => {
    throw error;
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
  setEditorCollapsed(originalWorkbenchLayoutState.isEditorCollapsed);
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
  setWorkbenchSelectedChatArticleUrlsInOrder(
    originalWorkbenchSession.selectedChatArticleUrlsInOrder,
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

  const nativeHost = createNativeHostService({
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
  });

  withElectronApi(createElectronApi({}), () => {
    const controller = createBatchFetchController({
      desktopRuntime: true,
      addressBarUrl: '',
      journalSourceOverrides: [],
      batchStartDate: '',
      batchEndDate: '',
      invokeDesktop: createInvokeDesktop(),
      nativeHost,
      ui: locales.en,
      onBeforeFetch: () => {},
      onFetchSuccess: () => {},
    });
    const sourceTexts: string[] = [];
    const disposeListener = controller.subscribe(() => {
      sourceTexts.push(controller.getSnapshot().statusbarFetchSourceText);
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

test('BatchFetchController reports date range no-match as empty result', async () => {
  let successCount = 0;
  const controller = createBatchFetchController({
    desktopRuntime: true,
    addressBarUrl: '',
    journalSourceOverrides: [],
    batchStartDate: '2026-07-01',
    batchEndDate: '2026-07-08',
    invokeDesktop: createRejectingInvokeDesktop(
      appError('BATCH_NO_MATCH_IN_DATE_RANGE', {
        startDate: '2026-07-01',
        endDate: '2026-07-08',
      }),
    ),
    nativeHost: createNativeHostService(),
    ui: locales.en,
    onBeforeFetch: () => {},
    onFetchSuccess: () => {
      successCount += 1;
    },
  });

  const result = await controller.handleFetchSource({
    id: 'source-1',
    url: 'https://example.com/articles',
    journalTitle: 'Example',
  });
  const snapshot = controller.getSnapshot();

  assert.equal(result.ok, false);
  assert.equal('reason' in result ? result.reason : '', 'empty');
  assert.equal(successCount, 0);
  assert.equal(snapshot.phase, 'empty');
  assert.equal(snapshot.emptyMessage, locales.en.errorBatchNoMatchInDateRange);
  assert.equal(snapshot.lastErrorMessage, locales.en.errorBatchNoMatchInDateRange);
  assert.equal(snapshot.isBatchLoading, false);
});

test('DocumentActionsController subscriptions stop after disposal', () => {
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
    createBrowserTab: () => {},
    onExportArticleSummaries: () => {},
    activeDraftExport: null,
  });
  const snapshotValues: boolean[] = [];
  const disposeListener = controller.subscribe(() => {
    snapshotValues.push(controller.getSnapshot().canExportDocx);
  });

  controller.setContext({
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
    createBrowserTab: () => {},
    onExportArticleSummaries: () => {},
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
    createBrowserTab: () => {},
    onExportArticleSummaries: () => {},
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
  const nativeHost = createNativeHostService({
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
  });

  await withElectronApi(createElectronApi({}), async () => {
    const model = new WebContentNavigationModel(nativeHost);
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
  const nativeHost = createNativeHostService({
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
  });

  await withElectronApi(createElectronApi({}), async () => {
    const model = new WebContentNavigationModel(nativeHost);

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
  const model = new SettingsModel();
  const useMicaValues: boolean[] = [];
  const disposeListener = model.subscribe(() => {
    useMicaValues.push(model.getSnapshot().useMica);
  });

  model.setUseMica(!model.getSnapshot().useMica);
  disposeListener();
  model.setStatusbarVisible(!model.getSnapshot().statusbarVisible);

  assert.equal(useMicaValues.length, 1);
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
    assert.equal(nextState.primarySidebarSize, 160);
    assert.equal(nextState.agentSidebarSize, 160);
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
  } = await import('cs/workbench/browser/workbench');
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
    'cs/workbench/browser/parts/titlebar/titlebarPart'
  );

  assert.equal(resolveWorkbenchStatusbarVisibility(true), true);
  assert.equal(resolveWorkbenchStatusbarVisibility(false), false);
});

test('TitlebarPart mounts the top app row before the middle shell and statusbar', async () => {
  const { createTitlebarPart } = await import(
    'cs/workbench/browser/parts/titlebar/titlebarPart'
  );
  const container = document.createElement('div');
  const shell = document.createElement('div');
  const statusbar = document.createElement('section');
  const sessionsHeader = document.createElement('header');
  const editorHeader = document.createElement('header');
  let toggleCount = 0;
  let focusAddressBarCount = 0;

  const titlebarPart = createTitlebarPart(container, shell, statusbar);
  container.append(titlebarPart.getElement(), shell);

  try {
    titlebarPart.sync({
      electronRuntime: false,
      useMica: false,
      statusbarVisible: true,
      activePage: 'content',
      primarySidebarVisible: true,
      primarySidebarSize: 260,
      editorVisible: true,
      editorSize: 420,
      sessionsHeaderElement: sessionsHeader,
      editorHeaderElement: editorHeader,
      leadingActions: {
        menuLabel: 'Menu',
        isPrimarySidebarVisible: true,
        primarySidebarToggleLabel: 'Hide primary sidebar',
        addressBarLabel: 'Address bar',
        onTogglePrimarySidebar: () => {
          toggleCount += 1;
        },
        onFocusAddressBar: () => {
          focusAddressBarCount += 1;
        },
      },
    });

    assert(container.classList.contains('comet-has-titlebar'));
    assert(container.classList.contains('comet-has-statusbar'));
    assert.equal(container.classList.contains('comet-has-leading-window-controls'), false);
    assert.equal(
      container.style.getPropertyValue('--workbench-leading-window-controls-width'),
      '',
    );
    assert.equal(container.children[0], titlebarPart.getElement());
    assert.equal(container.children[1], shell);
    assert.equal(container.children[2], statusbar);
    assert.equal(
      titlebarPart.getElement().querySelector('.comet-titlebar-left > .comet-titlebar-leading-actions-host') instanceof HTMLElement,
      true,
    );
    const menuButton = titlebarPart.getElement().querySelector('.comet-titlebar-menu-btn');
    const toggleButton = titlebarPart.getElement().querySelector('.comet-titlebar-primary-sidebar-toggle-btn');
    const addressBarButton = titlebarPart.getElement().querySelector('.comet-titlebar-address-bar-btn');
    assert(menuButton instanceof HTMLButtonElement);
    assert(toggleButton instanceof HTMLButtonElement);
    assert(addressBarButton instanceof HTMLButtonElement);
    assert.equal(menuButton.getAttribute('aria-label'), 'Menu');
    assert.equal(toggleButton.getAttribute('aria-label'), 'Hide primary sidebar');
    assert.equal(addressBarButton.getAttribute('aria-label'), 'Address bar');
    toggleButton.click();
    addressBarButton.click();
    assert.equal(toggleCount, 1);
    assert.equal(focusAddressBarCount, 1);
    assert.equal(
      titlebarPart.getElement().querySelector('.comet-titlebar-sessions')?.firstElementChild,
      sessionsHeader,
    );
    assert.equal(
      titlebarPart.getElement().querySelector('.comet-titlebar-editor')?.firstElementChild,
      editorHeader,
    );
    assert.equal(
      getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.titlebar],
      titlebarPart.getElement(),
    );
    assert.equal(
      getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.statusbar],
      statusbar,
    );
  } finally {
    titlebarPart.dispose();
  }
});
