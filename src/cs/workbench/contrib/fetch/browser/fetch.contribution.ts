/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { Event } from 'cs/base/common/event';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import {
	IFetchService,
	type ArticleDetail,
	type ArticleId,
	type ArticleListCatalog,
	type ArticleListItem,
	type ArticleListItemId,
	type ArticleListSourceId,
	type ArticlePage,
	type ArticlePageId,
	type ArticleRecord,
	type FetchLoadState,
	type JournalDescriptor,
	type JournalId,
} from 'cs/workbench/services/fetch/common/fetch';

const unavailableMessage = 'Article fetching is not available in web.';
const idleLoadState: FetchLoadState = { status: 'idle' };

class WebFetchService implements IFetchService {
	declare readonly _serviceBrand: undefined;

	readonly onDidChangeCatalog = Event.None;
	readonly onDidChangeSource = Event.None;
	readonly onDidChangeArticle = Event.None;

	getJournals(): readonly JournalDescriptor[] {
		return [];
	}

	getJournal(_journalId: JournalId): JournalDescriptor | undefined {
		return undefined;
	}

	getArticleListCatalog(_journalId: JournalId): ArticleListCatalog | undefined {
		return undefined;
	}

	getArticlePage(_pageId: ArticlePageId): ArticlePage | undefined {
		return undefined;
	}

	getArticlePages(_sourceId: ArticleListSourceId): readonly ArticlePage[] {
		return [];
	}

	getArticleListItem(_itemId: ArticleListItemId): ArticleListItem | undefined {
		return undefined;
	}

	getArticle(_articleId: ArticleId): ArticleRecord | undefined {
		return undefined;
	}

	getArticleDetail(_articleId: ArticleId): ArticleDetail | undefined {
		return undefined;
	}

	getCatalogLoadState(_journalId: JournalId): FetchLoadState {
		return idleLoadState;
	}

	getSourceLoadState(_sourceId: ArticleListSourceId): FetchLoadState {
		return idleLoadState;
	}

	getArticleLoadState(_articleId: ArticleId): FetchLoadState {
		return idleLoadState;
	}

	discoverArticleListSources(_journalId: JournalId, _token: CancellationToken): Promise<void> {
		return Promise.reject(new Error(unavailableMessage));
	}

	fetchArticleListSource(_sourceId: ArticleListSourceId, _token: CancellationToken): Promise<void> {
		return Promise.reject(new Error(unavailableMessage));
	}

	fetchNextPage(_sourceId: ArticleListSourceId, _token: CancellationToken): Promise<void> {
		return Promise.reject(new Error(unavailableMessage));
	}

	fetchArticle(_articleId: ArticleId, _token: CancellationToken): Promise<ArticleDetail> {
		return Promise.reject(new Error(unavailableMessage));
	}

	refreshJournal(_journalId: JournalId, _token: CancellationToken): Promise<void> {
		return Promise.reject(new Error(unavailableMessage));
	}

	refreshArticleListSource(_sourceId: ArticleListSourceId, _token: CancellationToken): Promise<void> {
		return Promise.reject(new Error(unavailableMessage));
	}
}

registerSingleton(IFetchService, WebFetchService, InstantiationType.Delayed);
