/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { CancellationToken } from 'cs/base/common/cancellation';
import { CancellationTokenNone } from 'cs/base/common/cancellation';
import type { Event } from 'cs/base/common/event';
import { EventEmitter } from 'cs/base/common/event';
import type { DisposableLike } from 'cs/base/common/lifecycle';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';

export interface IChannel {
	call<T = unknown>(
		command: string,
		arg?: unknown,
		cancellationToken?: CancellationToken,
	): Promise<T>;
	listen<T = unknown>(event: string, arg?: unknown): Event<T>;
}

export interface IServerChannel<TContext = string> {
	call<T = unknown>(
		ctx: TContext,
		command: string,
		arg?: unknown,
		cancellationToken?: CancellationToken,
	): Promise<T>;
	listen<T = unknown>(ctx: TContext, event: string, arg?: unknown): Event<T>;
}

export interface IChannelServer<TContext = string> {
	registerChannel(channelName: string, channel: IServerChannel<TContext>): void;
}

export interface IChannelClient {
	getChannel<T extends IChannel = IChannel>(channelName: string): T;
}

export interface Client<TContext = string> {
	readonly ctx: TContext;
}

export interface IConnectionHub<TContext = string> {
	readonly connections: readonly Client<TContext>[];
	readonly onDidAddConnection: Event<Client<TContext>>;
	readonly onDidRemoveConnection: Event<Client<TContext>>;
}

export interface IClientRouter<TContext = string> {
	routeCall(
		hub: IConnectionHub<TContext>,
		command: string,
		arg?: unknown,
		cancellationToken?: CancellationToken,
	): Promise<Client<TContext>>;
	routeEvent(
		hub: IConnectionHub<TContext>,
		event: string,
		arg?: unknown,
	): Promise<Client<TContext>>;
}

export interface IRoutingChannelClient<TContext = string> {
	getChannel<T extends IChannel = IChannel>(
		channelName: string,
		router: IClientRouter<TContext>,
	): T;
}

export class StaticRouter<TContext = string> implements IClientRouter<TContext> {
	constructor(private readonly fn: (ctx: TContext) => boolean | Promise<boolean>) {}

	routeCall(
		hub: IConnectionHub<TContext>,
		_command?: string,
		_arg?: unknown,
		_cancellationToken?: CancellationToken,
	): Promise<Client<TContext>> {
		return this.route(hub);
	}

	routeEvent(
		hub: IConnectionHub<TContext>,
		_event?: string,
		_arg?: unknown,
	): Promise<Client<TContext>> {
		return this.route(hub);
	}

	private async route(hub: IConnectionHub<TContext>): Promise<Client<TContext>> {
		for (const connection of hub.connections) {
			if (await this.fn(connection.ctx)) {
				return connection;
			}
		}

		return new Promise(resolve => {
			const disposable = hub.onDidAddConnection(async connection => {
				if (await this.fn(connection.ctx)) {
					disposable.dispose();
					resolve(connection);
				}
			});
		});
	}
}

export function getDelayedChannel<T extends IChannel>(
	channelPromise: Promise<T>,
): T {
	return {
		call<TResult = unknown>(
			command: string,
			arg?: unknown,
			cancellationToken?: CancellationToken,
		) {
			return channelPromise.then(channel =>
				channel.call<TResult>(command, arg, cancellationToken),
			);
		},

		listen<TResult = unknown>(event: string, arg?: unknown): Event<TResult> {
			return listener => {
				const store = new DisposableStore();
				let disposed = false;

				void channelPromise.then(channel => {
					if (disposed) {
						return;
					}

					store.add(channel.listen<TResult>(event, arg)(listener));
				});

				return toDisposable(() => {
					disposed = true;
					store.dispose();
				});
			};
		},
	} as T;
}

