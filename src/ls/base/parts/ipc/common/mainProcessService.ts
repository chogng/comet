/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type {
	IChannel,
	IClientRouter,
	IRoutingChannelClient,
	IServerChannel,
} from 'ls/base/parts/ipc/common/ipc';
import type { IRemoteService } from 'ls/base/parts/ipc/common/services';
import { createDecorator } from 'ls/platform/instantiation/common/instantiation';

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
