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
	const entries = [...document.querySelectorAll('a[href]')]
		.map(anchor => ({ label: text(anchor), url: uriFromHref(anchor.getAttribute('href'), base) }))
		.filter((entry): entry is { label: string; url: URI } => !!entry.label && !!entry.url)
		.filter(entry => /^(Current Issue|First Release)$/iu.test(entry.label))
		.map(source => ({ kind: 'source' as const, ...source }));
	if (entries.length !== 2) {
		throw new Error(`Science source discovery for "${base.toString(true)}" did not find both Current Issue and First Release.`);
	}
	return { entries };
}
