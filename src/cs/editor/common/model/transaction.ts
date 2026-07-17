/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { captureBoundedClosedJson } from 'cs/editor/common/core/boundedClosedJson';
import { isWellFormedUnicodeString } from 'cs/editor/common/core/canonicalJson';
import { isCanonicalUtcTimestamp } from 'cs/editor/common/core/canonicalTimestamp';
import { manuscriptHashDomains } from 'cs/editor/common/core/hashPreimage';
import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	parseProposalChangeGroupId,
	parseProposalId,
	parseRevisionId,
	parseTransactionId,
	type ContentHash,
	type EntityId,
	type NodeId,
	type ProposalChangeGroupId,
	type ProposalId,
	type RevisionId,
	type TransactionId,
} from 'cs/editor/common/core/identifiers';
import {
	parseManuscriptResource,
	validateManuscriptResource,
} from 'cs/editor/common/core/manuscriptResource';
import { hashCanonicalJson } from 'cs/editor/common/core/sha256';
import {
	createTrustedActorRef,
	type ActorRef,
} from 'cs/editor/common/model/actor';
import {
	decodePersistedOperationV1,
	encodePersistedOperationV1,
	type IPersistedOperationV1,
	type Operation,
} from 'cs/editor/common/model/operation';

export const transactionSources = Object.freeze([
	'human-input',
	'command',
	'import',
	'migration',
	'validator-fix',
	'proposal-accept',
	'undo',
	'redo',
] as const);

export type TransactionSource = (typeof transactionSources)[number];

type OrdinaryTransactionSource = Exclude<
	TransactionSource,
	'proposal-accept' | 'undo' | 'redo'
>;

export type TransactionMetadata =
	| {
		readonly source: OrdinaryTransactionSource;
	}
	| {
		readonly source: 'proposal-accept';
		readonly proposalId: ProposalId;
		readonly proposalRevision: number;
		readonly proposalChangeGroupId: ProposalChangeGroupId;
	}
	| {
		readonly source: 'undo' | 'redo';
		readonly targetTransactionId: TransactionId;
		readonly targetRevisionId: RevisionId;
	};

export type TransactionPrecondition =
	| {
		readonly kind: 'document-hash';
		readonly expectedDocumentHash: ContentHash;
	}
	| {
		readonly kind: 'schema-version';
		readonly expectedSchemaVersion: string;
	}
	| {
		readonly kind: 'node-exists';
		readonly nodeId: NodeId;
	}
	| {
		readonly kind: 'node-hash';
		readonly nodeId: NodeId;
		readonly expectedNodeHash: ContentHash;
	}
	| {
		readonly kind: 'entity-exists';
		readonly entityId: EntityId;
	}
	| {
		readonly kind: 'entity-hash';
		readonly entityId: EntityId;
		readonly expectedEntityHash: ContentHash;
	};

export interface Transaction {
	readonly id: TransactionId;
	readonly resource: URI;
	readonly baseRevisionId: RevisionId;
	readonly actor: ActorRef;
	readonly operations: readonly [Operation, ...Operation[]];
	readonly preconditions: readonly TransactionPrecondition[];
	readonly metadata: TransactionMetadata;
	readonly createdAt: string;
}

export const persistedTransactionFormat = 'nireco-transaction';
export const persistedTransactionFormatVersion = 1;

export const maximumPersistedTransactionUtf8Bytes = 16 * 1_024 * 1_024;
export const maximumTransactionJsonValues = 262_144;
export const maximumTransactionDepth = 256;
export const maximumTransactionOperations = 1_024;
export const maximumTransactionPreconditions = 4_096;

export interface IPersistedTransactionBodyV1 {
	readonly id: TransactionId;
	readonly resource: string;
	readonly baseRevisionId: RevisionId;
	readonly actor: ActorRef;
	readonly operations: readonly [IPersistedOperationV1, ...IPersistedOperationV1[]];
	readonly preconditions: readonly TransactionPrecondition[];
	readonly metadata: TransactionMetadata;
	readonly createdAt: string;
}

