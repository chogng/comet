/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const root = {
	tests: [],
	suites: [],
	before: [],
	after: [],
	beforeEach: [],
	afterEach: [],
};

let currentSuite = root;

class TestSkip extends Error {
	constructor(reason) {
		super(reason);
		this.name = 'TestSkip';
	}
}

function normalizeCallback(options, callback) {
	return typeof options === 'function' ? options : callback;
}

function addHook(name, options, callback) {
	const hook = normalizeCallback(options, callback);
	if (typeof hook !== 'function') {
		throw new TypeError(`${name} requires a callback.`);
	}
	currentSuite[name].push(hook);
}

export function suite(name, options, callback) {
	const body = normalizeCallback(options, callback);
	if (typeof body !== 'function') {
		throw new TypeError('suite requires a callback.');
	}
	const child = {
		name,
		tests: [],
		suites: [],
		before: [],
		after: [],
		beforeEach: [],
		afterEach: [],
	};
	currentSuite.suites.push(child);
	const previousSuite = currentSuite;
	currentSuite = child;
	body();
	currentSuite = previousSuite;
	return child;
}

export function test(name, options, callback) {
	const body = normalizeCallback(options, callback);
	if (typeof body !== 'function') {
		throw new TypeError('test requires a callback.');
	}
	const item = { name, callback: body, skipped: false };
	currentSuite.tests.push(item);
	return item;
}

test.skip = (name, options, callback) => {
	const item = test(name, options, callback ?? (() => {}));
	item.skipped = true;
	return item;
};

export const before = (options, callback) => addHook('before', options, callback);
export const after = (options, callback) => addHook('after', options, callback);
export const beforeEach = (options, callback) => addHook('beforeEach', options, callback);
export const afterEach = (options, callback) => addHook('afterEach', options, callback);

async function runHook(hook) {
	await hook({ signal: new AbortController().signal, skip: reason => { throw new TestSkip(reason); } });
}

function errorRecord(error) {
	return {
		message: String(error?.message ?? error),
		stack: String(error?.stack ?? error),
	};
}

async function runSuite(node, ancestors, records) {
	for (const hook of node.before) {
		await runHook(hook);
	}

	for (const item of node.tests) {
		const fullName = [...ancestors, node.name, item.name].filter(Boolean).join(' > ');
		if (item.skipped) {
			records.push({ name: fullName, status: 'skipped' });
			continue;
		}
		const beforeEachHooks = [...ancestors.flatMap(ancestor => ancestor.beforeEach), ...node.beforeEach];
		const afterEachHooks = [...node.afterEach, ...ancestors.flatMap(ancestor => ancestor.afterEach).reverse()];
		try {
			for (const hook of beforeEachHooks) {
				await runHook(hook);
			}
			await item.callback({ signal: new AbortController().signal, skip: reason => { throw new TestSkip(reason); } });
			records.push({ name: fullName, status: 'passed' });
		} catch (error) {
			if (error instanceof TestSkip) {
				records.push({ name: fullName, status: 'skipped', reason: error.message });
			} else {
				records.push({ name: fullName, status: 'failed', error: errorRecord(error) });
			}
		} finally {
			for (const hook of afterEachHooks) {
				try {
					await runHook(hook);
				} catch (error) {
					records.push({ name: `${fullName} (afterEach)`, status: 'failed', error: errorRecord(error) });
				}
			}
		}
	}

	for (const child of node.suites) {
		await runSuite(child, [...ancestors, node.name], records);
	}

	for (const hook of node.after) {
		await runHook(hook);
	}
}

async function runAll() {
	const records = [];
	let fatalError;
	try {
		await runSuite(root, [], records);
	} catch (error) {
		fatalError = errorRecord(error);
	}
	const result = {
		tests: records,
		passed: records.filter(record => record.status === 'passed').length,
		failed: records.filter(record => record.status === 'failed').length + (fatalError ? 1 : 0),
		skipped: records.filter(record => record.status === 'skipped').length,
		fatalError,
	};
	if (fatalError) {
		result.tests.push({ name: 'runtime setup', status: 'failed', error: fatalError });
	}
	globalThis.__cometUnitResult = result;
	globalThis.__cometUnitDone?.(result);
}

queueMicrotask(() => {
	if (!globalThis.__cometUnitRunScheduled) {
		globalThis.__cometUnitRunScheduled = true;
		runAll();
	}
});

export default test;
