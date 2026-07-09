/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'cs/base/common/event';
import type { LocaleMessages } from 'language/locales';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { formatLocaleMessage } from 'cs/workbench/common/errorMessages';
import { EMPTY_WEB_CONTENT_STATE, resolveWebContentNavigation, resolveWebContentRefreshMode, resolveWebContentStateUrlUpdate } from 'cs/workbench/contrib/browserView/common/browserView';
import type { WebContentState } from 'cs/platform/browserView/common/browserView';
import type { INotificationService } from 'cs/platform/notification/common/notification';

type StringSetter = (value: string) => void;
type StringStateSetter = (value: string | ((current: string) => string)) => void;

export type WebContentNavigationSnapshot = {
  browserUrl: string;
  webContentState: WebContentState;
};

type WebContentStateSyncContext = {
  webContentRuntime: boolean;
  setWebUrl: StringSetter;
  setFetchSeedUrl: StringStateSetter;
};

type NavigateToAddressBarUrlParams = {
  nextUrl: string;
  showToast?: boolean;
  electronRuntime: boolean;
  webContentRuntime: boolean;
  ui: LocaleMessages;
  setWebUrl: StringSetter;
  setFetchSeedUrl: StringSetter;
};

type BrowserRefreshParams = {
  electronRuntime: boolean;
  webContentRuntime: boolean;
  ui: LocaleMessages;
};

type WebContentNavigationButtonParams = {
  webContentRuntime: boolean;
  ui: LocaleMessages;
};

const DEFAULT_WEB_CONTENT_NAVIGATION_SNAPSHOT: WebContentNavigationSnapshot = {
  browserUrl: '',
  webContentState: EMPTY_WEB_CONTENT_STATE,
};

function isSameWebContentTargetId(left: string | null, right: string | null) {
  return (left ?? null) === (right ?? null);
}

function isStateForActiveTarget(
  state: WebContentState,
  activeTargetId: string | null,
) {
  return (
    state.ownership === 'active' &&
    isSameWebContentTargetId(state.activeTargetId, activeTargetId) &&
    isSameWebContentTargetId(state.targetId, activeTargetId)
  );
}

function areWebContentStatesEqual(previous: WebContentState, next: WebContentState) {
  return (
    previous.targetId === next.targetId &&
    previous.activeTargetId === next.activeTargetId &&
    previous.ownership === next.ownership &&
    previous.layoutPhase === next.layoutPhase &&
    previous.url === next.url &&
    (previous.pageTitle ?? '') === (next.pageTitle ?? '') &&
    (previous.faviconUrl ?? '') === (next.faviconUrl ?? '') &&
    previous.canGoBack === next.canGoBack &&
    previous.canGoForward === next.canGoForward &&
    previous.isLoading === next.isLoading &&
    previous.visible === next.visible
  );
}

function areWebContentNavigationSnapshotsEqual(
  previous: WebContentNavigationSnapshot,
  next: WebContentNavigationSnapshot,
) {
  return (
    previous.browserUrl === next.browserUrl &&
    areWebContentStatesEqual(previous.webContentState, next.webContentState)
  );
}

export class WebContentNavigationModel {
  private snapshot: WebContentNavigationSnapshot = DEFAULT_WEB_CONTENT_NAVIGATION_SNAPSHOT;
  private readonly onDidChangeEmitter = new EventEmitter<void>();
  private activeTargetId: string | null = null;

  constructor(
    private readonly nativeHost: INativeHostService,
    private readonly notificationService: INotificationService,
  ) {}

  private emitChange() {
    this.onDidChangeEmitter.fire();
  }

  private setSnapshot(nextSnapshot: WebContentNavigationSnapshot) {
    if (areWebContentNavigationSnapshotsEqual(this.snapshot, nextSnapshot)) {
      return;
    }

    this.snapshot = nextSnapshot;
    this.emitChange();
  }

  private updateSnapshot(
    updater: (snapshot: WebContentNavigationSnapshot) => WebContentNavigationSnapshot,
  ) {
    this.setSnapshot(updater(this.snapshot));
  }

