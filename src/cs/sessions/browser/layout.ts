/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import type { GridSashSnapEvent, IGridView } from 'cs/base/browser/ui/grid/gridview';
import { GridBranchView, GridView, Orientation } from 'cs/base/browser/ui/grid/gridview';
import {
	Disposable,
	DisposableStore,
	MutableDisposable,
	toDisposable,
	type IDisposable,
} from 'cs/base/common/lifecycle';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';
import {
	getWorkbenchPartDomNode,
	registerWorkbenchPartDomNode,
} from 'cs/workbench/browser/layout';

export interface ISessionsLayoutPartViews {
	getSidebarElement(): HTMLElement | null;
	getSessionsElement(): HTMLElement | null;
	getEditorElement(): HTMLElement | null;
	layoutSessions(width: number, height: number): void;
	layoutEditor(width: number, height: number): void;
}

export interface ISessionsLayoutViewProps {
	readonly isEdgeSnappingEnabled: boolean;
	readonly partViews: ISessionsLayoutPartViews;
}

interface ILayoutAxisLimits {
	readonly minimum: number;
	readonly maximum: number;
}

const SidebarIndex = 0;
const EditorIndex = 2;
const CollapsedSidebarSize = 188;
const ReserveSashSpace = false;

const SplitViewLimits = {
	sidebar: {
		minimum: 220,
		maximum: Number.POSITIVE_INFINITY,
	},
	sessions: {
		minimum: 320,
		maximum: Number.POSITIVE_INFINITY,
	},
	editor: {
		minimum: 420,
		maximum: Number.POSITIVE_INFINITY,
	},
} as const;

function syncElementContent(host: HTMLElement, content: HTMLElement | null): void {
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

function getSidebarLimits(isSidebarVisible: boolean): ILayoutAxisLimits {
	if (isSidebarVisible) {
		return SplitViewLimits.sidebar;
	}

	return {
		minimum: CollapsedSidebarSize,
		maximum: CollapsedSidebarSize,
	};
}

class SessionsLayoutPartView implements IGridView {
	readonly element: HTMLElement;
	readonly snap: boolean;

	private minimumWidthValue = 0;
	private maximumWidthValue = Number.POSITIVE_INFINITY;
	private minimumHeightValue = 0;
	private maximumHeightValue = Number.POSITIVE_INFINITY;

	constructor(
		className: string,
		snap = false,
		private readonly onLayout?: (width: number, height: number) => void,
	) {
		this.snap = snap;
		this.element = $('div', { class: `comet-sessions-layout-part ${className}`.trim() });
	}

	get minimumWidth(): number {
		return this.minimumWidthValue;
	}

	get maximumWidth(): number {
		return this.maximumWidthValue;
	}

	get minimumHeight(): number {
		return this.minimumHeightValue;
	}

	get maximumHeight(): number {
		return this.maximumHeightValue;
	}

	setConstraints(constraints: ILayoutAxisLimits): void {
		this.minimumWidthValue = constraints.minimum;
		this.maximumWidthValue = constraints.maximum;
		this.minimumHeightValue = 0;
		this.maximumHeightValue = Number.POSITIVE_INFINITY;
	}

	setContent(content: HTMLElement | null): void {
		syncElementContent(this.element, content);
	}

	layout(width: number, height: number): void {
		this.onLayout?.(width, height);
	}
}

class SessionsLayoutController extends Disposable {
	private gridView: GridView | undefined;
	private rootGrid: GridBranchView | undefined;
	private readonly gridDisposables = this._register(new DisposableStore());
	private readonly resizeObserver = this._register(new MutableDisposable<IDisposable>());
	private readonly layoutAnimationFrame = this._register(new MutableDisposable<IDisposable>());

	constructor(
		private readonly container: HTMLElement,
		private readonly contentHost: HTMLElement,
		private readonly sidebarPartView: SessionsLayoutPartView,
		private readonly sessionsPartView: SessionsLayoutPartView,
		private readonly editorPartView: SessionsLayoutPartView,
		private readonly getEdgeSnappingEnabled: () => boolean,
		private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		this.installResizeObserver();
	}

	sync(): void {
		const state = this.layoutService.getLayoutState();
		this.syncSplitPartConstraints(state.isSidebarVisible);
		this.ensureGridView();
		if (!this.gridView) {
			return;
		}

		this.gridView.edgeSnapping = this.getEdgeSnappingEnabled();
		this.gridView.setViewVisible([SidebarIndex], true);
		this.gridView.setViewVisible([EditorIndex], !state.isEditorCollapsed);
		this.gridView.setViewSize(
			[SidebarIndex],
			state.isSidebarVisible ? state.sidebarSize : CollapsedSidebarSize,
		);
		if (!state.isEditorCollapsed) {
			this.gridView.setViewSize([EditorIndex], state.expandedEditorSize);
		}
		this.scheduleGridViewLayout();
	}

	layout(): void {
		this.handleContainerResize();
	}

	override dispose(): void {
		this.disposeGridView();
		super.dispose();
	}

	private ensureGridView(): void {
		if (this.gridView
			&& this.rootGrid
			&& this.contentHost.firstChild === this.gridView.element) {
			return;
		}

		this.disposeGridView();
		const state = this.layoutService.getLayoutState();
		const rootGrid = new GridBranchView(
			Orientation.VERTICAL,
			undefined,
			ReserveSashSpace,
			[
				{
					view: this.sidebarPartView,
					size: state.isSidebarVisible ? state.sidebarSize : CollapsedSidebarSize,
					visible: true,
				},
				{
					view: this.sessionsPartView,
					size: this.resolveInitialSessionsSize(),
					visible: true,
					flex: true,
				},
				{
					view: this.editorPartView,
					size: state.expandedEditorSize,
					visible: !state.isEditorCollapsed,
				},
			],
		);
		const gridView = new GridView(rootGrid);
		gridView.edgeSnapping = this.getEdgeSnappingEnabled();
		this.gridDisposables.add(gridView.onDidSashSnap(this.handleGridSashSnap));
		this.gridDisposables.add(gridView.onDidSashEnd(this.handleGridSashEnd));
		this.rootGrid = rootGrid;
		this.gridView = gridView;
		this.contentHost.replaceChildren(gridView.element);
	}

	private disposeGridView(): void {
		this.gridDisposables.clear();
		this.gridView?.dispose();
		this.gridView = undefined;
		this.rootGrid = undefined;
	}

	private resolveInitialSessionsSize(): number {
		return Math.max(SplitViewLimits.sessions.minimum, this.contentHost.clientWidth);
	}

	private readonly handleGridSashSnap = (event: GridSashSnapEvent): void => {
		if (event.location.length === 1 && event.itemIndex === SidebarIndex) {
			this.layoutService.setSidebarVisible(event.visible);
		}
	};

	private readonly handleGridSashEnd = (location: readonly number[]): void => {
		if (location.length === 0 || !this.gridView) {
			return;
		}

		const state = this.layoutService.getLayoutState();
		this.layoutService.setPartSizes({
			sidebarSize: state.isSidebarVisible
				? this.gridView.getViewSize([SidebarIndex])
				: undefined,
			editorSize: state.isEditorCollapsed
				? undefined
				: this.gridView.getViewSize([EditorIndex]),
		});
	};

	private installResizeObserver(): void {
		const resizeObserver = new ResizeObserver(this.handleContainerResize);
		resizeObserver.observe(this.container);
		this.resizeObserver.value = toDisposable(() => resizeObserver.disconnect());
	}

	private readonly handleContainerResize = (): void => {
		this.layoutService.setViewport(this.container.clientWidth, this.container.clientHeight);
		const state = this.layoutService.getLayoutState();
		this.syncSplitPartConstraints(state.isSidebarVisible);
		this.ensureGridView();
		this.scheduleGridViewLayout();
	};

	private scheduleGridViewLayout(): void {
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

			const state = this.layoutService.getLayoutState();
			this.syncSplitPartConstraints(state.isSidebarVisible);
			this.gridView.layout(this.contentHost.clientWidth, this.contentHost.clientHeight);
		});
	}

	private syncSplitPartConstraints(isSidebarVisible: boolean): void {
		this.sidebarPartView.setConstraints(getSidebarLimits(isSidebarVisible));
		this.sessionsPartView.setConstraints(SplitViewLimits.sessions);
		this.editorPartView.setConstraints(SplitViewLimits.editor);
	}
}

