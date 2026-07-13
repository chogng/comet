/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationError, CancellationTokenNone, CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { errorHandler } from 'cs/base/common/errors';
import { URI } from 'cs/base/common/uri';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import {
	maximumArticleReadableContentBytes,
	type ArticleId,
	type ArticleListSource,
	type ArticleRecord,
	type JournalDescriptor,
} from 'cs/workbench/services/fetch/common/fetch';
import { createArticleId, createArticleListSourceId } from 'cs/workbench/services/fetch/common/fetchIds';
import type { IFetchProvider, ParsedArticleDetail, ParsedArticleListCatalog, ParsedArticleListPage, ParsedArticleReadableContent } from 'cs/workbench/services/fetch/common/fetchProvider';
import { FetchRegistry, IFetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';
import { FetchService } from 'cs/workbench/services/fetch/browser/fetchService';

class TestFetchProvider implements IFetchProvider {
	readonly id = 'provider.test';
	private listRequestCount = 0;
	private detailRequestCount = 0;

	getDetailRequestCount(): number {
		return this.detailRequestCount;
	}

	canonicalizeSourceUri(uri: URI): URI {
		return uri.with({ fragment: null });
	}

	canonicalizePageUri(uri: URI): URI {
		return uri.with({ fragment: null });
	}

	canonicalizeArticleUri(uri: URI): URI {
		return uri.with({ fragment: null });
	}

	async discoverArticleListSources(_journal: JournalDescriptor, _token: CancellationToken): Promise<ParsedArticleListCatalog> {
		return {
			entries: [{
				kind: 'group',
				label: 'Research',
				sources: [{ kind: 'source', label: 'Article', url: URI.parse('https://example.com/articles#catalog') }],
			}],
		};
	}

	async fetchArticleListPage(_journal: JournalDescriptor, _source: ArticleListSource, url: URI, _token: CancellationToken): Promise<ParsedArticleListPage> {
		this.listRequestCount++;
		const article = this.listRequestCount === 1
			? URI.parse('https://example.com/articles/one#source')
			: URI.parse('https://example.com/articles/two#source');
		return {
			url,
			groups: [],
			ungroupedItems: [{
				providerOccurrenceKey: `card:${this.listRequestCount}`,
				articleUrl: article,
				title: `Article ${this.listRequestCount}`,
				authors: [],
				relatedArticles: [],
			}],
			nextPageUrl: this.listRequestCount === 1 ? URI.parse('https://example.com/articles?page=2') : undefined,
		};
	}

	async fetchArticleDetail(_journal: JournalDescriptor, article: ArticleRecord, _token: CancellationToken): Promise<ParsedArticleDetail> {
		this.detailRequestCount++;
		return {
			url: article.url,
			doi: '10.1000/test',
			title: 'Authoritative title',
			subjects: [],
			authors: [],
			publication: { title: 'Test Journal' },
		};
	}

	async fetchArticleReadableContent(
		_journal: JournalDescriptor,
		article: ArticleRecord,
		_token: CancellationToken,
	): Promise<ParsedArticleReadableContent> {
		return {
			url: article.url,
			title: 'Authoritative title',
			text: 'Complete Article body.',
		};
	}
}

const journal: JournalDescriptor = {
	id: 'journal.test',
	title: 'Test Journal',
	homeUrl: URI.parse('https://example.com'),
	discoveryUrl: URI.parse('https://example.com/articles'),
	providerId: 'provider.test',
};

function createFetchServiceFromRegistry(registry: FetchRegistry): FetchService {
	const instantiationService: IInstantiationService = new InstantiationService(new ServiceCollection([IFetchRegistry, registry]), true);
	return instantiationService.createInstance(new SyncDescriptor(FetchService));
}

function createFetchService(provider: typeof TestFetchProvider = TestFetchProvider): FetchService {
	const registry = new FetchRegistry();
	registry.registerJournal(journal);
	registry.registerProvider({ id: 'provider.test', ctor: provider });
	return createFetchServiceFromRegistry(registry);
}

async function loadFirstArticle(service: FetchService): Promise<ArticleId> {
	const sourceId = createArticleListSourceId(journal.id, URI.parse('https://example.com/articles'));
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	await service.fetchArticleListSource(sourceId, CancellationTokenNone);
	return createArticleId(journal.id, URI.parse('https://example.com/articles/one'));
}

class FailsOnceInConstructorFetchProvider extends TestFetchProvider {
	private static constructionCount = 0;

	static reset(): void {
		this.constructionCount = 0;
	}

	constructor() {
		super();
		FailsOnceInConstructorFetchProvider.constructionCount += 1;
		if (FailsOnceInConstructorFetchProvider.constructionCount === 1) {
			throw new Error('Provider construction failed');
		}
	}
}

class FailsOnceSynchronouslyInOperationFetchProvider extends TestFetchProvider {
	private static operationCount = 0;

	static reset(): void {
		this.operationCount = 0;
	}

	override discoverArticleListSources(
		journal: JournalDescriptor,
		token: CancellationToken,
	): Promise<ParsedArticleListCatalog> {
		FailsOnceSynchronouslyInOperationFetchProvider.operationCount += 1;
		if (FailsOnceSynchronouslyInOperationFetchProvider.operationCount === 1) {
			throw new Error('Provider operation failed synchronously');
		}
		return super.discoverArticleListSources(journal, token);
	}
}

async function assertFailedCatalogTaskCanRetry(
	service: FetchService,
	failure: RegExp,
): Promise<void> {
	const states: string[] = [];
	service.onDidChangeCatalog(id => states.push(service.getCatalogLoadState(id).status));

	await assert.rejects(
		service.discoverArticleListSources(journal.id, CancellationTokenNone),
		failure,
	);
	assert.equal(service.getCatalogLoadState(journal.id).status, 'error');
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);

	assert.deepEqual({
		states,
		loadState: service.getCatalogLoadState(journal.id).status,
		catalog: service.getArticleListCatalog(journal.id)?.journalId,
	}, {
		states: ['loading', 'error', 'loading', 'ready'],
		loadState: 'ready',
		catalog: journal.id,
	});
}

