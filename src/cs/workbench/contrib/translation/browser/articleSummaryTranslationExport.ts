/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { toast } from 'cs/base/browser/ui/toast/toast';
import type {
  DocumentTranslationProgress,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';
import type { Locale } from 'language/i18n';
import type { LocaleMessages } from 'language/locales';
import type { Article } from 'cs/workbench/services/article/articleFetch';
import {
  canExportArticlesDocx,
  resolvePreferredDirectory,
} from 'cs/workbench/services/document/documentActionService';
import {
  formatLocalized,
  localizeDesktopInvokeError,
  parseDesktopInvokeError,
} from 'cs/workbench/services/desktop/desktopError';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import {
  getStatusbarStateSnapshot,
  setStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarModel';

export type ArticleSummaryTranslationExportControllerContext = {
  desktopRuntime: boolean;
  invokeDesktop: ElectronInvoke;
  nativeHost: INativeHostService;
  locale: Locale;
  ui: LocaleMessages;
  pdfDownloadDir: string;
};

export class ArticleSummaryTranslationExportController {
  private context: ArticleSummaryTranslationExportControllerContext;

  constructor(context: ArticleSummaryTranslationExportControllerContext) {
    this.context = context;
  }

  readonly setContext = (context: ArticleSummaryTranslationExportControllerContext) => {
    this.context = context;
  };

  readonly handleExportArticleSummaries = async (articles: readonly Article[]) => {
    const {
      desktopRuntime,
      invokeDesktop,
      locale,
      ui,
      pdfDownloadDir,
    } = this.context;

    if (!desktopRuntime) {
      return;
    }

    const exportArticles = [...articles];
    if (!canExportArticlesDocx(exportArticles.length)) {
      toast.info(ui.toastNoExportableArticles);
      return;
    }

    const restoreTranslationStatus = this.beginTranslationStatusbarProgress();
    try {
      const result = await invokeDesktop('export_articles_docx', {
        articles: exportArticles,
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
}

export function createArticleSummaryTranslationExportController(
  context: ArticleSummaryTranslationExportControllerContext,
) {
  return new ArticleSummaryTranslationExportController(context);
}
