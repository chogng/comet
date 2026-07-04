import type { EditorBrowserLibraryPanel } from 'cs/workbench/browser/parts/editor/editorBrowserLibraryPanel';

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
    browserLibraryPanelTitle: string;
    browserLibraryPanelRecentTitle: string;
    browserLibraryPanelRecentTodayTitle: string;
    browserLibraryPanelRecentYesterdayTitle: string;
    browserLibraryPanelRecentLast7DaysTitle: string;
    browserLibraryPanelRecentLast30DaysTitle: string;
    browserLibraryPanelRecentOlderTitle: string;
    browserLibraryPanelFavoritesTitle: string;
    browserLibraryPanelEmptyState: string;
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
  browserLibraryPanel: EditorBrowserLibraryPanel | null;
};

export interface EditorModeToolbarContribution {
  readonly mode: EditorModeToolbarKind;
  getElement(): HTMLElement;
  setContext(context: EditorModeToolbarContributionContext): void;
  focusPrimaryInput?(): void;
  dispose(): void;
}
