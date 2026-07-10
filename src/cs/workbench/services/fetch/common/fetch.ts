/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import type { URI } from 'cs/base/common/uri';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export type JournalId = string;
export type FetchProviderId = string;
export type ArticleListSourceId = string;
export type ArticlePageId = string;
export type ArticleGroupId = string;
export type ArticleListItemId = string;
export type ArticleId = string;

export interface JournalDescriptor {
	readonly id: JournalId;
	readonly title: string;
	readonly homeUrl: URI;
	readonly discoveryUrl: URI;
	readonly providerId: FetchProviderId;
}

export interface ArticleListCatalog {
	readonly journalId: JournalId;
	readonly entries: readonly ArticleListCatalogEntry[];
}

export type ArticleListCatalogEntry = ArticleListSourceGroup | ArticleListSource;

export interface ArticleListSourceGroup {
	readonly kind: 'group';
	readonly label: string;
	readonly sources: readonly ArticleListSource[];
}

export interface ArticleListSource {
	readonly kind: 'source';
	readonly id: ArticleListSourceId;
	readonly journalId: JournalId;
	readonly label: string;
	readonly url: URI;
}

export interface ArticlePage {
	readonly id: ArticlePageId;
	readonly sourceId: ArticleListSourceId;
	readonly url: URI;
	readonly issue?: IssueMetadata;
	readonly groups: readonly ArticleGroup[];
	readonly ungroupedItemIds: readonly ArticleListItemId[];
	readonly nextPageUrl?: URI;
}

export interface IssueMetadata {
	readonly volume?: string;
	readonly issue?: string;
	readonly publishedAt?: string;
	readonly canonicalUrl?: URI;
}

export interface ArticleGroup {
	readonly id: ArticleGroupId;
	readonly label: string;
	readonly itemIds: readonly ArticleListItemId[];
}

export interface ArticleListItem {
	readonly id: ArticleListItemId;
	readonly articleId: ArticleId;
	readonly title: string;
	readonly description?: string;
	readonly abstract?: string;
	readonly articleType?: string;
	readonly subject?: string;
	readonly publishedAt?: string;
	readonly pageRange?: string;
	readonly isOpenAccess?: boolean;
	readonly authors: readonly ArticleAuthorRef[];
	readonly image?: ArticleImage;
	readonly pdfUrl?: URI;
	readonly relatedArticles: readonly RelatedArticleRef[];
}

export interface RelatedArticleRef {
	readonly relationLabel: string;
	readonly url: URI;
	readonly articleType?: string;
	readonly title: string;
	readonly authors: readonly ArticleAuthorRef[];
	readonly journalTitle?: string;
	readonly publishedAt?: string;
}

export interface ArticleAuthorRef {
	readonly name: string;
	readonly url?: URI;
}

export interface ArticleImage {
	readonly url: URI;
	readonly alt?: string;
}

export interface ArticleRecord {
	readonly id: ArticleId;
	readonly journalId: JournalId;
	readonly url: URI;
	readonly doi?: string;
}

export interface ArticleDetail {
	readonly articleId: ArticleId;
	readonly journalId: JournalId;
	readonly url: URI;
	readonly doi?: string;
	readonly title: string;
	readonly description?: string;
	readonly editorsSummary?: string;
	readonly abstract?: string;
	readonly articleType?: string;
	readonly subjects: readonly string[];
	readonly publishedAt?: string;
	readonly isOpenAccess?: boolean;
	readonly authors: readonly ArticleAuthor[];
	readonly publication: ArticlePublication;
	readonly pdfUrl?: URI;
	readonly citationUrl?: URI;
}

export interface ArticleAuthor extends ArticleAuthorRef {
	readonly isCorresponding?: boolean;
}

export interface ArticlePublication {
	readonly journalId?: JournalId;
	readonly title: string;
	readonly url?: URI;
	readonly volume?: string;
	readonly issue?: string;
	readonly articleNumber?: string;
	readonly pageRange?: string;
	readonly year?: number;
}

export interface FetchLoadState {
	readonly status: 'idle' | 'loading' | 'ready' | 'error';
	readonly error?: string;
	readonly updatedAt?: string;
}

export const IFetchService = createDecorator<IFetchService>('fetchService');

export interface IFetchService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeCatalog: Event<JournalId>;
	readonly onDidChangeSource: Event<ArticleListSourceId>;
	readonly onDidChangeArticle: Event<ArticleId>;
	getJournals(): readonly JournalDescriptor[];
	getJournal(journalId: JournalId): JournalDescriptor | undefined;
	getArticleListCatalog(journalId: JournalId): ArticleListCatalog | undefined;
	getArticlePage(pageId: ArticlePageId): ArticlePage | undefined;
	getArticleListItem(itemId: ArticleListItemId): ArticleListItem | undefined;
	getArticle(articleId: ArticleId): ArticleRecord | undefined;
	getArticleDetail(articleId: ArticleId): ArticleDetail | undefined;
	discoverArticleListSources(journalId: JournalId, token: CancellationToken): Promise<void>;
	fetchArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void>;
	fetchArticleListUrl(
		journalId: JournalId,
		url: URI,
		label: string,
		token: CancellationToken,
	): Promise<ArticlePage>;
	fetchNextPage(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void>;
	fetchArticle(articleId: ArticleId, token: CancellationToken): Promise<ArticleDetail>;
	refreshJournal(journalId: JournalId, token: CancellationToken): Promise<void>;
	refreshArticleListSource(sourceId: ArticleListSourceId, token: CancellationToken): Promise<void>;
}
