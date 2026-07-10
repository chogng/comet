/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { ParsedArticleListItem, ParsedArticleListPage } from 'cs/workbench/services/fetch/common/fetchProvider';

function text(element: Element | null): string | undefined {
	const value = element?.textContent?.replace(/\s+/gu, ' ').trim();
	return value || undefined;
}

function uriFromHref(href: string | null, base: URI): URI | undefined {
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
}

export function isNatureArticleList(document: Document): boolean {
	return !!document.querySelector('main article, main li[data-test*="article"]') && !isNatureNewsOpinionList(document);
}

export function isNatureNewsOpinionList(document: Document): boolean {
	return !!document.querySelector('main [data-test="news-opinion-list"], main .news-and-views-list');
}

export function parseNatureArticleList(document: Document, base: URI): ParsedArticleListPage {
	return {
		url: base,
		groups: [],
		ungroupedItems: parseNatureArticleCards(document, base),
		nextPageUrl: uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, base),
	};
}

export function parseNatureArticleCards(root: ParentNode, base: URI): ParsedArticleListItem[] {
	return [...root.querySelectorAll('article, li[data-test*="article"]')].map((card, index) => {
		const anchor = card.querySelector('h2 a[href], h3 a[href], a[data-track-action="view article"]');
		const articleUrl = uriFromHref(anchor?.getAttribute('href') ?? null, base);
		const title = text(anchor);
		if (!articleUrl || !title) {
			throw new Error('Nature article card is missing its article URL or title.');
		}
		const image = card.querySelector('img[src]');
		const imageUrl = uriFromHref(image?.getAttribute('src') ?? null, base);
		return {
			providerOccurrenceKey: card.getAttribute('data-test') ?? `card:${index}`,
			articleUrl,
			title,
			description: text(card.querySelector('.c-card__summary, .article-item__summary')),
			articleType: text(card.querySelector('.c-meta__type, .article-item__type')),
			publishedAt: text(card.querySelector('time')),
			authors: [...card.querySelectorAll('[data-test="author-name"], .c-author-list__item')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
			image: imageUrl ? { url: imageUrl, alt: image?.getAttribute('alt') ?? undefined } : undefined,
			relatedArticles: [],
		};
	});
}
