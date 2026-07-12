/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
  LibraryDocumentSummary,
  LibraryDocumentsResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import {
	ILibraryModel,
	LibraryModel,
} from 'cs/workbench/services/knowledgeBase/libraryModel';
import { localeService } from 'cs/workbench/services/localization/browser/localeService';
import {
  getWorkbenchPartDomSnapshot,
  registerWorkbenchPartDomNode,
  subscribeWorkbenchPartDom,
} from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
  subscribeStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';
import { createDocumentActionsController } from 'cs/workbench/browser/documentActionsModel';
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
let originalWorkbenchPartDomSnapshot = getWorkbenchPartDomSnapshot();
let originalStatusbarState = getStatusbarStateSnapshot();

function createInvokeDesktop(): ElectronInvoke {
  return (async (command: string) => {
    throw new Error(`Unexpected desktop command in model subscriptions test: ${command}`);
  }) as ElectronInvoke;
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

function createLibraryDocumentsResult(
  items: readonly LibraryDocumentSummary[],
): LibraryDocumentsResult {
  return {
    items: [...items],
    totalCount: items.length,
    fileCount: items.reduce((count, item) => count + item.fileCount, 0),
    queuedJobCount: 0,
    libraryDbFile: '/tmp/library.db',
    defaultManagedDirectory: '/tmp/library',
    ragCacheDir: '/tmp/rag-cache',
  };
}

function restoreWorkbenchPartDomSnapshot() {
  const partIds = Array.from(
    new Set(Object.values(WORKBENCH_PART_IDS)),
  ) as Array<(typeof WORKBENCH_PART_IDS)[keyof typeof WORKBENCH_PART_IDS]>;

  for (const partId of partIds) {
    registerWorkbenchPartDomNode(partId, originalWorkbenchPartDomSnapshot[partId]);
  }
}

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  originalDocumentLanguage = document.documentElement.lang;
  originalLocale = localeService.getLocale();
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
		getExportableArticleSelection: () => undefined,
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
		getExportableArticleSelection: () => undefined,
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
		getExportableArticleSelection: () => undefined,
    onUnavailableArticleIds: () => {},
    onOpenEditor: () => {},
    onExportArticleSummaries: () => {},
    activeDraftExport: null,
  });

  assert.deepEqual(snapshotValues, [true]);
});

test('LibraryModel subscriptions stop after listener disposal and model dispose', () => {
  const registrations = getSingletonServiceDescriptors().filter(([id]) => id === ILibraryModel);
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0][1].supportsDelayedInstantiation, true);

  const model = new LibraryModel({
    canInvoke: () => false,
    invoke: createInvokeDesktop(),
  } as never);
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

test('LibraryModel starts once and commits only the latest refresh', async () => {
  const requests: Array<{
    resolve: (result: LibraryDocumentsResult) => void;
  }> = [];
  const model = new LibraryModel({
    canInvoke: () => true,
    invoke: (async (command: string) => {
      assert.equal(command, 'list_library_documents');
      return new Promise<LibraryDocumentsResult>((resolve) => {
        requests.push({ resolve });
      });
    }) as ElectronInvoke,
  } as never);
  assert.equal(requests.length, 1);

  const latestRefresh = model.refresh();
  assert.equal(requests.length, 2);
  const latest = createLibraryDocumentSummary({
    documentId: 'latest',
    sourceUrl: 'https://example.com/latest',
  });
  requests[1]!.resolve(createLibraryDocumentsResult([latest]));
  await latestRefresh;

  const stale = createLibraryDocumentSummary({
    documentId: 'stale',
    sourceUrl: 'https://example.com/stale',
  });
  requests[0]!.resolve(createLibraryDocumentsResult([stale]));
  await Promise.resolve();

  assert.deepEqual(
    model.getSnapshot().librarySnapshot.items.map(item => item.documentId),
    ['latest'],
  );
  model.dispose();
});

test('LibraryModel does not publish a pending refresh after disposal', async () => {
  let resolveRefresh!: (result: LibraryDocumentsResult) => void;
  const refreshPromise = new Promise<LibraryDocumentsResult>((resolve) => {
    resolveRefresh = resolve;
  });
  const model = new LibraryModel({
    canInvoke: () => true,
    invoke: (async () => refreshPromise) as ElectronInvoke,
  } as never);
  let changes = 0;
  model.subscribe(() => {
    changes += 1;
  });

  model.dispose();
  resolveRefresh(createLibraryDocumentsResult([createLibraryDocumentSummary()]));
  await refreshPromise;
  await Promise.resolve();

  assert.equal(changes, 0);
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

test('resolveWorkbenchStatusbarVisibility requires the editor to be visible', async () => {
  const { resolveWorkbenchStatusbarVisibility } = await import(
    'cs/workbench/browser/parts/titlebar/titlebarPart'
  );

  assert.equal(resolveWorkbenchStatusbarVisibility(true, true), true);
  assert.equal(resolveWorkbenchStatusbarVisibility(true, false), false);
  assert.equal(resolveWorkbenchStatusbarVisibility(false, true), false);
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
  const dropdownServices = await createDropdownTestServices();

  const titlebarPart = createTitlebarPart(container, shell, statusbar, dropdownServices);
  container.append(titlebarPart.getElement(), shell);

  try {
    titlebarPart.sync({
      electronRuntime: false,
      useMica: false,
      statusbarVisible: true,
      isEditorVisible: true,
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
    dropdownServices.dispose();
  }
});
