/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import {
	assertAgentHostInteractionTarget,
	type IAgentHostInteractionTarget,
} from './attachments.js';
import {
	AgentChatId,
	AgentDescriptorRevision,
	AgentHostClientConnectionId,
	AgentHostOperationId,
	AgentHostPayloadDigest,
	AgentId,
	AgentInteractionTargetId,
	AgentInteractionTargetTypeId,
	AgentMcpServerId,
	AgentModelDescriptorRevision,
	AgentRuntimeRegistrationRevision,
	AgentSessionId,
	AgentToolCallId,
	AgentToolContributorId,
	AgentToolDescriptorRevision,
	AgentToolExecutorId,
	AgentToolId,
	AgentToolRegistrationId,
	AgentToolRegistrationRevision,
	AgentToolSchemaProfileId,
	AgentToolSetRevision,
	AgentTurnId,
	createAgentChatId,
	createAgentHostClientConnectionId,
	createAgentHostOperationId,
	createAgentHostPayloadDigest,
	createAgentId,
	createAgentInteractionTargetId,
	createAgentInteractionTargetTypeId,
	createAgentMcpServerId,
	createAgentRuntimeRegistrationRevision,
	createAgentSessionId,
	createAgentToolCallId,
	createAgentToolContributorId,
	createAgentToolDescriptorRevision,
	createAgentToolExecutorId,
	createAgentToolId,
	createAgentToolRegistrationId,
	createAgentToolRegistrationRevision,
	createAgentToolSchemaProfileId,
	createAgentToolSetRevision,
	createAgentTurnId,
} from './identities.js';
import { AgentHostError, AgentHostErrorCode } from './errors.js';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	computeAgentHostPayloadDigest,
	encodeAgentHostProtocolValue,
} from './protocolValues.js';

export const COMET_TOOL_SCHEMA_PROFILE = createAgentToolSchemaProfileId('comet.tools.v1');

interface ICometToolSchemaDescription {
	readonly description?: string;
}

export type CometToolSchemaNode =
	| (ICometToolSchemaDescription & { readonly type: 'null' })
	| (ICometToolSchemaDescription & { readonly type: 'boolean' })
	| (ICometToolSchemaDescription & {
		readonly type: 'number' | 'integer';
		readonly minimum?: number;
		readonly maximum?: number;
	})
	| (ICometToolSchemaDescription & {
		readonly type: 'string';
		readonly minimumLength?: number;
		readonly maximumLength?: number;
		readonly enum?: readonly string[];
	})
	| (ICometToolSchemaDescription & {
		readonly type: 'array';
		readonly items: CometToolSchemaNode;
		readonly minimumItems?: number;
		readonly maximumItems?: number;
	})
	| (ICometToolSchemaDescription & {
		readonly type: 'object';
		readonly properties: Readonly<Record<string, CometToolSchemaNode>>;
		readonly required: readonly string[];
		readonly additionalProperties: false;
	})
	| (ICometToolSchemaDescription & {
		readonly type: 'literal';
		readonly value: null | boolean | number | string;
	})
	| (ICometToolSchemaDescription & {
		readonly type: 'oneOf';
		readonly variants: readonly CometToolSchemaNode[];
	});

const maximumCometToolSchemaDepth = 32;
const maximumCometToolSchemaNodes = 4_096;
const maximumCometToolSchemaProperties = 8_192;
const maximumCometToolSchemaDescriptionLength = 8_192;
const maximumCometToolSchemaPropertyNameLength = 128;
const maximumCometToolSchemaEnumValues = 256;
const maximumCometToolSchemaStringConstraint = 64 * 1024 * 1024;

function invalidToolSchema(field: string, value: unknown): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidProtocolValue,
		'Invalid comet.tools.v1 schema or value',
		{ field, value: typeof value === 'string' ? value.slice(0, 256) : typeof value },
	);
}

function schemaRecord(value: unknown, field: string): Readonly<Record<string, unknown>> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidToolSchema(field, value);
	}
	return value as Readonly<Record<string, unknown>>;
}

function assertSchemaKeys(
	record: Readonly<Record<string, unknown>>,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	if (
		Object.keys(record).some(key => !allowed.has(key))
		|| required.some(key => !Object.hasOwn(record, key))
	) {
		invalidToolSchema(field, 'fields');
	}
}

function schemaDescription(record: Readonly<Record<string, unknown>>, field: string): string | undefined {
	if (record.description === undefined) {
		return undefined;
	}
	if (typeof record.description !== 'string' || record.description.length > maximumCometToolSchemaDescriptionLength) {
		return invalidToolSchema(`${field}.description`, record.description);
	}
	return record.description;
}

