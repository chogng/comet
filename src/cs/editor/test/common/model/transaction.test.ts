/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	serializeCanonicalJson,
	type CanonicalJsonValue,
} from 'cs/editor/common/core/canonicalJson';
import {
	manuscriptHashDomains,
	manuscriptHashPreimagePrefix,
} from 'cs/editor/common/core/hashPreimage';
import {
	parseContentHash,
	parseEntityId,
	parseNodeId,
	parseOperationId,
	parseProposalChangeGroupId,
	parseProposalId,
	parseRevisionId,
	parseTransactionId,
	type ContentHash,
	type EntityId,
	type NodeId,
	type OperationId,
	type ProposalChangeGroupId,
	type ProposalId,
	type RevisionId,
	type TransactionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import type { ReferenceSnapshot } from 'cs/editor/common/model/academicGraph';
import type { ActorRef } from 'cs/editor/common/model/actor';
import {
	encodePersistedOperationV1,
	type IPersistedOperationV1,
	type Operation,
	type ReplaceTextOperation,
} from 'cs/editor/common/model/operation';
import {
	decodePersistedTransactionV1,
	encodePersistedTransactionV1,
	hashPersistedTransactionV1,
	maximumPersistedTransactionUtf8Bytes,
	maximumTransactionJsonValues,
	maximumTransactionOperations,
	maximumTransactionPreconditions,
	persistedTransactionFormat,
	persistedTransactionFormatVersion,
	type IPersistedTransactionV1,
	type Transaction,
	type TransactionMetadata,
	type TransactionPrecondition,
} from 'cs/editor/common/model/transaction';

const hashA = contentHash(
	'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
);
const hashB = contentHash(
	'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
);
const resource = createManuscriptDraftResource(uuid(900));
const otherResource = createManuscriptDraftResource(uuid(901));
const transactionIdentifier = transactionId(uuid(1));
const baseRevisionId = revisionId(uuid(2));
const textNodeId = nodeId(uuid(3));
const actor: ActorRef = Object.freeze({
	type: 'human',
	id: 'reviewer-1',
});

const replaceTextOperation: ReplaceTextOperation = Object.freeze({
	id: operationId(uuid(4)),
	type: 'replace-text',
	textNodeId,
	expectedNodeHash: hashA,
	startUtf16Offset: offset(1),
	endUtf16Offset: offset(3),
	replacement: 'new text',
});

const requiredPreconditions: readonly TransactionPrecondition[] = Object.freeze([
	Object.freeze({
		kind: 'document-hash',
		expectedDocumentHash: hashA,
	}),
	Object.freeze({
		kind: 'schema-version',
		expectedSchemaVersion: 'nireco-manuscript@1',
	}),
]);

const baseTransaction: Transaction = Object.freeze({
	id: transactionIdentifier,
	resource,
	baseRevisionId,
	actor,
	operations: Object.freeze([
		replaceTextOperation,
	]) as readonly [ReplaceTextOperation],
	preconditions: requiredPreconditions,
	metadata: Object.freeze({
		source: 'human-input',
	}),
	createdAt: '2026-07-16T12:00:00.000Z',
});

suite('Transaction codec', () => {
	test('round-trips the exact versioned envelope with full operation envelopes', () => {
		const persisted = encode(baseTransaction);

		assert.equal(persisted.format, persistedTransactionFormat);
		assert.equal(persisted.formatVersion, persistedTransactionFormatVersion);
		assert.deepStrictEqual(Object.keys(persisted).sort(), [
			'format',
			'formatVersion',
			'transaction',
		]);
		assert.deepStrictEqual(Object.keys(persisted.transaction).sort(), [
			'actor',
			'baseRevisionId',
			'createdAt',
			'id',
			'metadata',
			'operations',
			'preconditions',
			'resource',
		]);
		assert.equal(persisted.transaction.resource, resource.toString(true));
		assert.equal(persisted.transaction.id, transactionIdentifier);
		assert.equal(persisted.transaction.operations[0].format, 'nireco-operation');
		assert.equal(persisted.transaction.operations[0].formatVersion, 1);
		assert.equal(
			persisted.transaction.operations[0].operation['id'],
			replaceTextOperation.id,
		);
		assertNoRuntimeUri(persisted);

		const decoded = decode(persisted);
		assert.equal(decoded.id, baseTransaction.id);
		assert.equal(decoded.baseRevisionId, baseTransaction.baseRevisionId);
		assert.equal(decoded.operations[0].id, baseTransaction.operations[0].id);
		assert.equal(decoded.resource.toString(true), resource.toString(true));
		assert.deepStrictEqual(encode(decoded), persisted);
	});

	test('deep-freezes owned decoded data without freezing the URI instance', () => {
		const persisted = encode(baseTransaction);
		const decoded = decode(persisted);

		for (const value of [
			persisted,
			persisted.transaction,
			persisted.transaction.actor,
			persisted.transaction.operations,
			persisted.transaction.operations[0],
			persisted.transaction.operations[0].operation,
			persisted.transaction.preconditions,
			persisted.transaction.preconditions[0],
			persisted.transaction.metadata,
			decoded,
			decoded.actor,
			decoded.operations,
			decoded.operations[0],
			decoded.preconditions,
			decoded.preconditions[0],
			decoded.metadata,
		]) {
			assert.equal(Object.isFrozen(value), true);
		}
		assert.equal(Object.isFrozen(decoded.resource), false);
		assert.throws(() => {
			(decoded.operations as unknown as Operation[]).push(replaceTextOperation);
		}, TypeError);
	});

	test('preserves an own __proto__ CSL key through Transaction decode and replay', () => {
		const reference: ReferenceSnapshot = {
			id: entityId(uuid(42)),
			type: 'reference-snapshot',
			cslJson: createPrototypeKeyCslJson(),
			capturedAt: '2026-07-16T12:00:00.000Z',
		};
		const operation: Operation = {
			id: operationId(uuid(41)),
			type: 'create-academic-entity',
			entity: reference,
		};
		const transaction: Transaction = {
			...baseTransaction,
			id: transactionId(uuid(40)),
			operations: [operation],
		};
		const persisted = encode(transaction);
		const persistedEntity = canonicalRecord(
			persisted.transaction.operations[0].operation['entity'],
		);
		assertSafePrototypeKeyRecord(canonicalRecord(persistedEntity['cslJson']));

		const decoded = decode(persisted);
		const decodedOperation = decoded.operations[0];
		if (
			decodedOperation.type !== 'create-academic-entity'
			|| decodedOperation.entity.type !== 'reference-snapshot'
		) {
			assert.fail('Expected a decoded create Reference Snapshot Operation.');
		}
		assertSafePrototypeKeyRecord(decodedOperation.entity.cslJson);
		assert.deepStrictEqual(encode(decoded), persisted);
	});

	test('accepts only the three exact metadata families', () => {
		const ordinarySources = [
			'human-input',
			'command',
			'import',
			'migration',
			'validator-fix',
		] as const;
		for (const source of ordinarySources) {
			assert.equal(encodeTransactionWith({
				metadata: { source },
			}).type, 'valid');
		}

		const proposalMetadata: TransactionMetadata = {
			source: 'proposal-accept',
			proposalId: proposalId(uuid(11)),
			proposalRevision: 3,
			proposalChangeGroupId: proposalChangeGroupId(uuidV8(12)),
		};
		const undoMetadata: TransactionMetadata = {
			source: 'undo',
			targetTransactionId: transactionId(uuid(13)),
			targetRevisionId: revisionId(uuid(14)),
		};
		const redoMetadata: TransactionMetadata = {
			...undoMetadata,
			source: 'redo',
		};
		for (const metadata of [proposalMetadata, undoMetadata, redoMetadata]) {
			const persisted = encode({
				...baseTransaction,
				metadata,
			});
			assert.deepStrictEqual({ ...persisted.transaction.metadata }, metadata);
		}

		for (const metadata of [
			{ source: 'human-input', sessionId: 'forbidden' },
			{ source: 'proposal-accept', proposalId: proposalId(uuid(11)) },
			{ ...proposalMetadata, proposalRevision: 0 },
			{ ...proposalMetadata, tool: 'forbidden' },
			{ source: 'undo', targetTransactionId: transactionId(uuid(13)) },
			{ ...undoMetadata, undoGroup: 'forbidden' },
			{ source: 'future-source' },
		]) {
			assert.equal(encodeTransactionWith({ metadata }).type, 'invalid');
		}
	});

	test('requires document and schema preconditions and classifies duplicate logical keys', () => {
		const node = nodeId(uuid(20));
		const entity = entityId(uuid(21));
		const document = requiredPreconditions[0]!;
		const schema = requiredPreconditions[1]!;

		assertInvalidReason(
			encodeTransactionWith({ preconditions: [schema] }),
			'invalid-transaction',
		);
		assertInvalidReason(
			encodeTransactionWith({ preconditions: [document] }),
			'invalid-transaction',
		);
		assertInvalidReason(
			encodeTransactionWith({ preconditions: [document, schema, document] }),
			'duplicate-precondition-key',
		);
		assertInvalidReason(
			encodeTransactionWith({
				preconditions: [
					document,
					schema,
					{ kind: 'document-hash', expectedDocumentHash: hashB },
				],
			}),
			'conflicting-precondition-key',
		);
		assertInvalidReason(
			encodeTransactionWith({ preconditions: [document, schema, schema] }),
			'duplicate-precondition-key',
		);
		assertInvalidReason(
			encodeTransactionWith({
				preconditions: [
					document,
					schema,
					{ kind: 'schema-version', expectedSchemaVersion: 'other' },
				],
			}),
			'conflicting-precondition-key',
		);
		assertInvalidReason(
			encodeTransactionWith({
				preconditions: [
					document,
					schema,
					{ kind: 'node-exists', nodeId: node },
					{ kind: 'node-exists', nodeId: node },
				],
			}),
			'duplicate-precondition-key',
		);
		assertInvalidReason(
			encodeTransactionWith({
				preconditions: [
					document,
					schema,
					{ kind: 'node-exists', nodeId: node },
					{ kind: 'node-hash', nodeId: node, expectedNodeHash: hashA },
				],
			}),
			'conflicting-precondition-key',
		);
		assertInvalidReason(
			encodeTransactionWith({
				preconditions: [
					document,
					schema,
					{ kind: 'entity-hash', entityId: entity, expectedEntityHash: hashA },
					{ kind: 'entity-hash', entityId: entity, expectedEntityHash: hashA },
				],
			}),
			'duplicate-precondition-key',
		);
		assertInvalidReason(
			encodeTransactionWith({
				preconditions: [
					document,
					schema,
					{ kind: 'entity-exists', entityId: entity },
					{ kind: 'entity-hash', entityId: entity, expectedEntityHash: hashB },
				],
			}),
			'conflicting-precondition-key',
		);
	});

	test('rejects duplicate Operation IDs without rewriting or sorting', () => {
		const duplicateOperation = {
			...replaceTextOperation,
			replacement: 'second',
		};
		const runtimeResult = encodeTransactionWith({
			operations: [replaceTextOperation, duplicateOperation],
		});
		assertInvalidReason(runtimeResult, 'duplicate-operation-id');
		assert.equal(
			runtimeResult.type === 'invalid' ? runtimeResult.path : '',
			'$.operations[1].id',
		);

		const persisted = encode(baseTransaction);
		const duplicatePersisted: IPersistedTransactionV1 = {
			...persisted,
			transaction: {
				...persisted.transaction,
				operations: [
					persisted.transaction.operations[0],
					persisted.transaction.operations[0],
				],
			},
		};
		const persistedResult = decodePersistedTransactionV1(duplicatePersisted);
		assertInvalidReason(persistedResult, 'duplicate-operation-id');
		assert.equal(
			persistedResult.type === 'invalid' ? persistedResult.path : '',
			'$.transaction.operations[1].operation.id',
		);
	});

	test('rejects invalid URI, IDs, actor, timestamp, and closed-envelope additions', () => {
		assert.equal(encodeTransactionWith({
			resource: URI.from({ scheme: 'file', path: '/tmp/manuscript' }),
		}).type, 'invalid');
		assert.equal(encodeTransactionWith({ id: 'not-an-id' }).type, 'invalid');
		assert.equal(encodeTransactionWith({
			actor: { type: 'human', id: '' },
		}).type, 'invalid');
		assert.equal(encodeTransactionWith({
			actor: { type: 'human', id: 'x'.repeat(513) },
		}).type, 'invalid');
		assert.equal(encodeTransactionWith({
			actor: { type: 'human', id: 'reviewer', role: 'forbidden' },
		}).type, 'invalid');
		assert.equal(encodeTransactionWith({
			actor: { type: 'system', id: 'service', role: 'unknown' },
		}).type, 'invalid');
		assert.equal(encodeTransactionWith({
			createdAt: '2026-07-16T12:00:00Z',
		}).type, 'invalid');
		assert.equal(encodeTransactionWith({
			preconditions: [
				requiredPreconditions[0],
				{
					kind: 'schema-version',
					expectedSchemaVersion: 'x'.repeat(129),
				},
			],
		}).type, 'invalid');

		const persisted = encode(baseTransaction);
		assertInvalidReason(decodePersistedTransactionV1({
			...persisted,
			extra: true,
		}), 'invalid-envelope');
		assertInvalidReason(decodePersistedTransactionV1({
			...persisted,
			formatVersion: 2,
		}), 'unsupported-version');
		assertInvalidReason(decodePersistedTransactionV1({
			...persisted,
			transaction: {
				...persisted.transaction,
				intent: 'forbidden',
			},
		}), 'invalid-transaction');
		assertInvalidReason(decodePersistedTransactionV1({
			...persisted,
			transaction: {
				...persisted.transaction,
				resource: `${resource.toString(true)}/noncanonical`,
			},
		}), 'invalid-transaction');
	});

	test('inspects descriptors without invoking accessors or inherited array methods', () => {
		let getterCalls = 0;
		const runtime: Record<string, unknown> = {
			...baseTransaction,
		};
		Object.defineProperty(runtime, 'metadata', {
			enumerable: true,
			get() {
				getterCalls += 1;
				return { source: 'human-input' };
			},
		});
		assertInvalidReason(encodePersistedTransactionV1(runtime), 'inspection-failed');
		assert.equal(getterCalls, 0);

		const persisted = encode(baseTransaction);
		const persistedWithGetter: Record<string, unknown> = {
			...persisted,
		};
		Object.defineProperty(persistedWithGetter, 'transaction', {
			enumerable: true,
			get() {
				getterCalls += 1;
				return persisted.transaction;
			},
		});
		assertInvalidReason(
			decodePersistedTransactionV1(persistedWithGetter),
			'inspection-failed',
		);
		assert.equal(getterCalls, 0);

		const operations = [replaceTextOperation];
		Object.setPrototypeOf(operations, {
			map() {
				throw new Error('must not call inherited map');
			},
		});
		assertInvalidReason(
			encodeTransactionWith({ operations }),
			'inspection-failed',
		);

		const sparseOperations = new Array<Operation>(1);
		assertInvalidReason(
			encodeTransactionWith({ operations: sparseOperations }),
			'inspection-failed',
		);

		const revoked = Proxy.revocable({ ...baseTransaction }, {});
		revoked.revoke();
		assertInvalidReason(
			encodePersistedTransactionV1(revoked.proxy),
			'inspection-failed',
		);
	});

	test('enforces operation, precondition, depth, value, and UTF-8 budgets', () => {
		const tooManyOperations = Array.from(
			{ length: maximumTransactionOperations + 1 },
			(_, index) => ({
				...replaceTextOperation,
				id: operationId(uuid(1_000 + index)),
			}),
		);
		assertInvalidReason(
			encodeTransactionWith({ operations: tooManyOperations }),
			'resource-limit-exceeded',
		);

		const tooManyPreconditions = Array.from(
			{ length: maximumTransactionPreconditions + 1 },
			(_, index): TransactionPrecondition => ({
				kind: 'node-exists',
				nodeId: nodeId(uuid(3_000 + index)),
			}),
		);
		tooManyPreconditions[0] = requiredPreconditions[0]!;
		tooManyPreconditions[1] = requiredPreconditions[1]!;
		assertInvalidReason(
			encodeTransactionWith({ preconditions: tooManyPreconditions }),
			'resource-limit-exceeded',
		);

		const persisted = encode(baseTransaction);
		let deep: unknown = true;
		for (let index = 0; index < 300; index += 1) {
			deep = { child: deep };
		}
		assertInvalidReason(decodePersistedTransactionV1({
			...persisted,
			deep,
		}), 'resource-limit-exceeded');

		assertInvalidReason(decodePersistedTransactionV1({
			...persisted,
			values: Array.from(
				{ length: maximumTransactionJsonValues },
				() => null,
			),
		}), 'resource-limit-exceeded');

		assertInvalidReason(encodeTransactionWith({
			operations: [{
				...replaceTextOperation,
				replacement: 'x'.repeat(maximumPersistedTransactionUtf8Bytes),
			}],
		}), 'resource-limit-exceeded');

		const largeReplacement = 'x'.repeat(8 * 1_024 * 1_024);
		assertInvalidReason(encodeTransactionWith({
			operations: [
				{
					...replaceTextOperation,
					replacement: largeReplacement,
				},
				{
					...replaceTextOperation,
					id: operationId(uuid(5)),
					replacement: largeReplacement,
				},
			],
		}), 'resource-limit-exceeded');
	});

	test('hashes the entire persisted envelope with the portable transaction domain', () => {
		const persisted = encode(baseTransaction);
		const result = hashPersistedTransactionV1(persisted);
		if (result.type === 'invalid') {
			assert.fail(`Expected a valid transaction hash: ${result.reason}.`);
		}
		const canonical = serializeCanonicalJson(persisted);
		if (canonical.type === 'error') {
			assert.fail(`Expected canonical transaction JSON at ${canonical.error.path}.`);
		}
		const preimage =
			`${manuscriptHashPreimagePrefix}${manuscriptHashDomains.transaction}\0${canonical.value}`;
		const oracle = `sha256:${createHash('sha256').update(preimage, 'utf8').digest('hex')}`;

		assert.equal(result.hash, oracle);
		assert.equal(
			result.hash,
			'sha256:8fce9acb59b1f2f4aeeb5095ac8b27b6ec10d7c11351266ed46b24dc4c96df42',
		);
		assert.deepStrictEqual(Object.keys(result).sort(), ['hash', 'type']);

		const changed = encode({
			...baseTransaction,
			metadata: {
				source: 'command',
			},
		});
		const changedHash = hashPersistedTransactionV1(changed);
		assert.equal(changedHash.type, 'valid');
		if (changedHash.type === 'valid') {
			assert.notEqual(changedHash.hash, result.hash);
		}
	});

	test('binds Claim Anchors to the transaction resource and preserves nested URIs', () => {
		const claimOperation = createClaimOperation(otherResource);
		assertInvalidReason(
			encodeTransactionWith({ operations: [claimOperation] }),
			'invalid-operation',
		);

		const foreignEnvelope = encodeOperation(claimOperation, otherResource);
		const persisted = encode(baseTransaction);
		assertInvalidReason(decodePersistedTransactionV1({
			...persisted,
			transaction: {
				...persisted.transaction,
				operations: [foreignEnvelope],
			},
		}), 'invalid-operation');

		const local = decode(encode({
			...baseTransaction,
			operations: [createClaimOperation(resource)],
		}));
		const localOperation = local.operations[0];
		assert.equal(localOperation.type, 'create-academic-entity');
		if (
			localOperation.type === 'create-academic-entity'
			&& localOperation.entity.type === 'claim'
		) {
			assert.equal(Object.isFrozen(localOperation.entity), true);
			assert.equal(Object.isFrozen(localOperation.entity.anchor), true);
			assert.equal(Object.isFrozen(localOperation.entity.anchor.document), true);
			assert.equal(
				Object.isFrozen(localOperation.entity.anchor.document.resource),
				false,
			);
		}
	});
});

function encode(value: unknown): IPersistedTransactionV1 {
	const result = encodePersistedTransactionV1(value);
	if (result.type === 'invalid') {
		assert.fail(`Expected a valid transaction: ${result.reason} at ${result.path}.`);
	}
	return result.value;
}

function decode(value: unknown): Transaction {
	const result = decodePersistedTransactionV1(value);
	if (result.type === 'invalid') {
		assert.fail(`Expected a valid transaction: ${result.reason} at ${result.path}.`);
	}
	return result.value;
}

function encodeOperation(
	value: unknown,
	expectedResource: URI,
): IPersistedOperationV1 {
	const result = encodePersistedOperationV1(value, expectedResource);
	if (result.type === 'invalid') {
		assert.fail(`Expected a valid operation: ${result.reason} at ${result.path}.`);
	}
	return result.value;
}

function encodeTransactionWith(
	changes: Readonly<Record<string, unknown>>,
): ReturnType<typeof encodePersistedTransactionV1> {
	return encodePersistedTransactionV1({
		...baseTransaction,
		...changes,
	});
}

function assertInvalidReason(
	result:
		| ReturnType<typeof encodePersistedTransactionV1>
		| ReturnType<typeof decodePersistedTransactionV1>,
	reason: string,
): void {
	assert.equal(result.type, 'invalid');
	if (result.type === 'invalid') {
		assert.equal(result.reason, reason);
	}
}

function assertNoRuntimeUri(value: unknown): void {
	assert.equal(value instanceof URI, false);
	if (Array.isArray(value)) {
		for (const item of value) {
			assertNoRuntimeUri(item);
		}
		return;
	}
	if (value !== null && typeof value === 'object') {
		for (const item of Object.values(value)) {
			assertNoRuntimeUri(item);
		}
	}
}

function createClaimOperation(anchorResource: URI): Operation {
	return {
		id: operationId(uuid(31)),
		type: 'create-academic-entity',
		entity: {
			id: entityId(uuid(30)),
			type: 'claim',
			anchor: {
				document: {
					resource: anchorResource,
					revisionId: baseRevisionId,
				},
				primary: {
					kind: 'text',
					textNodeId,
					utf16Offset: offset(2),
					affinity: 'after',
				},
				targetNodeId: textNodeId,
				textQuote: {
					exact: 'Claim',
				},
				pathHint: [textNodeId],
			},
			textSnapshot: 'Claim',
		},
	};
}

function canonicalRecord(
	value: unknown,
): Readonly<Record<string, CanonicalJsonValue>> {
	assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value));
	return value as Readonly<Record<string, CanonicalJsonValue>>;
}

