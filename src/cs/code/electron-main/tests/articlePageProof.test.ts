/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { URI } from 'cs/base/common/uri';
import type { FetchArticleProof } from 'cs/base/parts/sandbox/common/fetchArticleProof';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { FetchErrorCode, getFetchErrorCode, getFetchErrorDetails } from 'cs/workbench/services/fetch/common/fetchErrors';
import { parseFetchArticleSnapshot } from 'cs/workbench/services/fetch/electron-main/fetchArticleDetailService';
import type { FetchPageSnapshot } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';

const bodyText = 'This paragraph contains the complete scientific article body and enough meaningful text to prove that the publisher rendered the requested content. '.repeat(3);

function createSnapshot(url: string, html: string, finalUrl: string = url): FetchPageSnapshot {
	return {
		resource: BrowserViewUri.forId('article-proof'),
		presentation: 'background',
		requestedUri: URI.parse(url),
		finalUri: URI.parse(finalUrl),
		statusCode: 200,
		html,
		documentReadyState: 'complete',
	};
}

function readRejectedProof(error: unknown): FetchArticleProof | undefined {
	return getFetchErrorDetails(error)?.proof as FetchArticleProof | undefined;
}

test('article detail parsing accepts each registered publisher only with structural and article proof', () => {
	const fixtures = [
		{
			url: 'https://www.nature.com/articles/s12345-026-00001',
			title: '<div class="c-article-header"><h1>Nature article title</h1></div>',
			body: `<div class="c-article-body"><section class="c-article-section"><h2>Results</h2><div id="Sec1-content" class="c-article-section__content"><p>${bodyText}</p></div></section></div>`,
			publication: 'Nature',
		},
		{
			url: 'https://www.science.org/doi/10.1126/science.example',
			title: '<h1 class="article__headline">Science article title</h1>',
			body: `<div class="article__body"><p>${bodyText}</p></div>`,
			publication: 'Science',
		},
		{
			url: 'https://pubs.acs.org/doi/10.1021/example',
			title: '<h1 class="hlFld-Title">ACS article title</h1>',
			body: `<div class="NLM_body"><p>${bodyText}</p></div>`,
			publication: 'ACS Nano',
		},
		{
			url: 'https://onlinelibrary.wiley.com/doi/10.1002/example',
			title: '<h1 class="citation__title">Wiley article title</h1>',
			body: `<section class="article-section__content"><p>${bodyText}</p></section>`,
			publication: 'Advanced Materials',
		},
	];

	for (const fixture of fixtures) {
		const result = parseFetchArticleSnapshot(createSnapshot(fixture.url, `
			<html><head>
				<link rel="canonical" href="${fixture.url}">
				<meta name="citation_title" content="Verified article title">
				<meta name="citation_author" content="Ada Lovelace">
				<meta name="citation_abstract" content="A sufficiently detailed abstract describing the article and its main result.">
				<meta name="citation_journal_title" content="${fixture.publication}">
				<meta name="citation_article_type" content="Article">
			</head><body>${fixture.title}${fixture.body}</body></html>`));
		assert.equal(result.proof.canonicalUriMatched, true, fixture.url);
		assert.equal(result.proof.titleFound, true, fixture.url);
		assert.equal(result.proof.authorsFound, true, fixture.url);
		assert.equal(result.proof.abstractFound, true, fixture.url);
		assert.equal(result.proof.bodyFound, true, fixture.url);
		assert.equal(result.proof.publicationFound, true, fixture.url);
		assert.equal(result.proof.articleKindFound, true, fixture.url);
		assert.equal(result.proof.accessGate, null, fixture.url);
	}
});

test('access gates reject a structurally recognized article page', () => {
	const url = 'https://www.science.org/doi/10.1126/science.example';
	for (const [gateHtml, expectedGate] of [
		['<div id="challenge-running">Checking your browser. Cloudflare Ray ID 123.</div><script src="/cdn-cgi/challenge-platform/test"></script>', 'cloudflareChallenge'],
		['<form action="/login"><input type="password"></form>', 'loginRequired'],
		['<div data-testid="paywall">Purchase access.</div>', 'subscriptionGate'],
	] as const) {
		assert.throws(
			() => parseFetchArticleSnapshot(createSnapshot(url, `
				<html><head>
					<link rel="canonical" href="${url}">
					<meta name="citation_title" content="Retained title">
					<meta name="citation_journal_title" content="Science">
					<meta name="citation_article_type" content="News">
				</head><body>
					<h1 class="article__headline">Retained title</h1>
					<div class="article__body">${gateHtml}</div>
				</body></html>`)),
			(error) => {
				assert.equal(getFetchErrorCode(error), FetchErrorCode.ArticlePageRejected);
				assert.equal(readRejectedProof(error)?.accessGate, expectedGate);
				return true;
			},
		);
	}
});

