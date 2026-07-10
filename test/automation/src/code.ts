/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Page } from '@playwright/test';

import type { IElement } from './driver';
import type { Logger } from './logger';
import { PlaywrightDriver, type ConsoleMessage } from './playwrightDriver';

export type WaitOptions = {
	readonly timeoutMs?: number;
	readonly intervalMs?: number;
};

export class Code {
	constructor(
		readonly driver: PlaywrightDriver,
		readonly logger: Logger,
	) {}

	get page(): Page {
		return this.driver.currentPage;
	}

	async waitForElement(
		selector: string,
		accept: (element: IElement | undefined) => boolean = element => Boolean(element),
		options: WaitOptions = {},
	): Promise<IElement> {
		return this.waitForCondition(
			`element ${selector}`,
			async () => (await this.driver.getElements(selector))[0],
			accept,
			options,
		) as Promise<IElement>;
	}

	async click(selector: string): Promise<void> {
		this.logger.log(`[driver] click ${selector}`);
		await this.driver.click(selector);
	}

	async evaluate<T>(expression: string): Promise<T> {
		return this.driver.evaluateExpression<T>(expression);
	}

	async setLocalStorage(entries: Readonly<Record<string, string>>): Promise<void> {
		await this.driver.setLocalStorage(entries);
	}

	async reload(): Promise<void> {
		await this.driver.reload();
		await this.whenWorkbenchRestored();
	}

	async whenWorkbenchRestored(): Promise<void> {
		await this.driver.whenWorkbenchRestored();
	}

	getConsoleMessages(): readonly ConsoleMessage[] {
		return this.driver.getConsoleMessages();
	}

	wait(milliseconds: number): Promise<void> {
		return new Promise(resolve => setTimeout(resolve, milliseconds));
	}

	async waitForCondition<T>(
		description: string,
		read: () => Promise<T>,
		accept: (value: T) => boolean,
		options: WaitOptions = {},
	): Promise<T> {
		const timeoutMs = options.timeoutMs ?? 20_000;
		const intervalMs = options.intervalMs ?? 100;
		const deadline = Date.now() + timeoutMs;
		let lastValue: T | undefined;
		let lastError: Error | undefined;

		while (Date.now() < deadline) {
			try {
				lastValue = await read();
				if (accept(lastValue)) {
					return lastValue;
				}
				lastError = undefined;
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
			}

			await this.wait(intervalMs);
		}

		const detail = lastError
			? lastError.message
			: JSON.stringify(lastValue);
		throw new Error(`Timed out waiting for ${description}. Last result: ${detail}`);
	}

	async exit(): Promise<void> {
		await this.driver.close();
	}
}
