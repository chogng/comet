/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type CanonicalJsonPrimitive = boolean | null | number | string;
export type CanonicalJsonValue =
	| CanonicalJsonPrimitive
	| readonly CanonicalJsonValue[]
	| {
		readonly [key: string]: CanonicalJsonValue;
	};

export type CanonicalJsonFailure =
	| 'unsupported-value'
	| 'non-finite-number'
	| 'cyclic-value'
	| 'sparse-array'
	| 'invalid-object-prototype'
	| 'invalid-property-descriptor'
	| 'maximum-depth-exceeded'
	| 'inspection-failed'
	| 'invalid-unicode-string';

export interface ICanonicalJsonError {
	readonly reason: CanonicalJsonFailure;
	readonly path: string;
}

export type CanonicalJsonResult =
	| {
		readonly type: 'ok';
		readonly value: string;
	}
	| {
		readonly type: 'error';
		readonly error: ICanonicalJsonError;
	};

export const maximumCanonicalJsonDepth = 1_024;

export function serializeCanonicalJson(value: unknown): CanonicalJsonResult {
	try {
		return serializeCanonicalValue(value, '$', new Set<object>(), 0);
	} catch {
		return canonicalJsonError('inspection-failed', '$');
	}
}

export function isWellFormedUnicodeString(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const current = value.charCodeAt(index);
		if (current >= 0xd800 && current <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
				return false;
			}
			index += 1;
		} else if (current >= 0xdc00 && current <= 0xdfff) {
			return false;
		}
	}
	return true;
}

function serializeCanonicalValue(
	value: unknown,
	path: string,
	activeObjects: Set<object>,
	depth: number,
): CanonicalJsonResult {
	if (value === null) {
		return {
			type: 'ok',
			value: 'null',
		};
	}

	if (typeof value === 'string') {
		return isWellFormedUnicodeString(value)
			? {
				type: 'ok',
				value: JSON.stringify(value),
			}
			: canonicalJsonError('invalid-unicode-string', path);
	}

	if (typeof value === 'boolean') {
		return {
			type: 'ok',
			value: JSON.stringify(value),
		};
	}

	if (typeof value === 'number') {
		return Number.isFinite(value)
			? {
				type: 'ok',
				value: JSON.stringify(value),
			}
			: canonicalJsonError('non-finite-number', path);
	}

	if (typeof value !== 'object') {
		return canonicalJsonError('unsupported-value', path);
	}

	if (depth > maximumCanonicalJsonDepth) {
		return canonicalJsonError('maximum-depth-exceeded', path);
	}

	if (activeObjects.has(value)) {
		return canonicalJsonError('cyclic-value', path);
	}

	activeObjects.add(value);
	const result = Array.isArray(value)
		? serializeCanonicalArray(value, path, activeObjects, depth)
		: serializeCanonicalObject(value, path, activeObjects, depth);
	activeObjects.delete(value);
	return result;
}

function serializeCanonicalArray(
	value: readonly unknown[],
	path: string,
	activeObjects: Set<object>,
	depth: number,
): CanonicalJsonResult {
	if (Reflect.getPrototypeOf(value) !== Array.prototype) {
		return canonicalJsonError('invalid-object-prototype', path);
	}

	const descriptors: PropertyDescriptor[] = [];
	const allowedKeys = new Set<string>(['length']);
	for (let index = 0; index < value.length; index += 1) {
		const key = String(index);
		allowedKeys.add(key);
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined) {
			return canonicalJsonError('sparse-array', `${path}[${index}]`);
		}
		if (!descriptor.enumerable || !('value' in descriptor)) {
			return canonicalJsonError('invalid-property-descriptor', `${path}[${index}]`);
		}
		descriptors.push(descriptor);
	}

	if (Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowedKeys.has(key))) {
		return canonicalJsonError('invalid-property-descriptor', path);
	}

	const serializedItems: string[] = [];
	for (let index = 0; index < descriptors.length; index += 1) {
		const item = serializeCanonicalValue(
			descriptors[index]?.value,
			`${path}[${index}]`,
			activeObjects,
			depth + 1,
		);
		if (item.type === 'error') {
			return item;
		}
		serializedItems.push(item.value);
	}

	return {
		type: 'ok',
		value: `[${serializedItems.join(',')}]`,
	};
}

function serializeCanonicalObject(
	value: object,
	path: string,
	activeObjects: Set<object>,
	depth: number,
): CanonicalJsonResult {
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return canonicalJsonError('invalid-object-prototype', path);
	}

	const stringKeys: string[] = [];
	for (const key of Reflect.ownKeys(value)) {
		if (typeof key !== 'string') {
			return canonicalJsonError('invalid-property-descriptor', path);
		}
		if (!isWellFormedUnicodeString(key)) {
			return canonicalJsonError('invalid-unicode-string', path);
		}
		stringKeys.push(key);
	}

	const descriptors = new Map<string, PropertyDescriptor>();
	for (const key of stringKeys) {
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor)) {
			return canonicalJsonError('invalid-property-descriptor', `${path}.${key}`);
		}
		descriptors.set(key, descriptor);
	}

	const serializedEntries: string[] = [];
	for (const key of stringKeys.sort(compareUnicodeCodePoints)) {
		const property = serializeCanonicalValue(
			descriptors.get(key)?.value,
			`${path}.${key}`,
			activeObjects,
			depth + 1,
		);
		if (property.type === 'error') {
			return property;
		}
		serializedEntries.push(`${JSON.stringify(key)}:${property.value}`);
	}

	return {
		type: 'ok',
		value: `{${serializedEntries.join(',')}}`,
	};
}

function compareUnicodeCodePoints(left: string, right: string): number {
	const leftCodePoints = Array.from(left, value => value.codePointAt(0) ?? 0);
	const rightCodePoints = Array.from(right, value => value.codePointAt(0) ?? 0);
	const length = Math.min(leftCodePoints.length, rightCodePoints.length);

	for (let index = 0; index < length; index += 1) {
		const difference = (leftCodePoints[index] ?? 0) - (rightCodePoints[index] ?? 0);
		if (difference !== 0) {
			return difference;
		}
	}

	return leftCodePoints.length - rightCodePoints.length;
}

function canonicalJsonError(reason: CanonicalJsonFailure, path: string): CanonicalJsonResult {
	return {
		type: 'error',
		error: {
			reason,
			path,
		},
	};
}
