/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	ipcMain,
	webContents,
	type IpcMainInvokeEvent,
	type WebContents,
} from 'electron';

import { serializeAppError } from 'cs/base/parts/sandbox/common/appError';
import {
	CancellationError,
	CancellationTokenNone,
	CancellationTokenSource,
	type CancellationToken,
} from 'cs/base/common/cancellation';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { type IDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';

const APP_SERVICE_IPC_CALL_CHANNEL = 'app:ipc-call';
const APP_SERVICE_IPC_CANCEL_CHANNEL = 'app:ipc-cancel';
const APP_SERVICE_IPC_EVENT_CHANNEL = 'app:ipc-event';
const APP_SERVICE_IPC_DISPOSE_CHANNEL = 'app:ipc-dispose';
const APP_SERVICE_IPC_RENDERER_CHANNEL_REGISTER_CHANNEL = 'app:ipc-renderer-channel-register';
const APP_SERVICE_IPC_RENDERER_CHANNEL_DISPOSE_CHANNEL = 'app:ipc-renderer-channel-dispose';
const APP_SERVICE_IPC_RENDERER_CALL_CHANNEL = 'app:ipc-renderer-call';
const APP_SERVICE_IPC_RENDERER_CALL_CANCEL_CHANNEL = 'app:ipc-renderer-call-cancel';
const APP_SERVICE_IPC_RENDERER_CALL_RESULT_CHANNEL = 'app:ipc-renderer-call-result';
const APP_SERVICE_IPC_RENDERER_EVENT_SUBSCRIBE_CHANNEL = 'app:ipc-renderer-event-subscribe';
const APP_SERVICE_IPC_RENDERER_EVENT_CHANNEL = 'app:ipc-renderer-event';
const APP_SERVICE_IPC_RENDERER_EVENT_DISPOSE_CHANNEL = 'app:ipc-renderer-event-dispose';

type AppIpcResponse<T> =
	| { ok: true; result: T }
	| { ok: false; error: string };

type ActiveSubscription = {
	readonly senderId: number;
	dispose(): void;
};

type PendingServiceCall = {
	readonly senderId: number;
	readonly cancellationSource: CancellationTokenSource;
};

type RendererCallRequest = {
	readonly requestId: string;
	readonly channelName: string;
	readonly command: string;
	readonly arg?: unknown;
};

type RendererCallResponse = {
	readonly requestId: string;
} & AppIpcResponse<unknown>;

type PendingRendererCall = {
	readonly senderId: number;
	readonly channelName: string;
	resolve(value: unknown): void;
	reject(error: Error): void;
	cancellation?: IDisposable;
};

type RendererEventSubscribeRequest = {
	readonly subscriptionId: string;
	readonly channelName: string;
	readonly eventName: string;
	readonly arg?: unknown;
};

type RendererEventPayload = {
	readonly subscriptionId: string;
	readonly data?: unknown;
	readonly error?: string;
};

type RendererEventSubscription = {
	readonly senderId: number;
	readonly channelName: string;
	readonly emitter: EventEmitter<unknown>;
};

export class ElectronMainChannelServer {
	private readonly channels = new Map<string, IServerChannel<IpcMainInvokeEvent>>();
	private readonly subscriptions = new Map<string, ActiveSubscription>();
	private readonly pendingServiceCalls = new Map<string, PendingServiceCall>();
	private readonly rendererChannels = new Map<number, Set<string>>();
	private readonly rendererSenderCleanup = new Map<number, () => void>();
	private readonly pendingRendererCalls = new Map<string, PendingRendererCall>();
	private readonly rendererEventSubscriptions =
		new Map<string, RendererEventSubscription>();
	private nextRendererRequestId = 0;
	private nextRendererSubscriptionId = 0;
	private registered = false;

	register(): void {
		if (this.registered) {
			return;
		}

		this.registered = true;
		ipcMain.handle(
			APP_SERVICE_IPC_CALL_CHANNEL,
			async (
				event,
				channelName: string,
				command: string,
				arg?: unknown,
				cancellationId?: string,
			): Promise<AppIpcResponse<unknown>> => {
				const source = typeof cancellationId === 'string' && cancellationId
					? new CancellationTokenSource()
					: undefined;
				const serviceCallId = source ? this.getServiceCallId(event.sender.id, cancellationId!) : undefined;
				if (source && serviceCallId) {
					this.trackRendererSender(event.sender);
					this.pendingServiceCalls.set(serviceCallId, {
						senderId: event.sender.id,
						cancellationSource: source,
					});
				}
				try {
					const channel = this.resolveChannel(channelName);
					return {
						ok: true,
						result: await channel.call(event, command, arg, source?.token),
					};
				} catch (error) {
					return {
						ok: false,
						error: serializeAppError(error),
					};
				} finally {
					if (serviceCallId) {
						this.pendingServiceCalls.delete(serviceCallId);
					}
					source?.dispose();
				}
			},
		);

		ipcMain.on(APP_SERVICE_IPC_CANCEL_CHANNEL, (event, cancellationId: unknown) => {
			if (typeof cancellationId !== 'string' || !cancellationId) {
				return;
			}
			this.pendingServiceCalls.get(this.getServiceCallId(event.sender.id, cancellationId))?.cancellationSource.cancel();
		});

		ipcMain.handle(
			APP_SERVICE_IPC_EVENT_CHANNEL,
			async (
				event,
				subscriptionId: string,
				channelName: string,
				eventName: string,
				arg?: unknown,
			): Promise<AppIpcResponse<void>> => {
				try {
					this.disposeSubscription(subscriptionId);
					const channel = this.resolveChannel(channelName);
					const subscription = channel.listen(event, eventName, arg)(data => {
						if (!event.sender.isDestroyed()) {
							event.sender.send(APP_SERVICE_IPC_EVENT_CHANNEL, {
								subscriptionId,
								data,
							});
						}
					});
					const cleanupSubscription = () => {
						this.disposeSubscription(subscriptionId);
					};
					event.sender.once('destroyed', cleanupSubscription);
					this.subscriptions.set(subscriptionId, {
						senderId: event.sender.id,
						dispose: () => {
							event.sender.off('destroyed', cleanupSubscription);
							subscription.dispose();
						},
					});
					return { ok: true, result: undefined };
				} catch (error) {
					return {
						ok: false,
						error: serializeAppError(error),
					};
				}
			},
		);

		ipcMain.on(APP_SERVICE_IPC_DISPOSE_CHANNEL, (_event, subscriptionId: string) => {
			this.disposeSubscription(subscriptionId);
		});

		ipcMain.on(
			APP_SERVICE_IPC_RENDERER_CHANNEL_REGISTER_CHANNEL,
			(event, channelName: string) => {
				this.registerRendererChannel(event.sender, event.sender.id, channelName);
			},
		);

		ipcMain.on(
			APP_SERVICE_IPC_RENDERER_CHANNEL_DISPOSE_CHANNEL,
			(event, channelName: string) => {
				this.disposeRendererChannel(event.sender.id, channelName);
			},
		);

		ipcMain.on(
			APP_SERVICE_IPC_RENDERER_CALL_RESULT_CHANNEL,
			(event, response: RendererCallResponse) => {
				this.handleRendererCallResponse(event.sender.id, response);
			},
		);

		ipcMain.on(
			APP_SERVICE_IPC_RENDERER_EVENT_CHANNEL,
			(event, payload: RendererEventPayload) => {
				this.handleRendererEvent(event.sender.id, payload);
			},
		);
	}

	registerChannel(
		channelName: string,
		channel: IServerChannel<IpcMainInvokeEvent>,
	): void {
		if (this.channels.has(channelName)) {
			throw new Error(`IPC channel '${channelName}' is already registered.`);
		}

		this.channels.set(channelName, channel);
	}

	getRendererChannel(senderId: number, channelName: string): IChannel {
		return {
			call: async <T = unknown>(
				command: string,
				arg?: unknown,
				cancellationToken: CancellationToken = CancellationTokenNone,
			) => {
				return await this.callRendererChannel<T>(
					senderId,
					channelName,
					command,
					arg,
					cancellationToken,
				);
			},
			listen: <T = unknown>(event: string, arg?: unknown): Event<T> => {
				return listener => {
					const subscriptionId = this.createRendererSubscriptionId(senderId);
					const sender = this.resolveRendererWebContents(senderId, channelName);
					const emitter = new EventEmitter<unknown>();
					const listenerSubscription = emitter.event(value => {
						listener(value as T);
					});
					this.rendererEventSubscriptions.set(subscriptionId, {
						senderId,
						channelName,
						emitter,
					});
					sender.send(APP_SERVICE_IPC_RENDERER_EVENT_SUBSCRIBE_CHANNEL, {
						subscriptionId,
						channelName,
						eventName: event,
						arg,
					} satisfies RendererEventSubscribeRequest);

					return toDisposable(() => {
						listenerSubscription.dispose();
						this.disposeRendererEventSubscription(subscriptionId, true);
					});
				};
			},
		};
	}

	disposeWebContentsSubscriptions(senderId: number): void {
		for (const [serviceCallId, pendingCall] of this.pendingServiceCalls) {
			if (pendingCall.senderId === senderId) {
				pendingCall.cancellationSource.cancel();
				pendingCall.cancellationSource.dispose();
				this.pendingServiceCalls.delete(serviceCallId);
			}
		}

		for (const [subscriptionId, subscription] of this.subscriptions) {
			if (subscription.senderId === senderId) {
				subscription.dispose();
				this.subscriptions.delete(subscriptionId);
			}
		}

		this.rendererChannels.delete(senderId);

		for (const [requestId, pendingCall] of this.pendingRendererCalls) {
			if (pendingCall.senderId === senderId) {
				pendingCall.cancellation?.dispose();
				pendingCall.reject(
					new Error(`Renderer IPC sender '${senderId}' was disposed.`),
				);
				this.pendingRendererCalls.delete(requestId);
			}
		}

		for (const [subscriptionId, subscription] of this.rendererEventSubscriptions) {
			if (subscription.senderId === senderId) {
				subscription.emitter.dispose();
				this.rendererEventSubscriptions.delete(subscriptionId);
			}
		}
	}

	private resolveChannel(channelName: string) {
		const channel = this.channels.get(channelName);
		if (!channel) {
			throw new Error(`Unknown IPC channel '${channelName}'.`);
		}

		return channel;
	}

	private getServiceCallId(senderId: number, cancellationId: string): string {
		return `${senderId}:${cancellationId}`;
	}

	private registerRendererChannel(
		sender: WebContents,
		senderId: number,
		channelName: unknown,
	): void {
		if (typeof channelName !== 'string' || !channelName) {
			throw new Error('Renderer IPC channel name must be a non-empty string.');
		}

		this.trackRendererSender(sender);

		let channels = this.rendererChannels.get(senderId);
		if (!channels) {
			channels = new Set<string>();
			this.rendererChannels.set(senderId, channels);
		}

		if (channels.has(channelName)) {
			throw new Error(
				`Renderer IPC channel '${channelName}' is already registered for sender '${senderId}'.`,
			);
		}

		channels.add(channelName);
	}

	private trackRendererSender(sender: WebContents): void {
		const senderId = sender.id;
		if (this.rendererSenderCleanup.has(senderId)) {
			return;
		}

		const cleanup = () => {
			this.disposeWebContentsSubscriptions(senderId);
			this.rendererSenderCleanup.delete(senderId);
		};
		this.rendererSenderCleanup.set(senderId, cleanup);
		sender.once('destroyed', cleanup);
	}

	private disposeRendererChannel(senderId: number, channelName: string): void {
		const channels = this.rendererChannels.get(senderId);
		if (!channels) {
			return;
		}

		channels.delete(channelName);
		if (channels.size === 0) {
			this.rendererChannels.delete(senderId);
		}

		for (const [requestId, pendingCall] of this.pendingRendererCalls) {
			if (
				pendingCall.senderId === senderId &&
				pendingCall.channelName === channelName
			) {
				pendingCall.cancellation?.dispose();
				pendingCall.reject(
					new Error(
						`Renderer IPC channel '${channelName}' was disposed for sender '${senderId}'.`,
					),
				);
				this.pendingRendererCalls.delete(requestId);
			}
		}

		for (const [subscriptionId, subscription] of this.rendererEventSubscriptions) {
			if (
				subscription.senderId === senderId &&
				subscription.channelName === channelName
			) {
				subscription.emitter.dispose();
				this.rendererEventSubscriptions.delete(subscriptionId);
			}
		}
	}

	private resolveRendererWebContents(
		senderId: number,
		channelName: string,
	): WebContents {
		const channels = this.rendererChannels.get(senderId);
		if (!channels?.has(channelName)) {
			throw new Error(
				`Renderer IPC channel '${channelName}' is not registered for sender '${senderId}'.`,
			);
		}

		const sender = webContents.fromId(senderId);
		if (!sender || sender.isDestroyed()) {
			throw new Error(`Renderer IPC sender '${senderId}' is unavailable.`);
		}

		return sender;
	}

	private callRendererChannel<T>(
		senderId: number,
		channelName: string,
		command: string,
		arg?: unknown,
		cancellationToken: CancellationToken = CancellationTokenNone,
	): Promise<T> {
		if (cancellationToken.isCancellationRequested) {
			return Promise.reject(new CancellationError());
		}
		const sender = this.resolveRendererWebContents(senderId, channelName);
		const requestId = this.createRendererRequestId(senderId);
		const request: RendererCallRequest = {
			requestId,
			channelName,
			command,
			arg,
		};

		return new Promise<T>((resolve, reject) => {
			const pendingCall: PendingRendererCall = {
				senderId,
				channelName,
				resolve: value => resolve(value as T),
				reject,
			};
			this.pendingRendererCalls.set(requestId, pendingCall);
			pendingCall.cancellation = cancellationToken.onCancellationRequested(() => {
				this.cancelRendererCall(requestId, true);
			});
			if (!this.pendingRendererCalls.has(requestId)) {
				return;
			}

			try {
				sender.send(APP_SERVICE_IPC_RENDERER_CALL_CHANNEL, request);
			} catch (error) {
				this.pendingRendererCalls.delete(requestId);
				pendingCall.cancellation.dispose();
				reject(error instanceof Error ? error : new Error(String(error)));
			}
		});
	}

	private handleRendererCallResponse(
		senderId: number,
		response: RendererCallResponse,
	): void {
		const pendingCall = this.pendingRendererCalls.get(response.requestId);
		if (!pendingCall || pendingCall.senderId !== senderId) {
			return;
		}

		this.pendingRendererCalls.delete(response.requestId);
		pendingCall.cancellation?.dispose();
		if (response.ok) {
			pendingCall.resolve(response.result);
			return;
		}

		pendingCall.reject(new Error(response.error));
	}

	private handleRendererEvent(senderId: number, payload: RendererEventPayload): void {
		const subscription = this.rendererEventSubscriptions.get(payload.subscriptionId);
		if (!subscription || subscription.senderId !== senderId) {
			return;
		}

		if (payload.error) {
			subscription.emitter.dispose();
			this.rendererEventSubscriptions.delete(payload.subscriptionId);
			return;
		}

		subscription.emitter.fire(payload.data);
	}

	private cancelRendererCall(requestId: string, notifyRenderer: boolean): void {
		const pendingCall = this.pendingRendererCalls.get(requestId);
		if (pendingCall === undefined) {
			return;
		}
		this.pendingRendererCalls.delete(requestId);
		pendingCall.cancellation?.dispose();
		if (notifyRenderer) {
			const sender = webContents.fromId(pendingCall.senderId);
			if (sender !== undefined && !sender.isDestroyed()) {
				sender.send(APP_SERVICE_IPC_RENDERER_CALL_CANCEL_CHANNEL, requestId);
			}
		}
		pendingCall.reject(new CancellationError());
	}

	private disposeRendererEventSubscription(
		subscriptionId: string,
		notifyRenderer: boolean,
	): void {
		const subscription = this.rendererEventSubscriptions.get(subscriptionId);
		if (!subscription) {
			return;
		}

		subscription.emitter.dispose();
		this.rendererEventSubscriptions.delete(subscriptionId);

		if (!notifyRenderer) {
			return;
		}

		const sender = webContents.fromId(subscription.senderId);
		if (!sender || sender.isDestroyed()) {
			return;
		}

		sender.send(APP_SERVICE_IPC_RENDERER_EVENT_DISPOSE_CHANNEL, subscriptionId);
	}

	private createRendererRequestId(senderId: number): string {
		this.nextRendererRequestId += 1;
		return `${senderId}:${this.nextRendererRequestId}`;
	}

	private createRendererSubscriptionId(senderId: number): string {
		this.nextRendererSubscriptionId += 1;
		return `${senderId}:${this.nextRendererSubscriptionId}`;
	}

	private disposeSubscription(subscriptionId: string): void {
		const subscription = this.subscriptions.get(subscriptionId);
		if (!subscription) {
			return;
		}

		subscription.dispose();
		this.subscriptions.delete(subscriptionId);
	}
}

export const electronMainChannelServer = new ElectronMainChannelServer();
