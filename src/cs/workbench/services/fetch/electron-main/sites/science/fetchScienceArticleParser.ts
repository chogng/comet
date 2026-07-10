/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parsePublisherArticle } from 'cs/workbench/services/fetch/electron-main/sites/fetchPublisherArticleShared';
import type { FetchArticleDetailParser } from 'cs/workbench/services/fetch/electron-main/sites/types';

const titleSelector = '.article__headline, .article-header__title, [data-test="article-title"]';
const bodySelector = '.article__body, .bodymatter, .article-body, [data-test="article-body"]';

export const fetchScienceArticleParser: FetchArticleDetailParser = {
	id: 'science.article.v1',
	match(context) {
		if (context.$(titleSelector).length === 0 || context.$(bodySelector).length === 0) {
			return undefined;
		}
		return {
			parserId: this.id,
			evidence: [
				{ kind: 'scienceArticleTitle', selector: titleSelector },
				{ kind: 'scienceArticleBody', selector: bodySelector },
			],
		};
	},
	parse(context) {
		return parsePublisherArticle(context, {
			publisherId: 'aaas',
			publisherTitle: 'American Association for the Advancement of Science',
			titleSelector,
			bodySelector,
			sectionSelector: 'section',
		});
	},
};
