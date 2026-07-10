/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { matchesNatureAuthority, natureNextLinkPaginationPolicy } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/fetchNatureArticleListSourceShared';
import type { FetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const fetchNatureOpinionSource: FetchArticleListSource = {
	id: 'nature.opinion',
	allowedParserIds: ['nature.editorialFeedList.v1'],
	matchUri(uri) {
		return matchesNatureAuthority(uri) && uri.path.replace(/\/+$/, '') === '/opinion';
	},
	matchLoadedUri(_requestedUri, finalUri) {
		return matchesNatureAuthority(finalUri) && finalUri.path.replace(/\/+$/, '') === '/opinion';
	},
	pagination: natureNextLinkPaginationPolicy,
};
