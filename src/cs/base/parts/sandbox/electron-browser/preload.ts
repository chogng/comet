/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { contextBridge, ipcRenderer } from 'electron';
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
  ElectronRendererChannelCallRequest,
  ElectronRendererChannelEventSubscribeRequest,
} from 'cs/base/parts/sandbox/common/electronTypes';
import {
  parseSerializedAppError,
  type AppErrorCode,
} from 'cs/base/parts/sandbox/common/appError';

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

/** Subscribes a renderer callback to one structured main-process payload. */
function subscribeIpcPayload<TPayload>(
  channel: string,
  listener: (payload: TPayload) => void,
) {
  if (typeof listener !== 'function') {
    throw new TypeError('IPC payload listener must be a function.');
  }

  const safeChannel = validateIpcChannel(channel);
  const wrapped = (_event: Electron.IpcRendererEvent, payload: TPayload) => {
    listener(payload);
  };

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
    rendererChannels: {
      register(channelName: string) {
        sendIpc(APP_SERVICE_IPC_RENDERER_CHANNEL_REGISTER_CHANNEL, channelName);
      },
      dispose(channelName: string) {
        sendIpc(APP_SERVICE_IPC_RENDERER_CHANNEL_DISPOSE_CHANNEL, channelName);
      },
      sendCallResult(response) {
        sendIpc(APP_SERVICE_IPC_RENDERER_CALL_RESULT_CHANNEL, response);
      },
      sendEvent(payload) {
        sendIpc(APP_SERVICE_IPC_RENDERER_EVENT_CHANNEL, payload);
      },
      onCall(listener) {
        return subscribeIpcPayload<ElectronRendererChannelCallRequest>(
          APP_SERVICE_IPC_RENDERER_CALL_CHANNEL,
          listener,
        );
      },
      onCallCancellation(listener) {
        return subscribeIpcPayload<string>(
          APP_SERVICE_IPC_RENDERER_CALL_CANCEL_CHANNEL,
          listener,
        );
      },
      onEventSubscription(listener) {
        return subscribeIpcPayload<ElectronRendererChannelEventSubscribeRequest>(
          APP_SERVICE_IPC_RENDERER_EVENT_SUBSCRIBE_CHANNEL,
          listener,
        );
      },
      onEventDisposal(listener) {
        return subscribeIpcPayload<string>(
          APP_SERVICE_IPC_RENDERER_EVENT_DISPOSE_CHANNEL,
          listener,
        );
      },
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
