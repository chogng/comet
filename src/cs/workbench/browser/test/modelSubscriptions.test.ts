import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type { LibraryDocumentSummary } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronAPI,
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createLibraryModel } from 'cs/workbench/browser/libraryModel';
import { WebContentNavigationModel } from 'cs/workbench/contrib/browserView/browser/browserNavigationModel';
import { EMPTY_WEB_CONTENT_STATE } from 'cs/workbench/contrib/browserView/common/browserView';
import { localeService } from 'cs/workbench/services/localization/browser/localeService';
import {
  getWorkbenchSessionSnapshot,
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
  WORKBENCH_PART_IDS,
} from 'cs/workbench/browser/layout';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
  subscribeStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';
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
    document: undefined,
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
  setWorkbenchWebUrl(originalWorkbenchSession.webUrl);
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

test('DocumentActionsController subscriptions stop after disposal', () => {
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
		getExportableArticleIds: () => [],
    onUnavailableArticleIds: () => {},
    onOpenEditor: () => {},
    onExportArticleSummaries: () => {},
    activeDraftExport: null,
  }, {} as never);
  const snapshotValues: boolean[] = [];
  const disposeListener = controller.subscribe(() => {
    snapshotValues.push(controller.getSnapshot().canExportDocx);
  });

  controller.setContext({
    desktopRuntime: true,
    invokeDesktop: createInvokeDesktop(),
    notificationService: new NoOpNotificationService(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
		getExportableArticleIds: () => [],
    onUnavailableArticleIds: () => {},
    onOpenEditor: () => {},
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
    notificationService: new NoOpNotificationService(),
    locale: 'en',
    ui: locales.en,
    knowledgeBaseEnabled: false,
    pdfDownloadDir: '',
    knowledgeBasePdfDownloadDir: '',
    pdfFileNameUseSelectionOrder: false,
		getExportableArticleIds: () => [],
    onUnavailableArticleIds: () => {},
    onOpenEditor: () => {},
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
    const model = new WebContentNavigationModel(
      nativeHost,
      new NoOpNotificationService(),
    );
    const browserUrls: string[] = [];
    let webUrl = '';
    const disposeListener = model.subscribe(() => {
      browserUrls.push(model.getSnapshot().browserUrl);
    });

    await model.activateTarget('target-1');
    const disconnect = model.connectWebContentState({
      webContentRuntime: true,
      setWebUrl: (value) => {
        webUrl = value;
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

    disconnect();
  });
});

test('WebContentNavigationModel does not activate a default web content target for null tabs', async () => {
  const activatedTargetIds: Array<string | null | undefined> = [];
  let setWebUrlCalls = 0;
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
    const model = new WebContentNavigationModel(
      nativeHost,
      new NoOpNotificationService(),
    );

    await model.activateTarget(null, {
      setWebUrl: () => {
        setWebUrlCalls += 1;
      },
    });

    assert.deepEqual(activatedTargetIds, []);
    assert.equal(setWebUrlCalls, 0);
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

test('resolveWorkbenchStatusbarVisibility returns the toggle state directly', async () => {
  const { resolveWorkbenchStatusbarVisibility } = await import(
    'cs/workbench/browser/parts/titlebar/titlebarPart'
  );

  assert.equal(resolveWorkbenchStatusbarVisibility(true), true);
  assert.equal(resolveWorkbenchStatusbarVisibility(false), false);
});

test('TitlebarPart syncs headless chrome before the shell and statusbar', async () => {
  const { createTitlebarPart } = await import(
    'cs/workbench/browser/parts/titlebar/titlebarPart'
  );
  const container = document.createElement('div');
  const shell = document.createElement('div');
  const statusbar = document.createElement('section');
  let toggleCount = 0;
  let focusAddressBarCount = 0;

  const titlebarPart = createTitlebarPart(container, shell, statusbar);
  container.append(titlebarPart.getElement(), shell);

  try {
    titlebarPart.sync({
      electronRuntime: false,
      useMica: false,
      statusbarVisible: true,
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

    assert(container.classList.contains('comet-has-statusbar'));
    assert.equal(container.classList.contains('comet-has-leading-window-controls'), false);
    assert.equal(
      container.style.getPropertyValue('--workbench-leading-window-controls-width'),
      '',
    );
    assert.equal(container.children[0], titlebarPart.getElement());
    assert.equal(container.children[1], shell);
    assert.equal(container.children[2], statusbar);
    assert.equal(titlebarPart.getElement().classList.contains('comet-titlebar-chrome'), true);
    assert.equal(
      titlebarPart.getLeadingActionsElement().parentElement,
      null,
    );
    const menuButton = titlebarPart.getLeadingActionsElement().querySelector('.comet-titlebar-menu-btn');
    const toggleButton = titlebarPart.getLeadingActionsElement().querySelector('.comet-titlebar-primary-sidebar-toggle-btn');
    const addressBarButton = titlebarPart.getLeadingActionsElement().querySelector('.comet-titlebar-address-bar-btn');
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
