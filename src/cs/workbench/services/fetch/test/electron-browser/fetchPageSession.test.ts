/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CancellationTokenNone, CancellationTokenSource } from 'cs/base/common/cancellation';
import { Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import type { IPageSnapshotOptions, IPageTrackingLease, IPlaywrightService } from 'cs/platform/browserView/common/playwrightService';
import type { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';

const { FetchPageSession, FetchPageSessionFactory } = await import('cs/workbench/services/fetch/electron-browser/fetchPageSession');

type BrowserViewCall = { command: string; args: unknown[] };

interface BrowserViewChannelOptions {
	readonly destroyErrors?: readonly Error[];
}

function createBrowserViewChannel(calls: BrowserViewCall[], options: BrowserViewChannelOptions = {}): IChannel {
	const destroyErrors = [...(options.destroyErrors ?? [])];
	return {
		call: async <T>(command: string, arg: unknown) => {
			const args = Array.isArray(arg) ? arg : [];
			calls.push({ command, args });
			if (command === 'destroyBrowserView' && destroyErrors.length > 0) {
				throw destroyErrors.shift();
			}
			return undefined as T;
		},
		listen: () => Event.None,
	};
}

interface PlaywrightServiceOptions {
	readonly tracked?: boolean;
	readonly snapshot?: { uri: URI; title: string; html: string };
	readonly acquireErrors?: readonly Error[];
	readonly navigateErrors?: readonly Error[];
	readonly releaseErrors?: readonly Error[];
	readonly disposeErrors?: readonly Error[];
}

function createPlaywrightService(options: PlaywrightServiceOptions = {}) {
	const calls: string[] = [];
	const captureOptions: Array<IPageSnapshotOptions | undefined> = [];
	const acquireErrors = [...(options.acquireErrors ?? [])];
	const navigateErrors = [...(options.navigateErrors ?? [])];
	const releaseErrors = [...(options.releaseErrors ?? [])];
	const disposeErrors = [...(options.disposeErrors ?? [])];
	const externalTracking = options.tracked ?? false;
	const leases = new Set<string>();
	let leaseSequence = 0;
	const service = {
		acquirePageTracking: async (viewId: string) => {
			calls.push('acquirePageTracking');
			if (acquireErrors.length > 0) {
				throw acquireErrors.shift();
			}
			const lease = { viewId, leaseId: `lease-${++leaseSequence}` };
			leases.add(lease.leaseId);
			return lease;
		},
		releasePageTracking: async (lease: IPageTrackingLease) => {
			calls.push('releasePageTracking');
			if (releaseErrors.length > 0) {
				throw releaseErrors.shift();
			}
			leases.delete(lease.leaseId);
		},
		isPageTracked: async () => externalTracking || leases.size > 0,
		navigatePage: async () => {
			calls.push('navigatePage');
			if (navigateErrors.length > 0) {
				throw navigateErrors.shift();
			}
		},
		captureSnapshot: async (_sessionId: string, trackingLease: IPageTrackingLease, snapshotOptions: IPageSnapshotOptions | undefined) => {
			calls.push('captureSnapshot');
			if (!externalTracking && leases.size === 0) {
				throw new Error('Page is not tracked.');
			}
			captureOptions.push(snapshotOptions);
			const snapshot = options.snapshot ?? { uri: URI.parse('https://example.com/loaded'), title: 'Loaded', html: '<html></html>' };
			return { pageId: trackingLease.viewId, ...snapshot, capturedAt: Date.now() };
		},
		disposeSession: async () => {
			calls.push('disposeSession');
			if (disposeErrors.length > 0) {
				throw disposeErrors.shift();
			}
		},
	} as unknown as IPlaywrightService;
	return { calls, captureOptions, service };
}

test('owned FetchPageSession does not capture after navigation fails and releases its BrowserView', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService({
		navigateErrors: [new Error('Navigation failed')],
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const session = await FetchPageSession.createOwned(mainProcessService, playwrightService, () => true, 1);

	await assert.rejects(
		session.navigateAndCapture(URI.parse('https://example.com/target'), undefined, CancellationTokenNone),
		/Navigation failed/,
	);
	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'navigatePage']);

	await session.dispose();
	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'navigatePage', 'releasePageTracking', 'disposeSession']);
	assert.deepEqual(calls.map(call => call.command), ['getOrCreateBrowserView', 'destroyBrowserView']);
});

test('borrowed FetchPageSession leaves an already tracked BrowserView alive and rejects an inadmissible snapshot', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, captureOptions, service: playwrightService } = createPlaywrightService({
		tracked: true,
		snapshot: { uri: URI.parse('https://example.com/redirected'), title: 'Redirected', html: '<html></html>' },
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const factory = new FetchPageSessionFactory(mainProcessService, playwrightService);
	const session = await factory.borrow('existing-page', (target, snapshot) => target.authority === snapshot.authority && target.path === snapshot.path);

	await assert.rejects(
		session.navigateAndCapture(URI.parse('https://example.com/target'), undefined, CancellationTokenNone),
		/Snapshot URI/,
	);
	await session.dispose();

	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'navigatePage', 'captureSnapshot', 'releasePageTracking', 'disposeSession']);
	assert.deepEqual(captureOptions, [{ readiness: undefined, maximumBytes: 2 * 1024 * 1024 }]);
	assert.deepEqual(calls, []);
});

