/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MessageChannelMain, type UtilityProcess as ElectronUtilityProcess } from 'electron';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Disposable } from 'cs/base/common/lifecycle';
import { getDelayedChannel, type IChannel, type IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { MessagePortChannel } from 'cs/base/parts/ipc/common/messagePortIpc';
import { SharedProcessLifecycle } from 'cs/platform/sharedProcess/common/sharedProcess';
import { UtilityProcess } from 'cs/platform/utilityProcess/electron-main/utilityProcess';

export class SharedProcess extends Disposable {
	private readonly utilityProcess = this._register(new UtilityProcess());
	private startup: Promise<MessagePortChannel> | undefined;
	private shutdownPromise: Promise<void> | undefined;

	start(channels: ReadonlyMap<string, IServerChannel<string>>): Promise<void> {
		if (this.shutdownPromise) {
			throw new Error('Shared process is shutting down.');
		}
		this.startup ??= this.createChannel(channels);
		return this.startup.then(() => undefined);
	}

	getChannel<T extends IChannel = IChannel>(channelName: string): T {
		if (!this.startup) {
			throw new Error('Shared process has not been started.');
		}
		return getDelayedChannel(this.startup.then(channel => channel.getChannel<T>(channelName)));
	}

	shutdown(): Promise<void> {
		this.shutdownPromise ??= this.shutdownProcess();
		return this.shutdownPromise;
	}

	private async shutdownProcess(): Promise<void> {
		try {
			if (this.startup) {
				const channel = await this.startup;
				await channel.getChannel('playwright').call('shutdown');
			}
		} finally {
			this.dispose();
		}
	}

	private async createChannel(channels: ReadonlyMap<string, IServerChannel<string>>): Promise<MessagePortChannel> {
		const entryPoint = fileURLToPath(new URL('../electron-utility/sharedProcess/sharedProcessMain.js', import.meta.url));
		const child = this.utilityProcess.start(entryPoint, {
			serviceName: 'Comet Shared Process',
			environment: process.env,
			execArgv: process.execArgv,
			workingDirectory: dirname(entryPoint),
			standardIO: 'pipe',
		});
		let processExitError: Error | undefined;
		let channel: MessagePortChannel | undefined;
		await this.waitForReady(child, error => {
			processExitError = error;
			channel?.disconnect(error);
		});
		const messageChannel = new MessageChannelMain();
		channel = this._register(new MessagePortChannel(messageChannel.port1, 'main'));
		if (processExitError) {
			channel.disconnect(processExitError);
			throw processExitError;
		}
		for (const [channelName, serverChannel] of channels) {
			channel.registerChannel(channelName, serverChannel);
		}
		this.utilityProcess.postMessage({ type: SharedProcessLifecycle.connect }, [messageChannel.port2]);
		return channel;
	}

	private waitForReady(process: ElectronUtilityProcess, onExitAfterReady: (error: Error) => void): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let ready = false;
			const onMessage = (message: unknown) => {
				if (message && typeof message === 'object' && (message as { type?: unknown }).type === SharedProcessLifecycle.ready) {
					ready = true;
					process.off('message', onMessage);
					resolve();
				}
			};
			const onExit = (code: number) => {
				process.off('message', onMessage);
				const error = new Error(`Shared process exited with code ${code}.`);
				if (ready) {
					onExitAfterReady(error);
				} else {
					reject(error);
				}
			};
			process.on('message', onMessage);
			process.once('exit', onExit);
		});
	}

	override dispose(): void {
		super.dispose();
	}
}
