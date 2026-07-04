/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	IChannel,
	IClientRouter,
	IRoutingChannelClient,
	IServerChannel,
} from 'cs/base/parts/ipc/common/ipc';
import type { IRemoteService } from 'cs/platform/ipc/common/service';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const IMainProcessService =
	createDecorator<IMainProcessService>('mainProcessService');

export interface IMainProcessService extends IRemoteService {}

export class MainProcessService implements IMainProcessService {
	declare readonly _serviceBrand: undefined;

	constructor(
		private readonly server: IRoutingChannelClient<string> & {
			registerChannel(channelName: string, channel: IServerChannel<string>): void;
		},
		private readonly router: IClientRouter<string>,
	) {}

	getChannel(channelName: string): IChannel {
		return this.server.getChannel(channelName, this.router);
	}

	registerChannel(channelName: string, channel: IServerChannel<string>): void {
		this.server.registerChannel(channelName, channel);
	}
}
