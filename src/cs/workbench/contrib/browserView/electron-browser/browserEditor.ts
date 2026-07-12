/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/workbench/contrib/browserView/electron-browser/media/browser.css';

import { $, getWindow } from 'cs/base/browser/dom';
import { getZoomFactor, onDidChangeZoomLevel } from 'cs/base/browser/browser';
import { disposableTimeout, raceCancellationError } from 'cs/base/common/async';
import { Emitter, Event } from 'cs/base/common/event';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { Disposable, DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import {
	ContextKeyExpr,
	IContextKeyService,
	RawContextKey,
	type ContextKey,
} from 'cs/platform/contextkey/common/contextkey';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { EditorPaneLayout } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { BrowserEditorPaneLabels } from 'cs/workbench/contrib/browserView/browser/browserEditorPaneState';
import type {
	BrowserEditorModeToolbarPane,
	BrowserEditorModeToolbarState,
} from 'cs/workbench/contrib/browserView/browser/browserModeToolbarHost';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createBrowserEditorPaneState } from 'cs/workbench/contrib/browserView/browser/browserEditorPaneState';
import type { BrowserHistoryAndFavoritesPanelFeatures, BrowserHistoryPanelFeature, BrowserFavoritesPanelFeature } from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';
import type { IEditorOpenContext, IEditorOptions } from 'cs/workbench/common/editor';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import type { IBrowserViewViewStateEvent } from 'cs/platform/browserView/common/browserView';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ILogService } from 'cs/platform/log/common/log';
import { ActiveEditorFocusedContext } from 'cs/workbench/common/contextkeys';

type BrowserEditorContributionCtor = new (editor: BrowserEditor, ...services: never[]) => BrowserEditorContribution;
type BrowserEditorViewState = IBrowserViewViewStateEvent;

const BROWSER_VIEW_STATE_RESTORE_DEADLINE_MS = 10_000;

export const BROWSER_EDITOR_ACTIVE = ContextKeyExpr.equals('activeEditor', BrowserEditorInput.EDITOR_ID);
export const CONTEXT_BROWSER_HAS_URL = new RawContextKey<boolean>('browserHasUrl', false);
export const CONTEXT_BROWSER_HAS_ERROR = new RawContextKey<boolean>('browserHasError', false);
export const CONTEXT_BROWSER_CAN_GO_BACK = new RawContextKey<boolean>('browserCanGoBack', false);
export const CONTEXT_BROWSER_CAN_GO_FORWARD = new RawContextKey<boolean>('browserCanGoForward', false);

export enum BrowserWidgetLocation {
	Toolbar = 'toolbar',
	ContentArea = 'contentArea',
}

export const BrowserActionCategory = 'Browser';

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

export type BrowserEditorModelDetachReason = 'modelChanged' | 'modelDisposed';

export abstract class BrowserEditorContribution extends Disposable {
	private readonly modelStore = this._register(new DisposableStore());
	private attachedModel: IBrowserViewModel | undefined;

	constructor(protected readonly editor: BrowserEditor) {
		super();
		this._register(editor.onDidChangeModel(({ model, isNew, detachReason }) => {
			if (this.attachedModel) {
				this.modelStore.clear();
				this.attachedModel = undefined;
				this.onModelDetached(detachReason);
			}
			if (model) {
				this.attachedModel = model;
				this.onModelAttached(model, this.modelStore, isNew);
			} else {
				this.modelStore.clear();
			}
		}));
	}

	get widgets(): readonly IBrowserEditorWidget[] {
		return [];
	}

	prerenderInput(_input: BrowserEditorInput): void { }
	protected onModelAttached(_model: IBrowserViewModel, _store: DisposableStore, _isNew: boolean): void { }
	onModelDetached(_reason: BrowserEditorModelDetachReason): void { }
	onPaneResized(_width: number): void { }
	afterContainerLayout(): void { }
	onPaneVisibilityChanged(_visible: boolean): void { }
	tryFocus(): boolean { return false; }
	onContainerCreated(_container: HTMLElement): void { }
	beforeContainerLayout(): IContainerLayoutOverride | undefined { return undefined; }
}

