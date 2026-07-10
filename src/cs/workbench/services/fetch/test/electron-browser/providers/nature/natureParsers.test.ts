/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { URI } from 'cs/base/common/uri';
import { parseNatureArticleDetail } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleDetailParser';
import { isNatureArticleList, parseNatureArticleList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleListParser';
import { isNatureArticleListCatalog, isNatureExploreCatalog, parseNatureArticleListCatalog, parseNatureCatalog } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureCatalogParser';
import { NatureFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureFetchProvider';
import { isNatureNewsOpinionList, parseNatureNewsOpinionList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureNewsOpinionListParser';
import { natureArticleDetailFixture, natureArticleListCatalogFixture, natureArticleListFixture, natureCatalogFixture, natureNewsOpinionListFixture } from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature.fixture';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';

const base = URI.parse('https://www.nature.com/nature/');
const journal: JournalDescriptor = { id: 'journal.nature.nature', title: 'Nature', homeUrl: base, discoveryUrl: base, providerId: 'publisher.nature' };

function documentFrom(html: string): Document {
	return new JSDOM(html).window.document;
}

test('Nature fixtures parse catalog, ordinary list, news list, and article detail separately', () => {
	const catalog = parseNatureCatalog(documentFrom(natureCatalogFixture), base);
	assert.deepEqual(catalog.entries.map(entry => entry.kind === 'group' ? [entry.label, entry.sources.map(source => source.label)] : entry.label), [['Research articles', ['Article', 'Matters Arising']]]);
	assert.equal(isNatureExploreCatalog(documentFrom(natureCatalogFixture)), true);
	const articleListCatalogDocument = documentFrom(natureArticleListCatalogFixture);
	assert.equal(isNatureExploreCatalog(articleListCatalogDocument), false);
	assert.equal(isNatureArticleListCatalog(articleListCatalogDocument), true);
	assert.deepEqual(parseNatureArticleListCatalog(articleListCatalogDocument, base).entries, [{
		kind: 'group',
		label: 'Research articles',
		sources: [{ kind: 'source', label: 'Research articles', url: base }],
	}]);

	const articleDocument = documentFrom(natureArticleListFixture);
	assert.equal(isNatureArticleList(articleDocument), true);
	assert.equal(parseNatureArticleList(articleDocument, base).ungroupedItems[0].title, 'Nature article');

	const newsDocument = documentFrom(natureNewsOpinionListFixture);
	assert.equal(isNatureArticleList(newsDocument), false);
	assert.equal(isNatureNewsOpinionList(newsDocument), true);
	assert.equal(parseNatureNewsOpinionList(newsDocument, base).ungroupedItems[0].title, 'News article');

	const detail = parseNatureArticleDetail(documentFrom(natureArticleDetailFixture), base, journal);
	assert.deepEqual(detail, {
		url: base,
		doi: '10.1038/test',
		title: 'Nature detail',
		description: 'Detail description',
		abstract: 'Detail abstract',
		articleType: 'Article',
		subjects: ['Genetics'],
		authors: [{ name: 'Ada Lovelace' }],
		publication: { title: 'Nature' },
		pdfUrl: URI.parse('https://www.nature.com/articles/s41586-026-00001.pdf'),
	});
});

test('Nature canonicalization removes fragments without merging query-distinct resources', () => {
	const provider = new NatureFetchProvider(undefined as never);
	const source = provider.canonicalizeSourceUri(URI.parse('HTTPS://WWW.NATURE.COM/articles?type=article#catalog'));
	assert.equal(source.toString(true), 'https://www.nature.com/articles?type=article');
	assert.notEqual(
		provider.canonicalizeSourceUri(URI.parse('https://www.nature.com/articles?type=article')).toString(true),
		provider.canonicalizeSourceUri(URI.parse('https://www.nature.com/articles?type=review')).toString(true),
	);
});
