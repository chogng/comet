/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import type * as playwright from 'playwright-core';
import { Emitter, Event } from 'cs/base/common/event';
import { CancellationError, CancellationToken, CancellationTokenNone } from 'cs/base/common/cancellation';
import { createCancelablePromise, raceCancellablePromises, timeout } from 'cs/base/common/async';
import { URI } from 'cs/base/common/uri';
import { IAgentNetworkFilterService } from 'cs/platform/networkFilter/common/networkFilterService';
import {
	BrowserPageReadinessSelectorError,
	BrowserPageReadinessTimeoutError,
	BrowserPageSnapshotEmptyError,
	BrowserPageSnapshotTooLargeError,
	defaultPageSnapshotMaximumBytes,
	defaultPageSnapshotTimeoutMs,
	IPageSnapshotOptions,
	maximumPageSnapshotTimeoutMs,
} from 'cs/platform/browserView/common/playwrightService';
import { IPlaywrightActionScope } from 'cs/platform/browserView/node/playwrightService';

type IAiAriaSnapshotOptions = NonNullable<Parameters<playwright.Locator['ariaSnapshot']>[0]> & { _track?: string };

interface IPageSnapshotCapture {
	readonly uri: string;
	readonly title: string;
	readonly html: string;
}

interface IPageSnapshotTooLarge {
	readonly uri: string;
	readonly title: string;
	readonly tooLarge: true;
}

interface IResolvedReadiness {
	readonly selector: string;
	readonly state: 'attached' | 'visible';
	readonly minimumCount: number;
}

interface IResolvedSnapshotOptions {
	readonly readiness: IResolvedReadiness | undefined;
	readonly timeoutMs: number;
	readonly maximumBytes: number;
}

declare module 'playwright-core' {
	interface Page {
		// We defined this here to be able to use the unofficial `_track` option
		ariaSnapshot(options?: IAiAriaSnapshotOptions): Promise<string>;
	}
}

function resolveSnapshotOptions(options: IPageSnapshotOptions | undefined): IResolvedSnapshotOptions {
	const timeoutMs = options?.timeoutMs ?? defaultPageSnapshotTimeoutMs;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > maximumPageSnapshotTimeoutMs) {
		throw new RangeError(`Snapshot timeout must be greater than zero and no greater than ${maximumPageSnapshotTimeoutMs} ms.`);
	}
	const maximumBytes = options?.maximumBytes ?? defaultPageSnapshotMaximumBytes;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > defaultPageSnapshotMaximumBytes) {
		throw new RangeError(`Snapshot maximum bytes must be a positive integer no greater than ${defaultPageSnapshotMaximumBytes}.`);
	}
	if (!options?.readiness) {
		return { timeoutMs, maximumBytes, readiness: undefined };
	}
	const readiness = options.readiness;
	if (!readiness.selector.trim()) {
		throw new BrowserPageReadinessSelectorError(readiness.selector, new Error('Readiness selector must not be empty.'));
	}
	const minimumCount = readiness.minimumCount ?? 1;
	if (!Number.isSafeInteger(minimumCount) || minimumCount <= 0) {
		throw new RangeError('Snapshot readiness minimum count must be a positive integer.');
	}
	return {
		timeoutMs,
		maximumBytes,
		readiness: { selector: readiness.selector, state: readiness.state ?? 'attached', minimumCount },
	};
}

function isInvalidSelectorError(error: unknown): boolean {
	return error instanceof Error && /Invalid selector|SyntaxError|Unexpected token/i.test(error.message);
}

/**
 * Thrown when a dialog (alert, confirm, prompt) opens while a page action is
 * running. The caller should defer the underlying promise and let the agent
 * handle the dialog before retrying.
 */
export class DialogInterruptedError extends Error {
	constructor() {
		super('Action was interrupted by a dialog');
		this.name = 'DialogInterruptedError';
	}
}

/**
 * Wrapper around a Playwright page that tracks additional state like active dialogs and recent console messages,
 * and can produce a summary of the page's current state for use in tools.
 *
 * Loosely based on https://github.com/microsoft/playwright/blob/main/packages/playwright/src/mcp/browser/tab.ts.
 */
export class PlaywrightTab {
	private _onDialogStateChanged = new Emitter<void>();

	private _dialog: playwright.Dialog | undefined;
	private _fileChooser: playwright.FileChooser | undefined;
	private _logs: { type: string; time: number; description: string }[] = [];
	private _needsFullSnapshot = false;

