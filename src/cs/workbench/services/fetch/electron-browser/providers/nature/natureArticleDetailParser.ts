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

export function parseNatureArticleDetail(document: Document, base: URI, journal: JournalDescriptor): ParsedArticleDetail {
	const title = text(document.querySelector('h1'));
	if (!title) {
		throw new Error(`Nature article "${base.toString(true)}" does not contain a title.`);
	}
	return {
		url: base,
		doi: document.querySelector('meta[name="citation_doi"]')?.getAttribute('content') ?? undefined,
		title,
		description: text(document.querySelector('.article__teaser, .c-article-teaser__text')),
		abstract: text(document.querySelector('#Abs1-content, .c-article-section__content')),
		articleType: text(document.querySelector('.c-article-identifiers__type')),
		subjects: [...document.querySelectorAll('.c-article-subject-list a')].map(subject => text(subject)).filter((subject): subject is string => !!subject),
		authors: [...document.querySelectorAll('[data-test="author-name"], .c-article-author-list__item')].map(author => ({ name: text(author) ?? '' })).filter(author => !!author.name),
		publication: { title: document.querySelector('meta[name="citation_journal_title"]')?.getAttribute('content') ?? journal.title },
		pdfUrl: uriFromHref(document.querySelector('a[href$=".pdf"]')?.getAttribute('href') ?? null, base),
	};
}
