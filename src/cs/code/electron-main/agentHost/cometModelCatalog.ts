/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';

import { CancellationError } from 'cs/base/common/errors';
import type {
	IAgentAttachmentCapabilities,
	IAgentExecutionProfileRequest,
	IAgentModelDescriptor,
} from 'cs/platform/agentHost/common/agent';
import {
	validateAndFreezeAgentConfigurationCandidate,
	type IAgentConfigurationSchema,
} from 'cs/platform/agentHost/common/configuration';
import {
	validateAndFreezeAgentCredentialReference,
	type IAgentCredentialResolver,
} from 'cs/platform/agentHost/common/credentials';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	AgentExecutionPresetId,
	AgentModelId,
	createAgentExecutionPresetId,
	createAgentConfigurationSchemaRevision,
	createAgentModelDescriptorRevision,
	createAgentModelId,
} from 'cs/platform/agentHost/common/identities';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';
import { encodeAgentHostProtocolValue, type AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type {
	ICometExecutionProfileResolution,
	ICometExecutionProfileResolver,
	ICometModelRuntime,
} from 'cs/platform/agentHost/node/agents/comet/cometModel';
import { CometModelError } from 'cs/platform/agentHost/node/agents/comet/cometModel';
import {
	COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY,
	COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY,
	COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY,
	COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER,
	createCometModelConfigurationSchema,
} from 'cs/platform/agentHost/node/agents/comet/cometConfiguration';
import { COMET_AGENT_ID, COMET_AGENT_PACKAGE_ID } from 'cs/platform/agentHost/node/agents/comet/cometAgent';
import {
	OpenAIResponsesModelRuntime,
	OPENAI_RESPONSES_INPUT_FILE_MEDIA_TYPES,
	type IOpenAIResponsesConnectionResolutionRequest,
	type IOpenAIResponsesConnectionResolver,
	type IOpenAIResponsesExecutionSettings,
} from 'cs/platform/agentHost/node/agents/comet/providers/openAIResponses';
import {
	OpenAIChatCompletionsModelRuntime,
	OPENAI_CHAT_COMPLETIONS_TEXT_MEDIA_TYPES,
	type IOpenAIChatCompletionsConnectionResolutionRequest,
	type IOpenAIChatCompletionsConnectionResolver,
	type IOpenAIChatCompletionsExecutionSettings,
} from 'cs/platform/agentHost/node/agents/comet/providers/openAIChatCompletions';
import { ArticleAttachmentRepresentationMediaType } from 'cs/workbench/contrib/fetch/common/articleChatAttachments';

export const COMET_AUTOMATIC_EXECUTION_PRESET = createAgentExecutionPresetId('comet.automatic');

const maximumSteps = 16;
const maximumRequestMilliseconds = 5 * 60 * 1_000;
const maximumRequestBytes = 64 * 1024 * 1024;
const maximumResponseBytes = 32 * 1024 * 1024;
const maximumAttachmentCount = 16;
const maximumAttachmentItemBytes = 10 * 1024 * 1024;
const maximumAttachmentTotalBytes = 20 * 1024 * 1024;
const maximumAttachmentTreeDepth = 32;
const maximumAttachmentTreeEntries = 4_096;
const cometBlobAttachmentRepresentationMediaTypes = Object.freeze([
	'application/vnd.comet.file+json',
	'application/vnd.comet.editor-snapshot+json',
	ArticleAttachmentRepresentationMediaType,
	'application/vnd.comet.pdf-selection+json',
]);
const cometResponsesAttachmentRepresentationMediaTypes = Object.freeze([
	...cometBlobAttachmentRepresentationMediaTypes,
	'application/vnd.comet.directory+json',
]);

/** Supplies the production credential, network, and clock authorities. */
export interface IProductionCometModelCatalogOptions {
	readonly credentials: IAgentCredentialResolver;
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
}

/** Contains the exact model runtimes and execution-profile resolver registered for Comet. */
export interface IProductionCometModelCatalog {
	readonly models: readonly ICometModelRuntime[];
	readonly executionProfileResolver: ICometExecutionProfileResolver;
	readonly automaticPreset: AgentExecutionPresetId;
	readonly automaticModel: AgentModelId;
}

interface IProductCometModelDefinitionBase {
	readonly model: AgentModelId;
	readonly runtime: string;
	readonly displayName: string;
	readonly endpoint: string;
	readonly providerModel: string;
	readonly credentialReference: string;
	readonly attachments: IAgentAttachmentCapabilities;
}

type IProductCometModelDefinition =
	| IProductCometModelDefinitionBase & {
		readonly protocol: 'openai-responses';
		readonly settings: IOpenAIResponsesExecutionSettings;
	}
	| IProductCometModelDefinitionBase & {
		readonly protocol: 'openai-chat-completions';
		readonly settings: IOpenAIChatCompletionsExecutionSettings;
	};

type IConfiguredModelOption = IProductCometModelDefinition & {
	readonly configurationSchema: IAgentConfigurationSchema;
};

function invalidConfiguration(message: string, data: { readonly field: string; readonly value: string }): never {
	throw new CometModelError('invalidConfiguration', message, data);
}

const textAttachmentMediaTypes = Object.freeze([
	...cometBlobAttachmentRepresentationMediaTypes,
	...OPENAI_CHAT_COMPLETIONS_TEXT_MEDIA_TYPES,
]);
const imageAttachmentMediaTypes = Object.freeze([
	...textAttachmentMediaTypes,
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
]);
const responsesAttachmentMediaTypes = Object.freeze([
	...cometResponsesAttachmentRepresentationMediaTypes,
	...OPENAI_RESPONSES_INPUT_FILE_MEDIA_TYPES,
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
]);
const textAttachmentCapabilities: IAgentAttachmentCapabilities = Object.freeze({
	carriers: Object.freeze(['inline', 'reference'] as const),
	shapes: Object.freeze(['blob'] as const),
	mediaTypes: textAttachmentMediaTypes,
	maximumCount: maximumAttachmentCount,
	maximumItemBytes: maximumAttachmentItemBytes,
	maximumTotalBytes: maximumAttachmentTotalBytes,
	maximumTreeDepth: 0,
	maximumTreeEntries: 0,
	supportsClientContentForBackgroundExecution: true,
});
const imageAttachmentCapabilities: IAgentAttachmentCapabilities = Object.freeze({
	...textAttachmentCapabilities,
	mediaTypes: imageAttachmentMediaTypes,
});
const responsesAttachmentCapabilities: IAgentAttachmentCapabilities = Object.freeze({
	carriers: Object.freeze(['inline', 'reference'] as const),
	shapes: Object.freeze(['blob', 'tree'] as const),
	mediaTypes: responsesAttachmentMediaTypes,
	maximumCount: maximumAttachmentCount,
	maximumItemBytes: maximumAttachmentItemBytes,
	maximumTotalBytes: maximumAttachmentTotalBytes,
	maximumTreeDepth: maximumAttachmentTreeDepth,
	maximumTreeEntries: maximumAttachmentTreeEntries,
	supportsClientContentForBackgroundExecution: true,
});

const productCometModelDefinitions: readonly IProductCometModelDefinition[] = Object.freeze([
	Object.freeze({
		protocol: 'openai-chat-completions',
		model: createAgentModelId('glm:glm-4.7-flash'),
		runtime: 'openai.chat-completions.glm.glm-4.7-flash.unspecified.unspecified',
		displayName: 'GLM-4.7-Flash',
		endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		providerModel: 'glm-4.7-flash',
		credentialReference: 'glm',
		settings: Object.freeze({ version: 1, maxOutputTokens: 131_072, maximumOutputTokensField: 'max_tokens' }),
		attachments: textAttachmentCapabilities,
	}),
	Object.freeze({
		protocol: 'openai-chat-completions',
		model: createAgentModelId('glm:glm-4.6v-flash'),
		runtime: 'openai.chat-completions.glm.glm-4.6v-flash.unspecified.unspecified',
		displayName: 'GLM-4.6V-Flash',
		endpoint: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
		providerModel: 'glm-4.6v-flash',
		credentialReference: 'glm',
		settings: Object.freeze({ version: 1, maxOutputTokens: 32_768, maximumOutputTokensField: 'max_tokens' }),
		attachments: imageAttachmentCapabilities,
	}),
	Object.freeze({
		protocol: 'openai-chat-completions',
		model: createAgentModelId('kimi:kimi-k2.5'),
		runtime: 'openai.chat-completions.kimi.kimi-k2.5.unspecified.unspecified',
		displayName: 'Kimi K2.5',
		endpoint: 'https://api.moonshot.cn/v1/chat/completions',
		providerModel: 'kimi-k2.5',
		credentialReference: 'kimi',
		settings: Object.freeze({ version: 1, maxOutputTokens: 32_768, maximumOutputTokensField: 'max_completion_tokens' }),
		attachments: imageAttachmentCapabilities,
	}),
	Object.freeze({
		protocol: 'openai-chat-completions',
		model: createAgentModelId('deepseek:deepseek-v4-flash'),
		runtime: 'openai.chat-completions.deepseek.deepseek-v4-flash.unspecified.unspecified',
		displayName: 'DeepSeek V4 Flash',
		endpoint: 'https://api.deepseek.com/chat/completions',
		providerModel: 'deepseek-v4-flash',
		credentialReference: 'deepseek',
		settings: Object.freeze({ version: 1, maxOutputTokens: 384_000, maximumOutputTokensField: 'max_tokens' }),
		attachments: textAttachmentCapabilities,
	}),
	Object.freeze({
		protocol: 'openai-responses',
		model: createAgentModelId('openai:gpt-5-codex:medium'),
		runtime: 'openai.responses.openai.gpt-5-codex.medium.unspecified',
		displayName: 'GPT-5 Codex Medium',
		endpoint: 'https://api.openai.com/v1/responses',
		providerModel: 'gpt-5-codex',
		credentialReference: 'openai',
		settings: Object.freeze({
			version: 1,
			maxOutputTokens: 128_000,
			temperature: null,
			reasoning: Object.freeze({ effort: 'medium', summary: 'auto' }),
			serviceTier: null,
			parallelToolCalls: true,
		}),
		attachments: responsesAttachmentCapabilities,
	}),
	Object.freeze({
		protocol: 'openai-responses',
		model: createAgentModelId('openai:gpt-5.5:medium'),
		runtime: 'openai.responses.openai.gpt-5.5.medium.unspecified',
		displayName: 'GPT-5.5 Medium',
		endpoint: 'https://api.openai.com/v1/responses',
		providerModel: 'gpt-5.5',
		credentialReference: 'openai',
		settings: Object.freeze({
			version: 1,
			maxOutputTokens: 128_000,
			temperature: null,
			reasoning: Object.freeze({ effort: 'medium', summary: 'auto' }),
			serviceTier: null,
			parallelToolCalls: true,
		}),
		attachments: responsesAttachmentCapabilities,
	}),
]);
const automaticModel = createAgentModelId('glm:glm-4.7-flash');

function validateProductEndpoint(definition: IProductCometModelDefinition): void {
	let endpoint: URL;
	try {
		endpoint = new URL(definition.endpoint);
	} catch {
		return invalidConfiguration('Comet product model endpoint is invalid', {
			field: 'productCometModelDefinitions.endpoint',
			value: definition.endpoint,
		});
	}
	const expectedSuffix = definition.protocol === 'openai-responses' ? '/responses' : '/chat/completions';
	if (
		endpoint.protocol !== 'https:'
		|| endpoint.username.length !== 0
		|| endpoint.password.length !== 0
		|| endpoint.search.length !== 0
		|| endpoint.hash.length !== 0
		|| !endpoint.pathname.endsWith(expectedSuffix)
		|| endpoint.toString() !== definition.endpoint
	) {
		return invalidConfiguration('Comet product model endpoint is invalid', {
			field: 'productCometModelDefinitions.endpoint',
			value: definition.endpoint,
		});
	}
}

function createProductModelConfigurationSchema(
	definition: IProductCometModelDefinition,
): IAgentConfigurationSchema {
	const candidate = createCometModelConfigurationSchema({
		revision: createAgentConfigurationSchemaRevision('content-addressing'),
		endpoint: definition.endpoint,
		providerModel: definition.providerModel,
		credentialReference: definition.credentialReference,
	});
	const content = Object.freeze({
		profile: candidate.profile,
		agent: candidate.agent,
		scope: candidate.scope,
		properties: candidate.properties,
	});
	const revision = createAgentConfigurationSchemaRevision(
		`sha256:${createHash('sha256')
			.update(encodeAgentHostProtocolValue(content as unknown as AgentHostProtocolValue))
			.digest('hex')}`,
	);
	return createCometModelConfigurationSchema({
		revision,
		endpoint: definition.endpoint,
		providerModel: definition.providerModel,
		credentialReference: definition.credentialReference,
	});
}

function productModelDescriptor(
	definition: IProductCometModelDefinition,
	configurationSchema: IAgentConfigurationSchema,
): IAgentModelDescriptor {
	if (new Set(definition.attachments.mediaTypes).size !== definition.attachments.mediaTypes.length) {
		return invalidConfiguration('Comet product model descriptor contains duplicate attachment media types', {
			field: 'productCometModelDefinitions.attachments.mediaTypes',
			value: definition.model,
		});
	}
	const content = Object.freeze({
		id: definition.model,
		displayName: definition.displayName,
		enabled: true,
		configurationSchema,
		toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		attachments: definition.attachments,
	});
	const revisionPayload = Object.freeze({
		protocol: definition.protocol,
		runtime: definition.runtime,
		settings: definition.settings,
		descriptor: content,
	});
	const revision = createAgentModelDescriptorRevision(
		`sha256:${createHash('sha256')
			.update(encodeAgentHostProtocolValue(revisionPayload as unknown as AgentHostProtocolValue))
			.digest('hex')}`,
	);
	return Object.freeze({
		...content,
		revision,
	});
}

type CometConnectionResolutionRequest =
	| IOpenAIResponsesConnectionResolutionRequest
	| IOpenAIChatCompletionsConnectionResolutionRequest;

async function resolveConfiguredConnection(
	expected: IConfiguredModelOption,
	credentials: IAgentCredentialResolver,
	request: CometConnectionResolutionRequest,
) {
	if (request.runtime !== expected.runtime || request.model !== expected.model) {
		throw new CometModelError('executionConnectionChanged', 'Comet model connection identity changed');
	}
	const configuration = validateAndFreezeAgentConfigurationCandidate(
		expected.configurationSchema,
		request.step.modelConfiguration,
		'model',
		true,
	);
	const endpoint = configuration.values[COMET_MODEL_ENDPOINT_CONFIGURATION_PROPERTY];
	const providerModel = configuration.values[COMET_MODEL_PROVIDER_MODEL_CONFIGURATION_PROPERTY];
	const credential = validateAndFreezeAgentCredentialReference(
		configuration.values[COMET_MODEL_CREDENTIAL_CONFIGURATION_PROPERTY],
	);
	if (typeof endpoint !== 'string' || typeof providerModel !== 'string') {
		throw new CometModelError('invalidConfiguration', 'Comet model connection configuration is incomplete');
	}
	if (
		endpoint !== expected.endpoint
		|| providerModel !== expected.providerModel
		|| credential.provider !== COMET_PROVIDER_API_KEY_CREDENTIAL_PROVIDER
		|| credential.scope !== 'llm'
		|| credential.reference !== expected.credentialReference
	) {
		throw new CometModelError(
			'invalidConfiguration',
			'Comet model connection configuration changed from its product-owned descriptor',
		);
	}
	const credentialIdentity = encodeAgentHostProtocolValue(credential);
	if (!request.step.credentials.some(candidate => (
		encodeAgentHostProtocolValue(validateAndFreezeAgentCredentialReference(candidate)) === credentialIdentity
	))) {
		throw new CometModelError('invalidConfiguration', 'Comet model credential is not bound to the addressed Turn');
	}
	let apiKey: string;
	try {
		apiKey = await credentials.resolve({
			packageId: COMET_AGENT_PACKAGE_ID,
			agentId: COMET_AGENT_ID,
			runtimeRegistration: request.step.runtimeRegistration,
			session: request.step.session,
			chat: request.step.chat,
			turn: request.step.turn,
			credential,
		}, request.token);
	} catch (error) {
		if (error instanceof CancellationError) {
			throw error;
		}
		if (
			error instanceof AgentHostError
			&& (error.code === AgentHostErrorCode.CredentialUnavailable
				|| error.code === AgentHostErrorCode.CredentialUnauthorized)
		) {
			throw new CometModelError('providerCredentialRequired', 'Comet model credential is unavailable');
		}
		throw new CometModelError('connectionResolutionFailed', 'Comet model credential resolution failed');
	}
	if (request.signal.aborted) {
		throw new CancellationError();
	}
	return Object.freeze({ endpoint, providerModel, apiKey });
}

/** Resolves one exact Responses connection from the accepted model configuration. */
class ResponsesConfigurationConnectionResolver implements IOpenAIResponsesConnectionResolver {
	constructor(
		private readonly expected: Extract<IConfiguredModelOption, { readonly protocol: 'openai-responses' }>,
		private readonly credentials: IAgentCredentialResolver,
	) {}

	resolve(request: IOpenAIResponsesConnectionResolutionRequest) {
		return resolveConfiguredConnection(this.expected, this.credentials, request);
	}
}

/** Resolves one exact Chat Completions connection from the accepted model configuration. */
class ChatCompletionsConfigurationConnectionResolver implements IOpenAIChatCompletionsConnectionResolver {
	constructor(
		private readonly expected: Extract<IConfiguredModelOption, { readonly protocol: 'openai-chat-completions' }>,
		private readonly credentials: IAgentCredentialResolver,
	) {}

	resolve(request: IOpenAIChatCompletionsConnectionResolutionRequest) {
		return resolveConfiguredConnection(this.expected, this.credentials, request);
	}
}

function selectionRecord(value: AgentHostProtocolValue): Readonly<Record<string, AgentHostProtocolValue>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		throw new CometModelError('invalidExecutionSelection', 'Invalid Comet execution profile selection', {
			field: 'selection.value',
			value: typeof value,
		});
	}
	return value as Readonly<Record<string, AgentHostProtocolValue>>;
}

