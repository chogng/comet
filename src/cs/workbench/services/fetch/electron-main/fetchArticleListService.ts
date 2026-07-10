/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'cheerio';

import { isWithinDateRange } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { getFetchArticleSourceUrl } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleProof } from 'cs/base/parts/sandbox/common/fetchArticleProof';
import type { FetchArticleListRunResult } from 'cs/workbench/services/fetch/common/fetchArticleListResult';
import { FetchErrorCode, fetchError, getFetchErrorCode, getFetchErrorDetails } from 'cs/workbench/services/fetch/common/fetchErrors';
import { detectAccessGate } from 'cs/workbench/services/fetch/electron-main/accessGateDetector';
import type { IFetchArticleDetailService } from 'cs/workbench/services/fetch/electron-main/fetchArticleDetailService';
import type {
	FetchPageSession,
	FetchPageSnapshot,
	FetchPageSnapshotAdmission,
} from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import { resolveFetchArticleListParser, resolveFetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/fetchParserResolver';
import { resolveFetchSite } from 'cs/workbench/services/fetch/electron-main/fetchSiteResolver';
import { fetchSiteProviders } from 'cs/workbench/services/fetch/electron-main/fetchSitesProvider';
import type {
	FetchArticleListSource,
	FetchSiteProvider,
} from 'cs/workbench/services/fetch/electron-main/sites/types';

export interface FetchArticleListRequest {
	readonly listUri: URI;
	readonly pageNumber: number;
	readonly remainingLimit: number;
	readonly dateRange: DateRange;
	readonly seenPageUris: ReadonlySet<string>;
	readonly seenArticleUris: ReadonlySet<string>;
	readonly pageSession: FetchPageSession;
	readonly articleDetailService: IFetchArticleDetailService;
	readonly pageTimeoutMs: number;
	readonly articleTimeoutMs: number;
	readonly browserEditorTimeoutMs: number;
	readonly traceId: string;
	readonly signal?: AbortSignal;
	readonly fetchText: (
		uri: URI,
		options: { readonly timeoutMs: number; readonly stage: string; readonly signal?: AbortSignal },
	) => Promise<string>;
	readonly onArticleProof?: (proof: FetchArticleProof) => void;
}

export interface IFetchArticleListService {
	fetchFromArticleList(request: FetchArticleListRequest): Promise<FetchArticleListRunResult>;
}

function parseArticleListSnapshot(
	site: FetchSiteProvider,
	source: FetchArticleListSource,
	snapshot: FetchPageSnapshot,
) {
	if (snapshot.statusCode !== null && (snapshot.statusCode < 200 || snapshot.statusCode >= 300)) {
		throw fetchError(FetchErrorCode.HttpRequestFailed, {
			status: snapshot.statusCode,
			requestedUri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
		});
	}
	if (!source.matchLoadedUri(snapshot.requestedUri, snapshot.finalUri)) {
		throw fetchError(FetchErrorCode.ArticleListPageRejected, {
			requestedUri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
			siteId: site.id,
			sourceId: source.id,
			reason: 'articleListIdentityMismatch',
		});
	}
	const context = {
		sourceUri: snapshot.finalUri,
		articleListSourceId: source.id,
		$: load(snapshot.html),
	};
	const resolvedParser = resolveFetchArticleListParser(site, source, context);
	const parsed = resolvedParser.parser.parse(context, resolvedParser.proof);
	if (parsed.candidates.length === 0) {
		throw fetchError(FetchErrorCode.UnsupportedArticleListStructure, {
			siteId: site.id,
			sourceId: source.id,
			parserId: resolvedParser.parser.id,
			uri: snapshot.requestedUri.toString(true),
			reason: 'parserProducedNoCandidates',
		});
	}
	return { context, resolvedParser, parsed };
}

function evaluateArticleListSnapshotAdmission(
	site: FetchSiteProvider,
	source: FetchArticleListSource,
	snapshot: FetchPageSnapshot,
): FetchPageSnapshotAdmission {
	if (snapshot.documentReadyState !== 'complete' || snapshot.html.length === 0) {
		return { ready: false };
	}
	if (snapshot.statusCode !== null && (snapshot.statusCode < 200 || snapshot.statusCode >= 300)) {
		const accessGate = detectAccessGate(snapshot, {
			bodyFound: false,
			articleListContentFound: false,
		});
		if (accessGate) {
			const rejection = fetchError(FetchErrorCode.ArticleListPageRejected, {
				requestedUri: snapshot.requestedUri.toString(true),
				finalUri: snapshot.finalUri.toString(true),
				siteId: site.id,
				sourceId: source.id,
				reason: 'accessGate',
				accessGate,
			});
			if (snapshot.presentation === 'background') throw rejection;
			return { ready: false, rejection };
		}
		throw fetchError(FetchErrorCode.HttpRequestFailed, {
			status: snapshot.statusCode,
			requestedUri: snapshot.requestedUri.toString(true),
			finalUri: snapshot.finalUri.toString(true),
		});
	}
	try {
		const result = parseArticleListSnapshot(site, source, snapshot);
		const accessGate = detectAccessGate(snapshot, {
			bodyFound: false,
			articleListContentFound: true,
		});
		if (accessGate) {
			const rejection = fetchError(FetchErrorCode.ArticleListPageRejected, {
				requestedUri: snapshot.requestedUri.toString(true),
				finalUri: snapshot.finalUri.toString(true),
				siteId: site.id,
				sourceId: source.id,
				reason: 'accessGate',
				accessGate,
			});
			if (snapshot.presentation === 'background') {
				throw rejection;
			}
			return { ready: false, rejection };
		}
		return {
			ready: true,
			stabilityKey: JSON.stringify(result.parsed.candidates),
		};
	} catch (error) {
		const code = getFetchErrorCode(error);
		if (
			code === FetchErrorCode.UnsupportedArticleListStructure ||
			code === FetchErrorCode.ArticleListPageRejected
		) {
			const accessGate = detectAccessGate(snapshot, {
				bodyFound: false,
				articleListContentFound: false,
			});
			const rejection = accessGate ? fetchError(FetchErrorCode.ArticleListPageRejected, {
				requestedUri: snapshot.requestedUri.toString(true),
				finalUri: snapshot.finalUri.toString(true),
				siteId: site.id,
				sourceId: source.id,
				reason: 'accessGate',
				accessGate,
			}) : error;
			if (snapshot.presentation === 'background' && accessGate) {
				throw rejection;
			}
			return { ready: false, rejection };
		}
		throw error;
	}
}

export class FetchArticleListService implements IFetchArticleListService {
	constructor(
		private readonly sites: readonly FetchSiteProvider[] = fetchSiteProviders,
	) {}

	async fetchFromArticleList(request: FetchArticleListRequest): Promise<FetchArticleListRunResult> {
		const site = resolveFetchSite(this.sites, request.listUri);
		const source = resolveFetchArticleListSource(site, request.listUri);
		const timeoutMs = request.pageSession.presentation === 'browserEditor'
			? request.browserEditorTimeoutMs
			: request.pageTimeoutMs;
		const snapshot = await request.pageSession.load(request.listUri, {
			timeoutMs,
			settleMs: site.acquisitionPolicy.settleMs,
			signal: request.signal,
			admitSnapshot: candidate => evaluateArticleListSnapshotAdmission(site, source, candidate),
		});
		const { context, resolvedParser, parsed } = parseArticleListSnapshot(site, source, snapshot);
		if (request.signal?.aborted) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'ABORTED',
				uri: request.listUri.toString(true),
			});
		}
		const candidates = source.enrichment
			? await source.enrichment.enrich({
				sourceUri: snapshot.finalUri,
				pageNumber: request.pageNumber,
				traceId: request.traceId,
				candidates: parsed.candidates,
				signal: request.signal,
				fetchText: (uri, options) => request.fetchText(uri, {
					...options,
					signal: request.signal,
				}),
			})
			: parsed.candidates;
		if (request.signal?.aborted) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'ABORTED',
				uri: request.listUri.toString(true),
			});
		}
		const paginationStop = source.pagination.kind === 'nextLink'
			? source.pagination.evaluateStop?.({
				sourceUri: snapshot.finalUri,
				pageNumber: request.pageNumber,
				dateRange: request.dateRange,
				candidates,
			})
			: undefined;

		const articles: FetchArticle[] = [];
		const seenArticleUrls = new Set(request.seenArticleUris);
		const candidateFailures: Record<string, unknown>[] = [];
		let candidateAttempted = 0;
		let candidateResolved = 0;
		for (const candidate of candidates) {
			if (articles.length >= request.remainingLimit) break;
			const candidateUri = URI.revive(candidate.sourceUri);
			if (seenArticleUrls.has(candidateUri.toString(true))) continue;
			candidateAttempted += 1;
			try {
				const result = await request.articleDetailService.fetchArticleDetail({
					sourceUri: candidateUri,
					candidate,
					pageSession: request.pageSession,
					backgroundTimeoutMs: request.articleTimeoutMs,
					browserEditorTimeoutMs: request.browserEditorTimeoutMs,
					fetchOrder: articles.length + 1,
					signal: request.signal,
				});
				candidateResolved += 1;
				request.onArticleProof?.(result.proof);
				if (!isWithinDateRange(result.article.publishedAt, request.dateRange)) continue;
				const articleUrl = getFetchArticleSourceUrl(result.article);
				if (seenArticleUrls.has(articleUrl)) continue;
				seenArticleUrls.add(articleUrl);
				articles.push(result.article);
			} catch (error) {
				const errorDetails = getFetchErrorDetails(error);
				if (
					getFetchErrorCode(error) === FetchErrorCode.InteractiveTargetTimedOut ||
					getFetchErrorCode(error) === FetchErrorCode.InteractiveTargetClosed ||
					request.signal?.aborted ||
					errorDetails?.status === 'ABORTED' ||
					(error instanceof DOMException && error.name === 'AbortError')
				) {
					throw error;
				}
				candidateFailures.push({
					uri: candidateUri.toString(true),
					code: getFetchErrorCode(error) || FetchErrorCode.UnknownError,
					details: getFetchErrorDetails(error),
				});
			}
		}
		if (candidateResolved === 0 && candidateFailures.length > 0) {
			throw fetchError(FetchErrorCode.ArticleListPageRejected, {
				uri: request.listUri.toString(true),
				siteId: site.id,
				sourceId: source.id,
				parserId: resolvedParser.parser.id,
				reason: 'articleProofFailed',
				candidateFailures,
			});
		}

		const nextPageUri =
			articles.length < request.remainingLimit &&
			!paginationStop?.shouldStop &&
			source.pagination.kind === 'nextLink'
				? source.pagination.findNextPageUri({
					...context,
					seenPageUris: request.seenPageUris,
				})
				: undefined;
		return {
			articles,
			candidateAttempted,
			candidateResolved,
			candidateAccepted: articles.length,
			nextPageUri: nextPageUri?.toJSON(),
			paginationStop: paginationStop?.shouldStop ? {
				reason: paginationStop.reason ?? 'articleListSourcePolicy',
				diagnostics: paginationStop.diagnostics,
			} : undefined,
			diagnostics: {
				siteId: site.id,
				sourceId: source.id,
				parserId: resolvedParser.parser.id,
				parserEvidence: resolvedParser.proof.evidence,
				details: {
					...parsed.diagnostics,
					...(candidateFailures.length > 0 ? { candidateFailures } : {}),
				},
			},
		};
	}
}