	private _initialized: Promise<void>;

	constructor(
		/**
		 * @deprecated prefer accessing the page via safeRunAgainstPage.
		 * Only use this directly if you are sure it cannot be blocked by dialogs.
		 */
		private readonly page: playwright.Page,
		private readonly actionScope: IPlaywrightActionScope,
		private readonly agentNetworkFilterService: IAgentNetworkFilterService,
	) {
		page.on('console', event => this._handleConsoleMessage(event))
			.on('pageerror', error => this._handlePageError(error))
			.on('requestfailed', request => this._handleRequestFailed(request))
			.on('dialog', dialog => this._handleDialog(dialog))
			.on('download', download => this._handleDownload(download));

		this._initialized = this._initialize();
	}

	private async _initialize() {
		const messages = await this.page.consoleMessages().catch(() => []);
		for (const message of messages) { this._handleConsoleMessage(message); }
		const errors = await this.page.pageErrors().catch(() => []);
		for (const error of errors) { this._handlePageError(error); }
	}

	private _handleDialog(dialog: playwright.Dialog) {
		this._dialog = dialog;
		// Playwright doesn't give us an event for when a dialog is closed, so we run a no-op script to know when it closes.
		this.page.waitForFunction(() => true, undefined, { timeout: 0 }).then(() => {
			if (this._dialog === dialog) {
				this._dialog = undefined;
				this._onDialogStateChanged.fire();
			}
		});
		this._onDialogStateChanged.fire();
	}

	async replyToDialog(accept?: boolean, promptText?: string) {
		if (!this._dialog) {
			throw new Error('No active modal dialog to respond to');
		}
		const dialog = this._dialog;
		this._dialog = undefined;
		this._onDialogStateChanged.fire();
		await this.safeRunAgainstPage(async () => {
			if (accept) {
				await dialog.accept(promptText);
			} else {
				await dialog.dismiss();
			}
		});
	}

	private _handleFileChooser(chooser: playwright.FileChooser) {
		this._fileChooser = chooser;
	}

	async replyToFileChooser(files: string[]) {
		if (!this._fileChooser) {
			throw new Error('No active file chooser dialog to respond to');
		}
		const chooser = this._fileChooser;
		this._fileChooser = undefined;
		await this.safeRunAgainstPage(() => chooser.setFiles(files));
	}

	private async _handleDownload(download: playwright.Download) {
		this._logs.push({ type: 'download', time: Date.now(), description: `${download.suggestedFilename()}` });
	}

	private _handleRequestFailed(request: playwright.Request) {
		const timing = request.timing();
		this._logs.push({ type: 'requestFailed', time: timing.responseEnd + timing.startTime, description: `${request.method()} request to ${request.url()} failed: "${request.failure()?.errorText}"` });
	}

	private _handleConsoleMessage(message: playwright.ConsoleMessage) {
		if (message.type() === 'error' || message.type() === 'warning') {
			this._logs.push({ type: 'console', time: message.timestamp(), description: `[${message.type()}] ${message.text()}` });
		}
	}

	private _handlePageError(error: Error) {
		this._logs.push({ type: 'pageError', time: Date.now(), description: error.stack ?? error.message });
	}

	/**
	 * Returns a blocked-by-policy error message if the current page URL is
	 * denied by the network filter, or `undefined` if the URL is allowed.
	 */
	private _getBlockedURLErrorMessage(): string | undefined {
		const url = this.page.url();
		if (!url || url === 'about:blank') {
			return undefined;
		}
		let uri: URI | undefined;
		try { uri = URI.parse(url); } catch { }
		if (uri && !this.agentNetworkFilterService.isUriAllowed(uri)) {
			return this.agentNetworkFilterService.formatError(uri);
		}
		return undefined;
	}

