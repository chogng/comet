import { contextBridge, ipcRenderer } from 'electron';
import type {
  IServerChannel,
} from 'cs/base/parts/ipc/common/ipc';
import type {
  AppCommand,
  AppCommandPayloadMap,
  AppCommandResultMap,
  DocumentTranslationProgress,
  WindowControlAction,
  WindowState,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  WebContentBounds,
  WebContentLayoutPhase,
  WebContentNavigationMode,
  WebContentSelectionSnapshot,
  WebContentState,
} from 'cs/platform/browserView/common/browserView';
import type {
  ElectronAPI,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
  parseSerializedAppError,
  serializeAppError,
  type AppErrorCode,
} from 'cs/base/parts/sandbox/common/appError';
import type { DisposableLike } from 'cs/base/common/lifecycle';
import { CancellationTokenSource } from 'cs/base/common/cancellation';

const APP_IPC_CHANNEL_PREFIX = 'app:';
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
const APP_SERVICE_IPC_RENDERER_CONTEXT = 'main';

type DesktopInvokeError = Error & {
  code?: AppErrorCode;
  details?: Record<string, unknown>;
};

type ContextAwareProcess = NodeJS.Process & {
  contextIsolated?: boolean;
};

function validateIpcChannel(channel: string): string {
  if (!channel || !channel.startsWith(APP_IPC_CHANNEL_PREFIX)) {
    throw new Error(`Unsupported IPC channel '${channel}'.`);
  }

  return channel;
}

function sendIpc(channel: string, ...args: unknown[]) {
  ipcRenderer.send(validateIpcChannel(channel), ...args);
}

function invokeIpc<TResult>(channel: string, ...args: unknown[]) {
  return ipcRenderer.invoke(validateIpcChannel(channel), ...args) as Promise<TResult>;
}

function subscribeIpc<TPayload>(
  channel: string,
  listener: (payload: TPayload) => void,
  fallbackPayload: TPayload,
) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  const safeChannel = validateIpcChannel(channel);
  const wrapped = (_event: Electron.IpcRendererEvent, payload: TPayload | undefined) =>
    listener(payload ?? fallbackPayload);

  ipcRenderer.on(safeChannel, wrapped);
  return () => {
    ipcRenderer.removeListener(safeChannel, wrapped);
  };
}

async function callIpcService<TResult>(
  channelName: string,
  command: string,
  arg?: unknown,
  cancellationId?: string,
) {
  const response = await invokeIpc<AppInvokeResponse<TResult>>(
    APP_SERVICE_IPC_CALL_CHANNEL,
    channelName,
    command,
    arg,
    cancellationId,
  );
  if (!response.ok) {
    throw normalizeInvokeError(new Error(response.error));
  }

  return response.result;
}

function listenIpcService<TPayload>(
  channelName: string,
  event: string,
  arg: unknown,
  listener: (payload: TPayload) => void,
) {
  if (typeof listener !== 'function') {
    return () => {};
  }

  const subscriptionId = `${Date.now()}:${Math.random().toString(36).slice(2)}`;
  const wrapped = (
    _event: Electron.IpcRendererEvent,
    payload:
      | {
          subscriptionId?: string;
          data?: TPayload;
        }
      | undefined,
  ) => {
    if (payload?.subscriptionId === subscriptionId) {
      listener(payload.data as TPayload);
    }
  };

  ipcRenderer.on(APP_SERVICE_IPC_EVENT_CHANNEL, wrapped);
  void invokeIpc<AppInvokeResponse<void>>(
    APP_SERVICE_IPC_EVENT_CHANNEL,
    subscriptionId,
    channelName,
    event,
    arg,
  ).then((response) => {
    if (!response.ok) {
      throw normalizeInvokeError(new Error(response.error));
    }
  }).catch((error) => {
    ipcRenderer.removeListener(APP_SERVICE_IPC_EVENT_CHANNEL, wrapped);
    console.error('Failed to subscribe to IPC channel event.', error);
  });

  return () => {
    ipcRenderer.removeListener(APP_SERVICE_IPC_EVENT_CHANNEL, wrapped);
    sendIpc(APP_SERVICE_IPC_DISPOSE_CHANNEL, subscriptionId);
  };
}

