/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AgentHostError, AgentHostErrorCode } from './errors.js';
import { AgentHostPayloadDigest, createAgentHostPayloadDigest } from './identities.js';

export type AgentHostProtocolValue =
	| null
	| boolean
	| number
	| string
	| readonly AgentHostProtocolValue[]
	| { readonly [name: string]: AgentHostProtocolValue };

export interface IAgentHostDisplayMetadata {
	readonly label: string;
	readonly description?: string;
}

export interface IAgentHostMetadataEntry {
	readonly namespace: string;
	readonly value: AgentHostProtocolValue;
}

const maximumProtocolDepth = 64;
const maximumProtocolEntries = 100_000;
const maximumProtocolStringLength = 64 * 1024 * 1024;

export function assertAgentHostProtocolValue(value: unknown): asserts value is AgentHostProtocolValue {
	let entryCount = 0;
	const invalid = (field: string, candidate: unknown): never => {
		const diagnostic = typeof candidate === 'number'
			? candidate
			: typeof candidate === 'string'
				? candidate.slice(0, 256)
				: typeof candidate;
		throw new AgentHostError(
			AgentHostErrorCode.InvalidProtocolValue,
			'Invalid Agent Host protocol value',
			{ field, value: diagnostic },
		);
	};

	const visit = (candidate: unknown, depth: number): void => {
		if (depth > maximumProtocolDepth) {
			invalid('depth', depth);
		}

		if (candidate === null || typeof candidate === 'boolean') {
			return;
		}

		if (typeof candidate === 'string') {
			if (candidate.length > maximumProtocolStringLength) {
				invalid('stringLength', candidate.length);
			}
			return;
		}

		if (typeof candidate === 'number') {
			if (!Number.isFinite(candidate)) {
				invalid('number', candidate);
			}
			return;
		}

		if (Array.isArray(candidate)) {
			entryCount += candidate.length;
			if (entryCount > maximumProtocolEntries) {
				invalid('entryCount', entryCount);
			}

			for (const item of candidate) {
				visit(item, depth + 1);
			}
			return;
		}

		if (typeof candidate !== 'object') {
			return invalid('value', candidate);
		}

		const prototype = Object.getPrototypeOf(candidate);
		if (prototype !== Object.prototype && prototype !== null) {
			invalid('prototype', prototype);
		}

		const entries = Object.entries(candidate);
		entryCount += entries.length;
		if (entryCount > maximumProtocolEntries) {
			invalid('entryCount', entryCount);
		}

		for (const [key, item] of entries) {
			if (key.length === 0 || key.length > 256) {
				invalid('key', key);
			}
			visit(item, depth + 1);
		}
	};

	visit(value, 0);
}

export function encodeAgentHostProtocolValue(value: AgentHostProtocolValue | object): string {
	assertAgentHostProtocolValue(value);
	return encodeValidatedAgentHostProtocolValue(value);
}

function encodeValidatedAgentHostProtocolValue(value: AgentHostProtocolValue): string {
	if (value === null || typeof value === 'boolean' || typeof value === 'string') {
		return JSON.stringify(value);
	}

	if (typeof value === 'number') {
		if (!Number.isFinite(value)) {
			throw new TypeError('Agent Host protocol numbers must be finite');
		}

		return JSON.stringify(value);
	}

	if (Array.isArray(value)) {
		return `[${value.map(item => encodeValidatedAgentHostProtocolValue(item)).join(',')}]`;
	}

	const entries = Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0);
	return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${encodeValidatedAgentHostProtocolValue(item)}`).join(',')}}`;
}

export async function computeAgentHostPayloadDigest(value: AgentHostProtocolValue | object): Promise<AgentHostPayloadDigest> {
	const bytes = new TextEncoder().encode(encodeAgentHostProtocolValue(value));
	const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', bytes));
	const hexadecimal = Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
	return createAgentHostPayloadDigest(`sha256:${hexadecimal}`);
}