test('Browser FetchService cleans up and retries a task after synchronous provider lookup failure', async () => {
	const registry = new FetchRegistry();
	registry.registerJournal(journal);
	const service = createFetchServiceFromRegistry(registry);
	const states: string[] = [];
	service.onDidChangeCatalog(id => states.push(service.getCatalogLoadState(id).status));

	await assert.rejects(
		service.discoverArticleListSources(journal.id, CancellationTokenNone),
		/provider "provider.test" is not registered/,
	);
	assert.equal(service.getCatalogLoadState(journal.id).status, 'error');
	registry.registerProvider({ id: 'provider.test', ctor: TestFetchProvider });
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);

	assert.deepEqual({
		states,
		loadState: service.getCatalogLoadState(journal.id).status,
		catalog: service.getArticleListCatalog(journal.id)?.journalId,
	}, {
		states: ['loading', 'error', 'loading', 'ready'],
		loadState: 'ready',
		catalog: journal.id,
	});
});

test('FetchService cleans up and retries a task after synchronous provider construction failure', async () => {
	FailsOnceInConstructorFetchProvider.reset();
	await assertFailedCatalogTaskCanRetry(
		createFetchService(FailsOnceInConstructorFetchProvider),
		/Provider construction failed/,
	);
});

test('FetchService cleans up and retries a task after synchronous provider operation failure', async () => {
	FailsOnceSynchronouslyInOperationFetchProvider.reset();
	await assertFailedCatalogTaskCanRetry(
		createFetchService(FailsOnceSynchronouslyInOperationFetchProvider),
		/Provider operation failed synchronously/,
	);
});

