/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parsePublisherArticle } from 'cs/workbench/services/fetch/electron-main/sites/fetchPublisherArticleShared';
import type { FetchArticleDetailParser } from 'cs/workbench/services/fetch/electron-main/sites/types';

const titleSelector = '.article_header-title, .hlFld-Title, [data-test="article-title"]';
const bodySelector = '.article_content, .article-body, .NLM_body, [data-test="article-body"]';

export const fetchAcsArticleParser: FetchArticleDetailParser = {
	id: 'acs.article.v1',
	match(context) {
		if (context.$(titleSelector).length === 0 || context.$(bodySelector).length === 0) {
			return undefined;
		}
		return {
			parserId: this.id,
			evidence: [
				{ kind: 'acsArticleTitle', selector: titleSelector },
				{ kind: 'acsArticleBody', selector: bodySelector },
			],
		};
	},
	parse(context) {
		return parsePublisherArticle(context, {
			publisherId: 'acs',
			publisherTitle: 'American Chemical Society',
			titleSelector,
			bodySelector,
			sectionSelector: '.NLM_sec, section',
		});
	},
};
