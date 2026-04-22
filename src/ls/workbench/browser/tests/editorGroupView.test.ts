import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import type { ElectronAPI } from 'ls/base/parts/sandbox/common/desktopTypes';
import { createWritingEditorDocumentFromPlainText } from 'ls/editor/common/writingEditorDocument';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import { DEFAULT_EDITOR_GROUP_ID } from 'ls/workbench/browser/editorGroupIdentity';
import {
  WEB_CONTENT_VIEW_STATE_CAPTURE_SCRIPT_MARKER,
  WEB_CONTENT_VIEW_STATE_RESTORE_SCRIPT_MARKER,
} from 'ls/workbench/browser/parts/editor/panes/contentEditorViewState';

let cleanupDomEnvironment: (() => void) | null = null;
let EditorGroupView: typeof import('ls/workbench/browser/parts/editor/editorGroupView').EditorGroupView;
let resolveEditorPane: typeof import('ls/workbench/browser/parts/editor/panes/editorPaneRegistry').resolveEditorPane;
let editorPaneDescriptors: typeof import('ls/workbench/browser/parts/editor/panes/editorPaneRegistry').editorPaneDescriptors;
let TextSelection: typeof import('prosemirror-state').TextSelection;

const labels = {
  topbarAddAction: 'Add',
  createDraft: 'Draft',
  createBrowser: 'Browser',
  createFile: 'File',
  toolbarSources: 'Source menu',
  toolbarBack: 'Back',
  toolbarForward: 'Forward',
  toolbarRefresh: 'Refresh',
  toolbarFavorite: 'Favorite',
  toolbarArchivePage: 'Archive page',
  toolbarMore: 'More',
  toolbarHardReload: 'Hard reload',
  toolbarCopyCurrentUrl: 'Copy current URL',
  toolbarClearBrowsingHistory: 'Clear browsing history',
  toolbarClearCookies: 'Clear cookies',
  toolbarClearCache: 'Clear cache',
  toolbarAddressBar: 'Address bar',
  toolbarAddressPlaceholder: 'Search or enter URL',
  browserLibraryPanelTitle: 'Source menu',
  browserLibraryPanelRecentTitle: 'Recent',
  browserLibraryPanelRecentTodayTitle: 'Today',
  browserLibraryPanelRecentYesterdayTitle: 'Yesterday',
  browserLibraryPanelRecentLast7DaysTitle: 'Last 7 Days',
  browserLibraryPanelRecentLast30DaysTitle: 'Last 30 Days',
  browserLibraryPanelRecentOlderTitle: 'Older',
  browserLibraryPanelFavoritesTitle: 'Favorites',
  browserLibraryPanelEmptyState: 'No links yet',
  browserLibraryPanelContextOpen: 'Open',
  browserLibraryPanelContextOpenInNewTab: 'Open in New Tab',
  browserLibraryPanelContextNewFolder: 'New Folder',
  browserLibraryPanelContextRename: 'Rename',
  browserLibraryPanelContextRemoveFavorite: 'Remove Favorite',
  draftMode: 'Draft',
  sourceMode: 'Source',
  pdfMode: 'PDF',
  newTab: 'New Tab',
  close: 'Close',
  expandEditor: 'Expand editor',
  collapseEditor: 'Collapse editor',
  renameFavoriteTitle: 'Rename Favorite',
  renameFavoriteLabel: 'Favorite name',
  newFavoriteFolderTitle: 'New Folder',
  newFavoriteFolderLabel: 'Folder name',
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
  },
};

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ EditorGroupView } = await import('ls/workbench/browser/parts/editor/editorGroupView'));
  ({ resolveEditorPane, editorPaneDescriptors } = await import(
    'ls/workbench/browser/parts/editor/panes/editorPaneRegistry'
  ));
  ({ TextSelection } = await import('prosemirror-state'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createProps(
  activeTabId: string | null,
  activeTab: import('ls/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab | null,
  tabs: import('ls/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab[],
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
    labels,
    viewPartProps: defaultViewPartProps,
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
    onToolbarNavigateToUrl: () => {},
    onDraftDocumentChange: () => {},
    onSetEditorViewState: () => {},
    onDeleteEditorViewState: () => {},
    ...overrides,
  };
}

function createResolverContext() {
  return {
    labels,
    viewPartProps: defaultViewPartProps,
    onDraftDocumentChange: () => {},
    onDraftStatusChange: () => {},
  };
}

function waitForAsyncWork() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

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

test('EditorGroupView schedules browser primary input focus when opening browser mode from an empty pane entry', () => {
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
    const browserButton = view
      .getElement()
      .querySelector('[data-tab-id="browser-entry"] .editor-tab-main');
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
      .querySelector('[data-tab-id="browser-a"] .editor-tab-main');
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
  assert.deepEqual(draftPane.contentClassNames, ['is-mode-draft']);

  const browserPane = resolveEditorPane(browserTab, createResolverContext());
  assert.equal(browserPane.paneId, 'browser');
  assert.equal(browserPane.paneKey, 'browser');
  assert.deepEqual(browserPane.contentClassNames, ['is-mode-browser']);

  const pdfPane = resolveEditorPane(pdfTab, createResolverContext());
  assert.equal(pdfPane.paneId, 'pdf');
  assert.equal(pdfPane.paneKey, 'pdf:pdf-a');
  assert.deepEqual(pdfPane.contentClassNames, ['is-mode-pdf']);
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

test('EditorGroupView captures and restores browser pane view state through the web content bridge', async () => {
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
