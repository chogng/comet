/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CancellationTokenNone } from 'cs/base/common/cancellation';
import type { LlmSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostPayloadDigest,
	createAgentModelId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentChatId,
	createAgentSubmissionId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';
import { CometModelError, type ICometModelStepRequest } from 'cs/platform/agentHost/node/agents/comet/cometModel';
import {
	COMET_AUTOMATIC_EXECUTION_PRESET,
	createProductionCometModelCatalog,
} from 'cs/code/electron-main/agentHost/cometModelCatalog';
import {
	ArticleAttachmentContentMediaType,
	ArticleAttachmentRepresentationMediaType,
} from 'cs/workbench/contrib/fetch/common/articleChatAttachments';
import { createDefaultLlmSettings } from 'cs/workbench/services/llm/config';

const firstOption = 'openai:gpt-5.5:medium';
const secondOption = 'openai:gpt-5-codex:medium';
const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.runtime.v1');
const agentDescriptor = createAgentDescriptorRevision('comet.descriptor.v1');

function settings(apiKey: string, selectedModelOption: string, baseUrl: string): LlmSettings {
	const provider = (providerBaseUrl = '') => ({
		apiKey: '',
		baseUrl: providerBaseUrl,
		selectedModelOption: '',
		enabledModelOptions: [] as string[],
	});
	return {
		activeProvider: 'openai',
		providers: {
			glm: provider('https://open.bigmodel.cn/api/paas/v4'),
			kimi: provider('https://api.moonshot.cn/v1'),
			deepseek: provider('https://api.deepseek.com'),
			anthropic: provider(),
			openai: {
				apiKey,
				baseUrl,
				selectedModelOption,
				enabledModelOptions: [firstOption, secondOption],
			},
			gemini: provider('https://generativelanguage.googleapis.com/v1beta/openai/'),
			custom: provider(),
		},
	};
}

function stepRequest(
	runtime: ReturnType<typeof createProductionCometModelCatalog>['models'][number],
	executionSettings: AgentHostProtocolValue = {
		version: 1,
		maxOutputTokens: 32_768,
		temperature: null,
		reasoning: { effort: 'medium', summary: 'auto' },
		serviceTier: null,
		parallelToolCalls: true,
	},
): ICometModelStepRequest {
	const session = createAgentSessionId('session-1');
	const chat = createAgentChatId('chat-1');
	const turn = createAgentTurnId('turn-1');
	return {
		profile: {
			revision: createAgentExecutionProfileRevision('profile.v1'),
			digest: createAgentExecutionProfileDigest(`sha256:${'a'.repeat(64)}`),
			agentDescriptor,
			modelDescriptor: runtime.descriptor.revision,
			data: '{}',
		},
		settings: executionSettings,
		systemPrompt: 'Use the exact accepted request.',
		session,
		chat,
		turn,
		step: 0,
		messages: [{ role: 'user', turn, text: 'Question' }],
		attachments: [],
		interactionTargets: [],
		toolSet: {
			revision: createAgentToolSetRevision('tool-set.v1'),
			schemaProfile: COMET_TOOL_SCHEMA_PROFILE,
			runtimeRegistration,
			agentDescriptor,
			modelDescriptor: runtime.descriptor.revision,
			registrations: [],
		},
		deadline: Date.now() + 10_000,
		outputConstraints: { format: 'text' },
	};
}

async function assertModelError(promise: Promise<unknown>, code: CometModelError['code']): Promise<void> {
	await assert.rejects(promise, error => {
		assert.ok(error instanceof CometModelError);
		assert.equal(error.code, code);
		return true;
	});
}

test('production Comet catalog reloads the exact connection without selection fallback', async () => {
	let currentSettings = settings('', firstOption, 'https://api.openai.com/v1');
	let loadCalls = 0;
	let fetchCalls = 0;
	let capturedUrl: string | undefined;
	let capturedAuthorization: string | null = null;
	const catalog = createProductionCometModelCatalog({
		settings: currentSettings,
		loadSettings: async signal => {
			assert.equal(signal.aborted, false);
			loadCalls += 1;
			return currentSettings;
		},
		fetch: async (url, init) => {
			fetchCalls += 1;
			capturedUrl = url;
			capturedAuthorization = new Headers(init.headers).get('Authorization');
			return new Response(JSON.stringify({
				id: 'response-1',
				model: 'gpt-5.5',
				status: 'completed',
				output: [{
					type: 'message',
					role: 'assistant',
					status: 'completed',
					content: [{ type: 'output_text', text: 'Answer', annotations: [] }],
				}],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		},
		now: Date.now,
	});
	assert.equal(catalog.automaticPreset, COMET_AUTOMATIC_EXECUTION_PRESET);
	assert.deepEqual(catalog.models.map(model => model.descriptor.id), [
		createAgentModelId(firstOption),
		createAgentModelId(secondOption),
	]);
	assert.equal(catalog.models[0].id, 'openai.responses.openai.gpt-5.5.medium.unspecified');
	assert.deepEqual(catalog.models[0].descriptor.attachments.carriers, ['inline', 'reference']);
	assert.deepEqual(catalog.models[0].descriptor.attachments.shapes, ['blob', 'tree']);
	assert.equal(catalog.models[0].descriptor.attachments.maximumTreeDepth, 32);
	assert.equal(catalog.models[0].descriptor.attachments.maximumTreeEntries, 4_096);
	assert.ok(catalog.models[0].descriptor.attachments.mediaTypes.includes('application/vnd.comet.directory+json'));
	assert.ok(catalog.models[0].descriptor.attachments.mediaTypes.includes(ArticleAttachmentRepresentationMediaType));
	assert.ok(catalog.models[0].descriptor.attachments.mediaTypes.includes(ArticleAttachmentContentMediaType));
	assert.ok(catalog.models[0].descriptor.attachments.mediaTypes.includes('application/pdf'));
	const profile = await catalog.executionProfileResolver.resolve({
		submission: createAgentSubmissionId('submission-1'),
		selection: { kind: 'product', value: { preset: COMET_AUTOMATIC_EXECUTION_PRESET } },
		selectionDigest: createAgentHostPayloadDigest(`sha256:${'b'.repeat(64)}`),
		runtimeRegistration,
	});
	assert.equal(profile.modelRuntime, catalog.models[0].id);
	assert.equal((profile.settings as Record<string, unknown>).maxOutputTokens, 128_000);

	const firstRuntime = catalog.models[0];
	await assertModelError(firstRuntime.executeStep(stepRequest(firstRuntime), CancellationTokenNone), 'authenticationRequired');
	assert.equal(fetchCalls, 0);

	currentSettings = settings('new-secret-key', firstOption, 'https://new.example.test/v2');
	const result = await firstRuntime.executeStep(stepRequest(firstRuntime), CancellationTokenNone);
	assert.equal(result.stopReason, 'completed');
	assert.equal(capturedUrl, 'https://new.example.test/v2/responses');
	assert.equal(capturedAuthorization, 'Bearer new-secret-key');
	assert.equal(fetchCalls, 1);

	currentSettings = settings('second-secret-key', secondOption, 'https://second.example.test/v1');
	const explicitlySelectedResult = await firstRuntime.executeStep(stepRequest(firstRuntime), CancellationTokenNone);
	assert.equal(explicitlySelectedResult.stopReason, 'completed');
	assert.equal(capturedUrl, 'https://second.example.test/v1/responses');
	assert.equal(capturedAuthorization, 'Bearer second-secret-key');
	assert.equal(fetchCalls, 2);

	currentSettings.activeProvider = 'glm';
	const crossProviderResult = await firstRuntime.executeStep(stepRequest(firstRuntime), CancellationTokenNone);
	assert.equal(crossProviderResult.stopReason, 'completed');
	assert.equal(fetchCalls, 3);

	currentSettings.providers.openai.enabledModelOptions = [secondOption];
	await assertModelError(firstRuntime.executeStep(stepRequest(firstRuntime), CancellationTokenNone), 'executionConnectionChanged');
	assert.equal(fetchCalls, 3);
	assert.equal(loadCalls, 5);
});

test('default LLM settings build a strict Comet catalog with explicit provider output limits', async () => {
	const defaultSettings = createDefaultLlmSettings();
	const catalog = createProductionCometModelCatalog({
		settings: defaultSettings,
		loadSettings: async () => defaultSettings,
		fetch: async () => {
			throw new Error('Default catalog test must not execute a provider request');
		},
		now: Date.now,
	});
	const expectedLimits = new Map([
		['glm:glm-4.7-flash', 131_072],
		['glm:glm-4.6v-flash', 32_768],
		['kimi:kimi-k2.5', 32_768],
		['deepseek:deepseek-v4-flash', 384_000],
		['openai:gpt-5.5:medium', 128_000],
		['openai:gpt-5-codex:medium', 128_000],
	]);
	assert.deepEqual(catalog.models.map(model => model.descriptor.id), [...expectedLimits.keys()]);
	for (const [index, [model, maximum]] of [...expectedLimits].entries()) {
		const profile = await catalog.executionProfileResolver.resolve({
			submission: createAgentSubmissionId(`default-${index}`),
			selection: { kind: 'user', value: { model: createAgentModelId(model) } },
			selectionDigest: createAgentHostPayloadDigest(`sha256:${String(index + 1).padStart(64, '0')}`),
			runtimeRegistration,
		});
		assert.equal((profile.settings as Record<string, unknown>).maxOutputTokens, maximum);
	}
	const glmVision = catalog.models.find(model => model.descriptor.id === createAgentModelId('glm:glm-4.6v-flash'));
	assert.ok(glmVision?.descriptor.attachments.mediaTypes.includes('image/png'));
	const glmText = catalog.models.find(model => model.descriptor.id === createAgentModelId('glm:glm-4.7-flash'));
	assert.equal(glmText?.id, 'openai.chat-completions.glm.glm-4.7-flash.unspecified.unspecified');
	assert.deepEqual(glmText?.descriptor.attachments.shapes, ['blob']);
	assert.equal(glmText?.descriptor.attachments.maximumTreeDepth, 0);
	assert.equal(glmText?.descriptor.attachments.maximumTreeEntries, 0);
	assert.equal(glmText?.descriptor.attachments.mediaTypes.includes('application/vnd.comet.directory+json'), false);
	assert.equal(glmText?.descriptor.attachments.mediaTypes.includes('application/pdf'), false);
	assert.ok(glmText?.descriptor.attachments.mediaTypes.includes(ArticleAttachmentRepresentationMediaType));
	assert.ok(glmText?.descriptor.attachments.mediaTypes.includes(ArticleAttachmentContentMediaType));
	const openAI = catalog.models.find(model => model.descriptor.id === createAgentModelId('openai:gpt-5.5:medium'));
	assert.deepEqual(openAI?.descriptor.attachments.shapes, ['blob', 'tree']);
	assert.ok(openAI?.descriptor.attachments.mediaTypes.includes('application/vnd.comet.directory+json'));
});

test('GLM, Kimi, and DeepSeek use their exact native Chat Completions endpoints and token fields', async () => {
	const currentSettings = createDefaultLlmSettings();
	currentSettings.providers.glm.apiKey = 'glm-secret';
	currentSettings.providers.kimi.apiKey = 'kimi-secret';
	currentSettings.providers.deepseek.apiKey = 'deepseek-secret';
	const requests: Array<{
		readonly url: string;
		readonly authorization: string | null;
		readonly body: Record<string, unknown>;
	}> = [];
	const catalog = createProductionCometModelCatalog({
		settings: currentSettings,
		loadSettings: async () => currentSettings,
		fetch: async (url, init) => {
			const body = JSON.parse(init.body as string) as Record<string, unknown>;
			requests.push({
				url,
				authorization: new Headers(init.headers).get('Authorization'),
				body,
			});
			return new Response(JSON.stringify({
				id: `chat-${requests.length}`,
				...(typeof body.model === 'string' && body.model.startsWith('glm-')
					? { request_id: `glm-request-${requests.length}` }
					: { object: 'chat.completion' }),
				created: 1_700_000_000,
				model: body.model,
				choices: [{
					index: 0,
					message: { role: 'assistant', content: 'Answer' },
					finish_reason: 'stop',
				}],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		},
		now: Date.now,
	});
	for (const [index, model] of [
		'glm:glm-4.7-flash',
		'kimi:kimi-k2.5',
		'deepseek:deepseek-v4-flash',
	].entries()) {
		const runtime = catalog.models.find(candidate => candidate.descriptor.id === createAgentModelId(model));
		assert.ok(runtime !== undefined);
		const profile = await catalog.executionProfileResolver.resolve({
			submission: createAgentSubmissionId(`chat-${index}`),
			selection: { kind: 'user', value: { model: createAgentModelId(model) } },
			selectionDigest: createAgentHostPayloadDigest(`sha256:${String(index + 10).padStart(64, '0')}`),
			runtimeRegistration,
		});
		const result = await runtime.executeStep(stepRequest(runtime, profile.settings), CancellationTokenNone);
		assert.equal(result.stopReason, 'completed');
	}
	assert.deepEqual(requests.map(request => request.url), [
		'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		'https://api.moonshot.cn/v1/chat/completions',
		'https://api.deepseek.com/chat/completions',
	]);
	assert.deepEqual(requests.map(request => request.authorization), [
		'Bearer glm-secret',
		'Bearer kimi-secret',
		'Bearer deepseek-secret',
	]);
	assert.equal(requests[0].body.max_tokens, 131_072);
	assert.equal(requests[0].body.max_completion_tokens, undefined);
	assert.equal(requests[1].body.max_completion_tokens, 32_768);
	assert.equal(requests[1].body.max_tokens, undefined);
	assert.equal(requests[2].body.max_tokens, 384_000);
	assert.equal(requests[2].body.max_completion_tokens, undefined);
});
