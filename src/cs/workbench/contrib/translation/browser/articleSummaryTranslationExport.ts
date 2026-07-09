/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'cs/base/common/cancellation';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter } from 'cs/base/common/event';
import type {
  DocumentTranslationProgress,
  DocxExportResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import type { Article } from 'cs/workbench/services/fetch/browser/articleFetch';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
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
import type { ArticleBatchTaskProgress } from 'cs/workbench/browser/articleBatchTask';
import type { INotificationService } from 'cs/platform/notification/common/notification';

export type ArticleSummaryTranslationExportControllerContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
  nativeHost: INativeHostService;
  notificationService: INotificationService;
  dialogService: IDialogService;
  locale: Locale;
  ui: LocaleMessages;
  pdfDownloadDir: string;
};

export type ArticleSummaryTranslationExportControllerSnapshot = {
  translationExportProgress: ArticleBatchTaskProgress | null;
};

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

function createSnapshot(
  translationExportProgress: ArticleBatchTaskProgress | null = null,
): ArticleSummaryTranslationExportControllerSnapshot {
  return {
    translationExportProgress,
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

function detailString(details: Record<string, unknown> | undefined, key: string) {
  const value = details?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : '';
}

function isDocxTranslationFailure(error: AppErrorData) {
  return error.code === 'DOCX_TRANSLATION_FAILED';
}

export class ArticleSummaryTranslationExportController {
  private context: ArticleSummaryTranslationExportControllerContext;
  private snapshot = createSnapshot();
  private currentTask: ArticleSummaryTranslationExportTask | null = null;
  private readonly onDidChangeEmitter = new EventEmitter<void>();

  constructor(context: ArticleSummaryTranslationExportControllerContext) {
    this.context = context;
  }

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  readonly setContext = (context: ArticleSummaryTranslationExportControllerContext) => {
    this.context = context;
  };

  readonly dispose = () => {
    this.currentTask?.source.cancel();
    this.currentTask?.source.dispose();
    this.currentTask?.restoreStatusbar(true);
    this.currentTask = null;
    this.onDidChangeEmitter.dispose();
  };

  readonly handleExportArticleSummaries = async (
    articles: readonly Article[],
    translateSummaries: boolean,
  ) => {
    if (this.currentTask) {
      this.cancelExportArticleSummaries();
      return;
    }

    const {
      desktopRuntime,
      invokeDesktop,
      locale,
      ui,
      pdfDownloadDir,
      notificationService,
    } = this.context;

    if (!desktopRuntime) {
      return;
    }

    const exportArticles = [...articles];
    if (!canExportArticlesDocx(exportArticles.length)) {
      notificationService.info(ui.toastNoExportableArticles);
      return;
    }

    const source = new CancellationTokenSource();
    const taskId = createArticleSummaryTranslationExportTaskId();
    const restoreTranslationStatus = this.beginTranslationStatusbarProgress(
      source.token,
      exportArticles.length,
    );
    this.currentTask = {
      taskId,
      source,
      restoreStatusbar: restoreTranslationStatus,
    };
    this.setTranslationExportProgress({
      phase: 'running',
      current: 0,
      total: exportArticles.length,
    });

    let shouldTranslateSummaries = translateSummaries;
    let targetFilePath = '';

    try {
      while (!source.token.isCancellationRequested) {
        let result: DocxExportResult | null;
        try {
          result = await invokeDesktop('export_articles_docx', {
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
            const choice = await this.promptTranslationFailure(parsedError, source.token);
            if (source.token.isCancellationRequested) {
              return;
            }

            if (choice === 'retry') {
              this.setTranslationExportProgress({
                phase: 'running',
                current: 0,
                total: exportArticles.length,
              });
              continue;
            }

            if (choice === 'exportOriginal') {
              shouldTranslateSummaries = false;
              this.setTranslationExportProgress({
                phase: 'running',
                current: exportArticles.length,
                total: exportArticles.length,
              });
              continue;
            }

            return;
          }

          const localizedError = localizeAppError(ui, parsedError);
          notificationService.error(
            formatLocaleMessage(ui.toastDocxExportFailed, { error: localizedError }),
          );
          return;
        }

        if (source.token.isCancellationRequested || !result) {
          return;
        }

        notificationService.info(
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
        this.setTranslationExportProgress(null);
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
    task.restoreStatusbar(true);
    this.currentTask = null;
    this.setTranslationExportProgress(null);
    void this.context.invokeDesktop('cancel_document_task', { taskId: task.taskId })
      .catch((error) => {
        console.warn('Failed to cancel article summary translation task.', error);
      });
  }

  private async promptTranslationFailure(
    error: AppErrorData,
    token: CancellationToken,
  ): Promise<ArticleSummaryTranslationFailureChoice> {
    const { dialogService, ui } = this.context;
    const confirmation = await dialogService.prompt<'retry' | 'exportOriginal'>({
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
    initialTotal: number,
  ) {
    const previousStatus = getStatusbarStateSnapshot();
    const unsubscribe = this.context.nativeHost.document?.onTranslationProgress((progress) => {
      if (token.isCancellationRequested) {
        return;
      }
      this.renderTranslationStatusbarProgress(previousStatus, progress);
      this.setTranslationExportProgress(this.resolveTranslationExportProgress(progress, initialTotal));
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

  private resolveTranslationExportProgress(
    progress: DocumentTranslationProgress,
    initialTotal: number,
  ): ArticleBatchTaskProgress {
    const total = Math.max(0, progress.total || initialTotal);
    const current =
      progress.phase === 'completed'
        ? total
        : Math.max(0, Math.min(progress.current, total));
    return {
      phase: 'running',
      current,
      total,
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

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }

  private setTranslationExportProgress(progress: ArticleBatchTaskProgress | null) {
    const nextSnapshot = createSnapshot(progress);
    if (
      sameArticleBatchTaskProgress(
        this.snapshot.translationExportProgress,
        nextSnapshot.translationExportProgress,
      )
    ) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.emitChange();
  }
}

export function createArticleSummaryTranslationExportController(
  context: ArticleSummaryTranslationExportControllerContext,
) {
  return new ArticleSummaryTranslationExportController(context);
}
