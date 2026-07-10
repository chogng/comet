/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { fetchScienceAdvancesPhysicalMaterialsListParser } from 'cs/workbench/services/fetch/electron-main/sites/science/articleList/fetchScienceAdvancesPhysicalMaterialsListParser';
import { fetchScienceCurrentResearchListParser } from 'cs/workbench/services/fetch/electron-main/sites/science/articleList/fetchScienceCurrentResearchListParser';
import { fetchScienceAdvancesCurrentSource, fetchScienceCurrentSource } from 'cs/workbench/services/fetch/electron-main/sites/science/articleList/fetchScienceArticleListSources';
import { fetchScienceArticleParser } from 'cs/workbench/services/fetch/electron-main/sites/science/fetchScienceArticleParser';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

export const fetchScienceSite: FetchSiteProvider = {
	id: 'science',
	acquisitionPolicy: { settleMs: 900 },
	articleListSources: [fetchScienceCurrentSource, fetchScienceAdvancesCurrentSource],
	articleListParsers: [
		fetchScienceCurrentResearchListParser,
		fetchScienceAdvancesPhysicalMaterialsListParser,
	],
	articleDetailParsers: [fetchScienceArticleParser],
	matchUri(uri) {
		const authority = uri.authority.toLowerCase();
		return authority === 'science.org' || authority.endsWith('.science.org') ||
			authority === 'sciencemag.org' || authority.endsWith('.sciencemag.org');
	},
	normalizeArticleAuthority(authority) {
		const value = authority.toLowerCase();
		return value === 'science.org' || value.endsWith('.science.org') ||
			value === 'sciencemag.org' || value.endsWith('.sciencemag.org')
			? 'science.org'
			: value;
	},
};
