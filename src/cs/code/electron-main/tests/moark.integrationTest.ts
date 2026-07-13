/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { suite, test, type TestContext } from 'node:test';

import { isCancellationError } from 'cs/base/common/errors';
import {
	requestMoarkEmbeddings,
	requestMoarkRerank,
	resolveMoarkRequest,
	testMoarkConnection,
	type ResolvedMoarkRequest,
} from 'cs/code/electron-main/rag/moark';
import { isRagError } from 'cs/workbench/services/rag/ragErrors';
import { getRagProviderDefinition } from 'cs/workbench/services/rag/registry';

type RequestRecord = {
	readonly url: string;
	readonly authorization: string | undefined;
	readonly failoverEnabled: string | undefined;
	readonly body: unknown;
};

type TestServer = {
	readonly baseUrl: string;
};

async function readJson(request: IncomingMessage): Promise<unknown> {
	const chunks: Buffer[] = [];
	for await (const chunk of request) {
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function writeJson(response: ServerResponse, payload: unknown, statusCode = 200): void {
	response.writeHead(statusCode, { 'Content-Type': 'application/json' });
	response.end(JSON.stringify(payload));
}

async function startServer(
	t: TestContext,
	handler: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
): Promise<TestServer> {
	const server = createServer((request, response) => {
		void handler(request, response).catch(error => {
			writeJson(response, { error: error instanceof Error ? error.message : String(error) }, 500);
		});
	});
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');
	t.after(async () => {
		await new Promise<void>((resolve, reject) => {
			server.close(error => error ? reject(error) : resolve());
			server.closeAllConnections();
		});
	});
	const address = server.address() as AddressInfo;
	return { baseUrl: `http://127.0.0.1:${address.port}` };
}

function request(baseUrl: string): ResolvedMoarkRequest {
	return resolveMoarkRequest({
		provider: 'moark',
		apiKey: 'secret-key',
		baseUrl,
		embeddingModel: 'exact-embedding',
		rerankerModel: 'exact-reranker',
		embeddingPath: '/embeddings',
		rerankPath: '/rerank',
	});
}

function assertRagStatus(error: unknown, status: string): boolean {
	assert.equal(isRagError(error), true);
	if (!isRagError(error)) {
		return false;
	}
	assert.equal(error.details?.status, status);
	return true;
}

suite('MoArk RAG protocol', { concurrency: false }, () => {
	test('uses the exact text rerank endpoint as the provider default', () => {
		assert.equal(getRagProviderDefinition('moark').defaultRerankPath, '/rerank');
	});

	test('requires every endpoint field instead of filling a provider path', () => {
		assert.throws(
			() => resolveMoarkRequest({
				provider: 'moark',
				apiKey: 'secret-key',
				baseUrl: 'https://example.com/v1',
				embeddingModel: 'exact-embedding',
				rerankerModel: 'exact-reranker',
				rerankPath: '/rerank',
			}),
			error => assertRagStatus(error, 'INVALID_CONFIGURATION'),
		);
	});

	test('sends one exact embedding request and one string-document rerank request', async t => {
		const requests: RequestRecord[] = [];
		const server = await startServer(t, async (incoming, response) => {
			const failoverEnabled = incoming.headers['x-failover-enabled'];
			if (Array.isArray(failoverEnabled)) {
				throw new TypeError('X-Failover-Enabled must have exactly one value.');
			}
			const record = {
				url: incoming.url ?? '',
				authorization: incoming.headers.authorization,
				failoverEnabled,
				body: await readJson(incoming),
			};
			requests.push(record);
			if (record.url === '/embeddings') {
				writeJson(response, {
					data: [
						{ index: 0, embedding: [1, 0] },
						{ index: 1, embedding: [0, 1] },
					],
				});
				return;
			}
			writeJson(response, {
				results: [
					{ index: 1, relevance_score: 0.9 },
					{ index: 0, relevance_score: 0.2 },
				],
			});
		});
		const moarkRequest = request(server.baseUrl);
		const options = { timeoutMs: 5000 };

		assert.deepStrictEqual(
			await requestMoarkEmbeddings(moarkRequest, ['query', 'document'], options),
			[[1, 0], [0, 1]],
		);
		assert.deepStrictEqual(
			await requestMoarkRerank(moarkRequest, 'query', ['first', 'second'], options),
			[
				{ index: 1, score: 0.9 },
				{ index: 0, score: 0.2 },
			],
		);
		assert.deepStrictEqual(requests, [
			{
				url: '/embeddings',
				authorization: 'Bearer secret-key',
				failoverEnabled: 'false',
				body: { model: 'exact-embedding', input: ['query', 'document'] },
			},
			{
				url: '/rerank',
				authorization: 'Bearer secret-key',
				failoverEnabled: 'false',
				body: { model: 'exact-reranker', query: 'query', documents: ['first', 'second'] },
			},
		]);
	});

	test('tests the configured connection through both strict endpoints', async t => {
		const server = await startServer(t, async (incoming, response) => {
			await readJson(incoming);
			if (incoming.url === '/embeddings') {
				writeJson(response, {
					data: [
						{ index: 0, embedding: [1, 0, 0] },
						{ index: 1, embedding: [0, 1, 0] },
					],
				});
				return;
			}
			writeJson(response, {
				results: [
					{ index: 0, relevance_score: 0.9 },
					{ index: 1, relevance_score: 0.1 },
				],
			});
		});

		assert.deepStrictEqual(
			await testMoarkConnection({
				provider: 'moark',
				apiKey: 'secret-key',
				baseUrl: server.baseUrl,
				embeddingModel: 'exact-embedding',
				rerankerModel: 'exact-reranker',
				embeddingPath: '/embeddings',
				rerankPath: '/rerank',
			}),
			{
				provider: 'moark',
				baseUrl: server.baseUrl,
				embeddingModel: 'exact-embedding',
				rerankerModel: 'exact-reranker',
				embeddingDimensions: 3,
				rerankCount: 2,
			},
		);
	});

	test('rejects alternate rerank response fields without another request', async t => {
		let requestCount = 0;
		const server = await startServer(t, async (incoming, response) => {
			requestCount += 1;
			await readJson(incoming);
			writeJson(response, {
				data: [{ index: 0, score: 0.8 }],
			});
		});

		await assert.rejects(
			requestMoarkRerank(request(server.baseUrl), 'query', ['document'], { timeoutMs: 5000 }),
			error => assertRagStatus(error, 'INVALID_RESPONSE'),
		);
		assert.equal(requestCount, 1);
	});

	test('rejects non-numeric embedding results', async t => {
		let requestCount = 0;
		const server = await startServer(t, async (incoming, response) => {
			requestCount += 1;
			await readJson(incoming);
			writeJson(response, {
				data: [
					{ index: 0, embedding: [null] },
					{ index: 1, embedding: [0] },
				],
			});
		});

		await assert.rejects(
			requestMoarkEmbeddings(request(server.baseUrl), ['query', 'document'], { timeoutMs: 5000 }),
			error => assertRagStatus(error, 'INVALID_RESPONSE'),
		);
		assert.equal(requestCount, 1);
	});

	test('cancels before dispatch and while a request is active', async t => {
		const beforeStart = new AbortController();
		beforeStart.abort();
		await assert.rejects(
			requestMoarkEmbeddings(request('http://127.0.0.1:1'), ['query'], {
				timeoutMs: 5000,
				signal: beforeStart.signal,
			}),
			isCancellationError,
		);

		let markReceived: (() => void) | undefined;
		const received = new Promise<void>(resolve => {
			markReceived = resolve;
		});
		const server = await startServer(t, async incoming => {
			await readJson(incoming);
			markReceived?.();
		});
		const active = new AbortController();
		const pending = requestMoarkEmbeddings(request(server.baseUrl), ['query'], {
			timeoutMs: 5000,
			signal: active.signal,
		});
		await received;
		active.abort();
		await assert.rejects(pending, isCancellationError);
	});

	test('reports timeout as the only terminal request outcome', async t => {
		const server = await startServer(t, async incoming => {
			await readJson(incoming);
		});
		await assert.rejects(
			requestMoarkEmbeddings(request(server.baseUrl), ['query'], { timeoutMs: 30 }),
			error => assertRagStatus(error, 'TIMEOUT'),
		);
	});
});