export function getNextTickChannel<T extends IChannel>(channel: T): T {
	let tickPromise: Promise<void> | undefined;
	const whenTicked = () => {
		tickPromise ??= new Promise<void>(resolve => {
			setTimeout(resolve, 0);
		});
		return tickPromise;
	};

	return {
		async call<TResult = unknown>(
			command: string,
			arg?: unknown,
			cancellationToken: CancellationToken = CancellationTokenNone,
		) {
			await whenTicked();
			return channel.call<TResult>(command, arg, cancellationToken);
		},

		listen<TResult = unknown>(event: string, arg?: unknown): Event<TResult> {
			return getDelayedChannel(whenTicked().then(() => channel)).listen<TResult>(
				event,
				arg,
			);
		},
	} as T;
}

function isUpperAsciiLetter(code: number): boolean {
	return code >= 65 && code <= 90;
}

function propertyIsEvent(name: string): boolean {
	return name[0] === 'o' && name[1] === 'n' && isUpperAsciiLetter(name.charCodeAt(2));
}

function propertyIsDynamicEvent(name: string): boolean {
	return (
		name.startsWith('onDynamic') &&
		isUpperAsciiLetter(name.charCodeAt('onDynamic'.length))
	);
}

function asError(message: string) {
	return new Error(message);
}

export namespace ProxyChannel {
	export interface IProxyOptions {
		readonly disableMarshalling?: boolean;
	}

	export interface ICreateServiceChannelOptions extends IProxyOptions {}

	export interface ICreateProxyServiceOptions extends IProxyOptions {
		readonly context?: unknown;
		readonly properties?: Map<string, unknown>;
	}

	type ServiceRecord = Record<string, unknown>;

	export function fromService<TContext = string>(
		service: unknown,
		disposables: DisposableStore,
		_options: ICreateServiceChannelOptions = {},
	): IServerChannel<TContext> {
		const handler = service as ServiceRecord;
		const eventCache = new Map<string, Event<unknown>>();

		return {
			async call<TResult = unknown>(
				_ctx: TContext,
				command: string,
				args?: unknown,
				_cancellationToken?: CancellationToken,
			): Promise<TResult> {
				const target = handler[command];
				if (typeof target !== 'function') {
					throw asError(`Method not found: ${command}`);
				}

				const methodArgs = Array.isArray(args) ? args : [];
				return await target.apply(handler, methodArgs) as TResult;
			},

			listen<TResult = unknown>(
				_ctx: TContext,
				event: string,
				arg?: unknown,
			): Event<TResult> {
				const cachedEvent = eventCache.get(event);
				if (cachedEvent) {
					return cachedEvent as Event<TResult>;
				}

				const target = handler[event];
				if (typeof target === 'function' && propertyIsDynamicEvent(event)) {
					return target.call(handler, arg) as Event<TResult>;
				}

				if (propertyIsEvent(event) && typeof target === 'function') {
					const emitter = disposables.add(new EventEmitter<unknown>());
					const subscription = target((payload: unknown) => {
						emitter.fire(payload);
					}) as DisposableLike;
					disposables.add(subscription);
					eventCache.set(event, emitter.event);
					return emitter.event as Event<TResult>;
				}

				throw asError(`Event not found: ${event}`);
			},
		};
	}

	export function toService<T extends object>(
		channel: IChannel,
		options: ICreateProxyServiceOptions = {},
	): T {
		return new Proxy({} as T, {
			get(_target, propKey) {
				if (typeof propKey !== 'string') {
					throw asError(`Property not found: ${String(propKey)}`);
				}

				if (options.properties?.has(propKey)) {
					return options.properties.get(propKey);
				}

				if (propertyIsDynamicEvent(propKey)) {
					return (arg: unknown) => channel.listen(propKey, arg);
				}

				if (propertyIsEvent(propKey)) {
					return channel.listen(propKey);
				}

				return (...args: unknown[]) => {
					const methodArgs =
						options.context === undefined
							? args
							: [options.context, ...args];
					return channel.call(propKey, methodArgs);
				};
			},
		});
	}
}
