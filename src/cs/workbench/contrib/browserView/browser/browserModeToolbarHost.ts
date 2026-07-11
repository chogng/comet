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
import { MutableDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { EditorModeToolbarHostContext } from 'cs/workbench/browser/parts/editor/editorModeToolbarRegistry';
import type { AnyEditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { BrowserHistoryAndFavoritesPanelFeatures } from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';
import { IBrowserEditorToolbarService } from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';

export interface BrowserEditorModeToolbarState {
	readonly tabId: string;
	readonly url: string;
	readonly title: string;
	readonly favicon: string | undefined;
	readonly loading: boolean;
}

export interface BrowserEditorModeToolbarPaneAdapter {
	supportsPane(pane: AnyEditorPane | null): boolean;
	getState(pane: AnyEditorPane): BrowserEditorModeToolbarState | undefined;
	onDidChangeState(
		pane: AnyEditorPane,
		listener: (state: BrowserEditorModeToolbarState) => void,
	): IDisposable;
	getHistoryAndFavoritesFeatures(pane: AnyEditorPane): BrowserHistoryAndFavoritesPanelFeatures | undefined;
	navigate(pane: AnyEditorPane, url: string): void | Promise<void>;
	goBack(pane: AnyEditorPane): void | Promise<void>;
	goForward(pane: AnyEditorPane): void | Promise<void>;
	reload(pane: AnyEditorPane, hard?: boolean): void | Promise<void>;
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
		private readonly paneAdapter: BrowserEditorModeToolbarPaneAdapter,
		@IBrowserEditorToolbarService private readonly toolbarService: IBrowserEditorToolbarService,
	) {
		this.context = context;
		this.browserHistoryAndFavoritesPanel = new BrowserHistoryAndFavoritesPanel(
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
		this.browserHistoryAndFavoritesPanel.setContext(this.createBrowserHistoryAndFavoritesPanelContext());
		this.browserHistoryAndFavoritesPanel.setFeatures(context.activePane && this.paneAdapter.supportsPane(context.activePane)
			? this.paneAdapter.getHistoryAndFavoritesFeatures(context.activePane)
			: undefined);
		this.browserStateListener.clear();
		if (context.activePane && this.paneAdapter.supportsPane(context.activePane)) {
			this.browserStateListener.value = this.paneAdapter.onDidChangeState(
				context.activePane,
				state => this.updateBrowserState(state),
			);
			const state = this.paneAdapter.getState(context.activePane);
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
			previous.loading === browserState.loading
		) {
			return;
		}
		this.browserStateByTabId.set(browserState.tabId, browserState);
		this.browserHistoryAndFavoritesPanel.setContext(this.createBrowserHistoryAndFavoritesPanelContext());
		this.browserToolbar.setContext(this.createBrowserToolbarContext());
	}

	focusPrimaryInput(): boolean {
		if (this.context.activePaneId !== 'browser') {
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
			activePaneId: this.context.activePaneId,
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
			onOpenEditor: this.context.onOpenEditor,
		};
	}

	private getBrowserViewPartProps(): ViewPartProps {
		const activeEditor = this.context.activeTab;
		const activeEditorId = activeEditor ? getEditorInputId(activeEditor) : undefined;
		const browserState = activeEditorId ? this.browserStateByTabId.get(activeEditorId) : undefined;
		return {
			...this.context.viewPartProps,
			browserUrl: browserState?.url ?? activeEditor?.getDescription(Verbosity.LONG) ?? '',
			browserPageTitle: browserState?.title ?? '',
			browserFaviconUrl: browserState?.favicon ?? '',
			browserIsLoading: browserState?.loading ?? false,
		};
	}

	private getActiveBrowserPane() {
		if (!this.context.activePane || !this.paneAdapter.supportsPane(this.context.activePane)) {
			throw new Error('The active editor pane is not a Browser editor.');
		}
		return this.context.activePane;
	}

	private readonly navigateBrowserToUrl = (url: string) => void this.paneAdapter.navigate(this.getActiveBrowserPane(), url);
	private readonly navigateBrowserBack = () => void this.paneAdapter.goBack(this.getActiveBrowserPane());
	private readonly navigateBrowserForward = () => void this.paneAdapter.goForward(this.getActiveBrowserPane());
	private readonly reloadBrowser = () => void this.paneAdapter.reload(this.getActiveBrowserPane());
	private readonly hardReloadBrowser = () => void this.paneAdapter.reload(this.getActiveBrowserPane(), true);

	private mountBrowserPanel(): void {
		if (this.context.activePaneId !== 'browser') {
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
	paneAdapter: BrowserEditorModeToolbarPaneAdapter,
) {
	return context.instantiationService.createInstance(
		EditorModeToolbarHost,
		context,
		dropdownServices,
		paneAdapter,
	);
}
