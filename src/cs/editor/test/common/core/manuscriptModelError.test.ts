/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	ManuscriptModelError,
	manuscriptModelErrorCodes,
} from 'cs/editor/common/core/manuscriptModelError';

suite('Manuscript model error', () => {
	test('surfaces every stable error code without translating it into prose', () => {
		assert.equal(Object.isFrozen(manuscriptModelErrorCodes), true);
		assert.deepStrictEqual(manuscriptModelErrorCodes, [
			'MANUSCRIPT_MODEL_ALREADY_EXISTS',
			'MANUSCRIPT_MODEL_NOT_FOUND',
			'MANUSCRIPT_RESOURCE_UNSUPPORTED',
			'MANUSCRIPT_REVISION_NOT_FOUND',
			'MANUSCRIPT_BASE_REVISION_MISMATCH',
			'MANUSCRIPT_TRANSACTION_INVALID',
			'MANUSCRIPT_SCHEMA_INVALID',
			'MANUSCRIPT_HASH_MISMATCH',
			'MANUSCRIPT_AUTHORITY_LOST',
			'MANUSCRIPT_DURABILITY_FAILED',
			'MANUSCRIPT_RECOVERY_REQUIRED',
			'MANUSCRIPT_WRITE_SUSPENDED',
			'MANUSCRIPT_PROPOSAL_REVISION_MISMATCH',
			'MANUSCRIPT_PROPOSAL_LOCKED',
		]);

		for (const code of manuscriptModelErrorCodes) {
			const error = new ManuscriptModelError(code);

			assert.ok(error instanceof Error);
			assert.equal(error.name, 'ManuscriptModelError');
			assert.equal(error.code, code);
			assert.equal(error.message, code);
			assert.deepStrictEqual(error.data, {});
			assert.equal(Object.isFrozen(error.data), true);
		}
	});

	test('preserves structured diagnostic data independently of the stable code', () => {
		const data = {
			resource: 'comet-draft:01234567-89ab-7001-8203-040506070809',
			expectedRevision: '01234567-89ab-7001-8203-040506070809',
			actualRevision: '01234567-89ab-7001-8203-04050607080a',
		};
		const error = new ManuscriptModelError(
			'MANUSCRIPT_BASE_REVISION_MISMATCH',
			data,
		);
		data.actualRevision = 'changed-after-construction';

		assert.equal(error.code, 'MANUSCRIPT_BASE_REVISION_MISMATCH');
		assert.equal(error.message, 'MANUSCRIPT_BASE_REVISION_MISMATCH');
		assert.deepStrictEqual(error.data, {
			resource: 'comet-draft:01234567-89ab-7001-8203-040506070809',
			expectedRevision: '01234567-89ab-7001-8203-040506070809',
			actualRevision: '01234567-89ab-7001-8203-04050607080a',
		});
		assert.notStrictEqual(error.data, data);
		assert.equal(Object.isFrozen(error.data), true);
	});
});
