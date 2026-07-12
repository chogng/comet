/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { ApplicationQuitCoordinator, type IApplicationQuitWindow } from 'cs/platform/lifecycle/electron-main/applicationQuit';

function createDeferred(): { readonly promise: Promise<void>; resolve(): void } {
	let resolve!: () => void;
	const promise = new Promise<void>(promiseResolve => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

class TestWindow implements IApplicationQuitWindow {
	private closedListener: (() => void) | undefined;
	private destroyed = false;
	closeCalls = 0;

	constructor(private readonly closeError?: Error) {}

	isDestroyed(): boolean {
		return this.destroyed;
	}

	once(_event: 'closed', listener: () => void): void {
		this.closedListener = listener;
	}

	removeListener(_event: 'closed', listener: () => void): void {
		if (this.closedListener === listener) {
			this.closedListener = undefined;
		}
	}

	close(): void {
		this.closeCalls++;
		if (this.closeError) {
			throw this.closeError;
		}
	}

	completeClose(): void {
		this.destroyed = true;
		const listener = this.closedListener;
		this.closedListener = undefined;
		listener?.();
	}
}

test('ApplicationQuitCoordinator blocks activate while async quit preparation is pending', async () => {
	const preparation = createDeferred();
	let preparationCalls = 0;
	let quitCalls = 0;
	let createWindowCalls = 0;
	let preventDefaultCalls = 0;
	const coordinator = new ApplicationQuitCoordinator(
		() => [],
		() => {
			preparationCalls++;
			return preparation.promise;
		},
		() => { quitCalls++; },
		() => assert.fail('Quit preparation should not fail.'),
	);
	const event = { preventDefault: () => { preventDefaultCalls++; } };

	coordinator.handleBeforeQuit(event);
	coordinator.handleBeforeQuit(event);
	coordinator.handleActivate(() => { createWindowCalls++; });
	await Promise.resolve();
	assert.equal(preventDefaultCalls, 2);
	assert.equal(preparationCalls, 1);
	assert.equal(createWindowCalls, 0);
	assert.equal(quitCalls, 0);

	preparation.resolve();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(quitCalls, 1);
	coordinator.handleBeforeQuit(event);
	assert.equal(preventDefaultCalls, 2);
});

test('ApplicationQuitCoordinator prepares services only after every window closes', async () => {
	const firstWindow = new TestWindow();
	const secondWindow = new TestWindow();
	const preparation = createDeferred();
	let preparationCalls = 0;
	let quitCalls = 0;
	const coordinator = new ApplicationQuitCoordinator(
		() => [firstWindow, secondWindow],
		() => {
			preparationCalls++;
			return preparation.promise;
		},
		() => { quitCalls++; },
		() => assert.fail('Quit preparation should not fail.'),
	);

	coordinator.handleBeforeQuit({ preventDefault: () => {} });
	assert.equal(firstWindow.closeCalls, 1);
	assert.equal(secondWindow.closeCalls, 1);
	firstWindow.completeClose();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(preparationCalls, 0);
	secondWindow.completeClose();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(preparationCalls, 1);
	assert.equal(quitCalls, 0);

	preparation.resolve();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(quitCalls, 1);
});

test('ApplicationQuitCoordinator prepares services after a window close failure', async () => {
	const closeError = new Error('Window close failed.');
	const failingWindow = new TestWindow(closeError);
	const closingWindow = new TestWindow();
	let preparationCalls = 0;
	let quitCalls = 0;
	let reportedError: unknown;
	const coordinator = new ApplicationQuitCoordinator(
		() => [failingWindow, closingWindow],
		async () => { preparationCalls++; },
		() => { quitCalls++; },
		error => { reportedError = error; },
	);

	coordinator.handleBeforeQuit({ preventDefault: () => {} });
	assert.equal(failingWindow.closeCalls, 1);
	assert.equal(closingWindow.closeCalls, 1);
	await Promise.resolve();
	assert.equal(preparationCalls, 0);
	closingWindow.completeClose();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(preparationCalls, 1);
	assert.equal(reportedError, closeError);
	assert.equal(quitCalls, 1);
});

test('ApplicationQuitCoordinator keeps macOS alive and prepares a non-macOS last-window quit once', async () => {
	const preparation = createDeferred();
	let preparationCalls = 0;
	let quitCalls = 0;
	let createWindowCalls = 0;
	let preventDefaultCalls = 0;
	const coordinator = new ApplicationQuitCoordinator(
		() => [],
		() => {
			preparationCalls++;
			return preparation.promise;
		},
		() => { quitCalls++; },
		() => assert.fail('Quit preparation should not fail.'),
	);

	coordinator.handleWindowAllClosed(true);
	coordinator.handleActivate(() => { createWindowCalls++; });
	assert.equal(quitCalls, 0);
	assert.equal(createWindowCalls, 1);

	coordinator.handleWindowAllClosed(false);
	assert.equal(quitCalls, 1);
	const event = { preventDefault: () => { preventDefaultCalls++; } };
	coordinator.handleBeforeQuit(event);
	coordinator.handleBeforeQuit(event);
	coordinator.handleActivate(() => { createWindowCalls++; });
	await Promise.resolve();
	assert.equal(preventDefaultCalls, 2);
	assert.equal(preparationCalls, 1);
	assert.equal(createWindowCalls, 1);

	preparation.resolve();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(quitCalls, 2);
});
