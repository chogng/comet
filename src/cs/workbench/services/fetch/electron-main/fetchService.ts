/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DateRange } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { getFetchArticleSourceUrl } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticle, FetchArticleCandidate } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleProof } from 'cs/base/parts/sandbox/common/fetchArticleProof';
import type { FetchArticleDetailFetchResult } from 'cs/workbench/services/fetch/common/fetchArticleDetailResult';
import type { FetchArticleListRunResult } from 'cs/workbench/services/fetch/common/fetchArticleListResult';
import { FetchArticleDetailService } from 'cs/workbench/services/fetch/electron-main/fetchArticleDetailService';
import type { IFetchArticleDetailService } from 'cs/workbench/services/fetch/electron-main/fetchArticleDetailService';
import { FetchArticleListService } from 'cs/workbench/services/fetch/electron-main/fetchArticleListService';
import type { IFetchArticleListService } from 'cs/workbench/services/fetch/electron-main/fetchArticleListService';
import type { FetchPagePresentation } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import { FetchPageSessionService } from 'cs/workbench/services/fetch/electron-main/fetchPageSessionService';

const maxPaginatedPageCount = 20;

export interface FetchServiceArticleDetailRequest {
	readonly sourceUri: URI;
	readonly candidate?: FetchArticleCandidate;
	readonly presentation: FetchPagePresentation;
	readonly backgroundTimeoutMs: number;
	readonly browserEditorTimeoutMs: number;
	readonly signal?: AbortSignal;
	readonly onBrowserEditorRequired: Parameters<FetchPageSessionService['createSession']>[1]['onBrowserEditorRequired'];
}

export interface FetchServiceArticleListRequest {
	readonly listUri: URI;
	readonly remainingLimit: number;
	readonly dateRange: DateRange;
	readonly presentation: FetchPagePresentation;
	readonly pageTimeoutMs: number;
	readonly articleTimeoutMs: number;
	readonly browserEditorTimeoutMs: number;
	readonly traceId: string;
	readonly signal?: AbortSignal;
	readonly fetchText: Parameters<FetchArticleListService['fetchFromArticleList']>[0]['fetchText'];
	readonly onBrowserEditorRequired: Parameters<FetchPageSessionService['createSession']>[1]['onBrowserEditorRequired'];
	readonly onPageStart?: (uri: URI, pageNumber: number) => void;
	readonly onArticleProof?: (proof: FetchArticleProof) => void;
}

export class FetchService {
	constructor(
		private readonly pageSessionService: FetchPageSessionService,
		private readonly articleDetailService: IFetchArticleDetailService = new FetchArticleDetailService(),
		private readonly articleListService: IFetchArticleListService = new FetchArticleListService(),
	) {}

	async fetchArticleDetail(
		request: FetchServiceArticleDetailRequest,
	): Promise<FetchArticleDetailFetchResult> {
		const pageSession = this.pageSessionService.createSession(
			{ presentation: request.presentation },
			{ onBrowserEditorRequired: request.onBrowserEditorRequired },
		);
		try {
			return await this.articleDetailService.fetchArticleDetail({
				sourceUri: request.sourceUri,
				candidate: request.candidate,
				pageSession,
				backgroundTimeoutMs: request.backgroundTimeoutMs,
				browserEditorTimeoutMs: request.browserEditorTimeoutMs,
				signal: request.signal,
			});
		} finally {
			await pageSession.dispose();
		}
	}

	async fetchFromArticleList(
		request: FetchServiceArticleListRequest,
	): Promise<FetchArticleListRunResult> {
		const pageSession = this.pageSessionService.createSession(
			{ presentation: request.presentation },
			{ onBrowserEditorRequired: request.onBrowserEditorRequired },
		);
		try {
			const articles: FetchArticle[] = [];
			const articleUrls = new Set<string>();
			const seenPageUris = new Set<string>();
			let currentUri: URI | undefined = request.listUri;
			let pageNumber = 0;
			let candidateAttempted = 0;
			let candidateResolved = 0;
			let lastResult: FetchArticleListRunResult | undefined;
			const pageDiagnostics: FetchArticleListRunResult['diagnostics'][] = [];
			let orchestrationStop: FetchArticleListRunResult['paginationStop'];
			while (
				currentUri &&
				articles.length < request.remainingLimit &&
				pageNumber < maxPaginatedPageCount
			) {
				const pageKey = currentUri.toString(true);
				if (seenPageUris.has(pageKey)) {
					orchestrationStop = {
						reason: 'articleListPageCycleDetected',
						diagnostics: { pageUri: pageKey },
					};
					break;
				}
				seenPageUris.add(pageKey);
				pageNumber += 1;
				request.onPageStart?.(currentUri, pageNumber);
				lastResult = await this.articleListService.fetchFromArticleList({
					listUri: currentUri,
					pageNumber,
					remainingLimit: request.remainingLimit - articles.length,
					dateRange: request.dateRange,
					seenPageUris,
					seenArticleUris: articleUrls,
					pageSession,
					articleDetailService: this.articleDetailService,
					pageTimeoutMs: request.pageTimeoutMs,
					articleTimeoutMs: request.articleTimeoutMs,
					browserEditorTimeoutMs: request.browserEditorTimeoutMs,
					traceId: request.traceId,
					signal: request.signal,
					fetchText: request.fetchText,
					onArticleProof: request.onArticleProof,
				});
				candidateAttempted += lastResult.candidateAttempted;
				candidateResolved += lastResult.candidateResolved;
				pageDiagnostics.push(lastResult.diagnostics);
				for (const article of lastResult.articles) {
					const url = getFetchArticleSourceUrl(article);
					if (articleUrls.has(url)) continue;
					articleUrls.add(url);
					articles.push(article);
				}
				currentUri = lastResult.nextPageUri
					? URI.revive(lastResult.nextPageUri)
					: undefined;
			}
			if (
				currentUri &&
				articles.length < request.remainingLimit &&
				pageNumber >= maxPaginatedPageCount
			) {
				orchestrationStop = {
					reason: 'articleListMaxPageCountReached',
					diagnostics: {
						maxPageCount: maxPaginatedPageCount,
						remainingPageUri: currentUri.toString(true),
					},
				};
			}
			if (!lastResult) {
				throw new Error('Fetch article-list service completed without loading a page.');
			}
			return {
				articles: articles.map((article, index) => ({
					...article,
					fetchOrder: index + 1,
				})),
				candidateAttempted,
				candidateResolved,
				candidateAccepted: articles.length,
				nextPageUri: currentUri?.toJSON(),
				paginationStop: orchestrationStop ?? lastResult.paginationStop,
				diagnostics: {
					...lastResult.diagnostics,
						details: {
							...lastResult.diagnostics.details,
							pageCount: pageNumber,
							pages: pageDiagnostics,
						},
				},
			};
		} finally {
			await pageSession.dispose();
		}
	}
}
