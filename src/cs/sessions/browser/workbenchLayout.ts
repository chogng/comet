import type {
	GridSashSnapEvent,
	IGridView,
} from 'cs/base/browser/ui/grid/gridview';
import {
	GridBranchView,
	GridView,
	Orientation,
} from 'cs/base/browser/ui/grid/gridview';
import {
	DisposableStore,
	MutableDisposable,
	toDisposable,
	type DisposableLike,
} from 'cs/base/common/lifecycle';
import {
	setEditorCollapsed,
	setPrimarySidebarVisible,
	setWorkbenchSidebarSizes,
} from 'cs/workbench/browser/layout';
import type { createSessionWorkbenchContentPartViews } from 'cs/sessions/browser/workbenchContentPartViews';

import 'cs/sessions/browser/media/workbenchLayout.css';

export type SessionWorkbenchLayoutViewProps = {
	mode?: 'content' | 'settings';
	isPrimarySidebarVisible: boolean;
	isLayoutEdgeSnappingEnabled: boolean;
	primarySidebarSize: number;
	isEditorCollapsed: boolean;
	expandedEditorSize: number;
	partViews: ReturnType<typeof createSessionWorkbenchContentPartViews>;
};

type LayoutAxisLimits = {
	minimum: number;
	maximum: number;
};

const SIDEBAR_INDEX = 0;
const EDITOR_INDEX = 2;

const SESSION_WORKBENCH_CONTENT_LAYOUT_BREAKPOINT = 980;
const SESSION_WORKBENCH_RESERVE_SASH_SPACE = false;

const DESKTOP_LIMITS = {
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

const MOBILE_LIMITS = {
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

function resolveOrientationFromWidth(width: number) {
	return width <= SESSION_WORKBENCH_CONTENT_LAYOUT_BREAKPOINT
		? Orientation.HORIZONTAL
		: Orientation.VERTICAL;
}

function getLayoutLimits(orientation: Orientation) {
	return orientation === Orientation.HORIZONTAL ? MOBILE_LIMITS : DESKTOP_LIMITS;
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

export class SessionWorkbenchLayoutSlotView implements IGridView {
	readonly element: HTMLElement;
	readonly snap: boolean;
	private minimumWidthValue = 0;
	private maximumWidthValue = Number.POSITIVE_INFINITY;
	private minimumHeightValue = 0;
	private maximumHeightValue = Number.POSITIVE_INFINITY;

	constructor(className: string, snap = false) {
		this.snap = snap;
		this.element = document.createElement('div');
		this.element.className = `session-workbench-slot ${className}`.trim();
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

	layout() {}
}

class SessionWorkbenchLayoutController {
	private gridView: GridView | null = null;
	private rootGrid: GridBranchView | null = null;
	private gridOrientation: Orientation | null = null;
	private splitConstraints = getLayoutLimits(Orientation.VERTICAL);
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
		this.gridView.setViewVisible([SIDEBAR_INDEX], state.isPrimarySidebarVisible);
		this.gridView.setViewVisible([EDITOR_INDEX], state.isEditorVisible);
		this.gridView.setViewSize([SIDEBAR_INDEX], state.primarySidebarSize);
		if (state.isEditorVisible) {
			this.gridView.setViewSize([EDITOR_INDEX], state.editorSize);
		}
		this.scheduleGridViewLayout();
	}

	layout() {
		if (this.disposed) {
			return;
		}

		this.handleContainerResize();
	}

	getEditorViewSize() {
		return this.gridView?.getViewSize([EDITOR_INDEX]) ?? null;
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
			SESSION_WORKBENCH_RESERVE_SASH_SPACE,
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
		return Math.max(DESKTOP_LIMITS.sessions.minimum, width);
	}

	private readonly handleGridSashSnap = (event: GridSashSnapEvent) => {
		if (event.location.length !== 1) {
			return;
		}

		if (event.itemIndex === SIDEBAR_INDEX) {
			this.options.onPrimarySidebarVisibilityChange(event.visible);
		}
	};

	private readonly handleGridSashEnd = (location: readonly number[]) => {
		if (location.length === 0 || !this.gridView) {
			return;
		}

		this.options.onPartSizesChange({
			primarySidebarSize: this.gridView.getViewSize([SIDEBAR_INDEX]),
			editorSize: this.gridView.getViewSize([EDITOR_INDEX]),
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
			this.gridView?.layout(
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
		this.splitConstraints = getLayoutLimits(orientation);
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

export class SessionWorkbenchLayoutView {
	private props: SessionWorkbenchLayoutViewProps;
	private readonly element = createElement(
		'section',
		'session-workbench-layout',
	);
	private readonly mainElement = createElement('main');
	private readonly sidebarSlot = new SessionWorkbenchLayoutSlotView(
		'session-workbench-slot-sidebar',
		true,
	);
	private readonly sessionsSlot = new SessionWorkbenchLayoutSlotView(
		'session-workbench-slot-sessions',
	);
	private readonly editorSlot = new SessionWorkbenchLayoutSlotView(
		'session-workbench-slot-editor',
	);
	private readonly layoutController: SessionWorkbenchLayoutController;
	private disposed = false;

	constructor(props: SessionWorkbenchLayoutViewProps) {
		this.props = props;
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
			'session-workbench-content-grid',
			this.props.mode === 'settings' ? 'is-settings' : '',
			this.props.isPrimarySidebarVisible ? 'is-primary-sidebar-visible' : '',
			isEditorVisible ? 'is-editor-visible' : '',
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