export class SessionsLayoutView extends Disposable {
	private props: ISessionsLayoutViewProps;
	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-sessions-layout');
	private readonly mainElement = $<HTMLElementTagNameMap['main']>('main.comet-sessions-content-grid');
	private readonly sidebarPartView = new SessionsLayoutPartView(
		'comet-sessions-layout-part-sidebar',
		true,
	);
	private readonly sessionsPartView = new SessionsLayoutPartView(
		'comet-sessions-layout-part-sessions',
		false,
		(width, height) => this.props.partViews.layoutSessions(width, height),
	);
	private readonly editorPartView = new SessionsLayoutPartView(
		'comet-sessions-layout-part-editor',
		false,
		(width, height) => this.props.partViews.layoutEditor(width, height),
	);
	private readonly layoutController: SessionsLayoutController;

	constructor(
		props: ISessionsLayoutViewProps,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		this.props = props;
		this.element.append(this.mainElement);
		this.layoutController = this._register(new SessionsLayoutController(
			this.element,
			this.mainElement,
			this.sidebarPartView,
			this.sessionsPartView,
			this.editorPartView,
			() => this.props.isEdgeSnappingEnabled,
			this.layoutService,
		));
		this._register(this.layoutService.onDidChangeLayoutState(this.render, this));
		this.render();
	}

	getElement(): HTMLElement {
		return this.element;
	}

	setProps(props: ISessionsLayoutViewProps): void {
		this.props = props;
		this.render();
	}

	layout(): void {
		this.layoutController.layout();
	}

	override dispose(): void {
		const sessionsElement = this.props.partViews.getSessionsElement();
		if (sessionsElement && getWorkbenchPartDomNode(SESSION_PART_IDS.sessions) === sessionsElement) {
			registerWorkbenchPartDomNode(SESSION_PART_IDS.sessions, null);
		}
		this.element.replaceChildren();
		super.dispose();
	}

	private render(): void {
		const state = this.layoutService.getLayoutState();
		const isEditorVisible = !state.isEditorCollapsed;
		this.mainElement.className = [
			'comet-sessions-content-grid',
			state.isSidebarVisible ? 'comet-is-sidebar-visible' : '',
			isEditorVisible ? 'comet-is-editor-visible' : '',
		].filter(Boolean).join(' ');

		this.sidebarPartView.setContent(this.props.partViews.getSidebarElement());
		const sessionsElement = this.props.partViews.getSessionsElement();
		this.sessionsPartView.setContent(sessionsElement);
		registerWorkbenchPartDomNode(SESSION_PART_IDS.sessions, sessionsElement);
		this.editorPartView.setContent(this.props.partViews.getEditorElement());
		this.layoutController.sync();
	}
}