export interface IPersistedTransactionV1 {
	readonly format: typeof persistedTransactionFormat;
	readonly formatVersion: typeof persistedTransactionFormatVersion;
	readonly transaction: IPersistedTransactionBodyV1;
}

export type TransactionCodecFailure =
	| 'inspection-failed'
	| 'resource-limit-exceeded'
	| 'invalid-envelope'
	| 'unsupported-version'
	| 'invalid-transaction'
	| 'invalid-operation'
	| 'duplicate-operation-id'
	| 'duplicate-precondition-key'
	| 'conflicting-precondition-key';

export interface ITransactionCodecError {
	readonly type: 'invalid';
	readonly reason: TransactionCodecFailure;
	readonly path: string;
}

export type EncodeTransactionResult =
	| {
		readonly type: 'valid';
		readonly value: IPersistedTransactionV1;
	}
	| ITransactionCodecError;

export type DecodeTransactionResult =
	| {
		readonly type: 'valid';
		readonly value: Transaction;
	}
	| ITransactionCodecError;

export type TransactionHashResult =
	| {
		readonly type: 'valid';
		readonly hash: ContentHash;
	}
	| ITransactionCodecError;

type ClosedRecord = Readonly<Record<string, unknown>>;

interface IRuntimeResource {
	readonly resource: URI;
	readonly canonical: string;
}

interface IDecodedPersistedTransaction {
	readonly transaction: Transaction;
	readonly persisted: IPersistedTransactionV1;
}

type DomainResult<TValue> =
	| {
		readonly type: 'valid';
		readonly value: TValue;
	}
	| ITransactionCodecError;

interface ISeenPrecondition {
	readonly kind: TransactionPrecondition['kind'];
	readonly expected?: string;
}

interface ITransactionInputFailure {
	readonly reason: 'inspection-failed' | 'resource-limit-exceeded';
	readonly path: string;
}

const transactionInputFailures = new WeakSet<object>();
const ordinaryTransactionSources = new Set<OrdinaryTransactionSource>([
	'human-input',
	'command',
	'import',
	'migration',
	'validator-fix',
]);

export function encodePersistedTransactionV1(value: unknown): EncodeTransactionResult {
	try {
		const encoded = encodeRuntimeTransaction(value);
		if (encoded.type === 'invalid') {
			return encoded;
		}
		const decoded = decodePersistedTransactionInternal(encoded.value);
		return decoded.type === 'invalid'
			? decoded
			: {
				type: 'valid',
				value: decoded.value.persisted,
			};
	} catch (error) {
		return errorFromThrownInput(error);
	}
}

export function decodePersistedTransactionV1(value: unknown): DecodeTransactionResult {
	const decoded = decodePersistedTransactionInternal(value);
	return decoded.type === 'invalid'
		? decoded
		: {
			type: 'valid',
			value: decoded.value.transaction,
		};
}

export function hashPersistedTransactionV1(value: unknown): TransactionHashResult {
	const decoded = decodePersistedTransactionInternal(value);
	if (decoded.type === 'invalid') {
		return decoded;
	}
	const hashed = hashCanonicalJson(
		manuscriptHashDomains.transaction,
		decoded.value.persisted,
	);
	return hashed.type === 'error'
		? invalidCodec('invalid-transaction', hashed.path)
		: {
			type: 'valid',
			hash: hashed.hash,
		};
}