function optionalBound(value: unknown, field: string, maximum: number): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
		return invalidToolSchema(field, value);
	}
	return value as number;
}

/** Strictly decodes the lossless, bounded comet.tools.v1 schema language. */
export function parseCometToolSchema(schema: IAgentToolSchema): CometToolSchemaNode {
	if (schema === null
		|| typeof schema !== 'object'
		|| Array.isArray(schema)
		|| Object.keys(schema).length !== 2
		|| !Object.hasOwn(schema, 'profile')
		|| !Object.hasOwn(schema, 'value')) {
		return invalidToolSchema('schema', 'fields');
	}
	if (schema.profile !== COMET_TOOL_SCHEMA_PROFILE) {
		return invalidToolSchema('schema.profile', schema.profile);
	}
	assertAgentHostProtocolValue(schema.value);
	let nodes = 0;
	let properties = 0;
	const visit = (value: unknown, field: string, depth: number): CometToolSchemaNode => {
		if (depth > maximumCometToolSchemaDepth || ++nodes > maximumCometToolSchemaNodes) {
			return invalidToolSchema(field, 'bounds');
		}
		const record = schemaRecord(value, field);
		const description = schemaDescription(record, field);
		const withDescription = description === undefined ? {} : { description };
		switch (record.type) {
			case 'null':
			case 'boolean':
				assertSchemaKeys(record, ['type'], ['description'], field);
				return Object.freeze({ type: record.type, ...withDescription });
			case 'number':
			case 'integer': {
				assertSchemaKeys(record, ['type'], ['description', 'minimum', 'maximum'], field);
				const minimum = record.minimum;
				const maximum = record.maximum;
				if ((minimum !== undefined && (typeof minimum !== 'number' || !Number.isFinite(minimum)))
					|| (maximum !== undefined && (typeof maximum !== 'number' || !Number.isFinite(maximum)))
					|| (minimum !== undefined && maximum !== undefined && minimum > maximum)) {
					return invalidToolSchema(field, 'number bounds');
				}
				return Object.freeze({
					type: record.type,
					...withDescription,
					...(minimum === undefined ? {} : { minimum }),
					...(maximum === undefined ? {} : { maximum }),
				}) as CometToolSchemaNode;
			}
			case 'string': {
				assertSchemaKeys(record, ['type'], ['description', 'minimumLength', 'maximumLength', 'enum'], field);
				const minimumLength = optionalBound(record.minimumLength, `${field}.minimumLength`, maximumCometToolSchemaStringConstraint);
				const maximumLength = optionalBound(record.maximumLength, `${field}.maximumLength`, maximumCometToolSchemaStringConstraint);
				if (minimumLength !== undefined && maximumLength !== undefined && minimumLength > maximumLength) {
					return invalidToolSchema(field, 'string bounds');
				}
				let enumValues: readonly string[] | undefined;
				if (record.enum !== undefined) {
					if (!Array.isArray(record.enum) || record.enum.length === 0 || record.enum.length > maximumCometToolSchemaEnumValues) {
						return invalidToolSchema(`${field}.enum`, record.enum);
					}
					const values = record.enum.map((candidate, index) => {
						if (typeof candidate !== 'string' || candidate.length > maximumCometToolSchemaStringConstraint) {
							return invalidToolSchema(`${field}.enum.${index}`, candidate);
						}
						return candidate;
					});
					if (new Set(values).size !== values.length) {
						return invalidToolSchema(`${field}.enum`, 'duplicates');
					}
					enumValues = Object.freeze(values);
				}
				return Object.freeze({
					type: 'string',
					...withDescription,
					...(minimumLength === undefined ? {} : { minimumLength }),
					...(maximumLength === undefined ? {} : { maximumLength }),
					...(enumValues === undefined ? {} : { enum: enumValues }),
				});
			}
			case 'array': {
				assertSchemaKeys(record, ['type', 'items'], ['description', 'minimumItems', 'maximumItems'], field);
				const minimumItems = optionalBound(record.minimumItems, `${field}.minimumItems`, maximumCometToolSchemaProperties);
				const maximumItems = optionalBound(record.maximumItems, `${field}.maximumItems`, maximumCometToolSchemaProperties);
				if (minimumItems !== undefined && maximumItems !== undefined && minimumItems > maximumItems) {
					return invalidToolSchema(field, 'array bounds');
				}
				return Object.freeze({
					type: 'array',
					...withDescription,
					items: visit(record.items, `${field}.items`, depth + 1),
					...(minimumItems === undefined ? {} : { minimumItems }),
					...(maximumItems === undefined ? {} : { maximumItems }),
				});
			}
			case 'object': {
				assertSchemaKeys(record, ['type', 'properties', 'required', 'additionalProperties'], ['description'], field);
				if (record.additionalProperties !== false || !Array.isArray(record.required)) {
					return invalidToolSchema(field, 'object contract');
				}
				const sourceProperties = schemaRecord(record.properties, `${field}.properties`);
				const names = Object.keys(sourceProperties);
				properties += names.length;
				if (properties > maximumCometToolSchemaProperties || names.some(name => name.length === 0 || name.length > maximumCometToolSchemaPropertyNameLength)) {
					return invalidToolSchema(`${field}.properties`, 'bounds');
				}
				const required = record.required.map((name, index) => {
					if (typeof name !== 'string' || !Object.hasOwn(sourceProperties, name)) {
						return invalidToolSchema(`${field}.required.${index}`, name);
					}
					return name;
				});
				if (new Set(required).size !== required.length) {
					return invalidToolSchema(`${field}.required`, 'duplicates');
				}
				const decoded: Record<string, CometToolSchemaNode> = {};
				for (const name of names) {
					Object.defineProperty(decoded, name, {
						value: visit(sourceProperties[name], `${field}.properties.${name}`, depth + 1),
						enumerable: true,
						configurable: false,
						writable: false,
					});
				}
				return Object.freeze({
					type: 'object',
					...withDescription,
					properties: Object.freeze(decoded),
					required: Object.freeze(required),
					additionalProperties: false,
				});
			}
			case 'literal':
				assertSchemaKeys(record, ['type', 'value'], ['description'], field);
				if (record.value !== null && !['boolean', 'number', 'string'].includes(typeof record.value)) {
					return invalidToolSchema(`${field}.value`, record.value);
				}
				if (typeof record.value === 'number' && !Number.isFinite(record.value)) {
					return invalidToolSchema(`${field}.value`, record.value);
				}
				return Object.freeze({ type: 'literal', ...withDescription, value: record.value }) as CometToolSchemaNode;
			case 'oneOf':
				assertSchemaKeys(record, ['type', 'variants'], ['description'], field);
				if (!Array.isArray(record.variants) || record.variants.length < 2 || record.variants.length > 32) {
					return invalidToolSchema(`${field}.variants`, record.variants);
				}
				return Object.freeze({
					type: 'oneOf',
					...withDescription,
					variants: Object.freeze(record.variants.map((variant, index) => visit(variant, `${field}.variants.${index}`, depth + 1))),
				});
			default:
				return invalidToolSchema(`${field}.type`, record.type);
		}
	};
	return visit(schema.value, 'schema.value', 0);
}

