/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { captureBoundedClosedJson } from 'cs/editor/common/core/boundedClosedJson';
import { serializeCanonicalJson } from 'cs/editor/common/core/canonicalJson';
import { isCanonicalUtcTimestamp } from 'cs/editor/common/core/canonicalTimestamp';
import {
	parseContentHash,
	parseRevisionId,
	parseTransactionId,
	type ContentHash,
	type RevisionId,
	type TransactionId,
} from 'cs/editor/common/core/identifiers';
import {
	parseManuscriptResource,
	validateManuscriptResource,
} from 'cs/editor/common/core/manuscriptResource';
import { encodeUtf8 } from 'cs/editor/common/core/sha256';
import {
	createTrustedActorRef,
	type ActorRef,
} from 'cs/editor/common/model/actor';
import {
	decodePersistedTransactionV1,
	encodePersistedTransactionV1,
	hashPersistedTransactionV1,
	maximumPersistedTransactionUtf8Bytes,
	type IPersistedTransactionV1,
	type Transaction,
} from 'cs/editor/common/model/transaction';

export interface Revision {
	readonly id: RevisionId;
	readonly resource: URI;
	readonly parentRevisionId: RevisionId | null;
	readonly transactionId: TransactionId;
	readonly sequence: number;
	readonly documentHash: ContentHash;
	readonly actor: ActorRef;
	readonly createdAt: string;
}

export const persistedRevisionFormat = 'nireco-revision';
export const persistedRevisionFormatVersion = 1;
export const persistedRevisionWalRecordFormat = 'nireco-revision-wal-record';
export const persistedRevisionWalRecordFormatVersion = 1;

export const revisionWalFrameMagic = 0x4e49_5257;
export const revisionWalFrameHeaderByteLength = 16;
export const maximumRevisionWalWrapperUtf8Bytes = 64 * 1_024;
export const maximumRevisionWalPayloadByteLength =
	maximumPersistedTransactionUtf8Bytes
	+ maximumRevisionWalWrapperUtf8Bytes;
export const maximumRevisionWalDecoderChunkByteLength = 1 * 1_024 * 1_024;
export const maximumRevisionWalFrameByteLength =
	revisionWalFrameHeaderByteLength
	+ maximumRevisionWalPayloadByteLength;

const maximumPersistedRevisionUtf8Bytes = 4 * 1_024;
const maximumPersistedRevisionJsonValues = 32;
const maximumPersistedRevisionDepth = 4;
const maximumTopLevelCodecOwnKeys = 32;
const maximumWalResynchronizationScannedBytes =
	maximumRevisionWalPayloadByteLength;
const maximumWalResynchronizationCandidates = 4_096;
const maximumWalResynchronizationChecksumBytes =
	maximumRevisionWalPayloadByteLength * 4;
const emptyWalRecords = Object.freeze([]) as readonly RevisionWalRecord[];
const revisionWalFrameMagicBytes = Object.freeze([
	0x4e,
	0x49,
	0x52,
	0x57,
] as const);

export interface IPersistedRevisionBodyV1 {
	readonly id: RevisionId;
	readonly resource: string;
	readonly parentRevisionId: RevisionId | null;
	readonly transactionId: TransactionId;
	readonly sequence: number;
	readonly documentHash: ContentHash;
	readonly actor: ActorRef;
	readonly createdAt: string;
}

export interface IPersistedRevisionV1 {
	readonly format: typeof persistedRevisionFormat;
	readonly formatVersion: typeof persistedRevisionFormatVersion;
	readonly revision: IPersistedRevisionBodyV1;
}

export interface RevisionWalRecord {
	readonly revision: Revision;
	readonly transactionHash: ContentHash;
	readonly transaction: Transaction;
}

export interface IPersistedRevisionWalRecordV1 {
	readonly format: typeof persistedRevisionWalRecordFormat;
	readonly formatVersion: typeof persistedRevisionWalRecordFormatVersion;
	readonly revision: IPersistedRevisionV1;
	readonly transactionHash: ContentHash;
	readonly transaction: IPersistedTransactionV1;
}

export type RevisionCodecFailure =
	| 'inspection-failed'
	| 'resource-limit-exceeded'
	| 'invalid-envelope'
	| 'unsupported-version'
	| 'invalid-revision';

export interface IRevisionCodecError {
	readonly type: 'invalid';
	readonly reason: RevisionCodecFailure;
	readonly path: string;
}

export type EncodePersistedRevisionResult =
	| {
		readonly type: 'valid';
		readonly value: IPersistedRevisionV1;
	}
	| IRevisionCodecError;

export type DecodePersistedRevisionResult =
	| {
		readonly type: 'valid';
		readonly value: Revision;
	}
	| IRevisionCodecError;

export type RevisionWalRecordCodecFailure =
	| RevisionCodecFailure
	| 'invalid-record'
	| 'invalid-transaction'
	| 'invalid-transaction-hash'
	| 'transaction-hash-mismatch'
	| 'revision-transaction-mismatch'
	| 'record-too-large'
	| 'invalid-bytes'
	| 'decoder-chunk-too-large'
	| 'decoder-finished';

export interface IRevisionWalRecordCodecError {
	readonly type: 'invalid';
	readonly reason: RevisionWalRecordCodecFailure;
	readonly path: string;
}

export type EncodeRevisionWalRecordResult =
	| {
		readonly type: 'valid';
		readonly bytes: Uint8Array;
		readonly payload: IPersistedRevisionWalRecordV1;
	}
	| IRevisionWalRecordCodecError;

export type DecodePersistedRevisionWalRecordResult =
	| {
		readonly type: 'valid';
		readonly value: RevisionWalRecord;
		readonly persisted: IPersistedRevisionWalRecordV1;
	}
	| IRevisionWalRecordCodecError;

