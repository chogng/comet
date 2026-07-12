/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { cleanText } from 'cs/base/common/strings';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import { requestWithBrowserSession } from 'cs/platform/request/electron-main/requestMainService';
import {
	createFetchTraceId,
	elapsedMs,
	getCompatFetchEnvValueOrDefault,
	shortenForLog,
	timingLog,
} from 'cs/platform/fetch/node/fetchTiming';
import {
	isRequestError,
	RequestErrorCode,
	requestError,
} from 'cs/platform/request/common/requestErrors';

const defaultFetchTimeoutMs = 12_000;
const htmlFetchAccept = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const htmlFetchTransport = getCompatFetchEnvValueOrDefault(
	'LS_FETCH_TRANSPORT',
	'READER_FETCH_TRANSPORT',
	'browser',
) === 'node' ? 'node' : 'browser';

export interface FetchHtmlOptions {
	readonly timeoutMs?: number;
	readonly traceId?: string;
	readonly stage?: string;
	readonly signal?: AbortSignal;
}

async function requestHtml(url: string, signal: AbortSignal) {
	const headers = { accept: htmlFetchAccept };
	if (htmlFetchTransport === 'node') {
		return { response: await fetch(url, { signal, headers }), transport: htmlFetchTransport };
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
	const traceId = cleanText(options.traceId) || createFetchTraceId('html');
	const stage = cleanText(options.stage) || 'html';
	const timeoutMs = Number.isFinite(options.timeoutMs) && Number(options.timeoutMs) > 0
		? Number(options.timeoutMs)
		: defaultFetchTimeoutMs;
	const controller = new AbortController();
	const externalSignal = options.signal;
	const abort = () => controller.abort();
	if (externalSignal?.aborted) {
		abort();
	} else {
		externalSignal?.addEventListener('abort', abort, { once: true });
	}
	const timeout = setTimeout(abort, timeoutMs);
	const startedAt = Date.now();
	try {
		const { response, transport } = await requestHtml(url, controller.signal);
		if (!response.ok) {
			throw requestError(RequestErrorCode.HttpRequestFailed, {
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
		if (isRequestError(error)) {
			throw error;
		}
		throw requestError(RequestErrorCode.HttpRequestFailed, {
			status: controller.signal.aborted ? (externalSignal?.aborted ? 'ABORTED' : 'TIMEOUT') : 'NETWORK_ERROR',
			statusText: controller.signal.aborted
				? (externalSignal?.aborted ? 'Request aborted' : `Request timed out after ${timeoutMs}ms`)
				: (error instanceof Error ? error.message : String(error)),
			url,
		});
	} finally {
		clearTimeout(timeout);
		externalSignal?.removeEventListener('abort', abort);
	}
}
