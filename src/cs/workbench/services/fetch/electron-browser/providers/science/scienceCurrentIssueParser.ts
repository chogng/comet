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

export function isScienceCurrentIssue(document: Document, base: URI): boolean {
	return !base.path.includes('first-release') && !!document.querySelector('main section article');
}

export function parseScienceCurrentIssue(document: Document, base: URI): ParsedArticleListPage {
	const groups = [...document.querySelectorAll('main section')].map(section => ({
		label: text(section.querySelector('h2, h3')) ?? 'Articles',
		items: parseScienceArticleCards(section, base),
	})).filter(group => group.items.length > 0);
	if (groups.length === 0) {
		throw new Error(`Science current issue "${base.toString(true)}" does not contain article sections.`);
	}
	return {
		url: base,
		issue: parseIssueMetadata(document, base),
		groups,
		ungroupedItems: [],
		nextPageUrl: uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, base),
	};
}

export function parseScienceArticleCards(root: ParentNode, base: URI): ParsedArticleListItem[] {
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
			abstract: text(card.querySelector('.abstract-content, [data-section="abstract"] > p')),
			articleType: text(card.querySelector('.article-type')),
			publishedAt: text(card.querySelector('time')),
			pageRange: text(card.querySelector('.page-range')),
			isOpenAccess: card.matches('[data-access="open"], .open-access') ? true : undefined,
			authors: [...card.querySelectorAll('[rel="author"], .author-name')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
			pdfUrl: uriFromHref(card.querySelector('a[href$=".pdf"]')?.getAttribute('href') ?? null, base),
			relatedArticles: [...card.querySelectorAll('[data-related-article]')].map(related => {
				const relatedAnchor = related.querySelector('a[href]');
				const relatedUrl = uriFromHref(relatedAnchor?.getAttribute('href') ?? null, base);
				const relatedTitle = text(relatedAnchor);
				if (!relatedUrl || !relatedTitle) {
					throw new Error('Science related article is missing its URL or title.');
				}
				return {
					relationLabel: text(related.querySelector('.relation-label')) ?? 'Related Article',
					url: relatedUrl,
					articleType: text(related.querySelector('.article-type')),
					title: relatedTitle,
					authors: [...related.querySelectorAll('[rel="author"], .author-name')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
					journalTitle: text(related.querySelector('.journal-title')),
					publishedAt: text(related.querySelector('time')),
				};
			}),
		};
	});
}

function parseIssueMetadata(document: Document, base: URI) {
	const issue = text(document.querySelector('[data-issue], .issue-metadata'));
	const volume = issue?.match(/Volume\s+(?<volume>[^,]+)/iu)?.groups?.volume;
	const number = issue?.match(/Issue\s+(?<issue>[^,]+)/iu)?.groups?.issue;
	const publishedAt = text(document.querySelector('[data-published-date], .issue-date, time'));
	const canonicalUrl = uriFromHref(document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? null, base);
	return volume || number || publishedAt || canonicalUrl ? { volume, issue: number, publishedAt, canonicalUrl } : undefined;
}
