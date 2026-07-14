/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { CancellationError } from 'cs/base/common/errors';
import type {
	IAgentExecutionProfileRequest,
	IAgentModelDescriptor,
} from 'cs/platform/agentHost/common/agent';
import { validateAndFreezeAgentConfigurationSchema } from 'cs/platform/agentHost/common/configuration';
import {
	assertAgentHostAttachment,
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	assertAgentContentTreeEntry,
	assertAgentContentTreePath,
	type AgentContentTreeEntry,
} from 'cs/platform/agentHost/common/contentResources';
import {
	AgentExecutionPresetId,
	AgentInteractionTargetId,
	AgentModelId,
	AgentToolCallId,
	createAgentChatId,
	createAgentExecutionPresetId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentModelDescriptorRevision,
	createAgentModelId,
	createAgentSessionId,
	createAgentToolCallId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentTurnId,
} from 'cs/platform/agentHost/common/identities';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
} from 'cs/platform/agentHost/common/protocolValues';
import {
	COMET_TOOL_SCHEMA_PROFILE,
	type AgentToolMutationPayload,
	type CometToolSchemaNode,
	agentToolRegistrationAcceptsTarget,
	computeAgentToolMutationPayloadDigest,
	type IAgentToolRegistration,
	parseCometToolSchema,
	validateCometToolValue,
} from 'cs/platform/agentHost/common/tools';
import { COMET_AGENT_ID } from '../cometAgent.js';
import {
	CometModelError,
	type CometModelOutputPart,
	type ICometExecutionProfileResolution,
	type ICometExecutionProfileResolver,
	type ICometModelRuntime,
	type ICometModelStepRequest,
	type ICometModelStepResult,
} from '../cometModel.js';

export type OpenAIResponsesReasoningEffort =
	| 'none'
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'xhigh';

export type OpenAIResponsesReasoningSummary = 'auto' | 'concise' | 'detailed';
export type OpenAIResponsesServiceTier = 'auto' | 'default' | 'flex' | 'priority';

export interface IOpenAIResponsesExecutionSettings {
	readonly version: 1;
	readonly maxOutputTokens: number;
	readonly temperature: number | null;
	readonly reasoning: {
		readonly effort: OpenAIResponsesReasoningEffort;
		readonly summary: OpenAIResponsesReasoningSummary;
	} | null;
	readonly serviceTier: OpenAIResponsesServiceTier | null;
	readonly parallelToolCalls: boolean;
}

export interface IOpenAIResponsesModelProfileBinding {
	readonly model: AgentModelId;
	readonly modelRuntime: string;
	readonly settings: IOpenAIResponsesExecutionSettings;
	readonly maximumSteps: number;
}

export interface IOpenAIResponsesProductProfileBinding {
	readonly preset: AgentExecutionPresetId;
	readonly modelRuntime: string;
	readonly settings: IOpenAIResponsesExecutionSettings;
	readonly maximumSteps: number;
}

export interface IOpenAIResponsesExecutionProfileResolverOptions {
	readonly models: readonly IOpenAIResponsesModelProfileBinding[];
	readonly productPresets: readonly IOpenAIResponsesProductProfileBinding[];
}

export interface IOpenAIResponsesConnection {
	readonly endpoint: string;
	readonly apiKey: string;
	readonly providerModel: string;
}

export interface IOpenAIResponsesConnectionResolutionRequest {
	readonly runtime: string;
	readonly model: AgentModelId;
	readonly step: Pick<
		ICometModelStepRequest,
		'modelConfiguration' | 'credentials' | 'runtimeRegistration' | 'session' | 'chat' | 'turn'
	>;
	readonly token: CancellationToken;
	readonly signal: AbortSignal;
}

export interface IOpenAIResponsesConnectionResolver {
	resolve(request: IOpenAIResponsesConnectionResolutionRequest): Promise<IOpenAIResponsesConnection>;
}

export interface IOpenAIResponsesModelRuntimeOptions {
	readonly id: string;
	readonly descriptor: IAgentModelDescriptor;
	readonly connectionResolver: IOpenAIResponsesConnectionResolver;
	readonly maximumRequestMilliseconds: number;
	readonly maximumRequestBytes: number;
	readonly maximumResponseBytes: number;
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
}

interface IOpenAIResponsesToolBinding {
	readonly providerName: string;
	readonly registration: IAgentToolRegistration;
	readonly inputSchema: CometToolSchemaNode;
	readonly outputSchema: CometToolSchemaNode;
	readonly target?: IAgentHostInteractionTarget;
}

interface IOpenAIResponsesProjectedTools {
	readonly bindingsByProviderName: ReadonlyMap<string, IOpenAIResponsesToolBinding>;
	readonly bindingsByRegistration: ReadonlyMap<string, readonly IOpenAIResponsesToolBinding[]>;
	readonly definitions: readonly AgentHostProtocolValue[];
}

interface IOpenAIResponsesConvertedInput {
	readonly input: readonly AgentHostProtocolValue[];
	readonly historicalCallIds: ReadonlySet<string>;
}

const modelRuntimePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const providerFunctionNamePattern = /^[A-Za-z0-9_-]+$/;
const maximumProviderFunctionNameLength = 64;
const maximumProjectedToolDescriptionLength = 32 * 1024;
const maximumProjectedToolCount = 128;
const maximumOutputItemCount = 512;
const maximumExecutionSteps = 64;
const maximumOutputTokens = 1_000_000;
const maximumProviderStringLength = 16 * 1024 * 1024;
const maximumInputFileDataLength = 32 * 1024 * 1024;
const maximumInputImageUrlLength = 20 * 1024 * 1024;
const maximumMaterializedReadLength = 1024 * 1024;
const supportedImageMediaTypes = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
]);
const inputFileExtensionsByMediaType: Readonly<Record<string, string>> = Object.freeze({
	'application/pdf': 'pdf',
	'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
	'application/vnd.ms-excel': 'xls',
	'text/csv': 'csv',
	'application/csv': 'csv',
	'text/tsv': 'tsv',
	'text/x-iif': 'iif',
	'application/x-iif': 'iif',
	'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
	'application/msword': 'doc',
	'application/rtf': 'rtf',
	'text/rtf': 'rtf',
	'application/vnd.oasis.opendocument.text': 'odt',
	'application/vnd.apple.pages': 'pages',
	'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
	'application/vnd.ms-powerpoint': 'ppt',
	'application/vnd.apple.keynote': 'key',
	'application/javascript': 'js',
	'application/typescript': 'ts',
	'text/xml': 'xml',
	'application/xml': 'xml',
	'text/x-shellscript': 'sh',
	'text/x-rst': 'rst',
	'text/x-makefile': 'txt',
	'text/x-lisp': 'txt',
	'text/x-asm': 'asm',
	'text/vbscript': 'txt',
	'text/css': 'css',
	'message/rfc822': 'eml',
	'application/x-sql': 'sql',
	'application/x-scala': 'txt',
	'application/x-rust': 'rs',
	'application/x-powershell': 'txt',
	'text/x-diff': 'txt',
	'text/x-patch': 'txt',
	'application/x-patch': 'txt',
	'text/plain': 'txt',
	'text/markdown': 'md',
	'text/x-java': 'txt',
	'text/x-script.python': 'py',
	'text/x-python': 'py',
	'text/x-c': 'c',
	'text/x-c++': 'cpp',
	'text/x-golang': 'txt',
	'text/html': 'html',
	'text/x-php': 'txt',
	'application/x-php': 'txt',
	'application/x-httpd-php': 'txt',
	'application/x-httpd-php-source': 'txt',
	'text/x-ruby': 'txt',
	'text/x-sh': 'sh',
	'text/x-bash': 'sh',
	'application/x-bash': 'sh',
	'text/x-zsh': 'sh',
	'text/x-tex': 'txt',
	'text/x-csharp': 'txt',
	'application/json': 'json',
	'text/x-typescript': 'ts',
	'text/javascript': 'js',
	'text/x-go': 'txt',
	'text/x-rust': 'rs',
	'text/x-scala': 'txt',
	'text/x-kotlin': 'txt',
	'text/x-swift': 'txt',
	'text/x-lua': 'txt',
	'text/x-r': 'txt',
	'text/x-julia': 'txt',
	'text/x-perl': 'pl',
	'text/x-objectivec': 'txt',
	'text/x-objectivec++': 'txt',
	'text/x-erlang': 'txt',
	'text/x-elixir': 'txt',
	'text/x-haskell': 'txt',
	'text/x-clojure': 'txt',
	'text/x-groovy': 'txt',
	'text/x-dart': 'txt',
	'text/x-awk': 'txt',
	'application/x-awk': 'txt',
	'text/jsx': 'txt',
	'text/tsx': 'txt',
	'text/x-handlebars': 'txt',
	'text/x-mustache': 'txt',
	'text/x-ejs': 'txt',
	'text/x-jinja2': 'txt',
	'text/x-liquid': 'txt',
	'text/x-erb': 'txt',
	'text/x-twig': 'txt',
	'text/x-pug': 'txt',
	'text/x-jade': 'txt',
	'text/x-tmpl': 'txt',
	'text/x-cmake': 'txt',
	'text/x-dockerfile': 'txt',
	'text/x-gradle': 'txt',
	'text/x-ini': 'txt',
	'text/x-properties': 'txt',
	'text/x-protobuf': 'txt',
	'application/x-protobuf': 'txt',
	'text/x-sql': 'sql',
	'text/x-sass': 'txt',
	'text/x-scss': 'txt',
	'text/x-less': 'txt',
	'text/x-hcl': 'txt',
	'text/x-terraform': 'txt',
	'application/x-terraform': 'txt',
	'text/x-toml': 'txt',
	'application/x-toml': 'txt',
	'application/graphql': 'txt',
	'application/x-graphql': 'txt',
	'text/x-graphql': 'txt',
	'application/x-ndjson': 'json',
	'application/json5': 'json',
	'application/x-json5': 'json',
	'text/x-yaml': 'txt',
	'application/toml': 'txt',
	'application/x-yaml': 'txt',
	'application/yaml': 'txt',
	'text/x-astro': 'txt',
	'text/srt': 'srt',
	'application/x-subrip': 'srt',
	'text/x-subrip': 'srt',
	'text/vtt': 'vtt',
	'text/x-vcard': 'vcf',
	'text/calendar': 'ics',
});

/** Exact MIME types that this runtime can project as Responses `input_file` values. */
export const OPENAI_RESPONSES_INPUT_FILE_MEDIA_TYPES: readonly string[] = Object.freeze(
	Object.keys(inputFileExtensionsByMediaType),
);
const reasoningEfforts = new Set<OpenAIResponsesReasoningEffort>([
	'none',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
]);
const reasoningSummaries = new Set<OpenAIResponsesReasoningSummary>(['auto', 'concise', 'detailed']);
const serviceTiers = new Set<OpenAIResponsesServiceTier>(['auto', 'default', 'flex', 'priority']);

function diagnosticValue(value: unknown): AgentHostProtocolValue {
	if (value === null || typeof value === 'boolean') {
		return value;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : String(value);
	}
	if (typeof value === 'string') {
		return value.slice(0, 256);
	}
	if (Array.isArray(value)) {
		return `array(${value.length})`;
	}
	return typeof value;
}

function invalid(
	code: CometModelError['code'],
	message: string,
	field: string,
	value: unknown,
): never {
	throw new CometModelError(code, message, { field, value: diagnosticValue(value) });
}

function asRecord(
	value: unknown,
	code: CometModelError['code'],
	field: string,
	message: string,
): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalid(code, message, field, value);
	}
	return value as Readonly<Record<string, unknown>>;
}

function assertExactKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	code: CometModelError['code'],
	field: string,
	message: string,
): void {
	const allowed = new Set([...required, ...optional]);
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) {
			invalid(code, message, `${field}.${key}`, key);
		}
	}
	for (const key of required) {
		if (!Object.hasOwn(record, key)) {
			invalid(code, message, `${field}.${key}`, 'missing');
		}
	}
}

function assertNonEmptyString(
	value: unknown,
	maximumLength: number,
	code: CometModelError['code'],
	field: string,
	message: string,
): asserts value is string {
	if (
		typeof value !== 'string'
		|| value.length === 0
		|| value.length > maximumLength
		|| /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)
	) {
		invalid(code, message, field, value);
	}
}

function assertInteger(
	value: unknown,
	minimum: number,
	maximum: number,
	code: CometModelError['code'],
	field: string,
	message: string,
): asserts value is number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
		invalid(code, message, field, value);
	}
}

function assertIdentity(
	value: unknown,
	create: (candidate: string) => string,
	code: CometModelError['code'],
	field: string,
	message: string,
): asserts value is string {
	if (typeof value !== 'string') {
		invalid(code, message, field, value);
	}
	try {
		create(value);
	} catch {
		invalid(code, message, field, value);
	}
}

function cloneAndFreezeProtocolValue(value: AgentHostProtocolValue): AgentHostProtocolValue {
	const clone = JSON.parse(encodeAgentHostProtocolValue(value)) as AgentHostProtocolValue;
	const freeze = (candidate: AgentHostProtocolValue): AgentHostProtocolValue => {
		if (candidate !== null && typeof candidate === 'object') {
			for (const child of Array.isArray(candidate) ? candidate : Object.values(candidate)) {
				freeze(child);
			}
			Object.freeze(candidate);
		}
		return candidate;
	};
	return freeze(clone);
}

function parseExecutionSettings(value: unknown): IOpenAIResponsesExecutionSettings {
	const message = 'Invalid OpenAI Responses execution settings';
	const settings = asRecord(value, 'invalidExecutionSettings', 'settings', message);
	assertExactKeys(
		settings,
		['version', 'maxOutputTokens', 'temperature', 'reasoning', 'serviceTier', 'parallelToolCalls'],
		[],
		'invalidExecutionSettings',
		'settings',
		message,
	);
	if (settings.version !== 1) {
		invalid('invalidExecutionSettings', message, 'settings.version', settings.version);
	}
	assertInteger(
		settings.maxOutputTokens,
		1,
		maximumOutputTokens,
		'invalidExecutionSettings',
		'settings.maxOutputTokens',
		message,
	);
	if (
		settings.temperature !== null
		&& (
			typeof settings.temperature !== 'number'
			|| !Number.isFinite(settings.temperature)
			|| settings.temperature < 0
			|| settings.temperature > 2
		)
	) {
		invalid('invalidExecutionSettings', message, 'settings.temperature', settings.temperature);
	}

	let reasoning: IOpenAIResponsesExecutionSettings['reasoning'] = null;
	if (settings.reasoning !== null) {
		const candidate = asRecord(
			settings.reasoning,
			'invalidExecutionSettings',
			'settings.reasoning',
			message,
		);
		assertExactKeys(
			candidate,
			['effort', 'summary'],
			[],
			'invalidExecutionSettings',
			'settings.reasoning',
			message,
		);
		if (!reasoningEfforts.has(candidate.effort as OpenAIResponsesReasoningEffort)) {
			invalid('invalidExecutionSettings', message, 'settings.reasoning.effort', candidate.effort);
		}
		if (!reasoningSummaries.has(candidate.summary as OpenAIResponsesReasoningSummary)) {
			invalid('invalidExecutionSettings', message, 'settings.reasoning.summary', candidate.summary);
		}
		reasoning = Object.freeze({
			effort: candidate.effort as OpenAIResponsesReasoningEffort,
			summary: candidate.summary as OpenAIResponsesReasoningSummary,
		});
	}
	if (settings.serviceTier !== null && !serviceTiers.has(settings.serviceTier as OpenAIResponsesServiceTier)) {
		invalid('invalidExecutionSettings', message, 'settings.serviceTier', settings.serviceTier);
	}
	if (typeof settings.parallelToolCalls !== 'boolean') {
		invalid('invalidExecutionSettings', message, 'settings.parallelToolCalls', settings.parallelToolCalls);
	}
	return Object.freeze({
		version: 1,
		maxOutputTokens: settings.maxOutputTokens,
		temperature: settings.temperature as number | null,
		reasoning,
		serviceTier: settings.serviceTier as OpenAIResponsesServiceTier | null,
		parallelToolCalls: settings.parallelToolCalls,
	});
}

function profileResolution(
	modelRuntime: string,
	settings: IOpenAIResponsesExecutionSettings,
	maximumSteps: number,
): ICometExecutionProfileResolution {
	return Object.freeze({
		modelRuntime,
		settings: cloneAndFreezeProtocolValue(settings as unknown as AgentHostProtocolValue),
		maximumSteps,
	});
}

function validateProfileBinding(
	modelRuntime: unknown,
	settings: unknown,
	maximumSteps: unknown,
	field: string,
): ICometExecutionProfileResolution {
	if (typeof modelRuntime !== 'string' || !modelRuntimePattern.test(modelRuntime)) {
		invalid('invalidConfiguration', 'Invalid OpenAI Responses profile binding', `${field}.modelRuntime`, modelRuntime);
	}
	assertInteger(
		maximumSteps,
		1,
		maximumExecutionSteps,
		'invalidConfiguration',
		`${field}.maximumSteps`,
		'Invalid OpenAI Responses profile binding',
	);
	return profileResolution(modelRuntime, parseExecutionSettings(settings), maximumSteps);
}

export class OpenAIResponsesExecutionProfileResolver implements ICometExecutionProfileResolver {
	private readonly models = new Map<AgentModelId, ICometExecutionProfileResolution>();
	private readonly productPresets = new Map<AgentExecutionPresetId, ICometExecutionProfileResolution>();

	constructor(options: IOpenAIResponsesExecutionProfileResolverOptions) {
		if (!Array.isArray(options.models) || !Array.isArray(options.productPresets)) {
			invalid('invalidConfiguration', 'Invalid OpenAI Responses profile resolver configuration', 'profiles', options);
		}
		for (const [index, binding] of options.models.entries()) {
			assertIdentity(
				binding.model,
				createAgentModelId,
				'invalidConfiguration',
				`profiles.models.${index}.model`,
				'Invalid OpenAI Responses model profile binding',
			);
			if (this.models.has(binding.model)) {
				invalid(
					'invalidConfiguration',
					'Duplicate OpenAI Responses model profile binding',
					`profiles.models.${index}.model`,
					binding.model,
				);
			}
			this.models.set(
				binding.model,
				validateProfileBinding(
					binding.modelRuntime,
					binding.settings,
					binding.maximumSteps,
					`profiles.models.${index}`,
				),
			);
		}
		for (const [index, binding] of options.productPresets.entries()) {
			assertIdentity(
				binding.preset,
				createAgentExecutionPresetId,
				'invalidConfiguration',
				`profiles.productPresets.${index}.preset`,
				'Invalid OpenAI Responses product profile binding',
			);
			if (this.productPresets.has(binding.preset)) {
				invalid(
					'invalidConfiguration',
					'Duplicate OpenAI Responses product profile binding',
					`profiles.productPresets.${index}.preset`,
					binding.preset,
				);
			}
			this.productPresets.set(
				binding.preset,
				validateProfileBinding(
					binding.modelRuntime,
					binding.settings,
					binding.maximumSteps,
					`profiles.productPresets.${index}`,
				),
			);
		}
	}

	async resolve(request: IAgentExecutionProfileRequest): Promise<ICometExecutionProfileResolution> {
		const message = 'Invalid OpenAI Responses execution profile selection';
		const selection = asRecord(request.selection.value, 'invalidExecutionSelection', 'selection.value', message);
		if (request.selection.kind === 'user') {
			assertExactKeys(selection, ['model'], [], 'invalidExecutionSelection', 'selection.value', message);
			assertIdentity(
				selection.model,
				createAgentModelId,
				'invalidExecutionSelection',
				'selection.value.model',
				message,
			);
			const resolution = this.models.get(selection.model as AgentModelId);
			if (resolution === undefined) {
				invalid('invalidExecutionSelection', 'Unknown OpenAI Responses model selection', 'selection.value.model', selection.model);
			}
			return resolution;
		}
		if (request.selection.kind === 'product') {
			assertExactKeys(selection, ['preset'], [], 'invalidExecutionSelection', 'selection.value', message);
			assertIdentity(
				selection.preset,
				createAgentExecutionPresetId,
				'invalidExecutionSelection',
				'selection.value.preset',
				message,
			);
			const resolution = this.productPresets.get(selection.preset as AgentExecutionPresetId);
			if (resolution === undefined) {
				invalid('invalidExecutionSelection', 'Unknown OpenAI Responses product preset', 'selection.value.preset', selection.preset);
			}
			return resolution;
		}
		return invalid('invalidExecutionSelection', message, 'selection.kind', request.selection.kind);
	}
}

function assertProtocolValue(
	value: unknown,
	code: CometModelError['code'],
	field: string,
	message: string,
): asserts value is AgentHostProtocolValue {
	try {
		assertAgentHostProtocolValue(value);
	} catch {
		invalid(code, message, field, value);
	}
}

function parseCanonicalToolSchema(
	registration: IAgentToolRegistration,
	kind: 'inputSchema' | 'outputSchema',
	field: string,
): CometToolSchemaNode {
	try {
		return parseCometToolSchema(registration.descriptor[kind]);
	} catch {
		return invalid('invalidCanonicalTool', 'Invalid canonical Comet Tool schema', field, registration.descriptor[kind].value);
	}
}

function validateCanonicalToolValue(
	schema: CometToolSchemaNode,
	value: unknown,
	code: 'invalidCanonicalMessage' | 'invalidProviderResponse',
	field: string,
): AgentHostProtocolValue {
	assertProtocolValue(value, code, field, 'Invalid canonical Comet Tool value');
	try {
		return validateCometToolValue(schema, value, field);
	} catch {
		return invalid(code, 'Comet Tool value does not match its canonical schema', field, 'schema-mismatch');
	}
}

function describedJsonSchema(
	schema: CometToolSchemaNode,
	fields: Record<string, AgentHostProtocolValue>,
): AgentHostProtocolValue {
	if (schema.description !== undefined) {
		fields.description = schema.description;
	}
	return fields;
}

