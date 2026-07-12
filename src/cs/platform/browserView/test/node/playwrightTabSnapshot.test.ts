/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationError, CancellationTokenNone, CancellationTokenSource, isCancellationError } from 'cs/base/common/cancellation';
import { Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import type { IAgentNetworkFilterService } from 'cs/platform/networkFilter/common/networkFilterService';
import { PlaywrightChannelClient } from 'cs/platform/browserView/common/playwrightChannelClient';
import {
	BrowserPageClosedError,
	BrowserPageNavigationInterruptedError,
	BrowserPageReadinessSelectorError,
	BrowserPageReadinessTimeoutError,
	BrowserPageNotTrackedError,
	BrowserPageSnapshotEmptyError,
	BrowserPageSnapshotTooLargeError,
	defaultPageSnapshotMaximumBytes,
	defaultPageSnapshotTimeoutMs,
	maximumPageSnapshotTimeoutMs,
	type IPageSnapshotOptions,
} from 'cs/platform/browserView/common/playwrightService';
import { DialogInterruptedError, PlaywrightTab } from 'cs/platform/browserView/node/playwrightTab';
import { PlaywrightChannel } from 'cs/platform/browserView/node/playwrightChannel';
import { PlaywrightService } from 'cs/platform/browserView/node/playwrightService';
import {
	createPageSnapshotDeadline,
	resolvePageSnapshotOptions,
} from 'cs/platform/browserView/node/playwrightSnapshot';

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
	readonly visibleIndices: number[] = [];
	loadState: Promise<void> = Promise.resolve();
	loadStateError: Error | undefined;
	render: Promise<void> = Promise.resolve();
	snapshot: SnapshotValue | TooLargeSnapshotValue | undefined = { uri: 'https://example.com/article', title: 'Example article', html: '<html><body>Example</body></html>' };
	snapshotPromise: Promise<SnapshotValue | TooLargeSnapshotValue | undefined> | undefined;
	snapshotError: Error | undefined;
	locatorCount = 1;
	initialLocatorCount: Promise<number> | undefined;
	visible = [true];
	locatorError: Error | undefined;
	consoleMessagesError: Error | undefined;
	consoleMessagesValue: readonly unknown[] = [];
	consoleMessagesCalls = 0;
	pageErrorsError: Error | undefined;
	pageErrorsValue: readonly Error[] = [];
	pageErrorsCalls = 0;
	titleValue = 'Example article';
	titleError: Error | undefined;
	titleCalls = 0;
	ariaSnapshotValue = '- article "Example article"';
	ariaSnapshotError: Error | undefined;
	readonly ariaSnapshotCalls: unknown[] = [];
	waitForFunctionError: Error | undefined;
	waitForFunctionResult: Promise<void> | undefined;
	waitForFunctionCalls = 0;
	urlValue = 'https://example.com/article';
	requestListenerCountDuringSnapshot = -1;
	private locatorCountCalls = 0;

	on(event: string, listener: (...args: readonly unknown[]) => void): this {
		this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
		return this;
	}

	off(event: string, listener: (...args: readonly unknown[]) => void): this {
		this.listeners.set(event, (this.listeners.get(event) ?? []).filter(candidate => candidate !== listener));
		return this;
	}

	listenerCount(event: string): number {
		return this.listeners.get(event)?.length ?? 0;
	}

	emit(event: string, ...args: readonly unknown[]): void {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(...args);
		}
	}

	async consoleMessages(): Promise<readonly unknown[]> {
		this.consoleMessagesCalls++;
		if (this.consoleMessagesError) {
			throw this.consoleMessagesError;
		}
		return this.consoleMessagesValue;
	}

	async pageErrors(): Promise<readonly Error[]> {
		this.pageErrorsCalls++;
		if (this.pageErrorsError) {
			throw this.pageErrorsError;
		}
		return this.pageErrorsValue;
	}

	url(): string {
		return this.urlValue;
	}

	async title(): Promise<string> {
		this.titleCalls++;
		if (this.titleError) {
			throw this.titleError;
		}
		return this.titleValue;
	}

	async ariaSnapshot(options?: unknown): Promise<string> {
		this.ariaSnapshotCalls.push(options);
		if (this.ariaSnapshotError) {
			throw this.ariaSnapshotError;
		}
		return this.ariaSnapshotValue;
	}

	mainFrame(): { waitForLoadState: () => Promise<void> } {
		return {
			waitForLoadState: () => this.loadStateError
				? Promise.reject(this.loadStateError)
				: this.loadState,
		};
	}

	async waitForFunction(): Promise<void> {
		this.waitForFunctionCalls++;
		if (this.waitForFunctionError) {
			throw this.waitForFunctionError;
		}
		await this.waitForFunctionResult;
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
			nth: index => ({
				isVisible: async () => {
					this.visibleIndices.push(index);
					return this.visible[index] ?? false;
				},
			}),
		};
	}

	async evaluate<T>(pageFunction?: unknown): Promise<T> {
		this.evaluateCalls.push(pageFunction);
		if (this.evaluateCalls.length === 1) {
			await this.render;
			return undefined as T;
		}
		this.requestListenerCountDuringSnapshot = this.listenerCount('request');
		if (this.snapshotError) {
			throw this.snapshotError;
		}
		if (this.snapshotPromise) {
			return await this.snapshotPromise as T;
		}
		return this.snapshot as T;
	}
}

interface FakeResponse {
	finished(): Promise<Error | null>;
}

interface FakeRequest {
	isNavigationRequest(): boolean;
	resourceType(): string;
	response(): Promise<FakeResponse | null>;
	timing(): { readonly responseEnd: number; readonly startTime: number };
	method(): string;
	url(): string;
	failure(): { readonly errorText: string } | null;
}

