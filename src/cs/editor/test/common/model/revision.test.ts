/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { serializeCanonicalJson } from 'cs/editor/common/core/canonicalJson';
import {
	parseContentHash,
	parseNodeId,
	parseOperationId,
	parseRevisionId,
	parseTransactionId,
	type ContentHash,
	type NodeId,
	type OperationId,
	type RevisionId,
	type TransactionId,
} from 'cs/editor/common/core/identifiers';
import { createManuscriptDraftResource } from 'cs/editor/common/core/manuscriptResource';
import {
	parseUtf16Offset,
	type Utf16Offset,
} from 'cs/editor/common/core/semanticPosition';
import type { ActorRef } from 'cs/editor/common/model/actor';
import type { ReplaceTextOperation } from 'cs/editor/common/model/operation';
import {
	crc32,
	decodePersistedRevisionV1,
	decodePersistedRevisionWalRecordV1,
	decodeRevisionWalRecordStreamV1,
	encodePersistedRevisionV1,
	encodeRevisionWalRecordV1,
	maximumRevisionWalDecoderChunkByteLength,
	maximumRevisionWalFrameByteLength,
	maximumRevisionWalPayloadByteLength,
	maximumRevisionWalWrapperUtf8Bytes,
	persistedRevisionFormat,
	persistedRevisionFormatVersion,
	persistedRevisionWalRecordFormat,
	persistedRevisionWalRecordFormatVersion,
	revisionWalFrameHeaderByteLength,
	revisionWalFrameMagic,
	RevisionWalStreamDecoderV1,
	type IRevisionWalCorruption,
	type IPersistedRevisionWalRecordV1,
	type Revision,
	type RevisionWalDecodeResult,
	type RevisionWalRecord,
} from 'cs/editor/common/model/revision';
import {
	encodePersistedTransactionV1,
	hashPersistedTransactionV1,
	maximumPersistedTransactionUtf8Bytes,
	type IPersistedTransactionV1,
	type Transaction,
} from 'cs/editor/common/model/transaction';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const hashA = contentHash(
	'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
);
const hashB = contentHash(
	'sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
);
const resource = createManuscriptDraftResource(uuid(900));
const parentRevisionIdentifier = revisionId(uuid(1));
const revisionIdentifier = revisionId(uuid(2));
const transactionIdentifier = transactionId(uuid(3));
const actor: ActorRef = Object.freeze({
	type: 'human',
	id: 'reviewer-1',
});
const createdAt = '2026-07-17T12:00:00.000Z';

const operation: ReplaceTextOperation = Object.freeze({
	id: operationId(uuid(4)),
	type: 'replace-text',
	textNodeId: nodeId(uuid(5)),
	expectedNodeHash: hashA,
	startUtf16Offset: offset(0),
	endUtf16Offset: offset(0),
	replacement: 'Durable text.',
});

const transaction: Transaction = Object.freeze({
	id: transactionIdentifier,
	resource,
	baseRevisionId: parentRevisionIdentifier,
	actor,
	operations: Object.freeze([operation]) as readonly [ReplaceTextOperation],
	preconditions: Object.freeze([
		Object.freeze({
			kind: 'document-hash',
			expectedDocumentHash: hashA,
		}),
		Object.freeze({
			kind: 'schema-version',
			expectedSchemaVersion: 'nireco-manuscript@1',
		}),
	]),
	metadata: Object.freeze({
		source: 'human-input',
	}),
	createdAt,
});

const revision: Revision = Object.freeze({
	id: revisionIdentifier,
	resource,
	parentRevisionId: parentRevisionIdentifier,
	transactionId: transactionIdentifier,
	sequence: 2,
	documentHash: hashB,
	actor,
	createdAt,
});

