/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	parseOperationId,
	parseTransactionId,
	type OperationId,
	type TransactionId,
} from 'cs/editor/common/core/identifiers';
import { maximumTransactionOperations } from 'cs/editor/common/model/transaction';

export interface TransactionIdentityReservation {
	readonly transactionId: TransactionId;
	readonly operationIds: readonly [OperationId, ...OperationId[]];
}

export type TransactionIdentityAuthorityFailure =
	| 'inspection-failed'
	| 'invalid-transaction-id'
	| 'invalid-operation-ids'
	| 'operation-limit-exceeded'
	| 'duplicate-identifier'
	| 'identifier-already-used'
	| 'identifier-already-reserved'
	| 'invalid-reservation';

export interface ITransactionIdentityAuthorityError {
	readonly type: 'error';
	readonly reason: TransactionIdentityAuthorityFailure;
	readonly path: string;
	readonly identifier?: string;
}

export type TransactionIdentityReservationResult =
	| {
		readonly type: 'ok';
		readonly value: TransactionIdentityReservation;
	}
	| ITransactionIdentityAuthorityError;

export type TransactionIdentityMutationResult =
	| {
		readonly type: 'ok';
	}
	| ITransactionIdentityAuthorityError;

interface IReservationState {
	readonly authority: TransactionIdentityAuthority;
	status: 'active' | 'committed' | 'released';
}

const reservationStates =
	new WeakMap<TransactionIdentityReservation, IReservationState>();

/**
 * Owns the persistent Transaction and Operation ID namespace for one model.
 */
export class TransactionIdentityAuthority {
	readonly #committedIdentifiers = new Set<string>();
	readonly #reservedIdentifiers = new Set<string>();

	constructor() {
		Object.freeze(this);
	}

	reserve(
		transactionId: unknown,
		operationIds: unknown,
	): TransactionIdentityReservationResult {
		const identity = readTransactionIdentity(transactionId, operationIds);
		if (identity.type === 'error') {
			return identity;
		}

		const availability = this.validateAvailability(identity.value);
		if (availability !== undefined) {
			return availability;
		}

		for (const identifier of identityIdentifiers(identity.value)) {
			this.#reservedIdentifiers.add(identifier);
		}
		const reservation = createReservation(identity.value);
		reservationStates.set(reservation, {
			authority: this,
			status: 'active',
		});
		return Object.freeze({
			type: 'ok',
			value: reservation,
		});
	}

	commit(
		reservation: unknown,
	): TransactionIdentityMutationResult {
		const state = readActiveReservationState(reservation, this);
		if (state === undefined) {
			return authorityError('invalid-reservation', '$reservation');
		}
		const trustedReservation = reservation as TransactionIdentityReservation;

		for (const identifier of identityIdentifiers(trustedReservation)) {
			if (
				!this.#reservedIdentifiers.has(identifier)
				|| this.#committedIdentifiers.has(identifier)
			) {
				return authorityError(
					'invalid-reservation',
					'$reservation',
					identifier,
				);
			}
		}

		for (const identifier of identityIdentifiers(trustedReservation)) {
			this.#reservedIdentifiers.delete(identifier);
			this.#committedIdentifiers.add(identifier);
		}
		state.status = 'committed';
		return okMutation();
	}

	release(
		reservation: unknown,
	): TransactionIdentityMutationResult {
		const state = readActiveReservationState(reservation, this);
		if (state === undefined) {
			return authorityError('invalid-reservation', '$reservation');
		}
		const trustedReservation = reservation as TransactionIdentityReservation;

		for (const identifier of identityIdentifiers(trustedReservation)) {
			if (!this.#reservedIdentifiers.has(identifier)) {
				return authorityError(
					'invalid-reservation',
					'$reservation',
					identifier,
				);
			}
		}

		for (const identifier of identityIdentifiers(trustedReservation)) {
			this.#reservedIdentifiers.delete(identifier);
		}
		state.status = 'released';
		return okMutation();
	}

	recordRecovered(
		transactionId: unknown,
		operationIds: unknown,
	): TransactionIdentityMutationResult {
		const identity = readTransactionIdentity(transactionId, operationIds);
		if (identity.type === 'error') {
			return identity;
		}

		const availability = this.validateAvailability(identity.value);
		if (availability !== undefined) {
			return availability;
		}
		for (const identifier of identityIdentifiers(identity.value)) {
			this.#committedIdentifiers.add(identifier);
		}
		return okMutation();
	}

	isCommitted(identifier: TransactionId | OperationId): boolean {
		return this.#committedIdentifiers.has(identifier);
	}

