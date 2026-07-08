import { EventEmitter } from 'cs/base/common/event';
import type {
  GridSashSnapEvent,
  IGridView,
} from 'cs/base/browser/ui/grid/gridview';
import { GridBranchView, GridView, Orientation } from 'cs/base/browser/ui/grid/gridview';
import {
  DisposableStore,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';
import type { WorkbenchPage } from 'cs/workbench/browser/workbench';
import {
  WORKBENCH_PART_IDS,
  type WorkbenchPartId,
  type WorkbenchPartRefCallback,
} from 'cs/workbench/browser/part';

export type WorkbenchLayoutStateSnapshot = {
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  primarySidebarSize: number;
  agentSidebarSize: number;
  isEditorCollapsed: boolean;
  expandedEditorSize: number;
};

export type WorkbenchLayoutMode = 'agent' | 'flow';

export type WorkbenchLayoutEvent =
  | {
      type: 'APPLY_LAYOUT_MODE';
      mode: WorkbenchLayoutMode;
    }
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

export const WORKBENCH_CONTENT_LAYOUT_BREAKPOINT = 980;
export const WORKBENCH_SPLITVIEW_RESERVE_SASH_SPACE = false;

export { WORKBENCH_PART_IDS };
export type { WorkbenchPartId, WorkbenchPartRefCallback };

const WORKBENCH_SPLITVIEW_LIMITS = {
  sidebar: {
    minimum: 220,
    maximum: Number.POSITIVE_INFINITY,
    defaultSize: 250,
  },
  editor: {
    minimum: 220,
    maximum: Number.POSITIVE_INFINITY,
  },
  agentSidebar: {
    minimum: 332,
    maximum: Number.POSITIVE_INFINITY,
    defaultSize: 360,
  },
} as const;

const MOBILE_SPLITVIEW_LIMITS = {
  sidebar: {
    minimum: 160,
    maximum: Number.POSITIVE_INFINITY,
  },
  editor: {
    minimum: 180,
    maximum: Number.POSITIVE_INFINITY,
  },
  agentSidebar: {
    minimum: 160,
    maximum: Number.POSITIVE_INFINITY,
  },
} as const;

type LayoutAxisLimits = {
  minimum: number;
  maximum: number;
};

type LayoutLimits = {
  primarySidebar: LayoutAxisLimits;
  editor: LayoutAxisLimits;
  agentSidebar: LayoutAxisLimits;
};

const DEFAULT_WORKBENCH_LAYOUT_STATE: WorkbenchLayoutStateSnapshot = {
  isPrimarySidebarVisible: true,
  isAgentSidebarVisible: true,
  primarySidebarSize: WORKBENCH_SPLITVIEW_LIMITS.sidebar.defaultSize,
  agentSidebarSize: WORKBENCH_SPLITVIEW_LIMITS.agentSidebar.defaultSize,
  isEditorCollapsed: true,
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

function getLayoutLimits(
  orientation: Orientation,
): LayoutLimits {
  const desktop = WORKBENCH_SPLITVIEW_LIMITS;
  const isHorizontal = orientation === Orientation.HORIZONTAL;

  return {
    primarySidebar: {
      minimum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.sidebar.minimum
        : desktop.sidebar.minimum,
      maximum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.sidebar.maximum
        : desktop.sidebar.maximum,
    },
    editor: {
      minimum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.editor.minimum
        : desktop.editor.minimum,
      maximum: desktop.editor.maximum,
    },
    agentSidebar: {
      minimum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.agentSidebar.minimum
        : desktop.agentSidebar.minimum,
      maximum: isHorizontal
        ? MOBILE_SPLITVIEW_LIMITS.agentSidebar.maximum
        : desktop.agentSidebar.maximum,
    },
  };
}

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
    case 'APPLY_LAYOUT_MODE': {
      const isAgentMode = event.mode === 'agent';
      const nextState = {
        ...state,
        isPrimarySidebarVisible: true,
        isAgentSidebarVisible: isAgentMode,
        isEditorCollapsed: isAgentMode,
      };

      if (
        state.isPrimarySidebarVisible === nextState.isPrimarySidebarVisible &&
        state.isAgentSidebarVisible === nextState.isAgentSidebarVisible &&
        state.isEditorCollapsed === nextState.isEditorCollapsed
      ) {
        return state;
      }

      return nextState;
    }
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
        isEditorCollapsed: event.visible,
      });
    case 'TOGGLE_AGENT_SIDEBAR_VISIBILITY': {
      const nextVisible = !state.isAgentSidebarVisible;
      return normalizeEditorCollapseState({
        ...state,
        isAgentSidebarVisible: nextVisible,
        isEditorCollapsed: nextVisible,
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

export function applyWorkbenchLayoutMode(mode: WorkbenchLayoutMode) {
  dispatchWorkbenchLayoutEvent({
    type: 'APPLY_LAYOUT_MODE',
    mode,
  });
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
  return `comet-app-shell ${activePage === 'settings' ? 'comet-app-shell-settings' : ''}`.trim();
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

export type SessionWorkbenchLayoutPartViews = {
	getSidebarElement(): HTMLElement | null;
	getSessionsElement(): HTMLElement | null;
	getEditorElement(): HTMLElement | null;
};

export type SessionWorkbenchLayoutViewProps = {
	mode?: 'content' | 'settings';
	isPrimarySidebarVisible: boolean;
	isLayoutEdgeSnappingEnabled: boolean;
	primarySidebarSize: number;
	isEditorCollapsed: boolean;
	expandedEditorSize: number;
	partViews: SessionWorkbenchLayoutPartViews;
};

type SessionLayoutLimits = {
	sidebar: LayoutAxisLimits;
	sessions: LayoutAxisLimits;
	editor: LayoutAxisLimits;
};

const SESSION_SIDEBAR_INDEX = 0;
const SESSION_EDITOR_INDEX = 2;

const SESSION_SPLITVIEW_LIMITS = {
	sidebar: {
		minimum: 220,
		maximum: Number.POSITIVE_INFINITY,
	},
	sessions: {
		minimum: 320,
		maximum: Number.POSITIVE_INFINITY,
	},
	editor: {
		minimum: 320,
		maximum: Number.POSITIVE_INFINITY,
	},
} as const;

const MOBILE_SESSION_SPLITVIEW_LIMITS = {
	sidebar: {
		minimum: 160,
		maximum: Number.POSITIVE_INFINITY,
	},
	sessions: {
		minimum: 220,
		maximum: Number.POSITIVE_INFINITY,
	},
	editor: {
		minimum: 220,
		maximum: Number.POSITIVE_INFINITY,
	},
} as const;

function getSessionLayoutLimits(orientation: Orientation): SessionLayoutLimits {
	return orientation === Orientation.HORIZONTAL
		? MOBILE_SESSION_SPLITVIEW_LIMITS
		: SESSION_SPLITVIEW_LIMITS;
}

class SessionWorkbenchLayoutSlotView implements IGridView {
	readonly element: HTMLElement;
	readonly snap: boolean;
	private minimumWidthValue = 0;
	private maximumWidthValue = Number.POSITIVE_INFINITY;
	private minimumHeightValue = 0;
	private maximumHeightValue = Number.POSITIVE_INFINITY;

	constructor(className: string, snap = false) {
		this.snap = snap;
		this.element = document.createElement('div');
		this.element.className = `comet-session-workbench-slot ${className}`.trim();
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
		// The slotted part roots stretch with CSS.
	}
}

class SessionWorkbenchLayoutController {
	private gridView: GridView | null = null;
	private rootGrid: GridBranchView | null = null;
	private gridOrientation: Orientation | null = null;
	private splitConstraints = getSessionLayoutLimits(Orientation.VERTICAL);
	private disposed = false;
	private readonly gridDisposables = new DisposableStore();
	private readonly resizeObserver = new MutableDisposable<DisposableLike>();
	private readonly layoutAnimationFrame = new MutableDisposable<DisposableLike>();

	constructor(
		private readonly options: {
			container: HTMLElement;
			contentHost: HTMLElement;
			sidebarSlot: SessionWorkbenchLayoutSlotView;
			sessionsSlot: SessionWorkbenchLayoutSlotView;
			editorSlot: SessionWorkbenchLayoutSlotView;
			getState: () => {
				isPrimarySidebarVisible: boolean;
				isLayoutEdgeSnappingEnabled: boolean;
				primarySidebarSize: number;
				isEditorVisible: boolean;
				editorSize: number;
			};
			onPrimarySidebarVisibilityChange: (visible: boolean) => void;
			onPartSizesChange: (sizes: {
				primarySidebarSize: number;
				editorSize: number;
			}) => void;
		},
	) {
		this.installResizeObserver();
	}

	sync() {
		const state = this.options.getState();
		const orientation = this.resolveSplitOrientation();
		this.syncSplitSlotConstraints(orientation);
		this.ensureGridView(state, orientation);
		if (!this.gridView) {
			return;
		}

		this.gridView.edgeSnapping = state.isLayoutEdgeSnappingEnabled;
		this.gridView.setViewVisible([SESSION_SIDEBAR_INDEX], state.isPrimarySidebarVisible);
		this.gridView.setViewVisible([SESSION_EDITOR_INDEX], state.isEditorVisible);
		this.gridView.setViewSize([SESSION_SIDEBAR_INDEX], state.primarySidebarSize);
		if (state.isEditorVisible) {
			this.gridView.setViewSize([SESSION_EDITOR_INDEX], state.editorSize);
		}
		this.scheduleGridViewLayout();
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
		this.resizeObserver.dispose();
		this.layoutAnimationFrame.dispose();
		this.disposeGridView();
	}

	private ensureGridView(
		state: ReturnType<typeof this.options.getState>,
		orientation: Orientation,
	) {
		if (
			this.gridView &&
			this.rootGrid &&
			this.gridOrientation === orientation &&
			this.options.contentHost.firstChild === this.gridView.element
		) {
			return;
		}

		this.disposeGridView();
		const rootGrid = new GridBranchView(
			orientation,
			undefined,
			WORKBENCH_SPLITVIEW_RESERVE_SASH_SPACE,
			[
				{
					view: this.options.sidebarSlot,
					size: state.primarySidebarSize,
					visible: state.isPrimarySidebarVisible,
				},
				{
					view: this.options.sessionsSlot,
					size: this.resolveInitialSessionsSize(),
					visible: true,
					flex: true,
				},
				{
					view: this.options.editorSlot,
					size: state.editorSize,
					visible: state.isEditorVisible,
				},
			],
		);
		const gridView = new GridView(rootGrid);
		gridView.edgeSnapping = state.isLayoutEdgeSnappingEnabled;
		this.gridDisposables.add(gridView.onDidSashSnap(this.handleGridSashSnap));
		this.gridDisposables.add(gridView.onDidSashEnd(this.handleGridSashEnd));
		this.rootGrid = rootGrid;
		this.gridView = gridView;
		this.gridOrientation = orientation;
		this.options.contentHost.replaceChildren(gridView.element);
	}

	private disposeGridView() {
		this.gridDisposables.clear();
		this.gridView?.dispose();
		this.gridView = null;
		this.rootGrid = null;
		this.gridOrientation = null;
	}

	private resolveInitialSessionsSize() {
		const width =
			this.options.contentHost.clientWidth ||
			this.options.container.clientWidth ||
			window.innerWidth;
		return Math.max(SESSION_SPLITVIEW_LIMITS.sessions.minimum, width);
	}

	private readonly handleGridSashSnap = (event: GridSashSnapEvent) => {
		if (event.location.length !== 1) {
			return;
		}

		if (event.itemIndex === SESSION_SIDEBAR_INDEX) {
			this.options.onPrimarySidebarVisibilityChange(event.visible);
		}
	};

	private readonly handleGridSashEnd = (location: readonly number[]) => {
		if (location.length === 0 || !this.gridView) {
			return;
		}

		this.options.onPartSizesChange({
			primarySidebarSize: this.gridView.getViewSize([SESSION_SIDEBAR_INDEX]),
			editorSize: this.gridView.getViewSize([SESSION_EDITOR_INDEX]),
		});
	};

	private installResizeObserver() {
		if (typeof ResizeObserver === 'undefined') {
			this.resizeObserver.value = addDisposableListener(
				window,
				'resize',
				this.handleWindowResize,
			);
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
		this.syncSplitSlotConstraints(orientation);
		this.ensureGridView(state, orientation);
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
				this.ensureGridView(state, nextOrientation);
			}
			this.gridView.layout(
				this.options.contentHost.clientWidth,
				this.options.contentHost.clientHeight,
			);
		});
	}

	private resolveSplitOrientation() {
		const containerWidth =
			this.options.contentHost.clientWidth ||
			this.options.container.clientWidth ||
			window.innerWidth;
		return resolveOrientationFromWidth(containerWidth);
	}

	private syncSplitSlotConstraints(orientation: Orientation) {
		this.splitConstraints = getSessionLayoutLimits(orientation);
		this.options.sidebarSlot.setConstraints(
			orientation,
			this.splitConstraints.sidebar,
		);
		this.options.sessionsSlot.setConstraints(
			orientation,
			this.splitConstraints.sessions,
		);
		this.options.editorSlot.setConstraints(
			orientation,
			this.splitConstraints.editor,
		);
	}
}

export class SessionWorkbenchLayoutView {
	private props: SessionWorkbenchLayoutViewProps;
	private readonly element = document.createElement('section');
	private readonly mainElement = document.createElement('main');
	private readonly sidebarSlot = new SessionWorkbenchLayoutSlotView(
		'comet-session-workbench-slot-sidebar',
		true,
	);
	private readonly sessionsSlot = new SessionWorkbenchLayoutSlotView(
		'comet-session-workbench-slot-sessions',
	);
	private readonly editorSlot = new SessionWorkbenchLayoutSlotView(
		'comet-session-workbench-slot-editor',
	);
	private readonly layoutController: SessionWorkbenchLayoutController;
	private disposed = false;

	constructor(props: SessionWorkbenchLayoutViewProps) {
		this.props = props;
		this.element.className = 'comet-session-workbench-layout';
		this.element.append(this.mainElement);
		this.layoutController = new SessionWorkbenchLayoutController({
			container: this.element,
			contentHost: this.mainElement,
			sidebarSlot: this.sidebarSlot,
			sessionsSlot: this.sessionsSlot,
			editorSlot: this.editorSlot,
			getState: () => ({
				isPrimarySidebarVisible: this.props.isPrimarySidebarVisible,
				isLayoutEdgeSnappingEnabled: this.props.isLayoutEdgeSnappingEnabled,
				primarySidebarSize: this.props.primarySidebarSize,
				isEditorVisible: !this.props.isEditorCollapsed,
				editorSize: this.props.expandedEditorSize,
			}),
			onPrimarySidebarVisibilityChange: setPrimarySidebarVisible,
			onPartSizesChange: sizes => {
				setWorkbenchSidebarSizes({
					primarySidebarSize: sizes.primarySidebarSize,
				});
				if (!this.props.isEditorCollapsed) {
					setEditorCollapsed(false, sizes.editorSize);
				}
			},
		});
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionWorkbenchLayoutViewProps) {
		if (this.disposed) {
			return;
		}

		this.props = props;
		this.render();
	}

	layout() {
		this.layoutController.layout();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.layoutController.dispose();
		this.element.replaceChildren();
	}

	private render() {
		const isEditorVisible = !this.props.isEditorCollapsed;
		this.mainElement.className = [
			'comet-session-workbench-content-grid',
			this.props.mode === 'settings' ? 'comet-is-settings' : '',
			this.props.isPrimarySidebarVisible ? 'comet-is-primary-sidebar-visible' : '',
			isEditorVisible ? 'comet-is-editor-visible' : '',
		]
			.filter(Boolean)
			.join(' ');

		this.sidebarSlot.setContent(this.props.partViews.getSidebarElement());
		this.sessionsSlot.setContent(this.props.partViews.getSessionsElement());
		this.editorSlot.setContent(this.props.partViews.getEditorElement());
		this.layoutController.sync();
	}
}

export function createSessionWorkbenchLayoutView(
	props: SessionWorkbenchLayoutViewProps,
) {
	return new SessionWorkbenchLayoutView(props);
}
