/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';
import { CancellationTokenSource } from 'cs/base/common/cancellation';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import type { ElectronIpcApi } from 'cs/base/parts/sandbox/common/electronTypes';
import { ElectronIPCMainProcessService } from 'cs/platform/ipc/electron-browser/mainProcessService';

class TestElectronIpcApi implements ElectronIpcApi {
	lastCallCancellationId: string | undefined;
	readonly cancelledIds: string[] = [];
	private completeCall: ((value: unknown) => void) | undefined;

	call<T = unknown>(
		_channelName: string,
		_command: string,
		_arg?: unknown,
		cancellationId?: string,
	): Promise<T> {
		this.lastCallCancellationId = cancellationId;
		return new Promise<T>(resolve => {
			this.completeCall = value => resolve(value as T);
		});
	}

	cancel(cancellationId: string): void {
		this.cancelledIds.push(cancellationId);
	}

	listen<T = unknown>(
		_channelName: string,
		_event: string,
		_arg: unknown,
		_listener: (payload: T) => void,
	): () => void {
		return () => {};
	}

	registerChannel(_channelName: string, _channel: IServerChannel<string>): () => void {
		return () => {};
	}

	complete(value: unknown): void {
		this.completeCall?.(value);
	}
}

test('forwards channel cancellation to the Electron IPC bridge', async () => {
	const ipc = new TestElectronIpcApi();
	const service = new ElectronIPCMainProcessService(ipc);
	const source = new CancellationTokenSource();

	try {
		const call = service.getChannel('playwright').call<string>('captureSnapshot', undefined, source.token);
		source.cancel();

		assert.ok(ipc.lastCallCancellationId);
		assert.deepEqual(ipc.cancelledIds, [ipc.lastCallCancellationId]);

		ipc.complete('cancelled');
		assert.equal(await call, 'cancelled');
	} finally {
		source.dispose();
		service.dispose();
	}
});