function createRequest(options: {
	readonly navigation?: boolean;
	readonly resourceType?: string;
	readonly response?: () => Promise<FakeResponse | null>;
	readonly failureText?: string;
} = {}): FakeRequest {
	return {
		isNavigationRequest: () => options.navigation ?? false,
		resourceType: () => options.resourceType ?? 'fetch',
		response: options.response ?? (async () => ({ finished: async () => null })),
		timing: () => ({ responseEnd: 1, startTime: 1_000 }),
		method: () => 'GET',
		url: () => 'https://example.com/resource',
		failure: () => options.failureText ? { errorText: options.failureText } : null,
	};
}

function createTab(page = new FakePage()): { readonly page: FakePage; readonly tab: PlaywrightTab } {
	const networkFilter: IAgentNetworkFilterService = {
		_serviceBrand: undefined,
		isUriAllowed: () => true,
		formatError: () => '',
		onDidChange: Event.None,
	};
	return {
		page,
		tab: new PlaywrightTab(page as unknown as ConstructorParameters<typeof PlaywrightTab>[0], networkFilter),
	};
}

function captureSnapshot(
	tab: PlaywrightTab,
	options: IPageSnapshotOptions | undefined,
	token = CancellationTokenNone,
): Promise<SnapshotValue> {
	const resolvedOptions = resolvePageSnapshotOptions(options);
	return tab.captureSnapshot(
		'page-1',
		resolvedOptions,
		createPageSnapshotDeadline(resolvedOptions),
		token,
	);
}

function runPageAction<T>(tab: PlaywrightTab, action: () => T | Promise<T>): Promise<T> {
	return tab.safeRunAgainstPage(
		async () => action(),
		{ waitForCompletion: true, token: CancellationTokenNone },
	);
}

interface TestPlaywrightSession {
	readonly sessionId: string;
	readonly group: {
		addView(viewId: string): Promise<{ viewId: string; targetId: string }>;
		removeView(viewId: string): Promise<void>;
	};
	navigatePage?: (...args: readonly unknown[]) => Promise<void>;
	captureSnapshot?: (...args: readonly unknown[]) => Promise<unknown>;
	getSummary?: (pageId: string) => Promise<string>;
	invokeFunctionRaw?: (pageId: string, fnDef: string, ...args: readonly unknown[]) => Promise<unknown>;
	shutdown(): Promise<void>;
}

interface TestPlaywrightServiceState {
	readonly _pendingInits: Map<string, Promise<TestPlaywrightSession>>;
	readonly _pendingInitGroups: Map<string, { destroy(): Promise<void> }>;
	readonly _sessions: { set(key: string, value: TestPlaywrightSession): void };
}

function getServiceState(service: PlaywrightService): TestPlaywrightServiceState {
	return service as unknown as TestPlaywrightServiceState;
}

function createTestSession(overrides: Partial<TestPlaywrightSession> = {}): TestPlaywrightSession {
	return {
		sessionId: 'test-session',
		group: {
			addView: async viewId => ({ viewId, targetId: `target-${viewId}` }),
			removeView: async () => {},
		},
		navigatePage: async () => {},
		shutdown: async () => {},
		...overrides,
	};
}

interface TestTrackingGroupOptions {
	readonly addView?: (viewId: string) => Promise<{ viewId: string; targetId: string }>;
	readonly removeView?: (viewId: string) => Promise<void>;
	readonly logService?: unknown;
	readonly telemetryService?: unknown;
}

function createPlaywrightServiceWithTrackingGroup(options: TestTrackingGroupOptions = {}): PlaywrightService {
	const trackingGroup = {
		id: 'tracking-group',
		onDidAddView: Event.None,
		onDidRemoveView: Event.None,
		onDidDestroy: Event.None,
		onCDPMessage: Event.None,
		addView: options.addView ?? (async (viewId: string) => ({ viewId, targetId: `target-${viewId}` })),
		removeView: options.removeView ?? (async () => {}),
		sendCDPMessage: async () => {},
		destroy: async () => {},
	};
	const remoteService = {
		createGroup: async () => trackingGroup,
	};
	return new PlaywrightService(
		1,
		remoteService as never,
		(options.logService ?? new Proxy({}, { get: () => () => {} })) as never,
		undefined as never,
		options.telemetryService as never,
	);
}

test('captureSnapshot returns an atomic main-frame HTML snapshot after readiness', async () => {
	const { page, tab } = createTab();
	const snapshot = await captureSnapshot(tab, {
		readiness: { selector: 'main article', state: 'attached', minimumCount: 1 },
	});

	assert.deepEqual(snapshot, page.snapshot);
	assert.deepEqual(page.locatorCalls, ['main article']);
	assert.equal(page.evaluateCalls.length, 2);
	const atomicSnapshotEvaluate = String(page.evaluateCalls[1]);
	assert.match(atomicSnapshotEvaluate, /location\.href/);
	assert.match(atomicSnapshotEvaluate, /document\.title/);
	assert.match(atomicSnapshotEvaluate, /documentElement.*outerHTML/);
	assert.match(atomicSnapshotEvaluate, /TextEncoder/);
});

test('captureSnapshot counts any matching visible readiness elements', async () => {
	const { page, tab } = createTab();
	page.locatorCount = 3;
	page.visible = [false, true, true];

	await captureSnapshot(tab, {
		readiness: { selector: 'article', state: 'visible', minimumCount: 2 },
	});
	assert.deepEqual(page.visibleIndices, [0, 1, 2]);
});

test('captureSnapshot rejects readiness when too few matching elements are visible or attached', async () => {
	const { page, tab } = createTab();
	page.locatorCount = 2;
	page.visible = [true, false];

	await assert.rejects(
		captureSnapshot(tab, { readiness: { selector: 'article', state: 'visible', minimumCount: 2 }, timeoutMs: 5 }),
		BrowserPageReadinessTimeoutError,
	);
	assert.equal(page.evaluateCalls.length, 0);

	page.locatorCount = 1;
	await assert.rejects(
		captureSnapshot(tab, { readiness: { selector: 'article', state: 'attached', minimumCount: 2 }, timeoutMs: 5 }),
		BrowserPageReadinessTimeoutError,
	);
});

