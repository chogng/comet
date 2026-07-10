/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { ParsedArticleListPage } from 'cs/workbench/services/fetch/common/fetchProvider';
import { parseScienceArticleCards } from 'cs/workbench/services/fetch/electron-browser/providers/science/scienceCurrentIssueParser';

function uriFromHref(href: string | null, base: URI): URI | undefined {
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
}

export function isScienceFirstRelease(document: Document, base: URI): boolean {
	return base.path.includes('first-release') && !!document.querySelector('main article');
}

export function parseScienceFirstRelease(document: Document, base: URI): ParsedArticleListPage {
	return {
		url: base,
		groups: [],
		ungroupedItems: parseScienceArticleCards(document, base),
		nextPageUrl: uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, base),
	};
}
