/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import {
	buildArticlePageProof,
	isArticlePageProofSatisfied,
} from 'cs/workbench/services/fetch/electron-main/articlePageProof';
import { buildArticleFromHtml } from 'cs/workbench/services/fetch/electron-main/parser';
import type { FetchTargetDocument } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';

const BODY_TEXT = 'This paragraph contains the complete scientific article body and enough meaningful text to prove that the publisher rendered the requested content. '.repeat(3);

function createTargetDocument(url: string, html: string): FetchTargetDocument {
	return {
		resource: BrowserViewUri.forId('article-proof'),
		targetMode: 'background',
		requestedUrl: url,
		finalUrl: url,
		statusCode: 200,
		html,
		documentReadyState: 'complete',
	};
}

function assess(url: string, html: string) {
	const document = createTargetDocument(url, html);
	const article = buildArticleFromHtml(url, html);
	return buildArticlePageProof(document, article);
}

function assessDocument(requestedUrl: string, finalUrl: string, html: string) {
	const document = {
		...createTargetDocument(requestedUrl, html),
		finalUrl,
	};
	const article = buildArticleFromHtml(requestedUrl, html);
	return buildArticlePageProof(document, article);
}

test('article page proof accepts publisher DOM only when identity and content agree', () => {
	const fixtures = [
		{
			url: 'https://www.nature.com/articles/s12345-026-00001',
			title: '<h1>Nature article title</h1>',
			titleRoot: 'c-article-header',
			bodyRoot: 'c-article-body',
		},
		{
			url: 'https://www.science.org/doi/10.1126/science.example',
			title: '<h1 class="article__headline">Science article title</h1>',
			titleRoot: '',
			bodyRoot: 'article__body',
		},
		{
			url: 'https://pubs.acs.org/doi/10.1021/example',
			title: '<h1 class="hlFld-Title">ACS article title</h1>',
			titleRoot: '',
			bodyRoot: 'NLM_body',
		},
		{
			url: 'https://onlinelibrary.wiley.com/doi/10.1002/example',
			title: '<h1 class="citation__title">Wiley article title</h1>',
			titleRoot: '',
			bodyRoot: 'article-section__content',
		},
	];

	for (const fixture of fixtures) {
		const html = `
			<html>
				<head>
					<link rel="canonical" href="${fixture.url}">
					<meta name="citation_title" content="Verified article title">
					<meta name="citation_author" content="Ada Lovelace">
					<meta name="citation_abstract" content="A sufficiently detailed abstract describing the article and its main result.">
				</head>
				<body>
					<div class="${fixture.titleRoot}">${fixture.title}</div>
					<div class="${fixture.bodyRoot}"><p>${BODY_TEXT}</p></div>
				</body>
			</html>`;
		const proof = assess(fixture.url, html);
		assert.equal(proof.canonicalUrlMatched, true, fixture.url);
		assert.equal(proof.titleFound, true, fixture.url);
		assert.equal(proof.authorsFound, true, fixture.url);
		assert.equal(proof.abstractFound, true, fixture.url);
		assert.equal(proof.bodyFound, true, fixture.url);
		assert.equal(proof.accessGate, null, fixture.url);
		assert.equal(isArticlePageProofSatisfied(proof), true, fixture.url);
	}
});

test('Cloudflare and login pages cannot pass article proof through a DOI in the URL', () => {
	const articleUrl = 'https://www.science.org/doi/10.1126/science.example';
	const cloudflareProof = assess(articleUrl, `
		<html><head><title>Just a moment...</title></head><body>
			<div id="challenge-running">Checking your browser before accessing Cloudflare protected content. Ray ID 123.</div>
			<script src="/cdn-cgi/challenge-platform/h/g/orchestrate/chl_page/v1"></script>
		</body></html>`);
	assert.equal(cloudflareProof.accessGate, 'cloudflareChallenge');
	assert.equal(isArticlePageProofSatisfied(cloudflareProof), false);

	const loginProof = assess(articleUrl, `
		<html><head><title>Sign in</title></head><body>
			<form action="/login?returnUrl=${encodeURIComponent(articleUrl)}"><input type="password"></form>
		</body></html>`);
	assert.equal(loginProof.accessGate, 'loginRequired');
	assert.equal(loginProof.titleFound, false);
	assert.equal(isArticlePageProofSatisfied(loginProof), false);
});

