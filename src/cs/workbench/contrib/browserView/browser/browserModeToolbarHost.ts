/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { BrowserHistoryAndFavoritesPanel } from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';
import { createEditorBrowserModeToolbarContribution } from 'cs/workbench/contrib/browserView/browser/browserModeToolbarContribution';
import { createEditorModeToolbarContext, resolveActiveBrowserMetadata } from 'cs/workbench/contrib/browserView/browser/browserModeToolbarModel';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import { Verbosity } from 'cs/workbench/common/editor';
import { MutableDisposable } from 'cs/base/common/lifecycle';
import type { EditorModeToolbarHostContext } from 'cs/workbench/browser/parts/editor/editorModeToolbarRegistry';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { BrowserHistoryAndFavoritesPanelFeatures } from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';
import { IBrowserEditorToolbarService } from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';
import type { Event } from 'cs/base/common/event';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IWorkbenchCommandService } from 'cs/workbench/services/commands/common/commandService';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import { BrowserEditorInput } from 'cs/workbench/contrib/browserView/common/browserEditorInput';

export interface BrowserEditorModeToolbarState {
	readonly tabId: string;
	readonly url: string;
	readonly title: string;
	readonly favicon: string | undefined;
	readonly loading: boolean;
	readonly canGoBack: boolean;
	readonly canGoForward: boolean;
}

export interface BrowserEditorModeToolbarPane {
	getHistoryAndFavoritesFeatures(): BrowserHistoryAndFavoritesPanelFeatures | undefined;
	readonly onDidChangeBrowserState: Event<BrowserEditorModeToolbarState>;
	readonly browserState: BrowserEditorModeToolbarState | undefined;
}

function isBrowserEditorModeToolbarPane(pane: AnyEditorPane | null): pane is AnyEditorPane & BrowserEditorModeToolbarPane {
	const candidate = pane as (Partial<BrowserEditorModeToolbarPane> & AnyEditorPane) | null;
	return Boolean(
		candidate
		&& typeof candidate.getHistoryAndFavoritesFeatures === 'function'
		&& typeof candidate.onDidChangeBrowserState === 'function',
	);
}

export class EditorModeToolbarHost {
	private context: EditorModeToolbarHostContext;
	private readonly browserStateByTabId = new Map<string, BrowserEditorModeToolbarState>();
	private readonly browserHistoryAndFavoritesPanel: BrowserHistoryAndFavoritesPanel;
	private readonly browserToolbar: ReturnType<typeof createEditorBrowserModeToolbarContribution>;
	private readonly browserStateListener = new MutableDisposable();

	constructor(
		context: EditorModeToolbarHostContext,
		dropdownServices: DropdownContextServices,
		@IBrowserEditorToolbarService private readonly toolbarService: IBrowserEditorToolbarService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IWorkbenchCommandService private readonly commandService: IWorkbenchCommandService,
	) {
		this.context = context;
		this.browserHistoryAndFavoritesPanel = this.instantiationService.createInstance(
			BrowserHistoryAndFavoritesPanel,
			this.createBrowserHistoryAndFavoritesPanelContext(),
			{ isInteractionWithin: target => context.toolbarElement.contains(target) },
		);
		this.browserToolbar = createEditorBrowserModeToolbarContribution(
			this.createBrowserToolbarContext(),
			dropdownServices,
		);
		this.mountBrowserPanel();
	}

	getElement(): HTMLElement {
		return this.browserToolbar.getElement();
	}

	setContext(context: EditorModeToolbarHostContext): void {
		this.context = context;
		this.pruneBrowserStates();
		const browserPane = isBrowserEditorModeToolbarPane(context.activePane)
			? context.activePane
			: undefined;
		this.browserHistoryAndFavoritesPanel.setContext(this.createBrowserHistoryAndFavoritesPanelContext());
		this.browserHistoryAndFavoritesPanel.setFeatures(browserPane?.getHistoryAndFavoritesFeatures());
		this.browserStateListener.clear();
		if (browserPane) {
			this.browserStateListener.value = browserPane.onDidChangeBrowserState(state => this.updateBrowserState(state));
			const state = browserPane.browserState;
			if (state) {
				this.updateBrowserState(state);
			}
		}
		this.browserToolbar.setContext(this.createBrowserToolbarContext());
		this.mountBrowserPanel();
	}