suite('Revision codec', () => {
	test('round-trips the exact closed V1 Revision envelope', () => {
		const encoded = encodePersistedRevisionV1(revision);
		if (encoded.type === 'invalid') {
			assert.fail(`${encoded.reason} at ${encoded.path}`);
		}

		assert.deepStrictEqual(Object.keys(encoded.value).sort(), [
			'format',
			'formatVersion',
			'revision',
		]);
		assert.deepStrictEqual(Object.keys(encoded.value.revision).sort(), [
			'actor',
			'createdAt',
			'documentHash',
			'id',
			'parentRevisionId',
			'resource',
			'sequence',
			'transactionId',
		]);
		assert.equal(encoded.value.format, persistedRevisionFormat);
		assert.equal(
			encoded.value.formatVersion,
			persistedRevisionFormatVersion,
		);
		assert.equal(encoded.value.revision.resource, resource.toString());
		assert.equal(Object.isFrozen(encoded.value), true);
		assert.equal(Object.isFrozen(encoded.value.revision), true);
		assert.equal(Object.isFrozen(encoded.value.revision.actor), true);

		const decoded = decodePersistedRevisionV1(encoded.value);
		if (decoded.type === 'invalid') {
			assert.fail(`${decoded.reason} at ${decoded.path}`);
		}
		assert.equal(decoded.value.id, revision.id);
		assert.equal(decoded.value.resource.toString(), resource.toString());
		assert.equal(decoded.value.parentRevisionId, revision.parentRevisionId);
		assert.equal(Object.isFrozen(decoded.value), true);
		assert.equal(Object.isFrozen(decoded.value.actor), true);
		assert.equal(Object.isFrozen(decoded.value.resource), false);
	});

	test('enforces the genesis and successor parent/sequence pairing', () => {
		const initial = encodePersistedRevisionV1({
			...revision,
			parentRevisionId: null,
			sequence: 1,
		});
		assert.equal(initial.type, 'valid');

		for (const changed of [
			{
				...revision,
				parentRevisionId: null,
				sequence: 2,
			},
			{
				...revision,
				sequence: 1,
			},
			{
				...revision,
				sequence: 0,
			},
			{
				...revision,
				extension: true,
			},
		]) {
			assert.equal(encodePersistedRevisionV1(changed).type, 'invalid');
		}

		let getterCalls = 0;
		const withGetter = {
			...revision,
			get sequence(): number {
				getterCalls += 1;
				return 1;
			},
		};
		assert.deepStrictEqual(encodePersistedRevisionV1(withGetter), {
			type: 'invalid',
			reason: 'inspection-failed',
			path: '$',
		});
		assert.equal(getterCalls, 0);

		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		assert.deepStrictEqual(encodePersistedRevisionV1(revoked.proxy), {
			type: 'invalid',
			reason: 'inspection-failed',
			path: '$',
		});
	});
});

