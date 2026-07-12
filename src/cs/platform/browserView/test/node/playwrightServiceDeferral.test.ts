/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { Emitter, Event } from 'cs/base/common/event';
import { PlaywrightService } from 'cs/platform/browserView/node/playwrightService';

const SESSION_ID = 'playwright-deferral-test';
const PAGE_ID = 'page-1';

interface TestDeferred<T> {
	readonly promise: Promise<T>;
	resolve(value: T): void;
	reject(error: unknown): void;
}

function createDeferred<T>(): TestDeferred<T> {
	let settled = false;
	let resolvePromise!: (value: T) => void;
	let rejectPromise!: (error: unknown) => void;
	const promise = new Promise<T>((resolve, reject) => {
		resolvePromise = resolve;
		rejectPromise = reject;
	});
	return {
		promise,
		resolve: value => {
			if (!settled) {
				settled = true;
				resolvePromise(value);
			}
		},
		reject: error => {
			if (!settled) {
				settled = true;
				rejectPromise(error);
			}
		},
	};
}

type TestListener = (...args: unknown[]) => void;

class TestEventTarget {
	private readonly listeners = new Map<string, Set<TestListener>>();

	on(event: string, listener: TestListener): this {
		let eventListeners = this.listeners.get(event);
		if (!eventListeners) {
			eventListeners = new Set();
			this.listeners.set(event, eventListeners);
		}
		eventListeners.add(listener);
		return this;
	}

	once(event: string, listener: TestListener): this {
		const wrapped: TestListener = (...args) => {
			this.off(event, wrapped);
			listener(...args);
		};
		return this.on(event, wrapped);
	}

	off(event: string, listener: TestListener): this {
		this.listeners.get(event)?.delete(listener);
		return this;
	}

	protected emit(event: string, ...args: unknown[]): void {
		for (const listener of [...(this.listeners.get(event) ?? [])]) {
			listener(...args);
		}
	}
}

interface TestViewEvent {
	readonly viewId: string;
	readonly targetId: string;
}

interface TestViewRemovalEvent extends TestViewEvent {
	readonly reason: 'detached' | 'closed';
}

class TestBrowserViewGroup {
	private readonly didAddViewEmitter = new Emitter<TestViewEvent>();
	private readonly didRemoveViewEmitter = new Emitter<TestViewRemovalEvent>();
	private readonly didDestroyEmitter = new Emitter<void>();
	private readonly cdpMessageEmitter = new Emitter<never>();
	private destroyed = false;

	readonly onDidAddView = this.didAddViewEmitter.event;
	readonly onDidRemoveView = this.didRemoveViewEmitter.event;
	readonly onDidDestroy = this.didDestroyEmitter.event;
	readonly onCDPMessage = this.cdpMessageEmitter.event;

	constructor(readonly id: string) {}

	fireDidAddView(viewId: string): void {
		this.didAddViewEmitter.fire({ viewId, targetId: `target-${viewId}` });
	}

	async addView(viewId: string): Promise<TestViewEvent> {
		return { viewId, targetId: `target-${viewId}` };
	}

	async removeView(): Promise<void> {}

	async sendCDPMessage(): Promise<void> {}

	async destroy(): Promise<void> {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;
		this.didDestroyEmitter.fire();
		this.didAddViewEmitter.dispose();
		this.didRemoveViewEmitter.dispose();
		this.didDestroyEmitter.dispose();
		this.cdpMessageEmitter.dispose();
	}
}

interface SummaryBlock {
	readonly started: TestDeferred<void>;
	readonly completion: TestDeferred<void>;
}

class TestDialog {
	constructor(private readonly page: TestPage) {}

	type(): string {
		return 'alert';
	}

	message(): string {
		return 'Continue deferred operation?';
	}

	async accept(): Promise<void> {
		this.page.completeDialogOperation();
	}

	async dismiss(): Promise<void> {
		this.page.completeDialogOperation();
	}
}

class TestPage extends TestEventTarget {
	readonly operation = createDeferred<unknown>();
	summaryError: Error | undefined;
	private dialogCompletion: TestDeferred<string> | undefined;
	private dialogClosed: TestDeferred<void> | undefined;
	private remainingDialogs = 0;
	private summaryBlock: SummaryBlock | undefined;
	private closed = false;

