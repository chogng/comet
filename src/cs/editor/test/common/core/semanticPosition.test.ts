/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	isUtf16ScalarBoundary,
	parseUtf16Offset,
} from 'cs/editor/common/core/semanticPosition';

suite('Semantic position', () => {
	test('parses nonnegative safe UTF-16 offsets', () => {
		assert.deepStrictEqual(parseUtf16Offset(0), {
			type: 'valid',
			value: 0,
		});
		assert.deepStrictEqual(parseUtf16Offset(Number.MAX_SAFE_INTEGER), {
			type: 'valid',
			value: Number.MAX_SAFE_INTEGER,
		});

		for (const value of [
			-1,
			0.5,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.MAX_SAFE_INTEGER + 1,
		]) {
			assert.deepStrictEqual(parseUtf16Offset(value), {
				type: 'invalid',
				reason: 'not-a-nonnegative-safe-integer',
			});
		}
	});

	test('accepts document edges and scalar boundaries', () => {
		const value = 'A\u{1f600}e\u0301B';

		for (const offset of [0, 1, 3, 4, 5, 6]) {
			assert.equal(
				isUtf16ScalarBoundary(value, offset),
				true,
				`expected UTF-16 offset ${offset} to be a scalar boundary`,
			);
		}
	});

	test('rejects the midpoint of a surrogate pair', () => {
		const value = 'A\u{1f600}B';

		assert.equal(value.length, 4);
		assert.equal(isUtf16ScalarBoundary(value, 1), true);
		assert.equal(isUtf16ScalarBoundary(value, 2), false);
		assert.equal(isUtf16ScalarBoundary(value, 3), true);
	});

	test('rejects offsets outside the represented UTF-16 string', () => {
		const value = 'manuscript';

		for (const offset of [
			-1,
			0.5,
			value.length + 1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
		]) {
			assert.equal(isUtf16ScalarBoundary(value, offset), false);
		}
	});
});
