/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'cheerio';

import type {
	Article,
	ArticlePageProof,
	ArticlePublisherId,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { cleanText } from 'cs/base/common/strings';
import { detectAccessGate } from 'cs/workbench/services/fetch/electron-main/accessGateDetector';
import { extractArticleBodyText } from 'cs/workbench/services/fetch/electron-main/articleBody';
import type { FetchTargetDocument } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';
import { extractStructuredDataItems } from 'cs/workbench/services/fetch/electron-main/rawMetadata';
import { resolvePublisherProfile } from 'cs/workbench/services/fetch/electron-main/publisherResolver';

const DOI_IDENTITY_PATTERN = /10\.\d{4,9}\/[-._;()/:a-z0-9]+/i;

const ARTICLE_TITLE_SELECTORS: Record<ArticlePublisherId, string> = {
	nature: '.c-article-header h1, [data-test="article-title"]',
	science: '.article__headline, .article-header__title, [data-test="article-title"]',
	acs: '.article_header-title, .hlFld-Title, [data-test="article-title"]',
	wiley: '.citation__title, .article-header__title, [data-test="article-title"]',
	other: '[itemprop="headline"], [data-test="article-title"]',
};

function collectStructuredArticleRecords(
	items: ReturnType<typeof extractStructuredDataItems>,
) {
	return items.filter(item => {
		const rawType = item['@type'];
		const types = Array.isArray(rawType) ? rawType : [rawType];
		return types.some(type => /(?:scholarly|news)?article/i.test(cleanText(type)));
	});
}

function normalizeComparableUrl(value: string) {
	try {
		const url = new URL(value);
		const hostname = url.hostname.toLowerCase().replace(/^www\./, '');
		let pathname = decodeURIComponent(url.pathname)
			.replace(/^\/doi\/(?:abs|full|epdf|pdf)\//i, '/doi/')
			.replace(/\/+$/, '') || '/';
		pathname = pathname.toLowerCase();
		return `${hostname}${pathname}`;
	} catch {
		return '';
	}
}

function extractDoiIdentity(value: string) {
	const match = cleanText(value).match(DOI_IDENTITY_PATTERN);
	return match?.[0]?.replace(/[.,;:]+$/, '').toLowerCase() ?? '';
}

function extractUrlDoiIdentity(value: string) {
	try {
		return extractDoiIdentity(decodeURIComponent(new URL(value).pathname));
	} catch {
		return '';
	}
}

function resolveCanonicalUrlMatched(
	$: ReturnType<typeof load>,
	document: FetchTargetDocument,
) {
	const requestedComparable = normalizeComparableUrl(document.requestedUrl);
	const declaredUrlIdentities = [
		$('link[rel="canonical"]').first().attr('href') ?? '',
		$('meta[property="og:url"]').first().attr('content') ?? '',
		$('meta[name="citation_public_url"]').first().attr('content') ?? '',
	].filter(candidate => cleanText(candidate));

	const requestedDoi = extractUrlDoiIdentity(document.requestedUrl);
	const declaredDoiIdentities = [
		...declaredUrlIdentities.map(extractUrlDoiIdentity),
		extractDoiIdentity($('meta[name="citation_doi"]').first().attr('content') ?? ''),
		extractDoiIdentity($('meta[name="dc.identifier"]').first().attr('content') ?? ''),
	].filter(Boolean);
	if (
		requestedDoi &&
		declaredDoiIdentities.length > 0 &&
		declaredDoiIdentities.some(identity => identity !== requestedDoi)
	) {
		return false;
	}
	if (declaredUrlIdentities.length > 0 || declaredDoiIdentities.length > 0) {
		return declaredUrlIdentities.some(
			candidate => normalizeComparableUrl(candidate) === requestedComparable,
		) || Boolean(
			requestedDoi && declaredDoiIdentities.some(identity => identity === requestedDoi),
		);
	}

	return Boolean(
		requestedComparable &&
		normalizeComparableUrl(document.finalUrl) === requestedComparable,
	);
}

function hasTitleEvidence(
	$: ReturnType<typeof load>,
	publisherId: ArticlePublisherId,
	structuredArticles: ReturnType<typeof collectStructuredArticleRecords>,
) {
	const citationTitle = cleanText($('meta[name="citation_title"]').first().attr('content'));
	const publisherTitle = cleanText($(ARTICLE_TITLE_SELECTORS[publisherId]).first().text());
	const structuredTitle = structuredArticles.some(item =>
		Boolean(cleanText(item.headline) || cleanText(item.name)),
	);
	return Boolean(citationTitle || publisherTitle || structuredTitle);
}

function hasAbstractEvidence(
	$: ReturnType<typeof load>,
	structuredArticles: ReturnType<typeof collectStructuredArticleRecords>,
) {
	const abstractText = cleanText(
		$('meta[name="citation_abstract"], meta[name="dc.description.abstract"], meta[name="prism.abstract"]')
			.first()
			.attr('content'),
	) || cleanText(
		$('[itemprop="abstract"], [data-test="article-abstract"], section[aria-labelledby*="abs" i], #Abs1-content, .abstract')
			.first()
			.text(),
	);
	if (abstractText.length >= 20) {
		return true;
	}

	return structuredArticles.some(item => cleanText(item.abstract).length >= 20);
}

function hasBodyEvidence(
	$: ReturnType<typeof load>,
	publisherId: ArticlePublisherId,
) {
	return extractArticleBodyText($, publisherId).length >= 120;
}

export function buildArticlePageProof(
	document: FetchTargetDocument,
	article: Article,
): ArticlePageProof {
	const $ = load(document.html);
	const publisherId = resolvePublisherProfile(document.requestedUrl).id;
	const structuredArticles = collectStructuredArticleRecords(extractStructuredDataItems($));
	const titleFound = hasTitleEvidence($, publisherId, structuredArticles);
	const authorsFound = article.authors.length > 0;
	const abstractFound = hasAbstractEvidence($, structuredArticles);
	const bodyFound = hasBodyEvidence($, publisherId);
	const accessGate = detectAccessGate(document, {
		bodyFound,
	});

	return {
		canonicalUrlMatched: resolveCanonicalUrlMatched($, document),
		titleFound,
		authorsFound,
		abstractFound,
		bodyFound,
		accessGate,
	};
}

export function isArticlePageProofSatisfied(
	proof: ArticlePageProof,
	requireBody: boolean = false,
) {
	return proof.accessGate === null &&
		proof.canonicalUrlMatched &&
		proof.titleFound &&
		(proof.abstractFound || proof.bodyFound) &&
		(!requireBody || proof.bodyFound);
}
