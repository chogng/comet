import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { BrowserHistoryAndFavoritesPanel } from 'cs/workbench/browser/parts/editor/browserHistoryAndFavoritesPanel';
import type { EditorModeToolbarContributionContext } from 'cs/workbench/browser/parts/editor/editorModeToolbarContribution';
import { Verbosity } from 'cs/workbench/common/editor';

type EditorModeToolbarSourceProps = {
  activeTab: EditorInput | null;
  activePaneId: string | null;
  labels: EditorPartLabels;
  viewPartProps: {
    browserUrl: string;
    browserPageTitle?: string;
    browserFaviconUrl?: string;
    electronRuntime: boolean;
  };
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
  props: Pick<EditorModeToolbarSourceProps, 'activeTab' | 'activePaneId' | 'viewPartProps'>,
): ResolvedActiveBrowserMetadata {
  const viewPartBrowserUrl = normalizeBrowserMetadataValue(props.viewPartProps.browserUrl);
  const viewPartBrowserPageTitle = normalizeBrowserMetadataValue(
    props.viewPartProps.browserPageTitle,
  );
  const viewPartBrowserFaviconUrl = normalizeBrowserMetadataValue(
    props.viewPartProps.browserFaviconUrl,
  );

  if (!props.activeTab || props.activePaneId !== 'browser') {
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
  const mode = props.activePaneId === 'browser' ? 'browser' : null;
  const activeBrowserMetadata = resolveActiveBrowserMetadata(props);

  return {
    mode,
    browserUrl: activeBrowserMetadata.browserUrl,
    browserPageTitle: activeBrowserMetadata.browserPageTitle,
    browserFaviconUrl: activeBrowserMetadata.browserFaviconUrl,
    browserTabTitle: activeBrowserMetadata.browserTabTitle,
    electronRuntime: props.viewPartProps.electronRuntime,
    labels: {
      toolbarSources: props.labels.toolbarSources,
      toolbarBack: props.labels.toolbarBack,
      toolbarForward: props.labels.toolbarForward,
      toolbarRefresh: props.labels.toolbarRefresh,
      toolbarFavorite: props.labels.toolbarFavorite,
      toolbarArchivePage: props.labels.toolbarArchivePage,
      toolbarExportDocx: props.labels.toolbarExportDocx,
      toolbarMore: props.labels.toolbarMore,
      toolbarHardReload: props.labels.toolbarHardReload,
      toolbarCopyCurrentUrl: props.labels.toolbarCopyCurrentUrl,
      toolbarClearBrowsingHistory: props.labels.toolbarClearBrowsingHistory,
      toolbarClearCookies: props.labels.toolbarClearCookies,
      toolbarClearCache: props.labels.toolbarClearCache,
      toolbarAddressBar: props.labels.toolbarAddressBar,
      toolbarAddressPlaceholder: props.labels.toolbarAddressPlaceholder,
      browserHistoryAndFavoritesPanelTitle: props.labels.browserHistoryAndFavoritesPanelTitle,
      browserHistoryAndFavoritesPanelRecentTitle: props.labels.browserHistoryAndFavoritesPanelRecentTitle,
      browserHistoryAndFavoritesPanelRecentTodayTitle: props.labels.browserHistoryAndFavoritesPanelRecentTodayTitle,
      browserHistoryAndFavoritesPanelRecentYesterdayTitle:
        props.labels.browserHistoryAndFavoritesPanelRecentYesterdayTitle,
      browserHistoryAndFavoritesPanelRecentLast7DaysTitle:
        props.labels.browserHistoryAndFavoritesPanelRecentLast7DaysTitle,
      browserHistoryAndFavoritesPanelRecentLast30DaysTitle:
        props.labels.browserHistoryAndFavoritesPanelRecentLast30DaysTitle,
      browserHistoryAndFavoritesPanelRecentOlderTitle: props.labels.browserHistoryAndFavoritesPanelRecentOlderTitle,
      browserHistoryAndFavoritesPanelFavoritesTitle: props.labels.browserHistoryAndFavoritesPanelFavoritesTitle,
      browserHistoryAndFavoritesPanelEmptyState: props.labels.browserHistoryAndFavoritesPanelEmptyState,
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
