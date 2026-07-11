/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import { Event } from 'cs/base/common/event';
import type { IAgentNetworkFilterService } from 'cs/platform/networkFilter/common/networkFilterService';
import {
	BrowserPageReadinessSelectorError,
	BrowserPageReadinessTimeoutError,
	BrowserPageNotTrackedError,
	BrowserPageSnapshotEmptyError,
	BrowserPageSnapshotTooLargeError,
} from 'cs/platform/browserView/common/playwrightService';
import { PlaywrightTab } from 'cs/platform/browserView/node/playwrightTab';
import { PlaywrightService } from 'cs/platform/browserView/node/playwrightService';

interface SnapshotValue {
	readonly uri: string;
	readonly title: string;
	readonly html: string;
}

interface TooLargeSnapshotValue {
	readonly uri: string;
	readonly title: string;
	readonly tooLarge: true;
}

class FakePage {
	readonly evaluateCalls: unknown[] = [];
	private readonly listeners = new Map<string, readonly ((...args: readonly unknown[]) => void)[]>();
	readonly locatorCalls: string[] = [];
	loadState: Promise<void> = Promise.resolve();
	snapshot: SnapshotValue | TooLargeSnapshotValue | undefined = { uri: 'https://example.com/article', title: 'Example article', html: '<html><body>Example</body></html>' };
	locatorCount = 1;
	initialLocatorCount: Promise<number> | undefined;
	visible = [true];
	locatorError: Error | undefined;
	private locatorCountCalls = 0;

	on(event: string, listener: (...args: readonly unknown[]) => void): this {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
		return this;
	}

	off(event: string, listener: (...args: readonly unknown[]) => void): this {
		this.listeners.set(event, (this.listeners.get(event) ?? []).filter(candidate => candidate !== listener));
		return this;
	}

	async consoleMessages(): Promise<readonly unknown[]> {
		return [];
	}

	async pageErrors(): Promise<readonly Error[]> {
		return [];
	}

	url(): string {
		return 'https://example.com/article';
	}

	mainFrame(): { waitForLoadState: () => Promise<void> } {
		return { waitForLoadState: () => this.loadState };
	}

	locator(selector: string): { count: () => Promise<number>; nth: (index: number) => { isVisible: () => Promise<boolean> } } {
		this.locatorCalls.push(selector);
		return {
			count: async () => {
				this.locatorCountCalls++;
				if (this.locatorCountCalls === 1 && this.initialLocatorCount) {
					return this.initialLocatorCount;
				}
				if (this.locatorError) {
					throw this.locatorError;
				}
				return this.locatorCount;
			},
			nth: index => ({ isVisible: async () => this.visible[index] ?? false }),
		};
	}

	async evaluate<T>(pageFunction?: unknown): Promise<T> {
		this.evaluateCalls.push(pageFunction);
		if (this.evaluateCalls.length === 1) {
			return undefined as T;
		}
		return this.snapshot as T;
	}
}

function createTab(page = new FakePage()): { readonly page: FakePage; readonly tab: PlaywrightTab } {
	const actionScope = { activeCalls: 0 };
	const networkFilter: IAgentNetworkFilterService = {
		_serviceBrand: undefined,
		isUriAllowed: () => true,
		formatError: () => '',
		onDidChange: Event.None,
	};
	return {
		page,
		tab: new PlaywrightTab(page as unknown as ConstructorParameters<typeof PlaywrightTab>[0], actionScope, networkFilter),
	};
}

test('captureSnapshot returns an atomic main-frame HTML snapshot after readiness', async () => {
	const { page, tab } = createTab();
	const snapshot = await tab.captureSnapshot('page-1', {
		readiness: { selector: 'main article', state: 'attached', minimumCount: 1 },
	}, CancellationTokenNone);

	assert.deepEqual(snapshot, page.snapshot);
	assert.deepEqual(page.locatorCalls, ['main article']);
	assert.equal(page.evaluateCalls.length, 2);
	const atomicSnapshotEvaluate = String(page.evaluateCalls[1]);
	assert.match(atomicSnapshotEvaluate, /location\.href/);
	assert.match(atomicSnapshotEvaluate, /document\.title/);
	assert.match(atomicSnapshotEvaluate, /documentElement.*outerHTML/);
	assert.match(atomicSnapshotEvaluate, /TextEncoder/);
});

