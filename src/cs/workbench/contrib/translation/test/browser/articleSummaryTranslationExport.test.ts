/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { DeferredPromise } from 'cs/base/common/async';
import { URI } from 'cs/base/common/uri';
import type { ElectronInvoke } from 'cs/base/parts/sandbox/common/electronTypes';
import type { DocumentTranslationProgress } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { getSingletonServiceDescriptors } from 'cs/platform/instantiation/common/extensions';
import { NoOpNotificationService } from 'cs/platform/notification/common/notification';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { ArticleDetail, ArticleId, ArticleRecord, IFetchService } from 'cs/workbench/services/fetch/common/fetch';
import { WorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { SettingsModel } from 'cs/workbench/services/settings/settingsModel';

let cleanupDomEnvironment: (() => void) | null = null;
let ArticleSummaryTranslationExportService: typeof import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport').ArticleSummaryTranslationExportService;
let IArticleSummaryTranslationExportService: typeof import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport').IArticleSummaryTranslationExportService;
let getStatusbarStateSnapshot: typeof import('cs/workbench/browser/parts/statusbar/statusbarModel').getStatusbarStateSnapshot;
let setStatusbarState: typeof import('cs/workbench/browser/parts/statusbar/statusbarModel').setStatusbarState;
let BrowserDialogService: typeof import('cs/workbench/services/dialogs/browser/dialogService').BrowserDialogService;

test.before(async () => {
	const domEnvironment = installDomTestEnvironment();
	cleanupDomEnvironment = domEnvironment.cleanup;
	({
		ArticleSummaryTranslationExportService,
		IArticleSummaryTranslationExportService,
	} = await import('cs/workbench/contrib/translation/browser/articleSummaryTranslationExport'));
	({ getStatusbarStateSnapshot, setStatusbarState } = await import('cs/workbench/browser/parts/statusbar/statusbarModel'));
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

function createExportService(
	nativeHostService: INativeHostService,
	fetchService: IFetchService,
	options: {
		localeService?: { getLocale: () => string };
		settingsModel?: SettingsModel;
	} = {},
) {
	const settingsModel = options.settingsModel ?? new SettingsModel();
	if (!options.settingsModel) {
		settingsModel.setPdfDownloadDir('/tmp');
	}
	return new ArticleSummaryTranslationExportService(
		nativeHostService,
		new NoOpNotificationService(),
		createDialogService(),
		(options.localeService ?? { getLocale: () => 'en' }) as never,
		new WorkbenchLanguageService(),
		settingsModel,
		fetchService,
	);
}

test('ArticleSummaryTranslationExportService resolves ArticleIds to DOCX DTOs and restores progress', async () => {
	const registrations = getSingletonServiceDescriptors()
		.filter(([id]) => id === IArticleSummaryTranslationExportService);
	assert.equal(registrations.length, 1);
	assert.equal(registrations[0][1].supportsDelayedInstantiation, true);
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
	const service = createExportService(
		createNativeHostService({
			onTranslationProgress: listener => {
				progressListener = listener;
				return () => { unsubscribed = true; progressListener = null; };
			},
		}, invoke),
		createFetchService([createArticleDetail(articleId)]),
	);

	await service.handleExportArticleSummaries([articleId], true, () => {});
	service.dispose();

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

test('ArticleSummaryTranslationExportService removes unavailable ArticleIds before export', async () => {
	const unavailable: ArticleId[][] = [];
	let invoked = false;
	const invoke = (async () => {
		invoked = true;
		return null;
	}) as ElectronInvoke;
	const service = createExportService(
		createNativeHostService({ onTranslationProgress: () => () => {} }, invoke),
		createFetchService([]),
	);

	await service.handleExportArticleSummaries(
		['article.missing'],
		false,
		articleIds => unavailable.push([...articleIds]),
	);
	service.dispose();
	assert.deepEqual(unavailable, [['article.missing']]);
	assert.equal(invoked, false);
});

test('ArticleSummaryTranslationExportService cancels an active export task', async () => {
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
	const service = createExportService(
		createNativeHostService({ onTranslationProgress: () => () => {} }, invoke),
		createFetchService([createArticleDetail(articleId)]),
	);

	const running = service.handleExportArticleSummaries([articleId], true, () => {});
	await delay(0);
	await service.handleExportArticleSummaries([articleId], true, () => {});
	await running;
	service.dispose();

	const exportArgs = invoked.find(entry => entry.command === 'export_articles_docx')?.args;
	const cancelArgs = invoked.find(entry => entry.command === 'cancel_document_task')?.args;
	assert.deepEqual(cancelArgs, { taskId: exportArgs?.taskId });
});

test('ArticleSummaryTranslationExportService cancels an active desktop task when disposed', async () => {
	const articleId = 'article.dispose';
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
	const service = createExportService(
		createNativeHostService({ onTranslationProgress: () => () => {} }, invoke),
		createFetchService([createArticleDetail(articleId)]),
	);

	const running = service.handleExportArticleSummaries([articleId], true, () => {});
	await delay(0);
	service.dispose();
	await running;

	const exportArgs = invoked.find(entry => entry.command === 'export_articles_docx')?.args;
	const cancelArgs = invoked.find(entry => entry.command === 'cancel_document_task')?.args;
	assert.deepEqual(cancelArgs, { taskId: exportArgs?.taskId });
});

test('ArticleSummaryTranslationExportService suppresses results from article details settled after disposal', async () => {
	const articleId = 'article.pending';
	const articleDetail = new DeferredPromise<ArticleDetail | null>();
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
	const invoked: string[] = [];
	const service = createExportService(
		createNativeHostService({ onTranslationProgress: () => () => {} }, (async (command: string) => {
			invoked.push(command);
			return command === 'cancel_document_task' ? true : null;
		}) as ElectronInvoke),
		fetchService,
	);
	const unavailable: ArticleId[][] = [];

	const running = service.handleExportArticleSummaries(
		[articleId],
		false,
		articleIds => unavailable.push([...articleIds]),
	);
	await delay(0);
	service.dispose();
	articleDetail.complete(null);
	await running;

	assert.deepEqual(unavailable, []);
	assert.deepEqual(invoked, ['cancel_document_task']);
});

test('ArticleSummaryTranslationExportService uses locale and download settings captured at operation start', async () => {
	const articleId = 'article.snapshot';
	const articleDetail = new DeferredPromise<ArticleDetail>();
	const fetchService = {
		getArticle: () => ({
			id: articleId,
			journalId: 'journal.example',
			url: URI.parse('https://example.com/snapshot'),
			doi: '10.1000/snapshot',
		}),
		getArticleDetail: () => undefined,
		fetchArticle: () => articleDetail.p,
	} as unknown as IFetchService;
	let locale = 'en';
	const settingsModel = new SettingsModel();
	settingsModel.setPdfDownloadDir('/tmp/start');
	let exportArgs: Record<string, unknown> | undefined;
	const service = createExportService(
		createNativeHostService({ onTranslationProgress: () => () => {} }, (async (
			command: string,
			args?: Record<string, unknown>,
		) => {
			assert.equal(command, 'export_articles_docx');
			exportArgs = args;
			return { articleCount: 1, filePath: '/tmp/articles.docx' };
		}) as ElectronInvoke),
		fetchService,
		{ localeService: { getLocale: () => locale }, settingsModel },
	);

	const running = service.handleExportArticleSummaries([articleId], true, () => {});
	await delay(0);
	locale = 'zh-Hans';
	settingsModel.setPdfDownloadDir('/tmp/changed');
	articleDetail.complete(createArticleDetail(articleId));
	await running;
	service.dispose();

	assert.equal(exportArgs?.locale, 'en');
	assert.equal(exportArgs?.preferredDirectory, '/tmp/start');
});