function encodeRuntimeTransaction(value: unknown): DomainResult<IPersistedTransactionV1> {
	const transaction = readDataRecord(value, '$');
	if (transaction === undefined || !hasExactKeys(transaction, [
		'id',
		'resource',
		'baseRevisionId',
		'actor',
		'operations',
		'preconditions',
		'metadata',
		'createdAt',
	])) {
		return invalidCodec('invalid-transaction', '$');
	}

	const id = transactionId(transaction['id']);
	const resource = runtimeManuscriptResource(transaction['resource']);
	const baseRevisionId = revisionId(transaction['baseRevisionId']);
	const actor = createTrustedActorRef(transaction['actor']);
	if (
		id === undefined
		|| resource === undefined
		|| baseRevisionId === undefined
		|| actor === undefined
		|| !isCanonicalUtcTimestamp(transaction['createdAt'])
	) {
		return invalidCodec('invalid-transaction', '$');
	}
	const operations = encodeOperations(
		transaction['operations'],
		'$.operations',
		resource.resource,
	);
	const preconditions = decodePreconditions(
		transaction['preconditions'],
		'$.preconditions',
	);
	const metadata = decodeMetadata(transaction['metadata'], '$.metadata');
	if (operations.type === 'invalid') {
		return operations;
	}
	if (preconditions.type === 'invalid') {
		return preconditions;
	}
	if (metadata.type === 'invalid') {
		return metadata;
	}

	const body: IPersistedTransactionBodyV1 = {
		id,
		resource: resource.canonical,
		baseRevisionId,
		actor,
		operations: operations.value,
		preconditions: preconditions.value,
		metadata: metadata.value,
		createdAt: transaction['createdAt'],
	};
	return {
		type: 'valid',
		value: deepFreezeOwnedData({
			format: persistedTransactionFormat,
			formatVersion: persistedTransactionFormatVersion,
			transaction: body,
		}),
	};
}

function decodePersistedTransactionInternal(
	value: unknown,
): DomainResult<IDecodedPersistedTransaction> {
	try {
		const captured = captureBoundedClosedJson(value, {
			maximumDepth: maximumTransactionDepth,
			maximumValues: maximumTransactionJsonValues,
			maximumArrayLength: maximumTransactionJsonValues,
			maximumObjectProperties: maximumTransactionJsonValues,
			maximumCanonicalUtf8Bytes: maximumPersistedTransactionUtf8Bytes,
		});
		if (captured.type === 'invalid') {
			return invalidCodec(captured.reason, captured.path);
		}
		return decodeCapturedPersistedTransaction(captured.value);
	} catch (error) {
		return errorFromThrownInput(error);
	}
}

function decodeCapturedPersistedTransaction(
	value: unknown,
): DomainResult<IDecodedPersistedTransaction> {
	const envelope = readDataRecord(value, '$');
	if (
		envelope === undefined
		|| !hasExactKeys(envelope, ['format', 'formatVersion', 'transaction'])
		|| envelope['format'] !== persistedTransactionFormat
	) {
		return invalidCodec('invalid-envelope', '$');
	}
	if (envelope['formatVersion'] !== persistedTransactionFormatVersion) {
		return invalidCodec('unsupported-version', '$.formatVersion');
	}

	const body = readDataRecord(envelope['transaction'], '$.transaction');
	if (body === undefined || !hasExactKeys(body, [
		'id',
		'resource',
		'baseRevisionId',
		'actor',
		'operations',
		'preconditions',
		'metadata',
		'createdAt',
	])) {
		return invalidCodec('invalid-transaction', '$.transaction');
	}

	const id = transactionId(body['id']);
	const resource = typeof body['resource'] === 'string'
		? parseManuscriptResource(body['resource'])
		: undefined;
	const baseRevisionId = revisionId(body['baseRevisionId']);
	const actor = createTrustedActorRef(body['actor']);
	if (
		id === undefined
		|| resource === undefined
		|| resource.type === 'invalid'
		|| baseRevisionId === undefined
		|| actor === undefined
		|| !isCanonicalUtcTimestamp(body['createdAt'])
	) {
		return invalidCodec('invalid-transaction', '$.transaction');
	}
	const operations = decodeOperations(
		body['operations'],
		'$.transaction.operations',
		resource.resource,
	);
	const preconditions = decodePreconditions(
		body['preconditions'],
		'$.transaction.preconditions',
	);
	const metadata = decodeMetadata(body['metadata'], '$.transaction.metadata');
	if (operations.type === 'invalid') {
		return operations;
	}
	if (preconditions.type === 'invalid') {
		return preconditions;
	}
	if (metadata.type === 'invalid') {
		return metadata;
	}

	const transaction = deepFreezeOwnedData<Transaction>({
		id,
		resource: resource.resource,
		baseRevisionId,
		actor,
		operations: operations.value,
		preconditions: preconditions.value,
		metadata: metadata.value,
		createdAt: body['createdAt'],
	});
	return {
		type: 'valid',
		value: {
			transaction,
			persisted: deepFreezeOwnedData(value as IPersistedTransactionV1),
		},
	};
}