suite('Revision WAL record codec', () => {
	test('round-trips exact canonical V1 payload with big-endian length and IEEE CRC-32', () => {
		assert.equal(
			crc32(textEncoder.encode('123456789')),
			0xcbf43926,
		);
		const record = createRecord();
		const encoded = encode(record);
		assert.equal(
			readUint32BigEndian(encoded.bytes, 0),
			revisionWalFrameMagic,
		);
		assert.equal(
			readUint32BigEndian(encoded.bytes, 4),
			encoded.bytes.byteLength - revisionWalFrameHeaderByteLength,
		);
		assert.equal(
			readUint32BigEndian(encoded.bytes, 8),
			crc32(encoded.bytes.subarray(revisionWalFrameHeaderByteLength)),
		);
		assert.equal(
			readUint32BigEndian(encoded.bytes, 12),
			crc32(encoded.bytes.subarray(0, 12)),
		);
		assert.equal(encoded.payload.format, persistedRevisionWalRecordFormat);
		assert.equal(
			encoded.payload.formatVersion,
			persistedRevisionWalRecordFormatVersion,
		);
		assert.deepStrictEqual(Object.keys(encoded.payload).sort(), [
			'format',
			'formatVersion',
			'revision',
			'transaction',
			'transactionHash',
		]);
		assert.equal(
			encoded.payload.transaction.format,
			'nireco-transaction',
		);
		assert.equal(Object.isFrozen(encoded.payload), true);
		const decodedPayload = decodePersistedRevisionWalRecordV1(
			encoded.payload,
		);
		if (decodedPayload.type === 'invalid') {
			assert.fail(`${decodedPayload.reason} at ${decodedPayload.path}`);
		}
		assert.equal(decodedPayload.value.revision.id, revision.id);
		assert.deepStrictEqual(decodedPayload.persisted, encoded.payload);

		const decoded = decode(encoded.bytes);
		assert.equal(decoded.incompleteTail, false);
		assert.equal(decoded.lastCompleteOffset, encoded.bytes.byteLength);
		assert.equal(decoded.records.length, 1);
		const decodedRecord = decoded.records[0]!;
		assert.equal(decodedRecord.revision.id, revision.id);
		assert.equal(decodedRecord.transaction.id, transaction.id);
		assert.equal(decodedRecord.transactionHash, record.transactionHash);
		for (const value of [
			decoded.records,
			decodedRecord,
			decodedRecord.revision,
			decodedRecord.revision.actor,
			decodedRecord.transaction,
			decodedRecord.transaction.actor,
			decodedRecord.transaction.operations,
			decodedRecord.transaction.operations[0],
		]) {
			assert.equal(Object.isFrozen(value), true);
		}
	});

	test('protects magic, length, payload checksum, and the complete header checksum', () => {
		const frame = encode(createRecord()).bytes;
		for (const [offset, reason] of [
			[0, 'invalid-magic'],
			[7, 'header-checksum-mismatch'],
			[11, 'header-checksum-mismatch'],
			[15, 'header-checksum-mismatch'],
		] as const) {
			const changed = frame.slice();
			changed[offset] ^= 1;
			assertCorrupt(
				decodeRevisionWalRecordStreamV1(changed),
				reason,
				0,
			);
		}
	});

	test('detaches persisted/runtime output from caller-owned records and bytes', () => {
		const mutableActor = {
			type: 'human' as const,
			id: 'caller-owned',
		};
		const mutableTransaction = {
			...transaction,
			actor: mutableActor,
		};
		const mutableRevision = {
			...revision,
			actor: mutableActor,
		};
		const transactionHash = hashTransaction(mutableTransaction);
		const encoded = encode({
			revision: mutableRevision,
			transactionHash,
			transaction: mutableTransaction,
		});
		const originalBytes = encoded.bytes.slice();

		mutableActor.id = 'mutated';
		assert.equal(encoded.payload.revision.revision.actor.id, 'caller-owned');
		assert.equal(encoded.payload.transaction.transaction.actor.id, 'caller-owned');
		assert.deepStrictEqual(encoded.bytes, originalBytes);

		const source = encoded.bytes.slice();
		const decoded = decode(source);
		source.fill(0);
		assert.equal(decoded.records[0]?.revision.actor.id, 'caller-owned');
	});

	test('rejects invalid nested Transaction, hash mismatch, and every Revision context mismatch', () => {
		const record = createRecord();
		assertInvalidWal({
			...record,
			transactionHash: hashB,
		}, 'transaction-hash-mismatch');
		assertInvalidWal({
			...record,
			revision: {
				...revision,
				sequence: 0,
			},
		}, 'invalid-revision');
		assertInvalidWal({
			...record,
			transaction: {
				...transaction,
				extension: true,
			},
		}, 'invalid-transaction');

		const otherActor: ActorRef = {
			type: 'agent',
			id: 'agent-1',
		};
		for (const changedRevision of [
			{
				...revision,
				transactionId: transactionId(uuid(50)),
			},
			{
				...revision,
				parentRevisionId: revisionId(uuid(51)),
			},
			{
				...revision,
				resource: createManuscriptDraftResource(uuid(901)),
			},
			{
				...revision,
				actor: otherActor,
			},
			{
				...revision,
				createdAt: '2026-07-17T12:00:01.000Z',
			},
		]) {
			assertInvalidWal({
				...record,
				revision: changedRevision,
			}, 'revision-transaction-mismatch');
		}
	});

	test('rejects extra keys, accessors, and revoked proxies without invoking caller code', () => {
		assertInvalidWal({
			...createRecord(),
			extension: true,
		}, 'invalid-record');

		let getterCalls = 0;
		const getterRecord = {
			revision,
			transactionHash: createRecord().transactionHash,
			get transaction(): Transaction {
				getterCalls += 1;
				return transaction;
			},
		};
		assertInvalidWal(getterRecord, 'inspection-failed');
		assert.equal(getterCalls, 0);

		const revoked = Proxy.revocable({}, {});
		revoked.revoke();
		assertInvalidWal(revoked.proxy, 'inspection-failed');
		assert.deepStrictEqual(
			decodePersistedRevisionWalRecordV1(revoked.proxy),
			{
				type: 'invalid',
				reason: 'inspection-failed',
				path: '$',
			},
		);
	});

	test('rejects 500,000 top-level keys before descriptor capture', {
		timeout: 120_000,
	}, () => {
		let getterCalls = 0;
		const huge: Record<string, unknown> = Object.create(null);
		Object.defineProperty(huge, 'key-0', {
			get(): number {
				getterCalls += 1;
				return 0;
			},
			enumerable: true,
			configurable: true,
		});
		for (let index = 1; index < 500_000; index += 1) {
			huge[`key-${index}`] = index;
		}

		assert.deepStrictEqual(encodePersistedRevisionV1(huge), {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
		});
		assert.deepStrictEqual(encodeRevisionWalRecordV1(huge), {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
		});
		assert.deepStrictEqual(
			decodePersistedRevisionWalRecordV1(huge),
			{
				type: 'invalid',
				reason: 'resource-limit-exceeded',
				path: '$',
			},
		);
		assert.equal(getterCalls, 0);
	});

	test('captures exact Proxy data fields once and rejects oversized ownKeys before descriptor traps', () => {
		const runtime = createRecord();
		let exactOwnKeysTraps = 0;
		let exactDescriptorTraps = 0;
		let exactGetTraps = 0;
		const exactProxy = new Proxy(runtime, {
			ownKeys(target): ArrayLike<string | symbol> {
				exactOwnKeysTraps += 1;
				return Reflect.ownKeys(target);
			},
			getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
				exactDescriptorTraps += 1;
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
			get(target, key, receiver): unknown {
				exactGetTraps += 1;
				return Reflect.get(target, key, receiver);
			},
		});
		assert.equal(encodeRevisionWalRecordV1(exactProxy).type, 'valid');
		assert.equal(exactOwnKeysTraps, 1);
		assert.equal(exactDescriptorTraps, 3);
		assert.equal(exactGetTraps, 0);

		const persisted = encode(runtime).payload;
		let persistedDescriptorTraps = 0;
		let persistedGetTraps = 0;
		const persistedProxy = new Proxy(persisted, {
			ownKeys(target): ArrayLike<string | symbol> {
				return Reflect.ownKeys(target);
			},
			getOwnPropertyDescriptor(target, key): PropertyDescriptor | undefined {
				persistedDescriptorTraps += 1;
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
			get(target, key, receiver): unknown {
				persistedGetTraps += 1;
				return Reflect.get(target, key, receiver);
			},
		});
		assert.equal(
			decodePersistedRevisionWalRecordV1(persistedProxy).type,
			'valid',
		);
		assert.equal(persistedDescriptorTraps, 5);
		assert.equal(persistedGetTraps, 0);

		let wrongDescriptorTraps = 0;
		const wrongShapeProxy = new Proxy(Object.create(null) as object, {
			ownKeys(): ArrayLike<string | symbol> {
				return ['revision', 'transactionHash', 'wrong'];
			},
			getOwnPropertyDescriptor(): PropertyDescriptor | undefined {
				wrongDescriptorTraps += 1;
				return undefined;
			},
		});
		assertInvalidWal(wrongShapeProxy, 'invalid-record');
		assert.equal(wrongDescriptorTraps, 0);

		let symbolDescriptorTraps = 0;
		const symbolShapeProxy = new Proxy(Object.create(null) as object, {
			ownKeys(): ArrayLike<string | symbol> {
				return [
					'revision',
					'transactionHash',
					Symbol('transaction'),
				];
			},
			getOwnPropertyDescriptor(): PropertyDescriptor | undefined {
				symbolDescriptorTraps += 1;
				return undefined;
			},
		});
		assertInvalidWal(symbolShapeProxy, 'inspection-failed');
		assert.equal(symbolDescriptorTraps, 0);

		let oversizedDescriptorTraps = 0;
		let oversizedPrototypeTraps = 0;
		let oversizedGetTraps = 0;
		const oversizedKeys = Array.from(
			{ length: 33 },
			(_, index) => `key-${index}`,
		);
		const oversizedProxy = new Proxy(Object.create(null) as object, {
			ownKeys(): ArrayLike<string | symbol> {
				return oversizedKeys;
			},
			getOwnPropertyDescriptor(): PropertyDescriptor | undefined {
				oversizedDescriptorTraps += 1;
				return undefined;
			},
			getPrototypeOf(): object | null {
				oversizedPrototypeTraps += 1;
				return null;
			},
			get(): unknown {
				oversizedGetTraps += 1;
				return undefined;
			},
		});
		assert.deepStrictEqual(encodeRevisionWalRecordV1(oversizedProxy), {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
		});
		assert.equal(oversizedDescriptorTraps, 0);
		assert.equal(oversizedPrototypeTraps, 0);
		assert.equal(oversizedGetTraps, 0);
	});

	test('rejects non-canonical whitespace, key order, and duplicate keys after checksum validation', () => {
		const encoded = encode(createRecord());
		const canonical = textDecoder.decode(
			encoded.bytes.subarray(revisionWalFrameHeaderByteLength),
		);
		for (const text of [
			` ${canonical}`,
			`{\n${canonical.slice(1)}`,
			canonical.replace(
				'{"format":',
				'{"formatVersion":1,"format":',
			).replace(
				',"formatVersion":1',
				'',
			),
			canonical.replace(
				'{"format":',
				`{"format":"${persistedRevisionWalRecordFormat}","format":`,
			),
		]) {
			const result = decodeRevisionWalRecordStreamV1(frameText(text));
			assertCorrupt(result, 'non-canonical-payload', 0);
		}
	});

	test('distinguishes checksum, UTF-8, JSON, codec, and hash corruption', () => {
		const encoded = encode(createRecord());
		const flipped = encoded.bytes.slice();
		flipped[flipped.byteLength - 1] ^= 1;
		assertCorrupt(
			decodeRevisionWalRecordStreamV1(flipped),
			'checksum-mismatch',
			0,
		);

		assertCorrupt(
			decodeRevisionWalRecordStreamV1(frameBytes(
				Uint8Array.from([0xc3, 0x28]),
			)),
			'invalid-utf8',
			0,
		);
		assertCorrupt(
			decodeRevisionWalRecordStreamV1(frameText('{')),
			'invalid-json',
			0,
		);

		const payload = clonePayload(encoded.payload);
		payload.revision.revision.documentHash = 'not-a-hash';
		assertCorrupt(
			decodeRevisionWalRecordStreamV1(frameCanonical(payload)),
			'invalid-record',
			0,
		);

		const extraRecord = {
			...clonePayload(encoded.payload),
			extension: true,
		};
		assertCorrupt(
			decodeRevisionWalRecordStreamV1(frameCanonical(extraRecord)),
			'invalid-record',
			0,
		);

		const invalidTransaction = clonePayload(encoded.payload);
		invalidTransaction.transaction = {
			...encoded.payload.transaction,
			transaction: {
				...encoded.payload.transaction.transaction,
				extension: true,
			},
		} as unknown as IPersistedTransactionV1;
		assertCorrupt(
			decodeRevisionWalRecordStreamV1(
				frameCanonical(invalidTransaction),
			),
			'invalid-transaction',
			0,
		);

		const hashMismatch = clonePayload(encoded.payload);
		hashMismatch.transactionHash = hashB;
		assertCorrupt(
			decodeRevisionWalRecordStreamV1(frameCanonical(hashMismatch)),
			'transaction-hash-mismatch',
			0,
		);
	});

	test('reports legal partial header/payload tails at the last complete frame', () => {
		const first = encode(createRecord(0)).bytes;
		const second = encode(createRecord(10)).bytes;
		for (const partial of [
			second.subarray(0, 1),
			second.subarray(0, revisionWalFrameHeaderByteLength - 1),
			second.subarray(0, revisionWalFrameHeaderByteLength),
			second.subarray(0, second.byteLength - 1),
		]) {
			const result = decodeRevisionWalRecordStreamV1(
				concatenate(first, partial),
			);
			assert.equal(result.type, 'valid');
			if (result.type !== 'valid') {
				continue;
			}
			assert.equal(result.incompleteTail, true);
			assert.equal(result.lastCompleteOffset, first.byteLength);
			assert.equal(result.records.length, 1);
		}
	});

	test('never treats an invalid middle checksum or length with a later canonical frame as tail', () => {
		const first = encode(createRecord(0)).bytes;
		const second = encode(createRecord(10)).bytes;
		const third = encode(createRecord(20)).bytes;

		const checksumCorruption = concatenate(first, second, third);
		checksumCorruption[
			first.byteLength + revisionWalFrameHeaderByteLength
		] ^= 1;
		const checksumResult = decodeRevisionWalRecordStreamV1(
			checksumCorruption,
		);
		assertCorrupt(
			checksumResult,
			'checksum-mismatch',
			first.byteLength,
		);
		assert.equal(
			(checksumResult as IRevisionWalCorruption).lastCompleteOffset,
			first.byteLength,
		);

		const lengthCorruption = concatenate(first, second, third);
		writeProtectedHeader(
			lengthCorruption,
			lengthCorruption.byteLength,
			readUint32BigEndian(
				lengthCorruption,
				first.byteLength + 8,
			),
			first.byteLength,
		);
		const lengthResult = decodeRevisionWalRecordStreamV1(lengthCorruption);
		assertCorrupt(lengthResult, 'invalid-length', first.byteLength);
		assert.equal(
			(lengthResult as IRevisionWalCorruption).records.length,
			1,
		);

		const decoder = new RevisionWalStreamDecoderV1();
		const progress = decoder.append(lengthCorruption);
		assert.equal(progress.type, 'valid');
		const instrumented = decoder.finish();
		assertCorrupt(instrumented, 'invalid-length', first.byteLength);
		const metrics = decoder.getMetrics();
		assert.equal(metrics.resynchronizationCandidateCount, 1);
		assert.equal(
			metrics.resynchronizationChecksumByteLength,
			third.byteLength - revisionWalFrameHeaderByteLength,
		);
		assert.equal(
			metrics.resynchronizationScannedByteLength
				<= lengthCorruption.byteLength - first.byteLength,
			true,
		);
		assert.equal(
			metrics.maximumPendingByteLength
				<= maximumRevisionWalFrameByteLength,
			true,
		);
	});

	test('bounds resynchronization candidate work even for zero-length payload candidates', () => {
		const candidate = new Uint8Array(
			revisionWalFrameHeaderByteLength,
		);
		writeProtectedHeader(candidate, 0, crc32(new Uint8Array(0)));
		const candidateCount = 4_097;
		const pendingPayload = new Uint8Array(
			candidate.byteLength * candidateCount,
		);
		for (let index = 0; index < candidateCount; index += 1) {
			pendingPayload.set(candidate, index * candidate.byteLength);
		}
		const incompleteHeader = new Uint8Array(
			revisionWalFrameHeaderByteLength,
		);
		writeProtectedHeader(
			incompleteHeader,
			pendingPayload.byteLength + 1,
			0,
		);
		const decoder = new RevisionWalStreamDecoderV1();
		const progress = decoder.append(concatenate(
			incompleteHeader,
			pendingPayload,
		));
		assert.equal(progress.type, 'valid');
		assertCorrupt(
			decoder.finish(),
			'resynchronization-budget-exceeded',
			0,
		);
		const metrics = decoder.getMetrics();
		assert.equal(metrics.resynchronizationCandidateCount, candidateCount);
		assert.equal(metrics.resynchronizationChecksumByteLength, 0);
		assert.equal(
			metrics.resynchronizationScannedByteLength
				<= pendingPayload.byteLength,
			true,
		);
	});

	test('decodes concatenated records across arbitrary chunks and owns decoder progress', () => {
		const first = encode(createRecord(0)).bytes;
		const second = encode(createRecord(10)).bytes;
		const bytes = concatenate(first, second);
		const decoder = new RevisionWalStreamDecoderV1();
		const records: RevisionWalRecord[] = [];
		const emptyProgress = decoder.append(new Uint8Array(0));
		assert.equal(emptyProgress.type, 'valid');
		assert.deepStrictEqual(decoder.getMetrics(), {
			receivedByteLength: 0,
			copiedByteLength: 0,
			maximumPendingByteLength: 0,
			maximumPendingCapacityByteLength:
				revisionWalFrameHeaderByteLength,
			resynchronizationScannedByteLength: 0,
			resynchronizationCandidateCount: 0,
			resynchronizationChecksumByteLength: 0,
		});
		for (let index = 0; index < bytes.byteLength; index += 1) {
			const chunk = bytes.slice(index, index + 1);
			const progress = decoder.append(chunk);
			assert.notEqual(progress.type, 'invalid');
			if (progress.type === 'invalid' || progress.type === 'corrupt') {
				assert.fail('Expected valid incremental WAL progress.');
			}
			records.push(...progress.records);
			chunk.fill(0);
		}
		const finished = decoder.finish();
		assert.equal(finished.type, 'valid');
		if (finished.type !== 'valid') {
			return;
		}
		assert.equal(finished.incompleteTail, false);
		assert.equal(finished.lastCompleteOffset, bytes.byteLength);
		assert.equal(records.length, 2);
		assert.equal(records[0]?.revision.sequence, 2);
		assert.equal(records[1]?.revision.sequence, 12);
		const metrics = decoder.getMetrics();
		assert.equal(metrics.receivedByteLength, bytes.byteLength);
		assert.equal(metrics.copiedByteLength, bytes.byteLength);
		assert.equal(
			metrics.maximumPendingByteLength,
			Math.max(first.byteLength, second.byteLength),
		);
		assert.equal(
			metrics.maximumPendingCapacityByteLength,
			Math.max(first.byteLength, second.byteLength),
		);
		assert.equal(metrics.resynchronizationScannedByteLength, 0);
		assert.equal(metrics.resynchronizationCandidateCount, 0);
		assert.equal(metrics.resynchronizationChecksumByteLength, 0);
		assert.deepStrictEqual(decoder.finish(), {
			type: 'invalid',
			reason: 'decoder-finished',
			path: '$bytes',
		});
	});

	test('enforces absolute frame and chunk bounds', () => {
		const oversizedHeader = new Uint8Array(
			revisionWalFrameHeaderByteLength,
		);
		writeProtectedHeader(
			oversizedHeader,
			maximumRevisionWalPayloadByteLength + 1,
			0,
		);
		assertCorrupt(
			decodeRevisionWalRecordStreamV1(oversizedHeader),
			'invalid-length',
			0,
		);

		const maximumPartialHeader = new Uint8Array(
			revisionWalFrameHeaderByteLength,
		);
		writeProtectedHeader(
			maximumPartialHeader,
			maximumRevisionWalPayloadByteLength,
			0,
		);
		const partial = decodeRevisionWalRecordStreamV1(
			maximumPartialHeader,
		);
		assert.equal(partial.type, 'valid');
		if (partial.type === 'valid') {
			assert.equal(partial.incompleteTail, true);
		}

		const decoder = new RevisionWalStreamDecoderV1();
		const before = decoder.getMetrics();
		assert.deepStrictEqual(
			decoder.append(new Uint8Array(
				maximumRevisionWalDecoderChunkByteLength + 1,
			)),
			{
				type: 'invalid',
				reason: 'decoder-chunk-too-large',
				path: '$bytes',
			},
		);
		assert.deepStrictEqual(decoder.getMetrics(), before);

		let proxyTrapCount = 0;
		const proxiedBytes = new Proxy(new Uint8Array(1), {
			getPrototypeOf(): object | null {
				proxyTrapCount += 1;
				return Uint8Array.prototype;
			},
		});
		assert.deepStrictEqual(
			decoder.append(proxiedBytes),
			{
				type: 'invalid',
				reason: 'invalid-bytes',
				path: '$bytes',
			},
		);
		assert.equal(proxyTrapCount, 0);
		assert.deepStrictEqual(decoder.getMetrics(), before);
	});

	test('reserves bounded WAL wrapper bytes for every valid near-limit Transaction', {
		timeout: 120_000,
	}, () => {
		const initialLastReplacementLength = 700_000;
		const initialTransaction = createLargeTransaction(
			initialLastReplacementLength,
		);
		const initialPersisted = encodeTransaction(initialTransaction);
		const initialCanonical = serializeCanonicalJson(initialPersisted.value);
		if (initialCanonical.type === 'error') {
			assert.fail('Expected a canonical near-limit Transaction.');
		}
		const targetTransactionBytes =
			maximumPersistedTransactionUtf8Bytes - 16;
		const adjustedLastReplacementLength =
			initialLastReplacementLength
			+ targetTransactionBytes
			- textEncoder.encode(initialCanonical.value).byteLength;
		assert.equal(
			adjustedLastReplacementLength > 0
			&& adjustedLastReplacementLength <= 1_000_000,
			true,
		);

		const nearLimitTransaction = createLargeTransaction(
			adjustedLastReplacementLength,
		);
		const persisted = encodeTransaction(nearLimitTransaction);
		const canonical = serializeCanonicalJson(persisted.value);
		if (canonical.type === 'error') {
			assert.fail('Expected a canonical near-limit Transaction.');
		}
		assert.equal(
			textEncoder.encode(canonical.value).byteLength,
			targetTransactionBytes,
		);
		const result = encodeRevisionWalRecordV1({
			revision,
			transactionHash: hashTransaction(nearLimitTransaction),
			transaction: nearLimitTransaction,
		});
		if (result.type === 'invalid') {
			assert.fail(`${result.reason} at ${result.path}`);
		}
		assert.equal(
			result.bytes.byteLength <= maximumRevisionWalFrameByteLength,
			true,
		);
		assert.equal(
			result.bytes.byteLength
				- revisionWalFrameHeaderByteLength
				- targetTransactionBytes
				<= maximumRevisionWalWrapperUtf8Bytes,
			true,
		);
		const decodedObject = decodePersistedRevisionWalRecordV1(
			result.payload,
		);
		assert.equal(decodedObject.type, 'valid');
	});

	test('decodes 20,000 bounded frames without retaining an unbounded pending frame', {
		timeout: 120_000,
	}, () => {
		const frame = encode(createRecord()).bytes;
		const recordCount = 20_000;
		const bytes = new Uint8Array(frame.byteLength * recordCount);
		for (let index = 0; index < recordCount; index += 1) {
			bytes.set(frame, index * frame.byteLength);
		}

		const decoder = new RevisionWalStreamDecoderV1();
		let decodedRecordCount = 0;
		const chunkByteLength = 64 * 1_024 + 13;
		for (
			let offset = 0;
			offset < bytes.byteLength;
			offset += chunkByteLength
		) {
			const progress = decoder.append(bytes.subarray(
				offset,
				Math.min(bytes.byteLength, offset + chunkByteLength),
			));
			if (progress.type !== 'valid') {
				assert.fail('Expected valid 20,000-frame decoder progress.');
			}
			decodedRecordCount += progress.records.length;
		}
		const finished = decoder.finish();
		if (finished.type !== 'valid') {
			assert.fail('Expected a complete 20,000-frame WAL stream.');
		}
		decodedRecordCount += finished.records.length;
		assert.equal(decodedRecordCount, recordCount);
		assert.equal(finished.lastCompleteOffset, bytes.byteLength);
		assert.equal(finished.incompleteTail, false);

		const metrics = decoder.getMetrics();
		assert.equal(metrics.receivedByteLength, bytes.byteLength);
		assert.equal(metrics.copiedByteLength, bytes.byteLength);
		assert.equal(metrics.maximumPendingByteLength <= frame.byteLength, true);
		assert.equal(
			metrics.maximumPendingCapacityByteLength <= frame.byteLength,
			true,
		);
		assert.equal(metrics.resynchronizationScannedByteLength, 0);
		assert.equal(metrics.resynchronizationCandidateCount, 0);
		assert.equal(metrics.resynchronizationChecksumByteLength, 0);
	});
});

function createRecord(sequenceOffset = 0): RevisionWalRecord {
	const nextOperation: ReplaceTextOperation = sequenceOffset === 0
		? operation
		: {
			...operation,
			id: operationId(uuid(4 + sequenceOffset)),
		};
	const nextTransaction: Transaction = sequenceOffset === 0
		? transaction
		: {
			...transaction,
			id: transactionId(uuid(3 + sequenceOffset)),
			baseRevisionId: revisionId(uuid(1 + sequenceOffset)),
			operations: Object.freeze([nextOperation]) as readonly [
				ReplaceTextOperation,
			],
		};
	const nextRevision: Revision = sequenceOffset === 0
		? revision
		: {
			...revision,
			id: revisionId(uuid(2 + sequenceOffset)),
			parentRevisionId: nextTransaction.baseRevisionId,
			transactionId: nextTransaction.id,
			sequence: 2 + sequenceOffset,
		};
	return Object.freeze({
		revision: nextRevision,
		transactionHash: hashTransaction(nextTransaction),
		transaction: nextTransaction,
	});
}

function encode(record: unknown): Extract<
	ReturnType<typeof encodeRevisionWalRecordV1>,
	{ readonly type: 'valid' }
> {
	const result = encodeRevisionWalRecordV1(record);
	if (result.type === 'invalid') {
		assert.fail(`${result.reason} at ${result.path}`);
	}
	return result;
}

function decode(bytes: Uint8Array): Extract<
	RevisionWalDecodeResult,
	{ readonly type: 'valid' }
> {
	const result = decodeRevisionWalRecordStreamV1(bytes);
	if (result.type !== 'valid') {
		assert.fail('Expected a valid WAL stream.');
	}
	return result;
}

function hashTransaction(value: Transaction): ContentHash {
	const encoded = encodeTransaction(value);
	const hashed = hashPersistedTransactionV1(encoded.value);
	if (hashed.type === 'invalid') {
		assert.fail('Expected a hashable Transaction.');
	}
	return hashed.hash;
}

function encodeTransaction(value: Transaction): Extract<
	ReturnType<typeof encodePersistedTransactionV1>,
	{ readonly type: 'valid' }
> {
	const encoded = encodePersistedTransactionV1(value);
	if (encoded.type === 'invalid') {
		assert.fail(`Expected a valid Transaction: ${encoded.reason}.`);
	}
	return encoded;
}

function createLargeTransaction(
	lastReplacementLength: number,
): Transaction {
	const operations: ReplaceTextOperation[] = [];
	for (let index = 0; index < 16; index += 1) {
		operations.push({
			...operation,
			id: operationId(uuid(100 + index)),
			replacement: 'x'.repeat(1_000_000),
		});
	}
	operations.push({
		...operation,
		id: operationId(uuid(116)),
		replacement: 'x'.repeat(lastReplacementLength),
	});
	return {
		...transaction,
		operations: operations as [
			ReplaceTextOperation,
			...ReplaceTextOperation[],
		],
	};
}

function assertInvalidWal(
	value: unknown,
	reason: string,
): void {
	const result = encodeRevisionWalRecordV1(value);
	assert.equal(result.type, 'invalid');
	if (result.type === 'invalid') {
		assert.equal(result.reason, reason);
	}
}

function assertCorrupt(
	result: RevisionWalDecodeResult,
	reason: IRevisionWalCorruption['reason'],
	offset: number,
): asserts result is IRevisionWalCorruption {
	assert.equal(result.type, 'corrupt');
	if (result.type !== 'corrupt') {
		return;
	}
	assert.equal(result.reason, reason);
	assert.equal(result.corruptionOffset, offset);
}

function clonePayload(
	value: IPersistedRevisionWalRecordV1,
): {
	format: string;
	formatVersion: number;
	revision: {
		format: string;
		formatVersion: number;
		revision: Record<string, unknown>;
	};
	transactionHash: unknown;
	transaction: IPersistedTransactionV1;
} {
	return {
		format: value.format,
		formatVersion: value.formatVersion,
		revision: {
			format: value.revision.format,
			formatVersion: value.revision.formatVersion,
			revision: {
				...value.revision.revision,
				actor: {
					...value.revision.revision.actor,
				},
			},
		},
		transactionHash: value.transactionHash,
		transaction: value.transaction,
	};
}

function frameCanonical(value: unknown): Uint8Array {
	const text = canonicalJson(value);
	return frameText(text);
}

function canonicalJson(value: unknown): string {
	const serialized = JSON.stringify(value, objectKeysInCanonicalOrder);
	if (serialized === undefined) {
		throw new Error('Expected JSON.');
	}
	return serialized;
}

function objectKeysInCanonicalOrder(
	_key: string,
	value: unknown,
): unknown {
	if (
		value === null
		|| typeof value !== 'object'
		|| Array.isArray(value)
	) {
		return value;
	}
	const record = value as Record<string, unknown>;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(record).sort()) {
		Object.defineProperty(sorted, key, {
			value: record[key],
			enumerable: true,
			configurable: true,
			writable: true,
		});
	}
	return sorted;
}

