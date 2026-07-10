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
	ParsedArticleListCatalog,
	ParsedArticleListItem,
	ParsedArticleListPage,
} from 'cs/workbench/services/fetch/common/fetchProvider';
import { FetchPageSessionFactory, IFetchPageSessionFactory } from 'cs/workbench/services/fetch/electron-browser/fetchPageSession';

function text(element: Element | null): string | undefined {
	const value = element?.textContent?.replace(/\s+/gu, ' ').trim();
	return value || undefined;
}

function uriFromHref(href: string | null, base: URI): URI | undefined {
	if (!href) {
		return undefined;
	}
	return URI.parse(new URL(href, base.toString(true)).toString());
}

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
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(journal.discoveryUrl, { selector: 'a', state: 'attached' }, token);
			const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
			const sources = [...document.querySelectorAll('a[href]')]
				.map(anchor => ({ label: text(anchor), url: uriFromHref(anchor.getAttribute('href'), snapshot.uri) }))
				.filter((entry): entry is { label: string; url: URI } => !!entry.label && !!entry.url)
				.filter(entry => /^(Current Issue|First Release)$/iu.test(entry.label));
			if (sources.length !== 2) {
				throw new Error(`Science source discovery for "${journal.id}" did not find both Current Issue and First Release.`);
			}
			return { entries: sources.map(source => ({ kind: 'source' as const, ...source })) };
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleListPage(_journal: JournalDescriptor, _source: ArticleListSource, url: URI, token: CancellationToken): Promise<ParsedArticleListPage> {
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(url, { selector: 'main', state: 'attached' }, token);
			const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
			const sections = [...document.querySelectorAll('main section')];
			const groups = sections.map(section => ({
				label: text(section.querySelector('h2, h3')) ?? 'Articles',
				items: this._parseItems(section, snapshot.uri),
			})).filter(group => group.items.length > 0);
			const ungroupedItems = groups.length === 0 ? this._parseItems(document, snapshot.uri) : [];
			const nextPageUrl = uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, snapshot.uri);
			return { url: snapshot.uri, groups, ungroupedItems, nextPageUrl };
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleDetail(journal: JournalDescriptor, article: ArticleRecord, token: CancellationToken): Promise<ParsedArticleDetail> {
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(article.url, { selector: 'h1', state: 'visible' }, token);
			const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
			const authors = [...document.querySelectorAll('[rel="author"], .author-name')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name);
			const title = text(document.querySelector('h1'));
			if (!title) {
				throw new Error(`Science article "${snapshot.uri.toString(true)}" does not contain a title.`);
			}
			return {
				url: snapshot.uri,
				doi: document.querySelector('meta[name="citation_doi"]')?.getAttribute('content') ?? undefined,
				title,
				abstract: text(document.querySelector('.abstract, [data-section="abstract"]')),
				articleType: text(document.querySelector('.article-type')),
				subjects: [...document.querySelectorAll('.subject a, [data-section="subject"] a')].map(subject => text(subject)).filter((subject): subject is string => !!subject),
				authors,
				publication: { title: text(document.querySelector('meta[name="citation_journal_title"]')) ?? journal.title },
				pdfUrl: uriFromHref(document.querySelector('a[href$=".pdf"]')?.getAttribute('href') ?? null, snapshot.uri),
			};
		} finally {
			await session.dispose();
		}
	}

	private _parseItems(root: ParentNode, base: URI): ParsedArticleListItem[] {
		return [...root.querySelectorAll('article')].map((card, index) => {
			const anchor = card.querySelector('h2 a[href], h3 a[href], a[href*="/doi/"]');
			const articleUrl = uriFromHref(anchor?.getAttribute('href') ?? null, base);
			const title = text(anchor);
			if (!articleUrl || !title) {
				throw new Error('Science article card is missing its article URL or title.');
			}
			return {
				providerOccurrenceKey: card.getAttribute('data-article-id') ?? `card:${index}`,
				articleUrl,
				title,
				description: text(card.querySelector('.description, .summary')),
				articleType: text(card.querySelector('.article-type')),
				publishedAt: text(card.querySelector('time')),
				authors: [...card.querySelectorAll('[rel="author"], .author-name')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
				relatedArticles: [],
			};
		});
	}

	private _canonicalize(uri: URI): URI {
		return uri.with({ scheme: uri.scheme.toLowerCase(), authority: uri.authority.toLowerCase(), fragment: null });
	}
}
