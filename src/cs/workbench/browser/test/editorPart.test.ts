import assert from 'node:assert/strict';
import test, { after, afterEach, before, beforeEach } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createWritingEditorDocumentFromPlainText } from 'cs/editor/common/writingEditorDocument';
import en from 'language/locales/en.json';
import { EMPTY_PDF_TAB_URL } from 'cs/workbench/browser/parts/editor/editorInput';
import { generateUuid } from 'cs/base/common/uuid';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { Schemas } from 'cs/base/common/network';
import type { URI } from 'cs/base/common/uri';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { EditorResolverService } from 'cs/workbench/services/editor/browser/editorResolverService';
import { RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import type {
  EditorPartBaseProps,
  EditorPartProps,
} from 'cs/workbench/browser/parts/editor/editorPartView';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';

const domEnvironment = installDomTestEnvironment();
let dropdownServices: Awaited<ReturnType<typeof createDropdownTestServices>>;
let BrowserDialogService: typeof import('cs/workbench/services/dialogs/browser/dialogService').BrowserDialogService;

class TestBrowserEditorInput extends EditorInput {
  constructor(
    readonly resource: URI,
  ) {
    super();
  }

  get typeId(): string {
    return 'workbench.editorinputs.browser';
  }
}

const defaultViewPartProps: ViewPartProps = {
  browserUrl: '',
  electronRuntime: false,
  webContentRuntime: false,
  labels: {
    emptyState: 'Empty',
    contentUnavailable: 'Unavailable',
    overlayPauseHeading: 'Paused',
    overlayPauseDetail: 'Dismiss',
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
    document: undefined,
  };
}

function createDialogService() {
  return new BrowserDialogService();
}

function createTestInstantiationService() {
  return new InstantiationService(new ServiceCollection());
}

function createBrowserEditorResolverService() {
  const editorResolverService = new EditorResolverService();
  editorResolverService.registerEditor(
    `${Schemas.vscodeBrowser}:/**`,
    {
      id: 'workbench.editor.browser',
      label: 'Browser',
      priority: RegisteredEditorPriority.exclusive,
    },
    {
      canSupportResource: resource => resource.scheme === Schemas.vscodeBrowser,
      singlePerResource: true,
    },
    {
      createEditorInput: ({ resource, options }) => ({
        editor: new TestBrowserEditorInput(resource),
        options,
      }),
    },
  );
  return editorResolverService;
}

beforeEach(async () => {
  window.localStorage.clear();
  document.body.replaceChildren();
  dropdownServices = await createDropdownTestServices();
});

afterEach(() => {
  dropdownServices.dispose();
});

before(async () => {
  ({ BrowserDialogService } = await import('cs/workbench/services/dialogs/browser/dialogService'));
});

function waitForNextTask() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function withBrowserToolbarActions(
  props: EditorPartBaseProps,
): EditorPartProps {
  return {
    ...dropdownServices,
    ...props,
    onOpenAddressBarSourceMenu: () => {},
    onToolbarArchiveCurrentPage: () => {},
    onToolbarCopyCurrentUrl: () => {},
    onToolbarClearBrowsingHistory: () => {},
    onToolbarClearCookies: () => {},
    onToolbarClearCache: () => {},
  };
}

after(() => {
  domEnvironment.cleanup();
});

test('EditorPartController creates a new browser tab as an empty about:blank tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
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
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
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
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
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

test('EditorPartController creates a draft tab from the empty workspace', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
  });

  assert.equal(controller.getSnapshot().activeTab, null);
  controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'draft',
    disposition: 'reveal-or-open',
  });

  const draftTabs = controller
    .getSnapshot()
    .tabs.filter((tab) => tab.kind === 'draft');
  assert.equal(draftTabs.length, 1);
  assert.equal(controller.getSnapshot().activeTab?.id, draftTabs[0]?.id);

  controller.dispose();
});

test('EditorPartController creates a new draft tab when the reusable draft is dirty', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
  });

  controller.getSnapshot().editorPartProps.onOpenEditor({
    kind: 'draft',
    disposition: 'reveal-or-open',
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
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
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
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
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
  assert.equal(document.querySelectorAll('.comet-dialog-box').length, 0);

  controller.dispose();
});