	constructor(private readonly browserContext: TestBrowserContext) {
		super();
	}

	context(): TestBrowserContext {
		return this.browserContext;
	}

	setDefaultTimeout(): void {}

	url(): string {
		return 'about:blank';
	}

	async consoleMessages(): Promise<readonly never[]> {
		return [];
	}

	async pageErrors(): Promise<readonly Error[]> {
		return [];
	}

	async ariaSnapshot(): Promise<string> {
		const block = this.summaryBlock;
		if (block) {
			block.started.resolve(undefined);
			await block.completion.promise;
		}
		if (this.summaryError) {
			throw this.summaryError;
		}
		return '- document "Playwright service test"';
	}

	async title(): Promise<string> {
		return 'Playwright service test';
	}

	mainFrame(): { waitForLoadState(): Promise<void> } {
		return { waitForLoadState: async () => {} };
	}

	waitForFunction(): Promise<void> {
		return this.dialogClosed?.promise ?? Promise.resolve();
	}

	runOperation(): Promise<unknown> {
		return this.operation.promise;
	}

	runDialogOperation(): Promise<string> {
		return this._startDialogOperation(1, true);
	}

	runRepeatedDialogOperation(): Promise<string> {
		return this._startDialogOperation(2, true);
	}

	runDelayedDialogOperation(): Promise<string> {
		return this._startDialogOperation(1, false);
	}

	openDelayedDialog(): void {
		if (!this.dialogCompletion || this.remainingDialogs !== 1 || this.dialogClosed) {
			throw new Error('Delayed dialog operation is not ready.');
		}
		this._openDialog();
	}

	private _startDialogOperation(dialogCount: number, openImmediately: boolean): Promise<string> {
		this.dialogCompletion = createDeferred<string>();
		this.remainingDialogs = dialogCount;
		if (openImmediately) {
			this._openDialog();
		}
		return this.dialogCompletion.promise;
	}

	private _openDialog(): void {
		this.dialogClosed = createDeferred<void>();
		this.emit('dialog', new TestDialog(this));
	}

	completeDialogOperation(): void {
		this.dialogClosed?.resolve(undefined);
		this.dialogClosed = undefined;
		this.remainingDialogs--;
		if (this.remainingDialogs > 0) {
			this._openDialog();
			return;
		}
		this.dialogCompletion?.resolve('dialog-completed');
	}

	blockNextSummary(): SummaryBlock {
		const block: SummaryBlock = {
			started: createDeferred<void>(),
			completion: createDeferred<void>(),
		};
		this.summaryBlock = block;
		return block;
	}

	isClosed(): boolean {
		return this.closed;
	}

	async close(): Promise<void> {
		this.closeFromBrowser(new Error('Page closed.'));
	}

	closeFromBrowser(error: Error): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		this.summaryBlock?.completion.reject(error);
		this.emit('close');
	}
}

class TestBrowserContext extends TestEventTarget {
	private readonly browserPages: TestPage[] = [];
	private closed = false;

	constructor(private readonly sessionGroup: TestBrowserViewGroup) {
		super();
	}

	pages(): readonly TestPage[] {
		return this.browserPages;
	}

	async newPage(): Promise<TestPage> {
		if (this.closed) {
			throw new Error('Browser context is closed.');
		}
		const page = new TestPage(this);
		this.browserPages.push(page);
		this.emit('page', page);
		this.sessionGroup.fireDidAddView(PAGE_ID);
		return page;
	}

	closeFromBrowser(error: Error): void {
		if (this.closed) {
			return;
		}
		this.closed = true;
		for (const page of this.browserPages) {
			page.closeFromBrowser(error);
		}
		this.emit('close');
	}
}

class TestBrowser extends TestEventTarget {
	private readonly browserContexts: TestBrowserContext[] = [];
	private closed = false;

	constructor(private readonly sessionGroup: TestBrowserViewGroup) {
		super();
	}

	contexts(): readonly TestBrowserContext[] {
		return this.browserContexts;
	}

	async newContext(): Promise<TestBrowserContext> {
		if (this.closed) {
			throw new Error('Browser is closed.');
		}
		const context = new TestBrowserContext(this.sessionGroup);
		this.browserContexts.push(context);
		return context;
	}

