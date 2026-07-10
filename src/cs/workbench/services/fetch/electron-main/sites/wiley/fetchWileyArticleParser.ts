/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parsePublisherArticle } from 'cs/workbench/services/fetch/electron-main/sites/fetchPublisherArticleShared';
import type { FetchArticleDetailParser } from 'cs/workbench/services/fetch/electron-main/sites/types';

const titleSelector = '.citation__title, .article-header__title, [data-test="article-title"]';
const bodySelector = '.article-section__content, .article__body, .fulltext, [data-test="article-body"]';

export const fetchWileyArticleParser: FetchArticleDetailParser = {
	id: 'wiley.article.v1',
	match(context) {
		if (context.$(titleSelector).length === 0 || context.$(bodySelector).length === 0) {
			return undefined;
		}
		return {
			parserId: this.id,
			evidence: [
				{ kind: 'wileyArticleTitle', selector: titleSelector },
				{ kind: 'wileyArticleBody', selector: bodySelector },
			],
		};
	},
	parse(context) {
		return parsePublisherArticle(context, {
			publisherId: 'wiley',
			publisherTitle: 'Wiley',
			titleSelector,
			bodySelector,
			sectionSelector: '.article-section, section',
		});
	},
};