export type RevisionWalCorruptionReason =
	| 'invalid-magic'
	| 'header-checksum-mismatch'
	| 'invalid-length'
	| 'checksum-mismatch'
	| 'invalid-utf8'
	| 'invalid-json'
	| 'non-canonical-payload'
	| 'invalid-record'
	| 'unsupported-version'
	| 'invalid-transaction'
	| 'transaction-hash-mismatch'
	| 'revision-transaction-mismatch'
	| 'resynchronization-budget-exceeded';

export interface IRevisionWalDecoderProgress {
	readonly type: 'valid';
	readonly records: readonly RevisionWalRecord[];
	readonly lastCompleteOffset: number;
}

export interface IRevisionWalDecoderTail {
	readonly type: 'valid';
	readonly records: readonly RevisionWalRecord[];
	readonly lastCompleteOffset: number;
	readonly incompleteTail: boolean;
}

export interface IRevisionWalCorruption {
	readonly type: 'corrupt';
	readonly records: readonly RevisionWalRecord[];
	readonly lastCompleteOffset: number;
	readonly corruptionOffset: number;
	readonly reason: RevisionWalCorruptionReason;
}

export interface IRevisionWalDecoderMetrics {
	readonly receivedByteLength: number;
	readonly copiedByteLength: number;
	readonly maximumPendingByteLength: number;
	readonly maximumPendingCapacityByteLength: number;
	readonly resynchronizationScannedByteLength: number;
	readonly resynchronizationCandidateCount: number;
	readonly resynchronizationChecksumByteLength: number;
}

export type RevisionWalDecoderAppendResult =
	| IRevisionWalDecoderProgress
	| IRevisionWalCorruption
	| IRevisionWalRecordCodecError;

export type RevisionWalDecodeResult =
	| IRevisionWalDecoderTail
	| IRevisionWalCorruption
	| IRevisionWalRecordCodecError;

type ClosedRecord = Readonly<Record<string, unknown>>;

type ExactDataRecordCaptureResult =
	| {
		readonly type: 'valid';
		readonly value: ClosedRecord;
	}
	| {
		readonly type: 'invalid';
		readonly reason:
			| 'invalid-shape'
			| 'inspection-failed'
			| 'resource-limit-exceeded';
	};

interface IDecodedPersistedRevision {
	readonly revision: Revision;
	readonly persisted: IPersistedRevisionV1;
}

interface IDecodedWalPayload {
	readonly record: RevisionWalRecord;
	readonly persisted: IPersistedRevisionWalRecordV1;
}

type RevisionDomainResult<TValue> =
	| {
		readonly type: 'valid';
		readonly value: TValue;
	}
	| IRevisionCodecError;

type WalDomainResult<TValue> =
	| {
		readonly type: 'valid';
		readonly value: TValue;
	}
	| IRevisionWalRecordCodecError;

type DecodedPayloadResult =
	| {
		readonly type: 'valid';
		readonly record: RevisionWalRecord;
	}
	| {
		readonly type: 'corrupt';
		readonly reason: Exclude<
			RevisionWalCorruptionReason,
			'invalid-magic'
			| 'header-checksum-mismatch'
			| 'invalid-length'
			| 'checksum-mismatch'
			| 'resynchronization-budget-exceeded'
		>;
	};

type ResynchronizationResult =
	({
		readonly type: 'found' | 'not-found' | 'budget-exceeded';
	} & IResynchronizationMetrics);

interface IResynchronizationMetrics {
	readonly scannedByteLength: number;
	readonly candidateCount: number;
	readonly checksumByteLength: number;
}

const revisionEnvelopeKeys = Object.freeze([
	'format',
	'formatVersion',
	'revision',
] as const);
const revisionBodyKeys = Object.freeze([
	'id',
	'resource',
	'parentRevisionId',
	'transactionId',
	'sequence',
	'documentHash',
	'actor',
	'createdAt',
] as const);
const runtimeWalRecordKeys = Object.freeze([
	'revision',
	'transactionHash',
	'transaction',
] as const);
const walRecordKeys = Object.freeze([
	'format',
	'formatVersion',
	'revision',
	'transactionHash',
	'transaction',
] as const);

export function encodePersistedRevisionV1(
	value: unknown,
): EncodePersistedRevisionResult {
	const captured = captureExactDataRecord(value, revisionBodyKeys);
	if (captured.type === 'invalid') {
		return invalidRevision(
			captured.reason === 'invalid-shape'
				? 'invalid-revision'
				: captured.reason,
			'$',
		);
	}
	return encodeCapturedRevision(captured.value);
}

export function decodePersistedRevisionV1(
	value: unknown,
): DecodePersistedRevisionResult {
	const decoded = decodePersistedRevisionInternal(value);
	return decoded.type === 'invalid'
		? decoded
		: {
			type: 'valid',
			value: decoded.value.revision,
		};
}

export function encodeRevisionWalRecordV1(
	value: unknown,
): EncodeRevisionWalRecordResult {
	const encoded = encodePersistedWalRecord(value);
	if (encoded.type === 'invalid') {
		return encoded;
	}
	const canonical = serializeCanonicalJson(encoded.value);
	if (canonical.type === 'error') {
		return invalidWal('invalid-record', canonical.error.path);
	}
	const payloadBytes = encodeUtf8(canonical.value);
	if (payloadBytes.byteLength > maximumRevisionWalPayloadByteLength) {
		return invalidWal('record-too-large', '$');
	}

	const bytes = new Uint8Array(
		revisionWalFrameHeaderByteLength + payloadBytes.byteLength,
	);
	writeRevisionWalHeader(
		bytes,
		payloadBytes.byteLength,
		crc32(payloadBytes),
	);
	bytes.set(payloadBytes, revisionWalFrameHeaderByteLength);

	return {
		type: 'valid',
		bytes,
		payload: encoded.value,
	};
}

