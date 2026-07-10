/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'cheerio';

import { URI } from 'cs/base/common/uri';
import type { FetchArticle, FetchArticleCandidate } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleProof } from 'cs/base/parts/sandbox/common/fetchArticleProof';
import type { FetchArticleDetailFetchResult } from 'cs/workbench/services/fetch/common/fetchArticleDetailResult';
import { normalizeFetchDoi } from 'cs/workbench/services/fetch/common/fetchDoi';
import {
	FetchErrorCode,
	fetchError,
	getFetchErrorCode,
	getFetchErrorDetails,
} from 'cs/workbench/services/fetch/common/fetchErrors';
import { detectAccessGate } from 'cs/workbench/services/fetch/electron-main/accessGateDetector';
import { buildFetchArticleProof, isFetchArticleProofSatisfied } from 'cs/workbench/services/fetch/electron-main/fetchArticleProof';
import type { FetchPageSession, FetchPageSnapshot } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import type { FetchPageSnapshotAdmission } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import { resolveFetchArticleDetailParser } from 'cs/workbench/services/fetch/electron-main/fetchParserResolver';
import { resolveFetchSite } from 'cs/workbench/services/fetch/electron-main/fetchSiteResolver';
import { fetchSiteProviders } from 'cs/workbench/services/fetch/electron-main/fetchSitesProvider';
import type { FetchArticleDraft, FetchSiteProvider } from 'cs/workbench/services/fetch/electron-main/sites/types';

export interface FetchArticleDetailRequest {
	readonly sourceUri: URI;
	readonly candidate?: FetchArticleCandidate;
	readonly pageSession: FetchPageSession;
	readonly backgroundTimeoutMs: number;
	readonly browserEditorTimeoutMs: number;
	readonly fetchOrder?: number;
	readonly signal?: AbortSignal;
}

export interface IFetchArticleDetailService {
	fetchArticleDetail(request: FetchArticleDetailRequest): Promise<FetchArticleDetailFetchResult>;
}

interface ParsedArticleSnapshot {
	readonly draft: FetchArticleDraft;
	readonly parserId: string;
	readonly parserEvidence: ReturnType<typeof resolveFetchArticleDetailParser>['proof']['evidence'];
}

export interface ParseFetchArticleSnapshotOptions {
	readonly candidate?: FetchArticleCandidate;
	readonly fetchOrder?: number;
	readonly sites?: readonly FetchSiteProvider[];
}

function parseSnapshot(
	site: FetchSiteProvider,
	snapshot: FetchPageSnapshot,
	sites: readonly FetchSiteProvider[],
): ParsedArticleSnapshot {
	if (!site.matchUri(snapshot.finalUri)) {
		throw fetchError(FetchErrorCode.ArticlePageRejected, {
			reason: 'articleDetailSiteMismatch',
			siteId: site.id,
			requestedUri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
		});
	}
	const finalSite = resolveFetchSite(sites, snapshot.finalUri);
	if (finalSite.id !== site.id) {
		throw fetchError(FetchErrorCode.ArticlePageRejected, {
			reason: 'articleDetailSiteMismatch',
			siteId: site.id,
			finalSiteId: finalSite.id,
			requestedUri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
		});
	}
	const requestedIdentity = site.resolveArticleIdentity?.(snapshot.requestedUri);
	const finalIdentity = site.resolveArticleIdentity?.(snapshot.finalUri);
	if (requestedIdentity && !finalIdentity) {
		throw fetchError(FetchErrorCode.ArticlePageRejected, {
			reason: 'articleIdentityLostAfterNavigation',
			siteId: site.id,
			requestedUri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
			requestedIdentity,
		});
	}
	if (
		requestedIdentity &&
		finalIdentity &&
		(
			requestedIdentity.articleId !== finalIdentity.articleId ||
			requestedIdentity.pageFamilyHint !== finalIdentity.pageFamilyHint
		)
	) {
		throw fetchError(FetchErrorCode.MetadataConflict, {
			field: 'articleIdentity',
			requestedIdentity,
			finalIdentity,
		});
	}
	const identity = finalIdentity;
	const context = {
		sourceUri: snapshot.requestedUri,
		finalUri: snapshot.finalUri,
		$: load(snapshot.html),
		identity,
	};
	const resolved = resolveFetchArticleDetailParser(site, context);
	return {
		draft: resolved.parser.parse(context, resolved.proof),
		parserId: resolved.parser.id,
		parserEvidence: resolved.proof.evidence,
	};
}

