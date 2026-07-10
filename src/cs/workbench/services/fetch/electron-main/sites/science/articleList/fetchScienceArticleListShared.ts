/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateHintFromText } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { cleanText } from 'cs/base/common/strings';
import { extractScienceDoiFromPathLike } from 'cs/base/common/url';
import type { FetchArticleCandidate } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleKind } from 'cs/base/parts/sandbox/common/fetchArticleKind';
import type { FetchArticleListParserContext } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const scienceTocBodySelectors = [
	'div.toc > div.toc__body > div.toc__body',
	'div.toc__body > div.toc__body',
	'div.toc__body',
] as const;
export const scienceSectionSelector = 'section.toc__section';
export const scienceSectionHeadingSelector = 'h4';
export const scienceSubsectionHeadingSelector = 'h5';
export const scienceCardSelector = 'div.card';
const scienceLinkSelector = 'h3.article-title a[href*="/doi/"]';

export function normalizeScienceHeading(value: unknown): string {
	return cleanText(value).toLowerCase();
}

export function resolveScienceTocRoot(context: FetchArticleListParserContext) {
	for (const selector of scienceTocBodySelectors) {
		const roots = context.$(selector).toArray().filter(
			root => context.$(root).children(scienceSectionSelector).length > 0,
		);
		if (roots.length === 1) {
			return { root: roots[0], selector };
		}
	}
	return undefined;
}

export function parseScienceCard(
	context: FetchArticleListParserContext,
	card: Parameters<FetchArticleListParserContext['$']>[0],
	sourceArticleTypeHint: string,
	articleKindHint: FetchArticleKind,
): FetchArticleCandidate | undefined {
	const root = context.$(card);
	const link = root.find(scienceLinkSelector).first();
	const href = cleanText(link.attr('href'));
	const title = cleanText(root.find('h3.article-title').first().text()) || cleanText(link.text());
	if (!href || !title) return undefined;
	const uri = URI.parse(new URL(href, context.sourceUri.toString(true)).toString());
	const dateNode = root.find('.card-meta time, time[datetime], [datetime]').first();
	const dateValue = dateNode.attr('datetime') ?? dateNode.text();
	const doiHint = extractScienceDoiFromPathLike(href) || undefined;
	return {
		sourceUri: uri.toJSON(),
		articleListSourceId: context.articleListSourceId,
		doiHint,
		titleHint: title,
		publishedAtHint: parseDateHintFromText(dateValue) ?? undefined,
		articleKindHint,
		sourceArticleTypeHint,
	};
}
