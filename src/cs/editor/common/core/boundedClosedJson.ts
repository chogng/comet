/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CanonicalJsonValue } from 'cs/editor/common/core/canonicalJson';

export interface IBoundedClosedJsonLimits {
	readonly maximumDepth: number;
	readonly maximumValues: number;
	readonly maximumArrayLength: number;
	readonly maximumObjectProperties: number;
	readonly maximumCanonicalUtf8Bytes: number;
}

export interface IBoundedClosedJsonMetrics {
	readonly valueCount: number;
	readonly maximumDepth: number;
	readonly canonicalUtf8Bytes: number;
}

export type BoundedClosedJsonLimit =
	| 'depth'
	| 'values'
	| 'array-length'
	| 'object-properties'
	| 'canonical-utf8-bytes';

export type BoundedClosedJsonCaptureResult =
	| {
		readonly type: 'valid';
		readonly value: CanonicalJsonValue;
		readonly metrics: IBoundedClosedJsonMetrics;
	}
	| {
		readonly type: 'invalid';
		readonly reason: 'inspection-failed';
		readonly path: string;
	}
	| {
		readonly type: 'invalid';
		readonly reason: 'resource-limit-exceeded';
		readonly path: string;
		readonly limit: BoundedClosedJsonLimit;
	};

interface IRootHolder {
	value?: CanonicalJsonValue;
}

type OwnedJsonContainer =
	| IRootHolder
	| CanonicalJsonValue[]
	| Record<string, CanonicalJsonValue>;

interface IVisitFrame {
	readonly type: 'visit';
	readonly source: unknown;
	readonly depth: number;
	readonly path: string;
	readonly parent: OwnedJsonContainer;
	readonly key: string | number;
}

interface IExitFrame {
	readonly type: 'exit';
	readonly source: object;
}

type CaptureFrame = IVisitFrame | IExitFrame;

