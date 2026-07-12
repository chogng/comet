/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	isSerializedJsonLargerThan,
	isUtf8StringLargerThan,
} from 'cs/sessions/services/sessions/common/serializedSize';

test('serialized JSON size matches JSON.stringify for Sessions payload values', () => {
	const value = {
		resource: URI.parse('test-chat:/session/main?query=值'),
		text: 'line\nquote"slash\\emoji😀lone\ud800',
		values: [undefined, null, true, false, -0, Number.NaN, 1.25],
		nested: { omitted: undefined, included: 'content' },
	};
	const serialized = JSON.stringify(value);
	const byteLength = new TextEncoder().encode(serialized).byteLength;

	assert.equal(isSerializedJsonLargerThan(value, byteLength), false);
	assert.equal(isSerializedJsonLargerThan(value, byteLength - 1), true);
});

test('serialized size rejects circular and oversized values before serialization', () => {
	const circular: { self?: unknown } = {};
	circular.self = circular;
	assert.throws(() => isSerializedJsonLargerThan(circular, 1024), /circular/);
	assert.equal(isSerializedJsonLargerThan({ content: 'x'.repeat(1025) }, 1024), true);
});

test('UTF-8 size handles multibyte and lone-surrogate strings at the exact boundary', () => {
	const value = 'ASCII值😀\ud800';
	const byteLength = new TextEncoder().encode(value).byteLength;
	assert.equal(isUtf8StringLargerThan(value, byteLength), false);
	assert.equal(isUtf8StringLargerThan(value, byteLength - 1), true);
});
