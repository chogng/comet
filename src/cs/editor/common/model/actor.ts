/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWellFormedUnicodeString } from 'cs/editor/common/core/canonicalJson';

export type ActorRef =
	| {
		readonly type: 'human';
		readonly id: string;
	}
	| {
		readonly type: 'agent';
		readonly id: string;
	}
	| {
		readonly type: 'system';
		readonly id: string;
		readonly role: 'importer' | 'migration' | 'validator' | 'recovery';
	};

export function createTrustedActorRef(value: unknown): ActorRef | undefined {
	try {
		const actor = readActorRecord(value);
		if (actor === undefined || !isActorId(actor['id'])) {
			return undefined;
		}
		if (actor['type'] === 'system') {
			return (
				hasExactActorKeys(actor, ['type', 'id', 'role'])
				&& (
					actor['role'] === 'importer'
					|| actor['role'] === 'migration'
					|| actor['role'] === 'validator'
					|| actor['role'] === 'recovery'
				)
			)
				? Object.freeze({
					type: 'system',
					id: actor['id'],
					role: actor['role'],
				})
				: undefined;
		}
		return (
			(actor['type'] === 'human' || actor['type'] === 'agent')
			&& hasExactActorKeys(actor, ['type', 'id'])
		)
			? Object.freeze({
				type: actor['type'],
				id: actor['id'],
			})
			: undefined;
	} catch {
		return undefined;
	}
}

function readActorRecord(value: unknown): Readonly<Record<string, unknown>> | undefined {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	const prototype = Reflect.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) {
		return undefined;
	}
	const keys = Reflect.ownKeys(value);
	const result: Record<string, unknown> = Object.create(null);
	for (const key of keys) {
		if (typeof key !== 'string') {
			return undefined;
		}
		const descriptor = Reflect.getOwnPropertyDescriptor(value, key);
		if (
			descriptor === undefined
			|| !descriptor.enumerable
			|| !('value' in descriptor)
		) {
			return undefined;
		}
		result[key] = descriptor.value;
	}
	return result;
}

function hasExactActorKeys(
	value: Readonly<Record<string, unknown>>,
	keys: readonly string[],
): boolean {
	return (
		Object.keys(value).length === keys.length
		&& keys.every(key => Object.hasOwn(value, key))
	);
}

function isActorId(value: unknown): value is string {
	return (
		typeof value === 'string'
		&& value.length >= 1
		&& value.length <= 512
		&& isWellFormedUnicodeString(value)
	);
}
