import type {
  AppCommand,
  AppCommandPayloadMap,
  AppCommandResultMap,
  DocumentTranslationProgress,
  FetchStatus,
  NativeToastLayout,
  NativeToastOptions,
  NativeToastState,
  WebContentBounds,
  WebContentLayoutPhase,
  WebContentNavigationMode,
  WebContentSelectionSnapshot,
  WebContentState,
  WindowControlAction,
  WindowState,
} from 'ls/base/parts/sandbox/common/sandboxTypes';

export type ElectronInvoke = {
  <TCommand extends AppCommand>(
    command: TCommand,
    args?: AppCommandPayloadMap[TCommand],
  ): Promise<AppCommandResultMap[TCommand]>;
  <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
};

export type WindowStateListener = (state: WindowState) => void;

export interface ElectronWindowControls {
  perform: (action: WindowControlAction) => void;
  getState: () => Promise<WindowState>;
  onStateChange: (listener: WindowStateListener) => () => void;
}

export interface ElectronWebContentApi {
  activate: (targetId?: string | null) => void;
  dispose: (targetId?: string | null) => void;
  release: (targetId?: string | null) => void;
  navigate: (
    url: string,
    targetId?: string | null,
    mode?: WebContentNavigationMode,
  ) => Promise<WebContentState>;
  getState: (targetId?: string | null) => Promise<WebContentState>;
  setBounds: (bounds: WebContentBounds | null) => void;
  setVisible: (visible: boolean) => void;
  setLayoutPhase: (phase: WebContentLayoutPhase) => void;
  setRetentionLimit: (limit: number) => void;
  clearHistory: (targetId?: string | null) => void;
  hardReload: (targetId?: string | null) => void;
  reload: (targetId?: string | null) => void;
  goBack: (targetId?: string | null) => void;
  goForward: (targetId?: string | null) => void;
  executeJavaScript?: <T = unknown>(
    targetId: string | null | undefined,
    script: string,
    timeoutMs?: number,
  ) => Promise<T | null>;
  getSelection: (targetId?: string | null) => Promise<WebContentSelectionSnapshot | null>;
  onStateChange: (listener: (state: WebContentState) => void) => () => void;
}

export interface ElectronFetchApi {
  onFetchStatus: (listener: (status: FetchStatus) => void) => () => void;
}

export interface ElectronDocumentApi {
  onTranslationProgress: (listener: (progress: DocumentTranslationProgress) => void) => () => void;
}

export interface ElectronToastApi {
  show: (options: NativeToastOptions) => void;
  dismiss: (id: number) => void;
  getState: () => Promise<NativeToastState>;
  onStateChange: (listener: (state: NativeToastState) => void) => () => void;
  reportLayout: (layout: NativeToastLayout) => void;
  setHovering: (hovering: boolean) => void;
}

export interface ElectronIpcApi {
  call: <T = unknown>(
    channelName: string,
    command: string,
    arg?: unknown,
  ) => Promise<T>;
  listen: <T = unknown>(
    channelName: string,
    event: string,
    arg: unknown,
    listener: (payload: T) => void,
  ) => () => void;
}

export interface ElectronAPI {
  invoke: ElectronInvoke;
  ipc?: ElectronIpcApi;
  windowControls?: ElectronWindowControls;
  webContent?: ElectronWebContentApi;
  fetch?: ElectronFetchApi;
  document?: ElectronDocumentApi;
  toast?: ElectronToastApi;
}
