import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import { createEmptyWritingEditorDocument } from 'ls/editor/common/writingEditorDocument';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import { DEFAULT_EDITOR_GROUP_ID } from 'ls/workbench/browser/editorGroupIdentity';
import {
  EDITOR_FRAME_SLOTS,
  getEditorFrameSlot,
} from 'ls/workbench/browser/parts/editor/editorFrame';
import type { EditorOpenRequest } from 'ls/workbench/services/editor/common/editorOpenTypes';

let cleanupDomEnvironment: (() => void) | null = null;
let createWorkbenchLayoutView: typeof import('ls/workbench/browser/workbench').createWorkbenchLayoutView;
let createWorkbenchContentPartViews: typeof import('ls/workbench/browser/workbenchContentPartViews').createWorkbenchContentPartViews;
let getWorkbenchLayoutStateSnapshot: typeof import('ls/workbench/browser/layout').getWorkbenchLayoutStateSnapshot;
let setPrimarySidebarVisible: typeof import('ls/workbench/browser/layout').setPrimarySidebarVisible;
let setAgentSidebarVisible: typeof import('ls/workbench/browser/layout').setAgentSidebarVisible;
let setWorkbenchSidebarSizes: typeof import('ls/workbench/browser/layout').setWorkbenchSidebarSizes;
let setEditorCollapsed: typeof import('ls/workbench/browser/layout').setEditorCollapsed;
let WORKBENCH_CONTENT_LAYOUT_BREAKPOINT: typeof import('ls/workbench/browser/layout').WORKBENCH_CONTENT_LAYOUT_BREAKPOINT;
let SidebarTopbarActionsView: typeof import('ls/workbench/browser/parts/sidebar/sidebarTopbarActions').SidebarTopbarActionsView;
let PrimaryBarFooterActionsView: typeof import('ls/workbench/browser/parts/primarybar/primarybarFooterActions').PrimaryBarFooterActionsView;

type RawWorkbenchLayoutViewProps = {
  mode?: 'content' | 'settings';
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  isLayoutEdgeSnappingEnabled: boolean;
  primarySidebarSize: number;
  agentSidebarSize: number;
  isEditorCollapsed: boolean;
  expandedEditorSize: number;
  settingsNavigationElement?: HTMLElement | null;
  settingsTopbarActionsElement?: HTMLElement | null;
  settingsContentElement?: HTMLElement | null;
  primaryBarProps: any;
  agentBarProps: any;
  sidebarTopbarActionsProps: any;
  sidebarTopbarActionsElement: HTMLElement;
  primaryBarFooterActionsElement: HTMLElement;
  editorTopbarAuxiliaryActionsElement: HTMLElement;
  editorPartProps: any;
  partViews: ReturnType<typeof createWorkbenchContentPartViews> | null;
};

function createSidebarTopbarActionsElement(props: {
  isPrimarySidebarVisible: boolean;
  primarySidebarToggleLabel: string;
  addressBarLabel: string;
  onTogglePrimarySidebar: () => void;
}) {
  const view = new SidebarTopbarActionsView();
  view.setProps(props);
  return view.getElement();
}

function createPrimaryBarFooterActionsElement(props: {
  accountLabel: string;
  settingsLabel: string;
}) {
  const view = new PrimaryBarFooterActionsView();
  view.setProps(props);
  return view.getElement();
}

function createSettingsTopbarActionsElement(backLabel: string) {
  const host = document.createElement('div');
  host.className = 'sidebar-topbar-actions-host';
  const actionbar = document.createElement('div');
  actionbar.className = 'sidebar-topbar-actions actionbar is-horizontal';
  const actions = document.createElement('div');
  actions.className = 'actionbar-actions-container';
  const button = document.createElement('button');
  button.className = 'actionbar-action sidebar-topbar-toggle-btn';
  button.setAttribute('aria-label', backLabel);
  actions.append(button);
  actionbar.append(actions);
  host.append(actionbar);
  return host;
}

