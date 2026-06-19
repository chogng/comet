import { Disposable } from 'ls/base/common/lifecycle';
import { toDisposable } from 'ls/base/common/lifecycle';
import type { Event } from 'ls/base/common/event';
import type { IChannel, IServerChannel } from 'ls/platform/ipc/common/ipc';
import type { IMainProcessService } from 'ls/platform/ipc/common/mainProcessService';
import type { ElectronIpcApi } from 'ls/base/parts/sandbox/common/desktopTypes';

export class ElectronIPCMainProcessService
  extends Disposable
  implements IMainProcessService
{
  declare readonly _serviceBrand: undefined;

  constructor(private readonly ipc: ElectronIpcApi) {
    super();
  }

  getChannel(channelName: string): IChannel {
    return {
      call: async <T = unknown>(command: string, arg?: unknown) => {
        return this.ipc.call<T>(
          channelName,
          command,
          arg,
        );
      },
      listen: <T = unknown>(event: string, arg?: unknown): Event<T> => {
        return (listener) =>
          toDisposable(this.ipc.listen(channelName, event, arg, listener));
      },
    };
  }

  registerChannel(_channelName: string, _channel: IServerChannel<string>): void {
    throw new Error('Renderer-to-main channel registration is not supported yet.');
  }
}

export function createElectronMainProcessService(
  ipc: ElectronIpcApi | undefined,
): ElectronIPCMainProcessService | null {
  if (!ipc) {
    return null;
  }

  return new ElectronIPCMainProcessService(ipc);
}
