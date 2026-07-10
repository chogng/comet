/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { load } from 'cheerio';

import type {
	Article,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { isWithinDateRange } from 'cs/base/common/date';
import type { DateRange } from 'cs/base/common/date';

import { detectAccessGate } from 'cs/workbench/services/fetch/electron-main/accessGateDetector';
import { ArticleFetchService } from 'cs/workbench/services/fetch/electron-main/articleFetchService';
import { applyCandidateArticleType } from 'cs/workbench/services/fetch/electron-main/merge';
import { planCandidateFetch } from 'cs/workbench/services/fetch/electron-main/listing/planning';
import type { FetchTargetSession } from 'cs/workbench/services/fetch/electron-main/fetchTargetProvider';
import type { FetchTargetDocument } from 'cs/workbench/services/fetch/electron-main/fetchTargetService';
import type { ListingCandidateExtractor } from 'cs/workbench/services/fetch/electron-main/sourceExtractors';
import type {
	CandidateCollectionResult,
	FetchStatusUpdate,
	PageFetchResult,
} from 'cs/workbench/services/fetch/electron-main/sourcePageFetchTypes';
import { FetchErrorCode, fetchError, getFetchErrorCode, getFetchErrorDetails } from 'cs/workbench/services/fetch/common/fetchErrors';

function createTargetReadyStatus(
	targetSession: FetchTargetSession,
	articleProof: FetchStatusUpdate['articleProof'],
	options: {
		readonly paginationStopped?: boolean;
		readonly paginationStopReason?: string | null;
	} = {},
): FetchStatusUpdate {
	if (targetSession.targetMode === 'webContentsView' && targetSession.targetId) {
		return {
			phase: 'targetReady',
			targetMode: 'webContentsView',
			targetId: targetSession.targetId,
			articleProof,
			...options,
		};
	}

	return {
		phase: 'loading',
		targetMode: 'background',
		targetId: targetSession.targetId,
		articleProof,
		...options,
	};
}

function hasSynchronousListingCandidates(
	html: string,
	page: URL,
	pageUrl: string,
	extractor: ListingCandidateExtractor | null,
) {
	const $ = load(html);
	if (extractor) {
		try {
			return Boolean(extractor.extract({ page, pageUrl, $ })?.candidates.length);
		} catch {
			return false;
		}
	}

	return $('a[href*="/article" i], a[href*="/articles/" i], a[href*="/doi/" i], a[href*="/paper" i]').length > 0;
}

function normalizeListingUrl(value: string) {
	try {
		const url = new URL(value);
		url.hash = '';
		url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
		url.pathname = url.pathname.replace(/\/+$/, '') || '/';
		return url.toString();
	} catch {
		return '';
	}
}

function hasScienceCurrentListingIdentity(requestedUrl: URL, candidateUrl: URL) {
	const requestedMatch = requestedUrl.pathname.match(/^\/toc\/(?<journal>science|sciadv)\/current\/?$/i);
	if (!requestedMatch?.groups?.journal) {
		return false;
	}
	return candidateUrl.pathname.toLowerCase().startsWith(
		`/toc/${requestedMatch.groups.journal.toLowerCase()}/`,
	);
}

function hasListingPageIdentity(
	document: FetchTargetDocument,
	requestedPageUrl: string,
) {
	const normalizedRequestedUrl = normalizeListingUrl(requestedPageUrl);
	if (
		normalizedRequestedUrl &&
		normalizeListingUrl(document.finalUrl) === normalizedRequestedUrl
	) {
		return true;
	}

	try {
		const requestedUrl = new URL(requestedPageUrl);
		const finalUrl = new URL(document.finalUrl);
		const requestedHost = requestedUrl.hostname.toLowerCase().replace(/^www\./, '');
		const finalHost = finalUrl.hostname.toLowerCase().replace(/^www\./, '');
		return requestedHost === finalHost && hasScienceCurrentListingIdentity(requestedUrl, finalUrl);
	} catch {
		return false;
	}
}

export async function fetchListing({
	sourceId,
	page,
	pageUrl,
	journalTitle,
	extractor,
	remainingLimit,
	dateRange,
	traceId,
	fetchedSourceUrls,
	seenPageUrls,
	pageNumber,
	targetSession,
	articleFetchService,
	collectListingCandidateDescriptors,
	timingLog,
	elapsedMs,
	shortenForLog,
	reportFetchStatus,
	candidatePlanConfig,
}: {
	sourceId: string;
	page: URL;
	pageUrl: string;
	journalTitle: string;
	extractor: ListingCandidateExtractor | null;
	remainingLimit: number;
	dateRange: DateRange;
	traceId: string;
	fetchedSourceUrls: Set<string>;
	seenPageUrls: ReadonlySet<string>;
	pageNumber: number;
	targetSession: FetchTargetSession;
	articleFetchService: ArticleFetchService;
	collectListingCandidateDescriptors: (
		page: URL,
		pageUrl: string,
		$: ReturnType<typeof load>,
		extractor: ListingCandidateExtractor | null,
		dateRange: DateRange,
		traceId: string,
		pageNumber: number,
	) => Promise<CandidateCollectionResult>;
	timingLog: (traceId: string, event: string, data?: Record<string, unknown>) => void;
	elapsedMs: (startedAt: number) => number;
	shortenForLog: (value: string) => string;
	reportFetchStatus: (status: FetchStatusUpdate) => void;
	candidatePlanConfig: {
		minCandidateAttempts: number;
		attemptsPerLimit: number;
		extractorAttemptsMultiplier: number;
		extractorAttemptsMinBuffer: number;
		fastExtractorAttemptsMultiplier: number;
		fastExtractorAttemptsMinBuffer: number;
		dateHintHighCoverageThreshold: number;
		extractorCandidateFetchConcurrency: number;
		candidateFetchConcurrency: number;
		retryPriorityMinOrder: number;
		retryPriorityLimitMultiplier: number;
		pageTimeoutMs: number;
		articleTimeoutMs: number;
		webContentsViewTimeoutMs: number;
	};
}): Promise<PageFetchResult> {
	const pageDocument = await targetSession.load(pageUrl, {
		timeoutMs: targetSession.targetMode === 'webContentsView'
			? candidatePlanConfig.webContentsViewTimeoutMs
			: candidatePlanConfig.pageTimeoutMs,
		admitDocument: document => {
			const hasCandidates = hasSynchronousListingCandidates(
				document.html,
				page,
				pageUrl,
				extractor,
			);
			return hasListingPageIdentity(document, pageUrl) && hasCandidates && detectAccessGate(
				document,
				{
					bodyFound: false,
					listingContentFound: hasCandidates,
				},
			) === null;
		},
	});
	reportFetchStatus(createTargetReadyStatus(targetSession, null));
	if (!hasListingPageIdentity(pageDocument, pageUrl)) {
		throw fetchError(FetchErrorCode.ListingPageRejected, {
			url: pageUrl,
			finalUrl: pageDocument.finalUrl,
			targetMode: targetSession.targetMode,
			reason: 'listingIdentityMismatch',
		});
	}

	const pageParseStartedAt = Date.now();
	const $ = load(pageDocument.html);
	const candidateCollection = await collectListingCandidateDescriptors(
		page,
		pageUrl,
		$,
		extractor,
		dateRange,
		traceId,
		pageNumber,
	);
	if (
		candidateCollection.candidates.length === 0 ||
		(extractor && candidateCollection.extractorId !== extractor.id)
	) {
		throw fetchError(FetchErrorCode.ListingPageRejected, {
			url: pageUrl,
			finalUrl: pageDocument.finalUrl,
			targetMode: targetSession.targetMode,
			extractorId: extractor?.id ?? null,
			reason: 'listingProofFailed',
		});
	}
	timingLog(traceId, 'source:page_parsed', {
		pageNumber,
		ms: elapsedMs(pageParseStartedAt),
		targetMode: targetSession.targetMode,
		candidateCount: candidateCollection.candidates.length,
	});

	const {
		candidates,
		linkCount,
		datedCandidateCount,
		inRangeDateHintCount,
		dateFilteredCount,
		stoppedByDateHint,
		sortedDateHintsObserved,
		consecutiveOlderDateHints,
		stopDateHint,
		extractorId,
		extractorDiagnostics,
		paginationStopEvaluation,
	} = candidateCollection;
	if (extractorId) {
		timingLog(traceId, 'source:candidate_extractor_selected', {
			pageNumber,
			extractorId,
			...extractorDiagnostics,
		});
	}
	if (stoppedByDateHint) {
		timingLog(traceId, 'source:candidate_date_early_stop', {
			pageNumber,
			stopDateHint,
			dateStart: dateRange.start,
			datedCandidateCount,
			consecutiveOlderDateHints,
		});
	}

	const stoppedByPaginationPolicy = Boolean(paginationStopEvaluation?.shouldStop);
	if (stoppedByPaginationPolicy) {
		reportFetchStatus(createTargetReadyStatus(targetSession, null, {
			paginationStopped: true,
			paginationStopReason: paginationStopEvaluation?.reason ?? 'extractor_policy',
		}));
	}

	const candidatePlan = planCandidateFetch(candidates, {
		extractorId,
		remainingLimit,
		datedCandidateCount,
		inRangeDateHintCount,
		hasDateRangeFilter: Boolean(dateRange.start || dateRange.end),
		minCandidateAttempts: candidatePlanConfig.minCandidateAttempts,
		attemptsPerLimit: candidatePlanConfig.attemptsPerLimit,
		extractorAttemptsMultiplier: candidatePlanConfig.extractorAttemptsMultiplier,
		extractorAttemptsMinBuffer: candidatePlanConfig.extractorAttemptsMinBuffer,
		fastExtractorAttemptsMultiplier: candidatePlanConfig.fastExtractorAttemptsMultiplier,
		fastExtractorAttemptsMinBuffer: candidatePlanConfig.fastExtractorAttemptsMinBuffer,
		dateHintHighCoverageThreshold: candidatePlanConfig.dateHintHighCoverageThreshold,
		extractorCandidateFetchConcurrency: candidatePlanConfig.extractorCandidateFetchConcurrency,
		candidateFetchConcurrency: candidatePlanConfig.candidateFetchConcurrency,
		retryPriorityMinOrder: candidatePlanConfig.retryPriorityMinOrder,
		retryPriorityLimitMultiplier: candidatePlanConfig.retryPriorityLimitMultiplier,
	});
	timingLog(traceId, 'source:candidates_ready', {
		pageNumber,
		linkCount,
		candidateCount: candidates.length,
		attemptBudget: candidatePlan.attemptBudget,
		datedCandidateCount,
		inRangeDateHintCount,
		dateFilteredCount,
		stoppedByDateHint,
		sortedDateHintsObserved,
	});

	const fetched: Article[] = [];
	const candidateFailures: Array<Record<string, unknown>> = [];
	let candidateAttempted = 0;
	let candidateResolved = 0;
	for (const [index, candidate] of candidatePlan.candidatesToFetch.entries()) {
		if (fetched.length >= remainingLimit) {
			break;
		}
		candidateAttempted += 1;
		const candidateOrder = index + 1;
		try {
			const parseStartedAt = Date.now();
			const result = await articleFetchService.fetch({
				pageUrl: candidate.url,
				targetSession,
				backgroundTimeoutMs: candidatePlanConfig.articleTimeoutMs,
				webContentsViewTimeoutMs: candidatePlanConfig.webContentsViewTimeoutMs,
			});
			applyCandidateArticleType(result.article, candidate.articleType);
			candidateResolved += 1;
			reportFetchStatus(createTargetReadyStatus(targetSession, result.proof));
			timingLog(traceId, 'candidate:parsed', {
				pageNumber,
				candidateOrder,
				ms: elapsedMs(parseStartedAt),
				url: shortenForLog(candidate.url),
				targetMode: targetSession.targetMode,
				hasTitle: result.proof.titleFound,
				hasAbstract: result.proof.abstractFound,
				hasBody: result.proof.bodyFound,
			});

			if (!isWithinDateRange(result.article.publishedAt, dateRange)) {
				continue;
			}
			if (fetchedSourceUrls.has(result.article.sourceUrl)) {
				continue;
			}
			result.article.sourceId = sourceId;
			if (journalTitle) {
				result.article.journalTitle = journalTitle;
			}
			fetchedSourceUrls.add(result.article.sourceUrl);
			fetched.push(result.article);
		} catch (error) {
			const errorCode = getFetchErrorCode(error);
			if (
				errorCode === FetchErrorCode.InteractiveTargetTimedOut ||
				errorCode === FetchErrorCode.InteractiveTargetClosed
			) {
				throw error;
			}
			candidateFailures.push({
				url: candidate.url,
				code: errorCode || 'UNKNOWN_ERROR',
				details: getFetchErrorDetails(error),
			});
			timingLog(traceId, 'candidate:failed', {
				pageNumber,
				candidateOrder,
				url: shortenForLog(candidate.url),
				code: errorCode || 'UNKNOWN_ERROR',
			});
		}
	}

	if (fetched.length === 0 && candidateFailures.length > 0) {
		throw fetchError(FetchErrorCode.ListingPageRejected, {
			url: pageUrl,
			targetMode: targetSession.targetMode,
			reason: 'articleProofFailed',
			candidateFailures,
		});
	}

	const nextPageUrl =
		fetched.length < remainingLimit && !stoppedByDateHint && !stoppedByPaginationPolicy
			? extractor?.findNextPageUrl?.({
				page,
				pageUrl,
				$,
				seenPageUrls,
			}) ?? null
			: null;

	return {
		targetMode: targetSession.targetMode,
		articles: fetched,
		candidateAttempted,
		candidateResolved,
		candidateAccepted: fetched.length,
		usedPageOnly: false,
		nextPageUrl,
		stoppedByDateHint: stoppedByDateHint || stoppedByPaginationPolicy,
	};
}
