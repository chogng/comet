import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import {
  createEmptyWritingEditorDocument,
  createWritingEditorDocumentFromPlainText,
} from 'ls/editor/common/writingEditorDocument';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import type {
  EditorGroupModel,
  EditorGroupTabItem,
} from 'ls/workbench/browser/parts/editor/editorGroupModel';
import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import type {
  WorkbenchContextMenuDelegate,
  WorkbenchContextMenuService,
} from 'ls/workbench/services/contextmenu/electron-sandbox/contextmenuService';

let cleanupDomEnvironment: (() => void) | null = null;
let TabsTitleControl: typeof import('ls/workbench/browser/parts/editor/tabsTitleControl').TabsTitleControl;
let createEditorGroupModel: typeof import('ls/workbench/browser/parts/editor/editorGroupModel').createEditorGroupModel;

function waitForAnimationFrame() {
  return new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => {
      resolve();
    });
  });
}

function createGroupModel(
  activeTabId: string | null,
  tabs: EditorGroupModel['tabs'],
): EditorGroupModel {
  return {
    tabs,
    activeTabId,
    activeTab: null,
  };
}

function createTabItem(
  tab: Pick<EditorGroupTabItem, 'id' | 'kind' | 'label' | 'title'> & {
    paneMode?: EditorGroupTabItem['paneMode'];
    residency?: EditorGroupTabItem['residency'];
    faviconUrl?: string;
    isActive?: boolean;
    isClosable?: boolean;
    isDirty?: boolean;
    hasLocalHistory?: boolean;
    targetTabId?: string | null;
  },
): EditorGroupTabItem {
  const fallbackPaneModeByKind: Record<EditorGroupTabItem['kind'], EditorGroupTabItem['paneMode']> = {
    draft: 'draft',
    browser: 'browser',
    pdf: 'pdf',
    file: 'file',
    terminal: 'terminal',
    'git-changes': 'git-changes',
  };

  return {
    id: tab.id,
    kind: tab.kind,
    paneMode: tab.paneMode ?? fallbackPaneModeByKind[tab.kind],
    residency:
      tab.residency ??
      (tab.targetTabId === null ? 'resident' : 'dynamic'),
    label: tab.label,
    title: tab.title,
    faviconUrl: tab.faviconUrl,
    targetTabId:
      Object.prototype.hasOwnProperty.call(tab, 'targetTabId')
        ? tab.targetTabId ?? null
        : tab.id,
    state: {
      isActive: Boolean(tab.isActive),
      isClosable: Boolean(tab.isClosable),
      isDirty: Boolean(tab.isDirty),
      hasLocalHistory: Boolean(tab.hasLocalHistory),
      canUndo: Boolean(tab.hasLocalHistory),
      canRedo: false,
    },
  };
}

function installResizeObserverSpy() {
  let activeObservers = 0;
  const previousResizeObserver = globalThis.ResizeObserver;

  class FakeResizeObserver implements ResizeObserver {
    private observing = false;

    disconnect() {
      if (!this.observing) {
        return;
      }

      this.observing = false;
      activeObservers -= 1;
    }

    observe() {
      if (this.observing) {
        return;
      }

      this.observing = true;
      activeObservers += 1;
    }

    unobserve() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });

  return {
    getActiveObservers() {
      return activeObservers;
    },
    restore() {
      if (previousResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
        return;
      }

      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: previousResizeObserver,
      });
    },
  };
}

function createContextMenuServiceSpy() {
  const delegates: WorkbenchContextMenuDelegate[] = [];
  const contextMenuService: WorkbenchContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return delegates.length > 0;
    },
    dispose() {},
  };

  return {
    contextMenuService,
    delegates,
  };
}

function getTabsContainer(rootElement: HTMLElement) {
  const tabsContainer = rootElement.querySelector('.editor-tabs-container');
  assert(tabsContainer instanceof HTMLDivElement);
  return tabsContainer;
}

function getDropIndicatorLeft(container: HTMLDivElement) {
  return container.style.getPropertyValue('--editor-tab-drop-indicator-left');
}

function createDataTransferStub() {
  const setDragImageCalls: Array<{
    element: Element;
    x: number;
    y: number;
  }> = [];
  const dataTransfer = {
    effectAllowed: 'all',
    dropEffect: 'none',
    setData() {},
    getData() {
      return '';
    },
    clearData() {},
    setDragImage(element: Element, x: number, y: number) {
      setDragImageCalls.push({ element, x, y });
    },
  } as unknown as DataTransfer & {
    setDragImageCalls: typeof setDragImageCalls;
  };
  dataTransfer.setDragImageCalls = setDragImageCalls;
  return dataTransfer;
}

