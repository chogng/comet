/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createEmptyEditorStatus } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import { $ } from 'cs/base/browser/dom';
import { isCancellationError } from 'cs/base/common/cancellation';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { EditorPanes, type EditorPanesContext } from 'cs/workbench/browser/parts/editor/editorPanes';

import { EditorEmptyWorkspaceView } from 'cs/workbench/browser/parts/editor/editorEmptyWorkspaceView';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPart';
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
import type {
  EditorViewStateKey,
  SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';

import { TabsTitleControl } from 'cs/workbench/browser/parts/editor/tabsTitleControl';
import type { TitleControl, TitleControlProps } from 'cs/workbench/browser/parts/editor/titleControl';
import { getWindowChromeLayout } from 'cs/platform/window/common/window';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IContextKeyService, type ContextKey } from 'cs/platform/contextkey/common/contextkey';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { EditorCreationAction } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import type { IEditorOpenContext, IEditorOptions } from 'cs/workbench/common/editor';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export type EditorGroupViewProps = DropdownContextServices & {
  labels: EditorPartLabels;
  creationActions: readonly EditorCreationAction[];
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
  commandService: IWorkbenchCommandService;
  onSetEditorViewState: (key: EditorViewStateKey, state: unknown) => void;
  onDeleteEditorViewState: (key: EditorViewStateKey) => void;
  showTitlebarActions?: boolean;
  showToolbar?: boolean;
  isEditorCollapsed?: boolean;
  onToggleEditorCollapse: () => void;
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
    onActivateTab: tabId => {
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
  private readonly titleAreaControl: TitleControl;
  private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-editor-content');
  private readonly emptyWorkspaceView: EditorEmptyWorkspaceView;
  private readonly editorPanes: EditorPanes;
  private pendingAutomaticPaneOpen: Promise<void> | null = null;
  private automaticPaneOpenError: unknown;
  private shouldFocusPrimaryInput = false;
	private readonly activeEditorFocusedContext: ContextKey<boolean>;

  constructor(
	props: EditorGroupViewProps,
	@IInstantiationService private readonly instantiationService: IInstantiationService,
	@IContextKeyService contextKeyService: IContextKeyService,
  ) {
    this.props = props;
	this.activeEditorFocusedContext = ActiveEditorFocusedContext.bindTo(contextKeyService);
    this.titlebarActionsView = createEditorTitlebarActionsView({
      contextMenuService: props.contextMenuService,
      contextViewProvider: props.contextViewProvider,
      isEditorCollapsed: Boolean(props.isEditorCollapsed),
      labels: {
        headerAddAction: props.labels.headerAddAction,
        expandEditor: props.labels.expandEditor,
        collapseEditor: props.labels.collapseEditor,
      },
      creationActions: props.creationActions,
      commandService: props.commandService,
      onToggleEditorCollapse: props.onToggleEditorCollapse,
    });
    this.controller = new EditorGroupController(props);
    this.editorPanes = this.instantiationService.createInstance(
		EditorPanes,
		this.contentElement,
		this.createEditorPanesContext(props),
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
	this.element.addEventListener('focusin', this.handleEditorFocusIn);
	this.element.addEventListener('focusout', this.handleEditorFocusOut);
    this.render();
  }

  getElement() {
    return this.element;
  }

  layout(_width: number, _height: number) {
    this.editorPanes.layout({
      width: this.contentElement.clientWidth,
      height: this.contentElement.clientHeight,
    });
  }

  getTitlebarElement() {
    this.element.classList.add('comet-has-external-titlebar');
    return this.titlebarElement;
  }

  getActivePane() {
	const activeEditor = this.props.group.activeEditor;
	return activeEditor && this.editorPanes.hasActiveInput(activeEditor)
		? this.editorPanes.getActivePane()
		: null;
  }

	async captureActivePaneViewState(): Promise<void> {
		await this.editorPanes.captureActivePaneViewState();
	}

  async whenTabViewStateSettled(tabId: string): Promise<void> {
    await this.pendingAutomaticPaneOpen;
    if (this.automaticPaneOpenError !== undefined) {
      const error = this.automaticPaneOpenError;
      this.automaticPaneOpenError = undefined;
      throw error;
    }
    await this.editorPanes.whenViewStateSettled(tabId);
  }

  focusPrimaryInput() {
    queueMicrotask(() => {
		this.editorPanes.focusPrimaryInput();
    });
  }

  async openEditor(
    input: EditorInput,
    options: IEditorOptions | undefined,
    context: IEditorOpenContext,
  ): Promise<void> {
    this.automaticPaneOpenError = undefined;
    this.pendingAutomaticPaneOpen = null;
    await this.editorPanes.openEditor(input, options, context);
    this.syncEditorPanePresentation(input);
  }

  setProps(props: EditorGroupViewProps) {
    if (props.group.id !== this.props.group.id) {
      this.automaticPaneOpenError = undefined;
    }
    this.props = props;
	if (props.isEditorCollapsed) {
		this.activeEditorFocusedContext.reset();
	} else if (this.element.contains(this.element.ownerDocument.activeElement)) {
		this.activeEditorFocusedContext.set(true);
	}
    this.controller.setContext(props);
    this.editorPanes.setContext(this.createEditorPanesContext(props));
    this.render();
  }

  dispose() {
	this.element.removeEventListener('focusin', this.handleEditorFocusIn);
	this.element.removeEventListener('focusout', this.handleEditorFocusOut);
	this.activeEditorFocusedContext.reset();
    this.titleAreaControl.dispose();
    this.titlebarActionsView.dispose();
    this.editorPanes.dispose();
    this.element.replaceChildren();
  }

	private readonly handleEditorFocusIn = () => {
		if (!this.props.isEditorCollapsed) {
			this.activeEditorFocusedContext.set(true);
		}
	};

	private readonly handleEditorFocusOut = (event: FocusEvent) => {
		const nextTarget = event.relatedTarget;
		if (nextTarget instanceof Node && this.element.contains(nextTarget)) {
			return;
		}
		this.activeEditorFocusedContext.reset();
	};

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
      labels: {
        headerAddAction: this.props.labels.headerAddAction,
        expandEditor: this.props.labels.expandEditor,
        collapseEditor: this.props.labels.collapseEditor,
      },
      creationActions: this.props.creationActions,
      commandService: this.props.commandService,
      onToggleEditorCollapse: this.props.onToggleEditorCollapse,
    });
    this.syncTitlebarActions(
      this.props.showTitlebarActions ? this.titlebarActionsView.getElement() : null,
      this.props.titlebarAuxiliaryActionsElements ?? [],
    );

    if (!group.activeTab) {
      this.editorPanes.clearActiveEditor();
      this.syncToolbar(null);
      this.syncToolbarMode(null);
      this.emptyWorkspaceView.setProps({
			creationActions: this.props.creationActions,
        commandService: this.props.commandService,
      });
      this.contentElement.replaceChildren(this.emptyWorkspaceView.getElement());
      return;
    }

    if (!this.editorPanes.hasActiveInput(group.activeTab)) {
      this.trackAutomaticPaneOpen(
        this.editorPanes.openEditor(group.activeTab, undefined, { newInGroup: false }),
        group.activeTab,
      );
    }
    this.syncEditorPanePresentation(group.activeTab);
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

	return this.editorPanes.getToolbarElement();
  }

  private createEditorPanesContext(props: EditorGroupViewProps): EditorPanesContext {
    return {
			groupId: props.group.id,
			visible: !props.isEditorCollapsed,
			viewStateEntries: props.viewStateEntries,
			onDidChangeRuntimeState: this.handlePaneStateChange,
			onSetEditorViewState: props.onSetEditorViewState,
			onDeleteEditorViewState: props.onDeleteEditorViewState,
    };
  }

  private trackAutomaticPaneOpen(pendingOpen: Promise<void>, input: EditorInput): void {
		const trackedOpen = pendingOpen.then(
			() => this.syncEditorPanePresentation(input),
			error => {
				if (!isCancellationError(error)) {
					this.automaticPaneOpenError = error;
				}
			},
		);
		this.pendingAutomaticPaneOpen = trackedOpen;
  }

	private syncEditorPanePresentation(activeTab: EditorInput): void {
		const activePaneModeId = this.editorPanes.getActivePaneModeId();
		this.syncToolbarMode(activePaneModeId);
		this.syncToolbar(this.resolveToolbarElement());
		this.flushPrimaryInputFocus(activeTab);
  }
}
