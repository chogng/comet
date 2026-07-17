/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	BrowserManuscriptIdentityService,
	type IBrowserManuscriptIdentityEnvironment,
} from 'cs/editor/browser/services/identityService';
import {
	parseEntityId,
	parseNodeId,
	parseOperationId,
	parseProposalId,
	parseRevisionId,
	parseTransactionId,
} from 'cs/editor/common/core/identifiers';
import { ManuscriptIdentityError } from 'cs/editor/common/services/identityService';

class TestIdentityEnvironment implements IBrowserManuscriptIdentityEnvironment {
	private clockIndex = 0;
	private entropyIndex = 0;

	constructor(
		private readonly clockValues: readonly number[],
		private readonly entropyValues: readonly Uint8Array[],
	) {}

	now(): number {
		const value = this.clockValues[this.clockIndex];
		this.clockIndex += 1;
		if (value === undefined) {
			throw new Error('The test clock is exhausted.');
		}
		return value;
	}

	fillRandomBytes(target: Uint8Array): void {
		const value = this.entropyValues[this.entropyIndex];
		this.entropyIndex += 1;
		if (value === undefined) {
			throw new Error('The test entropy source is exhausted.');
		}
		target.set(value);
	}
}

function environment(
	clockValues: readonly number[],
	entropyValues: readonly number[],
): TestIdentityEnvironment {
	return new TestIdentityEnvironment(
		clockValues,
		entropyValues.map(value => new Uint8Array(10).fill(value)),
	);
}

suite('Manuscript identity service', () => {
	test('allocates every Editor identity through one monotonic sequence', () => {
		const service = new BrowserManuscriptIdentityService(environment(
			[10, 10, 9, 11, 11, 11],
			[0, 0xff, 0xff, 0, 0, 0],
		));
		const values = [
			service.allocateRevisionId(),
			service.allocateTransactionId(),
			service.allocateOperationId(),
			service.allocateNodeId(),
			service.allocateEntityId(),
			service.allocateProposalId(),
		];

		assert.deepStrictEqual(values, [
			'00000000-000a-7000-8000-000000000000',
			'00000000-000a-7000-8000-000000000001',
			'00000000-000a-7000-8000-000000000002',
			'00000000-000b-7000-8000-000000000000',
			'00000000-000b-7000-8000-000000000001',
			'00000000-000b-7000-8000-000000000002',
		]);
		assert.equal(parseRevisionId(values[0]!).type, 'valid');
		assert.equal(parseTransactionId(values[1]!).type, 'valid');
		assert.equal(parseOperationId(values[2]!).type, 'valid');
		assert.equal(parseNodeId(values[3]!).type, 'valid');
		assert.equal(parseEntityId(values[4]!).type, 'valid');
		assert.equal(parseProposalId(values[5]!).type, 'valid');
	});

	test('fails closed when the browser clock is unavailable', () => {
		const service = new BrowserManuscriptIdentityService(environment(
			[Number.NaN],
			[0],
		));

		assert.throws(
			() => service.allocateNodeId(),
			error => error instanceof ManuscriptIdentityError
				&& error.code === 'IDENTITY_CLOCK_UNAVAILABLE',
		);
	});

	test('fails closed when cryptographic entropy is unavailable', () => {
		const service = new BrowserManuscriptIdentityService({
			now: () => 10,
			fillRandomBytes: () => {
				throw new ManuscriptIdentityError(
					'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
				);
			},
		});

		assert.throws(
			() => service.allocateNodeId(),
			error => error instanceof ManuscriptIdentityError
				&& error.code === 'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
		);
	});

	test('reports sequence exhaustion without wrapping or using another source', () => {
		const service = new BrowserManuscriptIdentityService(environment(
			[10, 10],
			[0xff, 0xff],
		));

		assert.equal(
			service.allocateOperationId(),
			'00000000-000a-7fff-bfff-ffffffffffff',
		);
		assert.throws(
			() => service.allocateOperationId(),
			error => error instanceof ManuscriptIdentityError
				&& error.code === 'IDENTITY_SEQUENCE_EXHAUSTED',
		);
	});
});
