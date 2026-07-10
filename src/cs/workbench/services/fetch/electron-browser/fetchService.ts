/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	CancellationError,
	CancellationToken,
	CancellationTokenSource,
} from 'cs/base/common/cancellation';
import { Event, EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import {
	ArticleDetail,
	ArticleId,
	ArticleListCatalog,
	ArticleListItem,
	ArticleListItemId,
	ArticleListSource,
	ArticleListSourceId,
	ArticlePage,
	ArticlePageId,
	ArticleRecord,
	FetchLoadState,
	FetchProviderId,
	IFetchService,
	JournalDescriptor,
	JournalId,
} from 'cs/workbench/services/fetch/common/fetch';
import {
	createArticleGroupId,
	createArticleId,
	createArticleListItemId,
	createArticleListSourceId,
	createArticlePageId,
} from 'cs/workbench/services/fetch/common/fetchIds';
import {
	IFetchProvider,
	ParsedArticleListCatalog,
	ParsedArticleListItem,
	ParsedArticleListPage,
} from 'cs/workbench/services/fetch/common/fetchProvider';
import { IFetchRegistry } from 'cs/workbench/services/fetch/common/fetchRegistry';

interface IFetchTask {
	readonly generation: number;
	readonly cancellationSource: CancellationTokenSource;
	readonly promise: Promise<void>;
}

interface IArticleTask {
	readonly generation: number;
	readonly cancellationSource: CancellationTokenSource;
	readonly promise: Promise<ArticleDetail>;
}

export class FetchService extends Disposable implements IFetchService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeCatalogEmitter = this._register(new EventEmitter<JournalId>());
	readonly onDidChangeCatalog = this.onDidChangeCatalogEmitter.event;
	private readonly onDidChangeSourceEmitter = this._register(new EventEmitter<ArticleListSourceId>());
	readonly onDidChangeSource = this.onDidChangeSourceEmitter.event;
	private readonly onDidChangeArticleEmitter = this._register(new EventEmitter<ArticleId>());
	readonly onDidChangeArticle = this.onDidChangeArticleEmitter.event;

	private readonly catalogs = new Map<JournalId, ArticleListCatalog>();
	private readonly sources = new Map<ArticleListSourceId, ArticleListSource>();
	private readonly pages = new Map<ArticlePageId, ArticlePage>();
	private readonly sourcePageIds = new Map<ArticleListSourceId, ArticlePageId[]>();
	private readonly pageItemIds = new Map<ArticlePageId, ArticleListItemId[]>();
	private readonly items = new Map<ArticleListItemId, ArticleListItem>();
	private readonly articles = new Map<ArticleId, ArticleRecord>();
	private readonly details = new Map<ArticleId, ArticleDetail>();
	private readonly catalogLoadStates = new Map<JournalId, FetchLoadState>();
	private readonly sourceLoadStates = new Map<ArticleListSourceId, FetchLoadState>();
	private readonly articleLoadStates = new Map<ArticleId, FetchLoadState>();
	private readonly catalogTasks = new Map<JournalId, IFetchTask>();
	private readonly sourceTasks = new Map<ArticleListSourceId, IFetchTask>();
	private readonly articleTasks = new Map<ArticleId, IArticleTask>();
	private readonly providers = new Map<FetchProviderId, IFetchProvider>();
	private nextTaskGeneration = 0;

	constructor(
		@IFetchRegistry private readonly registry: IFetchRegistry,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	getJournals(): readonly JournalDescriptor[] {
		return this.registry.getJournals();
	}

	getJournal(journalId: JournalId): JournalDescriptor | undefined {
		return this.registry.getJournal(journalId);
	}

	getArticleListCatalog(journalId: JournalId): ArticleListCatalog | undefined {
		return this.catalogs.get(journalId);
	}

	getArticlePage(pageId: ArticlePageId): ArticlePage | undefined {
		return this.pages.get(pageId);
	}

	getArticlePages(sourceId: ArticleListSourceId): readonly ArticlePage[] {
		return (this.sourcePageIds.get(sourceId) ?? []).map(pageId => this.pages.get(pageId)).filter((page): page is ArticlePage => !!page);
	}

	getArticleListItem(itemId: ArticleListItemId): ArticleListItem | undefined {
		return this.items.get(itemId);
	}

	getArticle(articleId: ArticleId): ArticleRecord | undefined {
		return this.articles.get(articleId);
	}

	getArticleDetail(articleId: ArticleId): ArticleDetail | undefined {
		return this.details.get(articleId);
	}

	getCatalogLoadState(journalId: JournalId): FetchLoadState {
		return this.catalogLoadStates.get(journalId) ?? { status: 'idle' };
	}

	getSourceLoadState(sourceId: ArticleListSourceId): FetchLoadState {
		return this.sourceLoadStates.get(sourceId) ?? { status: 'idle' };
	}

	getArticleLoadState(articleId: ArticleId): FetchLoadState {
		return this.articleLoadStates.get(articleId) ?? { status: 'idle' };
	}

	discoverArticleListSources(journalId: JournalId, token: CancellationToken): Promise<void> {
		return this._discoverArticleListSources(journalId, token, false);
	}

	refreshJournal(journalId: JournalId, token: CancellationToken): Promise<void> {
		return this._discoverArticleListSources(journalId, token, true);
	}

	private _discoverArticleListSources(journalId: JournalId, token: CancellationToken, replace: boolean): Promise<void> {
		const existing = this.catalogTasks.get(journalId);
		if (existing && !replace) {
			return existing.promise;
		}
		existing?.cancellationSource.cancel();
		const journal = this._requireJournal(journalId);
		this._setLoadState(this.catalogLoadStates, journalId, 'loading');
		const task = this._startTask(this.catalogTasks, journalId, token, async taskToken => {
			const provider = this._getProvider(journal.providerId);
			const parsed = await provider.discoverArticleListSources(journal, taskToken);
			this._throwIfCancelled(taskToken);
			this._replaceCatalog(journal, provider, parsed);
		}, this.catalogLoadStates);
		return task.promise;
	}

	fetchArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void> {
		return this._fetchArticleListSource(sourceId, token, false);
	}

	refreshArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void> {
		return this._fetchArticleListSource(sourceId, token, true);
	}

	private _fetchArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken, replace: boolean): Promise<void> {
		const existing = this.sourceTasks.get(sourceId);
		if (existing && !replace) {
			return existing.promise;
		}
		existing?.cancellationSource.cancel();
		const source = this._requireSource(sourceId);
		const journal = this._requireJournal(source.journalId);
		this._setLoadState(this.sourceLoadStates, sourceId, 'loading');
		const task = this._startTask(this.sourceTasks, sourceId, token, async taskToken => {
			const provider = this._getProvider(journal.providerId);
			const parsed = await provider.fetchArticleListPage(journal, source, source.url, taskToken);
			this._throwIfCancelled(taskToken);
			this._replaceSourcePages(sourceId);
			this._commitPage(journal, source, provider, parsed, false);
			this.onDidChangeSourceEmitter.fire(sourceId);
		}, this.sourceLoadStates);
		return task.promise;
	}

	fetchNextPage(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void> {
		const existing = this.sourceTasks.get(sourceId);
		if (existing) {
			return existing.promise;
		}
		const source = this._requireSource(sourceId);
		const pageIds = this.sourcePageIds.get(sourceId);
		const lastPageId = pageIds?.at(-1);
		const nextPageUrl = lastPageId ? this.pages.get(lastPageId)?.nextPageUrl : undefined;
		if (!nextPageUrl) {
			throw new Error(`Article list source "${sourceId}" has no next page.`);
		}
		const journal = this._requireJournal(source.journalId);
		this._setLoadState(this.sourceLoadStates, sourceId, 'loading');
		const task = this._startTask(this.sourceTasks, sourceId, token, async taskToken => {
			const provider = this._getProvider(journal.providerId);
			const parsed = await provider.fetchArticleListPage(journal, source, nextPageUrl, taskToken);
			this._throwIfCancelled(taskToken);
			this._commitPage(journal, source, provider, parsed, true);
			this.onDidChangeSourceEmitter.fire(sourceId);
		}, this.sourceLoadStates);
		return task.promise;
	}

	fetchArticle(articleId: ArticleId, token: CancellationToken): Promise<ArticleDetail> {
		const existing = this.articleTasks.get(articleId);
		if (existing) {
			return existing.promise;
		}
		const article = this._requireArticle(articleId);
		const journal = this._requireJournal(article.journalId);
		const cancellationSource = new CancellationTokenSource();
		const generation = ++this.nextTaskGeneration;
		const taskToken = this._combineTokens(token, cancellationSource.token);
		this._setLoadState(this.articleLoadStates, articleId, 'loading');
		const promise = (async () => {
			try {
				const provider = this._getProvider(journal.providerId);
				const parsed = await provider.fetchArticleDetail(journal, article, taskToken);
				this._throwIfCancelled(taskToken);
				const detail: ArticleDetail = {
					...parsed,
					articleId,
					journalId: journal.id,
					url: provider.canonicalizeArticleUri(parsed.url),
				};
				if (this.articleTasks.get(articleId)?.generation !== generation) {
					throw new CancellationError();
				}
				this.details.set(articleId, detail);
				if (detail.doi && this.articles.get(articleId) === article) {
					this.articles.set(articleId, { ...article, doi: detail.doi });
				}
				this.onDidChangeArticleEmitter.fire(articleId);
				this._setLoadState(this.articleLoadStates, articleId, 'ready');
				return detail;
			} catch (error) {
				if (this.articleTasks.get(articleId)?.generation === generation) {
					this._setLoadState(this.articleLoadStates, articleId, error instanceof CancellationError ? 'idle' : 'error', error);
				}
				throw error;
			} finally {
				if (this.articleTasks.get(articleId)?.generation === generation) {
					this.articleTasks.delete(articleId);
				}
				cancellationSource.dispose();
			}
		})();
		this.articleTasks.set(articleId, { generation, cancellationSource, promise });
		return promise;
	}

	private _replaceCatalog(journal: JournalDescriptor, provider: IFetchProvider, parsed: ParsedArticleListCatalog): void {
		const entries = parsed.entries.map(entry => {
			if (entry.kind === 'source') {
				return this._createSource(journal, provider, entry.label, entry.url);
			}
			return {
				kind: 'group' as const,
				label: entry.label,
				sources: entry.sources.map(source => this._createSource(journal, provider, source.label, source.url)),
			};
		});
		const nextCatalog: ArticleListCatalog = { journalId: journal.id, entries };
		const nextSourceIds = new Set(entries.flatMap(entry => entry.kind === 'source' ? [entry.id] : entry.sources.map(source => source.id)));
		const previousCatalog = this.catalogs.get(journal.id);
		if (previousCatalog) {
			for (const sourceId of this._getCatalogSourceIds(previousCatalog)) {
				if (!nextSourceIds.has(sourceId)) {
					this._removeSource(sourceId);
				}
			}
		}
		for (const entry of entries) {
			if (entry.kind === 'source') {
				this.sources.set(entry.id, entry);
			} else {
				for (const source of entry.sources) {
					this.sources.set(source.id, source);
				}
			}
		}
		this.catalogs.set(journal.id, nextCatalog);
		this.onDidChangeCatalogEmitter.fire(journal.id);
	}

	private _createSource(journal: JournalDescriptor, provider: IFetchProvider, label: string, url: ArticleListSource['url']): ArticleListSource {
		const canonicalUrl = provider.canonicalizeSourceUri(url);
		return {
			kind: 'source',
			id: createArticleListSourceId(journal.id, canonicalUrl),
			journalId: journal.id,
			label,
			url: canonicalUrl,
		};
	}

	private _commitPage(journal: JournalDescriptor, source: ArticleListSource, provider: IFetchProvider, parsed: ParsedArticleListPage, append: boolean): ArticlePage {
		const url = provider.canonicalizePageUri(parsed.url);
		const pageId = createArticlePageId(source.id, url);
		const itemIds: ArticleListItemId[] = [];
		const groups = parsed.groups.map((group, groupIndex) => {
			const groupItemIds = group.items.map(item => this._commitItem(journal, provider, pageId, item));
			itemIds.push(...groupItemIds);
			return { id: createArticleGroupId(pageId, groupIndex), label: group.label, itemIds: groupItemIds };
		});
		const ungroupedItemIds = parsed.ungroupedItems.map(item => this._commitItem(journal, provider, pageId, item));
		itemIds.push(...ungroupedItemIds);
		const page: ArticlePage = {
			id: pageId,
			sourceId: source.id,
			url,
			issue: parsed.issue,
			groups,
			ungroupedItemIds,
			nextPageUrl: parsed.nextPageUrl ? provider.canonicalizePageUri(parsed.nextPageUrl) : undefined,
		};
		this._removePage(pageId);
		this.pages.set(pageId, page);
		this.pageItemIds.set(pageId, itemIds);
		const pageIds = this.sourcePageIds.get(source.id) ?? [];
		if (!append) {
			pageIds.length = 0;
		}
		if (!pageIds.includes(pageId)) {
			pageIds.push(pageId);
		}
		this.sourcePageIds.set(source.id, pageIds);
		return page;
	}

	private _commitItem(journal: JournalDescriptor, provider: IFetchProvider, pageId: ArticlePageId, parsed: ParsedArticleListItem): ArticleListItemId {
		const articleUrl = provider.canonicalizeArticleUri(parsed.articleUrl);
		const articleId = createArticleId(journal.id, articleUrl);
		const itemId = createArticleListItemId(pageId, articleId, parsed.providerOccurrenceKey);
		const { articleUrl: _articleUrl, doi, providerOccurrenceKey: _providerOccurrenceKey, ...item } = parsed;
		this.items.set(itemId, { ...item, id: itemId, articleId });
		const previous = this.articles.get(articleId);
		if (!previous) {
			this.articles.set(articleId, { id: articleId, journalId: journal.id, url: articleUrl, doi });
		} else if (doi && !previous.doi) {
			this.articles.set(articleId, { ...previous, doi });
		}
		return itemId;
	}

	private _replaceSourcePages(sourceId: ArticleListSourceId): void {
		for (const pageId of this.sourcePageIds.get(sourceId) ?? []) {
			this._removePage(pageId);
		}
		this.sourcePageIds.delete(sourceId);
	}

	private _removeSource(sourceId: ArticleListSourceId): void {
		this.sourceTasks.get(sourceId)?.cancellationSource.cancel();
		this.sourceTasks.delete(sourceId);
		this._replaceSourcePages(sourceId);
		this.sources.delete(sourceId);
		this.sourceLoadStates.delete(sourceId);
	}

	private _removePage(pageId: ArticlePageId): void {
		for (const itemId of this.pageItemIds.get(pageId) ?? []) {
			this.items.delete(itemId);
		}
		this.pageItemIds.delete(pageId);
		this.pages.delete(pageId);
	}

	private _getCatalogSourceIds(catalog: ArticleListCatalog): readonly ArticleListSourceId[] {
		return catalog.entries.flatMap(entry => entry.kind === 'source' ? [entry.id] : entry.sources.map(source => source.id));
	}

	private _getProvider(providerId: FetchProviderId): IFetchProvider {
		const existing = this.providers.get(providerId);
		if (existing) {
			return existing;
		}
		const descriptor = this.registry.getProviderDescriptor(providerId);
		if (!descriptor) {
			throw new Error(`Fetch provider "${providerId}" is not registered.`);
		}
		const provider = this.instantiationService.createInstance(descriptor.ctor);
		this.providers.set(providerId, provider);
		return provider;
	}

	private _startTask(tasks: Map<string, IFetchTask>, key: string, token: CancellationToken, operation: (token: CancellationToken) => Promise<void>, loadStates: Map<string, FetchLoadState>): IFetchTask {
		const cancellationSource = new CancellationTokenSource();
		const generation = ++this.nextTaskGeneration;
		const taskToken = this._combineTokens(token, cancellationSource.token);
		const promise = (async () => {
			try {
				await operation(taskToken);
				if (tasks.get(key)?.generation === generation) {
					this._setLoadState(loadStates, key, 'ready');
				}
			} catch (error) {
				if (tasks.get(key)?.generation === generation) {
					this._setLoadState(loadStates, key, error instanceof CancellationError ? 'idle' : 'error', error);
				}
				throw error;
			} finally {
				if (tasks.get(key)?.generation === generation) {
					tasks.delete(key);
				}
				cancellationSource.dispose();
			}
		})();
		const task = { generation, cancellationSource, promise };
		tasks.set(key, task);
		return task;
	}

	private _combineTokens(...tokens: readonly CancellationToken[]): CancellationToken {
		return {
			get isCancellationRequested() {
				return tokens.some(token => token.isCancellationRequested);
			},
			onCancellationRequested: Event.any(...tokens.map(token => token.onCancellationRequested)),
		};
	}

	private _throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
	}

	private _setLoadState(states: Map<string, FetchLoadState>, key: string, status: FetchLoadState['status'], error?: unknown): void {
		states.set(key, {
			status,
			error: status === 'error' ? error instanceof Error ? error.message : 'Fetch failed.' : undefined,
			updatedAt: new Date().toISOString(),
		});
	}

	private _requireJournal(journalId: JournalId): JournalDescriptor {
		const journal = this.registry.getJournal(journalId);
		if (!journal) {
			throw new Error(`Journal "${journalId}" is not registered.`);
		}
		return journal;
	}

	private _requireSource(sourceId: ArticleListSourceId): ArticleListSource {
		const source = this.sources.get(sourceId);
		if (!source) {
			throw new Error(`Article list source "${sourceId}" is not available.`);
		}
		return source;
	}

	private _requireArticle(articleId: ArticleId): ArticleRecord {
		const article = this.articles.get(articleId);
		if (!article) {
			throw new Error(`Article "${articleId}" is not available.`);
		}
		return article;
	}
}
