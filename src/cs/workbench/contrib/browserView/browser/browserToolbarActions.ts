/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
  WebContentHtmlArchiveResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronInvoke,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { LocaleMessages } from 'language/locales';
import { getEditorContentDisplayUrl } from 'cs/workbench/contrib/browserView/browser/browserUrlPresentation';
import type { INotificationService } from 'cs/platform/notification/common/notification';
import type { BrowserEditorToolbarActions } from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';

type CreateEditorBrowserToolbarActionsParams = {
	browserViewId: string;
	browserUrl: string;
	invokeDesktop: ElectronInvoke;
	notificationService: INotificationService;
	knowledgeBaseEnabled: boolean;
	ui: LocaleMessages;
	onLibraryUpdated?: () => void | Promise<void>;
	onOpenAddressBarSourceMenu: () => void;
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
): BrowserEditorToolbarActions {
	const {
		browserViewId,
		browserUrl,
		invokeDesktop,
		notificationService,
		knowledgeBaseEnabled,
		ui,
		onLibraryUpdated,
		onOpenAddressBarSourceMenu,
	} = params;

	return {
		onOpenSources: onOpenAddressBarSourceMenu,
		onArchiveCurrentPage: async () => {
			try {
				const result = await invokeDesktop<WebContentHtmlArchiveResult>(
					'web_content_archive_html',
					{
						browserViewId,
						pageUrl: browserUrl,
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
		onCopyCurrentUrl: async () => {
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
		onClearBrowsingHistory: () => {
      notificationService.info(ui.toastBrowsingHistoryCleared);
    },
		onClearCookies: async () => {
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
		onClearCache: async () => {
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
  } satisfies BrowserEditorToolbarActions;
}
