/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import { ProxyChannel } from 'cs/base/parts/ipc/common/ipc';
import { generateUuid } from 'cs/base/common/uuid';
import type { CodeWindow } from 'cs/base/browser/window';
import type { IBrowserViewService } from 'cs/platform/browserView/common/browserView';
import { BrowserViewStorageScope as BrowserViewStorageScopes, ipcBrowserViewChannelName } from 'cs/platform/browserView/common/browserView';
import type {
	IBrowserPageSnapshot,
	IPageSnapshotReadiness,
	IPageTrackingLease,
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

export class FetchPageSession implements IFetchPageSession {
	private disposed = false;
	private disposeStarted = false;
	private disposePromise: Promise<void> | undefined;
	private trackingReleased: boolean;
	private browserViewReleased: boolean;
	private playwrightSessionReleased = false;

	private constructor(
		readonly sessionId: string,
		readonly pageId: string,
		readonly ownership: FetchPageOwnership,
		private readonly browserViewService: IBrowserViewService,
		private readonly playwrightService: IPlaywrightService,
		private readonly admission: FetchSnapshotAdmission,
		private readonly trackingLease: IPageTrackingLease | undefined,
	) {
		this.trackingReleased = !trackingLease;
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
			const trackingLease = await playwrightService.acquirePageTracking(pageId);
			return new FetchPageSession(
				sessionId,
				pageId,
				'owned-background',
				browserViewService,
				playwrightService,
				admission,
				trackingLease,
			);
		} catch (error) {
			const session = new FetchPageSession(
				sessionId,
				pageId,
				'owned-background',
				browserViewService,
				playwrightService,
				admission,
				undefined,
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
		admission: FetchSnapshotAdmission,
	): Promise<FetchPageSession> {
		const browserViewService = ProxyChannel.toService<IBrowserViewService>(
			mainProcessService.getChannel(ipcBrowserViewChannelName),
		);
		const sessionId = `fetch:${generateUuid()}`;
		let trackingLease: IPageTrackingLease;
		try {
			trackingLease = await playwrightService.acquirePageTracking(pageId);
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
		await this.playwrightService.navigatePage(this.sessionId, this.trackingLease!, uri.toString(true), token);
		if (token.isCancellationRequested) {
			throw new CancellationError();
		}
		const snapshot = await this.playwrightService.captureSnapshot(this.sessionId, this.trackingLease!, {
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
		if (!this.trackingReleased) {
			try {
				await this.playwrightService.releasePageTracking(this.trackingLease!);
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
			&& this.browserViewReleased
			&& this.playwrightSessionReleased;
		if (errors.length > 0) {
			throw new AggregateError(errors, 'Failed to dispose a Fetch page session.');
		}
	}
}

export class FetchPageSessionFactory {
	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) {}

	createOwned(admission: FetchSnapshotAdmission): Promise<FetchPageSession> {
		const mainWindow = window as CodeWindow;
		return FetchPageSession.createOwned(this.mainProcessService, this.playwrightService, admission, mainWindow.vscodeWindowId);
	}

	borrow(pageId: string, admission: FetchSnapshotAdmission): Promise<FetchPageSession> {
		return FetchPageSession.borrow(
			pageId,
			this.mainProcessService,
			this.playwrightService,
			admission,
		);
	}
}
