import { EventEmitter } from 'cs/base/common/event';
import { CancellationTokenSource } from 'cs/base/common/cancellation';
import type { CancellationToken } from 'cs/base/common/cancellation';
import type {
  LibraryDocumentSummary,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import type { Article } from 'cs/workbench/services/article/articleFetch';
import {
  parseAppErrorData,
} from 'cs/base/common/errors';
import {
  formatLocaleMessage,
  localizeAppError,
} from 'cs/workbench/common/errorMessages';
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
import type { ArticleBatchTaskProgress } from 'cs/workbench/browser/articleBatchTask';
import type { INotificationService } from 'cs/platform/notification/common/notification';

export type DocumentActionsControllerContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
  notificationService: INotificationService;
  locale: Locale;
  ui: LocaleMessages;
  knowledgeBaseEnabled: boolean;
  pdfDownloadDir: string;
  knowledgeBasePdfDownloadDir: string;
  pdfFileNameUseSelectionOrder: boolean;
  isSelectionModeEnabled: boolean;
  selectedArticleOrderLookup: ReadonlyMap<string, number>;
  exportableArticles: Article[];
  createBrowserTab: (url: string) => void;
  onExportArticleSummaries: (articles: readonly Article[], translateSummaries: boolean) => void | Promise<void>;
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
  downloadAllProgress: ArticleBatchTaskProgress | null;
};

type DocumentDownloadTask = {
  taskId: string;
  source: CancellationTokenSource;
};

type SharedPdfDownloadOptions = {
  taskId?: string;
  token?: CancellationToken;
};

type DownloadableArticle = Pick<
  Article,
  | 'title'
  | 'sourceUrl'
  | 'fetchedAt'
  | 'journalTitle'
  | 'doi'
  | 'authors'
  | 'publishedAt'
  | 'sourceId'
> & { fetchOrder: number | null };

