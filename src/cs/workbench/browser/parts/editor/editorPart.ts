/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocaleMessages } from 'language/locales';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import type { EditorPartBaseProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import type {
	EditorViewStateKey,
	SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { IEditorGroup, IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import type { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { IStorageService, StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { getEditorCreationActions } from 'cs/workbench/browser/parts/editor/editorCreationActionRegistry';

const EditorViewStateStorageKey = 'workbench.editor.viewState';

export type EditorPartControllerContext = {
	ui: LocaleMessages;
	viewPartProps: ViewPartProps;
	nativeHost: INativeHostService;
	dialogService: IDialogService;
	instantiationService: IInstantiationService;
	editorGroupsService: IEditorGroupsService;
	editorService: IEditorService;
	storageService: IStorageService;
	commandService: IWorkbenchCommandService;
};

export type EditorPartControllerSnapshot = {
	group: IEditorGroup;
	viewStateEntries: SerializedEditorViewStateEntry[];
	editorPartProps: EditorPartBaseProps;
};

export type EditorPartModel = EditorPartController;
export type EditorPartChangeReason = 'structure' | 'context';

type EditorPartActions = {
	onActivateTab: (editorId: string) => void;
	onReorderTab: (editorId: string, targetSlotIndex: number) => void;
	onCloseTab: (editorId: string) => Promise<boolean>;
	onCloseOtherTabs: (editorId: string) => Promise<boolean>;
	onCloseAllTabs: () => Promise<boolean>;
	onRenameTab: (editorId: string) => Promise<void>;
	onOpenEditor: EditorOpenHandler;
	onSetEditorViewState: (key: EditorViewStateKey, state: unknown) => void;
	onDeleteEditorViewState: (key: EditorViewStateKey) => void;
};

function createEditorPartStructureKey(snapshot: EditorPartControllerSnapshot): string {
	return JSON.stringify({
		groupId: snapshot.group.id,
		editors: snapshot.group.getEditors().map(editor => ({
			id: getEditorInputId(editor),
			name: editor.getName(),
			dirty: editor.isDirty(),
		})),
		activeEditor: snapshot.group.activeEditor
			? getEditorInputId(snapshot.group.activeEditor)
			: null,
	});
}

function createEditorPartProps(
	context: EditorPartControllerContext,
	group: IEditorGroup,
	viewStateEntries: SerializedEditorViewStateEntry[],
	actions: EditorPartActions,
): EditorPartBaseProps {
	const { ui } = context;
	return {
		ui,
		creationActions: getEditorCreationActions(ui),
		labels: {
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
		},
		viewPartProps: context.viewPartProps,
		nativeHost: context.nativeHost,
		dialogService: context.dialogService,
		instantiationService: context.instantiationService,
		group,
		commandService: context.commandService,
		viewStateEntries,
		...actions,
		showTitlebarActions: true,
		showToolbar: true,
		isEditorCollapsed: false,
		onToggleEditorCollapse: () => {},
	};
}

function areEditorPartControllerContextsEqual(
	previous: EditorPartControllerContext,
	next: EditorPartControllerContext,
): boolean {
	return previous.ui === next.ui
		&& previous.nativeHost === next.nativeHost
		&& previous.dialogService === next.dialogService
		&& previous.instantiationService === next.instantiationService
		&& previous.editorGroupsService === next.editorGroupsService
		&& previous.editorService === next.editorService
		&& previous.storageService === next.storageService
		&& previous.commandService === next.commandService
		&& previous.viewPartProps === next.viewPartProps;
}

export class EditorPartController {
	private context: EditorPartControllerContext;
	private readonly editorGroupsService: IEditorGroupsService;
	private readonly editorService: IEditorService;
	private readonly viewStateEntries = new Map<string, SerializedEditorViewStateEntry>();
	private readonly listeners = new Set<(reason: EditorPartChangeReason) => void>();
	private snapshot: EditorPartControllerSnapshot;
	private readonly actions: EditorPartActions;
	private readonly groupsListener: IDisposable;

	constructor(context: EditorPartControllerContext) {
		this.context = context;
		this.editorGroupsService = context.editorGroupsService;
		this.editorService = context.editorService;
		const stored = context.storageService.get(EditorViewStateStorageKey, StorageScope.WORKSPACE);
		if (stored) {
			const parsed = JSON.parse(stored) as SerializedEditorViewStateEntry[];
			for (const entry of parsed) {
				this.viewStateEntries.set(JSON.stringify(entry.key), entry);
			}
		}
		this.actions = {
			onActivateTab: this.onActivateTab,
			onReorderTab: this.onReorderTab,
			onCloseTab: this.onCloseTab,
			onCloseOtherTabs: this.onCloseOtherTabs,
			onCloseAllTabs: this.onCloseAllTabs,
			onRenameTab: this.onRenameTab,
			onOpenEditor: this.editorService.openEditor.bind(this.editorService),
			onSetEditorViewState: this.setEditorViewState,
			onDeleteEditorViewState: this.deleteEditorViewState,
		};
		this.snapshot = this.createSnapshot();
		this.groupsListener = this.editorGroupsService.onDidChange(() => {
			this.refreshSnapshot('structure');
		});
	}

	readonly subscribe = (listener: (reason: EditorPartChangeReason) => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};

	readonly getSnapshot = () => this.snapshot;

	readonly setContext = (context: EditorPartControllerContext) => {
		if (context.editorGroupsService !== this.editorGroupsService) {
			throw new Error('EditorPartController cannot change editor groups service.');
		}
		if (context.editorService !== this.editorService) {
			throw new Error('EditorPartController cannot change editor service.');
		}
		if (areEditorPartControllerContextsEqual(this.context, context)) {
			return;
		}
		this.context = context;
		this.refreshSnapshot('context');
	};

	private activateEditor(editor: EditorInput): void {
		const match = this.editorGroupsService.findEditor(editor);
		if (!match) {
			return;
		}
		match.group.setActive(match.editor);
		this.editorGroupsService.activateGroup(match.group);
	}

	readonly setEditorViewState = (key: EditorViewStateKey, state: unknown) => {
		this.viewStateEntries.set(JSON.stringify(key), { key, state });
		this.persist();
		this.refreshSnapshot('structure');
	};

	readonly deleteEditorViewState = (key: EditorViewStateKey) => {
		this.viewStateEntries.delete(JSON.stringify(key));
		this.persist();
		this.refreshSnapshot('structure');
	};

	readonly dispose = () => {
		this.groupsListener.dispose();
		this.listeners.clear();
	};

	private readonly onActivateTab = (editorId: string) => {
		const editor = this.findEditorById(editorId);
		if (editor) {
			this.activateEditor(editor);
		}
	};

	private readonly onReorderTab = (editorId: string, targetSlotIndex: number) => {
		const editor = this.findEditorById(editorId);
		if (editor) {
			this.editorGroupsService.activeGroup.moveEditor(editor, targetSlotIndex);
		}
	};

	private readonly onCloseTab = async (editorId: string) => {
		const editor = this.findEditorById(editorId);
		return editor ? this.editorGroupsService.closeEditor(editor) : false;
	};

	private readonly onCloseOtherTabs = async (editorId: string) => {
		const group = this.editorGroupsService.activeGroup;
		for (const editor of group.getEditors()) {
			if (getEditorInputId(editor) !== editorId && !(await group.closeEditor(editor))) {
				return false;
			}
		}
		return true;
	};

	private readonly onCloseAllTabs = async () => {
		for (const editor of this.editorGroupsService.activeGroup.getEditors()) {
			if (!(await this.editorGroupsService.activeGroup.closeEditor(editor))) {
				return false;
			}
		}
		return true;
	};

	private readonly onRenameTab = async (editorId: string) => {
		const editor = this.findEditorById(editorId);
		if (!editor) {
			return;
		}
		const result = await this.context.dialogService.input({
			title: this.context.ui.editorTabRenameTitle,
			message: this.context.ui.editorTabRenameLabel,
			value: editor.getName(),
			primaryButton: this.context.ui.editorModalConfirm,
			cancelButton: this.context.ui.editorModalCancel,
		});
		if (result.value) {
			editor.rename(result.value);
		}
	};

	private findEditorById(editorId: string): EditorInput | undefined {
		return this.editorGroupsService.activeGroup.getEditors().find(editor => getEditorInputId(editor) === editorId);
	}

	private createSnapshot(): EditorPartControllerSnapshot {
		const group = this.editorGroupsService.activeGroup;
		const viewStateEntries = [...this.viewStateEntries.values()];
		return {
			group,
			viewStateEntries,
			editorPartProps: createEditorPartProps(this.context, group, viewStateEntries, this.actions),
		};
	}

	private refreshSnapshot(reason: EditorPartChangeReason): void {
		const next = this.createSnapshot();
		const previous = this.snapshot;
		this.snapshot = next;
		if (reason === 'structure' && createEditorPartStructureKey(previous) === createEditorPartStructureKey(next)) {
			return;
		}
		for (const listener of this.listeners) {
			listener(reason);
		}
	}

	private persist(): void {
		this.context.storageService.store(
			EditorViewStateStorageKey,
			JSON.stringify([...this.viewStateEntries.values()]),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}
}

export function createEditorPartController(context: EditorPartControllerContext) {
	return new EditorPartController(context);
}
