/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	type IUuidV7Seed,
	type IUuidV7SeedSource,
} from 'cs/editor/common/core/identifiers';
import {
	createManuscriptIdentityService,
	IManuscriptIdentityService,
	ManuscriptIdentityError,
	type IManuscriptIdentityService as ManuscriptIdentityService,
} from 'cs/editor/common/services/identityService';
import {
	InstantiationType,
	registerSingleton,
} from 'cs/platform/instantiation/common/extensions';

export interface IBrowserManuscriptIdentityEnvironment {
	now(): number;
	fillRandomBytes(target: Uint8Array): void;
}

const browserManuscriptIdentityEnvironment: IBrowserManuscriptIdentityEnvironment =
	Object.freeze({
		now: () => Date.now(),
		fillRandomBytes: (target: Uint8Array) => {
			const browserCrypto = globalThis.crypto;
			if (
				browserCrypto === undefined
				|| typeof browserCrypto.getRandomValues !== 'function'
			) {
				throw new ManuscriptIdentityError(
					'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
				);
			}
			try {
				browserCrypto.getRandomValues(target);
			} catch {
				throw new ManuscriptIdentityError(
					'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
				);
			}
		},
	});

class BrowserUuidV7SeedSource implements IUuidV7SeedSource {
	readonly #now: () => number;
	readonly #fillRandomBytes: (target: Uint8Array) => void;

	constructor(
		environment: IBrowserManuscriptIdentityEnvironment,
	) {
		const now = environment.now;
		const fillRandomBytes = environment.fillRandomBytes;
		if (typeof now !== 'function') {
			throw new ManuscriptIdentityError('IDENTITY_CLOCK_UNAVAILABLE');
		}
		if (typeof fillRandomBytes !== 'function') {
			throw new ManuscriptIdentityError(
				'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
			);
		}
		this.#now = () => Reflect.apply(now, environment, []);
		this.#fillRandomBytes = target => {
			Reflect.apply(fillRandomBytes, environment, [target]);
		};
		Object.freeze(this);
	}

	nextSeed(): IUuidV7Seed {
		let unixMilliseconds: number;
		try {
			unixMilliseconds = this.#now();
		} catch {
			throw new ManuscriptIdentityError('IDENTITY_CLOCK_UNAVAILABLE');
		}
		if (
			!Number.isSafeInteger(unixMilliseconds)
			|| unixMilliseconds < 0
			|| unixMilliseconds > 0xffff_ffff_ffff
		) {
			throw new ManuscriptIdentityError('IDENTITY_CLOCK_UNAVAILABLE');
		}

		const randomBytes = new Uint8Array(10);
		try {
			this.#fillRandomBytes(randomBytes);
		} catch (error) {
			if (error instanceof ManuscriptIdentityError) {
				throw error;
			}
			throw new ManuscriptIdentityError(
				'IDENTITY_CRYPTOGRAPHIC_RANDOM_UNAVAILABLE',
			);
		}
		return Object.freeze({
			unixMilliseconds,
			randomBytes,
		});
	}
}

Object.freeze(BrowserUuidV7SeedSource.prototype);
Object.freeze(BrowserUuidV7SeedSource);

class BrowserManuscriptIdentityService implements ManuscriptIdentityService {
	declare readonly _serviceBrand: undefined;

	readonly #delegate: ManuscriptIdentityService;

	constructor(
		environment: IBrowserManuscriptIdentityEnvironment =
			browserManuscriptIdentityEnvironment,
	) {
		this.#delegate = createManuscriptIdentityService(
			new BrowserUuidV7SeedSource(environment),
		);
		Object.freeze(this);
	}

	allocateRevisionId() {
		return this.#delegate.allocateRevisionId();
	}

	allocateTransactionId() {
		return this.#delegate.allocateTransactionId();
	}

	allocateOperationId() {
		return this.#delegate.allocateOperationId();
	}

	allocateNodeId() {
		return this.#delegate.allocateNodeId();
	}

	allocateEntityId() {
		return this.#delegate.allocateEntityId();
	}

	allocateProposalId() {
		return this.#delegate.allocateProposalId();
	}
}

Object.defineProperty(BrowserManuscriptIdentityService.prototype, 'constructor', {
	value: undefined,
	writable: false,
	configurable: false,
});
Object.freeze(BrowserManuscriptIdentityService.prototype);
Object.freeze(BrowserManuscriptIdentityService);

export function createBrowserManuscriptIdentityService(
	environment: IBrowserManuscriptIdentityEnvironment =
		browserManuscriptIdentityEnvironment,
): IManuscriptIdentityService {
	return new BrowserManuscriptIdentityService(environment);
}

registerSingleton(
	IManuscriptIdentityService,
	BrowserManuscriptIdentityService,
	InstantiationType.Delayed,
);
