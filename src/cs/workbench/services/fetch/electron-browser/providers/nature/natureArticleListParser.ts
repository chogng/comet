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

function occurrenceKey(anchor: Element | null, index: number): string {
	const trackingLabel = anchor?.getAttribute('data-track-label')?.trim();
	return trackingLabel && trackingLabel !== 'link' ? trackingLabel : `article:${index}`;
}

export function isNatureArticleList(document: Document): boolean {
	return !!document.querySelector('main article, main li[data-test*="article"]') && !isNatureNewsOpinionList(document);
}

export function isNatureNewsOpinionList(document: Document): boolean {
	return !!document.querySelector('[role="main"] .c-article-list .c-article-item__content > a[href]');
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
	const cards = [...new Set(root.querySelectorAll([
		'article',
		'li[data-test*="article"]',
		'.c-article-item__content',
	].join(', ')))];
	return cards.map((card, index) => {
		const anchor = card.querySelector([
			':scope > a[href]',
			'h2 a[href]',
			'h3 a[href]',
			'a[data-track-action="view article"]',
		].join(', '));
		const articleUrl = uriFromHref(anchor?.getAttribute('href') ?? null, base);
		const title = text(card.querySelector('h2, h3, .c-article-item__title'));
		if (!articleUrl || !title) {
			throw new Error('Nature article card is missing its article URL or title.');
		}
		const image = card.querySelector('img[src]');
		const imageUrl = uriFromHref(image?.getAttribute('src') ?? null, base);
		return {
			providerOccurrenceKey: occurrenceKey(anchor, index),
			articleUrl,
			title,
			description: text(card.querySelector('.c-card__summary, .article-item__summary, .c-article-item__standfirst')),
			articleType: text(card.querySelector('.c-meta__type, .article-item__type, .c-article-item__article-type')),
			publishedAt: text(card.querySelector('time, .c-article-item__date')),
			isOpenAccess: card.querySelector('[data-test="open-access"], .u-color-open-access') ? true : undefined,
			authors: [...card.querySelectorAll('[data-test="author-name"], [data-test="author-list"] [itemprop="name"], .c-author-list__item')]
				.map(author => ({ name: text(author) ?? '' }))
				.filter(author => !!author.name),
			image: imageUrl ? { url: imageUrl, alt: image?.getAttribute('alt') ?? undefined } : undefined,
			relatedArticles: [],
		};
	});
}
