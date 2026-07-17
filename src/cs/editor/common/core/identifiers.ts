/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare const manuscriptIdentifierBrand: unique symbol;

type ManuscriptIdentifier<TName extends string> = string & {
	readonly [manuscriptIdentifierBrand]: TName;
};

export type RevisionId = ManuscriptIdentifier<'RevisionId'>;
export type TransactionId = ManuscriptIdentifier<'TransactionId'>;
export type OperationId = ManuscriptIdentifier<'OperationId'>;
export type NodeId = ManuscriptIdentifier<'NodeId'>;
export type EntityId = ManuscriptIdentifier<'EntityId'>;
export type ProposalId = ManuscriptIdentifier<'ProposalId'>;
export type ProposalChangeGroupId = ManuscriptIdentifier<'ProposalChangeGroupId'>;
export type ContentHash = ManuscriptIdentifier<'ContentHash'>;

export type IdentifierParseFailure =
	| 'empty'
	| 'too-long'
	| 'invalid-content-hash'
	| 'not-canonical-uuid'
	| 'wrong-uuid-version';

export type IdentifierParseResult<TIdentifier> =
	| {
		readonly type: 'valid';
		readonly value: TIdentifier;
	}
	| {
		readonly type: 'invalid';
		readonly reason: IdentifierParseFailure;
	};

export interface IUuidV7Seed {
	readonly unixMilliseconds: number;
	readonly randomBytes: Uint8Array;
}

export interface IUuidV7SeedSource {
	nextSeed(): IUuidV7Seed;
}

export type UuidV7AllocationFailure =
	| 'invalid-timestamp'
	| 'invalid-random-byte-count'
	| 'sequence-exhausted';

export class UuidV7AllocationError extends Error {
	constructor(readonly reason: UuidV7AllocationFailure) {
		super(`Unable to allocate a manuscript UUIDv7: ${reason}.`);
		this.name = 'UuidV7AllocationError';
	}
}

const maximumIdentifierLength = 128;
const canonicalUuidPattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const uuidV7Pattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const uuidV8Pattern =
	/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^sha256:[a-f0-9]{64}$/u;

export function parseRevisionId(value: string): IdentifierParseResult<RevisionId> {
	return parseAllocatedIdentifier(value, validated => validated as RevisionId);
}

export function parseTransactionId(value: string): IdentifierParseResult<TransactionId> {
	return parseAllocatedIdentifier(value, validated => validated as TransactionId);
}

export function parseOperationId(value: string): IdentifierParseResult<OperationId> {
	return parseAllocatedIdentifier(value, validated => validated as OperationId);
}

export function parseNodeId(value: string): IdentifierParseResult<NodeId> {
	return parseAllocatedIdentifier(value, validated => validated as NodeId);
}

export function parseEntityId(value: string): IdentifierParseResult<EntityId> {
	return parseAllocatedIdentifier(value, validated => validated as EntityId);
}

export function parseProposalId(value: string): IdentifierParseResult<ProposalId> {
	return parseAllocatedIdentifier(value, validated => validated as ProposalId);
}

export function parseProposalChangeGroupId(
	value: string,
): IdentifierParseResult<ProposalChangeGroupId> {
	return parseUuidIdentifier(
		value,
		8,
		uuidV8Pattern,
		validated => validated as ProposalChangeGroupId,
	);
}

export function parseContentHash(value: string): IdentifierParseResult<ContentHash> {
	if (!sha256Pattern.test(value)) {
		return {
			type: 'invalid',
			reason: 'invalid-content-hash',
		};
	}

	return {
		type: 'valid',
		value: value as ContentHash,
	};
}

export function isCanonicalUuidV7(value: string): boolean {
	return parseUuidIdentifier(value, 7, uuidV7Pattern, validated => validated).type === 'valid';
}

export class UuidV7IdAllocator {
	private previousBytes: Uint8Array | undefined;

	constructor(private readonly source: IUuidV7SeedSource) {}

	allocateRevisionId(): RevisionId {
		return this.allocate(parseRevisionId);
	}

	allocateTransactionId(): TransactionId {
		return this.allocate(parseTransactionId);
	}

	allocateOperationId(): OperationId {
		return this.allocate(parseOperationId);
	}

	allocateNodeId(): NodeId {
		return this.allocate(parseNodeId);
	}

	allocateEntityId(): EntityId {
		return this.allocate(parseEntityId);
	}

	allocateProposalId(): ProposalId {
		return this.allocate(parseProposalId);
	}

	private allocate<TIdentifier>(
		parse: (value: string) => IdentifierParseResult<TIdentifier>,
	): TIdentifier {
		const candidate = createUuidV7Bytes(this.source.nextSeed());
		const bytes = this.previousBytes === undefined
			? candidate
			: ensureMonotonicUuidV7(candidate, this.previousBytes);
		this.previousBytes = bytes;

		const parsed = parse(formatUuid(bytes));
		if (parsed.type === 'invalid') {
			throw new UuidV7AllocationError('invalid-random-byte-count');
		}
		return parsed.value;
	}
}

