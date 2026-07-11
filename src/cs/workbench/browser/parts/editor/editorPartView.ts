import type {
  EditorViewStateKey,
  SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type {
  EditorStatusLabels,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';
import type { WritingEditorSurfaceLabels } from 'cs/editor/browser/text/editor';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import type { DraftEditorSurfaceActionId } from 'cs/workbench/browser/parts/editor/activeDraftEditorCommandExecutor';
import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { EditorGroupView } from 'cs/workbench/browser/parts/editor/editorGroupView';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { BrowserEditorPaneState } from 'cs/workbench/browser/parts/editor/panes/browserEditorPane';
import type { EditorGroup } from 'cs/workbench/browser/parts/editor/editorGroup';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import 'cs/workbench/browser/parts/editor/media/editor.css';
import 'cs/workbench/browser/parts/editor/media/editorToolbar.css';
import 'cs/workbench/browser/parts/editor/media/browserHistoryAndFavoritesPanel.css';
import 'cs/workbench/browser/parts/editor/media/tabsTitleControl.css';

export type EditorPartLabels = {
  headerAddAction: string;
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
  toolbarExportDocx: string;
  toolbarMore: string;
  toolbarHardReload: string;
  toolbarCopyCurrentUrl: string;
  toolbarClearBrowsingHistory: string;
  toolbarClearCookies: string;
  toolbarClearCache: string;
  toolbarAddressBar: string;
  toolbarAddressPlaceholder: string;
  browserHistoryAndFavoritesPanelTitle: string;
  browserHistoryAndFavoritesPanelRecentTitle: string;
  browserHistoryAndFavoritesPanelRecentTodayTitle: string;
  browserHistoryAndFavoritesPanelRecentYesterdayTitle: string;
  browserHistoryAndFavoritesPanelRecentLast7DaysTitle: string;
  browserHistoryAndFavoritesPanelRecentLast30DaysTitle: string;
  browserHistoryAndFavoritesPanelRecentOlderTitle: string;
  browserHistoryAndFavoritesPanelFavoritesTitle: string;
  browserHistoryAndFavoritesPanelEmptyState: string;
  browserHistoryAndFavoritesPanelContextOpen: string;
  browserHistoryAndFavoritesPanelContextOpenInNewTab: string;
  browserHistoryAndFavoritesPanelContextRemoveFavorite: string;
  draftMode: string;
  sourceMode: string;
  pdfMode: string;
  close: string;
  closeOthers?: string;
  closeAll?: string;
  rename?: string;
  editorModalConfirm: string;
  editorModalCancel: string;
  expandEditor: string;
  collapseEditor: string;
  emptyWorkspaceTitle: string;
  emptyWorkspaceBody: string;
  draftBodyPlaceholder: string;
  pdfTitle: string;
  pdfOpenFile?: string;
  renameTabTitle?: string;
  renameTabLabel?: string;
  status: EditorStatusLabels;
} & WritingEditorSurfaceLabels;

export type EditorPartBrowserToolbarActions = {
  onOpenAddressBarSourceMenu: () => void;
  onToolbarArchiveCurrentPage: () => void | Promise<void>;
  onToolbarExportDocx?: () => void | Promise<void>;
  onToolbarCopyCurrentUrl: () => void | Promise<void>;
  onToolbarClearBrowsingHistory: () => void;
  onToolbarClearCookies: () => void | Promise<void>;
  onToolbarClearCache: () => void | Promise<void>;
};

export type EditorPartBaseProps = {
  labels: EditorPartLabels;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  dialogService: IDialogService;
  instantiationService: IInstantiationService;
  group: EditorGroup;
  commandService: IWorkbenchCommandService;
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
  onDidChangeBrowserState: (state: BrowserEditorPaneState) => void;
  onSetEditorViewState: (key: EditorViewStateKey, state: unknown) => void;
  onDeleteEditorViewState: (key: EditorViewStateKey) => void;
  showTitlebarActions?: boolean;
  showToolbar?: boolean;
  isEditorCollapsed?: boolean;
  onToggleEditorCollapse?: () => void;
  isAgentSidebarVisible?: boolean;
  showAgentSidebarToggle?: boolean;
  agentSidebarToggleLabel?: string;
  onToggleAgentSidebar?: () => void;
  titlebarAuxiliaryActionsElements?: readonly HTMLElement[];
  hasLeadingTitlebarWindowControlsInset?: boolean;
  onStatusChange?: (status: EditorStatusState) => void;
};

export type EditorPartProps = EditorPartBaseProps &
  EditorPartBrowserToolbarActions &
  DropdownContextServices;

export class EditorPartView {
  private readonly element = document.createElement('section');
  private readonly groupView: EditorGroupView;

  constructor(props: EditorPartProps) {
    this.element.className = 'comet-panel comet-editor-panel';
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, this.element);
    this.groupView = new EditorGroupView(props);
    this.element.append(this.groupView.getElement());
  }

  getElement() {
    return this.element;
  }

  getTitlebarElement() {
    return this.groupView.getTitlebarElement();
  }

  layout(width: number, height: number) {
    this.groupView.layout(width, height);
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
