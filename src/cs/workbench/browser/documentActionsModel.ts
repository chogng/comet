import { toast } from 'cs/base/browser/ui/toast/toast';
import { EventEmitter } from 'cs/base/common/event';
import type {
  DocumentTranslationProgress,
  LibraryDocumentSummary,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import type { Article } from 'cs/workbench/services/article/articleFetch';
import {
  formatLocalized,
  localizeDesktopInvokeError,
  parseDesktopInvokeError,
} from 'cs/workbench/services/desktop/desktopError';
import {
  markPdfDownloadCancelled,
  markPdfDownloadFailed,
  markPdfDownloadStarted,
  markPdfDownloadSucceeded,
} from 'cs/workbench/services/document/pdfDownloadStatus';
import {
  canExportArticlesDocx,
  preparePdfDownload,
  resolvePreferredDirectory,
} from 'cs/workbench/services/document/documentActionService';
import { syncLibraryMetadataFromArticle } from 'cs/workbench/services/knowledgeBase/libraryMetadataService';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import type { EditorDraftStyleSettings } from 'cs/base/common/editorDraftStyle';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';

export type DocumentActionsControllerContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
  nativeHost: INativeHostService;
  locale: Locale;
  ui: LocaleMessages;
  knowledgeBaseEnabled: boolean;
  pdfDownloadDir: string;
  knowledgeBasePdfDownloadDir: string;
  pdfFileNameUseSelectionOrder: boolean;
  isSelectionModeEnabled: boolean;
  selectedArticleOrderLookup: ReadonlyMap<string, number>;
  exportableArticles: Article[];
  activeDraftExport: {
    title: string;
    document: WritingEditorDocument;
    editorDraftStyle?: EditorDraftStyleSettings;
  } | null;
  onLibraryDocumentUpserted?: (document: LibraryDocumentSummary) => void;
  onLibraryUpdated?: () => void | Promise<void>;
};

export type DocumentActionsControllerSnapshot = {
  canExportDocx: boolean;
};

function getArticleSelectionKey(article: Pick<Article, 'sourceUrl' | 'fetchedAt'>) {
  return `${article.sourceUrl}::${article.fetchedAt}`;
}

function buildDownloadArticleTitle(
  article: Pick<Article, 'title' | 'sourceUrl' | 'fetchedAt'>,
  pdfFileNameUseSelectionOrder: boolean,
  isSelectionModeEnabled: boolean,
  selectedArticleOrderLookup: ReadonlyMap<string, number>,
) {
  const articleTitle = typeof article.title === 'string' ? article.title.trim() : '';
  if (!articleTitle) {
    return article.title;
  }

  if (!pdfFileNameUseSelectionOrder || !isSelectionModeEnabled) {
    return article.title;
  }

  const order = selectedArticleOrderLookup.get(getArticleSelectionKey(article));
  return typeof order === 'number' ? `${order}. ${articleTitle}` : article.title;
}

function resolveSciencePdfQueueMessage(ui: LocaleMessages) {
  return ui.toastSciencePdfQueued;
}

function isScienceValidationWindowClosedCancel(
  error: ReturnType<typeof parseDesktopInvokeError>,
) {
  return (
    error.code === 'PDF_DOWNLOAD_FAILED' &&
    String(error.details?.status ?? '').toUpperCase() === 'SCIENCE_VALIDATION_REQUIRED' &&
    String(error.details?.statusText ?? '') ===
      'Science validation window was closed before verification completed.'
  );
}

function openArticleSourceUrl(sourceUrl: string) {
  window.open(sourceUrl, '_blank', 'noopener,noreferrer');
}

function showAppToast(
  nativeHost: INativeHostService,
  type: 'info' | 'success' | 'error' | 'warning',
  message: string,
) {
  const toastApi = nativeHost.toast;
  if (toastApi) {
    toastApi.show({ type, message });
    return;
  }

  switch (type) {
    case 'success':
      toast.success(message);
      return;
    case 'error':
      toast.error(message);
      return;
    case 'warning':
      toast.info(message);
      return;
    default:
      toast.info(message);
  }
}

function createSnapshot(
  context: DocumentActionsControllerContext,
): DocumentActionsControllerSnapshot {
  return {
    canExportDocx:
      Boolean(context.activeDraftExport) ||
      canExportArticlesDocx(context.exportableArticles.length),
  };
}

