/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { createEmptyEditorStatus } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import { $ } from 'cs/base/browser/dom';
import { CancellationTokenSource } from 'cs/base/common/cancellation';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';

import { resolveEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import type { EditorPaneResolverContext } from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';
import {
  EditorPane,
} from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';

import { EditorEmptyWorkspaceView } from 'cs/workbench/browser/parts/editor/editorEmptyWorkspaceView';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import { createEditorModeToolbarHost } from 'cs/workbench/browser/parts/editor/editorModeToolbarRegistry';
import { createEditorTitlebarActionsView } from 'cs/workbench/browser/parts/editor/editorTitlebarActionsView';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import { createEditorTabsModel, type EditorTabsModel } from 'cs/workbench/browser/parts/editor/editorTabsModel';
import type { IEditorGroup } from 'cs/workbench/services/editor/common/editorGroupsService';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
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
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { EditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import type { LocaleMessages } from 'language/locales';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export type EditorGroupViewProps = DropdownContextServices & {
  ui: LocaleMessages;
  labels: EditorPartLabels;
  creationActions: readonly EditorCreationAction[];
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  dialogService: IDialogService;
  instantiationService: IInstantiationService;
  group: IEditorGroup;
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
  commandService: IWorkbenchCommandService;
  onOpenSources: () => void;
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

type EditorGroupControllerSnapshot = {
  group: EditorTabsModel;
  editorStatus: EditorStatusState;
};

function createTitleControlProps(
  props: Pick<
    EditorGroupViewProps,
    | 'labels'
    | 'group'
    | 'onActivateTab'
    | 'onReorderTab'
    | 'onCloseTab'
    | 'onCloseOtherTabs'
    | 'onCloseAllTabs'
    | 'onRenameTab'
  >,
  group: EditorTabsModel,
  requestPrimaryInputFocus: () => void,
): TitleControlProps {
  const focusPrimaryInputIfNeeded = (tabId: string | null) => {
    if (!tabId) {
      return false;
    }

    const targetTab = group.activeTabId === tabId
      ? group.activeTab
      : props.group.getEditors().find(editor => getEditorInputId(editor) === tabId) ?? null;
    return Boolean(targetTab?.prefersPrimaryInputFocus());
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
      if (focusPrimaryInputIfNeeded(tabId)) {
        requestPrimaryInputFocus();
      }
    },
    onReorderTab: props.onReorderTab,
    onCloseTab: props.onCloseTab,
    onCloseOtherTabs: props.onCloseOtherTabs,
    onCloseAllTabs: props.onCloseAllTabs,
    onRenameTab: props.onRenameTab,
  };
}

function createTitleControl(
  props: Pick<
    EditorGroupViewProps,
    | 'labels'
    | 'group'
    | 'onActivateTab'
    | 'onReorderTab'
    | 'onCloseTab'
    | 'onCloseOtherTabs'
    | 'onCloseAllTabs'
    | 'onRenameTab'
  >,
  group: EditorTabsModel,
  requestPrimaryInputFocus: () => void,
): TitleControl {
  return new TabsTitleControl(
    createTitleControlProps(props, group, requestPrimaryInputFocus),
  );
}

function createEditorGroupControllerSnapshot(
  context: EditorGroupViewProps,
  runtimeStateByTabId: Record<string, EditorPaneRuntimeState>,
): EditorGroupControllerSnapshot {
  const group = createEditorTabsModel({
    editors: context.group.getEditors(),
    activeEditor: context.group.activeEditor,
    runtimeStateByEditorId: runtimeStateByTabId,
  });
  const activeRuntimeState = group.activeTab
    ? runtimeStateByTabId[getEditorInputId(group.activeTab)]
    : undefined;

  return {
    group,
    editorStatus: activeRuntimeState?.status ?? createEmptyEditorStatus(context.labels.status),
  };
}

function createEditorGroupSnapshotKey(snapshot: EditorGroupControllerSnapshot) {
  return JSON.stringify({
    tabs: snapshot.group.tabs,
    activeTabId: snapshot.group.activeTabId,
    activeTab: snapshot.group.activeTab
      ? getEditorInputId(snapshot.group.activeTab)
      : null,
    editorStatus: snapshot.editorStatus,
  });
}

class EditorGroupController {
  private context: EditorGroupViewProps;
  private runtimeStateByTabId: Record<string, EditorPaneRuntimeState> = {};
  private snapshot: EditorGroupControllerSnapshot;
  private snapshotKey: string;

  constructor(context: EditorGroupViewProps) {
    this.context = context;
    this.snapshot = createEditorGroupControllerSnapshot(this.context, this.runtimeStateByTabId);
    this.snapshotKey = createEditorGroupSnapshotKey(this.snapshot);
  }

  getSnapshot() {
    return this.snapshot;
  }

  setContext(context: EditorGroupViewProps) {
    this.context = context;
    this.pruneRuntimeStates();
    this.refreshSnapshot();
  }

  updateRuntimeState = (tabId: string, nextState: EditorPaneRuntimeState) => {
    this.runtimeStateByTabId = {
      ...this.runtimeStateByTabId,
      [tabId]: nextState,
    };
    this.refreshSnapshot();
  };

  private pruneRuntimeStates() {
    const tabIds = new Set(this.context.group.getEditors().map(getEditorInputId));
    const nextRuntimeStateByTabId = Object.fromEntries(
      Object.entries(this.runtimeStateByTabId).filter(([tabId]) =>
        tabIds.has(tabId),
      ),
    ) as Record<string, EditorPaneRuntimeState>;

    if (
      Object.keys(nextRuntimeStateByTabId).length ===
      Object.keys(this.runtimeStateByTabId).length
    ) {
      return;
    }

    this.runtimeStateByTabId = nextRuntimeStateByTabId;
  }


  private refreshSnapshot() {
    const nextSnapshot = createEditorGroupControllerSnapshot(this.context, this.runtimeStateByTabId);
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
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-editor-frame');
  private readonly titlebarElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-titlebar');
  private readonly toolbarElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-toolbar');
  private readonly tabsElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-titlebar-tabs');
  private readonly actionsElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-titlebar-actions');
  private readonly windowControlsSpacerElement = $<HTMLElementTagNameMap['div']>('div.comet-titlebar-window-controls-spacer');
  private readonly titlebarActionsView: ReturnType<typeof createEditorTitlebarActionsView>;
  private readonly modeToolbarHost: ReturnType<typeof createEditorModeToolbarHost>;
  private readonly titleAreaControl: TitleControl;
  private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-content');
  private readonly emptyWorkspaceView: EditorEmptyWorkspaceView;
  private readonly viewStateStore: ReturnType<typeof createEditorViewStateStore>;
  private activePane: AnyEditorPane | null = null;
  private activePaneTabId: string | null = null;
  private activePaneViewStateKey: EditorViewStateKey | null = null;
  private activePaneKey: string | null = null;
  private readonly paneInstances = new Map<string, AnyEditorPane>();
  private activePaneInputSource: CancellationTokenSource | null = null;
  private activePaneRuntimeStateListener: IDisposable = Disposable.None;
  private readonly pendingViewStateSaveByTabId = new Map<string, Promise<void>>();
  private shouldFocusPrimaryInput = false;

  constructor(props: EditorGroupViewProps) {
    this.props = props;
    this.titlebarActionsView = createEditorTitlebarActionsView({
      contextMenuService: props.contextMenuService,
      contextViewProvider: props.contextViewProvider,
      isEditorCollapsed: false,
      isAgentSidebarVisible: false,
      showAgentSidebarToggle: false,
      agentSidebarToggleLabel: '',
      labels: {
        headerAddAction: '',
        expandEditor: '',
        collapseEditor: '',
      },
		creationActions: [],
      commandService: props.commandService,
      onToggleEditorCollapse: () => {},
      onToggleAgentSidebar: () => {},
    });
    this.controller = new EditorGroupController(props);
    this.viewStateStore = createEditorViewStateStore(props.viewStateEntries);
    this.modeToolbarHost = createEditorModeToolbarHost(
      this.createModeToolbarHostContext(props, null),
      props,
    );
    setEditorFrameSlot(this.titlebarElement, EDITOR_FRAME_SLOTS.titlebar);
    setEditorFrameSlot(this.toolbarElement, EDITOR_FRAME_SLOTS.toolbar);
    setEditorFrameSlot(this.contentElement, EDITOR_FRAME_SLOTS.content);
    if (WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx > 0) {
      this.titlebarElement.style.setProperty(
        '--editor-titlebar-leading-window-controls-width',
        `${WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx}px`,
      );
    }
    this.titleAreaControl = createTitleControl(
      props,
      this.controller.getSnapshot().group,
      this.requestPrimaryInputFocus,
    );
    this.emptyWorkspaceView = new EditorEmptyWorkspaceView({
		creationActions: props.creationActions,
      commandService: props.commandService,
    });
    this.tabsElement.append(this.titleAreaControl.getElement());
    this.titlebarElement.append(
      this.tabsElement,
      this.actionsElement,
      this.windowControlsSpacerElement,
    );
    this.element.append(this.titlebarElement, this.toolbarElement, this.contentElement);
    this.render();
  }

  getElement() {
    return this.element;
  }

  layout(_width: number, _height: number) {
    this.activePane?.layout({
      width: this.contentElement.clientWidth,
      height: this.contentElement.clientHeight,
    });
  }

  getTitlebarElement() {
    this.element.classList.add('comet-has-external-titlebar');
    return this.titlebarElement;
  }

  getActivePane() {
    return this.activePane;
  }

  whenTabViewStateSettled(tabId: string) {
    return this.pendingViewStateSaveByTabId.get(tabId) ?? Promise.resolve();
  }

  focusPrimaryInput() {
    queueMicrotask(() => {
      if (!this.modeToolbarHost.focusPrimaryInput()) {
        this.activePane?.focusPrimaryInput();
      }
    });
  }

  setProps(props: EditorGroupViewProps) {
    if (props.group.id !== this.props.group.id) {
      this.saveActivePaneViewState();
      this.disposeAllPaneInstances();
      this.viewStateStore.replaceAll(props.viewStateEntries);
    }
    this.props = props;
    this.controller.setContext(props);
    this.render();
  }

  dispose() {
    this.titleAreaControl.dispose();
    this.titlebarActionsView.dispose();
    this.modeToolbarHost.dispose();
    this.saveActivePaneViewState();
    this.disposeAllPaneInstances();
    this.element.replaceChildren();
  }

  private readonly handlePaneStateChange = (
    input: EditorInput,
    state: EditorPaneRuntimeState,
  ) => {
    this.controller.updateRuntimeState(getEditorInputId(input), state);
    const snapshot = this.controller.getSnapshot();
    this.titleAreaControl.setProps(
      createTitleControlProps(this.props, snapshot.group, this.requestPrimaryInputFocus),
    );
    this.props.onStatusChange?.(snapshot.editorStatus);
  };

  private render() {
    const { group, editorStatus } = this.controller.getSnapshot();
    const resolverContext = this.createPaneResolverContext();
    this.props.onStatusChange?.(editorStatus);
    this.titleAreaControl.setProps(
      createTitleControlProps(
        this.props,
        group,
        this.requestPrimaryInputFocus,
      ),
    );
    this.titlebarElement.classList.toggle('comet-has-tabs', group.tabs.length > 0);
    this.titlebarElement.classList.toggle(
      'comet-has-leading-window-controls-inset',
      Boolean(this.props.hasLeadingTitlebarWindowControlsInset),
    );
    this.titlebarActionsView.setProps({
      contextMenuService: this.props.contextMenuService,
      contextViewProvider: this.props.contextViewProvider,
      isEditorCollapsed: Boolean(this.props.isEditorCollapsed),
      isAgentSidebarVisible: Boolean(this.props.isAgentSidebarVisible),
      showAgentSidebarToggle: Boolean(this.props.showAgentSidebarToggle),
      agentSidebarToggleLabel: this.props.agentSidebarToggleLabel ?? '',
      labels: {
        headerAddAction: this.props.labels.headerAddAction,
        expandEditor: this.props.labels.expandEditor,
        collapseEditor: this.props.labels.collapseEditor,
      },
		creationActions: this.props.creationActions,
      commandService: this.props.commandService,
      onToggleEditorCollapse: this.props.onToggleEditorCollapse ?? (() => {}),
      onToggleAgentSidebar: this.props.onToggleAgentSidebar,
    });
    this.modeToolbarHost.setContext(this.createModeToolbarHostContext(this.props, null));
    this.syncTitlebarActions(
      this.props.showTitlebarActions ? this.titlebarActionsView.getElement() : null,
      this.props.titlebarAuxiliaryActionsElements ?? [],
    );

    this.contentElement.className = 'comet-editor-content';
    this.contentElement.removeAttribute('data-editor-pane');

    if (!group.activeTab) {
      this.releaseActivePane();
      this.syncToolbar(null);
      this.syncToolbarMode(null);
      this.emptyWorkspaceView.setProps({
		creationActions: this.props.creationActions,
        commandService: this.props.commandService,
      });
      this.contentElement.replaceChildren(this.emptyWorkspaceView.getElement());
      return;
    }

    const resolvedPane = resolveEditorPane(group.activeTab, resolverContext);
    this.syncToolbarMode(resolvedPane.paneId);

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
        group.activeTab,
        nextPaneViewStateKey,
      );
    } else {
      const activeEditorId = getEditorInputId(group.activeTab);
      const didSwitchActivePaneTab = this.activePaneTabId !== activeEditorId;
      if (didSwitchActivePaneTab) {
        this.saveActivePaneViewState();
      }

      this.activePaneTabId = activeEditorId;
      this.activePaneViewStateKey = nextPaneViewStateKey;
      this.bindActivePaneRuntimeState(this.activePane, group.activeTab);
      resolvedPane.updatePane?.(this.activePane);
      if (didSwitchActivePaneTab) {
        this.setActivePaneInput(resolvedPane, this.activePane);
        this.restorePaneViewState(this.activePane, nextPaneViewStateKey);
      }
      this.activePane.setVisible(!this.props.isEditorCollapsed);
      if (this.contentElement.firstChild !== this.activePane.getElement()) {
        this.contentElement.replaceChildren(this.activePane.getElement());
      }
    }

    this.modeToolbarHost.setContext(this.createModeToolbarHostContext(this.props, resolvedPane.paneId));
    this.syncToolbar(this.resolveToolbarElement());
    this.flushPrimaryInputFocus(group.activeTab);
  }

  private createModeToolbarHostContext(
    props: EditorGroupViewProps,
    activePaneId: string | null,
  ) {
    return {
      ...props,
      activeTab: props.group.activeEditor,
      activePaneId,
      activePane: this.activePane,
      contentElement: this.contentElement,
      toolbarElement: this.toolbarElement,
    };
  }

  private readonly requestPrimaryInputFocus = () => {
    this.shouldFocusPrimaryInput = true;
  };

  private flushPrimaryInputFocus(activeTab: EditorInput | null) {
    if (!this.shouldFocusPrimaryInput || !activeTab?.prefersPrimaryInputFocus()) {
      return;
    }

    this.shouldFocusPrimaryInput = false;
    this.focusPrimaryInput();
  }

  private syncTitlebarActions(
    titlebarActionsElement: HTMLElement | null,
    titlebarAuxiliaryActionsElements: readonly HTMLElement[],
  ) {
    const nextTitlebarActionsElements: HTMLElement[] = [];
    for (const element of titlebarAuxiliaryActionsElements) {
      if (!element || nextTitlebarActionsElements.includes(element)) {
        continue;
      }
      nextTitlebarActionsElements.push(element);
    }
    if (
      titlebarActionsElement &&
      !nextTitlebarActionsElements.includes(titlebarActionsElement)
    ) {
      nextTitlebarActionsElements.push(titlebarActionsElement);
    }

const currentTitlebarActionsElements = Array.from(this.actionsElement.children);
    const hasSameOrder =
      currentTitlebarActionsElements.length === nextTitlebarActionsElements.length &&
      currentTitlebarActionsElements.every(
        (element, index) => element === nextTitlebarActionsElements[index],
      );
    if (hasSameOrder) {
      return;
    }

    this.actionsElement.replaceChildren(...nextTitlebarActionsElements);
  }

  private syncToolbar(toolbarContentElement: HTMLElement | null) {
    const currentToolbarContentElement = this.toolbarElement.firstElementChild;
    if (toolbarContentElement) {
      if (currentToolbarContentElement !== toolbarContentElement) {
        this.toolbarElement.replaceChildren(toolbarContentElement);
      }
      this.toolbarElement.hidden = false;
      return;
    }

    if (currentToolbarContentElement) {
      this.toolbarElement.replaceChildren();
    }
    this.toolbarElement.hidden = true;
  }

  private syncToolbarMode(paneId: string | null) {
    if (!paneId) {
      this.toolbarElement.removeAttribute('data-toolbar-mode');
      return;
    }

    this.toolbarElement.dataset.toolbarMode = paneId;
  }

  private resolveToolbarElement() {
    if (!this.props.showToolbar) {
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
    input: EditorInput,
  ): EditorViewStateKey {
    return {
      groupId: this.props.group.id,
      paneId,
      resourceKey: getEditorInputId(input),
    };
  }

  private createPaneResolverContext(): EditorPaneResolverContext {
    return {
      contextMenuService: this.props.contextMenuService,
      contextViewProvider: this.props.contextViewProvider,
		ui: this.props.ui,
      viewPartProps: this.props.viewPartProps,
      nativeHost: this.props.nativeHost,
      dialogService: this.props.dialogService,
      instantiationService: this.props.instantiationService,
      onOpenEditor: this.props.onOpenEditor,
      onOpenSources: this.props.onOpenSources,
    };
  }

  private activateResolvedPane(
    resolvedPane: ReturnType<typeof resolveEditorPane>,
    input: EditorInput,
    viewStateKey: EditorViewStateKey,
  ) {
    const existingPane = this.paneInstances.get(resolvedPane.paneKey);
    this.activePane = existingPane ?? resolvedPane.createPane();
    if (!existingPane) {
      this.paneInstances.set(resolvedPane.paneKey, this.activePane);
    }
    this.activePaneTabId = getEditorInputId(input);
    this.activePaneViewStateKey = viewStateKey;
    this.activePaneKey = resolvedPane.paneKey;
    this.bindActivePaneRuntimeState(this.activePane, input);
		resolvedPane.updatePane?.(this.activePane);
		this.setActivePaneInput(resolvedPane, this.activePane);
    this.activePane.setVisible(!this.props.isEditorCollapsed);
    this.contentElement.replaceChildren(this.activePane.getElement());
    this.restorePaneViewState(this.activePane, viewStateKey);
  }

  private bindActivePaneRuntimeState(pane: AnyEditorPane, input: EditorInput): void {
    this.activePaneRuntimeStateListener.dispose();
    this.activePaneRuntimeStateListener = pane.onDidChangeRuntimeState(state => {
      this.handlePaneStateChange(input, state);
    });
    const state = pane.getRuntimeState();
    if (state) {
      this.handlePaneStateChange(input, state);
    }
  }

  private setActivePaneInput(
    resolvedPane: ReturnType<typeof resolveEditorPane>,
    pane: AnyEditorPane,
  ): void {
    this.activePaneInputSource?.cancel();
    this.activePaneInputSource?.dispose();
    const source = new CancellationTokenSource();
    this.activePaneInputSource = source;
		const result = resolvedPane.setInput(pane, source.token);
		if (result) {
			void this.completeSetActivePaneInput(result, source);
			return;
		}
		this.finishSetActivePaneInput(source);
	}

	private async completeSetActivePaneInput(
		result: Promise<void>,
		source: CancellationTokenSource,
	): Promise<void> {
		try {
			await result;
		} finally {
			this.finishSetActivePaneInput(source);
		}
	}

	private finishSetActivePaneInput(source: CancellationTokenSource): void {
		if (this.activePaneInputSource === source) {
			this.activePaneInputSource = null;
		}
		source.dispose();
	}

  private releaseActivePane() {
    if (!this.activePane) {
      return;
    }

    this.saveActivePaneViewState();
    this.activePaneInputSource?.cancel();
    this.activePaneInputSource?.dispose();
    this.activePaneInputSource = null;
		this.activePaneRuntimeStateListener.dispose();
		this.activePaneRuntimeStateListener = Disposable.None;

    const pane = this.activePane;
    this.activePane = null;
    this.activePaneTabId = null;
    this.activePaneViewStateKey = null;
    this.activePaneKey = null;

    pane.clearInput();
    pane.setVisible(false);
  }

  private disposePane(pane: AnyEditorPane) {
    pane.clearInput();
    pane.dispose();
  }

  private disposeAllPaneInstances() {
		this.activePaneInputSource?.cancel();
		this.activePaneInputSource?.dispose();
		this.activePaneInputSource = null;
    this.activePaneRuntimeStateListener.dispose();
    this.activePaneRuntimeStateListener = Disposable.None;
    for (const pane of this.paneInstances.values()) {
      this.disposePane(pane);
    }
    this.paneInstances.clear();
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
