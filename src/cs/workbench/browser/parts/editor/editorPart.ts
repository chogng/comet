/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocaleMessages } from 'language/locales';
import { toDisposable, Disposable } from 'cs/base/common/lifecycle';
import type { IEditorOpenContext, IEditorOptions, IEditorPane } from 'cs/workbench/common/editor';
import type { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { IStorageService } from 'cs/platform/storage/common/storage';
import { StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { getEditorCreationActions } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';
import { EditorGroupView, type EditorGroupViewProps } from 'cs/workbench/browser/parts/editor/editorGroupView';
import type { EditorStatusLabels, EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import type {
	EditorViewStateKey,
	SerializedEditorViewState,
	SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import {
	parseSerializedEditorViewState,
	serializeEditorViewStateKey,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type {
	IEditorGroupsService,
	IEditorPartHost,
} from 'cs/workbench/services/editor/common/editorGroupsService';
import type { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import type { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

const EditorViewStateStorageKey = 'workbench.editor.viewState';

export interface EditorPartLabels {
	readonly headerAddAction: string;
	readonly close: string;
	readonly closeOthers: string;
	readonly closeAll: string;
	readonly rename: string;
	readonly expandEditor: string;
	readonly collapseEditor: string;
	readonly status: EditorStatusLabels;
}

export type IEditorPartsConstructionOwner = Omit<IEditorGroupsService, '_serviceBrand' | 'mainPart'>;

export abstract class MainEditorPart extends Disposable implements IEditorPartHost {
	private readonly viewStateEntries = new Map<string, SerializedEditorViewStateEntry>();
	private viewStateDirty = false;
	private groupView: EditorGroupView | undefined;

	protected constructor(
		protected readonly editorGroupsService: IEditorPartsConstructionOwner,
		private readonly element: HTMLElement,
		private readonly nativeHostService: INativeHostService,
		private readonly dialogService: IDialogService,
		private readonly instantiationService: IInstantiationService,
		private readonly storageService: IStorageService,
		private readonly commandService: IWorkbenchCommandService,
		private readonly contextMenuService: IContextMenuService,
		private readonly contextViewService: IContextViewService,
		private readonly localeService: IWorkbenchLocaleService,
		private readonly languageService: IWorkbenchLanguageService,
	) {
		super();
		this.restoreViewState();
		this._register(this.storageService.onWillSaveState(event => {
			event.join(this.captureAndPersistViewState());
		}));
		this._register(this.editorGroupsService.onDidChange(() => this.refreshPresentation()));
		this._register(toDisposable(this.localeService.subscribe(() => this.refreshPresentation())));
	}

	abstract revealEditor(expandedEditorSize?: number): void;

	async openEditor(
		editor: EditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
	): Promise<void> {
		if (this.editorGroupsService.activeGroup.activeEditor !== editor) {
			return;
		}
		await this.requireGroupView().openEditor(editor, options, context);
	}

	initialize(): void {
		if (this.groupView) {
			return;
		}

		const groupView = this._register(this.instantiationService.createInstance(
			EditorGroupView,
			this.createGroupViewProps(),
		));
		this.groupView = groupView;
		this.element.append(groupView.getElement());
	}

	getElement(): HTMLElement {
		return this.element;
	}

	layout(width: number, height: number): void {
		this.requireGroupView().layout(width, height);
	}

	whenEditorTabViewStateSettled(tabId: string): Promise<void> {
		return this.requireGroupView().whenTabViewStateSettled(tabId);
	}

	focusPrimaryInput(): void {
		this.requireGroupView().focusPrimaryInput();
	}

	get activeEditorPane(): IEditorPane | undefined {
		return this.groupView?.getActivePane() ?? undefined;
	}

	protected refreshPresentation(): void {
		this.groupView?.setProps(this.createGroupViewProps());
	}

	protected abstract onDidResolveLabels(labels: EditorPartLabels): void;

	protected abstract get editorCollapsed(): boolean;
	protected abstract toggleEditorCollapsed(): void;
	protected abstract updateEditorStatus(status: EditorStatusState): void;

	override dispose(): void {
		super.dispose();
		this.persistViewState();
		this.groupView = undefined;
		this.element.replaceChildren();
	}

	private createGroupViewProps(): EditorGroupViewProps {
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
		const labels = this.createLabels(ui);
		this.onDidResolveLabels(labels);
		const group = this.editorGroupsService.activeGroup;
		const viewStateEntries = [...this.viewStateEntries.values()];

		return {
			ui,
			labels,
			creationActions: getEditorCreationActions(ui),
			viewPartProps: this.createViewPartProps(ui),
			group,
			commandService: this.commandService,
			viewStateEntries,
			contextMenuService: this.contextMenuService,
			contextViewProvider: this.contextViewService,
			onActivateTab: editorId => this.activateEditor(editorId),
			onReorderTab: (editorId, targetSlotIndex) => this.reorderEditor(editorId, targetSlotIndex),
			onCloseTab: editorId => this.closeEditor(editorId),
			onCloseOtherTabs: editorId => this.closeOtherEditors(editorId),
			onCloseAllTabs: () => this.closeAllEditors(),
			onRenameTab: editorId => this.renameEditor(editorId, ui),
			onSetEditorViewState: (key, state) => this.setEditorViewState(key, state),
			onDeleteEditorViewState: key => this.deleteEditorViewState(key),
			showTitlebarActions: !this.editorCollapsed,
			showToolbar: true,
			isEditorCollapsed: this.editorCollapsed,
			onToggleEditorCollapse: () => this.toggleEditorCollapsed(),
			titlebarAuxiliaryActionsElements: [],
			hasLeadingTitlebarWindowControlsInset: false,
			onStatusChange: status => this.updateEditorStatus(status),
		};
	}

	private createLabels(ui: LocaleMessages): EditorPartLabels {
		return {
			headerAddAction: ui.editorHeaderAddAction,
			close: ui.toastClose,
			closeOthers: ui.editorTabContextCloseOthers,
			closeAll: ui.editorTabContextCloseAll,
			rename: ui.editorTabContextRename,
			expandEditor: ui.editorExpand,
			collapseEditor: ui.editorCollapse,
			status: {
				statusbarAriaLabel: ui.editorStatusbarAriaLabel,
				ready: ui.statusReady,
			},
		};
	}

	private createViewPartProps(ui: LocaleMessages): ViewPartProps {
		return {
			browserUrl: '',
			browserPageTitle: '',
			browserFaviconUrl: '',
			browserIsLoading: false,
			electronRuntime: this.nativeHostService.canInvoke(),
			webContentRuntime: typeof this.nativeHostService.webContent?.navigate === 'function',
			labels: {
				emptyState: ui.emptyState,
				contentUnavailable: ui.webContentUnavailable,
				overlayPauseHeading: ui.webContentOverlayPauseHeading,
				overlayPauseDetail: ui.webContentOverlayPauseDetail,
			},
		};
	}

	private activateEditor(editorId: string): void {
		const editor = this.findEditorById(editorId);
		if (!editor) {
			return;
		}
		const match = this.editorGroupsService.findEditor(editor);
		if (!match) {
			return;
		}
		match.group.setActive(match.editor);
		this.editorGroupsService.activateGroup(match.group);
	}

	private reorderEditor(editorId: string, targetSlotIndex: number): void {
		const editor = this.findEditorById(editorId);
		if (editor) {
			this.editorGroupsService.activeGroup.moveEditor(editor, targetSlotIndex);
		}
	}

	private async closeEditor(editorId: string): Promise<boolean> {
		const editor = this.findEditorById(editorId);
		return editor ? this.editorGroupsService.closeEditor(editor) : false;
	}

	private async closeOtherEditors(editorId: string): Promise<boolean> {
		const group = this.editorGroupsService.activeGroup;
		for (const editor of group.getEditors()) {
			if (getEditorInputId(editor) !== editorId && !(await group.closeEditor(editor))) {
				return false;
			}
		}
		return true;
	}

	private async closeAllEditors(): Promise<boolean> {
		for (const editor of this.editorGroupsService.activeGroup.getEditors()) {
			if (!(await this.editorGroupsService.activeGroup.closeEditor(editor))) {
				return false;
			}
		}
		return true;
	}

	private async renameEditor(editorId: string, ui: LocaleMessages): Promise<void> {
		const editor = this.findEditorById(editorId);
		if (!editor) {
			return;
		}
		const result = await this.dialogService.input({
			title: ui.editorTabRenameTitle,
			message: ui.editorTabRenameLabel,
			value: editor.getName(),
			primaryButton: ui.editorModalConfirm,
			cancelButton: ui.editorModalCancel,
		});
		if (result.value) {
			editor.rename(result.value);
		}
	}

	private findEditorById(editorId: string): EditorInput | undefined {
		return this.editorGroupsService.activeGroup.getEditors()
			.find(editor => getEditorInputId(editor) === editorId);
	}

	private setEditorViewState(key: EditorViewStateKey, state: unknown): void {
		if (state === undefined) {
			throw new Error('Editor view state must be deleted instead of set to undefined.');
		}
		this.viewStateEntries.set(serializeEditorViewStateKey(key), { key, state });
		this.viewStateDirty = true;
	}

	private deleteEditorViewState(key: EditorViewStateKey): void {
		if (this.viewStateEntries.delete(serializeEditorViewStateKey(key))) {
			this.viewStateDirty = true;
		}
	}

	private restoreViewState(): void {
		const stored = this.storageService.get(EditorViewStateStorageKey, StorageScope.WORKSPACE);
		if (stored === undefined) {
			return;
		}
		const parsed = parseSerializedEditorViewState(JSON.parse(stored));
		for (const entry of parsed.entries) {
			this.viewStateEntries.set(serializeEditorViewStateKey(entry.key), entry);
		}
	}

	private persistViewState(): void {
		if (!this.viewStateDirty) {
			return;
		}
		const stored: SerializedEditorViewState = {
			version: 2,
			entries: [...this.viewStateEntries.values()],
		};
		this.storageService.store(
			EditorViewStateStorageKey,
			JSON.stringify(stored),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
		this.viewStateDirty = false;
	}

	private async captureAndPersistViewState(): Promise<void> {
		await this.groupView?.captureActivePaneViewState();
		this.persistViewState();
	}

	private requireGroupView(): EditorGroupView {
		if (!this.groupView) {
			throw new Error('The main Editor Part has not been initialized.');
		}
		return this.groupView;
	}

}
