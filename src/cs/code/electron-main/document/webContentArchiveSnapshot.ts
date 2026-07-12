/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { appError } from 'cs/base/parts/sandbox/common/appError';
import { BrowserViewErrorCode } from 'cs/platform/browserView/common/browserView';
import type { IPlaywrightService } from 'cs/platform/browserView/common/playwrightService';

const HtmlArchiveSnapshotSessionId = 'html-archive-snapshot';

export function canonicalizeWebContentArchiveUrl(value: string): string {
	const url = new URL(value);
	if (url.protocol !== 'http:' && url.protocol !== 'https:') {
		throw new Error(`Web content archive does not support the '${url.protocol}' protocol.`);
	}
	return url.toString();
}

/** Captures the addressed BrowserView document and enforces exact URI admission. */
export async function captureWebContentArchiveSnapshot(
	targetId: string,
	pageUrl: string,
	playwrightService: IPlaywrightService,
	token: CancellationToken,
) {
	const requestedUrl = canonicalizeWebContentArchiveUrl(pageUrl);
	if (!targetId) {
		throw appError(BrowserViewErrorCode.PreviewNotReady);
	}

	const trackingLease = await playwrightService.acquirePageTracking(targetId);
	try {
		const snapshot = await playwrightService.captureSnapshot(
			HtmlArchiveSnapshotSessionId,
			trackingLease,
			undefined,
			token,
		);
		if (
			snapshot.pageId !== targetId
			|| canonicalizeWebContentArchiveUrl(snapshot.uri.toString(true)) !== requestedUrl
		) {
			throw appError(BrowserViewErrorCode.PreviewNotReady);
		}
		return snapshot;
	} finally {
		await playwrightService.releasePageTracking(trackingLease);
	}
}