test('normal article navigation controls and inactive CAPTCHA scripts do not create a gate', () => {
	const url = 'https://www.nature.com/articles/s12345-026-00002';
	const html = `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Normal article">
			<meta name="citation_author" content="Grace Hopper">
			<meta name="citation_abstract" content="A complete abstract that provides enough evidence for article extraction.">
			<script src="https://www.google.com/recaptcha/api.js"></script>
		</head><body>
			<nav><a href="/login">Sign in</a><a href="/subscribe">Subscribe</a></nav>
			<div class="c-article-header"><h1>Normal article</h1></div>
			<div class="c-article-body"><div class="main-content"><p>${BODY_TEXT}</p></div></div>
		</body></html>`;
	const proof = assess(url, html);
	assert.equal(proof.accessGate, null);
	assert.equal(isArticlePageProofSatisfied(proof), true);
});

test('subscription gate overrides otherwise complete article metadata', () => {
	const url = 'https://onlinelibrary.wiley.com/doi/10.1002/example';
	const html = `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Subscription article">
			<meta name="citation_author" content="Katherine Johnson">
			<meta name="citation_abstract" content="The abstract remains visible even though the full article requires a subscription.">
		</head><body><div data-testid="paywall">Purchase access or sign in through your institution.</div></body></html>`;
	const proof = assess(url, html);
	assert.equal(proof.accessGate, 'subscriptionGate');
	assert.equal(isArticlePageProofSatisfied(proof), false);
});

test('login, SSO, and CAPTCHA gates override retained article metadata', () => {
	const articleUrl = 'https://www.science.org/doi/10.1126/science.example';
	const articleHead = `
		<link rel="canonical" href="${articleUrl}">
		<meta name="citation_title" content="Retained article title">
		<meta name="citation_abstract" content="The publisher retains this complete abstract while access is blocked.">`;
	const loginProof = assess(articleUrl, `
		<html><head>${articleHead}</head><body>
			<form action="/login"><input type="password"></form>
		</body></html>`);
	assert.equal(loginProof.accessGate, 'loginRequired');
	assert.equal(isArticlePageProofSatisfied(loginProof), false);

	const ssoProof = assessDocument(
		articleUrl,
		'https://login.example.edu/idp/saml',
		`<html><head>${articleHead}</head><body>
			<form action="/saml"><input name="SAMLRequest"></form>
		</body></html>`,
	);
	assert.equal(ssoProof.accessGate, 'institutionalSso');
	assert.equal(isArticlePageProofSatisfied(ssoProof), false);

	const captchaProof = assess(articleUrl, `
		<html><head>${articleHead}</head><body>
			<iframe src="https://captcha.example/recaptcha/challenge"></iframe>
		</body></html>`);
	assert.equal(captchaProof.accessGate, 'manualInteractionRequired');
	assert.equal(isArticlePageProofSatisfied(captchaProof), false);
});

test('declared canonical and DOI identity must agree with the requested article', () => {
	const requestedUrl = 'https://www.science.org/doi/10.1126/science.requested';
	const proof = assess(requestedUrl, `
		<html><head>
			<link rel="canonical" href="https://www.science.org/doi/10.1126/science.other">
			<meta name="citation_doi" content="10.1126/science.other">
			<meta name="citation_title" content="A different article">
			<meta name="citation_abstract" content="A complete abstract belonging to a different article identity.">
		</head><body></body></html>`);
	assert.equal(proof.canonicalUrlMatched, false);
	assert.equal(isArticlePageProofSatisfied(proof), false);
});

test('paywall abstract is not counted as article body', () => {
	const url = 'https://onlinelibrary.wiley.com/doi/10.1002/example';
	const proof = assess(url, `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Subscription article">
			<meta name="citation_abstract" content="The abstract remains visible while the body requires a subscription.">
		</head><body>
			<div class="abstract article-section__content"><p>${BODY_TEXT}</p></div>
			<div data-testid="paywall">Purchase access.</div>
		</body></html>`);
	assert.equal(proof.bodyFound, false);
	assert.equal(proof.accessGate, 'subscriptionGate');
	assert.equal(isArticlePageProofSatisfied(proof), false);
});

test('publisher body extraction combines later article sections', () => {
	const url = 'https://onlinelibrary.wiley.com/doi/10.1002/example';
	const html = `
		<html><head>
			<link rel="canonical" href="${url}">
			<meta name="citation_title" content="Multi-section article">
		</head><body>
			<h1 class="citation__title">Multi-section article</h1>
			<section class="article-section__content"><p>Short highlights.</p></section>
			<section class="article-section__content"><p>${BODY_TEXT}</p></section>
		</body></html>`;
	const document = createTargetDocument(url, html);
	const article = buildArticleFromHtml(url, html);
	const proof = buildArticlePageProof(document, article);
	assert.equal(proof.bodyFound, true);
	assert.equal(isArticlePageProofSatisfied(proof), true);
	assert.match(article.descriptionText ?? '', /complete scientific article body/);
});
