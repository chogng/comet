/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';

import { URI } from 'cs/base/common/uri';
import { FetchErrorCode, getFetchErrorCode } from 'cs/workbench/services/fetch/common/fetchErrors';
import { resolveFetchArticleListParser, resolveFetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/fetchParserResolver';
import { resolveFetchSite } from 'cs/workbench/services/fetch/electron-main/fetchSiteResolver';
import { fetchSiteProviders } from 'cs/workbench/services/fetch/electron-main/fetchSitesProvider';

test('site resolver requires exactly one matching publisher', () => {
	assert.deepEqual(
		[
			'https://www.nature.com/latest-news',
			'https://www.science.org/toc/science/current',
			'https://pubs.acs.org/doi/10.1021/example',
			'https://onlinelibrary.wiley.com/doi/10.1002/example',
		].map(value => resolveFetchSite(fetchSiteProviders, URI.parse(value)).id),
		['nature', 'science', 'acs', 'wiley'],
	);
	assert.throws(
		() => resolveFetchSite(fetchSiteProviders, URI.parse('https://arxiv.org/list/cs/new')),
		(error) => getFetchErrorCode(error) === FetchErrorCode.UnsupportedSite,
	);
});

test('article-list resolver selects a source by URI and a parser by structural proof', () => {
	const uri = URI.parse('https://www.nature.com/latest-news');
	const site = resolveFetchSite(fetchSiteProviders, uri);
	const source = resolveFetchArticleListSource(site, uri);
	const context = {
		sourceUri: uri,
		articleListSourceId: source.id,
		$: load(`
			<div class="c-article-item__wrapper">
				<a href="/articles/d41586-026-00001" data-track-label="article card 1"></a>
				<h3 class="c-article-item__title">Example news</h3>
			</div>`),
	};
	const resolved = resolveFetchArticleListParser(site, source, context);
	assert.equal(source.id, 'nature.latestNews');
	assert.equal(resolved.parser.id, 'nature.editorialFeedList.v1');
	assert.equal(resolved.proof.evidence.length, 2);
});

test('an unmatched Nature path is not treated as a default article list', () => {
	const uri = URI.parse('https://www.nature.com/unsupported');
	const site = resolveFetchSite(fetchSiteProviders, uri);
	assert.throws(
		() => resolveFetchArticleListSource(site, uri),
		(error) => getFetchErrorCode(error) === FetchErrorCode.UnsupportedArticleListSource,
	);
});
