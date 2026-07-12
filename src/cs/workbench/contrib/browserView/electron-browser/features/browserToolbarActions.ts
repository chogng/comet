/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize2 } from 'cs/nls';
import { Action2, registerAction2 } from 'cs/platform/actions/common/actions';
import { BrowserViewCommandId } from 'cs/platform/browserView/common/browserView';
import type { ServicesAccessor } from 'cs/platform/instantiation/common/instantiation';
import { INativeHostService } from 'cs/platform/native/common/native';
import { INotificationService } from 'cs/platform/notification/common/notification';
import { getEditorContentDisplayUrl } from 'cs/workbench/contrib/browserView/browser/browserUrlPresentation';
import {
	BrowserActionCategory,
	BrowserEditor,
} from 'cs/workbench/contrib/browserView/electron-browser/browserEditor';
import { BrowserHistoryFeature } from 'cs/workbench/contrib/browserView/electron-browser/features/browserHistoryFeature';
import { ILibraryModel } from 'cs/workbench/services/knowledgeBase/libraryModel';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import { ISettingsModel } from 'cs/workbench/services/settings/settingsModel';

function requireBrowserEditor(
	candidate: unknown,
): BrowserEditor {
	if (!(candidate instanceof BrowserEditor)) {
		throw new Error('The Browser toolbar action target is not a Browser editor.');
	}
	return candidate;
}

function requireAttachedBrowserEditor(candidate: unknown): BrowserEditor {
	const editor = requireBrowserEditor(candidate);
	if (!editor.input || !editor.model) {
		throw new Error('The Browser toolbar action target has no attached input and model.');
	}
	return editor;
}

function getUi(accessor: ServicesAccessor) {
	const localeService = accessor.get(IWorkbenchLocaleService);
	return accessor.get(IWorkbenchLanguageService).getLocaleMessages(
		localeService.getLocale(),
	);
}

function getErrorMessage(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

class ArchiveBrowserPageAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.ArchivePage,
			title: localize2('browser.archivePage', "Archive Page"),
			category: BrowserActionCategory,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		const editor = requireAttachedBrowserEditor(candidate);
		const input = editor.input!;
		const model = editor.model!;
		const browserViewId = input.id;
		const pageUrl = model.url;
		if (!pageUrl) {
			throw new Error('The Browser toolbar action target has no current URL.');
		}
		const nativeHostService = accessor.get(INativeHostService);
		const notificationService = accessor.get(INotificationService);
		const knowledgeBaseEnabled = accessor.get(ISettingsModel).getSnapshot().knowledgeBaseEnabled;
		const ui = getUi(accessor);

		try {
			if (!nativeHostService.canInvoke()) {
				throw new Error(ui.toastWebContentRuntimeUnavailable);
			}
			const result = await nativeHostService.invoke('web_content_archive_html', {
				browserViewId,
				pageUrl,
			});
			if (knowledgeBaseEnabled && result.pdfPath) {
				void accessor.get(ILibraryModel).refresh();
			}
			notificationService.info(
				(result.pdfPath
					? ui.toastHtmlArchiveSavedWithPdf
					: ui.toastHtmlArchiveSavedWithoutPdf)
					.replace('{filePath}', result.filePath)
					.replace('{sourceUrl}', result.sourceUrl),
			);
		} catch (error) {
			notificationService.error(
				ui.toastHtmlArchiveSaveFailed.replace('{error}', getErrorMessage(error)),
			);
		}
	}
}

class CopyBrowserUrlAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.CopyCurrentUrl,
			title: localize2('browser.copyCurrentUrl', "Copy Current URL"),
			category: BrowserActionCategory,
			f1: false,
		});
	}

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		const editor = requireAttachedBrowserEditor(candidate);
		const currentUrl = getEditorContentDisplayUrl(editor.model!.url);
		if (!currentUrl) {
			throw new Error('The Browser toolbar action target has no current URL.');
		}
		const notificationService = accessor.get(INotificationService);
		const ui = getUi(accessor);
		try {
			if (!navigator.clipboard?.writeText) {
				throw new Error(ui.errorClipboardApiUnavailable);
			}
			await navigator.clipboard.writeText(currentUrl);
			notificationService.info(ui.toastCurrentUrlCopied);
		} catch (error) {
			notificationService.error(
				ui.toastCurrentUrlCopyFailed.replace('{error}', getErrorMessage(error)),
			);
		}
	}
}

class ClearBrowserHistoryAction extends Action2 {
	constructor() {
		super({
			id: BrowserViewCommandId.ClearBrowsingHistory,
			title: localize2('browser.clearBrowsingHistory', "Clear Browsing History"),
			category: BrowserActionCategory,
			f1: false,
		});
	}

	run(accessor: ServicesAccessor, candidate?: unknown): void {
		const editor = requireBrowserEditor(candidate);
		const history = editor.getContribution(BrowserHistoryFeature);
		if (!history) {
			throw new Error('The Browser editor has no history contribution.');
		}
		history.clear();
		accessor.get(INotificationService).info(getUi(accessor).toastBrowsingHistoryCleared);
	}
}

abstract class ClearBrowserDataAction extends Action2 {
	protected abstract readonly command: 'clear_web_cookies' | 'clear_web_cache';
	protected abstract getSuccessMessage(ui: ReturnType<typeof getUi>): string;
	protected abstract getFailureMessage(ui: ReturnType<typeof getUi>): string;

	async run(accessor: ServicesAccessor, candidate?: unknown): Promise<void> {
		requireBrowserEditor(candidate);
		const nativeHostService = accessor.get(INativeHostService);
		const notificationService = accessor.get(INotificationService);
		const ui = getUi(accessor);
		try {
			if (!nativeHostService.canInvoke()) {
				throw new Error(ui.toastWebContentRuntimeUnavailable);
			}
			const cleared = await nativeHostService.invoke(this.command);
			if (!cleared) {
				throw new Error(ui.toastWebContentRuntimeUnavailable);
			}
			notificationService.info(this.getSuccessMessage(ui));
		} catch (error) {
			notificationService.error(
				this.getFailureMessage(ui).replace('{error}', getErrorMessage(error)),
			);
		}
	}
}

class ClearBrowserCookiesAction extends ClearBrowserDataAction {
	protected readonly command = 'clear_web_cookies' as const;

	constructor() {
		super({
			id: BrowserViewCommandId.ClearCookies,
			title: localize2('browser.clearCookies', "Clear Cookies"),
			category: BrowserActionCategory,
			f1: false,
		});
	}

	protected getSuccessMessage(ui: ReturnType<typeof getUi>): string {
		return ui.toastCookiesCleared;
	}

	protected getFailureMessage(ui: ReturnType<typeof getUi>): string {
		return ui.toastCookiesClearFailed;
	}
}

class ClearBrowserCacheAction extends ClearBrowserDataAction {
	protected readonly command = 'clear_web_cache' as const;

	constructor() {
		super({
			id: BrowserViewCommandId.ClearCache,
			title: localize2('browser.clearCache', "Clear Cache"),
			category: BrowserActionCategory,
			f1: false,
		});
	}

	protected getSuccessMessage(ui: ReturnType<typeof getUi>): string {
		return ui.toastCacheCleared;
	}

	protected getFailureMessage(ui: ReturnType<typeof getUi>): string {
		return ui.toastCacheClearFailed;
	}
}

registerAction2(ArchiveBrowserPageAction);
registerAction2(CopyBrowserUrlAction);
registerAction2(ClearBrowserHistoryAction);
registerAction2(ClearBrowserCookiesAction);
registerAction2(ClearBrowserCacheAction);
