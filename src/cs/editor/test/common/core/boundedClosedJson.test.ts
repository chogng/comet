/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

import {
	captureBoundedClosedJson,
	type IBoundedClosedJsonLimits,
} from 'cs/editor/common/core/boundedClosedJson';
import { serializeCanonicalJson } from 'cs/editor/common/core/canonicalJson';

const generousLimits: IBoundedClosedJsonLimits = {
	maximumDepth: 256,
	maximumValues: 10_000,
	maximumArrayLength: 1_000,
	maximumObjectProperties: 1_000,
	maximumCanonicalUtf8Bytes: 1024 * 1024,
};

suite('Bounded closed JSON', () => {
	test('captures detached owned JSON and reports exact canonical metrics', () => {
		const source = {
			text: '雪\n"quoted"',
			items: [true, null, 3],
		};
		const result = captureBoundedClosedJson(source, generousLimits);
		if (result.type === 'invalid') {
			assert.fail(`Expected valid capture: ${result.reason} at ${result.path}.`);
		}
		const canonical = serializeCanonicalJson(result.value);
		assert.equal(canonical.type, 'ok');
		if (canonical.type === 'ok') {
			assert.equal(
				result.metrics.canonicalUtf8Bytes,
				new TextEncoder().encode(canonical.value).byteLength,
			);
		}
		assert.equal(result.metrics.valueCount, 6);
		assert.equal(result.metrics.maximumDepth, 2);
		assert.equal(Object.getPrototypeOf(result.value), null);
		const captured = result.value as Readonly<Record<string, unknown>>;
		assert.notEqual(captured, source);
		assert.notEqual(captured['items'], source.items);
		source.text = 'changed';
		assert.equal(captured['text'], '雪\n"quoted"');
	});

	test('uses an iterative walk for deeply nested values', () => {
		let source: unknown = 'leaf';
		for (let index = 0; index < 20_000; index += 1) {
			source = { value: source };
		}
		const result = captureBoundedClosedJson(source, {
			...generousLimits,
			maximumDepth: 20_000,
			maximumValues: 20_001,
			maximumCanonicalUtf8Bytes: 1024 * 1024,
		});
		assert.equal(result.type, 'valid');
		if (result.type === 'valid') {
			assert.equal(result.metrics.maximumDepth, 20_000);
			assert.equal(result.metrics.valueCount, 20_001);
		}
	});

	test('matches the canonical UTF-8 byte oracle at primitive and record boundaries', () => {
		const nullPrototype = Object.create(null) as Record<string, unknown>;
		nullPrototype['z-last'] = 'astral 😀';
		nullPrototype['a-first'] = 'BMP 雪';
		const values: readonly unknown[] = [
			-0,
			1e+21,
			'\b\t\n\f\r\u0000',
			'"quoted"\\backslash',
			'雪',
			'😀',
			nullPrototype,
			{ z: 1, a: 2 },
		];
		for (const value of values) {
			const result = captureBoundedClosedJson(value, generousLimits);
			if (result.type === 'invalid') {
				assert.fail(`Expected valid capture: ${result.reason} at ${result.path}.`);
			}
			const canonical = serializeCanonicalJson(result.value);
			assert.equal(canonical.type, 'ok');
			if (canonical.type === 'ok') {
				assert.equal(
					result.metrics.canonicalUtf8Bytes,
					new TextEncoder().encode(canonical.value).byteLength,
				);
			}
		}
	});

	test('rejects accessors, Proxies, sparse arrays, cycles, and non-JSON values', () => {
		let getterCalls = 0;
		const accessor = {};
		Object.defineProperty(accessor, 'value', {
			enumerable: true,
			get() {
				getterCalls += 1;
				return true;
			},
		});
		assert.equal(captureBoundedClosedJson(accessor, generousLimits).type, 'invalid');
		assert.equal(getterCalls, 0);

		const proxyResult = captureBoundedClosedJson(new Proxy({}, {
			ownKeys() {
				throw new Error('inspection failure');
			},
		}), generousLimits);
		assert.deepStrictEqual(proxyResult, {
			type: 'invalid',
			reason: 'inspection-failed',
			path: '$',
		});

		const sparse = new Array<unknown>(2);
		sparse[1] = true;
		assert.equal(captureBoundedClosedJson(sparse, generousLimits).type, 'invalid');

		const cyclic: { self?: unknown } = {};
		cyclic.self = cyclic;
		assert.equal(captureBoundedClosedJson(cyclic, generousLimits).type, 'invalid');
		assert.equal(captureBoundedClosedJson('\ud800', generousLimits).type, 'invalid');
		assert.equal(captureBoundedClosedJson(Number.POSITIVE_INFINITY, generousLimits).type, 'invalid');
		assert.equal(captureBoundedClosedJson(new Date(), generousLimits).type, 'invalid');
	});

	test('accepts shared DAG nodes but rejects revoked and changing Proxy inspection', () => {
		const shared = { value: 'shared' };
		const dagResult = captureBoundedClosedJson({
			left: shared,
			right: shared,
		}, generousLimits);
		assert.equal(dagResult.type, 'valid');
		if (dagResult.type === 'valid') {
			const captured = dagResult.value as Readonly<Record<string, unknown>>;
			assert.notEqual(captured['left'], captured['right']);
			assert.deepStrictEqual(captured['left'], captured['right']);
		}

		const revocable = Proxy.revocable({ value: true }, {});
		revocable.revoke();
		assert.equal(
			captureBoundedClosedJson(revocable.proxy, generousLimits).type,
			'invalid',
		);

		let descriptorReads = 0;
		const changing = new Proxy({ value: 'first' }, {
			getOwnPropertyDescriptor(target, property) {
				descriptorReads += 1;
				if (descriptorReads > 1) {
					return {
						configurable: true,
						enumerable: true,
						value: 'changed',
						writable: true,
					};
				}
				return Reflect.getOwnPropertyDescriptor(target, property);
			},
		});
		const changingResult = captureBoundedClosedJson(changing, generousLimits);
		assert.equal(changingResult.type, 'valid');
		if (changingResult.type === 'valid') {
			assert.equal(
				(changingResult.value as Readonly<Record<string, unknown>>)['value'],
				'first',
			);
		}
		assert.equal(descriptorReads, 1);
	});

	test('rejects oversized dense arrays before item or iterator access', () => {
		let valueReads = 0;
		let descriptorReads = 0;
		const dense = new Array<unknown>(4).fill(null);
		const proxied = new Proxy(dense, {
			get(target, property, receiver) {
				valueReads += 1;
				return Reflect.get(target, property, receiver);
			},
			getOwnPropertyDescriptor(target, property) {
				descriptorReads += 1;
				return Reflect.getOwnPropertyDescriptor(target, property);
			},
		});
		const result = captureBoundedClosedJson(proxied, {
			...generousLimits,
			maximumArrayLength: 3,
		});
		assert.deepStrictEqual(result, {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
			limit: 'array-length',
		});
		assert.equal(valueReads, 0);
		assert.equal(descriptorReads, 1);
	});

	test('rejects huge strings from their length before canonical allocation', () => {
		const result = captureBoundedClosedJson('x'.repeat(100), {
			...generousLimits,
			maximumCanonicalUtf8Bytes: 16,
		});
		assert.deepStrictEqual(result, {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
			limit: 'canonical-utf8-bytes',
		});
	});

	test('returns the specific exhausted value, depth, and property budgets', () => {
		assert.deepStrictEqual(captureBoundedClosedJson([true], {
			...generousLimits,
			maximumValues: 1,
		}), {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$[0]',
			limit: 'values',
		});
		assert.deepStrictEqual(captureBoundedClosedJson({ nested: true }, {
			...generousLimits,
			maximumDepth: 0,
		}), {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$.nested',
			limit: 'depth',
		});
		assert.deepStrictEqual(captureBoundedClosedJson({ first: 1, second: 2 }, {
			...generousLimits,
			maximumObjectProperties: 1,
		}), {
			type: 'invalid',
			reason: 'resource-limit-exceeded',
			path: '$',
			limit: 'object-properties',
		});
	});
});
