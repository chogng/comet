/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { URI } from 'cs/base/common/uri';
import { captureWebContentArchiveSnapshot } from 'cs/code/electron-main/document/webContentArchiveSnapshot';
import type {
	IBrowserPageSnapshot,
	IPageSnapshotOptions,
	IPageTrackingLease,
	IPlaywrightService,
} from 'cs/platform/browserView/common/playwrightService';

function createSnapshotService(snapshot: IBrowserPageSnapshot) {
	const captureCalls: Array<{
		readonly sessionId: string;
		readonly pageId: string;
		readonly options: IPageSnapshotOptions | undefined;
		readonly token: unknown;
	}> = [];
	const trackingLease: IPageTrackingLease = { viewId: snapshot.pageId, leaseId: 'archive-lease' };
	const releasedLeases: IPageTrackingLease[] = [];
	const service = {
		acquirePageTracking: async () => trackingLease,
		captureSnapshot: async (
			sessionId: string,
			lease: IPageTrackingLease,
			options: IPageSnapshotOptions | undefined,
			token: CancellationToken,
		) => {
			captureCalls.push({ sessionId, pageId: lease.viewId, options, token });
			return snapshot;
		},
		releasePageTracking: async (lease: IPageTrackingLease) => {
			releasedLeases.push(lease);
		},
	} as unknown as IPlaywrightService;
	return { service, captureCalls, releasedLeases, trackingLease };
}

test('web content archive captures the addressed query and fragment URL with the platform deadline', async () => {
	const pageUrl = 'https://example.com/article?issue=7#/document/2!';
	const snapshot: IBrowserPageSnapshot = {
		pageId: 'browser-view-1',
		uri: URI.parse(pageUrl),
		title: 'Article',
		html: '<html><body>Article</body></html>',
		capturedAt: 1,
	};
	const { service, captureCalls, releasedLeases, trackingLease } = createSnapshotService(snapshot);
	const cancellationSource = new CancellationTokenSource();

	try {
		assert.equal(
			await captureWebContentArchiveSnapshot(
				'browser-view-1',
				pageUrl,
				service,
				cancellationSource.token,
			),
			snapshot,
		);
		assert.deepEqual(captureCalls, [{
			sessionId: 'html-archive-snapshot',
			pageId: 'browser-view-1',
			options: undefined,
			token: cancellationSource.token,
		}]);
		assert.deepEqual(releasedLeases, [trackingLease]);
	} finally {
		cancellationSource.dispose();
	}
});

test('web content archive rejects a fragment route that differs only by trailing punctuation', async () => {
	const snapshot: IBrowserPageSnapshot = {
		pageId: 'browser-view-1',
		uri: URI.parse('https://example.com/article?issue=7#/document/2!'),
		title: 'Article',
		html: '<html><body>Article</body></html>',
		capturedAt: 1,
	};
	const { service, releasedLeases, trackingLease } = createSnapshotService(snapshot);
	const cancellationSource = new CancellationTokenSource();

	try {
		await assert.rejects(captureWebContentArchiveSnapshot(
			'browser-view-1',
			'https://example.com/article?issue=7#/document/2',
			service,
			cancellationSource.token,
		));
		assert.deepEqual(releasedLeases, [trackingLease]);
	} finally {
		cancellationSource.dispose();
	}
});
