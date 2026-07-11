import type { BrowserHistoryAndFavoritesPanel } from 'cs/workbench/browser/parts/editor/browserHistoryAndFavoritesPanel';

export type EditorModeToolbarKind = 'browser' | 'pdf';

export type EditorModeToolbarContributionContext = {
  mode: EditorModeToolbarKind | null;
  browserUrl: string;
  browserPageTitle?: string;
  browserFaviconUrl?: string;
  browserTabTitle?: string;
  electronRuntime: boolean;
  labels: {
    toolbarSources: string;
    toolbarBack: string;
    toolbarForward: string;
    toolbarRefresh: string;
    toolbarFavorite: string;
    toolbarArchivePage: string;
    toolbarExportDocx: string;
    toolbarMore: string;
    toolbarHardReload: string;
    toolbarCopyCurrentUrl: string;
    toolbarClearBrowsingHistory: string;
    toolbarClearCookies: string;
    toolbarClearCache: string;
    toolbarAddressBar: string;
    toolbarAddressPlaceholder: string;
    browserHistoryAndFavoritesPanelTitle: string;
    browserHistoryAndFavoritesPanelRecentTitle: string;
    browserHistoryAndFavoritesPanelRecentTodayTitle: string;
    browserHistoryAndFavoritesPanelRecentYesterdayTitle: string;
    browserHistoryAndFavoritesPanelRecentLast7DaysTitle: string;
    browserHistoryAndFavoritesPanelRecentLast30DaysTitle: string;
    browserHistoryAndFavoritesPanelRecentOlderTitle: string;
    browserHistoryAndFavoritesPanelFavoritesTitle: string;
    browserHistoryAndFavoritesPanelEmptyState: string;
    pdfTitle: string;
  };
  onOpenSources: () => void;
  onNavigateBack: () => void;
  onNavigateForward: () => void;
  onNavigateRefresh: () => void;
  onArchiveCurrentPage: () => void | Promise<void>;
  onExportDocx: () => void | Promise<void>;
  onHardReload: () => void;
  onCopyCurrentUrl: () => void | Promise<void>;
  onClearBrowsingHistory: () => void;
  onClearCookies: () => void | Promise<void>;
  onClearCache: () => void | Promise<void>;
  onAddressInputChange: (value: string) => void;
  onAddressInputSubmit: () => void;
  onNavigateToUrl: (url: string) => void;
  onPdfHighlightSelection: () => void;
  onPdfNoteSelection: () => void;
  browserHistoryAndFavoritesPanel: BrowserHistoryAndFavoritesPanel | null;
};

export interface EditorModeToolbarContribution {
  readonly mode: EditorModeToolbarKind;
  getElement(): HTMLElement;
  setContext(context: EditorModeToolbarContributionContext): void;
  focusPrimaryInput?(): void;
  dispose(): void;
}
