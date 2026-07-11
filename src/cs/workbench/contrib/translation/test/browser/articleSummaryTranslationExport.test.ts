/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { URI } from 'cs/base/common/uri';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type { DocumentTranslationProgress } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { ArticleDetail, ArticleId, ArticleRecord, IFetchService } from 'cs/workbench/services/fetch/common/fetch';

let cleanupDomEnvironment: (() => void) | null = null;
let createArticleSummaryTranslationExportController: typeof import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport').createArticleSummaryTranslationExportController;
let getStatusbarStateSnapshot: typeof import('cs/workbench/browser/parts/statusbar/statusbarModel').getStatusbarStateSnapshot;
let setStatusbarState: typeof import('cs/workbench/browser/parts/statusbar/statusbarModel').setStatusbarState;
let locales: typeof import('language/locales').locales;
let BrowserDialogService: typeof import('cs/workbench/services/dialogs/browser/dialogService').BrowserDialogService;

test.before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ createArticleSummaryTranslationExportController } = await import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport'));
	({ getStatusbarStateSnapshot, setStatusbarState } = await import('cs/workbench/browser/parts/statusbar/statusbarModel'));
	({ locales } = await import('language/locales'));
	({ BrowserDialogService } = await import('cs/workbench/services/dialogs/browser/dialogService'));
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

function createArticleDetail(articleId: ArticleId): ArticleDetail {
	return {
		articleId,
		journalId: 'journal.example',
		url: URI.parse(`https://example.com/articles/${articleId}`),
		doi: `10.1000/${articleId}`,
		title: 'Example article',
		abstract: 'An abstract',
		subjects: [],
		authors: [{ name: 'Example Author' }],
		publishedAt: '2026-07-04',
		publication: { title: 'Example Journal' },
	};
}

function createFetchService(details: readonly ArticleDetail[]): IFetchService {
	const detailById = new Map(details.map(detail => [detail.articleId, detail]));
	return {
		getArticle: (articleId: ArticleId) => {
			const detail = detailById.get(articleId);
			return detail
				? { id: articleId, journalId: detail.journalId, url: detail.url, doi: detail.doi } satisfies ArticleRecord
				: undefined;
		},
		getArticleDetail: (articleId: ArticleId) => detailById.get(articleId),
		fetchArticle: async (articleId: ArticleId) => {
			const detail = detailById.get(articleId);
			if (!detail) {
				throw new Error(`Unknown article: ${articleId}`);
			}
			return detail;
		},
	} as unknown as IFetchService;
}

function createNativeHostService(
	documentApi: NonNullable<INativeHostService['document']>,
	invoke: ElectronInvoke,
): INativeHostService {
	return {
		_serviceBrand: undefined,
		canInvoke: () => true,
		invoke,
		ipc: undefined,
		windowControls: undefined,
		webContent: undefined,
		document: documentApi,
	};
}

function createDialogService() {
	return new BrowserDialogService();
}