test('captureSnapshot rejects invalid readiness selectors and invalid limits', async () => {
	const { page, tab } = createTab();
	page.locatorError = new Error('Invalid selector');

	await assert.rejects(
		captureSnapshot(tab, { readiness: { selector: '[', state: 'attached' } }),
		BrowserPageReadinessSelectorError,
	);
	assert.throws(() => resolvePageSnapshotOptions({ readiness: { selector: '' } }), BrowserPageReadinessSelectorError);
	assert.throws(() => resolvePageSnapshotOptions({ readiness: { selector: 'main', minimumCount: 0 } }), RangeError);
	assert.throws(() => resolvePageSnapshotOptions({ readiness: { selector: 'main', state: 'hidden' as never } }), RangeError);
	assert.throws(() => resolvePageSnapshotOptions({ timeoutMs: 0 }), RangeError);
	assert.throws(() => resolvePageSnapshotOptions({ timeoutMs: maximumPageSnapshotTimeoutMs + 1 }), RangeError);
	assert.throws(() => resolvePageSnapshotOptions({ maximumBytes: 0 }), RangeError);
	assert.throws(() => resolvePageSnapshotOptions({ maximumBytes: defaultPageSnapshotMaximumBytes + 1 }), RangeError);
	assert.deepEqual(resolvePageSnapshotOptions(undefined), {
		readiness: undefined,
		timeoutMs: defaultPageSnapshotTimeoutMs,
		maximumBytes: defaultPageSnapshotMaximumBytes,
	});
	assert.equal(resolvePageSnapshotOptions({ timeoutMs: maximumPageSnapshotTimeoutMs }).timeoutMs, maximumPageSnapshotTimeoutMs);
});

test('captureSnapshot rejects empty documents and UTF-8 byte-limit overflow', async () => {
	const { page, tab } = createTab();
	page.snapshot = undefined;
	await assert.rejects(captureSnapshot(tab, undefined), BrowserPageSnapshotEmptyError);

	page.snapshot = { uri: 'https://example.com/article', title: 'Example article', html: '汉' };
	await assert.rejects(
		captureSnapshot(tab, { maximumBytes: 2 }),
		BrowserPageSnapshotTooLargeError,
	);

	page.snapshot = { uri: 'https://example.com/article', title: 'Example article', tooLarge: true };
	await assert.rejects(
		captureSnapshot(tab, undefined),
		BrowserPageSnapshotTooLargeError,
	);
});

test('captureSnapshot cancels while validating a readiness selector', async () => {
	const { page, tab } = createTab();
	page.initialLocatorCount = new Promise(() => {});
	const cancellationSource = new CancellationTokenSource();
	const capture = captureSnapshot(tab, { readiness: { selector: 'main' } }, cancellationSource.token);
	cancellationSource.cancel();

	await assert.rejects(capture, /Canceled/);
	cancellationSource.dispose();
});

test('captureSnapshot cancels during a pending load-state wait without returning a snapshot', async () => {
	const { page, tab } = createTab();
	let resolveLoadState: (() => void) | undefined;
	page.loadState = new Promise(resolve => { resolveLoadState = resolve; });
	const cancellationSource = new CancellationTokenSource();
	const capture = captureSnapshot(tab, undefined, cancellationSource.token);
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
		captureSnapshot(tab, undefined),
		BrowserPageNavigationInterruptedError,
	);
	assert.equal(page.evaluateCalls.length, 0);
});

test('captureSnapshot returns the new document after navigation completes', async () => {
	const { page, tab } = createTab();
	page.snapshot = { uri: 'https://example.com/new', title: 'New document', html: '<html><body>New</body></html>' };

	assert.deepEqual(await captureSnapshot(tab, undefined), page.snapshot);
});

test('captureSnapshot maps Playwright stage timeouts to the typed readiness timeout', async () => {
	const { page, tab } = createTab();
	const timeoutError = new Error('page.waitForLoadState: Timeout 5ms exceeded.');
	timeoutError.name = 'TimeoutError';
	page.loadState = Promise.reject(timeoutError);

	await assert.rejects(
		captureSnapshot(tab, { timeoutMs: 5 }),
		BrowserPageReadinessTimeoutError,
	);

	const renderFixture = createTab();
	renderFixture.page.render = new Promise(() => {});
	await assert.rejects(
		captureSnapshot(renderFixture.tab, { timeoutMs: 5 }),
		BrowserPageReadinessTimeoutError,
	);
});

test('captureSnapshot uses one deadline across load and render stages', async () => {
	const { page, tab } = createTab();
	const originalNow = Date.now;
	let now = 1_000;
	Date.now = () => now;
	try {
		const options = resolvePageSnapshotOptions({ timeoutMs: 100 });
		const deadline = createPageSnapshotDeadline(options);
		page.loadState = {
			then: (resolve: () => void) => {
				now = 1_050;
				resolve();
			},
		} as Promise<void>;
		page.render = {
			then: (resolve: () => void) => {
				now = deadline;
				resolve();
			},
		} as Promise<void>;

		await assert.rejects(
			tab.captureSnapshot('page-1', options, deadline, CancellationTokenNone),
			BrowserPageReadinessTimeoutError,
		);
		assert.equal(page.evaluateCalls.length, 1);
	} finally {
		Date.now = originalNow;
	}
});

test('captureSnapshot cancellation discards a pending atomic evaluate result', async () => {
	const { page, tab } = createTab();
	let resolveSnapshot: ((value: SnapshotValue) => void) | undefined;
	page.snapshotPromise = new Promise(resolve => { resolveSnapshot = resolve; });
	const cancellationSource = new CancellationTokenSource();
	const capture = captureSnapshot(tab, undefined, cancellationSource.token);
	await new Promise<void>(resolve => setImmediate(resolve));
	cancellationSource.cancel();

	await assert.rejects(capture, error => isCancellationError(error));
	resolveSnapshot?.({ uri: 'https://example.com/stale', title: 'Stale', html: '<html>Stale</html>' });
	await new Promise<void>(resolve => setImmediate(resolve));
	assert.equal(page.evaluateCalls.length, 2);
	cancellationSource.dispose();
});