export class DocumentActionsController {
  private context: DocumentActionsControllerContext;
  private snapshot: DocumentActionsControllerSnapshot;
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private sciencePdfDownloadCount = 0;

  constructor(context: DocumentActionsControllerContext) {
    this.context = context;
    this.snapshot = createSnapshot(context);
  }

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setContext = (context: DocumentActionsControllerContext) => {
    this.context = context;
    this.setSnapshot(createSnapshot(context));
  };

  readonly dispose = () => {
    this.onDidChangeEmitter.dispose();
  };

  readonly handleSharedPdfDownload = async (
    article: Pick<
      Article,
      | 'title'
      | 'sourceUrl'
      | 'fetchedAt'
      | 'journalTitle'
      | 'doi'
      | 'authors'
      | 'publishedAt'
      | 'sourceId'
    >,
  ) => {
    const {
      desktopRuntime,
      invokeDesktop,
      nativeHost,
      ui,
      knowledgeBaseEnabled,
      pdfDownloadDir,
      knowledgeBasePdfDownloadDir,
      pdfFileNameUseSelectionOrder,
      isSelectionModeEnabled,
      selectedArticleOrderLookup,
      onLibraryUpdated,
      onLibraryDocumentUpserted,
    } = this.context;

    const preparedPdfDownload = preparePdfDownload(article.sourceUrl, article.doi);
    if (!preparedPdfDownload) {
      showAppToast(nativeHost, 'error', ui.toastEnterArticleUrl);
      return;
    }

    if (!desktopRuntime) {
      showAppToast(nativeHost, 'info', ui.toastDesktopPdfDownloadOnly);
      return;
    }

    if (knowledgeBaseEnabled) {
      try {
        await syncLibraryMetadataFromArticle({
          enabled: knowledgeBaseEnabled,
          invokeDesktop,
          article: {
            ...article,
            sourceUrl: preparedPdfDownload.normalizedSourceUrl,
          },
          onDocumentUpserted: onLibraryDocumentUpserted,
        });
      } catch (metadataError) {
        console.error('Failed to upsert library document metadata.', metadataError);
      }
    }
    markPdfDownloadStarted(preparedPdfDownload.normalizedSourceUrl);

    if (preparedPdfDownload.isSciencePdfDownload && this.sciencePdfDownloadCount > 0) {
      showAppToast(nativeHost, 'info', resolveSciencePdfQueueMessage(ui));
    }

    if (preparedPdfDownload.isSciencePdfDownload) {
      this.sciencePdfDownloadCount += 1;
    }

    try {
      const result = await invokeDesktop('web_content_download_pdf', {
        pageUrl: preparedPdfDownload.normalizedSourceUrl,
        downloadUrl: preparedPdfDownload.preferredPdfUrl,
        doi: typeof article.doi === 'string' ? article.doi : undefined,
        articleTitle: buildDownloadArticleTitle(
          article,
          pdfFileNameUseSelectionOrder,
          isSelectionModeEnabled,
          selectedArticleOrderLookup,
        ),
        authors: article.authors,
        publishedAt: typeof article.publishedAt === 'string' ? article.publishedAt : null,
        sourceId: typeof article.sourceId === 'string' ? article.sourceId : null,
        journalTitle: typeof article.journalTitle === 'string' ? article.journalTitle : undefined,
        customDownloadDir: resolvePreferredDirectory(
          knowledgeBaseEnabled ? knowledgeBasePdfDownloadDir : pdfDownloadDir,
        ),
      });
      markPdfDownloadSucceeded(preparedPdfDownload.normalizedSourceUrl, result);
      void onLibraryUpdated?.();
      showAppToast(
        nativeHost,
        'success',
        formatLocalized(ui.toastPdfDownloaded, {
          filePath: result.filePath,
          sourceUrl: result.sourceUrl,
        }),
      );
    } catch (downloadError) {
      const parsedError = parseDesktopInvokeError(downloadError);
      if (isScienceValidationWindowClosedCancel(parsedError)) {
        markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
        return;
      }

      const localizedError = localizeDesktopInvokeError(ui, parsedError);
      markPdfDownloadFailed(preparedPdfDownload.normalizedSourceUrl, localizedError);
      showAppToast(
        nativeHost,
        'error',
        formatLocalized(ui.toastPdfDownloadFailed, { error: localizedError }),
      );
    } finally {
      if (preparedPdfDownload.isSciencePdfDownload) {
        this.sciencePdfDownloadCount = Math.max(0, this.sciencePdfDownloadCount - 1);
      }
    }
  };

