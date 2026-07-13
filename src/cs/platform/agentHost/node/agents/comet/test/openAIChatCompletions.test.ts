/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test } from 'node:test';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import type { IAgentModelDescriptor } from 'cs/platform/agentHost/common/agent';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentChatId,
	createAgentContentDigest,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type IAgentToolRegistration,
	type IAgentToolSet,
} from 'cs/platform/agentHost/common/tools';
import {
	CometModelError,
	type ICometModelAttachment,
	type ICometModelStepRequest,
} from 'cs/platform/agentHost/node/agents/comet/cometModel';
import {
	OpenAIChatCompletionsModelRuntime,
	type IOpenAIChatCompletionsConnectionResolver,
	type IOpenAIChatCompletionsExecutionSettings,
} from 'cs/platform/agentHost/node/agents/comet/providers/openAIChatCompletions';

const modelId = createAgentModelId('chat-model');
const modelRevision = createAgentModelDescriptorRevision('chat-model.v1');
const agentDescriptorRevision = createAgentDescriptorRevision('comet.descriptor.v1');
const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.runtime.v1');
const sessionId = createAgentSessionId('session-1');
const chatId = createAgentChatId('chat-1');
const turnId = createAgentTurnId('turn-1');
const registrationId = createAgentToolRegistrationId('read-registration');

const descriptor: IAgentModelDescriptor = {
	id: modelId,
	revision: modelRevision,
	displayName: 'Chat Completions test model',
	enabled: true,
	toolSchemaProfiles: [COMET_TOOL_SCHEMA_PROFILE],
	attachments: {
		carriers: ['inline', 'reference'],
		shapes: ['blob'],
		mediaTypes: ['application/vnd.comet.file+json', 'text/plain', 'application/json', 'image/png'],
		maximumCount: 8,
		maximumItemBytes: 1024 * 1024,
		maximumTotalBytes: 4 * 1024 * 1024,
		maximumTreeDepth: 0,
		maximumTreeEntries: 0,
		supportsClientContentForBackgroundExecution: true,
	},
};

const maxTokensSettings: IOpenAIChatCompletionsExecutionSettings = {
	version: 1,
	maxOutputTokens: 4_096,
	maximumOutputTokensField: 'max_tokens',
};

const inputSchema = {
	type: 'object',
	properties: { query: { type: 'string' } },
	required: ['query'],
	additionalProperties: false,
} as const;

const outputSchema = {
	type: 'object',
	properties: { content: { type: 'string' } },
	required: ['content'],
	additionalProperties: false,
} as const;

function toolRegistration(): IAgentToolRegistration {
	return {
		id: registrationId,
		revision: createAgentToolRegistrationRevision('read-registration.v1'),
		descriptor: {
			id: createAgentToolId('workspace.read'),
			revision: createAgentToolDescriptorRevision('workspace.read.v1'),
			contributor: createAgentToolContributorId('workspace'),
			functionName: 'read_exactly',
			displayName: 'Read exactly',
			description: 'Read the exact requested value.',
			inputSchema: { profile: COMET_TOOL_SCHEMA_PROFILE, value: inputSchema },
			outputSchema: { profile: COMET_TOOL_SCHEMA_PROFILE, value: outputSchema },
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			targetTypes: [],
			limits: {
				maximumInputBytes: 4_096,
				maximumOutputBytes: 32_768,
				maximumContentBytes: 32_768,
				timeoutMilliseconds: 5_000,
				maximumConcurrency: 1,
			},
		},
		executor: { kind: 'host', executor: createAgentToolExecutorId('workspace-reader') },
	};
}

function toolSet(registrations: readonly IAgentToolRegistration[] = []): IAgentToolSet {
	return {
		revision: createAgentToolSetRevision('tool-set.v1'),
		schemaProfile: COMET_TOOL_SCHEMA_PROFILE,
		runtimeRegistration,
		agentDescriptor: agentDescriptorRevision,
		modelDescriptor: modelRevision,
		registrations,
	};
}