export function decodePersistedRevisionWalRecordV1(
	value: unknown,
): DecodePersistedRevisionWalRecordResult {
	const decoded = decodePersistedWalRecord(value);
	return decoded.type === 'invalid'
		? decoded
		: {
			type: 'valid',
			value: decoded.value.record,
			persisted: decoded.value.persisted,
		};
}

/**
 * Incrementally validates WAL frames while retaining at most one incomplete frame.
 *
 * The protected header is four unsigned big-endian uint32 values: the `NIRW` magic,
 * canonical JSON payload byte length, IEEE CRC-32 of the exact payload bytes, and
 * IEEE CRC-32 of the preceding 12 header bytes. Cross-record sequence, parent, and
 * used-ID continuity belongs to recovery; this decoder validates each record
 * independently.
 */
export class RevisionWalStreamDecoderV1 {
	private readonly header = new Uint8Array(
		revisionWalFrameHeaderByteLength,
	);
	private headerByteLength = 0;
	private payload: Uint8Array | undefined;
	private payloadByteLength = 0;
	private expectedPayloadChecksum = 0;
	private frameStartOffset = 0;
	private streamOffset = 0;
	private lastCompleteOffset = 0;
	private finished = false;

	private receivedByteLength = 0;
	private copiedByteLength = 0;
	private maximumPendingByteLength = 0;
	private maximumPendingCapacityByteLength =
		revisionWalFrameHeaderByteLength;
	private resynchronizationScannedByteLength = 0;
	private resynchronizationCandidateCount = 0;
	private resynchronizationChecksumByteLength = 0;

	append(bytes: Uint8Array): RevisionWalDecoderAppendResult {
		if (this.finished) {
			return invalidWal('decoder-finished', '$bytes');
		}
		const sourceByteLength = readUint8ArrayByteLength(bytes);
		if (sourceByteLength === undefined) {
			return invalidWal('invalid-bytes', '$bytes');
		}
		if (sourceByteLength > maximumRevisionWalDecoderChunkByteLength) {
			return invalidWal('decoder-chunk-too-large', '$bytes');
		}
		if (sourceByteLength === 0) {
			return {
				type: 'valid',
				records: emptyWalRecords,
				lastCompleteOffset: this.lastCompleteOffset,
			};
		}

		this.receivedByteLength += sourceByteLength;
		const records: RevisionWalRecord[] = [];
		let sourceOffset = 0;
		while (sourceOffset < sourceByteLength) {
			if (this.payload === undefined) {
				if (this.headerByteLength === 0) {
					this.frameStartOffset = this.streamOffset;
				}
				const copied = Math.min(
					revisionWalFrameHeaderByteLength
						- this.headerByteLength,
					sourceByteLength - sourceOffset,
				);
				copyUint8ArrayRange(
					this.header,
					this.headerByteLength,
					bytes,
					sourceOffset,
					copied,
				);
				this.headerByteLength += copied;
				sourceOffset += copied;
				this.streamOffset += copied;
				this.copiedByteLength += copied;
				this.updatePendingMetrics();
				if (
					this.headerByteLength
					< revisionWalFrameHeaderByteLength
				) {
					continue;
				}

				const headerFailure = this.openValidatedFrame();
				if (headerFailure !== undefined) {
					this.finished = true;
					return corruptWal(
						records,
						this.lastCompleteOffset,
						this.frameStartOffset,
						headerFailure,
					);
				}
				if (
					(this.payload as Uint8Array | undefined)
						?.byteLength === 0
				) {
					const payloadFailure = this.completeFrame(records);
					if (payloadFailure !== undefined) {
						this.finished = true;
						return corruptWal(
							records,
							this.lastCompleteOffset,
							this.frameStartOffset,
							payloadFailure,
						);
					}
				}
				continue;
			}

			const copied = Math.min(
				this.payload.byteLength - this.payloadByteLength,
				sourceByteLength - sourceOffset,
			);
			copyUint8ArrayRange(
				this.payload,
				this.payloadByteLength,
				bytes,
				sourceOffset,
				copied,
			);
			this.payloadByteLength += copied;
			sourceOffset += copied;
			this.streamOffset += copied;
			this.copiedByteLength += copied;
			this.updatePendingMetrics();
			if (this.payloadByteLength < this.payload.byteLength) {
				continue;
			}

			const payloadFailure = this.completeFrame(records);
			if (payloadFailure !== undefined) {
				this.finished = true;
				return corruptWal(
					records,
					this.lastCompleteOffset,
					this.frameStartOffset,
					payloadFailure,
				);
			}
		}

		return {
			type: 'valid',
			records: records.length === 0
				? emptyWalRecords
				: Object.freeze(records),
			lastCompleteOffset: this.lastCompleteOffset,
		};
	}

	finish(): RevisionWalDecodeResult {
		if (this.finished) {
			return invalidWal('decoder-finished', '$bytes');
		}
		this.finished = true;
		if (this.headerByteLength === 0 && this.payload === undefined) {
			return {
				type: 'valid',
				records: emptyWalRecords,
				lastCompleteOffset: this.lastCompleteOffset,
				incompleteTail: false,
			};
		}
		if (this.payload === undefined) {
			return validWalTail(this.lastCompleteOffset);
		}

		const resynchronization = findCompleteCanonicalFrameInPendingPayload(
			this.payload,
			this.payloadByteLength,
		);
		this.resynchronizationScannedByteLength +=
			resynchronization.scannedByteLength;
		this.resynchronizationCandidateCount +=
			resynchronization.candidateCount;
		this.resynchronizationChecksumByteLength +=
			resynchronization.checksumByteLength;
		if (resynchronization.type === 'found') {
			return corruptWal(
				emptyWalRecords,
				this.lastCompleteOffset,
				this.frameStartOffset,
				'invalid-length',
			);
		}
		if (resynchronization.type === 'budget-exceeded') {
			return corruptWal(
				emptyWalRecords,
				this.lastCompleteOffset,
				this.frameStartOffset,
				'resynchronization-budget-exceeded',
			);
		}
		return validWalTail(this.lastCompleteOffset);
	}

