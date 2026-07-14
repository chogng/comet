/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostError, AgentHostErrorCode } from './errors.js';
import {
	AgentConfigurationPropertyId,
	AgentConfigurationSchemaRevision,
	AgentConfigurationStateRevision,
	AgentId,
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentId,
} from './identities.js';
import {
	AgentHostProtocolValue,
	assertAgentHostProtocolValue,
	encodeAgentHostProtocolValue,
} from './protocolValues.js';
import type { IAgentCredentialReference } from './credentials.js';

export const AgentConfigurationSchemaProfile = 'agent.configuration.v1' as const;

export type AgentConfigurationScope = 'hostDefault' | 'session' | 'model';

export type AgentConfigurationOwner =
	| { readonly kind: 'platform' }
	| { readonly kind: 'agent'; readonly agent: AgentId };

export interface IAgentConfigurationDisplayMetadata {
	readonly label: string;
	readonly description?: string;
}

export interface IAgentConfigurationBooleanValueSchema {
	readonly type: 'boolean';
}

export interface IAgentConfigurationNumberValueSchema {
	readonly type: 'number';
	readonly integer: boolean;
	readonly minimum?: number;
	readonly maximum?: number;
}

export interface IAgentConfigurationStringValueSchema {
	readonly type: 'string';
	readonly minimumLength?: number;
	readonly maximumLength?: number;
	readonly enum?: readonly string[];
}

export interface IAgentConfigurationArrayValueSchema {
	readonly type: 'array';
	readonly items: AgentConfigurationValueSchema;
	readonly minimumItems?: number;
	readonly maximumItems?: number;
	readonly uniqueItems: boolean;
}

export interface IAgentConfigurationObjectPropertySchema {
	readonly name: string;
	readonly required: boolean;
	readonly value: AgentConfigurationValueSchema;
}

export interface IAgentConfigurationObjectValueSchema {
	readonly type: 'object';
	readonly properties: readonly IAgentConfigurationObjectPropertySchema[];
}

export interface IAgentConfigurationCredentialReferenceValueSchema {
	readonly type: 'credentialReference';
	readonly providers: readonly string[];
	readonly scopes: readonly string[];
	readonly references: readonly string[];
}

export type AgentConfigurationValueSchema =
	| IAgentConfigurationBooleanValueSchema
	| IAgentConfigurationNumberValueSchema
	| IAgentConfigurationStringValueSchema
	| IAgentConfigurationArrayValueSchema
	| IAgentConfigurationObjectValueSchema
	| IAgentConfigurationCredentialReferenceValueSchema;

export interface IAgentConfigurationPropertySchema {
	readonly id: AgentConfigurationPropertyId;
	readonly owner: AgentConfigurationOwner;
	readonly scopes: readonly AgentConfigurationScope[];
	readonly value: AgentConfigurationValueSchema;
	readonly required: boolean;
	readonly default?: AgentHostProtocolValue;
	readonly sessionMutable: boolean;
	readonly dynamicCompletion: boolean;
	readonly display: IAgentConfigurationDisplayMetadata;
	readonly persistence: 'persisted';
	readonly redaction: 'public' | 'credentialReference';
}

export interface IAgentConfigurationSchema {
	readonly profile: typeof AgentConfigurationSchemaProfile;
	readonly agent: AgentId;
	readonly scope: AgentConfigurationScope;
	readonly revision: AgentConfigurationSchemaRevision;
	readonly properties: readonly IAgentConfigurationPropertySchema[];
}

export type AgentConfigurationValues = Readonly<Record<string, AgentHostProtocolValue>>;

export interface IAgentConfigurationCredentialReferenceBinding {
	readonly property: AgentConfigurationPropertyId;
	readonly credential: IAgentCredentialReference;
}

export interface IAgentConfigurationCandidate {
	readonly schema: AgentConfigurationSchemaRevision;
	readonly values: AgentConfigurationValues;
}

