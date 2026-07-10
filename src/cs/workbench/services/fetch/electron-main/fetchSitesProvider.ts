/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { natureFetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/nature';
import { scienceFetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/science';
import type { FetchSiteProvider, ListingCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sites/types';

const fetchSiteProviders: readonly FetchSiteProvider[] = [
	natureFetchSiteProvider,
	scienceFetchSiteProvider,
];

export function findFetchSiteProvider(page: URL): FetchSiteProvider | null {
	return fetchSiteProviders.find(provider => provider.matches(page)) ?? null;
}

export function findListingCandidateExtractor(
	page: URL,
	preferredExtractorId?: string | null,
): ListingCandidateExtractor | null {
	const siteProvider = findFetchSiteProvider(page);
	if (!siteProvider) {
		return null;
	}

	const normalizedPreferredExtractorId = String(preferredExtractorId ?? '').trim();
	if (normalizedPreferredExtractorId) {
		const preferredExtractor = siteProvider.listingCandidateExtractors.find(
			extractor => extractor.id === normalizedPreferredExtractorId,
		);
		if (preferredExtractor?.matches(page)) {
			return preferredExtractor;
		}
	}

	return siteProvider.listingCandidateExtractors.find(extractor => extractor.matches(page)) ?? null;
}