test('captureSnapshot maps page close, browser disconnect, and evaluate navigation interruption', async t => {
	const cases: readonly { readonly name: string; readonly message: string; readonly error: typeof BrowserPageClosedError | typeof BrowserPageNavigationInterruptedError }[] = [
		{ name: 'page close', message: 'Target page, context or browser has been closed', error: BrowserPageClosedError },
		{ name: 'browser disconnect', message: 'Browser has been closed', error: BrowserPageClosedError },
		{ name: 'navigation', message: 'Execution context was destroyed, most likely because of a navigation', error: BrowserPageNavigationInterruptedError },
	];

	for (const testCase of cases) {
		await t.test(testCase.name, async () => {
			const { page, tab } = createTab();
			page.snapshotError = new Error(testCase.message);
			await assert.rejects(captureSnapshot(tab, undefined), testCase.error);
		});
	}
});

test('captureSnapshot does not enter generic page request-completion waiting', async () => {
	const { page, tab } = createTab();
	await captureSnapshot(tab, undefined);

	assert.equal(page.requestListenerCountDuringSnapshot, 0);
});

test('getSummary remains the read-page ARIA boundary', async () => {
	const { page, tab } = createTab();
	page.titleValue = 'ARIA page';
	page.ariaSnapshotValue = '- button "Continue"';

	const summary = await tab.getSummary(true);
	assert.match(summary, /Page Title: ARIA page/);
	assert.match(summary, /Snapshot:\s+- button "Continue"/);
});

test('getSummary lazily initializes console history and exposes a sticky failure', async () => {
	const page = new FakePage();
	const historyError = new Error('console history unavailable');
	page.consoleMessagesError = historyError;
	const { tab } = createTab(page);

	assert.equal(page.consoleMessagesCalls, 0);
	await assert.rejects(tab.getSummary(true), error => error === historyError);
	await assert.rejects(tab.getSummary(true), error => error === historyError);
	assert.equal(page.consoleMessagesCalls, 1);
	assert.equal(page.pageErrorsCalls, 1);
});

test('getSummary lazily initializes page errors and exposes a sticky failure', async () => {
	const page = new FakePage();
	const pageErrorsError = new Error('page error history unavailable');
	page.pageErrorsError = pageErrorsError;
	const { tab } = createTab(page);

	assert.equal(page.consoleMessagesCalls, 0);
	assert.equal(page.pageErrorsCalls, 0);
	await assert.rejects(tab.getSummary(true), error => error === pageErrorsError);
	await assert.rejects(tab.getSummary(true), error => error === pageErrorsError);
	assert.equal(page.consoleMessagesCalls, 1);
	assert.equal(page.pageErrorsCalls, 1);
});

test('getSummary rejects a page URL that cannot be checked by network policy', async () => {
	const page = new FakePage();
	page.urlValue = 'missing-scheme.example.com';
	const { tab } = createTab(page);

	await assert.rejects(tab.getSummary(true), /Scheme is missing/);
});

test('getSummary merges overlapping history and live errors once in chronological groups', async () => {
	const page = new FakePage();
	const historicalConsole = {
		type: () => 'warning',
		timestamp: () => 100,
		text: () => 'historical warning',
	};
	const overlappingConsole = {
		type: () => 'error',
		timestamp: () => 200,
		text: () => 'overlapping error',
	};
	const laterConsole = {
		type: () => 'warning',
		timestamp: () => 300,
		text: () => 'later warning',
	};
	const overlappingPageError = new Error('overlapping page error');
	page.consoleMessagesValue = [historicalConsole, overlappingConsole];
	page.pageErrorsValue = [overlappingPageError];
	const { tab } = createTab(page);
	const livePageError = new Error(overlappingPageError.message);
	livePageError.stack = overlappingPageError.stack;
	page.emit('console', { ...overlappingConsole });
	page.emit('pageerror', livePageError);
	page.emit('console', laterConsole);
	page.emit('requestfailed', createRequest({ failureText: 'net::ERR_FAILED' }));
	page.emit('download', { suggestedFilename: () => 'article.pdf' });

	const summary = await tab.getSummary(true);

	assert.equal(summary.match(/historical warning/g)?.length, 1);
	assert.equal(summary.match(/overlapping error/g)?.length, 1);
	assert.equal(summary.match(/overlapping page error/g)?.length, 1);
	assert.equal(summary.match(/later warning/g)?.length, 1);
	assert.equal(summary.match(/net::ERR_FAILED/g)?.length, 1);
	assert.equal(summary.match(/article\.pdf/g)?.length, 1);
	assert.ok(summary.indexOf('historical warning') < summary.indexOf('later warning'));
	assert.ok(summary.indexOf('overlapping error') < summary.indexOf('later warning'));
	assert.ok(summary.indexOf('historical warning') < summary.indexOf('net::ERR_FAILED'));
	assert.ok(summary.indexOf('historical warning') < summary.indexOf('article.pdf'));
});

test('getSummary rejects an ARIA failure and retries with a full snapshot', async () => {
	const { page, tab } = createTab();
	const snapshotError = new Error('ARIA snapshot failed');
	page.ariaSnapshotError = snapshotError;

	await assert.rejects(tab.getSummary(false), error => error === snapshotError);
	page.ariaSnapshotError = undefined;
	const summary = await tab.getSummary();

	assert.match(summary, /Snapshot:\s+- article "Example article"/);
	assert.deepEqual(page.ariaSnapshotCalls, [
		{ mode: 'ai', _track: 'response' },
		{ mode: 'ai' },
	]);
});

