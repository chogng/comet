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

export function parseScienceCatalog(document: Document, base: URI): ParsedArticleListCatalog {
	const candidates = [...document.querySelectorAll('a[href]')]
		.map(anchor => ({ label: text(anchor), url: uriFromHref(anchor.getAttribute('href'), base) }))
		.filter((entry): entry is { label: string; url: URI } =>
			!!entry.label
			&& !!entry.url
			&& entry.url.scheme === base.scheme
			&& entry.url.authority === base.authority
		)
		.map(entry => ({
			...entry,
			kind: /^\/toc\/[^/]+\/current\/?$/u.test(entry.url.path)
				? 'current-issue' as const
				: /^\/first-release\/[^/]+\/?$/u.test(entry.url.path)
					? 'first-release' as const
					: undefined,
		}))
		.filter((entry): entry is typeof entry & { kind: 'current-issue' | 'first-release' } => !!entry.kind);
	const currentIssues = dedupeByUrl(candidates.filter(candidate => candidate.kind === 'current-issue'));
	const firstReleases = dedupeByUrl(candidates.filter(candidate => candidate.kind === 'first-release'));
	if (currentIssues.length !== 1 || firstReleases.length !== 1) {
		throw new Error(`Science source discovery for "${base.toString(true)}" did not find both Current Issue and First Release.`);
	}
	return {
		entries: [currentIssues[0], firstReleases[0]].map(({ label, url }) => ({
			kind: 'source',
			label,
			url,
		})),
	};
}

function dedupeByUrl<T extends { readonly url: URI }>(entries: readonly T[]): readonly T[] {
	const seen = new Set<string>();
	return entries.filter(entry => {
		const key = entry.url.toString(true);
		if (seen.has(key)) {
			return false;
		}
		seen.add(key);
		return true;
	});
}
