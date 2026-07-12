/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'node:path';

import * as playwright from '@playwright/test';

import type { IElement, IWindowDriver } from './driver';
import type { LaunchOptions } from './electron';

export type ConsoleMessage = {
	readonly type: string;
	readonly text: string;
};

export type WebContentsViewBoundsSnapshot = {
	readonly x: number;
	readonly y: number;
	readonly width: number;
	readonly height: number;
};

export class PlaywrightDriver {
	private readonly consoleMessages: ConsoleMessage[] = [];
	private screenshotCounter = 1;

	constructor(
		private readonly application: playwright.ElectronApplication,
		private page: playwright.Page,
		private readonly options: LaunchOptions,
	) {
		this.registerPageListeners(page);
	}

	private registerPageListeners(page: playwright.Page): void {
		page.on('console', message => {
			const consoleMessage = { type: message.type(), text: message.text() };
			this.consoleMessages.push(consoleMessage);
			this.options.logger.log(
				`[renderer:${consoleMessage.type}] ${consoleMessage.text}`,
			);
		});
		page.on('pageerror', error => {
			this.options.logger.log(`[renderer:error] ${error.stack ?? error.message}`);
		});
		page.on('crash', () => {
			this.options.logger.log('[renderer] page crashed');
		});
	}

	get currentPage(): playwright.Page {
		return this.page;
	}

	async waitForDriver(): Promise<void> {
		await this.page.waitForFunction(() => {
			return Boolean((window as Window & { driver?: IWindowDriver }).driver);
		});
	}

	async whenWorkbenchRestored(): Promise<void> {
		await this.page.evaluate(
			([driver]) => driver.whenWorkbenchRestored(),
			[await this.getDriverHandle()] as const,
		);
	}

	async getElements(selector: string, recursive = false): Promise<IElement[]> {
		return this.page.evaluate(
			([driver, targetSelector, includeChildren]) =>
				driver.getElements(targetSelector, includeChildren),
			[await this.getDriverHandle(), selector, recursive] as const,
		);
	}

	async click(selector: string): Promise<void> {
		await this.page.locator(selector).click();
	}

	async evaluateExpression<T>(expression: string): Promise<T> {
		return this.page.evaluate(expression) as Promise<T>;
	}

	async getVisibleWebContentsViewBounds(): Promise<WebContentsViewBoundsSnapshot[]> {
		return this.application.evaluate(({ BrowserWindow, WebContentsView }) =>
			BrowserWindow.getAllWindows().flatMap(targetWindow =>
				targetWindow.contentView.children
					.filter(view => view instanceof WebContentsView && view.getVisible())
					.map(view => view.getBounds()),
			),
		);
	}

	async terminateSharedProcess(): Promise<number> {
		return this.application.evaluate(({ app }) => {
			const candidates = app.getAppMetrics().filter(metric =>
				metric.type === 'Utility' && metric.name === 'Comet Shared Process'
			);
			if (candidates.length !== 1) {
				throw new Error(`Expected one Comet Shared Process, found ${candidates.length}.`);
			}
			const [{ pid }] = candidates;
			process.kill(pid, 'SIGKILL');
			return pid;
		});
	}

	async closeAndReopenMainWindow(): Promise<void> {
		const reopenedPage = this.application.waitForEvent('window');
		await this.application.evaluate(({ app, BrowserWindow }) => new Promise<void>((resolve, reject) => {
			const windows = BrowserWindow.getAllWindows();
			if (windows.length !== 1) {
				reject(new Error(`Expected one main window, found ${windows.length}.`));
				return;
			}
			windows[0].once('closed', () => {
				app.emit('activate');
				resolve();
			});
			windows[0].close();
		}));
		this.page = await reopenedPage;
		this.registerPageListeners(this.page);
		await this.waitForDriver();
	}

	async setLocalStorage(entries: Readonly<Record<string, string>>): Promise<void> {
		await this.page.evaluate(storageEntries => {
			localStorage.clear();
			for (const [key, value] of Object.entries(storageEntries)) {
				localStorage.setItem(key, value);
			}
		}, entries);
	}

	async reload(): Promise<void> {
		await this.page.reload({ waitUntil: 'load' });
		await this.waitForDriver();
	}

	getConsoleMessages(): readonly ConsoleMessage[] {
		return [...this.consoleMessages];
	}

	async takeScreenshot(name: string): Promise<string> {
		const fileName = `${this.screenshotCounter++}-${name.replace(/\s+/g, '-')}.png`;
		const screenshotPath = path.join(this.options.logsPath, fileName);
		await this.page.screenshot({ path: screenshotPath });
		return screenshotPath;
	}

	async close(): Promise<void> {
		await this.application.close();
	}

	private async getDriverHandle(): Promise<playwright.JSHandle<IWindowDriver>> {
		return this.page.evaluateHandle('window.driver');
	}
}
