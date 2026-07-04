import {
  isEmptyBrowserTabInput,
  getEditorPaneMode,
  getEditorTabInputResourceKey,
  isEditorDraftTabInput,
} from 'cs/workbench/browser/parts/editor/editorInput';
import type {
  EditorWorkspaceTab,
  WritingEditorDocument,
} from 'cs/workbench/browser/parts/editor/editorModel';
import { toEditorWorkspaceTabInput } from 'cs/workbench/browser/parts/editor/editorModel';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { areDraftEditorStatusStatesEqual } from 'cs/editor/browser/text/draftEditorStatusState';
import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import { createEditorStatus } from 'cs/workbench/browser/parts/editor/editorStatus';
import type {
  EditorContentStatusState,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';
import type { PdfReaderRuntimeStatus } from 'cs/editor/browser/pdf/pdfDocumentReader';

import { createActiveDraftEditorCommandExecutor } from 'cs/workbench/browser/parts/editor/activeDraftEditorCommandExecutor';
import type { DraftEditorSurfaceActionId } from 'cs/workbench/browser/parts/editor/activeDraftEditorCommandExecutor';
import { resolveEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import type { EditorPaneResolverContext } from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import {
  EditorPane,
} from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';

import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';
import { EditorBrowserLibraryPanel } from 'cs/workbench/browser/parts/editor/editorBrowserLibraryPanel';
import { EditorEmptyWorkspaceView } from 'cs/workbench/browser/parts/editor/editorEmptyWorkspaceView';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import {
  createEditorModeToolbarContext,
  resolveActiveBrowserMetadata,
} from 'cs/workbench/browser/parts/editor/editorModeToolbarModel';
import { createEditorModeToolbarHost } from 'cs/workbench/browser/parts/editor/editorModeToolbarHost';
import { createEditorHeaderActionsView } from 'cs/workbench/browser/parts/editor/editorHeaderActionsView';
import { createEditorGroupModel } from 'cs/workbench/browser/parts/editor/editorGroupModel';
import type { EditorGroupModel } from 'cs/workbench/browser/parts/editor/editorGroupModel';
import {
  EDITOR_FRAME_SLOTS,
  setEditorFrameSlot,
} from 'cs/workbench/browser/parts/editor/editorFrame';
import {
  createEditorViewStateStore,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type {
  EditorViewStateKey,
  SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';

import { TabsTitleControl } from 'cs/workbench/browser/parts/editor/tabsTitleControl';
import type { TitleControl, TitleControlProps } from 'cs/workbench/browser/parts/editor/titleControl';
import { getWindowChromeLayout } from 'cs/platform/window/common/window';
import type {
  EditorOpenHandler,
  EditorOpenRequest,
} from 'cs/workbench/services/editor/common/editorOpenTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export type EditorGroupViewProps = {
  labels: EditorPartLabels;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  groupId: string;
  tabs: EditorWorkspaceTab[];
  dirtyDraftTabIds: readonly string[];
  activeTabId: string | null;
  activeTab: EditorWorkspaceTab | null;
  viewStateEntries: SerializedEditorViewStateEntry[];
  onActivateTab: (tabId: string) => void;
  onReorderTab?: (
    tabId: string,
    targetSlotIndex: number,
  ) => void | Promise<void>;
  onCloseTab: (tabId: string) => Promise<boolean> | boolean | void;
  onCloseOtherTabs?: (tabId: string) => Promise<boolean> | boolean | void;
  onCloseAllTabs?: () => Promise<boolean> | boolean | void;
  onRenameTab?: (tabId: string) => void | Promise<void>;
  onOpenEditor: EditorOpenHandler;
  onPromptRenameBrowserFavorite?: (
    params: { url: string; title: string },
  ) => Promise<string | null> | string | null;
  onPromptCreateBrowserFavoriteFolder?: (
    params: { url: string; title: string },
  ) => Promise<string | null> | string | null;
  onOpenAddressBarSourceMenu: () => void;
  onToolbarNavigateBack: () => void;
  onToolbarNavigateForward: () => void;
  onToolbarNavigateRefresh: () => void;
  onToolbarArchiveCurrentPage: () => void | Promise<void>;
  onToolbarExportDocx?: () => void | Promise<void>;
  onToolbarHardReload: () => void;
  onToolbarCopyCurrentUrl: () => void | Promise<void>;
  onToolbarClearBrowsingHistory: () => void;
  onToolbarClearCookies: () => void | Promise<void>;
  onToolbarClearCache: () => void | Promise<void>;
  onToolbarAddressChange: (value: string) => void;
  onToolbarAddressSubmit: () => void;
  onToolbarNavigateToUrl: (url: string) => void;
  onDraftDocumentChange: (value: WritingEditorDocument) => void;
  onSetEditorViewState: (key: EditorViewStateKey, state: unknown) => void;
  onDeleteEditorViewState: (key: EditorViewStateKey) => void;
  showHeaderActions?: boolean;
  showHeaderToolbar?: boolean;
  isEditorCollapsed?: boolean;
  onToggleEditorCollapse?: () => void;
  isAgentSidebarVisible?: boolean;
  showAgentSidebarToggle?: boolean;
  agentSidebarToggleLabel?: string;
  onToggleAgentSidebar?: () => void;
  headerAuxiliaryActionsElements?: readonly HTMLElement[];
  hasLeadingWindowControlsInset?: boolean;
  onStatusChange?: (status: EditorStatusState) => void;
};

type EditorGroupControllerSnapshot = {
  group: EditorGroupModel;
  editorStatus: EditorStatusState;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function createTitleControlProps(
  props: Pick<
    EditorGroupViewProps,
    | 'labels'
    | 'tabs'
    | 'activeTabId'
    | 'activeTab'
    | 'onActivateTab'
    | 'onReorderTab'
    | 'onCloseTab'
    | 'onCloseOtherTabs'
    | 'onCloseAllTabs'
    | 'onRenameTab'
    | 'onOpenEditor'
  >,
  group: EditorGroupModel,
  requestBrowserPrimaryInputFocus: () => void,
): TitleControlProps {
  const focusBrowserUrlInputIfNeeded = (tabId: string | null) => {
    if (!tabId) {
      return false;
    }

    const targetTab = group.activeTabId === tabId
      ? group.activeTab
      : props.tabs.find((tab) => tab.id === tabId) ?? null;
    return isEmptyBrowserTabInput(targetTab);
  };

  return {
    group,
    labels: {
      close: props.labels.close,
      closeOthers: props.labels.closeOthers,
      closeAll: props.labels.closeAll,
      rename: props.labels.rename,
    },
    onActivateTab: (tabId) => {
      props.onActivateTab(tabId);
      if (focusBrowserUrlInputIfNeeded(tabId)) {
        requestBrowserPrimaryInputFocus();
      }
    },
    onReorderTab: props.onReorderTab,
    onCloseTab: props.onCloseTab,
    onCloseOtherTabs: props.onCloseOtherTabs,
    onCloseAllTabs: props.onCloseAllTabs,
    onRenameTab: props.onRenameTab,
    onOpenPaneMode: (paneMode) => {
      switch (paneMode) {
        case 'draft':
          void props.onOpenEditor({
            kind: 'draft',
            disposition: 'reveal-or-open',
          });
          return;
        case 'browser':
          void props.onOpenEditor({
            kind: 'browser',
            disposition: 'reveal-or-open',
          });
          requestBrowserPrimaryInputFocus();
          return;
        case 'pdf':
          void props.onOpenEditor({
            kind: 'pdf',
            disposition: 'reveal-or-open',
          });
          return;
        case 'file':
        case 'terminal':
        case 'git-changes':
          // Future launcher kinds are intentionally not wired yet.
          return;
      }
    },
  };
}

function createTitleControl(
  props: Pick<
    EditorGroupViewProps,
    | 'labels'
    | 'tabs'
    | 'activeTabId'
    | 'activeTab'
    | 'onActivateTab'
    | 'onReorderTab'
    | 'onCloseTab'
    | 'onCloseOtherTabs'
    | 'onCloseAllTabs'
    | 'onRenameTab'
    | 'onOpenEditor'
  >,
  group: EditorGroupModel,
  requestBrowserPrimaryInputFocus: () => void,
): TitleControl {
  return new TabsTitleControl(
    createTitleControlProps(props, group, requestBrowserPrimaryInputFocus),
  );
}

function createEditorStatusLabels(labels: EditorPartLabels) {
  return {
    draftMode: labels.draftMode,
    sourceMode: labels.sourceMode,
    pdfMode: labels.pdfMode,
    paragraph: labels.paragraph,
    heading1: labels.heading1,
    heading2: labels.heading2,
    heading3: labels.heading3,
    bulletList: labels.bulletList,
    orderedList: labels.orderedList,
    blockquote: labels.blockquote,
    undo: labels.undo,
    redo: labels.redo,
    statusbarAriaLabel: labels.status.statusbarAriaLabel,
    words: labels.status.words,
    characters: labels.status.characters,
    paragraphs: labels.status.paragraphs,
    selection: labels.status.selection,
    block: labels.status.block,
    line: labels.status.line,
    column: labels.status.column,
    url: labels.status.url,
    blockFigure: labels.status.blockFigure,
    ready: labels.status.ready,
  };
}

function createEditorGroupControllerSnapshot(
  context: EditorGroupViewProps,
  draftStatusByTabId: Record<string, DraftEditorStatusState>,
  pdfReaderStatusByTabId: Record<string, PdfReaderRuntimeStatus>,
): EditorGroupControllerSnapshot {
  const group = createEditorGroupModel({
    tabs: context.tabs,
    activeTabId: context.activeTabId,
    activeTab: context.activeTab,
    labels: context.labels,
    draftStatusByTabId,
    dirtyDraftTabIds: context.dirtyDraftTabIds,
  });
  const activeDraftStatus =
    isEditorDraftTabInput(group.activeTab)
      ? draftStatusByTabId[group.activeTab.id]
      : undefined;
  const activeContentStatus =
    group.activeTab?.kind === 'pdf'
      ? createPdfContentStatus(pdfReaderStatusByTabId[group.activeTab.id])
      : undefined;

  return {
    group,
    editorStatus: createEditorStatus(
      group.activeTab,
      createEditorStatusLabels(context.labels),
      activeDraftStatus,
      activeContentStatus,
    ),
  };
}

function createPdfContentStatus(
  status: PdfReaderRuntimeStatus | undefined,
): EditorContentStatusState | undefined {
  if (!status || status.state === 'idle') {
    return undefined;
  }

  const value = status.detail && status.state === 'error'
    ? `${status.message}: ${status.detail}`
    : status.message;
  const hitTest = status.hitTest;

  return {
    message: value,
    detail: status.detail,
    tone:
      status.state === 'error'
        ? 'error'
        : status.state === 'loading'
          ? 'muted'
          : 'accent',
    items: hitTest
      ? [
          {
            id: 'pdf-hit-line',
            label: 'Line',
            value: `P${hitTest.page} L${hitTest.lineIndex}`,
            tone: 'muted',
            title: `${hitTest.lineId}\n${hitTest.text}`,
          },
          {
            id: 'pdf-hit-point',
            label: 'PDF',
            value: `${Math.round(hitTest.pdfX)},${Math.round(hitTest.pdfY)}`,
            tone: 'muted',
            title: `char=${hitTest.charOffset}, deltaY=${hitTest.lineDeltaY.toFixed(2)}`,
          },
        ]
      : undefined,
  };
}

function createEditorGroupSnapshotKey(snapshot: EditorGroupControllerSnapshot) {
  return JSON.stringify({
    tabs: snapshot.group.tabs,
    activeTabId: snapshot.group.activeTabId,
    activeTab: snapshot.group.activeTab
      ? {
          id: snapshot.group.activeTab.id,
          kind: snapshot.group.activeTab.kind,
          paneMode: getEditorPaneMode(snapshot.group.activeTab),
        }
      : null,
    editorStatus: snapshot.editorStatus,
  });
}

class EditorGroupController {
  private context: EditorGroupViewProps;
  private draftStatusByTabId: Record<string, DraftEditorStatusState> = {};
  private pdfReaderStatusByTabId: Record<string, PdfReaderRuntimeStatus> = {};
  private snapshot: EditorGroupControllerSnapshot;
  private snapshotKey: string;

  constructor(context: EditorGroupViewProps) {
    this.context = context;
    this.snapshot = createEditorGroupControllerSnapshot(
      this.context,
      this.draftStatusByTabId,
      this.pdfReaderStatusByTabId,
    );
    this.snapshotKey = createEditorGroupSnapshotKey(this.snapshot);
  }

  getSnapshot() {
    return this.snapshot;
  }

  setContext(context: EditorGroupViewProps) {
    this.context = context;
    this.pruneDraftStatuses();
    this.prunePdfReaderStatuses();
    this.refreshSnapshot();
  }

  updateDraftStatus = (tabId: string, nextStatus: DraftEditorStatusState) => {
    if (areDraftEditorStatusStatesEqual(this.draftStatusByTabId[tabId], nextStatus)) {
      return;
    }

    this.draftStatusByTabId = {
      ...this.draftStatusByTabId,
      [tabId]: nextStatus,
    };
    this.refreshSnapshot();
  };

  updatePdfReaderStatus = (
    tabId: string,
    nextStatus: PdfReaderRuntimeStatus,
  ) => {
    const previousStatus = this.pdfReaderStatusByTabId[tabId];
    if (
      previousStatus?.state === nextStatus.state &&
      previousStatus.message === nextStatus.message &&
      previousStatus.detail === nextStatus.detail &&
      previousStatus.hitTest === nextStatus.hitTest
    ) {
      return;
    }

    this.pdfReaderStatusByTabId = {
      ...this.pdfReaderStatusByTabId,
      [tabId]: nextStatus,
    };
    this.refreshSnapshot();
  };

  private pruneDraftStatuses() {
    const draftTabIds = new Set(
      this.context.tabs
        .filter((tab) => isEditorDraftTabInput(tab))
        .map((tab) => tab.id),
    );
    const nextDraftStatusByTabId = Object.fromEntries(
      Object.entries(this.draftStatusByTabId).filter(([tabId]) =>
        draftTabIds.has(tabId),
      ),
    ) as Record<string, DraftEditorStatusState>;

    if (
      Object.keys(nextDraftStatusByTabId).length ===
      Object.keys(this.draftStatusByTabId).length
    ) {
      return;
    }

    this.draftStatusByTabId = nextDraftStatusByTabId;
  }

  private prunePdfReaderStatuses() {
    const pdfTabIds = new Set(
      this.context.tabs
        .filter((tab) => tab.kind === 'pdf')
        .map((tab) => tab.id),
    );
    const nextPdfReaderStatusByTabId = Object.fromEntries(
      Object.entries(this.pdfReaderStatusByTabId).filter(([tabId]) =>
        pdfTabIds.has(tabId),
      ),
    ) as Record<string, PdfReaderRuntimeStatus>;

    if (
      Object.keys(nextPdfReaderStatusByTabId).length ===
      Object.keys(this.pdfReaderStatusByTabId).length
    ) {
      return;
    }

    this.pdfReaderStatusByTabId = nextPdfReaderStatusByTabId;
  }


  private refreshSnapshot() {
    const nextSnapshot = createEditorGroupControllerSnapshot(
      this.context,
      this.draftStatusByTabId,
      this.pdfReaderStatusByTabId,
    );
    const nextSnapshotKey = createEditorGroupSnapshotKey(nextSnapshot);
    if (nextSnapshotKey === this.snapshotKey) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.snapshotKey = nextSnapshotKey;
  }
}

export class EditorGroupView {
  private props: EditorGroupViewProps;
  private readonly controller: EditorGroupController;
  private readonly element = createElement('div', 'comet-editor-frame');
  private readonly headerElement = createElement('div', 'comet-editor-header');
  private readonly toolbarElement = createElement('div', 'comet-editor-toolbar');
  private readonly tabsElement = createElement('div', 'comet-editor-header-tabs');
  private readonly actionsElement = createElement('div', 'comet-editor-header-actions');
  private readonly headerActionsView = createEditorHeaderActionsView({
    isEditorCollapsed: false,
    isAgentSidebarVisible: false,
    showAgentSidebarToggle: false,
    agentSidebarToggleLabel: '',
    labels: {
      headerAddAction: '',
      createDraft: '',
      createBrowser: '',
      createFile: '',
      expandEditor: '',
      collapseEditor: '',
    },
    onOpenEditor: () => {},
    onToggleEditorCollapse: () => {},
    onToggleAgentSidebar: () => {},
  });
  private readonly modeToolbarHost: ReturnType<typeof createEditorModeToolbarHost>;
  private readonly titleAreaControl: TitleControl;
  private readonly contentElement = createElement('div', 'comet-editor-content');
  private readonly browserLibraryPanel: EditorBrowserLibraryPanel;
  private readonly emptyWorkspaceView: EditorEmptyWorkspaceView;
  private readonly viewStateStore: ReturnType<typeof createEditorViewStateStore>;
  private readonly draftCommandExecutor = createActiveDraftEditorCommandExecutor(
    () => this.activePane,
  );
  private activePane: AnyEditorPane | null = null;
  private activePaneTabId: string | null = null;
  private activePaneViewStateKey: EditorViewStateKey | null = null;
  private activePaneKey: string | null = null;
  private readonly pendingViewStateSaveByTabId = new Map<string, Promise<void>>();
  private shouldFocusBrowserPrimaryInput = false;

  constructor(props: EditorGroupViewProps) {
    this.props = props;
    this.controller = new EditorGroupController(props);
    this.viewStateStore = createEditorViewStateStore(props.viewStateEntries);
    this.browserLibraryPanel = new EditorBrowserLibraryPanel(
      this.createBrowserLibraryPanelContext(props),
      {
        isInteractionWithin: (target) => this.toolbarElement.contains(target),
      },
    );
    this.modeToolbarHost = createEditorModeToolbarHost(
      createEditorModeToolbarContext({
        ...props,
        browserLibraryPanel: this.browserLibraryPanel,
        onPdfHighlightSelection: this.handlePdfHighlightSelection,
        onPdfNoteSelection: this.handlePdfNoteSelection,
      }),
    );
    setEditorFrameSlot(this.headerElement, EDITOR_FRAME_SLOTS.header);
    setEditorFrameSlot(this.toolbarElement, EDITOR_FRAME_SLOTS.toolbar);
    setEditorFrameSlot(this.contentElement, EDITOR_FRAME_SLOTS.content);
    if (WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx > 0) {
      this.headerElement.style.setProperty(
        '--editor-header-leading-window-controls-width',
        `${WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx}px`,
      );
    }
    this.titleAreaControl = createTitleControl(
      props,
      this.controller.getSnapshot().group,
      this.requestBrowserPrimaryInputFocus,
    );
    this.emptyWorkspaceView = new EditorEmptyWorkspaceView({
      labels: props.labels,
      onOpenEditor: this.openEditorFromEmptyWorkspace,
    });
    this.tabsElement.append(this.titleAreaControl.getElement());
    this.headerElement.append(this.tabsElement, this.actionsElement);
    this.element.append(this.headerElement, this.toolbarElement, this.contentElement);
    this.render();
  }

  getElement() {
    return this.element;
  }

  getHeaderElement() {
    this.element.classList.add('comet-has-external-header');
    return this.headerElement;
  }

  executeActiveDraftCommand(commandId: DraftEditorCommandId) {
    return this.draftCommandExecutor.execute(commandId);
  }

  canExecuteActiveDraftCommand(commandId: DraftEditorCommandId) {
    return this.draftCommandExecutor.canExecute(commandId);
  }

  runActiveDraftEditorAction(actionId: DraftEditorSurfaceActionId) {
    return this.draftCommandExecutor.runAction(actionId);
  }

  getActiveDraftStableSelectionTarget() {
    return this.draftCommandExecutor.getStableSelectionTarget();
  }

  whenTabViewStateSettled(tabId: string) {
    return this.pendingViewStateSaveByTabId.get(tabId) ?? Promise.resolve();
  }

  focusPrimaryInput() {
    queueMicrotask(() => {
      this.modeToolbarHost.focusPrimaryInput();
    });
  }

  setProps(props: EditorGroupViewProps) {
    if (props.groupId !== this.props.groupId) {
      this.saveActivePaneViewState();
      this.disposeAllPaneInstances();
      this.viewStateStore.replaceAll(props.viewStateEntries);
    }
    this.props = props;
    this.controller.setContext(props);
    this.render();
  }

  dispose() {
    this.browserLibraryPanel.dispose();
    this.titleAreaControl.dispose();
    this.headerActionsView.dispose();
    this.modeToolbarHost.dispose();
    this.saveActivePaneViewState();
    this.disposeAllPaneInstances();
    this.element.replaceChildren();
  }

  private handleDraftStatusChange = (
    tabId: string,
    status: DraftEditorStatusState,
  ) => {
    this.controller.updateDraftStatus(tabId, status);
    this.props.onStatusChange?.(this.controller.getSnapshot().editorStatus);
  };

  private handlePdfReaderStatusChange = (
    tabId: string,
    status: PdfReaderRuntimeStatus,
  ) => {
    this.controller.updatePdfReaderStatus(tabId, status);
    this.props.onStatusChange?.(this.controller.getSnapshot().editorStatus);
  };

  private readonly handlePdfHighlightSelection = () => {
    this.runActivePdfAnnotationAction('addHighlightFromSelection');
  };

  private readonly handlePdfNoteSelection = () => {
    this.runActivePdfAnnotationAction('addNoteFromSelection');
  };

  private runActivePdfAnnotationAction(
    methodName: 'addHighlightFromSelection' | 'addNoteFromSelection',
  ) {
    const pane = this.activePane as AnyEditorPane & {
      addHighlightFromSelection?: () => boolean;
      addNoteFromSelection?: () => boolean;
    } | null;
    pane?.[methodName]?.();
  }

  private render() {
    const { group, editorStatus } = this.controller.getSnapshot();
    const resolverContext = this.createPaneResolverContext();
    this.props.onStatusChange?.(editorStatus);
    this.titleAreaControl.setProps(
      createTitleControlProps(
        this.props,
        group,
        this.requestBrowserPrimaryInputFocus,
      ),
    );
    this.headerElement.classList.toggle('has-tabs', group.tabs.length > 0);
    this.headerElement.classList.toggle(
      'comet-has-leading-window-controls-inset',
      Boolean(this.props.hasLeadingWindowControlsInset),
    );
    this.headerActionsView.setProps({
      isEditorCollapsed: Boolean(this.props.isEditorCollapsed),
      isAgentSidebarVisible: Boolean(this.props.isAgentSidebarVisible),
      showAgentSidebarToggle: Boolean(this.props.showAgentSidebarToggle),
      agentSidebarToggleLabel: this.props.agentSidebarToggleLabel ?? '',
      labels: {
        headerAddAction: this.props.labels.headerAddAction,
        createDraft: this.props.labels.createDraft,
        createBrowser: this.props.labels.createBrowser,
        createFile: this.props.labels.createFile,
        expandEditor: this.props.labels.expandEditor,
        collapseEditor: this.props.labels.collapseEditor,
      },
      onOpenEditor: async (request) => {
        await this.props.onOpenEditor(request);
        if (
          request.kind === 'browser' &&
          request.disposition === 'reveal-or-open' &&
          !request.url
        ) {
          this.requestBrowserPrimaryInputFocus();
        }
      },
      onToggleEditorCollapse: this.props.onToggleEditorCollapse ?? (() => {}),
      onToggleAgentSidebar: this.props.onToggleAgentSidebar,
    });
    this.browserLibraryPanel.setContext(this.createBrowserLibraryPanelContext(this.props));
    this.modeToolbarHost.setContext(createEditorModeToolbarContext({
      ...this.props,
      browserLibraryPanel: this.browserLibraryPanel,
      onPdfHighlightSelection: this.handlePdfHighlightSelection,
      onPdfNoteSelection: this.handlePdfNoteSelection,
    }));
    this.syncToolbarMode(group.activeTab);
    this.syncHeaderActions(
      this.props.showHeaderActions ? this.headerActionsView.getElement() : null,
      this.props.headerAuxiliaryActionsElements ?? [],
    );

    this.contentElement.className = 'comet-editor-content';
    this.contentElement.removeAttribute('data-editor-pane');

    if (!group.activeTab) {
      this.releaseActivePane();
      this.syncHeaderToolbar(null);
      this.emptyWorkspaceView.setProps({
        labels: this.props.labels,
        onOpenEditor: this.openEditorFromEmptyWorkspace,
      });
      this.contentElement.replaceChildren(this.emptyWorkspaceView.getElement());
      this.browserLibraryPanel.close();
      this.browserLibraryPanel.mountTo(null);
      return;
    }

    const resolvedPane = resolveEditorPane(group.activeTab, resolverContext);

    this.contentElement.className = [
      'comet-editor-content',
      ...resolvedPane.contentClassNames,
    ].join(' ');
    this.contentElement.dataset.editorPane = resolvedPane.paneId;

    const nextPaneViewStateKey = this.createPaneViewStateKey(
      resolvedPane.paneId,
      group.activeTab,
    );

    if (this.activePaneKey !== resolvedPane.paneKey || !this.activePane) {
      this.releaseActivePane();
      this.activateResolvedPane(
        resolvedPane,
        group.activeTab.id,
        nextPaneViewStateKey,
      );
    } else {
      const didSwitchActivePaneTab = this.activePaneTabId !== group.activeTab.id;
      if (didSwitchActivePaneTab) {
        this.saveActivePaneViewState();
      }

      resolvedPane.updatePane(this.activePane);
      this.activePaneTabId = group.activeTab.id;
      this.activePaneViewStateKey = nextPaneViewStateKey;
      if (didSwitchActivePaneTab) {
        this.restorePaneViewState(this.activePane, nextPaneViewStateKey);
      }
      if (this.contentElement.firstChild !== this.activePane.getElement()) {
        this.contentElement.replaceChildren(this.activePane.getElement());
      }
    }

    this.syncHeaderToolbar(this.resolveToolbarElement());
    this.flushBrowserPrimaryInputFocus(group.activeTab);
    this.mountBrowserLibraryPanelForResolvedPane(resolvedPane.paneId);
  }

  private mountBrowserLibraryPanelForResolvedPane(paneId: string) {
    if (paneId !== 'browser') {
      this.browserLibraryPanel.close();
      this.browserLibraryPanel.mountTo(null);
      return;
    }

    const panelHost = this.contentElement.querySelector('.comet-browser-frame-container');
    this.browserLibraryPanel.mountTo(panelHost instanceof HTMLElement ? panelHost : null);
  }

  private createBrowserLibraryPanelContext(props: EditorGroupViewProps) {
    const activeBrowserMetadata = resolveActiveBrowserMetadata({
      activeTab: props.activeTab,
      viewPartProps: props.viewPartProps,
    });
    const browserUrl = activeBrowserMetadata.hasActiveBrowserTab
      ? activeBrowserMetadata.browserUrl
      : '';
    const browserPageTitle = activeBrowserMetadata.hasActiveBrowserTab
      ? activeBrowserMetadata.browserPageTitle
      : '';
    const browserFaviconUrl = activeBrowserMetadata.hasActiveBrowserTab
      ? activeBrowserMetadata.browserFaviconUrl
      : '';
    const browserIsLoading = activeBrowserMetadata.hasActiveBrowserTab
      ? Boolean(props.viewPartProps.browserIsLoading)
      : false;
    const browserTabTitle = activeBrowserMetadata.hasActiveBrowserTab
      ? activeBrowserMetadata.browserTabTitle
      : '';

    return {
      browserUrl,
      browserPageTitle,
      browserFaviconUrl,
      browserIsLoading,
      browserTabTitle,
      labels: {
        title: props.labels.browserLibraryPanelTitle,
        recentTitle: props.labels.browserLibraryPanelRecentTitle,
        recentTodayTitle: props.labels.browserLibraryPanelRecentTodayTitle,
        recentYesterdayTitle: props.labels.browserLibraryPanelRecentYesterdayTitle,
        recentLast7DaysTitle: props.labels.browserLibraryPanelRecentLast7DaysTitle,
        recentLast30DaysTitle: props.labels.browserLibraryPanelRecentLast30DaysTitle,
        recentOlderTitle: props.labels.browserLibraryPanelRecentOlderTitle,
        favoritesTitle: props.labels.browserLibraryPanelFavoritesTitle,
        emptyState: props.labels.browserLibraryPanelEmptyState,
        contextOpen: props.labels.browserLibraryPanelContextOpen,
        contextOpenInNewTab: props.labels.browserLibraryPanelContextOpenInNewTab,
        contextNewFolder: props.labels.browserLibraryPanelContextNewFolder,
        contextRename: props.labels.browserLibraryPanelContextRename,
        contextRemoveFavorite: props.labels.browserLibraryPanelContextRemoveFavorite,
      },
      onNavigateToUrl: props.onToolbarNavigateToUrl,
      onOpenEditor: props.onOpenEditor,
      onRequestRenameFavorite: props.onPromptRenameBrowserFavorite,
      onRequestCreateFavoriteFolder: props.onPromptCreateBrowserFavoriteFolder,
    };
  }

  private readonly requestBrowserPrimaryInputFocus = () => {
    this.shouldFocusBrowserPrimaryInput = true;
  };

  private readonly openEditorFromEmptyWorkspace = (request: EditorOpenRequest) => {
    const result = this.props.onOpenEditor(request);
    if (
      request.kind === 'browser' &&
      request.disposition === 'reveal-or-open' &&
      !request.url
    ) {
      this.requestBrowserPrimaryInputFocus();
    }
    return result;
  };

  private flushBrowserPrimaryInputFocus(activeTab: EditorWorkspaceTab | null) {
    if (!this.shouldFocusBrowserPrimaryInput || !isEmptyBrowserTabInput(activeTab)) {
      return;
    }

    this.shouldFocusBrowserPrimaryInput = false;
    this.focusPrimaryInput();
  }

  private syncHeaderActions(
    headerActionsElement: HTMLElement | null,
    headerAuxiliaryActionsElements: readonly HTMLElement[],
  ) {
    const nextHeaderActionsElements: HTMLElement[] = [];
    for (const element of headerAuxiliaryActionsElements) {
      if (!element || nextHeaderActionsElements.includes(element)) {
        continue;
      }
      nextHeaderActionsElements.push(element);
    }
    if (
      headerActionsElement &&
      !nextHeaderActionsElements.includes(headerActionsElement)
    ) {
      nextHeaderActionsElements.push(headerActionsElement);
    }

    const currentHeaderActionsElements = Array.from(this.actionsElement.children);
    const hasSameOrder =
      currentHeaderActionsElements.length === nextHeaderActionsElements.length &&
      currentHeaderActionsElements.every(
        (element, index) => element === nextHeaderActionsElements[index],
      );
    if (hasSameOrder) {
      return;
    }

    this.actionsElement.replaceChildren(...nextHeaderActionsElements);
  }

  private syncHeaderToolbar(headerToolbarElement: HTMLElement | null) {
    const currentHeaderToolbarElement = this.toolbarElement.firstElementChild;
    if (headerToolbarElement) {
      if (currentHeaderToolbarElement !== headerToolbarElement) {
        this.toolbarElement.replaceChildren(headerToolbarElement);
      }
      this.toolbarElement.hidden = false;
      return;
    }

    if (currentHeaderToolbarElement) {
      this.toolbarElement.replaceChildren();
    }
    this.toolbarElement.hidden = true;
  }

  private syncToolbarMode(activeTab: EditorWorkspaceTab | null) {
    if (!activeTab) {
      this.toolbarElement.removeAttribute('data-toolbar-mode');
      return;
    }

    this.toolbarElement.dataset.toolbarMode = getEditorPaneMode(activeTab);
  }

  private resolveToolbarElement() {
    if (!this.props.showHeaderToolbar) {
      return null;
    }

    const paneToolbarElement = this.activePane?.getToolbarElement() ?? null;
    if (paneToolbarElement) {
      return paneToolbarElement;
    }

    return this.modeToolbarHost.getElement();
  }

  private createPaneViewStateKey(
    paneId: string,
    tab: EditorWorkspaceTab,
  ): EditorViewStateKey {
    return {
      groupId: this.props.groupId,
      paneId,
      resourceKey: getEditorTabInputResourceKey(toEditorWorkspaceTabInput(tab)),
    };
  }

  private createPaneResolverContext(): EditorPaneResolverContext {
    return {
      labels: this.props.labels,
      viewPartProps: this.props.viewPartProps,
      nativeHost: this.props.nativeHost,
      onOpenEditor: this.props.onOpenEditor,
      onDraftDocumentChange: this.props.onDraftDocumentChange,
      onDraftStatusChange: this.handleDraftStatusChange,
      onPdfReaderStatusChange: this.handlePdfReaderStatusChange,
    };
  }

  private activateResolvedPane(
    resolvedPane: ReturnType<typeof resolveEditorPane>,
    tabId: string,
    viewStateKey: EditorViewStateKey,
  ) {
    this.activePane = resolvedPane.createPane();
    this.activePaneTabId = tabId;
    this.activePaneViewStateKey = viewStateKey;
    this.activePaneKey = resolvedPane.paneKey;
    this.contentElement.replaceChildren(this.activePane.getElement());
    this.restorePaneViewState(this.activePane, viewStateKey);
  }

  private releaseActivePane() {
    if (!this.activePane) {
      return;
    }

    this.saveActivePaneViewState();

    const pane = this.activePane;

    this.activePane = null;
    this.activePaneTabId = null;
    this.activePaneViewStateKey = null;
    this.activePaneKey = null;

    this.disposePane(pane);
  }

  private disposePane(pane: AnyEditorPane) {
    pane.clearInput();
    pane.dispose();
  }

  private disposeAllPaneInstances() {
    if (this.activePane) {
      this.disposePane(this.activePane);
    }
    this.activePane = null;
    this.activePaneTabId = null;
    this.activePaneViewStateKey = null;
    this.activePaneKey = null;
  }

  private saveActivePaneViewState() {
    if (!this.activePane || !this.activePaneViewStateKey || !this.activePaneTabId) {
      return;
    }

    const pane = this.activePane;
    const tabId = this.activePaneTabId;
    const viewStateKey = this.activePaneViewStateKey;
    const syncViewState = pane.getViewState();

    if (syncViewState === undefined) {
      if (pane.captureViewState === EditorPane.prototype.captureViewState) {
        this.deletePaneViewState(viewStateKey);
      }
    } else {
      this.setPaneViewState(viewStateKey, syncViewState);
    }

    const pendingSave = pane
      .captureViewState()
      .then((capturedViewState) => {
        if (capturedViewState === undefined) {
          if (pane.captureViewState === EditorPane.prototype.captureViewState) {
            this.deletePaneViewState(viewStateKey);
          }
          return;
        }

        this.setPaneViewState(viewStateKey, capturedViewState);
      })
      .catch(() => {});
    this.trackPendingViewStateSave(tabId, pendingSave);
  }

  private trackPendingViewStateSave(tabId: string, pendingSave: Promise<void>) {
    this.pendingViewStateSaveByTabId.set(tabId, pendingSave);
    void pendingSave.finally(() => {
      if (this.pendingViewStateSaveByTabId.get(tabId) === pendingSave) {
        this.pendingViewStateSaveByTabId.delete(tabId);
      }
    });
  }

  private restorePaneViewState(
    pane: AnyEditorPane,
    key: EditorViewStateKey,
  ) {
    pane.restoreViewState(this.viewStateStore.get(key));
  }

  private setPaneViewState(key: EditorViewStateKey, state: unknown) {
    this.viewStateStore.set(key, state);
    this.props.onSetEditorViewState(key, state);
  }

  private deletePaneViewState(key: EditorViewStateKey) {
    this.viewStateStore.delete(key);
    this.props.onDeleteEditorViewState(key);
  }
}

export function createEditorGroupView(props: EditorGroupViewProps) {
  return new EditorGroupView(props);
}