export interface IAgentConfigurationState {
	readonly schema: IAgentConfigurationSchema;
	readonly revision: AgentConfigurationStateRevision;
	readonly values: AgentConfigurationValues;
}

export interface IAgentConfigurationCompletion {
	readonly label: string;
	readonly description?: string;
	readonly value: AgentHostProtocolValue;
}

export interface IAgentConfigurationSchemaExpectation {
	readonly agent: AgentId;
	readonly scope: AgentConfigurationScope;
	readonly revision?: AgentConfigurationSchemaRevision;
}

const maximumProperties = 256;
const maximumNestedProperties = 128;
const maximumSchemaNodes = 1_024;
const maximumSchemaDepth = 16;
const maximumEnumValues = 256;
const maximumCompletions = 100;
const maximumArrayItems = 4_096;
const maximumConfigurationStringLength = 64 * 1024;
const maximumLabelLength = 512;
const maximumDescriptionLength = 2_048;
const nestedPropertyNamePattern = /^[a-z][A-Za-z0-9_-]*$/;

type ProtocolRecord = Readonly<Record<string, AgentHostProtocolValue>>;

function invalidSchema(field: string, reason: string): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidConfigurationSchema,
		'Invalid Agent configuration schema',
		{ field, reason },
	);
}

function invalidValue(property: string, reason: string): never {
	throw new AgentHostError(
		AgentHostErrorCode.InvalidConfigurationValue,
		'Invalid Agent configuration value',
		{ property, reason },
	);
}

function staleSchema(expected: AgentConfigurationSchemaRevision, received: AgentConfigurationSchemaRevision): never {
	throw new AgentHostError(
		AgentHostErrorCode.StaleConfigurationSchema,
		'Stale Agent configuration schema revision',
		{ expected, received },
	);
}

function asRecord(value: AgentHostProtocolValue, field: string): ProtocolRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidSchema(field, 'expectedObject');
	}
	return value as ProtocolRecord;
}

function asValueRecord(value: AgentHostProtocolValue, property: string): ProtocolRecord {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return invalidValue(property, 'expectedObject');
	}
	return value as ProtocolRecord;
}

function assertExactKeys(
	record: ProtocolRecord,
	required: readonly string[],
	optional: readonly string[],
	field: string,
): void {
	const allowed = new Set([...required, ...optional]);
	if (Object.keys(record).some(key => !allowed.has(key))) {
		invalidSchema(field, 'unknownField');
	}
	if (required.some(key => !Object.hasOwn(record, key))) {
		invalidSchema(field, 'missingField');
	}
}

function assertExactValueKeys(
	record: ProtocolRecord,
	required: readonly string[],
	optional: readonly string[],
	property: string,
): void {
	const allowed = new Set([...required, ...optional]);
	if (Object.keys(record).some(key => !allowed.has(key))) {
		invalidValue(property, 'unknownField');
	}
	if (required.some(key => !Object.hasOwn(record, key))) {
		invalidValue(property, 'missingField');
	}
}

function requireString(value: AgentHostProtocolValue | undefined, field: string, maximumLength = 512): string {
	if (typeof value !== 'string' || value.length === 0 || value.length > maximumLength) {
		return invalidSchema(field, 'invalidString');
	}
	return value;
}

function requireBoolean(value: AgentHostProtocolValue | undefined, field: string): boolean {
	if (typeof value !== 'boolean') {
		return invalidSchema(field, 'invalidBoolean');
	}
	return value;
}

function requireNonNegativeInteger(value: AgentHostProtocolValue | undefined, field: string, maximum: number): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > maximum) {
		return invalidSchema(field, 'invalidInteger');
	}
	return value;
}

function optionalFiniteNumber(value: AgentHostProtocolValue | undefined, field: string): number | undefined {
	if (value === undefined) {
		return undefined;
	}
	if (typeof value !== 'number' || !Number.isFinite(value)) {
		return invalidSchema(field, 'invalidNumber');
	}
	return value;
}