function exactSelectionValue(
	selection: Readonly<Record<string, AgentHostProtocolValue>>,
	field: 'model' | 'preset',
): string {
	if (Object.keys(selection).length !== 1 || typeof selection[field] !== 'string') {
		throw new CometModelError('invalidExecutionSelection', 'Invalid Comet execution profile selection', {
			field: `selection.value.${field}`,
			value: 'invalid',
		});
	}
	return selection[field];
}

class ProductionCometExecutionProfileResolver implements ICometExecutionProfileResolver {
	private readonly models = new Map<AgentModelId, {
		readonly configurationSchema: IAgentConfigurationSchema;
		readonly resolution: ICometExecutionProfileResolution;
	}>();
	private readonly productPresets = new Map<AgentExecutionPresetId, {
		readonly configurationSchema: IAgentConfigurationSchema;
		readonly resolution: ICometExecutionProfileResolution;
	}>();

	constructor(configured: readonly IConfiguredModelOption[], automatic: IConfiguredModelOption) {
		for (const entry of configured) {
			this.models.set(entry.model, Object.freeze({
				configurationSchema: entry.configurationSchema,
				resolution: Object.freeze({
					modelRuntime: entry.runtime,
					settings: entry.settings as unknown as AgentHostProtocolValue,
					maximumSteps,
				}),
			}));
		}
		this.productPresets.set(COMET_AUTOMATIC_EXECUTION_PRESET, Object.freeze({
			configurationSchema: automatic.configurationSchema,
			resolution: Object.freeze({
				modelRuntime: automatic.runtime,
				settings: automatic.settings as unknown as AgentHostProtocolValue,
				maximumSteps,
			}),
		}));
	}