test('inactive CAPTCHA scripts do not override a complete article', () => {
	const url = 'https://www.nature.com/articles/s12345-026-00002';
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Normal article">
			<meta name="citation_journal_title" content="Nature">
			<meta name="citation_article_type" content="Article">
			<meta name="citation_abstract" content="A complete abstract that provides enough evidence for article extraction.">
			<script src="https://www.google.com/recaptcha/api.js"></script>
		</head><body>
			<div class="c-article-header"><h1>Normal article</h1></div>
			<div class="c-article-body"><section class="c-article-section"><h2>Results</h2><div id="Sec1-content" class="c-article-section__content"><p>${bodyText}</p></div></section></div>
		</body></html>`));
	assert.equal(result.proof.accessGate, null);
});

test('Nature journal sections keep references out of the article body', () => {
	const url = 'https://www.nature.com/articles/s41586-026-00003-4';
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Separated references">
			<meta name="citation_journal_title" content="Nature">
			<meta name="citation_article_type" content="Article">
			<meta name="citation_abstract" content="A complete abstract for a Nature research article.">
		</head><body>
			<div class="c-article-header"><h1>Separated references</h1></div>
			<div class="c-article-body">
				<section class="c-article-section"><h2>Results</h2><div id="Sec1-content" class="c-article-section__content"><p>${bodyText}</p></div></section>
				<section id="Bib1" class="c-article-section"><h2>References</h2><div id="Bib1-content"><p class="c-article-references__text">Reference text must not become article body content.</p></div></section>
			</div>
		</body></html>`));
	assert.doesNotMatch(result.article.sections.map(section => section.content).join('\n'), /Reference text/);
	assert.match(result.article.references[0]?.text ?? '', /Reference text/);
});

test('Nature journal supplementary information cannot stand in for the article body', () => {
	const url = 'https://www.nature.com/articles/s41586-026-00004-5';
	assert.throws(
		() => parseFetchArticleSnapshot(createSnapshot(url, `
			<html><head>
				<link rel="canonical" href="${url}">
				<meta name="citation_title" content="Gated journal article">
				<meta name="citation_journal_title" content="Nature">
				<meta name="citation_article_type" content="Article">
				<meta name="citation_abstract" content="A retained abstract from the inaccessible article.">
			</head><body>
				<div class="c-article-header"><h1>Gated journal article</h1></div>
				<div class="c-article-body"><section data-title="Supplementary information"><div class="c-article-section"><h2>Supplementary information</h2><div id="Sec7-content" class="c-article-section__content"><p>${bodyText}</p></div></div></section></div>
			</body></html>`)),
		(error) => getFetchErrorCode(error) === FetchErrorCode.UnsupportedArticleDetailStructure,
	);
});