  private setBrowserUrl(browserUrl: string) {
    if (this.snapshot.browserUrl === browserUrl) {
      return;
    }

    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      browserUrl,
    }));
  }

  private setWebContentState(webContentState: WebContentState) {
    this.updateSnapshot((snapshot) => ({
      ...snapshot,
      webContentState,
    }));
  }

  private applyWebContentState(
    state: WebContentState,
    context: Pick<WebContentStateSyncContext, 'setWebUrl' | 'setFetchSeedUrl'>,
  ) {
    this.setWebContentState(state);

    const webContentStateUrlUpdate = resolveWebContentStateUrlUpdate(state);
    if (!webContentStateUrlUpdate) {
      return;
    }

    this.setBrowserUrl(webContentStateUrlUpdate.browserUrl);
    context.setWebUrl(webContentStateUrlUpdate.webUrl);
    context.setFetchSeedUrl((current) => current || webContentStateUrlUpdate.fetchSeedUrl);
  }

  readonly subscribe = (listener: () => void) => {
    return this.onDidChangeEmitter.event(listener);
  };

  readonly getSnapshot = () => this.snapshot;

  async activateTarget(
    targetId: string | null,
    context?: Pick<WebContentStateSyncContext, 'setWebUrl' | 'setFetchSeedUrl'>,
  ) {
    this.activeTargetId = targetId;
    const requestedTargetId = targetId;

    const webContent = this.nativeHost.webContent;
    if (!webContent) {
      return null;
    }

    if (!targetId) {
      this.setWebContentState(EMPTY_WEB_CONTENT_STATE);
      return null;
    }

    webContent.activate(targetId);

    if (!context) {
      return null;
    }

    try {
      const state = await webContent.getState(targetId);
      if (
        !isSameWebContentTargetId(this.activeTargetId, requestedTargetId) ||
        !isStateForActiveTarget(state, requestedTargetId)
      ) {
        return null;
      }
      this.applyWebContentState(state, context);
      return state;
    } catch {
      return null;
    }
  }

  releaseTarget(targetId: string | null) {
    const webContent = this.nativeHost.webContent;
    if (!webContent) {
      return;
    }

    webContent.release(targetId);
  }

  disposeTarget(targetId: string | null) {
    const webContent = this.nativeHost.webContent;
    if (!webContent) {
      return;
    }

    webContent.dispose(targetId);
  }

  connectWebContentState({
    webContentRuntime,
    setWebUrl,
    setFetchSeedUrl,
  }: WebContentStateSyncContext): () => void {
    const webContent = this.nativeHost.webContent;
    if (!webContentRuntime || !webContent) {
      this.setWebContentState(EMPTY_WEB_CONTENT_STATE);
      return () => {};
    }

    let mounted = true;
    const requestedTargetId = this.activeTargetId;

    void webContent
      .getState(requestedTargetId)
      .then((state) => {
        if (
          !mounted ||
          !isSameWebContentTargetId(this.activeTargetId, requestedTargetId) ||
          !isStateForActiveTarget(state, requestedTargetId)
        ) {
          return;
        }

        this.applyWebContentState(state, {
          setWebUrl,
          setFetchSeedUrl,
        });
      })
      .catch(() => {});

    const unsubscribe = webContent.onStateChange((state) => {
      if (!isStateForActiveTarget(state, this.activeTargetId)) {
        return;
      }
      this.applyWebContentState(state, {
        setWebUrl,
        setFetchSeedUrl,
      });
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }

  navigateToAddressBarUrl({
    nextUrl,
    showToast,
    electronRuntime,
    webContentRuntime,
    ui,
    setWebUrl,
    setFetchSeedUrl,
  }: NavigateToAddressBarUrlParams): boolean {
    const webContentNavigation = resolveWebContentNavigation(
      nextUrl,
      electronRuntime,
      webContentRuntime,
    );

    if (webContentNavigation.kind === 'invalid-url') {
      this.notificationService.error(ui.toastEnterArticleUrl);
      return false;
    }

    setWebUrl(webContentNavigation.normalizedUrl);
    this.setBrowserUrl(webContentNavigation.normalizedUrl);
    setFetchSeedUrl(webContentNavigation.normalizedUrl);

    if (webContentNavigation.kind === 'content-runtime-unavailable') {
      this.notificationService.error(ui.toastWebContentRuntimeUnavailable);
      return false;
    }

    const webContent = this.nativeHost.webContent;
    if (webContentNavigation.kind === 'webcontents-content' && webContent) {
      void webContent
        .navigate(webContentNavigation.normalizedUrl, this.activeTargetId, 'browser')
        .catch(() => {
          this.notificationService.error(ui.toastWebContentRuntimeUnavailable);
        });

      if (showToast) {
        this.notificationService.info(formatLocaleMessage(ui.toastNavigatingTo, { url: webContentNavigation.normalizedUrl }));
      }
    }

    return true;
  }

  handleBrowserRefresh({
    electronRuntime,
    webContentRuntime,
    ui,
  }: BrowserRefreshParams): void {
    const webContentRefreshMode = resolveWebContentRefreshMode(
      electronRuntime,
      webContentRuntime,
    );

    if (webContentRefreshMode === 'content-runtime-unavailable') {
      this.notificationService.error(ui.toastWebContentRuntimeUnavailable);
      return;
    }

    const webContent = this.nativeHost.webContent;
    if (webContentRefreshMode === 'webcontents-content' && webContent) {
      webContent.reload(this.activeTargetId);
    }
  }

  handleBrowserHardReload({
    electronRuntime,
    webContentRuntime,
    ui,
  }: BrowserRefreshParams): void {
    const webContentRefreshMode = resolveWebContentRefreshMode(
      electronRuntime,
      webContentRuntime,
    );

    if (webContentRefreshMode === 'content-runtime-unavailable') {
      this.notificationService.error(ui.toastWebContentRuntimeUnavailable);
      return;
    }

    const webContent = this.nativeHost.webContent;
    if (webContentRefreshMode === 'webcontents-content' && webContent) {
      webContent.hardReload(this.activeTargetId);
    }
  }

  handleWebContentBack({ webContentRuntime, ui }: WebContentNavigationButtonParams): void {
    const webContent = this.nativeHost.webContent;
    if (!webContentRuntime || !webContent) {
      this.notificationService.info(ui.toastWebContentBackUnsupported);
      return;
    }

    webContent.goBack(this.activeTargetId);
  }

  handleWebContentForward({ webContentRuntime, ui }: WebContentNavigationButtonParams): void {
    const webContent = this.nativeHost.webContent;
    if (!webContentRuntime || !webContent) {
      this.notificationService.info(ui.toastWebContentForwardUnsupported);
      return;
    }

    webContent.goForward(this.activeTargetId);
  }

  handleWebContentClearHistory({ webContentRuntime, ui }: WebContentNavigationButtonParams): void {
    const webContent = this.nativeHost.webContent;
    if (!webContentRuntime || !webContent) {
      this.notificationService.error(ui.toastWebContentRuntimeUnavailable);
      return;
    }

    webContent.clearHistory(this.activeTargetId);
  }
}
