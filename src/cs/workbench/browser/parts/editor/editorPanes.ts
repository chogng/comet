/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, CancellationTokenSource } from 'cs/base/common/cancellation';
import { Disposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IEditorOpenContext, IEditorOptions } from 'cs/workbench/common/editor';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IContextKeyService, type ContextKey } from 'cs/platform/contextkey/common/contextkey';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import { ActiveEditorContext } from 'cs/workbench/common/contextkeys';
import { EditorViewStateStore, type EditorViewStateKey, type SerializedEditorViewStateEntry } from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import { EditorPane, type AnyEditorPane, type EditorPaneLayout, type EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import {
	editorPaneRegistry,
	type IEditorPaneDescriptor,
} from 'cs/workbench/browser/parts/editor/panes/editorPaneRegistry';

export interface EditorPanesContext {
	readonly groupId: string;
	readonly visible: boolean;
	readonly viewStateEntries: readonly SerializedEditorViewStateEntry[];
	readonly onDidChangeRuntimeState: (input: EditorInput, state: EditorPaneRuntimeState) => void;
	readonly onSetEditorViewState: (key: EditorViewStateKey, state: unknown) => void;
	readonly onDeleteEditorViewState: (key: EditorViewStateKey) => void;
}

export class EditorPanes extends Disposable {
	private context: EditorPanesContext;
	private readonly viewStateStore: EditorViewStateStore;
	private readonly paneInstances = new Map<IEditorPaneDescriptor, AnyEditorPane>();
	private readonly paneVisibility = new Map<AnyEditorPane, boolean>();
	private readonly pendingViewStateSaveByTabId = new Map<string, Promise<void>>();
	private readonly pendingOpenByTabId = new Map<string, Promise<void>>();
	private readonly viewStateSaveErrorByTabId = new Map<string, unknown>();
	private readonly viewStateSaveSequenceByKey = new Map<string, number>();
	private activePane: AnyEditorPane | null = null;
	private activeDescriptor: IEditorPaneDescriptor | null = null;
	private activeInput: EditorInput | null = null;
	private activePaneViewStateKey: EditorViewStateKey | null = null;
	private activePaneInputSource: CancellationTokenSource | null = null;
	private activePaneRuntimeStateListener: IDisposable = Disposable.None;
	private activePaneViewStateListener: IDisposable = Disposable.None;
	private operationSequence = 0;
	private viewStateSaveSequence = 0;
	private viewStateWriteEpoch = 0;
	private isDisposed = false;
	private readonly activeEditorContext: ContextKey<string | null>;

	constructor(
		private readonly contentElement: HTMLElement,
		context: EditorPanesContext,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();
		this.context = context;
		this.viewStateStore = new EditorViewStateStore(context.viewStateEntries);
		this.activeEditorContext = ActiveEditorContext.bindTo(contextKeyService);
	}

	setContext(context: EditorPanesContext): void {
		this.assertNotDisposed();
		if (context.groupId !== this.context.groupId) {
			this.saveActivePaneViewState();
			this.invalidatePendingViewStateWrites();
			this.disposeAllPaneInstances();
			this.viewStateStore.replaceAll(context.viewStateEntries);
		}
		this.context = context;
		if (this.activePane && this.activeInput) {
			this.bindActivePaneRuntimeState(this.activePane, this.activeInput);
			this.setPaneVisible(this.activePane, context.visible && !this.activePaneInputSource);
		}
	}

	hasActiveInput(input: EditorInput): boolean {
		return this.activeInput === input;
	}

	openEditor(
		input: EditorInput,
		options: IEditorOptions | undefined,
		openContext: IEditorOpenContext,
	): Promise<void> {
		this.assertNotDisposed();
		const tabId = getEditorInputId(input);
		const operation = ++this.operationSequence;
		this.cancelActiveInput();
		this.activeEditorContext.reset();
		const pendingOpen = this.doOpenEditor(operation, input, options, openContext);
		this.pendingOpenByTabId.set(tabId, pendingOpen);
		pendingOpen.then(
			() => this.clearPendingOpen(tabId, pendingOpen),
			() => this.clearPendingOpen(tabId, pendingOpen),
		);
		return pendingOpen;
	}

	clearActiveEditor(): void {
		this.assertNotDisposed();
		this.operationSequence += 1;
		this.cancelActiveInput();
		this.releaseActivePane();
		this.resetContentPresentation();
	}

	getActivePane(): AnyEditorPane | null {
		return this.activePane;
	}

	getActivePaneModeId(): string | null {
		return this.activeDescriptor?.modeId ?? null;
	}

	getToolbarElement(): HTMLElement | null {
		return this.activePane?.getToolbarElement() ?? null;
	}

	async captureActivePaneViewState(): Promise<void> {
		this.assertNotDisposed();
		const tabId = this.activeInput ? getEditorInputId(this.activeInput) : undefined;
		this.saveActivePaneViewState();
		if (tabId) {
			await this.whenViewStateSettled(tabId);
		}
	}

	layout(layout: EditorPaneLayout): void {
		this.activePane?.layout(layout);
	}

	focusPrimaryInput(): boolean {
		if (!this.activePane) {
			return false;
		}
		this.activePane.focusPrimaryInput();
		return true;
	}

	async whenViewStateSettled(tabId: string): Promise<void> {
		await this.pendingOpenByTabId.get(tabId);
		await this.pendingViewStateSaveByTabId.get(tabId);
		if (this.viewStateSaveErrorByTabId.has(tabId)) {
			const error = this.viewStateSaveErrorByTabId.get(tabId);
			this.viewStateSaveErrorByTabId.delete(tabId);
			throw error;
		}
	}

	override dispose(): void {
		if (this.isDisposed) {
			return;
		}
		this.operationSequence += 1;
		this.cancelActiveInput();
		this.saveActivePaneViewState();
		this.isDisposed = true;
		this.activeEditorContext.reset();
		this.invalidatePendingViewStateWrites();
		this.disposeAllPaneInstances();
		this.pendingOpenByTabId.clear();
		this.pendingViewStateSaveByTabId.clear();
		this.viewStateSaveErrorByTabId.clear();
		super.dispose();
	}

	private async doOpenEditor(
		operation: number,
		input: EditorInput,
		options: IEditorOptions | undefined,
		openContext: IEditorOpenContext,
	): Promise<void> {
		await Promise.resolve();
		this.assertCurrentOperation(operation);

		const descriptor = editorPaneRegistry.getEditorPane(input);
		const activeEditorId = input.editorId;
		if (!activeEditorId) {
			throw new Error(`Editor input '${input.typeId}' does not identify its Editor Pane.`);
		}
		const viewStateKey = this.createPaneViewStateKey(descriptor.paneId, input);
		const didSwitchInput = this.activeInput !== input;
		let pane = this.activePane;
		if (this.activeDescriptor !== descriptor || !pane) {
			this.releaseActivePane();
			pane = this.getOrCreatePane(descriptor);
			this.activePane = pane;
			this.activeDescriptor = descriptor;
		} else if (didSwitchInput) {
			this.saveActivePaneViewState();
		}

		this.activeInput = input;
		this.activePaneViewStateKey = viewStateKey;
		this.bindActivePaneRuntimeState(pane, input);
		this.applyContentPresentation(descriptor, pane);
		this.activeEditorContext.reset();
		pane.clearInput();
		if (this.paneVisibility.get(pane) === true) {
			this.setPaneVisible(pane, false);
		}

		const source = new CancellationTokenSource();
		this.activePaneInputSource = source;
		try {
			try {
				await pane.setInput(input, options, openContext, source.token);
			} catch (error) {
				this.assertCurrentOperation(operation, source);
				throw error;
			}
			this.assertCurrentOperation(operation, source);
			this.restorePaneViewState(pane, viewStateKey);
			this.activeEditorContext.set(activeEditorId);
			this.setPaneVisible(pane, this.context.visible);
		} finally {
			if (this.activePaneInputSource === source) {
				this.activePaneInputSource = null;
			}
			source.dispose();
		}
	}

	private getOrCreatePane(descriptor: IEditorPaneDescriptor): AnyEditorPane {
		const existingPane = this.paneInstances.get(descriptor);
		if (existingPane) {
			return existingPane;
		}
		const pane = this.instantiationService.createInstance(descriptor.paneConstructor);
		this.paneInstances.set(descriptor, pane);
		return pane;
	}

	private assertCurrentOperation(operation: number, source?: CancellationTokenSource): void {
		if (operation !== this.operationSequence || source?.token.isCancellationRequested) {
			throw new CancellationError();
		}
	}

	private clearPendingOpen(tabId: string, pendingOpen: Promise<void>): void {
		if (this.pendingOpenByTabId.get(tabId) === pendingOpen) {
			this.pendingOpenByTabId.delete(tabId);
		}
	}

	private cancelActiveInput(): void {
		this.activePaneInputSource?.cancel();
		this.activePaneInputSource?.dispose();
		this.activePaneInputSource = null;
	}

	private releaseActivePane(): void {
		if (!this.activePane) {
			return;
		}
		this.saveActivePaneViewState();
		this.cancelActiveInput();
		this.activePaneRuntimeStateListener.dispose();
		this.activePaneRuntimeStateListener = Disposable.None;
		this.activePaneViewStateListener.dispose();
		this.activePaneViewStateListener = Disposable.None;
		this.activePane.clearInput();
		this.setPaneVisible(this.activePane, false);
		this.activePane = null;
		this.activeDescriptor = null;
		this.activeInput = null;
		this.activePaneViewStateKey = null;
		this.activeEditorContext.reset();
	}

	private bindActivePaneRuntimeState(pane: AnyEditorPane, input: EditorInput): void {
		this.activePaneRuntimeStateListener.dispose();
		this.activePaneViewStateListener.dispose();
		this.activePaneRuntimeStateListener = pane.onDidChangeRuntimeState(state => {
			this.context.onDidChangeRuntimeState(input, state);
		});
		this.activePaneViewStateListener = pane.onDidChangeViewState(state => {
			if (this.activePane === pane && this.activeInput === input && this.activePaneViewStateKey) {
				this.setPaneViewState(this.activePaneViewStateKey, state);
			}
		});
		const state = pane.getRuntimeState();
		if (state) {
			this.context.onDidChangeRuntimeState(input, state);
		}
	}

	private applyContentPresentation(descriptor: IEditorPaneDescriptor, pane: AnyEditorPane): void {
		this.contentElement.className = [
			'comet-editor-content',
			...descriptor.contentClassNames,
		].join(' ');
		this.contentElement.dataset.editorPane = descriptor.paneId;
		if (this.contentElement.firstChild !== pane.getElement()) {
			this.contentElement.replaceChildren(pane.getElement());
		}
	}

	private setPaneVisible(pane: AnyEditorPane, visible: boolean): void {
		if (this.paneVisibility.get(pane) === visible) {
			return;
		}
		this.paneVisibility.set(pane, visible);
		pane.setVisible(visible);
	}

	private resetContentPresentation(): void {
		this.contentElement.className = 'comet-editor-content';
		this.contentElement.removeAttribute('data-editor-pane');
	}

	private createPaneViewStateKey(paneId: string, input: EditorInput): EditorViewStateKey {
		return {
			groupId: this.context.groupId,
			paneId,
			resourceKey: getEditorInputId(input),
		};
	}

	private saveActivePaneViewState(): void {
		if (!this.activePane || !this.activePaneViewStateKey || !this.activeInput) {
			return;
		}
		const pane = this.activePane;
		const tabId = getEditorInputId(this.activeInput);
		const viewStateKey = this.activePaneViewStateKey;
		const serializedViewStateKey = JSON.stringify(viewStateKey);
		const saveSequence = ++this.viewStateSaveSequence;
		const writeEpoch = this.viewStateWriteEpoch;
		this.viewStateSaveSequenceByKey.set(serializedViewStateKey, saveSequence);
		const synchronousViewState = pane.getViewState();
		if (synchronousViewState === undefined) {
			if (pane.captureViewState === EditorPane.prototype.captureViewState) {
				this.deletePaneViewState(viewStateKey);
			}
		} else {
			this.setPaneViewState(viewStateKey, synchronousViewState);
		}

		const pendingSave = pane.captureViewState()
			.then(capturedViewState => {
				if (this.viewStateWriteEpoch !== writeEpoch
					|| this.viewStateSaveSequenceByKey.get(serializedViewStateKey) !== saveSequence) {
					return;
				}
				if (capturedViewState === undefined) {
					if (pane.captureViewState === EditorPane.prototype.captureViewState) {
						this.deletePaneViewState(viewStateKey);
					}
					return;
				}
				this.setPaneViewState(viewStateKey, capturedViewState);
			})
			.finally(() => {
				if (this.viewStateSaveSequenceByKey.get(serializedViewStateKey) === saveSequence) {
					this.viewStateSaveSequenceByKey.delete(serializedViewStateKey);
				}
			});
		this.trackPendingViewStateSave(tabId, pendingSave, writeEpoch);
	}

	private trackPendingViewStateSave(
		tabId: string,
		pendingSave: Promise<void>,
		writeEpoch: number,
	): void {
		const handledSave = pendingSave.catch(error => {
			if (this.viewStateWriteEpoch === writeEpoch
				&& !this.viewStateSaveErrorByTabId.has(tabId)) {
				this.viewStateSaveErrorByTabId.set(tabId, error);
			}
		});
		const previousSave = this.pendingViewStateSaveByTabId.get(tabId);
		const trackedSave = previousSave
			? Promise.all([previousSave, handledSave]).then(() => undefined)
			: handledSave;
		this.pendingViewStateSaveByTabId.set(tabId, trackedSave);
		trackedSave.then(() => this.clearPendingViewStateSave(tabId, trackedSave));
	}

	private clearPendingViewStateSave(tabId: string, pendingSave: Promise<void>): void {
		if (this.pendingViewStateSaveByTabId.get(tabId) === pendingSave) {
			this.pendingViewStateSaveByTabId.delete(tabId);
		}
	}

	private restorePaneViewState(pane: AnyEditorPane, key: EditorViewStateKey): void {
		pane.restoreViewState(this.viewStateStore.get(key));
	}

	private setPaneViewState(key: EditorViewStateKey, state: unknown): void {
		this.viewStateStore.set(key, state);
		this.context.onSetEditorViewState(key, state);
	}

	private deletePaneViewState(key: EditorViewStateKey): void {
		this.viewStateStore.delete(key);
		this.context.onDeleteEditorViewState(key);
	}

	private invalidatePendingViewStateWrites(): void {
		this.viewStateWriteEpoch += 1;
		this.viewStateSaveSequenceByKey.clear();
		this.pendingViewStateSaveByTabId.clear();
		this.viewStateSaveErrorByTabId.clear();
	}

	private assertNotDisposed(): void {
		if (this.isDisposed) {
			throw new Error('Editor Panes have been disposed.');
		}
	}

	private disposeAllPaneInstances(): void {
		this.cancelActiveInput();
		this.activePaneRuntimeStateListener.dispose();
		this.activePaneRuntimeStateListener = Disposable.None;
		this.activePaneViewStateListener.dispose();
		this.activePaneViewStateListener = Disposable.None;
		for (const pane of this.paneInstances.values()) {
			pane.clearInput();
			pane.dispose();
		}
		this.paneInstances.clear();
		this.paneVisibility.clear();
		this.activePane = null;
		this.activeDescriptor = null;
		this.activeInput = null;
		this.activePaneViewStateKey = null;
		this.activeEditorContext.reset();
	}
}
