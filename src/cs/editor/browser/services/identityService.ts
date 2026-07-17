/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	type IUuidV7Seed,
	type IUuidV7SeedSource,
} from 'cs/editor/common/core/identifiers';
import {
	IManuscriptIdentityService,
	ManuscriptIdentityError,
	ManuscriptIdentityService,
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
	constructor(
		private readonly environment: IBrowserManuscriptIdentityEnvironment,
	) {}

	nextSeed(): IUuidV7Seed {
		let unixMilliseconds: number;
		try {
			unixMilliseconds = this.environment.now();
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
			this.environment.fillRandomBytes(randomBytes);
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

export class BrowserManuscriptIdentityService extends ManuscriptIdentityService {
	constructor(
		environment: IBrowserManuscriptIdentityEnvironment =
			browserManuscriptIdentityEnvironment,
	) {
		super(new BrowserUuidV7SeedSource(environment));
	}
}

registerSingleton(
	IManuscriptIdentityService,
	BrowserManuscriptIdentityService,
	InstantiationType.Delayed,
);
