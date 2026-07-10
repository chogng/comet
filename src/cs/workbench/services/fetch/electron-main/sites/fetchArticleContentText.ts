/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cleanText } from 'cs/base/common/strings';
import type { FetchPageDom } from 'cs/workbench/services/fetch/electron-main/sites/types';

const contentBlockSelector = [
	'p',
	'li',
	'blockquote',
	'pre',
	'figcaption',
	'caption',
	'th',
	'td',
	'[role="math"]',
	'math',
].join(', ');

const excludedContentSelector = [
	'[itemprop="abstract"]',
	'[data-test*="abstract" i]',
	'[class~="abstract" i]',
	'[id^="Abs"]',
	'[data-test*="paywall" i]',
	'[data-testid*="paywall" i]',
	'[class~="paywall" i]',
	'[id*="paywall" i]',
	'[data-test="access-wall"]',
	'.app-access-wall',
	'.article-access-options',
	'.purchase-access',
	'.access-denied-content',
	'nav',
	'aside',
	'footer',
].join(', ');

export function extractArticleContentText(
	$: FetchPageDom,
	rootNode: Parameters<FetchPageDom>[0],
): string {
	const root = $(rootNode);
	const blocks: string[] = [];
	root.find(contentBlockSelector).each((_, node) => {
		const block = $(node);
		if (
			block.closest(excludedContentSelector).length > 0 ||
			block.parents(contentBlockSelector).length > 0
		) {
			return;
		}
		const text = cleanText(block.attr('alttext') ?? block.attr('aria-label') ?? block.text());
		if (!text) {
			return;
		}
		blocks.push(text);
	});
	return blocks.join('\n\n');
}