function cloneProtocolValue(value: AgentHostProtocolValue): AgentHostProtocolValue {
	if (value === null || typeof value !== 'object') {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(cloneProtocolValue));
	}
	const result: Record<string, AgentHostProtocolValue> = {};
	for (const [key, item] of Object.entries(value)) {
		Object.defineProperty(result, key, {
			value: cloneProtocolValue(item),
			enumerable: true,
			configurable: false,
			writable: false,
		});
	}
	return Object.freeze(result);
}

function validateSchemaValue(schema: CometToolSchemaNode, value: AgentHostProtocolValue, field: string): void {
	switch (schema.type) {
		case 'null':
			if (value !== null) { invalidToolSchema(field, value); }
			return;
		case 'boolean':
			if (typeof value !== 'boolean') { invalidToolSchema(field, value); }
			return;
		case 'number':
		case 'integer':
			if (typeof value !== 'number' || (schema.type === 'integer' && !Number.isSafeInteger(value))
				|| (schema.minimum !== undefined && value < schema.minimum)
				|| (schema.maximum !== undefined && value > schema.maximum)) {
				invalidToolSchema(field, value);
			}
			return;
		case 'string':
			if (typeof value !== 'string'
				|| (schema.minimumLength !== undefined && value.length < schema.minimumLength)
				|| (schema.maximumLength !== undefined && value.length > schema.maximumLength)
				|| (schema.enum !== undefined && !schema.enum.includes(value))) {
				invalidToolSchema(field, value);
			}
			return;
		case 'array':
			if (!Array.isArray(value)
				|| (schema.minimumItems !== undefined && value.length < schema.minimumItems)
				|| (schema.maximumItems !== undefined && value.length > schema.maximumItems)) {
				invalidToolSchema(field, value);
			}
			for (const [index, item] of (value as readonly AgentHostProtocolValue[]).entries()) {
				validateSchemaValue(schema.items, item, `${field}.${index}`);
			}
			return;
		case 'object': {
			if (value === null || typeof value !== 'object' || Array.isArray(value)) {
				return invalidToolSchema(field, value);
			}
			const record = value as Readonly<Record<string, AgentHostProtocolValue>>;
			if (Object.keys(record).some(name => !Object.hasOwn(schema.properties, name))
				|| schema.required.some(name => !Object.hasOwn(record, name))) {
				return invalidToolSchema(field, 'object fields');
			}
			for (const [name, item] of Object.entries(record)) {
				validateSchemaValue(schema.properties[name], item, `${field}.${name}`);
			}
			return;
		}
		case 'literal':
			if (encodeAgentHostProtocolValue(value) !== encodeAgentHostProtocolValue(schema.value)) {
				invalidToolSchema(field, value);
			}
			return;
		case 'oneOf': {
			let matches = 0;
			for (const variant of schema.variants) {
				try {
					validateSchemaValue(variant, value, field);
					matches += 1;
				} catch (error) {
					if (!(error instanceof AgentHostError)) { throw error; }
				}
			}
			if (matches !== 1) { invalidToolSchema(field, `oneOf:${matches}`); }
		}
	}
}