test('Nature editorial parsing uses the current combined article-body main-content node', () => {
	const url = 'https://www.nature.com/articles/d41586-026-02091-6';
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
		</head><body>
			<div class="c-article-header"><span data-test="article-category">NEWS EXPLAINER</span><h1>Current editorial article</h1><time datetime="2026-07-10">10 July 2026</time></div>
			<div class="c-article-body main-content"><p>${bodyText}</p></div>
		</body></html>`));
	assert.equal(result.article.articleKind, 'news');
	assert.equal(result.article.sourceArticleType, 'NEWS EXPLAINER');
	assert.equal(result.article.publishedAt, '2026-07-10');
	assert.match(result.article.sections[0]?.content ?? '', /complete scientific article body/);
});

test('Nature editorial access wall rejects a long teaser', () => {
	const url = 'https://www.nature.com/articles/d41586-026-02091-7';
	assert.throws(
		() => parseFetchArticleSnapshot(createSnapshot(url, `
			<html><head>
				<link rel="canonical" href="${url}">
				<meta name="citation_title" content="Access-walled editorial">
				<meta name="citation_journal_title" content="Nature">
				<meta name="citation_article_type" content="News">
			</head><body>
				<div class="c-article-header"><h1>Access-walled editorial</h1></div>
				<div class="c-article-body main-content"><p>${bodyText}</p><div class="app-access-wall" data-test="access-wall">Subscribe to continue.</div></div>
			</body></html>`)),
		(error) => {
			assert.equal(getFetchErrorCode(error), FetchErrorCode.ArticlePageRejected);
			assert.equal(readRejectedProof(error)?.accessGate, 'subscriptionGate');
			return true;
		},
	);
});

test('an explicit soft paywall rejects an article even when the teaser exceeds the body threshold', () => {
	const url = 'https://www.science.org/doi/10.1126/science.paywalled';
	assert.throws(
		() => parseFetchArticleSnapshot(createSnapshot(url, `
			<html><head>
				<link rel="canonical" href="${url}">
				<meta name="citation_title" content="Paywalled article">
				<meta name="citation_journal_title" content="Science">
				<meta name="citation_article_type" content="Article">
				<meta name="citation_abstract" content="A complete abstract that would otherwise satisfy research article proof.">
			</head><body>
				<h1 class="article__headline">Paywalled article</h1>
				<div class="article__body"><p>${bodyText}</p><div data-testid="paywall">Subscribe to continue.</div></div>
			</body></html>`)),
		(error) => {
			assert.equal(getFetchErrorCode(error), FetchErrorCode.ArticlePageRejected);
			assert.equal(readRejectedProof(error)?.accessGate, 'subscriptionGate');
			return true;
		},
	);
});

test('DOI evidence conflict is reported instead of selecting one value', () => {
	const url = 'https://www.science.org/doi/10.1126/science.requested';
	assert.throws(
		() => parseFetchArticleSnapshot(createSnapshot(url, `
			<html><head>
				<link rel="canonical" href="${url}">
				<meta name="citation_doi" content="10.1126/science.other">
				<meta name="citation_title" content="Conflicting article">
				<meta name="citation_journal_title" content="Science">
				<meta name="citation_article_type" content="Article">
				<meta name="citation_abstract" content="A complete abstract for the conflicting article.">
			</head><body>
				<h1 class="article__headline">Conflicting article</h1>
				<div class="article__body"><p>${bodyText}</p></div>
			</body></html>`)),
		(error) => getFetchErrorCode(error) === FetchErrorCode.MetadataConflict,
	);
});

test('publisher body parsing combines multiple structural sections', () => {
	const url = 'https://onlinelibrary.wiley.com/doi/10.1002/example';
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Multi-section article">
			<meta name="citation_journal_title" content="Advanced Materials">
			<meta name="citation_article_type" content="News">
		</head><body>
			<h1 class="citation__title">Multi-section article</h1>
			<section class="article-section__content"><p>Short highlights.</p></section>
			<section class="article-section__content"><p>${bodyText}</p></section>
		</body></html>`));
	assert.equal(result.article.sections.length, 2);
	assert.match(result.article.sections.map(section => section.content).join('\n'), /complete scientific article body/);
});

test('publisher parsing accepts a DOM abstract and preserves titled sections', () => {
	const url = 'https://www.science.org/doi/10.1126/science.dom-abstract';
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="DOM abstract article">
			<meta name="citation_journal_title" content="Science">
			<meta name="citation_article_type" content="Research Article">
		</head><body>
			<h1 class="article__headline">DOM abstract article</h1>
			<div itemprop="abstract"><p>A sufficiently detailed abstract rendered in the article DOM.</p></div>
			<div class="article__body"><section id="results"><h2>Results</h2><p>${bodyText}</p></section></div>
		</body></html>`));
	assert.equal(result.proof.abstractFound, true);
	assert.equal(result.article.sections[0]?.id, 'results');
	assert.equal(result.article.sections[0]?.title, 'Results');
});

test('protocol parsing retains ordered procedure steps from the article body', () => {
	const url = 'https://pubs.acs.org/doi/10.1021/protocol.example';
	const stepText = 'Prepare the material and perform the procedure under controlled conditions. '.repeat(3);
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Validated protocol">
			<meta name="citation_journal_title" content="ACS Protocols">
			<meta name="citation_article_type" content="Protocol">
		</head><body>
			<h1 class="hlFld-Title">Validated protocol</h1>
			<div class="NLM_body"><section class="NLM_sec"><h2>Procedure</h2><ol><li>${stepText}</li></ol></section></div>
		</body></html>`));
	assert.equal(result.article.articleKind, 'protocol');
	assert.match(result.article.sections[0]?.content ?? '', /Prepare the material/);
});