function dispatchDragEvent(
  target: EventTarget,
  type: string,
  options: {
    clientX?: number;
    dataTransfer?: DataTransfer;
  } = {},
) {
  const event = new Event(type, {
    bubbles: true,
    cancelable: true,
  }) as DragEvent;
  Object.defineProperties(event, {
    clientX: {
      configurable: true,
      value: options.clientX ?? 0,
    },
    dataTransfer: {
      configurable: true,
      value: options.dataTransfer ?? createDataTransferStub(),
    },
  });
  target.dispatchEvent(event);
  return event;
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ TabsTitleControl } = await import('ls/workbench/browser/parts/editor/tabsTitleControl'));
  ({ createEditorGroupModel } = await import('ls/workbench/browser/parts/editor/editorGroupModel'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

const editorLabels = {
  draftMode: 'Draft',
  sourceMode: 'Browser',
  pdfMode: 'PDF',
  newTab: 'New Tab',
} as EditorPartLabels;

test('TabsTitleControl reuses tab nodes across prop updates', () => {
  const activatedTabIds: string[] = [];
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: (tabId) => {
      activatedTabIds.push(tabId);
    },
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const draftTab = container.children[0];
  const browserTab = container.children[1];

  control.setProps({
    group: createGroupModel('browser-b', [
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B Updated',
        title: 'Web B Updated',
        isActive: true,
      }),
      createTabItem({
        id: 'pdf-c',
        kind: 'pdf',
        label: 'PDF C',
        title: 'PDF C',
      }),
    ]),
    labels: {
      close: 'Remove',
    },
    onActivateTab: (tabId) => {
      activatedTabIds.push(tabId);
    },
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });

  assert.equal(container.children.length, 2);
  assert.equal(container.children[0], browserTab);
  assert.equal(container.children[1].querySelector('.editor-tab-label-text')?.textContent, 'PDF C');
  assert.equal(draftTab.isConnected, false);

  const updatedMainButton = browserTab.querySelector('.editor-tab-main');
  assert(updatedMainButton instanceof HTMLButtonElement);
  assert.equal(updatedMainButton.title, 'Web B Updated');
  assert.equal(updatedMainButton.getAttribute('aria-selected'), 'true');
  assert.equal(updatedMainButton.getAttribute('aria-posinset'), '1');
  assert.equal(updatedMainButton.getAttribute('aria-setsize'), '2');

  updatedMainButton.click();

  assert.deepEqual(activatedTabIds, ['browser-b']);

  control.dispose();
});

test('createEditorGroupModel keeps concrete tabs in workspace order', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: 'Draft A',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
      {
        id: 'draft-b',
        kind: 'draft',
        title: 'Draft B',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
      {
        id: 'browser-a',
        kind: 'browser',
        title: 'Example A',
        url: 'https://a.test',
      },
      {
        id: 'pdf-a',
        kind: 'pdf',
        title: 'Paper A',
        url: 'https://a.test/paper.pdf',
      },
    ],
    activeTabId: 'draft-a',
    activeTab: {
      id: 'draft-a',
      kind: 'draft',
      title: 'Draft A',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.deepEqual(
    model.tabs.map((tab) => tab.id),
    ['draft-a', 'draft-b', 'browser-a', 'pdf-a'],
  );
  assert.equal(model.tabs[0]?.targetTabId, 'draft-a');
  assert.equal(model.tabs[0]?.label, 'Draft A');
  assert.equal(model.tabs[1]?.targetTabId, 'draft-b');
  assert.equal(model.tabs[1]?.residency, 'dynamic');
  assert.equal(model.tabs[2]?.targetTabId, 'browser-a');
  assert.equal(model.tabs[2]?.state.isClosable, true);
  assert.equal(model.tabs[3]?.targetTabId, 'pdf-a');
  assert.equal(model.tabs[3]?.state.isActive, false);
});

test('createEditorGroupModel keeps a resident tab in its workspace position instead of pinning it first', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'browser-a',
        kind: 'browser',
        title: 'Example A',
        url: 'https://a.test',
      },
      {
        id: 'draft-a',
        kind: 'draft',
        title: '',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
      {
        id: 'pdf-a',
        kind: 'pdf',
        title: '',
        url: 'about:blank',
      },
    ],
    activeTabId: 'pdf-a',
    activeTab: {
      id: 'pdf-a',
      kind: 'pdf',
      title: '',
      url: 'about:blank',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.deepEqual(
    model.tabs.map((tab) => tab.id),
    ['browser-a', 'draft-a', 'pdf-a'],
  );
  assert.equal(model.tabs[1]?.residency, 'resident');
  assert.equal(model.tabs[2]?.residency, 'resident');
});

test('createEditorGroupModel appends missing resident entries after concrete tabs', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: 'Draft A',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
      {
        id: 'browser-a',
        kind: 'browser',
        title: 'Example A',
        url: 'https://a.test',
      },
    ],
    activeTabId: 'draft-a',
    activeTab: {
      id: 'draft-a',
      kind: 'draft',
      title: 'Draft A',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.deepEqual(
    model.tabs.map((tab) => tab.id),
    ['draft-a', 'browser-a', 'pdf-entry'],
  );
  assert.equal(model.tabs[2]?.targetTabId, null);
  assert.equal(model.tabs[2]?.title, 'PDF');
});

test('createEditorGroupModel keeps browser favicons on tabs even when inactive', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: 'Draft A',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
      {
        id: 'browser-a',
        kind: 'browser',
        title: 'Example A',
        url: 'https://a.test',
        faviconUrl: 'https://a.test/favicon.ico',
      },
    ],
    activeTabId: 'draft-a',
    activeTab: {
      id: 'draft-a',
      kind: 'draft',
      title: 'Draft A',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.equal(model.tabs[1]?.targetTabId, 'browser-a');
  assert.equal(model.tabs[1]?.faviconUrl, 'https://a.test/favicon.ico');
});

test('createEditorGroupModel respects explicit resident tabs even when they are not first in kind order', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'browser-dynamic',
        kind: 'browser',
        title: '',
        url: 'about:blank',
        residency: 'dynamic',
      },
      {
        id: 'browser-resident',
        kind: 'browser',
        title: '',
        url: 'about:blank',
        residency: 'resident',
      },
      {
        id: 'pdf-a',
        kind: 'pdf',
        title: 'Paper.pdf',
        url: 'https://a.test/paper.pdf',
      },
    ],
    activeTabId: 'browser-dynamic',
    activeTab: {
      id: 'browser-dynamic',
      kind: 'browser',
      title: '',
      url: 'about:blank',
      residency: 'dynamic',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.deepEqual(
    model.tabs.map((tab) => tab.id),
    ['browser-dynamic', 'browser-resident', 'pdf-a', 'draft-entry'],
  );
  assert.equal(model.tabs[1]?.residency, 'resident');
  assert.equal(model.tabs[1]?.label, '');
  const dynamicBrowser = model.tabs.find((tab) => tab.id === 'browser-dynamic');
  assert.equal(dynamicBrowser?.residency, 'dynamic');
  assert.equal(dynamicBrowser?.label, 'New Tab');
});

