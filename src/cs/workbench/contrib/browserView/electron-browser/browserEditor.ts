/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/workbench/contrib/browserView/electron-browser/media/browser.css';

import { $, getWindow } from 'cs/base/browser/dom';
import { getZoomFactor, onDidChangeZoomLevel } from 'cs/base/browser/browser';
import { Emitter, Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import {
	ContextKeyExpr,
	ContextKeyServiceImpl,
	IContextKeyService,
	RawContextKey,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorPaneLayout } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorWorkspaceBrowserTab } from 'cs/workbench/browser/parts/editor/editorModel';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import { IBrowserViewWorkbenchService, type IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import type { ThemeIcon } from 'cs/base/common/themables';
import type { URI } from 'cs/base/common/uri';
import type { IQuickInputButton } from 'cs/platform/quickinput/common/quickInput';
import type { INativeHostService } from 'cs/platform/native/common/native';
import {
	captureBrowserEditorViewState,
	restoreBrowserEditorViewState,
	type BrowserEditorViewState,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditorViewState';

type BrowserEditorContributionCtor = new (editor: BrowserEditor, ...services: never[]) => BrowserEditorContribution;

export const BROWSER_EDITOR_ACTIVE = ContextKeyExpr.equals('activeEditor', BrowserEditorInput.EDITOR_ID);
export const CONTEXT_BROWSER_FOCUSED = new RawContextKey<boolean>('browserFocused', false);
export const CONTEXT_BROWSER_HAS_URL = new RawContextKey<boolean>('browserHasUrl', false);
export const CONTEXT_BROWSER_HAS_ERROR = new RawContextKey<boolean>('browserHasError', false);

export enum BrowserWidgetLocation {
	PreUrl = 'preUrl',
	PostUrl = 'postUrl',
	Toolbar = 'toolbar',
	ContentArea = 'contentArea',
}

export const BrowserActionCategory = 'Browser';

export enum BrowserActionGroup {
	Tabs = '1_tabs',
	Zoom = '2_zoom',
	Tools = '3_tools',
	Data = '4_data',
	Settings = '5_settings',
}

export interface IContainerLayout {
	readonly width: number;
	readonly height: number;
	readonly top?: number;
	readonly left?: number;
	readonly emulation?: {
		readonly scale: number;
	};
}

export interface IContainerLayoutOverride {
	readonly padding?: {
		top?: number;
		right?: number;
		bottom?: number;
		left?: number;
	};
	readonly compute?: (current: IContainerLayout, pane: IContainerLayoutPane) => IContainerLayout | undefined;
	readonly priority?: number;
}

export interface IContainerLayoutPane {
	readonly width: number;
	readonly height: number;
	readonly originX: number;
	readonly originY: number;
}

export interface IBrowserEditorWidget {
	readonly location: BrowserWidgetLocation;
	readonly element: HTMLElement;
	readonly order: number;
}

export interface IBrowserUrlRenderer {
	render(url: string, container: HTMLElement): boolean;
}

export interface IBrowserUrlSuggestion {
	readonly id: string;
	readonly label: string;
	readonly description?: string;
	readonly icon?: ThemeIcon;
	readonly iconPath?: URI;
	readonly actions?: readonly IBrowserUrlPickerAction[];
	apply(input: BrowserEditorInput): void | Promise<void>;
}

export interface IBrowserUrlSuggestionProvider {
	readonly onDidChange?: Event<void>;
	readonly order?: number;
	readonly label?: string;
	readonly description?: string;
	readonly actions?: readonly IBrowserUrlPickerAction[];
	getSuggestions(input: BrowserEditorInput, value: string): readonly IBrowserUrlSuggestion[] | Promise<readonly IBrowserUrlSuggestion[]>;
}

export interface IBrowserUrlPickerAction extends IQuickInputButton {
	readonly id: string;
	readonly label: string;
	readonly iconClass?: string;
	run(input: BrowserEditorInput): void | Promise<void>;
}

export interface IBrowserUrlPickerActionProvider {
	readonly onDidChange?: Event<void>;
	readonly order?: number;
	getActions(input: BrowserEditorInput): readonly IBrowserUrlPickerAction[];
}

export type BrowserEditorProps = {
	labels: EditorPartLabels;
	browserTab: EditorWorkspaceBrowserTab;
	nativeHost: INativeHostService;
};

export abstract class BrowserEditorContribution extends Disposable {
	private readonly modelStore = this._register(new DisposableStore());

	constructor(protected readonly editor: BrowserEditor) {
		super();
		this._register(editor.onDidChangeModel(({ model, isNew }) => {
			this.modelStore.clear();
			if (model) {
				this.onModelAttached(model, this.modelStore, isNew);
			} else {
				this.onModelDetached();
			}
		}));
	}

	get widgets(): readonly IBrowserEditorWidget[] {
		return [];
	}

	get urlSuggestionProviders(): readonly IBrowserUrlSuggestionProvider[] {
		return [];
	}

	get urlRenderers(): readonly IBrowserUrlRenderer[] {
		return [];
	}

	get urlPickerActionProviders(): readonly IBrowserUrlPickerActionProvider[] {
		return [];
	}

	prerenderInput(_input: BrowserEditorInput): void { }
	protected onModelAttached(_model: IBrowserViewModel, _store: DisposableStore, _isNew: boolean): void { }
	onModelDetached(): void { }
	onPaneResized(_width: number): void { }
	afterContainerLayout(): void { }
	onPaneVisibilityChanged(_visible: boolean): void { }
	tryFocus(): boolean { return false; }
	onContainerCreated(_container: HTMLElement): void { }
	beforeContainerLayout(): IContainerLayoutOverride | undefined { return undefined; }
}

export class BrowserEditor extends EditorPane<
	BrowserEditorProps,
	BrowserEditorViewState
> {
	private static readonly contributions: BrowserEditorContributionCtor[] = [];
	private readonly contributionInstances = new Map<BrowserEditorContributionCtor, BrowserEditorContribution>();
	private readonly disposables = new DisposableStore();
	private readonly inputDisposables = this.disposables.add(new DisposableStore());
	private readonly _onDidFocus = this.disposables.add(new Emitter<void>());
	private readonly _onDidChangeModel = this.disposables.add(new Emitter<{
		model: IBrowserViewModel | undefined;
		isNew: boolean;
	}>());
	private readonly browserContextKeyService = new ContextKeyServiceImpl();
	private readonly browserFocusedContext: ContextKey<boolean>;
	private readonly hasUrlContext: ContextKey<boolean>;
	private readonly hasErrorContext: ContextKey<boolean>;
	private props: BrowserEditorProps;
	private inputModelSequence = 0;
	private _input: BrowserEditorInput | undefined;
	private _model: IBrowserViewModel | undefined;
	private readonly rootElement = $('div.browser-root');
	private readonly browserContainerWrapper = $('div.browser-container-wrapper');
	private readonly browserContainerElement = $('div.browser-container');
	private readonly placeholderContents = $('div.browser-placeholder-contents');
	private currentPadding: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 };
	private viewState: BrowserEditorViewState | undefined;
	private restoreSequence = 0;
	private pendingRestoreTimer: number | null = null;

	readonly onDidFocus: Event<void> = this._onDidFocus.event;
	readonly onDidChangeModel = this._onDidChangeModel.event;

	get input(): BrowserEditorInput | undefined {
		return this._input;
	}

	set input(input: BrowserEditorInput | undefined) {
		this._input = input;
	}

	get model(): IBrowserViewModel | undefined {
		return this._model;
	}

	set model(model: IBrowserViewModel | undefined) {
		if (this._model === model) {
			return;
		}
		this._model = model;
		this._onDidChangeModel.fire({ model, isNew: false });
	}

	get browserContainer(): HTMLElement {
		return this.browserContainerElement;
	}

	get window(): Window & { vscodeWindowId: number } {
		return getWindow(this.rootElement) as Window & { vscodeWindowId: number };
	}

	constructor(
		props: BrowserEditorProps,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBrowserViewWorkbenchService private readonly browserViewWorkbenchService: IBrowserViewWorkbenchService,
	) {
		super();
		this.props = props;
		this.browserFocusedContext = CONTEXT_BROWSER_FOCUSED.bindTo(this.browserContextKeyService);
		this.hasUrlContext = CONTEXT_BROWSER_HAS_URL.bindTo(this.browserContextKeyService);
		this.hasErrorContext = CONTEXT_BROWSER_HAS_ERROR.bindTo(this.browserContextKeyService);
		this.createEditor();
		this.setProps(props);
	}

	static registerContribution(ctor: BrowserEditorContributionCtor): void {
		const contributionCtor = ctor;
		if (!BrowserEditor.contributions.includes(contributionCtor)) {
			BrowserEditor.contributions.push(contributionCtor);
		}
	}

	getContributions(): Iterable<BrowserEditorContribution> {
		return this.contributionInstances.values();
	}

	getContribution<T extends BrowserEditorContribution>(
		ctor: new (editor: BrowserEditor, ...services: never[]) => T,
	): T | undefined {
		const contributionCtor = ctor;
		return this.contributionInstances.get(contributionCtor) as T | undefined;
	}

	ensureBrowserFocus(): void {
		this.browserContainerElement.focus();
		this.window.document.getSelection()?.removeAllRanges();
		this._onDidFocus.fire();
	}

	override getElement() {
		return this.rootElement;
	}

	override setProps(props: BrowserEditorProps) {
		const previousTabId = this.props.browserTab.id;
		this.props = props;
		if (previousTabId !== props.browserTab.id) {
			this.cancelRestoreSequence();
		}
		this.setInput(this.browserViewWorkbenchService.getOrCreateLazy(
			props.browserTab.id,
			{
				url: props.browserTab.url,
				title: props.browserTab.title,
			},
		));
	}

	override focus() {
		for (const contribution of this.contributionInstances.values()) {
			if (contribution.tryFocus()) {
				return;
			}
		}
		this.ensureBrowserFocus();
	}

	override layout(_dimension?: EditorPaneLayout) {
		if (_dimension) {
			for (const contribution of this.contributionInstances.values()) {
				contribution.onPaneResized(_dimension.width);
			}
		}
		void this.layoutBrowserContainer();
	}

	override getViewState() {
		return this.viewState;
	}

	override async captureViewState() {
		const capturedViewState = await captureBrowserEditorViewState(
			this.props.browserTab.id,
			this.props.nativeHost,
		);
		if (capturedViewState) {
			this.viewState = capturedViewState;
		}

		return this.viewState;
	}

	override restoreViewState(viewState: BrowserEditorViewState | undefined) {
		this.viewState = viewState;
		this.scheduleRestore(viewState);
	}

	override clearInput() {
		this.inputModelSequence += 1;
		this.inputDisposables.clear();
		this._input = undefined;
		this.setModel(undefined, false);
		this.hasUrlContext.reset();
		this.hasErrorContext.reset();
	}

	override dispose() {
		this.cancelRestoreSequence();
		for (const contribution of this.contributionInstances.values()) {
			contribution.onPaneVisibilityChanged(false);
		}
		this.clearInput();
		this.rootElement.replaceChildren();
		this.disposables.dispose();
	}

	async layoutBrowserContainer(retries = 2): Promise<boolean> {
		const model = this._model;
		if (!model) {
			return false;
		}

		const overrides: IContainerLayoutOverride[] = [];
		for (const contribution of this.contributionInstances.values()) {
			const override = contribution.beforeContainerLayout();
			if (override) {
				overrides.push(override);
			}
		}

		const padding = { top: 0, right: 0, bottom: 0, left: 0 };
		for (const override of overrides) {
			padding.top = Math.max(padding.top, override.padding?.top ?? 0);
			padding.right = Math.max(padding.right, override.padding?.right ?? 0);
			padding.bottom = Math.max(padding.bottom, override.padding?.bottom ?? 0);
			padding.left = Math.max(padding.left, override.padding?.left ?? 0);
		}
		this.currentPadding = padding;

		const wrapperRect = this.browserContainerWrapper.getBoundingClientRect();
		if ((wrapperRect.width === 0 || wrapperRect.height === 0) && retries > 0) {
			await new Promise<void>(resolve => {
				this.window.requestAnimationFrame(() => resolve());
			});
			return this.layoutBrowserContainer(retries - 1);
		}
		if (wrapperRect.width === 0 || wrapperRect.height === 0) {
			return false;
		}

		const paneWidth = Math.max(0, wrapperRect.width - padding.left - padding.right);
		const paneHeight = Math.max(0, wrapperRect.height - padding.top - padding.bottom);
		const pane: IContainerLayoutPane = {
			width: paneWidth,
			height: paneHeight,
			originX: wrapperRect.left + padding.left,
			originY: wrapperRect.top + padding.top,
		};
		const sorted = overrides.slice().sort((left, right) => (left.priority ?? 0) - (right.priority ?? 0));
		let containerLayout: IContainerLayout = { width: paneWidth, height: paneHeight, top: 0, left: 0 };
		for (const override of sorted) {
			const nextLayout = override.compute?.(containerLayout, pane);
			if (nextLayout) {
				containerLayout = nextLayout;
			}
		}

		const left = padding.left + (containerLayout.left ?? 0);
		const top = padding.top + (containerLayout.top ?? 0);

		this.browserContainerElement.style.width = `${containerLayout.width}px`;
		this.browserContainerElement.style.height = `${containerLayout.height}px`;
		this.browserContainerElement.style.left = `${left}px`;
		this.browserContainerElement.style.top = `${top}px`;

		await model.layout({
			windowId: this.window.vscodeWindowId,
			x: wrapperRect.left + left,
			y: wrapperRect.top + top,
			width: containerLayout.width,
			height: containerLayout.height,
			zoomFactor: getZoomFactor(this.window),
			cornerRadius: parseFloat(this.window.getComputedStyle(this.browserContainerElement).borderTopLeftRadius ?? '0'),
			emulation: containerLayout.emulation,
		});
		if (this._model !== model) {
			return false;
		}

		for (const contribution of this.contributionInstances.values()) {
			contribution.afterContainerLayout();
		}
		return true;
	}

	get paneSize(): { width: number; height: number } {
		const rect = this.browserContainerWrapper.getBoundingClientRect();
		const padding = this.currentPadding;
		return {
			width: Math.max(0, rect.width - padding.left - padding.right),
			height: Math.max(0, rect.height - padding.top - padding.bottom),
		};
	}

	private createEditor() {
		this.rootElement.tabIndex = -1;
		this.browserFocusedContext.set(true);

		const scopedInstantiationService = this.disposables.add(this.instantiationService.createChild(new ServiceCollection(
			[IContextKeyService, this.browserContextKeyService],
		)));
		for (const ctor of BrowserEditor.contributions) {
			const instance = this.disposables.add(scopedInstantiationService.createInstance(ctor, this));
			this.contributionInstances.set(ctor, instance);
		}

		const widgetsByLocation = new Map<BrowserWidgetLocation, IBrowserEditorWidget[]>();
		for (const contribution of this.contributionInstances.values()) {
			for (const widget of contribution.widgets) {
				let widgets = widgetsByLocation.get(widget.location);
				if (!widgets) {
					widgets = [];
					widgetsByLocation.set(widget.location, widgets);
				}
				widgets.push(widget);
			}
		}
		for (const widgets of widgetsByLocation.values()) {
			widgets.sort((left, right) => left.order - right.order);
		}
		const widgetsAt = (location: BrowserWidgetLocation) =>
			widgetsByLocation.get(location) ?? [];

		for (const widget of widgetsAt(BrowserWidgetLocation.Toolbar)) {
			this.rootElement.append(widget.element);
		}

		this.browserContainerWrapper.style.setProperty('--zoom-factor', String(getZoomFactor(this.window)));
		this.rootElement.append(this.browserContainerWrapper);

		this.browserContainerElement.tabIndex = 0;
		this.browserContainerWrapper.append(this.browserContainerElement);
		for (const contribution of this.contributionInstances.values()) {
			contribution.onContainerCreated(this.browserContainerElement);
		}

		this.browserContainerElement.append(this.placeholderContents);
		for (const widget of widgetsAt(BrowserWidgetLocation.ContentArea)) {
			this.placeholderContents.append(widget.element);
		}

		for (const contribution of this.contributionInstances.values()) {
			contribution.onPaneVisibilityChanged(true);
		}
	}

	private setInput(input: BrowserEditorInput) {
		if (this._input === input) {
			this.layout();
			return;
		}

		const sequence = ++this.inputModelSequence;
		this.inputDisposables.clear();
		this._input = input;

		let model = input.model;
		const isNew = !model;
		if (!model) {
			this.hasUrlContext.set(!!input.url);
			this.hasErrorContext.set(false);
			for (const contribution of this.contributionInstances.values()) {
				contribution.prerenderInput(input);
			}
			void input.resolve().then((resolvedModel) => {
				if (this.inputModelSequence !== sequence || this._input !== input) {
					return;
				}
				this.attachModel(resolvedModel, isNew);
			});
			return;
		}

		this.attachModel(model, isNew);
	}

	private attachModel(model: IBrowserViewModel, isNew: boolean) {
		if (this._model === model) {
			this.layout();
			return;
		}

		this.setModel(model, isNew);
		this.inputDisposables.add(model.onWillDispose(() => {
			if (this._model === model) {
				this.setModel(undefined, false);
			}
		}));
		this.inputDisposables.add(model.onWillNavigate(() => this.ensureBrowserFocus()));
		this.inputDisposables.add(model.onDidNavigate(() => {
			this.hasUrlContext.set(!!model.url);
			this.ensureBrowserFocus();
		}));
		this.inputDisposables.add(model.onDidChangeLoadingState(() => {
			this.hasErrorContext.set(!!model.error);
		}));
		this.inputDisposables.add(model.onDidChangeFocus(({ focused }) => {
			if (focused) {
				this._onDidFocus.fire();
				this.ensureBrowserFocus();
			}
		}));
		this.inputDisposables.add(onDidChangeZoomLevel(targetWindowId => {
			if (targetWindowId === this.window.vscodeWindowId) {
				this.browserContainerWrapper.style.setProperty('--zoom-factor', String(getZoomFactor(this.window)));
				void this.layoutBrowserContainer();
			}
		}));

		this.layout();
	}

	private setModel(model: IBrowserViewModel | undefined, isNew: boolean) {
		if (this._model === model) {
			return;
		}
		this._model = model;
		this.hasUrlContext.set(!!model?.url);
		this.hasErrorContext.set(!!model?.error);
		this._onDidChangeModel.fire({ model, isNew });
	}

	private scheduleRestore(viewState: BrowserEditorViewState | undefined) {
		this.cancelRestoreSequence();
		if (!viewState || typeof window === 'undefined') {
			return;
		}

		const restoreSequence = ++this.restoreSequence;
		this.scheduleRestoreAttempt(restoreSequence, this.props.browserTab.id, viewState, 0);
	}

	private scheduleRestoreAttempt(
		restoreSequence: number,
		targetId: string,
		viewState: BrowserEditorViewState,
		attemptIndex: number,
	) {
		if (typeof window === 'undefined' || this.restoreSequence !== restoreSequence) {
			return;
		}

		const retryDelaysMs = [0, 200, 800] as const;
		const delayMs = retryDelaysMs[attemptIndex] ?? 0;
		const runAttempt = () => {
			this.pendingRestoreTimer = null;
			if (this.restoreSequence !== restoreSequence) {
				return;
			}

			void restoreBrowserEditorViewState(
				targetId,
				viewState,
				this.props.nativeHost,
			).then((restored) => {
				if (restored || this.restoreSequence !== restoreSequence) {
					return;
				}
				if (attemptIndex >= retryDelaysMs.length - 1) {
					return;
				}
				this.scheduleRestoreAttempt(
					restoreSequence,
					targetId,
					viewState,
					attemptIndex + 1,
				);
			});
		};

		if (delayMs <= 0) {
			runAttempt();
			return;
		}

		this.pendingRestoreTimer = window.setTimeout(runAttempt, delayMs);
	}

	private cancelRestoreSequence() {
		this.restoreSequence += 1;
		if (this.pendingRestoreTimer !== null && typeof window !== 'undefined') {
			window.clearTimeout(this.pendingRestoreTimer);
		}

		this.pendingRestoreTimer = null;
	}
}