function openAIJsonSchema(schema: CometToolSchemaNode, field: string): AgentHostProtocolValue {
	switch (schema.type) {
		case 'null':
		case 'boolean':
			return describedJsonSchema(schema, { type: schema.type });
		case 'number':
		case 'integer': {
			const result: Record<string, AgentHostProtocolValue> = { type: schema.type };
			if (schema.minimum !== undefined) {
				result.minimum = schema.minimum;
			}
			if (schema.maximum !== undefined) {
				result.maximum = schema.maximum;
			}
			return describedJsonSchema(schema, result);
		}
		case 'string':
			if (schema.minimumLength !== undefined || schema.maximumLength !== undefined) {
				return invalid(
					'invalidCanonicalTool',
					'OpenAI strict function schemas cannot losslessly carry canonical string length bounds',
					field,
					'string-length-bounds',
				);
			}
			return describedJsonSchema(schema, {
				type: 'string',
				...(schema.enum === undefined ? {} : { enum: schema.enum }),
			});
		case 'array': {
			const result: Record<string, AgentHostProtocolValue> = {
				type: 'array',
				items: openAIJsonSchema(schema.items, `${field}.items`),
			};
			if (schema.minimumItems !== undefined) {
				result.minItems = schema.minimumItems;
			}
			if (schema.maximumItems !== undefined) {
				result.maxItems = schema.maximumItems;
			}
			return describedJsonSchema(schema, result);
		}
		case 'object': {
			const propertyNames = Object.keys(schema.properties);
			if (schema.required.length !== propertyNames.length || propertyNames.some(name => !schema.required.includes(name))) {
				return invalid(
					'invalidCanonicalTool',
					'OpenAI strict function schemas cannot losslessly carry optional canonical object properties',
					`${field}.required`,
					'not-all-properties-required',
				);
			}
			const properties: Record<string, AgentHostProtocolValue> = {};
			for (const [name, property] of Object.entries(schema.properties)) {
				properties[name] = openAIJsonSchema(property, `${field}.properties.${name}`);
			}
			return describedJsonSchema(schema, {
				type: 'object',
				properties,
				required: schema.required,
				additionalProperties: false,
			});
		}
		case 'literal':
			return describedJsonSchema(schema, {
				type: schema.value === null ? 'null' : typeof schema.value,
				enum: [schema.value],
			});
		case 'oneOf':
			return describedJsonSchema(schema, {
				anyOf: schema.variants.map((variant, index) => openAIJsonSchema(variant, `${field}.variants.${index}`)),
			});
	}
}

function isSupportedTextMediaType(mediaType: string): boolean {
	return mediaType.startsWith('text/')
		|| mediaType === 'application/json'
		|| mediaType.endsWith('+json')
		|| mediaType === 'application/xml'
		|| mediaType.endsWith('+xml');
}

function validateDescriptor(descriptor: IAgentModelDescriptor): IAgentModelDescriptor {
	const message = 'Invalid OpenAI Responses model descriptor';
	assertIdentity(descriptor.id, createAgentModelId, 'invalidConfiguration', 'descriptor.id', message);
	assertIdentity(
		descriptor.revision,
		createAgentModelDescriptorRevision,
		'invalidConfiguration',
		'descriptor.revision',
		message,
	);
	assertNonEmptyString(descriptor.displayName, 512, 'invalidConfiguration', 'descriptor.displayName', message);
	if (typeof descriptor.enabled !== 'boolean') {
		invalid('invalidConfiguration', message, 'descriptor.enabled', descriptor.enabled);
	}
	if (
		!Array.isArray(descriptor.toolSchemaProfiles)
		|| descriptor.toolSchemaProfiles.length !== 1
		|| descriptor.toolSchemaProfiles[0] !== COMET_TOOL_SCHEMA_PROFILE
	) {
		invalid('invalidConfiguration', message, 'descriptor.toolSchemaProfiles', descriptor.toolSchemaProfiles);
	}
	const attachments = descriptor.attachments;
	if (
		!Array.isArray(attachments.carriers)
		|| attachments.carriers.length === 0
		|| new Set(attachments.carriers).size !== attachments.carriers.length
		|| attachments.carriers.some(carrier => carrier !== 'inline' && carrier !== 'reference')
		|| !Array.isArray(attachments.shapes)
		|| attachments.shapes.length === 0
		|| new Set(attachments.shapes).size !== attachments.shapes.length
		|| attachments.shapes.some(shape => shape !== 'blob' && shape !== 'tree')
	) {
		invalid('invalidConfiguration', message, 'descriptor.attachments.carriers', attachments.carriers);
	}
	if (
		!Array.isArray(attachments.mediaTypes)
		|| attachments.mediaTypes.length === 0
		|| new Set(attachments.mediaTypes).size !== attachments.mediaTypes.length
	) {
		invalid('invalidConfiguration', message, 'descriptor.attachments.mediaTypes', attachments.mediaTypes);
	}
	for (const [index, mediaType] of attachments.mediaTypes.entries()) {
		if (
			typeof mediaType !== 'string'
			|| (
				!isSupportedTextMediaType(mediaType)
				&& !supportedImageMediaTypes.has(mediaType)
				&& inputFileExtensionsByMediaType[mediaType] === undefined
			)
		) {
			invalid('invalidConfiguration', message, `descriptor.attachments.mediaTypes.${index}`, mediaType);
		}
	}
	assertInteger(
		attachments.maximumCount,
		1,
		1_024,
		'invalidConfiguration',
		'descriptor.attachments.maximumCount',
		message,
	);
	assertInteger(
		attachments.maximumItemBytes,
		1,
		32 * 1024 * 1024,
		'invalidConfiguration',
		'descriptor.attachments.maximumItemBytes',
		message,
	);
	assertInteger(
		attachments.maximumTotalBytes,
		attachments.maximumItemBytes,
		128 * 1024 * 1024,
		'invalidConfiguration',
		'descriptor.attachments.maximumTotalBytes',
		message,
	);
	if (attachments.shapes.includes('tree')) {
		assertInteger(
			attachments.maximumTreeDepth,
			1,
			1_024,
			'invalidConfiguration',
			'descriptor.attachments.maximumTreeDepth',
			message,
		);
		assertInteger(
			attachments.maximumTreeEntries,
			1,
			1_000_000,
			'invalidConfiguration',
			'descriptor.attachments.maximumTreeEntries',
			message,
		);
	} else if (attachments.maximumTreeDepth !== 0 || attachments.maximumTreeEntries !== 0) {
		invalid('invalidConfiguration', message, 'descriptor.attachments.maximumTreeDepth', attachments.maximumTreeDepth);
	}
	if (typeof attachments.supportsClientContentForBackgroundExecution !== 'boolean') {
		invalid(
			'invalidConfiguration',
			message,
			'descriptor.attachments.supportsClientContentForBackgroundExecution',
			attachments.supportsClientContentForBackgroundExecution,
		);
	}
	return Object.freeze({
		id: descriptor.id,
		revision: descriptor.revision,
		displayName: descriptor.displayName,
		enabled: descriptor.enabled,
		configurationSchema: validateAndFreezeAgentConfigurationSchema(descriptor.configurationSchema, {
			agent: COMET_AGENT_ID,
			scope: 'model',
		}),
		toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		attachments: Object.freeze({
			carriers: Object.freeze([...attachments.carriers]),
			shapes: Object.freeze([...attachments.shapes]),
			mediaTypes: Object.freeze([...attachments.mediaTypes]),
			maximumCount: attachments.maximumCount,
			maximumItemBytes: attachments.maximumItemBytes,
			maximumTotalBytes: attachments.maximumTotalBytes,
			maximumTreeDepth: attachments.maximumTreeDepth,
			maximumTreeEntries: attachments.maximumTreeEntries,
			supportsClientContentForBackgroundExecution: attachments.supportsClientContentForBackgroundExecution,
		}),
	});
}

function validateEndpoint(value: unknown): string {
	assertNonEmptyString(value, 4_096, 'invalidConfiguration', 'endpoint', 'Invalid OpenAI Responses endpoint');
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		return invalid('invalidConfiguration', 'Invalid OpenAI Responses endpoint', 'endpoint', value);
	}
	if (
		endpoint.protocol !== 'https:'
		|| endpoint.username.length !== 0
		|| endpoint.password.length !== 0
		|| endpoint.hash.length !== 0
		|| !endpoint.pathname.endsWith('/responses')
	) {
		invalid('invalidConfiguration', 'Invalid OpenAI Responses endpoint', 'endpoint', value);
	}
	return endpoint.toString();
}

function validateProviderName(name: unknown, field: string): asserts name is string {
	assertNonEmptyString(name, maximumProviderFunctionNameLength, 'invalidCanonicalTool', field, 'Invalid canonical Tool function name');
	if (!providerFunctionNamePattern.test(name)) {
		invalid('invalidCanonicalTool', 'Invalid canonical Tool function name', field, name);
	}
}

function canonicalToolDescription(
	registration: IAgentToolRegistration,
	target: IAgentHostInteractionTarget | undefined,
): string {
	const descriptor = registration.descriptor;
	const contract = {
		registration: registration.id,
		tool: descriptor.id,
		displayName: descriptor.displayName,
		safety: descriptor.safety,
		confirmation: descriptor.confirmation,
		allowsEditedInput: descriptor.allowsEditedInput,
		limits: descriptor.limits,
		outputSchema: descriptor.outputSchema.value,
		...(target === undefined ? {} : { target }),
	};
	const description = `${descriptor.description}\nCanonical Tool contract: ${encodeAgentHostProtocolValue(contract)}`;
	if (description.length > maximumProjectedToolDescriptionLength) {
		invalid(
			'invalidCanonicalTool',
			'Canonical Tool description exceeds the OpenAI Responses projection limit',
			`tool.${registration.id}.description`,
			description.length,
		);
	}
	return description;
}

