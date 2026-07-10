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
	const entries = [...document.querySelectorAll('nav, aside, section')].map(container => {
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
	if (entries.length === 0) {
		throw new Error(`Nature source discovery for "${base.toString(true)}" did not find an article type catalog.`);
	}
	return { entries };
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
