/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationError, CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { SyncDescriptor } from 'cs/platform/instantiation/common/descriptors';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import type { ArticleListSource, ArticleRecord, JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import { createArticleId, createArticleListSourceId } from 'cs/workbench/services/fetch/common/fetchIds';
import type { IFetchProvider, ParsedArticleDetail, ParsedArticleListCatalog, ParsedArticleListPage } from 'cs/workbench/services/fetch/common/fetchProvider';
import { FetchRegistry, IFetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';
import { FetchService } from 'cs/workbench/services/fetch/electron-browser/fetchService';

class TestFetchProvider implements IFetchProvider {
	readonly id = 'provider.test';
	private listRequestCount = 0;

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
		return {
			url: article.url,
			doi: '10.1000/test',
			title: 'Authoritative title',
			subjects: [],
			authors: [],
			publication: { title: 'Test Journal' },
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

function createFetchService(provider: typeof TestFetchProvider = TestFetchProvider): FetchService {
	const registry = new FetchRegistry();
	registry.registerJournal(journal);
	registry.registerProvider({ id: 'provider.test', ctor: provider });
	const instantiationService: IInstantiationService = new InstantiationService(new ServiceCollection([IFetchRegistry, registry]), true);
	return instantiationService.createInstance(new SyncDescriptor(FetchService));
}

test('FetchService keeps source, list item, article record, and detail state distinct', async () => {
	const service = createFetchService();
	const catalogChanges: string[] = [];
	const sourceChanges: string[] = [];
	const articleChanges: string[] = [];
	service.onDidChangeCatalog(id => catalogChanges.push(id));
	service.onDidChangeSource(id => sourceChanges.push(id));
	service.onDidChangeArticle(id => articleChanges.push(id));

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

	await service.fetchNextPage(sourceId, CancellationTokenNone);
	const secondArticleId = createArticleId(journal.id, URI.parse('https://example.com/articles/two'));
	assert.notEqual(firstArticleId, secondArticleId);
	assert.ok(service.getArticle(secondArticleId));
	assert.deepEqual(catalogChanges, [journal.id]);
	assert.deepEqual(sourceChanges, [sourceId, sourceId]);
	assert.deepEqual(articleChanges, [firstArticleId]);
	assert.equal(service.getSourceLoadState(sourceId).status, 'ready');

	await service.refreshArticleListSource(sourceId, CancellationTokenNone);
	assert.equal(service.getArticlePages(sourceId).length, 1);
	assert.equal(service.getArticlePages(sourceId)[0].ungroupedItemIds.length, 1);
	assert.equal(service.getArticleDetail(firstArticleId)?.title, 'Authoritative title');

	await service.refreshJournal(journal.id, CancellationTokenNone);
	assert.equal(service.getArticlePages(sourceId).length, 1);
	assert.equal(service.getCatalogLoadState(journal.id).status, 'ready');
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
