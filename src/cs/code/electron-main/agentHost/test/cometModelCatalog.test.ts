/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

import { CancellationTokenNone, type CancellationToken } from 'cs/base/common/cancellation';
import {
	collectAgentConfigurationCredentialReferences,
	resolveAgentModelConfigurationCandidate,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationState,
} from 'cs/platform/agentHost/common/configuration';
import type {
	IAgentCredentialResolutionRequest,
	IAgentCredentialResolver,
} from 'cs/platform/agentHost/common/credentials';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentChatId,
	createAgentConfigurationStateRevision,
	createAgentDescriptorRevision,
	createAgentExecutionProfileDigest,
	createAgentExecutionProfileRevision,
	createAgentHostPayloadDigest,
	createAgentModelId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentSubmissionId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import { encodeAgentHostProtocolValue, type AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';
import {
	COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY,
	COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY,
	COMET_SESSION_CONFIGURATION_SCHEMA,
} from 'cs/platform/agentHost/node/agents/comet/cometConfiguration';
import { CometModelError, type ICometModelStepRequest } from 'cs/platform/agentHost/node/agents/comet/cometModel';
import {
	COMET_AUTOMATIC_EXECUTION_PRESET,
	createProductionCometModelCatalog,
} from 'cs/code/electron-main/agentHost/cometModelCatalog';
import {
	ArticleAttachmentContentMediaType,
	ArticleAttachmentRepresentationMediaType,
} from 'cs/workbench/contrib/fetch/common/articleChatAttachments';

const runtimeRegistration = createAgentRuntimeRegistrationRevision('comet.runtime.v1');
const agentDescriptor = createAgentDescriptorRevision('comet.descriptor.v2');
const sessionConfiguration = validateAndFreezeAgentConfigurationState({
	schema: COMET_SESSION_CONFIGURATION_SCHEMA,
	revision: createAgentConfigurationStateRevision('comet.catalog-test.session-state.v1'),
	values: {},
});

class TestCredentialResolver implements IAgentCredentialResolver {
	readonly secrets = new Map<string, string>();
	readonly requests: IAgentCredentialResolutionRequest[] = [];

	resolve(request: IAgentCredentialResolutionRequest, token: CancellationToken): Promise<string> {
		assert.equal(token.isCancellationRequested, false);
		this.requests.push(request);
		const value = this.secrets.get(request.credential.reference);
		if (value === undefined) {
			throw new AgentHostError(
				AgentHostErrorCode.CredentialUnavailable,
				'Test credential is unavailable',
				{ provider: request.credential.provider, scope: request.credential.scope },
			);
		}
		return Promise.resolve(value);
	}
}

function modelBinding(runtime: ReturnType<typeof createProductionCometModelCatalog>['models'][number]) {
	const configuration = resolveAgentModelConfigurationCandidate(
		runtime.descriptor.configurationSchema,
		{ schema: runtime.descriptor.configurationSchema.revision, values: {} },
	);
	const credentials = collectAgentConfigurationCredentialReferences(
		runtime.descriptor.configurationSchema,
		configuration.values,
		'model',
	).map(binding => binding.credential);
	return { configuration, credentials };
}

function stepRequest(
	runtime: ReturnType<typeof createProductionCometModelCatalog>['models'][number],
	executionSettings: AgentHostProtocolValue,
	binding = modelBinding(runtime),
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
		modelConfiguration: binding.configuration,
		credentials: binding.credentials,
		runtimeRegistration,
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

function protocolValueDigest(value: AgentHostProtocolValue): string {
	return `sha256:${createHash('sha256').update(encodeAgentHostProtocolValue(value)).digest('hex')}`;
}

test('production Comet catalog binds exact model configuration and Turn credential resolution', async () => {
	const credentials = new TestCredentialResolver();
	let capturedUrl: string | undefined;
	let capturedAuthorization: string | null = null;
	const catalog = createProductionCometModelCatalog({
		credentials,
		fetch: async (url, init) => {
			capturedUrl = url;
			capturedAuthorization = new Headers(init.headers).get('Authorization');
			return new Response(JSON.stringify({
				id: 'response-1', model: 'gpt-5.5', status: 'completed',
				output: [{
					type: 'message', role: 'assistant', status: 'completed',
					content: [{ type: 'output_text', text: 'Answer', annotations: [] }],
				}],
				usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		},
		now: Date.now,
	});
	assert.equal(catalog.automaticPreset, COMET_AUTOMATIC_EXECUTION_PRESET);
	assert.equal(catalog.automaticModel, createAgentModelId('glm:glm-4.7-flash'));
	assert.deepEqual(catalog.models.map(model => model.descriptor.id), [
		'glm:glm-4.7-flash',
		'glm:glm-4.6v-flash',
		'kimi:kimi-k2.5',
		'deepseek:deepseek-v4-flash',
		'openai:gpt-5-codex:medium',
		'openai:gpt-5.5:medium',
	]);

	const runtime = catalog.models.find(model => model.descriptor.id === createAgentModelId('openai:gpt-5.5:medium'))!;
	assert.match(runtime.descriptor.revision, /^sha256:[a-f0-9]{64}$/);
	assert.deepEqual(runtime.descriptor.attachments.carriers, ['inline', 'reference']);
	assert.deepEqual(runtime.descriptor.attachments.shapes, ['blob', 'tree']);
	assert.ok(runtime.descriptor.attachments.mediaTypes.includes(ArticleAttachmentRepresentationMediaType));
	assert.ok(runtime.descriptor.attachments.mediaTypes.includes(ArticleAttachmentContentMediaType));
	assert.ok(runtime.descriptor.attachments.mediaTypes.includes('application/pdf'));

	const binding = modelBinding(runtime);
	const profile = await catalog.executionProfileResolver.resolve({
		submission: createAgentSubmissionId('submission-1'),
		selection: {
			kind: 'user',
			value: { model: runtime.descriptor.id },
			configuration: binding.configuration,
		},
		selectionDigest: createAgentHostPayloadDigest(`sha256:${'b'.repeat(64)}`),
		runtimeRegistration,
		sessionConfiguration,
	});
	assert.equal(profile.modelRuntime, runtime.id);
	assert.equal((profile.settings as Record<string, unknown>).maxOutputTokens, 128_000);

	await assertModelError(
		runtime.executeStep(stepRequest(runtime, profile.settings, binding), CancellationTokenNone),
		'providerCredentialRequired',
	);
	credentials.secrets.set('openai', 'new-secret-key');
	const result = await runtime.executeStep(
		stepRequest(runtime, profile.settings, binding),
		CancellationTokenNone,
	);
	assert.equal(result.stopReason, 'completed');
	assert.equal(capturedUrl, binding.configuration.values[COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY]);
	assert.equal(capturedAuthorization, 'Bearer new-secret-key');
	assert.equal(credentials.requests.length, 2);
	assert.deepEqual(credentials.requests[1], {
		packageId: 'comet',
		agentId: 'comet',
		runtimeRegistration,
		session: 'session-1',
		chat: 'chat-1',
		turn: 'turn-1',
		credential: { provider: 'comet.provider-api-key', scope: 'llm', reference: 'openai' },
	});
	assert.throws(() => validateAndFreezeAgentConfigurationCandidate(
		runtime.descriptor.configurationSchema,
		{
			schema: binding.configuration.schema,
			values: {
				...binding.configuration.values,
				[COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY]: 'https://attacker.example.test/v2/responses',
			},
		},
		'model',
		true,
	), (error: unknown) => error instanceof AgentHostError && error.code === AgentHostErrorCode.InvalidConfigurationValue);
	assert.throws(() => validateAndFreezeAgentConfigurationCandidate(
		runtime.descriptor.configurationSchema,
		{
			schema: binding.configuration.schema,
			values: {
				...binding.configuration.values,
				[COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY]: {
					provider: 'comet.provider-api-key',
					scope: 'llm',
					reference: 'glm',
				},
			},
		},
		'model',
		true,
	), (error: unknown) => error instanceof AgentHostError && error.code === AgentHostErrorCode.InvalidConfigurationValue);
});

test('product-owned catalog locks the complete model configuration, settings, capabilities, and revisions', async () => {
	const catalog = createProductionCometModelCatalog({
		credentials: new TestCredentialResolver(),
		fetch: async () => { throw new Error('Catalog shape test must not execute a request'); },
		now: Date.now,
	});
	const actual = [];
	for (const [index, runtime] of catalog.models.entries()) {
		const binding = modelBinding(runtime);
		const profile = await catalog.executionProfileResolver.resolve({
			submission: createAgentSubmissionId(`shape-${index}`),
			selection: { kind: 'user', value: { model: runtime.descriptor.id }, configuration: binding.configuration },
			selectionDigest: createAgentHostPayloadDigest(`sha256:${String(index + 1).padStart(64, '0')}`),
			runtimeRegistration,
			sessionConfiguration,
		});
		actual.push({
			id: runtime.descriptor.id,
			runtime: runtime.id,
			descriptorRevision: runtime.descriptor.revision,
			configurationRevision: runtime.descriptor.configurationSchema.revision,
			displayName: runtime.descriptor.displayName,
			configuration: binding.configuration.values,
			settings: profile.settings,
			descriptorDigest: protocolValueDigest(runtime.descriptor as unknown as AgentHostProtocolValue),
		});
	}
	assert.deepEqual(actual, [
		{
			id: 'glm:glm-4.7-flash',
			runtime: 'openai.chat-completions.glm.glm-4.7-flash.unspecified.unspecified',
			descriptorRevision: 'sha256:6e013be845f51fdb070935b853da5b920a03663e39ef1a98d919dc7c0dcf33ec',
			configurationRevision: 'sha256:34bf19c9cb80a4118f66b480f3333ad0d08295d7ffc2922757933b8ddaddc9b8',
			displayName: 'GLM-4.7-Flash',
			configuration: {
				'comet.model.endpoint': 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
				'comet.model.provider-model': 'glm-4.7-flash',
				'comet.model.credential': { provider: 'comet.provider-api-key', scope: 'llm', reference: 'glm' },
			},
			settings: { version: 1, maxOutputTokens: 131_072, maximumOutputTokensField: 'max_tokens' },
			descriptorDigest: 'sha256:e2e280724d8e2ceb6065d53e4d6c7e60858bbddac4735e2f28d35a065e1bb704',
		},
		{
			id: 'glm:glm-4.6v-flash',
			runtime: 'openai.chat-completions.glm.glm-4.6v-flash.unspecified.unspecified',
			descriptorRevision: 'sha256:26c8ce3ce440144966eb9f4fde91721c01cd0b44524ad161f61727ebed6614a6',
			configurationRevision: 'sha256:4262671bd14a8eefe72e66c0f0627f212ca8104daa8a4cb6e4e68515cef25ab5',
			displayName: 'GLM-4.6V-Flash',
			configuration: {
				'comet.model.endpoint': 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
				'comet.model.provider-model': 'glm-4.6v-flash',
				'comet.model.credential': { provider: 'comet.provider-api-key', scope: 'llm', reference: 'glm' },
			},
			settings: { version: 1, maxOutputTokens: 32_768, maximumOutputTokensField: 'max_tokens' },
			descriptorDigest: 'sha256:1ee3360d2300ed85e0cf7e3128d54772644f89e77e95a5d688f19928b69b97b5',
		},
		{
			id: 'kimi:kimi-k2.5',
			runtime: 'openai.chat-completions.kimi.kimi-k2.5.unspecified.unspecified',
			descriptorRevision: 'sha256:f35d14d2213dd6a2a254d32360cc205857c321f33aaacce2fb948cbded210893',
			configurationRevision: 'sha256:5770367060d2abcb473b4c9b9b5ad96a0350acbb88554d038a635b69f786feb6',
			displayName: 'Kimi K2.5',
			configuration: {
				'comet.model.endpoint': 'https://api.moonshot.cn/v1/chat/completions',
				'comet.model.provider-model': 'kimi-k2.5',
				'comet.model.credential': { provider: 'comet.provider-api-key', scope: 'llm', reference: 'kimi' },
			},
			settings: { version: 1, maxOutputTokens: 32_768, maximumOutputTokensField: 'max_completion_tokens' },
			descriptorDigest: 'sha256:5f5b2abcf5562eea92f34c73ea64b303959346ebc244f0932baa92634b949646',
		},
		{
			id: 'deepseek:deepseek-v4-flash',
			runtime: 'openai.chat-completions.deepseek.deepseek-v4-flash.unspecified.unspecified',
			descriptorRevision: 'sha256:04bf49d1c4c8040df54f99a7a10f21a23b2feec2c8a324719b9bf12f47db48d1',
			configurationRevision: 'sha256:8ad7a5efbefb38efca22a8efaa2b461f49184455df70c893e94b37566d810cf0',
			displayName: 'DeepSeek V4 Flash',
			configuration: {
				'comet.model.endpoint': 'https://api.deepseek.com/chat/completions',
				'comet.model.provider-model': 'deepseek-v4-flash',
				'comet.model.credential': { provider: 'comet.provider-api-key', scope: 'llm', reference: 'deepseek' },
			},
			settings: { version: 1, maxOutputTokens: 384_000, maximumOutputTokensField: 'max_tokens' },
			descriptorDigest: 'sha256:bb553c6ec23dd88537946d09ec269e4b06c701a9c9f1e48b9d2ec373a6d428ca',
		},
		{
			id: 'openai:gpt-5-codex:medium',
			runtime: 'openai.responses.openai.gpt-5-codex.medium.unspecified',
			descriptorRevision: 'sha256:a7eef21dfff91b3065a26af216244c022b95a930a893cdf24bd4a4cc0635a242',
			configurationRevision: 'sha256:f04775cfd7b62775ba046fbd4636abaacd940861b06be512ef531b6076f911b1',
			displayName: 'GPT-5 Codex Medium',
			configuration: {
				'comet.model.endpoint': 'https://api.openai.com/v1/responses',
				'comet.model.provider-model': 'gpt-5-codex',
				'comet.model.credential': { provider: 'comet.provider-api-key', scope: 'llm', reference: 'openai' },
			},
			settings: {
				version: 1,
				maxOutputTokens: 128_000,
				temperature: null,
				reasoning: { effort: 'medium', summary: 'auto' },
				serviceTier: null,
				parallelToolCalls: true,
			},
			descriptorDigest: 'sha256:f2298046ac7fc26559960455be5b8bfc54ad7278beda0fa9ae7850433cf4a118',
		},
		{
			id: 'openai:gpt-5.5:medium',
			runtime: 'openai.responses.openai.gpt-5.5.medium.unspecified',
			descriptorRevision: 'sha256:9c4a9e654f35239c90b6b0c24c4cd0848c8822592e7f2874a9774402a3042b86',
			configurationRevision: 'sha256:10d01bf5b428319da3e60087bf6943f07e005a0dc3b7c9b1e2cb01b90831486e',
			displayName: 'GPT-5.5 Medium',
			configuration: {
				'comet.model.endpoint': 'https://api.openai.com/v1/responses',
				'comet.model.provider-model': 'gpt-5.5',
				'comet.model.credential': { provider: 'comet.provider-api-key', scope: 'llm', reference: 'openai' },
			},
			settings: {
				version: 1,
				maxOutputTokens: 128_000,
				temperature: null,
				reasoning: { effort: 'medium', summary: 'auto' },
				serviceTier: null,
				parallelToolCalls: true,
			},
			descriptorDigest: 'sha256:c62f0b6360b2efd925310116f6464bc68b7ae629576236a97086e7889ff1557c',
		},
	]);
	const glmVision = catalog.models.find(model => model.descriptor.id === createAgentModelId('glm:glm-4.6v-flash'))!;
	assert.ok(glmVision.descriptor.attachments.mediaTypes.includes('image/png'));
	const glmText = catalog.models.find(model => model.descriptor.id === createAgentModelId('glm:glm-4.7-flash'))!;
	assert.equal(glmText.id, 'openai.chat-completions.glm.glm-4.7-flash.unspecified.unspecified');
	assert.deepEqual(glmText.descriptor.attachments.shapes, ['blob']);
	assert.equal(glmText.descriptor.attachments.maximumTreeDepth, 0);
	assert.equal(glmText.descriptor.attachments.mediaTypes.includes('application/pdf'), false);
});

test('GLM, Kimi, and DeepSeek resolve exact native endpoints, credentials, and token fields', async () => {
	const credentials = new TestCredentialResolver();
	credentials.secrets.set('glm', 'glm-secret');
	credentials.secrets.set('kimi', 'kimi-secret');
	credentials.secrets.set('deepseek', 'deepseek-secret');
	const requests: Array<{ readonly url: string; readonly authorization: string | null; readonly body: Record<string, unknown> }> = [];
	const catalog = createProductionCometModelCatalog({
		credentials,
		fetch: async (url, init) => {
			const body = JSON.parse(init.body as string) as Record<string, unknown>;
			requests.push({ url, authorization: new Headers(init.headers).get('Authorization'), body });
			return new Response(JSON.stringify({
				id: `chat-${requests.length}`,
				...(typeof body.model === 'string' && body.model.startsWith('glm-')
					? { request_id: `glm-request-${requests.length}` }
					: { object: 'chat.completion' }),
				created: 1_700_000_000,
				model: body.model,
				choices: [{ index: 0, message: { role: 'assistant', content: 'Answer' }, finish_reason: 'stop' }],
				usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
			}), { status: 200, headers: { 'content-type': 'application/json' } });
		},
		now: Date.now,
	});
	for (const [index, model] of ['glm:glm-4.7-flash', 'kimi:kimi-k2.5', 'deepseek:deepseek-v4-flash'].entries()) {
		const runtime = catalog.models.find(candidate => candidate.descriptor.id === createAgentModelId(model))!;
		const binding = modelBinding(runtime);
		const profile = await catalog.executionProfileResolver.resolve({
			submission: createAgentSubmissionId(`chat-${index}`),
			selection: { kind: 'user', value: { model: runtime.descriptor.id }, configuration: binding.configuration },
			selectionDigest: createAgentHostPayloadDigest(`sha256:${String(index + 10).padStart(64, '0')}`),
			runtimeRegistration,
			sessionConfiguration,
		});
		const result = await runtime.executeStep(stepRequest(runtime, profile.settings, binding), CancellationTokenNone);
		assert.equal(result.stopReason, 'completed');
	}
	assert.deepEqual(requests.map(request => request.url), [
		'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		'https://api.moonshot.cn/v1/chat/completions',
		'https://api.deepseek.com/chat/completions',
	]);
	assert.deepEqual(requests.map(request => request.authorization), [
		'Bearer glm-secret', 'Bearer kimi-secret', 'Bearer deepseek-secret',
	]);
	assert.equal(requests[0].body.max_tokens, 131_072);
	assert.equal(requests[1].body.max_completion_tokens, 32_768);
	assert.equal(requests[2].body.max_tokens, 384_000);
});