export function captureBoundedClosedJson(
	value: unknown,
	limits: IBoundedClosedJsonLimits,
): BoundedClosedJsonCaptureResult {
	assertValidLimits(limits);

	const root: IRootHolder = {};
	const activeObjects = new Set<object>();
	const stack: CaptureFrame[] = [{
		type: 'visit',
		source: value,
		depth: 0,
		path: '$',
		parent: root,
		key: 'value',
	}];
	let valueCount = 0;
	let maximumDepth = 0;
	let canonicalUtf8Bytes = 0;
	let currentPath = '$';

	const consumeBytes = (
		bytes: number,
		path: string,
	): BoundedClosedJsonCaptureResult | undefined => {
		if (canonicalUtf8Bytes + bytes > limits.maximumCanonicalUtf8Bytes) {
			return resourceLimit('canonical-utf8-bytes', path);
		}
		canonicalUtf8Bytes += bytes;
		return undefined;
	};

	try {
		while (stack.length > 0) {
			const frame = stack.pop()!;
			if (frame.type === 'exit') {
				activeObjects.delete(frame.source);
				continue;
			}
			currentPath = frame.path;
			if (frame.depth > limits.maximumDepth) {
				return resourceLimit('depth', frame.path);
			}
			valueCount += 1;
			if (valueCount > limits.maximumValues) {
				return resourceLimit('values', frame.path);
			}
			maximumDepth = Math.max(maximumDepth, frame.depth);

			const source = frame.source;
			if (source === null) {
				const limit = consumeBytes(4, frame.path);
				if (limit !== undefined) {
					return limit;
				}
				assignCapturedValue(frame.parent, frame.key, null);
				continue;
			}
			if (typeof source === 'boolean') {
				const limit = consumeBytes(source ? 4 : 5, frame.path);
				if (limit !== undefined) {
					return limit;
				}
				assignCapturedValue(frame.parent, frame.key, source);
				continue;
			}
			if (typeof source === 'number') {
				if (!Number.isFinite(source)) {
					return inspectionFailure(frame.path);
				}
				const serialized = JSON.stringify(source);
				const limit = consumeBytes(serialized.length, frame.path);
				if (limit !== undefined) {
					return limit;
				}
				assignCapturedValue(frame.parent, frame.key, source);
				continue;
			}
			if (typeof source === 'string') {
				if (
					source.length + 2
					> limits.maximumCanonicalUtf8Bytes - canonicalUtf8Bytes
				) {
					return resourceLimit('canonical-utf8-bytes', frame.path);
				}
				const bytes = canonicalJsonStringUtf8Length(source);
				if (bytes === undefined) {
					return inspectionFailure(frame.path);
				}
				const limit = consumeBytes(bytes, frame.path);
				if (limit !== undefined) {
					return limit;
				}
				assignCapturedValue(frame.parent, frame.key, source);
				continue;
			}
			if (typeof source !== 'object' || activeObjects.has(source)) {
				return inspectionFailure(frame.path);
			}

			const prototype = Reflect.getPrototypeOf(source);
			if (Array.isArray(source)) {
				if (prototype !== Array.prototype) {
					return inspectionFailure(frame.path);
				}
				const arrayResult = inspectArray(source, frame.path, limits);
				if (arrayResult.type === 'invalid') {
					return arrayResult;
				}
				const structuralBytes = 2 + Math.max(0, arrayResult.items.length - 1);
				const limit = consumeBytes(structuralBytes, frame.path);
				if (limit !== undefined) {
					return limit;
				}
				const target: CanonicalJsonValue[] = [];
				assignCapturedValue(frame.parent, frame.key, target);
				activeObjects.add(source);
				stack.push({
					type: 'exit',
					source,
				});
				for (let index = arrayResult.items.length - 1; index >= 0; index -= 1) {
					stack.push({
						type: 'visit',
						source: arrayResult.items[index],
						depth: frame.depth + 1,
						path: `${frame.path}[${index}]`,
						parent: target,
						key: index,
					});
				}
				continue;
			}
			if (prototype !== Object.prototype && prototype !== null) {
				return inspectionFailure(frame.path);
			}
			const recordResult = inspectRecord(source, frame.path, limits);
			if (recordResult.type === 'invalid') {
				return recordResult;
			}
			const structuralBytes = 2 + Math.max(0, recordResult.properties.length - 1);
			const structuralLimit = consumeBytes(structuralBytes, frame.path);
			if (structuralLimit !== undefined) {
				return structuralLimit;
			}
			for (const property of recordResult.properties) {
				if (
					property.key.length + 3
					> limits.maximumCanonicalUtf8Bytes - canonicalUtf8Bytes
				) {
					return resourceLimit(
						'canonical-utf8-bytes',
						propertyPath(frame.path, property.key),
					);
				}
				const keyBytes = canonicalJsonStringUtf8Length(property.key);
				if (keyBytes === undefined) {
					return inspectionFailure(propertyPath(frame.path, property.key));
				}
				const keyLimit = consumeBytes(
					keyBytes + 1,
					propertyPath(frame.path, property.key),
				);
				if (keyLimit !== undefined) {
					return keyLimit;
				}
			}
			const target: Record<string, CanonicalJsonValue> = Object.create(null);
			assignCapturedValue(frame.parent, frame.key, target);
			activeObjects.add(source);
			stack.push({
				type: 'exit',
				source,
			});
			for (let index = recordResult.properties.length - 1; index >= 0; index -= 1) {
				const property = recordResult.properties[index]!;
				stack.push({
					type: 'visit',
					source: property.value,
					depth: frame.depth + 1,
					path: propertyPath(frame.path, property.key),
					parent: target,
					key: property.key,
				});
			}
		}
	} catch {
		return inspectionFailure(currentPath);
	}

	if (!Object.hasOwn(root, 'value')) {
		return inspectionFailure('$');
	}
	return {
		type: 'valid',
		value: root.value!,
		metrics: Object.freeze({
			valueCount,
			maximumDepth,
			canonicalUtf8Bytes,
		}),
	};
}

function inspectArray(
	value: readonly unknown[],
	path: string,
	limits: IBoundedClosedJsonLimits,
):
	| {
		readonly type: 'valid';
		readonly items: readonly unknown[];
	}
	| Exclude<BoundedClosedJsonCaptureResult, { readonly type: 'valid' }> {
	const lengthDescriptor = Reflect.getOwnPropertyDescriptor(value, 'length');
	if (
		lengthDescriptor === undefined
		|| !('value' in lengthDescriptor)
		|| typeof lengthDescriptor.value !== 'number'
		|| !Number.isSafeInteger(lengthDescriptor.value)
		|| lengthDescriptor.value < 0
	) {
		return inspectionFailure(path);
	}
	const length = lengthDescriptor.value;
	if (length > limits.maximumArrayLength) {
		return resourceLimit('array-length', path);
	}
	const keys = Reflect.ownKeys(value);
	if (keys.length !== length + 1 || !keys.includes('length')) {
		return inspectionFailure(path);
	}
	const keySet = new Set<PropertyKey>(keys);
	const items: unknown[] = [];
	for (let index = 0; index < length; index += 1) {
		const key = String(index);
		if (!keySet.has(key)) {
			return inspectionFailure(`${path}[${index}]`);
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			return inspectionFailure(`${path}[${index}]`);
		}
		items.push(descriptor.value);
	}
	if (keys.some(key => key !== 'length' && (
		typeof key !== 'string'
		|| !isCanonicalArrayIndex(key, length)
	))) {
		return inspectionFailure(path);
	}
	return {
		type: 'valid',
		items,
	};
}

