/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Event } from 'cs/base/common/event';
import { PlaywrightService } from 'cs/platform/browserView/node/playwrightService';

function createDeferred<T = void>(): {
	readonly promise: Promise<T>;
	resolve(value: T): void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

interface TestSession {
	readonly sessionId: string;
	readonly group: {
		addView(viewId: string): Promise<{ viewId: string; targetId: string }>;
		removeView(viewId: string): Promise<void>;
	};
	shutdown(): Promise<void>;
}

interface TestServiceState {
	readonly _pendingInits: Map<string, Promise<TestSession>>;
	readonly _pendingInitGroups: Map<string, { destroy(): Promise<void> }>;
	readonly _sessions: { set(key: string, value: TestSession): void };
}

function getServiceState(service: PlaywrightService): TestServiceState {
	return service as unknown as TestServiceState;
}

function createTestSession(overrides: Partial<TestSession> = {}): TestSession {
	return {
		sessionId: 'test-session',
		group: {
			addView: async viewId => ({ viewId, targetId: `target-${viewId}` }),
			removeView: async () => {},
		},
		shutdown: async () => {},
		...overrides,
	};
}

function createService(): PlaywrightService {
	const trackingGroup = {
		id: 'tracking-group',
		onDidAddView: Event.None,
		onDidRemoveView: Event.None,
		onDidDestroy: Event.None,
		onCDPMessage: Event.None,
		addView: async (viewId: string) => ({ viewId, targetId: `target-${viewId}` }),
		removeView: async () => {},
		sendCDPMessage: async () => {},
		destroy: async () => {},
	};
	return new PlaywrightService(
		1,
		{ createGroup: async () => trackingGroup } as never,
		new Proxy({}, { get: () => () => {} }) as never,
		undefined as never,
		undefined as never,
	);
}

test('PlaywrightService shutdown interrupts pending initialization and awaits the resulting session shutdown', async () => {
	const service = createService();
	const state = getServiceState(service);
	const groupShutdown = createDeferred();
	const sessionInitialization = createDeferred<TestSession>();
	const sessionShutdown = createDeferred();
	let groupShutdownCalls = 0;
	let sessionShutdownCalls = 0;
	state._pendingInitGroups.set('session-1', {
		destroy: async () => {
			groupShutdownCalls++;
			await groupShutdown.promise;
		},
	});
	state._pendingInits.set('session-1', sessionInitialization.promise);
	const pendingSession = createTestSession({
		sessionId: 'session-1',
		shutdown: async () => {
			sessionShutdownCalls++;
			await sessionShutdown.promise;
		},
	});

	let completed = false;
	const shutdown = service.shutdown().then(() => { completed = true; });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(groupShutdownCalls, 1);
	assert.equal(completed, false);
	await assert.rejects(service.getTrackedPages(), /shutting down/);

	groupShutdown.resolve();
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(completed, false);
	sessionInitialization.resolve(pendingSession);
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(sessionShutdownCalls, 1);
	assert.equal(completed, false);

	sessionShutdown.resolve();
	await shutdown;
	assert.equal(completed, true);
});

test('PlaywrightService disposeSession gates the session ID until pending initialization is shut down', async () => {
	const service = createService();
	const state = getServiceState(service);
	const groupShutdown = createDeferred();
	const sessionInitialization = createDeferred<TestSession>();
	const sessionShutdown = createDeferred();
	state._pendingInitGroups.set('session-1', { destroy: () => groupShutdown.promise });
	state._pendingInits.set('session-1', sessionInitialization.promise);
	const pendingSession = createTestSession({
		sessionId: 'session-1',
		shutdown: () => sessionShutdown.promise,
	});

	const disposal = service.disposeSession('session-1');
	await assert.rejects(service.getSummary('session-1', 'page-1'), /being disposed/);
	groupShutdown.resolve();
	sessionInitialization.resolve(pendingSession);
	await new Promise<void>(resolve => setImmediate(resolve));
	let completed = false;
	void disposal.then(() => { completed = true; });
	assert.equal(completed, false);
	sessionShutdown.resolve();
	await disposal;

	state._pendingInitGroups.delete('session-1');
	state._pendingInits.delete('session-1');
	await service.shutdown();
});

test('PlaywrightService shutdown runs every session cleanup and aggregates failures', async () => {
	const service = createService();
	const state = getServiceState(service);
	let firstCalls = 0;
	let secondCalls = 0;
	state._sessions.set('first', createTestSession({
		sessionId: 'first',
		shutdown: async () => {
			firstCalls++;
			throw new Error('first shutdown failed');
		},
	}));
	state._sessions.set('second', createTestSession({
		sessionId: 'second',
		shutdown: async () => {
			secondCalls++;
			throw new Error('second shutdown failed');
		},
	}));

	await assert.rejects(
		service.shutdown(),
		error => error instanceof AggregateError
			&& error.errors.some(candidate => String(candidate).includes('first shutdown failed'))
			&& error.errors.some(candidate => String(candidate).includes('second shutdown failed')),
	);
	assert.equal(firstCalls, 1);
	assert.equal(secondCalls, 1);
});

test('PlaywrightService reports pending initialization group cleanup failures once', async () => {
	const service = createService();
	const state = getServiceState(service);
	const cleanupError = new Error('pending group cleanup failed');
	state._pendingInitGroups.set('session-1', {
		destroy: async () => {
			throw cleanupError;
		},
	});
	state._pendingInits.set('session-1', Promise.reject(cleanupError));

	await assert.rejects(service.shutdown(), error => error === cleanupError);
});