test('getSummary rejects a title failure and retries with a full snapshot', async () => {
	const { page, tab } = createTab();
	const titleError = new Error('title failed');
	page.titleError = titleError;

	await assert.rejects(tab.getSummary(false), error => error === titleError);
	page.titleError = undefined;
	const summary = await tab.getSummary();

	assert.match(summary, /Page Title: Example article/);
	assert.deepEqual(page.ariaSnapshotCalls, [
		{ mode: 'ai', _track: 'response' },
		{ mode: 'ai' },
	]);
	assert.equal(page.titleCalls, 2);
});

test('getSummary preserves valid empty title and unchanged ARIA results', async () => {
	const { page, tab } = createTab();
	page.titleValue = '';
	page.ariaSnapshotValue = '';

	const summary = await tab.getSummary(false);

	assert.doesNotMatch(summary, /Page Title:/);
	assert.match(summary, /Snapshot: <unchanged>/);
});

test('safeRunAgainstPage rejects navigation load failures and removes its request listener', async () => {
	const { page, tab } = createTab();
	const loadError = new Error('navigation load failed');
	page.loadStateError = loadError;

	await assert.rejects(
		runPageAction(tab, () => {
			page.emit('request', createRequest({ navigation: true }));
			return 'completed';
		}),
		error => error === loadError,
	);
	assert.equal(page.listenerCount('request'), 0);
});

test('safeRunAgainstPage rejects request response failures for every completion branch', async t => {
	for (const resourceType of ['fetch', 'image']) {
		await t.test(resourceType, async () => {
			const { page, tab } = createTab();
			const responseError = new Error(`${resourceType} response failed`);

			await assert.rejects(
				runPageAction(tab, () => {
					page.emit('request', createRequest({
						resourceType,
						response: async () => { throw responseError; },
					}));
					return 'completed';
				}),
				error => error === responseError,
			);
			assert.equal(page.listenerCount('request'), 0);
		});
	}
});

test('safeRunAgainstPage accepts a failed request without a response and reports its log', async () => {
	const { page, tab } = createTab();
	const request = createRequest({
		resourceType: 'fetch',
		response: async () => null,
		failureText: 'net::ERR_FAILED',
	});

	const result = await runPageAction(tab, () => {
		page.emit('request', request);
		page.emit('requestfailed', request);
		return 'completed';
	});
	const summary = await tab.getSummary(true);

	assert.equal(result, 'completed');
	assert.match(summary, /GET request to https:\/\/example\.com\/resource failed: "net::ERR_FAILED"/);
});

test('safeRunAgainstPage rejects an error returned by response.finished', async () => {
	const { page, tab } = createTab();
	const finishedError = new Error('response body failed');

	await assert.rejects(
		runPageAction(tab, () => {
			page.emit('request', createRequest({
				resourceType: 'fetch',
				response: async () => ({ finished: async () => finishedError }),
			}));
			return 'completed';
		}),
		error => error === finishedError,
	);
});

test('safeRunAgainstPage rejects a request completion timeout', async () => {
	let markResponseRequested!: () => void;
	const responseRequested = new Promise<void>(resolve => {
		markResponseRequested = resolve;
	});
	const { page, tab } = createTab();
	const operation = runPageAction(tab, () => {
		page.emit('request', createRequest({
			resourceType: 'fetch',
			response: () => {
				markResponseRequested();
				return new Promise<FakeResponse | null>(() => {});
			},
		}));
		return 'completed';
	});

	await responseRequested;
	await assert.rejects(operation, error => error instanceof Error
		&& /timed out/i.test(error.message)
		&& /5000/.test(error.message));
});

test('dialog close observation handles page wait failures', async () => {
	const page = new FakePage();
	const observationError = new Error('dialog page closed');
	page.waitForFunctionError = observationError;
	const { tab } = createTab(page);

	page.emit('dialog', {});
	await new Promise<void>(resolve => setImmediate(resolve));

	assert.equal(page.waitForFunctionCalls, 1);
	await assert.rejects(tab.getSummary(), error => error === observationError);
});

test('getSummary reports an active dialog without replacing failed page reads with empty values', async () => {
	const page = new FakePage();
	page.waitForFunctionResult = new Promise<void>(() => {});
	const { tab } = createTab(page);
	page.emit('dialog', {
		type: () => 'alert',
		message: () => 'Confirm this action',
	});

	const summary = await tab.getSummary();

	assert.match(summary, /Active alert dialog: "Confirm this action"/);
	assert.match(summary, /Snapshot: <blocked by active dialog>/);
	assert.equal(page.ariaSnapshotCalls.length, 0);
	assert.equal(page.titleCalls, 0);
});

test('dialog interruption preserves a post-action request completion failure', async () => {
	const { page, tab } = createTab();
	let rejectResponse!: (error: Error) => void;
	const response = new Promise<FakeResponse | null>((_resolve, reject) => {
		rejectResponse = reject;
	});
	let interruption: DialogInterruptedError | undefined;
	try {
		await runPageAction(tab, () => {
			page.emit('request', createRequest({ resourceType: 'fetch', response: () => response }));
			page.emit('dialog', {});
			return 'completed';
		});
		assert.fail('Expected the dialog to interrupt the action.');
	} catch (error) {
		assert.ok(error instanceof DialogInterruptedError);
		interruption = error;
	}

	const completionError = new Error('request completion failed after interruption');
	rejectResponse(completionError);
	await assert.rejects(interruption.waitForCompletion(), error => error === completionError);
});

test('dialog interruption remains cancellable until its page action settles', async () => {
	const { page, tab } = createTab();
	page.waitForFunctionResult = new Promise<void>(() => {});
	const cancellation = new CancellationTokenSource();
	let interruption: DialogInterruptedError | undefined;
	try {
		await tab.safeRunAgainstPage(
			async () => {
				page.emit('dialog', {});
				return new Promise<void>(() => {});
			},
			{ waitForCompletion: true, token: cancellation.token },
		);
		assert.fail('Expected the dialog to interrupt the action.');
	} catch (error) {
		assert.ok(error instanceof DialogInterruptedError);
		interruption = error;
	}

	cancellation.cancel();
	await assert.rejects(interruption.waitForCompletion(), error => isCancellationError(error));
	cancellation.dispose();
});

