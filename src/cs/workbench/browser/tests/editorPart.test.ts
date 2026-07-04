import assert from 'node:assert/strict';
import test, { after, beforeEach } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createWritingEditorDocumentFromPlainText } from 'cs/editor/common/writingEditorDocument';
import en from 'language/locales/en.json';
import { EMPTY_PDF_TAB_URL } from 'cs/workbench/browser/parts/editor/editorInput';
import type {
  EditorPartBaseProps,
  EditorPartProps,
} from 'cs/workbench/browser/parts/editor/editorPartView';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { INativeHostService } from 'cs/platform/native/common/native';

const domEnvironment = installDomTestEnvironment();

const defaultViewPartProps: ViewPartProps = {
  browserUrl: '',
  electronRuntime: false,
  webContentRuntime: false,
  labels: {
    emptyState: 'Empty',
    contentUnavailable: 'Unavailable',
  },
};

function createNativeHostService(): INativeHostService {
  return {
    _serviceBrand: undefined,
    canInvoke: () => false,
    invoke: (async () => undefined) as INativeHostService['invoke'],
    ipc: undefined,
    windowControls: undefined,
    webContent: undefined,
    fetch: undefined,
    document: undefined,
    toast: undefined,
  };
}

beforeEach(() => {
  window.localStorage.clear();
  document.body.replaceChildren();
});

function waitForNextTask() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function withBrowserToolbarActions(
  props: EditorPartBaseProps,
  options: {
    onNavigateToUrl?: (url: string) => void;
  } = {},
): EditorPartProps {
  return {
    ...props,
    onOpenAddressBarSourceMenu: () => {},
    onToolbarNavigateBack: () => {},
    onToolbarNavigateForward: () => {},
    onToolbarNavigateRefresh: () => {},
    onToolbarArchiveCurrentPage: () => {},
    onToolbarHardReload: () => {},
    onToolbarCopyCurrentUrl: () => {},
    onToolbarClearBrowsingHistory: () => {},
    onToolbarClearCookies: () => {},
    onToolbarClearCache: () => {},
    onToolbarAddressChange: () => {},
    onToolbarAddressSubmit: () => {},
    onToolbarNavigateToUrl: options.onNavigateToUrl ?? (() => {}),
  };
}

after(() => {
  domEnvironment.cleanup();
});

test('EditorPartController creates a new browser tab as an empty about:blank tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: 'https://example.com/articles/current',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  await Promise.resolve(controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
  }));

  const browserTab = controller
    .getSnapshot()
    .tabs.find((tab) => tab.kind === 'browser');
  assert(browserTab);
  assert.equal(browserTab.url, 'about:blank');
  assert.equal(controller.getSnapshot().activeTab?.id, browserTab.id);

  controller.dispose();
});

test('EditorPartController keeps browser tab creation empty even without an available URL', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: '',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  await Promise.resolve(controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
  }));

  const browserTab = controller
    .getSnapshot()
    .tabs.find((tab) => tab.kind === 'browser');
  assert(browserTab);
  assert.equal(browserTab.url, 'about:blank');
  assert.equal(controller.getSnapshot().activeTab?.id, browserTab.id);

  controller.dispose();
});

test('EditorPartController opens the browser pane as an empty about:blank tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: 'https://example.com/articles/current',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
  });

  const browserTab = controller
    .getSnapshot()
    .tabs.find((tab) => tab.kind === 'browser');
  assert(browserTab);
  assert.equal(browserTab.url, 'about:blank');
  assert.equal(controller.getSnapshot().activeTab?.id, browserTab.id);

  controller.dispose();
});

test('EditorPartController reuses an existing empty draft tab for explicit draft creation', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: '',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  const initialDraftTabId = controller.getSnapshot().activeTab?.id ?? null;
  controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'draft',
    disposition: 'reveal-or-open',
  });

  const draftTabs = controller
    .getSnapshot()
    .tabs.filter((tab) => tab.kind === 'draft');
  assert.equal(draftTabs.length, 1);
  assert.equal(controller.getSnapshot().activeTab?.id, initialDraftTabId);

  controller.dispose();
});

test('EditorPartController creates a new draft tab when the reusable draft is dirty', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: '',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  const initialDraftTabId = controller.getSnapshot().activeTab?.id ?? null;
  controller.setDraftDocument(createWritingEditorDocumentFromPlainText('dirty'));
  controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'draft',
    disposition: 'reveal-or-open',
  });

  const draftTabs = controller
    .getSnapshot()
    .tabs.filter((tab) => tab.kind === 'draft');
  assert.equal(draftTabs.length, 2);
  assert.notEqual(controller.getSnapshot().activeTab?.id, initialDraftTabId);

  controller.dispose();
});

test('EditorPartController reuses an existing empty browser tab for explicit browser creation', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: '',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
  });
  await Promise.resolve(controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
  }));

  const browserTabs = controller
    .getSnapshot()
    .tabs.filter((tab) => tab.kind === 'browser');
  assert.equal(browserTabs.length, 1);
  assert.equal(browserTabs[0]?.url, 'about:blank');
  assert.equal(controller.getSnapshot().activeTab?.id, browserTabs[0]?.id);

  controller.dispose();
});

test('EditorPartController opens the pdf pane as an empty tab without prompting for a URL', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: 'https://example.com/articles/current',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  await Promise.resolve(controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'pdf',
    disposition: 'reveal-or-open',
  }));

  const pdfTab = controller
    .getSnapshot()
    .tabs.find((tab) => tab.kind === 'pdf');
  assert(pdfTab);
  assert.equal(pdfTab.url, EMPTY_PDF_TAB_URL);
  assert.equal(controller.getSnapshot().activeTab?.id, pdfTab.id);
  assert.equal(document.querySelectorAll('.workbench-editor-modal-panel').length, 0);

  controller.dispose();
});

