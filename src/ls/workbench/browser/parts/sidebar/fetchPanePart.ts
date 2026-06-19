import type {
  ArticleDetailsModalLabels,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { DomScrollableElement } from 'ls/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'ls/base/browser/ui/scrollbar/scrollableElementOptions';
import { LifecycleOwner, LifecycleStore, toDisposable } from 'ls/base/common/lifecycle';
import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import { FetchTreeView } from 'ls/workbench/browser/parts/sidebar/fetchTreeView';
import { createSidebarTitlebarLabels } from 'ls/workbench/browser/parts/titlebar/titlebarActions';

export type SidebarArticle = {
  title: string;
  articleType: string | null;
  doi: string | null;
  authors: string[];
  abstractText: string | null;
  descriptionText: string | null;
  publishedAt: string | null;
  sourceUrl: string;
  fetchedAt: string;
  sourceId?: string | null;
  journalTitle?: string | null;
  archiveHtmlPath?: string | null;
  archiveTextPath?: string | null;
  archivePdfPath?: string | null;
};

export type SidebarLabels = {
  untitled: string;
  unknown: string;
  articleType: string;
  authors: string;
  abstract: string;
  description: string;
  publishedAt: string;
  source: string;
  fetchedAt: string;
  archiveHtmlPath: string;
  archiveTextPath: string;
  archivePdfPath: string;
  revealPath: string;
  controlsAriaLabel: string;
  minimize: string;
  maximize: string;
  restore: string;
  close: string;
  emptyFiltered: string;
  emptyAll: string;
  emptyAllInputLinkAction: string;
  emptyAllInputLinkSuffix: string;
  startDate: string;
  endDate: string;
  fetchLatestBusy: string;
  fetchLatest: string;
  fetchTitle: string;
  selectionModeEnterMulti: string;
  selectionModeSelectAll: string;
  selectionModeExit: string;
  loading: string;
  refresh: string;
  libraryTitle: string;
  libraryAction: string;
  pdfDownloadAction: string;
  libraryEmpty: string;
  libraryDocuments: string;
  libraryFiles: string;
  libraryQueuedJobs: string;
  libraryDbFile: string;
  libraryFilesDir: string;
  libraryCacheDir: string;
  libraryStatusRegistered: string;
  libraryStatusQueued: string;
  libraryStatusRunning: string;
  libraryStatusFailed: string;
  contextRename: string;
  contextEditSourceUrl: string;
  contextDelete: string;
  assistantTitle: string;
  assistantDescriptionEnabled: string;
  assistantDescriptionDisabled: string;
  assistantModeOn: string;
  assistantModeOff: string;
  assistantReady: string;
  assistantPlaceholderEnabled: string;
  assistantPlaceholderDisabled: string;
  assistantVoice: string;
  assistantImage: string;
  assistantSend: string;
  assistantSendBusy: string;
  assistantQuestion: string;
  assistantQuestionPlaceholder: string;
  assistantContext: string;
  assistantContextPlaceholder: string;
  assistantAnswerTitle: string;
  assistantEvidenceTitle: string;
  assistantSources: string;
  assistantNoArticles: string;
  assistantQuestionRequired: string;
  assistantRerankOn: string;
  assistantRerankOff: string;
};

export type SidebarSelectionModePhase = 'off' | 'multi' | 'all';
export type FetchPaneProps = {
  articles: SidebarArticle[];
  hasData: boolean;
  locale: Locale;
  labels: SidebarLabels;
  onFocusWebUrlInput: () => void;
  fetchStartDate: string;
  onFetchStartDateChange: (value: string) => void;
  fetchEndDate: string;
  onFetchEndDateChange: (value: string) => void;
  onFetch: () => void;
  onDownloadPdf: (article: SidebarArticle) => Promise<void>;
  onOpenArticleDetails: (
    article: SidebarArticle,
    labels: ArticleDetailsModalLabels
  ) => void | Promise<void>;
  isFetchLoading: boolean;
  isSelectionModeEnabled: boolean;
  selectionModePhase: SidebarSelectionModePhase;
  selectedArticleKeys: ReadonlySet<string>;
  onToggleSelectionMode: () => void;
  onToggleArticleSelected: (article: SidebarArticle) => void;
};

export type FetchPaneState = {
  ui: LocaleMessages;
  locale: Locale;
  articles: SidebarArticle[];
  hasData: boolean;
  fetchStartDate: string;
  fetchEndDate: string;
  isFetchLoading: boolean;
  isSelectionModeEnabled: boolean;
  selectionModePhase: SidebarSelectionModePhase;
  selectedArticleKeys: ReadonlySet<string>;
};

export type FetchPaneActions = {
  onFocusWebUrlInput: () => void;
  onFetchStartDateChange: (value: string) => void;
  onFetchEndDateChange: (value: string) => void;
  onFetch: () => void;
  onDownloadPdf: FetchPaneProps['onDownloadPdf'];
  onOpenArticleDetails: FetchPaneProps['onOpenArticleDetails'];
  onToggleSelectionMode: FetchPaneProps['onToggleSelectionMode'];
  onToggleArticleSelected: FetchPaneProps['onToggleArticleSelected'];
};

type CreateSidebarPartLabelsParams = {
  ui: LocaleMessages;
};
type CreateFetchPanePropsParams = {
  state: FetchPaneState;
  actions: FetchPaneActions;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function addDisposableListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

export function createSidebarPartLabels({
  ui,
}: CreateSidebarPartLabelsParams): SidebarLabels {
  return {
    untitled: ui.untitled,
    unknown: ui.unknown,
    articleType: ui.articleType,
    authors: ui.authors,
    abstract: ui.abstract,
    description: ui.description,
    publishedAt: ui.publishedAt,
    source: ui.source,
    fetchedAt: ui.fetchedAt,
    archiveHtmlPath: ui.articleDetailsArchiveHtmlPath,
    archiveTextPath: ui.articleDetailsArchiveTextPath,
    archivePdfPath: ui.articleDetailsArchivePdfPath,
    revealPath: ui.articleDetailsRevealPath,
    ...createSidebarTitlebarLabels(ui),
    emptyFiltered: ui.emptyFiltered,
    emptyAll: ui.emptyAll,
    emptyAllInputLinkAction: ui.emptyAllInputLinkAction,
    emptyAllInputLinkSuffix: ui.emptyAllInputLinkSuffix,
    startDate: ui.startDate,
    endDate: ui.endDate,
    fetchLatestBusy: ui.fetchLatestBusy,
    fetchLatest: ui.fetchLatest,
    fetchTitle: ui.sidebarFetchTitle,
    selectionModeEnterMulti: ui.sidebarSelectionModeEnterMulti,
    selectionModeSelectAll: ui.sidebarSelectionModeSelectAll,
    selectionModeExit: ui.sidebarSelectionModeExit,
    loading: ui.settingsLoading,
    libraryTitle: ui.sidebarLibraryAction,
    libraryAction: ui.sidebarLibraryAction,
    pdfDownloadAction: ui.sidebarPdfDownloadAction,
    libraryEmpty: ui.knowledgeBaseSidebarEmpty,
    libraryDocuments: ui.settingsLibraryStatusDocuments,
    libraryFiles: ui.settingsLibraryStatusFiles,
    libraryQueuedJobs: ui.settingsLibraryStatusQueuedJobs,
    libraryDbFile: ui.settingsLibraryDbFile,
    libraryFilesDir: ui.settingsLibraryFilesDir,
    libraryCacheDir: ui.settingsLibraryCacheDir,
    libraryStatusRegistered: ui.settingsLibraryDocumentRegistered,
    libraryStatusQueued: ui.settingsLibraryDocumentQueued,
    libraryStatusRunning: ui.settingsLibraryDocumentRunning,
    libraryStatusFailed: ui.settingsLibraryDocumentFailed,
    contextRename: ui.libraryContextRename,
    contextEditSourceUrl: ui.libraryContextEditSourceUrl,
    contextDelete: ui.libraryContextDelete,
    assistantTitle: ui.assistantSidebarTitle,
    assistantDescriptionEnabled: ui.assistantSidebarDescriptionEnabled,
    assistantDescriptionDisabled: ui.assistantSidebarDescriptionDisabled,
    assistantModeOn: ui.assistantSidebarModeOn,
    assistantModeOff: ui.assistantSidebarModeOff,
    assistantReady: ui.assistantSidebarReady,
    assistantPlaceholderEnabled: ui.assistantSidebarPlaceholderEnabled,
    assistantPlaceholderDisabled: ui.assistantSidebarPlaceholderDisabled,
    assistantVoice: ui.assistantSidebarVoice,
    assistantImage: ui.assistantSidebarImage,
    assistantSend: ui.assistantSidebarSend,
    assistantSendBusy: ui.assistantSidebarSendBusy,
    assistantQuestion: ui.assistantSidebarQuestion,
    assistantQuestionPlaceholder: ui.assistantSidebarQuestionPlaceholder,
    assistantContext: ui.assistantSidebarContext,
    assistantContextPlaceholder: ui.assistantSidebarContextPlaceholder,
    assistantAnswerTitle: ui.assistantSidebarAnswerTitle,
    assistantEvidenceTitle: ui.assistantSidebarEvidenceTitle,
    assistantSources: ui.assistantSidebarSources,
    assistantNoArticles: ui.assistantSidebarNoArticles,
    assistantQuestionRequired: ui.assistantSidebarQuestionRequired,
    assistantRerankOn: ui.assistantSidebarRerankOn,
    assistantRerankOff: ui.assistantSidebarRerankOff,
  };
}

export function createFetchPaneProps({
  state: {
    ui,
    locale,
    articles,
    hasData,
    fetchStartDate,
    fetchEndDate,
    isFetchLoading,
    isSelectionModeEnabled,
    selectionModePhase,
    selectedArticleKeys,
  },
  actions: {
    onFocusWebUrlInput,
    onFetchStartDateChange,
    onFetchEndDateChange,
    onFetch,
    onDownloadPdf,
    onOpenArticleDetails,
    onToggleSelectionMode,
    onToggleArticleSelected,
  },
}: CreateFetchPanePropsParams): FetchPaneProps {
  return {
    articles,
    hasData,
    locale,
    labels: createSidebarPartLabels({ ui }),
    onFocusWebUrlInput,
    fetchStartDate,
    onFetchStartDateChange,
    fetchEndDate,
    onFetchEndDateChange,
    onFetch,
    onDownloadPdf,
    onOpenArticleDetails,
    isFetchLoading,
    isSelectionModeEnabled,
    selectionModePhase,
    selectedArticleKeys,
    onToggleSelectionMode,
    onToggleArticleSelected,
  };
}

function createArticleCardLabels(
  labels: FetchPaneProps['labels'],
): ArticleDetailsModalLabels {
  return {
    untitled: labels.untitled,
    unknown: labels.unknown,
    articleType: labels.articleType,
    authors: labels.authors,
    abstract: labels.abstract,
    description: labels.description,
    publishedAt: labels.publishedAt,
    source: labels.source,
    fetchedAt: labels.fetchedAt,
    archiveHtmlPath: labels.archiveHtmlPath,
    archiveTextPath: labels.archiveTextPath,
    archivePdfPath: labels.archivePdfPath,
    revealPath: labels.revealPath,
    controlsAriaLabel: labels.controlsAriaLabel,
    minimize: labels.minimize,
    maximize: labels.maximize,
    restore: labels.restore,
    close: labels.close,
  };
}

export class FetchPaneContentView extends LifecycleOwner {
  private props: FetchPaneProps;
  private readonly element = createElement('div', 'fetch-pane-content');
  private readonly contentElement = createElement('div', 'fetch-pane-content-body');
  private readonly scrollableElement: DomScrollableElement;
  private readonly renderDisposables = new LifecycleStore();
  private fetchTreeView: FetchTreeView | null = null;
  private disposed = false;

  constructor(props: FetchPaneProps) {
    super();
    this.props = props;
    this.register(this.renderDisposables);
    this.scrollableElement = new DomScrollableElement(this.contentElement, {
      className: 'fetch-pane-scrollable',
      vertical: ScrollbarVisibility.Auto,
      horizontal: ScrollbarVisibility.Hidden,
      useShadows: false,
    });
    this.element.append(this.scrollableElement.getDomNode());
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: FetchPaneProps) {
    if (this.disposed) {
      return;
    }

    this.props = props;
    this.render();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    super.dispose();
    this.scrollableElement.dispose();
    this.fetchTreeView?.dispose();
    this.fetchTreeView = null;
    this.element.replaceChildren();
  }

  private render() {
    if (this.disposed) {
      return;
    }

    this.renderContent();
  }

  private renderContent() {
    this.renderDisposables.clear();

    if (this.props.articles.length > 0) {
      const articleCardLabels = createArticleCardLabels(this.props.labels);
      const treeProps = {
        articles: this.props.articles,
        locale: this.props.locale,
        labels: {
          ...articleCardLabels,
          fetchTitle: this.props.labels.fetchTitle,
        },
        selectedArticleKeys: this.props.selectedArticleKeys,
        isSelectionModeEnabled: this.props.isSelectionModeEnabled,
        onDownloadPdf: this.props.onDownloadPdf,
        onOpenArticleDetails: this.props.onOpenArticleDetails,
        onToggleArticleSelected: this.props.onToggleArticleSelected,
      };

      if (!this.fetchTreeView) {
        this.fetchTreeView = new FetchTreeView(treeProps);
      } else {
        this.fetchTreeView.setProps(treeProps);
      }

      if (this.fetchTreeView.getElement().parentElement !== this.contentElement) {
        this.contentElement.replaceChildren(this.fetchTreeView.getElement());
      }
      this.scrollableElement.scanDomNode();
      return;
    }

    if (this.fetchTreeView) {
      this.fetchTreeView.dispose();
      this.fetchTreeView = null;
    }

    const empty = createElement('div', 'fetch-pane-empty-state');
    if (this.props.hasData) {
      empty.textContent = this.props.labels.emptyFiltered;
      this.contentElement.replaceChildren(empty);
      this.scrollableElement.scanDomNode();
      return;
    }

    const inputLink = createElement(
      'button',
      'fetch-pane-empty-state-action',
    );
    inputLink.type = 'button';
    inputLink.textContent = this.props.labels.emptyAllInputLinkAction;
    this.renderDisposables.add(
      addDisposableListener(inputLink, 'click', this.props.onFocusWebUrlInput),
    );

    empty.append(
      inputLink,
      document.createTextNode(
        this.props.labels.emptyAllInputLinkSuffix
          ? ` ${this.props.labels.emptyAllInputLinkSuffix}`
          : this.props.labels.emptyAll,
      ),
    );
    this.contentElement.replaceChildren(empty);
    this.scrollableElement.scanDomNode();
  }
}