function encodeOperations(
	value: unknown,
	path: string,
	expectedResource: URI,
): DomainResult<readonly [IPersistedOperationV1, ...IPersistedOperationV1[]]> {
	const operations = readDenseDataArray(
		value,
		path,
		maximumTransactionOperations,
	);
	if (operations === undefined || operations.length === 0) {
		return invalidCodec('invalid-transaction', path);
	}
	const encoded: IPersistedOperationV1[] = [];
	const operationIds = new Set<string>();
	let remainingValues = maximumTransactionJsonValues;
	let remainingUtf8Bytes = maximumPersistedTransactionUtf8Bytes;
	for (let index = 0; index < operations.length; index += 1) {
		const itemPath = `${path}[${index}]`;
		const operation = encodePersistedOperationV1(
			operations[index],
			expectedResource,
		);
		if (operation.type === 'invalid') {
			return invalidCodec(
				operation.reason === 'inspection-failed'
					|| operation.reason === 'resource-limit-exceeded'
					? operation.reason
					: 'invalid-operation',
				`${itemPath}${operation.path === '$' ? '' : operation.path.slice(1)}`,
			);
		}
		if (index > 0) {
			if (remainingUtf8Bytes === 0) {
				return invalidCodec('resource-limit-exceeded', itemPath);
			}
			remainingUtf8Bytes -= 1;
		}
		const captured = captureBoundedClosedJson(operation.value, {
			maximumDepth: maximumTransactionDepth - 3,
			maximumValues: remainingValues,
			maximumArrayLength: remainingValues,
			maximumObjectProperties: remainingValues,
			maximumCanonicalUtf8Bytes: remainingUtf8Bytes,
		});
		if (captured.type === 'invalid') {
			return invalidCodec(
				captured.reason,
				`${itemPath}${captured.path === '$' ? '' : captured.path.slice(1)}`,
			);
		}
		remainingValues -= captured.metrics.valueCount;
		remainingUtf8Bytes -= captured.metrics.canonicalUtf8Bytes;
		const persistedOperation = captured.value as unknown as IPersistedOperationV1;
		const decoded = decodePersistedOperationV1(
			persistedOperation,
			expectedResource,
		);
		if (decoded.type === 'invalid') {
			return invalidCodec('invalid-operation', itemPath);
		}
		if (operationIds.has(decoded.value.id)) {
			return invalidCodec('duplicate-operation-id', `${itemPath}.id`);
		}
		operationIds.add(decoded.value.id);
		encoded.push(deepFreezeOwnedData(persistedOperation));
	}
	return {
		type: 'valid',
		value: Object.freeze(encoded) as readonly [
			IPersistedOperationV1,
			...IPersistedOperationV1[],
		],
	};
}

