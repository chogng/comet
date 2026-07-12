/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import {
	createActionBarView,
	type ActionBarActionItem,
	type ActionBarItem,
} from 'cs/base/browser/ui/actionbar/actionbar';
import { ActionViewItem } from 'cs/base/browser/ui/actionbar/actionViewItems';
import {
	createDropdownMenuActionViewItem,
	type DropdownMenuActionViewItemOptions,
} from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { InputBox } from 'cs/base/browser/ui/inputbox/inputBox';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { toDisposable, type DisposableStore } from 'cs/base/common/lifecycle';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { INativeHostService } from 'cs/platform/native/common/native';
import { getEditorContentDisplayUrl } from 'cs/workbench/contrib/browserView/browser/browserUrlPresentation';
import {
	BrowserHistoryAndFavoritesPanel,
	type BrowserHistoryAndFavoritesPanelFeatures,
} from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';
import type { IBrowserViewModel } from 'cs/workbench/contrib/browserView/common/browserView';
import type { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';
import {
	BrowserEditor,
	BrowserEditorToolbarContribution,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { BrowserFavoritesFeature } from 'cs/workbench/contrib/browserView/electron-browser/features/browserFavoritesFeature';
import { BrowserHistoryFeature } from 'cs/workbench/contrib/browserView/electron-browser/features/browserHistoryFeature';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';

const BROWSER_TOOLBAR_MORE_MENU_DATA = 'browser-toolbar-more';

export class BrowserModeToolbar extends BrowserEditorToolbarContribution {
	private readonly element = $<HTMLDivElement>('div.comet-editor-mode-toolbar.comet-editor-browser-toolbar');
	private readonly toolbarRow = $<HTMLDivElement>('div.comet-editor-browser-toolbar-row');
	private readonly leadingHost = $<HTMLDivElement>('div.comet-editor-browser-toolbar-leading');
	private readonly addressHost = $<HTMLDivElement>('div.comet-editor-browser-toolbar-address-host');
	private readonly trailingHost = $<HTMLDivElement>('div.comet-editor-browser-toolbar-trailing');
	private readonly leadingActionsView = createActionBarView({
		className: 'comet-editor-browser-toolbar-actions',
		ariaRole: 'group',
	});
	private readonly trailingActionsView = createActionBarView({
		className: 'comet-editor-browser-toolbar-actions',
		ariaRole: 'group',
	});
	private readonly addressInput = new InputBox(this.addressHost, undefined, {
		className: 'comet-editor-browser-toolbar-address-input',
		value: '',
		placeholder: '',
	});
	private readonly archivePageActionViewItem: ActionViewItem;
	private readonly moreActionViewItem: ReturnType<typeof createDropdownMenuActionViewItem>;
	private readonly historyAndFavoritesPanel: BrowserHistoryAndFavoritesPanel;
	private readonly historyAndFavoritesFeatures: BrowserHistoryAndFavoritesPanelFeatures;
	private model: IBrowserViewModel | undefined;
	private isAddressInputEdited = false;

	constructor(
		editor: BrowserEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
	) {
		super(editor);
		this.historyAndFavoritesFeatures = this.requireHistoryAndFavoritesFeatures();
		this.historyAndFavoritesPanel = instantiationService.createInstance(
			BrowserHistoryAndFavoritesPanel,
			this.createHistoryAndFavoritesPanelContext(),
			this.historyAndFavoritesFeatures,
			{
				isInteractionWithin: target => this.element.contains(target),
				onDidChangeOpenState: this.handlePanelStateChange,
				onDidChangeState: this.handlePanelStateChange,
			},
		);

		this.archivePageActionViewItem = new ActionViewItem(this.createArchivePageAction());
		this.moreActionViewItem = createDropdownMenuActionViewItem(this.createMoreActionOptions());
		this.leadingHost.append(this.leadingActionsView.getElement());
		this.trailingHost.append(this.trailingActionsView.getElement());
		this.trailingActionsView.setProps({
			className: 'comet-editor-browser-toolbar-actions',
			ariaRole: 'group',
			items: [this.archivePageActionViewItem, this.moreActionViewItem],
		});
		this.addressInput.inputElement.setAttribute('spellcheck', 'false');
		this.addressInput.inputElement.addEventListener('keydown', this.handleAddressInputKeyDown);
		this.addressInput.inputElement.addEventListener('blur', this.handleAddressInputBlur);
		this._register(this.addressInput.onDidChange(() => {
			this.isAddressInputEdited = true;
		}));
		this._register(toDisposable(this.localeService.subscribe(() => this.render())));

		this.toolbarRow.append(this.leadingHost, this.addressHost, this.trailingHost);
		this.element.append(this.toolbarRow);
		this.render();
	}

	override getEditorToolbarElement(): HTMLElement {
		return this.element;
	}

	override focusPrimaryInput(): void {
		this.addressInput.focus();
		this.addressInput.select();
	}

	override onContainerCreated(): void {
		this.historyAndFavoritesPanel.mountTo(this.editor.getElement());
	}

	override prerenderInput(_input: BrowserEditorInput): void {
		this.model = undefined;
		this.isAddressInputEdited = false;
		this.moreActionViewItem.hide();
		this.historyAndFavoritesPanel.close();
		this.render();
	}

	protected override onModelAttached(
		model: IBrowserViewModel,
		store: DisposableStore,
	): void {
		this.model = model;
		store.add(model.onDidNavigate(this.handleModelStateChange));
		store.add(model.onDidChangeLoadingState(this.handleModelStateChange));
		store.add(model.onDidChangeTitle(this.handleModelStateChange));
		store.add(model.onDidChangeFavicon(this.handleModelStateChange));
		this.render();
	}

	override onModelDetached(): void {
		this.model = undefined;
		this.isAddressInputEdited = false;
		this.moreActionViewItem.hide();
		this.historyAndFavoritesPanel.close();
		this.render();
	}

	override onPaneVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this.moreActionViewItem.hide();
			this.historyAndFavoritesPanel.close();
		}
	}

	override dispose(): void {
		this.moreActionViewItem.hide();
		this.historyAndFavoritesPanel.close();
		this.historyAndFavoritesPanel.dispose();
		this.addressInput.inputElement.removeEventListener('keydown', this.handleAddressInputKeyDown);
		this.addressInput.inputElement.removeEventListener('blur', this.handleAddressInputBlur);
		this.addressInput.dispose();
		this.leadingActionsView.dispose();
		this.trailingActionsView.dispose();
		this.element.replaceChildren();
		super.dispose();
	}

	private render(): void {
		this.historyAndFavoritesPanel.setContext(this.createHistoryAndFavoritesPanelContext());
		this.updateLeadingActions();
		this.archivePageActionViewItem.setItem(this.createArchivePageAction());
		this.moreActionViewItem.setOptions(this.createMoreActionOptions());
		this.syncAddressInputFromModel();

		const ui = this.ui;
		this.addressInput.inputElement.setAttribute('aria-label', ui.agentbarToolbarAddressBar);
		this.addressInput.setPlaceHolder(ui.editorToolbarAddressPlaceholder);
	}

	private updateLeadingActions(): void {
		this.leadingActionsView.setProps({
			className: 'comet-editor-browser-toolbar-actions',
			ariaRole: 'group',
			items: this.createLeadingItems(),
		});
	}

	private syncAddressInputFromModel(force = false): void {
		const displayUrl = getEditorContentDisplayUrl(this.model?.url ?? '');
		const canSync = force || !this.addressInput.hasFocus() || !this.isAddressInputEdited;
		if (canSync && this.addressInput.value !== displayUrl) {
			this.addressInput.value = displayUrl;
		}
	}

	private createLeadingItems(): ActionBarItem[] {
		const ui = this.ui;
		const model = this.model;
		const browserUrl = model?.url ?? '';
		const isCurrentUrlFavorited = this.historyAndFavoritesFeatures.favorites.isFavorite(browserUrl);
		return [
			{
				label: ui.agentbarToolbarSources,
				title: ui.agentbarToolbarSources,
				mode: 'icon',
				buttonClassName: 'comet-editor-browser-toolbar-btn',
				content: createLxIcon('list-unordered'),
				active: this.historyAndFavoritesPanel.getIsOpen(),
				buttonAttributes: this.historyAndFavoritesPanel.getToggleButtonAttributes(),
				onClick: this.handleHistoryAndFavoritesButtonClick,
			},
			{
				label: ui.titlebarBack,
				title: ui.titlebarBack,
				mode: 'icon',
				buttonClassName: 'comet-editor-browser-toolbar-btn',
				content: createLxIcon('arrow-left'),
				disabled: !model?.canGoBack,
				onClick: () => this.executeBrowserCommand(BrowserViewCommandId.GoBack),
			},
			{
				label: ui.titlebarForward,
				title: ui.titlebarForward,
				mode: 'icon',
				buttonClassName: 'comet-editor-browser-toolbar-btn',
				content: createLxIcon('arrow-right'),
				disabled: !model?.canGoForward,
				onClick: () => this.executeBrowserCommand(BrowserViewCommandId.GoForward),
			},
			{
				label: ui.titlebarRefresh,
				title: ui.titlebarRefresh,
				mode: 'icon',
				buttonClassName: 'comet-editor-browser-toolbar-btn',
				content: createLxIcon('refresh'),
				disabled: !browserUrl,
				onClick: () => this.executeBrowserCommand(BrowserViewCommandId.Reload),
			},
			{
				label: ui.agentbarToolbarFavorite,
				title: ui.agentbarToolbarFavorite,
				mode: 'icon',
				buttonClassName: 'comet-editor-browser-toolbar-btn',
				content: createLxIcon(isCurrentUrlFavorited ? 'favorite-filled' : 'favorite'),
				disabled: !browserUrl,
				buttonAttributes: { 'aria-pressed': String(isCurrentUrlFavorited) },
				onClick: this.handleFavoriteButtonClick,
			},
		];
	}

	private createArchivePageAction(): ActionBarActionItem {
		return {
			label: this.ui.editorToolbarArchivePage,
			title: this.ui.editorToolbarArchivePage,
			mode: 'icon',
			buttonClassName: 'comet-editor-browser-toolbar-btn',
			content: createLxIcon('download-2'),
			disabled: !this.model?.url || !this.nativeHostService.canInvoke(),
			onClick: () => this.executeBrowserCommand(BrowserViewCommandId.ArchivePage),
		};
	}

	private createMoreActionOptions(): DropdownMenuActionViewItemOptions {
		const ui = this.ui;
		const hasUrl = Boolean(this.model?.url);
		const desktopRuntime = this.nativeHostService.canInvoke();
		return {
			contextMenuService: this.contextMenuService,
			contextViewProvider: this.contextViewService,
			label: ui.agentbarToolbarMore,
			title: ui.agentbarToolbarMore,
			mode: 'icon',
			buttonClassName: 'comet-editor-browser-toolbar-btn',
			content: createLxIcon('more'),
			overlayAlignment: 'end',
			menuData: BROWSER_TOOLBAR_MORE_MENU_DATA,
			menu: [
				{
					label: ui.editorToolbarHardReload,
					disabled: !hasUrl,
					onClick: () => this.executeBrowserCommand(BrowserViewCommandId.HardReload),
				},
				{
					label: ui.editorToolbarCopyCurrentUrl,
					disabled: !hasUrl,
					onClick: () => this.executeBrowserCommand(BrowserViewCommandId.CopyCurrentUrl),
				},
				{
					label: ui.editorToolbarClearBrowsingHistory,
					disabled: this.historyAndFavoritesFeatures.history.entries.length === 0,
					onClick: () => this.executeBrowserCommand(BrowserViewCommandId.ClearBrowsingHistory),
				},
				{
					label: ui.editorToolbarClearCookies,
					disabled: !desktopRuntime,
					onClick: () => this.executeBrowserCommand(BrowserViewCommandId.ClearCookies),
				},
				{
					label: ui.editorToolbarClearCache,
					disabled: !desktopRuntime,
					onClick: () => this.executeBrowserCommand(BrowserViewCommandId.ClearCache),
				},
			],
		};
	}

	private createHistoryAndFavoritesPanelContext() {
		const ui = this.ui;
		return {
			browserUrl: this.model?.url ?? '',
			browserIsLoading: this.model?.loading ?? false,
			labels: {
				title: ui.agentbarToolbarSources,
				recentTodayTitle: ui.editorToolbarSourcesToday,
				recentYesterdayTitle: ui.editorToolbarSourcesYesterday,
				recentLast7DaysTitle: ui.editorToolbarSourcesLast7Days,
				recentLast30DaysTitle: ui.editorToolbarSourcesLast30Days,
				recentOlderTitle: ui.editorToolbarSourcesOlder,
				favoritesTitle: ui.editorToolbarSourcesFavorites,
				emptyState: ui.editorToolbarSourcesEmpty,
				search: ui.editorToolbarSourcesSearch,
				noMatches: ui.editorToolbarSourcesNoMatches,
				contextOpen: ui.editorFavoriteContextOpen,
				contextOpenInNewTab: ui.editorFavoriteContextOpenInNewTab,
				contextRemoveFavorite: ui.editorFavoriteContextRemove,
				deleteHistoryEntry: ui.editorToolbarDeleteHistoryEntry,
			},
			onNavigateToUrl: (url: string) => {
				void this.editor.navigate(url);
			},
		};
	}

	private requireHistoryAndFavoritesFeatures(): BrowserHistoryAndFavoritesPanelFeatures {
		const history = this.editor.getContribution(BrowserHistoryFeature);
		const favorites = this.editor.getContribution(BrowserFavoritesFeature);
		if (!history || !favorites) {
			throw new Error('The Browser toolbar requires history and favorites contributions.');
		}
		return { history, favorites };
	}

	private executeBrowserCommand(commandId: BrowserViewCommandId): void {
		void this.commandService.executeCommand(commandId, this.editor);
	}

	private readonly handleModelStateChange = () => {
		this.render();
	};

	private readonly handlePanelStateChange = () => {
		this.updateLeadingActions();
		this.moreActionViewItem.setOptions(this.createMoreActionOptions());
	};

	private readonly handleAddressInputKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Enter') {
			this.isAddressInputEdited = false;
			void this.editor.navigate(this.addressInput.value);
			return;
		}
		if (event.key === 'Escape') {
			event.preventDefault();
			this.isAddressInputEdited = false;
			this.syncAddressInputFromModel(true);
			this.addressInput.select();
		}
	};

	private readonly handleAddressInputBlur = () => {
		this.isAddressInputEdited = false;
		this.syncAddressInputFromModel(true);
	};

	private readonly handleHistoryAndFavoritesButtonClick = () => {
		this.historyAndFavoritesPanel.toggleOpen();
		this.updateLeadingActions();
	};

	private readonly handleFavoriteButtonClick = () => {
		if (!this.model?.url) {
			throw new Error('The Browser toolbar has no current URL to favorite.');
		}
		this.executeBrowserCommand(BrowserViewCommandId.ToggleFavorite);
	};

	private get ui() {
		return this.languageService.getLocaleMessages(this.localeService.getLocale());
	}
}

BrowserEditor.registerContribution(BrowserModeToolbar);
