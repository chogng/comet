/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageChannelMain } from 'electron';
import { fileURLToPath } from 'node:url';
import { Disposable } from 'cs/base/common/lifecycle';
import { getDelayedChannel, type IChannel, type IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';
import { UtilityProcess } from 'cs/platform/utilityProcess/electron-main/utilityProcess';

export class SharedProcess extends Disposable {
	private readonly utilityProcess = this._register(new UtilityProcess());
	private startup: Promise<MessagePortChannel> | undefined;

	start(channels: ReadonlyMap<string, IServerChannel<string>>): Promise<void> {
		this.startup ??= this.createChannel(channels);
		return this.startup.then(() => undefined);
	}

	getChannel<T extends IChannel = IChannel>(channelName: string): T {
		if (!this.startup) {
			throw new Error('Shared process has not been started.');
		}
		return getDelayedChannel(this.startup.then(channel => channel.getChannel<T>(channelName)));
	}

	private async createChannel(channels: ReadonlyMap<string, IServerChannel<string>>): Promise<MessagePortChannel> {
		const entryPoint = fileURLToPath(new URL('../../../code/electron-utility/sharedProcess/sharedProcessMain.js', import.meta.url));
		await this.utilityProcess.start(entryPoint);
		const messageChannel = new MessageChannelMain();
		const channel = this._register(new MessagePortChannel(messageChannel.port1, 'main'));
		for (const [channelName, serverChannel] of channels) {
			channel.registerChannel(channelName, serverChannel);
		}
		this.utilityProcess.postMessage({ type: 'comet:shared-process-connect' }, [messageChannel.port2]);
		return channel;
	}

	override dispose(): void {
		super.dispose();
	}
}
