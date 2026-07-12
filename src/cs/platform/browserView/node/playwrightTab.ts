/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// eslint-disable-next-line local/code-import-patterns
import type * as playwright from 'playwright-core';
import { Emitter, Event } from 'cs/base/common/event';
import { CancellationError, CancellationToken, CancellationTokenNone, isCancellationError } from 'cs/base/common/cancellation';
import { createCancelablePromise, DeferredPromise, raceTimeout } from 'cs/base/common/async';
import { URI } from 'cs/base/common/uri';
import { IAgentNetworkFilterService } from 'cs/platform/networkFilter/common/networkFilterService';
import {
	BrowserPageReadinessSelectorError,
	BrowserPageClosedError,
	BrowserPageNavigationInterruptedError,
	BrowserPageSnapshotEmptyError,
	BrowserPageSnapshotTooLargeError,
} from 'cs/platform/browserView/common/playwrightService';
import {
	type IResolvedPageSnapshotOptions,
	isNavigationInterruptedError,
	isPageClosedError,
	remainingPageSnapshotTime,
	waitForPageSnapshotStage,
} from 'cs/platform/browserView/node/playwrightSnapshot';

type IAiAriaSnapshotOptions = NonNullable<Parameters<playwright.Locator['ariaSnapshot']>[0]> & { _track?: string };

interface IPageLog {
	readonly type: string;
	readonly time: number;
	readonly description: string;
}

interface IPendingInitialLog {
	readonly key?: string;
	readonly log: IPageLog;
}

const REQUEST_COMPLETION_TIMEOUT_MS = 5000;
const REQUEST_COMPLETION_RESOURCE_TYPES = new Set(['document', 'stylesheet', 'script', 'xhr', 'fetch']);

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

declare module 'playwright-core' {
	interface Page {
		// We defined this here to be able to use the unofficial `_track` option
		ariaSnapshot(options?: IAiAriaSnapshotOptions): Promise<string>;
	}
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
	private completion: Promise<unknown> | undefined;

	constructor(private readonly completionFactory: () => Promise<unknown>) {
		super('Action was interrupted by a dialog');
		this.name = 'DialogInterruptedError';
	}