test('ArticleSummaryTranslationExportController resolves ArticleIds to DOCX DTOs and restores progress', async () => {
	const articleId = 'article.export';
	const previousStatus: EditorStatusState = {
		ariaLabel: 'Status',
		paneMode: 'browser',
		summary: 'Ready',
		leftItems: [{ id: 'existing', label: 'Mode', value: 'PDF' }],
		rightItems: [],
	};
	setStatusbarState(previousStatus);
	let progressListener: ((progress: DocumentTranslationProgress) => void) | null = null;
	let unsubscribed = false;
	const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
	const invoke = (async (command: string, args?: Record<string, unknown>) => {
		invoked.push({ command, args });
		progressListener?.({
			phase: 'batch', current: 1, total: 1,
			provider: 'translation:deepl', model: 'translate-to-zh-hans', message: null,
		});
		assert.equal(getStatusbarStateSnapshot().summary, 'Translating 1/1');
		return { articleCount: 1, filePath: '/tmp/articles.docx' };
	}) as ElectronInvoke;
	const controller = createArticleSummaryTranslationExportController({
		desktopRuntime: true,
		invokeDesktop: invoke,
		nativeHost: createNativeHostService({
			onTranslationProgress: listener => {
				progressListener = listener;
				return () => { unsubscribed = true; progressListener = null; };
			},
		}, invoke),
		notificationService: new NoOpNotificationService(),
		dialogService: createDialogService(),
		locale: 'en',
		ui: locales.en,
		pdfDownloadDir: '/tmp',
		onUnavailableArticleIds: () => {},
	}, createFetchService([createArticleDetail(articleId)]));

	await controller.handleExportArticleSummaries([articleId], true);
	controller.dispose();

	assert.equal(unsubscribed, true);
	assert.deepEqual(getStatusbarStateSnapshot(), previousStatus);
	assert.deepEqual(invoked[0]?.args, {
		taskId: invoked[0]?.args?.taskId,
		articles: [{
			title: 'Example article',
			authors: ['Example Author'],
			abstract: 'An abstract',
			journalTitle: 'Example Journal',
			publishedAt: '2026-07-04',
		}],
		preferredDirectory: '/tmp',
		targetFilePath: null,
		translateSummaries: true,
		locale: 'en',
	});
});

test('ArticleSummaryTranslationExportController removes unavailable ArticleIds before export', async () => {
	const unavailable: ArticleId[][] = [];
	let invoked = false;
	const invoke = (async () => {
		invoked = true;
		return null;
	}) as ElectronInvoke;
	const controller = createArticleSummaryTranslationExportController({
		desktopRuntime: true,
		invokeDesktop: invoke,
		nativeHost: createNativeHostService({ onTranslationProgress: () => () => {} }, invoke),
		notificationService: new NoOpNotificationService(),
		dialogService: createDialogService(),
		locale: 'en',
		ui: locales.en,
		pdfDownloadDir: '/tmp',
		onUnavailableArticleIds: ids => unavailable.push([...ids]),
	}, createFetchService([]));

	await controller.handleExportArticleSummaries(['article.missing'], false);
	controller.dispose();
	assert.deepEqual(unavailable, [['article.missing']]);
	assert.equal(invoked, false);
});

test('ArticleSummaryTranslationExportController cancels an active export task', async () => {
	const articleId = 'article.cancel';
	let rejectExport: ((error: unknown) => void) | null = null;
	const invoked: Array<{ command: string; args: Record<string, unknown> | undefined }> = [];
	const invoke = (async (command: string, args?: Record<string, unknown>) => {
		invoked.push({ command, args });
		if (command === 'export_articles_docx') {
			return new Promise((_resolve, reject) => { rejectExport = reject; });
		}
		if (command === 'cancel_document_task') {
			rejectExport?.(new Error('Canceled'));
			return true;
		}
		throw new Error(`Unexpected desktop command: ${command}`);
	}) as ElectronInvoke;
	const controller = createArticleSummaryTranslationExportController({
		desktopRuntime: true,
		invokeDesktop: invoke,
		nativeHost: createNativeHostService({ onTranslationProgress: () => () => {} }, invoke),
		notificationService: new NoOpNotificationService(),
		dialogService: createDialogService(),
		locale: 'en',
		ui: locales.en,
		pdfDownloadDir: '/tmp',
		onUnavailableArticleIds: () => {},
	}, createFetchService([createArticleDetail(articleId)]));

	const running = controller.handleExportArticleSummaries([articleId], true);
	await delay(0);
	await controller.handleExportArticleSummaries([articleId], true);
	await running;
	controller.dispose();

	const exportArgs = invoked.find(entry => entry.command === 'export_articles_docx')?.args;
	const cancelArgs = invoked.find(entry => entry.command === 'cancel_document_task')?.args;
	assert.deepEqual(cancelArgs, { taskId: exportArgs?.taskId });
	assert.equal(controller.getSnapshot().translationExportProgress, null);
});
