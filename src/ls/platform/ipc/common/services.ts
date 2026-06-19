import type { IChannel, IServerChannel } from 'ls/platform/ipc/common/ipc';

export interface IRemoteService {
  readonly _serviceBrand: undefined;
  getChannel(channelName: string): IChannel;
  registerChannel(channelName: string, channel: IServerChannel<string>): void;
}

