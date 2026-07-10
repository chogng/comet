/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import { Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import type { IPlaywrightService } from 'cs/platform/browserView/common/playwrightService';
import type { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';

const { FetchPageSession } = await import('cs/workbench/services/fetch/electron-browser/fetchPageSession');

type BrowserViewCall = { command: string; args: unknown[] };

function createBrowserViewChannel(calls: BrowserViewCall[], loadError?: Error): IChannel {
	return {
		call: async <T>(command: string, arg: unknown) => {
			const args = Array.isArray(arg) ? arg : [];
			calls.push({ command, args });
			if (command === 'loadURL' && loadError) {
				throw loadError;
			}
			return undefined as T;
		},
		listen: () => Event.None,
	};
}

function createPlaywrightService(options: { tracked?: boolean; snapshot?: { uri: URI; title: string; html: string } } = {}) {
	const calls: string[] = [];
	const service = {
		startTrackingPage: async () => { calls.push('startTrackingPage'); },
		stopTrackingPage: async () => { calls.push('stopTrackingPage'); },
		isPageTracked: async () => options.tracked ?? false,
		captureSnapshot: async () => {
			calls.push('captureSnapshot');
			const snapshot = options.snapshot ?? { uri: URI.parse('https://example.com/loaded'), title: 'Loaded', html: '<html></html>' };
			return { pageId: 'page', ...snapshot, capturedAt: Date.now() };
		},
		disposeSession: async () => { calls.push('disposeSession'); },
	} as unknown as IPlaywrightService;
	return { calls, service };
}

test('owned FetchPageSession does not capture after navigation fails and releases its BrowserView', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService();
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls, new Error('Navigation failed')),
	} as unknown as IMainProcessService;
	const session = await FetchPageSession.createOwned(mainProcessService, playwrightService, () => true, 1);

	await assert.rejects(
		session.navigateAndCapture(URI.parse('https://example.com/target'), undefined, CancellationTokenNone),
		/Navigation failed/,
	);
	assert.deepEqual(playwrightCalls, ['startTrackingPage']);

	await session.dispose();
	assert.deepEqual(playwrightCalls, ['startTrackingPage', 'stopTrackingPage', 'disposeSession']);
	assert.deepEqual(calls.map(call => call.command), ['getOrCreateBrowserView', 'loadURL', 'destroyBrowserView']);
});

test('borrowed FetchPageSession leaves an already tracked BrowserView alive and rejects an inadmissible snapshot', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService({
		tracked: true,
		snapshot: { uri: URI.parse('https://example.com/redirected'), title: 'Redirected', html: '<html></html>' },
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const session = await FetchPageSession.borrow('existing-page', mainProcessService, playwrightService, (target, snapshot) => target.authority === snapshot.authority && target.path === snapshot.path);

	await assert.rejects(
		session.navigateAndCapture(URI.parse('https://example.com/target'), undefined, CancellationTokenNone),
		/Snapshot URI/,
	);
	await session.dispose();

	assert.deepEqual(playwrightCalls, ['captureSnapshot', 'disposeSession']);
	assert.deepEqual(calls.map(call => call.command), ['loadURL']);
});