	get page(): TestPage | undefined {
		return this.browserContexts[0]?.pages()[0];
	}

	async close(): Promise<void> {
		if (this.closed) {
			return;
		}
		this.closed = true;
		const closeError = new Error('Browser closed during page summary.');
		for (const context of this.browserContexts) {
			context.closeFromBrowser(closeError);
		}
	}
}

interface TestHarness {
	readonly service: PlaywrightService;
	readonly page: TestPage;
	readonly pageId: string;
	dispose(): Promise<void>;
}

function requireSummary(result: { readonly summary?: string }): string {
	if (typeof result.summary !== 'string') {
		assert.fail('Expected a successful page summary.');
	}
	return result.summary;
}

async function createHarness(): Promise<TestHarness> {
	const sessionGroup = new TestBrowserViewGroup('session-group');
	const trackingGroup = new TestBrowserViewGroup('tracking-group');
	const browser = new TestBrowser(sessionGroup);
	const remoteService = {
		createGroup: async (owner: { readonly sessionId?: string }) => owner.sessionId === 'playwright:page-tracking'
			? trackingGroup
			: sessionGroup,
	};
	const logService = {
		debug: () => {},
		info: () => {},
		error: () => {},
	};
	const networkFilterService = {
		_serviceBrand: undefined,
		isUriAllowed: () => true,
		formatError: () => '',
		onDidChange: Event.None,
	};
	const telemetryService = {
		publicLog2: () => {},
	};
	const service = new PlaywrightService(
		1,
		remoteService as never,
		logService as never,
		networkFilterService as never,
		telemetryService as never,
	);

	const mutableChromium = chromium as unknown as {
		connectOverCDP: (...args: unknown[]) => Promise<unknown>;
	};
	const originalConnectOverCDP = mutableChromium.connectOverCDP;
	mutableChromium.connectOverCDP = async () => browser;
	let openedPage: { readonly pageId: string };
	try {
		openedPage = await service.openPage(SESSION_ID, 'about:blank');
	} catch (error) {
		await service.shutdown();
		throw error;
	} finally {
		mutableChromium.connectOverCDP = originalConnectOverCDP;
	}

	const page = browser.page;
	assert.ok(page);
	return {
		service,
		page,
		pageId: openedPage.pageId,
		dispose: () => service.shutdown(),
	};
}

test('PlaywrightService preserves deferred ownership across summary errors, polling, and terminal consumption', { timeout: 5_000 }, async () => {
	const harness = await createHarness();
	try {
		harness.page.summaryError = new Error('summary unavailable');
		const initial = await harness.service.invokeFunction(
			SESSION_ID,
			harness.pageId,
			'async page => page.runOperation()',
			[],
			5,
		);
		const deferredResultId = initial.deferredResultId;
		assert.ok(deferredResultId);
		assert.equal(initial.summaryError, 'summary unavailable');

		const pollSummary = harness.page.blockNextSummary();
		const activePoll = harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 0);
		await pollSummary.started.promise;
		await assert.rejects(
			harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 1),
			/already being awaited/,
		);
		pollSummary.completion.resolve(undefined);
		const polled = await activePoll;
		assert.equal(polled.deferredResultId, deferredResultId);
		assert.equal(polled.summaryError, 'summary unavailable');

		harness.page.summaryError = undefined;
		harness.page.operation.resolve('operation-completed');
		const terminal = await harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 0);
		assert.equal(terminal.result, 'operation-completed');
		assert.equal(terminal.deferredResultId, undefined);
		assert.match(requireSummary(terminal), /Playwright service test/);
		await assert.rejects(
			harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 1),
			/No deferred result found/,
		);
	} finally {
		await harness.dispose();
	}
});

test('PlaywrightService consumes a dialog continuation that completed after the initial timeout', { timeout: 5_000 }, async () => {
	const harness = await createHarness();
	try {
		const initial = await harness.service.invokeFunction(
			SESSION_ID,
			harness.pageId,
			'async page => page.runDelayedDialogOperation()',
			[],
			0,
		);
		const deferredResultId = initial.deferredResultId;
		assert.ok(deferredResultId);

		harness.page.openDelayedDialog();
		await harness.service.replyToDialog(SESSION_ID, harness.pageId, true);
		const terminal = await harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 100);
		assert.equal(terminal.result, 'dialog-completed');
		assert.equal(terminal.deferredResultId, undefined);
	} finally {
		await harness.dispose();
	}
});