	/**
	 * Run a callback against the page and wait for it to complete.
	 *
	 * Because dialogs pause the page, execution races against any dialog that opens -- if a dialog
	 * appears before the callback finishes, the method throws so the caller can surface it to the agent.
	 *
	 * Also allows for interactions to be handled differently when triggered by agents.
	 * E.g. file dialogs should appear when the user triggers one, but not when the agent does.
	 */
	async safeRunAgainstPage<T>(action: (page: playwright.Page, token: CancellationToken) => Promise<T>): Promise<T> {
		if (this._dialog) {
			throw new Error(`Cannot perform action while a dialog is open`);
		}

		// Block agent actions when the current page URL is on the deny list.
		const blockedError = this._getBlockedURLErrorMessage();
		if (blockedError) {
			throw new Error(blockedError);
		}

		let actionDidComplete = false;
		let result: T | void;
		const dialogOpened = new Promise<void>(resolve => Event.once(this._onDialogStateChanged.event)(() => resolve()));
		const actionCompleted = createCancelablePromise(async (token) => {

			// Whenever the page has a `filechooser` handler, the default file chooser is disabled.
			// We don't want this during normal user interactions, but we do for agentic interactions.
			// So we add a handler just during the action, and remove it afterwards.
			// This isn't perfect (e.g. the user could trigger it while an action is running), but it's a best effort.
			const handleFileChooser = (chooser: playwright.FileChooser) => this._handleFileChooser(chooser);
			this.page.on('filechooser', handleFileChooser);

			try {
				this.actionScope.activeCalls++;
				result = await this.runAndWaitForCompletion((token) => action(this.page, token), token);
				actionDidComplete = true;
			} finally {
				this.page.off('filechooser', handleFileChooser);
				this.actionScope.activeCalls--;
			}
		});

		return raceCancellablePromises([dialogOpened, actionCompleted]).then(() => {
			if (!actionDidComplete) {
				// A dialog was opened before the action completed. Note we don't cancel the action, just ignore its result.
				throw new DialogInterruptedError();
			}
			return result!;
		});
	}

	async getSummary(full = this._needsFullSnapshot): Promise<string> {
		await this._initialized;

		// When the current page URL is blocked by network policy, return only a
		// policy error — do not expose title, URL, console logs, or snapshot to
		// avoid prompt-injection via blocked content.
		const blockedError = this._getBlockedURLErrorMessage();
		if (blockedError) {
			return blockedError;
		}

		if (full && this._needsFullSnapshot) {
			this._needsFullSnapshot = false;
		}

		const snapshotFromPage = await this.safeRunAgainstPage((page) => this.getAiSnapshot(page, full)).catch(() => {
			this._needsFullSnapshot = true;
			return undefined;
		});
		const title = await this.safeRunAgainstPage((page) => page.title()).catch(() => '');

		const logs = this._logs;
		this._logs = [];

		const snapshot = snapshotFromPage?.trim() ?? '';

		return [
			...(title ? [`Page Title: ${title}`] : []),
			`URL: ${this.page.url()}`,
			...(this._dialog ? [`Active ${this._dialog.type()} dialog: "${this._dialog.message()}"`] : []),
			...(this._fileChooser ? [`Active file chooser dialog`] : []),
			...(logs.length > 0 ? [
				`Recent events:`,
				...logs.map(log => `- [${new Date(log.time).toISOString()}] (${log.type}) ${log.description}`)
			] : []),
			`Snapshot: ${snapshotFromPage !== undefined ? snapshot ? `\n${snapshot}` : '<unchanged>' : '<unavailable>'}`,
		].join('\n');
	}

	async captureSnapshot(pageId: string, options: IPageSnapshotOptions | undefined, token: CancellationToken): Promise<IPageSnapshotCapture> {
		const resolved = resolveSnapshotOptions(options);
		const deadline = Date.now() + resolved.timeoutMs;
		this._throwIfCancelled(token);
		return this.safeRunAgainstPage(async page => {
			await this._awaitSnapshotStage(page.mainFrame().waitForLoadState('domcontentloaded', { timeout: this._remainingTimeout(deadline, resolved) }), deadline, resolved, token);
			if (resolved.readiness) {
				await this._waitForReadiness(page, deadline, resolved, token);
			}
			await this._awaitSnapshotStage(page.evaluate(() => new Promise<void>(resolve => globalThis.requestAnimationFrame(() => resolve()))), deadline, resolved, token);
			const snapshot = await this._awaitSnapshotStage(page.evaluate((maximumBytes: number): IPageSnapshotCapture | IPageSnapshotTooLarge | undefined => {
				const documentElement = globalThis.document.documentElement;
				if (!documentElement) {
					return undefined;
				}
				const html = documentElement.outerHTML;
				if (new TextEncoder().encode(html).byteLength > maximumBytes) {
					return { uri: globalThis.location.href, title: globalThis.document.title, tooLarge: true };
				}
				return { uri: globalThis.location.href, title: globalThis.document.title, html };
			}, resolved.maximumBytes), deadline, resolved, token);
			this._throwIfCancelled(token);
			if (!snapshot) {
				throw new BrowserPageSnapshotEmptyError(pageId);
			}
			if ('tooLarge' in snapshot) {
				throw new BrowserPageSnapshotTooLargeError(resolved.maximumBytes);
			}
			if (Buffer.byteLength(snapshot.html, 'utf8') > resolved.maximumBytes) {
				throw new BrowserPageSnapshotTooLargeError(resolved.maximumBytes);
			}
			return snapshot;
		});
	}

