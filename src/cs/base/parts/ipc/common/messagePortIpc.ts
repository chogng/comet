/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationError, CancellationTokenNone, CancellationTokenSource, type CancellationToken } from 'cs/base/common/cancellation';
import { EventEmitter, type Event } from 'cs/base/common/event';
import { Disposable, toDisposable, type IDisposable } from 'cs/base/common/lifecycle';
import type { IChannel, IServerChannel } from 'cs/base/parts/ipc/common/ipc';

interface IMessagePortLike {
	postMessage(message: unknown): void;
	start(): void;
	close(): void;
	on(event: 'close', listener: () => void): void;
	on(event: 'message', listener: (event: { data: unknown }) => void): void;
	off(event: 'close', listener: () => void): void;
	off(event: 'message', listener: (event: { data: unknown }) => void): void;
}

type Request = {
	type: 'call' | 'listen' | 'dispose' | 'cancel';
	id: number;
	channelName?: string;
	name?: string;
	arg?: unknown;
};

type Response =
	| { type: 'result'; id: number; value: unknown }
	| { type: 'error'; id: number; error: { name: string; message: string; stack?: string } }
	| { type: 'event'; id: number; value: unknown };

type Message = Request | Response;

function isMessage(message: unknown): message is Message {
	return typeof message === 'object' && message !== null && 'type' in message && typeof (message as { type: unknown }).type === 'string';
}

function asError(value: unknown): Error {
	if (value instanceof Error) {
		return value;
	}
	return new Error(typeof value === 'string' ? value : 'Unknown IPC error.');
}

/**
 * Duplex channel transport for Electron MessagePorts.
 *
 * The same port can host local server channels and call remote server channels,
 * which keeps the shared process connected to the main process without a
 * renderer-side runtime or an additional compatibility transport.
 */
export class MessagePortChannel extends Disposable {
	private readonly channels = new Map<string, IServerChannel<string>>();
	private readonly activeListeners = new Map<number, IDisposable>();
	private readonly activeCalls = new Map<number, CancellationTokenSource>();
	private readonly pendingCalls = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
	private readonly eventEmitters = new Map<number, EventEmitter<unknown>>();
	private nextRequestId = 0;
	private disconnected = false;

	constructor(
		private readonly port: IMessagePortLike,
		private readonly context: string,
	) {
		super();
		this.port.on('message', this.onMessage);
		this.port.on('close', this.onClose);
		this.port.start();
	}

	registerChannel(channelName: string, channel: IServerChannel<string>): void {
		this.assertConnected();
		if (this.channels.has(channelName)) {
			throw new Error(`IPC channel "${channelName}" is already registered.`);
		}
		this.channels.set(channelName, channel);
	}

	getChannel<T extends IChannel = IChannel>(channelName: string): T {
		return {
			call: <TResult = unknown>(command: string, arg?: unknown, token: CancellationToken = CancellationTokenNone) =>
				this.call<TResult>(channelName, command, arg, token),
			listen: <TResult = unknown>(event: string, arg?: unknown): Event<TResult> =>
				this.listen<TResult>(channelName, event, arg),
		} as T;
	}

	private call<T>(channelName: string, name: string, arg: unknown, token: CancellationToken): Promise<T> {
		this.assertConnected();
		const id = this.nextRequestId++;
		return new Promise<T>((resolve, reject) => {
			const cancellation = token.onCancellationRequested(() => {
				this.pendingCalls.delete(id);
				this.port.postMessage({ type: 'cancel', id } satisfies Request);
				cancellation.dispose();
				reject(new CancellationError());
			});
			this.pendingCalls.set(id, {
				resolve: value => {
					cancellation.dispose();
					resolve(value as T);
				},
				reject: error => {
					cancellation.dispose();
					reject(error);
				},
			});
			try {
				this.port.postMessage({ type: 'call', id, channelName, name, arg } satisfies Request);
			} catch (error) {
				this.pendingCalls.delete(id);
				cancellation.dispose();
				reject(asError(error));
			}
		});
	}

	private listen<T>(channelName: string, name: string, arg: unknown): Event<T> {
		return listener => {
			this.assertConnected();
			const id = this.nextRequestId++;
			const emitter = new EventEmitter<unknown>();
			this.eventEmitters.set(id, emitter);
			const subscription = emitter.event(value => listener(value as T));
			try {
				this.port.postMessage({ type: 'listen', id, channelName, name, arg } satisfies Request);
			} catch (error) {
				subscription.dispose();
				this.eventEmitters.delete(id);
				emitter.dispose();
				throw asError(error);
			}
			return toDisposable(() => {
				subscription.dispose();
				const removedEmitter = this.eventEmitters.get(id);
				this.eventEmitters.delete(id);
				removedEmitter?.dispose();
				if (!this.disconnected) {
					this.port.postMessage({ type: 'dispose', id } satisfies Request);
				}
			});
		};
	}