test('EditorPartController keeps browser pane active as about:blank when closing the last browser tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: '',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  controller.createBrowserTab('https://example.com/article');
  const browserTab = controller
    .getSnapshot()
    .tabs.find((tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article');
  assert(browserTab);

  await controller.onCloseTab(browserTab.id);

  const snapshot = controller.getSnapshot();
  const browserTabs = snapshot.tabs.filter((tab) => tab.kind === 'browser');
  assert.equal(browserTabs.length, 1);
  assert.equal(browserTabs[0]?.url, 'about:blank');
  assert.equal(browserTabs[0]?.title, '');
  assert.equal(snapshot.activeTab?.id, browserTabs[0]?.id);
  assert.equal(snapshot.activeTab?.kind, 'browser');

  controller.dispose();
});

test('EditorPartController opens a browser favorite in a new tab without reusing the existing url tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: '',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  controller.createBrowserTab('https://example.com/article');
  controller
    .getSnapshot()
    .editorPartProps
    .onOpenEditor({
      kind: 'browser',
      disposition: 'new-tab',
      url: 'https://example.com/article',
    });

  const browserTabs = controller
    .getSnapshot()
    .tabs
    .filter((tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article');
  assert.equal(browserTabs.length, 2);
  assert.equal(controller.getSnapshot().activeTab?.id, browserTabs[1]?.id);

  controller.dispose();
});

test('EditorPartView favorite context menu opens a fresh browser tab instead of navigating the current tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const { createEditorPartView } = await import(
    'cs/workbench/browser/parts/editor/editorPartView'
  );
  const favoriteUrl = 'https://example.com/favorites/open-in-new-tab';
  const navigateCalls: string[] = [];
  const controller = new EditorPartController({
    ui: en,
    browserUrl: favoriteUrl,
    webUrl: favoriteUrl,
    viewPartProps: {
      ...defaultViewPartProps,
      browserUrl: favoriteUrl,
      browserPageTitle: 'Favorite Open In New Tab',
      browserFaviconUrl: 'https://example.com/favicon.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
    nativeHost: createNativeHostService(),
  });

  controller.createBrowserTab(favoriteUrl);
  const view = createEditorPartView(withBrowserToolbarActions(
    controller.getSnapshot().editorPartProps,
    {
      onNavigateToUrl: (url) => {
        navigateCalls.push(url);
      },
    },
  ));
  const unsubscribe = controller.subscribe(() => {
    view.setProps(withBrowserToolbarActions(
      controller.getSnapshot().editorPartProps,
      {
        onNavigateToUrl: (url) => {
          navigateCalls.push(url);
        },
      },
    ));
  });
  document.body.append(view.getElement());

  try {
    const favoriteButton = view
      .getElement()
      .querySelector(`.editor-browser-toolbar-leading [aria-label="${en.agentbarToolbarFavorite}"]`);
    assert(favoriteButton instanceof HTMLButtonElement);
    favoriteButton.click();

    const sourcesButton = view
      .getElement()
      .querySelector(`.editor-browser-toolbar-leading [aria-label="${en.agentbarToolbarSources}"]`);
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await waitForNextTask();
    await waitForNextTask();

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    const favoriteItem = panel.querySelector(
      `.editor-browser-library-item.is-favorite[title="${favoriteUrl}"]`,
    );
    assert(favoriteItem instanceof HTMLButtonElement);
    favoriteItem.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 24,
      clientY: 24,
    }));
    await waitForNextTask();

    const menu = document.body.querySelector(
      '.dropdown-menu[data-menu="editor-browser-library-favorite-item"]',
    );
    assert(menu instanceof HTMLElement);
    const openInNewTabItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.trim() === en.editorFavoriteContextOpenInNewTab,
    );
    assert(openInNewTabItem instanceof HTMLElement);
    openInNewTabItem.click();
    await waitForNextTask();

    const matchingBrowserTabs = controller
      .getSnapshot()
      .tabs
      .filter((tab) => tab.kind === 'browser' && tab.url === favoriteUrl);
    assert.equal(navigateCalls.length, 0);
    assert.equal(matchingBrowserTabs.length, 2);
    assert.equal(
      controller.getSnapshot().activeTab?.id,
      matchingBrowserTabs[1]?.id,
    );
  } finally {
    unsubscribe();
    view.dispose();
    controller.dispose();
  }
});

test('EditorPartController serializes close requests while unsaved confirm is open', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    browserUrl: '',
    webUrl: '',
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
  });

  const activeDraftTab = controller
    .getSnapshot()
    .activeTab;
  assert(activeDraftTab?.kind === 'draft');
  controller.setDraftDocument(createWritingEditorDocumentFromPlainText('dirty'));

  const firstClose = controller.onCloseTab(activeDraftTab.id);
  const secondClose = controller.onCloseTab(activeDraftTab.id);

  await Promise.resolve();
  assert.equal(document.querySelectorAll('.workbench-editor-modal-panel').length, 1);

  const discardButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.workbench-editor-modal-actions button',
    ),
  ).find(
    (button) => button.textContent?.trim() === en.editorUnsavedChangesDiscard,
  );
  assert(discardButton instanceof HTMLButtonElement);
  discardButton.click();

  const [didCloseFirst, didCloseSecond] = await Promise.all([
    firstClose,
    secondClose,
  ]);
  assert.equal(didCloseFirst, true);
  assert.equal(didCloseSecond, false);
  assert.equal(document.querySelectorAll('.workbench-editor-modal-panel').length, 0);

  controller.dispose();
});
