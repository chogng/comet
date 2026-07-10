/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import type { ParsedArticleDetail } from 'cs/workbench/services/fetch/common/fetchProvider';

function text(element: Element | null): string | undefined {
	const value = element?.textContent?.replace(/\s+/gu, ' ').trim();
	return value || undefined;
}

function uriFromHref(href: string | null, base: URI): URI | undefined {
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
}

export function parseScienceArticleDetail(document: Document, base: URI, journal: JournalDescriptor): ParsedArticleDetail {
	const title = text(document.querySelector('h1'));
	if (!title) {
		throw new Error(`Science article "${base.toString(true)}" does not contain a title.`);
	}
	return {
		url: base,
		doi: document.querySelector('meta[name="citation_doi"]')?.getAttribute('content') ?? undefined,
		title,
		description: text(document.querySelector('.description, .article-teaser')),
		editorsSummary: text(document.querySelector('[data-section="editors-summary"], .editors-summary')),
		abstract: text(document.querySelector('.abstract-content, .abstract, [data-section="abstract"] > p')),
		articleType: text(document.querySelector('.article-type')),
		subjects: [...document.querySelectorAll('.subject a, [data-section="subject"] a')].map(subject => text(subject)).filter((subject): subject is string => !!subject),
		isOpenAccess: document.querySelector('[data-access="open"], .open-access') ? true : undefined,
		authors: [...document.querySelectorAll('[rel="author"], .author-name')].map(author => ({
			name: text(author) ?? '',
			isCorresponding: author.getAttribute('data-corresponding-author') === 'true' ? true : undefined,
		})).filter(author => !!author.name),
		publication: {
			title: document.querySelector('meta[name="citation_journal_title"]')?.getAttribute('content') ?? journal.title,
			volume: document.querySelector('meta[name="citation_volume"]')?.getAttribute('content') ?? undefined,
			issue: document.querySelector('meta[name="citation_issue"]')?.getAttribute('content') ?? undefined,
			pageRange: document.querySelector('meta[name="citation_firstpage"]')?.getAttribute('content') ?? undefined,
		},
		pdfUrl: uriFromHref(document.querySelector('a[href$=".pdf"]')?.getAttribute('href') ?? null, base),
		citationUrl: uriFromHref(document.querySelector('a[href*="citation"]')?.getAttribute('href') ?? null, base),
	};
}
