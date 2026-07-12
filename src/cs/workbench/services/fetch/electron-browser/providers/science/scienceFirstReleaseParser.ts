/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { ParsedArticleListPage } from 'cs/workbench/services/fetch/common/fetchProvider';
import { parseScienceArticleCards } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCurrentIssueParser';

function text(element: Element | null): string | undefined {
	const value = element?.textContent?.replace(/\s+/gu, ' ').trim();
	return value || undefined;
}

function uriFromHref(href: string | null, base: URI): URI | undefined {
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
}

export function isScienceFirstRelease(document: Document, base: URI): boolean {
	return /^\/first-release\/[^/]+\/?$/u.test(base.path)
		&& !!document.querySelector('main')
		&& (
			!!document.querySelector('main article')
			|| /first release/iu.test(text(document.querySelector('main h1')) ?? '')
		);
}

export function parseScienceFirstRelease(document: Document, base: URI): ParsedArticleListPage {
	return {
		url: base,
		groups: [],
		ungroupedItems: parseScienceArticleCards(document, base),
		nextPageUrl: uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, base),
	};
}