function cloneProtocolValue(value: AgentHostProtocolValue): AgentHostProtocolValue {
	if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
		return value;
	}
	if (Array.isArray(value)) {
		return Object.freeze(value.map(cloneProtocolValue));
	}
	return Object.freeze(Object.fromEntries(
		Object.entries(value).map(([key, item]) => [key, cloneProtocolValue(item)]),
	));
}

function validateOwner(value: AgentHostProtocolValue, agent: AgentId, field: string): AgentConfigurationOwner {
	const owner = asRecord(value, field);
	const kind = requireString(owner.kind, `${field}.kind`, 16);
	if (kind === 'platform') {
		assertExactKeys(owner, ['kind'], [], field);
		return Object.freeze({ kind: 'platform' });
	}
	if (kind === 'agent') {
		assertExactKeys(owner, ['kind', 'agent'], [], field);
		const ownerAgent = createAgentId(requireString(owner.agent, `${field}.agent`, 128));
		if (ownerAgent !== agent) {
			return invalidSchema(field, 'foreignAgentOwner');
		}
		return Object.freeze({ kind: 'agent', agent: ownerAgent });
	}
	return invalidSchema(field, 'invalidOwner');
}

function validateDisplay(value: AgentHostProtocolValue, field: string): IAgentConfigurationDisplayMetadata {
	const display = asRecord(value, field);
	assertExactKeys(display, ['label'], ['description'], field);
	const label = requireString(display.label, `${field}.label`, maximumLabelLength);
	const description = display.description === undefined
		? undefined
		: requireString(display.description, `${field}.description`, maximumDescriptionLength);
	return Object.freeze({ label, ...(description === undefined ? {} : { description }) });
}

interface ISchemaValidationContext {
	nodes: number;
}