	getMetrics(): IRevisionWalDecoderMetrics {
		return Object.freeze({
			receivedByteLength: this.receivedByteLength,
			copiedByteLength: this.copiedByteLength,
			maximumPendingByteLength: this.maximumPendingByteLength,
			maximumPendingCapacityByteLength:
				this.maximumPendingCapacityByteLength,
			resynchronizationScannedByteLength:
				this.resynchronizationScannedByteLength,
			resynchronizationCandidateCount:
				this.resynchronizationCandidateCount,
			resynchronizationChecksumByteLength:
				this.resynchronizationChecksumByteLength,
		});
	}

	private openValidatedFrame(): RevisionWalCorruptionReason | undefined {
		if (readUint32BigEndian(this.header, 0) !== revisionWalFrameMagic) {
			return 'invalid-magic';
		}
		const expectedHeaderChecksum = readUint32BigEndian(this.header, 12);
		const actualHeaderChecksum = crc32Range(this.header, 0, 12);
		if (actualHeaderChecksum !== expectedHeaderChecksum) {
			return 'header-checksum-mismatch';
		}
		const payloadLength = readUint32BigEndian(this.header, 4);
		if (payloadLength > maximumRevisionWalPayloadByteLength) {
			return 'invalid-length';
		}

		this.expectedPayloadChecksum = readUint32BigEndian(this.header, 8);
		this.payload = new Uint8Array(payloadLength);
		this.payloadByteLength = 0;
		this.maximumPendingCapacityByteLength = Math.max(
			this.maximumPendingCapacityByteLength,
			revisionWalFrameHeaderByteLength + payloadLength,
		);
		return undefined;
	}

	private completeFrame(
		records: RevisionWalRecord[],
	): RevisionWalCorruptionReason | undefined {
		const payload = this.payload;
		if (payload === undefined) {
			return 'invalid-record';
		}
		if (crc32(payload) !== this.expectedPayloadChecksum) {
			return 'checksum-mismatch';
		}
		const decoded = decodeWalPayload(payload);
		if (decoded.type === 'corrupt') {
			return decoded.reason;
		}
		records.push(decoded.record);
		this.lastCompleteOffset = this.streamOffset;
		this.headerByteLength = 0;
		this.payload = undefined;
		this.payloadByteLength = 0;
		this.expectedPayloadChecksum = 0;
		return undefined;
	}

	private updatePendingMetrics(): void {
		const current = this.payload === undefined
			? this.headerByteLength
			: revisionWalFrameHeaderByteLength + this.payloadByteLength;
		this.maximumPendingByteLength = Math.max(
			this.maximumPendingByteLength,
			current,
		);
	}
}

export function decodeRevisionWalRecordStreamV1(
	bytes: Uint8Array,
): RevisionWalDecodeResult {
	const byteLength = readUint8ArrayByteLength(bytes);
	if (byteLength === undefined) {
		return invalidWal('invalid-bytes', '$bytes');
	}

	const decoder = new RevisionWalStreamDecoderV1();
	const records: RevisionWalRecord[] = [];
	for (
		let offset = 0;
		offset < byteLength;
		offset += maximumRevisionWalDecoderChunkByteLength
	) {
		const chunk = subarrayUint8Array(
			bytes,
			offset,
			Math.min(
				byteLength,
				offset + maximumRevisionWalDecoderChunkByteLength,
			),
		);
		if (chunk === undefined) {
			return invalidWal('invalid-bytes', '$bytes');
		}
		const result = decoder.append(chunk);
		if (result.type === 'invalid') {
			return result;
		}
		records.push(...result.records);
		if (result.type === 'corrupt') {
			return {
				...result,
				records: Object.freeze(records),
			};
		}
	}
	const finished = decoder.finish();
	if (finished.type === 'invalid') {
		return finished;
	}
	records.push(...finished.records);
	return {
		...finished,
		records: records.length === 0
			? emptyWalRecords
			: Object.freeze(records),
	};
}

function encodeCapturedRevision(
	revision: ClosedRecord,
): RevisionDomainResult<IPersistedRevisionV1> {
	const id = parseRequiredRevisionId(revision['id']);
	const resource = validateManuscriptResource(revision['resource'] as URI);
	const parentRevisionId = parseOptionalRevisionId(revision['parentRevisionId']);
	const transactionId = parseRequiredTransactionId(revision['transactionId']);
	const sequence = positiveSafeInteger(revision['sequence']);
	const documentHash = parseRequiredContentHash(revision['documentHash']);
	const actor = createTrustedActorRef(revision['actor']);
	const createdAt = revision['createdAt'];
	if (
		id === undefined
		|| resource.type === 'invalid'
		|| parentRevisionId.type === 'invalid'
		|| transactionId === undefined
		|| sequence === undefined
		|| documentHash === undefined
		|| actor === undefined
		|| !isCanonicalUtcTimestamp(createdAt)
		|| !isValidRevisionParentSequence(
			parentRevisionId.type === 'valid'
				? parentRevisionId.value
				: null,
			sequence,
		)
	) {
		return invalidRevision('invalid-revision', '$');
	}

	const persisted = freezePersistedRevision({
		format: persistedRevisionFormat,
		formatVersion: persistedRevisionFormatVersion,
		revision: {
			id,
			resource: resource.canonical,
			parentRevisionId: parentRevisionId.value,
			transactionId,
			sequence,
			documentHash,
			actor,
			createdAt,
		},
	});
	return {
		type: 'valid',
		value: persisted,
	};
}

