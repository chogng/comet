/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { suite, test } from 'node:test';

import { CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import { CancellationError } from 'cs/base/common/errors';
import type { IAgentExecutionProfileRequest, IAgentModelDescriptor } from 'cs/platform/agentHost/common/agent';
import type { IAgentHostInteractionTarget } from 'cs/platform/agentHost/common/attachments';
import {
	AgentConfigurationSchemaProfile,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import {
	createAgentAttachmentId,
	createAgentAttachmentProducerTypeId,
	createAgentAttachmentRepresentationSchemaId,
	createAgentChatId,
	createAgentContentDigest,
	createAgentContentReferenceId,
	createAgentContentVersion,
	createAgentConfigurationStateRevision,
	createAgentDescriptorRevision,
	createAgentExecutionPresetId,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentInteractionTargetId,
	createAgentInteractionTargetOwnerId,
	createAgentInteractionTargetRevision,
	createAgentInteractionTargetTypeId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
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
import type { AgentContentTreeEntry } from 'cs/platform/agentHost/common/contentResources';
import { encodeAgentHostProtocolValue, type AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	computeAgentToolMutationPayloadDigest,
	type IAgentToolRegistration,
	type IAgentToolSet,
} from 'cs/platform/agentHost/common/tools';
import { COMET_AGENT_ID } from 'cs/platform/agentHost/node/agents/comet/cometAgent';
import { CometModelError, type ICometModelAttachment, type ICometModelStepRequest } from 'cs/platform/agentHost/node/agents/comet/cometModel';
import {
	OpenAIResponsesExecutionProfileResolver,
	OpenAIResponsesModelRuntime,
	type IOpenAIResponsesConnectionResolver,
	type IOpenAIResponsesExecutionSettings,
} from 'cs/platform/agentHost/node/agents/comet/providers/openAIResponses';

const modelId = createAgentModelId('openai-model');
const modelRevision = createAgentModelDescriptorRevision('openai-model.v1');
const agentDescriptorRevision = createAgentDescriptorRevision('comet.descriptor.v2');
const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.runtime.v1');
const sessionId = createAgentSessionId('session-1');
const chatId = createAgentChatId('chat-1');
const currentTurnId = createAgentTurnId('turn-2');
const previousTurnId = createAgentTurnId('turn-1');
const registrationId = createAgentToolRegistrationId('read-target-registration');
const targetType = createAgentInteractionTargetTypeId('browser.document');
const targetId = createAgentInteractionTargetId('target-1');
const sessionConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: COMET_AGENT_ID,
	scope: 'session',
	revision: 'openai-responses.session-configuration.v1',
	properties: [],
});
const sessionConfiguration = validateAndFreezeAgentConfigurationState({
	schema: sessionConfigurationSchema,
	revision: createAgentConfigurationStateRevision('openai-responses.session-state.v1'),
	values: {},
});
const modelConfigurationSchema = validateAndFreezeAgentConfigurationSchema({
	profile: AgentConfigurationSchemaProfile,
	agent: COMET_AGENT_ID,
	scope: 'model',
	revision: 'openai-responses.model-configuration.v1',
	properties: [],
});
const modelConfiguration = validateAndFreezeAgentConfigurationCandidate(
	modelConfigurationSchema,
	{ schema: modelConfigurationSchema.revision, values: {} },
	'model',
	true,
);

const settings: IOpenAIResponsesExecutionSettings = {
	version: 1,
	maxOutputTokens: 4_096,
	temperature: null,
	reasoning: { effort: 'medium', summary: 'detailed' },
	serviceTier: 'default',
	parallelToolCalls: false,
};

const descriptor: IAgentModelDescriptor = {
	id: modelId,
	revision: modelRevision,
	displayName: 'OpenAI Responses test model',
	enabled: true,
	configurationSchema: modelConfigurationSchema,
	toolSchemaProfiles: [COMET_TOOL_SCHEMA_PROFILE],
	attachments: {
		carriers: ['inline', 'reference'],
		shapes: ['blob', 'tree'],
		mediaTypes: [
			'application/json',
			'application/vnd.comet.directory+json',
			'text/plain',
			'image/png',
		],
		maximumCount: 8,
		maximumItemBytes: 1024 * 1024,
		maximumTotalBytes: 4 * 1024 * 1024,
		maximumTreeDepth: 8,
		maximumTreeEntries: 64,
		supportsClientContentForBackgroundExecution: true,
	},
};

const inputSchema = {
	type: 'object',
	properties: {
		query: { type: 'string' },
	},
	required: ['query'],
	additionalProperties: false,
} as const;

const outputSchema = {
	type: 'object',
	properties: {
		content: { type: 'string' },
	},
	required: ['content'],
	additionalProperties: false,
} as const;

function toolRegistration(): IAgentToolRegistration {
	return {
		id: registrationId,
		revision: createAgentToolRegistrationRevision('read-target-registration.v1'),
		descriptor: {
			id: createAgentToolId('browser.read-target'),
			revision: createAgentToolDescriptorRevision('browser.read-target.v1'),
			contributor: createAgentToolContributorId('browser'),
			functionName: 'read_exact_target',
			displayName: 'Read exact target',
			description: 'Read the accepted interaction target.',
			inputSchema: { profile: COMET_TOOL_SCHEMA_PROFILE, value: inputSchema },
			outputSchema: { profile: COMET_TOOL_SCHEMA_PROFILE, value: outputSchema },
			safety: 'read',
			confirmation: 'never',
			allowsEditedInput: false,
			targetTypes: [targetType],
			limits: {
				maximumInputBytes: 4_096,
				maximumOutputBytes: 32_768,
				maximumContentBytes: 32_768,
				timeoutMilliseconds: 5_000,
				maximumConcurrency: 1,
			},
		},
		executor: { kind: 'host', executor: createAgentToolExecutorId('browser-reader') },
	};
}

function mutationToolRegistration(): IAgentToolRegistration {
	return {
		...toolRegistration(),
		id: createAgentToolRegistrationId('mutate-registration'),
		revision: createAgentToolRegistrationRevision('mutate-registration.v1'),
		descriptor: {
			...toolRegistration().descriptor,
			id: createAgentToolId('browser.mutate'),
			revision: createAgentToolDescriptorRevision('browser.mutate.v1'),
			functionName: 'mutate_exactly',
			displayName: 'Mutate exactly',
			description: 'Apply the exact requested mutation.',
			safety: 'write',
			confirmation: 'always',
			targetTypes: [],
		},
	};
}

function toolSet(registrations: readonly IAgentToolRegistration[] = []): IAgentToolSet {
	return {
		revision: createAgentToolSetRevision('tool-set-1'),
		schemaProfile: COMET_TOOL_SCHEMA_PROFILE,
		runtimeRegistration,
		agentDescriptor: agentDescriptorRevision,
		modelDescriptor: modelRevision,
		registrations,
	};
}

function target(): IAgentHostInteractionTarget {
	return {
		id: targetId,
		owner: createAgentInteractionTargetOwnerId('browser'),
		type: targetType,
		schemaVersion: 1,
		resource: 'browser-view://view-1',
		resourceVersion: 'document-epoch-7',
		revision: createAgentInteractionTargetRevision('target-revision-1'),
		authority: { kind: 'host' },
		availability: 'turn',
		display: { label: 'Article page' },
	};
}

function response(output: readonly unknown[], overrides: Readonly<Record<string, unknown>> = {}): Response {
	return new Response(JSON.stringify({
		id: 'resp_1',
		model: 'gpt-test',
		status: 'completed',
		output,
		usage: { input_tokens: 10, output_tokens: 4, total_tokens: 14 },
		...overrides,
	}), {
		status: 200,
		headers: { 'content-type': 'application/json' },
	});
}

function runtime(
	fetchImplementation: (url: string, init: RequestInit) => Promise<Response>,
	maximumRequestMilliseconds = 5_000,
	connectionResolver: IOpenAIResponsesConnectionResolver = {
		resolve: async () => ({
			endpoint: 'https://api.example.test/v1/responses',
			apiKey: 'secret-test-key',
			providerModel: 'gpt-test',
		}),
	},
): OpenAIResponsesModelRuntime {
	return new OpenAIResponsesModelRuntime({
		id: 'openai.responses.gpt-test',
		descriptor,
		connectionResolver,
		maximumRequestMilliseconds,
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
		modelConfiguration,
		credentials: [],
		runtimeRegistration,
		settings: settings as unknown as AgentHostProtocolValue,
		systemPrompt: 'You are the exact Comet assistant.',
		session: sessionId,
		chat: chatId,
		turn: currentTurnId,
		workspace: {
			resource: 'workspace://test',
			label: 'Test workspace',
			folders: [{ resource: 'file:///workspace', workingDirectory: '/workspace', name: 'workspace' }],
		},
		step: 0,
		messages: [{ role: 'user', turn: currentTurnId, text: 'Current question' }],
		attachments: [],
		interactionTargets: [],
		toolSet: toolSet(),
		deadline: Date.now() + 10_000,
		outputConstraints: { format: 'text' },
		...overrides,
	};
}

function inlineAttachments(): readonly ICometModelAttachment[] {
	const textContent = {
		kind: 'inline' as const,
		mediaType: 'text/plain',
		encoding: 'utf8' as const,
		data: 'Exact attachment text',
		byteLength: 21,
		version: createAgentContentVersion('text-v1'),
		digest: createAgentContentDigest(`sha256:${'b'.repeat(64)}`),
	};
	const imageContent = {
		kind: 'inline' as const,
		mediaType: 'image/png',
		encoding: 'base64' as const,
		data: 'AQID',
		byteLength: 3,
		version: createAgentContentVersion('image-v1'),
		digest: createAgentContentDigest(`sha256:${'c'.repeat(64)}`),
	};
	return [
		{
			attachment: {
				envelopeVersion: 1,
				id: createAgentAttachmentId('text-1'),
				producerType: createAgentAttachmentProducerTypeId('text'),
				display: { label: 'Text attachment' },
				representation: {
					schema: createAgentAttachmentRepresentationSchemaId('comet.text.v1'),
					mediaType: 'text/plain',
					value: { kind: 'text' },
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
					value: { kind: 'image' },
				},
				content: imageContent,
				metadata: [],
			},
			content: { kind: 'inline', content: imageContent },
		},
	];
}

function digestBytes(bytes: Uint8Array | string) {
	return createAgentContentDigest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`);
}

function materializedBlobAttachment(
	id: string,
	mediaType: string,
	bytes: Uint8Array,
	resource: string,
): ICometModelAttachment {
	const digest = digestBytes(bytes);
	const content = {
		kind: 'reference' as const,
		reference: createAgentContentReferenceId(`reference-${id}`),
		owner: { kind: 'host' as const },
		shape: 'blob' as const,
		mediaType,
		bounds: { byteLength: bytes.byteLength, maximumReadLength: Math.max(1, Math.min(2, bytes.byteLength)) },
		version: createAgentContentVersion(digest),
		digest,
	};
	return {
		attachment: {
			envelopeVersion: 1,
			id: createAgentAttachmentId(id),
			producerType: createAgentAttachmentProducerTypeId('file'),
			display: { label: id },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.file.v1'),
				mediaType,
				value: { name: id, mediaType },
			},
			content,
			metadata: [],
		},
		content: { kind: 'materialized', content, resource, treeEntries: null },
	};
}

function treeFile(path: string, mediaType: string | null, bytes: Uint8Array): Extract<AgentContentTreeEntry, { readonly kind: 'file' }> {
	const digest = digestBytes(bytes);
	return Object.freeze({
		kind: 'file',
		path,
		mediaType,
		byteLength: bytes.byteLength,
		version: createAgentContentVersion(digest),
		digest,
	});
}

function materializedTreeAttachment(
	id: string,
	entries: readonly AgentContentTreeEntry[],
	resource: string,
	digest = digestBytes(encodeAgentHostProtocolValue(entries)),
): ICometModelAttachment {
	const files = entries.filter((entry): entry is Extract<AgentContentTreeEntry, { readonly kind: 'file' }> => entry.kind === 'file');
	const byteLength = files.reduce((total, entry) => total + entry.byteLength, 0);
	const treeDepth = Math.max(...entries.map(entry => entry.path.split('/').length));
	const content = {
		kind: 'reference' as const,
		reference: createAgentContentReferenceId(`reference-${id}`),
		owner: { kind: 'host' as const },
		shape: 'tree' as const,
		bounds: {
			byteLength,
			maximumReadLength: Math.max(1, Math.min(2, byteLength)),
			treeDepth,
			treeEntryCount: entries.length,
		},
		version: createAgentContentVersion(digest),
		digest,
	};
	return {
		attachment: {
			envelopeVersion: 1,
			id: createAgentAttachmentId(id),
			producerType: createAgentAttachmentProducerTypeId('files.directory'),
			display: { label: id },
			representation: {
				schema: createAgentAttachmentRepresentationSchemaId('comet.directory.v1'),
				mediaType: 'application/vnd.comet.directory+json',
				value: { name: id },
			},
			content,
			metadata: [],
		},
		content: { kind: 'materialized', content, resource, treeEntries: entries },
	};
}

async function assertModelError(promise: Promise<unknown>, code: CometModelError['code']): Promise<void> {
	await assert.rejects(promise, error => {
		assert.ok(error instanceof CometModelError);
		assert.equal(error.code, code);
		return true;
	});
}

suite('OpenAIResponsesExecutionProfileResolver', () => {
	test('resolves exact model and product selections without defaults', async () => {
		const preset = createAgentExecutionPresetId('balanced');
		const resolver = new OpenAIResponsesExecutionProfileResolver({
			models: [{ model: modelId, modelRuntime: 'openai.responses.gpt-test', settings, maximumSteps: 6 }],
			productPresets: [{ preset, modelRuntime: 'openai.responses.gpt-test', settings, maximumSteps: 4 }],
		});
		const base = {
			submission: createAgentSubmissionId('submission-1'),
			selectionDigest: createAgentHostPayloadDigest(`sha256:${'d'.repeat(64)}`),
			runtimeRegistration,
			sessionConfiguration,
		};
		const user = await resolver.resolve({
			...base,
			selection: { kind: 'user', value: { model: modelId }, configuration: modelConfiguration },
		});
		assert.equal(user.modelRuntime, 'openai.responses.gpt-test');
		assert.equal(user.maximumSteps, 6);
		assert.deepEqual(user.settings, settings);
		const product = await resolver.resolve({
			...base,
			selection: { kind: 'product', value: { preset }, configuration: modelConfiguration },
		});
		assert.equal(product.maximumSteps, 4);
		const selectionWithUnknownField: IAgentExecutionProfileRequest = {
			...base,
			selection: {
				kind: 'user',
				value: { model: modelId, fallback: preset },
				configuration: modelConfiguration,
			},
		};
		await assertModelError(resolver.resolve(selectionWithUnknownField), 'invalidExecutionSelection');
		await assertModelError(resolver.resolve({
			...base,
			selection: {
				kind: 'user',
				value: { model: createAgentModelId('unknown-model') },
				configuration: modelConfiguration,
			},
		}), 'invalidExecutionSelection');
	});
});

suite('OpenAIResponsesModelRuntime', () => {
	test('rejects plaintext HTTP endpoints before sending credentials', async () => {
		let fetchCalls = 0;
		const model = runtime(
			async () => {
				fetchCalls += 1;
				return response([]);
			},
			5_000,
			{
				resolve: async () => ({
					endpoint: 'http://attacker.example.test/v1/responses',
					apiKey: 'secret-test-key',
					providerModel: 'gpt-test',
				}),
			},
		);
		await assertModelError(model.executeStep(stepRequest(), CancellationTokenNone), 'invalidConfiguration');
		assert.equal(fetchCalls, 0);
	});

	test('registers without credentials and fails execution with a typed authentication error', async () => {
		let fetchCalls = 0;
		const model = runtime(
			async () => {
				fetchCalls += 1;
				return response([]);
			},
			5_000,
			{
				resolve: async () => ({
					endpoint: 'https://api.example.test/v1/responses',
					apiKey: '',
					providerModel: 'gpt-test',
				}),
			},
		);
		assert.equal(model.descriptor.id, modelId);
		await assertModelError(model.executeStep(stepRequest(), CancellationTokenNone), 'providerCredentialRequired');
		assert.equal(fetchCalls, 0);
	});

	test('strictly converts canonical history, tools, targets, workspace, text, and images', async () => {
		let capturedUrl: string | undefined;
		let capturedInit: RequestInit | undefined;
		const model = runtime(async (url, init) => {
			capturedUrl = url;
			capturedInit = init;
			return response([{
				type: 'message',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text: 'Converted.', annotations: [] }],
			}]);
		});
		const historicalCall = createAgentToolCallId('call-history-1');
		const result = await model.executeStep(stepRequest({
			messages: [
				{ role: 'user', turn: previousTurnId, text: 'Earlier question' },
				{
					role: 'assistant',
					turn: previousTurnId,
					parts: [{
						kind: 'toolCall',
						call: {
							id: historicalCall,
							registrationId,
							input: { query: 'earlier' },
							target: targetId,
							effect: { kind: 'read' },
						},
					}],
				},
				{ role: 'tool', turn: previousTurnId, result: { call: historicalCall, status: 'completed', output: { content: 'Exact result' } } },
				{ role: 'user', turn: currentTurnId, text: 'Current question' },
			],
			attachments: inlineAttachments(),
			interactionTargets: [target()],
			toolSet: toolSet([toolRegistration()]),
		}), CancellationTokenNone);

		assert.equal(result.stopReason, 'completed');
		assert.equal(capturedUrl, 'https://api.example.test/v1/responses');
		assert.ok(capturedInit !== undefined);
		assert.equal(capturedInit.method, 'POST');
		assert.equal((capturedInit.headers as Record<string, string>).Authorization, 'Bearer secret-test-key');
		const body = JSON.parse(capturedInit.body as string) as Record<string, unknown>;
		assert.equal(body.model, 'gpt-test');
		assert.equal(body.store, false);
		assert.equal(body.truncation, 'disabled');
		assert.equal(body.max_output_tokens, 4_096);
		assert.equal(body.parallel_tool_calls, false);
		assert.match(body.instructions as string, /Canonical workspace context/);
		const tools = body.tools as Array<Record<string, unknown>>;
		assert.equal(tools.length, 1);
		assert.equal(tools[0].name, 'read_exact_target__target_1');
		assert.equal(tools[0].strict, true);
		assert.deepEqual(tools[0].parameters, inputSchema);
		assert.match(tools[0].description as string, /browser-view:\/\/view-1/);
		const input = body.input as Array<Record<string, unknown>>;
		assert.ok(input.some(item => item.type === 'function_call' && item.call_id === historicalCall));
		assert.ok(input.some(item => item.type === 'function_call_output' && item.call_id === historicalCall));
		const currentUser = input.find(item => item.type === 'message' && item.role === 'user'
			&& (item.content as Array<Record<string, unknown>>).some(content => content.text === 'Current question'));
		assert.ok(currentUser !== undefined);
		const currentContent = currentUser.content as Array<Record<string, unknown>>;
		assert.ok(currentContent.some(content => content.type === 'input_text' && (content.text as string).includes('Exact attachment text')));
		assert.ok(currentContent.some(content => content.type === 'input_image'
			&& content.image_url === 'data:image/png;base64,AQID'));
	});

	test('converts text and reasoning output in provider order', async () => {
		const model = runtime(async () => response([
			{
				type: 'reasoning',
				status: 'completed',
				summary: [{ type: 'summary_text', text: 'Checked the constraints.' }],
			},
			{
				type: 'message',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text: 'Final answer.', annotations: [] }],
			},
		]));
		const result = await model.executeStep(stepRequest(), CancellationTokenNone);
		assert.deepEqual(result.parts, [
			{ kind: 'reasoning', text: 'Checked the constraints.' },
			{ kind: 'text', text: 'Final answer.' },
		]);
		assert.deepEqual(result.usage, { input_tokens: 10, output_tokens: 4, total_tokens: 14 });
	});

	test('maps exact provider call identity, name, target, input, and effect', async () => {
		const model = runtime(async () => response([{
			type: 'function_call',
			status: 'completed',
			call_id: 'call-provider-1',
			name: 'read_exact_target__target_1',
			arguments: '{"query":"exact"}',
		}]));
		const result = await model.executeStep(stepRequest({
			interactionTargets: [target()],
			toolSet: toolSet([toolRegistration()]),
		}), CancellationTokenNone);
		assert.equal(result.stopReason, 'toolCalls');
		assert.deepEqual(result.parts, [{
			kind: 'toolCall',
			call: {
				id: 'call-provider-1',
				registrationId,
				input: { query: 'exact' },
				target: targetId,
				effect: { kind: 'read' },
			},
		}]);
	});

	test('binds a mutation effect to the exact canonical call payload digest', async () => {
		const registration = mutationToolRegistration();
		const model = runtime(async () => response([{
			type: 'function_call',
			status: 'completed',
			call_id: 'mutation-call-1',
			name: 'mutate_exactly',
			arguments: '{"query":"apply"}',
		}]));
		const request = stepRequest({ toolSet: toolSet([registration]) });
		const result = await model.executeStep(request, CancellationTokenNone);
		const part = result.parts[0];
		assert.equal(part?.kind, 'toolCall');
		if (part?.kind !== 'toolCall' || part.call.effect.kind !== 'mutation') {
			assert.fail('Expected one mutating Tool call');
		}
		assert.equal(part.call.effect.operation, 'mutation-call-1');
		const expectedDigest = await computeAgentToolMutationPayloadDigest({
			id: createAgentToolCallId('mutation-call-1'),
			agent: COMET_AGENT_ID,
			registration: runtimeRegistration,
			session: sessionId,
			chat: chatId,
			turn: currentTurnId,
			toolSet: request.toolSet.revision,
			tool: registration.descriptor.id,
			descriptor: registration.descriptor.revision,
			registrationId: registration.id,
			registrationRevision: registration.revision,
			input: { query: 'apply' },
			effect: { kind: 'mutation', operation: createAgentHostOperationId('mutation-call-1') },
			deadline: request.deadline,
		});
		assert.equal(part.call.effect.payloadDigest, expectedDigest);
	});

	test('returns typed errors for malformed, unknown, and invalid provider output', async t => {
		const cases: readonly { readonly name: string; readonly output: readonly unknown[]; readonly overrides?: Readonly<Record<string, unknown>> }[] = [
			{
				name: 'missing call_id',
				output: [{ type: 'function_call', status: 'completed', name: 'read_exact_target__target_1', arguments: '{"query":"x"}' }],
			},
			{
				name: 'missing name',
				output: [{ type: 'function_call', status: 'completed', call_id: 'call-1', arguments: '{"query":"x"}' }],
			},
			{
				name: 'malformed arguments JSON',
				output: [{ type: 'function_call', status: 'completed', call_id: 'call-1', name: 'read_exact_target__target_1', arguments: '{' }],
			},
			{
				name: 'unknown function',
				output: [{ type: 'function_call', status: 'completed', call_id: 'call-1', name: 'unknown_tool', arguments: '{"query":"x"}' }],
			},
			{
				name: 'invalid item status',
				output: [{ type: 'function_call', status: 'incomplete', call_id: 'call-1', name: 'read_exact_target__target_1', arguments: '{"query":"x"}' }],
			},
			{
				name: 'refusal output',
				output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'refusal', refusal: 'No.' }] }],
			},
			{
				name: 'incomplete response',
				output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'partial' }] }],
				overrides: { status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
			},
		];
		for (const entry of cases) {
			await t.test(entry.name, async () => {
				const model = runtime(async () => response(entry.output, entry.overrides));
				await assertModelError(model.executeStep(stepRequest({
					interactionTargets: [target()],
					toolSet: toolSet([toolRegistration()]),
				}), CancellationTokenNone), 'invalidProviderResponse');
			});
		}
	});

	test('projects verified materialized image and file blobs without changing media', async t => {
		const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'comet-openai-blob-')));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		const textBytes = new TextEncoder().encode('Exact materialized file');
		const imageBytes = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
		const textResource = path.join(temporary, 'text-content');
		const imageResource = path.join(temporary, 'image-content');
		await writeFile(textResource, textBytes);
		await writeFile(imageResource, imageBytes);
		let requestBody: Record<string, unknown> | undefined;
		const model = runtime(async (_url, init) => {
			requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
			return response([{
				type: 'message',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text: 'Read.', annotations: [] }],
			}]);
		});
		await model.executeStep(stepRequest({
			attachments: [
				materializedBlobAttachment('materialized-text', 'text/plain', textBytes, textResource),
				materializedBlobAttachment('materialized-image', 'image/png', imageBytes, imageResource),
			],
		}), CancellationTokenNone);
		assert.ok(requestBody !== undefined);
		const current = (requestBody.input as Array<Record<string, unknown>>).find(item => item.type === 'message' && item.role === 'user');
		assert.ok(current !== undefined);
		const content = current.content as Array<Record<string, unknown>>;
		const file = content.find(item => item.type === 'input_file');
		assert.deepEqual(file, {
			type: 'input_file',
			filename: 'comet-attachment-1.txt',
			file_data: `data:text/plain;base64,${Buffer.from(textBytes).toString('base64')}`,
		});
		assert.ok(content.some(item => item.type === 'input_image'
			&& item.image_url === `data:image/png;base64,${Buffer.from(imageBytes).toString('base64')}`));
	});

	test('projects one verified materialized tree as one canonical JSON input_file', async t => {
		const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'comet-openai-tree-')));
		t.after(() => rm(temporary, { recursive: true, force: true }));
		const root = path.join(temporary, 'tree');
		await mkdir(path.join(root, 'docs'), { recursive: true });
		const nestedBytes = new TextEncoder().encode('Nested exact bytes');
		const rootBytes = new TextEncoder().encode('{"exact":true}');
		await writeFile(path.join(root, 'docs', 'note.txt'), nestedBytes);
		await writeFile(path.join(root, 'root.json'), rootBytes);
		const entries: readonly AgentContentTreeEntry[] = Object.freeze([
			Object.freeze({ kind: 'directory', path: 'docs' }),
			treeFile('docs/note.txt', 'text/plain', nestedBytes),
			treeFile('root.json', 'application/json', rootBytes),
		]);
		let requestBody: Record<string, unknown> | undefined;
		const model = runtime(async (_url, init) => {
			requestBody = JSON.parse(init.body as string) as Record<string, unknown>;
			return response([{
				type: 'message',
				role: 'assistant',
				status: 'completed',
				content: [{ type: 'output_text', text: 'Read tree.', annotations: [] }],
			}]);
		});
		await model.executeStep(stepRequest({
			attachments: [materializedTreeAttachment('materialized-tree', entries, root)],
		}), CancellationTokenNone);
		assert.ok(requestBody !== undefined);
		const current = (requestBody.input as Array<Record<string, unknown>>).find(item => item.type === 'message' && item.role === 'user');
		assert.ok(current !== undefined);
		const content = current.content as Array<Record<string, unknown>>;
		const files = content.filter(item => item.type === 'input_file');
		assert.equal(files.length, 1);
		assert.equal(files[0].filename, 'comet-directory-1.json');
		const fileData = files[0].file_data as string;
		assert.match(fileData, /^data:application\/json;base64,/);
		const bundle = JSON.parse(Buffer.from(fileData.slice(fileData.indexOf(',') + 1), 'base64').toString('utf8')) as {
			readonly schema: string;
			readonly entries: readonly Record<string, unknown>[];
		};
		assert.equal(bundle.schema, 'comet.materialized-tree.v1');
		assert.equal(bundle.entries.length, 3);
		assert.deepEqual(bundle.entries[0], { kind: 'directory', path: 'docs' });
		assert.equal((bundle.entries[1].content as Record<string, unknown>).data, Buffer.from(nestedBytes).toString('base64'));
		assert.equal((bundle.entries[2].content as Record<string, unknown>).data, Buffer.from(rootBytes).toString('base64'));
		assert.equal(content.filter(item => item.type === 'input_text'
			&& typeof item.text === 'string'
			&& item.text.includes('Nested exact bytes')).length, 0);
	});

	test('rejects materialized tree tampering before issuing a request', async t => {
		const cases = [
			'extra entry',
			'symbolic link',
			'manifest order',
			'manifest digest',
		] as const;
		for (const kind of cases) {
			await t.test(kind, async testContext => {
				if (kind === 'symbolic link' && process.platform === 'win32') {
					testContext.skip('Creating file symbolic links requires an elevated Windows process.');
					return;
				}
				const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'comet-openai-tree-tamper-')));
				testContext.after(() => rm(temporary, { recursive: true, force: true }));
				const root = path.join(temporary, 'tree');
				await mkdir(root);
				const firstBytes = new TextEncoder().encode('first');
				const secondBytes = new TextEncoder().encode('second');
				await writeFile(path.join(root, 'a.txt'), firstBytes);
				let entries: readonly AgentContentTreeEntry[] = [treeFile('a.txt', 'text/plain', firstBytes)];
				let digest = digestBytes(encodeAgentHostProtocolValue(entries));
				if (kind === 'extra entry') {
					await writeFile(path.join(root, 'extra.txt'), secondBytes);
				} else if (kind === 'symbolic link') {
					await rm(path.join(root, 'a.txt'));
					await writeFile(path.join(temporary, 'outside.txt'), firstBytes);
					await symlink(path.join(temporary, 'outside.txt'), path.join(root, 'a.txt'));
				} else if (kind === 'manifest order') {
					await writeFile(path.join(root, 'b.txt'), secondBytes);
					entries = [
						treeFile('b.txt', 'text/plain', secondBytes),
						treeFile('a.txt', 'text/plain', firstBytes),
					];
					digest = digestBytes(encodeAgentHostProtocolValue(entries));
				} else {
					digest = createAgentContentDigest(`sha256:${'f'.repeat(64)}`);
				}
				let fetchCalls = 0;
				const model = runtime(async () => {
					fetchCalls += 1;
					return response([]);
				});
				await assertModelError(model.executeStep(stepRequest({
					attachments: [materializedTreeAttachment(`tampered-tree-${kind.replace(' ', '-')}`, entries, root, digest)],
				}), CancellationTokenNone), 'unsupportedAttachment');
				assert.equal(fetchCalls, 0);
			});
		}
	});

	test('cancellation aborts the in-flight fetch and rejects with CancellationError', async () => {
		let signal: AbortSignal | undefined;
		let markStarted: (() => void) | undefined;
		const started = new Promise<void>(resolve => {
			markStarted = resolve;
		});
		const model = runtime(async (_url, init) => {
			signal = init.signal as AbortSignal;
			markStarted?.();
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
			});
		});
		const cancellation = new CancellationTokenSource();
		const execution = model.executeStep(stepRequest(), cancellation.token);
		await started;
		cancellation.cancel();
		await assert.rejects(execution, error => error instanceof CancellationError);
		assert.equal(signal?.aborted, true);
		cancellation.dispose();
	});

	test('deadline aborts the in-flight fetch and returns the typed deadline code', async () => {
		let signal: AbortSignal | undefined;
		const model = runtime(async (_url, init) => {
			signal = init.signal as AbortSignal;
			return new Promise<Response>((_resolve, reject) => {
				signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
			});
		}, 20);
		await assertModelError(model.executeStep(stepRequest(), CancellationTokenNone), 'deadlineExceeded');
		assert.equal(signal?.aborted, true);
	});
});