function waitForNextTask() {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

function materializeWorkbenchLayoutViewProps(
  props: RawWorkbenchLayoutViewProps,
) {
  setPrimarySidebarVisible(props.isPrimarySidebarVisible);
  setAgentSidebarVisible(props.isAgentSidebarVisible);
  setWorkbenchSidebarSizes({
    primarySidebarSize: props.primarySidebarSize,
    agentSidebarSize: props.agentSidebarSize,
  });
  setEditorCollapsed(props.isEditorCollapsed, props.expandedEditorSize);

  const nextPartViews = props.partViews ?? createWorkbenchContentPartViews({
    mode: props.mode,
    isPrimarySidebarVisible: props.isPrimarySidebarVisible,
    isAgentSidebarVisible: props.isAgentSidebarVisible,
    settingsNavigationElement: props.settingsNavigationElement ?? null,
    settingsTopbarActionsElement: props.settingsTopbarActionsElement ?? null,
    settingsContentElement: props.settingsContentElement ?? null,
    primaryBarProps: props.primaryBarProps,
    agentBarProps: props.agentBarProps,
    editorPartProps: props.editorPartProps,
    sidebarTopbarActionsElement: props.sidebarTopbarActionsElement,
    primaryBarFooterActionsElement: props.primaryBarFooterActionsElement,
    editorTopbarAuxiliaryActionsElement: props.editorTopbarAuxiliaryActionsElement,
  });

  nextPartViews.setProps({
    mode: props.mode,
    isPrimarySidebarVisible: props.isPrimarySidebarVisible,
    isAgentSidebarVisible: props.isAgentSidebarVisible,
    settingsNavigationElement: props.settingsNavigationElement ?? null,
    settingsTopbarActionsElement: props.settingsTopbarActionsElement ?? null,
    settingsContentElement: props.settingsContentElement ?? null,
    primaryBarProps: props.primaryBarProps,
    agentBarProps: props.agentBarProps,
    editorPartProps: props.editorPartProps,
    sidebarTopbarActionsElement: props.sidebarTopbarActionsElement,
    primaryBarFooterActionsElement: props.primaryBarFooterActionsElement,
    editorTopbarAuxiliaryActionsElement: props.editorTopbarAuxiliaryActionsElement,
  });

  props.partViews = nextPartViews;

  return {
    mode: props.mode,
    isPrimarySidebarVisible: props.isPrimarySidebarVisible,
    isAgentSidebarVisible: props.isAgentSidebarVisible,
    isLayoutEdgeSnappingEnabled: props.isLayoutEdgeSnappingEnabled,
    primarySidebarSize: props.primarySidebarSize,
    agentSidebarSize: props.agentSidebarSize,
    isEditorCollapsed: props.isEditorCollapsed,
    expandedEditorSize: props.expandedEditorSize,
    partViews: nextPartViews,
  } as Parameters<typeof createWorkbenchLayoutView>[0];
}

function syncRawPropsWithLayoutState(props: RawWorkbenchLayoutViewProps) {
  const layoutState = getWorkbenchLayoutStateSnapshot();
  props.isPrimarySidebarVisible = layoutState.isPrimarySidebarVisible;
  props.isAgentSidebarVisible = layoutState.isAgentSidebarVisible;
  props.primarySidebarSize = layoutState.primarySidebarSize;
  props.agentSidebarSize = layoutState.agentSidebarSize;
  props.isEditorCollapsed = layoutState.isEditorCollapsed;
  props.expandedEditorSize = layoutState.expandedEditorSize;
  return props;
}

function installResizeObserverSpy() {
  let activeObservers = 0;
  const previousResizeObserver = globalThis.ResizeObserver;
  const instances: Array<{
    observing: boolean;
    disconnectCount: number;
  }> = [];

  class FakeResizeObserver implements ResizeObserver {
    private readonly instanceState = {
      observing: false,
      disconnectCount: 0,
    };

    constructor() {
      instances.push(this.instanceState);
    }

    disconnect() {
      if (!this.instanceState.observing) {
        return;
      }

      this.instanceState.observing = false;
      this.instanceState.disconnectCount += 1;
      activeObservers -= 1;
    }

    observe() {
      if (this.instanceState.observing) {
        return;
      }

      this.instanceState.observing = true;
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
    getInstanceCount() {
      return instances.length;
    },
    isObserving(index: number) {
      return instances[index]?.observing ?? false;
    },
    wasDisconnected(index: number) {
      return (instances[index]?.disconnectCount ?? 0) > 0;
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

function installAnimationFrameSpy() {
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const canceledHandles: number[] = [];

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((handle: number) => {
    canceledHandles.push(handle);
    callbacks.delete(handle);
  }) as typeof window.cancelAnimationFrame;

  return {
    getCanceledHandles() {
      return [...canceledHandles];
    },
    getPendingHandles() {
      return [...callbacks.keys()];
    },
    flushAll(timestamp = 0) {
      const pendingCallbacks = [...callbacks.entries()];
      callbacks.clear();
      for (const [, callback] of pendingCallbacks) {
        callback(timestamp);
      }
    },
    restore() {
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    },
  };
}

function setWindowInnerWidth(width: number) {
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: width,
  });
}

function bindWorkbenchContentSize(
  view: ReturnType<typeof createWorkbenchLayoutView>,
  initialWidth: number,
  initialHeight: number,
) {
  let width = initialWidth;
  let height = initialHeight;
  const element = (view as unknown as {
    element: HTMLElement;
    mainElement: HTMLElement;
  }).element;
  const mainElement = (view as unknown as {
    element: HTMLElement;
    mainElement: HTMLElement;
  }).mainElement;

  const defineDimension = (
    target: HTMLElement,
    dimension: 'clientWidth' | 'clientHeight',
  ) => {
    Object.defineProperty(target, dimension, {
      configurable: true,
      get: () => (dimension === 'clientWidth' ? width : height),
    });
  };

  defineDimension(element, 'clientWidth');
  defineDimension(element, 'clientHeight');
  defineDimension(mainElement, 'clientWidth');
  defineDimension(mainElement, 'clientHeight');

  return {
    setSize(nextWidth: number, nextHeight: number) {
      width = nextWidth;
      height = nextHeight;
    },
  };
}

function getEventEmitterListenerCount(
  owner: Record<string, unknown>,
  fieldName: string,
) {
  const emitter = owner[fieldName] as { listeners?: Set<unknown> } | undefined;
  return emitter?.listeners?.size ?? 0;
}

function createWorkbenchLayoutViewProps() {
  const auxiliaryEditorTopbarActionsElement = document.createElement('div');
  auxiliaryEditorTopbarActionsElement.className = 'sidebar-topbar-actions actionbar is-horizontal';
  const actionsContainer = document.createElement('div');
  actionsContainer.className = 'actionbar-actions-container';
  const toggleButton = document.createElement('button');
  toggleButton.className = 'actionbar-action editor-topbar-toggle-editor-btn';
  toggleButton.setAttribute('aria-label', 'Expand editor');
  actionsContainer.append(toggleButton);
  auxiliaryEditorTopbarActionsElement.append(actionsContainer);
  const sidebarLabels = {
    untitled: 'Untitled',
    unknown: 'Unknown',
    articleType: 'Type',
    authors: 'Authors',
    abstract: 'Abstract',
    description: 'Description',
    publishedAt: 'Published',
    source: 'Source',
    fetchedAt: 'Fetched',
    controlsAriaLabel: 'Controls',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
    emptyFiltered: 'No results',
    emptyAll: 'No articles',
    emptyAllInputLinkAction: 'Input link',
    emptyAllInputLinkSuffix: 'suffix',
    startDate: 'Start date',
    endDate: 'End date',
    fetchLatestBusy: 'Fetching',
    fetchLatest: 'Fetch latest',
    fetchTitle: 'Literature fetch',
    selectionModeEnterMulti: 'Select multiple',
    selectionModeSelectAll: 'Select all',
    selectionModeExit: 'Exit selection',
    loading: 'Loading',
    refresh: 'Refresh',
    libraryTitle: 'Library',
    libraryAction: 'Refresh library',
    pdfDownloadAction: 'Download pdf',
    libraryEmpty: 'No library data',
    libraryDocuments: 'Documents',
    libraryFiles: 'Files',
    libraryQueuedJobs: 'Queued jobs',
    libraryDbFile: 'DB file',
    libraryFilesDir: 'Files dir',
    libraryCacheDir: 'Cache dir',
    libraryStatusRegistered: 'Registered',
    libraryStatusQueued: 'Queued',
    libraryStatusRunning: 'Running',
    libraryStatusFailed: 'Failed',
    contextRename: 'Rename',
    contextEditSourceUrl: 'Edit source',
    contextDelete: 'Delete',
    assistantTitle: 'Assistant',
    assistantDescriptionEnabled: 'Enabled',
    assistantDescriptionDisabled: 'Disabled',
    assistantModeOn: 'On',
    assistantModeOff: 'Off',
    assistantReady: 'Ready',
    assistantPlaceholderEnabled: 'Ask',
    assistantPlaceholderDisabled: 'Disabled',
    assistantVoice: 'Voice',
    assistantImage: 'Image',
    assistantSend: 'Send',
    assistantSendBusy: 'Sending',
    assistantQuestion: 'Question',
    assistantQuestionPlaceholder: 'Type a question',
    assistantContext: 'Context',
    assistantContextPlaceholder: 'Type context',
    assistantAnswerTitle: 'Answer',
    assistantEvidenceTitle: 'Evidence',
    assistantSources: 'Sources',
    assistantNoArticles: 'No articles',
    assistantQuestionRequired: 'Question required',
    assistantRerankOn: 'Rerank on',
    assistantRerankOff: 'Rerank off',
  };
  const fetchPaneProps = {
    articles: [],
    hasData: false,
    locale: 'en' as const,
    labels: sidebarLabels,
    onFocusWebUrlInput: () => {},
    fetchStartDate: '',
    onFetchStartDateChange: () => {},
    fetchEndDate: '',
    onFetchEndDateChange: () => {},
    onFetch: () => {},
    onDownloadPdf: async () => {},
    onOpenArticleDetails: () => {},
    isFetchLoading: false,
    isSelectionModeEnabled: false,
    selectionModePhase: 'off' as const,
    selectedArticleKeys: new Set<string>(),
    onToggleSelectionMode: () => {},
    onToggleArticleSelected: () => {},
  };
  return {
    mode: 'content' as const,
    isPrimarySidebarVisible: false,
    isAgentSidebarVisible: false,
    isLayoutEdgeSnappingEnabled: false,
    primarySidebarSize: 320,
    agentSidebarSize: 360,
    isEditorCollapsed: false,
    expandedEditorSize: 220,
    settingsNavigationElement: null,
    settingsTopbarActionsElement: null,
    settingsContentElement: null,
    fetchPaneProps,
    primaryBarProps: {
      labels: sidebarLabels,
      fetchPaneProps,
      librarySnapshot: {
        items: [],
        totalCount: 0,
        fileCount: 0,
        queuedJobCount: 0,
        libraryDbFile: '',
        defaultManagedDirectory: '',
        ragCacheDir: '',
      },
      isLibraryLoading: false,
    },
    agentBarProps: {
      labels: {
        assistantHistory: 'History',
        assistantNewConversation: 'New conversation',
        assistantMore: 'More',
        assistantCloseSidebar: 'Close sidebar',
        assistantModel: 'Model',
        assistantModelSettings: 'Model settings',
        assistantQuestion: 'Question',
        assistantQuestionPlaceholder: 'Type a question',
        assistantSend: 'Send',
        assistantSendBusy: 'Sending',
        assistantVoice: 'Voice',
        assistantImage: 'Image',
        assistantContext: 'Context',
        assistantContextPlaceholder: 'Type context',
        assistantReady: 'Ready',
        assistantDescriptionEnabled: 'Enabled',
        assistantDescriptionDisabled: 'Disabled',
        assistantNoArticles: 'No articles',
        assistantApplyPatch: 'Apply patch',
      },
      isKnowledgeBaseModeEnabled: false,
      messages: [],
      question: '',
      onQuestionChange: () => {},
      isAsking: false,
      errorMessage: null,
      onAsk: () => {},
      onApplyPatch: () => {},
      availableArticleCount: 0,
      conversations: [
        {
          id: 'conversation-1',
          title: 'Conversation 1',
          messages: [],
        },
      ],
      activeConversationId: 'conversation-1',
      llmModelOptions: [],
      activeLlmModelOptionValue: '',
      onCreateConversation: () => {},
      onActivateConversation: () => {},
      onCloseConversation: () => {},
      onCloseAgentBar: () => {},
      onSelectLlmModel: () => {},
      onOpenModelSettings: () => {},
    },
    sidebarTopbarActionsProps: {
      isPrimarySidebarVisible: false,
      primarySidebarToggleLabel: 'Show primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    },
    sidebarTopbarActionsElement: createSidebarTopbarActionsElement({
      isPrimarySidebarVisible: false,
      primarySidebarToggleLabel: 'Show primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    }),
    primaryBarFooterActionsElement: createPrimaryBarFooterActionsElement({
      accountLabel: 'Account',
      settingsLabel: 'Settings',
    }),
    partViews: null,
    editorTopbarAuxiliaryActionsElement: auxiliaryEditorTopbarActionsElement,
    editorPartProps: {
      labels: {
        topbarAddAction: 'Add',
        createDraft: 'Draft',
        createBrowser: 'Browser',
        createFile: 'Read',
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
        renameFavoriteTitle: 'Rename Favorite',
        renameFavoriteLabel: 'Favorite name',
        newFavoriteFolderTitle: 'New Folder',
        newFavoriteFolderLabel: 'Folder name',
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
      },
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
      tabs: [],
      dirtyDraftTabIds: [],
      activeTabId: null,
      activeTab: null,
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
    },
  } as RawWorkbenchLayoutViewProps;
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createWorkbenchLayoutView } = await import('ls/workbench/browser/workbench'));
  ({ createWorkbenchContentPartViews } = await import('ls/workbench/browser/workbenchContentPartViews'));
  ({
    getWorkbenchLayoutStateSnapshot,
    setPrimarySidebarVisible,
    setAgentSidebarVisible,
    setWorkbenchSidebarSizes,
    setEditorCollapsed,
    WORKBENCH_CONTENT_LAYOUT_BREAKPOINT,
  } = await import('ls/workbench/browser/layout'));
  ({ SidebarTopbarActionsView } = await import('ls/workbench/browser/parts/sidebar/sidebarTopbarActions'));
  ({ PrimaryBarFooterActionsView } = await import('ls/workbench/browser/parts/primarybar/primarybarFooterActions'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

afterEach(() => {
  document.body.replaceChildren();
});

test('WorkbenchLayoutView mounts primary topbar actions into auxiliary topbar when the primary sidebar is hidden', () => {
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = true;
  props.isAgentSidebarVisible = true;
  props.sidebarTopbarActionsProps = {
    ...props.sidebarTopbarActionsProps,
    isPrimarySidebarVisible: true,
    primarySidebarToggleLabel: 'Hide primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    let primaryTopbarActionsHost = view
      .getElement()
      .querySelector('.primarybar-topbar .sidebar-topbar-actions-host');
    assert(primaryTopbarActionsHost instanceof HTMLElement);
    assert.equal(
      view
        .getElement()
        .querySelector('.agentbar-topbar .sidebar-topbar-actions-host'),
      null,
    );

    const nextProps = {
      ...props,
      isPrimarySidebarVisible: false,
      sidebarTopbarActionsProps: {
        ...props.sidebarTopbarActionsProps,
        isPrimarySidebarVisible: false,
        primarySidebarToggleLabel: 'Show primary sidebar',
      },
      sidebarTopbarActionsElement: createSidebarTopbarActionsElement({
        isPrimarySidebarVisible: false,
        primarySidebarToggleLabel: 'Show primary sidebar',
        addressBarLabel: 'Address bar',
        onTogglePrimarySidebar: () => {},
      }),
    };
    view.setProps(materializeWorkbenchLayoutViewProps(nextProps));

    primaryTopbarActionsHost = view
      .getElement()
      .querySelector('.agentbar-topbar .sidebar-topbar-actions-host');
    assert(primaryTopbarActionsHost instanceof HTMLElement);
    assert.equal(
      view
        .getElement()
        .querySelector('.agentbar-topbar .sidebar-topbar-toggle-btn')
        ?.getAttribute('aria-label'),
      'Show primary sidebar',
    );
    assert.equal(
      view
        .getElement()
        .querySelector('.primarybar-topbar .sidebar-topbar-actions-host'),
      null,
    );
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView mounts the editor collapse action into auxiliary topbar when the editor is collapsed', () => {
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = false;
  props.isAgentSidebarVisible = true;
  props.sidebarTopbarActionsProps = {
    ...props.sidebarTopbarActionsProps,
    isPrimarySidebarVisible: false,
    primarySidebarToggleLabel: 'Show primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const editorToggleButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-toggle-editor-btn');
    assert(editorToggleButton instanceof HTMLButtonElement);
    assert.equal(editorToggleButton.getAttribute('aria-label'), 'Collapse editor');

    editorToggleButton.click();
    view.setProps(materializeWorkbenchLayoutViewProps(syncRawPropsWithLayoutState(props)));

    const auxiliaryToggleButton = view
      .getElement()
      .querySelector('.agentbar-topbar .editor-topbar-toggle-editor-btn');
    assert(auxiliaryToggleButton instanceof HTMLButtonElement);
    assert.equal(auxiliaryToggleButton.getAttribute('aria-label'), 'Expand editor');
    assert.equal(
      view
        .getElement()
        .querySelector('.editor-topbar .editor-topbar-toggle-editor-btn'),
      null,
    );
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView collapses editor and mounts expand action into primarybar topbar when only primarybar and editor are visible', () => {
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = true;
  props.isAgentSidebarVisible = false;
  props.isEditorCollapsed = false;
  props.sidebarTopbarActionsProps = {
    ...props.sidebarTopbarActionsProps,
    isPrimarySidebarVisible: true,
    primarySidebarToggleLabel: 'Hide primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const editorToggleButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-toggle-editor-btn');
    assert(editorToggleButton instanceof HTMLButtonElement);
    assert.equal(editorToggleButton.getAttribute('aria-label'), 'Collapse editor');

    editorToggleButton.click();
    view.setProps(materializeWorkbenchLayoutViewProps(syncRawPropsWithLayoutState(props)));

    assert.equal(props.isAgentSidebarVisible, false);
    assert.equal(props.isEditorCollapsed, true);

    const primaryToggleButton = view
      .getElement()
      .querySelector('.primarybar-topbar .editor-topbar-toggle-editor-btn');
    assert(primaryToggleButton instanceof HTMLButtonElement);
    assert.equal(primaryToggleButton.getAttribute('aria-label'), 'Expand editor');
    assert.equal(
      view
        .getElement()
        .querySelector('.editor-topbar .editor-topbar-toggle-editor-btn'),
      null,
    );
    assert.equal(
      view
        .getElement()
        .querySelector('.agentbar-topbar .editor-topbar-toggle-editor-btn'),
      null,
    );
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView remounts primary topbar actions from agentbar into editor topbar when both sidebars are hidden', () => {
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = false;
  props.isAgentSidebarVisible = true;
  props.sidebarTopbarActionsProps = {
    ...props.sidebarTopbarActionsProps,
    isPrimarySidebarVisible: false,
    primarySidebarToggleLabel: 'Show primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const inAgentbar = view
      .getElement()
      .querySelector('.agentbar-topbar .sidebar-topbar-actions-host');
    assert.equal(inAgentbar, props.sidebarTopbarActionsElement);
    assert.equal(
      view
        .getElement()
        .querySelector('.editor-topbar .sidebar-topbar-actions-host'),
      null,
    );

    const nextProps = {
      ...props,
      isPrimarySidebarVisible: false,
      isAgentSidebarVisible: false,
    };
    view.setProps(materializeWorkbenchLayoutViewProps(nextProps));

    const inEditor = view
      .getElement()
      .querySelector('.editor-topbar .sidebar-topbar-actions-host');
    assert.equal(inEditor, props.sidebarTopbarActionsElement);
    assert.equal(
      view
        .getElement()
        .querySelector('.agentbar-topbar .sidebar-topbar-actions-host'),
      null,
    );
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView applies editor topbar leading inset only when sidebars are hidden', () => {
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = false;
  props.isAgentSidebarVisible = false;

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const hiddenSidebarsTopbar = view
      .getElement()
      .querySelector('.editor-topbar');
    assert(hiddenSidebarsTopbar instanceof HTMLElement);
    assert.equal(
      hiddenSidebarsTopbar.classList.contains('has-leading-window-controls-inset'),
      true,
    );

    const primaryVisibleProps = {
      ...props,
      isPrimarySidebarVisible: true,
      isAgentSidebarVisible: false,
    };
    view.setProps(materializeWorkbenchLayoutViewProps(primaryVisibleProps));
    const primaryVisibleTopbar = view
      .getElement()
      .querySelector('.editor-topbar');
    assert(primaryVisibleTopbar instanceof HTMLElement);
    assert.equal(
      primaryVisibleTopbar.classList.contains('has-leading-window-controls-inset'),
      false,
    );

    const agentVisibleProps = {
      ...props,
      isPrimarySidebarVisible: false,
      isAgentSidebarVisible: true,
    };
    view.setProps(materializeWorkbenchLayoutViewProps(agentVisibleProps));
    const agentVisibleTopbar = view
      .getElement()
      .querySelector('.editor-topbar');
    assert(agentVisibleTopbar instanceof HTMLElement);
    assert.equal(
      agentVisibleTopbar.classList.contains('has-leading-window-controls-inset'),
      false,
    );
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView switches from content mode to settings mode using dedicated slots', () => {
  const props = createWorkbenchLayoutViewProps();
  props.mode = 'content';
  props.isPrimarySidebarVisible = true;
  props.isAgentSidebarVisible = false;
  props.sidebarTopbarActionsProps = {
    ...props.sidebarTopbarActionsProps,
    isPrimarySidebarVisible: true,
    primarySidebarToggleLabel: 'Hide primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  };
  props.sidebarTopbarActionsElement = createSidebarTopbarActionsElement({
    isPrimarySidebarVisible: true,
    primarySidebarToggleLabel: 'Hide primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  });

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const initialTopbarActionsHost = view
      .getElement()
      .querySelector('.primarybar-topbar .sidebar-topbar-actions-host');
    assert.equal(initialTopbarActionsHost, props.sidebarTopbarActionsElement);
    assert(
      view
        .getElement()
        .querySelector('.primarybar-content .pane-view') instanceof HTMLElement,
    );
    assert(
      view
        .getElement()
        .querySelector('.workbench-content-slot-editor .editor-frame') instanceof HTMLElement,
    );

    const settingsNavigationElement = document.createElement('aside');
    settingsNavigationElement.className = 'settings-navigation';
    settingsNavigationElement.textContent = 'Settings navigation';
    const settingsContentElement = document.createElement('div');
    settingsContentElement.className = 'settings-content';
    settingsContentElement.textContent = 'Settings content';
    const settingsTopbarActionsElement = createSettingsTopbarActionsElement('Back');

    const nextProps = {
      ...props,
      mode: 'settings' as const,
      isPrimarySidebarVisible: true,
      isAgentSidebarVisible: false,
      settingsNavigationElement,
      settingsTopbarActionsElement,
      settingsContentElement,
    };
    view.setProps(materializeWorkbenchLayoutViewProps(nextProps));

    const mountedTopbarActionsHost = view
      .getElement()
      .querySelector('.primarybar-topbar .sidebar-topbar-actions-host');
    assert.equal(mountedTopbarActionsHost, settingsTopbarActionsElement);
    assert.equal(
      view
        .getElement()
        .querySelector('.primarybar-topbar .sidebar-topbar-toggle-btn')
        ?.getAttribute('aria-label'),
      'Back',
    );
    assert.equal(
      view
        .getElement()
        .querySelector('.primarybar-content > .settings-navigation'),
      settingsNavigationElement,
    );
    assert.equal(
      view
        .getElement()
        .querySelector('.primarybar-content .pane-view'),
      null,
    );
    assert.equal(
      view
        .getElement()
        .querySelector('.workbench-content-slot-editor > .settings-content'),
      settingsContentElement,
    );
    assert.equal(
      view
        .getElement()
        .querySelector('.workbench-content-slot-agent .agentbar-panel'),
      null,
    );
    assert.equal(view.getElement().contains(props.sidebarTopbarActionsElement), false);
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView keeps primary width when switching back from settings mode', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.mode = 'content';
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = true;
    props.isEditorCollapsed = false;
    props.primarySidebarSize = 320;
    props.agentSidebarSize = 360;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    };
    props.sidebarTopbarActionsElement = createSidebarTopbarActionsElement({
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    });

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    animationFrameSpy.flushAll();

    const initialGridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(initialGridView);
    const primarySizeBefore = initialGridView.getViewSize([0]);

    const settingsNavigationElement = document.createElement('aside');
    settingsNavigationElement.className = 'settings-navigation';
    settingsNavigationElement.textContent = 'Settings navigation';
    const settingsContentElement = document.createElement('div');
    settingsContentElement.className = 'settings-content';
    settingsContentElement.textContent = 'Settings content';
    const settingsTopbarActionsElement = createSettingsTopbarActionsElement('Back');

    const settingsProps = {
      ...props,
      mode: 'settings' as const,
      isPrimarySidebarVisible: true,
      isAgentSidebarVisible: false,
      settingsNavigationElement,
      settingsTopbarActionsElement,
      settingsContentElement,
    };
    view.setProps(materializeWorkbenchLayoutViewProps(settingsProps));
    animationFrameSpy.flushAll();

    const backToContentProps = {
      ...props,
      mode: 'content' as const,
      isPrimarySidebarVisible: true,
      isAgentSidebarVisible: true,
      settingsNavigationElement: null,
      settingsTopbarActionsElement: null,
      settingsContentElement: null,
    };
    view.setProps(materializeWorkbenchLayoutViewProps(backToContentProps));
    animationFrameSpy.flushAll();

    const finalGridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(finalGridView);
    assert.equal(finalGridView.getViewSize([0]), primarySizeBefore);

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView renders an add dropdown before the collapse action and dispatches open requests', async () => {
  const calls: Array<{ kind: string; disposition: string }> = [];
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    onOpenEditor: (request: EditorOpenRequest) => {
      calls.push({
        kind: request.kind,
        disposition: request.disposition,
      });
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const actionButtons = Array.from(
      view.getElement().querySelectorAll(
        '.editor-topbar .editor-topbar-add-btn, .editor-topbar .editor-topbar-toggle-editor-btn',
      ),
    );
    assert.equal(actionButtons.length, 2);
    assert.equal(actionButtons[0]?.classList.contains('editor-topbar-add-btn'), true);
    assert.equal(actionButtons[1]?.classList.contains('editor-topbar-toggle-editor-btn'), true);

    const addButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-add-btn');
    assert(addButton instanceof HTMLButtonElement);
    assert.equal(addButton.getAttribute('aria-label'), 'Add');

    for (const [label, expectedCall] of [
      ['Draft', { kind: 'draft', disposition: 'reveal-or-open' }],
      ['Browser', { kind: 'browser', disposition: 'reveal-or-open' }],
      ['Read', { kind: 'pdf', disposition: 'reveal-or-open' }],
    ] as const) {
      addButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const menu = document.body.querySelector('.dropdown-menu');
      assert(menu instanceof HTMLElement);
      assert.equal(menu.getAttribute('data-menu'), 'editor-topbar-add');
      const menuItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
        (node) => node.textContent?.includes(label),
      );
      assert(menuItem instanceof HTMLElement);
      menuItem.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      assert.deepEqual(calls.at(-1), expectedCall);
    }

    assert.deepEqual(calls, [
      { kind: 'draft', disposition: 'reveal-or-open' },
      { kind: 'browser', disposition: 'reveal-or-open' },
      { kind: 'pdf', disposition: 'reveal-or-open' },
    ]);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView renders the agent sidebar toggle between add and collapse in editor topbar', () => {
  let toggleAgentCount = 0;
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = true;
  props.isAgentSidebarVisible = true;
  props.editorPartProps = {
    ...props.editorPartProps,
    isAgentSidebarVisible: true,
    showAgentSidebarToggle: true,
    agentSidebarToggleLabel: 'Hide assistant',
    onToggleAgentSidebar: () => {
      toggleAgentCount += 1;
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const actionButtons = Array.from(
      view.getElement().querySelectorAll(
        '.editor-topbar .editor-topbar-add-btn, .editor-topbar .editor-topbar-agent-btn, .editor-topbar .editor-topbar-toggle-editor-btn',
      ),
    );
    assert.equal(actionButtons.length, 3);
    assert.equal(actionButtons[0]?.classList.contains('editor-topbar-add-btn'), true);
    assert.equal(actionButtons[1]?.classList.contains('editor-topbar-agent-btn'), true);
    assert.equal(actionButtons[2]?.classList.contains('editor-topbar-toggle-editor-btn'), true);

    const agentButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-agent-btn');
    assert(agentButton instanceof HTMLButtonElement);
    assert.equal(agentButton.getAttribute('aria-label'), 'Hide assistant');
    agentButton.click();
    assert.equal(toggleAgentCount, 1);
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView keeps the agent toggle in editor topbar when the agent sidebar is hidden', () => {
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = true;
  props.isAgentSidebarVisible = false;
  props.editorPartProps = {
    ...props.editorPartProps,
    isAgentSidebarVisible: false,
    showAgentSidebarToggle: true,
    agentSidebarToggleLabel: 'Show assistant',
    onToggleAgentSidebar: () => {},
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const editorAgentButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-agent-btn');
    assert(editorAgentButton instanceof HTMLButtonElement);
    assert.equal(editorAgentButton.getAttribute('aria-label'), 'Show assistant');

    const primaryAgentButton = view
      .getElement()
      .querySelector('.primarybar-topbar .editor-topbar-agent-btn');
    assert.equal(primaryAgentButton, null);
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView add dropdown supports search header filtering', async () => {
  const props = createWorkbenchLayoutViewProps();
  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const addButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-add-btn');
    assert(addButton instanceof HTMLButtonElement);

    addButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const menu = document.body.querySelector('.dropdown-menu[data-menu=\"editor-topbar-add\"]');
    assert(menu instanceof HTMLElement);
    const searchInput = menu.querySelector('.ls-menu-header .dropdown-menu-search-input .input');
    assert(searchInput instanceof HTMLInputElement);

    searchInput.value = 'bro';
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    const menuItemLabels = Array.from(
      menu.querySelectorAll('.dropdown-menu-item .dropdown-menu-item-content'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(menuItemLabels, ['Browser']);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView renders the browser toolbar below the editor topbar', () => {
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-1',
        kind: 'browser',
        title: 'Example',
        url: 'https://example.com/current',
      },
    ],
    activeTabId: 'browser-tab-1',
    activeTab: {
      id: 'browser-tab-1',
      kind: 'browser',
      title: 'Example',
      url: 'https://example.com/current',
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: 'https://example.com/current',
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const editorFrame = view.getElement().querySelector('.editor-frame');
    assert(editorFrame instanceof HTMLElement);

    const topbar = editorFrame.querySelector('.editor-topbar');
    assert(topbar instanceof HTMLElement);
    const toolbarHost = editorFrame.querySelector(':scope > .editor-toolbar');
    assert(toolbarHost instanceof HTMLElement);
    assert.equal(toolbarHost.hidden, false);
    assert.equal(getEditorFrameSlot(toolbarHost), EDITOR_FRAME_SLOTS.toolbar);
    assert.equal(toolbarHost.dataset.toolbarMode, 'browser');

    const toolbar = editorFrame.querySelector('.editor-toolbar .editor-browser-toolbar');
    assert(toolbar instanceof HTMLElement);
    assert.equal(topbar.nextElementSibling, toolbar.parentElement);

    const leadingButtons = Array.from(
      toolbar.querySelectorAll('.editor-browser-toolbar-leading .editor-browser-toolbar-btn'),
    );
    assert.deepEqual(
      leadingButtons.map((button) => button.getAttribute('aria-label')),
      ['Source menu', 'Back', 'Forward', 'Refresh', 'Favorite'],
    );

    const addressInput = toolbar.querySelector('.editor-browser-toolbar-address-input input');
    assert(addressInput instanceof HTMLInputElement);
    assert.equal(addressInput.getAttribute('aria-label'), 'Address bar');
    assert.equal(addressInput.value, 'https://example.com/current');

    const trailingButtons = Array.from(
      toolbar.querySelectorAll('.editor-browser-toolbar-trailing .editor-browser-toolbar-btn'),
    );
    assert.deepEqual(
      trailingButtons.map((button) => button.getAttribute('aria-label')),
      ['Archive page', 'More'],
    );
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView shows browser library panel entries and navigates when a favorite is selected', async () => {
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const addressChanges: string[] = [];
  let navigateCount = 0;
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-history',
        kind: 'browser',
        title: 'Example',
        url: 'https://example.com/current',
      },
    ],
    activeTabId: 'browser-tab-history',
    activeTab: {
      id: 'browser-tab-history',
      kind: 'browser',
      title: 'Example',
      url: 'https://example.com/current',
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: 'https://example.com/current',
      browserPageTitle: 'Example Current Page',
      browserFaviconUrl: 'https://example.com/favicon.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
    onToolbarAddressChange: (value: string) => {
      addressChanges.push(value);
    },
    onToolbarNavigateToUrl: (value: string) => {
      addressChanges.push(value);
      navigateCount += 1;
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    let favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    assert.equal(favoriteButton.getAttribute('aria-pressed'), 'false');
    assert(
      favoriteButton.querySelector('.lx-icon-favorite') instanceof HTMLElement,
    );
    favoriteButton.click();
    favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    assert.equal(favoriteButton.getAttribute('aria-pressed'), 'true');
    const favoriteItem = favoriteButton.closest('.actionbar-item');
    assert(favoriteItem instanceof HTMLElement);
    assert.equal(favoriteItem.classList.contains('is-active'), false);
    assert.equal(favoriteItem.classList.contains('is-checked'), false);
    assert(
      favoriteButton.querySelector('.lx-icon-favorite-filled') instanceof HTMLElement,
    );

    const sourcesButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Source menu"]');
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    assert.equal(panel.classList.contains('is-open'), true);
    assert.equal(
      panel.classList.contains('is-desktop-overlay'),
      true,
    );
    const panelBackdrop = document.body.querySelector(
      '.editor-browser-library-panel-backdrop',
    );
    assert(panelBackdrop instanceof HTMLElement);
    assert.equal(panelBackdrop.classList.contains('is-open'), true);

    const favoriteItems = Array.from(
      panel.querySelectorAll('.editor-browser-library-item.is-favorite'),
    );
    assert.equal(favoriteItems.length, 1);
    const sectionTitles = Array.from(
      panel.querySelectorAll('.editor-browser-library-section-title'),
    );
    assert.equal(
      sectionTitles.some((node) => node.textContent === 'Favorites'),
      true,
    );
    assert.equal(
      sectionTitles.some((node) => node.textContent === 'Today'),
      true,
    );
    const matchingItems = panel.querySelectorAll(
      '.editor-browser-library-item[title="https://example.com/current"]',
    );
    assert.equal(matchingItems.length, 2);
    const favoriteFavicon = favoriteItems[0]?.querySelector(
      '.editor-browser-library-item-favicon',
    );
    assert(favoriteFavicon instanceof HTMLElement);
    assert.equal(favoriteFavicon.tagName, 'IMG');
    assert.equal(favoriteFavicon.getAttribute('src'), 'https://example.com/favicon.ico');
    const favoriteTitle = favoriteItems[0]?.querySelector(
      '.editor-browser-library-item-title',
    );
    assert(favoriteTitle instanceof HTMLElement);
    assert.equal(favoriteTitle.textContent, 'Example Current Page');

    const [sourceItem] = favoriteItems;
    assert(sourceItem instanceof HTMLButtonElement);
    sourceItem.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(addressChanges.at(-1), 'https://example.com/current');
    assert.equal(navigateCount, 1);
    assert.equal(panel.classList.contains('is-open'), false);
    assert.equal(
      panel.classList.contains('is-desktop-overlay'),
      true,
    );
    assert.equal(panelBackdrop.classList.contains('is-open'), false);
  } finally {
    view.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('WorkbenchLayoutView opens the favorite item context menu and dispatches Open', async () => {
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const FAVORITE_URL = 'https://example.com/current-context-open';
  const FAVORITE_TITLE = 'Example Context Open Page';
  const addressChanges: string[] = [];
  let navigateCount = 0;
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-favorite-context-open',
        kind: 'browser',
        title: 'Example',
        url: FAVORITE_URL,
      },
    ],
    activeTabId: 'browser-tab-favorite-context-open',
    activeTab: {
      id: 'browser-tab-favorite-context-open',
      kind: 'browser',
      title: 'Example',
      url: FAVORITE_URL,
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: FAVORITE_URL,
      browserPageTitle: FAVORITE_TITLE,
      browserFaviconUrl: 'https://example.com/favicon.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
    onToolbarNavigateToUrl: (value: string) => {
      addressChanges.push(value);
      navigateCount += 1;
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    favoriteButton.click();

    const sourcesButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Source menu"]');
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await waitForNextTask();
    await waitForNextTask();

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    const favoriteItem = Array.from(
      panel.querySelectorAll('.editor-browser-library-item.is-favorite'),
    )[0];
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
    const menuItems = Array.from(menu.querySelectorAll('.dropdown-menu-item'));
    assert.deepEqual(
      menuItems.map((node) => node.textContent?.trim()),
      ['Open', 'Open in New Tab', 'New Folder', 'Rename', 'Remove Favorite'],
    );

    const openItem = menuItems.find((node) => node.textContent?.trim() === 'Open');
    assert(openItem instanceof HTMLElement);
    openItem.click();
    await waitForNextTask();

    assert.equal(addressChanges.at(-1), FAVORITE_URL);
    assert.equal(navigateCount, 1);
    assert.equal(panel.classList.contains('is-open'), false);
  } finally {
    view.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('WorkbenchLayoutView keeps favorite context menu Open in New Tab enabled from the browser toolbar path', async () => {
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const FAVORITE_URL = 'https://example.com/current-context-open-new-tab';
  const FAVORITE_TITLE = 'Example Context Open New Tab Page';
  const openedInNewTab: string[] = [];
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-favorite-context-open-new-tab',
        kind: 'browser',
        title: 'Example',
        url: FAVORITE_URL,
      },
    ],
    activeTabId: 'browser-tab-favorite-context-open-new-tab',
    activeTab: {
      id: 'browser-tab-favorite-context-open-new-tab',
      kind: 'browser',
      title: 'Example',
      url: FAVORITE_URL,
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: FAVORITE_URL,
      browserPageTitle: FAVORITE_TITLE,
      browserFaviconUrl: 'https://example.com/favicon.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
    onOpenEditor: (request: EditorOpenRequest) => {
      if (
        request.kind === 'browser' &&
        request.disposition === 'new-tab' &&
        request.url
      ) {
        openedInNewTab.push(request.url);
      }
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    favoriteButton.click();

    const sourcesButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Source menu"]');
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await waitForNextTask();
    await waitForNextTask();

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    const favoriteItem = Array.from(
      panel.querySelectorAll('.editor-browser-library-item.is-favorite'),
    )[0];
    assert(favoriteItem instanceof HTMLButtonElement);

    favoriteItem.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 30,
      clientY: 30,
    }));
    await waitForNextTask();

    const menu = document.body.querySelector(
      '.dropdown-menu[data-menu="editor-browser-library-favorite-item"]',
    );
    assert(menu instanceof HTMLElement);
    const openInNewTabItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.trim() === 'Open in New Tab',
    );
    assert(openInNewTabItem instanceof HTMLElement);
    assert.equal(openInNewTabItem.getAttribute('aria-disabled'), 'false');

    openInNewTabItem.click();
    await waitForNextTask();

    assert.deepEqual(openedInNewTab, [FAVORITE_URL]);
    assert.equal(panel.classList.contains('is-open'), false);
  } finally {
    view.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('WorkbenchLayoutView shows a filled favorite icon after loading a favorite from the source menu', async () => {
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const CURRENT_URL = 'https://example.com/current-before-favorite-load';
  const FAVORITE_URL = 'https://cn.bing.com/search?q=pdf+reader+github+project&form=QBLH';
  const LOADED_FAVORITE_URL =
    'https://www.bing.com/search?form=QBRE&q=pdf%20reader%20github%20project&cvid=abc123';
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-favorite-load',
        kind: 'browser',
        title: 'Favorite article',
        url: FAVORITE_URL,
      },
    ],
    activeTabId: 'browser-tab-favorite-load',
    activeTab: {
      id: 'browser-tab-favorite-load',
      kind: 'browser',
      title: 'Favorite article',
      url: FAVORITE_URL,
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: FAVORITE_URL,
      browserPageTitle: 'Favorite article',
      browserFaviconUrl: 'https://example.com/favorite.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
  };

  let view: ReturnType<typeof createWorkbenchLayoutView> | null = null;
  const showCurrentUrl = () => {
    view?.setProps(materializeWorkbenchLayoutViewProps({
      ...props,
      editorPartProps: {
        ...props.editorPartProps,
        tabs: [
          {
            id: 'browser-tab-favorite-load',
            kind: 'browser',
            title: 'Current article',
            url: CURRENT_URL,
          },
        ],
        activeTabId: 'browser-tab-favorite-load',
        activeTab: {
          id: 'browser-tab-favorite-load',
          kind: 'browser',
          title: 'Current article',
          url: CURRENT_URL,
        },
        viewPartProps: {
          ...props.editorPartProps.viewPartProps,
          browserUrl: CURRENT_URL,
          browserPageTitle: 'Current article',
          browserFaviconUrl: 'https://example.com/current.ico',
          electronRuntime: true,
          webContentRuntime: true,
        },
      },
    }));
  };

  props.editorPartProps.onToolbarNavigateToUrl = () => {
    view?.setProps(materializeWorkbenchLayoutViewProps({
      ...props,
      editorPartProps: {
        ...props.editorPartProps,
        tabs: [
          {
            id: 'browser-tab-favorite-load',
            kind: 'browser',
            title: 'Current article',
            url: CURRENT_URL,
          },
        ],
        activeTabId: 'browser-tab-favorite-load',
        activeTab: {
          id: 'browser-tab-favorite-load',
          kind: 'browser',
          title: 'Current article',
          url: CURRENT_URL,
        },
        viewPartProps: {
          ...props.editorPartProps.viewPartProps,
          browserUrl: LOADED_FAVORITE_URL,
          browserPageTitle: 'Favorite article',
          browserFaviconUrl: 'https://example.com/favorite.ico',
          electronRuntime: true,
          webContentRuntime: true,
        },
      },
    }));
  };

  view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    let favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    favoriteButton.click();

    showCurrentUrl();

    favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    assert.equal(favoriteButton.getAttribute('aria-pressed'), 'false');

    const sourcesButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Source menu"]');
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await waitForNextTask();
    await waitForNextTask();

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    const favoriteItem = Array.from(
      panel.querySelectorAll('.editor-browser-library-item.is-favorite'),
    ).find((item) => item.getAttribute('title') === FAVORITE_URL);
    assert(favoriteItem instanceof HTMLButtonElement);
    favoriteItem.click();
    await waitForNextTask();

    favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    assert.equal(favoriteButton.getAttribute('aria-pressed'), 'true');
    assert(
      favoriteButton.querySelector('.lx-icon-favorite-filled') instanceof HTMLElement,
    );
  } finally {
    view?.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('WorkbenchLayoutView keeps the toolbar favorite icon in sync when a current favorite is removed from the source menu', async () => {
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const FAVORITE_URL = 'https://example.com/current-remove-favorite-sync';
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-favorite-remove-sync',
        kind: 'browser',
        title: 'Example',
        url: FAVORITE_URL,
      },
    ],
    activeTabId: 'browser-tab-favorite-remove-sync',
    activeTab: {
      id: 'browser-tab-favorite-remove-sync',
      kind: 'browser',
      title: 'Example',
      url: FAVORITE_URL,
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: FAVORITE_URL,
      browserPageTitle: 'Example Remove Favorite Sync Page',
      browserFaviconUrl: 'https://example.com/favicon.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    let favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    favoriteButton.click();

    favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    assert.equal(favoriteButton.getAttribute('aria-pressed'), 'true');
    assert(
      favoriteButton.querySelector('.lx-icon-favorite-filled') instanceof HTMLElement,
    );

    const sourcesButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Source menu"]');
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await waitForNextTask();
    await waitForNextTask();

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    const favoriteItem = Array.from(
      panel.querySelectorAll(`.editor-browser-library-item.is-favorite[title="${FAVORITE_URL}"]`),
    )[0];
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
    const removeFavoriteItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.trim() === 'Remove Favorite',
    );
    assert(removeFavoriteItem instanceof HTMLElement);
    removeFavoriteItem.click();
    await waitForNextTask();
    await waitForNextTask();

    favoriteButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Favorite"]');
    assert(favoriteButton instanceof HTMLButtonElement);
    assert.equal(favoriteButton.getAttribute('aria-pressed'), 'false');
    assert(
      favoriteButton.querySelector('.lx-icon-favorite') instanceof HTMLElement,
    );
  } finally {
    view.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('EditorBrowserLibraryPanel keeps the recent item and creates a separate favorite item when favorited', async () => {
  const { EditorBrowserLibraryPanel } = await import(
    'ls/workbench/browser/parts/editor/editorBrowserLibraryPanel'
  );
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const FAVORITE_URL = 'https://example.com/current-duplicate-item';
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const host = document.createElement('div');
  document.body.append(host);
  const panel = new EditorBrowserLibraryPanel({
    browserUrl: FAVORITE_URL,
    browserPageTitle: 'Move Node',
    browserFaviconUrl: 'https://example.com/favicon.ico',
    browserTabTitle: 'Move Node',
    labels: {
      title: 'Source menu',
      recentTitle: 'Recent',
      recentTodayTitle: 'Today',
      recentYesterdayTitle: 'Yesterday',
      recentLast7DaysTitle: 'Last 7 Days',
      recentLast30DaysTitle: 'Last 30 Days',
      recentOlderTitle: 'Older',
      favoritesTitle: 'Favorites',
      emptyState: 'No links yet',
      contextOpen: 'Open',
      contextOpenInNewTab: 'Open in New Tab',
      contextNewFolder: 'New Folder',
      contextRename: 'Rename',
      contextRemoveFavorite: 'Remove Favorite',
    },
    onNavigateToUrl: () => {},
  });
  panel.mountTo(host);
  panel.setOpen(true);

  try {
    await waitForNextTask();
    await waitForNextTask();

    const panelElement = panel.getElement();
    const beforeItems = panelElement.querySelectorAll(
      `.editor-browser-library-item[title="${FAVORITE_URL}"]`,
    );
    assert.equal(beforeItems.length, 1);

    panel.toggleCurrentBrowserUrlFavorite();
    await waitForNextTask();
    await waitForNextTask();

    const matchingItems = panelElement.querySelectorAll(
      `.editor-browser-library-item[title="${FAVORITE_URL}"]`,
    );
    assert.equal(matchingItems.length, 2);
    const favoriteItems = panelElement.querySelectorAll(
      `.editor-browser-library-item.is-favorite[title="${FAVORITE_URL}"]`,
    );
    assert.equal(favoriteItems.length, 1);
    const recentItems = panelElement.querySelectorAll(
      `.editor-browser-library-item[title="${FAVORITE_URL}"]:not(.is-favorite)`,
    );
    assert.equal(recentItems.length, 1);
    assert.notEqual(favoriteItems[0], recentItems[0]);

    const favoriteItemRow = favoriteItems[0]?.closest('.editor-browser-library-item-row');
    assert(favoriteItemRow instanceof HTMLElement);
    assert.equal(favoriteItemRow.classList.contains('is-deletable'), false);
    assert.equal(favoriteItemRow.querySelector('.editor-browser-library-item-delete-btn'), null);

    const recentItemRow = recentItems[0]?.closest('.editor-browser-library-item-row');
    assert(recentItemRow instanceof HTMLElement);
    assert.equal(recentItemRow.classList.contains('is-deletable'), true);
    assert(
      recentItemRow.querySelector('.editor-browser-library-item-delete-btn')
        instanceof HTMLButtonElement,
    );

    const sectionTitles = Array.from(
      panelElement.querySelectorAll('.editor-browser-library-section-title'),
    );
    assert.equal(
      sectionTitles.some((node) => node.textContent === 'Favorites'),
      true,
    );
    assert.equal(
      sectionTitles.some((node) => node.textContent === 'Today'),
      true,
    );
    const sectionItemCount = panelElement.querySelectorAll(
      `.editor-browser-library-item[title="${FAVORITE_URL}"]`,
    );
    assert.equal(sectionItemCount.length, 2);
  } finally {
    panel.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('EditorBrowserLibraryPanel favorite item context menu can rename, group, open in new tab, and remove the favorite', async () => {
  const { EditorBrowserLibraryPanel } = await import(
    'ls/workbench/browser/parts/editor/editorBrowserLibraryPanel'
  );
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const FAVORITE_URL = 'https://example.com/current-context-actions';
  const FAVORITE_TITLE = 'Example Context Actions Page';
  const openedInNewTab: string[] = [];
  let renameRequestCount = 0;
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const host = document.createElement('div');
  document.body.append(host);
  const panel = new EditorBrowserLibraryPanel({
    browserUrl: FAVORITE_URL,
    browserPageTitle: FAVORITE_TITLE,
    browserFaviconUrl: 'https://example.com/favicon.ico',
    browserTabTitle: 'Example',
    labels: {
      title: 'Source menu',
      recentTitle: 'Recent',
      recentTodayTitle: 'Today',
      recentYesterdayTitle: 'Yesterday',
      recentLast7DaysTitle: 'Last 7 Days',
      recentLast30DaysTitle: 'Last 30 Days',
      recentOlderTitle: 'Older',
      favoritesTitle: 'Favorites',
      emptyState: 'No links yet',
      contextOpen: 'Open',
      contextOpenInNewTab: 'Open in New Tab',
      contextNewFolder: 'New Folder',
      contextRename: 'Rename',
      contextRemoveFavorite: 'Remove Favorite',
    },
    onNavigateToUrl: () => {},
    onOpenEditor: (request) => {
      if (
        request.kind === 'browser' &&
        request.disposition === 'new-tab' &&
        request.url
      ) {
        openedInNewTab.push(request.url);
      }
    },
    onRequestRenameFavorite: async () => {
      renameRequestCount += 1;
      return 'Pinned Example';
    },
    onRequestCreateFavoriteFolder: async () => 'Reading List',
  });
  panel.mountTo(host);
  panel.toggleCurrentBrowserUrlFavorite();
  panel.setOpen(true);

  try {
    await waitForNextTask();
    await waitForNextTask();

    const panelElement = panel.getElement();
    const favoriteItemSelector = `.editor-browser-library-item.is-favorite[title="${FAVORITE_URL}"]`;
    const anyItemSelector = `.editor-browser-library-item[title="${FAVORITE_URL}"]`;
    let favoriteItem = panelElement.querySelector(favoriteItemSelector);
    assert(favoriteItem instanceof HTMLButtonElement);
    favoriteItem.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 28,
      clientY: 28,
    }));
    await waitForNextTask();

    let menu = document.body.querySelector(
      '.dropdown-menu[data-menu="editor-browser-library-favorite-item"]',
    );
    assert(menu instanceof HTMLElement);
    let renameItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.trim() === 'Rename',
    );
    assert(renameItem instanceof HTMLElement);
    renameItem.click();
    await waitForNextTask();
    await waitForNextTask();

    assert.equal(renameRequestCount, 1);

    favoriteItem = panelElement.querySelector(favoriteItemSelector);
    assert(favoriteItem instanceof HTMLButtonElement);
    let favoriteTitle = favoriteItem.querySelector('.editor-browser-library-item-title');
    assert(favoriteTitle instanceof HTMLElement);
    assert.equal(favoriteTitle.textContent, 'Pinned Example');

    favoriteItem = panelElement.querySelector(favoriteItemSelector);
    assert(favoriteItem instanceof HTMLButtonElement);
    favoriteItem.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 32,
      clientY: 32,
    }));
    await waitForNextTask();

    menu = document.body.querySelector(
      '.dropdown-menu[data-menu="editor-browser-library-favorite-item"]',
    );
    assert(menu instanceof HTMLElement);
    let newFolderItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.trim() === 'New Folder',
    );
    assert(newFolderItem instanceof HTMLElement);
    newFolderItem.click();
    await waitForNextTask();
    await waitForNextTask();

    const folderTitle = panelElement.querySelector('.editor-browser-library-folder-title');
    assert(folderTitle instanceof HTMLElement);
    assert.equal(folderTitle.textContent, 'Reading List');
    favoriteItem = panelElement.querySelector(favoriteItemSelector);
    assert(favoriteItem instanceof HTMLButtonElement);
    favoriteTitle = favoriteItem.querySelector('.editor-browser-library-item-title');
    assert(favoriteTitle instanceof HTMLElement);
    assert.equal(favoriteTitle.textContent, 'Pinned Example');

    favoriteItem = panelElement.querySelector(favoriteItemSelector);
    assert(favoriteItem instanceof HTMLButtonElement);
    favoriteItem.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 36,
      clientY: 36,
    }));
    await waitForNextTask();

    menu = document.body.querySelector(
      '.dropdown-menu[data-menu="editor-browser-library-favorite-item"]',
    );
    assert(menu instanceof HTMLElement);
    let openInNewTabItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.trim() === 'Open in New Tab',
    );
    assert(openInNewTabItem instanceof HTMLElement);
    openInNewTabItem.click();
    await waitForNextTask();

    assert.deepEqual(openedInNewTab, [FAVORITE_URL]);
    assert.equal(panelElement.classList.contains('is-open'), false);

    panel.setOpen(true);
    await waitForNextTask();
    await waitForNextTask();

    favoriteItem = panelElement.querySelector(favoriteItemSelector);
    assert(favoriteItem instanceof HTMLButtonElement);
    favoriteItem.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX: 40,
      clientY: 40,
    }));
    await waitForNextTask();

    menu = document.body.querySelector(
      '.dropdown-menu[data-menu="editor-browser-library-favorite-item"]',
    );
    assert(menu instanceof HTMLElement);
    let removeFavoriteItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.trim() === 'Remove Favorite',
    );
    assert(removeFavoriteItem instanceof HTMLElement);
    removeFavoriteItem.click();
    await waitForNextTask();
    await waitForNextTask();

    assert.equal(
      panelElement.querySelector(favoriteItemSelector),
      null,
    );
    const folderTitles = Array.from(
      panelElement.querySelectorAll('.editor-browser-library-folder-title'),
    ).map((node) => node.textContent);
    assert.equal(folderTitles.includes('Reading List'), false);
    const recentItem = panelElement.querySelector(anyItemSelector);
    assert(recentItem instanceof HTMLButtonElement);
    assert.equal(recentItem.classList.contains('is-favorite'), false);
    const recentTitle = recentItem.querySelector('.editor-browser-library-item-title');
    assert(recentTitle instanceof HTMLElement);
    assert.equal(recentTitle.textContent, FAVORITE_TITLE);
  } finally {
    panel.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('EditorBrowserLibraryPanel groups recent history by visit time buckets instead of showing everything as today', async () => {
  const { EditorBrowserLibraryPanel } = await import(
    'ls/workbench/browser/parts/editor/editorBrowserLibraryPanel'
  );
  const realDateNow = Date.now;
  const baseNow = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  const host = document.createElement('div');
  document.body.append(host);
  const panel = new EditorBrowserLibraryPanel({
    browserUrl: '',
    labels: {
      title: 'Source menu',
      recentTitle: 'Recent',
      recentTodayTitle: 'Today',
      recentYesterdayTitle: 'Yesterday',
      recentLast7DaysTitle: 'Last 7 Days',
      recentLast30DaysTitle: 'Last 30 Days',
      recentOlderTitle: 'Older',
      favoritesTitle: 'Favorites',
      emptyState: 'No links yet',
      contextOpen: 'Open',
      contextOpenInNewTab: 'Open in New Tab',
      contextNewFolder: 'New Folder',
      contextRename: 'Rename',
      contextRemoveFavorite: 'Remove Favorite',
    },
    onNavigateToUrl: () => {},
  });
  panel.mountTo(host);
  panel.setOpen(true);

  try {
    panel.clearRecentLibraryEntries();

    Date.now = () => baseNow - 45 * DAY_MS;
    panel.setContext({
      browserUrl: 'https://example.com/older',
      browserPageTitle: 'Older article',
      browserTabTitle: 'Older article',
      labels: {
        title: 'Source menu',
        recentTitle: 'Recent',
        recentTodayTitle: 'Today',
        recentYesterdayTitle: 'Yesterday',
        recentLast7DaysTitle: 'Last 7 Days',
        recentLast30DaysTitle: 'Last 30 Days',
        recentOlderTitle: 'Older',
        favoritesTitle: 'Favorites',
        emptyState: 'No links yet',
        contextOpen: 'Open',
        contextOpenInNewTab: 'Open in New Tab',
        contextNewFolder: 'New Folder',
        contextRename: 'Rename',
        contextRemoveFavorite: 'Remove Favorite',
      },
      onNavigateToUrl: () => {},
    });

    Date.now = () => baseNow - 14 * DAY_MS;
    panel.setContext({
      browserUrl: 'https://example.com/last-30-days',
      browserPageTitle: 'Two weeks ago article',
      browserTabTitle: 'Two weeks ago article',
      labels: {
        title: 'Source menu',
        recentTitle: 'Recent',
        recentTodayTitle: 'Today',
        recentYesterdayTitle: 'Yesterday',
        recentLast7DaysTitle: 'Last 7 Days',
        recentLast30DaysTitle: 'Last 30 Days',
        recentOlderTitle: 'Older',
        favoritesTitle: 'Favorites',
        emptyState: 'No links yet',
        contextOpen: 'Open',
        contextOpenInNewTab: 'Open in New Tab',
        contextNewFolder: 'New Folder',
        contextRename: 'Rename',
        contextRemoveFavorite: 'Remove Favorite',
      },
      onNavigateToUrl: () => {},
    });

    Date.now = () => baseNow;
    panel.setContext({
      browserUrl: 'https://example.com/today',
      browserPageTitle: 'Today article',
      browserTabTitle: 'Today article',
      labels: {
        title: 'Source menu',
        recentTitle: 'Recent',
        recentTodayTitle: 'Today',
        recentYesterdayTitle: 'Yesterday',
        recentLast7DaysTitle: 'Last 7 Days',
        recentLast30DaysTitle: 'Last 30 Days',
        recentOlderTitle: 'Older',
        favoritesTitle: 'Favorites',
        emptyState: 'No links yet',
        contextOpen: 'Open',
        contextOpenInNewTab: 'Open in New Tab',
        contextNewFolder: 'New Folder',
        contextRename: 'Rename',
        contextRemoveFavorite: 'Remove Favorite',
      },
      onNavigateToUrl: () => {},
    });

    await waitForNextTask();
    await waitForNextTask();

    const panelElement = panel.getElement();
    const sectionTitles = Array.from(
      panelElement.querySelectorAll('.editor-browser-library-section-title'),
    ).map((node) => node.textContent?.trim());
    assert.equal(sectionTitles.includes('Today'), true);
    assert.equal(sectionTitles.includes('Last 30 Days'), true);
    assert.equal(sectionTitles.includes('Older'), true);

    const recentItemTitles = Array.from(
      panelElement.querySelectorAll('.editor-browser-library-item-title'),
    ).map((node) => node.textContent?.trim());
    assert.equal(recentItemTitles.includes('Today article'), true);
    assert.equal(recentItemTitles.includes('Two weeks ago article'), true);
    assert.equal(recentItemTitles.includes('Older article'), true);
  } finally {
    Date.now = realDateNow;
    panel.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView removes a recent browser library entry without triggering navigation', async () => {
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const RECENT_ENTRY_URL = 'https://example.com/recent-delete-target';
  const RECENT_ENTRY_TITLE = 'Recent Delete Target';
  const addressChanges: string[] = [];
  let navigateCount = 0;
  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-recent-delete',
        kind: 'browser',
        title: 'Example',
        url: RECENT_ENTRY_URL,
      },
    ],
    activeTabId: 'browser-tab-recent-delete',
    activeTab: {
      id: 'browser-tab-recent-delete',
      kind: 'browser',
      title: 'Example',
      url: RECENT_ENTRY_URL,
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: RECENT_ENTRY_URL,
      browserPageTitle: RECENT_ENTRY_TITLE,
      browserFaviconUrl: 'https://example.com/favicon.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
    onToolbarAddressChange: (value: string) => {
      addressChanges.push(value);
    },
    onToolbarNavigateToUrl: (value: string) => {
      addressChanges.push(value);
      navigateCount += 1;
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const sourcesButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Source menu"]');
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    assert.equal(panel.classList.contains('is-open'), true);
    const recentItem = Array.from(
      panel.querySelectorAll('.editor-browser-library-item'),
    ).find((node) => {
      const titleElement = node.querySelector('.editor-browser-library-item-title');
      return titleElement?.textContent === RECENT_ENTRY_TITLE;
    });
    assert(recentItem instanceof HTMLButtonElement);
    const deleteButton = recentItem.parentElement?.querySelector(
      '.editor-browser-library-item-delete-btn',
    );
    assert(deleteButton instanceof HTMLButtonElement);
    deleteButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(navigateCount, 0);
    assert.deepEqual(addressChanges, []);
    const remainingItemTitles = Array.from(
      panel.querySelectorAll('.editor-browser-library-item-title'),
    ).map((node) => node.textContent ?? '');
    assert.equal(remainingItemTitles.includes(RECENT_ENTRY_TITLE), false);
    const serializedState = window.localStorage?.getItem(BROWSER_LIBRARY_STORAGE_KEY);
    assert(serializedState);
    const parsedState = JSON.parse(serializedState) as {
      recentUrls?: string[];
    };
    assert.equal((parsedState.recentUrls ?? []).includes(RECENT_ENTRY_URL), false);
  } finally {
    view.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('WorkbenchLayoutView keeps browser library titles scoped to each URL across tab-close metadata lag', async () => {
  const BROWSER_LIBRARY_STORAGE_KEY = 'ls.editor.browser.library.v1';
  const tabA = {
    id: 'browser-tab-history-a',
    kind: 'browser' as const,
    title: 'History Page A',
    url: 'https://example.com/history-a',
  };
  const tabB = {
    id: 'browser-tab-history-b',
    kind: 'browser' as const,
    title: 'History Page B',
    url: 'https://example.com/history-b',
  };
  const blankTab = {
    id: 'browser-tab-history-blank',
    kind: 'browser' as const,
    title: '',
    url: 'about:blank',
  };

  window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);

  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [tabA, tabB],
    activeTabId: tabB.id,
    activeTab: tabB,
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: tabB.url,
      browserPageTitle: tabB.title,
      browserFaviconUrl: 'https://example.com/history-b.ico',
      electronRuntime: true,
      webContentRuntime: true,
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    // Simulate a close-transition frame where URL has switched but page title is still stale.
    view.setProps(
      materializeWorkbenchLayoutViewProps({
        ...props,
        editorPartProps: {
          ...props.editorPartProps,
          tabs: [tabA],
          activeTabId: tabA.id,
          activeTab: tabA,
          viewPartProps: {
            ...props.editorPartProps.viewPartProps,
            browserUrl: tabA.url,
            browserPageTitle: tabB.title,
            browserFaviconUrl: 'https://example.com/history-a.ico',
            electronRuntime: true,
            webContentRuntime: true,
          },
        },
      }),
    );

    view.setProps(
      materializeWorkbenchLayoutViewProps({
        ...props,
        editorPartProps: {
          ...props.editorPartProps,
          tabs: [],
          activeTabId: null,
          activeTab: null,
          viewPartProps: {
            ...props.editorPartProps.viewPartProps,
            browserUrl: tabA.url,
            browserPageTitle: tabB.title,
            browserFaviconUrl: '',
            electronRuntime: true,
            webContentRuntime: true,
          },
        },
      }),
    );

    view.setProps(
      materializeWorkbenchLayoutViewProps({
        ...props,
        editorPartProps: {
          ...props.editorPartProps,
          tabs: [blankTab],
          activeTabId: blankTab.id,
          activeTab: blankTab,
          viewPartProps: {
            ...props.editorPartProps.viewPartProps,
            browserUrl: blankTab.url,
            browserPageTitle: '',
            browserFaviconUrl: '',
            electronRuntime: true,
            webContentRuntime: true,
          },
        },
      }),
    );

    const sourcesButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-leading [aria-label="Source menu"]');
    assert(sourcesButton instanceof HTMLButtonElement);
    sourcesButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const panel = document.body.querySelector('.editor-browser-library-panel');
    assert(panel instanceof HTMLElement);
    const itemTitlesByUrl = new Map(
      Array.from(panel.querySelectorAll('.editor-browser-library-item')).flatMap((node) => {
        if (!(node instanceof HTMLButtonElement)) {
          return [];
        }
        const title = node
          .querySelector('.editor-browser-library-item-title')
          ?.textContent
          ?.trim() ?? '';
        return [[node.title, title] as const];
      }),
    );

    assert.equal(itemTitlesByUrl.get(tabA.url), tabA.title);
    assert.equal(itemTitlesByUrl.get(tabB.url), tabB.title);
  } finally {
    view.dispose();
    document.body.replaceChildren();
    window.localStorage?.removeItem(BROWSER_LIBRARY_STORAGE_KEY);
  }
});

test('WorkbenchLayoutView opens the browser toolbar more menu and dispatches handlers', async () => {
  const calls: string[] = [];
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-1',
        kind: 'browser',
        title: 'Example',
        url: 'https://example.com/current',
      },
    ],
    activeTabId: 'browser-tab-1',
    activeTab: {
      id: 'browser-tab-1',
      kind: 'browser',
      title: 'Example',
      url: 'https://example.com/current',
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: 'https://example.com/current',
      electronRuntime: true,
      webContentRuntime: true,
    },
    onToolbarHardReload: () => {
      calls.push('hardReload');
    },
    onToolbarCopyCurrentUrl: () => {
      calls.push('copy');
    },
    onToolbarClearBrowsingHistory: () => {
      calls.push('clearHistory');
    },
    onToolbarClearCookies: () => {
      calls.push('clearCookies');
    },
    onToolbarClearCache: () => {
      calls.push('clearCache');
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const moreButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-trailing [aria-label="More"]');
    assert(moreButton instanceof HTMLElement);

    for (const label of [
      ['Hard reload', 'hardReload'],
      ['Copy current URL', 'copy'],
      ['Clear browsing history', 'clearHistory'],
      ['Clear cookies', 'clearCookies'],
      ['Clear cache', 'clearCache'],
    ].map(([entryLabel]) => entryLabel)) {
      moreButton.click();
      await new Promise((resolve) => setTimeout(resolve, 0));

      const menu = document.body.querySelector('.dropdown-menu');
      assert(menu instanceof HTMLElement);
      assert.equal(menu.getAttribute('data-menu'), 'editor-browser-toolbar-more');
      const menuItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
        (node) => node.textContent?.includes(label),
      );
      assert(menuItem instanceof HTMLElement);
      menuItem.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    assert.deepEqual(calls, [
      'hardReload',
      'copy',
      'clearHistory',
      'clearCookies',
      'clearCache',
    ]);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView dispatches the browser toolbar archive action', async () => {
  const calls: string[] = [];
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-1',
        kind: 'browser',
        title: 'Example',
        url: 'https://example.com/current',
      },
    ],
    activeTabId: 'browser-tab-1',
    activeTab: {
      id: 'browser-tab-1',
      kind: 'browser',
      title: 'Example',
      url: 'https://example.com/current',
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: 'https://example.com/current',
      electronRuntime: true,
      webContentRuntime: true,
    },
    onToolbarArchiveCurrentPage: () => {
      calls.push('archive');
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const archiveButton = view
      .getElement()
      .querySelector('.editor-browser-toolbar-trailing [aria-label="Archive page"]');
    assert(archiveButton instanceof HTMLButtonElement);

    archiveButton.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(calls, ['archive']);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView hides about:blank in the browser toolbar address input', () => {
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-blank',
        kind: 'browser',
        title: '',
        url: 'about:blank',
      },
    ],
    activeTabId: 'browser-tab-blank',
    activeTab: {
      id: 'browser-tab-blank',
      kind: 'browser',
      title: '',
      url: 'about:blank',
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: 'about:blank',
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const addressInput = view.getElement().querySelector(
      '.editor-browser-toolbar-address-input input',
    );
    assert(addressInput instanceof HTMLInputElement);
    assert.equal(addressInput.value, '');
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView syncs focused browser address input when it has not been edited', () => {
  const initialUrl = 'https://example.com/current';
  const updatedUrl = 'https://example.com/next';
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-sync',
        kind: 'browser',
        title: 'Example',
        url: initialUrl,
      },
    ],
    activeTabId: 'browser-tab-sync',
    activeTab: {
      id: 'browser-tab-sync',
      kind: 'browser',
      title: 'Example',
      url: initialUrl,
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: initialUrl,
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const initialAddressInput = view.getElement().querySelector(
      '.editor-browser-toolbar-address-input input',
    );
    assert(initialAddressInput instanceof HTMLInputElement);
    assert.equal(initialAddressInput.value, initialUrl);
    initialAddressInput.focus();

    view.setProps(
      materializeWorkbenchLayoutViewProps({
        ...props,
        editorPartProps: {
          ...props.editorPartProps,
          tabs: [
            {
              id: 'browser-tab-sync',
              kind: 'browser',
              title: 'Example',
              url: updatedUrl,
            },
          ],
          activeTabId: 'browser-tab-sync',
          activeTab: {
            id: 'browser-tab-sync',
            kind: 'browser',
            title: 'Example',
            url: updatedUrl,
          },
          viewPartProps: {
            ...props.editorPartProps.viewPartProps,
            browserUrl: updatedUrl,
          },
        },
      }),
    );

    const updatedAddressInput = view.getElement().querySelector(
      '.editor-browser-toolbar-address-input input',
    );
    assert(updatedAddressInput instanceof HTMLInputElement);
    assert.equal(updatedAddressInput.value, updatedUrl);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView keeps typed browser address input while focused during onChange rerenders', () => {
  const pastedUrl = 'https://example.com/pasted';
  let latestAddressValue = '';
  let view: ReturnType<typeof createWorkbenchLayoutView> | null = null;
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'browser-tab-blank',
        kind: 'browser',
        title: '',
        url: 'about:blank',
      },
    ],
    activeTabId: 'browser-tab-blank',
    activeTab: {
      id: 'browser-tab-blank',
      kind: 'browser',
      title: '',
      url: 'about:blank',
    },
    viewPartProps: {
      ...props.editorPartProps.viewPartProps,
      browserUrl: 'about:blank',
    },
    onToolbarAddressChange: (value: string) => {
      latestAddressValue = value;
      if (!view) {
        return;
      }

      view.setProps(
        materializeWorkbenchLayoutViewProps({
          ...props,
          editorPartProps: {
            ...props.editorPartProps,
            viewPartProps: {
              ...props.editorPartProps.viewPartProps,
              browserUrl: 'about:blank',
            },
          },
        }),
      );
    },
  };

  view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const addressInput = view.getElement().querySelector(
      '.editor-browser-toolbar-address-input input',
    );
    assert(addressInput instanceof HTMLInputElement);

    addressInput.focus();
    addressInput.value = pastedUrl;
    addressInput.dispatchEvent(new Event('input', { bubbles: true }));

    assert.equal(latestAddressValue, pastedUrl);
    assert.equal(addressInput.value, pastedUrl);

    addressInput.blur();
    assert.equal(addressInput.value, '');
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView shows the active-tab toolbar for draft tabs and pdf tabs', () => {
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'draft-tab-1',
        kind: 'draft',
        title: 'Draft',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
    ],
    activeTabId: 'draft-tab-1',
    activeTab: {
      id: 'draft-tab-1',
      kind: 'draft',
      title: 'Draft',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const toolbarHost = view.getElement().querySelector('.editor-frame > .editor-toolbar');
    assert(toolbarHost instanceof HTMLElement);
    assert.equal(toolbarHost.hidden, false);
    assert.equal(toolbarHost.dataset.toolbarMode, 'draft');
    const contentHost = view.getElement().querySelector('.editor-frame > .editor-content');
    assert(contentHost instanceof HTMLElement);
    assert.equal(getEditorFrameSlot(contentHost), EDITOR_FRAME_SLOTS.content);
    assert.equal(
      view.getElement().querySelector('.editor-toolbar .editor-browser-toolbar'),
      null,
    );
    const draftToolbar = view.getElement().querySelector('.editor-toolbar .editor-draft-toolbar');
    assert(draftToolbar instanceof HTMLElement);

    const nextProps = {
      ...props,
      editorPartProps: {
        ...props.editorPartProps,
        tabs: [
          {
            id: 'pdf-tab-1',
            kind: 'pdf',
            title: 'Paper.pdf',
            url: 'https://example.com/paper.pdf',
          },
        ],
        activeTabId: 'pdf-tab-1',
        activeTab: {
          id: 'pdf-tab-1',
          kind: 'pdf',
          title: 'Paper.pdf',
          url: 'https://example.com/paper.pdf',
        },
      },
    };
    view.setProps(materializeWorkbenchLayoutViewProps(nextProps));

    const pdfToolbar = view.getElement().querySelector('.editor-toolbar .editor-pdf-toolbar');
    assert.equal(toolbarHost.hidden, false);
    assert.equal(toolbarHost.dataset.toolbarMode, 'pdf');
    assert(pdfToolbar instanceof HTMLElement);
    assert.equal(
      view.getElement().querySelector('.editor-toolbar .editor-draft-toolbar'),
      null,
    );
    const pdfLeadingButtons = Array.from(
      pdfToolbar.querySelectorAll(
        '.editor-pdf-toolbar-leading .editor-pdf-toolbar-btn.actionbar-action[aria-label]',
      ),
    ).map((button) => button.getAttribute('aria-label'));
    const pdfTrailingButtons = Array.from(
      pdfToolbar.querySelectorAll(
        '.editor-pdf-toolbar-trailing .editor-pdf-toolbar-btn.actionbar-action[aria-label]',
      ),
    ).map((button) => button.getAttribute('aria-label'));
    assert.deepEqual(pdfLeadingButtons, [
      'Source menu',
      'Zoom out',
      'Zoom in',
      'Pagination',
      'Highlight',
      'Translate',
      'Erase',
      'Note',
    ]);
    assert.deepEqual(pdfTrailingButtons, ['Search', 'More']);
    const pdfPane = view.getElement().querySelector('.editor-content .editor-pdf-pane');
    assert(pdfPane instanceof HTMLElement);
    const pdfBody = pdfPane.querySelector(':scope > .editor-pdf-body');
    assert(pdfBody instanceof HTMLElement);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView mounts the draft editor content hierarchy inside editor-frame', () => {
  const props = createWorkbenchLayoutViewProps();
  props.editorPartProps = {
    ...props.editorPartProps,
    tabs: [
      {
        id: 'draft-tab-1',
        kind: 'draft',
        title: 'Draft',
        document: createEmptyWritingEditorDocument(),
        viewMode: 'draft',
      },
    ],
    activeTabId: 'draft-tab-1',
    activeTab: {
      id: 'draft-tab-1',
      kind: 'draft',
      title: 'Draft',
      document: createEmptyWritingEditorDocument(),
      viewMode: 'draft',
    },
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const editorFrame = view.getElement().querySelector('.editor-frame');
    assert(editorFrame instanceof HTMLElement);
    assert.deepEqual(
      Array.from(editorFrame.children).map((child) =>
        getEditorFrameSlot(child as HTMLElement) ?? '',
      ),
      [
        EDITOR_FRAME_SLOTS.topbar,
        EDITOR_FRAME_SLOTS.toolbar,
        EDITOR_FRAME_SLOTS.content,
      ],
    );

    const editorContent = editorFrame.querySelector(':scope > .editor-content.is-mode-draft');
    assert(editorContent instanceof HTMLElement);

    const draftPane = editorContent.querySelector(':scope > .editor-draft-pane');
    assert(draftPane instanceof HTMLElement);

    const proseMirrorSurface = draftPane.querySelector(':scope > .pm-editor-surface');
    assert(proseMirrorSurface instanceof HTMLElement);

    const proseMirrorRoot = proseMirrorSurface.querySelector('.ProseMirror');
    assert(proseMirrorRoot instanceof HTMLElement);
  } finally {
    view.dispose();
    document.body.replaceChildren();
  }
});

test('WorkbenchLayoutView mounts the editor collapse action into agentbar topbar even when the primary sidebar is visible', () => {
  const props = createWorkbenchLayoutViewProps();
  props.isPrimarySidebarVisible = true;
  props.isAgentSidebarVisible = true;
  props.sidebarTopbarActionsProps = {
    ...props.sidebarTopbarActionsProps,
    isPrimarySidebarVisible: true,
    primarySidebarToggleLabel: 'Hide primary sidebar',
    addressBarLabel: 'Address bar',
    onTogglePrimarySidebar: () => {},
  };

  const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
  document.body.append(view.getElement());

  try {
    const editorToggleButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-toggle-editor-btn');
    assert(editorToggleButton instanceof HTMLButtonElement);
    assert.equal(editorToggleButton.getAttribute('aria-label'), 'Collapse editor');

    editorToggleButton.click();
    view.setProps(materializeWorkbenchLayoutViewProps(syncRawPropsWithLayoutState(props)));

    const auxiliaryToggleButton = view
      .getElement()
      .querySelector('.agentbar-topbar .editor-topbar-toggle-editor-btn');
    assert(auxiliaryToggleButton instanceof HTMLButtonElement);
    assert.equal(auxiliaryToggleButton.getAttribute('aria-label'), 'Expand editor');
    assert(
      view
        .getElement()
        .querySelector('.primarybar-topbar .sidebar-topbar-actions-host')
        instanceof HTMLElement,
    );
    assert.equal(
      view
        .getElement()
        .querySelector('.primarybar-topbar .editor-topbar-toggle-editor-btn'),
      null,
    );
  } finally {
    view.dispose();
  }
});

test('WorkbenchLayoutView keeps primary width fixed and expands agentbar when the editor is collapsed', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = true;
    props.primarySidebarSize = 320;
    props.agentSidebarSize = 360;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    };

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    animationFrameSpy.flushAll();

    const gridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(gridView);

    const primarySizeBefore = gridView.getViewSize([0]);
    const agentSizeBefore = gridView.getViewSize([1]);

    const editorToggleButton = view
      .getElement()
      .querySelector('.editor-topbar .editor-topbar-toggle-editor-btn');
    assert(editorToggleButton instanceof HTMLButtonElement);
    editorToggleButton.click();
    view.setProps(materializeWorkbenchLayoutViewProps(syncRawPropsWithLayoutState(props)));
    animationFrameSpy.flushAll();

    const nextGridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(nextGridView);

    assert.equal(nextGridView.getViewSize([0]), primarySizeBefore);
    assert(nextGridView.getViewSize([1]) > agentSizeBefore);

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView keeps editor width fixed and expands agentbar when the primary sidebar is hidden', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = true;
    props.isEditorCollapsed = false;
    props.primarySidebarSize = 320;
    props.agentSidebarSize = 360;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    };

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    animationFrameSpy.flushAll();

    const gridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(gridView);

    const editorSizeBefore = gridView.getViewSize([2]);
    const agentSizeBefore = gridView.getViewSize([1]);

    props.isPrimarySidebarVisible = false;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: false,
      primarySidebarToggleLabel: 'Show primary sidebar',
    };
    props.sidebarTopbarActionsElement = createSidebarTopbarActionsElement({
      isPrimarySidebarVisible: false,
      primarySidebarToggleLabel: 'Show primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    });
    view.setProps(materializeWorkbenchLayoutViewProps(props));
    animationFrameSpy.flushAll();

    const nextGridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(nextGridView);

    assert.equal(nextGridView.getViewSize([2]), editorSizeBefore);
    assert(nextGridView.getViewSize([1]) > agentSizeBefore);

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView clamps sidebar sizes with content layout orientation instead of window orientation', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(WORKBENCH_CONTENT_LAYOUT_BREAKPOINT + 320);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = true;

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(
      view,
      WORKBENCH_CONTENT_LAYOUT_BREAKPOINT - 80,
      720,
    );
    document.body.append(view.getElement());
    animationFrameSpy.flushAll();

    setWorkbenchSidebarSizes({
      primarySidebarSize: 0,
      agentSidebarSize: 0,
    });
    syncRawPropsWithLayoutState(props);

    assert.equal(props.primarySidebarSize, 160);
    assert.equal(props.agentSidebarSize, 160);

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView measures the pre-toggle editor size before the first animation frame when agentbar becomes visible', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = false;
    props.isEditorCollapsed = false;
    props.primarySidebarSize = 320;
    props.agentSidebarSize = 360;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    };

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());

    props.isAgentSidebarVisible = true;
    view.setProps(materializeWorkbenchLayoutViewProps(props));
    animationFrameSpy.flushAll();

    const gridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(gridView);

    const editorSize = gridView.getViewSize([2]);
    const agentSize = gridView.getViewSize([1]);
    assert(editorSize > props.expandedEditorSize);
    assert(editorSize > agentSize);

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView keeps primary width fixed when agentbar becomes visible in collapsed mode', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = false;
    props.isEditorCollapsed = true;
    props.expandedEditorSize = 600;
    props.primarySidebarSize = 320;
    props.agentSidebarSize = 360;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    };

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    animationFrameSpy.flushAll();

    const gridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(gridView);

    props.isAgentSidebarVisible = true;
    view.setProps(materializeWorkbenchLayoutViewProps(props));
    animationFrameSpy.flushAll();

    const nextGridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(nextGridView);

    assert.equal(nextGridView.getViewSize([0]), props.primarySidebarSize);
    assert(nextGridView.getViewSize([1]) > props.agentSidebarSize);

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView keeps primary width fixed and expands editor when agentbar becomes hidden', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = true;
    props.isEditorCollapsed = false;
    props.primarySidebarSize = 320;
    props.agentSidebarSize = 360;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    };

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    animationFrameSpy.flushAll();

    const gridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(gridView);

    const primarySizeBefore = gridView.getViewSize([0]);
    const editorSizeBefore = gridView.getViewSize([2]);

    props.isAgentSidebarVisible = false;
    view.setProps(materializeWorkbenchLayoutViewProps(props));
    animationFrameSpy.flushAll();

    const nextGridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(nextGridView);

    assert.equal(nextGridView.getViewSize([0]), primarySizeBefore);
    assert(nextGridView.getViewSize([2]) > editorSizeBefore);

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView keeps editor collapsed and mounts expand action into primarybar when agentbar is hidden from collapsed mode', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const props = createWorkbenchLayoutViewProps();
    props.isPrimarySidebarVisible = true;
    props.isAgentSidebarVisible = true;
    props.isEditorCollapsed = true;
    props.expandedEditorSize = 600;
    props.primarySidebarSize = 320;
    props.agentSidebarSize = 360;
    props.sidebarTopbarActionsProps = {
      ...props.sidebarTopbarActionsProps,
      isPrimarySidebarVisible: true,
      primarySidebarToggleLabel: 'Hide primary sidebar',
      addressBarLabel: 'Address bar',
      onTogglePrimarySidebar: () => {},
    };

    const view = createWorkbenchLayoutView(materializeWorkbenchLayoutViewProps(props));
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    animationFrameSpy.flushAll();

    const gridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(gridView);

    const primarySizeBefore = gridView.getViewSize([0]);

    setAgentSidebarVisible(false);
    syncRawPropsWithLayoutState(props);
    assert.equal(props.isAgentSidebarVisible, false);
    assert.equal(props.isEditorCollapsed, true);
    view.setProps(materializeWorkbenchLayoutViewProps(props));
    animationFrameSpy.flushAll();

    const nextGridView = (view as unknown as {
      gridView: {
        getViewSize: (location: readonly number[]) => number;
      } | null;
    }).gridView;
    assert(nextGridView);

    assert(nextGridView.getViewSize([0]) > primarySizeBefore);
    const primaryToggleButton = view
      .getElement()
      .querySelector('.primarybar-topbar .editor-topbar-toggle-editor-btn');
    assert(primaryToggleButton instanceof HTMLButtonElement);
    assert.equal(primaryToggleButton.getAttribute('aria-label'), 'Expand editor');
    assert.equal(
      view
        .getElement()
        .querySelector('.editor-topbar .editor-topbar-toggle-editor-btn'),
      null,
    );

    view.dispose();
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView dispose cancels a pending layout animation frame', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const view = createWorkbenchLayoutView(
      materializeWorkbenchLayoutViewProps(createWorkbenchLayoutViewProps()),
    );
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    const layoutAnimationFrame = (view as unknown as {
      layoutAnimationFrame: { value: unknown };
    }).layoutAnimationFrame;
    const canceledHandleCountBeforeDispose =
      animationFrameSpy.getCanceledHandles().length;
    assert(layoutAnimationFrame.value);

    view.dispose();

    assert.equal(layoutAnimationFrame.value, undefined);
    assert(
      animationFrameSpy.getCanceledHandles().length > canceledHandleCountBeforeDispose,
    );
    assert.equal(view.getElement().childElementCount, 0);
  } finally {
    animationFrameSpy.restore();
  }
});

