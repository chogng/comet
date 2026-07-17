/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { DeferredPromise } from 'cs/base/common/async';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type {
	EditorDocxExportResult,
	PdfDownloadResult,
	WebContentPdfDownloadPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { URI } from 'cs/base/common/uri';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import { formatLocaleMessage } from 'cs/workbench/common/errorMessages';
import { getPdfDownloadStatus } from 'cs/workbench/services/document/pdfDownloadStatus';
import {
	IDocumentActionsService,
	type IArticleSelectionSnapshot,
} from 'cs/workbench/services/document/common/documentActions';
import type {
	ArticleDetail,
	ArticleId,
	ArticleRecord,
	IFetchService,
} from 'cs/workbench/services/fetch/common/fetch';
import { locales } from 'language/locales';

let cleanupDomEnvironment: (() => void) | undefined;
let DocumentActionsServiceConstructor:
	typeof import('cs/workbench/services/document/browser/documentActionsService').DocumentActionsService;

test.before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({ DocumentActionsService: DocumentActionsServiceConstructor } = await import(
		'cs/workbench/services/document/browser/documentActionsService'
	));
});

test.after(() => {
	cleanupDomEnvironment?.();
	cleanupDomEnvironment = undefined;
});

function createArticleDetail(articleId: ArticleId, overrides: Partial<ArticleDetail> = {}): ArticleDetail {
	return {
		articleId,
		journalId: 'journal.example',
		url: URI.parse(`https://example.com/articles/${articleId}`),
		pdfUrl: URI.parse(`https://example.com/articles/${articleId}.pdf`),
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

class TestNotificationService extends NoOpNotificationService {
	readonly infos: string[] = [];
	readonly errors: string[] = [];

	override info(message: string): void {
		this.infos.push(message);
	}

	override error(message: string): void {
		this.errors.push(message);
	}
}

type CreateServiceOptions = {
	readonly canInvoke?: boolean;
	readonly invokeDesktop?: ElectronInvoke;
	readonly fetchService?: IFetchService;
	readonly notificationService?: TestNotificationService;
	readonly localeState?: { value: 'en' | 'zh' };
	readonly settings?: {
		readonly knowledgeBaseEnabled?: boolean;
		readonly pdfDownloadDir?: string;
		readonly knowledgeBasePdfDownloadDir?: string;
		readonly pdfFileNameUseSelectionOrder?: boolean;
	};
};

function createUnexpectedInvoke(): ElectronInvoke {
	return (async (command: string) => {
		throw new Error(`Unexpected desktop command in DocumentActionsService test: ${command}`);
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

function createService(options: CreateServiceOptions = {}) {
	const articleExports: Array<{
		articleIds: readonly ArticleId[];
		translateSummaries: boolean;
		onUnavailableArticleIds: (articleIds: readonly ArticleId[]) => void;
	}> = [];
	const notificationService = options.notificationService ?? new TestNotificationService();
	const localeState = options.localeState ?? { value: 'en' as const };
	const libraryRefreshes: true[] = [];
	const libraryUpserts: unknown[] = [];
	const settings = {
		knowledgeBaseEnabled: false,
		pdfDownloadDir: '',
		knowledgeBasePdfDownloadDir: '',
		pdfFileNameUseSelectionOrder: false,
		...options.settings,
	};
	const service = new DocumentActionsServiceConstructor(
		{
			canInvoke: () => options.canInvoke ?? true,
			invoke: options.invokeDesktop ?? createUnexpectedInvoke(),
		} as never,
		notificationService,
		{
			getLocale: () => localeState.value,
		} as never,
		{
			getLocaleMessages: (locale: 'en' | 'zh') => locales[locale],
		} as never,
		{
			getSnapshot: () => settings,
		} as never,
		options.fetchService ?? createFetchService([]),
		{
			upsertDocumentSummary: (document: unknown) => { libraryUpserts.push(document); },
			refresh: async () => { libraryRefreshes.push(true); },
		} as never,
		{
			handleExportArticleSummaries: async (
				articleIds: readonly ArticleId[],
				translateSummaries: boolean,
				onUnavailableArticleIds: (articleIds: readonly ArticleId[]) => void,
			) => {
				articleExports.push({
					articleIds: [...articleIds],
					translateSummaries,
					onUnavailableArticleIds,
				});
			},
		} as never,
	);
	return {
		service,
		articleExports,
		notificationService,
		settings,
		localeState,
		libraryRefreshes,
		libraryUpserts,
	};
}

test('DocumentActionsService is registered once with delayed instantiation', () => {
	const registrations = getSingletonServiceDescriptors().filter(([id]) => id === IDocumentActionsService);
	assert.equal(registrations.length, 1);
	assert.equal(registrations[0]?.[1].supportsDelayedInstantiation, true);
});

test('DocumentActionsService exports one explicit Article selection', async () => {
	const selection: IArticleSelectionSnapshot = {
		resource: URI.from({ scheme: 'chat', path: '/export' }),
		articleIds: ['article.export'],
	};
	const { service, articleExports } = createService();

	await service.exportArticleSummaries(selection);
	service.dispose();

	assert.deepEqual(
		articleExports.map(({ articleIds, translateSummaries }) => ({ articleIds, translateSummaries })),
		[{ articleIds: ['article.export'], translateSummaries: true }],
	);
});

test('DocumentActionsService does not own Feature selection returned as unavailable', async () => {
	const initialResource = URI.from({ scheme: 'chat', path: '/initial-selection' });
	const replacementResource = URI.from({ scheme: 'chat', path: '/replacement-selection' });
	const { service, articleExports } = createService();

	await service.exportArticleSummaries({ resource: initialResource, articleIds: ['article.initial'] });
	await service.exportArticleSummaries({ resource: replacementResource, articleIds: ['article.replacement'] });
	articleExports[0]?.onUnavailableArticleIds(['article.initial-missing']);
	service.dispose();

	assert.equal(articleExports.length, 2);
});

test('DocumentActionsService accepts unavailable export completion after disposal without owning selection', async () => {
	const resource = URI.from({ scheme: 'chat', path: '/disposed-export' });
	const { service, articleExports } = createService();

	await service.exportArticleSummaries({ resource, articleIds: ['article.pending'] });
	service.dispose();
	articleExports[0]?.onUnavailableArticleIds(['article.pending']);

	assert.equal(articleExports.length, 1);
});

test('DocumentActionsService exports an explicit Draft without invoking Article export', async () => {
	const invoked: string[] = [];
	const invokeDesktop = (async (command: string) => {
		invoked.push(command);
		return {
			title: 'Draft',
			filePath: '/tmp/Draft.docx',
		};
	}) as ElectronInvoke;
	const { service, articleExports } = createService({ invokeDesktop });

	await service.exportDraftDocument({
		title: 'Draft',
		document: { type: 'doc', content: [] },
	});
	service.dispose();

	assert.deepEqual(invoked, ['export_editor_docx']);
	assert.deepEqual(articleExports, []);
});

test('DocumentActionsService uses operation-local order for batch PDF titles', async () => {
	const firstId = 'article.first';
	const secondId = 'article.second';
	const payloads: WebContentPdfDownloadPayload[] = [];
	const { service, settings } = createService({
		invokeDesktop: createSuccessfulDownloadInvoke(payloads),
		settings: { pdfFileNameUseSelectionOrder: true },
		fetchService: createFetchService([
			createArticleDetail(firstId, { title: 'Checked first' }),
			createArticleDetail(secondId, { title: 'Checked second' }),
		]),
	});

	const running = service.downloadArticlePdfs({
		resource: URI.from({ scheme: 'chat', path: '/batch' }),
		articleIds: [firstId, secondId],
	});
	settings.pdfFileNameUseSelectionOrder = false;
	await running;
	service.dispose();

	assert.deepEqual(payloads.map(payload => payload.articleTitle), ['1. Checked first', '2. Checked second']);
});

test('DocumentActionsService sends the Article Detail PDF URL to the download boundary', async () => {
	const articleId = 'article.pdf-url';
	const payloads: WebContentPdfDownloadPayload[] = [];
	const detailPdfUrl = 'https://cdn.example.com/authoritative/article-file.pdf';
	const { service } = createService({
		invokeDesktop: createSuccessfulDownloadInvoke(payloads),
		fetchService: createFetchService([createArticleDetail(articleId, {
			url: URI.parse('https://www.nature.com/articles/source-page'),
			doi: '10.1038/source-page',
			pdfUrl: URI.parse(detailPdfUrl),
		})]),
	});

	await service.downloadArticlePdf(articleId);
	service.dispose();

	assert.equal(payloads[0]?.pageUrl, 'https://www.nature.com/articles/source-page');
	assert.equal(payloads[0]?.downloadUrl, detailPdfUrl);
});

test('DocumentActionsService rejects a detail without a PDF URL before native invocation', async () => {
	const articleId = 'article.without-pdf-url';
	let desktopInvocations = 0;
	const notificationService = new TestNotificationService();
	const { service } = createService({
		invokeDesktop: (async () => {
			desktopInvocations += 1;
			throw new Error('The native boundary must not be invoked without a PDF URL.');
		}) as ElectronInvoke,
		notificationService,
		fetchService: createFetchService([createArticleDetail(articleId, { pdfUrl: undefined })]),
	});

	await service.downloadArticlePdf(articleId);
	service.dispose();

	assert.equal(desktopInvocations, 0);
	assert.deepEqual(notificationService.errors, [locales.en.errorPdfLinkNotFound]);
});

test('DocumentActionsService reports a missing Article without mutating Feature selection', async () => {
	const articleSelectionResource = URI.from({ scheme: 'chat', path: '/unavailable' });
	const notificationService = new TestNotificationService();
	const { service } = createService({ notificationService });

	await service.downloadArticlePdf('article.missing', articleSelectionResource);
	service.dispose();

	assert.deepEqual(notificationService.infos, [locales.en.articleDetailsUnavailable]);
});

test('DocumentActionsService cancels a batch only through the explicit cancel operation', async () => {
	const articleId = 'article.cancel';
	const downloadPayloads: WebContentPdfDownloadPayload[] = [];
	const cancelPayloads: Array<{ taskId?: string }> = [];
	let rejectDownload: ((error: unknown) => void) | undefined;
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
	const selection = {
		resource: URI.from({ scheme: 'chat', path: '/cancel' }),
		articleIds: [articleId],
	};
	const { service } = createService({
		invokeDesktop,
		fetchService: createFetchService([createArticleDetail(articleId)]),
	});

	const running = service.downloadArticlePdfs(selection);
	await delay(0);
	await assert.rejects(service.downloadArticlePdfs(selection), /already active/);
	service.cancelArticlePdfDownloads();
	await running;
	service.dispose();

	assert.equal(typeof downloadPayloads[0]?.taskId, 'string');
	assert.deepEqual(cancelPayloads, [{ taskId: downloadPayloads[0]?.taskId }]);
});

test('DocumentActionsService cancels an active desktop batch when disposed', async () => {
	const articleId = 'article.dispose';
	const downloadPayloads: WebContentPdfDownloadPayload[] = [];
	const cancelPayloads: Array<{ taskId?: string }> = [];
	let rejectDownload: ((error: unknown) => void) | undefined;
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
		throw new Error(`Unexpected desktop command in disposal test: ${command}`);
	}) as ElectronInvoke;
	const { service } = createService({
		invokeDesktop,
		fetchService: createFetchService([createArticleDetail(articleId)]),
	});

	const running = service.downloadArticlePdfs({
		resource: URI.from({ scheme: 'chat', path: '/dispose' }),
		articleIds: [articleId],
	});
	await delay(0);
	service.dispose();
	await running;

	assert.equal(typeof downloadPayloads[0]?.taskId, 'string');
	assert.deepEqual(cancelPayloads, [{ taskId: downloadPayloads[0]?.taskId }]);
});

test('DocumentActionsService suppresses Article detail results settled after batch cancellation', async () => {
	const articleId = 'article.pending';
	const articleDetail = new DeferredPromise<ArticleDetail | null>();
	const invoked: string[] = [];
	const notificationService = new TestNotificationService();
	const fetchService = {
		getArticle: () => ({
			id: articleId,
			journalId: 'journal.example',
			url: URI.parse('https://example.com/pending'),
			doi: '10.1000/pending',
		}),
		getArticleDetail: () => undefined,
		fetchArticle: () => articleDetail.p,
	} as unknown as IFetchService;
	const { service } = createService({
		invokeDesktop: (async (command: string) => {
			invoked.push(command);
			return command === 'cancel_document_task' ? true : null;
		}) as ElectronInvoke,
		fetchService,
		notificationService,
	});

	const running = service.downloadArticlePdfs({
		resource: URI.from({ scheme: 'chat', path: '/pending' }),
		articleIds: [articleId],
	});
	await delay(0);
	service.cancelArticlePdfDownloads();
	articleDetail.complete(null);
	await running;
	service.dispose();

	assert.deepEqual(notificationService.infos, []);
	assert.deepEqual(invoked, ['cancel_document_task']);
});

test('DocumentActionsService suppresses a single PDF completion settled after disposal', async () => {
	const articleId = 'article.single-dispose';
	const downloadResult = new DeferredPromise<PdfDownloadResult>();
	const notificationService = new TestNotificationService();
	const { service, libraryRefreshes } = createService({
		invokeDesktop: (async (command: string) => {
			assert.equal(command, 'web_content_download_pdf');
			return downloadResult.p;
		}) as ElectronInvoke,
		fetchService: createFetchService([createArticleDetail(articleId)]),
		notificationService,
	});

	const running = service.downloadArticlePdf(articleId);
	await delay(0);
	service.dispose();
	downloadResult.complete({
		filePath: '/tmp/article.pdf',
		sourceUrl: 'https://example.com/article.pdf',
		libraryRegistration: null,
	});
	await running;

	assert.deepEqual(notificationService.infos, []);
	assert.deepEqual(notificationService.errors, []);
	assert.deepEqual(libraryRefreshes, []);
	assert.equal(
		getPdfDownloadStatus(`https://example.com/articles/${articleId}`).isDownloading,
		false,
	);
});

test('DocumentActionsService suppresses Library metadata settled after disposal', async () => {
	const articleId = 'article.metadata-dispose';
	const metadata = new DeferredPromise<unknown>();
	const invoked: string[] = [];
	const { service, libraryUpserts } = createService({
		invokeDesktop: (async (command: string) => {
			invoked.push(command);
			if (command === 'upsert_library_document_metadata') {
				return metadata.p;
			}
			throw new Error(`Unexpected command after metadata disposal: ${command}`);
		}) as ElectronInvoke,
		fetchService: createFetchService([createArticleDetail(articleId)]),
		settings: { knowledgeBaseEnabled: true },
	});

	const running = service.downloadArticlePdf(articleId);
	await delay(0);
	service.dispose();
	metadata.complete({ documentId: 'document.disposed' });
	await running;

	assert.deepEqual(libraryUpserts, []);
	assert.deepEqual(invoked, ['upsert_library_document_metadata']);
});

test('DocumentActionsService snapshots Draft locale, UI, and download directory at operation start', async () => {
	const exportResult = new DeferredPromise<EditorDocxExportResult | null>();
	const notificationService = new TestNotificationService();
	const localeState = { value: 'en' as 'en' | 'zh' };
	let exportPayload: Record<string, unknown> | undefined;
	const { service, settings } = createService({
		invokeDesktop: (async (command: string, payload?: Record<string, unknown>) => {
			assert.equal(command, 'export_editor_docx');
			exportPayload = payload;
			return exportResult.p;
		}) as ElectronInvoke,
		notificationService,
		localeState,
		settings: { pdfDownloadDir: '/tmp/start' },
	});

	const running = service.exportDraftDocument({
		title: 'Draft',
		document: { type: 'doc', content: [] },
	});
	await delay(0);
	localeState.value = 'zh';
	settings.pdfDownloadDir = '/tmp/changed';
	exportResult.complete({ title: 'Draft', filePath: '/tmp/start/Draft.docx' });
	await running;
	service.dispose();

	assert.equal(exportPayload?.locale, 'en');
	assert.equal(exportPayload?.preferredDirectory, '/tmp/start');
	assert.deepEqual(notificationService.infos, [
		formatLocaleMessage(locales.en.toastEditorDocxExported, {
			title: 'Draft',
			filePath: '/tmp/start/Draft.docx',
		}),
	]);
});

test('DocumentActionsService suppresses a Draft export settled after disposal', async () => {
	const exportResult = new DeferredPromise<EditorDocxExportResult | null>();
	const notificationService = new TestNotificationService();
	const { service } = createService({
		invokeDesktop: (async (command: string) => {
			assert.equal(command, 'export_editor_docx');
			return exportResult.p;
		}) as ElectronInvoke,
		notificationService,
	});

	const running = service.exportDraftDocument({
		title: 'Draft',
		document: { type: 'doc', content: [] },
	});
	await delay(0);
	service.dispose();
	exportResult.complete({ title: 'Draft', filePath: '/tmp/Draft.docx' });
	await running;

	assert.deepEqual(notificationService.infos, []);
	assert.deepEqual(notificationService.errors, []);
});
