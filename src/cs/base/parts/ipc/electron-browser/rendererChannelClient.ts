/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'cs/base/common/cancellation';
import { onUnexpectedError } from 'cs/base/common/errors';
import { Disposable, type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { IServerChannel } from 'cs/base/parts/ipc/common/ipc';
import { serializeAppError } from 'cs/base/parts/sandbox/common/appError';
import type {
	ElectronIpcApi,
	ElectronRendererChannelCallRequest,
	ElectronRendererChannelEventSubscribeRequest,
} from 'cs/base/parts/sandbox/common/electronTypes';

interface RendererCall {
	readonly channelName: string;
	readonly cancellationSource: CancellationTokenSource;
}

interface RendererEventSubscription {
	readonly channelName: string;
	readonly disposable: IDisposable;
}

interface SharedRendererChannelClient {
	readonly client: ElectronRendererChannelClient;
	references: number;
}

const rendererChannelContext = 'main';
const clients = new WeakMap<ElectronIpcApi, SharedRendererChannelClient>();

/** Owns renderer channel implementations and transports only structured data through preload. */
class ElectronRendererChannelClient extends Disposable {
	private readonly channels = new Map<string, IServerChannel<string>>();
	private readonly calls = new Map<string, RendererCall>();
	private readonly eventSubscriptions = new Map<string, RendererEventSubscription>();

	constructor(private readonly ipc: ElectronIpcApi) {
		super();
		this._register(toDisposable(this.ipc.rendererChannels.onCall(request => {
			void this.handleCall(request).catch(onUnexpectedError);
		})));
		this._register(toDisposable(this.ipc.rendererChannels.onCallCancellation(requestId => {
			this.calls.get(requestId)?.cancellationSource.cancel();
		})));
		this._register(toDisposable(this.ipc.rendererChannels.onEventSubscription(request => {
			try {
				this.handleEventSubscription(request);
			} catch (error) {
				onUnexpectedError(error);
			}
		})));
		this._register(toDisposable(this.ipc.rendererChannels.onEventDisposal(subscriptionId => {
			this.disposeEventSubscription(subscriptionId);
		})));
	}

	/** Registers one executable channel in the renderer and publishes only its name to main. */
	registerChannel(channelName: string, channel: IServerChannel<string>): IDisposable {
		if (this.channels.has(channelName)) {
			throw new Error(`Renderer IPC channel '${channelName}' is already registered.`);
		}
		this.channels.set(channelName, channel);
		try {
			this.ipc.rendererChannels.register(channelName);
		} catch (error) {
			this.channels.delete(channelName);
			throw error;
		}
		return toDisposable(() => this.disposeChannel(channelName));
	}

	private getChannel(channelName: string): IServerChannel<string> {
		const channel = this.channels.get(channelName);
		if (!channel) {
			throw new Error(`Unknown renderer IPC channel '${channelName}'.`);
		}
		return channel;
	}

	private async handleCall(request: ElectronRendererChannelCallRequest): Promise<void> {
		if (this.calls.has(request.requestId)) {
			this.ipc.rendererChannels.sendCallResult({
				requestId: request.requestId,
				ok: false,
				error: serializeAppError(new Error(`Renderer IPC request '${request.requestId}' is already active.`)),
			});
			return;
		}

		const cancellationSource = new CancellationTokenSource();
		this.calls.set(request.requestId, {
			channelName: request.channelName,
			cancellationSource,
		});
		try {
			const channel = this.getChannel(request.channelName);
			const result = await channel.call(
				rendererChannelContext,
				request.command,
				request.arg,
				cancellationSource.token,
			);
			if (this.calls.get(request.requestId)?.cancellationSource !== cancellationSource) {
				return;
			}
			this.ipc.rendererChannels.sendCallResult({
				requestId: request.requestId,
				ok: true,
				result,
			});
		} catch (error) {
			if (this.calls.get(request.requestId)?.cancellationSource !== cancellationSource) {
				return;
			}
			this.ipc.rendererChannels.sendCallResult({
				requestId: request.requestId,
				ok: false,
				error: serializeAppError(error),
			});
		} finally {
			if (this.calls.get(request.requestId)?.cancellationSource === cancellationSource) {
				this.calls.delete(request.requestId);
				cancellationSource.dispose();
			}
		}
	}

	private handleEventSubscription(request: ElectronRendererChannelEventSubscribeRequest): void {
		try {
			this.disposeEventSubscription(request.subscriptionId);
			const channel = this.getChannel(request.channelName);
			let acceptsEvents = true;
			const disposable = channel.listen(
				rendererChannelContext,
				request.eventName,
				request.arg,
			)(data => {
				if (!acceptsEvents) {
					return;
				}
				try {
					this.ipc.rendererChannels.sendEvent({
						subscriptionId: request.subscriptionId,
						data,
					});
				} catch (error) {
					acceptsEvents = false;
					this.disposeEventSubscription(request.subscriptionId);
					this.ipc.rendererChannels.sendEvent({
						subscriptionId: request.subscriptionId,
						error: serializeAppError(error),
					});
				}
			});
			if (!acceptsEvents) {
				disposable.dispose();
				return;
			}
			this.eventSubscriptions.set(request.subscriptionId, {
				channelName: request.channelName,
				disposable,
			});
		} catch (error) {
			this.ipc.rendererChannels.sendEvent({
				subscriptionId: request.subscriptionId,
				error: serializeAppError(error),
			});
		}
	}

	private disposeChannel(channelName: string): void {
		if (!this.channels.delete(channelName)) {
			return;
		}
		for (const [requestId, call] of this.calls) {
			if (call.channelName === channelName) {
				call.cancellationSource.cancel();
				call.cancellationSource.dispose();
				this.calls.delete(requestId);
			}
		}
		for (const [subscriptionId, subscription] of this.eventSubscriptions) {
			if (subscription.channelName === channelName) {
				subscription.disposable.dispose();
				this.eventSubscriptions.delete(subscriptionId);
			}
		}
		this.ipc.rendererChannels.dispose(channelName);
	}

	private disposeEventSubscription(subscriptionId: string): void {
		const subscription = this.eventSubscriptions.get(subscriptionId);
		if (!subscription) {
			return;
		}
		this.eventSubscriptions.delete(subscriptionId);
		subscription.disposable.dispose();
	}
}

function acquireElectronRendererChannelClient(
	ipc: ElectronIpcApi,
): readonly [ElectronRendererChannelClient, IDisposable] {
	let shared = clients.get(ipc);
	if (!shared) {
		shared = {
			client: new ElectronRendererChannelClient(ipc),
			references: 0,
		};
		clients.set(ipc, shared);
	}
	const record = shared;
	record.references += 1;
	return [record.client, toDisposable(() => {
		record.references -= 1;
		if (record.references === 0 && clients.get(ipc) === record) {
			clients.delete(ipc);
			record.client.dispose();
		}
	})];
}

/** Registers one renderer-owned IPC channel for the lifetime of the returned disposable. */
export function registerElectronRendererChannel(
	ipc: ElectronIpcApi,
	channelName: string,
	channel: IServerChannel<string>,
): IDisposable {
	const [client, release] = acquireElectronRendererChannelClient(ipc);
	let registration: IDisposable;
	try {
		registration = client.registerChannel(channelName, channel);
	} catch (error) {
		release.dispose();
		throw error;
	}
	return toDisposable(() => {
		try {
			registration.dispose();
		} finally {
			release.dispose();
		}
	});
}
