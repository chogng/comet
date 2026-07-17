/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	UuidV7AllocationError,
	UuidV7IdAllocator,
	type EntityId,
	type IUuidV7SeedSource,
	type NodeId,
	type OperationId,
	type ProposalId,
	type RevisionId,
	type TransactionId,
} from 'cs/editor/common/core/identifiers';
import {
	createDecorator,
	type ServiceIdentifier,
} from 'cs/platform/instantiation/common/instantiation';

export const IManuscriptIdentityService: ServiceIdentifier<IManuscriptIdentityService> =
	createDecorator<IManuscriptIdentityService>('manuscriptIdentityService');

export const manuscriptIdentityErrorCodes = Object.freeze([
	'IDENTITY_CLOCK_UNAVAILABLE',
	'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
	'IDENTITY_SEQUENCE_EXHAUSTED',
] as const);

export type ManuscriptIdentityErrorCode =
	(typeof manuscriptIdentityErrorCodes)[number];

export class ManuscriptIdentityError extends Error {
	constructor(readonly code: ManuscriptIdentityErrorCode) {
		super(code);
		this.name = 'ManuscriptIdentityError';
	}
}

/**
 * Allocates persistent Editor identities from one trusted monotonic sequence.
 */
export interface IManuscriptIdentityService {
	readonly _serviceBrand: undefined;

	allocateRevisionId(): RevisionId;
	allocateTransactionId(): TransactionId;
	allocateOperationId(): OperationId;
	allocateNodeId(): NodeId;
	allocateEntityId(): EntityId;
	allocateProposalId(): ProposalId;
}

/**
 * Keeps ambient clock and entropy access outside Editor common.
 */
class DefaultManuscriptIdentityService implements IManuscriptIdentityService {
	declare readonly _serviceBrand: undefined;

	readonly #allocator: UuidV7IdAllocator;

	constructor(source: IUuidV7SeedSource) {
		this.#allocator = new UuidV7IdAllocator(source);
		Object.freeze(this);
	}

	allocateRevisionId(): RevisionId {
		return this.allocate(() => this.#allocator.allocateRevisionId());
	}

	allocateTransactionId(): TransactionId {
		return this.allocate(() => this.#allocator.allocateTransactionId());
	}

	allocateOperationId(): OperationId {
		return this.allocate(() => this.#allocator.allocateOperationId());
	}

	allocateNodeId(): NodeId {
		return this.allocate(() => this.#allocator.allocateNodeId());
	}

	allocateEntityId(): EntityId {
		return this.allocate(() => this.#allocator.allocateEntityId());
	}

	allocateProposalId(): ProposalId {
		return this.allocate(() => this.#allocator.allocateProposalId());
	}

	private allocate<TIdentifier>(allocate: () => TIdentifier): TIdentifier {
		try {
			return allocate();
		} catch (error) {
			if (error instanceof ManuscriptIdentityError) {
				throw error;
			}
			if (error instanceof UuidV7AllocationError) {
				switch (error.reason) {
					case 'invalid-timestamp':
						throw new ManuscriptIdentityError(
							'IDENTITY_CLOCK_UNAVAILABLE',
						);
					case 'invalid-random-byte-count':
						throw new ManuscriptIdentityError(
							'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
						);
					case 'sequence-exhausted':
						throw new ManuscriptIdentityError(
							'IDENTITY_SEQUENCE_EXHAUSTED',
						);
				}
			}
			throw error;
		}
	}
}

Object.defineProperty(DefaultManuscriptIdentityService.prototype, 'constructor', {
	value: undefined,
	writable: false,
	configurable: false,
});
Object.freeze(DefaultManuscriptIdentityService.prototype);
Object.freeze(DefaultManuscriptIdentityService);

export function createManuscriptIdentityService(
	source: IUuidV7SeedSource,
): IManuscriptIdentityService {
	return new DefaultManuscriptIdentityService(source);
}
