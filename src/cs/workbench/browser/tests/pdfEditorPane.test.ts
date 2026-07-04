import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { Annotation } from 'cs/editor/common/annotation';
import { readStoredPdfAnnotations } from 'cs/editor/browser/pdf/pdfAnnotationPersistence';
import { createPdfSelection } from 'cs/editor/browser/pdf/pdfSelection';
import { DEFAULT_EDITOR_GROUP_ID } from 'cs/workbench/browser/editorGroupIdentity';

let cleanupDomEnvironment: (() => void) | null = null;
let EditorGroupView: typeof import('cs/workbench/browser/parts/editor/editorGroupView').EditorGroupView;

type TestViewPartProps = {
  browserUrl: string;
  electronRuntime: boolean;
  webContentRuntime: boolean;
  labels: {
    emptyState: string;
    contentUnavailable: string;
  };
};

const labels = {
  headerAddAction: 'Add',
  createDraft: 'Draft',
  createBrowser: 'Browser',
  createFile: 'File',
  newTab: 'New Tab',
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

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ EditorGroupView } = await import('cs/workbench/browser/parts/editor/editorGroupView'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createProps(
  activeTabId: string | null,
  activeTab: import('cs/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab | null,
  tabs: import('cs/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab[],
  viewPartProps?: Partial<TestViewPartProps>,
) {
  return {
    labels,
    viewPartProps: {
      browserUrl: '',
      electronRuntime: false,
      webContentRuntime: false,
      labels: {
        emptyState: 'Empty',
        contentUnavailable: 'Unavailable',
      },
      ...viewPartProps,
    },
    nativeHost: createNativeHostService(),
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
  };
}

test('EditorGroupView restores pdf pane selection and draft comment after switching away and back', () => {
  const pdfTab = {
    id: 'pdf-a',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'https://example.com/paper.pdf',
  };
  const browserTab = {
    id: 'browser-a',
    kind: 'browser' as const,
    title: 'Browser A',
    url: 'https://example.com/article',
  };
  const tabs = [pdfTab, browserTab];

  const view = new EditorGroupView(createProps(pdfTab.id, pdfTab, tabs));
  document.body.append(view.getElement());

  try {
    const activePane = (view as unknown as {
      activePane: {
        editor: {
          setSelection: (selection: ReturnType<typeof createPdfSelection> | null) => void;
          restoreViewState: (state: {
            selection: ReturnType<typeof createPdfSelection> | null;
            draftComment: string;
          }) => void;
          getViewState: () => {
            selection: ReturnType<typeof createPdfSelection> | null;
            draftComment: string;
          };
        };
      } | null;
    }).activePane;
    assert(activePane);

    activePane.editor.setSelection(
      createPdfSelection({
        page: 2,
        rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        text: 'quoted text',
      }),
    );
    activePane.editor.restoreViewState({
      selection: createPdfSelection({
        page: 2,
        rects: [{ x: 1, y: 2, width: 3, height: 4 }],
        text: 'quoted text',
      }),
      draftComment: 'note',
    });

    view.setProps(createProps(browserTab.id, browserTab, tabs));
    view.setProps(createProps(pdfTab.id, pdfTab, tabs));

    const restoredPane = (view as unknown as {
      activePane: {
        editor: {
          getViewState: () => {
            selection: ReturnType<typeof createPdfSelection> | null;
            draftComment: string;
          };
        };
      } | null;
    }).activePane;
    assert(restoredPane);

    const restoredViewState = restoredPane.editor.getViewState();
    assert(restoredViewState.selection);
    assert.equal(restoredViewState.selection.page, 2);
    assert.equal(restoredViewState.selection.text, 'quoted text');
    assert.equal(restoredViewState.draftComment, 'note');
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView persists pdf highlight and note annotations from the current selection', () => {
  const pdfTab = {
    id: 'pdf-annotate',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'https://example.com/annotate.pdf',
  };
  const storageKey = `cs.pdfAnnotations.${pdfTab.url}`;
  window.localStorage.removeItem(storageKey);

  const view = new EditorGroupView(createProps(pdfTab.id, pdfTab, [pdfTab]));
  document.body.append(view.getElement());

  try {
    const activePane = (view as unknown as {
      activePane: {
        restoreViewState: (state: {
          selection: ReturnType<typeof createPdfSelection> | null;
          draftComment: string;
        }) => void;
        addHighlightFromSelection: () => boolean;
        addNoteFromSelection: () => boolean;
        updatePdfAnnotation: (annotation: Annotation) => void;
        deletePdfAnnotation: (annotationId: string) => void;
      } | null;
    }).activePane;
    assert(activePane);

    activePane.restoreViewState({
      selection: createPdfSelection({
        page: 1,
        rects: [{ x: 10, y: 20, width: 100, height: 12 }],
        text: 'layout anchored quote',
        startCharOffset: 5,
        endCharOffset: 26,
        lineIds: ['page-1-line-2'],
        textRange: { startCharIndex: 5, endCharIndex: 26 },
      }),
      draftComment: 'stored note',
    });

    assert.equal(activePane.addHighlightFromSelection(), true);
    assert.equal(activePane.addNoteFromSelection(), true);

    const annotations = readStoredPdfAnnotations(pdfTab.url);
    assert.equal(annotations.length, 2);
    const [highlight, note] = annotations;
    assert(highlight);
    assert(note);
    assert.equal(highlight.mode, 'highlight');
    assert.equal(highlight.comment, '');
    assert.equal(note.mode, 'note');
    assert.equal(note.comment, 'stored note');
    assert.equal(highlight.anchor.ranges?.[0]?.quote, 'layout anchored quote');
    assert.equal(highlight.anchor.ranges?.[0]?.startCharOffset, 5);
    assert.equal(highlight.anchor.ranges?.[0]?.endCharOffset, 26);
    assert.deepEqual(highlight.anchor.ranges?.[0]?.lineIds, ['page-1-line-2']);

    activePane.updatePdfAnnotation({
      ...note,
      comment: 'edited note',
      updatedAt: '2026-04-25T00:00:00.000Z',
    });
    assert.equal(readStoredPdfAnnotations(pdfTab.url)[1]?.comment, 'edited note');

    activePane.deletePdfAnnotation(highlight.id);
    const remainingAnnotations = readStoredPdfAnnotations(pdfTab.url);
    assert.equal(remainingAnnotations.length, 1);
    assert.equal(remainingAnnotations[0]?.id, note.id);
  } finally {
    view.dispose();
    document.body.replaceChildren();
    window.localStorage.removeItem(storageKey);
  }
});

test('EditorGroupView renders a controlled PDFium reader shell for PDF tabs', () => {
  const pdfTab = {
    id: 'pdf-direct-reader',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'file:///C:/Users/lanxi/Desktop/sample.pdf',
  };

  const view = new EditorGroupView(
    createProps(pdfTab.id, pdfTab, [pdfTab], {
      electronRuntime: true,
      webContentRuntime: false,
    }),
  );
  document.body.append(view.getElement());

  try {
    const reader = view.getElement().querySelector('.pdf-reader-view');
    const pages = view.getElement().querySelector('.pdf-reader-pages');
    const loading = view.getElement().querySelector('.pdf-reader-status');
    assert(reader instanceof HTMLElement);
    assert(pages instanceof HTMLElement);
    assert(loading instanceof HTMLElement);
    assert.equal(reader.hidden, false);
    assert.equal(loading.textContent, 'Loading PDF...');
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView replaces the pdf reader with unavailable state when rendering is unsupported', () => {
  const pdfTab = {
    id: 'pdf-unavailable-reader',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'file:///C:/Users/lanxi/Desktop/sample.pdf',
  };

  const view = new EditorGroupView(createProps(pdfTab.id, pdfTab, [pdfTab]));
  document.body.append(view.getElement());

  try {
    const reader = view.getElement().querySelector('.pdf-reader-view');
    const pages = view.getElement().querySelector('.pdf-reader-pages');
    const loading = view.getElement().querySelector('.pdf-reader-status');
    const unavailable = view.getElement().querySelector('.pdf-reader-unavailable');
    assert(reader instanceof HTMLElement);
    assert(pages instanceof HTMLElement);
    assert(loading instanceof HTMLElement);
    assert(unavailable instanceof HTMLElement);
    assert.equal(reader.hidden, false);
    assert.equal(pages.childElementCount, 0);
    assert.equal(loading.hidden, true);
    assert.equal(unavailable.hidden, false);
    assert.equal(unavailable.textContent, 'Unavailable');
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView reports pdf reader errors to the editor statusbar state', () => {
  const pdfTab = {
    id: 'pdf-status-error',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'file:///C:/Users/lanxi/Desktop/sample.pdf',
  };
  const statusUpdates: Array<{
    paneMode: string;
    leftItems: readonly { id: string; value: string; tone?: string; title?: string }[];
  }> = [];

  const view = new EditorGroupView({
    ...createProps(pdfTab.id, pdfTab, [pdfTab]),
    onStatusChange: (status) => {
      statusUpdates.push(status);
    },
  });
  document.body.append(view.getElement());

  try {
    const pdfStatus = statusUpdates
      .flatMap((status) => status.leftItems)
      .find((item) => item.id === 'pdf-status');
    assert(pdfStatus);
    assert.equal(pdfStatus.tone, 'error');
    assert.match(pdfStatus.value, /Unavailable/);
    assert.match(pdfStatus.title ?? '', /Electron runtime/);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView reports pdf hit-test diagnostics to the editor statusbar state', () => {
  const pdfTab = {
    id: 'pdf-status-hit-test',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'file:///C:/Users/lanxi/Desktop/sample.pdf',
  };
  const statusUpdates: Array<{
    leftItems: readonly { id: string; value: string; title?: string }[];
  }> = [];

  const view = new EditorGroupView({
    ...createProps(pdfTab.id, pdfTab, [pdfTab]),
    onStatusChange: (status) => {
      statusUpdates.push(status);
    },
  });
  document.body.append(view.getElement());

  try {
    (view as unknown as {
      handlePdfReaderStatusChange: (
        tabId: string,
        status: {
          state: 'ready';
          message: string;
          hitTest: {
            page: number;
            lineIndex: number;
            lineId: string;
            charOffset: number;
            pdfX: number;
            pdfY: number;
            lineDeltaY: number;
            text: string;
          };
        },
      ) => void;
    }).handlePdfReaderStatusChange(pdfTab.id, {
      state: 'ready',
      message: '7 pages',
      hitTest: {
        page: 2,
        lineIndex: 5,
        lineId: 'pdf_line_2_5',
        charOffset: 42,
        pdfX: 123.4,
        pdfY: 567.8,
        lineDeltaY: -3.2,
        text: 'diagnostic line',
      },
    });

    const latestStatus = statusUpdates.at(-1);
    assert(latestStatus);
    assert.equal(
      latestStatus.leftItems.find((item) => item.id === 'pdf-hit-line')?.value,
      'P2 L5',
    );
    assert.equal(
      latestStatus.leftItems.find((item) => item.id === 'pdf-hit-point')?.value,
      '123,568',
    );
    assert.match(
      latestStatus.leftItems.find((item) => item.id === 'pdf-hit-line')?.title ?? '',
      /diagnostic line/,
    );
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView renders a pdf empty-state shell with a body container', () => {
  const pdfTab = {
    id: 'pdf-empty',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'https://example.com/paper.pdf',
  };

  const view = new EditorGroupView(createProps(pdfTab.id, pdfTab, [pdfTab]));
  document.body.append(view.getElement());

  try {
    const pdfPane = view.getElement().querySelector('.editor-content .editor-pdf-pane');
    assert(pdfPane instanceof HTMLElement);

    const pdfBody = pdfPane.querySelector(':scope > .editor-pdf-body');
    assert(pdfBody instanceof HTMLElement);
    assert.equal(pdfBody.childElementCount, 1);
    assert(pdfBody.firstElementChild?.classList.contains('pdf-document-reader'));

    const readerSurface = pdfBody.querySelector('.pdf-annotation-surface');
    assert(readerSurface instanceof HTMLElement);

    const annotationOverlay = pdfBody.querySelector('.pdf-annotation-overlay');
    assert.equal(annotationOverlay, null);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('EditorGroupView captures pdf document reader view state from the mounted pane', () => {
  const pdfTab = {
    id: 'pdf-state',
    kind: 'pdf' as const,
    title: 'Paper PDF',
    url: 'https://example.com/state.pdf',
  };

  const view = new EditorGroupView(createProps(pdfTab.id, pdfTab, [pdfTab]));
  document.body.append(view.getElement());

  try {
    const activePane = (view as unknown as {
      activePane: {
        documentReader: {
          restoreViewState: (state: {
            selection: ReturnType<typeof createPdfSelection> | null;
            draftComment: string;
          }) => void;
        };
        getViewState: () => {
          selection: ReturnType<typeof createPdfSelection> | null;
          draftComment: string;
        };
      } | null;
    }).activePane;
    assert(activePane);

    activePane.documentReader.restoreViewState({
      selection: createPdfSelection({
        page: 3,
        text: 'captured text',
      }),
      draftComment: 'captured note',
    });

    const viewState = activePane.getViewState();
    assert.equal(viewState.selection?.page, 3);
    assert.equal(viewState.selection?.text, 'captured text');
    assert.equal(viewState.draftComment, 'captured note');
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});