test('createEditorGroupModel keeps a resident untitled browser tab icon-only', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'browser-a',
        kind: 'browser',
        title: '',
        url: 'about:blank',
      },
    ],
    activeTabId: 'browser-a',
    activeTab: {
      id: 'browser-a',
      kind: 'browser',
      title: '',
      url: 'about:blank',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  const browserTab = model.tabs.find((tab) => tab.id === 'browser-a');
  assert.equal(browserTab?.targetTabId, 'browser-a');
  assert.equal(browserTab?.residency, 'resident');
  assert.equal(browserTab?.label, '');
  assert.equal(browserTab?.title, 'Browser');
  assert.equal(browserTab?.state.isClosable, false);
});

test('createEditorGroupModel keeps a resident empty pdf tab icon-only', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'pdf-a',
        kind: 'pdf',
        title: '',
        url: 'about:blank',
      },
    ],
    activeTabId: 'pdf-a',
    activeTab: {
      id: 'pdf-a',
      kind: 'pdf',
      title: '',
      url: 'about:blank',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  const pdfTab = model.tabs.find((tab) => tab.id === 'pdf-a');
  assert.equal(pdfTab?.targetTabId, 'pdf-a');
  assert.equal(pdfTab?.residency, 'resident');
  assert.equal(pdfTab?.label, '');
  assert.equal(pdfTab?.title, 'PDF');
  assert.equal(pdfTab?.state.isClosable, false);
});

test('createEditorGroupModel keeps a resident untitled draft tab icon-only', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: '',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
    ],
    activeTabId: 'draft-a',
    activeTab: {
      id: 'draft-a',
      kind: 'draft',
      title: '',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.equal(model.tabs[0]?.targetTabId, 'draft-a');
  assert.equal(model.tabs[0]?.residency, 'resident');
  assert.equal(model.tabs[0]?.label, '');
  assert.equal(model.tabs[0]?.title, 'Draft');
  assert.equal(model.tabs[0]?.state.isClosable, false);
});

test('createEditorGroupModel keeps empty dirty draft tabs closable', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: '',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
    ],
    activeTabId: 'draft-a',
    activeTab: {
      id: 'draft-a',
      kind: 'draft',
      title: '',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: ['draft-a'],
  });

  assert.equal(model.tabs[0]?.targetTabId, 'draft-a');
  assert.equal(model.tabs[0]?.state.isClosable, true);
  assert.equal(model.tabs[0]?.label, '');
  assert.equal(model.tabs[0]?.title, 'Draft');
});

test('createEditorGroupModel shows label for a single non-empty clean draft tab', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: '',
        document: createWritingEditorDocumentFromPlainText('saved content'),
        viewMode: 'draft',
      },
    ],
    activeTabId: 'draft-a',
    activeTab: {
      id: 'draft-a',
      kind: 'draft',
      title: '',
      document: createWritingEditorDocumentFromPlainText('saved content'),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.equal(model.tabs[0]?.targetTabId, 'draft-a');
  assert.equal(model.tabs[0]?.state.isClosable, true);
  assert.equal(model.tabs[0]?.label, 'Draft 1');
  assert.equal(model.tabs[0]?.title, 'Draft 1');
});

test('createEditorGroupModel keeps resident empty draft icon-only and dynamic empty draft labeled', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: '',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
      {
        id: 'draft-b',
        kind: 'draft',
        title: '',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
    ],
    activeTabId: 'draft-a',
    activeTab: {
      id: 'draft-a',
      kind: 'draft',
      title: '',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  assert.equal(model.tabs[0]?.targetTabId, 'draft-a');
  assert.equal(model.tabs[0]?.residency, 'resident');
  assert.equal(model.tabs[0]?.label, '');
  assert.equal(model.tabs[0]?.title, 'Draft');
  const dynamicDraft = model.tabs.find((tab) => tab.id === 'draft-b');
  assert.equal(dynamicDraft?.targetTabId, 'draft-b');
  assert.equal(dynamicDraft?.residency, 'dynamic');
  assert.equal(dynamicDraft?.state.isClosable, true);
  assert.equal(dynamicDraft?.label, 'New Tab');
  assert.equal(dynamicDraft?.title, 'New Tab');
});

test('createEditorGroupModel keeps resident empty pdf icon-only and dynamic empty pdf labeled', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'pdf-a',
        kind: 'pdf',
        title: '',
        url: 'about:blank',
        residency: 'resident',
      },
      {
        id: 'pdf-b',
        kind: 'pdf',
        title: '',
        url: 'about:blank',
        residency: 'dynamic',
      },
    ],
    activeTabId: 'pdf-b',
    activeTab: {
      id: 'pdf-b',
      kind: 'pdf',
      title: '',
      url: 'about:blank',
      residency: 'dynamic',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  const residentPdf = model.tabs.find((tab) => tab.id === 'pdf-a');
  assert.equal(residentPdf?.residency, 'resident');
  assert.equal(residentPdf?.state.isClosable, false);
  assert.equal(residentPdf?.label, '');
  assert.equal(residentPdf?.title, 'PDF');
  const dynamicPdf = model.tabs.find((tab) => tab.id === 'pdf-b');
  assert.equal(dynamicPdf?.residency, 'dynamic');
  assert.equal(dynamicPdf?.state.isClosable, true);
  assert.equal(dynamicPdf?.label, 'New Tab');
  assert.equal(dynamicPdf?.title, 'New Tab');
});

