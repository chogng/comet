/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	parseOperationId,
	parseTransactionId,
	type OperationId,
	type TransactionId,
} from 'cs/editor/common/core/identifiers';
import {
	TransactionIdentityAuthority,
	type TransactionIdentityReservationResult,
	type TransactionIdentityReservation,
} from 'cs/editor/common/model/transactionIdentityAuthority';
import { maximumTransactionOperations } from 'cs/editor/common/model/transaction';

function uuid(seed: number): string {
	return `018f0000-0000-7000-8000-${seed.toString(16).padStart(12, '0')}`;
}

function transactionId(seed: number): TransactionId {
	const parsed = parseTransactionId(uuid(seed));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Transaction ID fixture.');
	}
	return parsed.value;
}

function operationId(seed: number): OperationId {
	const parsed = parseOperationId(uuid(seed));
	if (parsed.type === 'invalid') {
		throw new Error('Expected a valid Operation ID fixture.');
	}
	return parsed.value;
}

function reserve(
	authority: TransactionIdentityAuthority,
	transaction: TransactionId,
	operations: readonly OperationId[],
): TransactionIdentityReservation {
	const result = authority.reserve(transaction, operations);
	if (result.type === 'error') {
		assert.fail(`Expected reservation, received ${result.reason}.`);
	}
	return result.value;
}

function failureReason(
	result: TransactionIdentityReservationResult,
): string {
	if (result.type !== 'error') {
		assert.fail('Expected an identity reservation failure.');
	}
	return result.reason;
}