	waitForCompletion(): Promise<unknown> {
		return this.completion ??= this.completionFactory();
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
	private _dialogObservationError: Error | undefined;
	private _fileChooser: playwright.FileChooser | undefined;
	private _logs: IPageLog[] = [];
	private _historyInitialized = false;
	private readonly _pendingInitialLogs: IPendingInitialLog[] = [];
	private _needsFullSnapshot = false;

	private _initialized: Promise<void> | undefined;

	constructor(
		/**
		 * @deprecated prefer accessing the page via safeRunAgainstPage.
		 * Only use this directly if you are sure it cannot be blocked by dialogs.
		 */
		private readonly page: playwright.Page,
		private readonly agentNetworkFilterService: IAgentNetworkFilterService,
	) {
		page.on('console', event => this._recordConsoleMessage(event))
			.on('pageerror', error => this._recordPageError(error))
			.on('requestfailed', request => this._handleRequestFailed(request))
			.on('dialog', dialog => this._handleDialog(dialog))
			.on('download', download => this._handleDownload(download));
	}

	private async _initialize() {
		const [messages, errors] = await Promise.all([
			this.page.consoleMessages(),
			this.page.pageErrors(),
		]);
		const historyOccurrences = new Map<string, number>();
		for (const message of messages) {
			if (!this._shouldLogConsoleMessage(message)) {
				continue;
			}
			this._addHistoryOccurrence(historyOccurrences, this._consoleMessageKey(message));
			this._handleConsoleMessage(message);
		}
		for (const error of errors) {
			this._addHistoryOccurrence(historyOccurrences, this._pageErrorKey(error));
			this._handlePageError(error);
		}
		this._historyInitialized = true;
		for (const pending of this._pendingInitialLogs) {
			if (pending.key !== undefined) {
				const occurrenceCount = historyOccurrences.get(pending.key) ?? 0;
				if (occurrenceCount > 0) {
					historyOccurrences.set(pending.key, occurrenceCount - 1);
					continue;
				}
			}
			this._logs.push(pending.log);
		}
		this._pendingInitialLogs.length = 0;
	}

	private _addHistoryOccurrence(occurrences: Map<string, number>, key: string): void {
		occurrences.set(key, (occurrences.get(key) ?? 0) + 1);
	}

	private _consoleMessageKey(message: playwright.ConsoleMessage): string {
		return JSON.stringify(['console', message.type(), message.timestamp(), message.text()]);
	}

	private _pageErrorKey(error: Error): string {
		return JSON.stringify(['pageError', error.name, error.message, error.stack]);
	}

	private _shouldLogConsoleMessage(message: playwright.ConsoleMessage): boolean {
		return message.type() === 'error' || message.type() === 'warning';
	}

	private _recordConsoleMessage(message: playwright.ConsoleMessage): void {
		if (!this._shouldLogConsoleMessage(message)) {
			return;
		}
		if (!this._historyInitialized) {
			this._pendingInitialLogs.push({
				key: this._consoleMessageKey(message),
				log: this._createConsoleLog(message),
			});
			return;
		}
		this._handleConsoleMessage(message);
	}

	private _recordPageError(error: Error): void {
		if (!this._historyInitialized) {
			this._pendingInitialLogs.push({
				key: this._pageErrorKey(error),
				log: this._createPageErrorLog(error),
			});
			return;
		}
		this._handlePageError(error);
	}

	private _handleDialog(dialog: playwright.Dialog) {
		this._dialog = dialog;
		// Playwright doesn't give us an event for when a dialog is closed, so we run a no-op script to know when it closes.
		void this._waitForDialogClose(dialog);
		this._onDialogStateChanged.fire();
	}

	private async _waitForDialogClose(dialog: playwright.Dialog): Promise<void> {
		try {
			await this.page.waitForFunction(() => true, undefined, { timeout: 0 });
		} catch (error) {
			const observationError = error instanceof Error ? error : new Error(String(error));
			this._handlePageError(observationError);
			if (this._dialog === dialog) {
				this._dialog = undefined;
				this._dialogObservationError = observationError;
				this._onDialogStateChanged.fire();
			}
			return;
		}
		if (this._dialog === dialog) {
			this._dialog = undefined;
			this._onDialogStateChanged.fire();
		}
	}

	async replyToDialog(accept?: boolean, promptText?: string) {
		this._throwDialogObservationError();
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
		}, { waitForCompletion: true, token: CancellationTokenNone });
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
		await this.safeRunAgainstPage(
			() => chooser.setFiles(files),
			{ waitForCompletion: true, token: CancellationTokenNone },
		);
	}

	private _handleDownload(download: playwright.Download): void {
		this._recordUnmatchedLog({ type: 'download', time: Date.now(), description: `${download.suggestedFilename()}` });
	}

	private _handleRequestFailed(request: playwright.Request) {
		const timing = request.timing();
		this._recordUnmatchedLog({ type: 'requestFailed', time: timing.responseEnd + timing.startTime, description: `${request.method()} request to ${request.url()} failed: "${request.failure()?.errorText}"` });
	}

	private _recordUnmatchedLog(log: IPageLog): void {
		if (!this._historyInitialized) {
			this._pendingInitialLogs.push({ log });
			return;
		}
		this._logs.push(log);
	}

	private _handleConsoleMessage(message: playwright.ConsoleMessage) {
		this._logs.push(this._createConsoleLog(message));
	}

	private _handlePageError(error: Error) {
		this._logs.push(this._createPageErrorLog(error));
	}

	private _createConsoleLog(message: playwright.ConsoleMessage): IPageLog {
		return { type: 'console', time: message.timestamp(), description: `[${message.type()}] ${message.text()}` };
	}

	private _createPageErrorLog(error: Error): IPageLog {
		return { type: 'pageError', time: Date.now(), description: error.stack ?? error.message };
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
		const uri = URI.parse(url, true);
		if (!this.agentNetworkFilterService.isUriAllowed(uri)) {
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
	async safeRunAgainstPage<T>(
		action: (page: playwright.Page, token: CancellationToken) => Promise<T>,
		options: { readonly waitForCompletion: boolean; readonly token: CancellationToken },
	): Promise<T> {
		if (options.token.isCancellationRequested) {
			throw new CancellationError();
		}
		this._throwDialogObservationError();
		if (this._dialog) {
			throw new Error(`Cannot perform action while a dialog is open`);
		}

		// Block agent actions when the current page URL is on the deny list.
		const blockedError = this._getBlockedURLErrorMessage();
		if (blockedError) {
			throw new Error(blockedError);
		}

		let result: T | void;
		const actionCompleted = createCancelablePromise(async (token) => {

			// Whenever the page has a `filechooser` handler, the default file chooser is disabled.
			// We don't want this during normal user interactions, but we do for agentic interactions.
			// So we add a handler just during the action, and remove it afterwards.
			// This isn't perfect (e.g. the user could trigger it while an action is running), but it's a best effort.
			const handleFileChooser = (chooser: playwright.FileChooser) => this._handleFileChooser(chooser);
			this.page.on('filechooser', handleFileChooser);

			try {
				result = await this.runAndWaitForCompletion(
					token => action(this.page, token),
					token,
					options.waitForCompletion,
				);
			} finally {
				this.page.off('filechooser', handleFileChooser);
			}
		});
		const cancellationListener = options.token.onCancellationRequested(() => actionCompleted.cancel());
		type ActionSettlement =
			| { readonly kind: 'fulfilled'; readonly result: T }
			| { readonly kind: 'rejected'; readonly error: unknown };
		let actionSettlement: ActionSettlement | undefined;
		const actionSettled = new Emitter<void>();
		const settleAction = (settlement: ActionSettlement): void => {
			actionSettlement = settlement;
			cancellationListener.dispose();
			actionSettled.fire();
			actionSettled.dispose();
		};
		void actionCompleted.then(
			() => settleAction({ kind: 'fulfilled', result: result as T }),
			error => settleAction({ kind: 'rejected', error }),
		);

		const readActionSettlement = (): T => {
			if (!actionSettlement) {
				throw new Error('Page action has not settled.');
			}
			if (actionSettlement.kind === 'rejected') {
				throw actionSettlement.error;
			}
			return actionSettlement.result;
		};

		const throwDialogObservationError = (): void => {
			if (this._dialogObservationError) {
				actionCompleted.cancel();
			}
			this._throwDialogObservationError();
		};

		const waitForStateChange = async (hasStateChanged: () => boolean): Promise<void> => {
			const stateChanged = new DeferredPromise<void>();
			const dialogListener = Event.once(this._onDialogStateChanged.event)(() => stateChanged.complete());
			const actionListener = Event.once(actionSettled.event)(() => stateChanged.complete());
			if (actionSettlement || this._dialogObservationError || hasStateChanged()) {
				stateChanged.complete();
			}
			try {
				await stateChanged.p;
			} finally {
				dialogListener.dispose();
				actionListener.dispose();
			}
		};

		let waitForActionOrDialog: () => Promise<T>;
		const waitForDialogToChange = async (dialog: playwright.Dialog): Promise<T> => {
			while (this._dialog === dialog && !actionSettlement) {
				await waitForStateChange(() => this._dialog !== dialog);
			}
			if (actionSettlement) {
				return readActionSettlement();
			}
			throwDialogObservationError();
			return waitForActionOrDialog();
		};

		waitForActionOrDialog = async (): Promise<T> => {
			while (true) {
				throwDialogObservationError();
				const dialog = this._dialog;
				if (dialog) {
					throw new DialogInterruptedError(() => waitForDialogToChange(dialog));
				}
				if (actionSettlement) {
					return readActionSettlement();
				}

				await waitForStateChange(() => this._dialog !== undefined);
				if (actionSettlement) {
					return readActionSettlement();
				}
			}
		};

		return waitForActionOrDialog();
	}

	async getSummary(full = this._needsFullSnapshot): Promise<string> {
		await (this._initialized ??= this._initialize());

		// When the current page URL is blocked by network policy, return only a
		// policy error — do not expose title, URL, console logs, or snapshot to
		// avoid prompt-injection via blocked content.
		const blockedError = this._getBlockedURLErrorMessage();
		if (blockedError) {
			return blockedError;
		}
		this._throwDialogObservationError();
		if (this._dialog) {
			this._needsFullSnapshot = true;
			const logs = this._logs;
			this._logs = [];
			return [
				`URL: ${this.page.url()}`,
				`Active ${this._dialog.type()} dialog: "${this._dialog.message()}"`,
				...(logs.length > 0 ? [
					`Recent events:`,
					...logs.map(log => `- [${new Date(log.time).toISOString()}] (${log.type}) ${log.description}`),
				] : []),
				`Snapshot: <blocked by active dialog>`,
			].join('\n');
		}

		if (full && this._needsFullSnapshot) {
			this._needsFullSnapshot = false;
		}

		let snapshotFromPage: string;
		let title: string;
		try {
			const pageActionOptions = { waitForCompletion: true, token: CancellationTokenNone };
			snapshotFromPage = await this.safeRunAgainstPage((page) => this.getAiSnapshot(page, full), pageActionOptions);
			title = await this.safeRunAgainstPage((page) => page.title(), pageActionOptions);
		} catch (error) {
			this._needsFullSnapshot = true;
			throw error;
		}

		const logs = this._logs;
		this._logs = [];

		const snapshot = snapshotFromPage.trim();

		return [
			...(title ? [`Page Title: ${title}`] : []),
			`URL: ${this.page.url()}`,
			...(this._fileChooser ? [`Active file chooser dialog`] : []),
			...(logs.length > 0 ? [
				`Recent events:`,
				...logs.map(log => `- [${new Date(log.time).toISOString()}] (${log.type}) ${log.description}`)
			] : []),
			`Snapshot: ${snapshot ? `\n${snapshot}` : '<unchanged>'}`,
		].join('\n');
	}

	private _throwDialogObservationError(): void {
		if (this._dialogObservationError) {
			throw this._dialogObservationError;
		}
	}

	async captureSnapshot(
		pageId: string,
		options: IResolvedPageSnapshotOptions,
		deadline: number,
		token: CancellationToken,
	): Promise<IPageSnapshotCapture> {
		this._throwIfCancelled(token);
		try {
			return await this.safeRunAgainstPage(async (page, actionToken) => {
				await waitForPageSnapshotStage(
					() => page.mainFrame().waitForLoadState('domcontentloaded', { timeout: remainingPageSnapshotTime(deadline, options) }),
					deadline,
					options,
					actionToken,
					true,
				);
				if (options.readiness) {
					await this._waitForReadiness(page, deadline, options, actionToken);
				}
				await waitForPageSnapshotStage(
					() => page.evaluate(() => new Promise<void>(resolve => globalThis.requestAnimationFrame(() => resolve()))),
					deadline,
					options,
					actionToken,
					true,
				);
				const snapshot = await waitForPageSnapshotStage(() => page.evaluate((maximumBytes: number): IPageSnapshotCapture | IPageSnapshotTooLarge | undefined => {
					const documentElement = globalThis.document.documentElement;
					if (!documentElement) {
						return undefined;
					}
					const html = documentElement.outerHTML;
					if (new TextEncoder().encode(html).byteLength > maximumBytes) {
						return { uri: globalThis.location.href, title: globalThis.document.title, tooLarge: true };
					}
					return { uri: globalThis.location.href, title: globalThis.document.title, html };
				}, options.maximumBytes), deadline, options, actionToken, true);
				this._throwIfCancelled(actionToken);
				if (!snapshot) {
					throw new BrowserPageSnapshotEmptyError(pageId);
				}
				if ('tooLarge' in snapshot) {
					throw new BrowserPageSnapshotTooLargeError(options.maximumBytes);
				}
				if (Buffer.byteLength(snapshot.html, 'utf8') > options.maximumBytes) {
					throw new BrowserPageSnapshotTooLargeError(options.maximumBytes);
				}
				return snapshot;
			}, { waitForCompletion: false, token });
		} catch (error) {
			if (isCancellationError(error)) {
				throw error;
			}
			if (isPageClosedError(error)) {
				throw new BrowserPageClosedError(pageId);
			}
			if (isNavigationInterruptedError(error)) {
				throw new BrowserPageNavigationInterruptedError(error);
			}
			throw error;
		}
	}

	private async _waitForReadiness(page: playwright.Page, deadline: number, options: IResolvedPageSnapshotOptions, token: CancellationToken): Promise<void> {
		const readiness = options.readiness!;
		const locator = page.locator(readiness.selector);
		try {
			await waitForPageSnapshotStage(() => locator.count(), deadline, options, token, true);
		} catch (error) {
			if (isInvalidSelectorError(error)) {
				throw new BrowserPageReadinessSelectorError(readiness.selector, error);
			}
			throw error;
		}
		while (true) {
			this._throwIfCancelled(token);
			const count = await waitForPageSnapshotStage(() => locator.count(), deadline, options, token, true);
			let ready = count >= readiness.minimumCount;
			if (ready && readiness.state === 'visible') {
				let visibleCount = 0;
				for (let index = 0; index < count && visibleCount < readiness.minimumCount; index++) {
					if (await waitForPageSnapshotStage(() => locator.nth(index).isVisible(), deadline, options, token, true)) {
						visibleCount++;
					}
				}
				ready = visibleCount >= readiness.minimumCount;
			}
			if (ready) {
				return;
			}
			await waitForPageSnapshotStage(
				() => new Promise<void>(resolve => setTimeout(resolve, Math.min(100, remainingPageSnapshotTime(deadline, options)))),
				deadline,
				options,
				token,
				false,
			);
		}
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

	private async runAndWaitForCompletion<T>(
		callback: (token: CancellationToken) => Promise<T>,
		token: CancellationToken,
		waitForCompletion: boolean,
	): Promise<T> {
		if (!waitForCompletion) {
			return callback(token);
		}
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
			await this.page.mainFrame().waitForLoadState('load', { timeout: 10000 });
			return result;
		}

		const completion = await raceTimeout(
			Promise.all(requests.map(request => this.waitForRequestCompletion(request))),
			REQUEST_COMPLETION_TIMEOUT_MS,
		);
		if (completion === undefined) {
			throw new Error(`Timed out after ${REQUEST_COMPLETION_TIMEOUT_MS} ms waiting for page requests to finish.`);
		}

		return result;
	}

	private async waitForRequestCompletion(request: playwright.Request): Promise<void> {
		const response = await request.response();
		if (!response || !REQUEST_COMPLETION_RESOURCE_TYPES.has(request.resourceType())) {
			return;
		}
		const completionError = await response.finished();
		if (completionError) {
			throw completionError;
		}
	}
}