	private readonly onClose = () => {
		this.disconnect(new Error('Message port closed by the remote endpoint.'));
	};

	private readonly onMessage = (event: { data: unknown }) => {
		const message = event.data;
		if (!isMessage(message)) {
			return;
		}
		if (message.type === 'result' || message.type === 'error' || message.type === 'event') {
			this.handleResponse(message);
			return;
		}
		void this.handleRequest(message);
	};

	private async handleRequest(request: Request): Promise<void> {
		if (this.disconnected) {
			return;
		}
		if (request.type === 'dispose') {
			const activeListener = this.activeListeners.get(request.id);
			this.activeListeners.delete(request.id);
			activeListener?.dispose();
			return;
		}
		if (request.type === 'cancel') {
			this.activeCalls.get(request.id)?.cancel();
			return;
		}
		const channel = this.channels.get(request.channelName ?? '');
		if (!channel || !request.name) {
			this.postError(request.id, new Error(`Unknown IPC channel "${request.channelName ?? ''}".`));
			return;
		}
		try {
			if (request.type === 'call') {
				const cancellation = new CancellationTokenSource();
				this.activeCalls.set(request.id, cancellation);
				const value = await channel.call(this.context, request.name, request.arg, cancellation.token);
				this.activeCalls.delete(request.id);
				cancellation.dispose();
				if (!this.disconnected) {
					this.port.postMessage({ type: 'result', id: request.id, value } satisfies Response);
				}
				return;
			}
			this.activeListeners.set(request.id, channel.listen(this.context, request.name, request.arg)(value => {
				if (!this.disconnected) {
					this.port.postMessage({ type: 'event', id: request.id, value } satisfies Response);
				}
			}));
		} catch (error) {
			const activeCall = this.activeCalls.get(request.id);
			this.activeCalls.delete(request.id);
			activeCall?.dispose();
			if (!this.disconnected) {
				this.postError(request.id, asError(error));
			}
		}
	}

	private handleResponse(response: Response): void {
		if (response.type === 'event') {
			this.eventEmitters.get(response.id)?.fire(response.value);
			return;
		}
		const pending = this.pendingCalls.get(response.id);
		if (!pending) {
			return;
		}
		this.pendingCalls.delete(response.id);
		if (response.type === 'result') {
			pending.resolve(response.value);
			return;
		}
		const error = new Error(response.error.message);
		error.name = response.error.name;
		error.stack = response.error.stack;
		pending.reject(error);
	}

	private postError(id: number, error: Error): void {
		this.port.postMessage({
			type: 'error',
			id,
			error: { name: error.name, message: error.message, stack: error.stack },
		} satisfies Response);
	}

	disconnect(error: Error): void {
		this.terminate(error, false);
	}

	private assertConnected(): void {
		if (this.disconnected) {
			throw new Error('Message port is disconnected.');
		}
	}

	private terminate(error: Error, closePort: boolean): void {
		if (this.disconnected) {
			return;
		}
		this.disconnected = true;
		const cleanupErrors: unknown[] = [];
		for (const pending of this.pendingCalls.values()) {
			try {
				pending.reject(error);
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		this.pendingCalls.clear();
		for (const listener of this.activeListeners.values()) {
			try {
				listener.dispose();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		this.activeListeners.clear();
		for (const cancellation of this.activeCalls.values()) {
			try {
				cancellation.cancel();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
			try {
				cancellation.dispose();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		this.activeCalls.clear();
		this.channels.clear();
		for (const emitter of this.eventEmitters.values()) {
			try {
				emitter.dispose();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		this.eventEmitters.clear();
		try {
			this.port.off('message', this.onMessage);
			this.port.off('close', this.onClose);
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError);
		}
		if (closePort) {
			try {
				this.port.close();
			} catch (cleanupError) {
				cleanupErrors.push(cleanupError);
			}
		}
		try {
			super.dispose();
		} catch (cleanupError) {
			cleanupErrors.push(cleanupError);
		}
		if (cleanupErrors.length === 1) {
			throw cleanupErrors[0];
		}
		if (cleanupErrors.length > 1) {
			throw new AggregateError(cleanupErrors, 'Failed to terminate message port IPC resources.');
		}
	}

	override dispose(): void {
		this.terminate(new Error('Message port was disposed.'), true);
	}
}