export function createUuidV7(seed: IUuidV7Seed): string {
	return formatUuid(createUuidV7Bytes(seed));
}

export function deriveProposalChangeGroupId(digest: Uint8Array): ProposalChangeGroupId {
	if (digest.length < 16) {
		throw new RangeError('A derived manuscript UUIDv8 requires at least 16 digest bytes.');
	}

	const uuidBytes = digest.slice(0, 16);
	uuidBytes[6] = ((uuidBytes[6] ?? 0) & 0x0f) | 0x80;
	uuidBytes[8] = ((uuidBytes[8] ?? 0) & 0x3f) | 0x80;
	const parsed = parseProposalChangeGroupId(formatUuid(uuidBytes));
	if (parsed.type === 'invalid') {
		throw new Error('The digest could not be encoded as a canonical manuscript UUIDv8.');
	}
	return parsed.value;
}

function parseAllocatedIdentifier<TIdentifier>(
	value: string,
	brand: (validated: string) => TIdentifier,
): IdentifierParseResult<TIdentifier> {
	return parseUuidIdentifier(value, 7, uuidV7Pattern, brand);
}

function parseUuidIdentifier<TIdentifier>(
	value: string,
	expectedVersion: 7 | 8,
	expectedPattern: RegExp,
	brand: (validated: string) => TIdentifier,
): IdentifierParseResult<TIdentifier> {
	if (value.length === 0) {
		return {
			type: 'invalid',
			reason: 'empty',
		};
	}

	if (value.length > maximumIdentifierLength) {
		return {
			type: 'invalid',
			reason: 'too-long',
		};
	}

	if (!canonicalUuidPattern.test(value)) {
		return {
			type: 'invalid',
			reason: 'not-canonical-uuid',
		};
	}

	if (!expectedPattern.test(value) || value[14] !== String(expectedVersion)) {
		return {
			type: 'invalid',
			reason: 'wrong-uuid-version',
		};
	}

	return {
		type: 'valid',
		value: brand(value),
	};
}

function createUuidV7Bytes(seed: IUuidV7Seed): Uint8Array {
	validateUuidV7Seed(seed);

	const bytes = new Uint8Array(16);
	writeUuidTimestamp(bytes, seed.unixMilliseconds);
	bytes[6] = 0x70 | ((seed.randomBytes[0] ?? 0) & 0x0f);
	bytes[7] = seed.randomBytes[1] ?? 0;
	bytes[8] = 0x80 | ((seed.randomBytes[2] ?? 0) & 0x3f);
	for (let index = 9; index < 16; index += 1) {
		bytes[index] = seed.randomBytes[index - 6] ?? 0;
	}
	return bytes;
}

function validateUuidV7Seed(seed: IUuidV7Seed): void {
	if (
		!Number.isSafeInteger(seed.unixMilliseconds)
		|| seed.unixMilliseconds < 0
		|| seed.unixMilliseconds > 0xffff_ffff_ffff
	) {
		throw new UuidV7AllocationError('invalid-timestamp');
	}

	if (seed.randomBytes.length !== 10) {
		throw new UuidV7AllocationError('invalid-random-byte-count');
	}
}

function writeUuidTimestamp(bytes: Uint8Array, timestamp: number): void {
	let remaining = timestamp;
	for (let index = 5; index >= 0; index -= 1) {
		bytes[index] = remaining % 256;
		remaining = Math.floor(remaining / 256);
	}
}

function ensureMonotonicUuidV7(candidate: Uint8Array, previous: Uint8Array): Uint8Array {
	if (compareUuidTimestamp(candidate, previous) > 0) {
		return candidate;
	}

	const next = previous.slice();
	if (!incrementUuidRandomField(next)) {
		throw new UuidV7AllocationError('sequence-exhausted');
	}
	return next;
}

function compareUuidTimestamp(left: Uint8Array, right: Uint8Array): number {
	for (let index = 0; index < 6; index += 1) {
		const difference = (left[index] ?? 0) - (right[index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}
	return 0;
}

function incrementUuidRandomField(bytes: Uint8Array): boolean {
	for (let index = 15; index >= 9; index -= 1) {
		if (incrementUuidByte(bytes, index, 0xff)) {
			return true;
		}
	}
	if (incrementUuidByte(bytes, 8, 0xbf, 0x80)) {
		return true;
	}
	if (incrementUuidByte(bytes, 7, 0xff)) {
		return true;
	}
	return incrementUuidByte(bytes, 6, 0x7f, 0x70);
}

function incrementUuidByte(
	bytes: Uint8Array,
	index: number,
	maximum: number,
	reset = 0,
): boolean {
	const value = bytes[index] ?? reset;
	if (value < maximum) {
		bytes[index] = value + 1;
		return true;
	}
	bytes[index] = reset;
	return false;
}

function formatUuid(bytes: Uint8Array): string {
	const hexadecimal = Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
	return `${hexadecimal.slice(0, 8)}-${hexadecimal.slice(8, 12)}-${hexadecimal.slice(
		12,
		16,
	)}-${hexadecimal.slice(16, 20)}-${hexadecimal.slice(20)}`;
}
