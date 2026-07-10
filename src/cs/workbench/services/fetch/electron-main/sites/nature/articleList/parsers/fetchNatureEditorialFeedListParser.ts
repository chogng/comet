/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateHintFromText } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { cleanText } from 'cs/base/common/strings';
import type { FetchArticleListParser } from 'cs/workbench/services/fetch/electron-main/sites/types';

const cardSelector = 'div.c-article-item__wrapper';
const linkSelector = 'a[href*="/articles/"][data-track-label^="article card "]';
const titleSelector = 'h3.c-article-item__title';

export const fetchNatureEditorialFeedListParser: FetchArticleListParser = {
	id: 'nature.editorialFeedList.v1',
	match(context) {
		const cards = context.$(cardSelector).toArray();
		const matchedCardCount = cards.filter(card => {
			const root = context.$(card);
			return Boolean(
				cleanText(root.find(linkSelector).first().attr('href')) &&
				cleanText(root.find(titleSelector).first().text()),
			);
		}).length;
		return matchedCardCount > 0 ? {
			parserId: this.id,
			evidence: [
				{ kind: 'editorialFeedCards', selector: cardSelector, value: String(matchedCardCount) },
				{ kind: 'trackedNatureArticleLinks', selector: linkSelector },
			],
		} : undefined;
	},
	parse(context) {
		const seen = new Set<string>();
		const candidates = context.$(cardSelector).toArray().map(card => {
			const root = context.$(card);
			const href = cleanText(root.find(linkSelector).first().attr('href'));
			const title = cleanText(root.find(titleSelector).first().text());
			if (!href || !title) return undefined;
			const uri = URI.parse(new URL(href, context.sourceUri.toString(true)).toString());
			const key = uri.toString(true);
			if (seen.has(key)) return undefined;
			seen.add(key);
			const footer = root.find('div.c-article-item__footer').first();
			const dateNode = footer.find('time[datetime], [datetime], span.c-article-item__date').first();
			const dateValue = cleanText(dateNode.attr('datetime')) ||
				cleanText(dateNode.text()) ||
				cleanText(footer.text());
			return {
				sourceUri: uri.toJSON(),
				articleListSourceId: context.articleListSourceId,
				titleHint: title,
				publishedAtHint: parseDateHintFromText(dateValue) ?? undefined,
				sourceArticleTypeHint: cleanText(
					root.find('span.c-article-item__article-type').first().text(),
				) || undefined,
			};
		}).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
		return {
			candidates,
			diagnostics: { cardSelector, cardCount: context.$(cardSelector).length },
		};
	},
};
