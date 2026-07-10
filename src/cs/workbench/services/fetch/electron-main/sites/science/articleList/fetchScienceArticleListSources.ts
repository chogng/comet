/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type { FetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/sites/types';

function matchesScienceAuthority(uri: URI): boolean {
	const authority = uri.authority.toLowerCase();
	return authority === 'science.org' || authority.endsWith('.science.org') ||
		authority === 'sciencemag.org' || authority.endsWith('.sciencemag.org');
}

export const fetchScienceCurrentSource: FetchArticleListSource = {
	id: 'science.current',
	allowedParserIds: ['science.currentResearchList.v1'],
	matchUri(uri) {
		return matchesScienceAuthority(uri) && /^\/toc\/science\/current\/?$/i.test(uri.path);
	},
	matchLoadedUri(_requestedUri, finalUri) {
		return matchesScienceAuthority(finalUri) && /^\/toc\/science\/(?:current|[^/]+\/[^/]+)\/?$/i.test(finalUri.path);
	},
	pagination: { kind: 'none' },
};

export const fetchScienceAdvancesCurrentSource: FetchArticleListSource = {
	id: 'scienceAdvances.current',
	allowedParserIds: ['science.advancesPhysicalMaterialsList.v1'],
	matchUri(uri) {
		return matchesScienceAuthority(uri) && /^\/toc\/sciadv\/current\/?$/i.test(uri.path);
	},
	matchLoadedUri(_requestedUri, finalUri) {
		return matchesScienceAuthority(finalUri) && /^\/toc\/sciadv\/(?:current|[^/]+\/[^/]+)\/?$/i.test(finalUri.path);
	},
	pagination: { kind: 'none' },
};
