import type {
  EditorWorkspaceTab,
  WritingEditorDocument,
} from 'ls/workbench/browser/parts/editor/editorModel';
import type {
  EditorViewStateKey,
  SerializedEditorViewStateEntry,
} from 'ls/workbench/browser/parts/editor/editorViewStateStore';
import type {
  EditorStatusLabels,
  EditorStatusState,
} from 'ls/workbench/browser/parts/editor/editorStatus';
import type { WritingEditorSurfaceLabels } from 'ls/editor/browser/text/editor';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'ls/workbench/browser/layout';
import type { DraftEditorSurfaceActionId } from 'ls/workbench/browser/parts/editor/activeDraftEditorCommandExecutor';
import type { DraftEditorCommandId } from 'ls/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import { EditorGroupView } from 'ls/workbench/browser/parts/editor/editorGroupView';
import type { EditorOpenHandler } from 'ls/workbench/services/editor/common/editorOpenTypes';
import 'ls/workbench/browser/parts/editor/media/editor.css';
import 'ls/workbench/browser/parts/editor/media/editorToolbar.css';
import 'ls/workbench/browser/parts/editor/media/editorBrowserLibraryPanel.css';
import 'ls/workbench/browser/parts/editor/media/tabsTitleControl.css';

export type EditorPartLabels = {
  topbarAddAction: string;
  createDraft: string;
  createBrowser: string;
  createFile: string;
  newTab: string;
  toolbarSources: string;
  toolbarBack: string;
  toolbarForward: string;
  toolbarRefresh: string;
  toolbarFavorite: string;
  toolbarArchivePage: string;
  toolbarMore: string;
  toolbarHardReload: string;
  toolbarCopyCurrentUrl: string;
  toolbarClearBrowsingHistory: string;
  toolbarClearCookies: string;
  toolbarClearCache: string;
  toolbarAddressBar: string;
  toolbarAddressPlaceholder: string;
  browserLibraryPanelTitle: string;
  browserLibraryPanelRecentTitle: string;
  browserLibraryPanelRecentTodayTitle: string;
  browserLibraryPanelRecentYesterdayTitle: string;
  browserLibraryPanelRecentLast7DaysTitle: string;
  browserLibraryPanelRecentLast30DaysTitle: string;
  browserLibraryPanelRecentOlderTitle: string;
  browserLibraryPanelFavoritesTitle: string;
  browserLibraryPanelEmptyState: string;
  browserLibraryPanelContextOpen: string;
  browserLibraryPanelContextOpenInNewTab: string;
  browserLibraryPanelContextNewFolder: string;
  browserLibraryPanelContextRename: string;
  browserLibraryPanelContextRemoveFavorite: string;
  draftMode: string;
  sourceMode: string;
  pdfMode: string;
  close: string;
  closeOthers?: string;
  closeAll?: string;
  rename?: string;
  renameFavoriteTitle?: string;
  renameFavoriteLabel?: string;
  newFavoriteFolderTitle?: string;
  newFavoriteFolderLabel?: string;
  expandEditor: string;
  collapseEditor: string;
  emptyWorkspaceTitle: string;
  emptyWorkspaceBody: string;
  draftBodyPlaceholder: string;
  pdfTitle: string;
  renameTabTitle?: string;
  renameTabLabel?: string;
  status: EditorStatusLabels;
} & WritingEditorSurfaceLabels;

export type EditorPartBrowserToolbarActions = {
  onOpenAddressBarSourceMenu: () => void;
  onToolbarNavigateBack: () => void;
  onToolbarNavigateForward: () => void;
  onToolbarNavigateRefresh: () => void;
  onToolbarArchiveCurrentPage: () => void | Promise<void>;
  onToolbarHardReload: () => void;
  onToolbarCopyCurrentUrl: () => void | Promise<void>;
  onToolbarClearBrowsingHistory: () => void;
  onToolbarClearCookies: () => void | Promise<void>;
  onToolbarClearCache: () => void | Promise<void>;
  onToolbarAddressChange: (value: string) => void;
  onToolbarAddressSubmit: () => void;
  onToolbarNavigateToUrl: (url: string) => void;
};

export type EditorPartBaseProps = {
  labels: EditorPartLabels;
  viewPartProps: ViewPartProps;
  groupId: string;
  tabs: EditorWorkspaceTab[];
  dirtyDraftTabIds: readonly string[];
  activeTabId: string | null;
  activeTab: EditorWorkspaceTab | null;
  viewStateEntries: SerializedEditorViewStateEntry[];
  onActivateTab: (tabId: string) => void;
  onReorderTab?: (
    tabId: string,
    targetTabId: string,
    position: 'before' | 'after',
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
  onDraftDocumentChange: (value: WritingEditorDocument) => void;
  onSetEditorViewState: (key: EditorViewStateKey, state: unknown) => void;
  onDeleteEditorViewState: (key: EditorViewStateKey) => void;
  showTopbarActions?: boolean;
  showTopbarToolbar?: boolean;
  isEditorCollapsed?: boolean;
  onToggleEditorCollapse?: () => void;
  isAgentSidebarVisible?: boolean;
  showAgentSidebarToggle?: boolean;
  agentSidebarToggleLabel?: string;
  onToggleAgentSidebar?: () => void;
  topbarAuxiliaryActionsElements?: readonly HTMLElement[];
  hasLeadingWindowControlsInset?: boolean;
  onStatusChange?: (status: EditorStatusState) => void;
};

export type EditorPartProps = EditorPartBaseProps &
  EditorPartBrowserToolbarActions;

export class EditorPartView {
  private readonly element = document.createElement('section');
  private readonly groupView: EditorGroupView;

  constructor(props: EditorPartProps) {
    this.element.className = 'panel editor-panel';
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, this.element);
    this.groupView = new EditorGroupView(props);
    this.element.append(this.groupView.getElement());
  }

  getElement() {
    return this.element;
  }

  executeActiveDraftCommand(commandId: DraftEditorCommandId) {
    return this.groupView.executeActiveDraftCommand(commandId);
  }

  canExecuteActiveDraftCommand(commandId: DraftEditorCommandId) {
    return this.groupView.canExecuteActiveDraftCommand(commandId);
  }

  runActiveDraftEditorAction(actionId: DraftEditorSurfaceActionId) {
    return this.groupView.runActiveDraftEditorAction(actionId);
  }

  getActiveDraftStableSelectionTarget() {
    return this.groupView.getActiveDraftStableSelectionTarget();
  }

  whenEditorTabViewStateSettled(tabId: string) {
    return this.groupView.whenTabViewStateSettled(tabId);
  }

  focusPrimaryInput() {
    this.groupView.focusPrimaryInput();
  }

  setProps(props: EditorPartProps) {
    this.groupView.setProps(props);
  }

  dispose() {
    this.groupView.dispose();
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, null);
    this.element.replaceChildren();
  }
}

export function createEditorPartView(props: EditorPartProps) {
  return new EditorPartView(props);
}

export default EditorPartView;
