/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';

import type { CancellationToken } from 'cs/base/common/cancellation';
import { CancellationError } from 'cs/base/common/errors';
import type { IAgentModelDescriptor } from 'cs/platform/agentHost/common/agent';
import {
	assertAgentHostAttachment,
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from 'cs/platform/agentHost/common/attachments';
import {
	AgentInteractionTargetId,
	AgentModelId,
	AgentToolCallId,
	createAgentChatId,
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
	type ICometModelRuntime,
	type ICometModelStepRequest,
	type ICometModelStepResult,
} from '../cometModel.js';

export type OpenAIChatCompletionsMaximumOutputTokensField = 'max_tokens' | 'max_completion_tokens';

export interface IOpenAIChatCompletionsExecutionSettings {
	readonly version: 1;
	readonly maxOutputTokens: number;
	readonly maximumOutputTokensField: OpenAIChatCompletionsMaximumOutputTokensField;
}

export interface IOpenAIChatCompletionsConnection {
	readonly endpoint: string;
	readonly apiKey: string;
	readonly providerModel: string;
}

export interface IOpenAIChatCompletionsConnectionResolutionRequest {
	readonly runtime: string;
	readonly model: AgentModelId;
	readonly signal: AbortSignal;
}

export interface IOpenAIChatCompletionsConnectionResolver {
	resolve(request: IOpenAIChatCompletionsConnectionResolutionRequest): Promise<IOpenAIChatCompletionsConnection>;
}

export interface IOpenAIChatCompletionsModelRuntimeOptions {
	readonly id: string;
	readonly descriptor: IAgentModelDescriptor;
	readonly connectionResolver: IOpenAIChatCompletionsConnectionResolver;
	readonly maximumRequestMilliseconds: number;
	readonly maximumRequestBytes: number;
	readonly maximumResponseBytes: number;
	readonly fetch: (url: string, init: RequestInit) => Promise<Response>;
	readonly now: () => number;
}

interface IOpenAIChatCompletionsToolBinding {
	readonly providerName: string;
	readonly registration: IAgentToolRegistration;
	readonly inputSchema: CometToolSchemaNode;
	readonly outputSchema: CometToolSchemaNode;
	readonly target?: IAgentHostInteractionTarget;
}

interface IOpenAIChatCompletionsProjectedTools {
	readonly bindingsByProviderName: ReadonlyMap<string, IOpenAIChatCompletionsToolBinding>;
	readonly bindingsByRegistration: ReadonlyMap<string, readonly IOpenAIChatCompletionsToolBinding[]>;
	readonly definitions: readonly AgentHostProtocolValue[];
}

interface IOpenAIChatCompletionsConvertedMessages {
	readonly messages: readonly AgentHostProtocolValue[];
	readonly historicalCallIds: ReadonlySet<string>;
}

const modelRuntimePattern = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;
const providerFunctionNamePattern = /^[A-Za-z0-9_-]+$/;
const maximumProviderFunctionNameLength = 64;
const maximumProjectedToolDescriptionLength = 32 * 1024;
const maximumProjectedToolCount = 128;
const maximumExecutionSteps = 64;
const maximumOutputTokens = 1_000_000;
const maximumProviderStringLength = 16 * 1024 * 1024;
const maximumInputImageUrlLength = 20 * 1024 * 1024;
const maximumMaterializedReadLength = 1024 * 1024;
const supportedImageMediaTypes = new Set([
	'image/png',
	'image/jpeg',
	'image/webp',
	'image/gif',
]);

export const OPENAI_CHAT_COMPLETIONS_TEXT_MEDIA_TYPES: readonly string[] = Object.freeze([
	'text/plain',
	'text/markdown',
	'text/html',
	'text/csv',
	'text/tsv',
	'text/xml',
	'text/css',
	'text/javascript',
	'text/typescript',
	'text/x-python',
	'text/x-java',
	'text/x-c',
	'text/x-c++',
	'text/x-go',
	'text/x-rust',
	'text/x-shellscript',
	'text/x-sh',
	'text/x-bash',
	'text/x-zsh',
	'text/x-sql',
	'text/x-yaml',
	'text/yaml',
	'text/calendar',
	'text/vtt',
	'application/json',
	'application/xml',
	'application/javascript',
	'application/typescript',
	'application/x-yaml',
	'application/yaml',
	'application/toml',
	'application/x-toml',
	'application/x-ndjson',
	'application/graphql',
]);

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
	value: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	code: CometModelError['code'],
	field: string,
	message: string,
): void {
	const keys = Object.keys(value);
	const allowed = new Set([...required, ...optional]);
	if (!required.every(key => Object.hasOwn(value, key)) || keys.some(key => !allowed.has(key))) {
		invalid(code, message, field, keys);
	}
}

function assertNonEmptyString(
	value: unknown,
	maximumLength: number,
	code: CometModelError['code'],
	field: string,
	message: string,
): asserts value is string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
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