function normalizeInvokeError(error: unknown): DesktopInvokeError {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const parsed = parseSerializedAppError(rawMessage);

  const invokeError: DesktopInvokeError = new Error(parsed?.code ?? rawMessage);
  invokeError.name = 'DesktopInvokeError';

  if (parsed) {
    invokeError.code = parsed.code;
    if (parsed.details) {
      invokeError.details = parsed.details;
      if (typeof parsed.details.message === 'string') {
        invokeError.message = parsed.details.message;
      }
    }
  }

  return invokeError;
}

type AppInvokeResponse<T> =
  | { ok: true; result: T }
  | { ok: false; error: string };

type RendererCallRequest = {
  readonly requestId: string;
  readonly channelName: string;
  readonly command: string;
  readonly arg?: unknown;
};

type RendererCallResponse = {
  readonly requestId: string;
} & AppInvokeResponse<unknown>;

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
  readonly channelName: string;
  readonly disposable: DisposableLike;
};

const rendererChannels = new Map<string, IServerChannel<string>>();
const rendererEventSubscriptions = new Map<string, RendererEventSubscription>();
const rendererCalls = new Map<string, {
  readonly channelName: string;
  readonly cancellationSource: CancellationTokenSource;
}>();

function getRendererChannel(channelName: string): IServerChannel<string> {
  const channel = rendererChannels.get(channelName);
  if (!channel) {
    throw new Error(`Unknown renderer IPC channel '${channelName}'.`);
  }

  return channel;
}

function disposeRendererEventSubscription(subscriptionId: string): void {
  const subscription = rendererEventSubscriptions.get(subscriptionId);
  if (!subscription) {
    return;
  }

  subscription.disposable.dispose();
  rendererEventSubscriptions.delete(subscriptionId);
}

function disposeRendererChannelSubscriptions(channelName: string): void {
  for (const [subscriptionId, subscription] of rendererEventSubscriptions) {
    if (subscription.channelName === channelName) {
      subscription.disposable.dispose();
      rendererEventSubscriptions.delete(subscriptionId);
    }
  }
}

function cancelRendererChannelCalls(channelName: string): void {
  for (const [requestId, call] of rendererCalls) {
    if (call.channelName === channelName) {
      call.cancellationSource.cancel();
      call.cancellationSource.dispose();
      rendererCalls.delete(requestId);
    }
  }
}

function registerIpcServiceChannel(
  channelName: string,
  channel: IServerChannel<string>,
) {
  if (rendererChannels.has(channelName)) {
    throw new Error(`Renderer IPC channel '${channelName}' is already registered.`);
  }

  rendererChannels.set(channelName, channel);
  sendIpc(APP_SERVICE_IPC_RENDERER_CHANNEL_REGISTER_CHANNEL, channelName);

  return () => {
    cancelRendererChannelCalls(channelName);
    disposeRendererChannelSubscriptions(channelName);
    rendererChannels.delete(channelName);
    sendIpc(APP_SERVICE_IPC_RENDERER_CHANNEL_DISPOSE_CHANNEL, channelName);
  };
}