	async resolve(request: IAgentExecutionProfileRequest): Promise<ICometExecutionProfileResolution> {
		const selection = selectionRecord(request.selection.value);
		if (request.selection.kind === 'user') {
			const value = exactSelectionValue(selection, 'model');
			let model: AgentModelId;
			try {
				model = createAgentModelId(value);
			} catch {
				throw new CometModelError('invalidExecutionSelection', 'Invalid Comet model selection', {
					field: 'selection.value.model',
					value: value.slice(0, 256),
				});
			}
			const binding = this.models.get(model);
			if (binding === undefined) {
				throw new CometModelError('invalidExecutionSelection', 'Unknown Comet model selection', {
					field: 'selection.value.model',
					value: model,
				});
			}
			if (request.selection.configuration.schema !== binding.configurationSchema.revision) {
				throw new CometModelError('invalidExecutionSelection', 'Comet model configuration schema changed');
			}
			return binding.resolution;
		}
		if (request.selection.kind === 'product') {
			const value = exactSelectionValue(selection, 'preset');
			let preset: AgentExecutionPresetId;
			try {
				preset = createAgentExecutionPresetId(value);
			} catch {
				throw new CometModelError('invalidExecutionSelection', 'Invalid Comet product preset selection', {
					field: 'selection.value.preset',
					value: value.slice(0, 256),
				});
			}
			const binding = this.productPresets.get(preset);
			if (binding === undefined) {
				throw new CometModelError('invalidExecutionSelection', 'Unknown Comet product preset selection', {
					field: 'selection.value.preset',
					value: preset,
				});
			}
			if (request.selection.configuration.schema !== binding.configurationSchema.revision) {
				throw new CometModelError('invalidExecutionSelection', 'Comet preset configuration schema changed');
			}
			return binding.resolution;
		}
		throw new CometModelError('invalidExecutionSelection', 'Invalid Comet execution profile selection', {
			field: 'selection.kind',
			value: request.selection.kind,
		});
	}
}

