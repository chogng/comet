/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { ParsedArticleListCatalog } from 'cs/workbench/services/fetch/common/fetchProvider';

function text(element: Element | null): string | undefined {
	const value = element?.textContent?.replace(/\s+/gu, ' ').trim();
	return value || undefined;
}

function uriFromHref(href: string | null, base: URI): URI | undefined {
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
}

export function parseNatureCatalog(document: Document, base: URI): ParsedArticleListCatalog {
	const entries = getNatureExploreCatalogEntries(document, base);
	if (entries.length === 0) {
		throw new Error(`Nature source discovery for "${base.toString(true)}" did not find an Explore content catalog.`);
	}
	return { entries };
}

export function isNatureExploreCatalog(document: Document): boolean {
	return getNatureExploreCatalogEntries(document, URI.parse('https://www.nature.com/')).length > 0;
}

export function isNatureArticleListCatalog(document: Document): boolean {
	return !!document.querySelector('main h1') && !!document.querySelector('main article, main li[data-test*="article"]');
}

export function parseNatureArticleListCatalog(document: Document, base: URI): ParsedArticleListCatalog {
	const label = text(document.querySelector('main h1'));
	if (!label) {
		throw new Error(`Nature article list "${base.toString(true)}" does not contain a title.`);
	}
	return {
		entries: [{
			kind: 'group',
			label,
			sources: [{ kind: 'source', label, url: base }],
		}],
	};
}

function getNatureExploreCatalogEntries(document: Document, base: URI): ParsedArticleListCatalog['entries'] {
	return [...document.querySelectorAll('nav, aside, section')].map(container => {
		const label = text(container.querySelector('h2, h3, [aria-level]'));
		const sources = [...container.querySelectorAll('a[href]')]
			.map(anchor => ({ label: text(anchor), url: uriFromHref(anchor.getAttribute('href'), base) }))
			.filter((entry): entry is { label: string; url: URI } => !!entry.label && !!entry.url)
			.filter(entry => /article|matter|review|commentary|correspondence|editorial|perspective|report/iu.test(entry.label));
		if (!label || sources.length === 0) {
			return undefined;
		}
		return {
			kind: 'group' as const,
			label,
			sources: dedupeSources(sources).map(source => ({ kind: 'source' as const, ...source })),
		};
	}).filter((entry): entry is NonNullable<typeof entry> => !!entry);
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
