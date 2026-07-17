/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	createUuidV7,
	deriveProposalChangeGroupId,
	isCanonicalUuidV7,
	parseContentHash,
	parseEntityId,
	parseNodeId,
	parseOperationId,
	parseProposalChangeGroupId,
	parseProposalId,
	parseRevisionId,
	parseTransactionId,
	UuidV7AllocationError,
	UuidV7IdAllocator,
	type IUuidV7Seed,
	type IUuidV7SeedSource,
	type UuidV7AllocationFailure,
} from 'cs/editor/common/core/identifiers';

const fixedTimestamp = 0x0123_4567_89ab;
const fixedUuidV7 = '01234567-89ab-7001-8203-040506070809';

function seed(
	unixMilliseconds: number,
	randomBytes: Uint8Array = new Uint8Array(10),
): IUuidV7Seed {
	return { unixMilliseconds, randomBytes };
}

function source(...seeds: readonly IUuidV7Seed[]): IUuidV7SeedSource {
	let index = 0;
	return {
		nextSeed: () => {
			const value = seeds[index];
			index += 1;
			if (value === undefined) {
				throw new Error('The deterministic UUIDv7 seed source was exhausted.');
			}
			return value;
		},
	};
}

function assertAllocationFailure(
	action: () => unknown,
	reason: UuidV7AllocationFailure,
): void {
	assert.throws(action, error => {
		assert.ok(error instanceof UuidV7AllocationError);
		assert.equal(error.reason, reason);
		return true;
	});
}

