/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { load } from 'cheerio';

import type { ArticlePublisherId } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';

const ARTICLE_BODY_SELECTORS: Record<ArticlePublisherId, string> = {
	nature: '.c-article-body .main-content, .c-article-body [id^="Sec"], .c-article-body',
	science: '.article__body, .bodymatter, .article-body, [data-test="article-body"]',
	acs: '.article_content, .article-body, .NLM_body, [data-test="article-body"]',
	wiley: '.article-section__content, .article__body, .fulltext, [data-test="article-body"]',
	other: 'article [itemprop="articleBody"], [itemprop="articleBody"], [data-test="article-body"]',
};

const EXCLUDED_BODY_ANCESTORS = [
	'[itemprop="abstract"]',
	'[data-test*="abstract" i]',
	'[class~="abstract" i]',
	'[id^="Abs"]',
	'[data-test*="paywall" i]',
	'[data-testid*="paywall" i]',
	'[class~="paywall" i]',
	'[id*="paywall" i]',
	'.article-access-options',
	'.purchase-access',
	'.access-denied-content',
	'nav',
	'aside',
	'footer',
].join(', ');

export function extractArticleBodyText(
	$: ReturnType<typeof load>,
	publisherId: ArticlePublisherId,
) {
	const paragraphTexts: string[] = [];
	const seenParagraphs = new Set<object>();
	$(ARTICLE_BODY_SELECTORS[publisherId]).find('p').each((_, node) => {
		if (seenParagraphs.has(node) || $(node).closest(EXCLUDED_BODY_ANCESTORS).length > 0) {
			return;
		}
		seenParagraphs.add(node);
		const text = cleanText($(node).text());
		if (text) {
			paragraphTexts.push(text);
		}
	});
	return paragraphTexts.join('\n\n');
}
