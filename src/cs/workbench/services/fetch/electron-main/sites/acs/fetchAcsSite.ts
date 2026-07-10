/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fetchAcsArticleParser } from 'cs/workbench/services/fetch/electron-main/sites/acs/fetchAcsArticleParser';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const fetchAcsSite: FetchSiteProvider = {
	id: 'acs',
	acquisitionPolicy: { settleMs: 700 },
	articleListSources: [],
	articleListParsers: [],
	articleDetailParsers: [fetchAcsArticleParser],
	matchUri(uri) {
		const authority = uri.authority.toLowerCase();
		return authority === 'acs.org' || authority.endsWith('.acs.org');
	},
	normalizeArticleAuthority(authority) {
		const value = authority.toLowerCase();
		return value === 'acs.org' || value.endsWith('.acs.org') ? 'acs.org' : value;
	},
};