test('FetchService keeps source, list item, article record, and detail state distinct', async () => {
	const service = createFetchService();
	const catalogStates: string[] = [];
	const sourceStates: string[] = [];
	const articleStates: string[] = [];
	service.onDidChangeCatalog(id => catalogStates.push(service.getCatalogLoadState(id).status));
	service.onDidChangeSource(id => sourceStates.push(service.getSourceLoadState(id).status));
	service.onDidChangeArticle(id => articleStates.push(service.getArticleLoadState(id).status));

	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	const sourceId = createArticleListSourceId(journal.id, URI.parse('https://example.com/articles'));
	const source = service.getArticleListCatalog(journal.id)?.entries[0];
	assert.equal(source?.kind, 'group');
	assert.equal(source?.kind === 'group' ? source.sources[0].id : undefined, sourceId);

	await service.fetchArticleListSource(sourceId, CancellationTokenNone);
	const firstArticleId = createArticleId(journal.id, URI.parse('https://example.com/articles/one'));
	const firstArticle = service.getArticle(firstArticleId);
	assert.equal(firstArticle?.doi, undefined);
	assert.equal(service.getArticleDetail(firstArticleId), undefined);

	const detail = await service.fetchArticle(firstArticleId, CancellationTokenNone);
	assert.equal(detail.articleId, firstArticleId);
	assert.equal(service.getArticle(firstArticleId)?.doi, '10.1000/test');
	const cachedDetail = await service.fetchArticle(firstArticleId, CancellationTokenNone);
	assert.equal(cachedDetail, detail);

	await service.fetchNextPage(sourceId, CancellationTokenNone);
	const secondArticleId = createArticleId(journal.id, URI.parse('https://example.com/articles/two'));
	assert.notEqual(firstArticleId, secondArticleId);
	assert.ok(service.getArticle(secondArticleId));
	assert.deepEqual(catalogStates, ['loading', 'ready']);
	assert.deepEqual(sourceStates, ['loading', 'ready', 'loading', 'ready']);
	assert.deepEqual(articleStates, ['loading', 'ready']);
	assert.equal(service.getSourceLoadState(sourceId).status, 'ready');

	await service.refreshArticleListSource(sourceId, CancellationTokenNone);
	assert.equal(service.getArticlePages(sourceId).length, 1);
	assert.equal(service.getArticlePages(sourceId)[0].ungroupedItemIds.length, 1);
	assert.equal(service.getArticleDetail(firstArticleId)?.title, 'Authoritative title');

	await service.refreshJournal(journal.id, CancellationTokenNone);
	assert.equal(service.getArticlePages(sourceId).length, 1);
	assert.equal(service.getCatalogLoadState(journal.id).status, 'ready');
});

class ChangingReadableContentProvider extends TestFetchProvider {
	private static requestCount = 0;

	static reset(): void {
		this.requestCount = 0;
	}

	static getRequestCount(): number {
		return this.requestCount;
	}

	override async fetchArticleReadableContent(
		_journal: JournalDescriptor,
		article: ArticleRecord,
		_token: CancellationToken,
	): Promise<ParsedArticleReadableContent> {
		ChangingReadableContentProvider.requestCount += 1;
		return {
			url: article.url,
			title: 'Authoritative title',
			text: `Complete Article body version ${ChangingReadableContentProvider.requestCount}.`,
		};
	}
}

test('FetchService returns immutable complete readable versions without caching a later extraction', async () => {
	ChangingReadableContentProvider.reset();
	const service = createFetchService(ChangingReadableContentProvider);
	const articleId = await loadFirstArticle(service);

	const first = await service.fetchArticleReadableContent(articleId, CancellationTokenNone);
	const second = await service.fetchArticleReadableContent(articleId, CancellationTokenNone);

	assert.equal(first.text, 'Complete Article body version 1.');
	assert.equal(second.text, 'Complete Article body version 2.');
	assert.notEqual(first.version, second.version);
	assert.equal(first.version, first.digest);
	assert.match(first.digest, /^sha256:[0-9a-f]{64}$/);
	assert.equal(first.byteLength, new TextEncoder().encode(first.text).byteLength);
	assert.equal(Object.isFrozen(first), true);
	assert.equal(ChangingReadableContentProvider.getRequestCount(), 2);
});

class MismatchedReadableContentProvider extends TestFetchProvider {
	private static requestCount = 0;

	static reset(): void {
		this.requestCount = 0;
	}

	static getRequestCount(): number {
		return this.requestCount;
	}

	override async fetchArticleReadableContent(): Promise<ParsedArticleReadableContent> {
		MismatchedReadableContentProvider.requestCount += 1;
		return {
			url: URI.parse('https://example.com/articles/different'),
			title: 'Different Article',
			text: 'Different complete body.',
		};
	}
}

