import type {
  WebContentHtmlArchiveResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { LocaleMessages } from 'language/locales';
import type { EditorPartBrowserToolbarActions } from 'cs/workbench/browser/parts/editor/editorPartView';
import { getEditorContentDisplayUrl } from 'cs/workbench/browser/parts/editor/editorUrlPresentation';
import type { INotificationService } from 'cs/platform/notification/common/notification';

type EditorBrowserToolbarActionHandlers = EditorPartBrowserToolbarActions;

type CreateEditorBrowserToolbarActionsParams = {
  browserUrl: string;
  browserPageTitle?: string;
  invokeDesktop: ElectronInvoke;
  notificationService: INotificationService;
  knowledgeBaseEnabled: boolean;
  ui: LocaleMessages;
  onLibraryUpdated?: () => void | Promise<void>;
  onOpenAddressBarSourceMenu: () => void;
  onToolbarExportDocx?: () => void | Promise<void>;
};

async function copyTextToClipboard(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.focus();
  textarea.select();

  try {
    const copied = document.execCommand('copy');
    if (!copied) {
      throw new Error('Clipboard copy command was rejected.');
    }
  } finally {
    textarea.remove();
  }
}

export function createEditorBrowserToolbarActions(
  params: CreateEditorBrowserToolbarActionsParams,
): EditorBrowserToolbarActionHandlers {
  const {
    browserUrl,
    browserPageTitle,
    invokeDesktop,
    notificationService,
    knowledgeBaseEnabled,
    ui,
    onLibraryUpdated,
    onOpenAddressBarSourceMenu,
    onToolbarExportDocx = () => {},
  } = params;

  return {
    onOpenAddressBarSourceMenu,
    onToolbarArchiveCurrentPage: async () => {
      try {
        const result = await invokeDesktop<WebContentHtmlArchiveResult>(
          'web_content_archive_html',
          {
            pageUrl: browserUrl,
            pageTitle: browserPageTitle || null,
          },
        );
        if (knowledgeBaseEnabled && result.pdfPath) {
          void onLibraryUpdated?.();
        }

        notificationService.info(
          (result.pdfPath
            ? ui.toastHtmlArchiveSavedWithPdf
            : ui.toastHtmlArchiveSavedWithoutPdf)
            .replace('{filePath}', result.filePath)
            .replace('{sourceUrl}', result.sourceUrl),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? 'Unknown archive error');
        notificationService.error(ui.toastHtmlArchiveSaveFailed.replace('{error}', message));
      }
    },
    onToolbarExportDocx: () => {
      void onToolbarExportDocx();
    },
    onToolbarCopyCurrentUrl: async () => {
      const currentUrl = getEditorContentDisplayUrl(browserUrl);
      if (!currentUrl) {
        return;
      }

      try {
        await copyTextToClipboard(currentUrl);
        notificationService.info(ui.toastCurrentUrlCopied);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? 'Unknown clipboard error');
        notificationService.error(ui.toastCurrentUrlCopyFailed.replace('{error}', message));
      }
    },
    onToolbarClearBrowsingHistory: () => {
      notificationService.info(ui.toastBrowsingHistoryCleared);
    },
    onToolbarClearCookies: async () => {
      try {
        const cleared = await invokeDesktop<boolean>('clear_web_cookies');
        if (!cleared) {
          throw new Error(ui.toastWebContentRuntimeUnavailable);
        }
        notificationService.info(ui.toastCookiesCleared);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? 'Unknown cookie error');
        notificationService.error(ui.toastCookiesClearFailed.replace('{error}', message));
      }
    },
    onToolbarClearCache: async () => {
      try {
        const cleared = await invokeDesktop<boolean>('clear_web_cache');
        if (!cleared) {
          throw new Error(ui.toastWebContentRuntimeUnavailable);
        }
        notificationService.info(ui.toastCacheCleared);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error ?? 'Unknown cache error');
        notificationService.error(ui.toastCacheClearFailed.replace('{error}', message));
      }
    },
  };
}