function registerRendererChannelHandlers(): void {
  ipcRenderer.on(
    APP_SERVICE_IPC_RENDERER_CALL_CHANNEL,
    async (_event, request: RendererCallRequest) => {
      const cancellationSource = new CancellationTokenSource();
      try {
        if (rendererCalls.has(request.requestId)) {
          throw new Error(`Renderer IPC request '${request.requestId}' is already active.`);
        }
        rendererCalls.set(request.requestId, {
          channelName: request.channelName,
          cancellationSource,
        });
        const channel = getRendererChannel(request.channelName);
        const result = await channel.call(
          APP_SERVICE_IPC_RENDERER_CONTEXT,
          request.command,
          request.arg,
          cancellationSource.token,
        );
        sendIpc(APP_SERVICE_IPC_RENDERER_CALL_RESULT_CHANNEL, {
          requestId: request.requestId,
          ok: true,
          result,
        } satisfies RendererCallResponse);
      } catch (error) {
        sendIpc(APP_SERVICE_IPC_RENDERER_CALL_RESULT_CHANNEL, {
          requestId: request.requestId,
          ok: false,
          error: serializeAppError(error),
        } satisfies RendererCallResponse);
      } finally {
        if (rendererCalls.get(request.requestId)?.cancellationSource === cancellationSource) {
          rendererCalls.delete(request.requestId);
        }
        cancellationSource.dispose();
      }
    },
  );

  ipcRenderer.on(
    APP_SERVICE_IPC_RENDERER_CALL_CANCEL_CHANNEL,
    (_event, requestId: string) => {
      rendererCalls.get(requestId)?.cancellationSource.cancel();
    },
  );

  ipcRenderer.on(
    APP_SERVICE_IPC_RENDERER_EVENT_SUBSCRIBE_CHANNEL,
    (_event, request: RendererEventSubscribeRequest) => {
      try {
        disposeRendererEventSubscription(request.subscriptionId);
        const channel = getRendererChannel(request.channelName);
        const disposable = channel.listen(
          APP_SERVICE_IPC_RENDERER_CONTEXT,
          request.eventName,
          request.arg,
        )(data => {
          sendIpc(APP_SERVICE_IPC_RENDERER_EVENT_CHANNEL, {
            subscriptionId: request.subscriptionId,
            data,
          } satisfies RendererEventPayload);
        });
        rendererEventSubscriptions.set(request.subscriptionId, {
          channelName: request.channelName,
          disposable,
        });
      } catch (error) {
        sendIpc(APP_SERVICE_IPC_RENDERER_EVENT_CHANNEL, {
          subscriptionId: request.subscriptionId,
          error: serializeAppError(error),
        } satisfies RendererEventPayload);
      }
    },
  );

  ipcRenderer.on(
    APP_SERVICE_IPC_RENDERER_EVENT_DISPOSE_CHANNEL,
    (_event, subscriptionId: string) => {
      disposeRendererEventSubscription(subscriptionId);
    },
  );
}

registerRendererChannelHandlers();

