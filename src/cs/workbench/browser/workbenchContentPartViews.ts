import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import { createEditorPartView } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorPartProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { SidebarProps } from 'cs/workbench/browser/parts/sidebar/sidebarPart';
import {
  createSidebarPartView,
  SidebarPartView,
} from 'cs/workbench/browser/parts/sidebar/sidebarPart';
import type { AgentBarPartProps } from 'cs/workbench/browser/parts/agentbar/agentbarPart';
import {
  createAgentBarPartView,
  AgentBarPartView,
} from 'cs/workbench/browser/parts/agentbar/agentbarPart';
import {
  clearStatusbarCommandHandlers,
  initializeStatusbarState,
  setStatusbarCommandHandlers,
  updateStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarActions';
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

export type WorkbenchContentPartViewsProps = {
  mode?: 'content' | 'settings';
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  sidebarProps: SidebarProps;
  settingsNavigationElement?: HTMLElement | null;
  agentBarProps: AgentBarPartProps;
  editorPartProps: EditorPartProps;
  settingsContentElement?: HTMLElement | null;
  sidebarFooterActionsElement: HTMLElement;
  editorTopbarAuxiliaryActionsElement?: HTMLElement | null;
  agentTopbarTrailingActionsElement?: HTMLElement | null;
};

export type WorkbenchContentPartViewsLayoutState = {
  isEditorCollapsed: boolean;
  onToggleEditorCollapse: () => void;
};

export class WorkbenchContentPartViews {
  private props: WorkbenchContentPartViewsProps;
  private layoutState: WorkbenchContentPartViewsLayoutState;
  private sidebarView: SidebarPartView | null = null;
  private agentBarView: AgentBarPartView | null = null;
  private editorView: ReturnType<typeof createEditorPartView> | null = null;
  private retiredEditorView: ReturnType<typeof createEditorPartView> | null = null;
  private readonly agentTopbarTrailingActionsHost = createElement(
    'div',
    'agentbar-topbar-trailing-actions-host',
  );
  private readonly agentTopbarPrimaryTrailingActionsHost = createElement(
    'div',
    'agentbar-topbar-trailing-primary',
  );
  private readonly agentTopbarSecondaryTrailingActionsHost = createElement(
    'div',
    'agentbar-topbar-trailing-secondary',
  );
  private disposed = false;

  constructor(props: WorkbenchContentPartViewsProps) {
    this.props = props;
    this.layoutState = {
      isEditorCollapsed: false,
      onToggleEditorCollapse: () => {},
    };
    this.agentTopbarTrailingActionsHost.append(
      this.agentTopbarPrimaryTrailingActionsHost,
      this.agentTopbarSecondaryTrailingActionsHost,
    );
    this.render();
  }

  setProps(props: WorkbenchContentPartViewsProps) {
    if (this.disposed) {
      return;
    }

    this.props = props;
    this.render();
  }

  setLayoutState(layoutState: WorkbenchContentPartViewsLayoutState) {
    if (this.disposed) {
      return;
    }

    this.layoutState = layoutState;
    this.render();
  }

  getPrimarySidebarElement() {
    return this.sidebarView?.getElement() ?? null;
  }

  getEditorElement() {
    if (this.props.mode === 'settings') {
      return this.props.settingsContentElement ?? null;
    }

    return this.editorView?.getElement() ?? null;
  }

  getAgentSidebarElement() {
    return this.agentBarView?.getElement() ?? null;
  }

  executeActiveDraftCommand(commandId: DraftEditorCommandId) {
    return this.editorView?.executeActiveDraftCommand(commandId) ?? false;
  }

  canExecuteActiveDraftCommand(commandId: DraftEditorCommandId) {
    return this.editorView?.canExecuteActiveDraftCommand(commandId) ?? false;
  }

  getActiveDraftStableSelectionTarget() {
    return this.editorView?.getActiveDraftStableSelectionTarget() ?? null;
  }

  focusActiveEditorPrimaryInput() {
    this.editorView?.focusPrimaryInput();
  }

  whenEditorTabViewStateSettled(tabId: string) {
    return (
      this.editorView?.whenEditorTabViewStateSettled(tabId) ??
      this.retiredEditorView?.whenEditorTabViewStateSettled(tabId) ??
      Promise.resolve()
    );
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    clearStatusbarCommandHandlers();
    this.sidebarView?.dispose();
    this.agentBarView?.dispose();
    this.retiredEditorView = this.editorView;
    this.retiredEditorView?.dispose();
    this.sidebarView = null;
    this.agentBarView = null;
    this.editorView = null;
  }

  private render() {
    initializeStatusbarState(this.props.editorPartProps.labels.status);
    this.renderPrimarySidebar();
    this.renderEditor();
    this.renderAgentBar();
  }

  private renderPrimarySidebar() {
    if (!this.props.isPrimarySidebarVisible) {
      this.sidebarView?.dispose();
      this.sidebarView = null;
      return;
    }

    const nextProps: SidebarProps = {
      ...this.props.sidebarProps,
      mode: this.props.mode === 'settings' ? 'settings' : 'content',
      settingsNavigationElement:
        this.props.mode === 'settings'
          ? (this.props.settingsNavigationElement ?? null)
          : null,
      footerActionsElement: this.props.sidebarFooterActionsElement,
    };

    if (!this.sidebarView) {
      this.sidebarView = createSidebarPartView(nextProps);
      return;
    }

    this.sidebarView.setProps(nextProps);
  }

  private renderEditor() {
    if (this.props.mode === 'settings') {
      this.retiredEditorView = this.editorView;
      this.retiredEditorView?.dispose();
      this.editorView = null;
      clearStatusbarCommandHandlers();
      return;
    }

    const topbarAuxiliaryActionsElement =
      !this.props.isAgentSidebarVisible && this.layoutState.isEditorCollapsed
        ? (this.props.editorTopbarAuxiliaryActionsElement ?? null)
        : null;

    const nextProps: EditorPartProps = {
      ...this.props.editorPartProps,
      showTopbarActions: !this.layoutState.isEditorCollapsed,
      showTopbarToolbar: !this.layoutState.isEditorCollapsed,
      isEditorCollapsed: this.layoutState.isEditorCollapsed,
      onToggleEditorCollapse: this.layoutState.onToggleEditorCollapse,
      topbarAuxiliaryActionsElements: topbarAuxiliaryActionsElement
        ? [topbarAuxiliaryActionsElement]
        : [],
      hasLeadingWindowControlsInset:
        !this.props.isPrimarySidebarVisible && !this.props.isAgentSidebarVisible,
      onStatusChange: this.handleEditorStatusChange,
    };

    if (!this.editorView) {
      this.editorView = createEditorPartView(nextProps);
    } else {
      this.editorView.setProps(nextProps);
    }

    this.syncStatusbarCommandHandlers();
  }

  private renderAgentBar() {
    if (this.props.mode === 'settings') {
      this.agentBarView?.dispose();
      this.agentBarView = null;
      return;
    }

    if (!this.props.isAgentSidebarVisible) {
      this.agentBarView?.dispose();
      this.agentBarView = null;
      return;
    }

    const nextProps: AgentBarPartProps = {
      ...this.props.agentBarProps,
      isPrimarySidebarVisible: this.props.isPrimarySidebarVisible,
      topbarActionsElement: null,
      topbarTrailingActionsElement: this.resolveAgentTopbarTrailingActionsElement(),
    };

    if (!this.agentBarView) {
      this.agentBarView = createAgentBarPartView(nextProps);
      return;
    }

    this.agentBarView.setProps(nextProps);
  }

  private resolveAgentTopbarTrailingActionsElement(): HTMLElement | null {
    const agentActionsElement =
      this.props.agentTopbarTrailingActionsElement ?? null;
    const editorAuxiliaryActionsElement =
      this.layoutState.isEditorCollapsed
        ? (this.props.editorTopbarAuxiliaryActionsElement ?? null)
        : null;

    if (!agentActionsElement && !editorAuxiliaryActionsElement) {
      this.syncTopbarSlot(this.agentTopbarPrimaryTrailingActionsHost, null);
      this.syncTopbarSlot(this.agentTopbarSecondaryTrailingActionsHost, null);
      return null;
    }

    if (!agentActionsElement) {
      this.syncTopbarSlot(this.agentTopbarPrimaryTrailingActionsHost, null);
      this.syncTopbarSlot(this.agentTopbarSecondaryTrailingActionsHost, null);
      return editorAuxiliaryActionsElement;
    }

    if (!editorAuxiliaryActionsElement || agentActionsElement === editorAuxiliaryActionsElement) {
      this.syncTopbarSlot(this.agentTopbarPrimaryTrailingActionsHost, null);
      this.syncTopbarSlot(this.agentTopbarSecondaryTrailingActionsHost, null);
      return agentActionsElement;
    }

    this.syncTopbarSlot(
      this.agentTopbarPrimaryTrailingActionsHost,
      agentActionsElement,
    );
    this.syncTopbarSlot(
      this.agentTopbarSecondaryTrailingActionsHost,
      editorAuxiliaryActionsElement,
    );
    return this.agentTopbarTrailingActionsHost;
  }

  private handleEditorStatusChange = (status: EditorStatusState) => {
    updateStatusbarState(status);
  };

  private syncStatusbarCommandHandlers() {
    setStatusbarCommandHandlers({
      undo: () => {
        this.editorView?.runActiveDraftEditorAction('undo');
      },
      redo: () => {
        this.editorView?.runActiveDraftEditorAction('redo');
      },
    });
  }

  private syncTopbarSlot(slotElement: HTMLElement, element: HTMLElement | null) {
    const currentElement = slotElement.firstElementChild;
    if (element) {
      if (currentElement !== element) {
        slotElement.replaceChildren(element);
      }
      return;
    }

    if (currentElement) {
      slotElement.replaceChildren();
    }
  }
}

export function createWorkbenchContentPartViews(props: WorkbenchContentPartViewsProps) {
  return new WorkbenchContentPartViews(props);
}