function getArticleSelectionKey(article: Pick<Article, 'sourceUrl' | 'fetchedAt'>) {
  return `${article.sourceUrl}::${article.fetchedAt}`;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function getDownloadArticleOrder(
  article: Pick<Article, 'sourceUrl' | 'fetchedAt'> & { fetchOrder: number | null },
  pdfFileNameUseSelectionOrder: boolean,
  isSelectionModeEnabled: boolean,
  selectedArticleOrderLookup: ReadonlyMap<string, number>,
) {
  if (pdfFileNameUseSelectionOrder && isSelectionModeEnabled) {
    const selectedOrder = selectedArticleOrderLookup.get(getArticleSelectionKey(article));
    return isPositiveInteger(selectedOrder) ? selectedOrder : null;
  }

  return isPositiveInteger(article.fetchOrder) ? article.fetchOrder : null;
}

function buildDownloadArticleTitle(
  article: Pick<Article, 'title' | 'sourceUrl' | 'fetchedAt'> & { fetchOrder: number | null },
  pdfFileNameUseSelectionOrder: boolean,
  isSelectionModeEnabled: boolean,
  selectedArticleOrderLookup: ReadonlyMap<string, number>,
) {
  const articleTitle = typeof article.title === 'string' ? article.title.trim() : '';
  if (!articleTitle) {
    return article.title;
  }

  const order = getDownloadArticleOrder(
    article,
    pdfFileNameUseSelectionOrder,
    isSelectionModeEnabled,
    selectedArticleOrderLookup,
  );
  return typeof order === 'number' ? `${order}. ${articleTitle}` : article.title;
}

function resolveSciencePdfQueueMessage(ui: LocaleMessages) {
  return ui.toastSciencePdfQueued;
}

function isScienceValidationWindowClosedCancel(
  error: ReturnType<typeof parseAppErrorData>,
) {
  return (
    error.code === 'PDF_DOWNLOAD_FAILED' &&
    String(error.details?.status ?? '').toUpperCase() === 'SCIENCE_VALIDATION_REQUIRED' &&
    String(error.details?.statusText ?? '') ===
      'Science validation window was closed before verification completed.'
  );
}

function isDesktopCancellation(
  error: ReturnType<typeof parseAppErrorData>,
) {
  return error.message === 'Canceled' || error.details?.message === 'Canceled';
}

let documentBatchTaskCounter = 0;

function createDocumentBatchTaskId() {
  documentBatchTaskCounter += 1;
  return `document-batch-${Date.now()}-${documentBatchTaskCounter}`;
}

function createSnapshot(
  context: DocumentActionsControllerContext,
  downloadAllProgress: ArticleBatchTaskProgress | null = null,
): DocumentActionsControllerSnapshot {
  return {
    canExportDocx:
      Boolean(context.activeDraftExport) ||
      canExportArticlesDocx(context.exportableArticles.length),
    downloadAllProgress,
  };
}

function sameArticleBatchTaskProgress(
  left: ArticleBatchTaskProgress | null,
  right: ArticleBatchTaskProgress | null,
) {
  if (left === right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.phase === right.phase && left.current === right.current && left.total === right.total;
}

export class DocumentActionsController {
  private context: DocumentActionsControllerContext;
  private snapshot: DocumentActionsControllerSnapshot;
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private sciencePdfDownloadCount = 0;
  private currentDownloadTask: DocumentDownloadTask | null = null;

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
    this.setSnapshot(createSnapshot(context, this.snapshot.downloadAllProgress));
  };

  readonly dispose = () => {
    this.currentDownloadTask?.source.cancel();
    this.currentDownloadTask?.source.dispose();
    this.currentDownloadTask = null;
    this.onDidChangeEmitter.dispose();
  };

  readonly handleSharedPdfDownload = async (
    article: DownloadableArticle,
    options: SharedPdfDownloadOptions = {},
  ) => {
    const {
      desktopRuntime,
      invokeDesktop,
      notificationService,
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
      if (options.token?.isCancellationRequested) {
        return;
      }
      notificationService.error(ui.toastEnterArticleUrl);
      return;
    }

    if (!desktopRuntime) {
      if (options.token?.isCancellationRequested) {
        return;
      }
      notificationService.info(ui.toastDesktopPdfDownloadOnly);
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
    if (options.token?.isCancellationRequested) {
      markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
      return;
    }
    markPdfDownloadStarted(preparedPdfDownload.normalizedSourceUrl);

    if (preparedPdfDownload.isSciencePdfDownload && this.sciencePdfDownloadCount > 0) {
      notificationService.info(resolveSciencePdfQueueMessage(ui));
    }

    if (preparedPdfDownload.isSciencePdfDownload) {
      this.sciencePdfDownloadCount += 1;
    }

    try {
      const result = await invokeDesktop('web_content_download_pdf', {
        taskId: options.taskId,
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
      if (options.token?.isCancellationRequested) {
        markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
        return;
      }
      markPdfDownloadSucceeded(preparedPdfDownload.normalizedSourceUrl, result);
      void onLibraryUpdated?.();
      notificationService.info(
        formatLocaleMessage(ui.toastPdfDownloaded, {
          filePath: result.filePath,
          sourceUrl: result.sourceUrl,
        }),
      );
    } catch (downloadError) {
      if (options.token?.isCancellationRequested) {
        markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
        return;
      }

      const parsedError = parseAppErrorData(downloadError);
      if (isScienceValidationWindowClosedCancel(parsedError) || isDesktopCancellation(parsedError)) {
        markPdfDownloadCancelled(preparedPdfDownload.normalizedSourceUrl);
        return;
      }

      const localizedError = localizeAppError(ui, parsedError);
      markPdfDownloadFailed(preparedPdfDownload.normalizedSourceUrl, localizedError);
      notificationService.error(
        formatLocaleMessage(ui.toastPdfDownloadFailed, { error: localizedError }),
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

    this.context.createBrowserTab(article.sourceUrl);
  };

  readonly handleDownloadAllArticles = async (articles: readonly Article[]) => {
    if (this.currentDownloadTask) {
      this.cancelDownloadAllArticles();
      return;
    }

    if (articles.length === 0) {
      return;
    }

    const source = new CancellationTokenSource();
    const taskId = createDocumentBatchTaskId();
    this.currentDownloadTask = { taskId, source };
    const total = articles.length;
    let completed = 0;
    this.setDownloadAllProgress({ phase: 'running', current: completed, total });

    try {
      for (const [index, article] of articles.entries()) {
        if (source.token.isCancellationRequested) {
          break;
        }

        await this.handleSharedPdfDownload({
          ...article,
          fetchOrder: index + 1,
        }, {
          taskId,
          token: source.token,
        });
        if (source.token.isCancellationRequested) {
          break;
        }

        completed += 1;
        if (this.currentDownloadTask?.taskId === taskId) {
          this.setDownloadAllProgress({ phase: 'running', current: completed, total });
        }
      }
    } finally {
      if (this.currentDownloadTask?.taskId === taskId) {
        this.currentDownloadTask = null;
        this.setDownloadAllProgress(null);
      }
      source.dispose();
    }
  };

  private cancelDownloadAllArticles() {
    const task = this.currentDownloadTask;
    if (!task) {
      return;
    }

    task.source.cancel();
    this.currentDownloadTask = null;
    this.setDownloadAllProgress(null);
    void this.context.invokeDesktop('cancel_document_task', { taskId: task.taskId })
      .catch((error) => {
        console.warn('Failed to cancel document download task.', error);
      });
  }

  readonly handleExportDocx = async () => {
    const {
      desktopRuntime,
      invokeDesktop,
      locale,
      ui,
      pdfDownloadDir,
      exportableArticles,
      activeDraftExport,
      onExportArticleSummaries,
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

        this.context.notificationService.info(
          formatLocaleMessage(ui.toastEditorDocxExported, {
            title: result.title,
            filePath: result.filePath,
          }),
        );
      } catch (exportError) {
        const localizedError = localizeAppError(
          ui,
          parseAppErrorData(exportError),
        );
        this.context.notificationService.error(
          formatLocaleMessage(ui.toastDocxExportFailed, { error: localizedError }),
        );
      }
      return;
    }

    await onExportArticleSummaries(exportableArticles, true);
  };

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }

  private setSnapshot(nextSnapshot: DocumentActionsControllerSnapshot) {
    if (
      this.snapshot.canExportDocx === nextSnapshot.canExportDocx &&
      sameArticleBatchTaskProgress(this.snapshot.downloadAllProgress, nextSnapshot.downloadAllProgress)
    ) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.emitChange();
  }

  private setDownloadAllProgress(progress: ArticleBatchTaskProgress | null) {
    this.setSnapshot(createSnapshot(this.context, progress));
  }
}

export function createDocumentActionsController(
  context: DocumentActionsControllerContext,
) {
  return new DocumentActionsController(context);
}
