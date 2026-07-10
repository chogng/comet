/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import {
	findFetchSiteProvider,
	findListingCandidateExtractor,
} from 'cs/workbench/services/fetch/electron-main/fetchSitesProvider';

test('fetch sites provider resolves publishers before listing parsers', () => {
	assert.deepEqual(
		[
			'https://www.nature.com/latest-news',
			'https://www.science.org/toc/science/current',
			'https://arxiv.org/list/cs/new',
		].map(value => findFetchSiteProvider(new URL(value))?.id ?? null),
		['nature', 'science', null],
	);
});

test('fetch sites provider scopes preferred listing parsers to the matched publisher', () => {
	const page = new URL('https://www.science.org/toc/science/current');
	const extractor = findListingCandidateExtractor(page, 'nature-latest-news');

	assert.equal(extractor?.id, 'science-current-news-in-depth-research-articles');
});

test('fetch sites provider returns no parser for an unmatched path', () => {
	assert.equal(
		findListingCandidateExtractor(new URL('https://www.nature.com/unsupported')),
		null,
	);
});