export class BrowserEditor extends EditorPane<
	BrowserEditorInput,
	BrowserEditorViewState
> implements BrowserEditorModeToolbarPane {
	private historyFeature: BrowserHistoryPanelFeature | undefined;
	private favoritesFeature: BrowserFavoritesPanelFeature | undefined;
	private static readonly contributions: BrowserEditorContributionCtor[] = [];
	private readonly contributionInstances = new Map<BrowserEditorContributionCtor, BrowserEditorContribution>();
	private readonly disposables = new DisposableStore();
	private readonly inputDisposables = this.disposables.add(new DisposableStore());
	private readonly _onDidFocus = this.disposables.add(new Emitter<void>());
	private readonly _onDidChangeModel = this.disposables.add(new Emitter<{
		model: IBrowserViewModel | undefined;
		isNew: boolean;
		detachReason: BrowserEditorModelDetachReason;
	}>());
	private readonly browserStateEmitter = this.disposables.add(new Emitter<BrowserEditorModeToolbarState>());
	private readonly runtimeStateEmitter = this.disposables.add(new Emitter<EditorPaneRuntimeState>());
	private readonly viewStateEmitter = this.disposables.add(new Emitter<BrowserEditorViewState>());
	private _browserState: BrowserEditorModeToolbarState | undefined;
	private readonly activeEditorFocusedContext: ContextKey<boolean>;
	private readonly hasUrlContext: ContextKey<boolean>;
	private readonly hasErrorContext: ContextKey<boolean>;
	private readonly canGoBackContext: ContextKey<boolean>;
	private readonly canGoForwardContext: ContextKey<boolean>;
	private inputModelSequence = 0;
	private _input: BrowserEditorInput | undefined;
	private _model: IBrowserViewModel | undefined;
	private readonly rootElement = $('div.browser-root');
	private readonly browserContainerWrapper = $('div.browser-container-wrapper');
	private readonly browserContainerElement = $('div.browser-container');
	private readonly placeholderContents = $('div.browser-placeholder-contents');
	private currentPadding: { top: number; right: number; bottom: number; left: number } = { top: 0, right: 0, bottom: 0, left: 0 };
	private viewState: BrowserEditorViewState | undefined;
	private pendingRestoredViewState: BrowserEditorViewState | undefined;
	private restoreSequence = 0;
	private restoreInFlight = false;
	private readonly restoreDeadline = this.disposables.add(new MutableDisposable());
	private visible = false;
	private hasVisibleLayout = false;
	private layoutGeneration = 0;

	readonly onDidFocus: Event<void> = this._onDidFocus.event;
	readonly onDidChangeModel = this._onDidChangeModel.event;
	readonly onDidChangeBrowserState = this.browserStateEmitter.event;
	override readonly onDidChangeRuntimeState = this.runtimeStateEmitter.event;
	override readonly onDidChangeViewState = this.viewStateEmitter.event;

	get browserState(): BrowserEditorModeToolbarState | undefined {
		return this._browserState;
	}

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
		this._onDidChangeModel.fire({ model, isNew: false, detachReason: 'modelChanged' });
	}

	get browserContainer(): HTMLElement {
		return this.browserContainerElement;
	}

	setHistoryFeature(feature: BrowserHistoryPanelFeature): void {
		this.historyFeature = feature;
	}

	setFavoritesFeature(feature: BrowserFavoritesPanelFeature): void {
		this.favoritesFeature = feature;
	}

	getHistoryAndFavoritesFeatures(): BrowserHistoryAndFavoritesPanelFeatures | undefined {
		return this.historyFeature && this.favoritesFeature
			? { history: this.historyFeature, favorites: this.favoritesFeature }
			: undefined;
	}

	get window(): Window & { vscodeWindowId: number } {
		return getWindow(this.rootElement) as Window & { vscodeWindowId: number };
	}

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.activeEditorFocusedContext = ActiveEditorFocusedContext.bindTo(contextKeyService);
		this.hasUrlContext = CONTEXT_BROWSER_HAS_URL.bindTo(contextKeyService);
		this.hasErrorContext = CONTEXT_BROWSER_HAS_ERROR.bindTo(contextKeyService);
		this.canGoBackContext = CONTEXT_BROWSER_CAN_GO_BACK.bindTo(contextKeyService);
		this.canGoForwardContext = CONTEXT_BROWSER_CAN_GO_FORWARD.bindTo(contextKeyService);
		this.disposables.add(toDisposable(this.localeService.subscribe(() => {
			if (this._input) {
				this.runtimeStateEmitter.fire(createBrowserEditorPaneState(this._input, this.labels));
			}
		})));
		this.createEditor();
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

	override getRuntimeState() {
		return this._input
			? createBrowserEditorPaneState(this._input, this.labels)
			: undefined;
	}

	override async setInput(
		input: BrowserEditorInput,
		_options: IEditorOptions | undefined,
		_context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		if (token.isCancellationRequested) {
			return;
		}
		const previousInputId = this._input?.id;
		if (previousInputId !== input.id) {
			this.cancelRestoreSequence();
		}
		await this.attachInput(input, token);
	}

	override focus() {
		for (const contribution of this.contributionInstances.values()) {
			if (contribution.tryFocus()) {
				return;
			}
		}
		this.ensureBrowserFocus();
	}

	override setVisible(visible: boolean) {
		if (this.visible !== visible) {
			this.layoutGeneration += 1;
		}
		this.visible = visible;
		if (!visible) {
			this.activeEditorFocusedContext.reset();
			this.hasVisibleLayout = false;
		}
		for (const contribution of this.contributionInstances.values()) {
			contribution.onPaneVisibilityChanged(visible);
		}
	}

	async navigate(url: string): Promise<void> {
		const model = await this.resolveCurrentModel();
		await model.loadURL(url, { source: 'urlInput' });
	}

	async goBack(): Promise<void> {
		await (await this.resolveCurrentModel()).goBack();
	}

	async goForward(): Promise<void> {
		await (await this.resolveCurrentModel()).goForward();
	}

	async reload(hard?: boolean): Promise<void> {
		await (await this.resolveCurrentModel()).reload(hard);
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
		return this.pendingRestoredViewState ?? this.viewState ?? this._model?.viewState;
	}

	override async captureViewState(): Promise<BrowserEditorViewState | undefined> {
		if (this.pendingRestoredViewState) {
			return this.pendingRestoredViewState;
		}
		const model = this._model;
		return model ? model.captureViewState() : this.viewState;
	}

	override restoreViewState(viewState: BrowserEditorViewState | undefined) {
		this.cancelRestoreSequence();
		this.viewState = viewState;
		this.pendingRestoredViewState = viewState;
		this.requestViewStateRestore();
	}

	override clearInput() {
		this.cancelRestoreSequence();
		this.inputModelSequence += 1;
		this.inputDisposables.clear();
		this._input = undefined;
		this.setModel(undefined, false);
		this.hasUrlContext.reset();
		this.hasErrorContext.reset();
	}

	override dispose() {
		this.cancelRestoreSequence();
		this.setVisible(false);
		this.clearInput();
		this.rootElement.replaceChildren();
		this.disposables.dispose();
	}

	async layoutBrowserContainer(retries = 2, generation = this.layoutGeneration): Promise<boolean> {
		const visibleLayout = this.visible;
		if (visibleLayout && retries === 2) {
			this.hasVisibleLayout = false;
		}
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
			return this.layoutBrowserContainer(retries - 1, generation);
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
		if (this._model !== model || generation !== this.layoutGeneration) {
			return false;
		}

		for (const contribution of this.contributionInstances.values()) {
			contribution.afterContainerLayout();
		}
		if (visibleLayout && this.visible) {
			this.hasVisibleLayout = true;
			this.requestViewStateRestore(model);
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

		for (const ctor of BrowserEditor.contributions) {
			const instance = this.disposables.add(this.instantiationService.createInstance(ctor, this));
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

		this.activeEditorFocusedContext.reset();
	}

	private async attachInput(input: BrowserEditorInput, token: CancellationToken): Promise<void> {
		if (this._input === input && this._model) {
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
			this.canGoBackContext.reset();
			this.canGoForwardContext.reset();
			for (const contribution of this.contributionInstances.values()) {
				contribution.prerenderInput(input);
			}
			model = await raceCancellationError(input.resolve(), token);
		}

		if (token.isCancellationRequested || this.inputModelSequence !== sequence || this._input !== input) {
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
				this.setModel(undefined, false, 'modelDisposed');
			}
		}));
		this.inputDisposables.add(model.onWillNavigate(() => this.ensureBrowserFocus()));
		this.inputDisposables.add(model.onDidChangeViewState(viewState => {
			this.updateViewState(viewState);
			this.requestViewStateRestore(model);
		}));
		this.inputDisposables.add(model.onDidNavigate(() => {
			if (this.pendingRestoredViewState && this.pendingRestoredViewState.url !== model.url) {
				this.cancelRestoreSequence();
			}
			this.hasUrlContext.set(!!model.url);
			if (this.viewState?.url !== model.url) {
				this.updateViewState({ url: model.url, scrollX: 0, scrollY: 0 });
			}
			this.ensureBrowserFocus();
			this.emitBrowserState(model);
		}));
		this.inputDisposables.add(model.onDidChangeLoadingState(() => {
			this.hasErrorContext.set(!!model.error);
			this.emitBrowserState(model);
			this.requestViewStateRestore(model);
		}));
		this.inputDisposables.add(model.onDidChangeVisibility(({ visible }) => {
			if (!visible) {
				this.activeEditorFocusedContext.reset();
			}
			this.requestViewStateRestore(model);
		}));
		this.inputDisposables.add(model.onDidChangeTitle(() => this.emitBrowserState(model)));
		this.inputDisposables.add(model.onDidChangeFavicon(() => this.emitBrowserState(model)));
		this.inputDisposables.add(model.onDidChangeFocus(({ focused }) => {
			if (focused) {
				this.activeEditorFocusedContext.set(true);
				this._onDidFocus.fire();
				this.ensureBrowserFocus();
			} else if (!this.rootElement.contains(this.rootElement.ownerDocument.activeElement)) {
				this.activeEditorFocusedContext.reset();
			}
		}));
		this.inputDisposables.add(onDidChangeZoomLevel(targetWindowId => {
			if (targetWindowId === this.window.vscodeWindowId) {
				this.browserContainerWrapper.style.setProperty('--zoom-factor', String(getZoomFactor(this.window)));
				void this.layoutBrowserContainer();
			}
		}));

		queueMicrotask(() => {
			if (this._model === model) {
				if (!this.pendingRestoredViewState && model.viewState.url === model.url) {
					this.updateViewState(model.viewState);
				}
				this.emitBrowserState(model);
				this.requestViewStateRestore(model);
			}
		});
		this.layout();
	}

	private async resolveCurrentModel(): Promise<IBrowserViewModel> {
		const input = this._input;
		if (!input) {
			throw new Error('Browser editor has no input.');
		}
		return input.resolve();
	}

	private emitBrowserState(model: IBrowserViewModel): void {
		this._browserState = {
			tabId: this.getCurrentInput().resource.toString(),
			url: model.url,
			title: model.title,
			favicon: model.favicon,
			loading: model.loading,
			canGoBack: model.canGoBack,
			canGoForward: model.canGoForward,
		};
		this.canGoBackContext.set(model.canGoBack);
		this.canGoForwardContext.set(model.canGoForward);
		this.browserStateEmitter.fire(this._browserState);
		this.runtimeStateEmitter.fire(createBrowserEditorPaneState(this.getCurrentInput(), this.labels));
	}

	private updateViewState(viewState: BrowserEditorViewState): void {
		const pendingViewState = this.pendingRestoredViewState;
		if (
			pendingViewState?.url === viewState.url &&
			(
				pendingViewState.scrollX !== viewState.scrollX ||
				pendingViewState.scrollY !== viewState.scrollY
			)
		) {
			return;
		}
		if (
			this.viewState?.url === viewState.url &&
			this.viewState.scrollX === viewState.scrollX &&
			this.viewState.scrollY === viewState.scrollY
		) {
			return;
		}
		this.viewState = viewState;
		this.viewStateEmitter.fire(viewState);
	}

	private getCurrentInput(): BrowserEditorInput {
		if (!this._input) {
			throw new Error('Browser editor has no input.');
		}
		return this._input;
	}

	private setModel(
		model: IBrowserViewModel | undefined,
		isNew: boolean,
		detachReason: BrowserEditorModelDetachReason = 'modelChanged',
	) {
		if (this._model === model) {
			return;
		}
		this.layoutGeneration += 1;
		this._model = model;
		this.hasVisibleLayout = false;
		this.hasUrlContext.set(!!model?.url);
		this.hasErrorContext.set(!!model?.error);
		this.canGoBackContext.set(model?.canGoBack ?? false);
		this.canGoForwardContext.set(model?.canGoForward ?? false);
		this._onDidChangeModel.fire({ model, isNew, detachReason });
	}

	private requestViewStateRestore(model = this._model): void {
		const viewState = this.pendingRestoredViewState;
		const input = this._input;
		if (
			!viewState ||
			!model ||
			!input ||
			model.loading ||
			!model.visible ||
			!this.visible ||
			!this.hasVisibleLayout ||
			this.restoreInFlight
		) {
			return;
		}
		if (!this.restoreDeadline.value) {
			this.restoreDeadline.value = disposableTimeout(() => {
				if (this.pendingRestoredViewState === viewState && this._model === model && this._input === input) {
					this.pendingRestoredViewState = undefined;
					this.restoreInFlight = false;
					this.restoreSequence += 1;
					this.logService.error(`Browser view state for '${input.id}' was not reachable before the restoration deadline.`);
				}
			}, BROWSER_VIEW_STATE_RESTORE_DEADLINE_MS);
		}
		this.restoreInFlight = true;
		const restoreSequence = ++this.restoreSequence;
		void model.restoreViewState(viewState).then(restored => {
			if (this.restoreSequence !== restoreSequence || this._model !== model || this._input !== input) {
				return;
			}
			this.restoreInFlight = false;
			if (restored) {
				this.pendingRestoredViewState = undefined;
				this.restoreDeadline.clear();
			}
		}).catch(error => {
			if (this.restoreSequence === restoreSequence && this._model === model && this._input === input) {
				this.pendingRestoredViewState = undefined;
				this.restoreInFlight = false;
				this.restoreDeadline.clear();
				this.logService.error(`Browser view state restoration failed for '${input.id}'.`, error);
			}
		});
	}

	private cancelRestoreSequence() {
		this.restoreSequence += 1;
		this.restoreInFlight = false;
		this.restoreDeadline.clear();
		this.pendingRestoredViewState = undefined;
	}

	private get labels(): BrowserEditorPaneLabels {
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		return {
			sourceMode: ui.editorSourceMode,
			status: {
				statusbarAriaLabel: ui.editorStatusbarAriaLabel,
				url: ui.editorStatusUrl,
			},
		};
	}
}