	private updateBrowserState(browserState: BrowserEditorModeToolbarState): void {
		const previous = this.browserStateByTabId.get(browserState.tabId);
		if (
			previous?.url === browserState.url &&
			previous.title === browserState.title &&
			previous.favicon === browserState.favicon &&
			previous.loading === browserState.loading &&
			previous.canGoBack === browserState.canGoBack &&
			previous.canGoForward === browserState.canGoForward
		) {
			return;
		}
		this.browserStateByTabId.set(browserState.tabId, browserState);
		this.browserHistoryAndFavoritesPanel.setContext(this.createBrowserHistoryAndFavoritesPanelContext());
		this.browserToolbar.setContext(this.createBrowserToolbarContext());
	}

	focusPrimaryInput(): boolean {
		if (this.context.activePaneModeId !== 'browser') {
			return false;
		}
		this.browserToolbar.focusPrimaryInput();
		return true;
	}

	dispose(): void {
		this.browserStateListener.dispose();
		this.browserHistoryAndFavoritesPanel.dispose();
		this.browserToolbar.dispose();
		this.browserStateByTabId.clear();
	}

	private createBrowserToolbarContext() {
		const actions = this.toolbarService.actions;
		return createEditorModeToolbarContext({
			...this.context,
			viewPartProps: this.getBrowserViewPartProps(),
			browserCanGoBack: this.getActiveBrowserState()?.canGoBack ?? false,
			browserCanGoForward: this.getActiveBrowserState()?.canGoForward ?? false,
			onOpenAddressBarSourceMenu: actions.onOpenSources,
			onToolbarArchiveCurrentPage: actions.onArchiveCurrentPage,
			onToolbarExportDocx: actions.onExportDocx,
			onToolbarCopyCurrentUrl: actions.onCopyCurrentUrl,
			onToolbarClearBrowsingHistory: actions.onClearBrowsingHistory,
			onToolbarClearCookies: actions.onClearCookies,
			onToolbarClearCache: actions.onClearCache,
			onToolbarNavigateBack: this.navigateBrowserBack,
			onToolbarNavigateForward: this.navigateBrowserForward,
			onToolbarNavigateRefresh: this.reloadBrowser,
			onToolbarHardReload: this.hardReloadBrowser,
			onToolbarNavigateToUrl: this.navigateBrowserToUrl,
			browserHistoryAndFavoritesPanel: this.browserHistoryAndFavoritesPanel,
		});
	}

	private createBrowserHistoryAndFavoritesPanelContext() {
		const viewPartProps = this.getBrowserViewPartProps();
		const activeBrowserMetadata = resolveActiveBrowserMetadata({
			activeTab: this.context.activeTab,
			activePaneModeId: this.context.activePaneModeId,
			viewPartProps,
		});
		return {
			browserUrl: activeBrowserMetadata.hasActiveBrowserTab ? activeBrowserMetadata.browserUrl : '',
			browserPageTitle: activeBrowserMetadata.hasActiveBrowserTab ? activeBrowserMetadata.browserPageTitle : '',
			browserFaviconUrl: activeBrowserMetadata.hasActiveBrowserTab ? activeBrowserMetadata.browserFaviconUrl : '',
			browserIsLoading: activeBrowserMetadata.hasActiveBrowserTab ? Boolean(viewPartProps.browserIsLoading) : false,
			browserTabTitle: activeBrowserMetadata.hasActiveBrowserTab ? activeBrowserMetadata.browserTabTitle : '',
			labels: {
				title: this.context.ui.agentbarToolbarSources,
				recentTitle: this.context.ui.editorToolbarSourcesRecent,
				recentTodayTitle: this.context.ui.editorToolbarSourcesToday,
				recentYesterdayTitle: this.context.ui.editorToolbarSourcesYesterday,
				recentLast7DaysTitle: this.context.ui.editorToolbarSourcesLast7Days,
				recentLast30DaysTitle: this.context.ui.editorToolbarSourcesLast30Days,
				recentOlderTitle: this.context.ui.editorToolbarSourcesOlder,
				favoritesTitle: this.context.ui.editorToolbarSourcesFavorites,
				emptyState: this.context.ui.editorToolbarSourcesEmpty,
				contextOpen: this.context.ui.editorFavoriteContextOpen,
				contextOpenInNewTab: this.context.ui.editorFavoriteContextOpenInNewTab,
				contextRemoveFavorite: this.context.ui.editorFavoriteContextRemove,
			},
			onNavigateToUrl: this.navigateBrowserToUrl,
		};
	}

