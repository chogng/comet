/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import { Disposable, toDisposable } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { registerElectronRendererChannel } from 'cs/base/parts/ipc/electron-browser/rendererChannelClient';
import type { ElectronIpcApi } from 'cs/base/parts/sandbox/common/electronTypes';
import type { IMainProcessService } from 'cs/platform/ipc/common/mainProcessService';

export class ElectronIPCMainProcessService
	extends Disposable
	implements IMainProcessService
{
	declare readonly _serviceBrand: undefined;

	constructor(private readonly ipc: ElectronIpcApi) {
		super();
	}

	getChannel(channelName: string): IChannel {
		return {
			call: async <T = unknown>(command: string, arg?: unknown, cancellationToken?: CancellationToken) => {
				const cancellationId = generateUuid();
				const request = this.ipc.call<T>(channelName, command, arg, cancellationId);
				const cancellation = cancellationToken?.onCancellationRequested(() => this.ipc.cancel(cancellationId));
				try {
					return await request;
				} finally {
					cancellation?.dispose();
				}
			},
			listen: <T = unknown>(event: string, arg?: unknown): Event<T> => {
				return listener =>
					toDisposable(this.ipc.listen(channelName, event, arg, listener));
			},
		};
	}

	registerChannel(channelName: string, channel: IServerChannel<string>): void {
		this._register(registerElectronRendererChannel(this.ipc, channelName, channel));
	}
}
