/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'cs/base/common/cancellation';
import type { CancellationToken } from 'cs/base/common/cancellation';
import type {
  ArticleSummaryExportInput,
  DocumentTranslationProgress,
  DocxExportResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { INativeHostService } from 'cs/platform/native/common/native';
import type { LocaleMessages } from 'language/locales';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import {
  canExportArticlesDocx,
  resolvePreferredDirectory,
} from 'cs/workbench/services/document/documentActionService';
import {
  parseAppErrorData,
  type AppErrorData,
} from 'cs/base/parts/sandbox/common/appError';
import {
  formatLocaleMessage,
  localizeAppError,
} from 'cs/workbench/common/errorMessages';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';
import { INotificationService } from 'cs/platform/notification/common/notification';
import {
  IFetchService,
  type ArticleDetail,
  type ArticleId,
} from 'cs/workbench/services/fetch/common/fetch';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISettingsModel, SettingsModel } from 'cs/workbench/services/settings/settingsModel';
import {
  IArticleSummaryTranslationExportService,
  type IArticleSummaryTranslationExportService as IArticleSummaryTranslationExportServiceContract,
} from 'cs/workbench/contrib/translation/common/articleSummaryTranslationExport';

type ArticleSummaryTranslationExportTask = {
  taskId: string;
  source: CancellationTokenSource;
  restoreStatusbar: (restoreStatus: boolean) => void;
};

type ArticleSummaryTranslationFailureChoice = 'retry' | 'exportOriginal' | 'cancel';

let articleSummaryTranslationExportTaskCounter = 0;

function createArticleSummaryTranslationExportTaskId() {
  articleSummaryTranslationExportTaskCounter += 1;
  return `article-summary-translation-${Date.now()}-${articleSummaryTranslationExportTaskCounter}`;
}