function createArticleStabilityKey(result: FetchArticleDetailFetchResult): string {
	const { fetchedAt: _fetchedAt, ...article } = result.article;
	return JSON.stringify({ article, proof: result.proof });
}

function hasFailedHttpStatus(snapshot: FetchPageSnapshot): boolean {
	return snapshot.statusCode !== null && (
		snapshot.statusCode < 200 || snapshot.statusCode >= 300
	);
}

function createAccessGateArticleRejection(
	snapshot: FetchPageSnapshot,
	accessGate: FetchArticleProof['accessGate'],
) {
	const proof: FetchArticleProof = {
		canonicalUriMatched: false,
		titleFound: false,
		authorsFound: false,
		abstractFound: false,
		bodyFound: false,
		publicationFound: false,
		articleKindFound: false,
		accessGate,
	};
	return fetchError(FetchErrorCode.ArticlePageRejected, {
		uri: snapshot.requestedUri.toString(true),
		finalUri: snapshot.finalUri.toString(true),
		reason: 'accessGate',
		proof,
	});
}

function evaluateArticleSnapshotAdmission(
	snapshot: FetchPageSnapshot,
	options: ParseFetchArticleSnapshotOptions,
): FetchPageSnapshotAdmission {
	if (snapshot.documentReadyState !== 'complete' || snapshot.html.length === 0) {
		return { ready: false };
	}
	if (hasFailedHttpStatus(snapshot)) {
		const accessGate = detectAccessGate(snapshot, { bodyFound: false });
		if (accessGate) {
			const rejection = createAccessGateArticleRejection(snapshot, accessGate);
			if (snapshot.presentation === 'background') throw rejection;
			return { ready: false, rejection };
		}
		throw fetchError(FetchErrorCode.HttpRequestFailed, {
			status: snapshot.statusCode,
			uri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
		});
	}
	try {
		const result = parseFetchArticleSnapshot(snapshot, options);
		return { ready: true, stabilityKey: createArticleStabilityKey(result) };
	} catch (error) {
		const code = getFetchErrorCode(error);
		if (
			code === FetchErrorCode.UnsupportedArticleDetailStructure ||
			code === FetchErrorCode.ArticlePageRejected ||
			code === FetchErrorCode.UnsupportedSite
		) {
			let rejection = error;
			let proof = getFetchErrorDetails(error)?.proof as FetchArticleProof | undefined;
			if (!proof) {
				const accessGate = detectAccessGate(snapshot, { bodyFound: false });
				if (accessGate) {
					rejection = createAccessGateArticleRejection(snapshot, accessGate);
					proof = getFetchErrorDetails(rejection)?.proof as FetchArticleProof;
				}
			}
			if (snapshot.presentation === 'background' && proof?.accessGate) {
				throw rejection;
			}
			return { ready: false, rejection };
		}
		throw error;
	}
}

function reconcileCandidateDoi(
	draft: FetchArticleDraft,
	candidate: FetchArticleCandidate | undefined,
): void {
	const candidateDoi = normalizeFetchDoi(candidate?.doiHint);
	if (!candidateDoi || !draft.doi) return;
	if (candidateDoi !== normalizeFetchDoi(draft.doi)) {
		throw fetchError(FetchErrorCode.MetadataConflict, {
			field: 'doi',
			candidateDoi,
			articleDoi: draft.doi,
		});
	}
}

