/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	AgentConfigurationSchemaProfile,
	validateAndFreezeAgentConfigurationCandidate,
	validateAndFreezeAgentConfigurationCompletions,
	validateAndFreezeAgentConfigurationSchema,
	validateAndFreezeAgentConfigurationState,
	resolveAgentSessionConfigurationValues,
} from 'cs/platform/agentHost/common/configuration';
import { AgentHostError, AgentHostErrorCode } from 'cs/platform/agentHost/common/errors';
import {
	createAgentConfigurationPropertyId,
	createAgentConfigurationSchemaRevision,
	createAgentConfigurationStateRevision,
	createAgentId,
} from 'cs/platform/agentHost/common/identities';
import { AgentHostProtocolValue } from 'cs/platform/agentHost/common/protocolValues';

type ProtocolObject = Record<string, AgentHostProtocolValue>;

const agentId = 'sample.agent';
const schemaRevision = 'schema-1';
const temperatureProperty = `${agentId}.temperature`;
const endpointProperty = `${agentId}.endpoint`;
const modeProperty = `${agentId}.mode`;
const optionsProperty = `${agentId}.options`;
const credentialProperty = `${agentId}.credential`;
const localeProperty = 'platform.locale';

function agentProperty(
	id: string,
	value: ProtocolObject,
	overrides: ProtocolObject = {},
): ProtocolObject {
	return {
		id,
		owner: { kind: 'agent', agent: agentId },
		scopes: ['hostDefault', 'session'],
		value,
		required: false,
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: id },
		persistence: 'persisted',
		redaction: 'public',
		...overrides,
	};
}

function platformProperty(
	id: string,
	value: ProtocolObject,
	overrides: ProtocolObject = {},
): ProtocolObject {
	return {
		id,
		owner: { kind: 'platform' },
		scopes: ['hostDefault', 'session'],
		value,
		required: false,
		sessionMutable: true,
		dynamicCompletion: false,
		display: { label: id },
		persistence: 'persisted',
		redaction: 'public',
		...overrides,
	};
}

function createProperties(): ProtocolObject[] {
	return [
		agentProperty(
			temperatureProperty,
			{ type: 'number', integer: false, minimum: 0, maximum: 2 },
			{ required: true, default: 0.5 },
		),
		agentProperty(
			endpointProperty,
			{ type: 'string', minimumLength: 1, maximumLength: 512 },
			{ required: true },
		),
		agentProperty(
			modeProperty,
			{ type: 'string', enum: ['balanced', 'fast'] },
			{ default: 'balanced', dynamicCompletion: true },
		),
		platformProperty(
			localeProperty,
			{ type: 'string', minimumLength: 2, maximumLength: 32 },
			{ default: 'en-US' },
		),
		agentProperty(
			optionsProperty,
			{
				type: 'object',
				properties: [
					{
						name: 'retries',
						required: true,
						value: { type: 'number', integer: true, minimum: 0, maximum: 5 },
					},
					{
						name: 'tags',
						required: false,
						value: {
							type: 'array',
							items: { type: 'string', maximumLength: 32 },
							maximumItems: 2,
							uniqueItems: true,
						},
					},
				],
			},
			{ scopes: ['session'] },
		),
		agentProperty(
			credentialProperty,
			{ type: 'credentialReference', providers: ['vault'], scopes: ['model'], references: ['vault:item-1'] },
			{ redaction: 'credentialReference' },
		),
	];
}

function createSchemaInput(properties: readonly ProtocolObject[] = createProperties()): ProtocolObject {
	return {
		profile: AgentConfigurationSchemaProfile,
		agent: agentId,
		scope: 'session',
		revision: schemaRevision,
		properties,
	};
}

function createSchema() {
	return validateAndFreezeAgentConfigurationSchema(createSchemaInput());
}

function captureAgentHostError(run: () => void, code: string): AgentHostError {
	let received: unknown;
	try {
		run();
	} catch (error) {
		received = error;
	}
	assert.ok(received instanceof AgentHostError);
	assert.equal(received.code, code);
	return received;
}

function assertSecretSafe(error: AgentHostError, ...secrets: readonly string[]): void {
	const diagnostic = `${error.message}\n${JSON.stringify(error.data)}`;
	for (const secret of secrets) {
		assert.equal(diagnostic.includes(secret), false);
	}
}

