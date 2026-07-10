/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { parseDateRange } from 'cs/base/common/date';
import { URI } from 'cs/base/common/uri';
import { cleanText } from 'cs/base/common/strings';
import { normalizeNatureMainSiteListingUrl, normalizeUrl } from 'cs/base/common/url';
import { getFetchArticleSourceUrl } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticle } from 'cs/base/parts/sandbox/common/fetchArticle';
import type { FetchArticleProof } from 'cs/base/parts/sandbox/common/fetchArticleProof';
import type {
	FetchFailureReason,
	FetchLatestArticlesPayload,
	FetchStatus,
	FetchTargetPreference,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import type { AppSettingsConfigurationService } from 'cs/platform/configuration/common/configuration';
import {
	batchLimitMax,
	batchLimitMin,
	defaultBatchLimit,
} from 'cs/platform/configuration/common/defaultBatchSources';
import {
	createFetchTraceId,
	elapsedMs,
	getCompatFetchEnvValueOrDefault,
	shortenForLog,
	timingLog,
} from 'cs/platform/fetch/node/fetchTiming';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import { requestWithBrowserSession } from 'cs/platform/request/electron-main/requestMainService';
import type { HistoryStore } from 'cs/platform/storage/electron-main/historyStore';
import {
	FetchErrorCode,
	fetchError,
	getFetchErrorCode,
	getFetchErrorDetails,
} from 'cs/workbench/services/fetch/common/fetchErrors';
import type { FetchPagePresentation } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import { resolveFetchArticleListSource } from 'cs/workbench/services/fetch/electron-main/fetchParserResolver';
import type { FetchService } from 'cs/workbench/services/fetch/electron-main/fetchService';
import { resolveFetchSite } from 'cs/workbench/services/fetch/electron-main/fetchSiteResolver';
import { fetchSiteProviders } from 'cs/workbench/services/fetch/electron-main/fetchSitesProvider';

const defaultFetchTimeoutMs = 12_000;
const pageFetchTimeoutMs = 12_000;
const articleFetchTimeoutMs = 12_000;
const browserEditorFetchTimeoutMs = 3 * 60 * 1000;
const htmlFetchAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const htmlFetchTransport = getCompatFetchEnvValueOrDefault(
	'LS_FETCH_TRANSPORT',
	'READER_FETCH_TRANSPORT',
	'browser',
) === 'node' ? 'node' : 'browser';

type FetchStorageService = AppSettingsConfigurationService & HistoryStore;

interface FetchHtmlOptions {
	readonly timeoutMs?: number;
	readonly traceId?: string;
	readonly stage?: string;
	readonly signal?: AbortSignal;
}

interface FetchSource {
	readonly sourceId: string;
	readonly listUri: URI;
	readonly fetchTarget: FetchTargetPreference;
}

export interface FetchDispatchOptions {
	readonly requestId: string;
	readonly fetchService: FetchService;
	readonly onFetchStatus?: (status: FetchStatus) => void;
}

function toPresentation(fetchTarget: FetchTargetPreference): FetchPagePresentation {
	return fetchTarget === 'webContentsView' ? 'browserEditor' : 'background';
}

function normalizeBatchLimit(value: unknown): number {
	const parsed = Number.parseInt(String(value), 10);
	if (!Number.isFinite(parsed)) return defaultBatchLimit;
	return Math.min(batchLimitMax, Math.max(batchLimitMin, parsed));
}

function resolveFailureReason(error: unknown): FetchFailureReason {
	const code = getFetchErrorCode(error);
	const details = getFetchErrorDetails(error);
	const status = details?.status ?? details?.statusCode;
	if (code === FetchErrorCode.InteractiveTargetTimedOut || status === 'TIMEOUT') return 'loadTimeout';
	if (status === 429 || status === '429') return 'rateLimited';
	if (status === 403 || status === '403') return 'accessDenied';
	if (status === 'JAVASCRIPT_ERROR') return 'javascriptError';
	if (code === FetchErrorCode.ArticlePageRejected) return 'articleProofFailed';
	if (
		code === FetchErrorCode.ArticleListPageRejected ||
		code === FetchErrorCode.UnsupportedArticleListStructure ||
		code === FetchErrorCode.AmbiguousArticleListStructure
	) return 'articleListProofFailed';
	return 'navigationFailed';
}

function readArticleProof(value: unknown): FetchArticleProof | null {
	if (!value || typeof value !== 'object') return null;
	const proof = value as Partial<FetchArticleProof>;
	return (
		typeof proof.canonicalUriMatched === 'boolean' &&
		typeof proof.titleFound === 'boolean' &&
		typeof proof.authorsFound === 'boolean' &&
		typeof proof.abstractFound === 'boolean' &&
		typeof proof.bodyFound === 'boolean' &&
		typeof proof.publicationFound === 'boolean' &&
		typeof proof.articleKindFound === 'boolean'
	) ? proof as FetchArticleProof : null;
}

async function requestHtml(url: string, signal: AbortSignal) {
	const headers = { accept: htmlFetchAccept };
	if (htmlFetchTransport === 'node') {
		return {
			response: await fetch(url, { signal, headers }),
			transport: htmlFetchTransport,
		};
	}
	return {
		response: await requestWithBrowserSession({
			url,
			signal,
			headers,
			partition: WORKBENCH_SHARED_WEB_PARTITION,
		}),
		transport: htmlFetchTransport,
	};
}

export async function fetchHtml(url: string, options: FetchHtmlOptions = {}): Promise<string> {
	const traceId = cleanText(options.traceId) || 'fetch';
	const stage = cleanText(options.stage) || 'html';
	const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
		? Number(options.timeoutMs)
		: defaultFetchTimeoutMs;
	const controller = new AbortController();
	const externalSignal = options.signal;
	const abort = () => controller.abort();
	if (externalSignal?.aborted) abort();
	else externalSignal?.addEventListener('abort', abort, { once: true });
	const timeout = setTimeout(abort, timeoutMs);
	const startedAt = Date.now();
	try {
		const { response, transport } = await requestHtml(url, controller.signal);
		if (!response.ok) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: response.status,
				statusText: response.statusText,
				url,
			});
		}
		const html = await response.text();
		timingLog(traceId, `${stage}:ok`, {
			ms: elapsedMs(startedAt),
			status: response.status,
			transport,
			url: shortenForLog(url),
			size: html.length,
		});
		return html;
	} catch (error) {
		if (getFetchErrorCode(error)) throw error;
		if (controller.signal.aborted) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: externalSignal?.aborted ? 'ABORTED' : 'TIMEOUT',
				statusText: externalSignal?.aborted ? 'Request aborted' : `Request timed out after ${timeoutMs}ms`,
				url,
			});
		}
		throw fetchError(FetchErrorCode.HttpRequestFailed, {
			status: 'NETWORK_ERROR',
			statusText: error instanceof Error ? error.message : String(error),
			url,
		});
	} finally {
		clearTimeout(timeout);
		externalSignal?.removeEventListener('abort', abort);
	}
}