test('publisher parsing does not duplicate nested body selector variants', () => {
	const url = 'https://www.science.org/doi/10.1126/science.nested-body';
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Nested body article">
			<meta name="citation_journal_title" content="Science">
			<meta name="citation_article_type" content="News">
		</head><body>
			<h1 class="article__headline">Nested body article</h1>
			<div class="article__body"><div class="bodymatter"><p>${bodyText}</p></div></div>
		</body></html>`));
	assert.equal(result.article.sections.length, 1);
	assert.equal(result.article.sections[0]?.content.match(/complete scientific article body/g)?.length, 3);
});

test('publisher parsing represents nested sections as children without duplicating child text', () => {
	const url = 'https://www.science.org/doi/10.1126/science.nested-sections';
	const parentText = 'The parent section contains enough introductory scientific content. '.repeat(3);
	const childText = 'The child section contains distinct experimental observations. '.repeat(3);
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Nested sections article">
			<meta name="citation_journal_title" content="Science">
			<meta name="citation_article_type" content="News">
		</head><body>
			<h1 class="article__headline">Nested sections article</h1>
			<div class="article__body"><section id="parent"><h2>Parent</h2><p>${parentText}</p>
				<section id="child"><h3>Child</h3><p>${childText}</p></section>
			</section></div>
		</body></html>`));
	assert.equal(result.article.sections.length, 1);
	assert.equal(result.article.sections[0]?.id, 'parent');
	assert.doesNotMatch(result.article.sections[0]?.content ?? '', /experimental observations/);
	assert.equal(result.article.sections[0]?.children?.[0]?.id, 'child');
	assert.match(result.article.sections[0]?.children?.[0]?.content ?? '', /experimental observations/);
});

test('publisher parsing reads article metadata only from a scoped JSON-LD Article record', () => {
	const url = 'https://www.science.org/doi/10.1126/science.structured';
	const result = parseFetchArticleSnapshot(createSnapshot(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<script type="application/ld+json">${JSON.stringify({
				'@context': 'https://schema.org',
				'@type': 'ScholarlyArticle',
				headline: 'Structured article',
				abstract: 'A sufficiently detailed abstract provided by the scoped structured article record.',
				genre: 'Research Article',
				identifier: '10.1126/science.structured',
				datePublished: '2026-07-10T12:00:00Z',
				author: [{ '@type': 'Person', givenName: 'Ada', familyName: 'Lovelace' }],
				isPartOf: { '@type': 'Periodical', name: 'Science' },
			})}</script>
		</head><body>
			<h1 class="article__headline">Structured article</h1>
			<div class="article__body"><section><h2>Results</h2><p>${bodyText}</p></section></div>
		</body></html>`));
	assert.equal(result.article.publication.title, 'Science');
	assert.equal(result.article.authors[0]?.name, 'Ada Lovelace');
	assert.equal(result.article.publishedAt, '2026-07-10');
	assert.equal(result.article.doi, '10.1126/science.structured');
	assert.equal(result.article.articleKind, 'researchArticle');
});

test('Science article proof accepts the controlled sciencemag.org to science.org authority migration', () => {
	const requestedUrl = 'https://www.sciencemag.org/doi/10.1126/science.alias';
	const finalUrl = 'https://www.science.org/doi/10.1126/science.alias';
	const result = parseFetchArticleSnapshot(createSnapshot(requestedUrl, `
		<html><head>
			<link rel="canonical" href="${finalUrl}">
			<meta name="citation_title" content="Authority alias article">
			<meta name="citation_journal_title" content="Science">
			<meta name="citation_article_type" content="News">
		</head><body>
			<h1 class="article__headline">Authority alias article</h1>
			<div class="article__body"><p>${bodyText}</p></div>
		</body></html>`, finalUrl));
	assert.equal(result.proof.canonicalUriMatched, true);
});

test('a failed article HTTP status cannot pass structural proof', () => {
	const url = 'https://www.science.org/doi/10.1126/science.not-found';
	const snapshot = createSnapshot(url, `
		<html><head><link rel="canonical" href="${url}"></head><body>
			<h1 class="article__headline">Retained error-page title</h1>
			<div class="article__body"><p>${bodyText}</p></div>
		</body></html>`);
	assert.throws(
		() => parseFetchArticleSnapshot({ ...snapshot, statusCode: 404 }),
		(error) => getFetchErrorCode(error) === FetchErrorCode.HttpRequestFailed,
	);
});

test('Nature article identity cannot survive navigation to an unrecognized same-site path', () => {
	const requestedUrl = 'https://www.nature.com/articles/s41586-026-00009-0';
	assert.throws(
		() => parseFetchArticleSnapshot(createSnapshot(requestedUrl, `
			<html><head>
				<link rel="canonical" href="${requestedUrl}">
				<meta name="citation_title" content="Stale article shell">
				<meta name="citation_journal_title" content="Nature">
				<meta name="citation_article_type" content="Article">
				<meta name="citation_abstract" content="A stale abstract retained after navigation.">
			</head><body>
				<div class="c-article-header"><h1>Stale article shell</h1></div>
				<div class="c-article-body"><section class="c-article-section"><h2>Results</h2><div id="Sec1-content" class="c-article-section__content"><p>${bodyText}</p></div></section></div>
			</body></html>`, 'https://www.nature.com/login')),
		(error) => getFetchErrorCode(error) === FetchErrorCode.ArticlePageRejected,
	);
});