function chatResponse(
	message: Readonly<Record<string, unknown>>,
	finishReason: string,
	overrides: Readonly<Record<string, unknown>> = {},
): Response {
	return new Response(JSON.stringify({
		id: 'chatcmpl-1',
		object: 'chat.completion',
		created: 1_700_000_000,
		model: 'provider-model',
		choices: [{ index: 0, message, finish_reason: finishReason }],
		usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
		...overrides,
	}), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function runtime(
	fetchImplementation: (url: string, init: RequestInit) => Promise<Response>,
	connectionResolver: IOpenAIChatCompletionsConnectionResolver = {
		resolve: async () => ({
			endpoint: 'https://chat.example.test/v1/chat/completions',
			apiKey: 'secret-test-key',
			providerModel: 'provider-model',
		}),
	},
): OpenAIChatCompletionsModelRuntime {
	return new OpenAIChatCompletionsModelRuntime({
		id: 'openai.chat-completions.provider.model',
		descriptor,
		connectionResolver,
		maximumRequestMilliseconds: 5_000,
		maximumRequestBytes: 8 * 1024 * 1024,
		maximumResponseBytes: 8 * 1024 * 1024,
		fetch: fetchImplementation,
		now: Date.now,
	});
}

function stepRequest(overrides: Partial<ICometModelStepRequest> = {}): ICometModelStepRequest {
	return {
		profile: {
			revision: createAgentExecutionProfileRevision('profile.v1'),
			digest: createAgentExecutionProfileDigest(`sha256:${'a'.repeat(64)}`),
			agentDescriptor: agentDescriptorRevision,
			modelDescriptor: modelRevision,
			data: '{}',
		},
		settings: maxTokensSettings as unknown as AgentHostProtocolValue,
		systemPrompt: 'You are the exact Comet assistant.',
		session: sessionId,
		chat: chatId,
		turn: turnId,
		workspace: {
			resource: 'workspace://test',
			label: 'Test workspace',
			folders: [{ resource: 'file:///workspace', workingDirectory: '/workspace', name: 'workspace' }],
		},
		step: 0,
		messages: [{ role: 'user', turn: turnId, text: 'Current question' }],
		attachments: [],
		interactionTargets: [],
		toolSet: toolSet(),
		deadline: Date.now() + 10_000,
		outputConstraints: { format: 'text' },
		...overrides,
	};
}

function digest(data: Uint8Array | string) {
	return createAgentContentDigest(`sha256:${createHash('sha256').update(data).digest('hex')}`);
}

function inlineAttachments(): readonly ICometModelAttachment[] {
	const textData = 'Exact attachment text';
	const textContent = {
		kind: 'inline' as const,
		mediaType: 'text/plain',
		encoding: 'utf8' as const,
		data: textData,
		byteLength: new TextEncoder().encode(textData).byteLength,
		version: createAgentContentVersion('text-v1'),
		digest: digest(textData),
	};
	const imageBytes = Uint8Array.from([1, 2, 3]);
	const imageContent = {
		kind: 'inline' as const,
		mediaType: 'image/png',
		encoding: 'base64' as const,
		data: Buffer.from(imageBytes).toString('base64'),
		byteLength: imageBytes.byteLength,
		version: createAgentContentVersion('image-v1'),
		digest: digest(imageBytes),
	};
	return [
		{
			attachment: {
				envelopeVersion: 1,
				id: createAgentAttachmentId('text-1'),
				producerType: createAgentAttachmentProducerTypeId('file'),
				display: { label: 'Text attachment' },
				representation: {
					schema: createAgentAttachmentRepresentationSchemaId('comet.file.v1'),
					mediaType: 'application/vnd.comet.file+json',
					value: { name: 'notes.txt' },
				},
				content: textContent,
				metadata: [],
			},
			content: { kind: 'inline', content: textContent },
		},
		{
			attachment: {
				envelopeVersion: 1,
				id: createAgentAttachmentId('image-1'),
				producerType: createAgentAttachmentProducerTypeId('image'),
				display: { label: 'Image attachment' },
				representation: {
					schema: createAgentAttachmentRepresentationSchemaId('comet.image.v1'),
					mediaType: 'image/png',
					value: { name: 'image.png' },
				},
				content: imageContent,
				metadata: [],
			},
			content: { kind: 'inline', content: imageContent },
		},
	];
}

function materializedBlobAttachment(bytes: Uint8Array, resource: string): ICometModelAttachment {
	const contentDigest = digest(bytes);
	const content = {
		kind: 'reference' as const,
		reference: createAgentContentReferenceId('materialized-reference'),
		owner: { kind: 'host' as const },
		shape: 'blob' as const,
		mediaType: 'text/plain',
		bounds: { byteLength: bytes.byteLength, maximumReadLength: 2 },
		version: createAgentContentVersion(contentDigest),
		digest: contentDigest,
	};
	return {
		attachment: {
			envelopeVersion: 1,
			id: createAgentAttachmentId('materialized-text'),
			producerType: createAgentAttachmentProducerTypeId('file'),
			display: { label: 'Materialized text' },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.file.v1'),
				mediaType: 'application/vnd.comet.file+json',
				value: { name: 'materialized.txt' },
			},
			content,
			metadata: [],
		},
		content: { kind: 'materialized', content, resource, treeEntries: null },
	};
}

function treeAttachment(): ICometModelAttachment {
	const contentDigest = digest('tree');
	const content = {
		kind: 'reference' as const,
		reference: createAgentContentReferenceId('tree-reference'),
		owner: { kind: 'host' as const },
		shape: 'tree' as const,
		bounds: { byteLength: 1, maximumReadLength: 1, treeDepth: 1, treeEntryCount: 1 },
		version: createAgentContentVersion(contentDigest),
		digest: contentDigest,
	};
	return {
		attachment: {
			envelopeVersion: 1,
			id: createAgentAttachmentId('tree'),
			producerType: createAgentAttachmentProducerTypeId('files.directory'),
			display: { label: 'Tree' },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.file.v1'),
				mediaType: 'application/vnd.comet.file+json',
				value: { name: 'tree' },
			},
			content,
			metadata: [],
		},
		content: { kind: 'materialized', content, resource: '/tmp/tree', treeEntries: [] },
	};
}