function decodePersistedRevisionInternal(
	value: unknown,
): RevisionDomainResult<IDecodedPersistedRevision> {
	const captured = captureBoundedClosedJson(value, {
		maximumDepth: maximumPersistedRevisionDepth,
		maximumValues: maximumPersistedRevisionJsonValues,
		maximumArrayLength: maximumPersistedRevisionJsonValues,
		maximumObjectProperties: maximumPersistedRevisionJsonValues,
		maximumCanonicalUtf8Bytes: maximumPersistedRevisionUtf8Bytes,
	});
	if (captured.type === 'invalid') {
		return invalidRevision(captured.reason, captured.path);
	}
	const envelope = asRecord(captured.value);
	if (
		envelope === undefined
		|| !hasExactKeys(envelope, revisionEnvelopeKeys)
		|| envelope['format'] !== persistedRevisionFormat
	) {
		return invalidRevision('invalid-envelope', '$');
	}
	if (envelope['formatVersion'] !== persistedRevisionFormatVersion) {
		return invalidRevision('unsupported-version', '$.formatVersion');
	}
	const body = asRecord(envelope['revision']);
	if (body === undefined || !hasExactKeys(body, revisionBodyKeys)) {
		return invalidRevision('invalid-revision', '$.revision');
	}

	const id = parseRequiredRevisionId(body['id']);
	const resource = typeof body['resource'] === 'string'
		? parseManuscriptResource(body['resource'])
		: undefined;
	const parentRevisionId = parseOptionalRevisionId(body['parentRevisionId']);
	const transactionId = parseRequiredTransactionId(body['transactionId']);
	const sequence = positiveSafeInteger(body['sequence']);
	const documentHash = parseRequiredContentHash(body['documentHash']);
	const actor = createTrustedActorRef(body['actor']);
	const createdAt = body['createdAt'];
	if (
		id === undefined
		|| resource === undefined
		|| resource.type === 'invalid'
		|| parentRevisionId.type === 'invalid'
		|| transactionId === undefined
		|| sequence === undefined
		|| documentHash === undefined
		|| actor === undefined
		|| !isCanonicalUtcTimestamp(createdAt)
		|| !isValidRevisionParentSequence(
			parentRevisionId.type === 'valid'
				? parentRevisionId.value
				: null,
			sequence,
		)
	) {
		return invalidRevision('invalid-revision', '$.revision');
	}

	const persisted = freezePersistedRevision({
		format: persistedRevisionFormat,
		formatVersion: persistedRevisionFormatVersion,
		revision: {
			id,
			resource: resource.canonical,
			parentRevisionId: parentRevisionId.value,
			transactionId,
			sequence,
			documentHash,
			actor,
			createdAt,
		},
	});
	const revision: Revision = Object.freeze({
		id,
		resource: resource.resource,
		parentRevisionId: parentRevisionId.value,
		transactionId,
		sequence,
		documentHash,
		actor,
		createdAt,
	});
	return {
		type: 'valid',
		value: Object.freeze({
			revision,
			persisted,
		}),
	};
}

function encodePersistedWalRecord(
	value: unknown,
): WalDomainResult<IPersistedRevisionWalRecordV1> {
	const captured = captureExactDataRecord(value, runtimeWalRecordKeys);
	if (captured.type === 'invalid') {
		return invalidWal(
			captured.reason === 'invalid-shape'
				? 'invalid-record'
				: captured.reason,
			'$',
		);
	}
	const record = captured.value;

	const revision = encodePersistedRevisionV1(record['revision']);
	if (revision.type === 'invalid') {
		return invalidWal(revision.reason, `$.revision${nestedPath(revision.path)}`);
	}
	if (
		revision.value.revision.parentRevisionId === null
		|| revision.value.revision.sequence < 2
	) {
		return invalidWal(
			'invalid-record',
			revision.value.revision.parentRevisionId === null
				? '$.revision.revision.parentRevisionId'
				: '$.revision.revision.sequence',
		);
	}
	const transaction = encodePersistedTransactionV1(record['transaction']);
	if (transaction.type === 'invalid') {
		return invalidWal(
			transaction.reason === 'inspection-failed'
				|| transaction.reason === 'resource-limit-exceeded'
				? transaction.reason
				: 'invalid-transaction',
			`$.transaction${nestedPath(transaction.path)}`,
		);
	}
	const transactionHash = parseRequiredContentHash(record['transactionHash']);
	if (transactionHash === undefined) {
		return invalidWal('invalid-transaction-hash', '$.transactionHash');
	}
	const computedHash = hashPersistedTransactionV1(transaction.value);
	if (computedHash.type === 'invalid') {
		return invalidWal('invalid-transaction', '$.transaction');
	}
	if (computedHash.hash !== transactionHash) {
		return invalidWal('transaction-hash-mismatch', '$.transactionHash');
	}
	if (!revisionMatchesTransaction(revision.value, transaction.value)) {
		return invalidWal('revision-transaction-mismatch', '$');
	}

	return {
		type: 'valid',
		value: freezePersistedWalRecord({
			format: persistedRevisionWalRecordFormat,
			formatVersion: persistedRevisionWalRecordFormatVersion,
			revision: revision.value,
			transactionHash,
			transaction: transaction.value,
		}),
	};
}