function validateRegistration(
	registration: IAgentToolRegistration,
	index: number,
): {
	readonly inputSchema: CometToolSchemaNode;
	readonly outputSchema: CometToolSchemaNode;
	readonly parameters: AgentHostProtocolValue;
} {
	const field = `toolSet.registrations.${index}`;
	const message = 'Invalid canonical Tool registration';
	assertIdentity(registration.id, createAgentToolRegistrationId, 'invalidCanonicalTool', `${field}.id`, message);
	assertIdentity(
		registration.revision,
		createAgentToolRegistrationRevision,
		'invalidCanonicalTool',
		`${field}.revision`,
		message,
	);
	const descriptor = registration.descriptor;
	validateProviderName(descriptor.functionName, `${field}.descriptor.functionName`);
	assertNonEmptyString(descriptor.displayName, 512, 'invalidCanonicalTool', `${field}.descriptor.displayName`, message);
	assertNonEmptyString(descriptor.description, 16_384, 'invalidCanonicalTool', `${field}.descriptor.description`, message);
	if (
		descriptor.inputSchema.profile !== COMET_TOOL_SCHEMA_PROFILE
		|| descriptor.outputSchema.profile !== COMET_TOOL_SCHEMA_PROFILE
	) {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.inputSchema.profile`, descriptor.inputSchema.profile);
	}
	const inputSchema = parseCanonicalToolSchema(registration, 'inputSchema', `${field}.descriptor.inputSchema.value`);
	const outputSchema = parseCanonicalToolSchema(registration, 'outputSchema', `${field}.descriptor.outputSchema.value`);
	if (inputSchema.type !== 'object') {
		invalid('invalidCanonicalTool', 'OpenAI Responses Tool input schema must be a canonical object', `${field}.descriptor.inputSchema.type`, inputSchema.type);
	}
	const parameters = openAIJsonSchema(inputSchema, `${field}.descriptor.inputSchema`);
	if (!['read', 'write', 'external'].includes(descriptor.safety)) {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.safety`, descriptor.safety);
	}
	if (!['never', 'always', 'writeOrExternal'].includes(descriptor.confirmation)) {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.confirmation`, descriptor.confirmation);
	}
	if (typeof descriptor.allowsEditedInput !== 'boolean') {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.allowsEditedInput`, descriptor.allowsEditedInput);
	}
	if (
		!Array.isArray(descriptor.targetTypes)
		|| new Set(descriptor.targetTypes).size !== descriptor.targetTypes.length
	) {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.targetTypes`, descriptor.targetTypes);
	}
	return { inputSchema, outputSchema, parameters };
}

function projectTools(request: ICometModelStepRequest): IOpenAIResponsesProjectedTools {
	if (
		request.toolSet.schemaProfile !== COMET_TOOL_SCHEMA_PROFILE
		|| request.toolSet.modelDescriptor !== request.profile.modelDescriptor
	) {
		invalid('invalidCanonicalTool', 'Canonical Tool set does not match this OpenAI Responses model', 'toolSet', request.toolSet.revision);
	}
	const targetIds = new Set<string>();
	for (const [index, target] of request.interactionTargets.entries()) {
		try {
			assertAgentHostInteractionTarget(target);
		} catch {
			invalid('invalidCanonicalTool', 'Invalid canonical interaction target', `interactionTargets.${index}`, target);
		}
		if (targetIds.has(target.id)) {
			invalid('invalidCanonicalTool', 'Duplicate canonical interaction target', `interactionTargets.${index}.id`, target.id);
		}
		targetIds.add(target.id);
	}

	const definitions: AgentHostProtocolValue[] = [];
	const bindingsByProviderName = new Map<string, IOpenAIResponsesToolBinding>();
	const bindingsByRegistration = new Map<string, readonly IOpenAIResponsesToolBinding[]>();
	const projectedTargets = new Set<AgentInteractionTargetId>();
	for (const [index, registration] of request.toolSet.registrations.entries()) {
		const schemas = validateRegistration(registration, index);
		const compatibleTargets = registration.descriptor.targetTypes.length === 0
			? [undefined]
			: request.interactionTargets.filter(target => agentToolRegistrationAcceptsTarget(registration, target));
		if (compatibleTargets.length === 0) {
			invalid(
				'invalidCanonicalTool',
				'Target-bound canonical Tool has no compatible interaction target',
				`toolSet.registrations.${index}.descriptor.targetTypes`,
				registration.descriptor.targetTypes,
			);
		}
		const registrationBindings: IOpenAIResponsesToolBinding[] = [];
		for (const [targetIndex, target] of compatibleTargets.entries()) {
			const providerName = target === undefined
				? registration.descriptor.functionName
				: `${registration.descriptor.functionName}__target_${targetIndex + 1}`;
			validateProviderName(providerName, `toolSet.registrations.${index}.providerName`);
			if (bindingsByProviderName.has(providerName)) {
				invalid('invalidCanonicalTool', 'Duplicate projected OpenAI Responses Tool name', 'tool.providerName', providerName);
			}
			const binding: IOpenAIResponsesToolBinding = Object.freeze({
				providerName,
				registration,
				inputSchema: schemas.inputSchema,
				outputSchema: schemas.outputSchema,
				...(target === undefined ? {} : { target }),
			});
			bindingsByProviderName.set(providerName, binding);
			registrationBindings.push(binding);
			if (target !== undefined) {
				projectedTargets.add(target.id);
			}
			definitions.push({
				type: 'function',
				name: providerName,
				description: canonicalToolDescription(registration, target),
				parameters: schemas.parameters,
				strict: true,
			});
		}
		bindingsByRegistration.set(registration.id, Object.freeze(registrationBindings));
	}
	if (definitions.length > maximumProjectedToolCount) {
		invalid('invalidCanonicalTool', 'Too many projected OpenAI Responses Tools', 'tools.length', definitions.length);
	}
	for (const [index, target] of request.interactionTargets.entries()) {
		if (!projectedTargets.has(target.id)) {
			invalid(
				'invalidCanonicalTool',
				'Canonical interaction target cannot be represented by the OpenAI Responses Tool set',
				`interactionTargets.${index}.id`,
				target.id,
			);
		}
	}
	return {
		bindingsByProviderName,
		bindingsByRegistration,
		definitions: Object.freeze(definitions),
	};
}

function bindingForCanonicalCall(
	registrationId: string,
	target: AgentInteractionTargetId | undefined,
	projected: IOpenAIResponsesProjectedTools,
	field: string,
): IOpenAIResponsesToolBinding {
	const candidates = projected.bindingsByRegistration.get(registrationId);
	if (candidates === undefined) {
		return invalid('invalidCanonicalMessage', 'Canonical model history references an unknown Tool', `${field}.registrationId`, registrationId);
	}
	const binding = candidates.find(candidate => candidate.target?.id === target);
	if (binding === undefined) {
		return invalid('invalidCanonicalMessage', 'Canonical model history references an invalid Tool target', `${field}.target`, target === undefined ? 'missing' : target);
	}
	return binding;
}

function validateCanonicalCall(
	call: Extract<CometModelOutputPart, { readonly kind: 'toolCall' }>['call'],
	binding: IOpenAIResponsesToolBinding,
	field: string,
): void {
	assertIdentity(call.id, createAgentToolCallId, 'invalidCanonicalMessage', `${field}.id`, 'Invalid canonical Tool call history');
	validateCanonicalToolValue(binding.inputSchema, call.input, 'invalidCanonicalMessage', `${field}.input`);
	if (binding.registration.descriptor.safety === 'read') {
		if (call.effect.kind !== 'read') {
			invalid('invalidCanonicalMessage', 'Canonical Tool call has an invalid effect', `${field}.effect`, call.effect.kind);
		}
	} else {
		if (call.effect.kind !== 'mutation') {
			invalid('invalidCanonicalMessage', 'Canonical Tool call has an invalid effect', `${field}.effect`, call.effect.kind);
		}
		assertIdentity(
			call.effect.operation,
			createAgentHostOperationId,
			'invalidCanonicalMessage',
			`${field}.effect.operation`,
			'Invalid canonical Tool call history',
		);
		assertIdentity(
			call.effect.payloadDigest,
			createAgentHostPayloadDigest,
			'invalidCanonicalMessage',
			`${field}.effect.payloadDigest`,
			'Invalid canonical Tool call history',
		);
	}
}

function attachmentEnvelope(attachment: ICometModelStepRequest['attachments'][number]): AgentHostProtocolValue {
	const content = attachment.attachment.content;
	return {
		envelopeVersion: attachment.attachment.envelopeVersion,
		id: attachment.attachment.id,
		producerType: attachment.attachment.producerType,
		display: {
			label: attachment.attachment.display.label,
			...(attachment.attachment.display.description === undefined
				? {}
				: { description: attachment.attachment.display.description }),
		},
		representation: {
			schema: attachment.attachment.representation.schema,
			mediaType: attachment.attachment.representation.mediaType,
			value: attachment.attachment.representation.value,
		},
		metadata: attachment.attachment.metadata.map(entry => ({
			namespace: entry.namespace,
			value: entry.value,
		})),
		...(content === undefined
			? {}
			: content.kind === 'inline'
				? {
					content: {
						kind: content.kind,
						mediaType: content.mediaType,
						encoding: content.encoding,
						byteLength: content.byteLength,
						version: content.version,
						digest: content.digest,
					},
				}
				: {
					content: {
						kind: content.kind,
						reference: content.reference,
						owner: content.owner.kind === 'host'
							? { kind: 'host' }
							: { kind: 'client', connection: content.owner.connection },
						shape: content.shape,
						...(content.mediaType === undefined ? {} : { mediaType: content.mediaType }),
						bounds: {
							byteLength: content.bounds.byteLength,
							maximumReadLength: content.bounds.maximumReadLength,
							...(content.bounds.treeDepth === undefined ? {} : { treeDepth: content.bounds.treeDepth }),
							...(content.bounds.treeEntryCount === undefined ? {} : { treeEntryCount: content.bounds.treeEntryCount }),
						},
						version: content.version,
						digest: content.digest,
					},
				}),
	};
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) {
		throw new CancellationError();
	}
}

function validateMaterializedResource(value: unknown, field: string): string {
	assertNonEmptyString(
		value,
		4_096,
		'unsupportedAttachment',
		field,
		'Invalid materialized attachment resource',
	);
	if (!path.isAbsolute(value) || path.resolve(value) !== value) {
		invalid('unsupportedAttachment', 'Invalid materialized attachment resource', field, value);
	}
	return value;
}

async function runMaterializedOperation<T>(
	field: string,
	signal: AbortSignal,
	operation: () => Promise<T>,
): Promise<T> {
	try {
		throwIfAborted(signal);
		const result = await operation();
		throwIfAborted(signal);
		return result;
	} catch (error) {
		if (error instanceof CometModelError || error instanceof CancellationError) {
			throw error;
		}
		if (signal.aborted) {
			throw new CancellationError();
		}
		return invalid(
			'unsupportedAttachment',
			'Materialized attachment content is unavailable or changed',
			field,
			'filesystem-error',
		);
	}
}

function digestBytes(bytes: Uint8Array): string {
	return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

async function readVerifiedMaterializedFile(
	resourceValue: unknown,
	expectedByteLength: number,
	expectedDigest: string,
	maximumReadLength: number,
	field: string,
	signal: AbortSignal,
): Promise<Uint8Array> {
	const resource = validateMaterializedResource(resourceValue, field);
	return runMaterializedOperation(field, signal, async () => {
		const resourceRealPath = await realpath(resource);
		const metadata = await lstat(resource);
		if (
			resourceRealPath !== resource
			|| metadata.isSymbolicLink()
			|| !metadata.isFile()
			|| metadata.size !== expectedByteLength
			|| (expectedByteLength > 0 && maximumReadLength <= 0)
		) {
			return invalid(
				'unsupportedAttachment',
				'Materialized attachment file does not match its canonical bounds',
				field,
				'metadata-mismatch',
			);
		}
		const handle = await open(resource, constants.O_RDONLY | constants.O_NOFOLLOW);
		try {
			const before = await handle.stat();
			if (!before.isFile() || before.size !== expectedByteLength) {
				return invalid(
					'unsupportedAttachment',
					'Materialized attachment file changed before it was read',
					field,
					'changed',
				);
			}
			const bytes = new Uint8Array(expectedByteLength);
			let offset = 0;
			while (offset < bytes.byteLength) {
				throwIfAborted(signal);
				const length = Math.min(
					maximumMaterializedReadLength,
					maximumReadLength,
					bytes.byteLength - offset,
				);
				const result = await handle.read(bytes, offset, length, offset);
				if (result.bytesRead <= 0 || result.bytesRead > length) {
					return invalid(
						'unsupportedAttachment',
						'Materialized attachment file returned an invalid read length',
						field,
						result.bytesRead,
					);
				}
				offset += result.bytesRead;
			}
			const after = await handle.stat();
			if (
				before.dev !== after.dev
				|| before.ino !== after.ino
				|| before.size !== after.size
				|| before.mtimeMs !== after.mtimeMs
				|| before.ctimeMs !== after.ctimeMs
			) {
				return invalid(
					'unsupportedAttachment',
					'Materialized attachment file changed while it was read',
					field,
					'changed',
				);
			}
			if (digestBytes(bytes) !== expectedDigest) {
				return invalid(
					'unsupportedAttachment',
					'Materialized attachment file digest does not match its canonical digest',
					field,
					'digest-mismatch',
				);
			}
			return bytes;
		} finally {
			await handle.close();
		}
	});
}

function inputFileData(mediaType: string, bytes: Uint8Array, field: string): string {
	const value = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
	if (value.length > maximumInputFileDataLength) {
		invalid(
			'unsupportedAttachment',
			'OpenAI Responses input_file data exceeds its provider limit',
			field,
			value.length,
		);
	}
	return value;
}

function inputImageData(mediaType: string, bytes: Uint8Array, field: string): string {
	const value = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
	if (value.length > maximumInputImageUrlLength) {
		invalid(
			'unsupportedAttachment',
			'OpenAI Responses input_image data exceeds its provider limit',
			field,
			value.length,
		);
	}
	return value;
}

function inputFilePart(
	mediaType: string,
	bytes: Uint8Array,
	filenamePrefix: string,
	field: string,
): AgentHostProtocolValue {
	const extension = inputFileExtensionsByMediaType[mediaType];
	if (extension === undefined) {
		return invalid(
			'unsupportedAttachment',
			'OpenAI Responses input_file does not support this exact attachment media type',
			field,
			mediaType,
		);
	}
	return {
		type: 'input_file',
		filename: `${filenamePrefix}.${extension}`,
		file_data: inputFileData(mediaType, bytes, field),
		...(mediaType === 'application/pdf' ? { detail: 'auto' } : {}),
	};
}

interface IMaterializedTreeFilesystemEntry {
	readonly kind: 'directory' | 'file';
	readonly path: string;
	readonly byteLength?: number;
}

function comparePaths(left: string, right: string): number {
	return left < right ? -1 : left > right ? 1 : 0;
}

async function enumerateMaterializedTree(
	root: string,
	maximumEntries: number,
	maximumDepth: number,
	field: string,
	signal: AbortSignal,
): Promise<readonly IMaterializedTreeFilesystemEntry[]> {
	return runMaterializedOperation(field, signal, async () => {
		const rootRealPath = await realpath(root);
		const rootMetadata = await lstat(root);
		if (rootRealPath !== root || rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
			return invalid(
				'unsupportedAttachment',
				'Materialized attachment tree root is invalid',
				field,
				'root-mismatch',
			);
		}
		const result: IMaterializedTreeFilesystemEntry[] = [];
		const visit = async (directory: string, prefix: string): Promise<void> => {
			throwIfAborted(signal);
			const names = (await readdir(directory)).sort(comparePaths);
			for (const name of names) {
				throwIfAborted(signal);
				const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
				try {
					assertAgentContentTreePath(relativePath, `${field}.path`);
				} catch {
					return invalid(
						'unsupportedAttachment',
						'Materialized attachment tree contains an invalid path',
						`${field}.path`,
						relativePath,
					);
				}
				const child = path.join(directory, name);
				const childRealPath = await realpath(child);
				const metadata = await lstat(child);
				if (childRealPath !== child || metadata.isSymbolicLink()) {
					return invalid(
						'unsupportedAttachment',
						'Materialized attachment tree contains a symbolic link',
						`${field}.path`,
						relativePath,
					);
				}
				if (metadata.isDirectory()) {
					result.push(Object.freeze({ kind: 'directory', path: relativePath }));
				} else if (metadata.isFile()) {
					result.push(Object.freeze({ kind: 'file', path: relativePath, byteLength: metadata.size }));
				} else {
					return invalid(
						'unsupportedAttachment',
						'Materialized attachment tree contains a non-file entry',
						`${field}.path`,
						relativePath,
					);
				}
				if (result.length > maximumEntries || relativePath.split('/').length > maximumDepth) {
					return invalid(
						'unsupportedAttachment',
						'Materialized attachment tree exceeds its canonical bounds',
						field,
						result.length,
					);
				}
				if (metadata.isDirectory()) {
					await visit(child, relativePath);
				}
			}
		};
		await visit(root, '');
		return Object.freeze(result);
	});
}

function validateMaterializedTreeEntries(
	value: readonly AgentContentTreeEntry[] | null,
	content: Extract<ICometModelStepRequest['attachments'][number]['content'], { readonly kind: 'materialized' }>['content'],
	mediaTypes: ReadonlySet<string>,
	field: string,
): readonly AgentContentTreeEntry[] {
	if (content.shape !== 'tree' || !Array.isArray(value)) {
		return invalid('unsupportedAttachment', 'Materialized attachment tree manifest is missing', field, value);
	}
	const expectedCount = content.bounds.treeEntryCount;
	const expectedDepth = content.bounds.treeDepth;
	if (
		expectedCount === undefined
		|| expectedDepth === undefined
		|| expectedCount <= 0
		|| expectedDepth <= 0
		|| value.length !== expectedCount
	) {
		return invalid('unsupportedAttachment', 'Materialized attachment tree bounds are invalid', field, value.length);
	}
	const entries: AgentContentTreeEntry[] = [];
	const entriesByPath = new Map<string, AgentContentTreeEntry>();
	let fileBytes = 0;
	let maximumDepth = 0;
	for (const [index, candidate] of value.entries()) {
		try {
			assertAgentContentTreeEntry(candidate, `${field}.${index}`);
		} catch {
			return invalid('unsupportedAttachment', 'Materialized attachment tree manifest is invalid', `${field}.${index}`, candidate);
		}
		if (
			entriesByPath.has(candidate.path)
			|| (entries.length > 0 && comparePaths(entries[entries.length - 1].path, candidate.path) >= 0)
		) {
			return invalid('unsupportedAttachment', 'Materialized attachment tree manifest is not strictly ordered', `${field}.${index}.path`, candidate.path);
		}
		if (candidate.kind === 'file') {
			fileBytes += candidate.byteLength;
			if (!Number.isSafeInteger(fileBytes) || fileBytes > content.bounds.byteLength) {
				return invalid('unsupportedAttachment', 'Materialized attachment tree byte bounds are invalid', field, fileBytes);
			}
			if (candidate.mediaType !== null && !mediaTypes.has(candidate.mediaType)) {
				return invalid(
					'unsupportedAttachment',
					'Materialized attachment tree entry media type is not advertised by this model',
					`${field}.${index}.mediaType`,
					candidate.mediaType,
				);
			}
		}
		maximumDepth = Math.max(maximumDepth, candidate.path.split('/').length);
		const entry = Object.freeze({ ...candidate }) as AgentContentTreeEntry;
		entries.push(entry);
		entriesByPath.set(entry.path, entry);
	}
	for (const entry of entries) {
		const segments = entry.path.split('/');
		for (let index = 1; index < segments.length; index += 1) {
			if (entriesByPath.get(segments.slice(0, index).join('/'))?.kind !== 'directory') {
				return invalid('unsupportedAttachment', 'Materialized attachment tree manifest has an invalid parent', field, entry.path);
			}
		}
	}
	if (
		fileBytes !== content.bounds.byteLength
		|| maximumDepth !== expectedDepth
		|| digestBytes(new TextEncoder().encode(encodeAgentHostProtocolValue(entries))) !== content.digest
	) {
		return invalid('unsupportedAttachment', 'Materialized attachment tree manifest does not match its canonical digest', field, 'digest-mismatch');
	}
	return Object.freeze(entries);
}

async function materializedTreePart(
	modelAttachment: ICometModelStepRequest['attachments'][number],
	index: number,
	mediaTypes: ReadonlySet<string>,
	signal: AbortSignal,
): Promise<AgentHostProtocolValue> {
	if (modelAttachment.content?.kind !== 'materialized') {
		return invalid('unsupportedAttachment', 'Materialized attachment content is missing', `attachments.${index}.content`, 'missing');
	}
	const field = `attachments.${index}.content`;
	const content = modelAttachment.content.content;
	const root = validateMaterializedResource(modelAttachment.content.resource, `${field}.resource`);
	const entries = validateMaterializedTreeEntries(
		modelAttachment.content.treeEntries,
		content,
		mediaTypes,
		`${field}.treeEntries`,
	);
	const filesystemEntries = await enumerateMaterializedTree(
		root,
		content.bounds.treeEntryCount!,
		content.bounds.treeDepth!,
		`${field}.resource`,
		signal,
	);
	if (filesystemEntries.length !== entries.length) {
		return invalid('unsupportedAttachment', 'Materialized attachment tree contains an unexpected entry', `${field}.resource`, filesystemEntries.length);
	}
	for (const [entryIndex, filesystemEntry] of filesystemEntries.entries()) {
		const entry = entries[entryIndex];
		if (
			entry.kind !== filesystemEntry.kind
			|| entry.path !== filesystemEntry.path
			|| (entry.kind === 'file' && entry.byteLength !== filesystemEntry.byteLength)
		) {
			return invalid('unsupportedAttachment', 'Materialized attachment tree does not match its canonical manifest', `${field}.resource`, filesystemEntry.path);
		}
	}

	const projectedEntries: AgentHostProtocolValue[] = [];
	for (const entry of entries) {
		if (entry.kind === 'directory') {
			projectedEntries.push({ kind: 'directory', path: entry.path });
			continue;
		}
		const resource = path.join(root, ...entry.path.split('/'));
		const bytes = await readVerifiedMaterializedFile(
			resource,
			entry.byteLength,
			entry.digest,
			content.bounds.maximumReadLength,
			`${field}.treeEntries.${entry.path}`,
			signal,
		);
		projectedEntries.push({
			kind: 'file',
			path: entry.path,
			mediaType: entry.mediaType,
			byteLength: entry.byteLength,
			version: entry.version,
			digest: entry.digest,
			content: { encoding: 'base64', data: Buffer.from(bytes).toString('base64') },
		});
	}
	const bundle = encodeAgentHostProtocolValue({
		schema: 'comet.materialized-tree.v1',
		attachment: modelAttachment.attachment.id,
		content: {
			reference: content.reference,
			version: content.version,
			digest: content.digest,
			bounds: content.bounds,
		},
		entries: projectedEntries,
	});
	return inputFilePart(
		'application/json',
		new TextEncoder().encode(bundle),
		`comet-directory-${index + 1}`,
		`${field}.treeEntries`,
	);
}

async function convertAttachments(
	request: ICometModelStepRequest,
	mediaTypes: ReadonlySet<string>,
	signal: AbortSignal,
): Promise<readonly AgentHostProtocolValue[]> {
	const converted: AgentHostProtocolValue[] = [];
	const attachmentIds = new Set<string>();
	for (const [index, modelAttachment] of request.attachments.entries()) {
		try {
			assertAgentHostAttachment(modelAttachment.attachment);
		} catch {
			invalid('unsupportedAttachment', 'Invalid OpenAI Responses attachment', `attachments.${index}`, modelAttachment.attachment);
		}
		if (attachmentIds.has(modelAttachment.attachment.id)) {
			invalid('unsupportedAttachment', 'Duplicate OpenAI Responses attachment', `attachments.${index}.id`, modelAttachment.attachment.id);
		}
		attachmentIds.add(modelAttachment.attachment.id);
		if (!mediaTypes.has(modelAttachment.attachment.representation.mediaType)) {
			invalid(
				'unsupportedAttachment',
				'Attachment representation media type is not advertised by this OpenAI Responses model',
				`attachments.${index}.attachment.representation.mediaType`,
				modelAttachment.attachment.representation.mediaType,
			);
		}
		converted.push({
			type: 'input_text',
			text: `Canonical attachment envelope: ${encodeAgentHostProtocolValue(attachmentEnvelope(modelAttachment))}`,
		});
		if (modelAttachment.content === undefined) {
			if (modelAttachment.attachment.content !== undefined) {
				invalid(
					'unsupportedAttachment',
					'Canonical attachment content was not prepared for OpenAI Responses',
					`attachments.${index}.content`,
					'missing',
				);
			}
			continue;
		}
		const canonicalContent = modelAttachment.attachment.content;
		if (
			canonicalContent === undefined
			|| (modelAttachment.content.kind === 'inline' && canonicalContent.kind !== 'inline')
			|| (modelAttachment.content.kind === 'materialized' && canonicalContent.kind !== 'reference')
			|| encodeAgentHostProtocolValue(canonicalContent)
				!== encodeAgentHostProtocolValue(modelAttachment.content.content)
		) {
			invalid(
				'unsupportedAttachment',
				'Prepared attachment content does not match its canonical envelope',
				`attachments.${index}.content`,
				'content-mismatch',
			);
		}
		if (modelAttachment.content.kind === 'materialized') {
			const content = modelAttachment.content.content;
			if (content.shape === 'tree') {
				converted.push(await materializedTreePart(modelAttachment, index, mediaTypes, signal));
				continue;
			}
			if (modelAttachment.content.treeEntries !== null) {
				invalid('unsupportedAttachment', 'Materialized blob cannot carry a tree manifest', `attachments.${index}.content.treeEntries`, 'present');
			}
			if (content.mediaType === undefined || !mediaTypes.has(content.mediaType)) {
				invalid(
					'unsupportedAttachment',
					'Materialized attachment blob requires an advertised exact media type',
					`attachments.${index}.content.mediaType`,
					content.mediaType === undefined ? 'missing' : content.mediaType,
				);
			}
			const bytes = await readVerifiedMaterializedFile(
				modelAttachment.content.resource,
				content.bounds.byteLength,
				content.digest,
				content.bounds.maximumReadLength,
				`attachments.${index}.content.resource`,
				signal,
			);
			if (supportedImageMediaTypes.has(content.mediaType)) {
				converted.push({
					type: 'input_image',
					image_url: inputImageData(content.mediaType, bytes, `attachments.${index}.content`),
					detail: 'auto',
				});
			} else {
				converted.push(inputFilePart(
					content.mediaType,
					bytes,
					`comet-attachment-${index + 1}`,
					`attachments.${index}.content.mediaType`,
				));
			}
			continue;
		}
		const content = modelAttachment.content.content;
		if (!mediaTypes.has(content.mediaType)) {
			invalid(
				'unsupportedAttachment',
				'Attachment content media type is not advertised by this OpenAI Responses model',
				`attachments.${index}.content.mediaType`,
				content.mediaType,
			);
		}
		if (content.encoding === 'utf8') {
			if (!isSupportedTextMediaType(content.mediaType)) {
				invalid(
					'unsupportedAttachment',
					'OpenAI Responses input_text cannot carry this attachment media type',
					`attachments.${index}.content.mediaType`,
					content.mediaType,
				);
			}
			const text = `Canonical attachment content (${content.mediaType}):\n${content.data}`;
			if (text.length > 10 * 1024 * 1024) {
				invalid('unsupportedAttachment', 'OpenAI Responses input_text exceeds its provider limit', `attachments.${index}.content`, text.length);
			}
			converted.push({ type: 'input_text', text });
			continue;
		}
		const bytes = Uint8Array.from(Buffer.from(content.data, 'base64'));
		if (supportedImageMediaTypes.has(content.mediaType)) {
			converted.push({
				type: 'input_image',
				image_url: inputImageData(content.mediaType, bytes, `attachments.${index}.content`),
				detail: 'auto',
			});
			continue;
		}
		converted.push(inputFilePart(
			content.mediaType,
			bytes,
			`comet-attachment-${index + 1}`,
			`attachments.${index}.content.mediaType`,
		));
	}
	return Object.freeze(converted);
}

async function convertMessages(
	request: ICometModelStepRequest,
	projected: IOpenAIResponsesProjectedTools,
	mediaTypes: ReadonlySet<string>,
	signal: AbortSignal,
): Promise<IOpenAIResponsesConvertedInput> {
	if (!Array.isArray(request.messages) || request.messages.length === 0) {
		invalid('invalidCanonicalMessage', 'OpenAI Responses requires canonical model messages', 'messages', request.messages);
	}
	const attachmentParts = await convertAttachments(request, mediaTypes, signal);
	const input: AgentHostProtocolValue[] = [];
	const historicalCallIds = new Set<string>();
	const pendingCalls = new Map<AgentToolCallId, IOpenAIResponsesToolBinding>();
	let currentUserMessageCount = 0;
	for (const [messageIndex, message] of request.messages.entries()) {
		const field = `messages.${messageIndex}`;
		assertIdentity(message.turn, createAgentTurnId, 'invalidCanonicalMessage', `${field}.turn`, 'Invalid canonical model message');
		if (message.role === 'user') {
			if (pendingCalls.size !== 0) {
				invalid('invalidCanonicalMessage', 'Canonical user message precedes required Tool results', `${field}.role`, message.role);
			}
			if (typeof message.text !== 'string' || message.text.length > maximumProviderStringLength) {
				invalid('invalidCanonicalMessage', 'Invalid canonical user message text', `${field}.text`, message.text);
			}
			const content: AgentHostProtocolValue[] = [{ type: 'input_text', text: message.text }];
			if (message.turn === request.turn) {
				currentUserMessageCount += 1;
				content.push(...attachmentParts);
			}
			input.push({ type: 'message', role: 'user', content });
			continue;
		}
		if (message.role === 'assistant') {
			if (pendingCalls.size !== 0) {
				invalid('invalidCanonicalMessage', 'Canonical assistant message precedes required Tool results', `${field}.role`, message.role);
			}
			if (!Array.isArray(message.parts) || message.parts.length === 0) {
				invalid('invalidCanonicalMessage', 'Canonical assistant message has no parts', `${field}.parts`, message.parts);
			}
			for (const [partIndex, part] of message.parts.entries()) {
				const partField = `${field}.parts.${partIndex}`;
				if (part.kind === 'text' || part.kind === 'reasoning') {
					assertNonEmptyString(
						part.text,
						maximumProviderStringLength,
						'invalidCanonicalMessage',
						`${partField}.text`,
						'Invalid canonical assistant message text',
					);
					input.push({
						type: 'message',
						role: 'assistant',
						content: [{
							type: 'input_text',
							text: part.kind === 'reasoning' ? `Canonical reasoning summary:\n${part.text}` : part.text,
						}],
					});
					continue;
				}
				if (part.kind !== 'toolCall') {
					invalid('invalidCanonicalMessage', 'Unknown canonical assistant message part', `${partField}.kind`, part);
				}
				const binding = bindingForCanonicalCall(part.call.registrationId, part.call.target, projected, `${partField}.call`);
				validateCanonicalCall(part.call, binding, `${partField}.call`);
				if (historicalCallIds.has(part.call.id)) {
					invalid('invalidCanonicalMessage', 'Duplicate canonical Tool call identity', `${partField}.call.id`, part.call.id);
				}
				historicalCallIds.add(part.call.id);
				pendingCalls.set(part.call.id, binding);
				input.push({
					type: 'function_call',
					call_id: part.call.id,
					name: binding.providerName,
					arguments: encodeAgentHostProtocolValue(part.call.input),
				});
			}
			continue;
		}
		if (message.role === 'tool') {
			assertIdentity(
				message.result.call,
				createAgentToolCallId,
				'invalidCanonicalMessage',
				`${field}.result.call`,
				'Invalid canonical Tool result',
			);
			const binding = pendingCalls.get(message.result.call);
			if (binding === undefined) {
				invalid('invalidCanonicalMessage', 'Canonical Tool result has no matching call', `${field}.result.call`, message.result.call);
			}
			let resultValue: AgentHostProtocolValue;
			if (message.result.status === 'completed') {
				const output = validateCanonicalToolValue(
					binding.outputSchema,
					message.result.output,
					'invalidCanonicalMessage',
					`${field}.result.output`,
				);
				resultValue = { status: 'completed', output };
			} else if (
				message.result.status === 'denied'
				|| message.result.status === 'cancelled'
				|| message.result.status === 'timedOut'
				|| message.result.status === 'failed'
			) {
				assertProtocolValue(message.result.failure, 'invalidCanonicalMessage', `${field}.result.failure`, 'Invalid canonical Tool failure');
				resultValue = { status: message.result.status, failure: message.result.failure };
			} else {
				invalid('invalidCanonicalMessage', 'Canonical Tool result has an invalid status', `${field}.result.status`, message.result);
			}
			pendingCalls.delete(message.result.call);
			input.push({
				type: 'function_call_output',
				call_id: message.result.call,
				output: encodeAgentHostProtocolValue(resultValue),
			});
			continue;
		}
		invalid('invalidCanonicalMessage', 'Unknown canonical model message role', `${field}.role`, message);
	}
	if (pendingCalls.size !== 0) {
		invalid('invalidCanonicalMessage', 'Canonical model history is missing Tool results', 'messages', pendingCalls.size);
	}
	if (currentUserMessageCount !== 1) {
		invalid('invalidCanonicalMessage', 'Canonical model history must contain exactly one current user message', 'messages.currentUser', currentUserMessageCount);
	}
	return { input: Object.freeze(input), historicalCallIds };
}

function assertCompletedItemStatus(item: Readonly<Record<string, unknown>>, field: string): void {
	if (item.status !== undefined && item.status !== 'completed') {
		invalid('invalidProviderResponse', 'OpenAI Responses output item has an invalid status', `${field}.status`, item.status);
	}
}

function responseTextParts(item: Readonly<Record<string, unknown>>, field: string): readonly CometModelOutputPart[] {
	if (item.role !== 'assistant') {
		invalid('invalidProviderResponse', 'OpenAI Responses message has an invalid role', `${field}.role`, item.role);
	}
	assertCompletedItemStatus(item, field);
	if (!Array.isArray(item.content) || item.content.length === 0) {
		invalid('invalidProviderResponse', 'OpenAI Responses message has invalid content', `${field}.content`, item.content);
	}
	const parts: CometModelOutputPart[] = [];
	for (const [index, contentValue] of item.content.entries()) {
		const contentField = `${field}.content.${index}`;
		const content = asRecord(
			contentValue,
			'invalidProviderResponse',
			contentField,
			'Invalid OpenAI Responses message content',
		);
		if (content.type === 'refusal') {
			invalid(
				'invalidProviderResponse',
				'OpenAI Responses refusal output has no canonical Comet representation',
				`${contentField}.type`,
				content.type,
			);
		}
		if (content.type !== 'output_text') {
			invalid('invalidProviderResponse', 'Unknown OpenAI Responses message content type', `${contentField}.type`, content.type);
		}
		assertNonEmptyString(
			content.text,
			maximumProviderStringLength,
			'invalidProviderResponse',
			`${contentField}.text`,
			'Invalid OpenAI Responses output text',
		);
		if (content.annotations !== undefined && (!Array.isArray(content.annotations) || content.annotations.length !== 0)) {
			invalid(
				'invalidProviderResponse',
				'OpenAI Responses annotations have no canonical Comet representation',
				`${contentField}.annotations`,
				content.annotations,
			);
		}
		if (content.logprobs !== undefined && (!Array.isArray(content.logprobs) || content.logprobs.length !== 0)) {
			invalid(
				'invalidProviderResponse',
				'OpenAI Responses log probabilities have no canonical Comet representation',
				`${contentField}.logprobs`,
				content.logprobs,
			);
		}
		parts.push({ kind: 'text', text: content.text });
	}
	return parts;
}

function responseReasoningParts(item: Readonly<Record<string, unknown>>, field: string): readonly CometModelOutputPart[] {
	assertCompletedItemStatus(item, field);
	if (item.encrypted_content !== undefined && item.encrypted_content !== null) {
		invalid(
			'invalidProviderResponse',
			'OpenAI Responses encrypted reasoning has no canonical Comet representation',
			`${field}.encrypted_content`,
			'present',
		);
	}
	const parts: CometModelOutputPart[] = [];
	const appendEntries = (value: unknown, type: 'summary_text' | 'reasoning_text', entryField: string): void => {
		if (value === undefined) {
			return;
		}
		if (!Array.isArray(value)) {
			invalid('invalidProviderResponse', 'Invalid OpenAI Responses reasoning content', entryField, value);
		}
		for (const [index, entryValue] of value.entries()) {
			const entry = asRecord(
				entryValue,
				'invalidProviderResponse',
				`${entryField}.${index}`,
				'Invalid OpenAI Responses reasoning content',
			);
			if (entry.type !== type) {
				invalid('invalidProviderResponse', 'Unknown OpenAI Responses reasoning content type', `${entryField}.${index}.type`, entry.type);
			}
			assertNonEmptyString(
				entry.text,
				maximumProviderStringLength,
				'invalidProviderResponse',
				`${entryField}.${index}.text`,
				'Invalid OpenAI Responses reasoning text',
			);
			parts.push({ kind: 'reasoning', text: entry.text });
		}
	};
	appendEntries(item.summary, 'summary_text', `${field}.summary`);
	appendEntries(item.content, 'reasoning_text', `${field}.content`);
	if (parts.length === 0) {
		invalid('invalidProviderResponse', 'OpenAI Responses reasoning item has no canonical text', field, 'empty');
	}
	return parts;
}

async function responseToolCallPart(
	item: Readonly<Record<string, unknown>>,
	field: string,
	projected: IOpenAIResponsesProjectedTools,
	callIds: Set<string>,
	request: ICometModelStepRequest,
): Promise<CometModelOutputPart> {
	assertCompletedItemStatus(item, field);
	assertNonEmptyString(
		item.call_id,
		128,
		'invalidProviderResponse',
		`${field}.call_id`,
		'OpenAI Responses function call is missing a valid call_id',
	);
	assertNonEmptyString(
		item.name,
		maximumProviderFunctionNameLength,
		'invalidProviderResponse',
		`${field}.name`,
		'OpenAI Responses function call is missing a valid name',
	);
	if (typeof item.arguments !== 'string' || item.arguments.length > maximumProviderStringLength) {
		invalid('invalidProviderResponse', 'OpenAI Responses function call has invalid arguments', `${field}.arguments`, item.arguments);
	}
	assertIdentity(
		item.call_id,
		createAgentToolCallId,
		'invalidProviderResponse',
		`${field}.call_id`,
		'OpenAI Responses function call has an invalid canonical identity',
	);
	if (callIds.has(item.call_id)) {
		invalid('invalidProviderResponse', 'OpenAI Responses returned a duplicate function call identity', `${field}.call_id`, item.call_id);
	}
	const binding = projected.bindingsByProviderName.get(item.name);
	if (binding === undefined) {
		invalid('invalidProviderResponse', 'OpenAI Responses returned an unknown function name', `${field}.name`, item.name);
	}
	let argumentsValue: unknown;
	try {
		argumentsValue = JSON.parse(item.arguments);
	} catch {
		return invalid('invalidProviderResponse', 'OpenAI Responses returned malformed function arguments JSON', `${field}.arguments`, 'malformed-json');
	}
	const input = validateCanonicalToolValue(binding.inputSchema, argumentsValue, 'invalidProviderResponse', `${field}.arguments`);
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		invalid('invalidProviderResponse', 'OpenAI Responses function arguments must be an object', `${field}.arguments`, argumentsValue);
	}
	callIds.add(item.call_id);
	const callId = item.call_id as AgentToolCallId;
	let effect: Extract<CometModelOutputPart, { readonly kind: 'toolCall' }>['call']['effect'];
	if (binding.registration.descriptor.safety === 'read') {
		effect = { kind: 'read' };
	} else {
		const operation = createAgentHostOperationId(callId);
		const mutation: AgentToolMutationPayload = {
			id: callId,
			agent: COMET_AGENT_ID,
			registration: request.toolSet.runtimeRegistration,
			session: request.session,
			chat: request.chat,
			turn: request.turn,
			toolSet: request.toolSet.revision,
			tool: binding.registration.descriptor.id,
			descriptor: binding.registration.descriptor.revision,
			registrationId: binding.registration.id,
			registrationRevision: binding.registration.revision,
			input,
			...(binding.target === undefined ? {} : { target: binding.target.id }),
			effect: { kind: 'mutation', operation },
			deadline: request.deadline,
		};
		effect = {
			kind: 'mutation',
			operation,
			payloadDigest: await computeAgentToolMutationPayloadDigest(mutation),
		};
	}
	return {
		kind: 'toolCall',
		call: {
			id: callId,
			registrationId: binding.registration.id,
			input,
			...(binding.target === undefined ? {} : { target: binding.target.id }),
			effect,
		},
	};
}

async function parseProviderResponse(
	value: unknown,
	providerModel: string,
	projected: IOpenAIResponsesProjectedTools,
	historicalCallIds: ReadonlySet<string>,
	request: ICometModelStepRequest,
): Promise<ICometModelStepResult> {
	const response = asRecord(
		value,
		'invalidProviderResponse',
		'response',
		'Invalid OpenAI Responses response',
	);
	assertNonEmptyString(
		response.id,
		512,
		'invalidProviderResponse',
		'response.id',
		'OpenAI Responses response is missing an identity',
	);
	if (response.status !== 'completed') {
		const details = response.incomplete_details === null || response.incomplete_details === undefined
			? undefined
			: asRecord(
				response.incomplete_details,
				'invalidProviderResponse',
				'response.incomplete_details',
				'Invalid OpenAI Responses incomplete details',
			);
		throw new CometModelError(
			'invalidProviderResponse',
			'OpenAI Responses did not complete successfully',
			{
				response: response.id,
				status: diagnosticValue(response.status),
				...(details?.reason === undefined ? {} : { reason: diagnosticValue(details.reason) }),
			},
		);
	}
	if (response.error !== undefined && response.error !== null) {
		invalid('invalidProviderResponse', 'Completed OpenAI Responses response contains an error', 'response.error', 'present');
	}
	if (response.incomplete_details !== undefined && response.incomplete_details !== null) {
		invalid(
			'invalidProviderResponse',
			'Completed OpenAI Responses response contains incomplete details',
			'response.incomplete_details',
			'present',
		);
	}
	if (response.model !== providerModel) {
		invalid('invalidProviderResponse', 'OpenAI Responses returned a different model', 'response.model', response.model);
	}
	if (!Array.isArray(response.output) || response.output.length === 0 || response.output.length > maximumOutputItemCount) {
		invalid('invalidProviderResponse', 'OpenAI Responses returned invalid output', 'response.output', response.output);
	}
	const parts: CometModelOutputPart[] = [];
	const callIds = new Set(historicalCallIds);
	let toolCallCount = 0;
	for (const [index, itemValue] of response.output.entries()) {
		const field = `response.output.${index}`;
		const item = asRecord(itemValue, 'invalidProviderResponse', field, 'Invalid OpenAI Responses output item');
		if (item.type === 'message') {
			parts.push(...responseTextParts(item, field));
		} else if (item.type === 'reasoning') {
			parts.push(...responseReasoningParts(item, field));
		} else if (item.type === 'function_call') {
			parts.push(await responseToolCallPart(item, field, projected, callIds, request));
			toolCallCount += 1;
		} else {
			invalid('invalidProviderResponse', 'Unknown OpenAI Responses output item type', `${field}.type`, item.type);
		}
	}
	if (parts.length === 0) {
		invalid('invalidProviderResponse', 'OpenAI Responses output has no canonical parts', 'response.output', 'empty');
	}
	let usage: AgentHostProtocolValue | undefined;
	if (response.usage !== undefined && response.usage !== null) {
		assertProtocolValue(response.usage, 'invalidProviderResponse', 'response.usage', 'Invalid OpenAI Responses usage');
		usage = cloneAndFreezeProtocolValue(response.usage);
	}
	return Object.freeze({
		stopReason: toolCallCount === 0 ? 'completed' : 'toolCalls',
		parts: Object.freeze(parts),
		...(usage === undefined ? {} : { usage }),
	});
}

async function readJsonResponse(response: Response, maximumBytes: number): Promise<unknown> {
	const contentType = response.headers.get('content-type');
	if (contentType === null || !/^application\/json(?:\s*;|$)/i.test(contentType)) {
		invalid('invalidProviderResponse', 'OpenAI Responses returned a non-JSON content type', 'response.contentType', contentType);
	}
	const contentLength = response.headers.get('content-length');
	if (contentLength !== null) {
		const length = Number(contentLength);
		if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
			invalid('invalidProviderResponse', 'OpenAI Responses returned an invalid content length', 'response.contentLength', contentLength);
		}
	}
	if (response.body === null) {
		invalid('invalidProviderResponse', 'OpenAI Responses returned an empty body', 'response.body', 'missing');
	}
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let byteLength = 0;
	while (true) {
		const result = await reader.read();
		if (result.done) {
			break;
		}
		byteLength += result.value.byteLength;
		if (!Number.isSafeInteger(byteLength) || byteLength > maximumBytes) {
			await reader.cancel();
			invalid('invalidProviderResponse', 'OpenAI Responses body exceeded its byte limit', 'response.body.byteLength', byteLength);
		}
		chunks.push(result.value);
	}
	const bytes = new Uint8Array(byteLength);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	let text: string;
	try {
		text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return invalid('invalidProviderResponse', 'OpenAI Responses body is not valid UTF-8', 'response.body', 'invalid-utf8');
	}
	try {
		return JSON.parse(text);
	} catch {
		return invalid('invalidProviderResponse', 'OpenAI Responses body is not valid JSON', 'response.body', 'malformed-json');
	}
}

export class OpenAIResponsesModelRuntime implements ICometModelRuntime {
	readonly id: string;
	readonly descriptor: IAgentModelDescriptor;

	private readonly connectionResolver: IOpenAIResponsesConnectionResolver;
	private readonly maximumRequestMilliseconds: number;
	private readonly maximumRequestBytes: number;
	private readonly maximumResponseBytes: number;
	private readonly fetchImplementation: (url: string, init: RequestInit) => Promise<Response>;
	private readonly now: () => number;
	private readonly attachmentMediaTypes: ReadonlySet<string>;

	constructor(options: IOpenAIResponsesModelRuntimeOptions) {
		if (typeof options.id !== 'string' || !modelRuntimePattern.test(options.id)) {
			invalid('invalidConfiguration', 'Invalid OpenAI Responses runtime identity', 'runtime.id', options.id);
		}
		this.id = options.id;
		this.descriptor = validateDescriptor(options.descriptor);
		if (options.connectionResolver === null || typeof options.connectionResolver !== 'object' || typeof options.connectionResolver.resolve !== 'function') {
			invalid('invalidConfiguration', 'OpenAI Responses connection resolver is required', 'connectionResolver', options.connectionResolver);
		}
		this.connectionResolver = options.connectionResolver;
		assertInteger(
			options.maximumRequestMilliseconds,
			1,
			10 * 60 * 1_000,
			'invalidConfiguration',
			'maximumRequestMilliseconds',
			'Invalid OpenAI Responses request duration limit',
		);
		this.maximumRequestMilliseconds = options.maximumRequestMilliseconds;
		assertInteger(
			options.maximumRequestBytes,
			1,
			64 * 1024 * 1024,
			'invalidConfiguration',
			'maximumRequestBytes',
			'Invalid OpenAI Responses request byte limit',
		);
		this.maximumRequestBytes = options.maximumRequestBytes;
		assertInteger(
			options.maximumResponseBytes,
			1,
			64 * 1024 * 1024,
			'invalidConfiguration',
			'maximumResponseBytes',
			'Invalid OpenAI Responses response byte limit',
		);
		this.maximumResponseBytes = options.maximumResponseBytes;
		if (typeof options.fetch !== 'function') {
			invalid('invalidConfiguration', 'OpenAI Responses fetch implementation is required', 'fetch', options.fetch);
		}
		this.fetchImplementation = options.fetch;
		if (typeof options.now !== 'function') {
			invalid('invalidConfiguration', 'OpenAI Responses clock is required', 'now', options.now);
		}
		const now = options.now();
		if (!Number.isSafeInteger(now) || now <= 0) {
			invalid('invalidConfiguration', 'OpenAI Responses clock returned an invalid value', 'now', now);
		}
		this.now = options.now;
		this.attachmentMediaTypes = new Set(this.descriptor.attachments.mediaTypes);
	}

	async executeStep(request: ICometModelStepRequest, token: CancellationToken): Promise<ICometModelStepResult> {
		this.validateStepRequest(request);
		const settings = parseExecutionSettings(request.settings);
		const projected = projectTools(request);
		const instructions = request.workspace === undefined
			? request.systemPrompt
			: `${request.systemPrompt}\n\nCanonical workspace context: ${encodeAgentHostProtocolValue(request.workspace)}`;
		return this.runControlled(request.deadline, token, async signal => {
			const connection = await this.resolveConnection(request, token, signal);
			const converted = await convertMessages(request, projected, this.attachmentMediaTypes, signal);
			const requestValue = {
				model: connection.providerModel,
				instructions,
				input: converted.input,
				tools: projected.definitions,
				tool_choice: projected.definitions.length === 0 ? 'none' : 'auto',
				parallel_tool_calls: projected.definitions.length !== 0 && settings.parallelToolCalls,
				max_output_tokens: settings.maxOutputTokens,
				store: false,
				truncation: 'disabled',
				text: { format: { type: 'text' } },
				...(settings.temperature === null ? {} : { temperature: settings.temperature }),
				...(settings.reasoning === null ? {} : { reasoning: settings.reasoning }),
				...(settings.serviceTier === null ? {} : { service_tier: settings.serviceTier }),
			};
			const body = encodeAgentHostProtocolValue(requestValue);
			const requestBytes = new TextEncoder().encode(body).byteLength;
			if (requestBytes > this.maximumRequestBytes) {
				invalid('invalidExecutionSettings', 'OpenAI Responses request exceeded its byte limit', 'request.byteLength', requestBytes);
			}
			let response: Response;
			try {
				response = await this.fetchImplementation(connection.endpoint, {
					method: 'POST',
					headers: {
						Accept: 'application/json',
						Authorization: `Bearer ${connection.apiKey}`,
						'Content-Type': 'application/json',
					},
					body,
					signal,
				});
			} catch (error) {
				if (error instanceof CometModelError || error instanceof CancellationError) {
					throw error;
				}
				throw new CometModelError('providerRequestFailed', 'OpenAI Responses request failed before receiving a response');
			}
			if (!response.ok) {
				const requestId = response.headers.get('x-request-id');
				throw new CometModelError(
					'providerRequestFailed',
					'OpenAI Responses request returned an unsuccessful HTTP status',
					{
						status: response.status,
						...(requestId === null ? {} : { requestId: requestId.slice(0, 256) }),
					},
				);
			}
			let value: unknown;
			try {
				value = await readJsonResponse(response, this.maximumResponseBytes);
			} catch (error) {
				if (error instanceof CometModelError || error instanceof CancellationError) {
					throw error;
				}
				throw new CometModelError('providerRequestFailed', 'OpenAI Responses response body could not be read');
			}
			return parseProviderResponse(value, connection.providerModel, projected, converted.historicalCallIds, request);
		});
	}

	private async resolveConnection(
		request: ICometModelStepRequest,
		token: CancellationToken,
		signal: AbortSignal,
	): Promise<IOpenAIResponsesConnection> {
		let connection: IOpenAIResponsesConnection;
		try {
			connection = await this.connectionResolver.resolve({
				runtime: this.id,
				model: this.descriptor.id,
				step: request,
				token,
				signal,
			});
		} catch (error) {
			if (error instanceof CometModelError || error instanceof CancellationError) {
				throw error;
			}
			throw new CometModelError('connectionResolutionFailed', 'OpenAI Responses connection resolution failed');
		}
		if (signal.aborted) {
			throw new CancellationError();
		}
		if (connection === null || typeof connection !== 'object') {
			invalid('connectionResolutionFailed', 'OpenAI Responses connection resolver returned an invalid value', 'connection', connection);
		}
		if (typeof connection.apiKey !== 'string' || connection.apiKey.length === 0) {
			invalid('providerCredentialRequired', 'OpenAI Responses credential is required', 'connection.apiKey', 'missing');
		}
		if (connection.apiKey.length > 8_192 || connection.apiKey.trim() !== connection.apiKey || /[\r\n]/.test(connection.apiKey)) {
			invalid('invalidConfiguration', 'Invalid OpenAI Responses API key', 'connection.apiKey', 'invalid-secret');
		}
		assertNonEmptyString(
			connection.providerModel,
			256,
			'invalidConfiguration',
			'connection.providerModel',
			'Invalid OpenAI Responses provider model',
		);
		return Object.freeze({
			endpoint: validateEndpoint(connection.endpoint),
			apiKey: connection.apiKey,
			providerModel: connection.providerModel,
		});
	}

	private validateStepRequest(request: ICometModelStepRequest): void {
		const message = 'Invalid OpenAI Responses model step request';
		assertIdentity(request.session, createAgentSessionId, 'invalidCanonicalMessage', 'request.session', message);
		assertIdentity(request.chat, createAgentChatId, 'invalidCanonicalMessage', 'request.chat', message);
		assertIdentity(request.turn, createAgentTurnId, 'invalidCanonicalMessage', 'request.turn', message);
		if (request.profile.modelDescriptor !== this.descriptor.revision) {
			invalid('invalidExecutionSettings', 'Execution profile does not belong to this OpenAI Responses model', 'profile.modelDescriptor', request.profile.modelDescriptor);
		}
		if (!Number.isSafeInteger(request.step) || request.step < 0 || request.step >= maximumExecutionSteps) {
			invalid('invalidExecutionSettings', message, 'request.step', request.step);
		}
		assertNonEmptyString(request.systemPrompt, 64 * 1024, 'invalidExecutionSettings', 'request.systemPrompt', message);
		if (!Number.isSafeInteger(request.deadline) || request.deadline <= 0) {
			invalid('invalidExecutionSettings', message, 'request.deadline', request.deadline);
		}
		if (request.checkpoint !== undefined) {
			invalid(
				'invalidExecutionSettings',
				'This OpenAI Responses runtime does not define a provider checkpoint',
				'request.checkpoint',
				'present',
			);
		}
		if (request.workspace !== undefined) {
			assertProtocolValue(request.workspace, 'invalidExecutionSettings', 'request.workspace', message);
		}
		const constraints = asRecord(
			request.outputConstraints,
			'invalidExecutionSettings',
			'request.outputConstraints',
			message,
		);
		assertExactKeys(
			constraints,
			['format'],
			[],
			'invalidExecutionSettings',
			'request.outputConstraints',
			message,
		);
		if (constraints.format !== 'text') {
			invalid('invalidExecutionSettings', 'Unsupported OpenAI Responses output format', 'request.outputConstraints.format', constraints.format);
		}
		if (!Array.isArray(request.attachments) || request.attachments.length > this.descriptor.attachments.maximumCount) {
			invalid('unsupportedAttachment', 'OpenAI Responses attachment count exceeds the model descriptor', 'request.attachments.length', request.attachments);
		}
		let totalBytes = 0;
		for (const [index, attachment] of request.attachments.entries()) {
			try {
				assertAgentHostAttachment(attachment.attachment);
			} catch {
				invalid('unsupportedAttachment', 'Invalid OpenAI Responses attachment', `request.attachments.${index}`, attachment);
			}
			const canonicalContent = attachment.attachment.content;
			if (
				canonicalContent !== undefined
				&& !this.descriptor.attachments.carriers.includes(canonicalContent.kind)
			) {
				invalid(
					'unsupportedAttachment',
					'Attachment carrier is not advertised by this OpenAI Responses model',
					`request.attachments.${index}.content.kind`,
					canonicalContent.kind,
				);
			}
			if (canonicalContent?.kind === 'reference') {
				if (!this.descriptor.attachments.shapes.includes(canonicalContent.shape)) {
					invalid(
						'unsupportedAttachment',
						'Attachment shape is not advertised by this OpenAI Responses model',
						`request.attachments.${index}.content.shape`,
						canonicalContent.shape,
					);
				}
				if (canonicalContent.shape === 'tree' && (
					canonicalContent.bounds.treeDepth === undefined
					|| canonicalContent.bounds.treeDepth <= 0
					|| canonicalContent.bounds.treeDepth > this.descriptor.attachments.maximumTreeDepth
					|| canonicalContent.bounds.treeEntryCount === undefined
					|| canonicalContent.bounds.treeEntryCount <= 0
					|| canonicalContent.bounds.treeEntryCount > this.descriptor.attachments.maximumTreeEntries
				)) {
					invalid(
						'unsupportedAttachment',
						'Attachment tree exceeds the model descriptor',
						`request.attachments.${index}.content.bounds`,
						canonicalContent.bounds.treeEntryCount === undefined ? 'missing' : canonicalContent.bounds.treeEntryCount,
					);
				}
			}
			const byteLength = canonicalContent === undefined
				? 0
				: canonicalContent.kind === 'inline'
					? canonicalContent.byteLength
					: canonicalContent.bounds.byteLength;
			if (byteLength > this.descriptor.attachments.maximumItemBytes) {
				invalid('unsupportedAttachment', 'OpenAI Responses attachment exceeds its item byte limit', `request.attachments.${index}.byteLength`, byteLength);
			}
			totalBytes += byteLength;
		}
		if (!Number.isSafeInteger(totalBytes) || totalBytes > this.descriptor.attachments.maximumTotalBytes) {
			invalid('unsupportedAttachment', 'OpenAI Responses attachments exceed their total byte limit', 'request.attachments.totalBytes', totalBytes);
		}
	}

	private async runControlled<T>(
		deadline: number,
		token: CancellationToken,
		operation: (signal: AbortSignal) => Promise<T>,
	): Promise<T> {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const startedAt = this.now();
		if (!Number.isSafeInteger(startedAt) || startedAt <= 0) {
			invalid('invalidConfiguration', 'OpenAI Responses clock returned an invalid value', 'now', startedAt);
		}
		const effectiveDeadline = Math.min(deadline, startedAt + this.maximumRequestMilliseconds);
		if (effectiveDeadline <= startedAt) {
			throw new CometModelError('deadlineExceeded', 'OpenAI Responses request deadline has already elapsed');
		}

		const controller = new AbortController();
		const abort = { state: 'none' as 'none' | 'cancelled' | 'deadline' };
		let rejectAbort: (error: Error) => void = () => undefined;
		const abortPromise = new Promise<never>((_resolve, reject) => {
			rejectAbort = reject;
		});
		const cancelListener = token.onCancellationRequested(() => {
			if (abort.state !== 'none') {
				return;
			}
			abort.state = 'cancelled';
			controller.abort();
			rejectAbort(new CancellationError());
		});
		const timer = setTimeout(() => {
			if (abort.state !== 'none') {
				return;
			}
			abort.state = 'deadline';
			controller.abort();
			rejectAbort(new CometModelError('deadlineExceeded', 'OpenAI Responses request exceeded its deadline'));
		}, effectiveDeadline - startedAt);

		try {
			return await Promise.race([operation(controller.signal), abortPromise]);
		} catch (error) {
			if (abort.state === 'cancelled') {
				throw new CancellationError();
			}
			if (abort.state === 'deadline') {
				throw new CometModelError('deadlineExceeded', 'OpenAI Responses request exceeded its deadline');
			}
			throw error;
		} finally {
			clearTimeout(timer);
			cancelListener.dispose();
		}
	}
}