suite('Manuscript identifiers', () => {
	test('parses only canonical UUIDv7 allocated identifiers', () => {
		const allocatedParsers = [
			parseRevisionId,
			parseTransactionId,
			parseOperationId,
			parseNodeId,
			parseEntityId,
			parseProposalId,
		] as const;

		for (const parse of allocatedParsers) {
			assert.deepStrictEqual(parse(fixedUuidV7), {
				type: 'valid',
				value: fixedUuidV7,
			});
			assert.deepStrictEqual(parse(''), {
				type: 'invalid',
				reason: 'empty',
			});
			assert.deepStrictEqual(parse('x'.repeat(129)), {
				type: 'invalid',
				reason: 'too-long',
			});
			assert.deepStrictEqual(parse(fixedUuidV7.toUpperCase()), {
				type: 'invalid',
				reason: 'not-canonical-uuid',
			});
			assert.deepStrictEqual(parse('0123456789ab70018203040506070809'), {
				type: 'invalid',
				reason: 'not-canonical-uuid',
			});
			assert.deepStrictEqual(parse('01234567-89ab-7001-7203-040506070809'), {
				type: 'invalid',
				reason: 'not-canonical-uuid',
			});
			assert.deepStrictEqual(parse('01234567-89ab-8001-8203-040506070809'), {
				type: 'invalid',
				reason: 'wrong-uuid-version',
			});
			assert.deepStrictEqual(parse('revision-01234567-89ab-7001-8203-040506070809'), {
				type: 'invalid',
				reason: 'not-canonical-uuid',
			});
		}

		assert.equal(isCanonicalUuidV7(fixedUuidV7), true);
		assert.equal(isCanonicalUuidV7(fixedUuidV7.toUpperCase()), false);
		assert.equal(isCanonicalUuidV7('01234567-89ab-8001-8203-040506070809'), false);
	});

	test('parses only canonical UUIDv8 proposal change group identifiers', () => {
		const uuidV8 = '01234567-89ab-8001-a203-040506070809';

		assert.deepStrictEqual(parseProposalChangeGroupId(uuidV8), {
			type: 'valid',
			value: uuidV8,
		});
		assert.deepStrictEqual(parseProposalChangeGroupId(fixedUuidV7), {
			type: 'invalid',
			reason: 'wrong-uuid-version',
		});
		assert.deepStrictEqual(parseProposalChangeGroupId(uuidV8.toUpperCase()), {
			type: 'invalid',
			reason: 'not-canonical-uuid',
		});
		assert.deepStrictEqual(
			parseProposalChangeGroupId('01234567-89ab-8001-2203-040506070809'),
			{
				type: 'invalid',
				reason: 'not-canonical-uuid',
			},
		);
	});

	test('parses only lowercase sha256 content hashes', () => {
		const contentHash = `sha256:${'ab'.repeat(32)}`;

		assert.deepStrictEqual(parseContentHash(contentHash), {
			type: 'valid',
			value: contentHash,
		});
		for (const invalid of [
			'',
			`sha256:${'AB'.repeat(32)}`,
			`sha256:${'a'.repeat(63)}`,
			`sha512:${'a'.repeat(64)}`,
			`sha256:${'g'.repeat(64)}`,
		]) {
			assert.deepStrictEqual(parseContentHash(invalid), {
				type: 'invalid',
				reason: 'invalid-content-hash',
			});
		}
	});

	test('encodes the fixed UUIDv7 vector without ambient time or randomness', () => {
		assert.equal(
			createUuidV7(seed(fixedTimestamp, Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]))),
			fixedUuidV7,
		);
	});

	test('allocates monotonically across equal and regressed clocks', () => {
		const allocator = new UuidV7IdAllocator(source(
			seed(fixedTimestamp),
			seed(fixedTimestamp),
			seed(fixedTimestamp - 1, new Uint8Array(10).fill(0xff)),
			seed(fixedTimestamp + 1),
		));

		assert.equal(
			allocator.allocateRevisionId(),
			'01234567-89ab-7000-8000-000000000000',
		);
		assert.equal(
			allocator.allocateTransactionId(),
			'01234567-89ab-7000-8000-000000000001',
		);
		assert.equal(
			allocator.allocateOperationId(),
			'01234567-89ab-7000-8000-000000000002',
		);
		assert.equal(
			allocator.allocateNodeId(),
			'01234567-89ac-7000-8000-000000000000',
		);
	});

	test('allocates every public UUIDv7 identifier kind from one monotonic sequence', () => {
		const allocator = new UuidV7IdAllocator(source(
			seed(0),
			seed(0),
			seed(0),
			seed(0),
			seed(0),
			seed(0),
		));

		assert.deepStrictEqual(
			[
				allocator.allocateRevisionId(),
				allocator.allocateTransactionId(),
				allocator.allocateOperationId(),
				allocator.allocateNodeId(),
				allocator.allocateEntityId(),
				allocator.allocateProposalId(),
			],
			[
				'00000000-0000-7000-8000-000000000000',
				'00000000-0000-7000-8000-000000000001',
				'00000000-0000-7000-8000-000000000002',
				'00000000-0000-7000-8000-000000000003',
				'00000000-0000-7000-8000-000000000004',
				'00000000-0000-7000-8000-000000000005',
			],
		);
	});

	test('fails instead of wrapping an exhausted UUIDv7 random field', () => {
		const maximumRandomField = new Uint8Array(10).fill(0xff);
		const allocator = new UuidV7IdAllocator(source(
			seed(fixedTimestamp, maximumRandomField),
			seed(fixedTimestamp, maximumRandomField),
		));

		assert.equal(
			allocator.allocateRevisionId(),
			'01234567-89ab-7fff-bfff-ffffffffffff',
		);
		assertAllocationFailure(
			() => allocator.allocateRevisionId(),
			'sequence-exhausted',
		);
	});

	test('rejects invalid UUIDv7 seed timestamps and random byte counts', () => {
		for (const unixMilliseconds of [
			-1,
			0.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			0x1_0000_0000_0000,
		]) {
			assertAllocationFailure(
				() => createUuidV7(seed(unixMilliseconds)),
				'invalid-timestamp',
			);
		}

		for (const length of [0, 9, 11]) {
			assertAllocationFailure(
				() => createUuidV7(seed(fixedTimestamp, new Uint8Array(length))),
				'invalid-random-byte-count',
			);
		}

		assert.equal(
			createUuidV7(seed(0xffff_ffff_ffff)),
			'ffffffff-ffff-7000-8000-000000000000',
		);
	});

	test('derives a canonical UUIDv8 from the first sixteen digest bytes', () => {
		const digest = Uint8Array.from({ length: 32 }, (_, index) => index);

		assert.equal(
			deriveProposalChangeGroupId(digest),
			'00010203-0405-8607-8809-0a0b0c0d0e0f',
		);
		assert.throws(
			() => deriveProposalChangeGroupId(new Uint8Array(15)),
			RangeError,
		);
	});
});