function createPrototypeKeyCslJson(): Readonly<Record<string, CanonicalJsonValue>> {
	const nested = Object.create(null) as Record<string, CanonicalJsonValue>;
	nested['polluted'] = 'contained';
	const cslJson = Object.create(null) as Record<string, CanonicalJsonValue>;
	Object.defineProperty(cslJson, '__proto__', {
		value: nested,
		enumerable: true,
		configurable: true,
		writable: true,
	});
	cslJson['title'] = 'Prototype-safe reference';
	return cslJson;
}

function assertSafePrototypeKeyRecord(
	value: Readonly<Record<string, CanonicalJsonValue>>,
): void {
	assert.equal(Object.getPrototypeOf(value), Object.prototype);
	assert.equal(Object.hasOwn(value, '__proto__'), true);
	const nested = canonicalRecord(value['__proto__']);
	assert.equal(Object.getPrototypeOf(nested), Object.prototype);
	assert.equal(nested['polluted'], 'contained');
	assert.equal(({} as { readonly polluted?: unknown }).polluted, undefined);
}

function uuid(suffix: number): string {
	return `018f0000-0000-7000-8000-${suffix.toString().padStart(12, '0')}`;
}

function uuidV8(suffix: number): string {
	return `018f0000-0000-8000-8000-${suffix.toString().padStart(12, '0')}`;
}

function operationId(value: string): OperationId {
	const parsed = parseOperationId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Operation ID.');
	}
	return parsed.value;
}

function transactionId(value: string): TransactionId {
	const parsed = parseTransactionId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Transaction ID.');
	}
	return parsed.value;
}

function revisionId(value: string): RevisionId {
	const parsed = parseRevisionId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Revision ID.');
	}
	return parsed.value;
}

function nodeId(value: string): NodeId {
	const parsed = parseNodeId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Node ID.');
	}
	return parsed.value;
}

function entityId(value: string): EntityId {
	const parsed = parseEntityId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Entity ID.');
	}
	return parsed.value;
}

function proposalId(value: string): ProposalId {
	const parsed = parseProposalId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Proposal ID.');
	}
	return parsed.value;
}

function proposalChangeGroupId(value: string): ProposalChangeGroupId {
	const parsed = parseProposalChangeGroupId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Proposal Change Group ID.');
	}
	return parsed.value;
}

function contentHash(value: string): ContentHash {
	const parsed = parseContentHash(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid content hash.');
	}
	return parsed.value;
}

function offset(value: number): Utf16Offset {
	const parsed = parseUtf16Offset(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid UTF-16 offset.');
	}
	return parsed.value;
}
