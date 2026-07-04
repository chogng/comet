/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';

export interface IRemoteService {
	readonly _serviceBrand: undefined;
	getChannel(channelName: string): IChannel;
	registerChannel(channelName: string, channel: IServerChannel<string>): void;
}
