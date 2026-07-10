/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow } from 'electron';

import { cleanText } from 'cs/base/common/strings';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import { getMainWindow } from 'cs/platform/windows/electron-main/windows';
import {
	getWebContentDocumentSnapshot,
	hasManagedWebContentTarget,
	startExistingWebContentTargetNavigation,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import {
	FetchErrorCode,
	fetchError,
	getFetchErrorCode,
} from 'cs/workbench/services/fetch/common/fetchErrors';

export interface FetchTargetDocument {
	readonly targetMode: 'background' | 'webContentsView';
	readonly targetId: string | null;
	readonly requestedUrl: string;
	readonly finalUrl: string;
	readonly statusCode: number | null;
	readonly html: string;
	readonly documentReadyState: string;
}

export interface FetchTargetLoadOptions {
	readonly timeoutMs: number;
	readonly settleMs?: number;
	readonly signal?: AbortSignal;
}

export type FetchTargetDocumentAdmission = (
	document: FetchTargetDocument,
) => boolean;

const WEB_CONTENTS_VIEW_POLL_MS = 400;
const WEB_CONTENTS_VIEW_OPEN_TIMEOUT_MS = 15_000;

function sleep(milliseconds: number) {
	return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

function isAbortError(error: unknown) {
	return Boolean(
		error &&
			typeof error === 'object' &&
			(error as { name?: string }).name === 'AbortError',
	);
}

export class FetchTargetService {
	private backgroundWindow: BrowserWindow | null = null;
	private backgroundQueue: Promise<void> = Promise.resolve();

	async loadBackground(
		url: string,
		options: FetchTargetLoadOptions,
	): Promise<FetchTargetDocument> {
		const previousTask = this.backgroundQueue.catch(() => undefined);
		const currentTask = previousTask.then(() => this.loadBackgroundNow(url, options));
		this.backgroundQueue = currentTask.then(
			() => undefined,
			() => undefined,
		);
		return currentTask;
	}

	async navigateWebContentsView(targetId: string, url: string) {
		startExistingWebContentTargetNavigation(url, targetId);
	}

	hasWebContentsViewTarget(targetId: string) {
		return hasManagedWebContentTarget(targetId);
	}

	dispose() {
		if (this.backgroundWindow && !this.backgroundWindow.isDestroyed()) {
			this.backgroundWindow.destroy();
		}
		this.backgroundWindow = null;
	}

	async waitForWebContentsView(
		targetId: string,
		requestedUrl: string,
		admit: FetchTargetDocumentAdmission,
		options: FetchTargetLoadOptions,
	): Promise<FetchTargetDocument> {
		const openStartedAt = Date.now();
		let validationStartedAt: number | null = null;
		while (
			validationStartedAt === null ||
			Date.now() - validationStartedAt < options.timeoutMs
		) {
			if (options.signal?.aborted) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'ABORTED',
					url: requestedUrl,
				});
			}

			if (!hasManagedWebContentTarget(targetId)) {
				if (validationStartedAt !== null) {
					throw fetchError(FetchErrorCode.InteractiveTargetClosed, {
						targetId,
						url: requestedUrl,
					});
				}
				if (Date.now() - openStartedAt >= WEB_CONTENTS_VIEW_OPEN_TIMEOUT_MS) {
					throw fetchError(FetchErrorCode.InteractiveTargetTimedOut, {
						targetId,
						url: requestedUrl,
						phase: 'opening',
						timeoutMs: WEB_CONTENTS_VIEW_OPEN_TIMEOUT_MS,
					});
				}
				await sleep(WEB_CONTENTS_VIEW_POLL_MS);
				continue;
			}
			validationStartedAt ??= Date.now();

			const snapshot = await getWebContentDocumentSnapshot(targetId, {
				timeoutMs: Math.min(1500, options.timeoutMs),
			});
			if (snapshot) {
				const document: FetchTargetDocument = {
					targetMode: 'webContentsView',
					targetId,
					requestedUrl,
					finalUrl: snapshot.url,
					statusCode: null,
					html: snapshot.html,
					documentReadyState: snapshot.documentReadyState,
				};
				if (admit(document)) {
					return document;
				}
			}

			await sleep(WEB_CONTENTS_VIEW_POLL_MS);
		}

		throw fetchError(FetchErrorCode.InteractiveTargetTimedOut, {
			targetId,
			url: requestedUrl,
			timeoutMs: options.timeoutMs,
		});
	}

	private getBackgroundWindow() {
		if (this.backgroundWindow && !this.backgroundWindow.isDestroyed()) {
			return this.backgroundWindow;
		}
		const ownerWindow = getMainWindow();
		if (!ownerWindow || ownerWindow.isDestroyed()) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'WINDOW_UNAVAILABLE',
			});
		}

		this.backgroundWindow = new BrowserWindow({
			show: false,
			width: 1280,
			height: 900,
			autoHideMenuBar: true,
			webPreferences: {
				partition: WORKBENCH_SHARED_WEB_PARTITION,
				sandbox: true,
				contextIsolation: true,
				nodeIntegration: false,
				backgroundThrottling: false,
			},
		});
		this.backgroundWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
		ownerWindow.once('closed', () => this.dispose());
		this.backgroundWindow.on('closed', () => {
			this.backgroundWindow = null;
		});
		return this.backgroundWindow;
	}

	private async loadBackgroundNow(
		url: string,
		options: FetchTargetLoadOptions,
	): Promise<FetchTargetDocument> {
		if (options.signal?.aborted) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'ABORTED',
				url,
			});
		}

		const window = this.getBackgroundWindow();
		const { webContents } = window;
		let statusCode: number | null = null;
		let timedOut = false;
		let aborted = false;
		const stopLoading = () => {
			if (!window.isDestroyed() && !webContents.isDestroyed()) {
				webContents.stop();
			}
		};
		const handleAbort = () => {
			aborted = true;
			stopLoading();
		};
		const handleNavigate = (
			_event: Electron.Event,
			_url: string,
			httpResponseCode: number,
		) => {
			statusCode = Number.isFinite(httpResponseCode) && httpResponseCode > 0
				? httpResponseCode
				: null;
		};

		if (options.signal?.aborted) {
			handleAbort();
		} else {
			options.signal?.addEventListener('abort', handleAbort, { once: true });
		}
		webContents.on('did-navigate', handleNavigate);
		const timeout = setTimeout(() => {
			timedOut = true;
			stopLoading();
		}, options.timeoutMs);

		try {
			await webContents.loadURL(url);
			if (aborted || timedOut) {
				throw new DOMException('The background navigation was interrupted.', 'AbortError');
			}
			if (options.settleMs && options.settleMs > 0) {
				await sleep(options.settleMs);
			}
			if (aborted || timedOut) {
				throw new DOMException('The background navigation was interrupted.', 'AbortError');
			}

			const snapshot = await webContents.executeJavaScript(
				`(() => ({
					url: location.href,
					html: document.documentElement ? document.documentElement.outerHTML : '',
					documentReadyState: document.readyState,
				}))()`,
				true,
			) as {
				url?: unknown;
				html?: unknown;
				documentReadyState?: unknown;
			};
			const html = typeof snapshot.html === 'string' ? snapshot.html : '';
			if (!html.trim()) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'EMPTY_DOCUMENT',
					url,
				});
			}

			return {
				targetMode: 'background',
				targetId: null,
				requestedUrl: url,
				finalUrl: cleanText(snapshot.url) || webContents.getURL() || url,
				statusCode,
				html,
				documentReadyState: cleanText(snapshot.documentReadyState),
			};
		} catch (error) {
			if (getFetchErrorCode(error)) {
				throw error;
			}
			if (aborted) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'ABORTED',
					url,
				});
			}
			if (timedOut) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'TIMEOUT',
					url,
					timeoutMs: options.timeoutMs,
				});
			}
			if (isAbortError(error)) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'NAVIGATION_ABORTED',
					url,
				});
			}
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'NAVIGATION_FAILED',
				statusText: error instanceof Error ? error.message : String(error),
				url,
			});
		} finally {
			clearTimeout(timeout);
			options.signal?.removeEventListener('abort', handleAbort);
			webContents.removeListener('did-navigate', handleNavigate);
		}
	}
}