async function assertModelError(promise: Promise<unknown>, code: CometModelError['code']): Promise<void> {
	await assert.rejects(promise, error => {
		assert.ok(error instanceof CometModelError);
		assert.equal(error.code, code);
		return true;
	});
}

suite('OpenAIChatCompletionsModelRuntime', () => {
	test('projects native history, tools, text, images, workspace, and max_tokens', async () => {
		let capturedUrl: string | undefined;
		let capturedInit: RequestInit | undefined;
		const model = runtime(async (url, init) => {
			capturedUrl = url;
			capturedInit = init;
			return chatResponse({
				role: 'assistant',
				reasoning_content: 'Checked the exact request.',
				content: 'Converted.',
			}, 'stop');
		});
		const historicalCall = createAgentToolCallId('call-history-1');
		const result = await model.executeStep(stepRequest({
			messages: [
				{ role: 'user', turn: turnId, text: 'Current question' },
				{
					role: 'assistant',
					turn: turnId,
					parts: [
						{ kind: 'reasoning', text: 'Need the exact value.' },
						{
							kind: 'toolCall',
							call: {
								id: historicalCall,
								registrationId,
								input: { query: 'exact' },
								effect: { kind: 'read' },
							},
						},
					],
				},
				{ role: 'tool', turn: turnId, result: { call: historicalCall, status: 'completed', output: { content: 'Exact result' } } },
			],
			attachments: inlineAttachments(),
			toolSet: toolSet([toolRegistration()]),
		}), CancellationTokenNone);

		assert.equal(capturedUrl, 'https://chat.example.test/v1/chat/completions');
		assert.ok(capturedInit !== undefined);
		assert.equal((capturedInit.headers as Record<string, string>).Authorization, 'Bearer secret-test-key');
		const body = JSON.parse(capturedInit.body as string) as Record<string, unknown>;
		assert.equal(body.stream, false);
		assert.equal(body.max_tokens, 4_096);
		assert.equal(body.max_completion_tokens, undefined);
		const messages = body.messages as Array<Record<string, unknown>>;
		assert.equal(messages[0].role, 'system');
		assert.match(messages[0].content as string, /Canonical workspace context/);
		const historicalAssistant = messages[2];
		assert.equal(historicalAssistant.reasoning_content, 'Need the exact value.');
		assert.equal(historicalAssistant.content, null);
		assert.deepEqual(historicalAssistant.tool_calls, [{
			id: historicalCall,
			type: 'function',
			function: { name: 'read_exactly', arguments: '{"query":"exact"}' },
		}]);
		assert.deepEqual(messages[3], {
			role: 'tool',
			tool_call_id: historicalCall,
			content: '{"output":{"content":"Exact result"},"status":"completed"}',
		});
		const currentContent = messages[1].content as Array<Record<string, unknown>>;
		assert.ok(currentContent.some(part => part.type === 'text' && (part.text as string).includes('Exact attachment text')));
		assert.ok(currentContent.some(part => part.type === 'image_url'
			&& (part.image_url as Record<string, unknown>).url === 'data:image/png;base64,AQID'));
		const tools = body.tools as Array<Record<string, unknown>>;
		assert.deepEqual((tools[0].function as Record<string, unknown>).parameters, inputSchema);
		assert.deepEqual(result.parts, [
			{ kind: 'reasoning', text: 'Checked the exact request.' },
			{ kind: 'text', text: 'Converted.' },
		]);
		assert.deepEqual(result.usage, { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 });
	});

	test('uses max_completion_tokens only when the execution profile declares it', async () => {
		let requestBody: Record<string, unknown> | undefined;
		const model = runtime(async (_url, init) => {
			requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
			return chatResponse({ role: 'assistant', content: 'Done.' }, 'stop');
		});
		await model.executeStep(stepRequest({
			settings: {
				version: 1,
				maxOutputTokens: 32_768,
				maximumOutputTokensField: 'max_completion_tokens',
			},
		}), CancellationTokenNone);
		assert.equal(requestBody?.max_completion_tokens, 32_768);
		assert.equal(requestBody?.max_tokens, undefined);
	});

	test('maps Tool calls and preserves reasoning, calls, and results on the next native request', async () => {
		const requests: Array<Record<string, unknown>> = [];
		let invocation = 0;
		const model = runtime(async (_url, init) => {
			requests.push(JSON.parse(init.body as string) as Record<string, unknown>);
			invocation += 1;
			return invocation === 1
				? chatResponse({
					role: 'assistant',
					reasoning_content: 'Use the Tool.',
					content: null,
					tool_calls: [{
						id: 'call-provider-1',
						type: 'function',
						function: { name: 'read_exactly', arguments: '{"query":"next"}' },
					}],
				}, 'tool_calls')
				: chatResponse({ role: 'assistant', content: 'Finished.' }, 'stop');
		});
		const first = await model.executeStep(stepRequest({ toolSet: toolSet([toolRegistration()]) }), CancellationTokenNone);
		assert.equal(first.stopReason, 'toolCalls');
		assert.deepEqual(first.parts, [
			{ kind: 'reasoning', text: 'Use the Tool.' },
			{
				kind: 'toolCall',
				call: {
					id: 'call-provider-1',
					registrationId,
					input: { query: 'next' },
					effect: { kind: 'read' },
				},
			},
		]);
		const call = first.parts[1];
		assert.equal(call.kind, 'toolCall');
		if (call.kind !== 'toolCall') {
			assert.fail('Expected one Tool call');
		}
		await model.executeStep(stepRequest({
			step: 1,
			messages: [
				{ role: 'user', turn: turnId, text: 'Current question' },
				{ role: 'assistant', turn: turnId, parts: first.parts },
				{ role: 'tool', turn: turnId, result: { call: call.call.id, status: 'completed', output: { content: 'Next result' } } },
			],
			toolSet: toolSet([toolRegistration()]),
		}), CancellationTokenNone);
		const messages = requests[1].messages as Array<Record<string, unknown>>;
		assert.equal(messages[2].reasoning_content, 'Use the Tool.');
		assert.deepEqual(messages[2].tool_calls, [{
			id: 'call-provider-1',
			type: 'function',
			function: { name: 'read_exactly', arguments: '{"query":"next"}' },
		}]);
		assert.deepEqual(messages[3], {
			role: 'tool',
			tool_call_id: 'call-provider-1',
			content: '{"output":{"content":"Next result"},"status":"completed"}',
		});
	});

	test('reads a verified materialized text blob and rejects trees before fetch', async t => {
		const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'comet-chat-blob-')));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		const bytes = new TextEncoder().encode('Exact materialized text');
		const resource = path.join(temporary, 'content');
		await writeFile(resource, bytes);
		let requestBody: Record<string, unknown> | undefined;
		let fetchCalls = 0;
		const model = runtime(async (_url, init) => {
			fetchCalls += 1;
			requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
			return chatResponse({ role: 'assistant', content: 'Read.' }, 'stop');
		});
		await model.executeStep(stepRequest({ attachments: [materializedBlobAttachment(bytes, resource)] }), CancellationTokenNone);
		const messages = requestBody?.messages as Array<Record<string, unknown>>;
		assert.match(messages[1].content as string, /Exact materialized text/);
		await assertModelError(model.executeStep(stepRequest({ attachments: [treeAttachment()] }), CancellationTokenNone), 'unsupportedAttachment');
		assert.equal(fetchCalls, 1);
	});

	test('returns typed errors for HTTP failures, incomplete output, and malformed responses', async t => {
		await t.test('HTTP status', async () => {
			const model = runtime(async () => new Response('denied', { status: 401, headers: { 'content-type': 'text/plain' } }));
			await assertModelError(model.executeStep(stepRequest(), CancellationTokenNone), 'providerRequestFailed');
		});
		await t.test('length finish reason', async () => {
			const model = runtime(async () => chatResponse({ role: 'assistant', content: 'Partial' }, 'length'));
			await assertModelError(model.executeStep(stepRequest(), CancellationTokenNone), 'invalidProviderResponse');
		});
		await t.test('unknown response field', async () => {
			const model = runtime(async () => chatResponse({ role: 'assistant', content: 'Done.', unrepresented: true }, 'stop'));
			await assertModelError(model.executeStep(stepRequest(), CancellationTokenNone), 'invalidProviderResponse');
		});
	});
});