function decodeOperations(
	value: unknown,
	path: string,
	expectedResource: URI,
): DomainResult<readonly [Operation, ...Operation[]]> {
	const operations = readDenseDataArray(
		value,
		path,
		maximumTransactionOperations,
	);
	if (operations === undefined || operations.length === 0) {
		return invalidCodec('invalid-transaction', path);
	}
	const decoded: Operation[] = [];
	const operationIds = new Set<string>();
	for (let index = 0; index < operations.length; index += 1) {
		const itemPath = `${path}[${index}]`;
		const operation = decodePersistedOperationV1(
			operations[index],
			expectedResource,
		);
		if (operation.type === 'invalid') {
			return invalidCodec(
				operation.reason === 'inspection-failed'
					|| operation.reason === 'resource-limit-exceeded'
					? operation.reason
					: 'invalid-operation',
				`${itemPath}${operation.path === '$' ? '' : operation.path.slice(1)}`,
			);
		}
		if (operationIds.has(operation.value.id)) {
			return invalidCodec('duplicate-operation-id', `${itemPath}.operation.id`);
		}
		operationIds.add(operation.value.id);
		decoded.push(deepFreezeOwnedData(operation.value));
	}
	return {
		type: 'valid',
		value: Object.freeze(decoded) as readonly [Operation, ...Operation[]],
	};
}

function decodePreconditions(
	value: unknown,
	path: string,
): DomainResult<readonly TransactionPrecondition[]> {
	const items = readDenseDataArray(
		value,
		path,
		maximumTransactionPreconditions,
	);
	if (items === undefined) {
		return invalidCodec('invalid-transaction', path);
	}
	const preconditions: TransactionPrecondition[] = [];
	const seen = new Map<string, ISeenPrecondition>();
	let hasDocumentHash = false;
	let hasSchemaVersion = false;
	for (let index = 0; index < items.length; index += 1) {
		const itemPath = `${path}[${index}]`;
		const precondition = decodePrecondition(items[index], itemPath);
		if (precondition.type === 'invalid') {
			return precondition;
		}
		const keyed = preconditionIdentity(precondition.value);
		const previous = seen.get(keyed.key);
		if (previous !== undefined) {
			const duplicate =
				previous.kind === keyed.identity.kind
				&& previous.expected === keyed.identity.expected;
			return invalidCodec(
				duplicate
					? 'duplicate-precondition-key'
					: 'conflicting-precondition-key',
				itemPath,
			);
		}
		seen.set(keyed.key, keyed.identity);
		hasDocumentHash ||= precondition.value.kind === 'document-hash';
		hasSchemaVersion ||= precondition.value.kind === 'schema-version';
		preconditions.push(precondition.value);
	}
	if (!hasDocumentHash || !hasSchemaVersion) {
		return invalidCodec('invalid-transaction', path);
	}
	return {
		type: 'valid',
		value: Object.freeze(preconditions),
	};
}

