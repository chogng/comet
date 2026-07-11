/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { URI } from 'cs/base/common/uri';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type { PdfDownloadResult, WebContentPdfDownloadPayload } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import type { DocumentActionsControllerContext } from 'cs/workbench/browser/documentActionsModel';
import type { EditorOpenRequest } from 'cs/workbench/services/editor/common/editorOpenTypes';
import type { ArticleDetail, ArticleId, ArticleRecord, IFetchService } from 'cs/workbench/services/fetch/common/fetch';

let cleanupDomEnvironment: (() => void) | null = null;
let createDocumentActionsController: typeof import('cs/workbench/browser/documentActionsModel').createDocumentActionsController;
let locales: typeof import('language/locales').locales;

test.before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ createDocumentActionsController } = await import('cs/workbench/browser/documentActionsModel'));
	({ locales } = await import('language/locales'));
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = null;
});

function createArticleDetail(articleId: ArticleId, overrides: Partial<ArticleDetail> = {}): ArticleDetail {
	return {
		articleId,
		journalId: 'journal.example',
		url: URI.parse(`https://example.com/articles/${articleId}`),
		title: 'Example article',
		subjects: [],
		authors: [{ name: 'Example Author' }],
		publication: { title: 'Example Journal' },
		...overrides,
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

function createInvokeDesktop(): ElectronInvoke {
	return (async (command: string) => {
		throw new Error(`Unexpected desktop command in document actions model test: ${command}`);
	}) as ElectronInvoke;
}

function createSuccessfulDownloadInvoke(payloads: WebContentPdfDownloadPayload[]): ElectronInvoke {
	return (async (command: string, payload?: Record<string, unknown>) => {
		assert.equal(command, 'web_content_download_pdf');
		payloads.push(payload as WebContentPdfDownloadPayload);
		return {
			filePath: 'C:\\Downloads\\article.pdf',
			sourceUrl: String((payload as WebContentPdfDownloadPayload | undefined)?.downloadUrl ?? ''),
			libraryRegistration: null,
		} satisfies PdfDownloadResult;
	}) as ElectronInvoke;
}

function createDocumentActionsContext(
	overrides: Partial<DocumentActionsControllerContext> = {},
): DocumentActionsControllerContext {
	return {
		desktopRuntime: true,
		invokeDesktop: createInvokeDesktop(),
		notificationService: new NoOpNotificationService(),
		locale: 'en',
		ui: locales.en,
		knowledgeBaseEnabled: false,
		pdfDownloadDir: '',
		knowledgeBasePdfDownloadDir: '',
		pdfFileNameUseSelectionOrder: false,
		getExportableArticleIds: () => [],
		onUnavailableArticleIds: () => {},
		onOpenEditor: () => {},
		onExportArticleSummaries: () => {},
		activeDraftExport: null,
		...overrides,
	};
}

test('DocumentActionsController opens an ArticleId in a browser tab', async () => {
	const articleId = 'article.open';
	const openRequests: EditorOpenRequest[] = [];
	const controller = createDocumentActionsController(
		createDocumentActionsContext({ onOpenEditor: request => { openRequests.push(request); } }),
		createFetchService([createArticleDetail(articleId, {
			url: URI.parse('https://www.nature.com/articles/example'),
		})]),
	);

	await controller.handleOpenArticleDetails(articleId);
	controller.dispose();

	assert.equal(openRequests.length, 1);
	const [request] = openRequests;
	assert.equal(request?.kind, 'browser');
	assert.equal(request?.disposition, 'reveal-or-open');
	assert.equal(request?.options?.viewState?.url, 'https://www.nature.com/articles/example');
	assert.ok(request?.resource && BrowserViewUri.getId(request.resource));
});

test('DocumentActionsController delegates checked ArticleIds to DOCX export', async () => {
	const articleId = 'article.export';
	const delegatedExports: Array<{ articleIds: readonly ArticleId[]; translateSummaries: boolean }> = [];
	const controller = createDocumentActionsController(
		createDocumentActionsContext({
			getExportableArticleIds: () => [articleId],
			onExportArticleSummaries: (articleIds, translateSummaries) => {
				delegatedExports.push({ articleIds, translateSummaries });
			},
		}),
		createFetchService([createArticleDetail(articleId)]),
	);

	await controller.handleExportDocx();
	controller.dispose();
	assert.deepEqual(delegatedExports, [{ articleIds: [articleId], translateSummaries: true }]);
});

test('DocumentActionsController uses command-local order for batch PDF titles', async () => {
	const firstId = 'article.first';
	const secondId = 'article.second';
	const payloads: WebContentPdfDownloadPayload[] = [];
	const controller = createDocumentActionsController(
		createDocumentActionsContext({
			invokeDesktop: createSuccessfulDownloadInvoke(payloads),
			pdfFileNameUseSelectionOrder: true,
		}),
		createFetchService([
			createArticleDetail(firstId, { title: 'Checked first' }),
			createArticleDetail(secondId, { title: 'Checked second' }),
		]),
	);

	await controller.handleDownloadAllArticles([firstId, secondId]);
	controller.dispose();
	assert.deepEqual(payloads.map(payload => payload.articleTitle), ['1. Checked first', '2. Checked second']);
});

test('DocumentActionsController removes unavailable ArticleIds through its owner callback', async () => {
	const unavailableArticleIds: ArticleId[][] = [];
	const controller = createDocumentActionsController(
		createDocumentActionsContext({ onUnavailableArticleIds: ids => unavailableArticleIds.push([...ids]) }),
		createFetchService([]),
	);

	await controller.handleSharedPdfDownload('article.missing');
	controller.dispose();
	assert.deepEqual(unavailableArticleIds, [['article.missing']]);
});

test('DocumentActionsController cancels an active ArticleId batch download task', async () => {
	const articleId = 'article.cancel';
	const downloadPayloads: WebContentPdfDownloadPayload[] = [];
	const cancelPayloads: Array<{ taskId?: string }> = [];
	let rejectDownload: ((error: unknown) => void) | null = null;
	const invokeDesktop = (async (command: string, payload?: Record<string, unknown>) => {
		if (command === 'web_content_download_pdf') {
			downloadPayloads.push(payload as WebContentPdfDownloadPayload);
			return new Promise<PdfDownloadResult>((_resolve, reject) => {
				rejectDownload = reject;
			});
		}
		if (command === 'cancel_document_task') {
			cancelPayloads.push(payload as { taskId?: string });
			rejectDownload?.(new Error('Canceled'));
			return true;
		}
		throw new Error(`Unexpected desktop command in cancellation test: ${command}`);
	}) as ElectronInvoke;
	const controller = createDocumentActionsController(
		createDocumentActionsContext({ invokeDesktop }),
		createFetchService([createArticleDetail(articleId)]),
	);

	const running = controller.handleDownloadAllArticles([articleId]);
	await delay(0);
	await controller.handleDownloadAllArticles([articleId]);
	await running;
	controller.dispose();

	assert.equal(typeof downloadPayloads[0]?.taskId, 'string');
	assert.deepEqual(cancelPayloads, [{ taskId: downloadPayloads[0]?.taskId }]);
	assert.equal(controller.getSnapshot().downloadAllProgress, null);
});
