/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { URI } from 'cs/base/common/uri';
import type {
	ArticleDetail,
	ArticleReadableContent,
	ArticleListItem,
	ArticleListSource,
	ArticlePublication,
	IssueMetadata,
	JournalDescriptor,
	ArticleRecord,
	FetchProviderId,
} from 'cs/workbench/services/fetch/common/fetch';

export interface IFetchProvider {
	readonly id: FetchProviderId;
	canonicalizeSourceUri(uri: URI): URI;
	canonicalizePageUri(uri: URI): URI;
	canonicalizeArticleUri(uri: URI): URI;
	discoverArticleListSources(journal: JournalDescriptor, token: CancellationToken): Promise<ParsedArticleListCatalog>;
	fetchArticleListPage(journal: JournalDescriptor, source: ArticleListSource, url: URI, token: CancellationToken): Promise<ParsedArticleListPage>;
	fetchArticleDetail(journal: JournalDescriptor, article: ArticleRecord, token: CancellationToken): Promise<ParsedArticleDetail>;
	fetchArticleReadableContent(journal: JournalDescriptor, article: ArticleRecord, token: CancellationToken): Promise<ParsedArticleReadableContent>;
}

export interface ParsedArticleListCatalog {
	readonly entries: readonly ParsedArticleListCatalogEntry[];
}

export type ParsedArticleListCatalogEntry = ParsedArticleListSourceGroup | ParsedArticleListSource;

export interface ParsedArticleListSourceGroup {
	readonly kind: 'group';
	readonly label: string;
	readonly sources: readonly ParsedArticleListSource[];
}

export interface ParsedArticleListSource {
	readonly kind: 'source';
	readonly label: string;
	readonly url: URI;
}

export interface ParsedArticleListPage {
	readonly url: URI;
	readonly issue?: IssueMetadata;
	readonly groups: readonly ParsedArticleGroup[];
	readonly ungroupedItems: readonly ParsedArticleListItem[];
	readonly nextPageUrl?: URI;
}

export interface ParsedArticleGroup {
	readonly label: string;
	readonly items: readonly ParsedArticleListItem[];
}

export interface ParsedArticleListItem extends Omit<ArticleListItem, 'id' | 'articleId'> {
	readonly providerOccurrenceKey: string;
	readonly articleUrl: URI;
	readonly doi?: string;
}

export interface ParsedArticleDetail extends Omit<ArticleDetail, 'articleId' | 'journalId' | 'publication'> {
	readonly publication: ArticlePublication;
}

export interface ParsedArticleReadableContent extends Pick<ArticleReadableContent, 'url' | 'title' | 'text'> {}