function decodePersistedWalRecord(
	value: unknown,
): WalDomainResult<IDecodedWalPayload> {
	const captured = captureExactDataRecord(value, walRecordKeys);
	if (captured.type === 'invalid') {
		return invalidWal(
			captured.reason === 'invalid-shape'
				? 'invalid-record'
				: captured.reason,
			'$',
		);
	}
	const record = captured.value;
	if (record['format'] !== persistedRevisionWalRecordFormat) {
		return invalidWal('invalid-record', '$');
	}
	if (record['formatVersion'] !== persistedRevisionWalRecordFormatVersion) {
		return invalidWal('unsupported-version', '$.formatVersion');
	}

	const revision = decodePersistedRevisionInternal(record['revision']);
	if (revision.type === 'invalid') {
		return invalidWal(revision.reason, `$.revision${nestedPath(revision.path)}`);
	}
	if (
		revision.value.revision.parentRevisionId === null
		|| revision.value.revision.sequence < 2
	) {
		return invalidWal(
			'invalid-record',
			revision.value.revision.parentRevisionId === null
				? '$.revision.revision.parentRevisionId'
				: '$.revision.revision.sequence',
		);
	}
	const transaction = decodePersistedTransactionV1(record['transaction']);
	if (transaction.type === 'invalid') {
		return invalidWal(
			transaction.reason === 'inspection-failed'
				|| transaction.reason === 'resource-limit-exceeded'
				? transaction.reason
				: 'invalid-transaction',
			`$.transaction${nestedPath(transaction.path)}`,
		);
	}
	const transactionHash = parseRequiredContentHash(record['transactionHash']);
	if (transactionHash === undefined) {
		return invalidWal('invalid-transaction-hash', '$.transactionHash');
	}
	const encodedTransaction = encodePersistedTransactionV1(transaction.value);
	if (encodedTransaction.type === 'invalid') {
		return invalidWal('invalid-transaction', '$.transaction');
	}
	const computedHash = hashPersistedTransactionV1(encodedTransaction.value);
	if (computedHash.type === 'invalid') {
		return invalidWal('invalid-transaction', '$.transaction');
	}
	if (computedHash.hash !== transactionHash) {
		return invalidWal('transaction-hash-mismatch', '$.transactionHash');
	}

	if (
		!revisionMatchesTransaction(
			revision.value.persisted,
			encodedTransaction.value,
		)
	) {
		return invalidWal('revision-transaction-mismatch', '$');
	}

	const persisted = freezePersistedWalRecord({
		format: persistedRevisionWalRecordFormat,
		formatVersion: persistedRevisionWalRecordFormatVersion,
		revision: revision.value.persisted,
		transactionHash,
		transaction: encodedTransaction.value,
	});
	const canonical = serializeCanonicalJson(persisted);
	if (
		canonical.type === 'error'
		|| encodeUtf8(canonical.value).byteLength
			> maximumRevisionWalPayloadByteLength
	) {
		return invalidWal('record-too-large', '$');
	}
	const runtime: RevisionWalRecord = Object.freeze({
		revision: revision.value.revision,
		transactionHash,
		transaction: transaction.value,
	});
	return {
		type: 'valid',
		value: Object.freeze({
			record: runtime,
			persisted,
		}),
	};
}

function decodeWalPayload(payload: Uint8Array): DecodedPayloadResult {
	let text: string;
	try {
		text = new TextDecoder('utf-8', {
			fatal: true,
			ignoreBOM: true,
		}).decode(payload);
	} catch {
		return {
			type: 'corrupt',
			reason: 'invalid-utf8',
		};
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(text) as unknown;
	} catch {
		return {
			type: 'corrupt',
			reason: 'invalid-json',
		};
	}

	const decoded = decodePersistedWalRecord(parsed);
	if (decoded.type === 'invalid') {
		return {
			type: 'corrupt',
			reason: walCodecFailureToCorruption(decoded.reason),
		};
	}
	const canonical = serializeCanonicalJson(decoded.value.persisted);
	if (canonical.type === 'error') {
		return {
			type: 'corrupt',
			reason: 'invalid-record',
		};
	}
	const canonicalBytes = encodeUtf8(canonical.value);
	if (!equalBytes(payload, canonicalBytes)) {
		return {
			type: 'corrupt',
			reason: 'non-canonical-payload',
		};
	}
	return {
		type: 'valid',
		record: decoded.value.record,
	};
}

function revisionMatchesTransaction(
	revisionEnvelope: IPersistedRevisionV1,
	transactionEnvelope: IPersistedTransactionV1,
): boolean {
	const revision = revisionEnvelope.revision;
	const transaction = transactionEnvelope.transaction;
	return (
		revision.parentRevisionId !== null
		&& revision.transactionId === transaction.id
		&& revision.resource === transaction.resource
		&& revision.parentRevisionId === transaction.baseRevisionId
		&& revision.createdAt === transaction.createdAt
		&& actorEquals(revision.actor, transaction.actor)
	);
}

function actorEquals(left: ActorRef, right: ActorRef): boolean {
	if (left.type !== right.type || left.id !== right.id) {
		return false;
	}
	return left.type !== 'system'
		|| (right.type === 'system' && left.role === right.role);
}

