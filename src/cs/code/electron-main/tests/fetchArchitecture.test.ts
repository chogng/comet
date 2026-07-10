/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { load } from 'cheerio';

import { URI } from 'cs/base/common/uri';
import { normalizeFetchDoi } from 'cs/workbench/services/fetch/common/fetchDoi';
import { FetchErrorCode, getFetchErrorCode } from 'cs/workbench/services/fetch/common/fetchErrors';
import { resolveFetchDoi } from 'cs/workbench/services/fetch/electron-main/fetchDoiResolver';
import { resolveFetchArticleListParser, resolveFetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/fetchParserResolver';
import { resolveFetchSite } from 'cs/workbench/services/fetch/electron-main/fetchSiteResolver';
import { fetchSiteProviders } from 'cs/workbench/services/fetch/electron-main/fetchSitesProvider';
import { classifyNatureArticle } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNatureArticleClassification';
import { resolveNatureArticleIdentity } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNatureArticleIdentity';
import { naturePublication } from 'cs/workbench/services/fetch/electron-main/sites/nature/fetchNaturePublicationResolver';
import { natureNextLinkPaginationPolicy } from 'cs/workbench/services/fetch/electron-main/sites/nature/articleList/fetchNatureArticleListSourceShared';

test('Nature s/d article identities constrain page family and preserve DOI/publication hints', () => {
	const journal = resolveNatureArticleIdentity(
		URI.parse('https://www.nature.com/articles/s41563-026-00001-2'),
	);
	assert.equal(journal?.articleId, 's41563-026-00001-2');
	assert.equal(journal?.pageFamilyHint, 'journalArticle');
	assert.equal(journal?.doiHint, '10.1038/s41563-026-00001-2');
	assert.equal(journal?.publicationHint?.title, 'Nature Materials');
	assert.equal(
		resolveNatureArticleIdentity(
			URI.parse('https://www.nature.com/articles/s41563-026-00001-2/'),
		)?.articleId,
		's41563-026-00001-2',
	);

	const editorial = resolveNatureArticleIdentity(
		URI.parse('https://www.nature.com/articles/d41586-026-00001-2'),
	);
	assert.equal(editorial?.pageFamilyHint, 'editorialArticle');
	assert.equal(editorial?.publicationHint, undefined);
});

test('Nature classification keeps source article type separate from normalized kind', () => {
	assert.deepEqual(
		classifyNatureArticle(naturePublication, 'World View', 'editorialArticle'),
		{
			publication: naturePublication,
			articleKind: 'opinion',
			sourceArticleType: 'World View',
			evidence: ['sourceArticleType:World View', 'articleKind:opinion'],
		},
	);
	assert.equal(
		classifyNatureArticle(naturePublication, 'News & Views', 'journalArticle').articleKind,
		'newsAndViews',
	);
	assert.equal(
		classifyNatureArticle(naturePublication, 'Unrecognized Format', 'journalArticle').articleKind,
		'other',
	);
});

test('DOI reconciliation normalizes equivalent values and rejects strong conflicts', () => {
	assert.equal(normalizeFetchDoi('https://doi.org/10.1038/S41586-026-00001-2.'), '10.1038/s41586-026-00001-2');
	assert.equal(resolveFetchDoi([
		{ source: 'citationDoi', value: '10.1038/example', strength: 'strong' },
		{ source: 'siteArticleUrl', value: 'https://doi.org/10.1038/example', strength: 'siteArticleUrl' },
	]).doi, '10.1038/example');
	assert.throws(
		() => resolveFetchDoi([
			{ source: 'citationDoi', value: '10.1038/one', strength: 'strong' },
			{ source: 'dcIdentifier', value: '10.1038/two', strength: 'strong' },
		]),
		(error) => getFetchErrorCode(error) === FetchErrorCode.MetadataConflict,
	);
});

test('a page-wide Nature article anchor is not accepted without the source parser structure', () => {
	const uri = URI.parse('https://www.nature.com/latest-news');
	const site = resolveFetchSite(fetchSiteProviders, uri);
	const source = resolveFetchArticleListSource(site, uri);
	assert.throws(
		() => resolveFetchArticleListParser(site, source, {
			sourceUri: uri,
			articleListSourceId: source.id,
			$: load('<main><a href="/articles/d41586-026-00001">Navigation article</a></main>'),
		}),
		(error) => getFetchErrorCode(error) === FetchErrorCode.UnsupportedArticleListStructure,
	);
});

test('Nature pagination uses the scoped next-page control and requires the page number to advance', () => {
	assert.equal(natureNextLinkPaginationPolicy.kind, 'nextLink');
	if (natureNextLinkPaginationPolicy.kind !== 'nextLink') return;
	const sourceUri = URI.parse('https://www.nature.com/latest-news');
	const nextPage = natureNextLinkPaginationPolicy.findNextPageUri({
		sourceUri,
		articleListSourceId: 'nature.latestNews',
		seenPageUris: new Set(),
		$: load(`
			<a rel="next" href="/unrelated-carousel?page=99">Unrelated</a>
			<nav class="c-pagination" aria-label="pagination">
				<li data-page="next" data-test="page-next"><a href="/latest-news?page=2">Next</a></li>
			</nav>
		`),
	});
	assert.equal(nextPage?.toString(true), 'https://www.nature.com/latest-news?page=2');
	const nonAdvancing = natureNextLinkPaginationPolicy.findNextPageUri({
		sourceUri: URI.parse('https://www.nature.com/latest-news?page=2'),
		articleListSourceId: 'nature.latestNews',
		seenPageUris: new Set(),
		$: load('<nav class="c-pagination"><li data-page="next"><a href="/latest-news?page=2">Next</a></li></nav>'),
	});
	assert.equal(nonAdvancing, undefined);
});