suite('Transaction identity authority', () => {
	test('commits one atomic Transaction and Operation identity reservation', () => {
		const authority = new TransactionIdentityAuthority();
		const transaction = transactionId(1);
		const operations = [operationId(2), operationId(3)] as const;
		const reservation = reserve(authority, transaction, operations);

		assert.equal(Object.isFrozen(reservation), true);
		assert.equal(Object.isFrozen(reservation.operationIds), true);
		assert.equal(authority.isCommitted(transaction), false);
		assert.deepStrictEqual(authority.commit(reservation), { type: 'ok' });
		assert.equal(authority.isCommitted(transaction), true);
		assert.equal(authority.isCommitted(operations[0]), true);
		assert.equal(authority.isCommitted(operations[1]), true);
		assert.deepStrictEqual(authority.commit(reservation), {
			type: 'error',
			reason: 'invalid-reservation',
			path: '$reservation',
		});
	});

	test('keeps authority state and dispatch unreachable from runtime callers', () => {
		const authority = new TransactionIdentityAuthority();
		const authorityPrototype = Object.getPrototypeOf(authority) as object;

		assert.equal(Object.isFrozen(authority), true);
		assert.equal(Object.isFrozen(authorityPrototype), true);
		assert.equal(Object.isFrozen(TransactionIdentityAuthority), true);
		assert.deepStrictEqual(Reflect.ownKeys(authority), []);
		assert.equal(
			Reflect.set(
				authorityPrototype,
				'isCommitted',
				() => true,
			),
			false,
		);

		const transaction = transactionId(4);
		const operation = operationId(5);
		const reservation = reserve(authority, transaction, [operation]);
		assert.deepStrictEqual(authority.commit(reservation), { type: 'ok' });
		assert.equal(authority.isCommitted(transaction), true);
		assert.equal(authority.isCommitted(operation), true);
	});

	test('blocks pending and committed identifiers across identity kinds', () => {
		const authority = new TransactionIdentityAuthority();
		const transaction = transactionId(10);
		const operation = operationId(11);
		const reservation = reserve(authority, transaction, [operation]);

		assert.deepStrictEqual(
			authority.reserve(operation as unknown as TransactionId, [
				operationId(12),
			]),
			{
				type: 'error',
				reason: 'identifier-already-reserved',
				path: '$',
				identifier: operation,
			},
		);
		assert.deepStrictEqual(authority.commit(reservation), { type: 'ok' });
		assert.deepStrictEqual(
			authority.reserve(transactionId(13), [
				transaction as unknown as OperationId,
			]),
			{
				type: 'error',
				reason: 'identifier-already-used',
				path: '$',
				identifier: transaction,
			},
		);
	});

	test('releases an uncommitted reservation without burning its IDs', () => {
		const authority = new TransactionIdentityAuthority();
		const transaction = transactionId(20);
		const operation = operationId(21);
		const reservation = reserve(authority, transaction, [operation]);

		assert.deepStrictEqual(authority.release(reservation), { type: 'ok' });
		assert.deepStrictEqual(authority.release(reservation), {
			type: 'error',
			reason: 'invalid-reservation',
			path: '$reservation',
		});
		const replacement = reserve(authority, transaction, [operation]);
		assert.deepStrictEqual(authority.commit(replacement), { type: 'ok' });
	});

	test('restores the used-ID set during recovery', () => {
		const authority = new TransactionIdentityAuthority();
		const transaction = transactionId(30);
		const operations = [operationId(31), operationId(32)] as const;

		assert.deepStrictEqual(
			authority.recordRecovered(transaction, operations),
			{ type: 'ok' },
		);
		assert.deepStrictEqual(
			authority.recordRecovered(transaction, operations),
			{
				type: 'error',
				reason: 'identifier-already-used',
				path: '$',
				identifier: transaction,
			},
		);
		assert.deepStrictEqual(
			authority.reserve(transactionId(33), [operations[1]]),
			{
				type: 'error',
				reason: 'identifier-already-used',
				path: '$',
				identifier: operations[1],
			},
		);
	});

	test('rejects duplicate, sparse, accessor, extra, and oversized ID lists', () => {
		const authority = new TransactionIdentityAuthority();
		const transaction = transactionId(40);
		const operation = operationId(41);

		assert.equal(
			failureReason(authority.reserve(transaction, [operation, operation])),
			'duplicate-identifier',
		);
		assert.equal(
			failureReason(authority.reserve(
				transaction,
				[transaction as unknown as OperationId],
			)),
			'duplicate-identifier',
		);

		const sparse = new Array<OperationId>(1);
		assert.equal(
			failureReason(authority.reserve(transaction, sparse)),
			'invalid-operation-ids',
		);

		const accessor: OperationId[] = [];
		Object.defineProperty(accessor, '0', {
			enumerable: true,
			get: () => operation,
		});
		accessor.length = 1;
		assert.equal(
			failureReason(authority.reserve(transaction, accessor)),
			'invalid-operation-ids',
		);

		const extra = [operation] as OperationId[] & { extra?: string };
		extra.extra = 'unexpected';
		assert.equal(
			failureReason(authority.reserve(transaction, extra)),
			'invalid-operation-ids',
		);

		const oversized = Array.from(
			{ length: 1_025 },
			(_, index) => operationId(1_000 + index),
		);
		assert.equal(
			failureReason(authority.reserve(transaction, oversized)),
			'operation-limit-exceeded',
		);
	});

	test('checks the operation limit before enumerating or copying descriptors', () => {
		const authority = new TransactionIdentityAuthority();
		const oversized = new Array<OperationId>(
			maximumTransactionOperations + 1,
		);
		let ownKeysCalls = 0;
		let descriptorCalls = 0;
		let getterCalls = 0;
		const hostile = new Proxy(oversized, {
			ownKeys(target): ArrayLike<string | symbol> {
				ownKeysCalls += 1;
				return Reflect.ownKeys(target);
			},
			getOwnPropertyDescriptor(
				target,
				key,
			): PropertyDescriptor | undefined {
				descriptorCalls += 1;
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
			get(target, key, receiver): unknown {
				getterCalls += 1;
				return Reflect.get(target, key, receiver);
			},
		});

		assert.equal(
			failureReason(authority.reserve(transactionId(42), hostile)),
			'operation-limit-exceeded',
		);
		assert.equal(ownKeysCalls, 0);
		assert.equal(descriptorCalls, 1);
		assert.equal(getterCalls, 0);
	});

	test('captures each exact operation ID descriptor once without property reads', () => {
		const authority = new TransactionIdentityAuthority();
		const operations = [operationId(43), operationId(44)];
		const descriptorCounts = new Map<PropertyKey, number>();
		let ownKeysCalls = 0;
		let getterCalls = 0;
		const captured = new Proxy(operations, {
			ownKeys(target): ArrayLike<string | symbol> {
				ownKeysCalls += 1;
				return Reflect.ownKeys(target);
			},
			getOwnPropertyDescriptor(
				target,
				key,
			): PropertyDescriptor | undefined {
				descriptorCounts.set(
					key,
					(descriptorCounts.get(key) ?? 0) + 1,
				);
				return Reflect.getOwnPropertyDescriptor(target, key);
			},
			get(target, key, receiver): unknown {
				getterCalls += 1;
				return Reflect.get(target, key, receiver);
			},
		});

		const reservation = reserve(
			authority,
			transactionId(45),
			captured,
		);
		assert.equal(reservation.operationIds.length, 2);
		assert.equal(ownKeysCalls, 1);
		assert.deepStrictEqual(
			[...descriptorCounts.entries()],
			[
				['length', 1],
				['0', 1],
				['1', 1],
			],
		);
		assert.equal(getterCalls, 0);
	});

	test('rejects forged and foreign reservations', () => {
		const authority = new TransactionIdentityAuthority();
		const otherAuthority = new TransactionIdentityAuthority();
		const reservation = reserve(
			authority,
			transactionId(50),
			[operationId(51)],
		);
		const forged = {
			transactionId: reservation.transactionId,
			operationIds: reservation.operationIds,
		};

		assert.deepStrictEqual(authority.commit(forged), {
			type: 'error',
			reason: 'invalid-reservation',
			path: '$reservation',
		});
		assert.deepStrictEqual(otherAuthority.commit(reservation), {
			type: 'error',
			reason: 'invalid-reservation',
			path: '$reservation',
		});
		assert.deepStrictEqual(authority.commit(reservation), { type: 'ok' });
	});

	test('converts hostile inspection failure into a typed result', () => {
		const authority = new TransactionIdentityAuthority();
		const revoked = Proxy.revocable([operationId(61)], {});
		revoked.revoke();

		assert.deepStrictEqual(
			authority.reserve(transactionId(60), revoked.proxy),
			{
				type: 'error',
				reason: 'inspection-failed',
				path: '$.operationIds',
			},
		);
	});
});