test('createEditorGroupModel keeps resident empty browser icon-only and dynamic empty browser labeled and closable', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'browser-a',
        kind: 'browser',
        title: '',
        url: 'about:blank',
        residency: 'resident',
      },
      {
        id: 'browser-b',
        kind: 'browser',
        title: '',
        url: 'about:blank',
        residency: 'dynamic',
      },
    ],
    activeTabId: 'browser-b',
    activeTab: {
      id: 'browser-b',
      kind: 'browser',
      title: '',
      url: 'about:blank',
      residency: 'dynamic',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: [],
  });

  const residentBrowser = model.tabs.find((tab) => tab.id === 'browser-a');
  assert.equal(residentBrowser?.residency, 'resident');
  assert.equal(residentBrowser?.state.isClosable, false);
  assert.equal(residentBrowser?.label, '');
  assert.equal(residentBrowser?.title, 'Source');

  const dynamicBrowser = model.tabs.find((tab) => tab.id === 'browser-b');
  assert.equal(dynamicBrowser?.residency, 'dynamic');
  assert.equal(dynamicBrowser?.state.isClosable, true);
  assert.equal(dynamicBrowser?.label, 'New Tab');
  assert.equal(dynamicBrowser?.title, 'New Tab');
});

test('TabsTitleControl allows resident real tabs to be dragged for reordering', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: '',
        title: 'Draft',
        residency: 'resident',
      }),
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'Example',
        title: 'Example',
        residency: 'resident',
      }),
    ]),
    labels: {
      close: 'Close',
      closeOthers: 'Close Others',
      closeAll: 'Close All',
      rename: 'Rename',
    },
    onActivateTab: () => {},
    onOpenPaneMode: () => {},
    onCloseTab: () => {},
    onCloseOtherTabs: () => false,
    onCloseAllTabs: () => false,
    onRenameTab: () => {},
    onReorderTab: () => {},
  });
  const element = control.getElement();
  document.body.append(element);

  try {
    const tabs = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.editor-tab-main'),
    );
    assert.equal(tabs[0]?.draggable, true);
    assert.equal(tabs[1]?.draggable, true);
  } finally {
    control.dispose();
    document.body.replaceChildren();
  }
});

