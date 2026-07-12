/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import type { JournalDescriptor } from 'cs/workbench/services/fetch/common/fetch';
import { FetchParserNotFoundError } from 'cs/workbench/services/fetch/electron-browser/fetchParserResolver';
import { isNatureArticleDetail, parseNatureArticleDetail } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleDetailParser';
import { isNatureArticleList, isNatureNewsOpinionList, parseNatureArticleList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureArticleListParser';
import {
	isNatureArticleTypeCatalog,
	parseNatureArticleTypeCatalog,
	parseNatureDirectListSource,
	parseNatureExploreGroups,
} from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureCatalogParser';
import { NatureFetchProvider } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureFetchProvider';
import { parseNatureNewsOpinionList } from 'cs/workbench/services/fetch/electron-browser/providers/nature/natureNewsOpinionListParser';
import natureArticleDetailFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-article-detail.html';
import natureNewsCommentArticleTypesFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-article-types-news-comment.html';
import natureResearchArticleTypesFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-article-types-research.html';
import natureReviewsArticleTypesFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-article-types-reviews.html';
import natureCatalogFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-catalog-root.html';
import natureMainCatalogFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-main-catalog-root.html';
import natureNewsListFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-news-list.html';
import natureNewsOpinionListFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-news-opinion-list.html';
import natureResearchAnalysisListFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-research-analysis-list.html';
import natureArticleListFixture from 'cs/workbench/services/fetch/test/electron-browser/providers/nature/fixtures/nature-standard-article-list.html';

const base = URI.parse('https://www.nature.com/ncomms/articles');
const journal: JournalDescriptor = { id: 'journal.nature.nature', title: 'Nature', homeUrl: base, discoveryUrl: base, providerId: 'publisher.nature' };

function documentFrom(html: string): Document {
	return new JSDOM(html).window.document;
}

test('Nature fixtures parse catalog, ordinary list, news list, and article detail separately', () => {
	const exploreGroups = parseNatureExploreGroups(documentFrom(natureCatalogFixture), base);
	assert.deepEqual(exploreGroups.map(group => [group.label, group.url.path]), [
		['Research articles', '/ncomms/research-articles'],
		['Reviews & Analysis', '/ncomms/reviews-and-analysis'],
		['News & Comment', '/ncomms/news-and-comment'],
		['Videos', '/ncomms/video'],
	]);
	const researchDocument = documentFrom(natureResearchArticleTypesFixture);
	assert.equal(isNatureArticleTypeCatalog(researchDocument), true);
	assert.deepEqual(
		parseNatureArticleTypeCatalog(researchDocument, URI.parse('https://www.nature.com/ncomms/research-articles'), 'Research articles'),
		{
			kind: 'group',
			label: 'Research articles',
			sources: [
				{ kind: 'source', label: 'Article', url: URI.parse('https://www.nature.com/ncomms/research-articles?type=article') },
				{ kind: 'source', label: 'Matters Arising', url: URI.parse('https://www.nature.com/ncomms/research-articles?type=matters-arising') },
				{ kind: 'source', label: 'Registered Report', url: URI.parse('https://www.nature.com/ncomms/research-articles?type=registered-report') },
			],
		},
	);

	const articleDocument = documentFrom(natureArticleListFixture);
	assert.equal(isNatureArticleList(articleDocument), true);
	assert.deepEqual(parseNatureArticleList(articleDocument, base), {
		url: base,
		groups: [],
		ungroupedItems: [{
			providerOccurrenceKey: 'article:0',
			articleUrl: URI.parse('https://www.nature.com/articles/s41586-026-00001'),
			title: 'Nature article',
			description: 'Article description',
			articleType: 'Article',
			publishedAt: '10 Jul 2026',
			isOpenAccess: true,
			authors: [{ name: 'Ada Lovelace' }, { name: 'Grace Hopper' }],
			image: {
				url: URI.parse('https://media.nature.com/article.jpg'),
				alt: 'Microscopy image',
			},
			relatedArticles: [],
		}],
		nextPageUrl: URI.parse('https://www.nature.com/ncomms/articles?page=2'),
	});

	const newsDocument = documentFrom(natureNewsOpinionListFixture);
	const opinionBase = URI.parse('https://www.nature.com/opinion');
	assert.equal(isNatureArticleList(newsDocument), false);
	assert.equal(isNatureNewsOpinionList(newsDocument), true);
	assert.deepEqual(parseNatureDirectListSource(newsDocument, opinionBase), {
		kind: 'source',
		label: 'Opinion - latest articles',
		url: opinionBase,
	});
	assert.deepEqual(parseNatureNewsOpinionList(newsDocument, opinionBase), {
		url: opinionBase,
		groups: [],
		ungroupedItems: [{
			providerOccurrenceKey: 'article card 1',
			articleUrl: URI.parse('https://www.nature.com/articles/d41586-026-00001'),
			title: 'News article',
			description: 'News description',
			articleType: 'Comment',
			publishedAt: '10 JUL 2026',
			isOpenAccess: undefined,
			authors: [],
			image: {
				url: URI.parse('https://media.nature.com/opinion.jpg'),
				alt: '',
			},
			relatedArticles: [],
		}],
		nextPageUrl: undefined,
	});

	const detail = parseNatureArticleDetail(documentFrom(natureArticleDetailFixture), base, journal);
	assert.equal(isNatureArticleDetail(documentFrom(natureArticleDetailFixture)), true);
	assert.equal(isNatureArticleDetail(documentFrom('<main><h1>Account sign in</h1></main>')), false);
	assert.deepEqual(detail, {
		url: base,
		doi: '10.1038/test',
		title: 'Nature detail',
		description: 'Detail description',
		abstract: 'Detail abstract',
		articleType: 'Article',
		subjects: ['Genetics'],
		publishedAt: '2026-07-10',
		isOpenAccess: true,
		authors: [
			{ name: 'Ada Lovelace', isCorresponding: undefined },
			{ name: 'Grace Hopper', isCorresponding: true },
		],
		publication: {
			title: 'Nature',
			url: URI.parse('https://www.nature.com/nature'),
			year: 2026,
		},
		pdfUrl: URI.parse('https://www.nature.com/articles/s41586-026-00001.pdf'),
	});
	assert.deepEqual(
		parseNatureArticleDetail(
			documentFrom(natureArticleDetailFixture.replace('id="corresponding-author-list"', 'id="author-contact-list"')),
			base,
			journal,
		).authors.map(author => author.isCorresponding),
		[undefined, undefined],
	);
});

test('Nature discovery resolves supported Explore groups through their own Article Type pages', async () => {
	const pages = new Map<string, string>([
		[base.toString(true), natureCatalogFixture],
		['https://www.nature.com/ncomms/research-articles', natureResearchArticleTypesFixture],
		['https://www.nature.com/ncomms/reviews-and-analysis', natureReviewsArticleTypesFixture],
		['https://www.nature.com/ncomms/news-and-comment', natureNewsCommentArticleTypesFixture],
	]);
	const navigations: string[] = [];
	let disposeCount = 0;
	const pageSessionFactory = {
		createOwned: async () => ({
			navigateAndCapture: async (uri: URI) => {
				const key = uri.toString(true);
				navigations.push(key);
				const html = pages.get(key);
				if (!html) {
					throw new Error(`Unexpected Nature discovery navigation: ${key}`);
				}
				return { pageId: 'nature-page', uri, title: 'Nature', html, capturedAt: Date.now() };
			},
			dispose: async () => {
				disposeCount += 1;
			},
		}),
	};
	const provider = new NatureFetchProvider(pageSessionFactory as never);
	const catalog = await provider.discoverArticleListSources(journal, CancellationTokenNone);

	assert.deepEqual({
		navigations,
		disposeCount,
		entries: catalog.entries.map(entry => entry.kind === 'group'
			? [entry.label, entry.sources.map(source => source.label)]
			: [entry.label]),
	}, {
		navigations: [
			'https://www.nature.com/ncomms/articles',
			'https://www.nature.com/ncomms/research-articles',
			'https://www.nature.com/ncomms/reviews-and-analysis',
			'https://www.nature.com/ncomms/news-and-comment',
		],
		disposeCount: 1,
		entries: [
			['Research articles', ['Article', 'Matters Arising', 'Registered Report']],
			['Reviews & Analysis', ['Review Article', 'Perspective']],
			['News & Comment', ['Comment', 'Editorial']],
		],
	});
});

test('Nature main discovery keeps supported direct lists as Sources beside dynamic groups', async () => {
	const mainBase = URI.parse('https://www.nature.com/nature/articles');
	const pages = new Map<string, string>([
		[mainBase.toString(true), natureMainCatalogFixture],
		['https://www.nature.com/nature/research-articles', natureResearchArticleTypesFixture],
		['https://www.nature.com/news', natureNewsListFixture],
		['https://www.nature.com/opinion', natureNewsOpinionListFixture],
		['https://www.nature.com/research-analysis', natureResearchAnalysisListFixture],
	]);
	const navigations: string[] = [];
	let disposeCount = 0;
	const provider = new NatureFetchProvider({
		createOwned: async () => ({
			navigateAndCapture: async (uri: URI) => {
				const key = uri.toString(true);
				navigations.push(key);
				const html = pages.get(key);
				if (!html) {
					throw new Error(`Unexpected Nature main discovery navigation: ${key}`);
				}
				return { pageId: 'nature-main-page', uri, title: 'Nature', html, capturedAt: Date.now() };
			},
			dispose: async () => {
				disposeCount += 1;
			},
		}),
	} as never);
	const catalog = await provider.discoverArticleListSources({
		...journal,
		id: 'journal.nature.nature',
		title: 'Nature',
		discoveryUrl: mainBase,
	}, CancellationTokenNone);

	assert.deepEqual({
		navigations,
		disposeCount,
		entries: catalog.entries.map(entry => entry.kind === 'group'
			? [entry.kind, entry.label, entry.sources.map(source => source.label)]
			: [entry.kind, entry.label]),
	}, {
		navigations: [
			'https://www.nature.com/nature/articles',
			'https://www.nature.com/nature/research-articles',
			'https://www.nature.com/news',
			'https://www.nature.com/opinion',
			'https://www.nature.com/research-analysis',
		],
		disposeCount: 1,
		entries: [
			['group', 'Research articles', ['Article', 'Matters Arising', 'Registered Report']],
			['source', 'News - latest articles'],
			['source', 'Opinion - latest articles'],
			['source', 'Research Analysis - latest articles'],
		],
	});
});

test('Nature discovery returns a supported direct list as a source without a synthetic group', async () => {
	const discoveryUrl = URI.parse('https://www.nature.com/opinion');
	let disposeCount = 0;
	const provider = new NatureFetchProvider({
		createOwned: async () => ({
			navigateAndCapture: async (uri: URI) => ({
				pageId: 'nature-direct-page',
				uri,
				title: 'Opinion',
				html: natureNewsOpinionListFixture,
				capturedAt: Date.now(),
			}),
			dispose: async () => {
				disposeCount += 1;
			},
		}),
	} as never);
	const catalog = await provider.discoverArticleListSources({ ...journal, discoveryUrl }, CancellationTokenNone);

	assert.deepEqual(catalog, {
		entries: [{ kind: 'source', label: 'Opinion - latest articles', url: discoveryUrl }],
	});
	assert.equal(disposeCount, 1);
});

test('Nature discovery rejects a supported Explore page without its required Article Type facet', async () => {
	const pages = new Map<string, string>([
		[base.toString(true), natureCatalogFixture],
		['https://www.nature.com/ncomms/research-articles', '<main><h1>Research articles</h1></main>'],
		['https://www.nature.com/ncomms/reviews-and-analysis', natureReviewsArticleTypesFixture],
		['https://www.nature.com/ncomms/news-and-comment', natureNewsCommentArticleTypesFixture],
	]);
	let disposeCount = 0;
	const provider = new NatureFetchProvider({
		createOwned: async () => ({
			navigateAndCapture: async (uri: URI) => ({
				pageId: 'nature-strict-page',
				uri,
				title: 'Nature',
				html: pages.get(uri.toString(true)) ?? '<main></main>',
				capturedAt: Date.now(),
			}),
			dispose: async () => {
				disposeCount += 1;
			},
		}),
	} as never);

	await assert.rejects(
		provider.discoverArticleListSources(journal, CancellationTokenNone),
		FetchParserNotFoundError,
	);
	assert.equal(disposeCount, 1);
});

test('Nature canonicalization removes fragments without merging query-distinct resources', () => {
	const provider = new NatureFetchProvider(undefined as never);
	const source = provider.canonicalizeSourceUri(URI.parse('HTTPS://WWW.NATURE.COM:443/articles?type=article&utm_source=test#catalog'));
	assert.equal(source.toString(true), 'https://www.nature.com/articles?type=article');
	assert.notEqual(
		provider.canonicalizeSourceUri(URI.parse('https://www.nature.com/articles?type=article')).toString(true),
		provider.canonicalizeSourceUri(URI.parse('https://www.nature.com/articles?type=review')).toString(true),
	);
});
