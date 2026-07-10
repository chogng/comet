/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { ArticleListSource, ArticleRecord, JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type { IFetchProvider, ParsedArticleDetail, ParsedArticleListCatalog, ParsedArticleListPage } from 'cs/workbench/services/fetch/common/fetchProvider';
import { FetchPageSessionFactory, IFetchPageSessionFactory } from 'cs/workbench/services/fetch/electron-browser/fetchPageSession';
import { resolveFetchParser, type FetchParseContext } from 'cs/workbench/services/fetch/electron-browser/fetchParserResolver';
import { parseNatureArticleDetail } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleDetailParser';
import { isNatureArticleList, parseNatureArticleList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleListParser';
import { isNatureArticleListCatalog, isNatureExploreCatalog, isNatureNewsOpinionListCatalog, parseNatureArticleListCatalog, parseNatureCatalog, parseNatureNewsOpinionListCatalog } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureCatalogParser';
import { isNatureNewsOpinionList, parseNatureNewsOpinionList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureNewsOpinionListParser';

export class NatureFetchProvider implements IFetchProvider {
	readonly id = 'publisher.nature';

	constructor(@IFetchPageSessionFactory private readonly pageSessionFactory: FetchPageSessionFactory) {}

	canonicalizeSourceUri(uri: URI): URI {
		return this._canonicalize(uri);
	}

	canonicalizePageUri(uri: URI): URI {
		return this._canonicalize(uri);
	}

	canonicalizeArticleUri(uri: URI): URI {
		return this._canonicalize(uri);
	}

	async discoverArticleListSources(journal: JournalDescriptor, token: CancellationToken): Promise<ParsedArticleListCatalog> {
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(journal.discoveryUrl, { selector: 'main', state: 'attached' }, token);
			const context: FetchParseContext = { uri: snapshot.uri, document: this._parseDocument(snapshot.html) };
			return resolveFetchParser([
				{ id: 'nature.explore-catalog', matches: ({ document }) => isNatureExploreCatalog(document), parser: parseNatureCatalog },
				{ id: 'nature.article-list-catalog', matches: ({ document }) => isNatureArticleListCatalog(document), parser: parseNatureArticleListCatalog },
				{ id: 'nature.news-opinion-list-catalog', matches: ({ document }) => isNatureNewsOpinionListCatalog(document), parser: parseNatureNewsOpinionListCatalog },
			], context)(context.document, context.uri);
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleListPage(_journal: JournalDescriptor, _source: ArticleListSource, url: URI, token: CancellationToken): Promise<ParsedArticleListPage> {
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(url, { selector: 'main', state: 'attached' }, token);
			const context: FetchParseContext = { uri: snapshot.uri, document: this._parseDocument(snapshot.html) };
			return resolveFetchParser([
				{ id: 'nature.article-list', matches: ({ document }) => isNatureArticleList(document), parser: parseNatureArticleList },
				{ id: 'nature.news-opinion-list', matches: ({ document }) => isNatureNewsOpinionList(document), parser: parseNatureNewsOpinionList },
			], context)(context.document, context.uri);
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleDetail(journal: JournalDescriptor, article: ArticleRecord, token: CancellationToken): Promise<ParsedArticleDetail> {
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(article.url, { selector: 'h1', state: 'visible' }, token);
			return parseNatureArticleDetail(this._parseDocument(snapshot.html), snapshot.uri, journal);
		} finally {
			await session.dispose();
		}
	}

	private _parseDocument(html: string): Document {
		return new DOMParser().parseFromString(html, 'text/html');
	}

	private _canonicalize(uri: URI): URI {
		return uri.with({ scheme: uri.scheme.toLowerCase(), authority: uri.authority.toLowerCase(), fragment: null });
	}
}