function detailString(details: Record<string, unknown> | undefined, key: string) {
  const value = details?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isDocxTranslationFailure(error: AppErrorData) {
  return error.code === 'DOCX_TRANSLATION_FAILED';
}

export class ArticleSummaryTranslationExportService
implements IArticleSummaryTranslationExportServiceContract {
  declare readonly _serviceBrand: undefined;

  private currentTask: ArticleSummaryTranslationExportTask | null = null;

  constructor(
    @INativeHostService private readonly nativeHostService: INativeHostService,
    @INotificationService private readonly notificationService: INotificationService,
    @IDialogService private readonly dialogService: IDialogService,
    @IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
    @IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
    @ISettingsModel private readonly settingsModel: SettingsModel,
    @IFetchService private readonly fetchService: IFetchService,
  ) {}

  readonly dispose = () => {
    this.cancelExportArticleSummaries();
  };

  readonly handleExportArticleSummaries = async (
    articleIds: readonly ArticleId[],
    translateSummaries: boolean,
    onUnavailableArticleIds: (articleIds: readonly ArticleId[]) => void,
  ) => {
    if (this.currentTask) {
      this.cancelExportArticleSummaries();
      return;
    }

    const desktopRuntime = this.nativeHostService.canInvoke();
    const locale = this.localeService.getLocale();
    const ui = this.languageService.getLocaleMessages(locale);
    const pdfDownloadDir = this.settingsModel.getSnapshot().pdfDownloadDir;

    if (!desktopRuntime) {
      return;
    }

    const source = new CancellationTokenSource();
    const taskId = createArticleSummaryTranslationExportTaskId();
    this.currentTask = {
      taskId,
      source,
      restoreStatusbar: () => {},
    };

    let exportArticles: ArticleSummaryExportInput[];
    try {
      exportArticles = await this.resolveArticleSummaries(
        articleIds,
        source.token,
        onUnavailableArticleIds,
        ui,
      );
    } catch (error) {
      if (!source.token.isCancellationRequested) {
        const localizedError = localizeAppError(ui, parseAppErrorData(error));
        this.notificationService.error(
          formatLocaleMessage(ui.toastDocxExportFailed, { error: localizedError }),
        );
      }
      if (this.currentTask?.taskId === taskId) {
        this.currentTask = null;
      }
      source.dispose();
      return;
    }

    if (source.token.isCancellationRequested) {
      if (this.currentTask?.taskId === taskId) {
        this.currentTask = null;
      }
      source.dispose();
      return;
    }

    if (!canExportArticlesDocx(exportArticles.length)) {
      this.notificationService.info(ui.toastNoExportableArticles);
      if (this.currentTask?.taskId === taskId) {
        this.currentTask = null;
      }
      source.dispose();
      return;
    }

    const restoreTranslationStatus = this.beginTranslationStatusbarProgress(
      source.token,
      ui,
    );
    this.currentTask = {
      taskId,
      source,
      restoreStatusbar: restoreTranslationStatus,
    };
    let shouldTranslateSummaries = translateSummaries;
    let targetFilePath = '';

    try {
      while (!source.token.isCancellationRequested) {
        let result: DocxExportResult | null;
        try {
          result = await this.nativeHostService.invoke('export_articles_docx', {
            taskId,
            articles: exportArticles,
            preferredDirectory: resolvePreferredDirectory(pdfDownloadDir),
            targetFilePath: targetFilePath || null,
            translateSummaries: shouldTranslateSummaries,
            locale,
          });
        } catch (exportError) {
          const parsedError = parseAppErrorData(exportError);
          targetFilePath = detailString(parsedError.details, 'filePath') || targetFilePath;

          if (source.token.isCancellationRequested) {
            return;
          }

          if (shouldTranslateSummaries && isDocxTranslationFailure(parsedError)) {
            const choice = await this.promptTranslationFailure(parsedError, source.token, ui);
            if (source.token.isCancellationRequested) {
              return;
            }

            if (choice === 'retry') {
              continue;
            }

            if (choice === 'exportOriginal') {
              shouldTranslateSummaries = false;
              continue;
            }

            return;
          }

          const localizedError = localizeAppError(ui, parsedError);
          this.notificationService.error(
            formatLocaleMessage(ui.toastDocxExportFailed, { error: localizedError }),
          );
          return;
        }

        if (source.token.isCancellationRequested || !result) {
          return;
        }

        this.notificationService.info(
          formatLocaleMessage(ui.toastDocxExported, {
            count: result.articleCount,
            filePath: result.filePath,
          }),
        );
        return;
      }
    } finally {
      const ownsCurrentTask = this.currentTask?.taskId === taskId;
      restoreTranslationStatus(ownsCurrentTask || !this.currentTask);
      if (ownsCurrentTask) {
        this.currentTask = null;
      }
      source.dispose();
    }
  };

  private cancelExportArticleSummaries() {
    const task = this.currentTask;
    if (!task) {
      return;
    }

    task.source.cancel();
    task.source.dispose();
    task.restoreStatusbar(true);
    this.currentTask = null;
    void this.nativeHostService.invoke('cancel_document_task', { taskId: task.taskId })
      .catch((error) => {
        console.warn('Failed to cancel article summary translation task.', error);
      });
  }

  private async resolveArticleSummaries(
    articleIds: readonly ArticleId[],
    token: CancellationToken,
    onUnavailableArticleIds: (articleIds: readonly ArticleId[]) => void,
    ui: LocaleMessages,
  ): Promise<ArticleSummaryExportInput[]> {
    const unavailableArticleIds: ArticleId[] = [];
    const summaries: ArticleSummaryExportInput[] = [];
    for (const articleId of articleIds) {
      if (token.isCancellationRequested) {
        return [];
      }

      const detail = await this.resolveArticleDetail(articleId, token);
      if (token.isCancellationRequested) {
        return [];
      }
      if (!detail) {
        unavailableArticleIds.push(articleId);
        continue;
      }
      summaries.push(this.toArticleSummary(detail));
    }

    if (unavailableArticleIds.length > 0) {
      onUnavailableArticleIds(unavailableArticleIds);
      this.notificationService.info(ui.articleDetailsUnavailable);
    }
    return summaries;
  }

  private async resolveArticleDetail(articleId: ArticleId, token: CancellationToken) {
    if (!this.fetchService.getArticle(articleId)) {
      return null;
    }
    return this.fetchService.getArticleDetail(articleId)
      ?? this.fetchService.fetchArticle(articleId, token);
  }

  private toArticleSummary(article: ArticleDetail): ArticleSummaryExportInput {
    return {
      title: article.title,
      authors: article.authors.map(author => author.name),
      abstract: article.abstract,
      journalTitle: article.publication.title,
      publishedAt: article.publishedAt,
    };
  }

  private async promptTranslationFailure(
    error: AppErrorData,
    token: CancellationToken,
    ui: LocaleMessages,
  ): Promise<ArticleSummaryTranslationFailureChoice> {
    const confirmation = await this.dialogService.prompt<'retry' | 'exportOriginal'>({
      title: ui.translationFailureDialogTitle,
      message: formatLocaleMessage(ui.translationFailureDialogMessage, {
        error: localizeAppError(ui, error),
      }),
      buttons: [
        {
          label: ui.translationFailureDialogRetry,
          result: 'retry',
          primary: true,
        },
        {
          label: ui.translationFailureDialogExportOriginal,
          result: 'exportOriginal',
        },
      ],
      cancelButton: ui.editorModalCancel,
      cancellationToken: token,
    });

    if (confirmation.result === 'retry') {
      return 'retry';
    }

    if (confirmation.result === 'exportOriginal') {
      return 'exportOriginal';
    }

    return 'cancel';
  }

  private beginTranslationStatusbarProgress(
    token: CancellationToken,
    ui: LocaleMessages,
  ) {
    const previousStatus = getStatusbarStateSnapshot();
    const unsubscribe = this.nativeHostService.document?.onTranslationProgress((progress) => {
      if (token.isCancellationRequested) {
        return;
      }
      this.renderTranslationStatusbarProgress(previousStatus, progress, ui);
    });
    let disposed = false;

    return (restoreStatus: boolean) => {
      if (disposed) {
        return;
      }
      disposed = true;
      unsubscribe?.();
      if (restoreStatus) {
        setStatusbarState(previousStatus);
      }
    };
  }

  private renderTranslationStatusbarProgress(
    previousStatus: EditorStatusState,
    progress: DocumentTranslationProgress,
    ui: LocaleMessages,
  ) {
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
              ? formatLocaleMessage(ui.statusTranslationProgress, { current, total })
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

}

registerSingleton(
  IArticleSummaryTranslationExportService,
  ArticleSummaryTranslationExportService,
  InstantiationType.Delayed,
);
