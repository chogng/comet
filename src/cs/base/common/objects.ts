/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isObject, isUndefinedOrNull } from './types.js';

export function cloneAndChange<T>(
	obj: T,
	changer: (value: unknown) => unknown,
): T {
	return cloneAndChangeValue(obj, changer, new Set()) as T;
}

function cloneAndChangeValue(
	obj: unknown,
	changer: (value: unknown) => unknown,
	seen: Set<unknown>,
): unknown {
	if (isUndefinedOrNull(obj)) {
		return obj;
	}

	const changed = changer(obj);
	if (typeof changed !== 'undefined') {
		return changed;
	}

	if (Array.isArray(obj)) {
		return obj.map(value => cloneAndChangeValue(value, changer, seen));
	}

	if (!isObject(obj)) {
		return obj;
	}

	if (seen.has(obj)) {
		throw new Error('Cannot clone recursive data-structure');
	}

	seen.add(obj);
	const result: Record<string, unknown> = {};
	for (const key in obj) {
		if (Object.hasOwn(obj, key)) {
			result[key] = cloneAndChangeValue(
				(obj as Record<string, unknown>)[key],
				changer,
				seen,
			);
		}
	}
	seen.delete(obj);
	return result;
}