function validateValueSchema(
	value: AgentHostProtocolValue,
	field: string,
	depth: number,
	context: ISchemaValidationContext,
): AgentConfigurationValueSchema {
	context.nodes += 1;
	if (depth > maximumSchemaDepth || context.nodes > maximumSchemaNodes) {
		return invalidSchema(field, 'schemaBoundsExceeded');
	}
	const schema = asRecord(value, field);
	const type = requireString(schema.type, `${field}.type`, 32);
	switch (type) {
		case 'boolean':
			assertExactKeys(schema, ['type'], [], field);
			return Object.freeze({ type });
		case 'number': {
			assertExactKeys(schema, ['type', 'integer'], ['minimum', 'maximum'], field);
			const integer = requireBoolean(schema.integer, `${field}.integer`);
			const minimum = optionalFiniteNumber(schema.minimum, `${field}.minimum`);
			const maximum = optionalFiniteNumber(schema.maximum, `${field}.maximum`);
			if (minimum !== undefined && maximum !== undefined && minimum > maximum) {
				return invalidSchema(field, 'invalidRange');
			}
			return Object.freeze({
				type,
				integer,
				...(minimum === undefined ? {} : { minimum }),
				...(maximum === undefined ? {} : { maximum }),
			});
		}
		case 'string': {
			assertExactKeys(schema, ['type'], ['minimumLength', 'maximumLength', 'enum'], field);
			const minimumLength = schema.minimumLength === undefined
				? undefined
				: requireNonNegativeInteger(schema.minimumLength, `${field}.minimumLength`, maximumConfigurationStringLength);
			const maximumLength = schema.maximumLength === undefined
				? undefined
				: requireNonNegativeInteger(schema.maximumLength, `${field}.maximumLength`, maximumConfigurationStringLength);
			if (minimumLength !== undefined && maximumLength !== undefined && minimumLength > maximumLength) {
				return invalidSchema(field, 'invalidLengthRange');
			}
			let enumeration: readonly string[] | undefined;
			if (schema.enum !== undefined) {
				if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > maximumEnumValues) {
					return invalidSchema(`${field}.enum`, 'invalidEnum');
				}
				enumeration = Object.freeze(schema.enum.map((item, index) => (
					requireString(item, `${field}.enum.${index}`, maximumConfigurationStringLength)
				)));
				if (new Set(enumeration).size !== enumeration.length) {
					return invalidSchema(`${field}.enum`, 'duplicateEnumValue');
				}
			}
			return Object.freeze({
				type,
				...(minimumLength === undefined ? {} : { minimumLength }),
				...(maximumLength === undefined ? {} : { maximumLength }),
				...(enumeration === undefined ? {} : { enum: enumeration }),
			});
		}
		case 'array': {
			assertExactKeys(schema, ['type', 'items', 'uniqueItems'], ['minimumItems', 'maximumItems'], field);
			const minimumItems = schema.minimumItems === undefined
				? undefined
				: requireNonNegativeInteger(schema.minimumItems, `${field}.minimumItems`, maximumArrayItems);
			const maximumItems = schema.maximumItems === undefined
				? undefined
				: requireNonNegativeInteger(schema.maximumItems, `${field}.maximumItems`, maximumArrayItems);
			if (minimumItems !== undefined && maximumItems !== undefined && minimumItems > maximumItems) {
				return invalidSchema(field, 'invalidItemRange');
			}
			return Object.freeze({
				type,
				items: validateValueSchema(schema.items!, `${field}.items`, depth + 1, context),
				uniqueItems: requireBoolean(schema.uniqueItems, `${field}.uniqueItems`),
				...(minimumItems === undefined ? {} : { minimumItems }),
				...(maximumItems === undefined ? {} : { maximumItems }),
			});
		}
		case 'object': {
			assertExactKeys(schema, ['type', 'properties'], [], field);
			if (!Array.isArray(schema.properties) || schema.properties.length > maximumNestedProperties) {
				return invalidSchema(`${field}.properties`, 'invalidProperties');
			}
			const names = new Set<string>();
			const properties = schema.properties.map((item, index) => {
				const propertyField = `${field}.properties.${index}`;
				const property = asRecord(item, propertyField);
				assertExactKeys(property, ['name', 'required', 'value'], [], propertyField);
				const name = requireString(property.name, `${propertyField}.name`, 128);
				if (!nestedPropertyNamePattern.test(name) || names.has(name)) {
					return invalidSchema(`${propertyField}.name`, 'invalidPropertyName');
				}
				names.add(name);
				return Object.freeze({
					name,
					required: requireBoolean(property.required, `${propertyField}.required`),
					value: validateValueSchema(property.value!, `${propertyField}.value`, depth + 1, context),
				});
			});
			return Object.freeze({ type, properties: Object.freeze(properties) });
		}
		case 'credentialReference': {
			assertExactKeys(schema, ['type', 'providers', 'scopes', 'references'], [], field);
			const providers = validateStringSet(schema.providers, `${field}.providers`, 128);
			const scopes = validateStringSet(schema.scopes, `${field}.scopes`, 128);
			const references = validateStringSet(schema.references, `${field}.references`, 512);
			if (providers.length === 0 || scopes.length === 0 || references.length === 0) {
				return invalidSchema(field, 'emptyCredentialAuthority');
			}
			return Object.freeze({ type, providers, scopes, references });
		}
	}
	return invalidSchema(`${field}.type`, 'unsupportedType');
}

function validateStringSet(value: AgentHostProtocolValue | undefined, field: string, maximumLength: number): readonly string[] {
	if (!Array.isArray(value) || value.length > maximumEnumValues) {
		return invalidSchema(field, 'invalidStringSet');
	}
	const result = value.map((item, index) => requireString(item, `${field}.${index}`, maximumLength));
	if (new Set(result).size !== result.length) {
		return invalidSchema(field, 'duplicateString');
	}
	return Object.freeze(result);
}

function validateScopes(value: AgentHostProtocolValue, field: string): readonly AgentConfigurationScope[] {
	if (!Array.isArray(value) || value.length === 0 || value.length > 3) {
		return invalidSchema(field, 'invalidScopes');
	}
	const scopes = value.map((item, index) => {
		if (item !== 'hostDefault' && item !== 'session' && item !== 'model') {
			return invalidSchema(`${field}.${index}`, 'invalidScope');
		}
		return item;
	});
	if (new Set(scopes).size !== scopes.length) {
		return invalidSchema(field, 'duplicateScope');
	}
	return Object.freeze(scopes);
}

