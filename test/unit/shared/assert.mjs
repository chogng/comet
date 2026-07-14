/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export class AssertionError extends Error {
	constructor(message, actual, expected) {
		super(message);
		this.name = 'AssertionError';
		this.actual = actual;
		this.expected = expected;
	}
}

function describe(value) {
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
}

function deepEqual(actual, expected, seen = new Map()) {
	if (Object.is(actual, expected)) {
		return true;
	}
	if (typeof actual !== 'object' || actual === null || typeof expected !== 'object' || expected === null) {
		return false;
	}
	if (seen.get(actual) === expected) {
		return true;
	}
	seen.set(actual, expected);
	if (Array.isArray(actual) !== Array.isArray(expected)) {
		return false;
	}
	const actualKeys = Object.keys(actual);
	const expectedKeys = Object.keys(expected);
	if (actualKeys.length !== expectedKeys.length) {
		return false;
	}
	return actualKeys.every(key => Object.hasOwn(expected, key) && deepEqual(actual[key], expected[key], seen));
}

function fail(message, actual, expected) {
	throw new AssertionError(message, actual, expected);
}

export function ok(value, message = 'The value must be truthy.') {
	if (!value) {
		fail(message, value, true);
	}
}

export function equal(actual, expected, message = `Expected ${describe(actual)} to equal ${describe(expected)}.`) {
	// eslint-disable-next-line eqeqeq
	if (actual != expected) {
		fail(message, actual, expected);
	}
}

export function notEqual(actual, expected, message = `Expected ${describe(actual)} not to equal ${describe(expected)}.`) {
	// eslint-disable-next-line eqeqeq
	if (actual == expected) {
		fail(message, actual, expected);
	}
}

export function strictEqual(actual, expected, message = `Expected ${describe(actual)} to strictly equal ${describe(expected)}.`) {
	if (!Object.is(actual, expected)) {
		fail(message, actual, expected);
	}
}

export function deepStrictEqual(actual, expected, message = `Expected ${describe(actual)} to deeply equal ${describe(expected)}.`) {
	if (!deepEqual(actual, expected)) {
		fail(message, actual, expected);
	}
}

export const deepEqualAssertion = deepStrictEqual;

export function match(value, expression, message = `Expected ${describe(value)} to match ${expression}.`) {
	if (!expression.test(String(value))) {
		fail(message, value, expression);
	}
}

export function doesNotMatch(value, expression, message = `Expected ${describe(value)} not to match ${expression}.`) {
	if (expression.test(String(value))) {
		fail(message, value, expression);
	}
}

function matchesExpected(error, expected) {
	if (!expected) {
		return true;
	}
	if (typeof expected === 'function') {
		return error instanceof expected;
	}
	if (expected instanceof RegExp) {
		return expected.test(String(error?.message ?? error));
	}
	return false;
}

export function throws(fn, expected, message = 'Expected the function to throw.') {
	try {
		fn();
	} catch (error) {
		if (!matchesExpected(error, expected)) {
			fail(message, error, expected);
		}
		return error;
	}
	fail(message, undefined, expected);
}

export function doesNotThrow(fn, message = 'Expected the function not to throw.') {
	try {
		return fn();
	} catch (error) {
		fail(message, error, undefined);
	}
}

export async function rejects(valueOrPromise, expected, message = 'Expected the promise to reject.') {
	try {
		await (typeof valueOrPromise === 'function' ? valueOrPromise() : valueOrPromise);
	} catch (error) {
		if (!matchesExpected(error, expected)) {
			fail(message, error, expected);
		}
		return error;
	}
	fail(message, undefined, expected);
}

function assert(value, message) {
	ok(value, message);
}

Object.assign(assert, {
	AssertionError,
	ok,
	equal,
	notEqual,
	strictEqual,
	deepEqual: deepStrictEqual,
	deepStrictEqual,
	match,
	doesNotMatch,
	throws,
	doesNotThrow,
	rejects,
});

export default assert;