function finalizeArticle(
	draft: FetchArticleDraft,
	request: Pick<FetchArticleDetailRequest, 'candidate' | 'fetchOrder'>,
): FetchArticle {
	if (!draft.title || !draft.publication || !draft.articleKind) {
		throw fetchError(FetchErrorCode.ArticlePageRejected, {
			reason: 'incompleteArticleModel',
		});
	}
	return {
		sourceUri: draft.sourceUri.toJSON(),
		canonicalUri: draft.canonicalUri?.toJSON(),
		publisherArticleId: draft.publisherArticleId,
		doi: draft.doi,
		title: draft.title,
		publication: draft.publication,
		articleKind: draft.articleKind,
		sourceArticleType: draft.sourceArticleType,
		authors: draft.authors,
		abstract: draft.abstract,
		sections: draft.sections,
		figures: draft.figures,
		references: draft.references,
		publishedAt: draft.publishedAt,
		receivedAt: draft.receivedAt,
		acceptedAt: draft.acceptedAt,
		fetchedAt: new Date().toISOString(),
		fetchOrder: request.fetchOrder ?? 1,
		articleListSourceId: request.candidate?.articleListSourceId,
	};
}

export class FetchArticleDetailService implements IFetchArticleDetailService {
	constructor(
		private readonly sites: readonly FetchSiteProvider[] = fetchSiteProviders,
	) {}

	async fetchArticleDetail(
		request: FetchArticleDetailRequest,
	): Promise<FetchArticleDetailFetchResult> {
		const site = resolveFetchSite(this.sites, request.sourceUri);
		const timeoutMs = request.pageSession.presentation === 'browserEditor'
			? request.browserEditorTimeoutMs
			: request.backgroundTimeoutMs;
		const snapshot = await request.pageSession.load(request.sourceUri, {
			timeoutMs,
			settleMs: site.acquisitionPolicy.settleMs,
			signal: request.signal,
			admitSnapshot: candidate => evaluateArticleSnapshotAdmission(candidate, {
				candidate: request.candidate,
				fetchOrder: request.fetchOrder,
				sites: this.sites,
			}),
		});
		return parseFetchArticleSnapshot(snapshot, {
			candidate: request.candidate,
			fetchOrder: request.fetchOrder,
			sites: this.sites,
		});
	}
}

export function parseFetchArticleSnapshot(
	snapshot: FetchPageSnapshot,
	options: ParseFetchArticleSnapshotOptions = {},
): FetchArticleDetailFetchResult {
	if (hasFailedHttpStatus(snapshot)) {
		throw fetchError(FetchErrorCode.HttpRequestFailed, {
			status: snapshot.statusCode,
			uri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
		});
	}
	const site = resolveFetchSite(options.sites ?? fetchSiteProviders, snapshot.requestedUri);
	const parsed = parseSnapshot(site, snapshot, options.sites ?? fetchSiteProviders);
	reconcileCandidateDoi(parsed.draft, options.candidate);
	const proof = buildFetchArticleProof(snapshot, parsed.draft, site);
	if (!isFetchArticleProofSatisfied(proof, parsed.draft)) {
		throw fetchError(FetchErrorCode.ArticlePageRejected, {
			uri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
			presentation: snapshot.presentation,
			statusCode: snapshot.statusCode,
			siteId: site.id,
			parserId: parsed.parserId,
			proof,
		});
	}
	return {
		article: finalizeArticle(parsed.draft, {
			candidate: options.candidate,
			fetchOrder: options.fetchOrder,
		}),
		proof,
		diagnostics: {
			siteId: site.id,
			parserId: parsed.parserId,
			parserEvidence: parsed.parserEvidence,
			doiSource: parsed.draft.doiSource,
			classificationEvidence: parsed.draft.classificationEvidence,
		},
	};
}
