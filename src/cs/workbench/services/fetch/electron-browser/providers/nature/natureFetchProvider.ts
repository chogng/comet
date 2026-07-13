/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { ArticleListSource, ArticleRecord, JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type {
	IFetchProvider,
	ParsedArticleDetail,
	ParsedArticleReadableContent,
	ParsedArticleListCatalog,
	ParsedArticleListCatalogEntry,
	ParsedArticleListPage,
} from 'cs/workbench/services/fetch/common/fetchProvider';
import { FetchPageSessionFactory, IFetchPageSessionFactory } from 'cs/workbench/services/fetch/electron-browser/fetchPageSession';
import { resolveFetchParser, type FetchParseContext } from 'cs/workbench/services/fetch/electron-browser/fetchParserResolver';
import { isNatureArticleDetail, parseNatureArticleDetail } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleDetailParser';
import {
	natureArticleReadableBodySelector,
	parseNatureArticleReadableContent,
} from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleReadableContentParser';
import { isNatureArticleList, isNatureNewsOpinionList, parseNatureArticleList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleListParser';
import {
	isNatureArticleTypeCatalog,
	parseNatureArticleTypeCatalog,
	parseNatureDirectListSource,
	parseNatureExploreGroups,
} from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureCatalogParser';
import { parseNatureNewsOpinionList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureNewsOpinionListParser';

const natureTrackingQueryParameters = [
	'utm_campaign',
	'utm_content',
	'utm_medium',
	'utm_source',
	'utm_term',
] as const;

type NatureCatalogEntryParser = (
	document: Document,
	base: URI,
	groupLabel: string,
) => ParsedArticleListCatalogEntry;

interface NatureCatalogPageDescriptor {
	readonly id: string;
	readonly supports: (uri: URI) => boolean;
	readonly matches: (context: FetchParseContext) => boolean;
	readonly parser: NatureCatalogEntryParser;
}

const natureArticleTypeGroupPaths = new Set([
	'research-articles',
	'reviews-and-analysis',
	'news-and-comment',
]);

const natureDirectListPaths = new Set([
	'/latest-news',
	'/news',
	'/opinion',
	'/research-analysis',
]);

function normalizedPath(uri: URI): string {
	const path = uri.path.replace(/\/+$/u, '');
	return path || '/';
}

function isNatureUri(uri: URI): boolean {
	return uri.scheme.toLowerCase() === 'https' && uri.authority.toLowerCase() === 'www.nature.com';
}

function isNatureArticleTypeGroupUri(uri: URI): boolean {
	const segments = normalizedPath(uri).split('/').filter(Boolean);
	return isNatureUri(uri) && segments.length === 2 && natureArticleTypeGroupPaths.has(segments[1]);
}

function isNatureDirectListUri(uri: URI): boolean {
	return isNatureUri(uri) && natureDirectListPaths.has(normalizedPath(uri));
}

const natureCatalogPageDescriptors: readonly NatureCatalogPageDescriptor[] = [
	{
		id: 'nature.article-type-catalog',
		supports: isNatureArticleTypeGroupUri,
		matches: ({ document, uri }) => isNatureArticleTypeGroupUri(uri) && isNatureArticleTypeCatalog(document),
		parser: parseNatureArticleTypeCatalog,
	},
	{
		id: 'nature.direct-list-catalog',
		supports: isNatureDirectListUri,
		matches: ({ document, uri }) => isNatureDirectListUri(uri) && isNatureNewsOpinionList(document),
		parser: parseNatureDirectListSource,
	},
];

function supportsNatureCatalogPage(uri: URI): boolean {
	const descriptors = natureCatalogPageDescriptors.filter(descriptor => descriptor.supports(uri));
	if (descriptors.length > 1) {
		throw new Error(`Multiple Nature Catalog descriptors support "${uri.toString(true)}": ${descriptors.map(descriptor => descriptor.id).join(', ')}.`);
	}
	return descriptors.length === 1;
}

function parseNatureCatalogEntry(
	context: FetchParseContext,
	groupLabel: string,
): ParsedArticleListCatalogEntry {
	return resolveFetchParser(natureCatalogPageDescriptors, context)(
		context.document,
		context.uri,
		groupLabel,
	);
}

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
		const session = await this.pageSessionFactory.createOwned(this._admitsSnapshot);
		try {
			const snapshot = await session.navigateAndCapture(
				journal.discoveryUrl,
				{ selector: 'main, [role="main"]', state: 'attached' },
				token,
			);
			const context: FetchParseContext = {
				uri: snapshot.uri,
				document: this._parseDocument(snapshot.html),
			};
			if (supportsNatureCatalogPage(context.uri)) {
				return { entries: [parseNatureCatalogEntry(context, journal.title)] };
			}

			const groups = parseNatureExploreGroups(context.document, context.uri)
				.filter(group => supportsNatureCatalogPage(group.url));
			if (groups.length === 0) {
				throw new Error(`Nature source discovery for "${context.uri.toString(true)}" does not contain supported Explore content.`);
			}
			const entries: ParsedArticleListCatalogEntry[] = [];
			for (const group of groups) {
				const groupSnapshot = await session.navigateAndCapture(
					group.url,
					{ selector: 'main, [role="main"]', state: 'attached' },
					token,
				);
				entries.push(parseNatureCatalogEntry({
					uri: groupSnapshot.uri,
					document: this._parseDocument(groupSnapshot.html),
				}, group.label));
			}
			return { entries };
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleListPage(_journal: JournalDescriptor, _source: ArticleListSource, url: URI, token: CancellationToken): Promise<ParsedArticleListPage> {
		const session = await this.pageSessionFactory.createOwned(this._admitsSnapshot);
		try {
			const snapshot = await session.navigateAndCapture(url, { selector: 'main, [role="main"]', state: 'attached' }, token);
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
		const session = await this.pageSessionFactory.createOwned(this._admitsSnapshot);
		try {
			const snapshot = await session.navigateAndCapture(article.url, { selector: 'h1', state: 'visible' }, token);
			const context: FetchParseContext = {
				uri: snapshot.uri,
				document: this._parseDocument(snapshot.html),
			};
			return resolveFetchParser([
				{
					id: 'nature.article-detail',
					matches: ({ document }) => isNatureArticleDetail(document),
					parser: parseNatureArticleDetail,
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
				{ selector: natureArticleReadableBodySelector, state: 'visible' },
				token,
			);
			return parseNatureArticleReadableContent(this._parseDocument(snapshot.html), snapshot.uri);
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
		for (const parameter of natureTrackingQueryParameters) {
			url.searchParams.delete(parameter);
		}
		return URI.parse(url.toString());
	}
}
