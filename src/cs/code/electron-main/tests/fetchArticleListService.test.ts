/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { URI } from 'cs/base/common/uri';
import { getFetchArticleSourceUrl } from 'cs/base/parts/sandbox/common/fetchArticle';
import { FetchErrorCode, getFetchErrorCode, getFetchErrorDetails } from 'cs/workbench/services/fetch/common/fetchErrors';
import type { IFetchArticleDetailService } from 'cs/workbench/services/fetch/electron-main/fetchArticleDetailService';
import { FetchArticleListService } from 'cs/workbench/services/fetch/electron-main/fetchArticleListService';
import { FetchPageSession } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import type { FetchPageSessionRuntime } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import type { FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

const listUri = URI.parse('https://example.test/list');
const articleUris = [
	URI.parse('https://example.test/articles/one'),
	URI.parse('https://example.test/articles/two'),
	URI.parse('https://example.test/articles/three'),
];

const site: FetchSiteProvider = {
	id: 'test',
	acquisitionPolicy: { settleMs: 0 },
	articleListSources: [{
		id: 'test.list',
		allowedParserIds: ['test.list.v1'],
		matchUri(uri) {
			return uri.toString(true) === listUri.toString(true);
		},
		matchLoadedUri(requestedUri, finalUri) {
			return requestedUri.toString(true) === finalUri.toString(true);
		},
		pagination: { kind: 'none' },
	}],
	articleListParsers: [{
		id: 'test.list.v1',
		match(context) {
			return context.$('[data-article-uri]').length > 0 ? {
				parserId: this.id,
				evidence: [{ kind: 'testCards', selector: '[data-article-uri]' }],
			} : undefined;
		},
		parse(context) {
			return {
				candidates: context.$('[data-article-uri]').map((_, node) => ({
					sourceUri: URI.parse(context.$(node).attr('data-article-uri')!).toJSON(),
					articleListSourceId: context.articleListSourceId,
					publishedAtHint: context.$(node).attr('data-published-at') || undefined,
				})).get(),
			};
		},
	}],
	articleDetailParsers: [],
	matchUri(uri) {
		return uri.authority === 'example.test';
	},
};

function createPageSession(html: string = `<main>${articleUris.map(uri => (
	`<article data-article-uri="${uri.toString(true)}"></article>`
)).join('')}</main>`, statusCode = 200): FetchPageSession {
	let targetExists = false;
	let currentUri = listUri;
	const runtime: FetchPageSessionRuntime = {
		hasTarget() {
			return targetExists;
		},
		async ensureTarget() {
			targetExists = true;
		},
		getPresentation() {
			return 'background';
		},
		async loadUri(_resource, uri) {
			currentUri = uri;
		},
		async getSnapshot() {
			return {
				url: currentUri.toString(true),
				html,
				statusCode,
				documentReadyState: 'complete',
			};
		},
		async destroyTarget() {
			targetExists = false;
		},
	};
	return new FetchPageSession(runtime, 'background', {
		onBrowserEditorRequired() {},
	});
}

test('article-list limit counts only globally new article URIs', async () => {
	const detailCalls: string[] = [];
	const detailService: IFetchArticleDetailService = {
		async fetchArticleDetail(request) {
			const sourceUrl = request.sourceUri.toString(true);
			detailCalls.push(sourceUrl);
			return {
				article: {
					sourceUri: request.sourceUri.toJSON(),
					title: sourceUrl,
					publication: {
						id: 'testJournal',
						title: 'Test Journal',
						publisherId: 'testPublisher',
						publisherTitle: 'Test Publisher',
					},
					articleKind: 'news',
					authors: [],
					sections: [{ content: 'Complete article body content. '.repeat(8) }],
					figures: [],
					references: [],
					fetchedAt: '2026-07-10T00:00:00.000Z',
					fetchOrder: request.fetchOrder ?? 1,
					articleListSourceId: request.candidate?.articleListSourceId,
				},
				proof: {
					canonicalUriMatched: true,
					titleFound: true,
					authorsFound: false,
					abstractFound: false,
					bodyFound: true,
					publicationFound: true,
					articleKindFound: true,
					accessGate: null,
				},
				diagnostics: {
					siteId: 'test',
					parserId: 'test.article.v1',
					parserEvidence: [],
					classificationEvidence: [],
				},
			};
		},
	};
	const pageSession = createPageSession();
	try {
		const result = await new FetchArticleListService([site]).fetchFromArticleList({
			listUri,
			pageNumber: 2,
			remainingLimit: 2,
			dateRange: { start: null, end: null },
			seenPageUris: new Set([listUri.toString(true)]),
			seenArticleUris: new Set([articleUris[0].toString(true)]),
			pageSession,
			articleDetailService: detailService,
			pageTimeoutMs: 1000,
			articleTimeoutMs: 1000,
			browserEditorTimeoutMs: 1000,
			traceId: 'test',
			async fetchText() {
				throw new Error('Unexpected enrichment request.');
			},
		});
		assert.deepEqual(detailCalls, articleUris.slice(1).map(uri => uri.toString(true)));
		assert.deepEqual(result.articles.map(getFetchArticleSourceUrl), detailCalls);
		assert.equal(result.candidateAccepted, 2);
	} finally {
		await pageSession.dispose();
	}
});

test('article-list admission rejects an access gate even when retained cards still parse', async () => {
	const pageSession = createPageSession(`
		<main><article data-article-uri="${articleUris[0].toString(true)}"></article></main>
		<div id="challenge-running">Checking your browser. Cloudflare Ray ID 123.</div>
		<script src="/cdn-cgi/challenge-platform/test"></script>
	`);
	try {
		await assert.rejects(
			() => new FetchArticleListService([site]).fetchFromArticleList({
				listUri,
				pageNumber: 1,
				remainingLimit: 1,
				dateRange: { start: null, end: null },
				seenPageUris: new Set(),
				seenArticleUris: new Set(),
				pageSession,
				articleDetailService: {
					async fetchArticleDetail() {
						throw new Error('Detail parsing must not start through an access gate.');
					},
				},
				pageTimeoutMs: 1000,
				articleTimeoutMs: 1000,
				browserEditorTimeoutMs: 1000,
				traceId: 'gate-test',
				async fetchText() {
					throw new Error('Unexpected enrichment request.');
				},
			}),
			(error) => {
				assert.equal(getFetchErrorCode(error), FetchErrorCode.ArticleListPageRejected);
				assert.equal(getFetchErrorDetails(error)?.accessGate, 'cloudflareChallenge');
				return true;
			},
		);
	} finally {
		await pageSession.dispose();
	}
});

test('article-list admission rejects a failed HTTP status even when cards still parse', async () => {
	const pageSession = createPageSession(
		`<main><article data-article-uri="${articleUris[0].toString(true)}"></article></main>`,
		404,
	);
	try {
		await assert.rejects(
			() => new FetchArticleListService([site]).fetchFromArticleList({
				listUri,
				pageNumber: 1,
				remainingLimit: 1,
				dateRange: { start: null, end: null },
				seenPageUris: new Set(),
				seenArticleUris: new Set(),
				pageSession,
				articleDetailService: {
					async fetchArticleDetail() {
						throw new Error('Detail parsing must not start for a failed list response.');
					},
				},
				pageTimeoutMs: 1000,
				articleTimeoutMs: 1000,
				browserEditorTimeoutMs: 1000,
				traceId: 'http-test',
				async fetchText() {
					throw new Error('Unexpected enrichment request.');
				},
			}),
			(error) => getFetchErrorCode(error) === FetchErrorCode.HttpRequestFailed,
		);
	} finally {
		await pageSession.dispose();
	}
});

test('article-list filtering uses the detail date instead of rejecting an out-of-range hint', async () => {
	const pageSession = createPageSession(
		`<main><article data-article-uri="${articleUris[0].toString(true)}" data-published-at="2020-01-01"></article></main>`,
	);
	let detailCalled = false;
	try {
		const result = await new FetchArticleListService([site]).fetchFromArticleList({
			listUri,
			pageNumber: 1,
			remainingLimit: 1,
			dateRange: { start: '2026-07-10', end: '2026-07-10' },
			seenPageUris: new Set(),
			seenArticleUris: new Set(),
			pageSession,
			articleDetailService: {
				async fetchArticleDetail(request) {
					detailCalled = true;
					return {
						article: {
							sourceUri: request.sourceUri.toJSON(),
							title: 'Detail-dated article',
							publication: {
								id: 'testJournal',
								title: 'Test Journal',
								publisherId: 'testPublisher',
								publisherTitle: 'Test Publisher',
							},
							articleKind: 'news',
							authors: [],
							sections: [{ content: 'Complete article body content. '.repeat(8) }],
							figures: [],
							references: [],
							publishedAt: '2026-07-10',
							fetchedAt: '2026-07-10T00:00:00.000Z',
							fetchOrder: 1,
						},
						proof: {
							canonicalUriMatched: true,
							titleFound: true,
							authorsFound: false,
							abstractFound: false,
							bodyFound: true,
							publicationFound: true,
							articleKindFound: true,
							accessGate: null,
						},
						diagnostics: {
							siteId: 'test',
							parserId: 'test.article.v1',
							parserEvidence: [],
							classificationEvidence: [],
						},
					};
				},
			},
			pageTimeoutMs: 1000,
			articleTimeoutMs: 1000,
			browserEditorTimeoutMs: 1000,
			traceId: 'date-test',
			async fetchText() {
				throw new Error('Unexpected enrichment request.');
			},
		});
		assert.equal(detailCalled, true);
		assert.equal(result.articles.length, 1);
	} finally {
		await pageSession.dispose();
	}
});

test('article-list enrichment propagates cancellation and cannot return success after abort', async () => {
	const controller = new AbortController();
	const enrichmentSite: FetchSiteProvider = {
		...site,
		articleListSources: [{
			...site.articleListSources[0],
			enrichment: {
				kind: 'testAbort',
				async enrich(context) {
					assert.equal(context.signal, controller.signal);
					controller.abort();
					return context.candidates;
				},
			},
		}],
	};
	const pageSession = createPageSession();
	try {
		await assert.rejects(
			() => new FetchArticleListService([enrichmentSite]).fetchFromArticleList({
				listUri,
				pageNumber: 1,
				remainingLimit: 1,
				dateRange: { start: null, end: null },
				seenPageUris: new Set(),
				seenArticleUris: new Set(),
				pageSession,
				articleDetailService: {
					async fetchArticleDetail() {
						throw new Error('Detail parsing must not start after cancellation.');
					},
				},
				pageTimeoutMs: 1000,
				articleTimeoutMs: 1000,
				browserEditorTimeoutMs: 1000,
				traceId: 'abort-test',
				signal: controller.signal,
				async fetchText() {
					throw new Error('Unexpected enrichment request.');
				},
			}),
			(error) => getFetchErrorDetails(error)?.status === 'ABORTED',
		);
	} finally {
		await pageSession.dispose();
	}
});