/** Validates without coercion or truncation and returns an immutable lossless clone. */
export function validateCometToolValue(
	schema: CometToolSchemaNode,
	value: AgentHostProtocolValue,
	field: string,
): AgentHostProtocolValue {
	assertAgentHostProtocolValue(value);
	validateSchemaValue(schema, value, field);
	return cloneProtocolValue(value);
}

export interface IAgentToolSchema {
	readonly profile: AgentToolSchemaProfileId;
	readonly value: AgentHostProtocolValue;
}

export interface IAgentToolLimits {
	readonly maximumInputBytes: number;
	readonly maximumOutputBytes: number;
	readonly maximumContentBytes: number;
	readonly timeoutMilliseconds: number;
	readonly maximumConcurrency: number;
}

export interface IAgentToolDescriptor {
	readonly id: AgentToolId;
	readonly revision: AgentToolDescriptorRevision;
	readonly contributor: AgentToolContributorId;
	readonly functionName: string;
	readonly displayName: string;
	readonly description: string;
	readonly inputSchema: IAgentToolSchema;
	readonly outputSchema: IAgentToolSchema;
	readonly safety: 'read' | 'write' | 'external';
	readonly confirmation: 'never' | 'always' | 'writeOrExternal';
	readonly allowsEditedInput: boolean;
	readonly targetTypes: readonly AgentInteractionTargetTypeId[];
	readonly limits: IAgentToolLimits;
}

export type AgentToolExecutorReference =
	| {
		readonly kind: 'client';
		readonly connection: AgentHostClientConnectionId;
		readonly executor: AgentToolExecutorId;
	}
	| {
		readonly kind: 'host';
		readonly executor: AgentToolExecutorId;
	}
	| {
		readonly kind: 'agent';
		readonly agent: AgentId;
		readonly registration: AgentRuntimeRegistrationRevision;
		readonly executor: AgentToolExecutorId;
	}
	| {
		readonly kind: 'mcp';
		readonly server: AgentMcpServerId;
		readonly tool: string;
	};

export interface IAgentToolRegistration {
	readonly id: AgentToolRegistrationId;
	readonly revision: AgentToolRegistrationRevision;
	readonly descriptor: IAgentToolDescriptor;
	readonly executor: AgentToolExecutorReference;
}

/** Matches a targeted registration to the exact target authority its executor can address. */
export function agentToolRegistrationAcceptsTarget(
	registration: IAgentToolRegistration,
	target: IAgentHostInteractionTarget,
): boolean {
	return registration.descriptor.targetTypes.includes(target.type)
		&& (registration.executor.kind !== 'client'
			|| (target.authority.kind === 'client'
				&& target.authority.connection === registration.executor.connection));
}

export interface IAgentClientToolPublicationSnapshot {
	readonly connection: AgentHostClientConnectionId;
	readonly revision: number;
	readonly registrations: readonly IAgentToolRegistration[];
}

const maximumToolDescriptionLength = 8_192;
const maximumToolDisplayNameLength = 256;
const maximumToolBytes = 64 * 1024 * 1024;
const maximumToolTimeout = 10 * 60 * 1_000;
const maximumToolConcurrency = 128;
const maximumToolFailureMessageLength = 8_192;
const toolFunctionNamePattern = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

