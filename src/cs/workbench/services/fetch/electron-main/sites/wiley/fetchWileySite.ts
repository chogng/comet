/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fetchWileyArticleParser } from 'cs/workbench/services/fetch/electron-main/sites/wiley/fetchWileyArticleParser';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const fetchWileySite: FetchSiteProvider = {
	id: 'wiley',
	acquisitionPolicy: { settleMs: 700 },
	articleListSources: [],
	articleListParsers: [],
	articleDetailParsers: [fetchWileyArticleParser],
	matchUri(uri) {
		const authority = uri.authority.toLowerCase();
		return authority === 'wiley.com' || authority.endsWith('.wiley.com');
	},
	normalizeArticleAuthority(authority) {
		const value = authority.toLowerCase();
		return value === 'wiley.com' || value.endsWith('.wiley.com') ? 'wiley.com' : value;
	},
};
