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

function content(document: Document, name: string): string | undefined {
	return document.querySelector(`meta[name="${name}"]`)?.getAttribute('content')?.trim() || undefined;
}

function publicationYear(publishedAt: string | undefined): number | undefined {
	const year = publishedAt?.match(/^\d{4}/u)?.[0];
	return year ? Number(year) : undefined;
}

function pageRange(document: Document): string | undefined {
	const firstPage = content(document, 'citation_firstpage');
	const lastPage = content(document, 'citation_lastpage');
	if (!firstPage) {
		return undefined;
	}
	return lastPage && lastPage !== firstPage ? `${firstPage}-${lastPage}` : firstPage;
}

export function isScienceArticleDetail(document: Document): boolean {
	return Boolean(
		document.querySelector('main h1')
		&& document.querySelector('meta[name="citation_doi"]')
		&& document.querySelector('meta[name="citation_journal_title"]'),
	);
}

export function parseScienceArticleDetail(document: Document, base: URI, journal: JournalDescriptor): ParsedArticleDetail {
	const title = text(document.querySelector('h1'));
	if (!title) {
		throw new Error(`Science article "${base.toString(true)}" does not contain a title.`);
	}
	const publishedAt = content(document, 'citation_publication_date')
		?? document.querySelector('main time[datetime]')?.getAttribute('datetime')?.trim()
		?? text(document.querySelector('main time'));
	return {
		url: base,
		doi: content(document, 'citation_doi'),
		title,
		description: text(document.querySelector('.description, .article-teaser')),
		editorsSummary: text(document.querySelector('[data-section="editors-summary"], .editors-summary')),
		abstract: text(document.querySelector('.abstract-content, .abstract, [data-section="abstract"] > p')),
		articleType: text(document.querySelector('.article-type')),
		subjects: [...document.querySelectorAll('.subject a, [data-section="subject"] a')].map(subject => text(subject)).filter((subject): subject is string => !!subject),
		publishedAt,
		isOpenAccess: document.querySelector('[data-access="open"], .open-access') ? true : undefined,
		authors: [...document.querySelectorAll('[rel="author"], .author-name')].map(author => ({
			name: text(author) ?? '',
			isCorresponding: author.getAttribute('data-corresponding-author') === 'true' ? true : undefined,
		})).filter(author => !!author.name),
		publication: {
			title: content(document, 'citation_journal_title') ?? journal.title,
			url: uriFromHref(document.querySelector('a[data-test="journal-link"][href]')?.getAttribute('href') ?? null, base),
			volume: content(document, 'citation_volume'),
			issue: content(document, 'citation_issue'),
			articleNumber: content(document, 'citation_article_number'),
			pageRange: pageRange(document),
			year: publicationYear(publishedAt),
		},
		pdfUrl: uriFromHref(content(document, 'citation_pdf_url') ?? null, base),
		citationUrl: uriFromHref(document.querySelector('a[href*="showCitFormats"]')?.getAttribute('href') ?? null, base),
	};
}