function hasExactKeys(record: object, required: readonly string[], optional: readonly string[] = []): boolean {
	const allowed = new Set([...required, ...optional]);
	const keys = Object.keys(record);
	return keys.every(key => allowed.has(key)) && required.every(key => Object.hasOwn(record, key));
}

function freezeToolSchema(schema: IAgentToolSchema): IAgentToolSchema {
	if (!hasExactKeys(schema, ['profile', 'value'])) {
		throw new Error('Invalid Tool schema fields');
	}
	parseCometToolSchema(schema);
	return Object.freeze({ profile: schema.profile, value: cloneProtocolValue(schema.value) });
}

/** Strictly validates and freezes one canonical Tool registration. */
export function validateAndFreezeAgentToolRegistration(registration: IAgentToolRegistration): IAgentToolRegistration {
	if (!hasExactKeys(registration, ['id', 'revision', 'descriptor', 'executor'])) {
		throw new Error('Invalid Tool registration fields');
	}
	createAgentToolRegistrationId(registration.id);
	createAgentToolRegistrationRevision(registration.revision);
	const descriptor = registration.descriptor;
	if (!hasExactKeys(descriptor, [
		'id', 'revision', 'contributor', 'functionName', 'displayName', 'description',
		'inputSchema', 'outputSchema', 'safety', 'confirmation', 'allowsEditedInput',
		'targetTypes', 'limits',
	])) {
		throw new Error(`Invalid Tool descriptor fields '${descriptor.id}'`);
	}
	createAgentToolId(descriptor.id);
	createAgentToolDescriptorRevision(descriptor.revision);
	createAgentToolContributorId(descriptor.contributor);
	if (typeof descriptor.functionName !== 'string' || !toolFunctionNamePattern.test(descriptor.functionName)) {
		throw new Error(`Invalid Tool function name '${descriptor.functionName}'`);
	}
	if (typeof descriptor.displayName !== 'string'
		|| typeof descriptor.description !== 'string'
		|| descriptor.displayName.length === 0
		|| descriptor.displayName.length > maximumToolDisplayNameLength
		|| descriptor.description.length > maximumToolDescriptionLength) {
		throw new Error(`Invalid Tool display metadata '${descriptor.id}'`);
	}
	if (!Array.isArray(descriptor.targetTypes)) {
		throw new Error(`Invalid Tool target types '${descriptor.id}'`);
	}
	const targetTypes = new Set(descriptor.targetTypes);
	if (targetTypes.size !== descriptor.targetTypes.length) {
		throw new Error(`Tool '${descriptor.id}' declares duplicate target types`);
	}
	for (const targetType of targetTypes) {
		createAgentInteractionTargetTypeId(targetType);
	}
	const limits = descriptor.limits;
	if (!hasExactKeys(limits, [
		'maximumInputBytes', 'maximumOutputBytes', 'maximumContentBytes',
		'timeoutMilliseconds', 'maximumConcurrency',
	])) {
		throw new Error(`Invalid Tool limit fields '${descriptor.id}'`);
	}
	for (const [field, value] of Object.entries(limits)) {
		if (!Number.isSafeInteger(value) || value < 1) {
			throw new Error(`Invalid Tool limit '${descriptor.id}.${field}'`);
		}
	}
	if (limits.maximumInputBytes > maximumToolBytes || limits.maximumOutputBytes > maximumToolBytes
		|| limits.maximumContentBytes > maximumToolBytes || limits.timeoutMilliseconds > maximumToolTimeout
		|| limits.maximumConcurrency > maximumToolConcurrency) {
		throw new Error(`Tool '${descriptor.id}' exceeds Host limits`);
	}
	if (!['read', 'write', 'external'].includes(descriptor.safety)
		|| !['never', 'always', 'writeOrExternal'].includes(descriptor.confirmation)
		|| typeof descriptor.allowsEditedInput !== 'boolean') {
		throw new Error(`Invalid Tool policy '${descriptor.id}'`);
	}
	assertAgentToolExecutorReference(registration.executor);
	const inputSchema = freezeToolSchema(descriptor.inputSchema);
	const outputSchema = freezeToolSchema(descriptor.outputSchema);
	if (inputSchema.profile !== outputSchema.profile) {
		throw new Error(`Tool '${descriptor.id}' input and output schema profiles differ`);
	}
	return Object.freeze({
		id: registration.id,
		revision: registration.revision,
		descriptor: Object.freeze({
			...descriptor,
			inputSchema,
			outputSchema,
			targetTypes: Object.freeze([...descriptor.targetTypes]),
			limits: Object.freeze({ ...limits }),
		}),
		executor: Object.freeze({ ...registration.executor }),
	});
}

