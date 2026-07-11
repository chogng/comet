/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocaleMessages } from 'language/locales';
import {
	writingEditorDocumentToPlainText,
	type WritingEditorDocument,
} from 'cs/editor/common/writingEditorDocument';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import type { EditorPartBaseProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import type {
	EditorViewStateKey,
	SerializedEditorViewStateEntry,
} from 'cs/workbench/browser/parts/editor/editorViewStateStore';
import { createEditorBrowserToolbarTitlebarLabels } from 'cs/workbench/browser/parts/titlebar/titlebarActions';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { IUntypedEditorInput } from 'cs/workbench/common/editor';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { IEditorResolverService } from 'cs/workbench/services/editor/common/editorResolverService';
import type { IEditorGroup, IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import type { IEditorOpenOptions, IEditorService } from 'cs/workbench/services/editor/common/editorService';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import { IStorageService, StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import type { IDisposable } from 'cs/base/common/lifecycle';
import type { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';

const EditorViewStateStorageKey = 'workbench.editor.viewState';

export type EditorPartControllerContext = {
	ui: LocaleMessages;
	viewPartProps: ViewPartProps;
	nativeHost: INativeHostService;
	dialogService: IDialogService;
	instantiationService: IInstantiationService;
	editorResolverService: IEditorResolverService;
	editorGroupsService: IEditorGroupsService;
	storageService: IStorageService;
	commandService: IWorkbenchCommandService;
	ensureEditorPartVisible: () => void;
};

export type EditorPartControllerSnapshot = {
	group: IEditorGroup;
	viewStateEntries: SerializedEditorViewStateEntry[];
	draftBody: string;
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
		labels: {
			headerAddAction: ui.editorHeaderAddAction,
			createDraft: ui.editorCreateDraft,
			createBrowser: ui.editorCreateBrowser,
			createFile: ui.editorCreateFile,
			newTab: ui.editorNewTab,
			toolbarSources: ui.agentbarToolbarSources,
			toolbarFavorite: ui.agentbarToolbarFavorite,
			toolbarArchivePage: ui.editorToolbarArchivePage,
			...createEditorBrowserToolbarTitlebarLabels(ui),
			toolbarMore: ui.agentbarToolbarMore,
			toolbarHardReload: ui.editorToolbarHardReload,
			toolbarCopyCurrentUrl: ui.editorToolbarCopyCurrentUrl,
			toolbarClearBrowsingHistory: ui.editorToolbarClearBrowsingHistory,
			toolbarClearCookies: ui.editorToolbarClearCookies,
			toolbarClearCache: ui.editorToolbarClearCache,
			toolbarAddressBar: ui.agentbarToolbarAddressBar,
			toolbarAddressPlaceholder: ui.editorToolbarAddressPlaceholder,
			browserHistoryAndFavoritesPanelTitle: ui.agentbarToolbarSources,
			browserHistoryAndFavoritesPanelRecentTitle: ui.editorToolbarSourcesRecent,
			browserHistoryAndFavoritesPanelRecentTodayTitle: ui.editorToolbarSourcesToday,
			browserHistoryAndFavoritesPanelRecentYesterdayTitle: ui.editorToolbarSourcesYesterday,
			browserHistoryAndFavoritesPanelRecentLast7DaysTitle: ui.editorToolbarSourcesLast7Days,
			browserHistoryAndFavoritesPanelRecentLast30DaysTitle: ui.editorToolbarSourcesLast30Days,
			browserHistoryAndFavoritesPanelRecentOlderTitle: ui.editorToolbarSourcesOlder,
			browserHistoryAndFavoritesPanelFavoritesTitle: ui.editorToolbarSourcesFavorites,
			browserHistoryAndFavoritesPanelEmptyState: ui.editorToolbarSourcesEmpty,
			browserHistoryAndFavoritesPanelContextOpen: ui.editorFavoriteContextOpen,
			browserHistoryAndFavoritesPanelContextOpenInNewTab: ui.editorFavoriteContextOpenInNewTab,
			browserHistoryAndFavoritesPanelContextRemoveFavorite: ui.editorFavoriteContextRemove,
			draftMode: ui.editorDraftMode,
			sourceMode: ui.editorSourceMode,
			pdfMode: ui.editorPdfMode,
			close: ui.toastClose,
			closeOthers: ui.editorTabContextCloseOthers,
			closeAll: ui.editorTabContextCloseAll,
			rename: ui.editorTabContextRename,
			editorModalConfirm: ui.editorModalConfirm,
			editorModalCancel: ui.editorModalCancel,
			expandEditor: ui.editorExpand,
			collapseEditor: ui.editorCollapse,
			emptyWorkspaceTitle: ui.editorEmptyWorkspaceTitle,
			emptyWorkspaceBody: ui.editorEmptyWorkspaceBody,
			draftBodyPlaceholder: ui.editorDraftBodyPlaceholder,
			pdfTitle: ui.editorPdfTitle,
			pdfOpenFile: ui.editorPdfOpenFile,
			renameTabTitle: ui.editorTabRenameTitle,
			renameTabLabel: ui.editorTabRenameLabel,
			status: {
				statusbarAriaLabel: ui.editorStatusbarAriaLabel,
				words: ui.editorStatusWords,
				characters: ui.editorStatusCharacters,
				paragraphs: ui.editorStatusParagraphs,
				selection: ui.editorStatusSelection,
				block: ui.editorStatusBlock,
				line: ui.editorStatusLine,
				column: ui.editorStatusColumn,
				url: ui.editorStatusUrl,
				blockFigure: ui.editorStatusFigure,
				ready: ui.statusReady,
			},
			textGroup: ui.editorRibbonText,
			formatGroup: ui.editorRibbonFormat,
			insertGroup: ui.editorRibbonInsert,
			historyGroup: ui.editorRibbonHistory,
			paragraph: ui.editorParagraph,
			heading1: ui.editorHeading1,
			heading2: ui.editorHeading2,
			heading3: ui.editorHeading3,
			bold: ui.editorBold,
			italic: ui.editorItalic,
			underline: ui.editorUnderline,
			fontFamily: ui.editorFontFamily,
			fontSize: ui.editorFontSize,
			defaultTextStyle: ui.editorDefaultTextStyle,
			alignLeft: ui.editorAlignLeft,
			alignCenter: ui.editorAlignCenter,
			alignRight: ui.editorAlignRight,
			clearInlineStyles: ui.editorClearInlineStyles,
			bulletList: ui.editorBulletList,
			orderedList: ui.editorOrderedList,
			blockquote: ui.editorBlockquote,
			undo: ui.editorUndo,
			redo: ui.editorRedo,
			insertCitation: ui.editorInsertCitation,
			insertFigure: ui.editorInsertFigure,
			insertFigureRef: ui.editorInsertFigureRef,
			citationPrompt: ui.editorCitationPrompt,
			figureUrlPrompt: ui.editorFigureUrlPrompt,
			figureCaptionPrompt: ui.editorFigureCaptionPrompt,
			figureRefPrompt: ui.editorFigureRefPrompt,
			fontFamilyPrompt: ui.editorFontFamilyPrompt,
			fontSizePrompt: ui.editorFontSizePrompt,
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
		&& previous.storageService === next.storageService
		&& previous.commandService === next.commandService
		&& previous.ensureEditorPartVisible === next.ensureEditorPartVisible
		&& previous.viewPartProps === next.viewPartProps;
}

export class EditorPartController implements IEditorService {
	declare readonly _serviceBrand: undefined;
	private context: EditorPartControllerContext;
	private readonly editorGroupsService: IEditorGroupsService;
	private readonly viewStateEntries = new Map<string, SerializedEditorViewStateEntry>();
	private readonly listeners = new Set<(reason: EditorPartChangeReason) => void>();
	private snapshot: EditorPartControllerSnapshot;
	private readonly actions: EditorPartActions;
	private readonly groupsListener: IDisposable;

	constructor(context: EditorPartControllerContext) {
		this.context = context;
		this.editorGroupsService = context.editorGroupsService;
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
			onOpenEditor: this.openEditor,
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
		if (areEditorPartControllerContextsEqual(this.context, context)) {
			return;
		}
		this.context = context;
		this.refreshSnapshot('context');
	};

	readonly openEditor = async (
		input: EditorInput | IUntypedEditorInput,
		options: IEditorOpenOptions = {},
	): Promise<EditorInput> => {
		this.context.ensureEditorPartVisible();
		const typedInput = input instanceof EditorInput
			? input
			: this.resolveEditorInput(input, options);
		return this.editorGroupsService.openEditor(typedInput, options);
	};

	readonly activateEditor = (editor: EditorInput) => {
		const match = this.editorGroupsService.findEditor(editor);
		if (!match) {
			return;
		}
		match.group.setActive(match.editor);
		this.editorGroupsService.activateGroup(match.group);
	};

	readonly closeEditor = (editor: EditorInput) => this.editorGroupsService.closeEditor(editor);

	readonly getEditors = () => this.editorGroupsService.getGroups().flatMap(group =>
		group.getEditors().map(editor => ({ groupId: group.id, editor })),
	);

	readonly getActiveGroupId = () => this.editorGroupsService.activeGroup.id;

	readonly canSaveActiveDraft = () => this.getActiveDraft()?.isDirty() ?? false;

	readonly saveActiveDraft = () => {
		const draft = this.getActiveDraft();
		if (!draft) {
			return false;
		}
		void draft.save();
		return true;
	};

	readonly getDraftBody = () => {
		const draft = this.getActiveDraft();
		return draft ? writingEditorDocumentToPlainText(draft.document) : '';
	};

	readonly getDraftDocument = () => this.getActiveDraft()?.document ?? null;

	readonly setDraftDocument = (value: WritingEditorDocument) => {
		this.getActiveDraft()?.setDocument(value);
	};

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

	private resolveEditorInput(
		input: IUntypedEditorInput,
		options: IEditorOpenOptions,
	): EditorInput {
		if (!('resource' in input) || !input.resource) {
			throw new Error('Cannot resolve an editor input without a resource.');
		}
		const resolved = this.context.editorResolverService.resolveEditor({
			resource: input.resource,
			options: options.editorOptions ?? input.options,
		});
		if (!resolved) {
			throw new Error(`No editor resolver is registered for '${input.resource.toString()}'.`);
		}
		return resolved.editor;
	}

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
		return editor ? this.closeEditor(editor) : false;
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

	private getActiveDraft(): (EditorInput & {
		readonly document: WritingEditorDocument;
		setDocument(value: WritingEditorDocument): void;
	}) | undefined {
		const active = this.editorGroupsService.activeGroup.activeEditor;
		if (!active) {
			return undefined;
		}
		const candidate = active as EditorInput & {
			readonly document?: WritingEditorDocument;
			setDocument?: (value: WritingEditorDocument) => void;
		};
		return candidate.document && candidate.setDocument
			? candidate as EditorInput & {
				readonly document: WritingEditorDocument;
				setDocument(value: WritingEditorDocument): void;
			}
			: undefined;
	}

	private createSnapshot(): EditorPartControllerSnapshot {
		const group = this.editorGroupsService.activeGroup;
		const viewStateEntries = [...this.viewStateEntries.values()];
		const draftBody = this.getDraftBody();
		return {
			group,
			viewStateEntries,
			draftBody,
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