/** Builds the exact product-owned Comet model catalog. */
export function createProductionCometModelCatalog(options: IProductionCometModelCatalogOptions): IProductionCometModelCatalog {
	if (
		options.credentials === null
		|| typeof options.credentials !== 'object'
		|| typeof options.credentials.resolve !== 'function'
		|| typeof options.fetch !== 'function'
		|| typeof options.now !== 'function'
	) {
		return invalidConfiguration('Comet model catalog dependencies are invalid', {
			field: 'options',
			value: 'invalid',
		});
	}
	const configured = productCometModelDefinitions.map<IConfiguredModelOption>(definition => {
		validateProductEndpoint(definition);
		const configurationSchema = createProductModelConfigurationSchema(definition);
		return Object.freeze({ ...definition, configurationSchema });
	});
	const configuredByModel = new Map(configured.map(entry => [entry.model, entry] as const));
	if (configuredByModel.size !== configured.length) {
		return invalidConfiguration('Comet model catalog contains duplicate model identities', {
			field: 'productCometModelDefinitions.model',
			value: 'duplicate',
		});
	}
	const automatic = configuredByModel.get(automaticModel);
	if (automatic === undefined) {
		return invalidConfiguration('Comet automatic profile requires the product-owned model', {
			field: 'automaticModel',
			value: automaticModel,
		});
	}
	const models: ICometModelRuntime[] = configured.map(entry => {
		if (entry.protocol === 'openai-responses') {
			return new OpenAIResponsesModelRuntime({
				id: entry.runtime,
				descriptor: productModelDescriptor(entry, entry.configurationSchema),
				connectionResolver: new ResponsesConfigurationConnectionResolver(entry, options.credentials),
				maximumRequestMilliseconds,
				maximumRequestBytes,
				maximumResponseBytes,
				fetch: options.fetch,
				now: options.now,
			});
		}
		return new OpenAIChatCompletionsModelRuntime({
			id: entry.runtime,
			descriptor: productModelDescriptor(entry, entry.configurationSchema),
			connectionResolver: new ChatCompletionsConfigurationConnectionResolver(entry, options.credentials),
			maximumRequestMilliseconds,
			maximumRequestBytes,
			maximumResponseBytes,
			fetch: options.fetch,
			now: options.now,
		});
	});
	const executionProfileResolver = new ProductionCometExecutionProfileResolver(configured, automatic);
	return Object.freeze({
		models: Object.freeze(models),
		executionProfileResolver,
		automaticPreset: COMET_AUTOMATIC_EXECUTION_PRESET,
		automaticModel: automatic.model,
	});
}
