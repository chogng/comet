/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { FetchArticleProof } from 'cs/base/parts/sandbox/common/fetchArticleProof';
import { detectAccessGate } from 'cs/workbench/services/fetch/electron-main/accessGateDetector';
import type { FetchPageSnapshot } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import type { FetchArticleDraft, FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

function normalizeComparableUri(value: string, site: FetchSiteProvider): string {
	try {
		const uri = new URL(value);
		const rawAuthority = uri.hostname.toLowerCase().replace(/^www\./, '');
		const authority = site.normalizeArticleAuthority?.(rawAuthority) ?? rawAuthority;
		const path = decodeURIComponent(uri.pathname)
			.replace(/^\/doi\/(?:abs|full|epdf|pdf)\//i, '/doi/')
			.replace(/\/+$/, '')
			.toLowerCase() || '/';
		return `${authority}${path}`;
	} catch {
		return '';
	}
}

function isCanonicalUriMatched(
	snapshot: FetchPageSnapshot,
	draft: FetchArticleDraft,
	site: FetchSiteProvider,
): boolean {
	const requested = normalizeComparableUri(snapshot.requestedUri.toString(true), site);
	if (draft.canonicalUri) {
		return normalizeComparableUri(draft.canonicalUri.toString(true), site) === requested;
	}
	return normalizeComparableUri(snapshot.finalUri.toString(true), site) === requested;
}

function getBodyText(draft: FetchArticleDraft): string {
	const text: string[] = [];
	const collect = (sections: FetchArticleDraft['sections']) => {
		for (const section of sections) {
			if (section.content) text.push(section.content);
			if (section.children) collect(section.children);
		}
	};
	collect(draft.sections);
	return text.join('\n\n');
}

function hasTitledSection(sections: FetchArticleDraft['sections']): boolean {
	return sections.some(section => Boolean(section.title) || (
		section.children ? hasTitledSection(section.children) : false
	));
}

export function buildFetchArticleProof(
	snapshot: FetchPageSnapshot,
	draft: FetchArticleDraft,
	site: FetchSiteProvider,
): FetchArticleProof {
	const bodyText = getBodyText(draft);
	const bodyFound = bodyText.length >= 120;
	return {
		canonicalUriMatched: isCanonicalUriMatched(snapshot, draft, site),
		titleFound: Boolean(draft.title?.trim()),
		authorsFound: draft.authors.length > 0,
		abstractFound: Boolean(draft.abstract && draft.abstract.trim().length >= 20),
		bodyFound,
		publicationFound: Boolean(
			draft.publication?.id.trim() &&
			draft.publication.title.trim() &&
			draft.publication.publisherId.trim() &&
			draft.publication.publisherTitle.trim(),
		),
		articleKindFound: draft.articleKind !== undefined,
		accessGate: detectAccessGate(snapshot, { bodyFound }),
	};
}

export function isFetchArticleProofSatisfied(
	proof: FetchArticleProof,
	draft: FetchArticleDraft,
): boolean {
	if (
		proof.accessGate !== null ||
		!proof.canonicalUriMatched ||
		!proof.titleFound ||
		!proof.bodyFound ||
		!proof.publicationFound ||
		!proof.articleKindFound
	) {
		return false;
	}
	if (draft.articleKind === 'researchArticle') {
		return proof.abstractFound || hasTitledSection(draft.sections);
	}
	if (draft.articleKind === 'protocol') {
		return /\b(?:procedure|materials?|methods?)\b/i.test(getBodyText(draft));
	}
	if (draft.articleKind === 'correction') {
		return draft.references.length > 0 || /\b(?:corrects?|correction|original article)\b/i.test(getBodyText(draft));
	}
	return true;
}
