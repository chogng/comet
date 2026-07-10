/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { ParsedArticleListPage } from 'cs/workbench/services/fetch/common/fetchProvider';
import { isNatureNewsOpinionList, parseNatureArticleCards } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleListParser';

function uriFromHref(href: string | null, base: URI): URI | undefined {
	return href ? URI.parse(new URL(href, base.toString(true)).toString()) : undefined;
}

export { isNatureNewsOpinionList };

export function parseNatureNewsOpinionList(document: Document, base: URI): ParsedArticleListPage {
	const root = document.querySelector('main [data-test="news-opinion-list"], main .news-and-views-list');
	if (!root) {
		throw new Error(`Nature news and opinion list "${base.toString(true)}" does not contain its list root.`);
	}
	return {
		url: base,
		groups: [],
		ungroupedItems: parseNatureArticleCards(root, base),
		nextPageUrl: uriFromHref(document.querySelector('a[rel="next"]')?.getAttribute('href') ?? null, base),
	};
}
