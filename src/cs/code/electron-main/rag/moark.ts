/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from 'cs/base/common/errors';
import { cleanText } from 'cs/base/common/strings';
import type {
	RagConnectionTestResult,
	RagProviderId,
	TestRagConnectionPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { RagErrorCode, isRagError, ragError } from 'cs/workbench/services/rag/ragErrors';
import { isRagProviderId } from 'cs/workbench/services/rag/registry';

const ragConnectionTestTimeoutMs = 20000;
const maximumErrorResponseLength = 4096;

export interface ResolvedMoarkRequest {
	readonly provider: RagProviderId;
	readonly apiKey: string;
	readonly baseUrl: string;
	readonly embeddingModel: string;
	readonly rerankerModel: string;
	readonly embeddingPath: string;
	readonly rerankPath: string;
}

export interface MoarkRequestOptions {
	readonly timeoutMs: number;
	readonly signal?: AbortSignal;
}

export interface MoarkRerankResult {
	readonly index: number;
	readonly score: number;
}

function invalidConfiguration(
	provider: RagProviderId,
	statusText: string,
): never {
	throw ragError(RagErrorCode.ConnectionFailed, {
		provider,
		status: 'INVALID_CONFIGURATION',
		statusText,
	});
}

function invalidResponse(
	request: ResolvedMoarkRequest,
	statusText: string,
): never {
	throw ragError(RagErrorCode.ConnectionFailed, {
		provider: request.provider,
		status: 'INVALID_RESPONSE',
		statusText,
	});
}

function normalizeProvider(value: unknown): RagProviderId {
	if (!isRagProviderId(value)) {
		throw ragError(RagErrorCode.ProviderUnsupported, {
			provider: typeof value === 'string' ? value : '',
		});
	}

	return value;
}

function normalizeBaseUrl(value: unknown): string {
	const baseUrl = cleanText(value);
	if (!baseUrl) {
		throw ragError(RagErrorCode.BaseUrlInvalid, { value: '' });
	}

	let parsedUrl: URL;
	try {
		parsedUrl = new URL(baseUrl);
	} catch {
		throw ragError(RagErrorCode.BaseUrlInvalid, { value: baseUrl });
	}

	if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
		throw ragError(RagErrorCode.BaseUrlInvalid, { value: baseUrl });
	}
	if (parsedUrl.username || parsedUrl.password || parsedUrl.search || parsedUrl.hash) {
		throw ragError(RagErrorCode.BaseUrlInvalid, { value: baseUrl });
	}

	return parsedUrl.toString().replace(/\/+$/, '');
}

function normalizeApiKey(value: unknown): string {
	const apiKey = cleanText(value);
	if (!apiKey) {
		throw ragError(RagErrorCode.ApiKeyMissing);
	}

	return apiKey;
}

function normalizeEmbeddingModel(value: unknown): string {
	const embeddingModel = cleanText(value);
	if (!embeddingModel) {
		throw ragError(RagErrorCode.EmbeddingModelMissing);
	}

	return embeddingModel;
}

function normalizeRerankerModel(value: unknown): string {
	const rerankerModel = cleanText(value);
	if (!rerankerModel) {
		throw ragError(RagErrorCode.RerankerModelMissing);
	}

	return rerankerModel;
}

function normalizeEndpointPath(
	provider: RagProviderId,
	value: unknown,
	field: 'embeddingPath' | 'rerankPath',
): string {
	const endpointPath = cleanText(value);
	if (!endpointPath) {
		invalidConfiguration(provider, `MoArk ${field} is required.`);
	}

	if (/^[a-z][a-z\d+.-]*:/i.test(endpointPath)) {
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(endpointPath);
		} catch {
			invalidConfiguration(provider, `MoArk ${field} must be an HTTP or HTTPS URL or path.`);
		}
		if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
			invalidConfiguration(provider, `MoArk ${field} must use HTTP or HTTPS.`);
		}
		if (parsedUrl.username || parsedUrl.password || parsedUrl.hash) {
			invalidConfiguration(provider, `MoArk ${field} must not contain credentials or a fragment.`);
		}
		return parsedUrl.toString().replace(/\/+$/, '');
	}
	if (endpointPath.includes('#')) {
		invalidConfiguration(provider, `MoArk ${field} must not contain a fragment.`);
	}

	return endpointPath.startsWith('/') ? endpointPath : `/${endpointPath}`;
}

function buildEndpointUrl(baseUrl: string, endpointPath: string): string {
	if (/^https?:\/\//i.test(endpointPath)) {
		return endpointPath;
	}

	return `${baseUrl}${endpointPath}`;
}