/** Strictly validates one contiguous connected-client Tool publication snapshot. */
export function validateAndFreezeAgentClientToolPublicationSnapshot(
	snapshot: unknown,
): IAgentClientToolPublicationSnapshot {
	if (snapshot === null || typeof snapshot !== 'object' || Array.isArray(snapshot)
		|| !hasExactKeys(snapshot, ['connection', 'revision', 'registrations'])) {
		throw new Error('Invalid client Tool publication snapshot fields');
	}
	const candidate = snapshot as IAgentClientToolPublicationSnapshot;
	assertAgentHostProtocolValue(candidate);
	createAgentHostClientConnectionId(candidate.connection);
	if (!Number.isSafeInteger(candidate.revision) || candidate.revision < 1) {
		throw new Error('Invalid client Tool publication revision');
	}
	if (!Array.isArray(candidate.registrations)) {
		throw new Error('Invalid client Tool publication registrations');
	}
	const registrations = candidate.registrations.map(validateAndFreezeAgentToolRegistration);
	const registrationIds = new Set<string>();
	const toolIds = new Set<string>();
	const functionNames = new Set<string>();
	const executorIds = new Set<string>();
	for (const registration of registrations) {
		if (registration.executor.kind !== 'client'
			|| registration.executor.connection !== candidate.connection) {
			throw new Error(`Tool registration '${registration.id}' does not address its publishing client`);
		}
		if (registrationIds.has(registration.id)
			|| toolIds.has(registration.descriptor.id)
			|| functionNames.has(registration.descriptor.functionName)
			|| executorIds.has(registration.executor.executor)) {
			throw new Error('Client Tool publication contains duplicate canonical identity');
		}
		registrationIds.add(registration.id);
		toolIds.add(registration.descriptor.id);
		functionNames.add(registration.descriptor.functionName);
		executorIds.add(registration.executor.executor);
	}
	return Object.freeze({
		connection: candidate.connection,
		revision: candidate.revision,
		registrations: Object.freeze(registrations),
	});
}

/** Strictly validates one canonical Tool executor reference. */
export function assertAgentToolExecutorReference(reference: AgentToolExecutorReference): void {
	switch (reference.kind) {
		case 'client':
			if (!hasExactKeys(reference, ['kind', 'connection', 'executor'])) {
				throw new Error('Invalid client Tool executor fields');
			}
			createAgentHostClientConnectionId(reference.connection);
			createAgentToolExecutorId(reference.executor);
			return;
		case 'host':
			if (!hasExactKeys(reference, ['kind', 'executor'])) {
				throw new Error('Invalid Host Tool executor fields');
			}
			createAgentToolExecutorId(reference.executor);
			return;
		case 'agent':
			if (!hasExactKeys(reference, ['kind', 'agent', 'registration', 'executor'])) {
				throw new Error('Invalid Agent Tool executor fields');
			}
			createAgentId(reference.agent);
			createAgentRuntimeRegistrationRevision(reference.registration);
			createAgentToolExecutorId(reference.executor);
			return;
		case 'mcp':
			if (!hasExactKeys(reference, ['kind', 'server', 'tool']) || reference.tool.length === 0 || reference.tool.length > 256) {
				throw new Error('Invalid MCP Tool executor fields');
			}
			createAgentMcpServerId(reference.server);
			return;
		default:
			throw new Error('Unknown Tool executor kind');
	}
}

export interface IAgentToolSet {
	readonly revision: AgentToolSetRevision;
	readonly schemaProfile: AgentToolSchemaProfileId;
	readonly runtimeRegistration: AgentRuntimeRegistrationRevision;
	readonly agentDescriptor: AgentDescriptorRevision;
	readonly modelDescriptor: AgentModelDescriptorRevision;
	readonly registrations: readonly IAgentToolRegistration[];
}

export type AgentToolCallEffect =
	| { readonly kind: 'read' }
	| {
		readonly kind: 'mutation';
		readonly operation: AgentHostOperationId;
		readonly payloadDigest: AgentHostPayloadDigest;
	};

export interface IAgentToolCall {
	readonly id: AgentToolCallId;
	readonly agent: AgentId;
	readonly registration: AgentRuntimeRegistrationRevision;
	readonly session: AgentSessionId;
	readonly chat: AgentChatId;
	readonly turn: AgentTurnId;
	readonly toolSet: AgentToolSetRevision;
	readonly tool: AgentToolId;
	readonly descriptor: AgentToolDescriptorRevision;
	readonly registrationId: AgentToolRegistrationId;
	readonly registrationRevision: AgentToolRegistrationRevision;
	readonly input: AgentHostProtocolValue;
	readonly target?: AgentInteractionTargetId;
	readonly effect: AgentToolCallEffect;
	readonly deadline: number;
}

