/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError } from 'cs/base/common/errors';
import type { LlmProviderId, LlmSettings } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { IAgentExecutionProfileRequest, IAgentModelDescriptor } from 'cs/platform/agentHost/common/agent';
import {
	AgentExecutionPresetId,
	AgentModelId,
	createAgentExecutionPresetId,
	createAgentModelDescriptorRevision,
	createAgentModelId,
} from 'cs/platform/agentHost/common/identities';
import { COMET_TOOL_SCHEMA_PROFILE } from 'cs/platform/agentHost/common/tools';
import type { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';
import type {
	ICometExecutionProfileResolution,
	ICometExecutionProfileResolver,
	ICometModelRuntime,
} from 'cs/platform/agentHost/node/agents/comet/cometModel';
import { CometModelError } from 'cs/platform/agentHost/node/agents/comet/cometModel';
import {
	OpenAIResponsesModelRuntime,
	OPENAI_RESPONSES_INPUT_FILE_MEDIA_TYPES,
	type IOpenAIResponsesConnectionResolutionRequest,
	type IOpenAIResponsesConnectionResolver,
	type IOpenAIResponsesExecutionSettings,
	type OpenAIResponsesReasoningEffort,
} from 'cs/platform/agentHost/node/agents/comet/providers/openAIResponses';
import {
	OpenAIChatCompletionsModelRuntime,
	OPENAI_CHAT_COMPLETIONS_TEXT_MEDIA_TYPES,
	type IOpenAIChatCompletionsConnectionResolutionRequest,
	type IOpenAIChatCompletionsConnectionResolver,
	type IOpenAIChatCompletionsExecutionSettings,
} from 'cs/platform/agentHost/node/agents/comet/providers/openAIChatCompletions';
import { ArticleAttachmentRepresentationMediaType } from 'cs/workbench/contrib/fetch/common/articleChatAttachments';
import {
	getLlmModelOptionsForProvider,
	getLlmProviderDefinition,
	llmProviderIds,
	type LlmModelOption,
} from 'cs/workbench/services/llm/registry';

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
const maximumOutputTokens = 1_000_000;
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

/** Supplies one catalog snapshot and the execution-time settings authority. */
export interface IProductionCometModelCatalogOptions {
	readonly settings: LlmSettings;
	readonly loadSettings: (signal: AbortSignal) => Promise<LlmSettings>;
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
}

/** Contains the exact model runtimes and execution-profile resolver registered for Comet. */
export interface IProductionCometModelCatalog {
	readonly models: readonly ICometModelRuntime[];
	readonly executionProfileResolver: ICometExecutionProfileResolver;
	readonly automaticPreset: AgentExecutionPresetId;
}

interface IConfiguredModelOptionBase {
	readonly option: LlmModelOption;
	readonly model: AgentModelId;
	readonly runtime: string;
}

type IConfiguredModelOption =
	| IConfiguredModelOptionBase & {
		readonly protocol: 'openai-responses';
		readonly settings: IOpenAIResponsesExecutionSettings;
	}
	| IConfiguredModelOptionBase & {
		readonly protocol: 'openai-chat-completions';
		readonly settings: IOpenAIChatCompletionsExecutionSettings;
	};

function invalidConfiguration(message: string, data: { readonly field: string; readonly value: string }): never {
	throw new CometModelError('invalidConfiguration', message, data);
}

function exactEnabledOptions(settings: LlmSettings, provider: LlmProviderId): readonly LlmModelOption[] {
	const providerSettings = settings.providers[provider];
	if (providerSettings === undefined || !Array.isArray(providerSettings.enabledModelOptions)) {
		return invalidConfiguration('Comet model catalog requires explicit enabled model options', {
			field: `settings.providers.${provider}.enabledModelOptions`,
			value: 'missing',
		});
	}
	const optionsByValue = new Map(
		getLlmModelOptionsForProvider(provider).map(option => [option.value, option] as const),
	);
	const enabled = new Set<string>();
	return Object.freeze(providerSettings.enabledModelOptions.map((value, index) => {
		if (typeof value !== 'string' || enabled.has(value)) {
			return invalidConfiguration('Comet model catalog contains an invalid enabled model option', {
				field: `settings.providers.${provider}.enabledModelOptions.${index}`,
				value: typeof value === 'string' ? value : typeof value,
			});
		}
		const option = optionsByValue.get(value);
		if (option === undefined) {
			return invalidConfiguration('Comet model catalog contains an unknown enabled model option', {
				field: `settings.providers.${provider}.enabledModelOptions.${index}`,
				value,
			});
		}
		enabled.add(value);
		return option;
	}));
}

function runtimeIdentity(option: LlmModelOption, protocol: IConfiguredModelOption['protocol']): string {
	return [
		protocol === 'openai-responses' ? 'openai.responses' : 'openai.chat-completions',
		option.providerId,
		option.modelId,
		option.reasoningEffort === undefined ? 'unspecified' : option.reasoningEffort,
		option.serviceTier === undefined ? 'unspecified' : option.serviceTier,
	].join('.');
}

function responsesModelDescriptor(option: LlmModelOption, model: AgentModelId, runtime: string): IAgentModelDescriptor {
	const fileMediaTypes = option.model.supports_image_input
		? OPENAI_RESPONSES_INPUT_FILE_MEDIA_TYPES
		: OPENAI_RESPONSES_INPUT_FILE_MEDIA_TYPES.filter(mediaType => mediaType !== 'application/pdf');
	const mediaTypes = [
		...cometResponsesAttachmentRepresentationMediaTypes,
		...fileMediaTypes,
		...(option.model.supports_image_input
			? ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
			: []),
	];
	if (new Set(mediaTypes).size !== mediaTypes.length) {
		return invalidConfiguration('Comet model descriptor contains duplicate attachment media types', {
			field: 'descriptor.attachments.mediaTypes',
			value: 'duplicate',
		});
	}
	return Object.freeze({
		id: model,
		revision: createAgentModelDescriptorRevision(`${runtime}.v1`),
		displayName: option.label,
		enabled: true,
		toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		attachments: Object.freeze({
			carriers: Object.freeze(['inline', 'reference'] as const),
			shapes: Object.freeze(['blob', 'tree'] as const),
			mediaTypes: Object.freeze(mediaTypes),
			maximumCount: maximumAttachmentCount,
			maximumItemBytes: maximumAttachmentItemBytes,
			maximumTotalBytes: maximumAttachmentTotalBytes,
			maximumTreeDepth: maximumAttachmentTreeDepth,
			maximumTreeEntries: maximumAttachmentTreeEntries,
			supportsClientContentForBackgroundExecution: true,
		}),
	});
}

function chatCompletionsModelDescriptor(option: LlmModelOption, model: AgentModelId, runtime: string): IAgentModelDescriptor {
	const mediaTypes = [
		...cometBlobAttachmentRepresentationMediaTypes,
		...OPENAI_CHAT_COMPLETIONS_TEXT_MEDIA_TYPES,
		...(option.model.supports_image_input
			? ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
			: []),
	];
	if (new Set(mediaTypes).size !== mediaTypes.length) {
		return invalidConfiguration('Comet model descriptor contains duplicate attachment media types', {
			field: 'descriptor.attachments.mediaTypes',
			value: 'duplicate',
		});
	}
	return Object.freeze({
		id: model,
		revision: createAgentModelDescriptorRevision(`${runtime}.v1`),
		displayName: option.label,
		enabled: true,
		toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		attachments: Object.freeze({
			carriers: Object.freeze(['inline', 'reference'] as const),
			shapes: Object.freeze(['blob'] as const),
			mediaTypes: Object.freeze(mediaTypes),
			maximumCount: maximumAttachmentCount,
			maximumItemBytes: maximumAttachmentItemBytes,
			maximumTotalBytes: maximumAttachmentTotalBytes,
			maximumTreeDepth: 0,
			maximumTreeEntries: 0,
			supportsClientContentForBackgroundExecution: true,
		}),
	});
}

function responsesExecutionSettings(option: LlmModelOption): IOpenAIResponsesExecutionSettings {
	const supportedReasoningEfforts: readonly OpenAIResponsesReasoningEffort[] = [
		'none',
		'minimal',
		'low',
		'medium',
		'high',
		'xhigh',
	];
	if (
		option.reasoningEffort !== undefined
		&& !supportedReasoningEfforts.includes(option.reasoningEffort as OpenAIResponsesReasoningEffort)
	) {
		return invalidConfiguration('Comet model option has an unsupported reasoning effort', {
			field: 'option.reasoningEffort',
			value: option.reasoningEffort,
		});
	}
	const effort = option.reasoningEffort as OpenAIResponsesReasoningEffort | undefined;
	const maxOutputTokens = option.model.max_output_tokens;
	if (
		!Number.isSafeInteger(maxOutputTokens)
		|| maxOutputTokens === undefined
		|| maxOutputTokens <= 0
		|| maxOutputTokens > maximumOutputTokens
	) {
		return invalidConfiguration('Comet model option requires an explicit valid output-token limit', {
			field: 'option.model.max_output_tokens',
			value: String(maxOutputTokens),
		});
	}
	return Object.freeze({
		version: 1,
		maxOutputTokens,
		temperature: null,
		reasoning: effort === undefined ? null : Object.freeze({ effort, summary: 'auto' }),
		serviceTier: option.serviceTier === undefined ? null : option.serviceTier,
		parallelToolCalls: true,
	});
}

function outputTokenLimit(option: LlmModelOption): number {
	const maxOutputTokens = option.model.max_output_tokens;
	if (
		!Number.isSafeInteger(maxOutputTokens)
		|| maxOutputTokens === undefined
		|| maxOutputTokens <= 0
		|| maxOutputTokens > maximumOutputTokens
	) {
		return invalidConfiguration('Comet model option requires an explicit valid output-token limit', {
			field: 'option.model.max_output_tokens',
			value: String(maxOutputTokens),
		});
	}
	return maxOutputTokens;
}

function chatCompletionsExecutionSettings(option: LlmModelOption): IOpenAIChatCompletionsExecutionSettings {
	if (option.reasoningEffort !== undefined || option.serviceTier !== undefined) {
		return invalidConfiguration('OpenAI Chat Completions model option contains unsupported execution controls', {
			field: option.reasoningEffort === undefined ? 'option.serviceTier' : 'option.reasoningEffort',
			value: option.reasoningEffort ?? option.serviceTier!,
		});
	}
	const provider = getLlmProviderDefinition(option.providerId);
	if (provider.protocol !== 'openai-chat-completions') {
		return invalidConfiguration('OpenAI Chat Completions model option has a different provider protocol', {
			field: 'provider.protocol',
			value: provider.protocol,
		});
	}
	return Object.freeze({
		version: 1,
		maxOutputTokens: outputTokenLimit(option),
		maximumOutputTokensField: provider.maximumOutputTokensField,
	});
}

function responsesEndpoint(baseUrl: string): string {
	if (baseUrl.length === 0) {
		return '';
	}
	return `${baseUrl.replace(/\/+$/, '')}/responses`;
}

function chatCompletionsEndpoint(baseUrl: string): string {
	if (baseUrl.length === 0) {
		return '';
	}
	return `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
}

async function loadCurrentSettings(
	loadSettings: (signal: AbortSignal) => Promise<LlmSettings>,
	signal: AbortSignal,
): Promise<LlmSettings> {
	let settings: LlmSettings;
	try {
		settings = await loadSettings(signal);
	} catch (error) {
		if (error instanceof CometModelError || error instanceof CancellationError) {
			throw error;
		}
		throw new CometModelError('connectionResolutionFailed', 'Comet model settings could not be loaded');
	}
	if (signal.aborted) {
		throw new CancellationError();
	}
	return settings;
}

function currentProviderSettings(expected: IConfiguredModelOption, settings: LlmSettings) {
	const provider = expected.option.providerId;
	const providerSettings = settings.providers[provider];
	if (
		providerSettings === undefined
		|| !Array.isArray(providerSettings.enabledModelOptions)
		|| !providerSettings.enabledModelOptions.includes(expected.option.value)
	) {
		throw new CometModelError('executionConnectionChanged', 'Configured Comet model selection changed', {
			provider,
			model: expected.model,
		});
	}
	return providerSettings;
}

/** Resolves one exact Responses model connection from the current settings authority. */
class ResponsesSettingsConnectionResolver implements IOpenAIResponsesConnectionResolver {
	constructor(
		private readonly expected: Extract<IConfiguredModelOption, { readonly protocol: 'openai-responses' }>,
		private readonly loadSettings: (signal: AbortSignal) => Promise<LlmSettings>,
	) {}

	async resolve(request: IOpenAIResponsesConnectionResolutionRequest) {
		if (request.runtime !== this.expected.runtime || request.model !== this.expected.model) {
			throw new CometModelError('executionConnectionChanged', 'Comet model connection identity changed');
		}
		const settings = await loadCurrentSettings(this.loadSettings, request.signal);
		const providerSettings = currentProviderSettings(this.expected, settings);
		return Object.freeze({
			endpoint: responsesEndpoint(providerSettings.baseUrl),
			apiKey: providerSettings.apiKey,
			providerModel: this.expected.option.modelId,
		});
	}
}

/** Resolves one exact Chat Completions model connection from the current settings authority. */
class ChatCompletionsSettingsConnectionResolver implements IOpenAIChatCompletionsConnectionResolver {
	constructor(
		private readonly expected: Extract<IConfiguredModelOption, { readonly protocol: 'openai-chat-completions' }>,
		private readonly loadSettings: (signal: AbortSignal) => Promise<LlmSettings>,
	) {}

	async resolve(request: IOpenAIChatCompletionsConnectionResolutionRequest) {
		if (request.runtime !== this.expected.runtime || request.model !== this.expected.model) {
			throw new CometModelError('executionConnectionChanged', 'Comet model connection identity changed');
		}
		const settings = await loadCurrentSettings(this.loadSettings, request.signal);
		const providerSettings = currentProviderSettings(this.expected, settings);
		return Object.freeze({
			endpoint: chatCompletionsEndpoint(providerSettings.baseUrl),
			apiKey: providerSettings.apiKey,
			providerModel: this.expected.option.modelId,
		});
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
	private readonly models = new Map<AgentModelId, ICometExecutionProfileResolution>();
	private readonly productPresets = new Map<AgentExecutionPresetId, ICometExecutionProfileResolution>();

	constructor(configured: readonly IConfiguredModelOption[], automatic: IConfiguredModelOption) {
		for (const entry of configured) {
			this.models.set(entry.model, Object.freeze({
				modelRuntime: entry.runtime,
				settings: entry.settings as unknown as AgentHostProtocolValue,
				maximumSteps,
			}));
		}
		this.productPresets.set(COMET_AUTOMATIC_EXECUTION_PRESET, Object.freeze({
			modelRuntime: automatic.runtime,
			settings: automatic.settings as unknown as AgentHostProtocolValue,
			maximumSteps,
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
			const resolution = this.models.get(model);
			if (resolution === undefined) {
				throw new CometModelError('invalidExecutionSelection', 'Unknown Comet model selection', {
					field: 'selection.value.model',
					value: model,
				});
			}
			return resolution;
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
			const resolution = this.productPresets.get(preset);
			if (resolution === undefined) {
				throw new CometModelError('invalidExecutionSelection', 'Unknown Comet product preset selection', {
					field: 'selection.value.preset',
					value: preset,
				});
			}
			return resolution;
		}
		throw new CometModelError('invalidExecutionSelection', 'Invalid Comet execution profile selection', {
			field: 'selection.kind',
			value: request.selection.kind,
		});
	}
}

/** Builds the exact production Comet model catalog from one settings snapshot. */
export function createProductionCometModelCatalog(options: IProductionCometModelCatalogOptions): IProductionCometModelCatalog {
	if (typeof options.loadSettings !== 'function' || typeof options.fetch !== 'function' || typeof options.now !== 'function') {
		return invalidConfiguration('Comet model catalog dependencies are invalid', {
			field: 'options',
			value: 'invalid',
		});
	}
	if (!llmProviderIds.includes(options.settings.activeProvider)) {
		return invalidConfiguration('Comet model catalog active provider is invalid', {
			field: 'settings.activeProvider',
			value: String(options.settings.activeProvider),
		});
	}
	const configured = llmProviderIds.flatMap<IConfiguredModelOption>(provider => {
		return exactEnabledOptions(options.settings, provider).map(option => {
			const providerDefinition = getLlmProviderDefinition(provider);
			const model = createAgentModelId(option.value);
			const runtime = runtimeIdentity(option, providerDefinition.protocol);
			if (providerDefinition.protocol === 'openai-responses') {
				return Object.freeze({
					protocol: providerDefinition.protocol,
					option,
					model,
					runtime,
					settings: responsesExecutionSettings(option),
				});
			}
			return Object.freeze({
				protocol: providerDefinition.protocol,
				option,
				model,
				runtime,
				settings: chatCompletionsExecutionSettings(option),
			});
		});
	});
	const configuredByValue = new Map(configured.map(entry => [entry.option.value, entry] as const));
	if (configuredByValue.size !== configured.length) {
		return invalidConfiguration('Comet model catalog contains duplicate model identities', {
			field: 'settings.providers',
			value: 'duplicate',
		});
	}
	const activeProviderSettings = options.settings.providers[options.settings.activeProvider];
	const automatic = activeProviderSettings === undefined
		? undefined
		: configuredByValue.get(activeProviderSettings.selectedModelOption);
	if (automatic === undefined || automatic.option.providerId !== options.settings.activeProvider) {
		return invalidConfiguration('Comet automatic profile requires the exact configured model option', {
			field: `settings.providers.${options.settings.activeProvider}.selectedModelOption`,
			value: activeProviderSettings === undefined ? 'missing' : activeProviderSettings.selectedModelOption,
		});
	}
	const models: ICometModelRuntime[] = configured.map(entry => {
		if (entry.protocol === 'openai-responses') {
			return new OpenAIResponsesModelRuntime({
				id: entry.runtime,
				descriptor: responsesModelDescriptor(entry.option, entry.model, entry.runtime),
				connectionResolver: new ResponsesSettingsConnectionResolver(entry, options.loadSettings),
				maximumRequestMilliseconds,
				maximumRequestBytes,
				maximumResponseBytes,
				fetch: options.fetch,
				now: options.now,
			});
		}
		return new OpenAIChatCompletionsModelRuntime({
			id: entry.runtime,
			descriptor: chatCompletionsModelDescriptor(entry.option, entry.model, entry.runtime),
			connectionResolver: new ChatCompletionsSettingsConnectionResolver(entry, options.loadSettings),
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
	});
}