test('WorkbenchLayoutView dispose disconnects its resize observer', () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const view = createWorkbenchLayoutView(
      materializeWorkbenchLayoutViewProps(createWorkbenchLayoutViewProps()),
    );
    const observerIndex = resizeObserverSpy.getInstanceCount() - 1;
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    const resizeObserverState = (view as unknown as {
      resizeObserver: { value: unknown };
    }).resizeObserver;
    assert(resizeObserverState.value);
    assert.equal(resizeObserverSpy.isObserving(observerIndex), true);

    view.dispose();

    assert.equal(resizeObserverState.value, undefined);
    assert.equal(resizeObserverSpy.isObserving(observerIndex), false);
    assert.equal(resizeObserverSpy.wasDisconnected(observerIndex), true);
  } finally {
    animationFrameSpy.restore();
    resizeObserverSpy.restore();
  }
});

test('WorkbenchLayoutView falls back to a disposable window resize listener without ResizeObserver', () => {
  const previousResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');
  const animationFrameSpy = installAnimationFrameSpy();
  const addedResizeListeners: EventListenerOrEventListenerObject[] = [];
  const removedResizeListeners: EventListenerOrEventListenerObject[] = [];
  const originalAddEventListener = window.addEventListener.bind(window);
  const originalRemoveEventListener = window.removeEventListener.bind(window);

  Reflect.deleteProperty(globalThis, 'ResizeObserver');
  window.addEventListener = ((...args: Parameters<typeof window.addEventListener>) => {
    const [type, listener] = args;
    if (type === 'resize') {
      addedResizeListeners.push(listener);
    }
    return originalAddEventListener(...args);
  }) as typeof window.addEventListener;
  window.removeEventListener = ((...args: Parameters<typeof window.removeEventListener>) => {
    const [type, listener] = args;
    if (type === 'resize') {
      removedResizeListeners.push(listener);
    }
    return originalRemoveEventListener(...args);
  }) as typeof window.removeEventListener;
  setWindowInnerWidth(1280);

  try {
    const view = createWorkbenchLayoutView(
      materializeWorkbenchLayoutViewProps(createWorkbenchLayoutViewProps()),
    );
    bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());
    const handleWindowResize = (view as unknown as {
      handleWindowResize: EventListenerOrEventListenerObject;
    }).handleWindowResize;

    assert.equal(
      addedResizeListeners.filter((listener) => listener === handleWindowResize).length,
      1,
    );

    view.dispose();

    assert.equal(
      removedResizeListeners.filter((listener) => listener === handleWindowResize).length,
      1,
    );
  } finally {
    animationFrameSpy.restore();
    window.addEventListener = originalAddEventListener;
    window.removeEventListener = originalRemoveEventListener;
    if (previousResizeObserver) {
      Object.defineProperty(globalThis, 'ResizeObserver', previousResizeObserver);
    } else {
      Reflect.deleteProperty(globalThis, 'ResizeObserver');
    }
  }
});

