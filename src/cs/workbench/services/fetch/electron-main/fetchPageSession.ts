/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import { generateUuid } from 'cs/base/common/uuid';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import {
	FetchErrorCode,
	fetchError,
	getFetchErrorCode,
	getFetchErrorDetails,
} from 'cs/workbench/services/fetch/common/fetchErrors';

export type FetchPagePresentation = 'background' | 'browserEditor';

export interface FetchPageSnapshot {
	readonly resource: URI;
	readonly presentation: FetchPagePresentation;
	readonly requestedUri: URI;
	readonly finalUri: URI;
	readonly statusCode: number | null;
	readonly html: string;
	readonly documentReadyState: string;
}

export interface FetchPageSessionRequest {
	readonly presentation: FetchPagePresentation;
}

export interface FetchPageSessionCallbacks {
	onBrowserEditorRequired(resource: URI, uri: URI): void;
}

export interface FetchPageLoadOptions {
	readonly timeoutMs: number;
	readonly settleMs?: number;
	readonly signal?: AbortSignal;
	readonly admitSnapshot: (snapshot: FetchPageSnapshot) => FetchPageSnapshotAdmission;
}

export interface FetchPageSnapshotAdmission {
	readonly ready: boolean;
	readonly stabilityKey?: string;
	readonly rejection?: unknown;
}

export interface FetchPageSessionRuntime {
	hasTarget(resource: URI): boolean;
	ensureTarget(resource: URI): Promise<void>;
	getPresentation(resource: URI): 'background' | 'editor' | undefined;
	loadUri(resource: URI, uri: URI): Promise<void>;
	getSnapshot(resource: URI, timeoutMs: number): Promise<FetchPageRuntimeSnapshot | null>;
	destroyTarget(resource: URI): Promise<void>;
}

export interface FetchPageRuntimeSnapshot {
	readonly url: string;
	readonly html: string;
	readonly statusCode: number | null;
	readonly documentReadyState: string;
}

const pagePollMs = 400;
const editorPollMs = 100;
const editorTimeoutMs = 15_000;

function sleep(milliseconds: number) {
	return new Promise<void>(resolve => setTimeout(resolve, milliseconds));
}

function getTargetId(resource: URI) {
	const targetId = BrowserViewUri.getId(resource);
	if (!targetId) {
		throw new Error(`Invalid Fetch page resource: ${resource.toString()}`);
	}
	return targetId;
}

export class FetchPageSession {
	readonly resource = BrowserViewUri.forId(generateUuid());
	private queue: Promise<void> = Promise.resolve();
	private disposed = false;
	private disposePromise: Promise<void> | undefined;

	constructor(
		private readonly runtime: FetchPageSessionRuntime,
		readonly presentation: FetchPagePresentation,
		private readonly callbacks: FetchPageSessionCallbacks,
	) {}

	get targetId(): string {
		return getTargetId(this.resource);
	}

