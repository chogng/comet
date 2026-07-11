import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import { BrowserHistoryAndFavoritesPanel } from 'cs/workbench/browser/parts/editor/browserHistoryAndFavoritesPanel';
import { createEditorBrowserModeToolbarContribution } from 'cs/workbench/browser/parts/editor/editorBrowserModeToolbarContribution';
import { createEditorModeToolbarContext, resolveActiveBrowserMetadata } from 'cs/workbench/browser/parts/editor/editorModeToolbarModel';
import { isBrowserEditorPane } from 'cs/workbench/contrib/browserView/browser/browserEditorPane';
import type { BrowserEditorPaneState } from 'cs/workbench/contrib/browserView/browser/browserEditorPane';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import { Verbosity } from 'cs/workbench/common/editor';
import { MutableDisposable } from 'cs/base/common/lifecycle';
import type { EditorModeToolbarHostContext } from 'cs/workbench/browser/parts/editor/editorModeToolbarRegistry';

export class EditorModeToolbarHost {
	private context: EditorModeToolbarHostContext;
	private readonly browserStateByTabId = new Map<string, BrowserEditorPaneState>();
	private readonly browserHistoryAndFavoritesPanel: BrowserHistoryAndFavoritesPanel;
	private readonly browserToolbar: ReturnType<typeof createEditorBrowserModeToolbarContribution>;
	private readonly browserStateListener = new MutableDisposable();

	constructor(
		context: EditorModeToolbarHostContext,
		dropdownServices: DropdownContextServices,
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
		this.browserHistoryAndFavoritesPanel.setFeatures(
			isBrowserEditorPane(context.activePane)
				? context.activePane.getHistoryAndFavoritesFeatures()
				: undefined,
		);
		this.browserStateListener.clear();
		if (isBrowserEditorPane(context.activePane)) {
			this.browserStateListener.value = context.activePane.onDidChangeBrowserState(
				state => this.updateBrowserState(state),
			);
			if (context.activePane.browserState) {
				this.updateBrowserState(context.activePane.browserState);
			}
		}
		this.browserToolbar.setContext(this.createBrowserToolbarContext());
		this.mountBrowserPanel();
	}

	private updateBrowserState(browserState: BrowserEditorPaneState): void {
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
		return createEditorModeToolbarContext({
			...this.context,
			viewPartProps: this.getBrowserViewPartProps(),
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
				title: this.context.labels.browserHistoryAndFavoritesPanelTitle,
				recentTitle: this.context.labels.browserHistoryAndFavoritesPanelRecentTitle,
				recentTodayTitle: this.context.labels.browserHistoryAndFavoritesPanelRecentTodayTitle,
				recentYesterdayTitle: this.context.labels.browserHistoryAndFavoritesPanelRecentYesterdayTitle,
				recentLast7DaysTitle: this.context.labels.browserHistoryAndFavoritesPanelRecentLast7DaysTitle,
				recentLast30DaysTitle: this.context.labels.browserHistoryAndFavoritesPanelRecentLast30DaysTitle,
				recentOlderTitle: this.context.labels.browserHistoryAndFavoritesPanelRecentOlderTitle,
				favoritesTitle: this.context.labels.browserHistoryAndFavoritesPanelFavoritesTitle,
				emptyState: this.context.labels.browserHistoryAndFavoritesPanelEmptyState,
				contextOpen: this.context.labels.browserHistoryAndFavoritesPanelContextOpen,
				contextOpenInNewTab: this.context.labels.browserHistoryAndFavoritesPanelContextOpenInNewTab,
				contextRemoveFavorite: this.context.labels.browserHistoryAndFavoritesPanelContextRemoveFavorite,
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
		if (!isBrowserEditorPane(this.context.activePane)) {
			throw new Error('The active editor pane is not a Browser editor.');
		}
		return this.context.activePane;
	}

	private readonly navigateBrowserToUrl = (url: string) => void this.getActiveBrowserPane().navigate(url);
	private readonly navigateBrowserBack = () => void this.getActiveBrowserPane().goBack();
	private readonly navigateBrowserForward = () => void this.getActiveBrowserPane().goForward();
	private readonly reloadBrowser = () => void this.getActiveBrowserPane().reload();
	private readonly hardReloadBrowser = () => void this.getActiveBrowserPane().reload(true);

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
) {
	return new EditorModeToolbarHost(context, dropdownServices);
}
