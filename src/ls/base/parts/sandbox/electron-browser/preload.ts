import { contextBridge, ipcRenderer } from 'electron';
import type {
  AppCommand,
  AppErrorCode,
  AppCommandPayloadMap,
  AppCommandResultMap,
  WebContentBridgeCommand,
  WebContentBridgeResponse,
  ElectronAPI,
  DocumentTranslationProgress,
  FetchStatus,
  NativeModalState,
  NativeToastLayout,
  NativeToastOptions,
  NativeToastState,
  WebContentBounds,
  WebContentNavigationMode,
  WebContentLayoutPhase,
  WebContentSelectionSnapshot,
  WebContentState,
  WindowControlAction,
  WindowState,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { parseSerializedAppError } from 'ls/base/common/errors';

const APP_IPC_CHANNEL_PREFIX = 'app:';
const APP_SERVICE_IPC_CALL_CHANNEL = 'app:ipc-call';
const APP_SERVICE_IPC_EVENT_CHANNEL = 'app:ipc-event';
const APP_SERVICE_IPC_DISPOSE_CHANNEL = 'app:ipc-dispose';

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
    async call<T = unknown>(channelName: string, command: string, arg?: unknown) {
      const response = await invokeIpc<AppInvokeResponse<T>>(
        APP_SERVICE_IPC_CALL_CHANNEL,
        channelName,
        command,
        arg,
      );
      if (!response.ok) {
        throw normalizeInvokeError(new Error(response.error));
      }

      return response.result;
    },
    listen<T = unknown>(
      channelName: string,
      event: string,
      arg: unknown,
      listener: (payload: T) => void,
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
              data?: T;
            }
          | undefined,
      ) => {
        if (payload?.subscriptionId === subscriptionId) {
          listener(payload.data as T);
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
          throw new Error(response.error);
        }
      }).catch((error) => {
        ipcRenderer.removeListener(APP_SERVICE_IPC_EVENT_CHANNEL, wrapped);
        console.error('Failed to subscribe to IPC channel event.', error);
      });

      return () => {
        ipcRenderer.removeListener(APP_SERVICE_IPC_EVENT_CHANNEL, wrapped);
        sendIpc(APP_SERVICE_IPC_DISPOSE_CHANNEL, subscriptionId);
      };
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
      sendIpc('app:window-action', action);
    },
    getState() {
      return invokeIpc<WindowState>('app:get-window-state');
    },
    onStateChange(listener: (state: WindowState) => void) {
      return subscribeIpc<WindowState>('app:window-state', listener, {
        isMaximized: false,
        isFullscreen: false,
      });
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
    onBridgeCommand(listener: (command: WebContentBridgeCommand) => void) {
      return subscribeIpc<WebContentBridgeCommand>(
        'app:web-content-bridge-command',
        listener,
        {
          requestId: '',
          method: 'getState',
          args: [],
        },
      );
    },
    respondToBridgeCommand(response: WebContentBridgeResponse) {
      sendIpc('app:web-content-bridge-response', response);
    },
    reportBridgeReady() {
      sendIpc('app:web-content-bridge-ready');
    },
    reportState(state: WebContentState) {
      sendIpc('app:web-content-report-state', state);
    },
  },
  fetch: {
    onFetchStatus(listener: (status: FetchStatus) => void) {
      return subscribeIpc<FetchStatus>('app:fetch-status', listener, {
        sourceId: '',
        pageUrl: '',
        pageNumber: 0,
        fetchChannel: 'network',
        fetchDetail: null,
        webContentReuseMode: null,
        extractorId: null,
        paginationStopped: false,
        paginationStopReason: null,
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
  modal: {
    getState() {
      return invokeIpc<NativeModalState | null>('app:modal-get-state');
    },
    onStateChange(listener: (state: NativeModalState | null) => void) {
      return subscribeIpc<NativeModalState | null>('app:modal-state', listener, null);
    },
  },
  toast: {
    show(options: NativeToastOptions) {
      sendIpc('app:native-toast-show', options);
    },
    dismiss(id: number) {
      sendIpc('app:native-toast-dismiss', id);
    },
    getState() {
      return invokeIpc<NativeToastState>('app:native-toast-get-state');
    },
    onStateChange(listener: (state: NativeToastState) => void) {
      return subscribeIpc<NativeToastState>('app:native-toast-state', listener, {
        items: [],
      });
    },
    reportLayout(layout: NativeToastLayout) {
      sendIpc('app:native-toast-layout', layout);
    },
    setHovering(hovering: boolean) {
      sendIpc('app:native-toast-hover', hovering);
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
