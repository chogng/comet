import type { EditorStatusState } from 'ls/workbench/browser/parts/editor/editorStatus';
import { createEditorPartView } from 'ls/workbench/browser/parts/editor/editorPartView';
import type { EditorPartProps } from 'ls/workbench/browser/parts/editor/editorPartView';
import type { DraftEditorCommandId } from 'ls/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { SidebarProps } from 'ls/workbench/browser/parts/sidebar/sidebarPart';
import {
  createSidebarPartView,
  SidebarPartView,
} from 'ls/workbench/browser/parts/sidebar/sidebarPart';
import type { AgentBarPartProps } from 'ls/workbench/browser/parts/agentbar/agentbarPart';
import {
  createAgentBarPartView,
  AgentBarPartView,
} from 'ls/workbench/browser/parts/agentbar/agentbarPart';
import {
  clearStatusbarCommandHandlers,
  initializeStatusbarState,
  setStatusbarCommandHandlers,
  updateStatusbarState,
} from 'ls/workbench/browser/parts/statusbar/statusbarActions';
import {
  resolveTopbarActionRoute,
  type TopbarActionRoute,
} from 'ls/workbench/browser/topbarActionRouter';

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
  settingsTopbarActionsElement?: HTMLElement | null;
  agentBarProps: AgentBarPartProps;
  editorPartProps: EditorPartProps;
  settingsContentElement?: HTMLElement | null;
  sidebarTopbarActionsElement: HTMLElement;
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
  private readonly primaryTopbarActionsHost = createElement(
    'div',
    'sidebar-combined-topbar-actions-host',
  );
  private readonly primaryTopbarLeadingActionsHost = createElement(
    'div',
    'sidebar-combined-topbar-leading',
  );
  private readonly primaryTopbarTrailingActionsHost = createElement(
    'div',
    'sidebar-combined-topbar-trailing',
  );
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
    this.primaryTopbarActionsHost.append(
      this.primaryTopbarLeadingActionsHost,
      this.primaryTopbarTrailingActionsHost,
    );
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

  getPrimarySidebarTopbarElement() {
    return this.sidebarView?.getTopbarElement() ?? null;
  }

  getEditorElement() {
    if (this.props.mode === 'settings') {
      return this.props.settingsContentElement ?? null;
    }

    return this.editorView?.getElement() ?? null;
  }

  getEditorTopbarElement() {
    if (this.props.mode === 'settings') {
      return null;
    }

    return this.editorView?.getTopbarElement() ?? null;
  }

  getAgentSidebarElement() {
    return this.agentBarView?.getElement() ?? null;
  }

  getAgentSidebarTopbarElement() {
    return this.agentBarView?.getTopbarElement() ?? null;
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
    const topbarActionRoute = this.resolveTopbarActionRoute();
    initializeStatusbarState(this.props.editorPartProps.labels.status);
    this.renderPrimarySidebar(topbarActionRoute);
    this.renderEditor(topbarActionRoute);
    this.renderAgentBar(topbarActionRoute);
  }

  private renderPrimarySidebar(topbarActionRoute: TopbarActionRoute) {
    if (!this.props.isPrimarySidebarVisible) {
      this.sidebarView?.dispose();
      this.sidebarView = null;
      return;
    }

    const topbarActionsElement =
      this.props.mode === 'settings'
        ? (this.props.settingsTopbarActionsElement ?? null)
        : this.resolvePrimaryTopbarActionsElement(topbarActionRoute);
    const nextProps: SidebarProps = {
      ...this.props.sidebarProps,
      mode: this.props.mode === 'settings' ? 'settings' : 'content',
      settingsNavigationElement:
        this.props.mode === 'settings'
          ? (this.props.settingsNavigationElement ?? null)
          : null,
      topbarActionsElement,
      footerActionsElement: this.props.sidebarFooterActionsElement,
    };

    if (!this.sidebarView) {
      this.sidebarView = createSidebarPartView(nextProps);
      return;
    }

    this.sidebarView.setProps(nextProps);
  }

  private resolvePrimaryTopbarActionsElement(
    topbarActionRoute: TopbarActionRoute,
  ): HTMLElement | null {
    const leadingElement =
      topbarActionRoute.sidebarTarget === 'primary'
        ? this.props.sidebarTopbarActionsElement
        : null;
    const trailingElement =
      topbarActionRoute.editorAuxiliaryTarget === 'primary'
        ? (this.props.editorTopbarAuxiliaryActionsElement ?? null)
        : null;

    if (!leadingElement && !trailingElement) {
      this.syncTopbarSlot(this.primaryTopbarLeadingActionsHost, null);
      this.syncTopbarSlot(this.primaryTopbarTrailingActionsHost, null);
      return null;
    }

    if (!trailingElement) {
      this.syncTopbarSlot(this.primaryTopbarLeadingActionsHost, null);
      this.syncTopbarSlot(this.primaryTopbarTrailingActionsHost, null);
      return leadingElement;
    }

    if (!leadingElement || leadingElement === trailingElement) {
      this.syncTopbarSlot(this.primaryTopbarLeadingActionsHost, null);
      this.syncTopbarSlot(this.primaryTopbarTrailingActionsHost, null);
      return trailingElement;
    }

    this.syncTopbarSlot(this.primaryTopbarLeadingActionsHost, leadingElement);
    this.syncTopbarSlot(this.primaryTopbarTrailingActionsHost, trailingElement);
    return this.primaryTopbarActionsHost;
  }

  private renderEditor(topbarActionRoute: TopbarActionRoute) {
    if (this.props.mode === 'settings') {
      this.retiredEditorView = this.editorView;
      this.retiredEditorView?.dispose();
      this.editorView = null;
      clearStatusbarCommandHandlers();
      return;
    }

    const topbarAuxiliaryActionsElements: HTMLElement[] = [];
    const topbarActionSources = {
      sidebar: this.props.sidebarTopbarActionsElement,
      editorAuxiliary: this.props.editorTopbarAuxiliaryActionsElement ?? null,
    } as const;
    for (const source of topbarActionRoute.editorActionOrder) {
      const target =
        source === 'sidebar'
          ? topbarActionRoute.sidebarTarget
          : topbarActionRoute.editorAuxiliaryTarget;
      if (target !== 'editor') {
        continue;
      }
      const element = topbarActionSources[source];
      if (element && !topbarAuxiliaryActionsElements.includes(element)) {
        topbarAuxiliaryActionsElements.push(element);
      }
    }

    const nextProps: EditorPartProps = {
      ...this.props.editorPartProps,
      showTopbarActions: !this.layoutState.isEditorCollapsed,
      showTopbarToolbar: !this.layoutState.isEditorCollapsed,
      isEditorCollapsed: this.layoutState.isEditorCollapsed,
      onToggleEditorCollapse: this.layoutState.onToggleEditorCollapse,
      topbarAuxiliaryActionsElements,
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

  private renderAgentBar(topbarActionRoute: TopbarActionRoute) {
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
      topbarActionsElement: topbarActionRoute.sidebarTarget === 'agent'
        ? this.props.sidebarTopbarActionsElement
        : null,
      topbarTrailingActionsElement:
        this.resolveAgentTopbarTrailingActionsElement(topbarActionRoute),
    };

    if (!this.agentBarView) {
      this.agentBarView = createAgentBarPartView(nextProps);
      return;
    }

    this.agentBarView.setProps(nextProps);
  }

  private resolveAgentTopbarTrailingActionsElement(
    topbarActionRoute: TopbarActionRoute,
  ): HTMLElement | null {
    const agentActionsElement =
      this.props.agentTopbarTrailingActionsElement ?? null;
    const editorAuxiliaryActionsElement =
      topbarActionRoute.editorAuxiliaryTarget === 'agent'
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

  private resolveTopbarActionRoute() {
    return resolveTopbarActionRoute({
      mode: this.props.mode,
      isPrimarySidebarVisible: this.props.isPrimarySidebarVisible,
      isAgentSidebarVisible: this.props.isAgentSidebarVisible,
      isEditorCollapsed: this.layoutState.isEditorCollapsed,
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