const electronAPI: ElectronAPI = {
  ipc: {
    async call<T = unknown>(channelName: string, command: string, arg?: unknown, cancellationId?: string) {
      return callIpcService<T>(channelName, command, arg, cancellationId);
    },
    cancel(cancellationId: string) {
      sendIpc(APP_SERVICE_IPC_CANCEL_CHANNEL, cancellationId);
    },
    listen<T = unknown>(
      channelName: string,
      event: string,
      arg: unknown,
      listener: (payload: T) => void,
    ) {
      return listenIpcService<T>(channelName, event, arg, listener);
    },
    registerChannel(channelName: string, channel: IServerChannel<string>) {
      return registerIpcServiceChannel(channelName, channel);
    },
  },
  async invoke<TCommand extends AppCommand>(command: TCommand, args?: AppCommandPayloadMap[TCommand]) {
    try {
      const response = await invokeIpc<AppInvokeResponse<AppCommandResultMap[TCommand]>>(
        'app:invoke',
        command,
        args ?? {},
      );
      if (!response.ok) {
        throw new Error(response.error);
      }
      return response.result;
    } catch (error) {
      throw normalizeInvokeError(error);
    }
  },
  windowControls: {
    perform(action: WindowControlAction) {
      void callIpcService<void>(
        'nativeHost',
        'perform_window_control',
        action,
      ).catch((error) => {
        console.error('Failed to perform window control action.', error);
      });
    },
    getState() {
      return callIpcService<WindowState>('nativeHost', 'get_window_state');
    },
    onStateChange(listener: (state: WindowState) => void) {
      return listenIpcService<WindowState>(
        'nativeHost',
        'on_did_change_window_state',
        undefined,
        listener,
      );
    },
  },
  webContent: {
    activate(targetId?: string | null) {
      sendIpc('app:web-content-activate', { targetId: targetId ?? null });
    },
    dispose(targetId?: string | null) {
      sendIpc('app:web-content-dispose', { targetId: targetId ?? null });
    },
    release(targetId?: string | null) {
      sendIpc('app:web-content-release', { targetId: targetId ?? null });
    },
    async navigate(
      url: string,
      targetId?: string | null,
      mode?: WebContentNavigationMode,
    ) {
      try {
        return await invokeIpc<WebContentState>('app:web-content-navigate', {
          url,
          targetId: targetId ?? null,
          mode,
        });
      } catch (error) {
        throw normalizeInvokeError(error);
      }
    },
    getState(targetId?: string | null) {
      return invokeIpc<WebContentState>('app:web-content-get-state', {
        targetId: targetId ?? null,
      });
    },
    setBounds(bounds: WebContentBounds | null) {
      sendIpc('app:web-content-set-bounds', bounds);
    },
    setVisible(visible: boolean) {
      sendIpc('app:web-content-set-visible', visible);
    },
    setLayoutPhase(phase: WebContentLayoutPhase) {
      sendIpc('app:web-content-set-layout-phase', phase);
    },
    setRetentionLimit(limit: number) {
      sendIpc('app:web-content-set-retention-limit', limit);
    },
    clearHistory(targetId?: string | null) {
      sendIpc('app:web-content-clear-history', { targetId: targetId ?? null });
    },
    hardReload(targetId?: string | null) {
      sendIpc('app:web-content-hard-reload', { targetId: targetId ?? null });
    },
    reload(targetId?: string | null) {
      sendIpc('app:web-content-reload', { targetId: targetId ?? null });
    },
    goBack(targetId?: string | null) {
      sendIpc('app:web-content-go-back', { targetId: targetId ?? null });
    },
    goForward(targetId?: string | null) {
      sendIpc('app:web-content-go-forward', { targetId: targetId ?? null });
    },
    executeJavaScript<T = unknown>(
      targetId: string | null | undefined,
      script: string,
      timeoutMs?: number,
    ) {
      return invokeIpc<T | null>('app:web-content-execute-javascript', {
        targetId: targetId ?? null,
        script,
        timeoutMs,
      });
    },
    captureScreenshot(targetId?: string | null) {
      return invokeIpc<string | null>('app:web-content-capture-screenshot', {
        targetId: targetId ?? null,
      });
    },
    getSelection(targetId?: string | null) {
      return invokeIpc<WebContentSelectionSnapshot | null>('app:web-content-get-selection', {
        targetId: targetId ?? null,
      });
    },
    onStateChange(listener: (state: WebContentState) => void) {
      return subscribeIpc<WebContentState>('app:web-content-state', listener, {
        targetId: null,
        activeTargetId: null,
        ownership: 'inactive',
        layoutPhase: 'hidden',
        url: '',
        pageTitle: '',
        faviconUrl: '',
        canGoBack: false,
        canGoForward: false,
        isLoading: false,
        visible: false,
      });
    },
  },
  document: {
    onTranslationProgress(listener: (progress: DocumentTranslationProgress) => void) {
      return subscribeIpc<DocumentTranslationProgress>('app:document-translation-progress', listener, {
        phase: 'completed',
        current: 0,
        total: 0,
        provider: '',
        model: '',
        message: null,
      });
    },
  },
};

function exposeElectronApi() {
  const contextIsolationEnabled = (process as ContextAwareProcess).contextIsolated !== false;

  if (contextIsolationEnabled) {
    try {
      contextBridge.exposeInMainWorld('electronAPI', electronAPI);
      return;
    } catch (error) {
      console.error('Failed to expose electronAPI via contextBridge.', error);
    }
  }

  const windowGlobal = globalThis as typeof globalThis & {
    electronAPI?: typeof electronAPI;
  };
  windowGlobal.electronAPI = electronAPI;
}

exposeElectronApi();
