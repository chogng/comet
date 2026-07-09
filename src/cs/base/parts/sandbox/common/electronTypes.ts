import type {
  AppCommand,
  AppCommandPayloadMap,
  AppCommandResultMap,
  DocumentTranslationProgress,
  FetchStatus,
  WindowControlAction,
  WindowState,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  IServerChannel,
} from 'cs/base/parts/ipc/common/ipc';
import type {
  WebContentBounds,
  WebContentLayoutPhase,
  WebContentNavigationMode,
  WebContentSelectionSnapshot,
  WebContentState,
} from 'cs/platform/browserView/common/browserView';

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
  captureScreenshot: (targetId?: string | null) => Promise<string | null>;
  getSelection: (targetId?: string | null) => Promise<WebContentSelectionSnapshot | null>;
  onStateChange: (listener: (state: WebContentState) => void) => () => void;
}

export interface ElectronFetchApi {
  onFetchStatus: (listener: (status: FetchStatus) => void) => () => void;
}

export interface ElectronDocumentApi {
  onTranslationProgress: (listener: (progress: DocumentTranslationProgress) => void) => () => void;
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
  registerChannel: (
    channelName: string,
    channel: IServerChannel<string>,
  ) => () => void;
}

export interface ElectronAPI {
  invoke: ElectronInvoke;
  ipc?: ElectronIpcApi;
  windowControls?: ElectronWindowControls;
  webContent?: ElectronWebContentApi;
  fetch?: ElectronFetchApi;
  document?: ElectronDocumentApi;
}