  readonly handleOpenArticleDetails = async (article: Article) => {
    if (!article.sourceUrl) {
      return;
    }

    openArticleSourceUrl(article.sourceUrl);
  };

  readonly handleExportDocx = async () => {
    const {
      desktopRuntime,
      invokeDesktop,
      locale,
      ui,
      pdfDownloadDir,
      exportableArticles,
      activeDraftExport,
    } = this.context;

    if (!desktopRuntime) {
      return;
    }

    if (activeDraftExport) {
      try {
        const result = await invokeDesktop('export_editor_docx', {
          document: activeDraftExport.document,
          editorDraftStyle: activeDraftExport.editorDraftStyle,
          title: activeDraftExport.title,
          preferredDirectory: resolvePreferredDirectory(pdfDownloadDir),
          locale,
        });

        if (!result) {
          return;
        }

        toast.success(
          formatLocalized(ui.toastEditorDocxExported, {
            title: result.title,
            filePath: result.filePath,
          }),
        );
      } catch (exportError) {
        const localizedError = localizeDesktopInvokeError(
          ui,
          parseDesktopInvokeError(exportError),
        );
        toast.error(
          formatLocalized(ui.toastDocxExportFailed, { error: localizedError }),
        );
      }
      return;
    }

    if (!canExportArticlesDocx(exportableArticles.length)) {
      toast.info(ui.toastNoExportableArticles);
      return;
    }

    const restoreTranslationStatus = this.beginTranslationStatusbarProgress();
    try {
      const result = await invokeDesktop('export_articles_docx', {
        articles: exportableArticles,
        preferredDirectory: resolvePreferredDirectory(pdfDownloadDir),
        locale,
      });

      if (!result) {
        return;
      }

      toast.success(
        formatLocalized(ui.toastDocxExported, {
          count: result.articleCount,
          filePath: result.filePath,
        }),
      );
    } catch (exportError) {
      const localizedError = localizeDesktopInvokeError(
        ui,
        parseDesktopInvokeError(exportError),
      );
      toast.error(
        formatLocalized(ui.toastDocxExportFailed, { error: localizedError }),
      );
    } finally {
      restoreTranslationStatus();
    }
  };

  private beginTranslationStatusbarProgress() {
    const previousStatus = getStatusbarStateSnapshot();
    const unsubscribe = this.context.nativeHost.document?.onTranslationProgress((progress) => {
      this.renderTranslationStatusbarProgress(previousStatus, progress);
    });

    return () => {
      unsubscribe?.();
      setStatusbarState(previousStatus);
    };
  }

  private renderTranslationStatusbarProgress(
    previousStatus: EditorStatusState,
    progress: DocumentTranslationProgress,
  ) {
    const { ui } = this.context;
    const total = Math.max(0, progress.total);
    const current = Math.max(0, Math.min(progress.current, total));
    const summary =
      progress.phase === 'failed'
        ? ui.statusTranslationFailed
        : progress.phase === 'completed' && total === 0
          ? ui.statusTranslationCached
          : progress.phase === 'completed'
            ? ui.statusTranslationCompleted
            : total > 0
              ? formatLocalized(ui.statusTranslationProgress, { current, total })
              : ui.statusTranslationStarting;
    const providerDetail = [progress.provider, progress.model].filter(Boolean).join(' / ');

    setStatusbarState({
      ...previousStatus,
      summary,
      leftItems: [
        ...previousStatus.leftItems.filter((item) => item.id !== 'document.translation.progress'),
        {
          id: 'document.translation.progress',
          label: 'Translate',
          value: providerDetail || summary,
          tone: progress.phase === 'failed' ? 'error' : 'accent',
          title: progress.message || providerDetail || summary,
        },
      ],
    });
  }

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }

  private setSnapshot(nextSnapshot: DocumentActionsControllerSnapshot) {
    if (this.snapshot.canExportDocx === nextSnapshot.canExportDocx) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.emitChange();
  }
}

export function createDocumentActionsController(
  context: DocumentActionsControllerContext,
) {
  return new DocumentActionsController(context);
}
