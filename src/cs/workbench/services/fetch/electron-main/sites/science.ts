/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { scienceCurrentNewsInDepthResearchArticlesCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sites/scienceCurrentNewsInDepthResearchArticles';
import { scienceSciadvCurrentPhysicalMaterialsCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sites/scienceSciadvCurrentPhysicalMaterials';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

function matchesScienceSite(page: URL) {
	const hostname = page.hostname.toLowerCase();
	return hostname === 'science.org' ||
		hostname.endsWith('.science.org') ||
		hostname === 'sciencemag.org' ||
		hostname.endsWith('.sciencemag.org');
}

export const scienceFetchSiteProvider: FetchSiteProvider = {
	id: 'science',
	matches: matchesScienceSite,
	listingCandidateExtractors: [
		scienceCurrentNewsInDepthResearchArticlesCandidateExtractor,
		scienceSciadvCurrentPhysicalMaterialsCandidateExtractor,
	],
};