test('dialog continuation reports each later dialog before the page action settles', async () => {
	const { page, tab } = createTab();
	let resolveAction!: (value: string) => void;
	const actionResult = new Promise<string>(resolve => { resolveAction = resolve; });
	let resolveFirstDialog!: () => void;
	page.waitForFunctionResult = new Promise<void>(resolve => { resolveFirstDialog = resolve; });
	const action = runPageAction(tab, () => actionResult);
	await new Promise<void>(resolve => setImmediate(resolve));
	page.emit('dialog', {});

	let firstInterruption: DialogInterruptedError | undefined;
	try {
		await action;
		assert.fail('Expected the first dialog to interrupt the action.');
	} catch (error) {
		assert.ok(error instanceof DialogInterruptedError);
		firstInterruption = error;
	}
	const firstContinuation = firstInterruption.waitForCompletion();
	assert.equal(firstInterruption.waitForCompletion(), firstContinuation);

	let resolveSecondDialog!: () => void;
	page.waitForFunctionResult = new Promise<void>(resolve => { resolveSecondDialog = resolve; });
	resolveFirstDialog();
	page.emit('dialog', {});

	let secondInterruption: DialogInterruptedError | undefined;
	try {
		await firstContinuation;
		assert.fail('Expected the second dialog to interrupt the continuation.');
	} catch (error) {
		assert.ok(error instanceof DialogInterruptedError);
		secondInterruption = error;
	}
	const secondContinuation = secondInterruption.waitForCompletion();
	resolveSecondDialog();
	await new Promise<void>(resolve => setImmediate(resolve));
	resolveAction('completed after dialogs');

	assert.equal(await secondContinuation, 'completed after dialogs');
});

test('PlaywrightChannel forwards IPC cancellation to lease-bound navigation and capture', async () => {
	let captureArguments: readonly unknown[] = [];
	let navigationArguments: readonly unknown[] = [];
	const channel = new PlaywrightChannel(undefined as never, undefined as never, undefined as never, undefined as never);
	const instances = (channel as unknown as {
		instances: { set(windowId: number, service: TestPlaywrightSession): void };
	}).instances;
	instances.set(7, createTestSession({
		captureSnapshot: async (...args) => {
			captureArguments = args;
			return undefined;
		},
		navigatePage: async (...args) => {
			navigationArguments = args;
		},
	}));
	const cancellationSource = new CancellationTokenSource();
	const trackingLease = { viewId: 'page-1', leaseId: 'lease-1' };

	await channel.call('test', 'navigatePage', [7, ['session-1', trackingLease, 'https://example.com']], cancellationSource.token);
	assert.equal(navigationArguments[3], cancellationSource.token);
	await channel.call('test', 'captureSnapshot', [7, ['session-1', trackingLease, undefined]], cancellationSource.token);
	assert.equal(captureArguments[3], cancellationSource.token);
	cancellationSource.dispose();
	await channel.call('test', 'disposeWindow', [7, undefined], CancellationTokenNone);
});

test('PlaywrightChannelClient addresses main-process requests and forwards snapshot cancellation', async () => {
	const calls: Array<{
		readonly command: string;
		readonly argument: unknown;
		readonly token: unknown;
	}> = [];
	const listens: Array<{ readonly event: string; readonly argument: unknown }> = [];
	const channel = {
		call: async <T>(command: string, argument: unknown, token: unknown): Promise<T> => {
			calls.push({ command, argument, token });
			if (command === 'captureSnapshot') {
				return {
					pageId: 'page-1',
					uri: URI.parse('https://example.com/article').toJSON(),
					title: 'Example article',
					html: '<html><body>Example</body></html>',
					capturedAt: 1,
				} as T;
			}
			return { viewId: 'page-2', leaseId: 'lease-1' } as T;
		},
		listen: <T>(event: string, argument: unknown): Event<T> => {
			listens.push({ event, argument });
			return Event.None;
		},
	} satisfies IChannel;
	const cancellationSource = new CancellationTokenSource();
	const mainClient = new PlaywrightChannelClient(channel, 7);
	const trackingLease = { viewId: 'page-1', leaseId: 'lease-1' };

	const snapshot = await mainClient.captureSnapshot(
		'session-1',
		trackingLease,
		{ timeoutMs: 500 },
		cancellationSource.token,
	);
	assert.deepEqual(listens, [{ event: 'onDidChangeTrackedPages', argument: [7, undefined] }]);
	assert.deepEqual(calls[0]?.argument, [7, ['session-1', trackingLease, { timeoutMs: 500 }]]);
	assert.equal(calls[0]?.token, cancellationSource.token);
	assert.equal(snapshot.uri.toString(), 'https://example.com/article');

	const workbenchClient = new PlaywrightChannelClient(channel);
	await workbenchClient.acquirePageTracking('page-2');
	assert.deepEqual(listens[1], { event: 'onDidChangeTrackedPages', argument: undefined });
	assert.deepEqual(calls[1]?.argument, ['page-2']);
	cancellationSource.dispose();
});

test('PlaywrightService rejects snapshot requests for untracked pages before creating a session', async () => {
	const service = new PlaywrightService(1, undefined as never, undefined as never, undefined as never, undefined as never);
	await assert.rejects(
		service.captureSnapshot(
			'session-1',
			{ viewId: 'untracked-page', leaseId: 'missing-lease' },
			undefined,
			CancellationTokenNone,
		),
		BrowserPageNotTrackedError,
	);
	await service.shutdown();
});

test('PlaywrightService cancellation races pending session creation', async () => {
	const service = createPlaywrightServiceWithTrackingGroup();
	const trackingLease = await service.acquirePageTracking('page-1');
	const state = getServiceState(service);
	state._pendingInits.set('session-1', new Promise(() => {}));
	const cancellationSource = new CancellationTokenSource();
	const capture = service.captureSnapshot('session-1', trackingLease, undefined, cancellationSource.token);
	cancellationSource.cancel();

	await assert.rejects(capture, error => error instanceof CancellationError);
	cancellationSource.dispose();
	state._pendingInits.delete('session-1');
	await service.shutdown();
});