test('FetchService rejects mismatched readable Article identity and never substitutes it', async () => {
	MismatchedReadableContentProvider.reset();
	const service = createFetchService(MismatchedReadableContentProvider);
	const articleId = await loadFirstArticle(service);

	await assert.rejects(
		service.fetchArticleReadableContent(articleId, CancellationTokenNone),
		/resolved from a different Article URL/,
	);
	await assert.rejects(
		service.fetchArticleReadableContent(articleId, CancellationTokenNone),
		/resolved from a different Article URL/,
	);
	assert.equal(MismatchedReadableContentProvider.getRequestCount(), 2);
});

class OversizedReadableContentProvider extends TestFetchProvider {
	override async fetchArticleReadableContent(
		_journal: JournalDescriptor,
		article: ArticleRecord,
		_token: CancellationToken,
	): Promise<ParsedArticleReadableContent> {
		return {
			url: article.url,
			title: 'Oversized Article',
			text: 'x'.repeat(maximumArticleReadableContentBytes + 1),
		};
	}
}

test('FetchService rejects complete readable content above the exact byte bound', async () => {
	const service = createFetchService(OversizedReadableContentProvider);
	const articleId = await loadFirstArticle(service);
	await assert.rejects(
		service.fetchArticleReadableContent(articleId, CancellationTokenNone),
		new RegExp(`cannot exceed ${maximumArticleReadableContentBytes} bytes`),
	);
});

class CancellationObservedReadableContentProvider extends TestFetchProvider {
	static token: CancellationToken | undefined;

	static reset(): void {
		this.token = undefined;
	}

	override fetchArticleReadableContent(
		_journal: JournalDescriptor,
		_article: ArticleRecord,
		token: CancellationToken,
	): Promise<ParsedArticleReadableContent> {
		CancellationObservedReadableContentProvider.token = token;
		return new Promise((_resolve, reject) => {
			token.onCancellationRequested(() => reject(new CancellationError()));
		});
	}
}

test('FetchService cancels complete readable extraction when its only waiter cancels', async () => {
	CancellationObservedReadableContentProvider.reset();
	const service = createFetchService(CancellationObservedReadableContentProvider);
	const articleId = await loadFirstArticle(service);
	const source = new CancellationTokenSource();
	const pending = service.fetchArticleReadableContent(articleId, source.token);

	source.cancel();
	await assert.rejects(pending, CancellationError);
	await Promise.resolve();
	assert.equal(CancellationObservedReadableContentProvider.token?.isCancellationRequested, true);
	source.dispose();
});

test('FetchService isolates observer failures from successful Catalog, Source, and Article tasks', async () => {
	const service = createFetchService();
	const observerError = new Error('Observer failed');
	const unexpectedErrors: unknown[] = [];
	const catalogStates: string[] = [];
	const sourceStates: string[] = [];
	const articleStates: string[] = [];
	const previousUnexpectedErrorHandler = errorHandler.getUnexpectedErrorHandler();
	errorHandler.setUnexpectedErrorHandler(error => unexpectedErrors.push(error));
	try {
		service.onDidChangeCatalog(() => {
			throw observerError;
		});
		service.onDidChangeCatalog(id => catalogStates.push(service.getCatalogLoadState(id).status));
		service.onDidChangeSource(() => {
			throw observerError;
		});
		service.onDidChangeSource(id => sourceStates.push(service.getSourceLoadState(id).status));
		service.onDidChangeArticle(() => {
			throw observerError;
		});
		service.onDidChangeArticle(id => articleStates.push(service.getArticleLoadState(id).status));

		await service.discoverArticleListSources(journal.id, CancellationTokenNone);
		const sourceId = createArticleListSourceId(journal.id, URI.parse('https://example.com/articles'));
		await service.fetchArticleListSource(sourceId, CancellationTokenNone);
		const articleId = createArticleId(journal.id, URI.parse('https://example.com/articles/one'));
		const detail = await service.fetchArticle(articleId, CancellationTokenNone);

		assert.deepEqual({
			catalogStates,
			sourceStates,
			articleStates,
			unexpectedErrors,
			detailTitle: detail.title,
			loadStates: [
				service.getCatalogLoadState(journal.id).status,
				service.getSourceLoadState(sourceId).status,
				service.getArticleLoadState(articleId).status,
			],
		}, {
			catalogStates: ['loading', 'ready'],
			sourceStates: ['loading', 'ready'],
			articleStates: ['loading', 'ready'],
			unexpectedErrors: Array(6).fill(observerError),
			detailTitle: 'Authoritative title',
			loadStates: ['ready', 'ready', 'ready'],
		});
	} finally {
		errorHandler.setUnexpectedErrorHandler(previousUnexpectedErrorHandler);
	}
});

