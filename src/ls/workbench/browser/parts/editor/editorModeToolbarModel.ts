import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import { getEditorPaneMode, isEditorBrowserTabInput } from 'ls/workbench/browser/parts/editor/editorInput';
import type { EditorWorkspaceTab } from 'ls/workbench/browser/parts/editor/editorModel';
import type { EditorBrowserLibraryPanel } from 'ls/workbench/browser/parts/editor/editorBrowserLibraryPanel';
import type { EditorModeToolbarContributionContext } from 'ls/workbench/browser/parts/editor/editorModeToolbarContribution';
import { getEditorContentTabTitle } from 'ls/workbench/browser/parts/editor/editorUrlPresentation';

type EditorModeToolbarSourceProps = {
  activeTab: EditorWorkspaceTab | null;
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
  onToolbarHardReload: () => void;
  onToolbarCopyCurrentUrl: () => void | Promise<void>;
  onToolbarClearBrowsingHistory: () => void;
  onToolbarClearCookies: () => void | Promise<void>;
  onToolbarClearCache: () => void | Promise<void>;
  onToolbarAddressChange: (value: string) => void;
  onToolbarAddressSubmit: () => void;
  onToolbarNavigateToUrl: (url: string) => void;
  onPdfHighlightSelection?: () => void;
  onPdfNoteSelection?: () => void;
  browserLibraryPanel?: EditorBrowserLibraryPanel | null;
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
  props: Pick<EditorModeToolbarSourceProps, 'activeTab' | 'viewPartProps'>,
): ResolvedActiveBrowserMetadata {
  const viewPartBrowserUrl = normalizeBrowserMetadataValue(props.viewPartProps.browserUrl);
  const viewPartBrowserPageTitle = normalizeBrowserMetadataValue(
    props.viewPartProps.browserPageTitle,
  );
  const viewPartBrowserFaviconUrl = normalizeBrowserMetadataValue(
    props.viewPartProps.browserFaviconUrl,
  );

  if (!isEditorBrowserTabInput(props.activeTab)) {
    return {
      browserUrl: viewPartBrowserUrl,
      browserPageTitle: viewPartBrowserPageTitle,
      browserFaviconUrl: viewPartBrowserFaviconUrl,
      browserTabTitle: '',
      hasActiveBrowserTab: false,
    };
  }

  const activeTabBrowserUrl = normalizeBrowserMetadataValue(props.activeTab.url);
  const browserUrl = viewPartBrowserUrl || activeTabBrowserUrl;
  const activeTabTitle = normalizeBrowserMetadataValue(props.activeTab.title);
  const derivedTitle = normalizeBrowserMetadataValue(
    getEditorContentTabTitle(browserUrl),
  );
  const activeTabFaviconUrl = normalizeBrowserMetadataValue(
    props.activeTab.faviconUrl,
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
  const mode = props.activeTab ? getEditorPaneMode(props.activeTab) : null;
  const activeBrowserMetadata = resolveActiveBrowserMetadata(props);

  return {
    mode: mode === 'browser' || mode === 'pdf' ? mode : null,
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
      toolbarMore: props.labels.toolbarMore,
      toolbarHardReload: props.labels.toolbarHardReload,
      toolbarCopyCurrentUrl: props.labels.toolbarCopyCurrentUrl,
      toolbarClearBrowsingHistory: props.labels.toolbarClearBrowsingHistory,
      toolbarClearCookies: props.labels.toolbarClearCookies,
      toolbarClearCache: props.labels.toolbarClearCache,
      toolbarAddressBar: props.labels.toolbarAddressBar,
      toolbarAddressPlaceholder: props.labels.toolbarAddressPlaceholder,
      browserLibraryPanelTitle: props.labels.browserLibraryPanelTitle,
      browserLibraryPanelRecentTitle: props.labels.browserLibraryPanelRecentTitle,
      browserLibraryPanelRecentTodayTitle: props.labels.browserLibraryPanelRecentTodayTitle,
      browserLibraryPanelRecentYesterdayTitle:
        props.labels.browserLibraryPanelRecentYesterdayTitle,
      browserLibraryPanelRecentLast7DaysTitle:
        props.labels.browserLibraryPanelRecentLast7DaysTitle,
      browserLibraryPanelRecentLast30DaysTitle:
        props.labels.browserLibraryPanelRecentLast30DaysTitle,
      browserLibraryPanelRecentOlderTitle: props.labels.browserLibraryPanelRecentOlderTitle,
      browserLibraryPanelFavoritesTitle: props.labels.browserLibraryPanelFavoritesTitle,
      browserLibraryPanelEmptyState: props.labels.browserLibraryPanelEmptyState,
      pdfTitle: props.labels.pdfTitle,
    },
    onOpenSources: props.onOpenAddressBarSourceMenu,
    onNavigateBack: props.onToolbarNavigateBack,
    onNavigateForward: props.onToolbarNavigateForward,
    onNavigateRefresh: props.onToolbarNavigateRefresh,
    onArchiveCurrentPage: props.onToolbarArchiveCurrentPage,
    onHardReload: props.onToolbarHardReload,
    onCopyCurrentUrl: props.onToolbarCopyCurrentUrl,
    onClearBrowsingHistory: props.onToolbarClearBrowsingHistory,
    onClearCookies: props.onToolbarClearCookies,
    onClearCache: props.onToolbarClearCache,
    onAddressInputChange: props.onToolbarAddressChange,
    onAddressInputSubmit: props.onToolbarAddressSubmit,
    onNavigateToUrl: props.onToolbarNavigateToUrl,
    onPdfHighlightSelection: props.onPdfHighlightSelection ?? (() => {}),
    onPdfNoteSelection: props.onPdfNoteSelection ?? (() => {}),
    browserLibraryPanel: props.browserLibraryPanel ?? null,
  };
}