suite('Agent configuration', { concurrency: false }, () => {
	test('accepts namespaced camel-case SDK configuration property identities', () => {
		assert.equal(createAgentConfigurationPropertyId('copilot.autoApprove'), 'copilot.autoApprove');
		assert.equal(createAgentConfigurationPropertyId('claude.permissionMode'), 'claude.permissionMode');
		assert.equal(createAgentConfigurationPropertyId('codex.modelReasoningEffort'), 'codex.modelReasoningEffort');
	});

	test('clones and freezes schemas, candidates, and states', () => {
		const input = createSchemaInput();
		const schema = validateAndFreezeAgentConfigurationSchema(input);
		assert.notStrictEqual(schema, input);
		assert.ok(Object.isFrozen(schema));
		assert.ok(Object.isFrozen(schema.properties));
		assert.ok(Object.isFrozen(schema.properties[4].value));

		const candidate = validateAndFreezeAgentConfigurationCandidate(
			schema,
			{
				schema: createAgentConfigurationSchemaRevision(schemaRevision),
				values: {
					[temperatureProperty]: 1.25,
					[endpointProperty]: 'candidate-endpoint',
				},
			},
			'session',
		);
		assert.ok(Object.isFrozen(candidate));
		assert.ok(Object.isFrozen(candidate.values));

		const state = validateAndFreezeAgentConfigurationState({
			schema,
			revision: createAgentConfigurationStateRevision('state-1'),
			values: {
				[temperatureProperty]: 1,
				[endpointProperty]: 'state-endpoint',
			},
		});
		assert.ok(Object.isFrozen(state));
		assert.ok(Object.isFrozen(state.schema));
		assert.ok(Object.isFrozen(state.values));
	});

	test('resolves candidate values before Host defaults and declared defaults', () => {
		const resolved = resolveAgentSessionConfigurationValues(
			createSchema(),
			{
				[temperatureProperty]: 0.75,
				[endpointProperty]: 'host-endpoint',
				[modeProperty]: 'fast',
			},
			{
				[temperatureProperty]: 1.25,
				[endpointProperty]: 'candidate-endpoint',
			},
		);

		assert.deepStrictEqual(resolved, {
			[temperatureProperty]: 1.25,
			[endpointProperty]: 'candidate-endpoint',
			[modeProperty]: 'fast',
			[localeProperty]: 'en-US',
		});
		assert.ok(Object.isFrozen(resolved));
	});

	test('rejects missing required values after all declared layers are exhausted', () => {
		const error = captureAgentHostError(
			() => resolveAgentSessionConfigurationValues(createSchema(), {}, {}),
			AgentHostErrorCode.InvalidConfigurationValue,
		);
		assert.deepStrictEqual(error.data, { property: endpointProperty, reason: 'required' });

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationState({
				schema: createSchema(),
				revision: createAgentConfigurationStateRevision('state-2'),
				values: { [temperatureProperty]: 1 },
			}),
			AgentHostErrorCode.InvalidConfigurationValue,
		);
	});

	test('rejects stale candidate schema revisions', () => {
		const error = captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCandidate(
				createSchema(),
				{
					schema: createAgentConfigurationSchemaRevision('schema-0'),
					values: {},
				},
				'session',
			),
			AgentHostErrorCode.StaleConfigurationSchema,
		);
		assert.deepStrictEqual(error.data, { expected: schemaRevision, received: 'schema-0' });
	});

	test('rejects unknown schema, configuration, and nested object fields', () => {
		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema({
				...createSchemaInput(),
				unknown: true,
			}),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCandidate(
				createSchema(),
				{
					schema: createAgentConfigurationSchemaRevision(schemaRevision),
					values: { [`${agentId}.unknown`]: true },
				},
				'session',
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);

		const candidateWithUnknownField = {
			schema: createAgentConfigurationSchemaRevision(schemaRevision),
			values: {},
			unknown: true,
		};
		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCandidate(
				createSchema(),
				candidateWithUnknownField,
				'session',
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);

		const stateWithUnknownField = {
			schema: createSchema(),
			revision: createAgentConfigurationStateRevision('state-with-unknown'),
			values: {
				[temperatureProperty]: 1,
				[endpointProperty]: 'state-endpoint',
			},
			unknown: true,
		};
		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationState(stateWithUnknownField),
			AgentHostErrorCode.InvalidConfigurationValue,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCandidate(
				createSchema(),
				{
					schema: createAgentConfigurationSchemaRevision(schemaRevision),
					values: {
						[optionsProperty]: { retries: 1, unknown: true },
					},
				},
				'session',
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);
	});

	test('does not fall through invalid layers or echo candidate and credential values', () => {
		const candidateSecret = 'candidate-secret-value';
		const candidateError = captureAgentHostError(
			() => resolveAgentSessionConfigurationValues(
				createSchema(),
				{
					[temperatureProperty]: 0.75,
					[endpointProperty]: 'host-endpoint',
				},
				{
					[temperatureProperty]: candidateSecret,
					[endpointProperty]: 'candidate-endpoint',
				},
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);
		assert.deepStrictEqual(candidateError.data, {
			property: temperatureProperty,
			reason: 'invalidNumber',
		});
		assertSecretSafe(candidateError, candidateSecret, 'candidate-endpoint', 'host-endpoint');

		const credentialSecret = 'vault-secret-reference';
		const rawCredentialSecret = 'raw-credential-material';
		const credentialError = captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCandidate(
				createSchema(),
				{
					schema: createAgentConfigurationSchemaRevision(schemaRevision),
					values: {
						[credentialProperty]: {
							provider: 'vault',
							scope: 'model',
							reference: credentialSecret,
							raw: rawCredentialSecret,
						},
					},
				},
				'session',
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);
		assertSecretSafe(credentialError, credentialSecret, rawCredentialSecret);
	});

	test('enforces duplicate, owner namespace, scope, and schema expectation constraints', () => {
		const duplicate = createProperties();
		duplicate.push({ ...duplicate[0] });
		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(createSchemaInput(duplicate)),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(createSchemaInput([
				{
					...agentProperty('platform.invalid', { type: 'boolean' }),
					owner: { kind: 'agent', agent: agentId },
				},
			])),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(createSchemaInput([
				{
					...agentProperty(`${agentId}.foreign`, { type: 'boolean' }),
					owner: { kind: 'agent', agent: 'foreign.agent' },
				},
			])),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(createSchemaInput([
				agentProperty(`${agentId}.host-only`, { type: 'boolean' }, { scopes: ['hostDefault'] }),
			])),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(
				createSchemaInput(),
				{ agent: createAgentId('other.agent'), scope: 'session' },
			),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);
	});

	test('enforces recursive schema, nested object, and array bounds', () => {
		let recursiveValue: AgentHostProtocolValue = { type: 'boolean' };
		for (let depth = 0; depth < 18; depth += 1) {
			recursiveValue = { type: 'array', items: recursiveValue, uniqueItems: false };
		}
		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(createSchemaInput([
				agentProperty(`${agentId}.recursive`, recursiveValue as ProtocolObject),
			])),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		const nestedProperties = Array.from({ length: 129 }, (_, index) => ({
			name: `property${index}`,
			required: false,
			value: { type: 'boolean' },
		}));
		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(createSchemaInput([
				agentProperty(`${agentId}.wide`, { type: 'object', properties: nestedProperties }),
			])),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationSchema(createSchemaInput([
				agentProperty(`${agentId}.oversized-array`, {
					type: 'array',
					items: { type: 'boolean' },
					maximumItems: 4_097,
					uniqueItems: false,
				}),
			])),
			AgentHostErrorCode.InvalidConfigurationSchema,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCandidate(
				createSchema(),
				{
					schema: createAgentConfigurationSchemaRevision(schemaRevision),
					values: {
						[optionsProperty]: { retries: 1, tags: ['one', 'two', 'three'] },
					},
				},
				'session',
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCandidate(
				createSchema(),
				{
					schema: createAgentConfigurationSchemaRevision(schemaRevision),
					values: {
						[optionsProperty]: { retries: 1, tags: ['duplicate', 'duplicate'] },
					},
				},
				'session',
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);
	});

	test('accepts only exact credential references and clones their values', () => {
		const credential: ProtocolObject = {
			provider: 'vault',
			scope: 'model',
			reference: 'vault:item-1',
		};
		const candidate = validateAndFreezeAgentConfigurationCandidate(
			createSchema(),
			{
				schema: createAgentConfigurationSchemaRevision(schemaRevision),
				values: { [credentialProperty]: credential },
			},
			'session',
		);
		credential.reference = 'vault:changed';
		assert.deepStrictEqual(candidate.values[credentialProperty], {
			provider: 'vault',
			scope: 'model',
			reference: 'vault:item-1',
		});
		assert.ok(Object.isFrozen(candidate.values[credentialProperty]));

		const invalidCredentials: readonly AgentHostProtocolValue[] = [
			'raw-secret',
			{ provider: 'other', scope: 'model', reference: 'vault:item-1' },
			{ provider: 'vault', scope: 'model', reference: 'vault:item-2' },
			{ provider: 'vault', scope: 'model' },
		];
		for (const value of invalidCredentials) {
			captureAgentHostError(
				() => validateAndFreezeAgentConfigurationCandidate(
					createSchema(),
					{
						schema: createAgentConfigurationSchemaRevision(schemaRevision),
						values: { [credentialProperty]: value },
					},
					'session',
				),
				AgentHostErrorCode.InvalidConfigurationValue,
			);
		}
	});

	test('bounds completions and rejects duplicate values', () => {
		const schema = createSchema();
		const property = createAgentConfigurationPropertyId(modeProperty);
		const completions = validateAndFreezeAgentConfigurationCompletions(schema, property, [
			{ label: 'Balanced', description: 'Balanced mode', value: 'balanced' },
			{ label: 'Fast', value: 'fast' },
		]);
		assert.ok(Object.isFrozen(completions));
		assert.ok(Object.isFrozen(completions[0]));

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCompletions(
				schema,
				property,
				Array.from({ length: 101 }, (_, index) => ({ label: `Mode ${index}`, value: 'balanced' })),
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCompletions(schema, property, [
				{ label: 'Balanced', value: 'balanced' },
				{ label: 'Balanced again', value: 'balanced' },
			]),
			AgentHostErrorCode.InvalidConfigurationValue,
		);

		const completionWithUnknownField = [{ label: 'Fast', value: 'fast', unknown: true }];
		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCompletions(
				schema,
				property,
				completionWithUnknownField,
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);

		captureAgentHostError(
			() => validateAndFreezeAgentConfigurationCompletions(
				schema,
				createAgentConfigurationPropertyId(endpointProperty),
				[],
			),
			AgentHostErrorCode.InvalidConfigurationValue,
		);
	});
});