class DeferredArticleFetchProvider extends TestFetchProvider {
	static readonly details: Array<(detail: ParsedArticleDetail) => void> = [];

	static reset(): void {
		this.details.length = 0;
	}

	override fetchArticleDetail(_journal: JournalDescriptor, article: ArticleRecord, _token: CancellationToken): Promise<ParsedArticleDetail> {
		return new Promise(resolve => {
			DeferredArticleFetchProvider.details.push(() => resolve({
				url: article.url,
				title: 'Deferred detail',
				subjects: [],
				authors: [],
				publication: { title: 'Test Journal' },
			}));
		});
	}
}

test('FetchService keeps a shared detail request alive until every waiter cancels', async () => {
	DeferredArticleFetchProvider.reset();
	const service = createFetchService(DeferredArticleFetchProvider);
	const sourceId = createArticleListSourceId(journal.id, URI.parse('https://example.com/articles'));
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	await service.fetchArticleListSource(sourceId, CancellationTokenNone);
	const articleId = createArticleId(journal.id, URI.parse('https://example.com/articles/one'));
	const firstCancellation = new CancellationTokenSource();
	const secondCancellation = new CancellationTokenSource();
	const first = service.fetchArticle(articleId, firstCancellation.token);
	const second = service.fetchArticle(articleId, secondCancellation.token);
	assert.equal(DeferredArticleFetchProvider.details.length, 1);

	firstCancellation.cancel();
	await assert.rejects(first, CancellationError);
	assert.equal(service.getArticleLoadState(articleId).status, 'loading');

	DeferredArticleFetchProvider.details[0]({
		url: URI.parse('https://example.com/articles/one'),
		title: 'Deferred detail',
		subjects: [],
		authors: [],
		publication: { title: 'Test Journal' },
	});
	const detail = await second;
	assert.equal(detail.title, 'Deferred detail');
	assert.equal(service.getArticleLoadState(articleId).status, 'ready');
	firstCancellation.dispose();
	secondCancellation.dispose();
});

class DeferredCatalogFetchProvider extends TestFetchProvider {
	static readonly catalogs: Array<(catalog: ParsedArticleListCatalog) => void> = [];

	static reset(): void {
		this.catalogs.length = 0;
	}

	override discoverArticleListSources(_journal: JournalDescriptor, _token: CancellationToken): Promise<ParsedArticleListCatalog> {
		return new Promise(resolve => DeferredCatalogFetchProvider.catalogs.push(resolve));
	}
}

test('FetchService rejects cancelled catalog results without writing stale state', async () => {
	DeferredCatalogFetchProvider.reset();
	const service = createFetchService(DeferredCatalogFetchProvider);
	const first = service.discoverArticleListSources(journal.id, CancellationTokenNone);
	const second = service.refreshJournal(journal.id, CancellationTokenNone);
	assert.equal(DeferredCatalogFetchProvider.catalogs.length, 2);

	DeferredCatalogFetchProvider.catalogs[0]({
		entries: [{ kind: 'source', label: 'Stale', url: URI.parse('https://example.com/stale') }],
	});
	DeferredCatalogFetchProvider.catalogs[1]({
		entries: [{ kind: 'source', label: 'Current', url: URI.parse('https://example.com/current') }],
	});

	await assert.rejects(first, CancellationError);
	await second;
	const catalog = service.getArticleListCatalog(journal.id);
	assert.equal(catalog?.entries[0].kind === 'source' ? catalog.entries[0].label : undefined, 'Current');
	assert.equal(service.getCatalogLoadState(journal.id).status, 'ready');
});

