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

function cardElement(card: Element, selector: string): Element | null {
	return [...card.querySelectorAll(selector)].find(element => !element.closest('[data-related-article]')) ?? null;
}

function cardElements(card: Element, selector: string): readonly Element[] {
	return [...card.querySelectorAll(selector)].filter(element => !element.closest('[data-related-article]'));
}

export function isScienceCurrentIssue(document: Document, base: URI): boolean {
	return /^\/toc\/[^/]+\/current\/?$/u.test(base.path)
		&& !!document.querySelector('main')
		&& !!document.querySelector('main section article, main [data-issue], main .issue-metadata');
}

export function parseScienceCurrentIssue(document: Document, base: URI): ParsedArticleListPage {
	const groups = [...document.querySelectorAll('main section')].map(section => {
		const items = parseScienceArticleCards(section, base);
		if (items.length === 0) {
			return undefined;
		}
		const label = text(section.querySelector(':scope > h2, :scope > h3, :scope > header h2, :scope > header h3'));
		if (!label) {
			throw new Error(`Science article section in "${base.toString(true)}" does not contain a label.`);
		}
		return {
			label,
			items,
		};
	}).filter((group): group is NonNullable<typeof group> => !!group);
	return {
		url: base,
		issue: parseIssueMetadata(document, base),
		groups,
		ungroupedItems: [],
		nextPageUrl: uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, base),
	};
}

export function parseScienceArticleCards(root: ParentNode, base: URI): ParsedArticleListItem[] {
	return [...root.querySelectorAll('article')].map(card => {
		const anchor = cardElement(card, 'h2 a[href], h3 a[href], a[href*="/doi/"]');
		const articleUrl = uriFromHref(anchor?.getAttribute('href') ?? null, base);
		const title = text(anchor);
		if (!articleUrl || !title) {
			throw new Error('Science article card is missing its article URL or title.');
		}
		const providerOccurrenceKey = card.getAttribute('data-article-id');
		if (!providerOccurrenceKey) {
			throw new Error(`Science article card "${articleUrl.toString(true)}" does not contain a stable occurrence key.`);
		}
		return {
			providerOccurrenceKey,
			articleUrl,
			title,
			description: text(cardElement(card, '.description, .summary')),
			abstract: text(cardElement(card, '.abstract-content, [data-section="abstract"] > p')),
			articleType: text(cardElement(card, '.article-type')),
			publishedAt: text(cardElement(card, 'time')),
			pageRange: text(cardElement(card, '.page-range')),
			isOpenAccess: card.matches('[data-access="open"], .open-access') ? true : undefined,
			authors: cardElements(card, '[rel="author"], .author-name').map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
			pdfUrl: uriFromHref(cardElement(card, 'a[href$=".pdf"], a[href*="/doi/pdf/"]')?.getAttribute('href') ?? null, base),
			relatedArticles: [...card.querySelectorAll('[data-related-article]')].map(related => {
				const relatedAnchor = related.querySelector('a[href]');
				const relatedUrl = uriFromHref(relatedAnchor?.getAttribute('href') ?? null, base);
				const relatedTitle = text(relatedAnchor);
				if (!relatedUrl || !relatedTitle) {
					throw new Error('Science related article is missing its URL or title.');
				}
				const relationLabel = text(related.querySelector('.relation-label'));
				if (!relationLabel) {
					throw new Error(`Science related article "${relatedUrl.toString(true)}" does not contain a relation label.`);
				}
				return {
					relationLabel,
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