function decodePrecondition(
	value: unknown,
	path: string,
): DomainResult<TransactionPrecondition> {
	const precondition = readDataRecord(value, path);
	if (precondition === undefined || typeof precondition['kind'] !== 'string') {
		return invalidCodec('invalid-transaction', path);
	}
	switch (precondition['kind']) {
		case 'document-hash': {
			if (!hasExactKeys(precondition, ['kind', 'expectedDocumentHash'])) {
				return invalidCodec('invalid-transaction', path);
			}
			const expectedDocumentHash = contentHash(precondition['expectedDocumentHash']);
			return expectedDocumentHash === undefined
				? invalidCodec('invalid-transaction', path)
				: validDomain(Object.freeze({
					kind: 'document-hash',
					expectedDocumentHash,
				}));
		}
		case 'schema-version':
			return hasExactKeys(precondition, ['kind', 'expectedSchemaVersion'])
				&& isBoundedString(precondition['expectedSchemaVersion'], 1, 128)
				? validDomain(Object.freeze({
					kind: 'schema-version',
					expectedSchemaVersion: precondition['expectedSchemaVersion'],
				}))
				: invalidCodec('invalid-transaction', path);
		case 'node-exists': {
			if (!hasExactKeys(precondition, ['kind', 'nodeId'])) {
				return invalidCodec('invalid-transaction', path);
			}
			const parsedNodeId = nodeId(precondition['nodeId']);
			return parsedNodeId === undefined
				? invalidCodec('invalid-transaction', path)
				: validDomain(Object.freeze({
					kind: 'node-exists',
					nodeId: parsedNodeId,
				}));
		}
		case 'node-hash': {
			if (!hasExactKeys(precondition, ['kind', 'nodeId', 'expectedNodeHash'])) {
				return invalidCodec('invalid-transaction', path);
			}
			const parsedNodeId = nodeId(precondition['nodeId']);
			const expectedNodeHash = contentHash(precondition['expectedNodeHash']);
			return parsedNodeId === undefined || expectedNodeHash === undefined
				? invalidCodec('invalid-transaction', path)
				: validDomain(Object.freeze({
					kind: 'node-hash',
					nodeId: parsedNodeId,
					expectedNodeHash,
				}));
		}
		case 'entity-exists': {
			if (!hasExactKeys(precondition, ['kind', 'entityId'])) {
				return invalidCodec('invalid-transaction', path);
			}
			const parsedEntityId = entityId(precondition['entityId']);
			return parsedEntityId === undefined
				? invalidCodec('invalid-transaction', path)
				: validDomain(Object.freeze({
					kind: 'entity-exists',
					entityId: parsedEntityId,
				}));
		}
		case 'entity-hash': {
			if (!hasExactKeys(precondition, ['kind', 'entityId', 'expectedEntityHash'])) {
				return invalidCodec('invalid-transaction', path);
			}
			const parsedEntityId = entityId(precondition['entityId']);
			const expectedEntityHash = contentHash(precondition['expectedEntityHash']);
			return parsedEntityId === undefined || expectedEntityHash === undefined
				? invalidCodec('invalid-transaction', path)
				: validDomain(Object.freeze({
					kind: 'entity-hash',
					entityId: parsedEntityId,
					expectedEntityHash,
				}));
		}
		default:
			return invalidCodec('invalid-transaction', path);
	}
}

function preconditionIdentity(precondition: TransactionPrecondition): {
	readonly key: string;
	readonly identity: ISeenPrecondition;
} {
	switch (precondition.kind) {
		case 'document-hash':
			return {
				key: 'document',
				identity: {
					kind: precondition.kind,
					expected: precondition.expectedDocumentHash,
				},
			};
		case 'schema-version':
			return {
				key: 'schema',
				identity: {
					kind: precondition.kind,
					expected: precondition.expectedSchemaVersion,
				},
			};
		case 'node-exists':
			return {
				key: `node:${precondition.nodeId}`,
				identity: {
					kind: precondition.kind,
				},
			};
		case 'node-hash':
			return {
				key: `node:${precondition.nodeId}`,
				identity: {
					kind: precondition.kind,
					expected: precondition.expectedNodeHash,
				},
			};
		case 'entity-exists':
			return {
				key: `entity:${precondition.entityId}`,
				identity: {
					kind: precondition.kind,
				},
			};
		case 'entity-hash':
			return {
				key: `entity:${precondition.entityId}`,
				identity: {
					kind: precondition.kind,
					expected: precondition.expectedEntityHash,
				},
			};
	}
}

