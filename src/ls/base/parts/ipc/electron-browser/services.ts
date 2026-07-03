/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IChannel } from 'ls/base/parts/ipc/common/ipc';
import { ProxyChannel } from 'ls/base/parts/ipc/common/ipc';
import {
	IMainProcessService,
	type IMainProcessService as MainProcessServiceShape,
} from 'ls/base/parts/ipc/common/mainProcessService';
import type { IRemoteService } from 'ls/base/parts/ipc/common/services';
import { SyncDescriptor } from 'ls/platform/instantiation/common/descriptors';
import { registerSingleton } from 'ls/platform/instantiation/common/extensions';
import {
	IInstantiationService,
	type IInstantiationService as InstantiationServiceShape,
	type ServiceIdentifier,
} from 'ls/platform/instantiation/common/instantiation';

type ChannelClientCtor<T> = new (channel: IChannel, ...args: unknown[]) => T;
type Remote = Pick<IRemoteService, 'getChannel'>;

abstract class RemoteServiceStub<T extends object> {
	constructor(
		channelName: string,
		options:
			| IRemoteServiceWithChannelClientOptions<T>
			| IRemoteServiceWithProxyOptions
			| undefined,
		remote: Remote,
		instantiationService: InstantiationServiceShape,
	) {
		const channel = remote.getChannel(channelName);

		if (isRemoteServiceWithChannelClientOptions(options)) {
			return instantiationService.createInstance(
				new SyncDescriptor(options.channelClientCtor, [channel]),
			);
		}

		return ProxyChannel.toService<T>(channel, options?.proxyOptions);
	}
}

export interface IRemoteServiceWithChannelClientOptions<T> {
	readonly channelClientCtor: ChannelClientCtor<T>;
}

export interface IRemoteServiceWithProxyOptions {
	readonly proxyOptions?: ProxyChannel.ICreateProxyServiceOptions;
}

function isRemoteServiceWithChannelClientOptions<T>(
	value:
		| IRemoteServiceWithChannelClientOptions<T>
		| IRemoteServiceWithProxyOptions
		| undefined,
): value is IRemoteServiceWithChannelClientOptions<T> {
	return !!value && 'channelClientCtor' in value;
}

class MainProcessRemoteServiceStub<T extends object> extends RemoteServiceStub<T> {
	constructor(
		channelName: string,
		options:
			| IRemoteServiceWithChannelClientOptions<T>
			| IRemoteServiceWithProxyOptions
			| undefined,
		ipcService: MainProcessServiceShape,
		instantiationService: InstantiationServiceShape,
	) {
		super(channelName, options, ipcService, instantiationService);
	}
}

IMainProcessService(MainProcessRemoteServiceStub, undefined, 2);
IInstantiationService(MainProcessRemoteServiceStub, undefined, 3);

export function registerMainProcessRemoteService<T extends object>(
	id: ServiceIdentifier<T>,
	channelName: string,
	options?:
		| IRemoteServiceWithChannelClientOptions<T>
		| IRemoteServiceWithProxyOptions,
): void {
	registerSingleton(
		id,
		new SyncDescriptor(MainProcessRemoteServiceStub, [channelName, options], true),
	);
}