test('createEditorGroupModel keeps dirty draft tabs reachable when a clean draft is newly active', () => {
  const model = createEditorGroupModel({
    tabs: [
      {
        id: 'draft-a',
        kind: 'draft',
        title: '',
        document: createWritingEditorDocumentFromPlainText('dirty'),
        viewMode: 'draft',
      },
      {
        id: 'draft-b',
        kind: 'draft',
        title: '',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
    ],
    activeTabId: 'draft-b',
    activeTab: {
      id: 'draft-b',
      kind: 'draft',
      title: '',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
    labels: editorLabels,
    draftStatusByTabId: {},
    dirtyDraftTabIds: ['draft-a'],
  });

  assert.equal(model.tabs[0]?.id, 'draft-a');
  assert.equal(model.tabs[0]?.targetTabId, 'draft-a');
  assert.equal(model.tabs[0]?.residency, 'resident');
  assert.equal(model.tabs[0]?.state.isDirty, true);
  assert.equal(model.tabs[0]?.state.isClosable, true);
  const activeDraft = model.tabs.find((tab) => tab.id === 'draft-b');
  assert.equal(activeDraft?.targetTabId, 'draft-b');
  assert.equal(activeDraft?.residency, 'dynamic');
  assert.equal(activeDraft?.state.isActive, true);
  assert.equal(activeDraft?.state.isClosable, false);
});

test('TabsTitleControl opens a pane mode when a resident entry has no target tab yet', () => {
  const openedPaneModes: string[] = [];
  const control = new TabsTitleControl({
    group: createGroupModel(null, [
      createTabItem({
        id: 'draft-entry',
        kind: 'draft',
        label: '',
        title: 'Draft',
        targetTabId: null,
      }),
      createTabItem({
        id: 'browser-entry',
        kind: 'browser',
        label: '',
        title: 'Browser',
        targetTabId: null,
      }),
      createTabItem({
        id: 'pdf-entry',
        kind: 'pdf',
        label: '',
        title: 'PDF',
        targetTabId: null,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: (paneMode) => {
      openedPaneModes.push(paneMode);
    },
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const browserButton = container.children[1]?.querySelector('.editor-tab-main');
  assert(browserButton instanceof HTMLButtonElement);

  browserButton.click();

  assert.deepEqual(openedPaneModes, ['browser']);

  control.dispose();
});

test('TabsTitleControl uses file-text for both inactive and active pdf tabs', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('browser-a', [
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'Browser',
        title: 'Browser',
        isActive: true,
      }),
      createTabItem({
        id: 'pdf-a',
        kind: 'pdf',
        label: 'Paper.pdf',
        title: 'Paper.pdf',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const getPdfIcon = () =>
    container.children[1]?.querySelector('.editor-tab-icon .lx-icon');

  assert.equal(getPdfIcon()?.classList.contains('lx-icon-file-text'), true);
  assert.equal(getPdfIcon()?.classList.contains('lx-icon-pdf'), false);

  control.setProps({
    group: createGroupModel('pdf-a', [
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'Browser',
        title: 'Browser',
      }),
      createTabItem({
        id: 'pdf-a',
        kind: 'pdf',
        label: 'Paper.pdf',
        title: 'Paper.pdf',
        isActive: true,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });

  assert.equal(getPdfIcon()?.classList.contains('lx-icon-file-text'), true);
  assert.equal(getPdfIcon()?.classList.contains('lx-icon-pdf'), false);

  control.dispose();
});

test('TabsTitleControl reorders tabs by drag and drop', () => {
  const reorderCalls: Array<[string, string, 'before' | 'after']> = [];
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
      createTabItem({
        id: 'pdf-c',
        kind: 'pdf',
        label: 'PDF C',
        title: 'PDF C',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onReorderTab: (tabId, targetTabId, position) => {
      reorderCalls.push([tabId, targetTabId, position]);
    },
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const [draftTab, browserTab] = Array.from(container.children);
  const draftButton = draftTab?.querySelector('.editor-tab-main');
  assert(draftButton instanceof HTMLButtonElement);
  assert.equal(draftButton.draggable, true);

  Object.defineProperty(browserTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 100,
      top: 0,
      width: 120,
      height: 26,
      right: 220,
      bottom: 26,
      x: 100,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });

  const dataTransfer = createDataTransferStub();
  dispatchDragEvent(draftButton, 'dragstart', { dataTransfer });
  assert.equal(draftTab?.classList.contains('is-dragging'), true);

  const dragOverEvent = dispatchDragEvent(browserTab, 'dragover', {
    clientX: 190,
    dataTransfer,
  });
  assert.equal(dragOverEvent.defaultPrevented, true);
  assert.equal(container.classList.contains('is-drop-indicator-visible'), true);
  assert.equal(getDropIndicatorLeft(container), '220px');

  dispatchDragEvent(browserTab, 'drop', {
    clientX: 190,
    dataTransfer,
  });

  assert.deepEqual(reorderCalls, [['draft-a', 'browser-b', 'after']]);
  assert.equal(draftTab?.classList.contains('is-dragging'), false);
  assert.equal(container.classList.contains('is-drop-indicator-visible'), false);

  control.dispose();
});

test('TabsTitleControl anchors the drag preview to the left edge of the dragged tab', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onReorderTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);
  const draftTab = container.children[0];
  const draftButton = draftTab?.querySelector('.editor-tab-main');
  assert(draftTab instanceof HTMLElement);
  assert(draftButton instanceof HTMLButtonElement);

  Object.defineProperty(draftTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 20,
      top: 0,
      width: 120,
      height: 26,
      right: 140,
      bottom: 26,
      x: 20,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });

  const dataTransfer = createDataTransferStub();
  dispatchDragEvent(draftButton, 'dragstart', { dataTransfer });

  assert.equal(dataTransfer.setDragImageCalls.length, 1);
  assert.equal(dataTransfer.setDragImageCalls[0]?.x, 0);
  assert.equal(dataTransfer.setDragImageCalls[0]?.y, 13);

  const previewElement = document.body.querySelector('.editor-tab-drag-preview');
  assert(previewElement instanceof HTMLDivElement);
  assert.equal(
    (dataTransfer.setDragImageCalls[0]?.element as Element | undefined)?.classList.contains(
      'editor-tab-drag-preview',
    ),
    true,
  );

  dispatchDragEvent(draftTab, 'dragend', { dataTransfer });
  assert.equal(document.body.querySelector('.editor-tab-drag-preview'), null);

  control.dispose();
});

test('TabsTitleControl clears hovered state after drag ends', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onReorderTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);
  const draftTab = container.children[0];
  const draftButton = draftTab?.querySelector('.editor-tab-main');
  assert(draftTab instanceof HTMLElement);
  assert(draftButton instanceof HTMLButtonElement);

  draftTab.dispatchEvent(new Event('pointerenter', { bubbles: true }));
  assert.equal(draftTab.dataset.hovered, 'true');

  const dataTransfer = createDataTransferStub();
  dispatchDragEvent(draftButton, 'dragstart', { dataTransfer });
  dispatchDragEvent(draftTab, 'dragend', { dataTransfer });

  assert.equal(draftTab.dataset.hovered, undefined);

  control.dispose();
});

test('TabsTitleControl keeps one stable insertion indicator between adjacent tabs', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('pdf-c', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
      createTabItem({
        id: 'pdf-c',
        kind: 'pdf',
        label: 'PDF C',
        title: 'PDF C',
        isActive: true,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onReorderTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);
  const [draftTab, browserTab, pdfTab] = Array.from(container.children);
  const pdfButton = pdfTab?.querySelector('.editor-tab-main');
  assert(draftTab instanceof HTMLElement);
  assert(browserTab instanceof HTMLElement);
  assert(pdfTab instanceof HTMLElement);
  assert(pdfButton instanceof HTMLButtonElement);

  Object.defineProperty(draftTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 120,
      height: 26,
      right: 120,
      bottom: 26,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  Object.defineProperty(browserTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 122,
      top: 0,
      width: 120,
      height: 26,
      right: 242,
      bottom: 26,
      x: 122,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  Object.defineProperty(pdfTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 244,
      top: 0,
      width: 120,
      height: 26,
      right: 364,
      bottom: 26,
      x: 244,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });

  const dataTransfer = createDataTransferStub();
  dispatchDragEvent(pdfButton, 'dragstart', { dataTransfer });

  dispatchDragEvent(draftTab, 'dragover', {
    clientX: 120,
    dataTransfer,
  });
  assert.equal(container.classList.contains('is-drop-indicator-visible'), true);
  assert.equal(getDropIndicatorLeft(container), '121px');

  dispatchDragEvent(browserTab, 'dragover', {
    clientX: 122,
    dataTransfer,
  });
  assert.equal(container.classList.contains('is-drop-indicator-visible'), true);
  assert.equal(getDropIndicatorLeft(container), '121px');

  dispatchDragEvent(pdfTab, 'dragend', { dataTransfer });
  assert.equal(container.classList.contains('is-drop-indicator-visible'), false);

  control.dispose();
});

test('TabsTitleControl keeps the same drop side for small cursor moves near a tab midpoint', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onReorderTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);
  const [draftTab, browserTab] = Array.from(container.children);
  const draftButton = draftTab?.querySelector('.editor-tab-main');
  assert(draftTab instanceof HTMLElement);
  assert(browserTab instanceof HTMLElement);
  assert(draftButton instanceof HTMLButtonElement);

  Object.defineProperty(browserTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 100,
      top: 0,
      width: 120,
      height: 26,
      right: 220,
      bottom: 26,
      x: 100,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });

  const dataTransfer = createDataTransferStub();
  dispatchDragEvent(draftButton, 'dragstart', { dataTransfer });

  dispatchDragEvent(browserTab, 'dragover', {
    clientX: 159,
    dataTransfer,
  });
  assert.equal(getDropIndicatorLeft(container), '100px');

  dispatchDragEvent(browserTab, 'dragover', {
    clientX: 161,
    dataTransfer,
  });
  assert.equal(getDropIndicatorLeft(container), '100px');

  dispatchDragEvent(draftTab, 'dragend', { dataTransfer });
  control.dispose();
});

test('TabsTitleControl supports dropping a tab after the last tab from container trailing space', () => {
  const reorderCalls: Array<[string, string, 'before' | 'after']> = [];
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
      createTabItem({
        id: 'pdf-c',
        kind: 'pdf',
        label: 'PDF C',
        title: 'PDF C',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onReorderTab: (tabId, targetTabId, position) => {
      reorderCalls.push([tabId, targetTabId, position]);
    },
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const [draftTab, browserTab, pdfTab] = Array.from(container.children);
  const draftButton = draftTab?.querySelector('.editor-tab-main');
  assert(draftButton instanceof HTMLButtonElement);

  Object.defineProperty(draftTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 0,
      top: 0,
      width: 120,
      height: 26,
      right: 120,
      bottom: 26,
      x: 0,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  Object.defineProperty(browserTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 122,
      top: 0,
      width: 120,
      height: 26,
      right: 242,
      bottom: 26,
      x: 122,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });
  Object.defineProperty(pdfTab, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({
      left: 244,
      top: 0,
      width: 120,
      height: 26,
      right: 364,
      bottom: 26,
      x: 244,
      y: 0,
      toJSON() {
        return {};
      },
    }),
  });

  const dataTransfer = createDataTransferStub();
  dispatchDragEvent(draftButton, 'dragstart', { dataTransfer });
  const dragOverEvent = dispatchDragEvent(container, 'dragover', {
    clientX: 420,
    dataTransfer,
  });
  assert.equal(dragOverEvent.defaultPrevented, true);
  assert.equal(container.classList.contains('is-drop-indicator-visible'), true);
  assert.equal(getDropIndicatorLeft(container), '364px');

  dispatchDragEvent(container, 'drop', {
    clientX: 420,
    dataTransfer,
  });

  assert.deepEqual(reorderCalls, [['draft-a', 'pdf-c', 'after']]);
  assert.equal(container.classList.contains('is-drop-indicator-visible'), false);

  control.dispose();
});

test('TabsTitleControl replaces browser pane icon with favicon when available', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('browser-a', [
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'Browser',
        title: 'Browser',
        faviconUrl: 'https://example.com/favicon.ico',
        isActive: true,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const iconContainer = container.children[0]?.querySelector('.editor-tab-icon');
  assert(iconContainer instanceof HTMLElement);
  const favicon = iconContainer.querySelector('.editor-tab-favicon');
  assert(favicon instanceof HTMLElement);
  assert.equal(favicon.tagName, 'IMG');
  assert.equal(favicon.getAttribute('src'), 'https://example.com/favicon.ico');

  favicon.dispatchEvent(new Event('error'));
  const fallbackIcon = iconContainer.querySelector('.lx-icon');
  assert(fallbackIcon instanceof HTMLElement);
  assert.equal(fallbackIcon.classList.contains('lx-icon-browser-1'), true);

  control.dispose();
});

test('TabsTitleControl renders unsave for dirty closable tabs and close for clean tabs', () => {
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
        isClosable: true,
        isDirty: true,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const getCloseActionIcon = () =>
    container.children[0]?.querySelector('.editor-tab-close-btn.actionbar-action .lx-icon');

  assert.equal(getCloseActionIcon()?.classList.contains('lx-icon-unsave'), true);
  assert.equal(getCloseActionIcon()?.classList.contains('lx-icon-close'), false);

  control.setProps({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
        isClosable: true,
        isDirty: false,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });

  assert.equal(getCloseActionIcon()?.classList.contains('lx-icon-unsave'), false);
  assert.equal(getCloseActionIcon()?.classList.contains('lx-icon-close'), true);

  control.dispose();
});

test('TabsTitleControl reveals the active tab when the strip overflows', async () => {
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
      }),
      createTabItem({
        id: 'pdf-c',
        kind: 'pdf',
        label: 'PDF C',
        title: 'PDF C',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  let scrollLeft = 0;
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    get: () => 160,
  });
  Object.defineProperty(container, 'scrollWidth', {
    configurable: true,
    get: () => 360,
  });
  Object.defineProperty(container, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });

  const [firstTab, secondTab, thirdTab] = Array.from(container.children);
  for (const [element, offsetLeft, offsetWidth] of [
    [firstTab, 0, 96],
    [secondTab, 96, 120],
    [thirdTab, 216, 120],
  ] as const) {
    Object.defineProperty(element, 'offsetLeft', {
      configurable: true,
      get: () => offsetLeft,
    });
    Object.defineProperty(element, 'offsetWidth', {
      configurable: true,
      get: () => offsetWidth,
    });
  }

  control.setProps({
    group: createGroupModel('pdf-c', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
      }),
      createTabItem({
        id: 'browser-b',
        kind: 'browser',
        label: 'Web B',
        title: 'Web B',
        isDirty: true,
        hasLocalHistory: true,
      }),
      createTabItem({
        id: 'pdf-c',
        kind: 'pdf',
        label: 'PDF C',
        title: 'PDF C',
        isActive: true,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });

  await waitForAnimationFrame();

  assert.equal(scrollLeft, 176);
  assert.equal(container.classList.contains('is-overflowing'), true);
  assert.equal(container.classList.contains('is-scroll-end'), true);
  assert.equal(secondTab.classList.contains('is-dirty'), true);

  control.dispose();
});

test('TabsTitleControl keeps scroll position stable for metadata-only active tab updates', async () => {
  const control = new TabsTitleControl({
    group: createGroupModel('browser-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
      }),
      createTabItem({
        id: 'pdf-a',
        kind: 'pdf',
        label: 'Paper.pdf',
        title: 'Paper.pdf',
      }),
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'New Tab',
        title: 'New Tab',
        isActive: true,
        isClosable: false,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  let scrollLeft = 106;
  let scrollWidth = 266;
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    get: () => 160,
  });
  Object.defineProperty(container, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(container, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });

  const [firstTab, secondTab, thirdTab] = Array.from(container.children);
  const setTabMetrics = (
    metrics: ReadonlyArray<readonly [Element, number, number]>,
  ) => {
    for (const [element, offsetLeft, offsetWidth] of metrics) {
      Object.defineProperty(element, 'offsetLeft', {
        configurable: true,
        get: () => offsetLeft,
      });
      Object.defineProperty(element, 'offsetWidth', {
        configurable: true,
        get: () => offsetWidth,
      });
    }
  };

  setTabMetrics([
    [firstTab, 0, 120],
    [secondTab, 120, 120],
    [thirdTab, 240, 26],
  ]);

  await waitForAnimationFrame();
  assert.equal(scrollLeft, 106);

  control.setProps({
    group: createGroupModel('browser-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
      }),
      createTabItem({
        id: 'pdf-a',
        kind: 'pdf',
        label: 'Paper.pdf',
        title: 'Paper.pdf',
      }),
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'example.com/article',
        title: 'example.com/article',
        isActive: true,
        isClosable: true,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });

  scrollWidth = 420;
  setTabMetrics([
    [firstTab, 0, 120],
    [secondTab, 120, 120],
    [thirdTab, 240, 180],
  ]);

  await waitForAnimationFrame();

  assert.equal(scrollLeft, 106);

  control.dispose();
});

test('TabsTitleControl keeps scroll position stable when an empty browser tab gains a title', async () => {
  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
      }),
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'New Tab',
        title: 'New Tab',
      }),
      createTabItem({
        id: 'pdf-a',
        kind: 'pdf',
        label: 'Paper.pdf',
        title: 'Paper.pdf',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  let scrollLeft = 12;
  let scrollWidth = 266;
  Object.defineProperty(container, 'clientWidth', {
    configurable: true,
    get: () => 160,
  });
  Object.defineProperty(container, 'scrollWidth', {
    configurable: true,
    get: () => scrollWidth,
  });
  Object.defineProperty(container, 'scrollLeft', {
    configurable: true,
    get: () => scrollLeft,
    set: (value: number) => {
      scrollLeft = value;
    },
  });

  const [draftTab, browserTab, pdfTab] = Array.from(container.children);
  const setTabMetrics = (
    metrics: ReadonlyArray<readonly [Element, number, number]>,
  ) => {
    for (const [element, offsetLeft, offsetWidth] of metrics) {
      Object.defineProperty(element, 'offsetLeft', {
        configurable: true,
        get: () => offsetLeft,
      });
      Object.defineProperty(element, 'offsetWidth', {
        configurable: true,
        get: () => offsetWidth,
      });
    }
  };

  setTabMetrics([
    [draftTab, 0, 120],
    [browserTab, 120, 26],
    [pdfTab, 146, 120],
  ]);

  control.setProps({
    group: createGroupModel('browser-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
      }),
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'New Tab',
        title: 'New Tab',
        isActive: true,
      }),
      createTabItem({
        id: 'pdf-a',
        kind: 'pdf',
        label: 'Paper.pdf',
        title: 'Paper.pdf',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });

  scrollWidth = 420;
  setTabMetrics([
    [draftTab, 0, 120],
    [browserTab, 120, 180],
    [pdfTab, 300, 120],
  ]);

  control.setProps({
    group: createGroupModel('browser-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
      }),
      createTabItem({
        id: 'browser-a',
        kind: 'browser',
        label: 'example.com/article',
        title: 'example.com/article',
        isActive: true,
        isClosable: true,
      }),
      createTabItem({
        id: 'pdf-a',
        kind: 'pdf',
        label: 'Paper.pdf',
        title: 'Paper.pdf',
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });

  await waitForAnimationFrame();

  assert.equal(scrollLeft, 12);

  control.dispose();
});

test('TabsTitleControl disconnects resize observers on dispose', () => {
  const resizeObserverSpy = installResizeObserverSpy();

  try {
    const control = new TabsTitleControl({
      group: createGroupModel('draft-a', [
        createTabItem({
          id: 'draft-a',
          kind: 'draft',
          label: 'Draft A',
          title: 'Draft A',
          isActive: true,
        }),
      ]),
      labels: {
        close: 'Close',
      },
      onActivateTab: () => {},
      onCloseTab: () => {},
      onOpenPaneMode: () => {},
    });
    document.body.append(control.getElement());

    assert.equal(resizeObserverSpy.getActiveObservers(), 2);

    control.dispose();

    assert.equal(resizeObserverSpy.getActiveObservers(), 0);
  } finally {
    resizeObserverSpy.restore();
    document.body.replaceChildren();
  }
});

test('TabsTitleControl opens a context menu with close, close others, close all, and rename actions', () => {
  const closedTabIds: string[] = [];
  const closeOtherTabIds: string[] = [];
  const renamedTabIds: string[] = [];
  let closeAllCount = 0;
  const contextMenuSpy = createContextMenuServiceSpy();
  const control = new TabsTitleControl(
    {
      group: createGroupModel('browser-a', [
        createTabItem({
          id: 'draft-a',
          kind: 'draft',
          label: 'Draft A',
          title: 'Draft A',
        }),
        createTabItem({
          id: 'browser-a',
          kind: 'browser',
          label: 'Browser A',
          title: 'Browser A',
          isActive: true,
          isClosable: true,
        }),
        createTabItem({
          id: 'pdf-a',
          kind: 'pdf',
          label: 'Paper.pdf',
          title: 'Paper.pdf',
        }),
      ]),
      labels: {
        close: 'Close',
        closeOthers: 'Close Others',
        closeAll: 'Close All',
        rename: 'Rename',
      },
      onActivateTab: () => {},
      onCloseTab: (tabId) => {
        closedTabIds.push(tabId);
      },
      onCloseOtherTabs: (tabId) => {
        closeOtherTabIds.push(tabId);
      },
      onCloseAllTabs: () => {
        closeAllCount += 1;
      },
      onRenameTab: (tabId) => {
        renamedTabIds.push(tabId);
      },
      onOpenPaneMode: () => {},
    },
    {
      contextMenuService: contextMenuSpy.contextMenuService,
    },
  );
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  const browserTab = container.children[1];
  const contextMenuEvent = new MouseEvent('contextmenu', {
    bubbles: true,
    cancelable: true,
    clientX: 24,
    clientY: 36,
  });
  browserTab?.dispatchEvent(contextMenuEvent);

  assert.equal(contextMenuEvent.defaultPrevented, true);
  assert.equal(contextMenuSpy.delegates.length, 1);
  const delegate = contextMenuSpy.delegates[0];

  assert.deepEqual(
    delegate.getActions().map((action) => action.value),
    ['close', 'close-others', 'close-all', 'rename'],
  );
  assert.deepEqual(
    delegate.getActions().map((action) => action.label),
    ['Close', 'Close Others', 'Close All', 'Rename'],
  );
  assert.deepEqual(delegate.getAnchor(), {
    x: 24,
    y: 36,
    width: 0,
    height: 0,
  });
  assert.equal(delegate.getMenuData?.(), 'editor-tab-context');

  delegate.onSelect?.('close');
  delegate.onSelect?.('close-others');
  delegate.onSelect?.('close-all');
  delegate.onSelect?.('rename');

  assert.deepEqual(closedTabIds, ['browser-a']);
  assert.deepEqual(closeOtherTabIds, ['browser-a']);
  assert.equal(closeAllCount, 1);
  assert.deepEqual(renamedTabIds, ['browser-a']);

  control.dispose();
});

test('TabsTitleControl renders its DOM context menu below the cursor for available tabs near the top edge', async () => {
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 300,
  });

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('editor-tab-main')) {
      return {
        x: 40,
        y: 5,
        width: 80,
        height: 26,
        top: 5,
        left: 40,
        right: 120,
        bottom: 31,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    if (this.classList.contains('ls-menu')) {
      return {
        x: 0,
        y: 0,
        width: 160,
        height: 120,
        top: 0,
        left: 0,
        right: 160,
        bottom: 120,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const control = new TabsTitleControl({
    group: createGroupModel('draft-a', [
      createTabItem({
        id: 'draft-a',
        kind: 'draft',
        label: 'Draft A',
        title: 'Draft A',
        isActive: true,
        isClosable: true,
      }),
    ]),
    labels: {
      close: 'Close',
    },
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenPaneMode: () => {},
  });
  const rootElement = control.getElement();
  document.body.append(rootElement);
  const container = getTabsContainer(rootElement);

  try {
    const tab = container.querySelector('.editor-tab');
    assert(tab instanceof HTMLElement);
    const button = tab.querySelector('.editor-tab-main');
    assert(button instanceof HTMLButtonElement);

    const buttonRect = button.getBoundingClientRect();
    const clientX = Math.round(buttonRect.left + buttonRect.width / 2);
    const clientY = Math.round(buttonRect.bottom - 2);
    const contextMenuEvent = new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 2,
      buttons: 2,
    });

    tab.dispatchEvent(contextMenuEvent);
    await waitForAnimationFrame();
    await waitForAnimationFrame();

    const contextView = document.body.querySelector('.ls-context-view');
    const menu = document.body.querySelector('.ls-context-view .ls-menu');
    assert(contextView instanceof HTMLElement);
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'editor-tab-context');
    assert.equal(contextView.classList.contains('bottom'), true);
    assert.equal(contextView.classList.contains('top'), false);
    assert.equal(menu.classList.contains('dropdown-menu-bottom'), true);
    assert.equal(menu.classList.contains('dropdown-menu-top'), false);

    const contextViewTop = Number.parseFloat(contextView.style.top);
    assert.equal(Number.isFinite(contextViewTop), true);
    assert.equal(contextViewTop >= clientY, true);
  } finally {
    control.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
  }
});