test('PlaywrightService does not start snapshot work for an already-cancelled request', async () => {
	const service = createPlaywrightServiceWithTrackingGroup();
	const trackingLease = await service.acquirePageTracking('page-1');
	const state = getServiceState(service);
	let captureCalls = 0;
	state._sessions.set('session-1', createTestSession({
		captureSnapshot: async () => {
			captureCalls++;
			return undefined;
		},
	}));
	const cancellationSource = new CancellationTokenSource();
	cancellationSource.cancel();

	await assert.rejects(
		service.captureSnapshot('session-1', trackingLease, undefined, cancellationSource.token),
		error => error instanceof CancellationError,
	);
	assert.equal(captureCalls, 0);
	cancellationSource.dispose();
	await service.shutdown();
});

test('PlaywrightService applies the snapshot deadline while creating a session', async () => {
	const service = createPlaywrightServiceWithTrackingGroup();
	const trackingLease = await service.acquirePageTracking('page-1');
	const state = getServiceState(service);
	state._pendingInits.set('session-1', new Promise(() => {}));

	await assert.rejects(
		service.captureSnapshot('session-1', trackingLease, { timeoutMs: 5 }, CancellationTokenNone),
		BrowserPageReadinessTimeoutError,
	);
	state._pendingInits.delete('session-1');
	await service.shutdown();
});

test('PlaywrightService cancellation races pending page resolution and evaluate work', async () => {
	const service = createPlaywrightServiceWithTrackingGroup();
	const trackingLease = await service.acquirePageTracking('page-1');
	const state = getServiceState(service);
	state._sessions.set('session-1', createTestSession({
		captureSnapshot: async () => new Promise(() => {}),
	}));
	const cancellationSource = new CancellationTokenSource();
	const capture = service.captureSnapshot('session-1', trackingLease, undefined, cancellationSource.token);
	cancellationSource.cancel();

	await assert.rejects(capture, error => error instanceof CancellationError);
	cancellationSource.dispose();
	await service.shutdown();
});

test('PlaywrightService keeps getSummary and invokeFunctionRaw unchanged without logging snapshot HTML', async () => {
	const secretHtml = '<html><body>snapshot-secret</body></html>';
	const logEntries: string[] = [];
	const telemetryEvents: string[] = [];
	const logService = new Proxy({}, {
		get: (_target, property) => (...args: readonly unknown[]) => {
			logEntries.push(`${String(property)}:${args.map(String).join(' ')}`);
		},
	});
	const telemetryService = {
		publicLog2: (eventName: string) => { telemetryEvents.push(eventName); },
	};
	const service = createPlaywrightServiceWithTrackingGroup({ logService, telemetryService });
	const trackingLease = await service.acquirePageTracking('page-1');
	const state = getServiceState(service);
	state._sessions.set('session-1', createTestSession({
		captureSnapshot: async () => ({
			pageId: 'page-1',
			uri: URI.parse('https://example.com/article'),
			title: 'Example article',
			html: secretHtml,
			capturedAt: 1,
		}),
		getSummary: async () => 'ARIA summary',
		invokeFunctionRaw: async (_pageId, _fnDef, ...args) => args,
	}));

	const snapshot = await service.captureSnapshot('session-1', trackingLease, undefined, CancellationTokenNone);
	assert.equal(snapshot.html, secretHtml);
	assert.equal(await service.getSummary('session-1', 'page-1'), 'ARIA summary');
	assert.deepEqual(await service.invokeFunctionRaw('session-1', 'page-1', 'async page => page', 'argument'), ['argument']);
	assert.equal(logEntries.some(entry => entry.includes(secretHtml)), false);
	assert.deepEqual(telemetryEvents, []);
	await service.shutdown();
});

test('PlaywrightService serializes page tracking leases and keeps tracking until the final lease is released', async () => {
	let resolveAdd: (() => void) | undefined;
	const add = new Promise<void>(resolve => {
		resolveAdd = resolve;
	});
	const group = {
		addView: async (viewId: string) => {
			await add;
			return { viewId, targetId: `target-${viewId}` };
		},
		removeView: async () => {},
	};
	const session = {
		sessionId: 'session',
		group,
		shutdown: async () => {},
	};
	const service = createPlaywrightServiceWithTrackingGroup();
	(service as unknown as { _sessions: { set(key: string, value: typeof session): void } })._sessions.set('session', session);

	try {
		let completed = false;
		const firstAcquisition = service.acquirePageTracking('page-1').then(result => {
			completed = true;
			return result;
		});
		const secondAcquisition = service.acquirePageTracking('page-1');

		await new Promise<void>(resolve => setImmediate(resolve));
		assert.equal(completed, false);

		resolveAdd?.();
		const firstLease = await firstAcquisition;
		const secondLease = await secondAcquisition;
		assert.notEqual(firstLease.leaseId, secondLease.leaseId);
		assert.equal(firstLease.viewId, 'page-1');
		assert.equal(secondLease.viewId, 'page-1');
		assert.equal(completed, true);

		await service.releasePageTracking(firstLease);
		assert.equal(await service.isPageTracked('page-1'), true);
		await service.releasePageTracking(secondLease);
		assert.equal(await service.isPageTracked('page-1'), false);
	} finally {
		await service.shutdown();
	}
});

