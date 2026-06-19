import { ipcMain, type IpcMainInvokeEvent } from 'electron';

import type { IServerChannel } from 'ls/platform/ipc/common/ipc';
import { serializeAppError } from 'ls/base/common/errors';

const APP_SERVICE_IPC_CALL_CHANNEL = 'app:ipc-call';
const APP_SERVICE_IPC_EVENT_CHANNEL = 'app:ipc-event';
const APP_SERVICE_IPC_DISPOSE_CHANNEL = 'app:ipc-dispose';

type AppIpcResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

type ActiveSubscription = {
  readonly senderId: number;
  dispose(): void;
};

export class ElectronMainChannelServer {
  private readonly channels = new Map<string, IServerChannel<IpcMainInvokeEvent>>();
  private readonly subscriptions = new Map<string, ActiveSubscription>();
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
      ): Promise<AppIpcResponse<unknown>> => {
        try {
          const channel = this.resolveChannel(channelName);
          return {
            ok: true,
            result: await channel.call(event, command, arg),
          };
        } catch (error) {
          return {
            ok: false,
            error: serializeAppError(error),
          };
        }
      },
    );

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
          const subscription = channel.listen(event, eventName, arg)((data) => {
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

  disposeWebContentsSubscriptions(senderId: number): void {
    for (const [subscriptionId, subscription] of this.subscriptions) {
      if (subscription.senderId === senderId) {
        subscription.dispose();
        this.subscriptions.delete(subscriptionId);
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