function assertIdentity<T extends string>(
	value: unknown,
	create: (value: string) => T,
	code: CometModelError['code'],
	field: string,
	message: string,
): asserts value is T {
	if (typeof value !== 'string') {
		invalid(code, message, field, value);
	}
	try {
		create(value as string);
	} catch {
		invalid(code, message, field, value);
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

function cloneAndFreezeProtocolValue(value: AgentHostProtocolValue): AgentHostProtocolValue {
	const clone = structuredClone(value);
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

function parseExecutionSettings(value: unknown): IOpenAIChatCompletionsExecutionSettings {
	const message = 'Invalid OpenAI Chat Completions execution settings';
	const settings = asRecord(value, 'invalidExecutionSettings', 'settings', message);
	assertExactKeys(
		settings,
		['version', 'maxOutputTokens', 'maximumOutputTokensField'],
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
	if (settings.maximumOutputTokensField !== 'max_tokens' && settings.maximumOutputTokensField !== 'max_completion_tokens') {
		invalid(
			'invalidExecutionSettings',
			message,
			'settings.maximumOutputTokensField',
			settings.maximumOutputTokensField,
		);
	}
	return Object.freeze({
		version: 1,
		maxOutputTokens: settings.maxOutputTokens,
		maximumOutputTokensField: settings.maximumOutputTokensField,
	});
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

function chatCompletionsJsonSchema(schema: CometToolSchemaNode, field: string): AgentHostProtocolValue {
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
		case 'string': {
			const result: Record<string, AgentHostProtocolValue> = { type: 'string' };
			if (schema.minimumLength !== undefined) {
				result.minLength = schema.minimumLength;
			}
			if (schema.maximumLength !== undefined) {
				result.maxLength = schema.maximumLength;
			}
			if (schema.enum !== undefined) {
				result.enum = schema.enum;
			}
			return describedJsonSchema(schema, result);
		}
		case 'array': {
			const result: Record<string, AgentHostProtocolValue> = {
				type: 'array',
				items: chatCompletionsJsonSchema(schema.items, `${field}.items`),
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
			const properties: Record<string, AgentHostProtocolValue> = {};
			for (const [name, property] of Object.entries(schema.properties)) {
				properties[name] = chatCompletionsJsonSchema(property, `${field}.properties.${name}`);
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
				oneOf: schema.variants.map((variant, index) => chatCompletionsJsonSchema(variant, `${field}.variants.${index}`)),
			});
	}
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
			'Canonical Tool description exceeds the OpenAI Chat Completions projection limit',
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
		invalid(
			'invalidCanonicalTool',
			'OpenAI Chat Completions Tool input schema must be a canonical object',
			`${field}.descriptor.inputSchema.type`,
			inputSchema.type,
		);
	}
	if (!['read', 'write', 'external'].includes(descriptor.safety)) {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.safety`, descriptor.safety);
	}
	if (!['never', 'always', 'writeOrExternal'].includes(descriptor.confirmation)) {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.confirmation`, descriptor.confirmation);
	}
	if (typeof descriptor.allowsEditedInput !== 'boolean') {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.allowsEditedInput`, descriptor.allowsEditedInput);
	}
	if (!Array.isArray(descriptor.targetTypes) || new Set(descriptor.targetTypes).size !== descriptor.targetTypes.length) {
		invalid('invalidCanonicalTool', message, `${field}.descriptor.targetTypes`, descriptor.targetTypes);
	}
	return {
		inputSchema,
		outputSchema,
		parameters: chatCompletionsJsonSchema(inputSchema, `${field}.descriptor.inputSchema`),
	};
}

function projectTools(request: ICometModelStepRequest): IOpenAIChatCompletionsProjectedTools {
	if (
		request.toolSet.schemaProfile !== COMET_TOOL_SCHEMA_PROFILE
		|| request.toolSet.modelDescriptor !== request.profile.modelDescriptor
	) {
		invalid(
			'invalidCanonicalTool',
			'Canonical Tool set does not match this OpenAI Chat Completions model',
			'toolSet',
			request.toolSet.revision,
		);
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
	const bindingsByProviderName = new Map<string, IOpenAIChatCompletionsToolBinding>();
	const bindingsByRegistration = new Map<string, readonly IOpenAIChatCompletionsToolBinding[]>();
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
		const registrationBindings: IOpenAIChatCompletionsToolBinding[] = [];
		for (const [targetIndex, target] of compatibleTargets.entries()) {
			const providerName = target === undefined
				? registration.descriptor.functionName
				: `${registration.descriptor.functionName}__target_${targetIndex + 1}`;
			validateProviderName(providerName, `toolSet.registrations.${index}.providerName`);
			if (bindingsByProviderName.has(providerName)) {
				invalid('invalidCanonicalTool', 'Duplicate projected OpenAI Chat Completions Tool name', 'tool.providerName', providerName);
			}
			const binding: IOpenAIChatCompletionsToolBinding = Object.freeze({
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
				function: {
					name: providerName,
					description: canonicalToolDescription(registration, target),
					parameters: schemas.parameters,
				},
			});
		}
		bindingsByRegistration.set(registration.id, Object.freeze(registrationBindings));
	}
	if (definitions.length > maximumProjectedToolCount) {
		invalid('invalidCanonicalTool', 'Too many projected OpenAI Chat Completions Tools', 'tools.length', definitions.length);
	}
	for (const [index, target] of request.interactionTargets.entries()) {
		if (!projectedTargets.has(target.id)) {
			invalid(
				'invalidCanonicalTool',
				'Canonical interaction target cannot be represented by the OpenAI Chat Completions Tool set',
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
	projected: IOpenAIChatCompletionsProjectedTools,
	field: string,
): IOpenAIChatCompletionsToolBinding {
	const candidates = projected.bindingsByRegistration.get(registrationId);
	if (candidates === undefined) {
		return invalid('invalidCanonicalMessage', 'Canonical model history references an unknown Tool', `${field}.registrationId`, registrationId);
	}
	const binding = candidates.find(candidate => candidate.target?.id === target);
	if (binding === undefined) {
		return invalid(
			'invalidCanonicalMessage',
			'Canonical model history references an invalid Tool target',
			`${field}.target`,
			target === undefined ? 'missing' : target,
		);
	}
	return binding;
}

function validateCanonicalCall(
	call: Extract<CometModelOutputPart, { readonly kind: 'toolCall' }>['call'],
	binding: IOpenAIChatCompletionsToolBinding,
	field: string,
): void {
	assertIdentity(call.id, createAgentToolCallId, 'invalidCanonicalMessage', `${field}.id`, 'Invalid canonical Tool call history');
	validateCanonicalToolValue(binding.inputSchema, call.input, 'invalidCanonicalMessage', `${field}.input`);
	if (binding.registration.descriptor.safety === 'read') {
		if (call.effect.kind !== 'read') {
			invalid('invalidCanonicalMessage', 'Canonical Tool call has an invalid effect', `${field}.effect`, call.effect.kind);
		}
		return;
	}
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

function isSupportedTextMediaType(mediaType: string): boolean {
	return OPENAI_CHAT_COMPLETIONS_TEXT_MEDIA_TYPES.includes(mediaType)
		|| mediaType.endsWith('+json')
		|| mediaType.endsWith('+xml');
}

function validateDescriptor(descriptor: IAgentModelDescriptor): IAgentModelDescriptor {
	const message = 'Invalid OpenAI Chat Completions model descriptor';
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
		|| attachments.shapes.length !== 1
		|| attachments.shapes[0] !== 'blob'
	) {
		invalid('invalidConfiguration', message, 'descriptor.attachments.shapes', attachments.shapes);
	}
	if (
		!Array.isArray(attachments.mediaTypes)
		|| attachments.mediaTypes.length === 0
		|| new Set(attachments.mediaTypes).size !== attachments.mediaTypes.length
	) {
		invalid('invalidConfiguration', message, 'descriptor.attachments.mediaTypes', attachments.mediaTypes);
	}
	for (const [index, mediaType] of attachments.mediaTypes.entries()) {
		if (typeof mediaType !== 'string' || (!isSupportedTextMediaType(mediaType) && !supportedImageMediaTypes.has(mediaType))) {
			invalid('invalidConfiguration', message, `descriptor.attachments.mediaTypes.${index}`, mediaType);
		}
	}
	assertInteger(attachments.maximumCount, 1, 1_024, 'invalidConfiguration', 'descriptor.attachments.maximumCount', message);
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
	if (attachments.maximumTreeDepth !== 0 || attachments.maximumTreeEntries !== 0) {
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
		toolSchemaProfiles: Object.freeze([COMET_TOOL_SCHEMA_PROFILE]),
		attachments: Object.freeze({
			carriers: Object.freeze([...attachments.carriers]),
			shapes: Object.freeze(['blob'] as const),
			mediaTypes: Object.freeze([...attachments.mediaTypes]),
			maximumCount: attachments.maximumCount,
			maximumItemBytes: attachments.maximumItemBytes,
			maximumTotalBytes: attachments.maximumTotalBytes,
			maximumTreeDepth: 0,
			maximumTreeEntries: 0,
			supportsClientContentForBackgroundExecution: attachments.supportsClientContentForBackgroundExecution,
		}),
	});
}

function validateEndpoint(value: unknown): string {
	assertNonEmptyString(value, 4_096, 'invalidConfiguration', 'endpoint', 'Invalid OpenAI Chat Completions endpoint');
	let endpoint: URL;
	try {
		endpoint = new URL(value);
	} catch {
		return invalid('invalidConfiguration', 'Invalid OpenAI Chat Completions endpoint', 'endpoint', value);
	}
	if (
		(endpoint.protocol !== 'https:' && endpoint.protocol !== 'http:')
		|| endpoint.username.length !== 0
		|| endpoint.password.length !== 0
		|| endpoint.hash.length !== 0
		|| endpoint.search.length !== 0
		|| !endpoint.pathname.endsWith('/chat/completions')
	) {
		invalid('invalidConfiguration', 'Invalid OpenAI Chat Completions endpoint', 'endpoint', value);
	}
	return endpoint.toString();
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
		metadata: attachment.attachment.metadata.map(entry => ({ namespace: entry.namespace, value: entry.value })),
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
	assertNonEmptyString(value, 4_096, 'unsupportedAttachment', field, 'Invalid materialized attachment resource');
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
				return invalid('unsupportedAttachment', 'Materialized attachment file changed before it was read', field, 'changed');
			}
			const bytes = new Uint8Array(expectedByteLength);
			let offset = 0;
			while (offset < bytes.byteLength) {
				throwIfAborted(signal);
				const length = Math.min(maximumMaterializedReadLength, maximumReadLength, bytes.byteLength - offset);
				const result = await handle.read(bytes, offset, length, offset);
				if (result.bytesRead <= 0 || result.bytesRead > length) {
					return invalid('unsupportedAttachment', 'Materialized attachment file returned an invalid read length', field, result.bytesRead);
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
				return invalid('unsupportedAttachment', 'Materialized attachment file changed while it was read', field, 'changed');
			}
			if (digestBytes(bytes) !== expectedDigest) {
				return invalid('unsupportedAttachment', 'Materialized attachment file digest does not match its canonical digest', field, 'digest-mismatch');
			}
			return bytes;
		} finally {
			await handle.close();
		}
	});
}

function imageDataUrl(mediaType: string, bytes: Uint8Array, field: string): string {
	const value = `data:${mediaType};base64,${Buffer.from(bytes).toString('base64')}`;
	if (value.length > maximumInputImageUrlLength) {
		invalid(
			'unsupportedAttachment',
			'OpenAI Chat Completions image data exceeds its provider limit',
			field,
			value.length,
		);
	}
	return value;
}

function decodeText(bytes: Uint8Array, field: string): string {
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
	} catch {
		return invalid(
			'unsupportedAttachment',
			'OpenAI Chat Completions text attachment is not valid UTF-8',
			field,
			'invalid-utf8',
		);
	}
}

function verifyInlineBytes(
	content: Extract<ICometModelStepRequest['attachments'][number]['content'], { readonly kind: 'inline' }>['content'],
	field: string,
): Uint8Array {
	const bytes = content.encoding === 'utf8'
		? new TextEncoder().encode(content.data)
		: Uint8Array.from(Buffer.from(content.data, 'base64'));
	if (bytes.byteLength !== content.byteLength || digestBytes(bytes) !== content.digest) {
		invalid(
			'unsupportedAttachment',
			'Inline attachment content does not match its canonical bounds and digest',
			field,
			'content-mismatch',
		);
	}
	return bytes;
}

interface IOpenAIChatCompletionsConvertedAttachments {
	readonly text: readonly string[];
	readonly images: readonly AgentHostProtocolValue[];
}

async function convertAttachments(
	request: ICometModelStepRequest,
	mediaTypes: ReadonlySet<string>,
	signal: AbortSignal,
): Promise<IOpenAIChatCompletionsConvertedAttachments> {
	const text: string[] = [];
	const images: AgentHostProtocolValue[] = [];
	const attachmentIds = new Set<string>();
	for (const [index, modelAttachment] of request.attachments.entries()) {
		const field = `attachments.${index}`;
		try {
			assertAgentHostAttachment(modelAttachment.attachment);
		} catch {
			invalid('unsupportedAttachment', 'Invalid OpenAI Chat Completions attachment', field, modelAttachment.attachment);
		}
		if (attachmentIds.has(modelAttachment.attachment.id)) {
			invalid('unsupportedAttachment', 'Duplicate OpenAI Chat Completions attachment', `${field}.id`, modelAttachment.attachment.id);
		}
		attachmentIds.add(modelAttachment.attachment.id);
		if (!mediaTypes.has(modelAttachment.attachment.representation.mediaType)) {
			invalid(
				'unsupportedAttachment',
				'Attachment representation media type is not advertised by this OpenAI Chat Completions model',
				`${field}.attachment.representation.mediaType`,
				modelAttachment.attachment.representation.mediaType,
			);
		}
		text.push(`Canonical attachment envelope: ${encodeAgentHostProtocolValue(attachmentEnvelope(modelAttachment))}`);
		if (modelAttachment.content === undefined) {
			if (modelAttachment.attachment.content !== undefined) {
				invalid(
					'unsupportedAttachment',
					'Canonical attachment content was not prepared for OpenAI Chat Completions',
					`${field}.content`,
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
			|| encodeAgentHostProtocolValue(canonicalContent) !== encodeAgentHostProtocolValue(modelAttachment.content.content)
		) {
			invalid(
				'unsupportedAttachment',
				'Prepared attachment content does not match its canonical envelope',
				`${field}.content`,
				'content-mismatch',
			);
		}

		let mediaType: string;
		let bytes: Uint8Array;
		if (modelAttachment.content.kind === 'materialized') {
			const content = modelAttachment.content.content;
			if (content.shape !== 'blob') {
				invalid(
					'unsupportedAttachment',
					'OpenAI Chat Completions does not support canonical attachment trees',
					`${field}.content.shape`,
					content.shape,
				);
			}
			if (modelAttachment.content.treeEntries !== null) {
				invalid('unsupportedAttachment', 'Materialized blob cannot carry a tree manifest', `${field}.content.treeEntries`, 'present');
			}
			if (content.mediaType === undefined || !mediaTypes.has(content.mediaType)) {
				invalid(
					'unsupportedAttachment',
					'Materialized attachment blob requires an advertised exact media type',
					`${field}.content.mediaType`,
					content.mediaType === undefined ? 'missing' : content.mediaType,
				);
			}
			mediaType = content.mediaType;
			bytes = await readVerifiedMaterializedFile(
				modelAttachment.content.resource,
				content.bounds.byteLength,
				content.digest,
				content.bounds.maximumReadLength,
				`${field}.content.resource`,
				signal,
			);
		} else {
			const content = modelAttachment.content.content;
			if (!mediaTypes.has(content.mediaType)) {
				invalid(
					'unsupportedAttachment',
					'Attachment content media type is not advertised by this OpenAI Chat Completions model',
					`${field}.content.mediaType`,
					content.mediaType,
				);
			}
			mediaType = content.mediaType;
			bytes = verifyInlineBytes(content, `${field}.content`);
		}

		if (supportedImageMediaTypes.has(mediaType)) {
			images.push({
				type: 'image_url',
				image_url: {
					url: imageDataUrl(mediaType, bytes, `${field}.content`),
				},
			});
			continue;
		}
		if (!isSupportedTextMediaType(mediaType)) {
			invalid(
				'unsupportedAttachment',
				'OpenAI Chat Completions cannot represent this attachment content media type',
				`${field}.content.mediaType`,
				mediaType,
			);
		}
		const contentText = decodeText(bytes, `${field}.content`);
		if (contentText.length > 10 * 1024 * 1024) {
			invalid(
				'unsupportedAttachment',
				'OpenAI Chat Completions text attachment exceeds its provider limit',
				`${field}.content`,
				contentText.length,
			);
		}
		text.push(`Canonical attachment content (${mediaType}):\n${contentText}`);
	}
	return {
		text: Object.freeze(text),
		images: Object.freeze(images),
	};
}

function assistantMessage(
	message: Extract<ICometModelStepRequest['messages'][number], { readonly role: 'assistant' }>,
	field: string,
	projected: IOpenAIChatCompletionsProjectedTools,
	historicalCallIds: Set<string>,
	pendingCalls: Map<AgentToolCallId, IOpenAIChatCompletionsToolBinding>,
): AgentHostProtocolValue {
	if (!Array.isArray(message.parts) || message.parts.length === 0) {
		invalid('invalidCanonicalMessage', 'Canonical assistant message has no parts', `${field}.parts`, message.parts);
	}
	let reasoning: string | undefined;
	let content: string | undefined;
	const toolCalls: AgentHostProtocolValue[] = [];
	let stage: 'reasoning' | 'text' | 'toolCall' = 'reasoning';
	for (const [partIndex, part] of message.parts.entries()) {
		const partField = `${field}.parts.${partIndex}`;
		if (part.kind === 'reasoning') {
			if (stage !== 'reasoning' || reasoning !== undefined) {
				invalid('invalidCanonicalMessage', 'Canonical reasoning cannot be represented losslessly in Chat Completions history', partField, part.kind);
			}
			assertNonEmptyString(part.text, maximumProviderStringLength, 'invalidCanonicalMessage', `${partField}.text`, 'Invalid canonical reasoning text');
			reasoning = part.text;
			continue;
		}
		if (part.kind === 'text') {
			if (stage === 'toolCall' || content !== undefined) {
				invalid('invalidCanonicalMessage', 'Canonical assistant text cannot be represented losslessly in Chat Completions history', partField, part.kind);
			}
			stage = 'text';
			assertNonEmptyString(part.text, maximumProviderStringLength, 'invalidCanonicalMessage', `${partField}.text`, 'Invalid canonical assistant text');
			content = part.text;
			continue;
		}
		if (part.kind !== 'toolCall') {
			invalid('invalidCanonicalMessage', 'Unknown canonical assistant message part', `${partField}.kind`, part);
		}
		stage = 'toolCall';
		const binding = bindingForCanonicalCall(part.call.registrationId, part.call.target, projected, `${partField}.call`);
		validateCanonicalCall(part.call, binding, `${partField}.call`);
		if (historicalCallIds.has(part.call.id)) {
			invalid('invalidCanonicalMessage', 'Duplicate canonical Tool call identity', `${partField}.call.id`, part.call.id);
		}
		historicalCallIds.add(part.call.id);
		pendingCalls.set(part.call.id, binding);
		toolCalls.push({
			id: part.call.id,
			type: 'function',
			function: {
				name: binding.providerName,
				arguments: encodeAgentHostProtocolValue(part.call.input),
			},
		});
	}
	return {
		role: 'assistant',
		content: content ?? null,
		...(reasoning === undefined ? {} : { reasoning_content: reasoning }),
		...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls }),
	};
}

async function convertMessages(
	request: ICometModelStepRequest,
	projected: IOpenAIChatCompletionsProjectedTools,
	mediaTypes: ReadonlySet<string>,
	signal: AbortSignal,
): Promise<IOpenAIChatCompletionsConvertedMessages> {
	if (!Array.isArray(request.messages) || request.messages.length === 0) {
		invalid('invalidCanonicalMessage', 'OpenAI Chat Completions requires canonical model messages', 'messages', request.messages);
	}
	const attachments = await convertAttachments(request, mediaTypes, signal);
	const messages: AgentHostProtocolValue[] = [];
	const historicalCallIds = new Set<string>();
	const pendingCalls = new Map<AgentToolCallId, IOpenAIChatCompletionsToolBinding>();
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
			if (message.turn !== request.turn) {
				messages.push({ role: 'user', content: message.text });
				continue;
			}
			currentUserMessageCount += 1;
			const text = [message.text, ...attachments.text].join('\n\n');
			if (text.length > maximumProviderStringLength) {
				invalid('unsupportedAttachment', 'OpenAI Chat Completions user content exceeds its provider limit', `${field}.content`, text.length);
			}
			if (attachments.images.length === 0) {
				messages.push({ role: 'user', content: text });
			} else {
				messages.push({
					role: 'user',
					content: [
						{ type: 'text', text },
						...attachments.images,
					],
				});
			}
			continue;
		}
		if (message.role === 'assistant') {
			if (pendingCalls.size !== 0) {
				invalid('invalidCanonicalMessage', 'Canonical assistant message precedes required Tool results', `${field}.role`, message.role);
			}
			messages.push(assistantMessage(message, field, projected, historicalCallIds, pendingCalls));
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
			let result: AgentHostProtocolValue;
			if (message.result.status === 'completed') {
				result = {
					status: 'completed',
					output: validateCanonicalToolValue(
						binding.outputSchema,
						message.result.output,
						'invalidCanonicalMessage',
						`${field}.result.output`,
					),
				};
			} else if (
				message.result.status === 'denied'
				|| message.result.status === 'cancelled'
				|| message.result.status === 'timedOut'
				|| message.result.status === 'failed'
			) {
				assertProtocolValue(message.result.failure, 'invalidCanonicalMessage', `${field}.result.failure`, 'Invalid canonical Tool failure');
				result = { status: message.result.status, failure: message.result.failure };
			} else {
				invalid('invalidCanonicalMessage', 'Canonical Tool result has an invalid status', `${field}.result.status`, message.result);
			}
			pendingCalls.delete(message.result.call);
			messages.push({
				role: 'tool',
				tool_call_id: message.result.call,
				content: encodeAgentHostProtocolValue(result),
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
	return { messages: Object.freeze(messages), historicalCallIds };
}

async function responseToolCallPart(
	value: unknown,
	index: number,
	field: string,
	projected: IOpenAIChatCompletionsProjectedTools,
	callIds: Set<string>,
	request: ICometModelStepRequest,
): Promise<CometModelOutputPart> {
	const call = asRecord(value, 'invalidProviderResponse', field, 'Invalid OpenAI Chat Completions Tool call');
	assertExactKeys(call, ['id', 'type', 'function'], ['index'], 'invalidProviderResponse', field, 'Invalid OpenAI Chat Completions Tool call');
	if (call.index !== undefined && call.index !== index) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions Tool call has an invalid index', `${field}.index`, call.index);
	}
	assertNonEmptyString(call.id, 128, 'invalidProviderResponse', `${field}.id`, 'OpenAI Chat Completions Tool call has no identity');
	assertIdentity(call.id, createAgentToolCallId, 'invalidProviderResponse', `${field}.id`, 'OpenAI Chat Completions Tool call has an invalid identity');
	if (callIds.has(call.id)) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions returned a duplicate Tool call identity', `${field}.id`, call.id);
	}
	if (call.type !== 'function') {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions returned an unsupported Tool call type', `${field}.type`, call.type);
	}
	const functionCall = asRecord(call.function, 'invalidProviderResponse', `${field}.function`, 'Invalid OpenAI Chat Completions function call');
	assertExactKeys(functionCall, ['name', 'arguments'], [], 'invalidProviderResponse', `${field}.function`, 'Invalid OpenAI Chat Completions function call');
	assertNonEmptyString(functionCall.name, maximumProviderFunctionNameLength, 'invalidProviderResponse', `${field}.function.name`, 'Invalid OpenAI Chat Completions function name');
	if (typeof functionCall.arguments !== 'string' || functionCall.arguments.length > maximumProviderStringLength) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions function call has invalid arguments', `${field}.function.arguments`, functionCall.arguments);
	}
	const binding = projected.bindingsByProviderName.get(functionCall.name);
	if (binding === undefined) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions returned an unknown function name', `${field}.function.name`, functionCall.name);
	}
	let parsedArguments: unknown;
	try {
		parsedArguments = JSON.parse(functionCall.arguments);
	} catch {
		return invalid('invalidProviderResponse', 'OpenAI Chat Completions returned malformed function arguments JSON', `${field}.function.arguments`, 'malformed-json');
	}
	const input = validateCanonicalToolValue(binding.inputSchema, parsedArguments, 'invalidProviderResponse', `${field}.function.arguments`);
	if (input === null || typeof input !== 'object' || Array.isArray(input)) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions function arguments must be an object', `${field}.function.arguments`, parsedArguments);
	}
	callIds.add(call.id);
	const callId = call.id as AgentToolCallId;
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
	projected: IOpenAIChatCompletionsProjectedTools,
	historicalCallIds: ReadonlySet<string>,
	request: ICometModelStepRequest,
): Promise<ICometModelStepResult> {
	const response = asRecord(value, 'invalidProviderResponse', 'response', 'Invalid OpenAI Chat Completions response');
	assertExactKeys(
		response,
		['id', 'created', 'model', 'choices'],
		['object', 'usage', 'system_fingerprint', 'request_id', 'video_result', 'web_search', 'content_filter'],
		'invalidProviderResponse',
		'response',
		'Invalid OpenAI Chat Completions response',
	);
	assertNonEmptyString(response.id, 512, 'invalidProviderResponse', 'response.id', 'OpenAI Chat Completions response is missing an identity');
	if (response.object !== undefined && response.object !== 'chat.completion') {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions response has an invalid object type', 'response.object', response.object);
	}
	for (const field of ['video_result', 'web_search', 'content_filter'] as const) {
		const metadata = response[field];
		if (metadata !== undefined && (!Array.isArray(metadata) || metadata.length !== 0)) {
			invalid(
				'invalidProviderResponse',
				'OpenAI Chat Completions response metadata has no canonical Comet representation',
				`response.${field}`,
				metadata,
			);
		}
	}
	assertInteger(response.created, 0, Number.MAX_SAFE_INTEGER, 'invalidProviderResponse', 'response.created', 'OpenAI Chat Completions response has an invalid creation time');
	if (response.system_fingerprint !== undefined && response.system_fingerprint !== null) {
		assertNonEmptyString(
			response.system_fingerprint,
			512,
			'invalidProviderResponse',
			'response.system_fingerprint',
			'OpenAI Chat Completions response has an invalid system fingerprint',
		);
	}
	if (response.request_id !== undefined && response.request_id !== null) {
		assertNonEmptyString(
			response.request_id,
			512,
			'invalidProviderResponse',
			'response.request_id',
			'OpenAI Chat Completions response has an invalid request identity',
		);
	}
	if (response.model !== providerModel) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions returned a different model', 'response.model', response.model);
	}
	if (!Array.isArray(response.choices) || response.choices.length !== 1) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions must return exactly one choice', 'response.choices', response.choices);
	}
	const choice = asRecord(response.choices[0], 'invalidProviderResponse', 'response.choices.0', 'Invalid OpenAI Chat Completions choice');
	assertExactKeys(choice, ['index', 'message', 'finish_reason'], ['logprobs'], 'invalidProviderResponse', 'response.choices.0', 'Invalid OpenAI Chat Completions choice');
	if (choice.index !== 0) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions choice has an invalid index', 'response.choices.0.index', choice.index);
	}
	if (choice.logprobs !== undefined && choice.logprobs !== null) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions log probabilities have no canonical representation', 'response.choices.0.logprobs', 'present');
	}
	const message = asRecord(choice.message, 'invalidProviderResponse', 'response.choices.0.message', 'Invalid OpenAI Chat Completions message');
	assertExactKeys(
		message,
		['role', 'content'],
		['reasoning_content', 'tool_calls', 'refusal'],
		'invalidProviderResponse',
		'response.choices.0.message',
		'Invalid OpenAI Chat Completions message',
	);
	if (message.role !== 'assistant') {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions message has an invalid role', 'response.choices.0.message.role', message.role);
	}
	if (message.refusal !== undefined && message.refusal !== null) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions refusal has no canonical representation', 'response.choices.0.message.refusal', 'present');
	}
	const parts: CometModelOutputPart[] = [];
	if (message.reasoning_content !== undefined && message.reasoning_content !== null && message.reasoning_content !== '') {
		assertNonEmptyString(
			message.reasoning_content,
			maximumProviderStringLength,
			'invalidProviderResponse',
			'response.choices.0.message.reasoning_content',
			'Invalid OpenAI Chat Completions reasoning content',
		);
		parts.push({ kind: 'reasoning', text: message.reasoning_content });
	}
	if (message.content !== null && message.content !== '') {
		assertNonEmptyString(
			message.content,
			maximumProviderStringLength,
			'invalidProviderResponse',
			'response.choices.0.message.content',
			'Invalid OpenAI Chat Completions content',
		);
		parts.push({ kind: 'text', text: message.content });
	}
	const callIds = new Set(historicalCallIds);
	let toolCallCount = 0;
	if (message.tool_calls !== undefined) {
		if (!Array.isArray(message.tool_calls) || message.tool_calls.length === 0 || message.tool_calls.length > maximumProjectedToolCount) {
			invalid('invalidProviderResponse', 'OpenAI Chat Completions returned invalid Tool calls', 'response.choices.0.message.tool_calls', message.tool_calls);
		}
		for (const [index, toolCall] of message.tool_calls.entries()) {
			parts.push(await responseToolCallPart(toolCall, index, `response.choices.0.message.tool_calls.${index}`, projected, callIds, request));
			toolCallCount += 1;
		}
	}
	if (choice.finish_reason === 'stop') {
		if (toolCallCount !== 0 || !parts.some(part => part.kind === 'text')) {
			invalid('invalidProviderResponse', 'OpenAI Chat Completions stop response has invalid canonical output', 'response.choices.0.finish_reason', choice.finish_reason);
		}
	} else if (choice.finish_reason === 'tool_calls') {
		if (toolCallCount === 0) {
			invalid('invalidProviderResponse', 'OpenAI Chat Completions Tool-call response has no Tool calls', 'response.choices.0.finish_reason', choice.finish_reason);
		}
	} else {
		throw new CometModelError(
			'invalidProviderResponse',
			'OpenAI Chat Completions did not complete successfully',
			{
				response: response.id,
				finishReason: diagnosticValue(choice.finish_reason),
			},
		);
	}
	let usage: AgentHostProtocolValue | undefined;
	if (response.usage !== undefined && response.usage !== null) {
		assertProtocolValue(response.usage, 'invalidProviderResponse', 'response.usage', 'Invalid OpenAI Chat Completions usage');
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
		invalid('invalidProviderResponse', 'OpenAI Chat Completions returned a non-JSON content type', 'response.contentType', contentType);
	}
	const contentLength = response.headers.get('content-length');
	if (contentLength !== null) {
		const length = Number(contentLength);
		if (!Number.isSafeInteger(length) || length < 0 || length > maximumBytes) {
			invalid('invalidProviderResponse', 'OpenAI Chat Completions returned an invalid content length', 'response.contentLength', contentLength);
		}
	}
	if (response.body === null) {
		invalid('invalidProviderResponse', 'OpenAI Chat Completions returned an empty body', 'response.body', 'missing');
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
			invalid('invalidProviderResponse', 'OpenAI Chat Completions body exceeded its byte limit', 'response.body.byteLength', byteLength);
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
		return invalid('invalidProviderResponse', 'OpenAI Chat Completions body is not valid UTF-8', 'response.body', 'invalid-utf8');
	}
	try {
		return JSON.parse(text);
	} catch {
		return invalid('invalidProviderResponse', 'OpenAI Chat Completions body is not valid JSON', 'response.body', 'malformed-json');
	}
}

export class OpenAIChatCompletionsModelRuntime implements ICometModelRuntime {
	readonly id: string;
	readonly descriptor: IAgentModelDescriptor;

	private readonly connectionResolver: IOpenAIChatCompletionsConnectionResolver;
	private readonly maximumRequestMilliseconds: number;
	private readonly maximumRequestBytes: number;
	private readonly maximumResponseBytes: number;
	private readonly fetchImplementation: (url: string, init: RequestInit) => Promise<Response>;
	private readonly now: () => number;
	private readonly attachmentMediaTypes: ReadonlySet<string>;

	constructor(options: IOpenAIChatCompletionsModelRuntimeOptions) {
		if (typeof options.id !== 'string' || !modelRuntimePattern.test(options.id)) {
			invalid('invalidConfiguration', 'Invalid OpenAI Chat Completions runtime identity', 'runtime.id', options.id);
		}
		this.id = options.id;
		this.descriptor = validateDescriptor(options.descriptor);
		if (options.connectionResolver === null || typeof options.connectionResolver !== 'object' || typeof options.connectionResolver.resolve !== 'function') {
			invalid('invalidConfiguration', 'OpenAI Chat Completions connection resolver is required', 'connectionResolver', options.connectionResolver);
		}
		this.connectionResolver = options.connectionResolver;
		assertInteger(options.maximumRequestMilliseconds, 1, 10 * 60 * 1_000, 'invalidConfiguration', 'maximumRequestMilliseconds', 'Invalid OpenAI Chat Completions request duration limit');
		this.maximumRequestMilliseconds = options.maximumRequestMilliseconds;
		assertInteger(options.maximumRequestBytes, 1, 64 * 1024 * 1024, 'invalidConfiguration', 'maximumRequestBytes', 'Invalid OpenAI Chat Completions request byte limit');
		this.maximumRequestBytes = options.maximumRequestBytes;
		assertInteger(options.maximumResponseBytes, 1, 64 * 1024 * 1024, 'invalidConfiguration', 'maximumResponseBytes', 'Invalid OpenAI Chat Completions response byte limit');
		this.maximumResponseBytes = options.maximumResponseBytes;
		if (typeof options.fetch !== 'function') {
			invalid('invalidConfiguration', 'OpenAI Chat Completions fetch implementation is required', 'fetch', options.fetch);
		}
		this.fetchImplementation = options.fetch;
		if (typeof options.now !== 'function') {
			invalid('invalidConfiguration', 'OpenAI Chat Completions clock is required', 'now', options.now);
		}
		const now = options.now();
		if (!Number.isSafeInteger(now) || now <= 0) {
			invalid('invalidConfiguration', 'OpenAI Chat Completions clock returned an invalid value', 'now', now);
		}
		this.now = options.now;
		this.attachmentMediaTypes = new Set(this.descriptor.attachments.mediaTypes);
	}

	async executeStep(request: ICometModelStepRequest, token: CancellationToken): Promise<ICometModelStepResult> {
		this.validateStepRequest(request);
		const settings = parseExecutionSettings(request.settings);
		const projected = projectTools(request);
		const systemContent = request.workspace === undefined
			? request.systemPrompt
			: `${request.systemPrompt}\n\nCanonical workspace context: ${encodeAgentHostProtocolValue(request.workspace)}`;
		return this.runControlled(request.deadline, token, async signal => {
			const connection = await this.resolveConnection(signal);
			const converted = await convertMessages(request, projected, this.attachmentMediaTypes, signal);
			const requestValue: Record<string, AgentHostProtocolValue> = {
				model: connection.providerModel,
				messages: [
					{ role: 'system', content: systemContent },
					...converted.messages,
				],
				stream: false,
				[settings.maximumOutputTokensField]: settings.maxOutputTokens,
				...(projected.definitions.length === 0 ? {} : { tools: projected.definitions }),
			};
			const body = encodeAgentHostProtocolValue(requestValue);
			const requestBytes = new TextEncoder().encode(body).byteLength;
			if (requestBytes > this.maximumRequestBytes) {
				invalid('invalidExecutionSettings', 'OpenAI Chat Completions request exceeded its byte limit', 'request.byteLength', requestBytes);
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
				throw new CometModelError('providerRequestFailed', 'OpenAI Chat Completions request failed before receiving a response');
			}
			if (!response.ok) {
				const requestId = response.headers.get('x-request-id');
				throw new CometModelError(
					'providerRequestFailed',
					'OpenAI Chat Completions request returned an unsuccessful HTTP status',
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
				throw new CometModelError('providerRequestFailed', 'OpenAI Chat Completions response body could not be read');
			}
			return parseProviderResponse(value, connection.providerModel, projected, converted.historicalCallIds, request);
		});
	}

	private async resolveConnection(signal: AbortSignal): Promise<IOpenAIChatCompletionsConnection> {
		let connection: IOpenAIChatCompletionsConnection;
		try {
			connection = await this.connectionResolver.resolve({ runtime: this.id, model: this.descriptor.id, signal });
		} catch (error) {
			if (error instanceof CometModelError || error instanceof CancellationError) {
				throw error;
			}
			throw new CometModelError('connectionResolutionFailed', 'OpenAI Chat Completions connection resolution failed');
		}
		if (signal.aborted) {
			throw new CancellationError();
		}
		if (connection === null || typeof connection !== 'object') {
			invalid('connectionResolutionFailed', 'OpenAI Chat Completions connection resolver returned an invalid value', 'connection', connection);
		}
		if (typeof connection.apiKey !== 'string' || connection.apiKey.length === 0) {
			invalid('authenticationRequired', 'OpenAI Chat Completions authentication is required', 'connection.apiKey', 'missing');
		}
		if (connection.apiKey.length > 8_192 || connection.apiKey.trim() !== connection.apiKey || /[\r\n]/.test(connection.apiKey)) {
			invalid('invalidConfiguration', 'Invalid OpenAI Chat Completions API key', 'connection.apiKey', 'invalid-secret');
		}
		assertNonEmptyString(connection.providerModel, 256, 'invalidConfiguration', 'connection.providerModel', 'Invalid OpenAI Chat Completions provider model');
		return Object.freeze({
			endpoint: validateEndpoint(connection.endpoint),
			apiKey: connection.apiKey,
			providerModel: connection.providerModel,
		});
	}

	private validateStepRequest(request: ICometModelStepRequest): void {
		const message = 'Invalid OpenAI Chat Completions model step request';
		assertIdentity(request.session, createAgentSessionId, 'invalidCanonicalMessage', 'request.session', message);
		assertIdentity(request.chat, createAgentChatId, 'invalidCanonicalMessage', 'request.chat', message);
		assertIdentity(request.turn, createAgentTurnId, 'invalidCanonicalMessage', 'request.turn', message);
		if (request.profile.modelDescriptor !== this.descriptor.revision) {
			invalid('invalidExecutionSettings', 'Execution profile does not belong to this OpenAI Chat Completions model', 'profile.modelDescriptor', request.profile.modelDescriptor);
		}
		if (!Number.isSafeInteger(request.step) || request.step < 0 || request.step >= maximumExecutionSteps) {
			invalid('invalidExecutionSettings', message, 'request.step', request.step);
		}
		assertNonEmptyString(request.systemPrompt, 64 * 1024, 'invalidExecutionSettings', 'request.systemPrompt', message);
		if (!Number.isSafeInteger(request.deadline) || request.deadline <= 0) {
			invalid('invalidExecutionSettings', message, 'request.deadline', request.deadline);
		}
		if (request.checkpoint !== undefined) {
			invalid('invalidExecutionSettings', 'This OpenAI Chat Completions runtime does not define a provider checkpoint', 'request.checkpoint', 'present');
		}
		if (request.workspace !== undefined) {
			assertProtocolValue(request.workspace, 'invalidExecutionSettings', 'request.workspace', message);
		}
		const constraints = asRecord(request.outputConstraints, 'invalidExecutionSettings', 'request.outputConstraints', message);
		assertExactKeys(constraints, ['format'], [], 'invalidExecutionSettings', 'request.outputConstraints', message);
		if (constraints.format !== 'text') {
			invalid('invalidExecutionSettings', 'Unsupported OpenAI Chat Completions output format', 'request.outputConstraints.format', constraints.format);
		}
		if (!Array.isArray(request.attachments) || request.attachments.length > this.descriptor.attachments.maximumCount) {
			invalid('unsupportedAttachment', 'OpenAI Chat Completions attachment count exceeds the model descriptor', 'request.attachments.length', request.attachments);
		}
		let totalBytes = 0;
		for (const [index, attachment] of request.attachments.entries()) {
			try {
				assertAgentHostAttachment(attachment.attachment);
			} catch {
				invalid('unsupportedAttachment', 'Invalid OpenAI Chat Completions attachment', `request.attachments.${index}`, attachment);
			}
			const canonicalContent = attachment.attachment.content;
			if (canonicalContent !== undefined && !this.descriptor.attachments.carriers.includes(canonicalContent.kind)) {
				invalid('unsupportedAttachment', 'Attachment carrier is not advertised by this OpenAI Chat Completions model', `request.attachments.${index}.content.kind`, canonicalContent.kind);
			}
			if (canonicalContent?.kind === 'reference' && !this.descriptor.attachments.shapes.includes(canonicalContent.shape)) {
				invalid('unsupportedAttachment', 'Attachment shape is not advertised by this OpenAI Chat Completions model', `request.attachments.${index}.content.shape`, canonicalContent.shape);
			}
			const byteLength = canonicalContent === undefined
				? 0
				: canonicalContent.kind === 'inline'
					? canonicalContent.byteLength
					: canonicalContent.bounds.byteLength;
			if (byteLength > this.descriptor.attachments.maximumItemBytes) {
				invalid('unsupportedAttachment', 'OpenAI Chat Completions attachment exceeds its item byte limit', `request.attachments.${index}.byteLength`, byteLength);
			}
			totalBytes += byteLength;
		}
		if (!Number.isSafeInteger(totalBytes) || totalBytes > this.descriptor.attachments.maximumTotalBytes) {
			invalid('unsupportedAttachment', 'OpenAI Chat Completions attachments exceed their total byte limit', 'request.attachments.totalBytes', totalBytes);
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
			invalid('invalidConfiguration', 'OpenAI Chat Completions clock returned an invalid value', 'now', startedAt);
		}
		const effectiveDeadline = Math.min(deadline, startedAt + this.maximumRequestMilliseconds);
		if (effectiveDeadline <= startedAt) {
			throw new CometModelError('deadlineExceeded', 'OpenAI Chat Completions request deadline has already elapsed');
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
			rejectAbort(new CometModelError('deadlineExceeded', 'OpenAI Chat Completions request exceeded its deadline'));
		}, effectiveDeadline - startedAt);

		try {
			return await Promise.race([operation(controller.signal), abortPromise]);
		} catch (error) {
			if (abort.state === 'cancelled') {
				throw new CancellationError();
			}
			if (abort.state === 'deadline') {
				throw new CometModelError('deadlineExceeded', 'OpenAI Chat Completions request exceeded its deadline');
			}
			throw error;
		} finally {
			clearTimeout(timer);
			cancelListener.dispose();
		}
	}
}