function findCompleteCanonicalFrameInPendingPayload(
	bytes: Uint8Array,
	byteLength: number,
): ResynchronizationResult {
	let scannedByteLength = 0;
	let candidateCount = 0;
	let checksumByteLength = 0;
	let matchedMagicBytes = 0;
	for (let index = 0; index < byteLength; index += 1) {
		scannedByteLength += 1;
		if (
			scannedByteLength
			> maximumWalResynchronizationScannedBytes
		) {
			return resynchronizationResult(
				'budget-exceeded',
				scannedByteLength,
				candidateCount,
				checksumByteLength,
			);
		}
		const byte = bytes[index];
		if (byte === revisionWalFrameMagicBytes[matchedMagicBytes]) {
			matchedMagicBytes += 1;
		} else {
			matchedMagicBytes =
				byte === revisionWalFrameMagicBytes[0] ? 1 : 0;
		}
		if (matchedMagicBytes !== revisionWalFrameMagicBytes.length) {
			continue;
		}
		const offset =
			index - revisionWalFrameMagicBytes.length + 1;
		matchedMagicBytes = 0;
		candidateCount += 1;
		if (candidateCount > maximumWalResynchronizationCandidates) {
			return resynchronizationResult(
				'budget-exceeded',
				scannedByteLength,
				candidateCount,
				checksumByteLength,
			);
		}
		if (
			offset + revisionWalFrameHeaderByteLength
			> byteLength
		) {
			continue;
		}
		const expectedHeaderChecksum = readUint32BigEndian(
			bytes,
			offset + 12,
		);
		if (
			crc32Range(bytes, offset, 12)
			!== expectedHeaderChecksum
		) {
			continue;
		}
		const payloadLength = readUint32BigEndian(bytes, offset + 4);
		if (payloadLength > maximumRevisionWalPayloadByteLength) {
			continue;
		}
		const frameEnd =
			offset + revisionWalFrameHeaderByteLength + payloadLength;
		if (frameEnd > byteLength) {
			continue;
		}
		if (
			checksumByteLength + payloadLength
			> maximumWalResynchronizationChecksumBytes
		) {
			return resynchronizationResult(
				'budget-exceeded',
				scannedByteLength,
				candidateCount,
				checksumByteLength,
			);
		}
		checksumByteLength += payloadLength;
		const payload = subarrayUint8Array(
			bytes,
			offset + revisionWalFrameHeaderByteLength,
			frameEnd,
		);
		if (payload === undefined) {
			return resynchronizationResult(
				'budget-exceeded',
				scannedByteLength,
				candidateCount,
				checksumByteLength,
			);
		}
		if (
			crc32(payload) === readUint32BigEndian(bytes, offset + 8)
			&& decodeWalPayload(payload).type === 'valid'
		) {
			return resynchronizationResult(
				'found',
				scannedByteLength,
				candidateCount,
				checksumByteLength,
			);
		}
	}
	return resynchronizationResult(
		'not-found',
		scannedByteLength,
		candidateCount,
		checksumByteLength,
	);
}

function resynchronizationResult(
	type: ResynchronizationResult['type'],
	scannedByteLength: number,
	candidateCount: number,
	checksumByteLength: number,
): ResynchronizationResult {
	return {
		type,
		scannedByteLength,
		candidateCount,
		checksumByteLength,
	};
}

function readUint8ArrayByteLength(value: unknown): number | undefined {
	try {
		const typedArrayPrototype = Reflect.getPrototypeOf(
			Uint8Array.prototype,
		);
		const descriptor = typedArrayPrototype === null
			? undefined
			: Reflect.getOwnPropertyDescriptor(
				typedArrayPrototype,
				'byteLength',
			);
		if (descriptor?.get === undefined) {
			return undefined;
		}
		const byteLength = Reflect.apply(descriptor.get, value, []);
		if (
			typeof byteLength !== 'number'
			|| !Number.isSafeInteger(byteLength)
			|| byteLength < 0
			|| Reflect.getPrototypeOf(value as object)
				!== Uint8Array.prototype
		) {
			return undefined;
		}
		return byteLength;
	} catch {
		return undefined;
	}
}

function subarrayUint8Array(
	value: Uint8Array,
	start: number,
	end: number,
): Uint8Array | undefined {
	try {
		return Reflect.apply(
			Uint8Array.prototype.subarray,
			value,
			[start, end],
		) as Uint8Array;
	} catch {
		return undefined;
	}
}

function copyUint8ArrayRange(
	target: Uint8Array,
	targetOffset: number,
	source: Uint8Array,
	sourceOffset: number,
	byteLength: number,
): void {
	if (byteLength === 0) {
		return;
	}
	const view = subarrayUint8Array(
		source,
		sourceOffset,
		sourceOffset + byteLength,
	);
	if (view === undefined) {
		throw new TypeError('Invalid WAL decoder byte source.');
	}
	Reflect.apply(
		Uint8Array.prototype.set,
		target,
		[view, targetOffset],
	);
}

function captureExactDataRecord(
	value: unknown,
	expectedKeys: readonly string[],
): ExactDataRecordCaptureResult {
	try {
		if (
			value === null
			|| typeof value !== 'object'
			|| Array.isArray(value)
		) {
			return invalidExactCapture('invalid-shape');
		}

		const keys = Reflect.ownKeys(value);
		if (keys.length > maximumTopLevelCodecOwnKeys) {
			return invalidExactCapture('resource-limit-exceeded');
		}
		if (keys.some(key => typeof key !== 'string')) {
			return invalidExactCapture('inspection-failed');
		}
		if (
			keys.length !== expectedKeys.length
			|| keys.some(key => !expectedKeys.includes(key as string))
		) {
			return invalidExactCapture('invalid-shape');
		}

		const prototype = Reflect.getPrototypeOf(value);
		if (prototype !== Object.prototype && prototype !== null) {
			return invalidExactCapture('inspection-failed');
		}
		const result: Record<string, unknown> = Object.create(null);
		for (const key of expectedKeys) {
			const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
			if (
				descriptor === undefined
				|| !descriptor.enumerable
				|| !('value' in descriptor)
			) {
				return invalidExactCapture('inspection-failed');
			}
			Object.defineProperty(result, key, {
				value: descriptor.value,
				enumerable: true,
				configurable: true,
				writable: true,
			});
		}
		return {
			type: 'valid',
			value: result,
		};
	} catch {
		return invalidExactCapture('inspection-failed');
	}
}

