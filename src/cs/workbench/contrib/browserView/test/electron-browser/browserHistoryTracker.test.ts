/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Emitter } from 'cs/base/common/event';
import { BrowserHistoryStore } from 'cs/platform/browserView/common/browserHistory';
import type {
	IBrowserViewFaviconChangeEvent,
	IBrowserViewNavigationEvent,
	IBrowserViewTitleChangeEvent,
} from 'cs/platform/browserView/common/browserView';
import { BrowserHistoryTracker } from 'cs/workbench/contrib/browserView/electron-browser/browserHistoryTracker';

test('browser history tracker records committed visits and refines replaced entries', () => {
	const onWillNavigate = new Emitter<string>();
	const onDidNavigate = new Emitter<IBrowserViewNavigationEvent>();
	const onDidChangeTitle = new Emitter<IBrowserViewTitleChangeEvent>();
	const onDidChangeFavicon = new Emitter<IBrowserViewFaviconChangeEvent>();
	const history = new BrowserHistoryStore();
	const faviconData = 'data:image/png;base64,aWNvbg==';
	let favicon: string | undefined;
	const tracker = new BrowserHistoryTracker({
		get favicon() { return favicon; },
		onWillNavigate: onWillNavigate.event,
		onDidNavigate: onDidNavigate.event,
		onDidChangeTitle: onDidChangeTitle.event,
		onDidChangeFavicon: onDidChangeFavicon.event,
	}, history);

	try {
		onWillNavigate.fire('https://example.com/start');
		onDidNavigate.fire(createNavigationEvent('https://example.com/start', 'Start', 0));
		favicon = faviconData;
		onDidChangeFavicon.fire({ favicon });
		onDidChangeTitle.fire({ title: 'Loaded' });
		onDidNavigate.fire(createNavigationEvent('https://example.com/final', 'Final', 0));
		onDidNavigate.fire(createNavigationEvent('https://example.com/next', 'Next', 1));
		onDidNavigate.fire(createNavigationEvent('https://example.com/next#section', 'Section', 1));
		favicon = undefined;
		onDidNavigate.fire(createNavigationEvent('about:blank', '', 2));
		onDidChangeTitle.fire({ title: 'Ignored' });
		onDidNavigate.fire(createNavigationEvent('file:///tmp/report.html', 'Report', 3));

		assert.deepEqual(
			history.entries.items.map(entry => ({
				url: entry.url,
				title: entry.title,
				explicit: entry.explicit,
				favicon: entry.icon ? history.favicons.get(entry.icon) : undefined,
			})),
			[
				{
					url: 'https://example.com/final',
					title: 'Final',
					explicit: true,
					favicon: faviconData,
				},
				{
					url: 'https://example.com/next#section',
					title: 'Section',
					explicit: undefined,
					favicon: faviconData,
				},
				{
					url: 'file:///tmp/report.html',
					title: 'Report',
					explicit: undefined,
					favicon: undefined,
				},
			],
		);
	} finally {
		tracker.dispose();
		history.dispose();
		onWillNavigate.dispose();
		onDidNavigate.dispose();
		onDidChangeTitle.dispose();
		onDidChangeFavicon.dispose();
	}
});

function createNavigationEvent(url: string, title: string, navigationEntryIndex: number): IBrowserViewNavigationEvent {
	return {
		url,
		title,
		navigationEntryIndex,
		canGoBack: navigationEntryIndex > 0,
		canGoForward: false,
		certificateError: undefined,
	};
}
