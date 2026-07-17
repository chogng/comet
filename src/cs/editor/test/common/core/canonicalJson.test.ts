/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	isWellFormedUnicodeString,
	maximumCanonicalJsonDepth,
	serializeCanonicalJson,
} from 'cs/editor/common/core/canonicalJson';

suite('Canonical JSON', () => {
	test('serializes primitives, nested values, and keys in Unicode code-point order', () => {
		const value = {
			'\u{10000}': 'astral',
			'\ue000': 'bmp',
			z: -0,
			a: {
				quote: '"',
				line: '\n',
				values: [true, false, null, 1.25],
			},
		};

		assert.deepStrictEqual(serializeCanonicalJson(value), {
			type: 'ok',
			value: '{"a":{"line":"\\n","quote":"\\"","values":[true,false,null,1.25]},"z":0,"":"bmp","𐀀":"astral"}',
		});
	});

	test('accepts null-prototype objects, frozen dense arrays, and repeated acyclic references', () => {
		const nullPrototype = Object.create(null) as Record<string, number>;
		nullPrototype.z = 2;
		nullPrototype.a = 1;
		const shared = Object.freeze({ value: 'shared' });

		assert.deepStrictEqual(
			serializeCanonicalJson({
				array: Object.freeze([nullPrototype, 3]),
				left: shared,
				right: shared,
			}),
			{
				type: 'ok',
				value: '{"array":[{"a":1,"z":2},3],"left":{"value":"shared"},"right":{"value":"shared"}}',
			},
		);
	});

	test('reports unsupported values, non-finite numbers, and malformed Unicode at exact paths', () => {
		assert.deepStrictEqual(serializeCanonicalJson(undefined), {
			type: 'error',
			error: {
				reason: 'unsupported-value',
				path: '$',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson({ value: Number.NaN }), {
			type: 'error',
			error: {
				reason: 'non-finite-number',
				path: '$.value',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson([0, Number.POSITIVE_INFINITY]), {
			type: 'error',
			error: {
				reason: 'non-finite-number',
				path: '$[1]',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson({ value: '\ud800' }), {
			type: 'error',
			error: {
				reason: 'invalid-unicode-string',
				path: '$.value',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson({ ['\udc00']: 'value' }), {
			type: 'error',
			error: {
				reason: 'invalid-unicode-string',
				path: '$',
			},
		});
		assert.equal(isWellFormedUnicodeString('A值😀\u0301'), true);
		assert.equal(isWellFormedUnicodeString('\ud800'), false);
		assert.equal(isWellFormedUnicodeString('\udc00'), false);
		assert.equal(isWellFormedUnicodeString('😀'.slice(0, 1)), false);
	});

	test('rejects non-JSON array shapes and object prototypes', () => {
		const sparse = new Array<number>(2);
		sparse[0] = 1;
		const arrayWithProperty = [1] as number[] & { extra?: number };
		arrayWithProperty.extra = 2;
		const customPrototype = Object.create({ inherited: true }) as Record<string, number>;
		customPrototype.value = 1;

		assert.deepStrictEqual(serializeCanonicalJson(sparse), {
			type: 'error',
			error: {
				reason: 'sparse-array',
				path: '$[1]',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson(arrayWithProperty), {
			type: 'error',
			error: {
				reason: 'invalid-property-descriptor',
				path: '$',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson(customPrototype), {
			type: 'error',
			error: {
				reason: 'invalid-object-prototype',
				path: '$',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson(new Date(0)), {
			type: 'error',
			error: {
				reason: 'invalid-object-prototype',
				path: '$',
			},
		});
	});

	test('rejects accessors, hidden properties, and symbols without invoking accessors', () => {
		let getterCalls = 0;
		const accessor = {};
		Object.defineProperty(accessor, 'danger', {
			enumerable: true,
			get: () => {
				getterCalls += 1;
				return 'value';
			},
		});
		const hidden = {};
		Object.defineProperty(hidden, 'value', {
			enumerable: false,
			value: 1,
		});
		const symbolProperty = {
			value: 1,
			[Symbol('hidden')]: 2,
		};

		assert.deepStrictEqual(serializeCanonicalJson(accessor), {
			type: 'error',
			error: {
				reason: 'invalid-property-descriptor',
				path: '$.danger',
			},
		});
		assert.equal(getterCalls, 0);
		assert.deepStrictEqual(serializeCanonicalJson(hidden), {
			type: 'error',
			error: {
				reason: 'invalid-property-descriptor',
				path: '$.value',
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson(symbolProperty), {
			type: 'error',
			error: {
				reason: 'invalid-property-descriptor',
				path: '$',
			},
		});
	});

	test('rejects cycles, excessive depth, and failed reflection deterministically', () => {
		interface IMutableNestedValue {
			next?: IMutableNestedValue;
		}

		const cyclic: IMutableNestedValue = {};
		cyclic.next = cyclic;
		assert.deepStrictEqual(serializeCanonicalJson(cyclic), {
			type: 'error',
			error: {
				reason: 'cyclic-value',
				path: '$.next',
			},
		});

		const root: IMutableNestedValue = {};
		let cursor = root;
		for (let depth = 0; depth < maximumCanonicalJsonDepth + 2; depth += 1) {
			const next: IMutableNestedValue = {};
			cursor.next = next;
			cursor = next;
		}
		const deepResult = serializeCanonicalJson(root);
		assert.equal(deepResult.type, 'error');
		if (deepResult.type === 'error') {
			assert.equal(deepResult.error.reason, 'maximum-depth-exceeded');
		}

		const inaccessible = new Proxy({}, {
			ownKeys: () => {
				throw new Error('reflection denied');
			},
		});
		assert.deepStrictEqual(serializeCanonicalJson(inaccessible), {
			type: 'error',
			error: {
				reason: 'inspection-failed',
				path: '$',
			},
		});
	});
});
