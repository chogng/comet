/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const enum SerializationResult {
	Omitted,
	Written,
	Exceeded,
}

interface ISerializationBudget {
	remainingBytes: number;
	readonly ancestors: Set<object>;
}

function consume(budget: ISerializationBudget, byteCount: number): boolean {
	if (byteCount > budget.remainingBytes) {
		budget.remainingBytes = -1;
		return false;
	}
	budget.remainingBytes -= byteCount;
	return true;
}

function consumeUtf8String(
	value: string,
	budget: ISerializationBudget,
	escapeJson: boolean,
): boolean {
	if (value.length > budget.remainingBytes) {
		budget.remainingBytes = -1;
		return false;
	}
	for (let index = 0; index < value.length; index += 1) {
		const codeUnit = value.charCodeAt(index);
		if (escapeJson && (codeUnit === 0x22 || codeUnit === 0x5c)) {
			if (!consume(budget, 2)) {
				return false;
			}
			continue;
		}
		if (escapeJson && (
			codeUnit === 0x08
			|| codeUnit === 0x09
			|| codeUnit === 0x0a
			|| codeUnit === 0x0c
			|| codeUnit === 0x0d
		)) {
			if (!consume(budget, 2)) {
				return false;
			}
			continue;
		}
		if (escapeJson && codeUnit <= 0x1f) {
			if (!consume(budget, 6)) {
				return false;
			}
			continue;
		}
		if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
			const nextCodeUnit = value.charCodeAt(index + 1);
			if (nextCodeUnit >= 0xdc00 && nextCodeUnit <= 0xdfff) {
				if (!consume(budget, 4)) {
					return false;
				}
				index += 1;
				continue;
			}
			if (!consume(budget, escapeJson ? 6 : 3)) {
				return false;
			}
			continue;
		}
		if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
			if (!consume(budget, escapeJson ? 6 : 3)) {
				return false;
			}
			continue;
		}
		const byteCount = codeUnit <= 0x7f ? 1 : codeUnit <= 0x7ff ? 2 : 3;
		if (!consume(budget, byteCount)) {
			return false;
		}
	}
	return true;
}

function writeJsonString(value: string, budget: ISerializationBudget): boolean {
	return consume(budget, 2) && consumeUtf8String(value, budget, true);
}

function writeJsonArray(value: readonly unknown[], budget: ISerializationBudget): SerializationResult {
	const minimumByteCount = value.length === 0 ? 2 : (value.length * 2) + 1;
	if (!consume(budget, minimumByteCount)) {
		return SerializationResult.Exceeded;
	}
	budget.remainingBytes += minimumByteCount - 1;

	for (let index = 0; index < value.length; index += 1) {
		if (index > 0 && !consume(budget, 1)) {
			return SerializationResult.Exceeded;
		}
		const result = writeJsonValue(value[index], String(index), budget, true);
		if (result === SerializationResult.Exceeded) {
			return result;
		}
		if (result === SerializationResult.Omitted && !consume(budget, 4)) {
			return SerializationResult.Exceeded;
		}
	}
	return consume(budget, 1) ? SerializationResult.Written : SerializationResult.Exceeded;
}

function writeJsonObject(value: object, budget: ISerializationBudget): SerializationResult {
	if (!consume(budget, 1)) {
		return SerializationResult.Exceeded;
	}
	let propertyCount = 0;
	const record = value as Record<string, unknown>;
	for (const key in record) {
		if (!Object.prototype.hasOwnProperty.call(record, key)) {
			continue;
		}
		const result = writeJsonValue(record[key], key, budget, true);
		if (result === SerializationResult.Exceeded) {
			return result;
		}
		if (result === SerializationResult.Omitted) {
			continue;
		}
		if ((propertyCount > 0 && !consume(budget, 1))
			|| !writeJsonString(key, budget)
			|| !consume(budget, 1)) {
			return SerializationResult.Exceeded;
		}
		propertyCount += 1;
	}
	return consume(budget, 1) ? SerializationResult.Written : SerializationResult.Exceeded;
}

function writeJsonValue(
	initialValue: unknown,
	key: string,
	budget: ISerializationBudget,
	applyToJSON: boolean,
): SerializationResult {
	let value = initialValue;
	if (applyToJSON && value !== null && (typeof value === 'object' || typeof value === 'function')) {
		const toJSON = (value as { readonly toJSON?: unknown }).toJSON;
		if (typeof toJSON === 'function') {
			value = toJSON.call(value, key) as unknown;
		}
	}

	switch (typeof value) {
		case 'string':
			return writeJsonString(value, budget)
				? SerializationResult.Written
				: SerializationResult.Exceeded;
		case 'number': {
			const serialized = Number.isFinite(value)
				? Object.is(value, -0) ? '0' : String(value)
				: 'null';
			return consume(budget, serialized.length)
				? SerializationResult.Written
				: SerializationResult.Exceeded;
		}
		case 'boolean':
			return consume(budget, value ? 4 : 5)
				? SerializationResult.Written
				: SerializationResult.Exceeded;
		case 'bigint':
			throw new TypeError('A Sessions payload cannot serialize a bigint value.');
		case 'undefined':
		case 'function':
		case 'symbol':
			return SerializationResult.Omitted;
		case 'object':
			if (value === null) {
				return consume(budget, 4)
					? SerializationResult.Written
					: SerializationResult.Exceeded;
			}
	}

	if (value instanceof Number || value instanceof String || value instanceof Boolean) {
		return writeJsonValue(value.valueOf(), key, budget, false);
	}
	if (budget.ancestors.has(value)) {
		throw new TypeError('A Sessions payload cannot serialize a circular value.');
	}
	budget.ancestors.add(value);
	const result = Array.isArray(value)
		? writeJsonArray(value, budget)
		: writeJsonObject(value, budget);
	budget.ancestors.delete(value);
	return result;
}

function createBudget(maximumBytes: number): ISerializationBudget {
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 0) {
		throw new RangeError('A serialized byte limit must be a non-negative safe integer.');
	}
	return { remainingBytes: maximumBytes, ancestors: new Set() };
}

/** Returns whether JSON serialization would exceed a byte limit without allocating the JSON string. */
export function isSerializedJsonLargerThan(value: unknown, maximumBytes: number): boolean {
	return writeJsonValue(value, '', createBudget(maximumBytes), true) === SerializationResult.Exceeded;
}

/** Returns whether a string's UTF-8 representation exceeds a byte limit without allocating bytes. */
export function isUtf8StringLargerThan(value: string, maximumBytes: number): boolean {
	return !consumeUtf8String(value, createBudget(maximumBytes), false);
}