test('PlaywrightService prevents an old lease from operating on a recreated target with the same view ID', async () => {
	let targetGeneration = 1;
	const service = createPlaywrightServiceWithTrackingGroup({
		addView: async viewId => ({ viewId, targetId: `target-${targetGeneration}` }),
	});

	try {
		const oldLease = await service.acquirePageTracking('page-1');
		targetGeneration = 2;
		const currentLease = await service.acquirePageTracking('page-1');
		let navigateCalls = 0;
		let captureCalls = 0;
		getServiceState(service)._sessions.set('session', createTestSession({
			navigatePage: async () => {
				navigateCalls += 1;
			},
			captureSnapshot: async () => {
				captureCalls += 1;
				return {
					pageId: 'page-1',
					uri: URI.parse('https://example.com/recreated'),
					title: 'Recreated',
					html: '<html></html>',
					capturedAt: 1,
				};
			},
		}));

		await assert.rejects(
			service.navigatePage('session', oldLease, 'https://example.com/stale-navigation', CancellationTokenNone),
			BrowserPageNotTrackedError,
		);
		await assert.rejects(
			service.captureSnapshot('session', oldLease, undefined, CancellationTokenNone),
			BrowserPageNotTrackedError,
		);
		assert.equal(navigateCalls, 0);
		assert.equal(captureCalls, 0);

		await service.navigatePage('session', currentLease, 'https://example.com/recreated', CancellationTokenNone);
		const snapshot = await service.captureSnapshot('session', currentLease, undefined, CancellationTokenNone);
		assert.equal(snapshot.uri.toString(), 'https://example.com/recreated');
		assert.equal(navigateCalls, 1);
		assert.equal(captureCalls, 1);

		await service.releasePageTracking(oldLease);
		assert.equal(await service.isPageTracked('page-1'), true);

		await assert.rejects(
			service.releasePageTracking({ viewId: 'another-page', leaseId: currentLease.leaseId }),
			/does not belong/,
		);
		assert.equal(await service.isPageTracked('page-1'), true);

		await service.releasePageTracking(currentLease);
		assert.equal(await service.isPageTracked('page-1'), false);
	} finally {
		await service.shutdown();
	}
});

test('PlaywrightService rolls back tracking ownership when page registration fails', async () => {
	let addAttempts = 0;
	let removeCalls = 0;
	const group = {
		addView: async (viewId: string) => {
			addAttempts += 1;
			if (addAttempts === 1) {
				throw new Error('Registration failed');
			}
			return { viewId, targetId: `target-${viewId}` };
		},
		removeView: async () => { removeCalls += 1; },
	};
	const session = {
		sessionId: 'session',
		group,
		shutdown: async () => {},
	};
	const service = createPlaywrightServiceWithTrackingGroup();
	(service as unknown as { _sessions: { set(key: string, value: typeof session): void } })._sessions.set('session', session);

	try {
		await assert.rejects(service.acquirePageTracking('page-1'), /Registration failed/);
		assert.equal(await service.isPageTracked('page-1'), false);
		assert.equal(removeCalls, 1);

		const lease = await service.acquirePageTracking('page-1');
		assert.equal(lease.viewId, 'page-1');
		assert.equal(await service.isPageTracked('page-1'), true);
		await service.releasePageTracking(lease);
		assert.equal(await service.isPageTracked('page-1'), false);
	} finally {
		await service.shutdown();
	}
});

test('PlaywrightService repairs partial session membership before issuing another lease', async () => {
	let firstSessionAddCalls = 0;
	let secondSessionAddCalls = 0;
	let firstSessionRemoveCalls = 0;
	const firstSession = {
		sessionId: 'first',
		group: {
			addView: async (viewId: string) => {
				firstSessionAddCalls += 1;
				return { viewId, targetId: `target-${viewId}` };
			},
			removeView: async () => {
				firstSessionRemoveCalls += 1;
				if (firstSessionRemoveCalls === 1) {
					throw new Error('Removal failed');
				}
			},
		},
		shutdown: async () => {},
	};
	const secondSession = {
		sessionId: 'second',
		group: {
			addView: async (viewId: string) => {
				secondSessionAddCalls += 1;
				return { viewId, targetId: `target-${viewId}` };
			},
			removeView: async () => {},
		},
		shutdown: async () => {},
	};
	const service = createPlaywrightServiceWithTrackingGroup();
	const sessions = (service as unknown as {
		_sessions: { set(key: string, value: TestPlaywrightSession): void };
	})._sessions;
	sessions.set('first', firstSession);
	sessions.set('second', secondSession);

	try {
		const firstLease = await service.acquirePageTracking('page-1');
		await assert.rejects(service.releasePageTracking(firstLease), /Removal failed/);
		assert.equal(await service.isPageTracked('page-1'), true);

		const secondLease = await service.acquirePageTracking('page-1');
		assert.equal(firstSessionAddCalls, 2);
		assert.equal(secondSessionAddCalls, 2);
		await service.releasePageTracking(firstLease);
		assert.equal(await service.isPageTracked('page-1'), true);
		await service.releasePageTracking(secondLease);
		assert.equal(await service.isPageTracked('page-1'), false);
	} finally {
		await service.shutdown();
	}
});

test('PlaywrightService clears local ownership when acquisition rollback also fails', async () => {
	let addCalls = 0;
	let removeCalls = 0;
	const session = {
		sessionId: 'session',
		group: {
			addView: async (viewId: string) => {
				addCalls += 1;
				if (addCalls === 1) {
					throw new Error('Registration failed');
				}
				return { viewId, targetId: `target-${viewId}` };
			},
			removeView: async () => {
				removeCalls += 1;
				if (removeCalls === 1) {
					throw new Error('Rollback failed');
				}
			},
		},
		shutdown: async () => {},
	};
	const service = createPlaywrightServiceWithTrackingGroup();
	(service as unknown as {
		_sessions: { set(key: string, value: TestPlaywrightSession): void };
	})._sessions.set('session', session);

	try {
		await assert.rejects(
			service.acquirePageTracking('page-1'),
			error => error instanceof AggregateError
				&& error.errors.some(candidate => String(candidate).includes('Registration failed'))
				&& error.errors.some(candidate => String(candidate).includes('Rollback failed')),
		);
		assert.equal(await service.isPageTracked('page-1'), false);

		const lease = await service.acquirePageTracking('page-1');
		await service.releasePageTracking(lease);
		assert.equal(await service.isPageTracked('page-1'), false);
	} finally {
		await service.shutdown();
	}
});