function decodeMetadata(
	value: unknown,
	path: string,
): DomainResult<TransactionMetadata> {
	const metadata = readDataRecord(value, path);
	if (metadata === undefined || typeof metadata['source'] !== 'string') {
		return invalidCodec('invalid-transaction', path);
	}
	if (ordinaryTransactionSources.has(metadata['source'] as OrdinaryTransactionSource)) {
		return hasExactKeys(metadata, ['source'])
			? validDomain(Object.freeze({
				source: metadata['source'] as OrdinaryTransactionSource,
			}))
			: invalidCodec('invalid-transaction', path);
	}
	if (metadata['source'] === 'proposal-accept') {
		if (!hasExactKeys(metadata, [
			'source',
			'proposalId',
			'proposalRevision',
			'proposalChangeGroupId',
		])) {
			return invalidCodec('invalid-transaction', path);
		}
		const parsedProposalId = proposalId(metadata['proposalId']);
		const proposalRevision = positiveSafeInteger(metadata['proposalRevision']);
		const proposalChangeGroupId = changeGroupId(metadata['proposalChangeGroupId']);
		return (
			parsedProposalId === undefined
			|| proposalRevision === undefined
			|| proposalChangeGroupId === undefined
		)
			? invalidCodec('invalid-transaction', path)
			: validDomain(Object.freeze({
				source: 'proposal-accept',
				proposalId: parsedProposalId,
				proposalRevision,
				proposalChangeGroupId,
			}));
	}
	if (metadata['source'] === 'undo' || metadata['source'] === 'redo') {
		if (!hasExactKeys(metadata, [
			'source',
			'targetTransactionId',
			'targetRevisionId',
		])) {
			return invalidCodec('invalid-transaction', path);
		}
		const targetTransactionId = transactionId(metadata['targetTransactionId']);
		const targetRevisionId = revisionId(metadata['targetRevisionId']);
		return targetTransactionId === undefined || targetRevisionId === undefined
			? invalidCodec('invalid-transaction', path)
			: validDomain(Object.freeze({
				source: metadata['source'],
				targetTransactionId,
				targetRevisionId,
			}));
	}
	return invalidCodec('invalid-transaction', path);
}

function runtimeManuscriptResource(
	value: unknown,
): IRuntimeResource | undefined {
	const validated = validateManuscriptResource(value as URI);
	return validated.type === 'invalid'
		? undefined
		: {
			resource: validated.resource,
			canonical: validated.canonical,
		};
}

function readDataRecord(value: unknown, path: string): ClosedRecord | undefined {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throwInputFailure('inspection-failed', path);
	}
	const result: Record<string, unknown> = Object.create(null);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throwInputFailure('inspection-failed', path);
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throwInputFailure('inspection-failed', `${path}.${key}`);
		}
		result[key] = descriptor.value;
	}
	return result;
}

function readDenseDataArray(
	value: unknown,
	path: string,
	maximumLength: number,
): readonly unknown[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	if (Reflect.getPrototypeOf(value) !== Array.prototype) {
		throwInputFailure('inspection-failed', path);
	}
	const keys = Reflect.ownKeys(value);
	const descriptors = new Map<PropertyKey, PropertyDescriptor>();
	for (const key of keys) {
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) {
			throwInputFailure('inspection-failed', path);
		}
		descriptors.set(key, descriptor);
	}
	const lengthDescriptor = descriptors.get('length');
	if (
		lengthDescriptor === undefined
		|| !('value' in lengthDescriptor)
		|| lengthDescriptor.enumerable
		|| !Number.isSafeInteger(lengthDescriptor.value)
		|| lengthDescriptor.value < 0
	) {
		throwInputFailure('inspection-failed', `${path}.length`);
	}
	const length = lengthDescriptor.value as number;
	if (length > maximumLength) {
		throwInputFailure('resource-limit-exceeded', `${path}.length`);
	}
	if (keys.length !== length + 1) {
		throwInputFailure('inspection-failed', path);
	}
	const result: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const descriptor = descriptors.get(String(index));
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throwInputFailure('inspection-failed', `${path}[${index}]`);
		}
		result.push(descriptor.value);
	}
	return result;
}

function hasExactKeys(record: ClosedRecord, keys: readonly string[]): boolean {
	return (
		Object.keys(record).length === keys.length
		&& keys.every(key => Object.hasOwn(record, key))
	);
}

function deepFreezeOwnedData<TValue>(value: TValue): TValue {
	return cloneAndFreezeOwnedData(
		value,
		new Map<object, unknown>(),
	) as TValue;
}