test('captureSnapshot requires every requested visible readiness element', async () => {
	const { page, tab } = createTab();
	page.locatorCount = 2;
	page.visible = [true, false];

	await assert.rejects(
		tab.captureSnapshot('page-1', { readiness: { selector: 'article', state: 'visible', minimumCount: 2 }, timeoutMs: 5 }, CancellationTokenNone),
		BrowserPageReadinessTimeoutError,
	);
	assert.equal(page.evaluateCalls.length, 0);
});

test('captureSnapshot rejects invalid readiness selectors and invalid limits', async () => {
	const { page, tab } = createTab();
	page.locatorError = new Error('Invalid selector');

	await assert.rejects(
		tab.captureSnapshot('page-1', { readiness: { selector: '[', state: 'attached' } }, CancellationTokenNone),
		BrowserPageReadinessSelectorError,
	);
	await assert.rejects(
		tab.captureSnapshot('page-1', { timeoutMs: 0 }, CancellationTokenNone),
		RangeError,
	);
	await assert.rejects(
		tab.captureSnapshot('page-1', { maximumBytes: 0 }, CancellationTokenNone),
		RangeError,
	);
});

test('captureSnapshot rejects empty documents and UTF-8 byte-limit overflow', async () => {
	const { page, tab } = createTab();
	page.snapshot = undefined;
	await assert.rejects(tab.captureSnapshot('page-1', undefined, CancellationTokenNone), BrowserPageSnapshotEmptyError);

	page.snapshot = { uri: 'https://example.com/article', title: 'Example article', html: '汉' };
	await assert.rejects(
		tab.captureSnapshot('page-1', { maximumBytes: 2 }, CancellationTokenNone),
		BrowserPageSnapshotTooLargeError,
	);

	page.snapshot = { uri: 'https://example.com/article', title: 'Example article', tooLarge: true };
	await assert.rejects(
		tab.captureSnapshot('page-1', undefined, CancellationTokenNone),
		BrowserPageSnapshotTooLargeError,
	);
});

test('captureSnapshot cancels while validating a readiness selector', async () => {
	const { page, tab } = createTab();
	page.initialLocatorCount = new Promise(() => {});
	const cancellationSource = new CancellationTokenSource();
	const capture = tab.captureSnapshot('page-1', { readiness: { selector: 'main' } }, cancellationSource.token);
	cancellationSource.cancel();

	await assert.rejects(capture, /Canceled/);
	cancellationSource.dispose();
});

test('captureSnapshot cancels during a pending load-state wait without returning a snapshot', async () => {
	const { page, tab } = createTab();
	let resolveLoadState: (() => void) | undefined;
	page.loadState = new Promise(resolve => { resolveLoadState = resolve; });
	const cancellationSource = new CancellationTokenSource();
	const capture = tab.captureSnapshot('page-1', undefined, cancellationSource.token);
	cancellationSource.cancel();

	await assert.rejects(capture, /Canceled/);
	resolveLoadState?.();
	cancellationSource.dispose();
	assert.equal(page.evaluateCalls.length, 0);
});

test('captureSnapshot does not read a previous document when navigation interrupts loading', async () => {
	const { page, tab } = createTab();
	page.loadState = Promise.reject(new Error('Execution context was destroyed, most likely because of a navigation'));

	await assert.rejects(
		tab.captureSnapshot('page-1', undefined, CancellationTokenNone),
		/Execution context was destroyed/,
	);
	assert.equal(page.evaluateCalls.length, 0);
});

test('PlaywrightService rejects snapshot requests for untracked pages before creating a session', async () => {
	const service = new PlaywrightService(1, undefined as never, undefined as never, undefined as never, undefined as never);
	await assert.rejects(
		service.captureSnapshot('session-1', 'untracked-page', undefined, CancellationTokenNone),
		BrowserPageNotTrackedError,
	);
	service.dispose();
});

test('PlaywrightService waits for existing groups to register a tracked page', async () => {
	let resolveAdd: (() => void) | undefined;
	const add = new Promise<void>(resolve => {
		resolveAdd = resolve;
	});
	const group = {
		addView: async () => add,
		removeView: async () => {},
	};
	const session = {
		group,
		dispose: () => {},
	};
	const service = new PlaywrightService(1, undefined as never, undefined as never, undefined as never, undefined as never);
	(service as unknown as { _sessions: { set(key: string, value: typeof session): void } })._sessions.set('session', session);

	try {
		let completed = false;
		const tracking = service.startTrackingPage('page-1').then(() => {
			completed = true;
		});

		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(completed, false);

		resolveAdd?.();
		await tracking;
		assert.equal(completed, true);
	} finally {
		service.dispose();
	}
});