	private getBrowserViewPartProps(): ViewPartProps {
		const activeEditor = this.context.activeTab;
		const browserState = this.getActiveBrowserState();
		return {
			...this.context.viewPartProps,
			browserUrl: browserState?.url ?? activeEditor?.getDescription(Verbosity.LONG) ?? '',
			browserPageTitle: browserState?.title ?? '',
			browserFaviconUrl: browserState?.favicon ?? '',
			browserIsLoading: browserState?.loading ?? false,
		};
	}

	private getActiveBrowserState(): BrowserEditorModeToolbarState | undefined {
		const activeEditorId = this.context.activeTab
			? getEditorInputId(this.context.activeTab)
			: undefined;
		return activeEditorId ? this.browserStateByTabId.get(activeEditorId) : undefined;
	}

	private getActiveBrowserInput(): BrowserEditorInput {
		if (!(this.context.activeTab instanceof BrowserEditorInput)) {
			throw new Error('The active editor input is not a Browser editor input.');
		}
		return this.context.activeTab;
	}

	private getActiveBrowserCommandTarget(): AnyEditorPane {
		if (!this.context.activePane || this.context.activePaneModeId !== 'browser') {
			throw new Error('The active editor pane is not a Browser editor.');
		}
		return this.context.activePane;
	}

	private readonly navigateBrowserToUrl = (url: string) => this.getActiveBrowserInput().navigate(url);
	private readonly navigateBrowserBack = () => void this.commandService.executeCommand(
		BrowserViewCommandId.GoBack,
		this.getActiveBrowserCommandTarget(),
	);
	private readonly navigateBrowserForward = () => void this.commandService.executeCommand(
		BrowserViewCommandId.GoForward,
		this.getActiveBrowserCommandTarget(),
	);
	private readonly reloadBrowser = () => void this.commandService.executeCommand(
		BrowserViewCommandId.Reload,
		this.getActiveBrowserCommandTarget(),
	);
	private readonly hardReloadBrowser = () => void this.commandService.executeCommand(
		BrowserViewCommandId.HardReload,
		this.getActiveBrowserCommandTarget(),
	);

	private mountBrowserPanel(): void {
		if (this.context.activePaneModeId !== 'browser') {
			this.browserHistoryAndFavoritesPanel.setFeatures(undefined);
			this.browserHistoryAndFavoritesPanel.close();
			this.browserHistoryAndFavoritesPanel.mountTo(null);
			return;
		}
		const panelHost = this.context.contentElement.querySelector('.browser-root');
		this.browserHistoryAndFavoritesPanel.mountTo(panelHost instanceof HTMLElement ? panelHost : null);
	}

	private pruneBrowserStates(): void {
		const activeTabId = this.context.activeTab ? getEditorInputId(this.context.activeTab) : undefined;
		for (const tabId of this.browserStateByTabId.keys()) {
			if (tabId !== activeTabId) {
				this.browserStateByTabId.delete(tabId);
			}
		}
	}
}

export function createEditorModeToolbarHost(
	context: EditorModeToolbarHostContext,
	dropdownServices: DropdownContextServices,
) {
	return context.instantiationService.createInstance(
		EditorModeToolbarHost,
		context,
		dropdownServices,
	);
}
