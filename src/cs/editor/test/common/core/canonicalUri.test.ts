/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import { URI } from 'cs/base/common/uri';
import {
	cloneCanonicalRuntimeUri,
	decodeCanonicalUri,
	encodeCanonicalUri,
} from 'cs/editor/common/core/canonicalUri';

suite('Canonical URI', () => {
	test('externalizes Unicode and spaces using the encoded Comet URI form', () => {
		const runtime = URI.from({
			scheme: 'https',
			authority: 'example.test',
			path: '/résumé notes/α',
			query: 'q=雪',
		});
		const encoded = 'https://example.test/r%C3%A9sum%C3%A9%20notes/%CE%B1?q%3D%E9%9B%AA';
		assert.equal(encodeCanonicalUri(runtime), encoded);
		assert.equal(decodeCanonicalUri(encoded)?.toString(), encoded);
		assert.equal(decodeCanonicalUri(runtime.toString(true)), undefined);

		const cloned = cloneCanonicalRuntimeUri(runtime);
		assert.notEqual(cloned, runtime);
		assert.equal(cloned?.toString(), encoded);
	});

	test('rejects URI strings that require canonical normalization', () => {
		assert.equal(
			decodeCanonicalUri('HTTPS://example.test/path')?.scheme,
			'HTTPS',
		);
		assert.equal(decodeCanonicalUri('https://example.test/a b'), undefined);
		assert.equal(decodeCanonicalUri('https://example.test/%c3%a9'), undefined);
		assert.equal(decodeCanonicalUri('relative/path'), undefined);
		assert.equal(decodeCanonicalUri('\ud800'), undefined);
	});

	test('rejects accessors and inspection-failing URI Proxies', () => {
		const runtime = URI.parse('https://example.test/path');
		const proxied = new Proxy(runtime, {
			getOwnPropertyDescriptor(_target, property) {
				if (property === 'path') {
					throw new Error('inspection failure');
				}
				return Reflect.getOwnPropertyDescriptor(runtime, property);
			},
		});
		assert.equal(cloneCanonicalRuntimeUri(proxied), undefined);
		assert.equal(encodeCanonicalUri(proxied), undefined);
	});
});