function validateProperty(
	value: AgentHostProtocolValue,
	agent: AgentId,
	schemaScope: AgentConfigurationScope,
	field: string,
	context: ISchemaValidationContext,
): IAgentConfigurationPropertySchema {
	const property = asRecord(value, field);
	assertExactKeys(property, [
		'id', 'owner', 'scopes', 'value', 'required', 'sessionMutable', 'dynamicCompletion',
		'display', 'persistence', 'redaction',
	], ['default'], field);
	const id = createAgentConfigurationPropertyId(requireString(property.id, `${field}.id`, 128));
	const owner = validateOwner(property.owner!, agent, `${field}.owner`);
	if (
		(owner.kind === 'platform' && !id.startsWith('platform.'))
		|| (owner.kind === 'agent' && !id.startsWith(`${agent}.`))
	) {
		return invalidSchema(`${field}.id`, 'ownerNamespaceMismatch');
	}
	const scopes = validateScopes(property.scopes!, `${field}.scopes`);
	if (!scopes.includes(schemaScope)) {
		return invalidSchema(`${field}.scopes`, 'schemaScopeMissing');
	}
	const valueSchema = validateValueSchema(property.value!, `${field}.value`, 0, context);
	const required = requireBoolean(property.required, `${field}.required`);
	const sessionMutable = requireBoolean(property.sessionMutable, `${field}.sessionMutable`);
	if (sessionMutable && !scopes.includes('session')) {
		return invalidSchema(`${field}.sessionMutable`, 'sessionScopeMissing');
	}
	const dynamicCompletion = requireBoolean(property.dynamicCompletion, `${field}.dynamicCompletion`);
	if (dynamicCompletion && valueSchema.type !== 'string') {
		return invalidSchema(`${field}.dynamicCompletion`, 'completionRequiresString');
	}
	if (property.persistence !== 'persisted') {
		return invalidSchema(`${field}.persistence`, 'unsupportedPersistence');
	}
	if (property.redaction !== 'public' && property.redaction !== 'credentialReference') {
		return invalidSchema(`${field}.redaction`, 'unsupportedRedaction');
	}
	if (
		(valueSchema.type === 'credentialReference' && property.redaction !== 'credentialReference')
		|| (valueSchema.type !== 'credentialReference' && property.redaction !== 'public')
	) {
		return invalidSchema(`${field}.redaction`, 'valueRedactionMismatch');
	}
	const defaultValue = property.default === undefined
		? undefined
		: validateValue(valueSchema, property.default, id);
	return Object.freeze({
		id,
		owner,
		scopes,
		value: valueSchema,
		required,
		...(defaultValue === undefined ? {} : { default: defaultValue }),
		sessionMutable,
		dynamicCompletion,
		display: validateDisplay(property.display!, `${field}.display`),
		persistence: 'persisted',
		redaction: property.redaction,
	});
}

