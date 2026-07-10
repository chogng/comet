/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateHintFromText, parseDateString } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { cleanText } from 'cs/base/common/strings';
import type { FetchArticleListParser } from 'cs/workbench/services/fetch/electron-main/sites/types';

const cardSelectors = [
	'section#new-article-list li.app-article-list-row__item article.c-card',
	'section#new-article-list article.c-card',
	'main li.app-article-list-row__item article',
] as const;
const linkSelector = 'h3.c-card__title a[href*="/articles/"], h3 a[href*="/articles/"], a.c-card__link[href*="/articles/"]';

function resolveCardSelector(context: Parameters<FetchArticleListParser['match']>[0]): string | undefined {
	return cardSelectors.find(selector => context.$(selector).toArray().some(card => {
		const root = context.$(card);
		return Boolean(cleanText(root.find(linkSelector).first().attr('href')) && cleanText(root.find('h3').first().text()));
	}));
}

export const fetchNatureJournalArchiveListParser: FetchArticleListParser = {
	id: 'nature.journalArchiveList.v1',
	match(context) {
		const selector = resolveCardSelector(context);
		return selector ? {
			parserId: this.id,
			evidence: [
				{ kind: 'journalArchiveCards', selector },
				{ kind: 'natureArticleLinks', selector: linkSelector },
			],
		} : undefined;
	},
	parse(context, proof) {
		const cardSelector = proof.evidence.find(item => item.kind === 'journalArchiveCards')?.selector;
		if (!cardSelector) {
			return { candidates: [] };
		}
		const seen = new Set<string>();
		const candidates = context.$(cardSelector).toArray().map(card => {
			const root = context.$(card);
			const href = cleanText(root.find(linkSelector).first().attr('href'));
			const title = cleanText(root.find('h3.c-card__title, h3').first().text());
			if (!href || !title) return undefined;
			const uri = URI.parse(new URL(href, context.sourceUri.toString(true)).toString());
			const key = uri.toString(true);
			if (seen.has(key)) return undefined;
			seen.add(key);
			const dateNode = root.find('time[datetime], [itemprop="datePublished"], [datetime]').first();
			const dateValue = dateNode.attr('datetime') ?? dateNode.attr('content') ?? dateNode.text();
			const publishedAtHint = parseDateString(dateValue) ?? parseDateHintFromText(dateValue) ?? undefined;
			const sourceArticleTypeHint = cleanText(
				root.find('[data-test="article.type"] .c-meta__type, [data-test="article.type"]').first().text(),
			) || undefined;
			return {
				sourceUri: uri.toJSON(),
				articleListSourceId: context.articleListSourceId,
				titleHint: title,
				publishedAtHint,
				sourceArticleTypeHint,
			};
		}).filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== undefined);
		return {
			candidates,
			diagnostics: { cardSelector, cardCount: context.$(cardSelector).length },
		};
	},
};
