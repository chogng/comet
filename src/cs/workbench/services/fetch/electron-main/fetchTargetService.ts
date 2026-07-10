/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type { FetchTargetPreference } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { BrowserViewStorageScope } from 'cs/platform/browserView/common/browserView';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import {
	getWebContentDocumentSnapshot,
	type BrowserViewMainService,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import { getMainWindow } from 'cs/platform/windows/electron-main/windows';
import {
	FetchErrorCode,
	fetchError,
} from 'cs/workbench/services/fetch/common/fetchErrors';

export interface FetchTargetDocument {
	readonly resource: URI;
	readonly targetMode: FetchTargetPreference;
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

const TARGET_POLL_MS = 400;
const TARGET_PRESENTATION_POLL_MS = 100;
const TARGET_PRESENTATION_TIMEOUT_MS = 15_000;

function sleep(milliseconds: number) {
	return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

function getTargetId(resource: URI) {
	const targetId = BrowserViewUri.getId(resource);
	if (!targetId) {
		throw new Error(`Invalid Browser target resource: ${resource.toString()}`);
	}
	return targetId;
}

export class FetchTargetService {
	constructor(private readonly browserViewService: BrowserViewMainService) {}

	hasTarget(resource: URI) {
		return this.browserViewService.tryGetTarget(getTargetId(resource)) !== undefined;
	}

	async ensureTarget(resource: URI): Promise<void> {
		const ownerWindow = getMainWindow();
		if (!ownerWindow || ownerWindow.isDestroyed()) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'WINDOW_UNAVAILABLE',
			});
		}

		await this.browserViewService.getOrCreateBrowserView(getTargetId(resource), {
			owner: { mainWindowId: ownerWindow.id },
			sessionOptions: { scope: BrowserViewStorageScope.Global },
			presentation: 'background',
		});
	}

	async waitForEditorTarget(
		resource: URI,
		requestedUrl: string,
		options: Pick<FetchTargetLoadOptions, 'signal'>,
	): Promise<void> {
		const targetId = getTargetId(resource);
		const startedAt = Date.now();
		while (Date.now() - startedAt < TARGET_PRESENTATION_TIMEOUT_MS) {
			if (options.signal?.aborted) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'ABORTED',
					url: requestedUrl,
				});
			}
			if (!this.browserViewService.tryGetTarget(targetId)) {
				throw fetchError(FetchErrorCode.InteractiveTargetClosed, {
					targetId,
					url: requestedUrl,
				});
			}
			if (this.browserViewService.getTargetPresentation(targetId) === 'editor') {
				return;
			}
			await sleep(TARGET_PRESENTATION_POLL_MS);
		}

		throw fetchError(FetchErrorCode.InteractiveTargetTimedOut, {
			targetId,
			url: requestedUrl,
			phase: 'opening',
			timeoutMs: TARGET_PRESENTATION_TIMEOUT_MS,
		});
	}

	async load(
		resource: URI,
		targetMode: FetchTargetPreference,
		requestedUrl: string,
		admit: FetchTargetDocumentAdmission,
		options: FetchTargetLoadOptions,
	): Promise<FetchTargetDocument> {
		const targetId = getTargetId(resource);
		let navigationError: unknown;
		void this.browserViewService.loadURL(targetId, requestedUrl).catch(error => {
			navigationError = error;
		});

		const startedAt = Date.now();
		let observedAt: number | null = null;
		let observedUrl = '';
		while (Date.now() - startedAt < options.timeoutMs) {
			if (options.signal?.aborted) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'ABORTED',
					url: requestedUrl,
				});
			}

			if (!this.browserViewService.tryGetTarget(targetId)) {
				if (targetMode === 'webContentsView') {
					throw fetchError(FetchErrorCode.InteractiveTargetClosed, {
						targetId,
						url: requestedUrl,
					});
				}
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'TARGET_CLOSED',
					targetId,
					url: requestedUrl,
				});
			}

			if (navigationError) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'NAVIGATION_FAILED',
					statusText: navigationError instanceof Error
						? navigationError.message
						: String(navigationError),
					targetId,
					url: requestedUrl,
				});
			}

			const snapshot = await getWebContentDocumentSnapshot(targetId, {
				timeoutMs: Math.min(1500, options.timeoutMs),
			});
			if (snapshot) {
				if (snapshot.url !== observedUrl) {
					observedUrl = snapshot.url;
					observedAt = Date.now();
				}

				const document: FetchTargetDocument = {
					resource,
					targetMode,
					requestedUrl,
					finalUrl: snapshot.url,
					statusCode: snapshot.statusCode,
					html: snapshot.html,
					documentReadyState: snapshot.documentReadyState,
				};
				const settleMs = Math.max(0, options.settleMs ?? 0);
				if (
					observedAt !== null &&
					Date.now() - observedAt >= settleMs &&
					admit(document)
				) {
					return document;
				}
			}

			await sleep(TARGET_POLL_MS);
		}

		if (targetMode === 'webContentsView') {
			throw fetchError(FetchErrorCode.InteractiveTargetTimedOut, {
				targetId,
				url: requestedUrl,
				timeoutMs: options.timeoutMs,
			});
		}
		throw fetchError(FetchErrorCode.HttpRequestFailed, {
			status: 'TIMEOUT',
			targetId,
			url: requestedUrl,
			timeoutMs: options.timeoutMs,
		});
	}

	async destroyTarget(resource: URI): Promise<void> {
		const targetId = getTargetId(resource);
		if (this.browserViewService.getTargetPresentation(targetId) === 'background') {
			await this.browserViewService.destroyBrowserView(targetId);
		}
	}
}