function normalizeSources(payload: FetchLatestArticlesPayload): FetchSource[] {
	const deduped = new Map<string, FetchSource>();
	for (const [index, source] of (payload.sources ?? []).entries()) {
		const value = cleanText(source.pageUrl);
		if (!value) continue;
		const normalized = normalizeNatureMainSiteListingUrl(normalizeUrl(value));
		const listUri = URI.parse(normalized);
		deduped.set(listUri.toString(true), {
			sourceId: cleanText(source.sourceId) || String(index + 1),
			listUri,
			fetchTarget: source.fetchTarget === 'webContentsView' ? 'webContentsView' : 'background',
		});
	}
	return [...deduped.values()];
}

function createStatusBase(
	requestId: string,
	sourceId: string,
	pageUri: URI,
	pageNumber: number,
	identity: {
		readonly siteId?: string;
		readonly articleListSourceId?: string;
		readonly parserId?: string;
	} = {},
) {
	return {
		requestId,
		sourceId,
		pageUrl: pageUri.toString(true),
		pageNumber,
		siteId: identity.siteId ?? null,
		articleListSourceId: identity.articleListSourceId ?? null,
		parserId: identity.parserId ?? null,
	};
}

export async function fetchArticle(
	urlValue: unknown,
	storage: FetchStorageService,
	options: FetchDispatchOptions & { readonly fetchTarget: FetchTargetPreference },
): Promise<FetchArticle> {
	const traceId = createFetchTraceId('single');
	const sourceUri = URI.parse(normalizeUrl(urlValue));
	const startedAt = Date.now();
	let siteId: string | null = null;
	let targetId: string | null = null;
	options.onFetchStatus?.({
		...createStatusBase(options.requestId, 'single', sourceUri, 1),
		phase: 'loading',
		targetMode: options.fetchTarget,
		targetId: null,
		articleProof: null,
	});
	try {
		const site = resolveFetchSite(fetchSiteProviders, sourceUri);
		siteId = site.id;
		const result = await options.fetchService.fetchArticleDetail({
			sourceUri,
			presentation: toPresentation(options.fetchTarget),
			backgroundTimeoutMs: articleFetchTimeoutMs,
			browserEditorTimeoutMs: browserEditorFetchTimeoutMs,
			onBrowserEditorRequired(resource, uri) {
				targetId = BrowserViewUri.getId(resource)!;
				options.onFetchStatus?.({
					...createStatusBase(options.requestId, 'single', uri, 1, { siteId: site.id }),
					phase: 'targetRequired',
					targetMode: 'webContentsView',
					targetId,
					articleProof: null,
				});
			},
		});
		if (options.fetchTarget === 'webContentsView' && targetId) {
			options.onFetchStatus?.({
				...createStatusBase(options.requestId, 'single', sourceUri, 1, {
					siteId: result.diagnostics.siteId,
					parserId: result.diagnostics.parserId,
				}),
				phase: 'targetReady',
				targetMode: 'webContentsView',
				targetId,
				articleProof: result.proof,
			});
		} else {
			options.onFetchStatus?.({
				...createStatusBase(options.requestId, 'single', sourceUri, 1, {
					siteId: result.diagnostics.siteId,
					parserId: result.diagnostics.parserId,
				}),
				phase: 'loading',
				targetMode: 'background',
				targetId: null,
				articleProof: result.proof,
			});
		}
		await storage.saveFetchedArticles([result.article]);
		timingLog(traceId, 'fetch_article:done', { totalMs: elapsedMs(startedAt) });
		return result.article;
	} catch (error) {
		const details = getFetchErrorDetails(error);
		options.onFetchStatus?.({
			...createStatusBase(options.requestId, 'single', sourceUri, 1, {
				siteId: typeof details?.siteId === 'string' ? details.siteId : siteId ?? undefined,
				parserId: typeof details?.parserId === 'string' ? details.parserId : undefined,
			}),
			phase: 'failed',
			targetMode: options.fetchTarget,
			targetId,
			failureReason: resolveFailureReason(error),
			articleProof: readArticleProof(details?.proof),
		});
		throw error;
	}
}