test('PlaywrightService preserves one deferred ID across consecutive dialogs', { timeout: 5_000 }, async () => {
	const harness = await createHarness();
	try {
		const initial = await harness.service.invokeFunction(
			SESSION_ID,
			harness.pageId,
			'async page => page.runRepeatedDialogOperation()',
			[],
		);
		const deferredResultId = initial.deferredResultId;
		assert.ok(deferredResultId);

		await assert.rejects(
			harness.service.replyToDialog(SESSION_ID, harness.pageId, true),
			/Action was interrupted by a dialog/,
		);
		const secondDialog = await harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 100);
		assert.equal(secondDialog.deferredResultId, deferredResultId);
		assert.ok(secondDialog.summary);
		assert.match(secondDialog.summary, /Active alert dialog/);

		await harness.service.replyToDialog(SESSION_ID, harness.pageId, true);
		const terminal = await harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 100);
		assert.equal(terminal.result, 'dialog-completed');
		assert.equal(terminal.deferredResultId, undefined);
	} finally {
		await harness.dispose();
	}
});

test('PlaywrightService consumes a rejected deferred operation and deletes its ID', { timeout: 5_000 }, async () => {
	const harness = await createHarness();
	try {
		const initial = await harness.service.invokeFunction(
			SESSION_ID,
			harness.pageId,
			'async page => page.runOperation()',
			[],
			0,
		);
		const deferredResultId = initial.deferredResultId;
		assert.ok(deferredResultId);

		harness.page.operation.reject(new Error('controlled operation failure'));
		const terminal = await harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 0);
		assert.equal(terminal.error, 'controlled operation failure');
		assert.equal(terminal.deferredResultId, undefined);
		await assert.rejects(
			harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 0),
			/No deferred result found/,
		);
	} finally {
		await harness.dispose();
	}
});

test('PlaywrightService defers a no-timeout dialog and returns its terminal result after reply', { timeout: 5_000 }, async () => {
	const harness = await createHarness();
	try {
		const initial = await harness.service.invokeFunction(
			SESSION_ID,
			harness.pageId,
			'async page => page.runDialogOperation()',
			[],
		);
		const deferredResultId = initial.deferredResultId;
		assert.ok(deferredResultId);
		assert.match(requireSummary(initial), /Active alert dialog/);

		await harness.service.replyToDialog(SESSION_ID, harness.pageId, true);
		const terminal = await harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 100);
		assert.equal(terminal.result, 'dialog-completed');
		assert.equal(terminal.deferredResultId, undefined);
		assert.match(requireSummary(terminal), /Playwright service test/);
	} finally {
		await harness.dispose();
	}
});

test('PlaywrightService does not return a deferred ID invalidated by shutdown during a wait summary', { timeout: 5_000 }, async () => {
	const harness = await createHarness();
	try {
		const initial = await harness.service.invokeFunction(
			SESSION_ID,
			harness.pageId,
			'async page => page.runOperation()',
			[],
			5,
		);
		const deferredResultId = initial.deferredResultId;
		assert.ok(deferredResultId);

		const summaryBlock = harness.page.blockNextSummary();
		const wait = harness.service.waitForDeferredResult(SESSION_ID, deferredResultId, 5);
		await summaryBlock.started.promise;
		const shutdown = harness.service.shutdown();
		await assert.rejects(wait, /shutting down|Canceled/);
		await shutdown;
	} finally {
		await harness.dispose();
	}
});

test('PlaywrightService does not return a deferred ID invalidated by shutdown during the initial summary', { timeout: 5_000 }, async () => {
	const harness = await createHarness();
	try {
		const summaryBlock = harness.page.blockNextSummary();
		const invocation = harness.service.invokeFunction(
			SESSION_ID,
			harness.pageId,
			'async page => page.runOperation()',
			[],
			0,
		);
		await summaryBlock.started.promise;
		const shutdown = harness.service.shutdown();
		await assert.rejects(invocation, /shutting down|Canceled/);
		await shutdown;
	} finally {
		await harness.dispose();
	}
});
