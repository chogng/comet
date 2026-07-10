/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import { BrowserViewStorageScope } from 'cs/platform/browserView/common/browserView';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import {
	getWebContentDocumentSnapshot,
	type BrowserViewMainService,
} from 'cs/platform/browserView/electron-main/browserViewMainService';
import { getMainWindow } from 'cs/platform/windows/electron-main/windows';
import { FetchErrorCode, fetchError } from 'cs/workbench/services/fetch/common/fetchErrors';
import { FetchPageSession } from 'cs/workbench/services/fetch/electron-main/fetchPageSession';
import type {
	FetchPageSessionCallbacks,
	FetchPageSessionRequest,
	FetchPageSessionRuntime,
} from 'cs/workbench/services/fetch/electron-main/fetchPageSession';

function getTargetId(resource: URI): string {
	const targetId = BrowserViewUri.getId(resource);
	if (!targetId) throw new Error(`Invalid Fetch page resource: ${resource.toString()}`);
	return targetId;
}

class BrowserViewFetchPageRuntime implements FetchPageSessionRuntime {
	constructor(private readonly browserViewService: BrowserViewMainService) {}

	hasTarget(resource: URI): boolean {
		return this.browserViewService.tryGetTarget(getTargetId(resource)) !== undefined;
	}

	async ensureTarget(resource: URI): Promise<void> {
		const ownerWindow = getMainWindow();
		if (!ownerWindow || ownerWindow.isDestroyed()) {
			throw fetchError(FetchErrorCode.HttpRequestFailed, { status: 'WINDOW_UNAVAILABLE' });
		}
		await this.browserViewService.getOrCreateBrowserView(getTargetId(resource), {
			owner: { mainWindowId: ownerWindow.id },
			sessionOptions: { scope: BrowserViewStorageScope.Global },
			presentation: 'background',
		});
	}

	getPresentation(resource: URI): 'background' | 'editor' | undefined {
		return this.browserViewService.getTargetPresentation(getTargetId(resource));
	}

	async loadUri(resource: URI, uri: URI): Promise<void> {
		await this.browserViewService.loadURL(getTargetId(resource), uri.toString(true));
	}

	getSnapshot(resource: URI, timeoutMs: number) {
		return getWebContentDocumentSnapshot(getTargetId(resource), { timeoutMs });
	}

	async destroyTarget(resource: URI): Promise<void> {
		await this.browserViewService.destroyBrowserView(getTargetId(resource));
	}
}

export class FetchPageSessionService {
	private readonly runtime: FetchPageSessionRuntime;

	constructor(browserViewService: BrowserViewMainService) {
		this.runtime = new BrowserViewFetchPageRuntime(browserViewService);
	}

	createSession(
		request: FetchPageSessionRequest,
		callbacks: FetchPageSessionCallbacks,
	): FetchPageSession {
		return new FetchPageSession(this.runtime, request.presentation, callbacks);
	}
}