async function fetchFromSource(
	source: FetchSource,
	limit: number,
	dateRange: ReturnType<typeof parseDateRange>,
	options: FetchDispatchOptions,
	traceId: string,
): Promise<readonly FetchArticle[]> {
	let activeUri = source.listUri;
	let activePageNumber = 1;
	let activeTargetId: string | null = null;
	let lastArticleProof: FetchArticleProof | null = null;
	let activeSiteId: string | undefined;
	let activeArticleListSourceId: string | undefined;
	let activeParserId: string | undefined;
	try {
		const site = resolveFetchSite(fetchSiteProviders, source.listUri);
		activeSiteId = site.id;
		const articleListSource = resolveFetchArticleListSource(site, source.listUri);
		activeArticleListSourceId = articleListSource.id;
		const result = await options.fetchService.fetchFromArticleList({
			listUri: source.listUri,
			remainingLimit: limit,
			dateRange,
			presentation: toPresentation(source.fetchTarget),
			pageTimeoutMs: pageFetchTimeoutMs,
			articleTimeoutMs: articleFetchTimeoutMs,
			browserEditorTimeoutMs: browserEditorFetchTimeoutMs,
			traceId,
			fetchText: (uri, fetchOptions) => fetchHtml(uri.toString(true), {
				...fetchOptions,
				traceId,
			}),
			onPageStart(uri, pageNumber) {
				activeUri = uri;
				activePageNumber = pageNumber;
				options.onFetchStatus?.({
					...createStatusBase(options.requestId, source.sourceId, uri, pageNumber, {
						siteId: activeSiteId,
						articleListSourceId: activeArticleListSourceId,
					}),
					phase: 'loading',
					targetMode: source.fetchTarget,
					targetId: activeTargetId,
					articleProof: null,
				});
			},
			onBrowserEditorRequired(resource, uri) {
				activeTargetId = BrowserViewUri.getId(resource)!;
				options.onFetchStatus?.({
					...createStatusBase(options.requestId, source.sourceId, uri, activePageNumber, {
						siteId: activeSiteId,
						articleListSourceId: activeArticleListSourceId,
					}),
					phase: 'targetRequired',
					targetMode: 'webContentsView',
					targetId: activeTargetId,
					articleProof: null,
				});
			},
			onArticleProof(proof) {
				lastArticleProof = proof;
				if (source.fetchTarget !== 'webContentsView' || !activeTargetId) return;
				options.onFetchStatus?.({
					...createStatusBase(options.requestId, source.sourceId, activeUri, activePageNumber, {
						siteId: activeSiteId,
						articleListSourceId: activeArticleListSourceId,
					}),
					phase: 'targetReady',
					targetMode: 'webContentsView',
					targetId: activeTargetId,
					articleProof: proof,
				});
			},
		});
		activeSiteId = result.diagnostics.siteId;
		activeArticleListSourceId = result.diagnostics.sourceId;
		activeParserId = result.diagnostics.parserId;
		const statusBase = createStatusBase(
			options.requestId,
			source.sourceId,
			activeUri,
			activePageNumber,
			{
				siteId: activeSiteId,
				articleListSourceId: activeArticleListSourceId,
				parserId: activeParserId,
			},
		);
		if (source.fetchTarget === 'webContentsView' && activeTargetId) {
			options.onFetchStatus?.({
				...statusBase,
				phase: 'targetReady',
				targetMode: 'webContentsView',
				targetId: activeTargetId,
				articleProof: lastArticleProof,
				paginationStopped: result.paginationStop !== undefined,
				paginationStopReason: result.paginationStop?.reason ?? null,
			});
		} else {
			options.onFetchStatus?.({
				...statusBase,
				phase: 'loading',
				targetMode: 'background',
				targetId: activeTargetId,
				articleProof: lastArticleProof,
				paginationStopped: result.paginationStop !== undefined,
				paginationStopReason: result.paginationStop?.reason ?? null,
			});
		}
		return result.articles;
	} catch (error) {
		const details = getFetchErrorDetails(error);
		const detailSiteId = typeof details?.siteId === 'string' ? details.siteId : undefined;
		const detailSourceId = typeof details?.sourceId === 'string' ? details.sourceId : undefined;
		const detailParserId = typeof details?.parserId === 'string' ? details.parserId : undefined;
		options.onFetchStatus?.({
			...createStatusBase(options.requestId, source.sourceId, activeUri, activePageNumber, {
				siteId: detailSiteId ?? activeSiteId,
				articleListSourceId: detailSourceId ?? activeArticleListSourceId,
				parserId: detailParserId ?? activeParserId,
			}),
			phase: 'failed',
			targetMode: source.fetchTarget,
			targetId: activeTargetId,
			failureReason: resolveFailureReason(error),
			articleProof: readArticleProof(details?.proof),
		});
		throw error;
	}
}

