/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { CancellationError, CancellationTokenCancelled, type CancellationToken } from 'cs/base/common/cancellation';
import { Event } from 'cs/base/common/event';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';

type MessageListener = (event: { data: unknown }) => void;
type CloseListener = () => void;

class TestMessagePort {
	readonly postedMessages: unknown[] = [];
	closeCount = 0;
	startCount = 0;
	private readonly messageListeners = new Set<MessageListener>();
	private readonly closeListeners = new Set<CloseListener>();

	postMessage(message: unknown): void {
		this.postedMessages.push(message);
	}

	start(): void {
		this.startCount++;
	}

	close(): void {
		this.closeCount++;
	}

	on(event: 'message', listener: MessageListener): void;
	on(event: 'close', listener: CloseListener): void;
	on(event: 'message' | 'close', listener: MessageListener | CloseListener): void {
		if (event === 'message') {
			this.messageListeners.add(listener as MessageListener);
		} else {
			this.closeListeners.add(listener as CloseListener);
		}
	}

	off(event: 'message', listener: MessageListener): void;
	off(event: 'close', listener: CloseListener): void;
	off(event: 'message' | 'close', listener: MessageListener | CloseListener): void {
		if (event === 'message') {
			this.messageListeners.delete(listener as MessageListener);
		} else {
			this.closeListeners.delete(listener as CloseListener);
		}
	}

	emitMessage(data: unknown): void {
		for (const listener of [...this.messageListeners]) {
			listener({ data });
		}
	}

	emitClose(): void {
		for (const listener of [...this.closeListeners]) {
			listener();
		}
	}
}

test('MessagePortChannel rejects pending and future calls when the remote endpoint closes', async () => {
	const port = new TestMessagePort();
	const channel = new MessagePortChannel(port, 'test');
	const remote = channel.getChannel('remote');
	const pending = remote.call('wait');

	assert.equal(port.startCount, 1);
	assert.equal(port.postedMessages.length, 1);
	port.emitClose();

	await assert.rejects(pending, /closed by the remote endpoint/);
	assert.throws(() => remote.call('after-close'), /disconnected/);
	assert.throws(() => remote.listen('after-close')(() => {}), /disconnected/);
	channel.dispose();
	assert.equal(port.closeCount, 0);
});

test('MessagePortChannel rejects an already-cancelled call before posting it', async () => {
	const port = new TestMessagePort();
	const channel = new MessagePortChannel(port, 'test');
	const remote = channel.getChannel('remote');

	await assert.rejects(remote.call('cancelled', undefined, CancellationTokenCancelled), CancellationError);
	assert.equal(port.postedMessages.length, 0);
	channel.dispose();
});

test('MessagePortChannel cancels active server calls when the remote endpoint closes', async () => {
	const port = new TestMessagePort();
	const channel = new MessagePortChannel(port, 'test');
	let cancellationRequested = false;
	const serverChannel: IServerChannel<string> = {
		call: (_context: string, _command: string, _arg: unknown, token: CancellationToken) => new Promise((_resolve, reject) => {
			token.onCancellationRequested(() => {
				cancellationRequested = true;
				reject(new Error('cancelled'));
			});
		}),
		listen: () => Event.None,
	};
	channel.registerChannel('server', serverChannel);

	port.emitMessage({ type: 'call', id: 1, channelName: 'server', name: 'wait' });
	await new Promise<void>(resolve => setImmediate(resolve));
	port.emitClose();
	await new Promise<void>(resolve => setImmediate(resolve));

	assert.equal(cancellationRequested, true);
});