class IsolatedSourceFetchProvider extends TestFetchProvider {
	override async discoverArticleListSources(_journal: JournalDescriptor, _token: CancellationToken): Promise<ParsedArticleListCatalog> {
		return {
			entries: [
				{ kind: 'source', label: 'Working source', url: URI.parse('https://example.com/working') },
				{ kind: 'source', label: 'Failing source', url: URI.parse('https://example.com/failing') },
			],
		};
	}

	override async fetchArticleListPage(journal: JournalDescriptor, source: ArticleListSource, url: URI, token: CancellationToken): Promise<ParsedArticleListPage> {
		if (source.url.path === '/failing') {
			throw new Error('Source failed');
		}
		return super.fetchArticleListPage(journal, source, url, token);
	}
}

test('FetchService isolates failed sources within the same journal', async () => {
	const service = createFetchService(IsolatedSourceFetchProvider);
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	const workingId = createArticleListSourceId(journal.id, URI.parse('https://example.com/working'));
	const failingId = createArticleListSourceId(journal.id, URI.parse('https://example.com/failing'));

	await service.fetchArticleListSource(workingId, CancellationTokenNone);
	await assert.rejects(service.fetchArticleListSource(failingId, CancellationTokenNone), /Source failed/);

	assert.equal(service.getSourceLoadState(workingId).status, 'ready');
	assert.equal(service.getSourceLoadState(failingId).status, 'error');
	assert.equal(service.getArticlePages(workingId).length, 1);
	assert.equal(service.getArticlePages(failingId).length, 0);
});

class ReplacingCatalogFetchProvider extends TestFetchProvider {
	private discoveryCount = 0;

	override async discoverArticleListSources(_journal: JournalDescriptor, _token: CancellationToken): Promise<ParsedArticleListCatalog> {
		this.discoveryCount += 1;
		return {
			entries: [{
				kind: 'source',
				label: this.discoveryCount === 1 ? 'Original source' : 'Replacement source',
				url: URI.parse(this.discoveryCount === 1 ? 'https://example.com/original' : 'https://example.com/replacement'),
			}],
		};
	}
}

test('refreshJournal removes disappeared source pages and load state', async () => {
	const service = createFetchService(ReplacingCatalogFetchProvider);
	const originalId = createArticleListSourceId(journal.id, URI.parse('https://example.com/original'));
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	await service.fetchArticleListSource(originalId, CancellationTokenNone);
	assert.equal(service.getArticlePages(originalId).length, 1);

	await service.refreshJournal(journal.id, CancellationTokenNone);
	assert.equal(service.getArticlePages(originalId).length, 0);
	assert.equal(service.getSourceLoadState(originalId).status, 'idle');
	const catalog = service.getArticleListCatalog(journal.id);
	assert.equal(catalog?.entries[0].kind === 'source' ? catalog.entries[0].label : undefined, 'Replacement source');
});

class StableOccurrenceRefreshProvider extends TestFetchProvider {
	private pageRequestCount = 0;

	override async fetchArticleListPage(
		_journal: JournalDescriptor,
		_source: ArticleListSource,
		url: URI,
		_token: CancellationToken,
	): Promise<ParsedArticleListPage> {
		this.pageRequestCount += 1;
		return {
			url,
			groups: [],
			ungroupedItems: [{
				providerOccurrenceKey: 'stable-card',
				articleUrl: URI.parse('https://example.com/articles/stable'),
				title: `Stable article ${this.pageRequestCount}`,
				authors: [],
				relatedArticles: [],
			}],
		};
	}
}

test('FetchService replaces a stable page occurrence without deleting the new ListItem', async () => {
	const service = createFetchService(StableOccurrenceRefreshProvider);
	const sourceId = createArticleListSourceId(journal.id, URI.parse('https://example.com/articles'));
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	await service.fetchArticleListSource(sourceId, CancellationTokenNone);
	const firstPage = service.getArticlePages(sourceId)[0];
	const stableItemId = firstPage?.ungroupedItemIds[0];
	assert(stableItemId);
	assert.equal(service.getArticleListItem(stableItemId)?.title, 'Stable article 1');

	await service.refreshArticleListSource(sourceId, CancellationTokenNone);
	const refreshedPage = service.getArticlePages(sourceId)[0];
	assert.equal(refreshedPage?.id, firstPage?.id);
	assert.equal(refreshedPage?.ungroupedItemIds[0], stableItemId);
	assert.equal(service.getArticleListItem(stableItemId)?.title, 'Stable article 2');
});