	async load(uri: URI, options: FetchPageLoadOptions): Promise<FetchPageSnapshot> {
		if (this.disposed) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'SESSION_DISPOSED',
				uri: uri.toString(true),
			});
		}
		const previousTask = this.queue.catch(() => undefined);
		const currentTask = previousTask.then(() => this.loadNow(uri, options));
		this.queue = currentTask.then(() => undefined, () => undefined);
		return currentTask;
	}

	private async ensureTarget(): Promise<boolean> {
		const existed = this.runtime.hasTarget(this.resource);
		if (existed) return true;
		await this.runtime.ensureTarget(this.resource);
		return false;
	}

	private async waitForEditor(uri: URI, signal: AbortSignal | undefined): Promise<void> {
		const startedAt = Date.now();
		while (Date.now() - startedAt < editorTimeoutMs) {
			if (signal?.aborted) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'ABORTED',
					uri: uri.toString(true),
				});
			}
			if (!this.runtime.hasTarget(this.resource)) {
				throw fetchError(FetchErrorCode.InteractiveTargetClosed, {
					targetId: this.targetId,
					uri: uri.toString(true),
				});
			}
			if (this.runtime.getPresentation(this.resource) === 'editor') return;
			await sleep(editorPollMs);
		}
		throw fetchError(FetchErrorCode.InteractiveTargetTimedOut, {
			targetId: this.targetId,
			uri: uri.toString(true),
			phase: 'opening',
			timeoutMs: editorTimeoutMs,
		});
	}

	private async loadNow(uri: URI, options: FetchPageLoadOptions): Promise<FetchPageSnapshot> {
		if (options.signal?.aborted) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, {
				status: 'ABORTED',
				uri: uri.toString(true),
			});
		}
		const existed = await this.ensureTarget();
		if (this.presentation === 'browserEditor' && !existed) {
			this.callbacks.onBrowserEditorRequired(this.resource, uri);
		}
		if (this.presentation === 'browserEditor') {
			await this.waitForEditor(uri, options.signal);
		}

		let navigationCompleted = false;
		let navigationError: unknown;
		void this.runtime.loadUri(this.resource, uri).then(
			() => {
				navigationCompleted = true;
			},
			error => {
				navigationError = error;
			},
		);
		const startedAt = Date.now();
		let stableSince: number | undefined;
		let stableKey = '';
		let lastAdmissionRejection: unknown;
		while (Date.now() - startedAt < options.timeoutMs) {
			if (options.signal?.aborted) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'ABORTED',
					uri: uri.toString(true),
				});
			}
			if (!this.runtime.hasTarget(this.resource)) {
				throw fetchError(
					this.presentation === 'browserEditor'
						? FetchErrorCode.InteractiveTargetClosed
						: FetchErrorCode.HttpRequestFailed,
					{ status: 'TARGET_CLOSED', targetId: this.targetId, uri: uri.toString(true) },
				);
			}
			if (navigationError) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'NAVIGATION_FAILED',
					statusText: navigationError instanceof Error ? navigationError.message : String(navigationError),
					targetId: this.targetId,
					uri: uri.toString(true),
				});
			}
			const observed = await this.runtime.getSnapshot(
				this.resource,
				Math.min(1500, options.timeoutMs),
			);
			if (navigationError) {
				throw fetchError(FetchErrorCode.HttpRequestFailed, {
					status: 'NAVIGATION_FAILED',
					statusText: navigationError instanceof Error ? navigationError.message : String(navigationError),
					targetId: this.targetId,
					uri: uri.toString(true),
				});
			}
			if (observed) {
				const snapshot: FetchPageSnapshot = {
					resource: this.resource,
					presentation: this.presentation,
					requestedUri: uri,
					finalUri: URI.parse(observed.url),
					statusCode: observed.statusCode,
					html: observed.html,
					documentReadyState: observed.documentReadyState,
				};
				if (navigationCompleted) {
					const admission = options.admitSnapshot(snapshot);
					if (admission.ready) {
						lastAdmissionRejection = undefined;
						const nextStableKey = `${snapshot.finalUri.toString(true)}\u0000${admission.stabilityKey ?? snapshot.html}`;
						if (nextStableKey !== stableKey) {
							stableKey = nextStableKey;
							stableSince = Date.now();
						}
						if (
							stableSince !== undefined &&
							Date.now() - stableSince >= Math.max(0, options.settleMs ?? 0)
						) {
							return snapshot;
						}
					} else {
						stableKey = '';
						stableSince = undefined;
						if (admission.rejection !== undefined) {
							lastAdmissionRejection = admission.rejection;
						}
					}
				}
			}
			await sleep(pagePollMs);
		}
		if (this.presentation === 'background' && lastAdmissionRejection !== undefined) {
			throw lastAdmissionRejection;
		}
		const lastRejectionDetails = getFetchErrorDetails(lastAdmissionRejection);
		throw fetchError(
			this.presentation === 'browserEditor'
				? FetchErrorCode.InteractiveTargetTimedOut
				: FetchErrorCode.HttpRequestFailed,
			{
				status: 'TIMEOUT',
				targetId: this.targetId,
				uri: uri.toString(true),
				timeoutMs: options.timeoutMs,
				lastRejectionCode: getFetchErrorCode(lastAdmissionRejection) || undefined,
				proof: lastRejectionDetails?.proof,
				accessGate: lastRejectionDetails?.accessGate,
			},
		);
	}

	private async disposeNow(): Promise<void> {
		await this.queue;
		if (
			this.runtime.hasTarget(this.resource) &&
			this.runtime.getPresentation(this.resource) === 'background'
		) {
			await this.runtime.destroyTarget(this.resource);
		}
	}

	dispose(): Promise<void> {
		if (!this.disposePromise) {
			this.disposed = true;
			this.disposePromise = this.disposeNow();
		}
		return this.disposePromise;
	}
}
