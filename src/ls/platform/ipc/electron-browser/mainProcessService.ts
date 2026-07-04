/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'ls/base/common/event';
import { Disposable, toDisposable } from 'ls/base/common/lifecycle';
import type { IChannel, IServerChannel } from 'ls/base/parts/ipc/common/ipc';
import type { ElectronIpcApi } from 'ls/base/parts/sandbox/common/electronTypes';
import type { IMainProcessService } from 'ls/platform/ipc/common/mainProcessService';

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
			call: async <T = unknown>(command: string, arg?: unknown) => {
				return await this.ipc.call<T>(channelName, command, arg);
			},
			listen: <T = unknown>(event: string, arg?: unknown): Event<T> => {
				return listener =>
					toDisposable(this.ipc.listen(channelName, event, arg, listener));
			},
		};
	}

	registerChannel(channelName: string, channel: IServerChannel<string>): void {
		this._register(toDisposable(this.ipc.registerChannel(channelName, channel)));
	}
}