test('borrowed FetchPageSession does not release tracking acquired by a competing external caller', async () => {
	const calls: string[] = [];
	const activeLeases = new Set<string>();
	let leaseSequence = 0;
	const playwrightService = {
		acquirePageTracking: async (viewId: string) => {
			calls.push('acquirePageTracking');
			const lease = { viewId, leaseId: `lease-${++leaseSequence}` };
			activeLeases.add(lease.leaseId);
			return lease;
		},
		releasePageTracking: async (lease: IPageTrackingLease) => {
			calls.push('releasePageTracking');
			activeLeases.delete(lease.leaseId);
		},
		disposeSession: async () => { calls.push('disposeSession'); },
	} as unknown as IPlaywrightService;
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel([]),
	} as unknown as IMainProcessService;
	const factory = new FetchPageSessionFactory(mainProcessService, playwrightService);

	const externalLease = await playwrightService.acquirePageTracking('existing-page');
	const session = await factory.borrow('existing-page', () => true);
	await session.dispose();

	assert.deepEqual([...activeLeases], [externalLease.leaseId]);
	assert.deepEqual(calls, ['acquirePageTracking', 'acquirePageTracking', 'releasePageTracking', 'disposeSession']);
});

test('concurrent borrowed FetchPageSessions share tracking until the final lease is released', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService();
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const factory = new FetchPageSessionFactory(mainProcessService, playwrightService);
	const [first, second] = await Promise.all([
		factory.borrow('shared-page', () => true),
		factory.borrow('shared-page', () => true),
	]);

	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'acquirePageTracking']);
	await first.dispose();
	assert.deepEqual(playwrightCalls, [
		'acquirePageTracking',
		'acquirePageTracking',
		'releasePageTracking',
		'disposeSession',
	]);
	const snapshot = await second.navigateAndCapture(
		URI.parse('https://example.com/loaded'),
		undefined,
		CancellationTokenNone,
	);
	assert.equal(snapshot.uri.toString(), 'https://example.com/loaded');
	await second.dispose();

	assert.deepEqual(playwrightCalls, [
		'acquirePageTracking',
		'acquirePageTracking',
		'releasePageTracking',
		'disposeSession',
		'navigatePage',
		'captureSnapshot',
		'releasePageTracking',
		'disposeSession',
	]);
	assert.deepEqual(calls, []);
});

test('FetchPageSession rejects cancellation before navigation and releases owned resources', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService();
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const session = await FetchPageSession.createOwned(mainProcessService, playwrightService, () => true, 1);
	const cancellationSource = new CancellationTokenSource();
	cancellationSource.cancel();

	await assert.rejects(
		session.navigateAndCapture(URI.parse('https://example.com/target'), undefined, cancellationSource.token),
		/Canceled/,
	);
	await session.dispose();
	cancellationSource.dispose();

	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'releasePageTracking', 'disposeSession']);
	assert.deepEqual(calls.map(call => call.command), ['getOrCreateBrowserView', 'destroyBrowserView']);
});

test('owned FetchPageSession releases every acquired resource when tracking startup fails', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService({
		acquireErrors: [new Error('Tracking failed')],
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;

	await assert.rejects(
		FetchPageSession.createOwned(mainProcessService, playwrightService, () => true, 1),
		/Tracking failed/,
	);

	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'disposeSession']);
	assert.deepEqual(calls.map(call => call.command), ['getOrCreateBrowserView', 'destroyBrowserView']);
});

test('borrowed FetchPageSession releases routing without releasing tracking when acquisition fails', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService({
		acquireErrors: [new Error('Tracking failed')],
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const factory = new FetchPageSessionFactory(mainProcessService, playwrightService);

	await assert.rejects(
		factory.borrow('existing-page', () => true),
		/Tracking failed/,
	);

	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'disposeSession']);
	assert.deepEqual(calls, []);
});

test('borrowed FetchPageSession can acquire a new lease after tracking startup fails', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService({
		acquireErrors: [new Error('Tracking failed')],
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const factory = new FetchPageSessionFactory(mainProcessService, playwrightService);

	await assert.rejects(factory.borrow('existing-page', () => true), /Tracking failed/);
	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'disposeSession']);

	const session = await factory.borrow('existing-page', () => true);
	await session.dispose();
	assert.deepEqual(playwrightCalls, [
		'acquirePageTracking',
		'disposeSession',
		'acquirePageTracking',
		'releasePageTracking',
		'disposeSession',
	]);
	assert.deepEqual(calls, []);
});

test('borrowed FetchPageSession retries only a failed final tracking release', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService({
		releaseErrors: [new Error('Release failed')],
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const factory = new FetchPageSessionFactory(mainProcessService, playwrightService);
	const session = await factory.borrow('existing-page', () => true);

	await assert.rejects(session.dispose(), AggregateError);
	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'releasePageTracking', 'disposeSession']);

	await session.dispose();
	assert.deepEqual(playwrightCalls, [
		'acquirePageTracking',
		'releasePageTracking',
		'disposeSession',
		'releasePageTracking',
	]);
	assert.deepEqual(calls, []);
});

test('FetchPageSession completes independent cleanup steps and retries only failed resources', async () => {
	const calls: BrowserViewCall[] = [];
	const { calls: playwrightCalls, service: playwrightService } = createPlaywrightService({
		releaseErrors: [new Error('Release failed')],
	});
	const mainProcessService = {
		getChannel: () => createBrowserViewChannel(calls),
	} as unknown as IMainProcessService;
	const session = await FetchPageSession.createOwned(mainProcessService, playwrightService, () => true, 1);

	await assert.rejects(session.dispose(), AggregateError);
	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'releasePageTracking', 'disposeSession']);
	assert.deepEqual(calls.map(call => call.command), ['getOrCreateBrowserView', 'destroyBrowserView']);

	await session.dispose();
	assert.deepEqual(playwrightCalls, ['acquirePageTracking', 'releasePageTracking', 'disposeSession', 'releasePageTracking']);
	assert.deepEqual(calls.map(call => call.command), ['getOrCreateBrowserView', 'destroyBrowserView']);
});
