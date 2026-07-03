import { EventEmitter } from 'ls/base/common/event';
import type {
  GridSashSnapEvent,
  IGridView,
} from 'ls/base/browser/ui/grid/gridview';
import { GridBranchView, GridView, Orientation } from 'ls/base/browser/ui/grid/gridview';
import {
  LifecycleStore,
  MutableLifecycle,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';
import type { WorkbenchPage } from 'ls/workbench/browser/workbench';
import {
  getLayoutLimits,
  type LayoutAxisLimits,
  WORKBENCH_SPLITVIEW_LIMITS,
} from 'ls/workbench/browser/layoutLimits';
import type {
  LayoutLeafId,
  LayoutNode,
} from 'ls/workbench/browser/layoutModel';
import {
  reconcileLayoutTree,
  resolveFlexState,
  updateLeaf,
} from 'ls/workbench/browser/layoutModel';
import {
  WORKBENCH_PART_IDS,
  type WorkbenchPartId,
  type WorkbenchPartRefCallback,
} from 'ls/workbench/browser/part';

export type WorkbenchLayoutStateSnapshot = {
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  primarySidebarSize: number;
  agentSidebarSize: number;
  isEditorCollapsed: boolean;
  expandedEditorSize: number;
};

export type WorkbenchLayoutEvent =
  | {
      type: 'SET_SIDEBAR_SIZES';
      sizes: Partial<
        Pick<
          WorkbenchLayoutStateSnapshot,
          'primarySidebarSize' | 'agentSidebarSize'
        >
      >;
    }
  | {
      type: 'SET_PRIMARY_SIDEBAR_VISIBLE';
      visible: boolean;
    }
  | {
      type: 'TOGGLE_PRIMARY_SIDEBAR_VISIBILITY';
    }
  | {
      type: 'SET_PRIMARY_SIDEBAR_SIZE';
      size: number;
    }
  | {
      type: 'SET_AGENT_SIDEBAR_VISIBLE';
      visible: boolean;
    }
  | {
      type: 'TOGGLE_AGENT_SIDEBAR_VISIBILITY';
    }
  | {
      type: 'SET_AGENT_SIDEBAR_SIZE';
      size: number;
    }
  | {
      type: 'SET_EDITOR_COLLAPSED';
      collapsed: boolean;
      expandedEditorSize?: number;
    };

type WorkbenchShellLayoutParams = {
  activePage: WorkbenchPage;
};

type WorkbenchContentLayoutParams = {
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
};

export type WorkbenchContentLayoutControllerState = {
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  isLayoutEdgeSnappingEnabled: boolean;
  primarySidebarSize: number;
  agentSidebarSize: number;
  isEditorCollapsed: boolean;
  expandedEditorSize: number;
};

type SplitViewSizeSnapshot = {
  primarySidebarSize: number;
  editorSize: number;
  agentSidebarSize: number;
};

const PRIMARY_SIDEBAR_INDEX = 0;
const EDITOR_INDEX = 1;
const AGENT_SIDEBAR_INDEX = 2;

export const WORKBENCH_CONTENT_LAYOUT_BREAKPOINT = 980;
export const WORKBENCH_SPLITVIEW_RESERVE_SASH_SPACE = false;

export { WORKBENCH_PART_IDS };
export type { WorkbenchPartId, WorkbenchPartRefCallback };

const DEFAULT_WORKBENCH_LAYOUT_STATE: WorkbenchLayoutStateSnapshot = {
  isPrimarySidebarVisible: true,
  isAgentSidebarVisible: true,
  primarySidebarSize: WORKBENCH_SPLITVIEW_LIMITS.sidebar.defaultSize,
  agentSidebarSize: WORKBENCH_SPLITVIEW_LIMITS.agentSidebar.defaultSize,
  isEditorCollapsed: false,
  expandedEditorSize: WORKBENCH_SPLITVIEW_LIMITS.editor.minimum,
};

const DEFAULT_WORKBENCH_PART_DOM_SNAPSHOT: Record<WorkbenchPartId, HTMLElement | null> = {
  [WORKBENCH_PART_IDS.container]: null,
  [WORKBENCH_PART_IDS.titlebar]: null,
  [WORKBENCH_PART_IDS.sidebar]: null,
  [WORKBENCH_PART_IDS.agentSidebar]: null,
  [WORKBENCH_PART_IDS.statusbar]: null,
  [WORKBENCH_PART_IDS.settings]: null,
  [WORKBENCH_PART_IDS.editor]: null,
  [WORKBENCH_PART_IDS.webContentViewHost]: null,
};

let workbenchLayoutState = DEFAULT_WORKBENCH_LAYOUT_STATE;
const onDidChangeWorkbenchLayoutStateEmitter = new EventEmitter<void>();

let workbenchPartDomSnapshot = DEFAULT_WORKBENCH_PART_DOM_SNAPSHOT;
const onDidChangeWorkbenchPartDomEmitter = new EventEmitter<void>();
const workbenchPartRefCallbacks = new Map<
  WorkbenchPartId,
  WorkbenchPartRefCallback
>();
let activeContentLayoutOrientation: Orientation | null = null;

function clampSidebarSize(target: 'sidebar' | 'agentSidebar', size: number) {
  const limits = resolveActiveClampLimits();
  const axisLimits =
    target === 'sidebar'
      ? limits.primarySidebar
      : limits.agentSidebar;

  return Math.max(axisLimits.minimum, Math.min(axisLimits.maximum, Math.round(size)));
}

function clampExpandedEditorSize(size: number) {
  const limits = resolveActiveClampLimits();
  return Math.max(
    limits.editor.minimum,
    Math.min(limits.editor.maximum, Math.round(size)),
  );
}

function resolveActiveClampLimits() {
  if (activeContentLayoutOrientation !== null) {
    return getLayoutLimits(activeContentLayoutOrientation);
  }

  if (typeof window === 'undefined') {
    return getLayoutLimits(Orientation.VERTICAL);
  }

  return getLayoutLimits(resolveOrientationFromWidth(window.innerWidth));
}

function resolveOrientationFromWidth(width: number) {
  return width <= WORKBENCH_CONTENT_LAYOUT_BREAKPOINT
    ? Orientation.HORIZONTAL
    : Orientation.VERTICAL;
}

function normalizeEditorCollapseState(
  state: WorkbenchLayoutStateSnapshot,
) {
  if (
    !state.isPrimarySidebarVisible &&
    !state.isAgentSidebarVisible &&
    state.isEditorCollapsed
  ) {
    return {
      ...state,
      isEditorCollapsed: false,
    };
  }

  return state;
}

function reduceWorkbenchLayoutState(
  state: WorkbenchLayoutStateSnapshot,
  event: WorkbenchLayoutEvent,
): WorkbenchLayoutStateSnapshot {
  switch (event.type) {
    case 'SET_SIDEBAR_SIZES': {
      const nextPrimarySidebarSize =
        typeof event.sizes.primarySidebarSize === 'number'
          ? clampSidebarSize('sidebar', event.sizes.primarySidebarSize)
          : state.primarySidebarSize;
      const nextAgentSidebarSize =
        typeof event.sizes.agentSidebarSize === 'number'
          ? clampSidebarSize('agentSidebar', event.sizes.agentSidebarSize)
          : state.agentSidebarSize;

      if (
        state.primarySidebarSize === nextPrimarySidebarSize &&
        state.agentSidebarSize === nextAgentSidebarSize
      ) {
        return state;
      }

      return {
        ...state,
        primarySidebarSize: nextPrimarySidebarSize,
        agentSidebarSize: nextAgentSidebarSize,
      };
    }
    case 'SET_PRIMARY_SIDEBAR_VISIBLE':
      if (state.isPrimarySidebarVisible === event.visible) {
        return normalizeEditorCollapseState(state);
      }
      return normalizeEditorCollapseState({
        ...state,
        isPrimarySidebarVisible: event.visible,
      });
    case 'TOGGLE_PRIMARY_SIDEBAR_VISIBILITY':
      return normalizeEditorCollapseState({
        ...state,
        isPrimarySidebarVisible: !state.isPrimarySidebarVisible,
      });
    case 'SET_PRIMARY_SIDEBAR_SIZE': {
      const nextSize = clampSidebarSize('sidebar', event.size);
      if (state.primarySidebarSize === nextSize) {
        return state;
      }
      return {
        ...state,
        primarySidebarSize: nextSize,
      };
    }
    case 'SET_AGENT_SIDEBAR_VISIBLE':
      if (state.isAgentSidebarVisible === event.visible) {
        return normalizeEditorCollapseState(state);
      }
      return normalizeEditorCollapseState({
        ...state,
        isAgentSidebarVisible: event.visible,
        isEditorCollapsed: event.visible ? state.isEditorCollapsed : false,
      });
    case 'TOGGLE_AGENT_SIDEBAR_VISIBILITY': {
      const nextVisible = !state.isAgentSidebarVisible;
      return normalizeEditorCollapseState({
        ...state,
        isAgentSidebarVisible: nextVisible,
        isEditorCollapsed: nextVisible ? state.isEditorCollapsed : false,
      });
    }
    case 'SET_AGENT_SIDEBAR_SIZE': {
      const nextSize = clampSidebarSize('agentSidebar', event.size);
      if (state.agentSidebarSize === nextSize) {
        return state;
      }
      return {
        ...state,
        agentSidebarSize: nextSize,
      };
    }
    case 'SET_EDITOR_COLLAPSED': {
      const nextExpandedEditorSize =
        typeof event.expandedEditorSize === 'number'
          ? clampExpandedEditorSize(event.expandedEditorSize)
          : state.expandedEditorSize;

      if (
        state.isEditorCollapsed === event.collapsed &&
        state.expandedEditorSize === nextExpandedEditorSize
      ) {
        return state;
      }

      const nextState = normalizeEditorCollapseState({
        ...state,
        isEditorCollapsed: event.collapsed,
        expandedEditorSize: nextExpandedEditorSize,
      });

      if (
        state.isEditorCollapsed === nextState.isEditorCollapsed &&
        state.expandedEditorSize === nextState.expandedEditorSize
      ) {
        return state;
      }

      return nextState;
    }
    default:
      return state;
  }
}

export function subscribeWorkbenchLayoutState(listener: () => void) {
  return onDidChangeWorkbenchLayoutStateEmitter.event(listener);
}

export function getWorkbenchLayoutStateSnapshot() {
  return workbenchLayoutState;
}

export function subscribeWorkbenchPartDom(listener: () => void) {
  return onDidChangeWorkbenchPartDomEmitter.event(listener);
}

export function getWorkbenchPartDomSnapshot() {
  return workbenchPartDomSnapshot;
}

export function dispatchWorkbenchLayoutEvent(event: WorkbenchLayoutEvent) {
  const nextState = reduceWorkbenchLayoutState(workbenchLayoutState, event);
  if (Object.is(nextState, workbenchLayoutState)) {
    return;
  }

  workbenchLayoutState = nextState;
  onDidChangeWorkbenchLayoutStateEmitter.fire();
}

export function setWorkbenchSidebarSizes(
  sizes: Partial<
    Pick<
      WorkbenchLayoutStateSnapshot,
      'primarySidebarSize' | 'agentSidebarSize'
    >
  >,
) {
  dispatchWorkbenchLayoutEvent({
    type: 'SET_SIDEBAR_SIZES',
    sizes,
  });
}

export function setPrimarySidebarVisible(visible: boolean) {
  dispatchWorkbenchLayoutEvent({
    type: 'SET_PRIMARY_SIDEBAR_VISIBLE',
    visible,
  });
}

export function setPrimarySidebarSize(size: number) {
  dispatchWorkbenchLayoutEvent({
    type: 'SET_PRIMARY_SIDEBAR_SIZE',
    size,
  });
}

export function togglePrimarySidebarVisibility() {
  dispatchWorkbenchLayoutEvent({
    type: 'TOGGLE_PRIMARY_SIDEBAR_VISIBILITY',
  });
}

export function setAgentSidebarVisible(visible: boolean) {
  dispatchWorkbenchLayoutEvent({
    type: 'SET_AGENT_SIDEBAR_VISIBLE',
    visible,
  });
}

export function setAgentSidebarSize(size: number) {
  dispatchWorkbenchLayoutEvent({
    type: 'SET_AGENT_SIDEBAR_SIZE',
    size,
  });
}

export function toggleAgentSidebarVisibility() {
  dispatchWorkbenchLayoutEvent({
    type: 'TOGGLE_AGENT_SIDEBAR_VISIBILITY',
  });
}

export function setEditorCollapsed(
  collapsed: boolean,
  expandedEditorSize?: number,
) {
  dispatchWorkbenchLayoutEvent({
    type: 'SET_EDITOR_COLLAPSED',
    collapsed,
    expandedEditorSize,
  });
}

export function toggleEditorCollapsed(expandedEditorSize?: number) {
  dispatchWorkbenchLayoutEvent({
    type: 'SET_EDITOR_COLLAPSED',
    collapsed: !workbenchLayoutState.isEditorCollapsed,
    expandedEditorSize,
  });
}

export function getWorkbenchPartDomNode(partId: WorkbenchPartId) {
  return workbenchPartDomSnapshot[partId];
}

export function registerWorkbenchPartDomNode(
  partId: WorkbenchPartId,
  element: HTMLElement | null,
) {
  if (workbenchPartDomSnapshot[partId] === element) {
    return;
  }

  workbenchPartDomSnapshot = {
    ...workbenchPartDomSnapshot,
    [partId]: element,
  };
  onDidChangeWorkbenchPartDomEmitter.fire();
}

export function createWorkbenchPartRef(
  partId: WorkbenchPartId,
): WorkbenchPartRefCallback {
  const cachedCallback = workbenchPartRefCallbacks.get(partId);
  if (cachedCallback) {
    return cachedCallback;
  }

  const nextCallback: WorkbenchPartRefCallback = (element) => {
    registerWorkbenchPartDomNode(partId, element);
  };
  workbenchPartRefCallbacks.set(partId, nextCallback);
  return nextCallback;
}

export function getWorkbenchShellClassName({
  activePage,
}: WorkbenchShellLayoutParams) {
  return `app-shell ${activePage === 'settings' ? 'app-shell-settings' : ''}`.trim();
}

export function getWorkbenchContentClassName({
  isPrimarySidebarVisible,
  isAgentSidebarVisible,
}: WorkbenchContentLayoutParams) {
  return [
    'content-grid',
    isPrimarySidebarVisible ? 'is-primary-sidebar-visible' : '',
    isAgentSidebarVisible ? 'is-agent-sidebar-visible' : '',
  ]
    .filter(Boolean)
    .join(' ');
}

function addDisposableListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function syncElementContent(host: HTMLElement, content: HTMLElement | null) {
  if (content) {
    if (host.firstChild !== content || host.childNodes.length !== 1) {
      host.replaceChildren(content);
    }
    return;
  }

  if (host.childNodes.length > 0) {
    host.replaceChildren();
  }
}

function getRootSplitSize(
  state: WorkbenchContentLayoutControllerState,
  sizes: SplitViewSizeSnapshot,
) {
  return (
    (state.isPrimarySidebarVisible ? sizes.primarySidebarSize : 0) +
    sizes.editorSize +
    (state.isAgentSidebarVisible ? sizes.agentSidebarSize : 0)
  );
}

export class WorkbenchLayoutSlotView implements IGridView {
  readonly element: HTMLElement;
  readonly snap: boolean;
  private minimumWidthValue = 0;
  private maximumWidthValue = Number.POSITIVE_INFINITY;
  private minimumHeightValue = 0;
  private maximumHeightValue = Number.POSITIVE_INFINITY;

  constructor(className: string, snap = false) {
    this.snap = snap;
    this.element = document.createElement('div');
    this.element.className = `workbench-content-slot ${className}`.trim();
  }

  get minimumWidth() {
    return this.minimumWidthValue;
  }

  get maximumWidth() {
    return this.maximumWidthValue;
  }

  get minimumHeight() {
    return this.minimumHeightValue;
  }

  get maximumHeight() {
    return this.maximumHeightValue;
  }

  setConstraints(
    orientation: Orientation,
    constraints: LayoutAxisLimits,
  ) {
    if (orientation === Orientation.VERTICAL) {
      this.minimumWidthValue = constraints.minimum;
      this.maximumWidthValue = constraints.maximum;
      this.minimumHeightValue = 0;
      this.maximumHeightValue = Number.POSITIVE_INFINITY;
      return;
    }

    this.minimumWidthValue = 0;
    this.maximumWidthValue = Number.POSITIVE_INFINITY;
    this.minimumHeightValue = constraints.minimum;
    this.maximumHeightValue = constraints.maximum;
  }

  setContent(content: HTMLElement | null) {
    syncElementContent(this.element, content);
  }

  layout() {
    // The slotted part roots stretch with CSS, so no per-frame DOM work is needed here.
  }
}

export class WorkbenchContentLayoutController {
  private layoutTree: LayoutNode | null = null;
  private gridView: GridView | null = null;
  private rootGrid: GridBranchView | null = null;
  private gridOrientation: Orientation | null = null;
  private gridPrimarySidebarVisibleState: boolean | null = null;
  private gridEditorCollapsedState: boolean | null = null;
  private gridFlexStateKey: string | null = null;
  private nextSyncCachedSizesOverride: SplitViewSizeSnapshot | null = null;
  private reapplySidebarSizesAfterNextLayout = false;
  private splitConstraints = getLayoutLimits(Orientation.VERTICAL);
  private disposed = false;
  private readonly gridDisposables = new LifecycleStore();
  private readonly resizeObserver = new MutableLifecycle<DisposableLike>();
  private readonly layoutAnimationFrame = new MutableLifecycle<DisposableLike>();

  constructor(
    private readonly options: {
      container: HTMLElement;
      contentHost: HTMLElement;
      primarySidebarSlot: WorkbenchLayoutSlotView;
      editorSlot: WorkbenchLayoutSlotView;
      agentSidebarSlot: WorkbenchLayoutSlotView;
      getState: () => WorkbenchContentLayoutControllerState;
      onPrimarySidebarVisibilityChange: (visible: boolean) => void;
      onAgentSidebarVisibilityChange: (visible: boolean) => void;
      onSidebarSizesChange: (sizes: {
        primarySidebarSize: number;
        agentSidebarSize: number;
      }) => void;
    },
  ) {
    this.installResizeObserver();
  }

  sync() {
    const state = this.options.getState();
    const orientation = this.resolveSplitOrientation();
    const cachedSizes = this.resolveSyncCachedSizes(state);
    this.syncSplitSlotConstraints(orientation);
    this.syncLayoutTree(state, orientation, cachedSizes);
    this.ensureGridView(state, orientation, cachedSizes);
    if (!this.gridView) {
      this.nextSyncCachedSizesOverride = null;
      this.reapplySidebarSizesAfterNextLayout = false;
      return;
    }

    this.gridView.edgeSnapping = state.isLayoutEdgeSnappingEnabled;
    this.gridView.setViewVisible([PRIMARY_SIDEBAR_INDEX], state.isPrimarySidebarVisible);
    this.gridView.setViewVisible([EDITOR_INDEX], !state.isEditorCollapsed);
    this.gridView.setViewVisible([AGENT_SIDEBAR_INDEX], state.isAgentSidebarVisible);
    this.applySidebarSizesToGridView(state);
    this.scheduleGridViewLayout();
    this.nextSyncCachedSizesOverride = null;
  }

  layout() {
    if (this.disposed) {
      return;
    }

    this.handleContainerResize();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    activeContentLayoutOrientation = null;
    this.resizeObserver.dispose();
    this.layoutAnimationFrame.dispose();
    this.disposeGridView();
  }

  getEditorViewSize() {
    return this.gridView?.getViewSize([EDITOR_INDEX]) ?? null;
  }

  setNextSyncCachedSizesOverride(cachedSizes: SplitViewSizeSnapshot | null) {
    this.nextSyncCachedSizesOverride = cachedSizes;
    this.reapplySidebarSizesAfterNextLayout = Boolean(cachedSizes);
  }

  private resolveSyncCachedSizes(state: WorkbenchContentLayoutControllerState) {
    return this.nextSyncCachedSizesOverride ?? this.captureGridSizes(state);
  }

  private computeFlexState(
    state: Pick<
      WorkbenchContentLayoutControllerState,
      'isAgentSidebarVisible' | 'isEditorCollapsed'
    >,
  ) {
    return resolveFlexState({
      isAgentSidebarVisible: state.isAgentSidebarVisible,
      isEditorVisible: !state.isEditorCollapsed,
    });
  }

  private resolveGridFlexStateKey(state: WorkbenchContentLayoutControllerState) {
    const flexState = this.computeFlexState(state);
    return `${flexState.agentSidebarFlex ? 1 : 0}:${flexState.editorFlex ? 1 : 0}`;
  }

  private ensureGridView(
    state: WorkbenchContentLayoutControllerState,
    orientation: Orientation,
    cachedSizes: SplitViewSizeSnapshot,
  ) {
    const flexStateKey = this.resolveGridFlexStateKey(state);
    if (
      this.gridView &&
      this.rootGrid &&
      this.gridOrientation === orientation &&
      this.gridPrimarySidebarVisibleState === state.isPrimarySidebarVisible &&
      this.gridEditorCollapsedState === state.isEditorCollapsed &&
      this.gridFlexStateKey === flexStateKey &&
      this.options.contentHost.firstChild === this.gridView.element
    ) {
      return;
    }

    this.disposeGridView();
    this.syncLayoutTree(state, orientation, cachedSizes);
    const layoutTree = this.layoutTree;
    if (!layoutTree) {
      return;
    }

    const rootGrid = this.buildBranchFromTree(layoutTree);
    const gridView = new GridView(rootGrid);
    gridView.edgeSnapping = state.isLayoutEdgeSnappingEnabled;

    this.gridDisposables.add(gridView.onDidSashSnap(this.handleGridSashSnap));
    this.gridDisposables.add(gridView.onDidSashEnd(this.handleGridSashEnd));
    this.rootGrid = rootGrid;
    this.gridView = gridView;
    this.gridOrientation = orientation;
    this.gridPrimarySidebarVisibleState = state.isPrimarySidebarVisible;
    this.gridEditorCollapsedState = state.isEditorCollapsed;
    this.gridFlexStateKey = flexStateKey;
    this.options.contentHost.replaceChildren(gridView.element);
  }

  private disposeGridView() {
    this.gridDisposables.clear();
    this.gridView?.dispose();
    this.gridView = null;
    this.layoutTree = null;
    this.rootGrid = null;
    this.gridOrientation = null;
    this.gridPrimarySidebarVisibleState = null;
    this.gridEditorCollapsedState = null;
    this.gridFlexStateKey = null;
  }

  private readonly handleGridSashSnap = (event: GridSashSnapEvent) => {
    if (event.location.length !== 1) {
      return;
    }

    switch (event.itemIndex) {
      case PRIMARY_SIDEBAR_INDEX:
        this.options.onPrimarySidebarVisibilityChange(event.visible);
        break;
      case AGENT_SIDEBAR_INDEX:
        this.options.onAgentSidebarVisibilityChange(event.visible);
        break;
    }
  };

  private readonly handleGridSashEnd = (location: readonly number[]) => {
    if (location.length === 0 || !this.gridView) {
      return;
    }

    this.syncLayoutTreeFromGrid(this.options.getState());
    this.options.onSidebarSizesChange({
      primarySidebarSize: this.gridView.getViewSize([PRIMARY_SIDEBAR_INDEX]),
      agentSidebarSize: this.gridView.getViewSize([AGENT_SIDEBAR_INDEX]),
    });
  };

  private installResizeObserver() {
    if (typeof ResizeObserver === 'undefined') {
      this.resizeObserver.value = addDisposableListener(window, 'resize', this.handleWindowResize);
      return;
    }

    const resizeObserver = new ResizeObserver(() => {
      this.handleContainerResize();
    });
    resizeObserver.observe(this.options.container);
    this.resizeObserver.value = toDisposable(() => {
      resizeObserver.disconnect();
    });
  }

  private readonly handleWindowResize = () => {
    this.handleContainerResize();
  };

  private handleContainerResize() {
    const state = this.options.getState();
    const orientation = this.resolveSplitOrientation();
    const cachedSizes = this.captureGridSizes(state);
    this.syncSplitSlotConstraints(orientation);
    this.ensureGridView(state, orientation, cachedSizes);
    this.scheduleGridViewLayout();
  }

  private scheduleGridViewLayout() {
    if (this.disposed) {
      return;
    }

    this.layoutAnimationFrame.clear();

    let animationFrameHandle = 0;
    const animationFrameDisposable = toDisposable(() => {
      window.cancelAnimationFrame(animationFrameHandle);
    });
    this.layoutAnimationFrame.value = animationFrameDisposable;
    animationFrameHandle = window.requestAnimationFrame(() => {
      if (this.layoutAnimationFrame.value === animationFrameDisposable) {
        this.layoutAnimationFrame.clearAndLeak();
      }
      if (!this.gridView) {
        return;
      }

      const state = this.options.getState();
      const nextOrientation = this.resolveSplitOrientation();
      this.syncSplitSlotConstraints(nextOrientation);
      if (nextOrientation !== this.gridOrientation) {
        this.ensureGridView(state, nextOrientation, this.captureGridSizes(state));
        this.applySidebarSizesToGridView(state);
      }

      this.gridView.layout(
        this.options.contentHost.clientWidth,
        this.options.contentHost.clientHeight,
      );
      if (this.reapplySidebarSizesAfterNextLayout) {
        this.applySidebarSizesToGridView(this.options.getState());
        this.reapplySidebarSizesAfterNextLayout = false;
      }
    });
  }

  private resolveSplitOrientation() {
    const containerWidth =
      this.options.contentHost.clientWidth ||
      this.options.container.clientWidth ||
      window.innerWidth;
    const orientation = resolveOrientationFromWidth(containerWidth);
    activeContentLayoutOrientation = orientation;
    return orientation;
  }

  private syncSplitSlotConstraints(orientation: Orientation) {
    this.splitConstraints = getLayoutLimits(orientation);

    this.options.primarySidebarSlot.setConstraints(
      orientation,
      this.splitConstraints.primarySidebar,
    );
    this.options.editorSlot.setConstraints(orientation, this.splitConstraints.editor);
    this.options.agentSidebarSlot.setConstraints(
      orientation,
      this.splitConstraints.agentSidebar,
    );
  }

  private applySidebarSizesToGridView(state: WorkbenchContentLayoutControllerState) {
    if (!this.gridView) {
      return;
    }

    this.gridView.setViewSize([PRIMARY_SIDEBAR_INDEX], state.primarySidebarSize);
    this.gridView.setViewSize([AGENT_SIDEBAR_INDEX], state.agentSidebarSize);
  }

  private captureGridSizes(state: WorkbenchContentLayoutControllerState): SplitViewSizeSnapshot {
    if (!this.gridView) {
      return {
        primarySidebarSize: state.primarySidebarSize,
        editorSize: state.expandedEditorSize,
        agentSidebarSize: state.agentSidebarSize,
      };
    }

    this.layoutGridViewForMeasurement();

    return {
      primarySidebarSize: this.gridView.getViewSize([PRIMARY_SIDEBAR_INDEX]),
      agentSidebarSize: this.gridView.getViewSize([AGENT_SIDEBAR_INDEX]),
      editorSize: state.isEditorCollapsed
        ? state.expandedEditorSize
        : this.gridView.getViewSize([EDITOR_INDEX]),
    };
  }

  private layoutGridViewForMeasurement() {
    if (!this.gridView || !this.rootGrid) {
      return;
    }

    if (this.rootGrid.width > 0 && this.rootGrid.height > 0) {
      return;
    }

    const width = this.options.contentHost.clientWidth;
    const height = this.options.contentHost.clientHeight;
    if (width <= 0 || height <= 0) {
      return;
    }

    this.gridView.layout(width, height);
  }

  private buildBranchFromTree(node: LayoutNode): GridBranchView {
    if (node.type !== 'branch') {
      throw new Error('Root workbench content layout node must be a branch.');
    }

    return new GridBranchView(
      node.orientation,
      undefined,
      WORKBENCH_SPLITVIEW_RESERVE_SASH_SPACE,
      node.children.map((child) => ({
        view:
          child.type === 'branch'
            ? this.buildBranchFromTree(child)
            : this.getSlotView(child.id),
        size: child.size,
        visible: this.isNodeVisible(child),
        flex: child.type === 'leaf' ? child.flex === true : false,
      })),
    );
  }

  private getSlotView(id: LayoutLeafId) {
    switch (id) {
      case 'primarySidebar':
        return this.options.primarySidebarSlot;
      case 'editor':
        return this.options.editorSlot;
      case 'agentSidebar':
        return this.options.agentSidebarSlot;
    }
  }

  private isNodeVisible(node: LayoutNode): boolean {
    return node.type === 'leaf'
      ? node.visible
      : node.children.some((child) => this.isNodeVisible(child));
  }

  private syncLayoutTree(
    state: WorkbenchContentLayoutControllerState,
    orientation: Orientation,
    cachedSizes: SplitViewSizeSnapshot,
  ) {
    let nextTree = reconcileLayoutTree(this.layoutTree, {
      orientation,
      isPrimarySidebarVisible: state.isPrimarySidebarVisible,
      isEditorVisible: !state.isEditorCollapsed,
      isAgentSidebarVisible: state.isAgentSidebarVisible,
      primarySidebarSize: state.primarySidebarSize,
      agentSidebarSize: state.agentSidebarSize,
      editorSize: state.isEditorCollapsed ? state.expandedEditorSize : cachedSizes.editorSize,
    });

    nextTree = this.updateTreeBranchSizes(state, nextTree, {
      primarySidebarSize: state.primarySidebarSize,
      editorSize: state.isEditorCollapsed ? 0 : cachedSizes.editorSize,
      agentSidebarSize: state.agentSidebarSize,
    });

    this.layoutTree = nextTree;
  }

  private syncLayoutTreeFromGrid(state: WorkbenchContentLayoutControllerState) {
    if (!this.layoutTree || !this.gridView) {
      return;
    }

    const flexState = this.computeFlexState(state);
    let nextTree = updateLeaf(this.layoutTree, 'primarySidebar', {
      size: this.gridView.getViewSize([PRIMARY_SIDEBAR_INDEX]),
      visible: state.isPrimarySidebarVisible,
    });
    nextTree = updateLeaf(nextTree, 'editor', {
      size: state.isEditorCollapsed
        ? state.expandedEditorSize
        : this.gridView.getViewSize([EDITOR_INDEX]),
      visible: !state.isEditorCollapsed,
      flex: flexState.editorFlex,
    });
    nextTree = updateLeaf(nextTree, 'agentSidebar', {
      size: this.gridView.getViewSize([AGENT_SIDEBAR_INDEX]),
      visible: state.isAgentSidebarVisible,
      flex: flexState.agentSidebarFlex,
    });

    this.layoutTree = this.updateTreeBranchSizes(state, nextTree, {
      primarySidebarSize: this.gridView.getViewSize([PRIMARY_SIDEBAR_INDEX]),
      editorSize: state.isEditorCollapsed ? 0 : this.gridView.getViewSize([EDITOR_INDEX]),
      agentSidebarSize: this.gridView.getViewSize([AGENT_SIDEBAR_INDEX]),
    });
  }

  private updateTreeBranchSizes(
    state: WorkbenchContentLayoutControllerState,
    tree: LayoutNode,
    sizes: SplitViewSizeSnapshot,
  ) {
    if (tree.type !== 'branch') {
      return tree;
    }

    return {
      ...tree,
      size: getRootSplitSize(state, sizes),
    };
  }
}
