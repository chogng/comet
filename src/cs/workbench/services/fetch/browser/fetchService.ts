/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import {
	CancellationError,
	CancellationToken,
	CancellationTokenSource,
} from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { EventEmitter } from 'cs/base/common/event';
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

interface IFetchTask<T> {
	readonly generation: number;
	readonly cancellationSource: CancellationTokenSource;
	promise: Promise<T>;
	waiterCount: number;
}

interface IPreparedArticlePage {
	readonly page: ArticlePage;
	readonly itemIds: readonly ArticleListItemId[];
	readonly items: ReadonlyMap<ArticleListItemId, ArticleListItem>;
	readonly articles: ReadonlyMap<ArticleId, ArticleRecord>;
}

/** Owns Fetch domain state independently from environment-specific provider contributions. */
export class FetchService extends Disposable implements IFetchService {
	declare readonly _serviceBrand: undefined;

	private readonly onDidChangeCatalogEmitter = this._register(new EventEmitter<JournalId>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeCatalog = this.onDidChangeCatalogEmitter.event;
	private readonly onDidChangeSourceEmitter = this._register(new EventEmitter<ArticleListSourceId>({
		onListenerError: onUnexpectedError,
	}));
	readonly onDidChangeSource = this.onDidChangeSourceEmitter.event;
	private readonly onDidChangeArticleEmitter = this._register(new EventEmitter<ArticleId>({
		onListenerError: onUnexpectedError,
	}));
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
	private readonly catalogTasks = new Map<JournalId, IFetchTask<void>>();
	private readonly sourceTasks = new Map<ArticleListSourceId, IFetchTask<void>>();
	private readonly articleTasks = new Map<ArticleId, IFetchTask<ArticleDetail>>();
	private readonly providers = new Map<FetchProviderId, IFetchProvider>();
	private nextTaskGeneration = 0;

	constructor(
		@IFetchRegistry private readonly registry: IFetchRegistry,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
	}

	override dispose(): void {
		for (const task of this.catalogTasks.values()) {
			task.cancellationSource.cancel();
		}
		for (const task of this.sourceTasks.values()) {
			task.cancellationSource.cancel();
		}
		for (const task of this.articleTasks.values()) {
			task.cancellationSource.cancel();
		}
		this.catalogTasks.clear();
		this.sourceTasks.clear();
		this.articleTasks.clear();
		super.dispose();
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
		if (token.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const existing = this.catalogTasks.get(journalId);
		if (existing && !replace) {
			return this._joinTask(existing, token);
		}
		existing?.cancellationSource.cancel();
		const journal = this._requireJournal(journalId);
		this._setLoadStateAndNotify(this.catalogLoadStates, journalId, 'loading', () => this.onDidChangeCatalogEmitter.fire(journalId));
		const task = this._startTask(this.catalogTasks, journalId, async taskToken => {
			const provider = this._getProvider(journal.providerId);
			const parsed = await provider.discoverArticleListSources(journal, taskToken);
			this._throwIfCancelled(taskToken);
			this._replaceCatalog(journal, provider, parsed);
		}, this.catalogLoadStates, () => this.onDidChangeCatalogEmitter.fire(journalId));
		return this._joinTask(task, token);
	}

	fetchArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void> {
		return this._fetchArticleListSource(sourceId, token, false);
	}

	refreshArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void> {
		return this._fetchArticleListSource(sourceId, token, true);
	}

	private _fetchArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken, replace: boolean): Promise<void> {
		if (token.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const existing = this.sourceTasks.get(sourceId);
		if (existing && !replace) {
			return this._joinTask(existing, token);
		}
		existing?.cancellationSource.cancel();
		const source = this._requireSource(sourceId);
		const journal = this._requireJournal(source.journalId);
		this._setLoadStateAndNotify(this.sourceLoadStates, sourceId, 'loading', () => this.onDidChangeSourceEmitter.fire(sourceId));
		const task = this._startTask(this.sourceTasks, sourceId, async taskToken => {
			const provider = this._getProvider(journal.providerId);
			const parsed = await provider.fetchArticleListPage(journal, source, source.url, taskToken);
			this._throwIfCancelled(taskToken);
			const prepared = this._preparePage(journal, source, provider, parsed);
			this._commitPreparedPage(source, prepared, false);
		}, this.sourceLoadStates, () => this.onDidChangeSourceEmitter.fire(sourceId));
		return this._joinTask(task, token);
	}

	fetchNextPage(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void> {
		if (token.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const existing = this.sourceTasks.get(sourceId);
		if (existing) {
			return this._joinTask(existing, token);
		}
		const source = this._requireSource(sourceId);
		const pageIds = this.sourcePageIds.get(sourceId);
		const lastPageId = pageIds?.at(-1);
		const nextPageUrl = lastPageId ? this.pages.get(lastPageId)?.nextPageUrl : undefined;
		if (!nextPageUrl) {
			throw new Error(`Article list source "${sourceId}" has no next page.`);
		}
		const journal = this._requireJournal(source.journalId);
		this._setLoadStateAndNotify(this.sourceLoadStates, sourceId, 'loading', () => this.onDidChangeSourceEmitter.fire(sourceId));
		const task = this._startTask(this.sourceTasks, sourceId, async taskToken => {
			const provider = this._getProvider(journal.providerId);
			const parsed = await provider.fetchArticleListPage(journal, source, nextPageUrl, taskToken);
			this._throwIfCancelled(taskToken);
			const prepared = this._preparePage(journal, source, provider, parsed);
			this._commitPreparedPage(source, prepared, true);
		}, this.sourceLoadStates, () => this.onDidChangeSourceEmitter.fire(sourceId));
		return this._joinTask(task, token);
	}

	fetchArticle(articleId: ArticleId, token: CancellationToken): Promise<ArticleDetail> {
		if (token.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const cached = this.details.get(articleId);
		if (cached) {
			return this._resolveForToken(cached, token);
		}
		const existing = this.articleTasks.get(articleId);
		if (existing) {
			return this._joinTask(existing, token);
		}
		const article = this._requireArticle(articleId);
		const journal = this._requireJournal(article.journalId);
		this._setLoadStateAndNotify(this.articleLoadStates, articleId, 'loading', () => this.onDidChangeArticleEmitter.fire(articleId));
		const task = this._startTask(this.articleTasks, articleId, async taskToken => {
			const provider = this._getProvider(journal.providerId);
			const parsed = await provider.fetchArticleDetail(journal, article, taskToken);
			this._throwIfCancelled(taskToken);
			const detail: ArticleDetail = {
				...parsed,
				articleId,
				journalId: journal.id,
				url: provider.canonicalizeArticleUri(parsed.url),
			};
			this.details.set(articleId, detail);
			if (detail.doi && this.articles.get(articleId) === article) {
				this.articles.set(articleId, { ...article, doi: detail.doi });
			}
			return detail;
		}, this.articleLoadStates, () => this.onDidChangeArticleEmitter.fire(articleId));
		return this._joinTask(task, token);
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

	private _preparePage(
		journal: JournalDescriptor,
		source: ArticleListSource,
		provider: IFetchProvider,
		parsed: ParsedArticleListPage,
	): IPreparedArticlePage {
		const url = provider.canonicalizePageUri(parsed.url);
		const pageId = createArticlePageId(source.id, url);
		const itemIds: ArticleListItemId[] = [];
		const items = new Map<ArticleListItemId, ArticleListItem>();
		const articles = new Map<ArticleId, ArticleRecord>();
		const prepareItem = (item: ParsedArticleListItem): ArticleListItemId => {
			const articleUrl = provider.canonicalizeArticleUri(item.articleUrl);
			const articleId = createArticleId(journal.id, articleUrl);
			const itemId = createArticleListItemId(pageId, articleId, item.providerOccurrenceKey);
			const {
				articleUrl: _articleUrl,
				doi,
				providerOccurrenceKey: _providerOccurrenceKey,
				...itemData
			} = item;
			if (items.has(itemId)) {
				throw new Error(`Article page "${pageId}" contains duplicate List Item identity "${itemId}".`);
			}
			items.set(itemId, { ...itemData, id: itemId, articleId });

			const previous = articles.get(articleId) ?? this.articles.get(articleId);
			if (!previous) {
				articles.set(articleId, {
					id: articleId,
					journalId: journal.id,
					url: articleUrl,
					doi,
				});
			} else if (doi && !previous.doi) {
				articles.set(articleId, { ...previous, doi });
			}
			return itemId;
		};
		const groups = parsed.groups.map((group, groupIndex) => {
			const groupItemIds = group.items.map(prepareItem);
			itemIds.push(...groupItemIds);
			return { id: createArticleGroupId(pageId, groupIndex), label: group.label, itemIds: groupItemIds };
		});
		const ungroupedItemIds = parsed.ungroupedItems.map(prepareItem);
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
		return { page, itemIds, items, articles };
	}

	private _commitPreparedPage(
		source: ArticleListSource,
		prepared: IPreparedArticlePage,
		append: boolean,
	): void {
		const previousPageIds = this.sourcePageIds.get(source.id) ?? [];
		const removedPageIds = append
			? previousPageIds.filter(pageId => pageId === prepared.page.id)
			: previousPageIds;
		for (const pageId of removedPageIds) {
			this._removePage(pageId);
		}

		for (const [itemId, item] of prepared.items) {
			this.items.set(itemId, item);
		}
		for (const [articleId, article] of prepared.articles) {
			this.articles.set(articleId, article);
		}
		this.pages.set(prepared.page.id, prepared.page);
		this.pageItemIds.set(prepared.page.id, [...prepared.itemIds]);
		const nextPageIds = append
			? previousPageIds.filter(pageId => pageId !== prepared.page.id)
			: [];
		nextPageIds.push(prepared.page.id);
		this.sourcePageIds.set(source.id, nextPageIds);
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

	private _startTask<T>(
		tasks: Map<string, IFetchTask<T>>,
		key: string,
		operation: (token: CancellationToken) => Promise<T>,
		loadStates: Map<string, FetchLoadState>,
		notify: () => void,
	): IFetchTask<T> {
		const cancellationSource = new CancellationTokenSource();
		const generation = ++this.nextTaskGeneration;
		const deferred = new DeferredPromise<T>();
		const task: IFetchTask<T> = {
			generation,
			cancellationSource,
			promise: deferred.p,
			waiterCount: 0,
		};
		tasks.set(key, task);
		deferred.complete((async (): Promise<T> => {
			try {
				const result = await operation(cancellationSource.token);
				this._throwIfCancelled(cancellationSource.token);
				if (tasks.get(key)?.generation === generation) {
					this._setLoadStateAndNotify(loadStates, key, 'ready', notify);
				}
				return result;
			} catch (error) {
				if (tasks.get(key)?.generation === generation) {
					this._setLoadStateAndNotify(loadStates, key, error instanceof CancellationError ? 'idle' : 'error', notify, error);
				}
				throw error;
			} finally {
				if (tasks.get(key)?.generation === generation) {
					tasks.delete(key);
				}
				cancellationSource.dispose();
			}
		})());
		return task;
	}

	private _joinTask<T>(task: IFetchTask<T>, token: CancellationToken): Promise<T> {
		if (token.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}

		task.waiterCount++;
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			let cancellationListener: ReturnType<CancellationToken['onCancellationRequested']> | undefined;
			const complete = (callback: () => void) => {
				if (settled) {
					return;
				}
				settled = true;
				cancellationListener?.dispose();
				task.waiterCount--;
				callback();
			};

			cancellationListener = token.onCancellationRequested(() => {
				complete(() => reject(new CancellationError()));
				if (task.waiterCount === 0) {
					task.cancellationSource.cancel();
				}
			});
			task.promise.then(
				result => complete(() => resolve(result)),
				error => complete(() => reject(error)),
			);
		});
	}

	private _resolveForToken<T>(value: T, token: CancellationToken): Promise<T> {
		return token.isCancellationRequested
			? Promise.reject(new CancellationError())
			: Promise.resolve(value);
	}

	private _throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
	}

	private _setLoadStateAndNotify(
		states: Map<string, FetchLoadState>,
		key: string,
		status: FetchLoadState['status'],
		notify: () => void,
		error?: unknown,
	): void {
		states.set(key, {
			status,
			error: status === 'error' ? error instanceof Error ? error.message : 'Fetch failed.' : undefined,
			updatedAt: new Date().toISOString(),
		});
		notify();
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
