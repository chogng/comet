import type { IChannel } from 'ls/platform/ipc/common/ipc';
import { ProxyChannel } from 'ls/platform/ipc/common/ipc';

export type ChannelClientCtor<T> = new (channel: IChannel, ...args: any[]) => T;

export interface Remote {
  getChannel(channelName: string): IChannel;
}

export interface IRemoteServiceWithChannelClientOptions<T> {
  readonly channelClientCtor: ChannelClientCtor<T>;
}

export interface IRemoteServiceWithProxyOptions {
  readonly proxyOptions?: ProxyChannel.ICreateProxyServiceOptions;
}

function hasChannelClientCtor<T>(
  options:
    | IRemoteServiceWithChannelClientOptions<T>
    | IRemoteServiceWithProxyOptions
    | undefined,
): options is IRemoteServiceWithChannelClientOptions<T> {
  return !!(options as IRemoteServiceWithChannelClientOptions<T> | undefined)
    ?.channelClientCtor;
}

export function createRemoteService<T extends object>(
  channelName: string,
  remote: Remote,
  options?:
    | IRemoteServiceWithChannelClientOptions<T>
    | IRemoteServiceWithProxyOptions,
): T {
  const channel = remote.getChannel(channelName);

  if (hasChannelClientCtor(options)) {
    return new options.channelClientCtor(channel);
  }

  return ProxyChannel.toService<T>(channel, options?.proxyOptions);
}