class RejectingRefreshProvider extends TestFetchProvider {
	private pageRequestCount = 0;

	override canonicalizeArticleUri(uri: URI): URI {
		if (uri.path.endsWith('/invalid')) {
			throw new Error('Invalid canonical Article URI');
		}
		return super.canonicalizeArticleUri(uri);
	}

	override async fetchArticleListPage(
		_journal: JournalDescriptor,
		_source: ArticleListSource,
		url: URI,
		_token: CancellationToken,
	): Promise<ParsedArticleListPage> {
		this.pageRequestCount += 1;
		return {
			url,
			groups: [],
			ungroupedItems: this.pageRequestCount === 1
				? [{
					providerOccurrenceKey: 'original-card',
					articleUrl: URI.parse('https://example.com/articles/original'),
					title: 'Original article',
					authors: [],
					relatedArticles: [],
				}]
				: [{
					providerOccurrenceKey: 'new-card',
					articleUrl: URI.parse('https://example.com/articles/new'),
					title: 'New article',
					authors: [],
					relatedArticles: [],
				}, {
					providerOccurrenceKey: 'invalid-card',
					articleUrl: URI.parse('https://example.com/articles/invalid'),
					title: 'Invalid article',
					authors: [],
					relatedArticles: [],
				}],
		};
	}
}

test('FetchService leaves the previous Source snapshot intact when page preparation fails', async () => {
	const service = createFetchService(RejectingRefreshProvider);
	const sourceId = createArticleListSourceId(journal.id, URI.parse('https://example.com/articles'));
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	await service.fetchArticleListSource(sourceId, CancellationTokenNone);
	const originalPage = service.getArticlePages(sourceId)[0];
	const originalItemId = originalPage?.ungroupedItemIds[0];
	assert(originalItemId);

	await assert.rejects(
		service.refreshArticleListSource(sourceId, CancellationTokenNone),
		/Invalid canonical Article URI/,
	);
	assert.equal(service.getArticlePages(sourceId)[0], originalPage);
	assert.equal(service.getArticleListItem(originalItemId)?.title, 'Original article');
	assert.equal(
		service.getArticle(createArticleId(journal.id, URI.parse('https://example.com/articles/new'))),
		undefined,
	);
	assert.equal(service.getSourceLoadState(sourceId).status, 'error');
});

class CancellationObservedDetailProvider extends TestFetchProvider {
	static token: CancellationToken | undefined;

	static reset(): void {
		this.token = undefined;
	}

	override fetchArticleDetail(
		_journal: JournalDescriptor,
		_article: ArticleRecord,
		token: CancellationToken,
	): Promise<ParsedArticleDetail> {
		CancellationObservedDetailProvider.token = token;
		return new Promise((_resolve, reject) => {
			token.onCancellationRequested(() => reject(new CancellationError()));
		});
	}
}

test('FetchService cancels a shared task after every waiter cancels', async () => {
	CancellationObservedDetailProvider.reset();
	const service = createFetchService(CancellationObservedDetailProvider);
	const sourceId = createArticleListSourceId(journal.id, URI.parse('https://example.com/articles'));
	await service.discoverArticleListSources(journal.id, CancellationTokenNone);
	await service.fetchArticleListSource(sourceId, CancellationTokenNone);
	const articleId = createArticleId(journal.id, URI.parse('https://example.com/articles/one'));
	const firstSource = new CancellationTokenSource();
	const secondSource = new CancellationTokenSource();
	const first = service.fetchArticle(articleId, firstSource.token);
	const second = service.fetchArticle(articleId, secondSource.token);

	firstSource.cancel();
	secondSource.cancel();
	await assert.rejects(first, CancellationError);
	await assert.rejects(second, CancellationError);
	await Promise.resolve();
	assert.equal(CancellationObservedDetailProvider.token?.isCancellationRequested, true);
	assert.equal(service.getArticleLoadState(articleId).status, 'idle');
	firstSource.dispose();
	secondSource.dispose();
});