	private async _waitForReadiness(page: playwright.Page, deadline: number, options: IResolvedSnapshotOptions, token: CancellationToken): Promise<void> {
		const readiness = options.readiness!;
		const locator = page.locator(readiness.selector);
		try {
			await this._awaitSnapshotStage(locator.count(), deadline, options, token);
		} catch (error) {
			if (isInvalidSelectorError(error)) {
				throw new BrowserPageReadinessSelectorError(readiness.selector, error);
			}
			throw error;
		}
		while (true) {
			this._throwIfCancelled(token);
			const count = await this._awaitSnapshotStage(locator.count(), deadline, options, token);
			let ready = count >= readiness.minimumCount;
			if (ready && readiness.state === 'visible') {
				for (let index = 0; index < readiness.minimumCount; index++) {
					if (!await this._awaitSnapshotStage(locator.nth(index).isVisible(), deadline, options, token)) {
						ready = false;
						break;
					}
				}
			}
			if (ready) {
				return;
			}
			await this._awaitSnapshotStage(new Promise<void>(resolve => setTimeout(resolve, Math.min(100, this._remainingTimeout(deadline, options)))), deadline, options, token);
		}
	}

	private _awaitSnapshotStage<T>(promise: Promise<T>, deadline: number, options: IResolvedSnapshotOptions, token: CancellationToken): Promise<T> {
		if (token.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const remaining = this._remainingTimeout(deadline, options);
		return new Promise<T>((resolve, reject) => {
			let settled = false;
			let cancellationListener: { dispose(): void } | undefined;
			const timeoutHandle = setTimeout(() => finish(() => reject(new BrowserPageReadinessTimeoutError(options.readiness?.selector, options.timeoutMs))), remaining);
			const finish = (callback: () => void) => {
				if (settled) {
					return;
				}
				settled = true;
				clearTimeout(timeoutHandle);
				cancellationListener?.dispose();
				callback();
			};
			cancellationListener = token.onCancellationRequested(() => finish(() => reject(new CancellationError())));
			promise.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
		});
	}

	private _remainingTimeout(deadline: number, options: IResolvedSnapshotOptions): number {
		const remaining = deadline - Date.now();
		if (remaining <= 0) {
			throw new BrowserPageReadinessTimeoutError(options.readiness?.selector, options.timeoutMs);
		}
		return remaining;
	}

	private _throwIfCancelled(token: CancellationToken): void {
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
	}

	private getAiSnapshot(page: playwright.Page, full: boolean): Promise<string> {
		const options: IAiAriaSnapshotOptions = { mode: 'ai' };
		if (!full) {
			options._track = 'response';
		}
		return page.ariaSnapshot(options);
	}

	private async runAndWaitForCompletion<T>(callback: (token: CancellationToken) => Promise<T>, token = CancellationTokenNone): Promise<T> {
		const requests: playwright.Request[] = [];

		const requestListener = (request: playwright.Request) => requests.push(request);
		const disposeListeners = () => {
			this.page.off('request', requestListener);
		};
		this.page.on('request', requestListener);

		let result: T;
		try {
			result = await callback(token);
		} finally {
			disposeListeners();
		}

		const requestedNavigation = requests.some(request => request.isNavigationRequest());
		if (requestedNavigation) {
			await this.page.mainFrame().waitForLoadState('load', { timeout: 10000 }).catch(() => { });
			return result;
		}

		const promises: Promise<unknown>[] = [];
		for (const request of requests) {
			if (['document', 'stylesheet', 'script', 'xhr', 'fetch'].includes(request.resourceType())) { promises.push(request.response().then(r => r?.finished()).catch(() => { })); }
			else { promises.push(request.response().catch(() => { })); }
		}
		await raceCancellablePromises<unknown>([
			Promise.all(promises),
			timeout(5000) // Don't wait indefinitely for requests to finish
		]);

		return result;
	}
}