function invalidExactCapture(
	reason: Extract<
		ExactDataRecordCaptureResult,
		{ readonly type: 'invalid' }
	>['reason'],
): ExactDataRecordCaptureResult {
	return {
		type: 'invalid',
		reason,
	};
}

function asRecord(value: unknown): ClosedRecord | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as ClosedRecord
		: undefined;
}

function hasExactKeys(
	record: ClosedRecord,
	keys: readonly string[],
): boolean {
	return (
		Object.keys(record).length === keys.length
		&& keys.every(key => Object.hasOwn(record, key))
	);
}

function parseRequiredRevisionId(value: unknown): RevisionId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseRevisionId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function parseRequiredTransactionId(
	value: unknown,
): TransactionId | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseTransactionId(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function parseRequiredContentHash(value: unknown): ContentHash | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}
	const parsed = parseContentHash(value);
	return parsed.type === 'valid' ? parsed.value : undefined;
}

function parseOptionalRevisionId(
	value: unknown,
):
	| {
		readonly type: 'valid';
		readonly value: RevisionId | null;
	}
	| {
		readonly type: 'invalid';
	} {
	if (value === null) {
		return {
			type: 'valid',
			value: null,
		};
	}
	const parsed = parseRequiredRevisionId(value);
	return parsed === undefined
		? {
			type: 'invalid',
		}
		: {
			type: 'valid',
			value: parsed,
		};
}

function positiveSafeInteger(value: unknown): number | undefined {
	return (
		typeof value === 'number'
		&& Number.isSafeInteger(value)
		&& value >= 1
	)
		? value
		: undefined;
}

function isValidRevisionParentSequence(
	parentRevisionId: RevisionId | null,
	sequence: number,
): boolean {
	return parentRevisionId === null
		? sequence === 1
		: sequence >= 2;
}

function freezePersistedRevision(
	value: IPersistedRevisionV1,
): IPersistedRevisionV1 {
	return Object.freeze({
		format: value.format,
		formatVersion: value.formatVersion,
		revision: Object.freeze({
			...value.revision,
			actor: Object.freeze({
				...value.revision.actor,
			}),
		}),
	});
}

function freezePersistedWalRecord(
	value: IPersistedRevisionWalRecordV1,
): IPersistedRevisionWalRecordV1 {
	return Object.freeze({
		format: value.format,
		formatVersion: value.formatVersion,
		revision: value.revision,
		transactionHash: value.transactionHash,
		transaction: value.transaction,
	});
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
	if (left.byteLength !== right.byteLength) {
		return false;
	}
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) {
			return false;
		}
	}
	return true;
}

/**
 * Computes the IEEE CRC-32 checksum using the reflected 0xedb88320
 * polynomial, initial value 0xffffffff, and final xor 0xffffffff.
 */
export function crc32(bytes: Uint8Array): number {
	return crc32Range(bytes, 0, bytes.byteLength);
}

function crc32Range(
	bytes: Uint8Array,
	offset: number,
	byteLength: number,
): number {
	let checksum = 0xffffffff;
	const end = offset + byteLength;
	for (let index = offset; index < end; index += 1) {
		checksum ^= bytes[index] ?? 0;
		for (let bit = 0; bit < 8; bit += 1) {
			checksum =
				(checksum >>> 1)
				^ ((checksum & 1) === 1 ? 0xedb88320 : 0);
		}
	}
	return (checksum ^ 0xffffffff) >>> 0;
}

function writeRevisionWalHeader(
	bytes: Uint8Array,
	payloadLength: number,
	payloadChecksum: number,
): void {
	writeUint32BigEndian(bytes, 0, revisionWalFrameMagic);
	writeUint32BigEndian(bytes, 4, payloadLength);
	writeUint32BigEndian(bytes, 8, payloadChecksum);
	writeUint32BigEndian(bytes, 12, crc32Range(bytes, 0, 12));
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

function nestedPath(path: string): string {
	return path === '$' ? '' : path.slice(1);
}

function invalidRevision(
	reason: RevisionCodecFailure,
	path: string,
): IRevisionCodecError {
	return {
		type: 'invalid',
		reason,
		path,
	};
}

function invalidWal(
	reason: RevisionWalRecordCodecFailure,
	path: string,
): IRevisionWalRecordCodecError {
	return {
		type: 'invalid',
		reason,
		path,
	};
}

function validWalTail(lastCompleteOffset: number): IRevisionWalDecoderTail {
	return {
		type: 'valid',
		records: emptyWalRecords,
		lastCompleteOffset,
		incompleteTail: true,
	};
}

function corruptWal(
	records: readonly RevisionWalRecord[],
	lastCompleteOffset: number,
	corruptionOffset: number,
	reason: RevisionWalCorruptionReason,
): IRevisionWalCorruption {
	return {
		type: 'corrupt',
		records: records.length === 0
			? emptyWalRecords
			: Object.freeze([...records]),
		lastCompleteOffset,
		corruptionOffset,
		reason,
	};
}

function walCodecFailureToCorruption(
	reason: RevisionWalRecordCodecFailure,
): Exclude<
	RevisionWalCorruptionReason,
	'invalid-magic'
	| 'header-checksum-mismatch'
	| 'invalid-length'
	| 'checksum-mismatch'
	| 'invalid-utf8'
	| 'invalid-json'
	| 'non-canonical-payload'
	| 'resynchronization-budget-exceeded'
> {
	switch (reason) {
		case 'unsupported-version':
			return 'unsupported-version';
		case 'invalid-transaction':
			return 'invalid-transaction';
		case 'transaction-hash-mismatch':
			return 'transaction-hash-mismatch';
		case 'revision-transaction-mismatch':
			return 'revision-transaction-mismatch';
		default:
			return 'invalid-record';
	}
}