test('WorkbenchLayoutView replaces grid event subscriptions when the split orientation changes', () => {
  const animationFrameSpy = installAnimationFrameSpy();
  setWindowInnerWidth(1280);

  try {
    const view = createWorkbenchLayoutView(
      materializeWorkbenchLayoutViewProps(createWorkbenchLayoutViewProps()),
    );
    const size = bindWorkbenchContentSize(view, 1280, 720);
    document.body.append(view.getElement());

    const firstGridView = (view as unknown as {
      gridView: Record<string, unknown> | null;
    }).gridView;
    assert(firstGridView);
    assert.equal(getEventEmitterListenerCount(firstGridView, 'onDidSashSnapEmitter'), 1);
    assert.equal(getEventEmitterListenerCount(firstGridView, 'onDidSashEndEmitter'), 1);

    size.setSize(720, 720);
    view.layout();

    const secondGridView = (view as unknown as {
      gridView: Record<string, unknown> | null;
    }).gridView;
    assert(secondGridView);
    assert.notEqual(secondGridView, firstGridView);
    assert.equal(getEventEmitterListenerCount(firstGridView, 'onDidSashSnapEmitter'), 0);
    assert.equal(getEventEmitterListenerCount(firstGridView, 'onDidSashEndEmitter'), 0);
    assert.equal(getEventEmitterListenerCount(secondGridView, 'onDidSashSnapEmitter'), 1);
    assert.equal(getEventEmitterListenerCount(secondGridView, 'onDidSashEndEmitter'), 1);

    view.dispose();
    assert.equal(getEventEmitterListenerCount(secondGridView, 'onDidSashSnapEmitter'), 0);
    assert.equal(getEventEmitterListenerCount(secondGridView, 'onDidSashEndEmitter'), 0);
    animationFrameSpy.flushAll();
  } finally {
    animationFrameSpy.restore();
  }
});