export interface IAgentClientToolInvocation {
	readonly call: IAgentToolCall;
	readonly target?: IAgentHostInteractionTarget;
}

/** Strictly validates the transport shape and identities of one canonical Tool call. */
export function assertAgentToolCall(call: unknown): asserts call is IAgentToolCall {
	if (call === null || typeof call !== 'object' || Array.isArray(call)
		|| !hasExactKeys(call, [
			'id', 'agent', 'registration', 'session', 'chat', 'turn', 'toolSet', 'tool',
			'descriptor', 'registrationId', 'registrationRevision', 'input', 'effect', 'deadline',
		], ['target'])) {
		throw new Error('Invalid canonical Tool call fields');
	}
	const candidate = call as IAgentToolCall;
	assertAgentHostProtocolValue(candidate);
	createAgentToolCallId(candidate.id);
	createAgentId(candidate.agent);
	createAgentRuntimeRegistrationRevision(candidate.registration);
	createAgentSessionId(candidate.session);
	createAgentChatId(candidate.chat);
	createAgentTurnId(candidate.turn);
	createAgentToolSetRevision(candidate.toolSet);
	createAgentToolId(candidate.tool);
	createAgentToolDescriptorRevision(candidate.descriptor);
	createAgentToolRegistrationId(candidate.registrationId);
	createAgentToolRegistrationRevision(candidate.registrationRevision);
	if (candidate.target !== undefined) {
		createAgentInteractionTargetId(candidate.target);
	}
	if (!Number.isSafeInteger(candidate.deadline) || candidate.deadline <= 0) {
		throw new Error('Invalid canonical Tool call deadline');
	}
	if (candidate.effect.kind === 'read') {
		if (!hasExactKeys(candidate.effect, ['kind'])) {
			throw new Error('Invalid canonical read Tool effect');
		}
	} else if (candidate.effect.kind === 'mutation') {
		if (!hasExactKeys(candidate.effect, ['kind', 'operation', 'payloadDigest'])) {
			throw new Error('Invalid canonical mutation Tool effect');
		}
		createAgentHostOperationId(candidate.effect.operation);
		createAgentHostPayloadDigest(candidate.effect.payloadDigest);
	} else {
		throw new Error('Unknown canonical Tool call effect');
	}
}

/** Strictly validates the exact accepted call and target sent to a connected client executor. */
export function assertAgentClientToolInvocation(
	invocation: unknown,
): asserts invocation is IAgentClientToolInvocation {
	if (invocation === null || typeof invocation !== 'object' || Array.isArray(invocation)
		|| !hasExactKeys(invocation, ['call'], ['target'])) {
		throw new Error('Invalid client Tool invocation fields');
	}
	const candidate = invocation as IAgentClientToolInvocation;
	assertAgentHostProtocolValue(candidate);
	assertAgentToolCall(candidate.call);
	if (candidate.target !== undefined) {
		assertAgentHostInteractionTarget(candidate.target);
	}
	if ((candidate.call.target === undefined) !== (candidate.target === undefined)
		|| (candidate.target !== undefined && candidate.target.id !== candidate.call.target)) {
		throw new Error('Client Tool invocation target does not match its call');
	}
}

export type AgentToolMutationPayload = Omit<IAgentToolCall, 'effect'> & {
	readonly effect: {
		readonly kind: 'mutation';
		readonly operation: AgentHostOperationId;
	};
};

export interface IAgentToolProgress {
	readonly call: AgentToolCallId;
	readonly sequence: number;
	readonly data: AgentHostProtocolValue;
}

/** Strictly validates one canonical Tool progress value. */
export function assertAgentToolProgress(progress: unknown): asserts progress is IAgentToolProgress {
	if (progress === null || typeof progress !== 'object' || Array.isArray(progress)
		|| !hasExactKeys(progress, ['call', 'sequence', 'data'])) {
		throw new Error('Invalid canonical Tool progress fields');
	}
	const candidate = progress as IAgentToolProgress;
	assertAgentHostProtocolValue(candidate);
	createAgentToolCallId(candidate.call);
	if (!Number.isSafeInteger(candidate.sequence) || candidate.sequence < 1) {
		throw new Error('Invalid canonical Tool progress sequence');
	}
}

export interface IAgentToolFailure {
	readonly code: 'denied' | 'cancelled' | 'timedOut' | 'unavailable' | 'invalidInput' | 'invalidOutput' | 'failed';
	readonly message: string;
	readonly data?: AgentHostProtocolValue;
	readonly reconciliation: 'terminal' | 'sameOperationRequired';
}

