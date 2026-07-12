/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import {
	BrowserPageReadinessSelectorError,
	BrowserPageReadinessTimeoutError,
	defaultPageSnapshotMaximumBytes,
	defaultPageSnapshotTimeoutMs,
	type IPageSnapshotOptions,
	maximumPageSnapshotTimeoutMs,
} from 'cs/platform/browserView/common/playwrightService';

export interface IResolvedPageSnapshotReadiness {
	readonly selector: string;
	readonly state: 'attached' | 'visible';
	readonly minimumCount: number;
}

export interface IResolvedPageSnapshotOptions {
	readonly readiness: IResolvedPageSnapshotReadiness | undefined;
	readonly timeoutMs: number;
	readonly maximumBytes: number;
}

export function resolvePageSnapshotOptions(options: IPageSnapshotOptions | undefined): IResolvedPageSnapshotOptions {
	const timeoutMs = options?.timeoutMs ?? defaultPageSnapshotTimeoutMs;
	if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > maximumPageSnapshotTimeoutMs) {
		throw new RangeError(`Snapshot timeout must be greater than zero and no greater than ${maximumPageSnapshotTimeoutMs} ms.`);
	}

	const maximumBytes = options?.maximumBytes ?? defaultPageSnapshotMaximumBytes;
	if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > defaultPageSnapshotMaximumBytes) {
		throw new RangeError(`Snapshot maximum bytes must be a positive integer no greater than ${defaultPageSnapshotMaximumBytes}.`);
	}

	const readiness = options?.readiness;
	if (!readiness) {
		return { timeoutMs, maximumBytes, readiness: undefined };
	}
	if (!readiness.selector.trim()) {
		throw new BrowserPageReadinessSelectorError(readiness.selector, new Error('Readiness selector must not be empty.'));
	}
	if (readiness.state !== undefined && readiness.state !== 'attached' && readiness.state !== 'visible') {
		throw new RangeError('Snapshot readiness state must be attached or visible.');
	}

	const minimumCount = readiness.minimumCount ?? 1;
	if (!Number.isSafeInteger(minimumCount) || minimumCount <= 0) {
		throw new RangeError('Snapshot readiness minimum count must be a positive integer.');
	}

	return {
		timeoutMs,
		maximumBytes,
		readiness: {
			selector: readiness.selector,
			state: readiness.state ?? 'attached',
			minimumCount,
		},
	};
}

export function createPageSnapshotDeadline(options: IResolvedPageSnapshotOptions): number {
	return Date.now() + options.timeoutMs;
}

export function remainingPageSnapshotTime(deadline: number, options: IResolvedPageSnapshotOptions): number {
	const remaining = deadline - Date.now();
	if (remaining <= 0) {
		throw new BrowserPageReadinessTimeoutError(options.readiness?.selector, options.timeoutMs);
	}
	return remaining;
}

export function waitForPageSnapshotStage<T>(
	stage: () => Promise<T>,
	deadline: number,
	options: IResolvedPageSnapshotOptions,
	token: CancellationToken,
	mapPlaywrightTimeout: boolean,
): Promise<T> {
	if (token.isCancellationRequested) {
		return Promise.reject(new CancellationError());
	}

	const remaining = remainingPageSnapshotTime(deadline, options);
	let promise: Promise<T>;
	try {
		promise = stage();
	} catch (error) {
		return Promise.reject(mapPlaywrightTimeout && isPlaywrightTimeoutError(error)
			? createPageSnapshotTimeout(options)
			: error);
	}
	return new Promise<T>((resolve, reject) => {
		let settled = false;
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		let cancellationListener: ReturnType<CancellationToken['onCancellationRequested']> | undefined;
		const finish = (callback: () => void) => {
			if (settled) {
				return;
			}
			settled = true;
			if (timeoutHandle !== undefined) {
				clearTimeout(timeoutHandle);
			}
			cancellationListener?.dispose();
			callback();
		};
		timeoutHandle = setTimeout(() => finish(() => reject(createPageSnapshotTimeout(options))), remaining);
		cancellationListener = token.onCancellationRequested(() => finish(() => reject(new CancellationError())));
		promise.then(
			value => finish(() => resolve(value)),
			error => finish(() => reject(mapPlaywrightTimeout && isPlaywrightTimeoutError(error)
				? createPageSnapshotTimeout(options)
				: error)),
		);
	});
}

export function isPageClosedError(error: unknown): boolean {
	return error instanceof Error && /Target page, context or browser has been closed|Page closed|Browser has been closed/i.test(error.message);
}

export function isNavigationInterruptedError(error: unknown): boolean {
	return error instanceof Error && /Execution context was destroyed|Cannot find context|most likely because of a navigation/i.test(error.message);
}

function createPageSnapshotTimeout(options: IResolvedPageSnapshotOptions): BrowserPageReadinessTimeoutError {
	return new BrowserPageReadinessTimeoutError(options.readiness?.selector, options.timeoutMs);
}

function isPlaywrightTimeoutError(error: unknown): boolean {
	return error instanceof Error && (
		error.name === 'TimeoutError'
		|| /Timeout \d+ms exceeded/i.test(error.message)
		|| /waiting for .* timed out/i.test(error.message)
	);
}
