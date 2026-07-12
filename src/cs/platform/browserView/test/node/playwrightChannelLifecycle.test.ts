/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { PlaywrightChannel } from 'cs/platform/browserView/node/playwrightChannel';

function createDeferred(): { readonly promise: Promise<void>; resolve(): void } {
	let resolve!: () => void;
	const promise = new Promise<void>(promiseResolve => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

interface TestSession {
	readonly sessionId: string;
	shutdown(): Promise<void>;
}

function createTestSession(overrides: Partial<TestSession> = {}): TestSession {
	return {
		sessionId: 'test-session',
		shutdown: async () => {},
		...overrides,
	};
}

test('PlaywrightChannel waits for window shutdown, gates work, and releases finalized state', async () => {
	const shutdownGate = createDeferred();
	let shutdownCalls = 0;
	const channel = new PlaywrightChannel(undefined as never, undefined as never, undefined as never, undefined as never);
	const instances = (channel as unknown as { instances: Map<number, TestSession> }).instances;
	instances.set(7, createTestSession({
		shutdown: async () => {
			shutdownCalls++;
			await shutdownGate.promise;
		},
	}));

	let completed = false;
	const disposal = channel.call('test', 'disposeWindow', [7, undefined], CancellationTokenNone).then(() => {
		completed = true;
	});
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(completed, false);
	assert.equal(shutdownCalls, 1);
	assert.throws(
		() => channel.call('test', 'getTrackedPages', [7, undefined], CancellationTokenNone),
		/disposed/,
	);
	assert.throws(() => channel.listen('test', 'onDidChangeTrackedPages', [7, undefined]), /disposed/);

	shutdownGate.resolve();
	await disposal;
	assert.equal(completed, true);
	assert.equal((channel as unknown as { windowShutdowns: Map<number, unknown> }).windowShutdowns.size, 0);
	assert.equal((channel as unknown as { disposedWindows: Set<number> }).disposedWindows.size, 0);
});

test('PlaywrightChannel global shutdown waits for every window and rejects new calls', async () => {
	const firstGate = createDeferred();
	const secondGate = createDeferred();
	const channel = new PlaywrightChannel(undefined as never, undefined as never, undefined as never, undefined as never);
	const instances = (channel as unknown as { instances: Map<number, TestSession> }).instances;
	instances.set(1, createTestSession({ sessionId: 'first', shutdown: () => firstGate.promise }));
	instances.set(2, createTestSession({ sessionId: 'second', shutdown: () => secondGate.promise }));

	let completed = false;
	const shutdown = channel.call('test', 'shutdown', undefined, CancellationTokenNone).then(() => {
		completed = true;
	});
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(completed, false);
	assert.throws(
		() => channel.call('test', 'getTrackedPages', [3, undefined], CancellationTokenNone),
		/shutting down/,
	);

	firstGate.resolve();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(completed, false);
	secondGate.resolve();
	await shutdown;
	assert.equal(completed, true);
});