function inspectRecord(
	value: object,
	path: string,
	limits: IBoundedClosedJsonLimits,
):
	| {
		readonly type: 'valid';
		readonly properties: readonly {
			readonly key: string;
			readonly value: unknown;
		}[];
	}
	| Exclude<BoundedClosedJsonCaptureResult, { readonly type: 'valid' }> {
	const keys = Reflect.ownKeys(value);
	if (keys.length > limits.maximumObjectProperties) {
		return resourceLimit('object-properties', path);
	}
	const properties: { key: string; value: unknown }[] = [];
	for (const key of keys) {
		if (typeof key !== 'string') {
			return inspectionFailure(path);
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			return inspectionFailure(propertyPath(path, key));
		}
		properties.push({
			key,
			value: descriptor.value,
		});
	}
	return {
		type: 'valid',
		properties,
	};
}

function assignCapturedValue(
	parent: OwnedJsonContainer,
	key: string | number,
	value: CanonicalJsonValue,
): void {
	if (Array.isArray(parent)) {
		parent[key as number] = value;
	} else {
		(parent as Record<string, CanonicalJsonValue>)[key as string] = value;
	}
}

function canonicalJsonStringUtf8Length(value: string): number | undefined {
	let bytes = 2;
	for (let index = 0; index < value.length; index += 1) {
		const unit = value.charCodeAt(index);
		if (unit === 0x22 || unit === 0x5c) {
			bytes += 2;
		} else if (
			unit === 0x08
			|| unit === 0x09
			|| unit === 0x0a
			|| unit === 0x0c
			|| unit === 0x0d
		) {
			bytes += 2;
		} else if (unit < 0x20) {
			bytes += 6;
		} else if (unit < 0x80) {
			bytes += 1;
		} else if (unit < 0x800) {
			bytes += 2;
		} else if (unit >= 0xd800 && unit <= 0xdbff) {
			const next = value.charCodeAt(index + 1);
			if (index + 1 >= value.length || next < 0xdc00 || next > 0xdfff) {
				return undefined;
			}
			bytes += 4;
			index += 1;
		} else if (unit >= 0xdc00 && unit <= 0xdfff) {
			return undefined;
		} else {
			bytes += 3;
		}
	}
	return bytes;
}

function isCanonicalArrayIndex(value: string, length: number): boolean {
	if (!/^(?:0|[1-9]\d*)$/u.test(value)) {
		return false;
	}
	const index = Number(value);
	return Number.isSafeInteger(index) && index >= 0 && index < length;
}

function propertyPath(parent: string, key: string): string {
	return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(key)
		? `${parent}.${key}`
		: `${parent}[${JSON.stringify(key.slice(0, 128))}]`;
}

function inspectionFailure(
	path: string,
): Extract<
	BoundedClosedJsonCaptureResult,
	{ readonly reason: 'inspection-failed' }
> {
	return {
		type: 'invalid',
		reason: 'inspection-failed',
		path,
	};
}

function resourceLimit(
	limit: BoundedClosedJsonLimit,
	path: string,
): Extract<
	BoundedClosedJsonCaptureResult,
	{ readonly reason: 'resource-limit-exceeded' }
> {
	return {
		type: 'invalid',
		reason: 'resource-limit-exceeded',
		path,
		limit,
	};
}

function assertValidLimits(limits: IBoundedClosedJsonLimits): void {
	for (const value of [
		limits.maximumDepth,
		limits.maximumValues,
		limits.maximumArrayLength,
		limits.maximumObjectProperties,
		limits.maximumCanonicalUtf8Bytes,
	]) {
		if (!Number.isSafeInteger(value) || value < 0) {
			throw new TypeError('Bounded closed JSON limits must be nonnegative safe integers.');
		}
	}
}