function validateValue(
	schema: AgentConfigurationValueSchema,
	value: AgentHostProtocolValue,
	property: string,
): AgentHostProtocolValue {
	switch (schema.type) {
		case 'boolean':
			if (typeof value !== 'boolean') {
				return invalidValue(property, 'expectedBoolean');
			}
			return value;
		case 'number':
			if (
				typeof value !== 'number'
				|| !Number.isFinite(value)
				|| (schema.integer && !Number.isSafeInteger(value))
				|| (schema.minimum !== undefined && value < schema.minimum)
				|| (schema.maximum !== undefined && value > schema.maximum)
			) {
				return invalidValue(property, 'invalidNumber');
			}
			return value;
		case 'string':
			if (
				typeof value !== 'string'
				|| value.length > maximumConfigurationStringLength
				|| (schema.minimumLength !== undefined && value.length < schema.minimumLength)
				|| (schema.maximumLength !== undefined && value.length > schema.maximumLength)
				|| (schema.enum !== undefined && !schema.enum.includes(value))
			) {
				return invalidValue(property, 'invalidString');
			}
			return value;
		case 'array': {
			if (
				!Array.isArray(value)
				|| value.length > maximumArrayItems
				|| (schema.minimumItems !== undefined && value.length < schema.minimumItems)
				|| (schema.maximumItems !== undefined && value.length > schema.maximumItems)
			) {
				return invalidValue(property, 'invalidArray');
			}
			const result = value.map((item, index) => validateValue(schema.items, item, `${property}.${index}`));
			if (schema.uniqueItems) {
				const encoded = result.map(item => encodeAgentHostProtocolValue(item));
				if (new Set(encoded).size !== encoded.length) {
					return invalidValue(property, 'duplicateArrayItem');
				}
			}
			return Object.freeze(result);
		}
		case 'object': {
			const record = asValueRecord(value, property);
			const properties = new Map(schema.properties.map(candidate => [candidate.name, candidate]));
			if (Object.keys(record).some(key => !properties.has(key))) {
				return invalidValue(property, 'unknownObjectProperty');
			}
			const result: Record<string, AgentHostProtocolValue> = {};
			for (const child of schema.properties) {
				const childValue = record[child.name];
				if (childValue === undefined) {
					if (child.required) {
						return invalidValue(`${property}.${child.name}`, 'required');
					}
					continue;
				}
				result[child.name] = validateValue(child.value, childValue, `${property}.${child.name}`);
			}
			return Object.freeze(result);
		}
		case 'credentialReference': {
			const reference = asValueRecord(value, property);
			if (
				Object.keys(reference).length !== 3
				|| typeof reference.provider !== 'string'
				|| typeof reference.scope !== 'string'
				|| typeof reference.reference !== 'string'
				|| reference.reference.length === 0
				|| reference.reference.length > 512
				|| !schema.providers.includes(reference.provider)
				|| !schema.scopes.includes(reference.scope)
				|| !schema.references.includes(reference.reference)
			) {
				return invalidValue(property, 'invalidCredentialReference');
			}
			return Object.freeze({
				provider: reference.provider,
				scope: reference.scope,
				reference: reference.reference,
			});
		}
	}
}

function validateLayer(
	schema: IAgentConfigurationSchema,
	values: AgentConfigurationValues,
	scope: AgentConfigurationScope,
	requireComplete: boolean,
): AgentConfigurationValues {
	assertAgentHostProtocolValue(values);
	const properties = new Map(schema.properties.map(property => [property.id, property]));
	for (const key of Object.keys(values)) {
		const property = properties.get(key as AgentConfigurationPropertyId);
		if (property === undefined) {
			return invalidValue(key, 'unknownProperty');
		}
		if (!property.scopes.includes(scope)) {
			return invalidValue(key, 'invalidScope');
		}
	}
	const result: Record<string, AgentHostProtocolValue> = {};
	for (const property of schema.properties) {
		const value = values[property.id];
		if (value === undefined) {
			if (requireComplete && property.scopes.includes(scope) && property.required) {
				return invalidValue(property.id, 'required');
			}
			continue;
		}
		result[property.id] = validateValue(property.value, value, property.id);
	}
	return Object.freeze(result);
}

