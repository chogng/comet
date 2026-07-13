/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

export type ElectronInvoke = {
  <TCommand extends AppCommand>(
    command: TCommand,
    args?: AppCommandPayloadMap[TCommand],
  ): Promise<AppCommandResultMap[TCommand]>;
  <T = unknown>(command: string, args?: Record<string, unknown>): Promise<T>;
};

export type WindowStateListener = (state: WindowState) => void;

/** Describes one main-to-renderer channel call without carrying executable objects. */
export interface ElectronRendererChannelCallRequest {
  readonly requestId: string;
  readonly channelName: string;
  readonly command: string;
  readonly arg?: unknown;
}

export type ElectronRendererChannelCallResponse = {
  readonly requestId: string;
} & (
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly error: string }
);

/** Describes one main-to-renderer event subscription. */
export interface ElectronRendererChannelEventSubscribeRequest {
  readonly subscriptionId: string;
  readonly channelName: string;
  readonly eventName: string;
  readonly arg?: unknown;
}

/** Carries one renderer channel event or terminal subscription error. */
export interface ElectronRendererChannelEventPayload {
  readonly subscriptionId: string;
  readonly data?: unknown;
  readonly error?: string;
}

/** Transports renderer channel DTOs across the isolated preload boundary. */
export interface ElectronRendererChannelApi {
  register(channelName: string): void;
  dispose(channelName: string): void;
  sendCallResult(response: ElectronRendererChannelCallResponse): void;
  sendEvent(payload: ElectronRendererChannelEventPayload): void;
  onCall(listener: (request: ElectronRendererChannelCallRequest) => void): () => void;
  onCallCancellation(listener: (requestId: string) => void): () => void;
  onEventSubscription(
    listener: (request: ElectronRendererChannelEventSubscribeRequest) => void,
  ): () => void;
  onEventDisposal(listener: (subscriptionId: string) => void): () => void;
}

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

export interface ElectronDocumentApi {
  onTranslationProgress: (listener: (progress: DocumentTranslationProgress) => void) => () => void;
}

export interface ElectronIpcApi {
  call: <T = unknown>(
    channelName: string,
    command: string,
    arg?: unknown,
    cancellationId?: string,
  ) => Promise<T>;
  cancel: (cancellationId: string) => void;
  listen: <T = unknown>(
    channelName: string,
    event: string,
    arg: unknown,
    listener: (payload: T) => void,
  ) => () => void;
  rendererChannels: ElectronRendererChannelApi;
}

export interface ElectronAPI {
  invoke: ElectronInvoke;
  ipc?: ElectronIpcApi;
  windowControls?: ElectronWindowControls;
  webContent?: ElectronWebContentApi;
  document?: ElectronDocumentApi;
}
