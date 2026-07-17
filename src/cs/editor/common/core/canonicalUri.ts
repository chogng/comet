/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { isWellFormedUnicodeString } from 'cs/editor/common/core/canonicalJson';

export function cloneCanonicalRuntimeUri(value: unknown): URI | undefined {
	try {
		if (!(value instanceof URI)) {
			return undefined;
		}
		const components: Record<string, string> = {};
		for (const key of ['scheme', 'authority', 'path', 'query', 'fragment'] as const) {
			const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
			if (
				descriptor === undefined
				|| !('value' in descriptor)
				|| typeof descriptor.value !== 'string'
				|| !isWellFormedUnicodeString(descriptor.value)
			) {
				return undefined;
			}
			components[key] = descriptor.value;
		}
		if (components['scheme'].length === 0) {
			return undefined;
		}
		const captured = URI.from({
			scheme: components['scheme'],
			authority: components['authority'],
			path: components['path'],
			query: components['query'],
			fragment: components['fragment'],
		});
		const encoded = captured.toString();
		const reparsed = URI.parse(encoded, true);
		return reparsed.toString() === encoded ? captured : undefined;
	} catch {
		return undefined;
	}
}

export function encodeCanonicalUri(value: unknown): string | undefined {
	const captured = cloneCanonicalRuntimeUri(value);
	return captured?.toString();
}

export function decodeCanonicalUri(value: unknown): URI | undefined {
	if (typeof value !== 'string' || !isWellFormedUnicodeString(value)) {
		return undefined;
	}
	try {
		const parsed = URI.parse(value, true);
		return parsed.scheme.length > 0 && parsed.toString() === value
			? parsed
			: undefined;
	} catch {
		return undefined;
	}
}
