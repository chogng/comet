/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesNatureAuthority, natureNextLinkPaginationPolicy } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/fetchNatureArticleListSourceShared';
import type { FetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const fetchNatureResearchArticlesSource: FetchArticleListSource = {
	id: 'nature.researchArticles',
	allowedParserIds: ['nature.journalArchiveList.v1'],
	matchUri(uri) {
		return matchesNatureAuthority(uri) && /^\/[^/]+\/(?:research-articles|reviews-and-analysis)\/?$/i.test(uri.path);
	},
	matchLoadedUri(requestedUri, finalUri) {
		return matchesNatureAuthority(finalUri) &&
			requestedUri.path.replace(/\/+$/, '') === finalUri.path.replace(/\/+$/, '');
	},
	pagination: natureNextLinkPaginationPolicy,
};