test('EditorPartController returns to the empty workspace after closing the last browser tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
  });

  controller.openEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
    options: {
      viewState: {
        url: 'https://example.com/article',
      },
    },
  });
  const browserTab = controller
    .getSnapshot()
    .tabs.find((tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article');
  assert(browserTab);

  await controller.onCloseTab(browserTab.id);

  const snapshot = controller.getSnapshot();
  assert.deepEqual(snapshot.tabs, []);
  assert.equal(snapshot.activeTabId, null);
  assert.equal(snapshot.activeTab, null);

  controller.dispose();
});

test('EditorPartController opens a browser favorite in a new tab without reusing the existing url tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
  });

  controller.openEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
    options: {
      viewState: {
        url: 'https://example.com/article',
      },
    },
  });
  const newTabResource = BrowserViewUri.forId(generateUuid());
  controller
    .getSnapshot()
    .editorPartProps
    .onOpenEditor({
      kind: 'browser',
      disposition: 'new-tab',
      resource: newTabResource,
      options: {
        viewState: {
          url: 'https://example.com/article',
        },
      },
    });

  const browserTabs = controller
    .getSnapshot()
    .tabs
    .filter((tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article');
  assert.equal(browserTabs.length, 2);
  assert.equal(controller.getSnapshot().activeTab?.id, browserTabs[1]?.id);
  assert.equal(browserTabs[1]?.id, BrowserViewUri.getId(newTabResource));

  controller.dispose();
});

test('EditorPartController opens a browser URL in a new tab', async () => {
  const { EditorPartController } = await import('cs/workbench/browser/parts/editor/editorPart');
  const controller = new EditorPartController({
    ui: en,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
  });
  const url = 'https://example.com/chat-link';
  const resource = BrowserViewUri.forId(generateUuid());

  controller.openEditor({
    kind: 'browser',
    disposition: 'new-tab',
    resource,
    options: {
      viewState: {
        url,
      },
    },
  });

  const browserTab = controller
    .getSnapshot()
    .tabs
    .find((tab) => tab.kind === 'browser' && tab.url === url);
  assert(browserTab);
  assert.equal(controller.getSnapshot().activeTab?.id, browserTab.id);
  assert.equal(browserTab.id, BrowserViewUri.getId(resource));

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
    viewPartProps: {
      ...defaultViewPartProps,
      browserUrl: favoriteUrl,
      browserPageTitle: 'Favorite Open In New Tab',
      browserFaviconUrl: 'https://example.com/favicon.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
  });

  controller.openEditor({
    kind: 'browser',
    disposition: 'reveal-or-open',
    options: {
      viewState: {
        url: favoriteUrl,
      },
    },
  });
  const view = createEditorPartView(withBrowserToolbarActions(
    controller.getSnapshot().editorPartProps,
  ));
  const unsubscribe = controller.subscribe(() => {
    view.setProps(withBrowserToolbarActions(
      controller.getSnapshot().editorPartProps,
    ));
  });
  document.body.append(view.getElement());

  try {
    const favoriteButton = view
      .getElement()
      .querySelector(`.comet-editor-browser-toolbar-leading [aria-label="${en.agentbarToolbarFavorite}"]`);
    assert(favoriteButton instanceof HTMLButtonElement);
    favoriteButton.click();

    const sourcesButton = view
      .getElement()
      .querySelector(`.comet-editor-browser-toolbar-leading [aria-label="${en.agentbarToolbarSources}"]`);
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await waitForNextTask();
    await waitForNextTask();

    const panel = document.body.querySelector('.comet-browser-history-and-favorites-panel');
    assert(panel instanceof HTMLElement);
    const favoriteItem = panel.querySelector(
      `.comet-browser-history-and-favorites-item.comet-is-favorite[title="${favoriteUrl}"]`,
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
      '.dropdown-menu[data-menu="browser-history-and-favorites-favorite-item"]',
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
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    editorResolverService: createBrowserEditorResolverService(),
  });

  const activeDraftTab = controller
    .getSnapshot()
    .activeTab;
  assert(activeDraftTab?.kind === 'draft');
  controller.setDraftDocument(createWritingEditorDocumentFromPlainText('dirty'));

  const firstClose = controller.onCloseTab(activeDraftTab.id);
  const secondClose = controller.onCloseTab(activeDraftTab.id);

  await Promise.resolve();
  assert.equal(document.querySelectorAll('.comet-dialog-box').length, 1);

  const discardButton = Array.from(
    document.querySelectorAll<HTMLButtonElement>(
      '.comet-dialog-buttons button',
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
  assert.equal(document.querySelectorAll('.comet-dialog-box').length, 0);

  controller.dispose();
});
