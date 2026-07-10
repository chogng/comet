/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	getNatureJournalContentNodes,
	natureJournalContentSelector,
	parseNatureArticle,
} from 'cs/workbench/services/fetch/electron-main/sites/nature/articleDetail/fetchNatureArticleShared';
import type { FetchNatureArticleIdentity } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNatureArticleIdentity';
import type { FetchArticleDetailParser } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const fetchNatureArticleParser: FetchArticleDetailParser = {
	id: 'nature.article.v1',
	match(context) {
		const identity = context.identity as FetchNatureArticleIdentity | undefined;
		if (!identity) {
			return undefined;
		}
		const headerSelector = '.c-article-header h1, [data-test="article-title"]';
		const bodySelector = identity.pageFamilyHint === 'journalArticle'
			? natureJournalContentSelector
			: '.c-article-body.main-content';
		const bodyFound = identity.pageFamilyHint === 'journalArticle'
			? getNatureJournalContentNodes(context).length > 0
			: context.$(bodySelector).length > 0;
		if (context.$(headerSelector).length === 0 || !bodyFound) {
			return undefined;
		}
		return {
			parserId: this.id,
			evidence: [
				{ kind: 'natureArticleHeader', selector: headerSelector },
				{ kind: 'natureArticleBody', selector: bodySelector },
			],
		};
	},
	parse(context) {
		const identity = context.identity as FetchNatureArticleIdentity;
		return parseNatureArticle(context, identity.pageFamilyHint);
	},
};