	private validateAvailability(
		identity: TransactionIdentityReservation,
	): ITransactionIdentityAuthorityError | undefined {
		for (const identifier of identityIdentifiers(identity)) {
			if (this.#committedIdentifiers.has(identifier)) {
				return authorityError(
					'identifier-already-used',
					'$',
					identifier,
				);
			}
			if (this.#reservedIdentifiers.has(identifier)) {
				return authorityError(
					'identifier-already-reserved',
					'$',
					identifier,
				);
			}
		}
		return undefined;
	}
}

Object.freeze(TransactionIdentityAuthority.prototype);
Object.freeze(TransactionIdentityAuthority);

function readTransactionIdentity(
	transactionId: unknown,
	operationIds: unknown,
): TransactionIdentityReservationResult {
	if (typeof transactionId !== 'string') {
		return authorityError('invalid-transaction-id', '$.transactionId');
	}
	const parsedTransactionId = parseTransactionId(transactionId);
	if (parsedTransactionId.type === 'invalid') {
		return authorityError('invalid-transaction-id', '$.transactionId');
	}

	try {
		if (!Array.isArray(operationIds)) {
			return authorityError('invalid-operation-ids', '$.operationIds');
		}
		const lengthDescriptor = Reflect.getOwnPropertyDescriptor(
			operationIds,
			'length',
		);
		const lengthValue = lengthDescriptor !== undefined
			&& 'value' in lengthDescriptor
			? lengthDescriptor.value
			: undefined;
		if (
			typeof lengthValue !== 'number'
			|| !Number.isSafeInteger(lengthValue)
			|| lengthValue < 1
		) {
			return authorityError(
				'invalid-operation-ids',
				'$.operationIds',
			);
		}
		const length = lengthValue;
		if (length > maximumTransactionOperations) {
			return authorityError('operation-limit-exceeded', '$.operationIds');
		}
		const keys = Reflect.ownKeys(operationIds);
		if (
			keys.length !== length + 1
			|| keys.some(key =>
				key !== 'length' && !isArrayIndexKey(key, length))
		) {
			return authorityError('invalid-operation-ids', '$.operationIds');
		}

		const parsedOperationIds: OperationId[] = [];
		const seenIdentifiers = new Set<string>([parsedTransactionId.value]);
		for (let index = 0; index < length; index += 1) {
			const descriptor = Reflect.getOwnPropertyDescriptor(
				operationIds,
				String(index),
			);
			if (
				descriptor === undefined
				|| !('value' in descriptor)
				|| descriptor.enumerable !== true
				|| typeof descriptor.value !== 'string'
			) {
				return authorityError(
					'invalid-operation-ids',
					`$.operationIds[${index}]`,
				);
			}
			const parsed = parseOperationId(descriptor.value);
			if (parsed.type === 'invalid') {
				return authorityError(
					'invalid-operation-ids',
					`$.operationIds[${index}]`,
				);
			}
			if (seenIdentifiers.has(parsed.value)) {
				return authorityError(
					'duplicate-identifier',
					`$.operationIds[${index}]`,
					parsed.value,
				);
			}
			seenIdentifiers.add(parsed.value);
			parsedOperationIds.push(parsed.value);
		}

		return Object.freeze({
			type: 'ok',
			value: createReservation({
				transactionId: parsedTransactionId.value,
				operationIds: parsedOperationIds as [
					OperationId,
					...OperationId[],
				],
			}),
		});
	} catch {
		return authorityError('inspection-failed', '$.operationIds');
	}
}

function createReservation(
	identity: TransactionIdentityReservation,
): TransactionIdentityReservation {
	return Object.freeze({
		transactionId: identity.transactionId,
		operationIds: Object.freeze([...identity.operationIds]) as readonly [
			OperationId,
			...OperationId[],
		],
	});
}

function* identityIdentifiers(
	identity: TransactionIdentityReservation,
): IterableIterator<string> {
	yield identity.transactionId;
	yield* identity.operationIds;
}

function readActiveReservationState(
	value: unknown,
	authority: TransactionIdentityAuthority,
): IReservationState | undefined {
	if (
		typeof value !== 'object'
		|| value === null
	) {
		return undefined;
	}
	const reservation = value as TransactionIdentityReservation;
	const state = reservationStates.get(reservation);
	return state?.authority === authority && state.status === 'active'
		? state
		: undefined;
}

function isArrayIndexKey(key: PropertyKey, length: number): boolean {
	if (typeof key !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(key)) {
		return false;
	}
	const index = Number(key);
	return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function okMutation(): TransactionIdentityMutationResult {
	return Object.freeze({
		type: 'ok',
	});
}

function authorityError(
	reason: TransactionIdentityAuthorityFailure,
	path: string,
	identifier?: string,
): ITransactionIdentityAuthorityError {
	return Object.freeze({
		type: 'error',
		reason,
		path,
		...(identifier === undefined ? {} : { identifier }),
	});
}