export type AgentToolResult =
	| {
		readonly call: AgentToolCallId;
		readonly status: 'completed';
		readonly output: AgentHostProtocolValue;
	}
	| {
		readonly call: AgentToolCallId;
		readonly status: 'denied' | 'cancelled' | 'timedOut' | 'failed';
		readonly failure: IAgentToolFailure;
	};

/** Strictly validates one canonical Tool terminal result. */
export function assertAgentToolResult(result: unknown): asserts result is AgentToolResult {
	assertAgentHostProtocolValue(result);
	if (result === null || typeof result !== 'object' || Array.isArray(result)) {
		throw new Error('Invalid canonical Tool result');
	}
	const candidate = result as AgentToolResult;
	createAgentToolCallId(candidate.call);
	if (candidate.status === 'completed') {
		if (!hasExactKeys(candidate, ['call', 'status', 'output'])) {
			throw new Error('Invalid canonical completed Tool result fields');
		}
		return;
	}
	if (!['denied', 'cancelled', 'timedOut', 'failed'].includes(candidate.status)
		|| !hasExactKeys(candidate, ['call', 'status', 'failure'])
		|| !hasExactKeys(candidate.failure, ['code', 'message', 'reconciliation'], ['data'])
		|| !['denied', 'cancelled', 'timedOut', 'unavailable', 'invalidInput', 'invalidOutput', 'failed'].includes(candidate.failure.code)
		|| candidate.failure.message.length === 0
		|| candidate.failure.message.length > maximumToolFailureMessageLength
		|| !['terminal', 'sameOperationRequired'].includes(candidate.failure.reconciliation)) {
		throw new Error('Invalid canonical failed Tool result fields');
	}
}

export type AgentToolEndpointReconciliation =
	| { readonly kind: 'pending' | 'unknown' }
	| { readonly kind: 'terminal'; readonly result: AgentToolResult };

/** Strictly validates one canonical executor reconciliation value. */
export function assertAgentToolEndpointReconciliation(
	reconciliation: unknown,
): asserts reconciliation is AgentToolEndpointReconciliation {
	assertAgentHostProtocolValue(reconciliation);
	if (reconciliation === null || typeof reconciliation !== 'object' || Array.isArray(reconciliation)) {
		throw new Error('Invalid Tool reconciliation value');
	}
	const candidate = reconciliation as AgentToolEndpointReconciliation;
	if (candidate.kind === 'pending' || candidate.kind === 'unknown') {
		if (!hasExactKeys(candidate, ['kind'])) {
			throw new Error('Invalid pending Tool reconciliation fields');
		}
		return;
	}
	if (candidate.kind !== 'terminal' || !hasExactKeys(candidate, ['kind', 'result'])) {
		throw new Error('Invalid terminal Tool reconciliation fields');
	}
	assertAgentToolResult(candidate.result);
}

/** One semantic endpoint contract shared by client, Host, Agent, and MCP executors. */
export interface IAgentToolExecutorEndpoint {
	execute(
		call: IAgentToolCall,
		target: IAgentHostInteractionTarget | undefined,
		reportProgress: (progress: IAgentToolProgress) => void,
		cancellation: CancellationToken,
	): Promise<AgentToolResult>;
	cancel(call: IAgentToolCall): Promise<void>;
	reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation>;
}

export interface IAgentToolExecutionPort {
	execute(call: IAgentToolCall, reportProgress: (progress: IAgentToolProgress) => void): Promise<AgentToolResult>;
	cancel(call: AgentToolCallId): Promise<void>;
	reconcile(call: IAgentToolCall): Promise<AgentToolEndpointReconciliation>;
	release(call: AgentToolCallId): void;
}

/** Computes the digest bound to one exact mutating Tool call, excluding only the digest itself. */
export async function computeAgentToolMutationPayloadDigest(call: AgentToolMutationPayload): Promise<AgentHostPayloadDigest> {
	return computeAgentHostPayloadDigest({
		call: call.id,
		agent: call.agent,
		registration: call.registration,
		session: call.session,
		chat: call.chat,
		turn: call.turn,
		toolSet: call.toolSet,
		tool: call.tool,
		descriptor: call.descriptor,
		registrationId: call.registrationId,
		registrationRevision: call.registrationRevision,
		input: call.input,
		...(call.target === undefined ? {} : { target: call.target }),
		effect: Object.freeze({ kind: 'mutation', operation: call.effect.operation }),
		deadline: call.deadline,
	});
}