export function validateAndFreezeAgentConfigurationSchema(
	value: unknown,
	expectation?: IAgentConfigurationSchemaExpectation,
): IAgentConfigurationSchema {
	assertAgentHostProtocolValue(value);
	const schema = asRecord(value, 'configurationSchema');
	assertExactKeys(schema, ['profile', 'agent', 'scope', 'revision', 'properties'], [], 'configurationSchema');
	if (schema.profile !== AgentConfigurationSchemaProfile) {
		return invalidSchema('configurationSchema.profile', 'unsupportedProfile');
	}
	const agent = createAgentId(requireString(schema.agent, 'configurationSchema.agent', 128));
	if (schema.scope !== 'hostDefault' && schema.scope !== 'session' && schema.scope !== 'model') {
		return invalidSchema('configurationSchema.scope', 'invalidScope');
	}
	const scope = schema.scope;
	const revision = createAgentConfigurationSchemaRevision(requireString(schema.revision, 'configurationSchema.revision', 128));
	if (!Array.isArray(schema.properties) || schema.properties.length > maximumProperties) {
		return invalidSchema('configurationSchema.properties', 'invalidProperties');
	}
	const context: ISchemaValidationContext = { nodes: 0 };
	const properties = schema.properties.map((property, index) => (
		validateProperty(property, agent, scope, `configurationSchema.properties.${index}`, context)
	));
	if (new Set(properties.map(property => property.id)).size !== properties.length) {
		return invalidSchema('configurationSchema.properties', 'duplicateProperty');
	}
	if (
		expectation !== undefined
		&& (
			expectation.agent !== agent
			|| expectation.scope !== scope
			|| (expectation.revision !== undefined && expectation.revision !== revision)
		)
	) {
		return invalidSchema('configurationSchema', 'expectationMismatch');
	}
	return Object.freeze({
		profile: AgentConfigurationSchemaProfile,
		agent,
		scope,
		revision,
		properties: Object.freeze(properties),
	});
}

export function validateAndFreezeAgentConfigurationCandidate(
	schema: IAgentConfigurationSchema,
	candidate: IAgentConfigurationCandidate,
	scope: AgentConfigurationScope,
	requireComplete = false,
): IAgentConfigurationCandidate {
	assertAgentHostProtocolValue(candidate);
	const record = asValueRecord(candidate, 'configurationCandidate');
	assertExactValueKeys(record, ['schema', 'values'], [], 'configurationCandidate');
	if (typeof record.schema !== 'string') {
		return invalidValue('configurationCandidate.schema', 'invalidRevision');
	}
	const revision = createAgentConfigurationSchemaRevision(record.schema);
	if (revision !== schema.revision) {
		return staleSchema(schema.revision, revision);
	}
	const values = asValueRecord(record.values!, 'configurationCandidate.values');
	return Object.freeze({
		schema: revision,
		values: validateLayer(schema, values, scope, requireComplete),
	});
}

export function validateAndFreezeAgentConfigurationState(
	state: IAgentConfigurationState,
	expectation?: IAgentConfigurationSchemaExpectation,
): IAgentConfigurationState {
	assertAgentHostProtocolValue(state);
	const record = asValueRecord(state, 'configurationState');
	assertExactValueKeys(record, ['schema', 'revision', 'values'], [], 'configurationState');
	const schema = validateAndFreezeAgentConfigurationSchema(record.schema, expectation);
	if (typeof record.revision !== 'string') {
		return invalidValue('configurationState.revision', 'invalidRevision');
	}
	const revision = createAgentConfigurationStateRevision(record.revision);
	const values = validateLayer(
		schema,
		asValueRecord(record.values!, 'configurationState.values'),
		schema.scope,
		schema.scope !== 'hostDefault',
	);
	return Object.freeze({ schema, revision, values });
}

export function resolveAgentSessionConfigurationValues(
	schema: IAgentConfigurationSchema,
	hostDefaults: AgentConfigurationValues,
	candidate: AgentConfigurationValues,
): AgentConfigurationValues {
	if (schema.scope !== 'session') {
		return invalidSchema('configurationSchema.scope', 'sessionSchemaRequired');
	}
	const validatedHostDefaults = validateLayer(schema, hostDefaults, 'hostDefault', false);
	const validatedCandidate = validateLayer(schema, candidate, 'session', false);
	const resolved: Record<string, AgentHostProtocolValue> = {};
	for (const property of schema.properties) {
		const candidateValue = validatedCandidate[property.id];
		const hostValue = validatedHostDefaults[property.id];
		if (candidateValue !== undefined) {
			resolved[property.id] = candidateValue;
		} else if (hostValue !== undefined) {
			resolved[property.id] = hostValue;
		} else if (property.default !== undefined) {
			resolved[property.id] = cloneProtocolValue(property.default);
		} else if (property.required) {
			return invalidValue(property.id, 'required');
		}
	}
	return Object.freeze(resolved);
}

