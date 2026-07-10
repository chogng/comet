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
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
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
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(journal.discoveryUrl, { selector: 'a[href]', state: 'attached' }, token);
			const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
			const groups = [...document.querySelectorAll('nav, aside, section')].map(container => {
				const label = text(container.querySelector('h2, h3, [aria-level]'));
				const sources = [...container.querySelectorAll('a[href]')]
					.map(anchor => ({ label: text(anchor), url: uriFromHref(anchor.getAttribute('href'), snapshot.uri) }))
					.filter((entry): entry is { label: string; url: URI } => !!entry.label && !!entry.url)
					.filter(entry => /article|review|commentary|correspondence|editorial|perspective|report/iu.test(entry.label));
				return label && sources.length > 0 ? {
					kind: 'group' as const,
					label,
					sources: dedupeSources(sources).map(source => ({ kind: 'source' as const, ...source })),
				} : undefined;
			}).filter((entry): entry is NonNullable<typeof entry> => !!entry);
			if (groups.length === 0) {
				throw new Error(`Nature source discovery for "${journal.id}" did not find an article type catalog.`);
			}
			return { entries: groups };
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleListPage(_journal: JournalDescriptor, _source: ArticleListSource, url: URI, token: CancellationToken): Promise<ParsedArticleListPage> {
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(url, { selector: 'main', state: 'attached' }, token);
			const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
			return {
				url: snapshot.uri,
				groups: [],
				ungroupedItems: this._parseItems(document, snapshot.uri),
				nextPageUrl: uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, snapshot.uri),
			};
		} finally {
			await session.dispose();
		}
	}

	async fetchArticleDetail(journal: JournalDescriptor, article: ArticleRecord, token: CancellationToken): Promise<ParsedArticleDetail> {
		const session = await this.pageSessionFactory.createOwned((target, snapshot) => target.authority === snapshot.authority);
		try {
			const snapshot = await session.navigateAndCapture(article.url, { selector: 'h1', state: 'visible' }, token);
			const document = new DOMParser().parseFromString(snapshot.html, 'text/html');
			const title = text(document.querySelector('h1'));
			if (!title) {
				throw new Error(`Nature article "${snapshot.uri.toString(true)}" does not contain a title.`);
			}
			return {
				url: snapshot.uri,
				doi: document.querySelector('meta[name="citation_doi"]')?.getAttribute('content') ?? undefined,
				title,
				description: text(document.querySelector('.article__teaser, .c-article-teaser__text')),
				abstract: text(document.querySelector('#Abs1-content, .c-article-section__content')),
				articleType: text(document.querySelector('.c-article-identifiers__type')),
				subjects: [...document.querySelectorAll('.c-article-subject-list a')].map(subject => text(subject)).filter((subject): subject is string => !!subject),
				authors: [...document.querySelectorAll('[data-test="author-name"], .c-article-author-list__item')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
				publication: { title: document.querySelector('meta[name="citation_journal_title"]')?.getAttribute('content') ?? journal.title },
				pdfUrl: uriFromHref(document.querySelector('a[href$=".pdf"]')?.getAttribute('href') ?? null, snapshot.uri),
			};
		} finally {
			await session.dispose();
		}
	}

	private _parseItems(root: ParentNode, base: URI): ParsedArticleListItem[] {
		return [...root.querySelectorAll('article, li[data-test*="article"]')].map((card, index) => {
			const anchor = card.querySelector('h2 a[href], h3 a[href], a[data-track-action="view article"]');
			const articleUrl = uriFromHref(anchor?.getAttribute('href') ?? null, base);
			const title = text(anchor);
			if (!articleUrl || !title) {
				throw new Error('Nature article card is missing its article URL or title.');
			}
			return {
				providerOccurrenceKey: card.getAttribute('data-test') ?? `card:${index}`,
				articleUrl,
				title,
				description: text(card.querySelector('.c-card__summary, .article-item__summary')),
				articleType: text(card.querySelector('.c-meta__type, .article-item__type')),
				publishedAt: text(card.querySelector('time')),
				authors: [...card.querySelectorAll('[data-test="author-name"], .c-author-list__item')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
				image: (() => {
					const image = card.querySelector('img[src]');
					const url = uriFromHref(image?.getAttribute('src') ?? null, base);
					return url ? { url, alt: image?.getAttribute('alt') ?? undefined } : undefined;
				})(),
				relatedArticles: [],
			};
		});
	}

	private _canonicalize(uri: URI): URI {
		return uri.with({ scheme: uri.scheme.toLowerCase(), authority: uri.authority.toLowerCase(), fragment: null });
	}
}

function dedupeSources(sources: readonly { label: string; url: URI }[]): readonly { label: string; url: URI }[] {
	const seen = new Set<string>();
	return sources.filter(source => {
		const key = source.url.toString(true);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}
