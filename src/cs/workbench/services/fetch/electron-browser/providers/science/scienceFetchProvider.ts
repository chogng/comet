/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { ArticleListSource, ArticleRecord, JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type { IFetchProvider, ParsedArticleDetail, ParsedArticleListCatalog, ParsedArticleListPage, ParsedArticleReadableContent } from 'cs/workbench/services/fetch/common/fetchProvider';
import { FetchPageSessionFactory, IFetchPageSessionFactory } from 'cs/workbench/services/fetch/electron-browser/fetchPageSession';
import { resolveFetchParser, type FetchParseContext } from 'cs/workbench/services/fetch/electron-browser/fetchParserResolver';
import { isScienceArticleDetail, parseScienceArticleDetail } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceArticleDetailParser';
import {
	parseScienceArticleReadableContent,
	scienceArticleReadableBodySelector,
} from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceArticleReadableContentParser';
import { parseScienceCatalog } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCatalogParser';
import { isScienceCurrentIssue, parseScienceCurrentIssue } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCurrentIssueParser';
import { isScienceFirstRelease, parseScienceFirstRelease } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceFirstReleaseParser';

const scienceTrackingQueryParameters = [
	'utm_campaign',
	'utm_content',
	'utm_medium',
	'utm_source',
	'utm_term',
] as const;

export class ScienceFetchProvider implements IFetchProvider {
	readonly id = 'publisher.science';

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
		const session = await this.pageSessionFactory.createOwned(this._admitsSnapshot);
		try {
			const snapshot = await session.navigateAndCapture(journal.discoveryUrl, { selector: 'a[href]', state: 'attached' }, token);
			return parseScienceCatalog(this._parseDocument(snapshot.html), snapshot.uri);
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleListPage(_journal: JournalDescriptor, _source: ArticleListSource, url: URI, token: CancellationToken): Promise<ParsedArticleListPage> {
		const session = await this.pageSessionFactory.createOwned(this._admitsSnapshot);
		try {
			const snapshot = await session.navigateAndCapture(url, { selector: 'main', state: 'attached' }, token);
			const context: FetchParseContext = { uri: snapshot.uri, document: this._parseDocument(snapshot.html) };
			return resolveFetchParser([
				{ id: 'science.current-issue', matches: ({ document, uri }) => isScienceCurrentIssue(document, uri), parser: parseScienceCurrentIssue },
				{ id: 'science.first-release', matches: ({ document, uri }) => isScienceFirstRelease(document, uri), parser: parseScienceFirstRelease },
			], context)(context.document, context.uri);
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleDetail(journal: JournalDescriptor, article: ArticleRecord, token: CancellationToken): Promise<ParsedArticleDetail> {
		const session = await this.pageSessionFactory.createOwned(this._admitsSnapshot);
		try {
			const snapshot = await session.navigateAndCapture(article.url, { selector: 'h1', state: 'visible' }, token);
			const context: FetchParseContext = {
				uri: snapshot.uri,
				document: this._parseDocument(snapshot.html),
			};
			return resolveFetchParser([
				{
					id: 'science.article-detail',
					matches: ({ document }) => isScienceArticleDetail(document),
					parser: parseScienceArticleDetail,
				},
			], context)(context.document, context.uri, journal);
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleReadableContent(
		_journal: JournalDescriptor,
		article: ArticleRecord,
		token: CancellationToken,
	): Promise<ParsedArticleReadableContent> {
		const session = await this.pageSessionFactory.createOwned(this._admitsSnapshot);
		try {
			const snapshot = await session.navigateAndCapture(
				article.url,
				{ selector: scienceArticleReadableBodySelector, state: 'visible' },
				token,
			);
			return parseScienceArticleReadableContent(this._parseDocument(snapshot.html), snapshot.uri);
		} finally {
			await session.dispose();
		}
	}

	private _parseDocument(html: string): Document {
		return new DOMParser().parseFromString(html, 'text/html');
	}

	private readonly _admitsSnapshot = (target: URI, snapshot: URI): boolean =>
		target.scheme === snapshot.scheme && target.authority === snapshot.authority;

	private _canonicalize(uri: URI): URI {
		const url = new URL(uri.toString(true));
		url.protocol = url.protocol.toLowerCase();
		url.hostname = url.hostname.toLowerCase();
		url.hash = '';
		for (const parameter of scienceTrackingQueryParameters) {
			url.searchParams.delete(parameter);
		}
		return URI.parse(url.toString());
	}
}
