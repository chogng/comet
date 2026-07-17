/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { isCanonicalUtcTimestamp } from 'cs/editor/common/core/canonicalTimestamp';

suite('Canonical UTC timestamp', () => {
	test('accepts only an exact UTC timestamp with millisecond precision', () => {
		assert.equal(isCanonicalUtcTimestamp('2026-07-16T12:34:56.000Z'), true);
		assert.equal(isCanonicalUtcTimestamp('2026-07-16T12:34:56.987Z'), true);
		assert.equal(isCanonicalUtcTimestamp('2026-07-16T12:34:56Z'), false);
		assert.equal(isCanonicalUtcTimestamp('2026-07-16T12:34:56.000+00:00'), false);
	});

	test('rejects invalid dates and values that require normalization', () => {
		assert.equal(isCanonicalUtcTimestamp('2026-02-30T12:00:00.000Z'), false);
		assert.equal(isCanonicalUtcTimestamp('2026-07-16T24:00:00.000Z'), false);
		assert.equal(isCanonicalUtcTimestamp('2026-7-16T12:00:00.000Z'), false);
		assert.equal(isCanonicalUtcTimestamp('not-a-timestamp'), false);
		assert.equal(isCanonicalUtcTimestamp(0), false);
	});
});
