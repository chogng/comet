import assert from 'node:assert/strict';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import type {
  ElectronAPI,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { Event as BaseEvent } from 'cs/base/common/event';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { BrowserViewStorageScope } from 'cs/platform/browserView/common/browserView';
import { BrowserHistoryStore } from 'cs/platform/browserView/common/browserHistory';
import { createWritingEditorDocumentFromPlainText } from 'cs/editor/common/writingEditorDocument';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { DEFAULT_EDITOR_GROUP_ID } from 'cs/workbench/browser/editorGroupIdentity';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import {
  BrowserViewSharingState,
  IBrowserViewWorkbenchService,
  type IBrowserEditorViewState,
  type IBrowserViewModel,
} from 'cs/workbench/contrib/browserView/common/browserView';
import {
  WEB_CONTENT_VIEW_STATE_CAPTURE_SCRIPT_MARKER,
  WEB_CONTENT_VIEW_STATE_RESTORE_SCRIPT_MARKER,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditorViewState';

let cleanupDomEnvironment: (() => void) | null = null;
let EditorGroupView: typeof import('cs/workbench/browser/parts/editor/editorGroupView').EditorGroupView;
let resolveEditorPane: typeof import('cs/workbench/browser/parts/editor/panes/editorPaneRegistry').resolveEditorPane;
let editorPaneDescriptors: typeof import('cs/workbench/browser/parts/editor/panes/editorPaneRegistry').editorPaneDescriptors;
let TextSelection: typeof import('prosemirror-state').TextSelection;
let BrowserDialogService: typeof import('cs/workbench/services/dialogs/browser/dialogService').BrowserDialogService;
let dropdownServices: DropdownContextServices & { dispose(): void };

const labels = {
  headerAddAction: 'Add',
  createDraft: 'Draft',
  createBrowser: 'Browser',
  createFile: 'File',
  toolbarSources: 'Source menu',
  toolbarBack: 'Back',
  toolbarForward: 'Forward',
  toolbarRefresh: 'Refresh',
  toolbarFavorite: 'Favorite',
  toolbarArchivePage: 'Archive page',
  toolbarExportDocx: 'Export DOCX',
  toolbarMore: 'More',
  toolbarHardReload: 'Hard reload',
  toolbarCopyCurrentUrl: 'Copy current URL',
  toolbarClearBrowsingHistory: 'Clear browsing history',
  toolbarClearCookies: 'Clear cookies',
  toolbarClearCache: 'Clear cache',
  toolbarAddressBar: 'Address bar',
  toolbarAddressPlaceholder: 'Search or enter URL',
  browserHistoryAndFavoritesPanelTitle: 'Source menu',
  browserHistoryAndFavoritesPanelRecentTitle: 'Recent',
  browserHistoryAndFavoritesPanelRecentTodayTitle: 'Today',
  browserHistoryAndFavoritesPanelRecentYesterdayTitle: 'Yesterday',
  browserHistoryAndFavoritesPanelRecentLast7DaysTitle: 'Last 7 Days',
  browserHistoryAndFavoritesPanelRecentLast30DaysTitle: 'Last 30 Days',
  browserHistoryAndFavoritesPanelRecentOlderTitle: 'Older',
  browserHistoryAndFavoritesPanelFavoritesTitle: 'Favorites',
  browserHistoryAndFavoritesPanelEmptyState: 'No links yet',
  browserHistoryAndFavoritesPanelContextOpen: 'Open',
  browserHistoryAndFavoritesPanelContextOpenInNewTab: 'Open in New Tab',
  browserHistoryAndFavoritesPanelContextRemoveFavorite: 'Remove Favorite',
  draftMode: 'Draft',
  sourceMode: 'Source',
  pdfMode: 'PDF',
  newTab: 'New Tab',
  close: 'Close',
  editorModalConfirm: 'OK',
  editorModalCancel: 'Cancel',
  expandEditor: 'Expand editor',
  collapseEditor: 'Collapse editor',
  emptyWorkspaceTitle: 'Empty workspace',
  emptyWorkspaceBody: 'Create a draft to start.',
  draftBodyPlaceholder: 'Start writing',
  pdfTitle: 'PDF',
  textGroup: 'Text',
  formatGroup: 'Format',
  insertGroup: 'Insert',
  historyGroup: 'History',
  paragraph: 'Paragraph',
  heading1: 'Heading 1',
  heading2: 'Heading 2',
  heading3: 'Heading 3',
  bold: 'Bold',
  italic: 'Italic',
  underline: 'Underline',
  fontFamily: 'Font family',
  fontSize: 'Font size',
  defaultTextStyle: 'Default',
  alignLeft: 'Align left',
  alignCenter: 'Align center',
  alignRight: 'Align right',
  clearInlineStyles: 'Clear styles',
  bulletList: 'Bullet list',
  orderedList: 'Ordered list',
  blockquote: 'Blockquote',
  undo: 'Undo',
  redo: 'Redo',
  insertCitation: 'Insert citation',
  insertFigure: 'Insert figure',
  insertFigureRef: 'Insert figure ref',
  citationPrompt: 'Citation prompt',
  figureUrlPrompt: 'Figure url prompt',
  figureCaptionPrompt: 'Figure caption prompt',
  figureRefPrompt: 'Figure ref prompt',
  fontFamilyPrompt: 'Font family prompt',
  fontSizePrompt: 'Font size prompt',
  status: {
    statusbarAriaLabel: 'Editor status',
    words: 'Words',
    characters: 'Characters',
    paragraphs: 'Paragraphs',
    selection: 'Selection',
    block: 'Block',
    line: 'Line',
    column: 'Column',
    url: 'URL',
    blockFigure: 'Figure',
    ready: 'Ready',
  },
};

const defaultViewPartProps = {
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
    canInvoke: () => typeof window.electronAPI?.invoke === 'function',
    invoke: (async (command: string, args?: Record<string, unknown>) => {
      if (!window.electronAPI?.invoke) {
        throw new Error('Desktop invoke bridge is unavailable.');
      }

      return window.electronAPI.invoke(command, args);
    }) as INativeHostService['invoke'],
    get ipc() {
      return window.electronAPI?.ipc;
    },
    get windowControls() {
      return window.electronAPI?.windowControls;
    },
    get webContent() {
      return window.electronAPI?.webContent;
    },
    get document() {
      return window.electronAPI?.document;
    },
  };
}

function createDialogService() {
  return new BrowserDialogService();
}

function createBrowserViewModel(id: string, url: string): IBrowserViewModel {
  return ({
    id,
    owner: { mainWindowId: (window as typeof window & { vscodeWindowId: number }).vscodeWindowId },
    url,
    title: '',
    favicon: undefined,
    screenshot: undefined,
    loading: false,
    focused: false,
    visible: false,
    canGoBack: false,
    canGoForward: false,
    isDevToolsOpen: false,
    error: undefined,
    certificateError: undefined,
    storageScope: BrowserViewStorageScope.Global,
    permissions: undefined,
    sharingState: BrowserViewSharingState.Unavailable,
    isRemoteSession: false,
    zoomFactor: 1,
    canZoomIn: false,
    canZoomOut: false,
    isElementSelectionActive: false,
    isAreaSelectionActive: false,
    device: undefined,
    onDidChangeSharingState: BaseEvent.None,
    onDidChangeZoom: BaseEvent.None,
    onWillNavigate: BaseEvent.None,
    onDidNavigate: BaseEvent.None,
    onDidChangeLoadingState: BaseEvent.None,
    onDidChangeFocus: BaseEvent.None,
    onDidChangeDevToolsState: BaseEvent.None,
    onDidKeyCommand: BaseEvent.None,
    onDidChangeTitle: BaseEvent.None,
    onDidChangeFavicon: BaseEvent.None,
    onDidFindInPage: BaseEvent.None,
    onDidChangeVisibility: BaseEvent.None,
    onDidClose: BaseEvent.None,
    onWillDispose: BaseEvent.None,
    onDidSelectElement: BaseEvent.None,
    onDidChangeElementSelectionActive: BaseEvent.None,
    onDidPickArea: BaseEvent.None,
    onDidChangeAreaSelectionActive: BaseEvent.None,
    onDidChangeDevice: BaseEvent.None,
    onDidChangeRemoteStatus: BaseEvent.None,
    onDidRequestPermission: BaseEvent.None,
    layout: async () => {},
    setVisible: async () => {},
    loadURL: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    reload: async () => {},
    toggleDevTools: async () => {},
    captureScreenshot: async () => {
      throw new Error('Unexpected screenshot capture in editorGroupView test.');
    },
    focus: async () => {},
    findInPage: async () => {},
    stopFindInPage: async () => {},
    getSelectedText: async () => '',
    clearStorage: async () => {},
    setSharedWithAgent: async () => false,
    trustCertificate: async () => {},
    untrustCertificate: async () => {},
    setPermissions: async () => {},
    selectDevice: async () => {},
    zoomIn: async () => {},
    zoomOut: async () => {},
    resetZoom: async () => {},
    getConsoleLogs: async () => '',
    toggleElementSelection: async () => {},
    toggleAreaSelection: async () => {},
    setDevice: async () => {},
    dispose: () => {},
  } as unknown) as IBrowserViewModel;
}

function createBrowserViewWorkbenchService(): IBrowserViewWorkbenchService {
  const inputs = new Map<string, {
    id: string;
    url: string | undefined;
    title: string | undefined;
    model: IBrowserViewModel;
    resource: ReturnType<typeof BrowserViewUri.forId>;
    resolve: () => Promise<IBrowserViewModel>;
  }>();

  return {
    _serviceBrand: undefined,
		browserHistory: new BrowserHistoryStore(Number.MAX_SAFE_INTEGER),
    onDidChangeBrowserViews: BaseEvent.None,
    onDidChangeSharingAvailable: BaseEvent.None,
    isSharingAvailable: false,
    getKnownBrowserViews: () => inputs as never,
    getContextualBrowserViews: () => inputs as never,
    registerContextualFilter: () => ({ dispose() {} }),
    registerOpenHandler: () => ({ dispose() {} }),
    getPreferredGroup: async preferredGroup => preferredGroup,
    getOrCreateLazy: (id: string, initialState: IBrowserEditorViewState = {}) => {
      let input = inputs.get(id);
      if (!input) {
        const model = createBrowserViewModel(id, initialState.url ?? '');
        input = {
          id,
          url: initialState.url,
          title: initialState.title,
          model,
          resource: BrowserViewUri.forId(id),
          resolve: async () => model,
        };
        inputs.set(id, input);
      }
      return input as never;
    },
    clearGlobalStorage: async () => {},
    clearWorkspaceStorage: async () => {},
    willUseRemoteProxy: () => false,
    setRemoteProxyInfo: () => {},
  };
}

function createTestInstantiationService() {
  return new InstantiationService(new ServiceCollection(
    [IBrowserViewWorkbenchService, createBrowserViewWorkbenchService()],
  ));
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  await import('cs/workbench/contrib/browserView/electron-browser/browserView.contribution');
  ({ EditorGroupView } = await import('cs/workbench/browser/parts/editor/editorGroupView'));
  ({ resolveEditorPane, editorPaneDescriptors } = await import(
    'cs/workbench/browser/parts/editor/panes/editorPaneRegistry'
  ));
  ({ TextSelection } = await import('prosemirror-state'));
  ({ BrowserDialogService } = await import('cs/workbench/services/dialogs/browser/dialogService'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

beforeEach(async () => {
  dropdownServices = await createDropdownTestServices();
});

afterEach(() => {
  dropdownServices.dispose();
});

function createProps(
  activeTabId: string | null,
  activeTab: import('cs/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab | null,
  tabs: import('cs/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab[],
  overrides: Partial<{
    onSetEditorViewState: (key: {
      groupId: string;
      paneId: string;
      resourceKey: string;
    }, state: unknown) => void;
    onDeleteEditorViewState: (key: {
      groupId: string;
      paneId: string;
      resourceKey: string;
    }) => void;
  }> = {},
) {
  return {
    ...dropdownServices,
    labels,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    groupId: DEFAULT_EDITOR_GROUP_ID,
    tabs,
    dirtyDraftTabIds: [],
    activeTabId,
    activeTab,
    viewStateEntries: [],
    onActivateTab: () => {},
    onCloseTab: () => {},
    onOpenEditor: () => {},
    onOpenAddressBarSourceMenu: () => {},
    onToolbarArchiveCurrentPage: () => {},
    onToolbarCopyCurrentUrl: () => {},
    onToolbarClearBrowsingHistory: () => {},
    onToolbarClearCookies: () => {},
    onToolbarClearCache: () => {},
    onDraftDocumentChange: () => {},
    onDidChangeBrowserState: () => {},
    onSetEditorViewState: () => {},
    onDeleteEditorViewState: () => {},
    ...overrides,
  };
}

function createResolverContext() {
  return {
    ...dropdownServices,
    labels,
    viewPartProps: defaultViewPartProps,
    nativeHost: createNativeHostService(),
    dialogService: createDialogService(),
    instantiationService: createTestInstantiationService(),
    onDraftDocumentChange: () => {},
    onDraftStatusChange: () => {},
    onPdfReaderStatusChange: () => {},
    onDidChangeBrowserState: () => {},
  };
}

function waitForAsyncWork() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

test('EditorGroupView forwards every layout change to the active editor pane', () => {
  const draftTab = {
    id: 'draft-layout',
    kind: 'draft' as const,
    title: 'Draft layout',
    document: createWritingEditorDocumentFromPlainText('layout'),
    viewMode: 'draft' as const,
  };
  const view = new EditorGroupView(
    createProps(draftTab.id, draftTab, [draftTab]),
  );
  document.body.append(view.getElement());

  try {
    const internals = view as unknown as {
      activePane: {
        layout: (layout: { width: number; height: number }) => void;
      } | null;
      contentElement: HTMLElement;
    };
    assert(internals.activePane);

    let contentWidth = 720;
    let contentHeight = 540;
    Object.defineProperties(internals.contentElement, {
      clientWidth: { configurable: true, get: () => contentWidth },
      clientHeight: { configurable: true, get: () => contentHeight },
    });
    const layouts: Array<{ width: number; height: number }> = [];
    internals.activePane.layout = layout => layouts.push(layout);

    view.layout(900, 600);
    contentWidth = 610;
    contentHeight = 500;
    view.layout(790, 560);

    assert.deepEqual(layouts, [
      { width: 720, height: 540 },
      { width: 610, height: 500 },
    ]);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

async function withElectronApi<T>(
  electronAPI: ElectronAPI | undefined,
  run: () => T | Promise<T>,
): Promise<T> {
  const testWindow = window as typeof window & {
    electronAPI?: ElectronAPI;
  };
  const previousElectronApi = testWindow.electronAPI;
  testWindow.electronAPI = electronAPI;

  try {
    return await run();
  } finally {
    testWindow.electronAPI = previousElectronApi;
  }
}

test('EditorGroupView recreates draft pane instances and restores view state after switching away and back', () => {
  const draftTab = {
    id: 'draft-a',
    kind: 'draft' as const,
    title: 'Draft A',
    document: createWritingEditorDocumentFromPlainText('alpha beta'),
    viewMode: 'draft' as const,
  };
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article',
  };
  const tabs = [draftTab, browserTab];

  const view = new EditorGroupView(createProps(draftTab.id, draftTab, tabs));
  document.body.append(view.getElement());

  try {
    const activePane = (view as unknown as {
      activePane: {
        editor: {
          view: import('prosemirror-view').EditorView | null;
          hostWrapperElement: HTMLElement;
        };
      } | null;
    }).activePane;
    assert(activePane);
    assert(activePane.editor.view);

    const selection = TextSelection.create(activePane.editor.view.state.doc, 1, 6);
    activePane.editor.view.dispatch(activePane.editor.view.state.tr.setSelection(selection));
    activePane.editor.hostWrapperElement.scrollTop = 48;
    activePane.editor.hostWrapperElement.dispatchEvent(new Event('scroll'));

    const initialTarget = view.getActiveDraftStableSelectionTarget();
    assert(initialTarget);
    assert.equal(initialTarget.selectedText, 'alpha');

    view.setProps(createProps(browserTab.id, browserTab, tabs));
    const browserPane = (view as unknown as {
      activePane: object | null;
    }).activePane;
    assert(browserPane);
    view.setProps(createProps(draftTab.id, draftTab, tabs));

    const restoredTarget = view.getActiveDraftStableSelectionTarget();
    assert(restoredTarget);
    assert.equal(restoredTarget.selectedText, 'alpha');

    const restoredPane = (view as unknown as {
      activePane: {
        editor: {
          hostWrapperElement: HTMLElement;
        };
      } | null;
    }).activePane;
    assert(restoredPane);
    assert.notEqual(restoredPane, activePane);
    assert.notEqual(restoredPane, browserPane);
    assert.equal(restoredPane.editor.hostWrapperElement.scrollTop, 48);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView schedules browser primary input focus when opening browser from empty workspace', () => {
  const openedRequests: Array<{ kind: string; disposition: string }> = [];
  const view = new EditorGroupView({
    ...createProps(null, null, []),
    onOpenEditor: (request) => {
      openedRequests.push({
        kind: request.kind,
        disposition: request.disposition,
      });
    },
  });
  document.body.append(view.getElement());

  try {
    assert.equal(
      view.getElement().querySelectorAll('.comet-editor-tab').length,
      0,
    );
    assert.equal(
      view.getElement().querySelectorAll('.comet-editor-empty-workspace-action').length,
      3,
    );
    const browserButton = [...view
      .getElement()
      .querySelectorAll('.comet-editor-empty-workspace-action')]
      .find((button) => button.textContent === labels.createBrowser);
    assert(browserButton instanceof HTMLButtonElement);

    browserButton.click();

    assert.deepEqual(openedRequests, [{
      kind: 'browser',
      disposition: 'reveal-or-open',
    }]);
    assert.equal(
      (view as unknown as { shouldFocusBrowserPrimaryInput: boolean })
        .shouldFocusBrowserPrimaryInput,
      true,
    );
  } finally {
    view.dispose();
  }
});

test('EditorGroupView renders an empty draft as a real editor tab', () => {
  const draftTab = {
    id: 'draft-a',
    kind: 'draft' as const,
    title: '',
    document: createWritingEditorDocumentFromPlainText(''),
    viewMode: 'draft' as const,
  };
  const view = new EditorGroupView(
    createProps(draftTab.id, draftTab, [draftTab]),
  );
  document.body.append(view.getElement());

  try {
    assert.equal(
      view.getElement().querySelectorAll('.comet-editor-tab').length,
      1,
    );
    assert.equal(
      view.getElement().querySelector('.comet-editor-empty-workspace'),
      null,
    );
    assert.equal(
      view.getElement().querySelector('.comet-editor-content')?.getAttribute('data-editor-pane'),
      'draft',
    );
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView schedules browser primary input focus when activating an empty browser tab', () => {
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: '',
    url: 'about:blank',
  };
  const activatedTabIds: string[] = [];
  const view = new EditorGroupView({
    ...createProps(null, null, [browserTab]),
    onActivateTab: (tabId) => {
      activatedTabIds.push(tabId);
    },
  });
  document.body.append(view.getElement());

  try {
    const browserButton = view
      .getElement()
      .querySelector('[data-tab-id="browser-a"] .comet-editor-tab-main');
    assert(browserButton instanceof HTMLButtonElement);

    browserButton.click();

    assert.deepEqual(activatedTabIds, ['browser-a']);
    assert.equal(
      (view as unknown as { shouldFocusBrowserPrimaryInput: boolean })
        .shouldFocusBrowserPrimaryInput,
      true,
    );
  } finally {
    view.dispose();
  }
});

test('EditorGroupView routes browser toolbar navigation through the active Browser editor pane', async () => {
  const browserTab = {
    id: 'browser-navigation',
    kind: 'browser' as const,
    title: 'Example',
    url: 'https://example.com',
  };
  const navigationCalls: Array<
    | { readonly kind: 'navigate'; readonly url: string }
    | { readonly kind: 'back' | 'forward' }
    | { readonly kind: 'reload'; readonly hard: boolean }
  > = [];
  const element = document.createElement('div');
  const descriptor = {
    paneId: 'browser' as const,
    acceptsInput: (input: { kind?: string }) => input.kind === 'browser',
    resolvePane: () => ({
      paneId: 'browser' as const,
      paneKey: 'test-browser-navigation',
      contentClassNames: ['comet-is-mode-browser'],
      createPane: () => ({
        getElement: () => element,
        getToolbarElement: () => null,
        setProps() {},
        dispose() {},
        clearInput() {},
        getViewState: () => undefined,
        captureViewState: async () => undefined,
        restoreViewState() {},
        getBrowserHistoryAndFavoritesFeatures: () => undefined,
        navigate: async (url: string) => {
          navigationCalls.push({ kind: 'navigate', url });
        },
        goBack: async () => {
          navigationCalls.push({ kind: 'back' });
        },
        goForward: async () => {
          navigationCalls.push({ kind: 'forward' });
        },
        reload: async (hard?: boolean) => {
          navigationCalls.push({ kind: 'reload', hard: Boolean(hard) });
        },
      }),
      updatePane() {},
    }),
  };
  editorPaneDescriptors.unshift(descriptor as never);
  const view = new EditorGroupView({
    ...createProps(browserTab.id, browserTab, [browserTab]),
    showToolbar: true,
  });
  document.body.append(view.getElement());

  try {
    const addressInput = view.getElement().querySelector(
      '.comet-editor-browser-toolbar-address-input input',
    );
    assert(addressInput instanceof HTMLInputElement);
    addressInput.value = 'https://example.org/next';
    addressInput.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
    }));

    for (const label of [labels.toolbarBack, labels.toolbarForward, labels.toolbarRefresh]) {
      const button = view.getElement().querySelector(`[aria-label="${label}"]`);
      assert(button instanceof HTMLButtonElement);
      button.click();
    }

    await waitForAsyncWork();
    assert.deepEqual(navigationCalls, [
      { kind: 'navigate', url: 'https://example.org/next' },
      { kind: 'back' },
      { kind: 'forward' },
      { kind: 'reload', hard: false },
    ]);
  } finally {
    view.dispose();
    editorPaneDescriptors.splice(editorPaneDescriptors.indexOf(descriptor as never), 1);
    document.body.replaceChildren();
  }
});

test('editor pane registry matches exactly one descriptor for each workspace input kind', () => {
  const draftTab = {
    id: 'draft-a',
    kind: 'draft' as const,
    title: 'Draft A',
    document: createWritingEditorDocumentFromPlainText('alpha beta'),
    viewMode: 'draft' as const,
  };
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article',
  };
  const pdfTab = {
    id: 'pdf-a',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'https://example.com/paper.pdf',
  };

  assert.deepEqual(
    editorPaneDescriptors
      .filter((descriptor) => descriptor.acceptsInput(draftTab))
      .map((descriptor) => descriptor.paneId),
    ['draft'],
  );
  assert.deepEqual(
    editorPaneDescriptors
      .filter((descriptor) => descriptor.acceptsInput(browserTab))
      .map((descriptor) => descriptor.paneId),
    ['browser'],
  );
  assert.deepEqual(
    editorPaneDescriptors
      .filter((descriptor) => descriptor.acceptsInput(pdfTab))
      .map((descriptor) => descriptor.paneId),
    ['pdf'],
  );
});

test('editor pane registry resolves pane identity and content classes from descriptors', () => {
  const draftTab = {
    id: 'draft-a',
    kind: 'draft' as const,
    title: 'Draft A',
    document: createWritingEditorDocumentFromPlainText('alpha beta'),
    viewMode: 'draft' as const,
  };
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article',
  };
  const pdfTab = {
    id: 'pdf-a',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'https://example.com/paper.pdf',
  };

  const draftPane = resolveEditorPane(draftTab, createResolverContext());
  assert.equal(draftPane.paneId, 'draft');
  assert.equal(draftPane.paneKey, 'draft:draft-a');
  assert.deepEqual(draftPane.contentClassNames, ['comet-is-mode-draft']);

  const browserPane = resolveEditorPane(browserTab, createResolverContext());
  assert.equal(browserPane.paneId, 'browser');
  assert.equal(browserPane.paneKey, 'browser');
  assert.deepEqual(browserPane.contentClassNames, ['comet-is-mode-browser']);

  const pdfPane = resolveEditorPane(pdfTab, createResolverContext());
  assert.equal(pdfPane.paneId, 'pdf');
  assert.equal(pdfPane.paneKey, 'pdf:pdf-a');
  assert.deepEqual(pdfPane.contentClassNames, ['comet-is-mode-pdf']);
});

test('EditorGroupView reports draft pane view state changes through persistence callbacks', () => {
  const draftTab = {
    id: 'draft-a',
    kind: 'draft' as const,
    title: 'Draft A',
    document: createWritingEditorDocumentFromPlainText('alpha beta'),
    viewMode: 'draft' as const,
  };
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article',
  };
  const tabs = [draftTab, browserTab];
  const persistedStates: Array<{
    key: {
      groupId: string;
      paneId: string;
      resourceKey: string;
    };
    state: unknown;
  }> = [];

  const view = new EditorGroupView({
    ...createProps(draftTab.id, draftTab, tabs, {
      onSetEditorViewState: (key, state) => {
        persistedStates.push({ key, state });
      },
    }),
  });
  document.body.append(view.getElement());

  try {
    const activePane = (view as unknown as {
      activePane: {
        editor: {
          view: import('prosemirror-view').EditorView | null;
          hostWrapperElement: HTMLElement;
        };
      } | null;
    }).activePane;
    assert(activePane);
    assert(activePane.editor.view);

    const selection = TextSelection.create(activePane.editor.view.state.doc, 1, 6);
    activePane.editor.view.dispatch(activePane.editor.view.state.tr.setSelection(selection));
    activePane.editor.hostWrapperElement.scrollTop = 48;
    activePane.editor.hostWrapperElement.dispatchEvent(new Event('scroll'));

    view.setProps(
      createProps(browserTab.id, browserTab, tabs, {
        onSetEditorViewState: (key, state) => {
          persistedStates.push({ key, state });
        },
      }),
    );

    const persistedState = persistedStates.find(
      (entry) =>
        entry.key.groupId === DEFAULT_EDITOR_GROUP_ID &&
        entry.key.paneId === 'draft' &&
        entry.key.resourceKey === `draft:${draftTab.id}`,
    );
    assert(persistedState);
    assert.deepEqual(persistedState.state, {
      scrollPosition: {
        scrollLeft: 0,
        scrollTop: 48,
      },
      selectionTarget: {
        blockId: (persistedState.state as {
          selectionTarget?: { blockId?: string };
        }).selectionTarget?.blockId,
        kind: 'paragraph',
        range: {
          startLineNumber: 1,
          startColumn: 1,
          endLineNumber: 1,
          endColumn: 6,
        },
        startOffset: 0,
        endOffset: 5,
        selectedText: 'alpha',
        blockText: 'alpha beta',
        isCollapsed: false,
        isPlainTextEditable: true,
      },
      shouldFocus: false,
    });
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView captures and restores browser pane view state through the BrowserView service', async () => {
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article',
  };
  const draftTab = {
    id: 'draft-a',
    kind: 'draft' as const,
    title: 'Draft A',
    document: createWritingEditorDocumentFromPlainText('alpha beta'),
    viewMode: 'draft' as const,
  };
  const tabs = [browserTab, draftTab];
  const scriptMarkers: string[] = [];
  const scrollStateByTargetId = new Map([
    [
      browserTab.id,
      {
        url: browserTab.url,
        scrollX: 0,
        scrollY: 96,
      },
    ],
  ]);
  let lastCapturedState:
    | {
        url: string;
        scrollX: number;
        scrollY: number;
      }
    | undefined;

  await withElectronApi(
    {
      invoke: (async () => {
        throw new Error('Unexpected invoke in editorGroupView test.');
      }) as ElectronAPI['invoke'],
      webContent: {
        dispose() {},
        activate() {},
        release() {},
        async navigate() {
          return {
            targetId: browserTab.id,
            activeTargetId: browserTab.id,
            ownership: 'active',
            layoutPhase: 'visible',
            url: scrollStateByTargetId.get(browserTab.id)?.url ?? '',
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            visible: true,
          };
        },
        async getState(targetId?: string | null) {
          return {
            targetId: targetId ?? null,
            activeTargetId: targetId ?? null,
            ownership: 'active',
            layoutPhase: 'visible',
            url: scrollStateByTargetId.get(targetId ?? '')?.url ?? '',
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            visible: true,
          };
        },
        setBounds() {},
        setVisible() {},
        setLayoutPhase() {},
        setRetentionLimit() {},
        clearHistory() {},
        hardReload() {},
        reload() {},
        goBack() {},
        goForward() {},
        async executeJavaScript<T = unknown>(
          targetId: string | null | undefined,
          script: string,
        ) {
          if (script.includes(WEB_CONTENT_VIEW_STATE_CAPTURE_SCRIPT_MARKER)) {
            scriptMarkers.push('capture');
            const capturedState = scrollStateByTargetId.get(targetId ?? '') ?? null;
            lastCapturedState = capturedState
              ? { ...capturedState }
              : undefined;
            return capturedState as T | null;
          }

          if (script.includes(WEB_CONTENT_VIEW_STATE_RESTORE_SCRIPT_MARKER)) {
            scriptMarkers.push('restore');
            if (!lastCapturedState || !targetId) {
              return false as T;
            }

            scrollStateByTargetId.set(targetId, { ...lastCapturedState });
            return true as T;
          }

          return null as T | null;
        },
        async getSelection() {
          return null;
        },
        async captureScreenshot() {
          return null;
        },
        onStateChange() {
          return () => {};
        },
      },
    },
    async () => {
      const view = new EditorGroupView({
        ...createProps(browserTab.id, browserTab, tabs),
        viewPartProps: {
          browserUrl: browserTab.url,
          electronRuntime: true,
          webContentRuntime: true,
          labels: {
            emptyState: 'Empty',
            contentUnavailable: 'Unavailable',
            overlayPauseHeading: 'Paused',
            overlayPauseDetail: 'Dismiss',
          },
        },
      });
      document.body.append(view.getElement());

      try {
        const initialBrowserPane = (view as unknown as {
          activePane: object | null;
        }).activePane;
        assert(initialBrowserPane);

        view.setProps(createProps(draftTab.id, draftTab, tabs));
        await waitForAsyncWork();

        scrollStateByTargetId.set(browserTab.id, {
          url: browserTab.url,
          scrollX: 0,
          scrollY: 0,
        });

        view.setProps({
          ...createProps(browserTab.id, browserTab, tabs),
          viewPartProps: {
            browserUrl: browserTab.url,
            electronRuntime: true,
            webContentRuntime: true,
            labels: {
              emptyState: 'Empty',
              contentUnavailable: 'Unavailable',
              overlayPauseHeading: 'Paused',
              overlayPauseDetail: 'Dismiss',
            },
          },
        });
        await waitForAsyncWork();
        await waitForAsyncWork();

        const restoredBrowserPane = (view as unknown as {
          activePane: object | null;
        }).activePane;
        assert(restoredBrowserPane);
        assert.equal(scrollStateByTargetId.get(browserTab.id)?.scrollY, 96);
        assert.notEqual(restoredBrowserPane, initialBrowserPane);
        assert(scriptMarkers.includes('capture'));
        assert(scriptMarkers.includes('restore'));
      } finally {
        view.dispose();
        document.body.replaceChildren();
      }
    },
  );
});

test('EditorGroupView reuses the browser pane when switching between browser tabs', async () => {
  const browserTabA = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article-a',
  };
  const browserTabB = {
    id: 'browser-b',
    kind: 'browser' as const,
    title: 'Browser B',
    url: 'https://example.com/article-b',
  };
  const tabs = [browserTabA, browserTabB];
  const persistedStates: Array<{
    key: {
      groupId: string;
      paneId: string;
      resourceKey: string;
    };
    state: unknown;
  }> = [];
  const scriptMarkers: string[] = [];
  const scrollStateByTargetId = new Map([
    [
      browserTabA.id,
      {
        url: browserTabA.url,
        scrollX: 0,
        scrollY: 96,
      },
    ],
    [
      browserTabB.id,
      {
        url: browserTabB.url,
        scrollX: 0,
        scrollY: 0,
      },
    ],
  ]);

  await withElectronApi(
    {
      invoke: (async () => {
        throw new Error('Unexpected invoke in editorGroupView test.');
      }) as ElectronAPI['invoke'],
      webContent: {
        dispose() {},
        activate() {},
        release() {},
        async navigate() {
          return {
            targetId: browserTabA.id,
            activeTargetId: browserTabA.id,
            ownership: 'active',
            layoutPhase: 'visible',
            url: scrollStateByTargetId.get(browserTabA.id)?.url ?? '',
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            visible: true,
          };
        },
        async getState(targetId?: string | null) {
          return {
            targetId: targetId ?? null,
            activeTargetId: targetId ?? null,
            ownership: 'active',
            layoutPhase: 'visible',
            url: scrollStateByTargetId.get(targetId ?? '')?.url ?? '',
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            visible: true,
          };
        },
        setBounds() {},
        setVisible() {},
        setLayoutPhase() {},
        setRetentionLimit() {},
        clearHistory() {},
        hardReload() {},
        reload() {},
        goBack() {},
        goForward() {},
        async executeJavaScript<T = unknown>(
          targetId: string | null | undefined,
          script: string,
        ) {
          if (script.includes(WEB_CONTENT_VIEW_STATE_CAPTURE_SCRIPT_MARKER)) {
            scriptMarkers.push('capture');
            return (scrollStateByTargetId.get(targetId ?? '') ?? null) as T | null;
          }

          if (script.includes(WEB_CONTENT_VIEW_STATE_RESTORE_SCRIPT_MARKER)) {
            scriptMarkers.push('restore');
            if (!targetId) {
              return false as T;
            }

            const viewStateMatch = script.match(/const viewState = (\{[\s\S]*?\});/);
            if (!viewStateMatch) {
              return false as T;
            }

            scrollStateByTargetId.set(
              targetId,
              JSON.parse(viewStateMatch[1]) as {
                url: string;
                scrollX: number;
                scrollY: number;
              },
            );
            return true as T;
          }

          return null as T | null;
        },
        async getSelection() {
          return null;
        },
        async captureScreenshot() {
          return null;
        },
        onStateChange() {
          return () => {};
        },
      },
    },
    async () => {
      const view = new EditorGroupView({
        ...createProps(browserTabA.id, browserTabA, tabs, {
          onSetEditorViewState: (key, state) => {
            persistedStates.push({ key, state });
          },
        }),
        viewStateEntries: [
          {
            key: {
              groupId: DEFAULT_EDITOR_GROUP_ID,
              paneId: 'browser',
              resourceKey: `browser:${browserTabB.url}`,
            },
            state: {
              url: browserTabB.url,
              scrollX: 0,
              scrollY: 24,
            },
          },
        ],
        viewPartProps: {
          browserUrl: browserTabA.url,
          electronRuntime: true,
          webContentRuntime: true,
          labels: {
            emptyState: 'Empty',
            contentUnavailable: 'Unavailable',
            overlayPauseHeading: 'Paused',
            overlayPauseDetail: 'Dismiss',
          },
        },
      });
      document.body.append(view.getElement());

      try {
        const initialBrowserPane = (view as unknown as {
          activePane: object | null;
        }).activePane;
        assert(initialBrowserPane);

        view.setProps({
          ...createProps(browserTabB.id, browserTabB, tabs, {
            onSetEditorViewState: (key, state) => {
              persistedStates.push({ key, state });
            },
          }),
          viewStateEntries: [
            {
              key: {
                groupId: DEFAULT_EDITOR_GROUP_ID,
                paneId: 'browser',
                resourceKey: `browser:${browserTabB.url}`,
              },
              state: {
                url: browserTabB.url,
                scrollX: 0,
                scrollY: 24,
              },
            },
          ],
          viewPartProps: {
            browserUrl: browserTabB.url,
            electronRuntime: true,
            webContentRuntime: true,
            labels: {
              emptyState: 'Empty',
              contentUnavailable: 'Unavailable',
              overlayPauseHeading: 'Paused',
              overlayPauseDetail: 'Dismiss',
            },
          },
        });

        await view.whenTabViewStateSettled(browserTabA.id);
        await waitForAsyncWork();
        await waitForAsyncWork();

        const switchedBrowserPane = (view as unknown as {
          activePane: object | null;
        }).activePane;
        assert(switchedBrowserPane);
        assert.equal(switchedBrowserPane, initialBrowserPane);
        assert.equal(scrollStateByTargetId.get(browserTabB.id)?.scrollY, 24);
        assert.deepEqual(
          persistedStates[persistedStates.length - 1],
          {
            key: {
              groupId: DEFAULT_EDITOR_GROUP_ID,
              paneId: 'browser',
              resourceKey: `browser:${browserTabA.url}`,
            },
            state: {
              url: browserTabA.url,
              scrollX: 0,
              scrollY: 96,
            },
          },
        );
        assert(scriptMarkers.includes('capture'));
        assert(scriptMarkers.includes('restore'));
      } finally {
        view.dispose();
        document.body.replaceChildren();
      }
    },
  );
});

test('EditorGroupView tracks pending browser view-state capture by tab id', async () => {
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article',
  };
  const draftTab = {
    id: 'draft-a',
    kind: 'draft' as const,
    title: 'Draft A',
    document: createWritingEditorDocumentFromPlainText('alpha beta'),
    viewMode: 'draft' as const,
  };
  const tabs = [browserTab, draftTab];
  const persistedStates: Array<{
    key: {
      groupId: string;
      paneId: string;
      resourceKey: string;
    };
    state: unknown;
  }> = [];
  let resolveCapture: ((value: {
    url: string;
    scrollX: number;
    scrollY: number;
  }) => void) | null = null;

  await withElectronApi(
    {
      invoke: (async () => {
        throw new Error('Unexpected invoke in editorGroupView test.');
      }) as ElectronAPI['invoke'],
      webContent: {
        dispose() {},
        activate() {},
        release() {},
        async navigate() {
          return {
            targetId: browserTab.id,
            activeTargetId: browserTab.id,
            ownership: 'active',
            layoutPhase: 'visible',
            url: browserTab.url,
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            visible: true,
          };
        },
        async getState(targetId?: string | null) {
          return {
            targetId: targetId ?? null,
            activeTargetId: targetId ?? null,
            ownership: 'active',
            layoutPhase: 'visible',
            url: browserTab.url,
            canGoBack: false,
            canGoForward: false,
            isLoading: false,
            visible: true,
          };
        },
        setBounds() {},
        setVisible() {},
        setLayoutPhase() {},
        setRetentionLimit() {},
        clearHistory() {},
        hardReload() {},
        reload() {},
        goBack() {},
        goForward() {},
        async executeJavaScript<T = unknown>(
          _targetId: string | null | undefined,
          script: string,
        ) {
          if (!script.includes(WEB_CONTENT_VIEW_STATE_CAPTURE_SCRIPT_MARKER)) {
            return null as T | null;
          }

          return await new Promise<T | null>((resolve) => {
            resolveCapture = (
              value: {
                url: string;
                scrollX: number;
                scrollY: number;
              },
            ) => resolve(value as T);
          });
        },
        async getSelection() {
          return null;
        },
        async captureScreenshot() {
          return null;
        },
        onStateChange() {
          return () => {};
        },
      },
    },
    async () => {
      const view = new EditorGroupView({
        ...createProps(browserTab.id, browserTab, tabs, {
          onSetEditorViewState: (key, state) => {
            persistedStates.push({ key, state });
          },
        }),
        viewPartProps: {
          browserUrl: browserTab.url,
          electronRuntime: true,
          webContentRuntime: true,
          labels: {
            emptyState: 'Empty',
            contentUnavailable: 'Unavailable',
            overlayPauseHeading: 'Paused',
            overlayPauseDetail: 'Dismiss',
          },
        },
      });
      document.body.append(view.getElement());

      try {
        view.setProps(
          createProps(draftTab.id, draftTab, tabs, {
            onSetEditorViewState: (key, state) => {
              persistedStates.push({ key, state });
            },
          }),
        );

        const pendingCapture = view.whenTabViewStateSettled(browserTab.id);
        let settled = false;
        void pendingCapture.then(() => {
          settled = true;
        });

        await waitForAsyncWork();
        assert.equal(settled, false);
        assert.equal(resolveCapture !== null, true);

        resolveCapture?.({
          url: browserTab.url,
          scrollX: 0,
          scrollY: 120,
        });
        await pendingCapture;

        assert.equal(settled, true);
        assert.deepEqual(
          persistedStates[persistedStates.length - 1],
          {
            key: {
              groupId: DEFAULT_EDITOR_GROUP_ID,
              paneId: 'browser',
              resourceKey: `browser:${browserTab.url}`,
            },
            state: {
              url: browserTab.url,
              scrollX: 0,
              scrollY: 120,
            },
          },
        );
      } finally {
        view.dispose();
        document.body.replaceChildren();
      }
    },
  );
});