function cloneAndFreezeOwnedData(
	value: unknown,
	clones: Map<object, unknown>,
): unknown {
	if (value === null || typeof value !== 'object' || value instanceof URI) {
		return value;
	}
	const existing = clones.get(value);
	if (existing !== undefined) {
		return existing;
	}
	if (Array.isArray(value)) {
		const result: unknown[] = [];
		clones.set(value, result);
		for (const key of Reflect.ownKeys(value)) {
			if (key === 'length') {
				continue;
			}
			if (typeof key !== 'string') {
				throw new TypeError('Owned transaction array has a symbol key.');
			}
			const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
			if (
				descriptor === undefined
				|| !descriptor.enumerable
				|| !('value' in descriptor)
			) {
				throw new TypeError('Owned transaction array has an unsafe property.');
			}
			Object.defineProperty(result, key, {
				value: cloneAndFreezeOwnedData(descriptor.value, clones),
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
		return Object.freeze(result);
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		throw new TypeError('Owned transaction record has an unsupported prototype.');
	}
	const result: Record<string, unknown> = Object.create(Object.prototype);
	clones.set(value, result);
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			throw new TypeError('Owned transaction record has a symbol key.');
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			throw new TypeError('Owned transaction record has an unsafe property.');
		}
		Object.defineProperty(result, key, {
			value: cloneAndFreezeOwnedData(descriptor.value, clones),
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return Object.freeze(result);
}

function validDomain<TValue>(value: TValue): DomainResult<TValue> {
	return {
		type: 'valid',
		value,
	};
}

function isBoundedString(
	value: unknown,
	minimumLength: number,
	maximumLength: number,
): value is string {
	return (
		typeof value === 'string'
		&& value.length >= minimumLength
		&& value.length <= maximumLength
		&& isWellFormedUnicodeString(value)
	);
}

function positiveSafeInteger(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1
		? value
		: undefined;
}

function transactionId(value: unknown): TransactionId | undefined {
	return parseIdentifier(value, parseTransactionId);
}

function revisionId(value: unknown): RevisionId | undefined {
	return parseIdentifier(value, parseRevisionId);
}

function nodeId(value: unknown): NodeId | undefined {
	return parseIdentifier(value, parseNodeId);
}

function entityId(value: unknown): EntityId | undefined {
	return parseIdentifier(value, parseEntityId);
}

function proposalId(value: unknown): ProposalId | undefined {
	return parseIdentifier(value, parseProposalId);
}

function changeGroupId(value: unknown): ProposalChangeGroupId | undefined {
	return parseIdentifier(value, parseProposalChangeGroupId);
}

function contentHash(value: unknown): ContentHash | undefined {
	return parseIdentifier(value, parseContentHash);
}

function parseIdentifier<TIdentifier>(
	value: unknown,
	parse: (value: string) =>
		| {
			readonly type: 'valid';
			readonly value: TIdentifier;
		}
		| {
			readonly type: 'invalid';
			readonly reason: string;
		},
): TIdentifier | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parse(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function errorFromThrownInput(error: unknown): ITransactionCodecError {
	if (isTransactionInputFailure(error)) {
		return invalidCodec(error.reason, error.path);
	}
	return invalidCodec('inspection-failed', '$');
}

function throwInputFailure(
	reason: ITransactionInputFailure['reason'],
	path: string,
): never {
	const failure: ITransactionInputFailure = Object.freeze({
		reason,
		path,
	});
	transactionInputFailures.add(failure);
	throw failure;
}

function isTransactionInputFailure(
	value: unknown,
): value is ITransactionInputFailure {
	if (value === null || typeof value !== 'object') {
		return false;
	}
	return transactionInputFailures.has(value);
}

function invalidCodec(
	reason: TransactionCodecFailure,
	path: string,
): ITransactionCodecError {
	return {
		type: 'invalid',
		reason,
		path,
	};
}
