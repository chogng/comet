/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { Event, EventEmitter } from 'cs/base/common/event';
import type { IChannel } from 'cs/base/parts/ipc/common/ipc';
import { BrowserViewGroupRemoteService } from 'cs/platform/browserView/node/browserViewGroupRemoteService';

function createDeferred(): { readonly promise: Promise<void>; resolve(): void } {
	let resolve!: () => void;
	const promise = new Promise<void>(promiseResolve => {
		resolve = promiseResolve;
	});
	return { promise, resolve };
}

test('RemoteBrowserViewGroup deduplicates destruction and completes locally before the RPC response', async () => {
	const didDestroy = new EventEmitter<void>();
	const destroyGate = createDeferred();
	let destroyCalls = 0;
	const channel: IChannel = {
		call: async <T>(command: string): Promise<T> => {
			if (command === 'createGroup') {
				return 'group-1' as T;
			}
			if (command === 'destroyGroup') {
				destroyCalls++;
				await destroyGate.promise;
				return undefined as T;
			}
			if (command === 'addViewToGroup') {
				return { viewId: 'page-1', targetId: 'target-1' } as T;
			}
			return undefined as T;
		},
		listen: <T>(event: string): Event<T> => event === 'onDynamicDidDestroy'
			? didDestroy.event as Event<T>
			: Event.None,
	};
	const remoteService = new BrowserViewGroupRemoteService({
		_serviceBrand: undefined,
		getChannel: () => channel,
		registerChannel: () => {},
	});
	const group = await remoteService.createGroup({ mainWindowId: 1 });
	let destroyEvents = 0;
	group.onDidDestroy(() => destroyEvents++);

	const first = group.destroy();
	const second = group.destroy();
	assert.equal(first, second);
	let rpcSettled = false;
	void first.then(() => { rpcSettled = true; });
	didDestroy.fire();
	await new Promise<void>(resolve => setImmediate(resolve));
	const third = group.destroy();

	assert.equal(destroyEvents, 1);
	assert.equal(third, first);
	assert.equal(rpcSettled, false);
	assert.equal((remoteService as unknown as { _groups: Map<string, unknown> })._groups.size, 0);
	await assert.rejects(group.addView('page-1'), /being destroyed/);

	destroyGate.resolve();
	await first;
	assert.equal(destroyCalls, 1);
	didDestroy.dispose();
});

test('RemoteBrowserViewGroup preserves a failed destroy result and rejects later operations', async () => {
	let destroyCalls = 0;
	let listenCalls = 0;
	const channel: IChannel = {
		call: async <T>(command: string): Promise<T> => {
			if (command === 'createGroup') {
				return 'group-2' as T;
			}
			if (command === 'destroyGroup') {
				destroyCalls++;
				throw new Error('destroy RPC failed');
			}
			return undefined as T;
		},
		listen: () => {
			listenCalls++;
			return Event.None;
		},
	};
	const remoteService = new BrowserViewGroupRemoteService({
		_serviceBrand: undefined,
		getChannel: () => channel,
		registerChannel: () => {},
	});
	const group = await remoteService.createGroup({ mainWindowId: 1 });
	const first = group.destroy();
	const second = group.destroy();
	let destroyEvents = 0;
	group.onDidDestroy(() => destroyEvents++);

	assert.equal(first, second);
	await assert.rejects(first, /destroy RPC failed/);
	await assert.rejects(group.sendCDPMessage({ id: 1, method: 'Browser.getVersion' }), /being destroyed/);
	group.onDidAddView(() => {});
	assert.equal(destroyCalls, 1);
	assert.equal(destroyEvents, 1);
	assert.equal(listenCalls, 3);
	assert.equal((remoteService as unknown as { _groups: Map<string, unknown> })._groups.size, 0);
});

test('RemoteBrowserViewGroup forwards CDP messages only while locally observed', async () => {
	let cdpSubscriptions = 0;
	let cdpDisposals = 0;
	const cdpMessages = new EventEmitter<unknown>();
	const channel: IChannel = {
		call: async <T>(command: string): Promise<T> => command === 'createGroup'
			? 'group-cdp-forwarding' as T
			: undefined as T,
		listen: <T>(event: string): Event<T> => {
			if (event !== 'onDynamicCDPMessage') {
				return Event.None;
			}
			return ((listener: (value: T) => void) => {
				cdpSubscriptions++;
				const subscription = cdpMessages.event(listener as (value: unknown) => void);
				return {
					dispose: () => {
						cdpDisposals++;
						subscription.dispose();
					},
				};
			}) as Event<T>;
		},
	};
	const remoteService = new BrowserViewGroupRemoteService({
		_serviceBrand: undefined,
		getChannel: () => channel,
		registerChannel: () => {},
	});
	const group = await remoteService.createGroup({ mainWindowId: 1 });
	assert.equal(cdpSubscriptions, 0);

	const first = group.onCDPMessage(() => {});
	const second = group.onCDPMessage(() => {});
	assert.equal(cdpSubscriptions, 1);
	first.dispose();
	assert.equal(cdpDisposals, 0);
	second.dispose();
	assert.equal(cdpDisposals, 1);

	await group.destroy();
	group.onCDPMessage(() => {});
	assert.equal(cdpSubscriptions, 1);
	cdpMessages.dispose();
});

test('RemoteBrowserViewGroup completes terminal cleanup when a destroy listener throws', async () => {
	const didDestroy = new EventEmitter<void>();
	const destroyGate = createDeferred();
	const channel: IChannel = {
		call: async <T>(command: string): Promise<T> => {
			if (command === 'createGroup') {
				return 'group-throwing-listener' as T;
			}
			if (command === 'destroyGroup') {
				await destroyGate.promise;
			}
			return undefined as T;
		},
		listen: <T>(event: string): Event<T> => event === 'onDynamicDidDestroy'
			? didDestroy.event as Event<T>
			: Event.None,
	};
	const remoteService = new BrowserViewGroupRemoteService({
		_serviceBrand: undefined,
		getChannel: () => channel,
		registerChannel: () => {},
	});
	const group = await remoteService.createGroup({ mainWindowId: 1 });
	group.onDidDestroy(() => {
		throw new Error('destroy listener failed');
	});

	const destruction = group.destroy();
	assert.throws(() => didDestroy.fire(), /destroy listener failed/);
	assert.equal((remoteService as unknown as { _groups: Map<string, unknown> })._groups.size, 0);
	await assert.rejects(group.addView('page-1'), /being destroyed/);
	destroyGate.resolve();
	await assert.rejects(destruction, /destroy listener failed/);
	didDestroy.dispose();
});