function createHeaders(apiKey: string): Record<string, string> {
	return {
		'Content-Type': 'application/json',
		Authorization: `Bearer ${apiKey}`,
		'X-Failover-Enabled': 'false',
	};
}

function assertRequestOptions(options: MoarkRequestOptions): void {
	if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0) {
		throw new RangeError('MoArk request timeout must be a positive safe integer.');
	}
}

function throwIfAborted(signal: AbortSignal | undefined): void {
	if (signal?.aborted) {
		throw new CancellationError();
	}
}

async function requestJson(
	request: ResolvedMoarkRequest,
	url: string,
	body: unknown,
	options: MoarkRequestOptions,
): Promise<unknown> {
	assertRequestOptions(options);
	throwIfAborted(options.signal);

	const controller = new AbortController();
	const abort = { kind: 'none' as 'none' | 'cancelled' | 'timeout' };
	const abortFromExternalSignal = () => {
		if (abort.kind !== 'none') {
			return;
		}
		abort.kind = 'cancelled';
		controller.abort();
	};
	const timeoutId = setTimeout(() => {
		if (abort.kind !== 'none') {
			return;
		}
		abort.kind = 'timeout';
		controller.abort();
	}, options.timeoutMs);
	options.signal?.addEventListener('abort', abortFromExternalSignal, { once: true });
	if (options.signal?.aborted) {
		abortFromExternalSignal();
	}

	try {
		const response = await fetch(url, {
			method: 'POST',
			headers: createHeaders(request.apiKey),
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		throwIfAborted(options.signal);

		if (!response.ok) {
			const errorText = cleanText(await response.text()).slice(0, maximumErrorResponseLength);
			throw ragError(RagErrorCode.ConnectionFailed, {
				provider: request.provider,
				status: response.status,
				statusText: errorText,
			});
		}

		try {
			const payload = await response.json() as unknown;
			throwIfAborted(options.signal);
			return payload;
		} catch (error) {
			if (error instanceof CancellationError || error instanceof Error && error.name === 'AbortError') {
				throw error;
			}
			invalidResponse(request, 'MoArk response body is not valid JSON.');
		}
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') {
			if (abort.kind === 'cancelled') {
				throw new CancellationError();
			}
			if (abort.kind === 'timeout') {
				throw ragError(RagErrorCode.ConnectionFailed, {
					provider: request.provider,
					status: 'TIMEOUT',
					statusText: `Connection timed out after ${options.timeoutMs}ms`,
				});
			}
		}

		if (error instanceof CancellationError || isRagError(error)) {
			throw error;
		}

		throw ragError(RagErrorCode.ConnectionFailed, {
			provider: request.provider,
			status: 'NETWORK_ERROR',
			statusText: error instanceof Error ? error.message : String(error),
		});
	} finally {
		options.signal?.removeEventListener('abort', abortFromExternalSignal);
		clearTimeout(timeoutId);
	}
}

function parseEmbeddingResponse(
	request: ResolvedMoarkRequest,
	payload: unknown,
	expectedCount: number,
): number[][] {
	if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
		invalidResponse(request, 'Embedding response payload must be an object.');
	}

	const data = (payload as { data?: unknown }).data;
	if (!Array.isArray(data) || data.length !== expectedCount) {
		invalidResponse(request, `Embedding response must contain exactly ${expectedCount} indexed vectors.`);
	}

	const embeddings: number[][] = [];
	const indexes = new Set<number>();
	let vectorLength: number | undefined;
	for (const value of data) {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			invalidResponse(request, 'Each embedding result must be an object.');
		}
		const item = value as { index?: unknown; embedding?: unknown };
		if (!Number.isSafeInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= expectedCount) {
			invalidResponse(request, 'Embedding result index is outside the request range.');
		}
		const index = item.index as number;
		if (indexes.has(index)) {
			invalidResponse(request, `Embedding response contains duplicate index ${index}.`);
		}
		indexes.add(index);

		if (!Array.isArray(item.embedding) || item.embedding.length === 0) {
			invalidResponse(request, `Embedding vector ${index} must be a non-empty array.`);
		}
		if (item.embedding.some(component => typeof component !== 'number' || !Number.isFinite(component))) {
			invalidResponse(request, `Embedding vector ${index} contains a non-finite component.`);
		}
		const embedding = item.embedding as number[];
		if (vectorLength === undefined) {
			vectorLength = embedding.length;
		} else if (embedding.length !== vectorLength) {
			invalidResponse(request, 'Embedding response vectors must have one consistent dimension.');
		}
		embeddings[index] = embedding;
	}

	return Array.from({ length: expectedCount }, (_value, index) => {
		const embedding = embeddings[index];
		if (!embedding) {
			invalidResponse(request, `Embedding response is missing index ${index}.`);
		}
		return embedding;
	});
}

