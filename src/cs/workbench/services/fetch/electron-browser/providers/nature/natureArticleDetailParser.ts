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

function publicationYear(document: Document): number | undefined {
	const value = text(document.querySelector('[data-test="article-publication-year"]'));
	return value && /^\d{4}$/u.test(value) ? Number(value) : undefined;
}

export function isNatureArticleDetail(document: Document): boolean {
	return Boolean(
		document.querySelector('main h1')
		&& document.querySelector('meta[name="citation_doi"]')
		&& document.querySelector('meta[name="citation_journal_title"]'),
	);
}

export function parseNatureArticleDetail(document: Document, base: URI, journal: JournalDescriptor): ParsedArticleDetail {
	const title = text(document.querySelector('h1'));
	if (!title) {
		throw new Error(`Nature article "${base.toString(true)}" does not contain a title.`);
	}
	const correspondingAuthors = new Set(
		[...document.querySelectorAll('#corresponding-author-list a[href^="mailto:"]')]
			.map(author => text(author))
			.filter((author): author is string => !!author),
	);
	return {
		url: base,
		doi: content(document, 'citation_doi'),
		title,
		description: text(document.querySelector('.article__teaser, .c-article-teaser__text')),
		abstract: text(document.querySelector('#Abs1-content, .c-article-section__content')),
		articleType: text(document.querySelector('[data-test="article-category"], .c-article-identifiers__type'))
			?? content(document, 'citation_article_type'),
		subjects: [...document.querySelectorAll('.c-article-subject-list a')].map(subject => text(subject)).filter((subject): subject is string => !!subject),
		publishedAt: document.querySelector('[data-test="article-identifier"] time[datetime]')?.getAttribute('datetime')?.trim()
			|| content(document, 'citation_online_date'),
		isOpenAccess: document.querySelector('[data-test="open-access"]') ? true : undefined,
		authors: [...document.querySelectorAll('[data-test="author-name"]')].map(author => {
			const name = text(author) ?? '';
			return { name, isCorresponding: correspondingAuthors.has(name) ? true : undefined };
		}).filter(author => !!author.name),
		publication: {
			title: content(document, 'citation_journal_title') ?? journal.title,
			url: uriFromHref(document.querySelector('a[data-test="journal-link"][href]')?.getAttribute('href') ?? null, base),
			year: publicationYear(document),
		},
		pdfUrl: uriFromHref(content(document, 'citation_pdf_url') ?? null, base),
	};
}