export async function fetchLatestArticles(
	payload: FetchLatestArticlesPayload,
	storage: FetchStorageService,
	options: FetchDispatchOptions,
): Promise<FetchArticle[]> {
	const traceId = createFetchTraceId('batch');
	const sources = normalizeSources(payload);
	if (sources.length === 0) throw fetchError(FetchErrorCode.BatchPageUrlsEmpty);
	const settings = await storage.loadSettings();
	const limit = normalizeBatchLimit(settings.defaultBatchLimit);
	const dateRange = parseDateRange(payload.startDate, payload.endDate);
	const fetched: FetchArticle[] = [];
	const seen = new Set<string>();
	const failedSources: Readonly<Record<string, unknown>>[] = [];
	for (const source of sources) {
		try {
			const articles = await fetchFromSource(source, limit, dateRange, options, `${traceId}:${source.sourceId}`);
			for (const article of articles) {
				const url = getFetchArticleSourceUrl(article);
				if (seen.has(url)) continue;
				seen.add(url);
				fetched.push(article);
			}
		} catch (error) {
			failedSources.push({
				sourceId: source.sourceId,
				listUri: source.listUri.toString(true),
				code: getFetchErrorCode(error) || FetchErrorCode.UnknownError,
				details: getFetchErrorDetails(error),
			});
		}
	}
	if (fetched.length === 0) {
		if (failedSources.length > 0) {
			throw fetchError(FetchErrorCode.BatchSourceFetchFailed, { failedSources });
		}
		if (dateRange.start || dateRange.end) {
			throw fetchError(FetchErrorCode.BatchNoMatchInDateRange, {
				startDate: dateRange.start,
				endDate: dateRange.end,
			});
		}
		throw fetchError(FetchErrorCode.BatchNoValidArticles);
	}
	return fetched.map((article, index) => ({ ...article, fetchOrder: index + 1 }));
}