function parseRerankResponse(
	request: ResolvedMoarkRequest,
	payload: unknown,
	documentCount: number,
): MoarkRerankResult[] {
	if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
		invalidResponse(request, 'Rerank response payload must be an object.');
	}

	const results = (payload as { results?: unknown }).results;
	if (!Array.isArray(results) || results.length !== documentCount) {
		invalidResponse(request, `Rerank response must contain exactly ${documentCount} indexed results.`);
	}

	const indexes = new Set<number>();
	return results.map(value => {
		if (value === null || typeof value !== 'object' || Array.isArray(value)) {
			invalidResponse(request, 'Each rerank result must be an object.');
		}
		const item = value as { index?: unknown; relevance_score?: unknown };
		if (!Number.isSafeInteger(item.index) || (item.index as number) < 0 || (item.index as number) >= documentCount) {
			invalidResponse(request, 'Rerank result index is outside the request range.');
		}
		const index = item.index as number;
		if (indexes.has(index)) {
			invalidResponse(request, `Rerank response contains duplicate index ${index}.`);
		}
		indexes.add(index);
		if (typeof item.relevance_score !== 'number' || !Number.isFinite(item.relevance_score)) {
			invalidResponse(request, `Rerank result ${index} must contain a finite relevance_score.`);
		}

		return {
			index,
			score: item.relevance_score,
		};
	});
}

function assertInputStrings(values: readonly string[], description: string): void {
	if (values.length === 0) {
		throw new TypeError(`${description} must contain at least one string.`);
	}
	values.forEach((value, index) => {
		if (typeof value !== 'string' || cleanText(value).length === 0) {
			throw new TypeError(`${description} ${index} must be a non-empty string.`);
		}
	});
}

export function resolveMoarkRequest(payload: TestRagConnectionPayload): ResolvedMoarkRequest {
	const provider = normalizeProvider(payload.provider);
	return {
		provider,
		apiKey: normalizeApiKey(payload.apiKey),
		baseUrl: normalizeBaseUrl(payload.baseUrl),
		embeddingModel: normalizeEmbeddingModel(payload.embeddingModel),
		rerankerModel: normalizeRerankerModel(payload.rerankerModel),
		embeddingPath: normalizeEndpointPath(provider, payload.embeddingPath, 'embeddingPath'),
		rerankPath: normalizeEndpointPath(provider, payload.rerankPath, 'rerankPath'),
	};
}

export async function requestMoarkEmbeddings(
	request: ResolvedMoarkRequest,
	input: readonly string[],
	options: MoarkRequestOptions,
): Promise<number[][]> {
	assertInputStrings(input, 'MoArk embedding input');
	const responseJson = await requestJson(
		request,
		buildEndpointUrl(request.baseUrl, request.embeddingPath),
		{
			model: request.embeddingModel,
			input,
		},
		options,
	);

	return parseEmbeddingResponse(request, responseJson, input.length);
}

export async function requestMoarkRerank(
	request: ResolvedMoarkRequest,
	query: string,
	documents: readonly string[],
	options: MoarkRequestOptions,
): Promise<MoarkRerankResult[]> {
	if (!cleanText(query)) {
		throw ragError(RagErrorCode.QueryEmpty);
	}
	assertInputStrings(documents, 'MoArk rerank documents');
	const responseJson = await requestJson(
		request,
		buildEndpointUrl(request.baseUrl, request.rerankPath),
		{
			model: request.rerankerModel,
			query,
			documents,
		},
		options,
	);

	return parseRerankResponse(request, responseJson, documents.length);
}

export async function testMoarkConnection(
	payload: TestRagConnectionPayload,
	signal?: AbortSignal,
): Promise<RagConnectionTestResult> {
	const request = resolveMoarkRequest(payload);
	const options = { timeoutMs: ragConnectionTestTimeoutMs, signal } satisfies MoarkRequestOptions;
	const embeddings = await requestMoarkEmbeddings(request, ['test', 'validation'], options);
	const rerankResults = await requestMoarkRerank(
		request,
		'Which document is about literature?',
		['This document is about literature review.', 'This document is about weather.'],
		options,
	);

	return {
		provider: request.provider,
		baseUrl: request.baseUrl,
		embeddingModel: request.embeddingModel,
		rerankerModel: request.rerankerModel,
		embeddingDimensions: embeddings[0].length,
		rerankCount: rerankResults.length,
	};
}