function frameText(value: string): Uint8Array {
	return frameBytes(textEncoder.encode(value));
}

function frameBytes(payload: Uint8Array): Uint8Array {
	const frame = new Uint8Array(
		revisionWalFrameHeaderByteLength + payload.byteLength,
	);
	writeProtectedHeader(frame, payload.byteLength, crc32(payload));
	frame.set(payload, revisionWalFrameHeaderByteLength);
	return frame;
}

function writeProtectedHeader(
	bytes: Uint8Array,
	payloadLength: number,
	payloadChecksum: number,
	offset = 0,
): void {
	writeUint32BigEndian(bytes, offset, revisionWalFrameMagic);
	writeUint32BigEndian(bytes, offset + 4, payloadLength);
	writeUint32BigEndian(bytes, offset + 8, payloadChecksum);
	writeUint32BigEndian(
		bytes,
		offset + 12,
		crc32(bytes.subarray(offset, offset + 12)),
	);
}

function concatenate(...values: readonly Uint8Array[]): Uint8Array {
	const result = new Uint8Array(
		values.reduce((total, value) => total + value.byteLength, 0),
	);
	let offset = 0;
	for (const value of values) {
		result.set(value, offset);
		offset += value.byteLength;
	}
	return result;
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
	return (
		(((bytes[offset] ?? 0) << 24)
			| ((bytes[offset + 1] ?? 0) << 16)
			| ((bytes[offset + 2] ?? 0) << 8)
			| (bytes[offset + 3] ?? 0))
		>>> 0
	);
}

function writeUint32BigEndian(
	bytes: Uint8Array,
	offset: number,
	value: number,
): void {
	bytes[offset] = (value >>> 24) & 0xff;
	bytes[offset + 1] = (value >>> 16) & 0xff;
	bytes[offset + 2] = (value >>> 8) & 0xff;
	bytes[offset + 3] = value & 0xff;
}

function uuid(sequence: number): string {
	return `018f0000-0000-7000-8000-${sequence
		.toString(16)
		.padStart(12, '0')}`;
}

function revisionId(value: string): RevisionId {
	const parsed = parseRevisionId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Revision ID.');
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

function operationId(value: string): OperationId {
	const parsed = parseOperationId(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Operation ID.');
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

function contentHash(value: string): ContentHash {
	const parsed = parseContentHash(value);
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Content Hash.');
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
