import type {
  EditorViewStateKey,
  SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type {
  EditorStatusLabels,
  EditorStatusState,
} from 'cs/workbench/browser/parts/editor/editorStatus';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { EditorGroupView } from 'cs/workbench/browser/parts/editor/editorGroupView';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { IEditorGroup } from 'cs/workbench/services/editor/common/editorGroupsService';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import type { EditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import type { LocaleMessages } from 'language/locales';
import 'cs/workbench/browser/parts/editor/media/editor.css';
import 'cs/workbench/browser/parts/editor/media/tabsTitleControl.css';

export type EditorPartLabels = {
  headerAddAction: string;
  close: string;
  closeOthers: string;
  closeAll: string;
  rename: string;
  expandEditor: string;
  collapseEditor: string;
  status: EditorStatusLabels;
};

export type EditorPartBaseProps = {
  ui: LocaleMessages;
  labels: EditorPartLabels;
  creationActions: readonly EditorCreationAction[];
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  dialogService: IDialogService;
  instantiationService: IInstantiationService;
  group: IEditorGroup;
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

export type EditorPartProps = EditorPartBaseProps & DropdownContextServices & {
	onOpenSources: () => void;
};

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
