/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise } from 'cs/base/common/async';
import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import { ProxyChannel } from 'cs/base/parts/ipc/common/ipc';
import { generateUuid } from 'cs/base/common/uuid';
import type { CodeWindow } from 'cs/base/browser/window';
import type { IBrowserViewService } from 'cs/platform/browserView/common/browserView';
import { BrowserViewStorageScope as BrowserViewStorageScopes, ipcBrowserViewChannelName } from 'cs/platform/browserView/common/browserView';
import type {
	IBrowserPageSnapshot,
	IPageSnapshotReadiness,
} from 'cs/platform/browserView/common/playwrightService';
import { IPlaywrightService } from 'cs/platform/browserView/common/playwrightService';
import { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { URI } from 'cs/base/common/uri';

export type FetchPageOwnership = 'owned-background' | 'borrowed-interactive';

const fetchPageSnapshotMaximumBytes = 2 * 1024 * 1024;

export interface IFetchPageSession {
	readonly sessionId: string;
	readonly pageId: string;
	readonly ownership: FetchPageOwnership;
	navigateAndCapture(uri: URI, readiness: IPageSnapshotReadiness | undefined, token: CancellationToken): Promise<IBrowserPageSnapshot>;
	dispose(): Promise<void>;
}

export type FetchSnapshotAdmission = (targetUri: URI, snapshotUri: URI) => boolean;

export const IFetchPageSessionFactory = createDecorator<FetchPageSessionFactory>('fetchPageSessionFactory');

type BorrowedPageTrackingOwnership = 'external' | 'fetch';

interface BorrowedPageTrackingEntry {
	readonly pageId: string;
	readonly ready: Promise<void>;
	referenceCount: number;
	ownership: BorrowedPageTrackingOwnership | undefined;
	closingPromise: Promise<void> | undefined;
}

class BorrowedPageTrackingLease {
	private released = false;
	private releasePromise: Promise<void> | undefined;

	constructor(
		private readonly pool: BorrowedPageTrackingLeasePool,
		private readonly entry: BorrowedPageTrackingEntry,
	) {}

	async release(): Promise<void> {
		if (this.released) {
			return;
		}
		if (this.releasePromise) {
			return this.releasePromise;
		}
		this.releasePromise = this.releaseOnce();
		try {
			await this.releasePromise;
		} finally {
			this.releasePromise = undefined;
		}
	}

	private async releaseOnce(): Promise<void> {
		await this.pool.release(this.entry);
		this.released = true;
	}
}

class BorrowedPageTrackingLeasePool {
	private readonly entries = new Map<string, BorrowedPageTrackingEntry>();

	constructor(private readonly playwrightService: IPlaywrightService) {}

	async acquire(pageId: string): Promise<BorrowedPageTrackingLease> {
		while (true) {
			const existing = this.entries.get(pageId);
			if (existing?.closingPromise) {
				await existing.closingPromise;
				continue;
			}

			const entry = existing ?? this.createEntry(pageId);
			entry.referenceCount += 1;
			try {
				await entry.ready;
				return new BorrowedPageTrackingLease(this, entry);
			} catch (error) {
				entry.referenceCount -= 1;
				if (
					entry.referenceCount === 0
					&& entry.ownership !== 'fetch'
					&& this.entries.get(pageId) === entry
				) {
					this.entries.delete(pageId);
				}
				throw error;
			}
		}
	}

	async release(entry: BorrowedPageTrackingEntry): Promise<void> {
		if (this.entries.get(entry.pageId) !== entry || entry.referenceCount <= 0) {
			throw new Error(`Borrowed Fetch page tracking lease for "${entry.pageId}" is not active.`);
		}
		if (entry.referenceCount > 1) {
			entry.referenceCount -= 1;
			return;
		}
		if (entry.ownership === 'external') {
			entry.referenceCount = 0;
			this.entries.delete(entry.pageId);
			return;
		}
		if (entry.ownership !== 'fetch') {
			throw new Error(`Borrowed Fetch page tracking lease for "${entry.pageId}" has no owner.`);
		}

		await this.runClosing(entry, async () => {
			await this.playwrightService.releasePageTracking(entry.pageId);
			entry.ownership = undefined;
			entry.referenceCount = 0;
			if (this.entries.get(entry.pageId) === entry) {
				this.entries.delete(entry.pageId);
			}
		});
	}

	private createEntry(pageId: string): BorrowedPageTrackingEntry {
		const ready = new DeferredPromise<void>();
		const entry: BorrowedPageTrackingEntry = {
			pageId,
			ready: ready.p,
			referenceCount: 0,
			ownership: undefined,
			closingPromise: undefined,
		};
		this.entries.set(pageId, entry);
		ready.complete(this.initializeEntry(entry));
		return entry;
	}

	private async initializeEntry(entry: BorrowedPageTrackingEntry): Promise<void> {
		const acquisition = await this.playwrightService.acquirePageTracking(entry.pageId);
		entry.ownership = acquisition.acquired ? 'fetch' : 'external';
	}

	private async runClosing(
		entry: BorrowedPageTrackingEntry,
		operation: () => Promise<void>,
	): Promise<void> {
		if (entry.closingPromise) {
			return entry.closingPromise;
		}
		const closing = new DeferredPromise<void>();
		entry.closingPromise = closing.p;
		closing.complete(operation());
		try {
			await closing.p;
		} finally {
			if (entry.closingPromise === closing.p) {
				entry.closingPromise = undefined;
			}
		}
	}
}

export class FetchPageSession implements IFetchPageSession {
	private disposed = false;
	private disposeStarted = false;
	private disposePromise: Promise<void> | undefined;
	private trackingReleased: boolean;
	private borrowedTrackingReleased: boolean;
	private browserViewReleased: boolean;
	private playwrightSessionReleased = false;

	private constructor(
		readonly sessionId: string,
		readonly pageId: string,
		readonly ownership: FetchPageOwnership,
		private readonly browserViewService: IBrowserViewService,
		private readonly playwrightService: IPlaywrightService,
		private readonly admission: FetchSnapshotAdmission,
		ownsTracking: boolean,
		private readonly borrowedTrackingLease?: BorrowedPageTrackingLease,
	) {
		this.trackingReleased = !ownsTracking;
		this.borrowedTrackingReleased = !borrowedTrackingLease;
		this.browserViewReleased = ownership !== 'owned-background';
	}

	static async createOwned(
		mainProcessService: IMainProcessService,
		playwrightService: IPlaywrightService,
		admission: FetchSnapshotAdmission,
		mainWindowId: number,
	): Promise<FetchPageSession> {
		const browserViewService = ProxyChannel.toService<IBrowserViewService>(
			mainProcessService.getChannel(ipcBrowserViewChannelName),
		);
		const sessionId = `fetch:${generateUuid()}`;
		const pageId = generateUuid();
		await browserViewService.getOrCreateBrowserView(pageId, {
			owner: { mainWindowId, sessionId },
			sessionOptions: { scope: BrowserViewStorageScopes.Global },
			presentation: 'background',
		});
		try {
			const acquisition = await playwrightService.acquirePageTracking(pageId);
			return new FetchPageSession(
				sessionId,
				pageId,
				'owned-background',
				browserViewService,
				playwrightService,
				admission,
				acquisition.acquired,
			);
		} catch (error) {
			const session = new FetchPageSession(
				sessionId,
				pageId,
				'owned-background',
				browserViewService,
				playwrightService,
				admission,
				false,
			);
			return this._disposeFailedCreation(
				session,
				error,
				'Failed to create and clean up an owned Fetch page session.',
			);
		}
	}

	static async borrow(
		pageId: string,
		mainProcessService: IMainProcessService,
		playwrightService: IPlaywrightService,
		trackingLeasePool: BorrowedPageTrackingLeasePool,
		admission: FetchSnapshotAdmission,
	): Promise<FetchPageSession> {
		const browserViewService = ProxyChannel.toService<IBrowserViewService>(
			mainProcessService.getChannel(ipcBrowserViewChannelName),
		);
		const sessionId = `fetch:${generateUuid()}`;
		let trackingLease: BorrowedPageTrackingLease;
		try {
			trackingLease = await trackingLeasePool.acquire(pageId);
		} catch (error) {
			try {
				await playwrightService.disposeSession(sessionId);
			} catch (cleanupError) {
				throw new AggregateError(
					[error, cleanupError],
					'Failed to borrow and clean up a Fetch page session.',
				);
			}
			throw error;
		}
		return new FetchPageSession(
			sessionId,
			pageId,
			'borrowed-interactive',
			browserViewService,
			playwrightService,
			admission,
			false,
			trackingLease,
		);
	}

	private static async _disposeFailedCreation(
		session: FetchPageSession,
		creationError: unknown,
		message: string,
	): Promise<never> {
		try {
			await session.dispose();
		} catch (cleanupError) {
			const cleanupErrors = cleanupError instanceof AggregateError
				? cleanupError.errors
				: [cleanupError];
			throw new AggregateError([creationError, ...cleanupErrors], message);
		}
		throw creationError;
	}

	async navigateAndCapture(uri: URI, readiness: IPageSnapshotReadiness | undefined, token: CancellationToken): Promise<IBrowserPageSnapshot> {
		this._assertActive();
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		await this.browserViewService.loadURL(this.pageId, uri.toString(true));
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const snapshot = await this.playwrightService.captureSnapshot(this.sessionId, this.pageId, {
			readiness,
			maximumBytes: fetchPageSnapshotMaximumBytes,
		}, token);
		if (!this.admission(uri, snapshot.uri)) {
			throw new Error(`Snapshot URI "${snapshot.uri.toString(true)}" was not admitted for "${uri.toString(true)}".`);
		}
		return snapshot;
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		if (this.disposePromise) {
			return this.disposePromise;
		}
		this.disposeStarted = true;
		this.disposePromise = this._disposeResources();
		try {
			await this.disposePromise;
		} finally {
			this.disposePromise = undefined;
		}
	}

	private _assertActive(): void {
		if (this.disposed || this.disposeStarted) {
			throw new Error('Fetch page session is disposed.');
		}
	}

	private async _disposeResources(): Promise<void> {
		const errors: unknown[] = [];
		if (!this.borrowedTrackingReleased) {
			try {
				await this.borrowedTrackingLease!.release();
				this.borrowedTrackingReleased = true;
			} catch (error) {
				errors.push(error);
			}
		}
		if (!this.trackingReleased) {
			try {
				await this.playwrightService.releasePageTracking(this.pageId);
				this.trackingReleased = true;
			} catch (error) {
				errors.push(error);
			}
		}
		if (!this.browserViewReleased) {
			try {
				await this.browserViewService.destroyBrowserView(this.pageId);
				this.browserViewReleased = true;
			} catch (error) {
				errors.push(error);
			}
		}
		if (!this.playwrightSessionReleased) {
			try {
				await this.playwrightService.disposeSession(this.sessionId);
				this.playwrightSessionReleased = true;
			} catch (error) {
				errors.push(error);
			}
		}
		this.disposed = this.trackingReleased
			&& this.borrowedTrackingReleased
			&& this.browserViewReleased
			&& this.playwrightSessionReleased;
		if (errors.length > 0) {
			throw new AggregateError(errors, 'Failed to dispose a Fetch page session.');
		}
	}
}

export class FetchPageSessionFactory {
	private readonly borrowedTrackingLeasePool: BorrowedPageTrackingLeasePool;

	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) {
		this.borrowedTrackingLeasePool = new BorrowedPageTrackingLeasePool(playwrightService);
	}

	createOwned(admission: FetchSnapshotAdmission): Promise<FetchPageSession> {
		const mainWindow = window as CodeWindow;
		return FetchPageSession.createOwned(this.mainProcessService, this.playwrightService, admission, mainWindow.vscodeWindowId);
	}

	borrow(pageId: string, admission: FetchSnapshotAdmission): Promise<FetchPageSession> {
		return FetchPageSession.borrow(
			pageId,
			this.mainProcessService,
			this.playwrightService,
			this.borrowedTrackingLeasePool,
			admission,
		);
	}
}
