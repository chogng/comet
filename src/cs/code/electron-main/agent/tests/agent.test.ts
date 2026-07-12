/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import type {
	ArticleContextInput,
	LlmSettings,
	RagSettings,
	RunMainAgentTurnPayload,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { runMainAgentTurn } from 'cs/code/electron-main/agent/agent';
import { createWritingEditorDocumentFromPlainText } from 'cs/editor/common/writingEditorDocument';

const llmSettings: LlmSettings = {
	activeProvider: 'glm',
	providers: {
		glm: {
			apiKey: 'test-key',
			baseUrl: 'https://example.test/v1',
			selectedModelOption: 'glm:glm-4.6',
		},
		kimi: {
			apiKey: '',
			baseUrl: 'https://example.test/v1',
			selectedModelOption: 'kimi:kimi-test-model',
		},
		deepseek: {
			apiKey: '',
			baseUrl: 'https://example.test/v1',
			selectedModelOption: 'deepseek:deepseek-test-model',
		},
		anthropic: {
			apiKey: '',
			baseUrl: '',
			selectedModelOption: 'anthropic:claude-3-7-sonnet-20250219',
		},
		openai: {
			apiKey: '',
			baseUrl: 'https://example.test/v1',
			selectedModelOption: 'openai:gpt-5',
		},
		gemini: {
			apiKey: '',
			baseUrl: 'https://example.test/v1',
			selectedModelOption: 'gemini:gemini-2.5-flash',
		},
		custom: {
			apiKey: '',
			baseUrl: '',
			selectedModelOption: '',
		},
	},
};

const ragSettings: RagSettings = {
	enabled: true,
	activeProvider: 'moark',
	providers: {
		moark: {
			apiKey: '',
			baseUrl: 'https://example.test',
			embeddingModel: 'test-embedding',
			rerankerModel: 'test-reranker',
			embeddingPath: '/embeddings',
			rerankPath: '/rerank',
		},
	},
	retrievalCandidateCount: 8,
	retrievalTopK: 4,
};

function createAgentPayload(
	overrides: Partial<RunMainAgentTurnPayload> = {},
): RunMainAgentTurnPayload {
	return {
		messages: [{
			role: 'user',
			parts: [{ type: 'text', text: 'Complete the request.' }],
		}],
		writingContext: null,
		editorSelection: null,
		editorDocument: null,
		articleContexts: [],
		llm: llmSettings,
		rag: ragSettings,
		availableTools: [],
		...overrides,
	};
}

function createArticleContext(overrides: Partial<ArticleContextInput> = {}): ArticleContextInput {
	return {
		sourceUrl: 'https://example.test/article',
		title: 'Bounded article',
		authors: ['Ada Author'],
		abstract: 'A bounded abstract.',
		journalTitle: 'Journal',
		...overrides,
	};
}

test('runMainAgentTurn returns the last validated patch proposal from apply_editor_patch', async () => {
	const originalFetch = globalThis.fetch;
	let requestCount = 0;

	globalThis.fetch = (async () => {
		requestCount += 1;

		if (requestCount === 1) {
			return new Response(
				JSON.stringify({
					id: 'resp_patch_1',
					status: 'completed',
					output: [
						{
							type: 'function_call',
							id: 'fc_patch_1',
							call_id: 'call_patch_1',
							name: 'apply_editor_patch',
							arguments: JSON.stringify({
								label: 'Tighten draft sentence',
								summary: 'Replace the first paragraph with a shorter sentence.',
								operations: [
									{
										kind: 'text-edit',
										edit: {
											kind: 'replaceBlock',
											blockId: 'block_1',
											expectedText: 'Draft paragraph for the agent.',
											text: 'Revised paragraph for the agent.',
										},
									},
								],
							}),
						},
					],
				}),
				{
					status: 200,
					headers: {
						'Content-Type': 'application/json',
					},
				},
			);
		}

		return new Response(
			JSON.stringify({
				id: 'resp_patch_2',
				status: 'completed',
				output: [
					{
						type: 'message',
						role: 'assistant',
						content: [
							{
								type: 'output_text',
								text: 'Patch prepared.',
							},
						],
					},
				],
			}),
			{
				status: 200,
				headers: {
					'Content-Type': 'application/json',
				},
			},
		);
	}) as typeof globalThis.fetch;

	const payload = createAgentPayload({
		messages: [
			{
				role: 'user',
				parts: [
					{
						type: 'text',
						text: 'Tighten the draft sentence.',
					},
				],
			},
		],
		editorDocument: {
			type: 'doc',
			content: [
				{
					type: 'paragraph',
					attrs: {
						blockId: 'block_1',
						textAlign: null,
					},
					content: [{ type: 'text', text: 'Draft paragraph for the agent.' }],
				},
			],
		},
		availableTools: ['apply_editor_patch'],
	});

	try {
		const result = await runMainAgentTurn(payload);

		assert.equal(result.finalText, 'Patch prepared.');
		assert.equal('messages' in result, false);
		assert.deepEqual(result.lastPatchProposal, {
			patch: {
				label: 'Tighten draft sentence',
				summary: 'Replace the first paragraph with a shorter sentence.',
				operations: [
					{
						kind: 'text-edit',
						edit: {
							kind: 'replaceBlock',
							blockId: 'block_1',
							expectedText: 'Draft paragraph for the agent.',
							text: 'Revised paragraph for the agent.',
						},
					},
				],
			},
			accepted: true,
			operationsValidated: 1,
			failedOperationIndex: null,
			requiresCustomExecutor: false,
			validationError: null,
		});
		assert.deepEqual(result.toolTrace, [
			{
				step: 0,
				toolName: 'apply_editor_patch',
				isError: false,
			},
		]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('runMainAgentTurn pages text units and keeps selection output document-free', async () => {
	const originalFetch = globalThis.fetch;
	const requestBodies: Array<{ input?: Array<{ type?: string; call_id?: string; output?: string; }>; }> = [];
	let requestCount = 0;
	globalThis.fetch = (async (_input, init) => {
		requestCount += 1;
		requestBodies.push(JSON.parse(String(init?.body)) as {
			input?: Array<{ type?: string; call_id?: string; output?: string; }>;
		});
		if (requestCount === 1) {
			return new Response(JSON.stringify({
				id: 'resp_tools_1',
				status: 'completed',
				output: [{
					type: 'function_call',
					call_id: 'call_selection',
					name: 'get_selection_context',
					arguments: '{}',
				}, {
					type: 'function_call',
					call_id: 'call_units',
					name: 'list_text_units',
					arguments: JSON.stringify({ cursor: 1, limit: 1 }),
				}],
			}), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		return new Response(JSON.stringify({
			id: 'resp_tools_2',
			status: 'completed',
			output: [{
				type: 'message',
				role: 'assistant',
				content: [{ type: 'output_text', text: 'Context inspected.' }],
			}],
		}), { status: 200, headers: { 'Content-Type': 'application/json' } });
	}) as typeof globalThis.fetch;

	try {
		const document = createWritingEditorDocumentFromPlainText('First\n\nSecond\n\nThird');
		const blockId = document.content?.[0]?.attrs?.blockId;
		assert.equal(typeof blockId, 'string');
		const result = await runMainAgentTurn(createAgentPayload({
			editorDocument: document,
			editorSelection: {
				blockId: blockId as string,
				startOffset: 0,
				endOffset: 5,
			},
			availableTools: ['get_selection_context', 'list_text_units'],
		}));
		assert.equal(result.finalText, 'Context inspected.');
		const outputs = requestBodies[1]?.input?.filter(item => item.type === 'function_call_output') ?? [];
		const selectionOutput = JSON.parse(outputs.find(item => item.call_id === 'call_selection')?.output ?? 'null');
		const textUnitsOutput = JSON.parse(outputs.find(item => item.call_id === 'call_units')?.output ?? 'null');
		assert.deepEqual(selectionOutput, {
			selection: {
				blockId,
				kind: 'paragraph',
				range: {
					startLineNumber: 1,
					startColumn: 1,
					endLineNumber: 1,
					endColumn: 6,
				},
				startOffset: 0,
				endOffset: 5,
				selectedText: 'First',
				isCollapsed: false,
				isPlainTextEditable: true,
			},
		});
		assert.deepEqual({
			texts: textUnitsOutput.units.map((unit: { text: string; }) => unit.text),
			nextCursor: textUnitsOutput.nextCursor,
			total: textUnitsOutput.total,
		}, {
			texts: ['Second'],
			nextCursor: 2,
			total: 3,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('runMainAgentTurn rejects an oversized text-unit page without truncation', async () => {
	const originalFetch = globalThis.fetch;
	let requestCount = 0;
	globalThis.fetch = (async () => {
		requestCount += 1;
		if (requestCount === 1) {
			return new Response(JSON.stringify({
				id: 'resp_large_units_1',
				status: 'completed',
				output: [{
					type: 'function_call',
					call_id: 'call_large_units',
					name: 'list_text_units',
					arguments: JSON.stringify({ cursor: 0, limit: 1 }),
				}],
			}), { status: 200, headers: { 'Content-Type': 'application/json' } });
		}
		return new Response(JSON.stringify({
			id: 'resp_large_units_2',
			status: 'completed',
			output: [{
				type: 'message',
				role: 'assistant',
				content: [{ type: 'output_text', text: 'The text-unit page was rejected.' }],
			}],
		}), { status: 200, headers: { 'Content-Type': 'application/json' } });
	}) as typeof globalThis.fetch;

	try {
		const result = await runMainAgentTurn(createAgentPayload({
			editorDocument: createWritingEditorDocumentFromPlainText('x'.repeat(300_000)),
			availableTools: ['list_text_units'],
		}));
		assert.deepEqual(result.toolTrace, [{
			step: 0,
			toolName: 'list_text_units',
			isError: true,
		}]);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('runMainAgentTurn rejects history outside the resolved model budget before transport', async () => {
	const originalFetch = globalThis.fetch;
	let requestCount = 0;
	globalThis.fetch = (async () => {
		requestCount += 1;
		throw new Error('Transport must not run for an oversized history.');
	}) as typeof globalThis.fetch;
	try {
		await assert.rejects(runMainAgentTurn(createAgentPayload({
			messages: [{
				role: 'user',
				parts: [{ type: 'text', text: 'x'.repeat(300_000) }],
			}],
		})), /history.*model budget/i);
		assert.equal(requestCount, 0);
	} finally {
		globalThis.fetch = originalFetch;
	}
});

test('runMainAgentTurn rejects malformed Editor documents at the main-process boundary', async () => {
	await assert.rejects(runMainAgentTurn(createAgentPayload({
		editorDocument: {
			type: 'doc',
			content: [{ type: 'not-a-writing-editor-node' }],
		},
	})), /Unknown node type|invalid content/i);
});

test('runMainAgentTurn revalidates Editor selection against the authoritative document', async () => {
	const document = createWritingEditorDocumentFromPlainText('Authoritative text');
	const blockId = document.content?.[0]?.attrs?.blockId;
	assert.equal(typeof blockId, 'string');
	await assert.rejects(runMainAgentTurn(createAgentPayload({
		editorDocument: document,
		editorSelection: {
			blockId: blockId as string,
			startOffset: 0,
			endOffset: 999,
		},
	})), /selection does not address its document text unit/i);
});

test('runMainAgentTurn rejects removed legacy payload properties', async () => {
	const payload = {
		...createAgentPayload(),
		draftBody: 'legacy duplicate',
	} as unknown as RunMainAgentTurnPayload;
	await assert.rejects(runMainAgentTurn(payload), /unsupported property/i);
});

test('runMainAgentTurn rejects malformed image history before transport', async () => {
	const payload = createAgentPayload({
		messages: [{
			role: 'user',
			parts: [{
				type: 'image',
				id: 'image-1',
				name: 'Browser.jpeg',
				mimeType: 'image/jpeg',
				data: 'not base64',
			}],
		}],
	});
	await assert.rejects(runMainAgentTurn(payload), /message schema/i);
});

test('runMainAgentTurn enforces Article field, author-count, and aggregate byte limits', async () => {
	const cases: readonly {
		readonly name: string;
		readonly articleContexts: ArticleContextInput[];
		readonly error: RegExp;
	}[] = [{
		name: 'required field',
		articleContexts: [createArticleContext({ title: '' })],
		error: /title.*non-empty string/i,
	}, {
		name: 'author count',
		articleContexts: [createArticleContext({
			authors: Array.from({ length: 257 }, (_, index) => `Author ${index}`),
		})],
		error: /author count.*256/i,
	}, {
		name: 'aggregate bytes',
		articleContexts: Array.from({ length: 5 }, (_, index) => createArticleContext({
			sourceUrl: `https://example.test/article-${index}`,
			abstract: 'a'.repeat(900_000),
		})),
		error: /aggregate limit/i,
	}];

	for (const testCase of cases) {
		await assert.rejects(
			runMainAgentTurn(createAgentPayload({ articleContexts: testCase.articleContexts })),
			testCase.error,
			testCase.name,
		);
	}
});