/** Materializes one complete model candidate from its exact candidate values and declared defaults. */
export function resolveAgentModelConfigurationCandidate(
	schema: IAgentConfigurationSchema,
	candidate: IAgentConfigurationCandidate,
): IAgentConfigurationCandidate {
	if (schema.scope !== 'model') {
		return invalidSchema('configurationSchema.scope', 'modelSchemaRequired');
	}
	const validated = validateAndFreezeAgentConfigurationCandidate(schema, candidate, 'model');
	const values: Record<string, AgentHostProtocolValue> = {};
	for (const property of schema.properties) {
		const value = validated.values[property.id] ?? property.default;
		if (value === undefined) {
			if (property.required) {
				return invalidValue(property.id, 'required');
			}
			continue;
		}
		values[property.id] = value;
	}
	return validateAndFreezeAgentConfigurationCandidate(
		schema,
		Object.freeze({ schema: schema.revision, values: Object.freeze(values) }),
		'model',
		true,
	);
}

/** Collects only schema-declared credential references from one validated configuration layer. */
export function collectAgentConfigurationCredentialReferences(
	schema: IAgentConfigurationSchema,
	values: AgentConfigurationValues,
	scope: AgentConfigurationScope,
): readonly IAgentConfigurationCredentialReferenceBinding[] {
	const validated = validateLayer(schema, values, scope, false);
	const bindings: IAgentConfigurationCredentialReferenceBinding[] = [];
	for (const property of schema.properties) {
		if (property.value.type !== 'credentialReference') {
			continue;
		}
		const value = validated[property.id];
		if (value === undefined) {
			continue;
		}
		const credential = value as unknown as IAgentCredentialReference;
		bindings.push(Object.freeze({ property: property.id, credential }));
	}
	return Object.freeze(bindings);
}

export function validateAndFreezeAgentConfigurationCompletions(
	schema: IAgentConfigurationSchema,
	propertyId: AgentConfigurationPropertyId,
	completions: readonly IAgentConfigurationCompletion[],
): readonly IAgentConfigurationCompletion[] {
	createAgentConfigurationPropertyId(propertyId);
	const property = schema.properties.find(candidate => candidate.id === propertyId);
	if (property === undefined || !property.dynamicCompletion) {
		return invalidValue(propertyId, 'dynamicCompletionUnsupported');
	}
	if (!Array.isArray(completions) || completions.length > maximumCompletions) {
		return invalidValue(propertyId, 'completionBoundsExceeded');
	}
	const values = new Set<string>();
	assertAgentHostProtocolValue(completions);
	const result = completions.map((completion, index) => {
		const record = asValueRecord(completion, `configurationCompletion.${index}`);
		assertExactValueKeys(
			record,
			['label', 'value'],
			['description'],
			`configurationCompletion.${index}`,
		);
		if (
			typeof record.label !== 'string'
			|| record.label.length === 0
			|| record.label.length > maximumLabelLength
			|| (record.description !== undefined && (
				typeof record.description !== 'string'
				|| record.description.length === 0
				|| record.description.length > maximumDescriptionLength
			))
		) {
			return invalidValue(propertyId, 'invalidCompletionMetadata');
		}
		const value = validateValue(property.value, record.value!, property.id);
		const encoded = encodeAgentHostProtocolValue(value);
		if (values.has(encoded)) {
			return invalidValue(propertyId, 'duplicateCompletionValue');
		}
		values.add(encoded);
		return Object.freeze({
			label: record.label,
			...(record.description === undefined ? {} : { description: record.description }),
			value,
		});
	});
	return Object.freeze(result);
}
