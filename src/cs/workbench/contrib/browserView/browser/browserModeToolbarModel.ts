/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { LocaleMessages } from 'language/locales';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { BrowserHistoryAndFavoritesPanel } from 'cs/workbench/contrib/browserView/browser/browserHistoryAndFavoritesPanel';
import type { EditorModeToolbarContributionContext } from 'cs/workbench/contrib/browserView/browser/browserModeToolbarTypes';
import { Verbosity } from 'cs/workbench/common/editor';

type EditorModeToolbarSourceProps = {
  activeTab: EditorInput | null;
	activePaneModeId: string | null;
  ui: LocaleMessages;
  viewPartProps: {
    browserUrl: string;
    browserPageTitle?: string;
    browserFaviconUrl?: string;
    electronRuntime: boolean;
  };
	browserCanGoBack: boolean;
	browserCanGoForward: boolean;
  onOpenAddressBarSourceMenu: () => void;
  onToolbarNavigateBack: () => void;
  onToolbarNavigateForward: () => void;
  onToolbarNavigateRefresh: () => void;
  onToolbarArchiveCurrentPage: () => void | Promise<void>;
  onToolbarExportDocx?: () => void | Promise<void>;
  onToolbarHardReload: () => void;
  onToolbarCopyCurrentUrl: () => void | Promise<void>;
  onToolbarClearBrowsingHistory: () => void;
  onToolbarClearCookies: () => void | Promise<void>;
  onToolbarClearCache: () => void | Promise<void>;
  onToolbarNavigateToUrl: (url: string) => void;
  browserHistoryAndFavoritesPanel?: BrowserHistoryAndFavoritesPanel | null;
};

export type EditorModeToolbarContext = EditorModeToolbarContributionContext;

type ResolvedActiveBrowserMetadata = {
  browserUrl: string;
  browserPageTitle: string;
  browserFaviconUrl: string;
  browserTabTitle: string;
  hasActiveBrowserTab: boolean;
};

function normalizeBrowserMetadataValue(value: unknown) {
  return String(value ?? '').trim();
}

export function resolveActiveBrowserMetadata(
  props: Pick<EditorModeToolbarSourceProps, 'activeTab' | 'activePaneModeId' | 'viewPartProps'>,
): ResolvedActiveBrowserMetadata {
  const viewPartBrowserUrl = normalizeBrowserMetadataValue(props.viewPartProps.browserUrl);
  const viewPartBrowserPageTitle = normalizeBrowserMetadataValue(
    props.viewPartProps.browserPageTitle,
  );
  const viewPartBrowserFaviconUrl = normalizeBrowserMetadataValue(
    props.viewPartProps.browserFaviconUrl,
  );

	if (!props.activeTab || props.activePaneModeId !== 'browser') {
    return {
      browserUrl: viewPartBrowserUrl,
      browserPageTitle: viewPartBrowserPageTitle,
      browserFaviconUrl: viewPartBrowserFaviconUrl,
      browserTabTitle: '',
      hasActiveBrowserTab: false,
    };
  }

  const activeTabBrowserUrl = normalizeBrowserMetadataValue(
    props.activeTab.getDescription(Verbosity.LONG),
  );
  const browserUrl = viewPartBrowserUrl || activeTabBrowserUrl;
  const activeTabTitle = normalizeBrowserMetadataValue(props.activeTab.getName());
  const derivedTitle = normalizeBrowserMetadataValue(
    props.activeTab.getDescription(),
  );
  const activeTabFaviconUrl = normalizeBrowserMetadataValue(
    props.activeTab.getIcon()?.toString(),
  );
  const isViewPartUrlAligned = viewPartBrowserUrl === activeTabBrowserUrl;
  const isUsingViewPartUrl = Boolean(viewPartBrowserUrl);
  const fallbackPageTitle =
    activeTabTitle && activeTabTitle !== derivedTitle
      ? activeTabTitle
      : '';

  return {
    browserUrl,
    browserPageTitle: isUsingViewPartUrl
      ? viewPartBrowserPageTitle || (isViewPartUrlAligned ? fallbackPageTitle : '')
      : fallbackPageTitle,
    browserFaviconUrl:
      (isUsingViewPartUrl ? viewPartBrowserFaviconUrl : '') ||
      (isViewPartUrlAligned ? activeTabFaviconUrl : ''),
    browserTabTitle: activeTabTitle,
    hasActiveBrowserTab: true,
  };
}

export function createEditorModeToolbarContext(
  props: EditorModeToolbarSourceProps,
): EditorModeToolbarContext {
	const mode = props.activePaneModeId === 'browser' ? 'browser' : null;
  const activeBrowserMetadata = resolveActiveBrowserMetadata(props);
	const { ui } = props;

  return {
    mode,
    browserUrl: activeBrowserMetadata.browserUrl,
    browserPageTitle: activeBrowserMetadata.browserPageTitle,
    browserFaviconUrl: activeBrowserMetadata.browserFaviconUrl,
    browserTabTitle: activeBrowserMetadata.browserTabTitle,
	browserCanGoBack: props.browserCanGoBack,
	browserCanGoForward: props.browserCanGoForward,
    electronRuntime: props.viewPartProps.electronRuntime,
    labels: {
			toolbarSources: ui.agentbarToolbarSources,
			toolbarBack: ui.titlebarBack,
			toolbarForward: ui.titlebarForward,
			toolbarRefresh: ui.titlebarRefresh,
			toolbarFavorite: ui.agentbarToolbarFavorite,
			toolbarArchivePage: ui.editorToolbarArchivePage,
			toolbarExportDocx: ui.titlebarExportDocx,
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
    },
    onOpenSources: props.onOpenAddressBarSourceMenu,
    onNavigateBack: props.onToolbarNavigateBack,
    onNavigateForward: props.onToolbarNavigateForward,
    onNavigateRefresh: props.onToolbarNavigateRefresh,
    onArchiveCurrentPage: props.onToolbarArchiveCurrentPage,
    onExportDocx: props.onToolbarExportDocx ?? (() => {}),
    onHardReload: props.onToolbarHardReload,
    onCopyCurrentUrl: props.onToolbarCopyCurrentUrl,
    onClearBrowsingHistory: props.onToolbarClearBrowsingHistory,
    onClearCookies: props.onToolbarClearCookies,
    onClearCache: props.onToolbarClearCache,
    onNavigateToUrl: props.onToolbarNavigateToUrl,
    browserHistoryAndFavoritesPanel: props.browserHistoryAndFavoritesPanel ?? null,
  };
}
