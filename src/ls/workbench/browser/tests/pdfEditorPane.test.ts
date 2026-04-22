import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import { createPdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import { DEFAULT_EDITOR_GROUP_ID } from 'ls/workbench/browser/editorGroupIdentity';

let cleanupDomEnvironment: (() => void) | null = null;
let EditorGroupView: typeof import('ls/workbench/browser/parts/editor/editorGroupView').EditorGroupView;

const labels = {
  topbarAddAction: 'Add',
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

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ EditorGroupView } = await import('ls/workbench/browser/parts/editor/editorGroupView'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createProps(
  activeTabId: string | null,
  activeTab: import('ls/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab | null,
  tabs: import('ls/workbench/browser/parts/editor/editorModel').EditorWorkspaceTab[],
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
    },
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
    assert.equal(pdfBody.childElementCount, 0);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});
