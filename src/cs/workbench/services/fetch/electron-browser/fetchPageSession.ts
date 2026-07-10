/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from 'cs/base/browser/window';
import { CancellationError, type CancellationToken } from 'cs/base/common/cancellation';
import { ProxyChannel } from 'cs/base/parts/ipc/common/ipc';
import { generateUuid } from 'cs/base/common/uuid';
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

	private constructor(
		readonly sessionId: string,
		readonly pageId: string,
		readonly ownership: FetchPageOwnership,
		private readonly browserViewService: IBrowserViewService,
		private readonly playwrightService: IPlaywrightService,
		private readonly admission: FetchSnapshotAdmission,
		private readonly ownsTracking: boolean,
	) {}

	static async createOwned(
		mainProcessService: IMainProcessService,
		playwrightService: IPlaywrightService,
		admission: FetchSnapshotAdmission,
	): Promise<FetchPageSession> {
		const browserViewService = ProxyChannel.toService<IBrowserViewService>(
			mainProcessService.getChannel(ipcBrowserViewChannelName),
		);
		const sessionId = `fetch:${generateUuid()}`;
		const pageId = generateUuid();
		await browserViewService.getOrCreateBrowserView(pageId, {
			owner: { mainWindowId: mainWindow.vscodeWindowId, sessionId },
			sessionOptions: { scope: BrowserViewStorageScopes.Global },
			presentation: 'background',
		});
		await playwrightService.startTrackingPage(pageId);
		return new FetchPageSession(sessionId, pageId, 'owned-background', browserViewService, playwrightService, admission, true);
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
		const wasTracked = await playwrightService.isPageTracked(pageId);
		if (!wasTracked) {
			await playwrightService.startTrackingPage(pageId);
		}
		return new FetchPageSession(`fetch:${generateUuid()}`, pageId, 'borrowed-interactive', browserViewService, playwrightService, admission, !wasTracked);
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
		const snapshot = await this.playwrightService.captureSnapshot(this.sessionId, this.pageId, { readiness }, token);
		if (!this.admission(uri, snapshot.uri)) {
			throw new Error(`Snapshot URI "${snapshot.uri.toString(true)}" was not admitted for "${uri.toString(true)}".`);
		}
		return snapshot;
	}

	async dispose(): Promise<void> {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		try {
			if (this.ownsTracking) {
				await this.playwrightService.stopTrackingPage(this.pageId);
			}
			if (this.ownership === 'owned-background') {
				await this.browserViewService.destroyBrowserView(this.pageId);
			}
		} finally {
			await this.playwrightService.disposeSession(this.sessionId);
		}
	}

	private _assertActive(): void {
		if (this.disposed) {
			throw new Error('Fetch page session is disposed.');
		}
	}
}

export class FetchPageSessionFactory {
	constructor(
		@IMainProcessService private readonly mainProcessService: IMainProcessService,
		@IPlaywrightService private readonly playwrightService: IPlaywrightService,
	) {}

	createOwned(admission: FetchSnapshotAdmission): Promise<FetchPageSession> {
		return FetchPageSession.createOwned(this.mainProcessService, this.playwrightService, admission);
	}

	borrow(pageId: string, admission: FetchSnapshotAdmission): Promise<FetchPageSession> {
		return FetchPageSession.borrow(pageId, this.mainProcessService, this.playwrightService, admission);
	}
}
