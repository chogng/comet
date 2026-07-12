/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserWindow, screen, session, WebContentsView, type Session } from 'electron';
import { VSBuffer } from 'cs/base/common/buffer';
import { Emitter, type Event } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { generateUuid } from 'cs/base/common/uuid';
import { appError } from 'cs/base/parts/sandbox/common/appError';

import {
  BrowserViewErrorCode,
  BrowserViewStorageScope,
  browserZoomDefaultIndex,
  browserZoomFactors,
  type IBrowserDeviceProfile,
  type IBrowserViewBounds,
  type IBrowserViewCaptureScreenshotOptions,
  type IBrowserViewCreatedEvent,
  type IBrowserViewCreateOptions,
  type IBrowserViewDevToolsStateEvent,
  type IBrowserViewFaviconChangeEvent,
  type IBrowserViewFindInPageOptions,
  type IBrowserViewFindInPageResult,
  type IBrowserViewFocusEvent,
  type IBrowserViewInfo,
  type IBrowserViewKeyDownEvent,
  type IBrowserViewLoadingEvent,
  type IBrowserViewNavigationEvent,
  type IBrowserViewViewStateEvent,
  type IBrowserViewOwner,
  type IBrowserViewPermissionRequestEvent,
  type IBrowserViewRect,
  type IBrowserViewService,
  type IBrowserViewState,
  type IBrowserViewTitleChangeEvent,
  type IBrowserViewVisibilityEvent,
  type IBrowserViewWindowConfiguration,
  type BrowserViewTargetPresentation,
  type IElementData,
  type WebContentBounds,
  type WebContentLayoutPhase,
  type WebContentNavigationMode,
  type WebContentSelectionSnapshot,
  type WebContentState,
} from 'cs/platform/browserView/common/browserView';
import type {
  IPermissionCategoryState,
  ISerializedBrowserPermissionsSnapshot,
} from 'cs/platform/browserView/common/browserPermissions';
import type { ICDPConnection } from 'cs/platform/browserView/common/cdp/types';
import { BrowserViewDebugger } from 'cs/platform/browserView/electron-main/browserViewDebugger';
import { BrowserViewInspector } from 'cs/platform/browserView/electron-main/browserViewInspector';
import { BrowserViewScreenshot } from 'cs/platform/browserView/electron-main/browserViewScreenshot';
import {
  createBrowserViewStateCaptureScript,
  createBrowserViewStateRestoreScript,
  parseBrowserViewViewState,
	resolveBrowserViewDocumentIpcEvent,
  resolveBrowserViewStateIpcEvent,
} from 'cs/platform/browserView/electron-main/browserViewViewState';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'cs/platform/native/electron-main/sharedWebSession';
import { resolveBrowserViewPreloadScriptPath } from 'cs/platform/window/electron-main/windowPaths';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'cs/workbench/services/webContent/webContentRetentionConfig';

const DEFAULT_WEB_CONTENT_TARGET_ID = '__shared__';
const RETAINED_WEB_CONTENT_TARGET_TTL_MS = 3 * 60 * 1000;
const DEFAULT_WEB_CONTENT_BOUNDS = { x: 0, y: 0, width: 1024, height: 768 };
const BACKGROUND_WEB_CONTENT_BOUNDS = { x: 0, y: 0, width: 1280, height: 900 };
const HIDDEN_WEB_CONTENT_BOUNDS = { x: 0, y: 0, width: 1, height: 1 };

type WebContentTargetState = Pick<
  WebContentState,
  | 'url'
  | 'pageTitle'
  | 'faviconUrl'
  | 'canGoBack'
  | 'canGoForward'
  | 'isLoading'
>;

type WebContentTargetMetadataMachine = {
  comparableUrl: string;
  pendingPageTitle: string;
  pendingFaviconUrl: string;
};

export interface BrowserViewMainContext {
  readonly id: string;
  readonly session: Session;
  readonly storageScope: BrowserViewStorageScope;
}

export interface BrowserViewMainTarget {
  readonly context: BrowserViewMainContext;
  readonly debuggerTransport: BrowserViewDebugger;
  readonly onDidClose: Event<void>;
  readonly owner: IBrowserViewOwner;
  readonly targetId: string;
  readonly view: WebContentsView;
}

type ManagedWebContentTarget = {
  cleanup: Array<() => void>;
  context: BrowserViewMainContext;
  debuggerTransport: BrowserViewDebugger;
	inspector: BrowserViewInspector;
  screenshot: BrowserViewScreenshot;
  metadataMachine: WebContentTargetMetadataMachine;
  onDidClose?: Event<void>;
  owner?: IBrowserViewOwner;
  state: WebContentTargetState;
  statusCode: number | null;
  targetId: string;
  view: WebContentsView;
};

type BrowserViewTargetEvents = {
  readonly disposables: DisposableStore;
  readonly onDidNavigate: Emitter<IBrowserViewNavigationEvent>;
  readonly onDidChangeViewState: Emitter<IBrowserViewViewStateEvent>;
  readonly onDidChangeLoadingState: Emitter<IBrowserViewLoadingEvent>;
  readonly onDidChangeFocus: Emitter<IBrowserViewFocusEvent>;
  readonly onDidChangeVisibility: Emitter<IBrowserViewVisibilityEvent>;
  readonly onDidChangeDevToolsState: Emitter<IBrowserViewDevToolsStateEvent>;
  readonly onDidKeyCommand: Emitter<IBrowserViewKeyDownEvent>;
  readonly onDidChangeTitle: Emitter<IBrowserViewTitleChangeEvent>;
  readonly onDidChangeFavicon: Emitter<IBrowserViewFaviconChangeEvent>;
  readonly onDidFindInPage: Emitter<IBrowserViewFindInPageResult>;
  readonly onDidClose: Emitter<void>;
  readonly onDidSelectElement: Emitter<IElementData>;
  readonly onDidChangeElementSelectionActive: Emitter<boolean>;
  readonly onDidPickArea: Emitter<IBrowserViewRect | undefined>;
  readonly onDidChangeAreaSelectionActive: Emitter<boolean>;
  readonly onDidChangeDeviceEmulation: Emitter<IBrowserDeviceProfile | undefined>;
  readonly onDidChangeRemoteStatus: Emitter<boolean>;
  readonly onDidRequestPermission: Emitter<IBrowserViewPermissionRequestEvent>;
  readonly onDidChangePermissions: Emitter<ISerializedBrowserPermissionsSnapshot>;
};

type BrowserViewTargetMetadata = {
  readonly owner: IBrowserViewOwner;
  readonly storageScope: BrowserViewStorageScope;
  readonly events: BrowserViewTargetEvents;
  presentation: BrowserViewTargetPresentation;
  permissions: ISerializedBrowserPermissionsSnapshot;
  browserZoomIndex: number;
  device: IBrowserDeviceProfile | undefined;
  emulationScaleFactor: number;
  visible: boolean;
  bounds: WebContentBounds | undefined;
  lastScreenshot: VSBuffer | undefined;
  readonly consoleLogs: string[];
  navigationGeneration: number;
  viewStateDocumentId: string | undefined;
  viewState: IBrowserViewViewStateEvent | undefined;
};

type RetainedWebContentTarget = {
  releasedAt: number;
};

let webContentWindow: BrowserWindow | null = null;
let activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
let lastReportedWebContentState: WebContentState = createDefaultWebContentState();
let disposeWebContentWindowListeners: (() => void) | null = null;
let webContentBounds: WebContentBounds | null = null;
let webContentVisible = false;
let webContentLayoutPhase: WebContentLayoutPhase = 'hidden';
let webContentRetentionSweepTimer: ReturnType<typeof setTimeout> | null = null;
let browserTabKeepAliveLimit = defaultBrowserTabKeepAliveLimit;
const webContentTargets = new Map<string, ManagedWebContentTarget>();
const retainedWebContentTargets = new Map<string, RetainedWebContentTarget>();
const browserViewTargetMetadata = new Map<string, BrowserViewTargetMetadata>();
const browserViewWindowConfigurations = new Map<number, IBrowserViewWindowConfiguration>();
const browserViewCreatedEmitter = new Emitter<IBrowserViewCreatedEvent>();
function createBrowserViewTargetEvents(): BrowserViewTargetEvents {
  const disposables = new DisposableStore();
  return {
    disposables,
    onDidNavigate: disposables.add(new Emitter<IBrowserViewNavigationEvent>()),
    onDidChangeViewState: disposables.add(new Emitter<IBrowserViewViewStateEvent>()),
    onDidChangeLoadingState: disposables.add(new Emitter<IBrowserViewLoadingEvent>()),
    onDidChangeFocus: disposables.add(new Emitter<IBrowserViewFocusEvent>()),
    onDidChangeVisibility: disposables.add(new Emitter<IBrowserViewVisibilityEvent>()),
    onDidChangeDevToolsState: disposables.add(new Emitter<IBrowserViewDevToolsStateEvent>()),
    onDidKeyCommand: disposables.add(new Emitter<IBrowserViewKeyDownEvent>()),
    onDidChangeTitle: disposables.add(new Emitter<IBrowserViewTitleChangeEvent>()),
    onDidChangeFavicon: disposables.add(new Emitter<IBrowserViewFaviconChangeEvent>()),
    onDidFindInPage: disposables.add(new Emitter<IBrowserViewFindInPageResult>()),
    onDidClose: disposables.add(new Emitter<void>()),
    onDidSelectElement: disposables.add(new Emitter<IElementData>()),
    onDidChangeElementSelectionActive: disposables.add(new Emitter<boolean>()),
    onDidPickArea: disposables.add(new Emitter<IBrowserViewRect | undefined>()),
    onDidChangeAreaSelectionActive: disposables.add(new Emitter<boolean>()),
    onDidChangeDeviceEmulation: disposables.add(new Emitter<IBrowserDeviceProfile | undefined>()),
    onDidChangeRemoteStatus: disposables.add(new Emitter<boolean>()),
    onDidRequestPermission: disposables.add(new Emitter<IBrowserViewPermissionRequestEvent>()),
    onDidChangePermissions: disposables.add(new Emitter<ISerializedBrowserPermissionsSnapshot>()),
  };
}

function createBrowserViewContext(
  targetId: string,
  storageScope: BrowserViewStorageScope,
): BrowserViewMainContext {
  switch (storageScope) {
    case BrowserViewStorageScope.Global:
      return {
        id: WORKBENCH_SHARED_WEB_PARTITION,
        session: session.fromPartition(WORKBENCH_SHARED_WEB_PARTITION),
        storageScope,
      };
    case BrowserViewStorageScope.Ephemeral:
      return {
        id: targetId,
        session: session.fromPartition(`comet-browser-view-${targetId}`),
        storageScope,
      };
    case BrowserViewStorageScope.Workspace:
      throw new Error('Workspace-scoped browser sessions require a workspace identifier.');
  }
}

function createBrowserViewTargetMetadata(
  options: IBrowserViewCreateOptions,
): BrowserViewTargetMetadata {
  const initialState = options.initialState;
  return {
    owner: options.owner,
    storageScope: options.sessionOptions.scope,
    events: createBrowserViewTargetEvents(),
    presentation: options.presentation,
    permissions: initialState?.permissions ?? { origins: {} },
    browserZoomIndex: normalizeBrowserZoomIndex(initialState?.browserZoomIndex),
    device: initialState?.device,
    emulationScaleFactor: 1,
    visible: false,
    bounds: undefined,
    lastScreenshot: initialState?.lastScreenshot,
    consoleLogs: [],
    navigationGeneration: 0,
		viewStateDocumentId: undefined,
    viewState: initialState?.url
      ? { url: initialState.url, scrollX: 0, scrollY: 0 }
      : undefined,
  };
}

function getBrowserViewTargetMetadata(targetId: string) {
  const metadata = browserViewTargetMetadata.get(targetId);
  if (!metadata) {
    throw new Error(`Browser view '${targetId}' does not exist.`);
  }
  return metadata;
}

function disposeBrowserViewTargetMetadata(targetId: string) {
  const metadata = browserViewTargetMetadata.get(targetId);
  if (!metadata) {
    return;
  }

  metadata.events.onDidClose.fire();
  metadata.events.disposables.dispose();
  browserViewTargetMetadata.delete(targetId);
}

function createDefaultWebContentTargetState(): WebContentTargetState {
  return {
    url: '',
    pageTitle: '',
    faviconUrl: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  };
}

function normalizeWebContentTargetId(targetId?: string | null) {
  const normalized = String(targetId ?? '').trim();
  return normalized || DEFAULT_WEB_CONTENT_TARGET_ID;
}

function createDefaultWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const isActiveTarget = normalizedTargetId === activeWebContentTargetId;
  return {
    ...createDefaultWebContentTargetState(),
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId:
      activeWebContentTargetId === DEFAULT_WEB_CONTENT_TARGET_ID
        ? null
        : activeWebContentTargetId,
    ownership:
      isActiveTarget ? 'active' : 'inactive',
    layoutPhase: isActiveTarget ? webContentLayoutPhase : 'hidden',
    visible: isActiveTarget ? webContentVisible : false,
  };
}

function rememberReportedWebContentState(state: WebContentState) {
  lastReportedWebContentState = state;
  activeWebContentTargetId = normalizeWebContentTargetId(state.activeTargetId);
}

function getActiveWebContentTargetId() {
  return activeWebContentTargetId;
}

function createDefaultTargetMetadataMachine(): WebContentTargetMetadataMachine {
  return {
    comparableUrl: '',
    pendingPageTitle: '',
    pendingFaviconUrl: '',
  };
}

function sanitizeWebContentFaviconUrl(value: unknown) {
  return String(value ?? '').trim();
}

function normalizeComparableWebContentUrl(value: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) return '';

  try {
    const parsed = new URL(normalized);
    parsed.hash = '';
    if (parsed.pathname !== '/') {
      parsed.pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    }
    return parsed.toString();
  } catch {
    return normalized;
  }
}

function coerceWebContentNavigationUrl(value: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  if (/^about:blank$/i.test(normalized) || /^https?:\/\/about:blank$/i.test(normalized)) {
    return 'about:blank';
  }

  return normalized;
}

function isWebContentFailureUrl(url: string) {
  return /^about:blank$/i.test(url) || /^chrome-error:\/\//i.test(url);
}

function sanitizeWebContentPageTitle(pageTitle: string, currentUrl: string) {
  const normalizedPageTitle = String(pageTitle ?? '').trim();
  if (!normalizedPageTitle) {
    return '';
  }

  if (
    /^about:blank$/i.test(normalizedPageTitle) ||
    /^https?:\/\/about:blank$/i.test(normalizedPageTitle)
  ) {
    return '';
  }

  return coerceWebContentNavigationUrl(currentUrl) === 'about:blank'
    ? ''
    : normalizedPageTitle;
}

function hasWebContentReachedStableDestination(
  currentUrl: string,
  targetUrl: string,
  initialUrl: string,
  isLoading: boolean,
) {
  if (!currentUrl || isWebContentFailureUrl(currentUrl)) {
    return false;
  }

  if (currentUrl === targetUrl) {
    return true;
  }

  if (isLoading) {
    return false;
  }

  return currentUrl !== initialUrl;
}

function hasWebContentReachedTarget(
  mode: WebContentNavigationMode,
  currentUrl: string,
  targetUrl: string,
  initialUrl: string,
  isLoading: boolean,
) {
  switch (mode) {
    case 'strict':
      return currentUrl === targetUrl;
    case 'browser':
    default:
      return hasWebContentReachedStableDestination(
        currentUrl,
        targetUrl,
        initialUrl,
        isLoading,
      );
  }
}

function isAbortLikeWebContentNavigationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\bERR_ABORTED\b/i.test(message) || /\(-3\)\s+loading\b/i.test(message);
}

function delay(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

export type WebContentDocumentSnapshot = {
  url: string;
  html: string;
  statusCode: number | null;
  captureMs: number;
  isLoading: boolean;
	documentReadyState: string;
};

type WebContentDocumentSnapshotOptions = {
  timeoutMs?: number;
};

const webContentDocumentSnapshotTimedOut = Symbol('webContentDocumentSnapshotTimedOut');

type WebContentExecutionTimeoutResult = {
  __csTimedOut: true;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function publishBrowserViewViewState(targetId: string, viewState: IBrowserViewViewStateEvent): void {
	const metadata = getBrowserViewTargetMetadata(targetId);
	metadata.viewState = viewState;
	metadata.events.onDidChangeViewState.fire(viewState);
}

function isWebContentLayoutPhase(value: unknown): value is WebContentLayoutPhase {
  return value === 'hidden' || value === 'measuring' || value === 'visible';
}

function isWebContentExecutionTimeoutResult(
  value: unknown,
): value is WebContentExecutionTimeoutResult {
  return isRecord(value) && value.__csTimedOut === true;
}

function isValidWebContentBounds(bounds: WebContentBounds | null): bounds is WebContentBounds {
  return Boolean(
    bounds &&
      Number.isFinite(bounds.x) &&
      Number.isFinite(bounds.y) &&
      Number.isFinite(bounds.width) &&
      Number.isFinite(bounds.height) &&
      bounds.width > 0 &&
      bounds.height > 0,
  );
}

function getWebContentOwnerWindow() {
  if (!webContentWindow || webContentWindow.isDestroyed()) {
    throw appError(BrowserViewErrorCode.PreviewNotReady, {
      message: 'Desktop web content window is unavailable.',
    });
  }

  return webContentWindow;
}

function shouldShowActiveWebContentTarget() {
  return Boolean(
    webContentVisible &&
      webContentLayoutPhase === 'visible' &&
      isValidWebContentBounds(webContentBounds),
  );
}

function buildWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const target = webContentTargets.get(normalizedTargetId);
  const currentState = target?.state ?? createDefaultWebContentTargetState();
  const activeTargetId = getActiveWebContentTargetId();
  const isActiveTarget = normalizedTargetId === activeTargetId;

  return {
    ...currentState,
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId:
      activeTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : activeTargetId,
    ownership: isActiveTarget ? 'active' : 'inactive',
    layoutPhase: isActiveTarget ? webContentLayoutPhase : 'hidden',
    visible: isActiveTarget && Boolean(target?.view.getVisible()),
  };
}

function normalizeWebContentTimeoutMs(value: unknown) {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(Number(value) || 0)) : 0;
}

async function executeWebContentScriptForTarget<T>(
  targetId: string | null | undefined,
  script: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<T | typeof webContentDocumentSnapshotTimedOut> {
  const timeoutMs = normalizeWebContentTimeoutMs(options.timeoutMs);
  const entry = webContentTargets.get(normalizeWebContentTargetId(targetId));
  if (!entry || entry.view.webContents.isDestroyed()) {
    return webContentDocumentSnapshotTimedOut;
  }

  try {
    const execution = entry.view.webContents.executeJavaScript(script, true) as Promise<T>;
    const result = timeoutMs > 0
      ? await Promise.race([
          execution,
          new Promise<WebContentExecutionTimeoutResult>((resolve) => {
            setTimeout(() => resolve({ __csTimedOut: true }), timeoutMs);
          }),
        ])
      : await execution;
    if (isWebContentExecutionTimeoutResult(result) || result === null) {
      return webContentDocumentSnapshotTimedOut;
    }
    return result as T;
  } catch {
    return webContentDocumentSnapshotTimedOut;
  }
}

async function executeWebContentScript<T>(
  script: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<T | typeof webContentDocumentSnapshotTimedOut> {
  return await executeWebContentScriptForTarget<T>(
    getActiveWebContentTargetId(),
    script,
    options,
  );
}

export async function executeWebContentTargetScript<T>(
  targetId: string | null | undefined,
  script: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<T | null> {
  const result = await executeWebContentScriptForTarget<T>(targetId, script, options);
  return result === webContentDocumentSnapshotTimedOut ? null : result;
}

function describeWebContentError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function ensureWebContentView(window: BrowserWindow) {
  if (webContentWindow && webContentWindow !== window) {
    disposeWebContentView(webContentWindow);
  }

  disposeWebContentWindowListeners?.();
  webContentWindow = window;

  const handleDestroyed = () => {
    disposeWebContentView(window);
  };
  const handleRenderProcessGone = () => {
    applyWebContentLayout();
  };

  window.webContents.on('destroyed', handleDestroyed);
  window.webContents.on('render-process-gone', handleRenderProcessGone);
  disposeWebContentWindowListeners = () => {
    if (!window.isDestroyed()) {
      const currentWebContents = window.webContents;
      if (!currentWebContents.isDestroyed()) {
        currentWebContents.removeListener('destroyed', handleDestroyed);
        currentWebContents.removeListener('render-process-gone', handleRenderProcessGone);
      }
    }
    disposeWebContentWindowListeners = null;
  };

  applyWebContentLayout();
}

export function disposeWebContentView(window?: BrowserWindow | null) {
  if (window && webContentWindow && webContentWindow !== window) return;

  disposeWebContentWindowListeners?.();
  clearRetentionSweepTimer();
  for (const targetId of [...webContentTargets.keys()]) {
    disposeWebContentTargetEntry(targetId);
  }
  retainedWebContentTargets.clear();
  webContentBounds = null;
  webContentVisible = false;
  webContentLayoutPhase = 'hidden';
  activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
  lastReportedWebContentState = createDefaultWebContentState();
  webContentWindow = null;
}

function clearRetentionSweepTimer() {
  if (webContentRetentionSweepTimer === null) {
    return;
  }

  clearTimeout(webContentRetentionSweepTimer);
  webContentRetentionSweepTimer = null;
}

function scheduleRetentionSweep(nextSweepDelayMs: number | null) {
  clearRetentionSweepTimer();
  if (nextSweepDelayMs === null || retainedWebContentTargets.size === 0) {
    return;
  }

  webContentRetentionSweepTimer = setTimeout(() => {
    webContentRetentionSweepTimer = null;
    sweepReleasedWebContentTargets(Date.now());
  }, nextSweepDelayMs);
}

function markWebContentTargetAsRetained(targetId: string, now = Date.now()) {
  if (targetId === DEFAULT_WEB_CONTENT_TARGET_ID || !webContentTargets.has(targetId)) {
    retainedWebContentTargets.delete(targetId);
    return;
  }

  retainedWebContentTargets.set(targetId, { releasedAt: now });
}

function markWebContentTargetAsActive(targetId: string) {
  retainedWebContentTargets.delete(targetId);
}

function sweepReleasedWebContentTargets(now = Date.now()) {
  retainedWebContentTargets.delete(activeWebContentTargetId);

  for (const targetId of [...retainedWebContentTargets.keys()]) {
    if (!webContentTargets.has(targetId)) {
      retainedWebContentTargets.delete(targetId);
    }
  }

  const evictedTargetIds: string[] = [];
  for (const [targetId, retentionEntry] of retainedWebContentTargets) {
    if (now - retentionEntry.releasedAt >= RETAINED_WEB_CONTENT_TARGET_TTL_MS) {
      evictedTargetIds.push(targetId);
    }
  }

  if (retainedWebContentTargets.size - evictedTargetIds.length > browserTabKeepAliveLimit) {
    const overflowCount =
      retainedWebContentTargets.size -
      evictedTargetIds.length -
      browserTabKeepAliveLimit;
    const overflowEvictions = [...retainedWebContentTargets.entries()]
      .filter(([targetId]) => !evictedTargetIds.includes(targetId))
      .sort(([, left], [, right]) => left.releasedAt - right.releasedAt)
      .slice(0, Math.max(0, overflowCount))
      .map(([targetId]) => targetId);
    evictedTargetIds.push(...overflowEvictions);
  }

  for (const targetId of evictedTargetIds) {
    retainedWebContentTargets.delete(targetId);
    disposeWebContentTargetEntry(targetId);
  }

  let nextSweepDelayMs: number | null = null;
  for (const retentionEntry of retainedWebContentTargets.values()) {
    const delayMs = Math.max(
      0,
      retentionEntry.releasedAt + RETAINED_WEB_CONTENT_TARGET_TTL_MS - now,
    );
    nextSweepDelayMs =
      nextSweepDelayMs === null ? delayMs : Math.min(nextSweepDelayMs, delayMs);
  }

  scheduleRetentionSweep(nextSweepDelayMs);
  applyWebContentLayout();
}

function disposeWebContentTargetEntry(targetId: string) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  retainedWebContentTargets.delete(normalizedTargetId);
  const entry = webContentTargets.get(normalizedTargetId);
  if (!entry) {
    return;
  }

  webContentTargets.delete(normalizedTargetId);
	entry.inspector.dispose();
	entry.debuggerTransport.dispose();
	disposeBrowserViewTargetMetadata(normalizedTargetId);
  for (const cleanup of entry.cleanup) {
    cleanup();
  }

  try {
    entry.view.webContents.stop();
  } catch {
    // Ignore stop failures while tearing down a browser view.
  }

  try {
    webContentWindow?.contentView.removeChildView(entry.view);
  } catch {
    // Ignore content-view removal races during window teardown.
  }

  if (!entry.view.webContents.isDestroyed()) {
    entry.view.webContents.close();
  }
}

type WebContentEmitter = {
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  removeListener(event: string, listener: (...args: unknown[]) => void): unknown;
};

function addWebContentTargetListener(
  entry: ManagedWebContentTarget,
  event: string,
  listener: (...args: unknown[]) => void,
) {
  const emitter = entry.view.webContents as unknown as WebContentEmitter;
  emitter.on(event, listener);
  entry.cleanup.push(() => {
    emitter.removeListener(event, listener);
  });
}

function resolveFaviconUrl(favicons: unknown) {
  if (!Array.isArray(favicons)) {
    return '';
  }

  for (const candidate of favicons) {
    const faviconUrl = sanitizeWebContentFaviconUrl(candidate);
    if (faviconUrl) {
      return faviconUrl;
    }
  }

  return '';
}

function emitBrowserViewStateChanges(
  targetId: string,
  previousState: WebContentTargetState,
  nextState: WebContentTargetState,
  navigationCommitted: boolean,
) {
  const metadata = browserViewTargetMetadata.get(targetId);
  const entry = webContentTargets.get(targetId);
  if (!metadata || !entry) {
    return;
  }

  if (navigationCommitted) {
    metadata.events.onDidNavigate.fire({
      url: nextState.url,
      title: nextState.pageTitle ?? '',
      navigationEntryIndex: entry.view.webContents.navigationHistory.getActiveIndex(),
      canGoBack: nextState.canGoBack,
      canGoForward: nextState.canGoForward,
      certificateError: undefined,
    });
  }
  if (previousState.isLoading !== nextState.isLoading) {
    metadata.events.onDidChangeLoadingState.fire({
      loading: nextState.isLoading,
    });
  }
  if (previousState.pageTitle !== nextState.pageTitle) {
    metadata.events.onDidChangeTitle.fire({
      title: nextState.pageTitle ?? '',
    });
  }
  if (previousState.faviconUrl !== nextState.faviconUrl) {
    metadata.events.onDidChangeFavicon.fire({
      favicon: nextState.faviconUrl || undefined,
    });
  }
}

function applyBrowserViewDeviceEmulation(
	targetId: string,
	device: IBrowserDeviceProfile | undefined,
): void {
	const metadata = getBrowserViewTargetMetadata(targetId);
	const webContents = getBrowserViewTargetEntry(targetId).view.webContents;
	metadata.device = device;
	if (!device) {
		webContents.disableDeviceEmulation();
		webContents.setUserAgent(webContents.session.getUserAgent());
		metadata.events.onDidChangeDeviceEmulation.fire(undefined);
		return;
	}

	const width = Math.max(1, Math.round(device.width ?? 1024));
	const height = Math.max(1, Math.round(device.height ?? 768));
	webContents.enableDeviceEmulation({
		screenPosition: device.mobile ? 'mobile' : 'desktop',
		screenSize: { width, height },
		viewPosition: { x: 0, y: 0 },
		deviceScaleFactor: Math.max(0, device.deviceScaleFactor ?? 1),
		viewSize: { width, height },
		scale: 1,
	});
	if (device.userAgent) {
		webContents.setUserAgent(device.userAgent);
	}
	metadata.events.onDidChangeDeviceEmulation.fire(device);
}

function interceptBrowserViewCDPCommand(
	entry: ManagedWebContentTarget,
	method: string,
	params: unknown,
	session: ICDPConnection | undefined,
): Promise<unknown> | undefined {
	if (session && session.targetId !== entry.debuggerTransport.targetId) {
		return undefined;
	}

	const currentDevice = browserViewTargetMetadata.get(entry.targetId)?.device;
	switch (method) {
		case 'Emulation.setDeviceMetricsOverride': {
			const metrics = (params ?? {}) as {
				width?: number;
				height?: number;
				mobile?: boolean;
				deviceScaleFactor?: number;
			};
			applyBrowserViewDeviceEmulation(entry.targetId, {
				...currentDevice,
				width: metrics.width || undefined,
				height: metrics.height || undefined,
				mobile: metrics.mobile ?? currentDevice?.mobile,
				deviceScaleFactor: metrics.deviceScaleFactor ?? currentDevice?.deviceScaleFactor,
			});
			return Promise.resolve({});
		}
		case 'Emulation.clearDeviceMetricsOverride': {
			if (!currentDevice) {
				return Promise.resolve({});
			}
			applyBrowserViewDeviceEmulation(
				entry.targetId,
				currentDevice.userAgent !== undefined ? { userAgent: currentDevice.userAgent } : undefined,
			);
			return Promise.resolve({});
		}
		default:
			return undefined;
	}
}

function createWebContentTarget(
  targetId: string,
  context: BrowserViewMainContext = createBrowserViewContext(
    targetId,
    BrowserViewStorageScope.Global,
  ),
) {
  const window = getWebContentOwnerWindow();
  const view = new WebContentsView({
    webPreferences: {
      session: context.session,
      contextIsolation: true,
      nodeIntegration: false,
      nodeIntegrationInSubFrames: true,
      preload: resolveBrowserViewPreloadScriptPath(),
      sandbox: true,
      webviewTag: false,
      plugins: true,
      backgroundThrottling: false,
    },
  });
  view.setBackgroundColor('#ffffff');
  view.setBounds(DEFAULT_WEB_CONTENT_BOUNDS);
  view.setVisible(false);
  window.contentView.addChildView(view);

  const metadata = browserViewTargetMetadata.get(targetId);

	const debuggerTransport = new BrowserViewDebugger(view.webContents);
	const inspector = new BrowserViewInspector(view.webContents, debuggerTransport);
	const screenshot = new BrowserViewScreenshot(view, debuggerTransport, inspector);
  const entry: ManagedWebContentTarget = {
    cleanup: [],
    context,
    debuggerTransport,
		inspector,
    metadataMachine: createDefaultTargetMetadataMachine(),
    onDidClose: metadata?.events.onDidClose.event,
    owner: metadata?.owner,
    state: createDefaultWebContentTargetState(),
    statusCode: null,
		screenshot,
    targetId,
    view,
  };
	const selectElementSubscription = inspector.onDidSelectElement(data => {
		browserViewTargetMetadata.get(targetId)?.events.onDidSelectElement.fire(data);
	});
	const elementSelectionActiveSubscription = inspector.onDidChangeElementSelectionActive(active => {
		browserViewTargetMetadata.get(targetId)?.events.onDidChangeElementSelectionActive.fire(active);
	});
	const pickAreaSubscription = inspector.onDidPickArea(rect => {
		browserViewTargetMetadata.get(targetId)?.events.onDidPickArea.fire(rect);
	});
	const areaSelectionActiveSubscription = inspector.onDidChangeAreaSelectionActive(active => {
		browserViewTargetMetadata.get(targetId)?.events.onDidChangeAreaSelectionActive.fire(active);
	});
	entry.cleanup.push(
		() => selectElementSubscription.dispose(),
		() => elementSelectionActiveSubscription.dispose(),
		() => pickAreaSubscription.dispose(),
		() => areaSelectionActiveSubscription.dispose(),
	);
	if (metadata) {
		const windowConfiguration = browserViewWindowConfigurations.get(metadata.owner.mainWindowId);
		if (windowConfiguration) {
			inspector.setTheme(windowConfiguration.theme);
		}
	}
	const cdpCommandInterceptor = entry.debuggerTransport.registerCommandInterceptor((method, params, session) =>
		interceptBrowserViewCDPCommand(entry, method, params, session)
	);
	entry.cleanup.push(() => cdpCommandInterceptor.dispose());

  const syncState = () => {
    syncWebContentTargetState(targetId);
  };
  const syncNavigationState = () => {
    syncWebContentTargetState(targetId, true);
  };

  for (const event of [
    'did-start-loading',
    'did-stop-loading',
    'did-finish-load',
    'did-fail-load',
  ]) {
    addWebContentTargetListener(entry, event, syncState);
  }
  for (const event of ['did-navigate', 'did-navigate-in-page']) {
    addWebContentTargetListener(entry, event, syncNavigationState);
  }

  addWebContentTargetListener(entry, 'did-start-navigation', (
    _event,
    _url,
	isInPlace,
    isMainFrame,
  ) => {
    if (isMainFrame === true) {
      entry.statusCode = null;
      const metadata = browserViewTargetMetadata.get(targetId);
      if (metadata) {
		metadata.navigationGeneration += 1;
		metadata.viewState = undefined;
		if (isInPlace !== true) {
			metadata.viewStateDocumentId = undefined;
		}
      }
    }
  });
  addWebContentTargetListener(entry, 'did-navigate', (
    _event,
    _url,
    httpResponseCode,
  ) => {
    const responseCode = Number(httpResponseCode);
    entry.statusCode = Number.isFinite(responseCode) && responseCode > 0
      ? responseCode
      : null;
  });

  addWebContentTargetListener(entry, 'focus', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeFocus.fire({ focused: true });
  });
  addWebContentTargetListener(entry, 'blur', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeFocus.fire({ focused: false });
  });
  addWebContentTargetListener(entry, 'devtools-opened', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeDevToolsState.fire({
      isDevToolsOpen: true,
    });
  });
  addWebContentTargetListener(entry, 'devtools-closed', () => {
    browserViewTargetMetadata.get(targetId)?.events.onDidChangeDevToolsState.fire({
      isDevToolsOpen: false,
    });
  });
  addWebContentTargetListener(entry, 'found-in-page', (_event, result) => {
    if (!isRecord(result)) {
      return;
    }
    const selectionArea = isRecord(result.selectionArea)
      ? {
          x: Number(result.selectionArea.x) || 0,
          y: Number(result.selectionArea.y) || 0,
          width: Number(result.selectionArea.width) || 0,
          height: Number(result.selectionArea.height) || 0,
        }
      : undefined;
    browserViewTargetMetadata.get(targetId)?.events.onDidFindInPage.fire({
      activeMatchOrdinal: Number(result.activeMatchOrdinal) || 0,
      matches: Number(result.matches) || 0,
      selectionArea,
      finalUpdate: result.finalUpdate === true,
    });
  });
  const handleCommandKeydown = (
    _event: unknown,
    keyEvent: IBrowserViewKeyDownEvent,
  ) => {
    browserViewTargetMetadata.get(targetId)?.events.onDidKeyCommand.fire(keyEvent);
  };
  entry.view.webContents.ipc.on('vscode:browserView:keydown', handleCommandKeydown);
  entry.cleanup.push(() => {
    entry.view.webContents.ipc.removeListener(
      'vscode:browserView:keydown',
      handleCommandKeydown,
    );
  });
	const handleViewStateDocument = (
		event: { readonly senderFrame?: unknown },
		value: unknown,
	) => {
		const document = resolveBrowserViewDocumentIpcEvent(
			event.senderFrame,
			entry.view.webContents.mainFrame,
			entry.view.webContents.getURL(),
			value,
		);
		if (!document) {
			return;
		}
		const metadata = browserViewTargetMetadata.get(targetId);
		if (metadata) {
			metadata.viewStateDocumentId = document.documentId;
		}
	};
	entry.view.webContents.ipc.on('vscode:browserView:viewStateDocument', handleViewStateDocument);
	entry.cleanup.push(() => {
		entry.view.webContents.ipc.removeListener(
			'vscode:browserView:viewStateDocument',
			handleViewStateDocument,
		);
	});
	const handleViewStateChange = (
    event: { readonly senderFrame?: unknown },
    value: unknown,
  ) => {
		const metadata = browserViewTargetMetadata.get(targetId);
		const viewState = resolveBrowserViewStateIpcEvent(
			event.senderFrame,
			entry.view.webContents.mainFrame,
			metadata?.viewStateDocumentId,
      entry.view.webContents.getURL(),
      value,
    );
    if (!viewState) {
      return;
    }
    publishBrowserViewViewState(targetId, viewState);
  };
  entry.view.webContents.ipc.on('vscode:browserView:viewStateChanged', handleViewStateChange);
  entry.cleanup.push(() => {
    entry.view.webContents.ipc.removeListener(
      'vscode:browserView:viewStateChanged',
      handleViewStateChange,
    );
  });
  addWebContentTargetListener(entry, 'console-message', (...args) => {
    const metadata = browserViewTargetMetadata.get(targetId);
    if (!metadata) {
      return;
    }
    const message = args
      .map(value => String(value ?? '').trim())
      .filter(Boolean)
      .join(' ');
    if (!message) {
      return;
    }
    metadata.consoleLogs.push(message);
    if (metadata.consoleLogs.length > 200) {
      metadata.consoleLogs.splice(0, metadata.consoleLogs.length - 200);
    }
  });

  addWebContentTargetListener(entry, 'page-title-updated', (_event, title) => {
    const pageTitle = String(title ?? '').trim();
    if (!pageTitle) {
      return;
    }

    if (
      entry.metadataMachine.pendingPageTitle === pageTitle &&
      String(entry.state.pageTitle ?? '').trim() === pageTitle
    ) {
      return;
    }

    entry.metadataMachine = {
      ...entry.metadataMachine,
      pendingPageTitle: pageTitle,
    };
    syncWebContentTargetState(targetId);
  });

  addWebContentTargetListener(entry, 'page-favicon-updated', (_event, favicons) => {
    const faviconUrl = resolveFaviconUrl(favicons);
    if (!faviconUrl) {
      return;
    }

    if (
      entry.metadataMachine.pendingFaviconUrl === faviconUrl &&
      sanitizeWebContentFaviconUrl(entry.state.faviconUrl) === faviconUrl
    ) {
      return;
    }

    entry.metadataMachine = {
      ...entry.metadataMachine,
      pendingFaviconUrl: faviconUrl,
    };
    syncWebContentTargetState(targetId);
  });

	addWebContentTargetListener(entry, 'destroyed', () => {
		entry.inspector.dispose();
    entry.debuggerTransport.dispose();
    for (const cleanup of entry.cleanup) {
      cleanup();
    }
    entry.cleanup.length = 0;
    webContentTargets.delete(targetId);
    retainedWebContentTargets.delete(targetId);
    disposeBrowserViewTargetMetadata(targetId);
    if (activeWebContentTargetId === targetId) {
      activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
      webContentBounds = null;
      webContentVisible = false;
      webContentLayoutPhase = 'hidden';
      applyWebContentLayout();
      return;
    }
    reportActiveWebContentState();
  });

  view.webContents.setWindowOpenHandler((details) => {
    const url = coerceWebContentNavigationUrl(details.url);
    if (url) {
      void navigateWebContentTarget(url, targetId, 'browser').catch((error) => {
        console.warn('[web-content-view] failed to navigate popup url', describeWebContentError(error));
      });
    }
    return { action: 'deny' };
  });

  webContentTargets.set(targetId, entry);
  syncWebContentTargetState(targetId);
  applyWebContentLayout();
  return entry;
}

function ensureWebContentTarget(
  targetId?: string | null,
  context?: BrowserViewMainContext,
) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const existingEntry = webContentTargets.get(normalizedTargetId);
  if (existingEntry && !existingEntry.view.webContents.isDestroyed()) {
    return existingEntry;
  }

  if (existingEntry) {
    webContentTargets.delete(normalizedTargetId);
  }

  return createWebContentTarget(normalizedTargetId, context);
}

function readWebContentTargetState(entry: ManagedWebContentTarget): WebContentTargetState {
  try {
    const previousState = entry.state;
    const previousMetadataMachine = entry.metadataMachine;
    const webContents = entry.view.webContents;
    const nextUrl = String(webContents.getURL() ?? '').trim();
    const nextComparableUrl = normalizeComparableWebContentUrl(nextUrl);
    const nextIsLoading = webContents.isLoading();
    const isNavigationTargetChanged =
      nextComparableUrl !== previousMetadataMachine.comparableUrl;
    const pendingPageTitle = isNavigationTargetChanged
      ? ''
      : sanitizeWebContentPageTitle(
          previousMetadataMachine.pendingPageTitle,
          nextUrl,
        );
    const pendingFaviconUrl = isNavigationTargetChanged
      ? ''
      : sanitizeWebContentFaviconUrl(previousMetadataMachine.pendingFaviconUrl);
    const sampledPageTitle = sanitizeWebContentPageTitle(
      String(webContents.getTitle() ?? '').trim(),
      nextUrl,
    );
    const previousPageTitle = isNavigationTargetChanged
      ? ''
      : String(previousState.pageTitle ?? '').trim();
    const previousFaviconUrl = isNavigationTargetChanged
      ? ''
      : sanitizeWebContentFaviconUrl(previousState.faviconUrl);
    const canApplyPendingPageTitle =
      Boolean(pendingPageTitle) &&
      !nextIsLoading &&
      (!sampledPageTitle || sampledPageTitle === pendingPageTitle);
    const canApplyPendingFaviconUrl =
      Boolean(pendingFaviconUrl) &&
      !nextIsLoading;
    const resolvedPageTitle = canApplyPendingPageTitle
      ? pendingPageTitle
      : !nextIsLoading && sampledPageTitle
        ? sampledPageTitle
        : previousPageTitle;
    const resolvedFaviconUrl = canApplyPendingFaviconUrl
      ? pendingFaviconUrl
      : previousFaviconUrl;

    entry.metadataMachine = {
      comparableUrl: nextComparableUrl,
      pendingPageTitle: canApplyPendingPageTitle ? '' : pendingPageTitle,
      pendingFaviconUrl: canApplyPendingFaviconUrl ? '' : pendingFaviconUrl,
    };

    return {
      url: nextUrl,
      pageTitle: resolvedPageTitle,
      faviconUrl: resolvedFaviconUrl,
      canGoBack: webContents.navigationHistory.canGoBack(),
      canGoForward: webContents.navigationHistory.canGoForward(),
      isLoading: nextIsLoading,
    };
  } catch {
    entry.metadataMachine = createDefaultTargetMetadataMachine();
    return createDefaultWebContentTargetState();
  }
}

function syncWebContentTargetState(targetId?: string | null, navigationCommitted = false) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const entry = webContentTargets.get(normalizedTargetId);
  if (!entry) {
    return createDefaultWebContentTargetState();
  }

  const previousState = entry.state;
  const nextState = readWebContentTargetState(entry);
  entry.state = nextState;
  emitBrowserViewStateChanges(normalizedTargetId, previousState, nextState, navigationCommitted);
  if (normalizedTargetId === activeWebContentTargetId) {
    reportActiveWebContentState();
  }
  return entry.state;
}

function reportActiveWebContentState() {
  const nextState = buildWebContentState(activeWebContentTargetId);
  if (areWebContentStatesEqual(lastReportedWebContentState, nextState)) {
    return;
  }

  rememberReportedWebContentState(nextState);
  const window = webContentWindow;
  if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
    return;
  }

  window.webContents.send('app:web-content-state', nextState);
}

function applyWebContentLayout() {
  const activeTargetId = getActiveWebContentTargetId();
  const shouldShow = shouldShowActiveWebContentTarget();
  const visibleBounds = isValidWebContentBounds(webContentBounds)
    ? {
        x: Math.round(webContentBounds.x),
        y: Math.round(webContentBounds.y),
        width: Math.round(webContentBounds.width),
        height: Math.round(webContentBounds.height),
      }
    : HIDDEN_WEB_CONTENT_BOUNDS;

  for (const [targetId, entry] of webContentTargets) {
    const shouldShowTarget = shouldShow && targetId === activeTargetId;
    const metadata = browserViewTargetMetadata.get(targetId);
    if (metadata && metadata.visible !== shouldShowTarget) {
      metadata.visible = shouldShowTarget;
      metadata.events.onDidChangeVisibility.fire({ visible: shouldShowTarget });
    }
    if (shouldShowTarget) {
      entry.view.setBounds(visibleBounds);
      entry.view.setVisible(true);
      continue;
    }

    if (entry.view.webContents.isFocused()) {
      webContentWindow?.webContents.focus();
    }
    entry.view.setVisible(false);
    entry.view.setBounds(
      metadata?.presentation === 'background'
        ? BACKGROUND_WEB_CONTENT_BOUNDS
        : HIDDEN_WEB_CONTENT_BOUNDS,
    );
  }

  reportActiveWebContentState();
}

export function setWebContentBounds(bounds: WebContentBounds | null) {
  webContentBounds = isValidWebContentBounds(bounds)
    ? {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      }
    : null;
  applyWebContentLayout();
}

export function setWebContentVisible(visible: boolean) {
  webContentVisible = Boolean(visible);
  applyWebContentLayout();
}

export function setWebContentLayoutPhaseState(phase: WebContentLayoutPhase) {
  if (!isWebContentLayoutPhase(phase)) {
    return;
  }

  webContentLayoutPhase = phase;
  applyWebContentLayout();
}

export function setWebContentRetentionLimit(limit: unknown) {
  browserTabKeepAliveLimit = normalizeBrowserTabKeepAliveLimit(limit, browserTabKeepAliveLimit);
  sweepReleasedWebContentTargets(Date.now());
}

export function activateWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  activeWebContentTargetId = normalizedTargetId;
  syncWebContentTargetState(normalizedTargetId);
  applyWebContentLayout();
}

export function releaseWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
    return;
  }

  if (activeWebContentTargetId === normalizedTargetId) {
    activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
    webContentBounds = null;
    webContentVisible = false;
    webContentLayoutPhase = 'hidden';
  }
  const metadata = browserViewTargetMetadata.get(normalizedTargetId);
  if (metadata) {
    metadata.bounds = undefined;
  }
  markWebContentTargetAsRetained(normalizedTargetId);
  sweepReleasedWebContentTargets(Date.now());
  applyWebContentLayout();
}

export function disposeWebContentTarget(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
    return;
  }

  disposeWebContentTargetEntry(normalizedTargetId);
  if (activeWebContentTargetId === normalizedTargetId) {
    activeWebContentTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
    webContentBounds = null;
    webContentVisible = false;
    webContentLayoutPhase = 'hidden';
  }
  applyWebContentLayout();
}

export function getWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (webContentTargets.has(normalizedTargetId)) {
    syncWebContentTargetState(normalizedTargetId);
  }

  return buildWebContentState(normalizedTargetId);
}

export async function captureWebContentScreenshot(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const entry = webContentTargets.get(normalizedTargetId);
  if (!entry || entry.view.webContents.isDestroyed()) {
    return null;
  }

  const image = await entry.view.webContents.capturePage();
  if (image.isEmpty()) {
    return null;
  }

  return `data:image/jpeg;base64,${image.toJPEG(80).toString('base64')}`;
}

export async function getWebContentDocumentSnapshot(
	targetId: string,
  options: WebContentDocumentSnapshotOptions = {},
): Promise<WebContentDocumentSnapshot | null> {
  const startedAt = Date.now();

  try {
    const snapshot = await executeWebContentScriptForTarget<{
		url?: unknown;
		html?: unknown;
		documentReadyState?: unknown;
	}>(
		targetId,
      `(() => {
        try {
          return {
			url: location.href,
			html: document.documentElement ? document.documentElement.outerHTML : '',
			documentReadyState: document.readyState,
		  };
        } catch {
		  return null;
        }
      })()`,
      options,
    );

    if (snapshot === webContentDocumentSnapshotTimedOut || !isRecord(snapshot)) {
      return null;
    }

	const url = typeof snapshot.url === 'string' ? snapshot.url.trim() : '';
	const html = typeof snapshot.html === 'string' ? snapshot.html : '';
	const documentReadyState = typeof snapshot.documentReadyState === 'string'
		? snapshot.documentReadyState
		: '';
    if (typeof html !== 'string' || !html.trim()) {
      return null;
    }

    return {
		  url,
	      html,
	      statusCode: webContentTargets.get(normalizeWebContentTargetId(targetId))?.statusCode ?? null,
      captureMs: Date.now() - startedAt,
	  isLoading: documentReadyState !== 'complete',
	  documentReadyState,
    };
  } catch {
    return null;
  }
}

export async function getWebContentSelection(
  targetId?: string | null,
): Promise<WebContentSelectionSnapshot | null> {
  const selection = await executeWebContentScriptForTarget<{
    text?: unknown;
    rects?: unknown;
  }>(
    targetId,
    `(() => {
      try {
        const toRect = (rect) => ({
          x: Number(rect.left) || 0,
          y: Number(rect.top) || 0,
          width: Number(rect.width) || 0,
          height: Number(rect.height) || 0,
        });

        const readSelection = (doc) => {
          try {
            const selection = doc.getSelection?.();
            if (!selection || selection.rangeCount === 0) {
              return null;
            }

            const text = String(selection.toString() || '').trim();
            if (!text) {
              return null;
            }

            const range = selection.getRangeAt(0);
            const rects = Array.from(range.getClientRects?.() || []).map(toRect);
            return { text, rects };
          } catch {
            return null;
          }
        };

        const direct = readSelection(document);
        if (direct) {
          return direct;
        }

        const frames = Array.from(document.querySelectorAll('iframe'));
        for (const frame of frames) {
          try {
            const frameDocument = frame.contentDocument;
            if (!frameDocument) {
              continue;
            }
            const nested = readSelection(frameDocument);
            if (nested) {
              return nested;
            }
          } catch {
            // Ignore cross-origin or inaccessible frames.
          }
        }

        return null;
      } catch {
        return null;
      }
    })()`,
    { timeoutMs: 3000 },
  );

  if (
    selection === webContentDocumentSnapshotTimedOut ||
    !selection ||
    !isRecord(selection) ||
    typeof selection.text !== 'string' ||
    !Array.isArray(selection.rects)
  ) {
    return null;
  }

  const rects = selection.rects
    .filter((rect) => isRecord(rect))
    .map((rect) => ({
      x: typeof rect.x === 'number' ? rect.x : 0,
      y: typeof rect.y === 'number' ? rect.y : 0,
      width: typeof rect.width === 'number' ? rect.width : 0,
      height: typeof rect.height === 'number' ? rect.height : 0,
    }));

  return {
    text: selection.text,
    rects,
  };
}

export async function getWebContentDocumentHtml(targetId: string) {
  const snapshot = await getWebContentDocumentSnapshot(targetId);
  return snapshot?.html ?? null;
}

export async function navigateWebContent(
  url: string,
  mode: WebContentNavigationMode = 'browser',
) {
  await navigateWebContentTarget(url, getActiveWebContentTargetId(), mode);
}

export async function navigateWebContentTarget(
  url: string,
  targetId?: string | null,
  mode: WebContentNavigationMode = 'browser',
) {
  const resolvedUrl = coerceWebContentNavigationUrl(url);
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  const entry = ensureWebContentTarget(normalizedTargetId);
  syncWebContentTargetState(normalizedTargetId);

  try {
    if (!resolvedUrl) {
      return getWebContentState(normalizedTargetId);
    }

    const initialUrl = normalizeComparableWebContentUrl(getWebContentState(normalizedTargetId).url);
    const normalizedTargetUrl = normalizeComparableWebContentUrl(resolvedUrl);
    if (normalizedTargetUrl === 'about:blank') {
      if (normalizeComparableWebContentUrl(entry.view.webContents.getURL()) !== 'about:blank') {
        try {
          await entry.view.webContents.loadURL('about:blank');
        } catch (error) {
          if (!isAbortLikeWebContentNavigationError(error)) {
            throw error;
          }
        }
      }
      entry.state = {
        ...createDefaultWebContentTargetState(),
        url: 'about:blank',
      };
      entry.metadataMachine = createDefaultTargetMetadataMachine();
      reportActiveWebContentState();
      return getWebContentState(normalizedTargetId);
    }

    let navigationFailure: unknown = null;
    void entry.view.webContents.loadURL(resolvedUrl).catch((error) => {
      if (isAbortLikeWebContentNavigationError(error)) {
        return;
      }
      navigationFailure = error;
    });

    const startedAt = Date.now();
    const timeoutMs = 12000;
    while (Date.now() - startedAt < timeoutMs) {
      if (navigationFailure) {
        throw navigationFailure;
      }

      const currentState = getWebContentState(normalizedTargetId);
      const currentUrl = normalizeComparableWebContentUrl(currentState.url);
      if (
        hasWebContentReachedTarget(
          mode,
          currentUrl,
          normalizedTargetUrl,
          initialUrl,
          currentState.isLoading,
        )
      ) {
        return currentState;
      }

      await delay(120);
    }

    throw new Error(
      mode === 'strict'
        ? 'Timed out while waiting for the web content URL to match the target exactly.'
        : 'Timed out while waiting for web content navigation to settle on a destination.',
    );
  } catch (error) {
    throw appError(BrowserViewErrorCode.PreviewNotReady, {
      message: describeWebContentError(error),
      targetUrl: url,
      currentUrl: getWebContentState(normalizedTargetId).url,
      navigationMode: mode,
    });
  }
}

export async function navigateWebContentForPrint(url: string, timeoutMs = 12000) {
  await navigateWebContentTarget(url, getActiveWebContentTargetId(), 'strict');

  const startedAt = Date.now();
  while (Date.now() - startedAt < Math.max(1000, timeoutMs)) {
    const mainReady = await executeWebContentScript<boolean>(
      `(() => {
        const main = document.querySelector('main#content');
        if (!main) return false;
        const title = (main.querySelector('h1')?.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const text = (main.textContent ?? '').replace(/\\s+/g, ' ').trim();
        const rect = main.getBoundingClientRect();
        return Boolean(title) && text.length >= 120 && rect.height > 120;
      })()`,
      { timeoutMs: 800 },
    );
    if (mainReady === true) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  throw appError(BrowserViewErrorCode.PreviewNotReady, {
    message: 'Timed out while waiting for web content main content to become printable.',
    targetUrl: url,
    currentUrl: getWebContentState().url,
  });
}

export async function waitForWebContentPrintLayout(stabilizeMs = 1200) {
  const result = await executeWebContentScript<void>(
    `(() => {
      const maxWaitMs = Math.max(1800, ${Math.max(0, Math.trunc(stabilizeMs))} + 1800);
      const settleMs = Math.max(250, Math.min(600, ${Math.max(0, Math.trunc(stabilizeMs))}));
      const startedAt = Date.now();

      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const normalizeText = (value) => String(value ?? '').replace(/\\s+/g, ' ').trim();
      const readMainSignature = () => {
        const main = document.querySelector('main#content');
        if (!main) {
          return { ready: false, signature: 'missing-main' };
        }

        const titleNode = main.querySelector('h1');
        const titleText = normalizeText(titleNode?.textContent ?? '');
        const textSample = normalizeText(main.textContent ?? '').slice(0, 1500);
        const mainRect = main.getBoundingClientRect();
        const images = Array.from(main.querySelectorAll('img')).filter((image) => {
          const rect = image.getBoundingClientRect();
          if (rect.width <= 0 || rect.height <= 0) return false;
          return rect.top < Math.max(window.innerHeight * 1.5, 1400);
        });
        const imageCount = images.length;
        const loadedImageCount = images.filter((image) => image.complete && image.naturalWidth > 0).length;
        const hasMeaningfulLayout = mainRect.height > 240 || textSample.length > 400;
        const ready = Boolean(titleText) && Boolean(textSample) && hasMeaningfulLayout;
        const imagesReady = imageCount === 0 || imageCount === loadedImageCount;

        return {
          ready: ready && imagesReady,
          signature: JSON.stringify({
            titleText,
            textSample,
            imageCount,
            loadedImageCount,
          }),
        };
      };

      return new Promise((resolve) => {
        let lastStableSignature = '';
        let stableSince = 0;

        const tick = async () => {
          const snapshot = readMainSignature();
          const now = Date.now();

          if (snapshot.ready) {
            if (snapshot.signature === lastStableSignature) {
              if (!stableSince) {
                stableSince = now;
              }
              if (now - stableSince >= settleMs) {
                resolve(undefined);
                return;
              }
            } else {
              lastStableSignature = snapshot.signature;
              stableSince = now;
            }
          }

          if (now - startedAt >= maxWaitMs) {
            resolve(undefined);
            return;
          }

          await sleep(150);
          tick();
        };

        void tick();
      });
    })()`,
    { timeoutMs: Math.max(1800, Math.max(0, Math.trunc(stabilizeMs)) + 2400) },
  );

  if (result === webContentDocumentSnapshotTimedOut) {
    await new Promise((resolve) => setTimeout(resolve, Math.max(0, Math.trunc(stabilizeMs))));
  }
}

export async function printCurrentWebContentToPdf() {
  try {
    const entry = webContentTargets.get(getActiveWebContentTargetId());
    if (!entry || entry.view.webContents.isDestroyed()) {
      throw new Error('Browser view is unavailable.');
    }

    return await entry.view.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      displayHeaderFooter: false,
      margins: {
        top: 0.4,
        bottom: 0.4,
        left: 0.4,
        right: 0.4,
      },
    });
  } catch (error) {
    throw appError(BrowserViewErrorCode.PreviewNotReady, {
      message: describeWebContentError(error),
      currentUrl: getWebContentState().url,
    });
  }
}

export function reloadWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  entry.view.webContents.reload();
  syncWebContentTargetState(normalizedTargetId);
}

export function hardReloadWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  entry.view.webContents.reloadIgnoringCache();
  syncWebContentTargetState(normalizedTargetId);
}

export function clearWebContentHistory(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  entry.view.webContents.navigationHistory.clear();
  syncWebContentTargetState(normalizedTargetId);
  applyWebContentLayout();
}

export function goBackWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  if (entry.view.webContents.navigationHistory.canGoBack()) {
    entry.view.webContents.navigationHistory.goBack();
  }
  syncWebContentTargetState(normalizedTargetId);
}

export function goForwardWebContent(targetId?: string | null) {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  if (targetId !== undefined) {
    activeWebContentTargetId = normalizedTargetId;
  }

  const entry = ensureWebContentTarget(normalizedTargetId);
  markWebContentTargetAsActive(normalizedTargetId);
  applyWebContentLayout();
  if (entry.view.webContents.navigationHistory.canGoForward()) {
    entry.view.webContents.navigationHistory.goForward();
  }
  syncWebContentTargetState(normalizedTargetId);
}

function getBrowserViewTargetEntry(targetId: string) {
  getBrowserViewTargetMetadata(targetId);
  const entry = webContentTargets.get(targetId);
  if (!entry || entry.view.webContents.isDestroyed()) {
    throw new Error(`Browser view '${targetId}' is unavailable.`);
  }
  return entry;
}

function isBrowserViewMainTarget(
  entry: ManagedWebContentTarget,
): entry is ManagedWebContentTarget & BrowserViewMainTarget {
  return entry.owner !== undefined && entry.onDidClose !== undefined;
}

function toBrowserViewState(targetId: string): IBrowserViewState {
  const metadata = getBrowserViewTargetMetadata(targetId);
  const entry = getBrowserViewTargetEntry(targetId);
  syncWebContentTargetState(targetId);
  return {
    url: entry.state.url,
    title: entry.state.pageTitle ?? '',
    canGoBack: entry.state.canGoBack,
    canGoForward: entry.state.canGoForward,
    loading: entry.state.isLoading,
    focused: entry.view.webContents.isFocused(),
    visible: metadata.visible,
    isDevToolsOpen: entry.view.webContents.isDevToolsOpened(),
    lastScreenshot: metadata.lastScreenshot,
    lastFavicon: entry.state.faviconUrl || undefined,
    lastError: undefined,
    certificateError: undefined,
    storageScope: metadata.storageScope,
    permissions: metadata.permissions,
    browserZoomIndex: metadata.browserZoomIndex,
    isElementSelectionActive: entry.inspector.isElementSelectionActive,
    isRemoteSession: false,
    isAreaSelectionActive: entry.inspector.isAreaSelectionActive,
    device: metadata.device,
  };
}

function normalizeBrowserZoomIndex(value: number | undefined) {
  if (!Number.isFinite(value)) {
    return browserZoomDefaultIndex;
  }
  return Math.max(0, Math.min(Math.trunc(value ?? browserZoomDefaultIndex), browserZoomFactors.length - 1));
}

export class BrowserViewMainService implements IBrowserViewService {
  readonly onDidCreateBrowserView = browserViewCreatedEmitter.event;

  onDynamicDidNavigate(id: string): Event<IBrowserViewNavigationEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidNavigate.event;
  }

  onDynamicDidChangeViewState(id: string): Event<IBrowserViewViewStateEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeViewState.event;
  }

  onDynamicDidChangeLoadingState(id: string): Event<IBrowserViewLoadingEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeLoadingState.event;
  }

  onDynamicDidChangeFocus(id: string): Event<IBrowserViewFocusEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeFocus.event;
  }

  onDynamicDidChangeVisibility(id: string): Event<IBrowserViewVisibilityEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeVisibility.event;
  }

  onDynamicDidChangeDevToolsState(id: string): Event<IBrowserViewDevToolsStateEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeDevToolsState.event;
  }

  onDynamicDidKeyCommand(id: string): Event<IBrowserViewKeyDownEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidKeyCommand.event;
  }

  onDynamicDidChangeTitle(id: string): Event<IBrowserViewTitleChangeEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeTitle.event;
  }

  onDynamicDidChangeFavicon(id: string): Event<IBrowserViewFaviconChangeEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeFavicon.event;
  }

  onDynamicDidFindInPage(id: string): Event<IBrowserViewFindInPageResult> {
    return getBrowserViewTargetMetadata(id).events.onDidFindInPage.event;
  }

  onDynamicDidClose(id: string): Event<void> {
    return getBrowserViewTargetMetadata(id).events.onDidClose.event;
  }

  onDynamicDidSelectElement(id: string): Event<IElementData> {
    return getBrowserViewTargetMetadata(id).events.onDidSelectElement.event;
  }

  onDynamicDidChangeElementSelectionActive(id: string): Event<boolean> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeElementSelectionActive.event;
  }

  onDynamicDidPickArea(id: string): Event<IBrowserViewRect | undefined> {
    return getBrowserViewTargetMetadata(id).events.onDidPickArea.event;
  }

  onDynamicDidChangeAreaSelectionActive(id: string): Event<boolean> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeAreaSelectionActive.event;
  }

  onDynamicDidChangeDeviceEmulation(id: string): Event<IBrowserDeviceProfile | undefined> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeDeviceEmulation.event;
  }

  onDynamicDidChangeRemoteStatus(id: string): Event<boolean> {
    return getBrowserViewTargetMetadata(id).events.onDidChangeRemoteStatus.event;
  }

  onDynamicDidRequestPermission(id: string): Event<IBrowserViewPermissionRequestEvent> {
    return getBrowserViewTargetMetadata(id).events.onDidRequestPermission.event;
  }

  onDynamicDidChangePermissions(id: string): Event<ISerializedBrowserPermissionsSnapshot> {
    return getBrowserViewTargetMetadata(id).events.onDidChangePermissions.event;
  }

  async getBrowserViews(windowId?: number): Promise<IBrowserViewInfo[]> {
    const result: IBrowserViewInfo[] = [];
    for (const [id, metadata] of browserViewTargetMetadata) {
      if (metadata.presentation !== 'editor') {
        continue;
      }
      if (windowId !== undefined && metadata.owner.mainWindowId !== windowId) {
        continue;
      }
      result.push({ id, owner: metadata.owner, state: toBrowserViewState(id) });
    }
    return result;
  }

  async getOrCreateBrowserView(
    id: string,
    options: IBrowserViewCreateOptions,
  ): Promise<IBrowserViewState> {
    const existingMetadata = browserViewTargetMetadata.get(id);
    if (existingMetadata) {
      if (
        options.presentation === 'editor' &&
        existingMetadata.presentation !== 'editor'
      ) {
        existingMetadata.presentation = 'editor';
        applyWebContentLayout();
      }
      return toBrowserViewState(id);
    }

    const initialState = options.initialState;
    const metadata = createBrowserViewTargetMetadata(options);
    browserViewTargetMetadata.set(id, metadata);

    try {
      const entry = ensureWebContentTarget(
        id,
        createBrowserViewContext(id, options.sessionOptions.scope),
      );
      if (initialState?.title) {
        entry.state.pageTitle = initialState.title;
      }
      if (initialState?.lastFavicon) {
        entry.state.faviconUrl = initialState.lastFavicon;
      }
      entry.view.webContents.setZoomFactor(browserZoomFactors[metadata.browserZoomIndex]);
      if (metadata.device) {
        await this.setDeviceEmulation(id, metadata.device);
      }
			if (initialState?.url) {
				await navigateWebContentTarget(initialState.url, id, 'browser');
			}
			return {
				...toBrowserViewState(id),
				isElementSelectionActive: entry.inspector.isElementSelectionActive,
				isAreaSelectionActive: entry.inspector.isAreaSelectionActive,
			};
    } catch (error) {
      disposeWebContentTargetEntry(id);
      throw error;
    }
  }

  tryGetTarget(id: string): BrowserViewMainTarget | undefined {
    const entry = webContentTargets.get(id);
    if (
      !entry ||
      entry.view.webContents.isDestroyed() ||
      !browserViewTargetMetadata.has(id) ||
      !isBrowserViewMainTarget(entry)
    ) {
      return undefined;
    }
    return entry;
  }

  getTargetPresentation(id: string): BrowserViewTargetPresentation | undefined {
    return browserViewTargetMetadata.get(id)?.presentation;
  }

  async createTarget(
    url: string,
    owner: IBrowserViewOwner,
    context: BrowserViewMainContext,
  ): Promise<BrowserViewMainTarget> {
    const id = generateUuid();
    const options: IBrowserViewCreateOptions = {
      owner,
      sessionOptions: { scope: context.storageScope },
      presentation: 'editor',
      initialState: { url },
    };
    const metadata = createBrowserViewTargetMetadata(options);
    browserViewTargetMetadata.set(id, metadata);

    try {
      const entry = createWebContentTarget(id, context);
      if (!isBrowserViewMainTarget(entry)) {
        throw new Error(`Browser view '${id}' has no CDP target metadata.`);
      }
			if (url) {
				await navigateWebContentTarget(url, id, 'browser');
			}

			const state = toBrowserViewState(id);
			browserViewCreatedEmitter.fire({
        info: {
          id,
          owner,
					state,
        },
				openOptions: { preserveFocus: true },
			});
			return entry;
    } catch (error) {
      disposeWebContentTargetEntry(id);
      throw error;
    }
  }

  async activateTarget(id: string): Promise<void> {
    getBrowserViewTargetEntry(id);
    activateWebContentTarget(id);
  }

  async destroyBrowserView(id: string): Promise<void> {
    disposeWebContentTarget(id);
  }

  async getState(id: string): Promise<IBrowserViewState> {
    return toBrowserViewState(id);
  }

  async layout(id: string, bounds: IBrowserViewBounds): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    getBrowserViewTargetEntry(id);
		const hostZoomFactor = bounds.zoomFactor;
		const emulationScale = bounds.emulation?.scale ?? 1;
		if (!Number.isFinite(hostZoomFactor) || hostZoomFactor <= 0) {
			throw new Error('Browser view host zoom factor must be a positive finite number.');
		}
		if (!Number.isFinite(emulationScale) || emulationScale <= 0) {
			throw new Error('Browser view emulation scale must be a positive finite number.');
		}
		metadata.emulationScaleFactor = hostZoomFactor * emulationScale;
    metadata.bounds = {
      x: Math.round(bounds.x),
      y: Math.round(bounds.y),
      width: Math.max(1, Math.round(bounds.width)),
      height: Math.max(1, Math.round(bounds.height)),
    };
    if (activeWebContentTargetId === id) {
      setWebContentBounds(metadata.bounds);
    }
  }

  async setVisible(id: string, visible: boolean): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    getBrowserViewTargetEntry(id);
    if (visible) {
      if (!metadata.bounds) {
        throw new Error(`Browser view '${id}' must be laid out before it becomes visible.`);
      }
      activeWebContentTargetId = id;
      webContentBounds = metadata.bounds;
      webContentVisible = true;
      webContentLayoutPhase = 'visible';
      applyWebContentLayout();
      return;
    }

    metadata.bounds = undefined;
    if (activeWebContentTargetId === id) {
      webContentBounds = null;
      webContentVisible = false;
      webContentLayoutPhase = 'hidden';
      applyWebContentLayout();
    }
  }

  async captureViewState(id: string): Promise<IBrowserViewViewStateEvent> {
    const metadata = getBrowserViewTargetMetadata(id);
    const entry = getBrowserViewTargetEntry(id);
    const generation = metadata.navigationGeneration;
    const result = await entry.view.webContents.executeJavaScript(
      createBrowserViewStateCaptureScript(),
      true,
    );
    if (metadata.navigationGeneration !== generation) {
      throw new Error(`Browser view '${id}' navigated while its view state was being captured.`);
    }
    const viewState = parseBrowserViewViewState(result);
    if (!viewState) {
      throw new Error(`Browser view '${id}' returned an invalid view state.`);
    }
    if (viewState.url !== entry.view.webContents.getURL()) {
      throw new Error(`Browser view '${id}' changed documents while its view state was being captured.`);
    }
    publishBrowserViewViewState(id, viewState);
    return viewState;
  }

  async restoreViewState(id: string, value: IBrowserViewViewStateEvent): Promise<boolean> {
    const viewState = parseBrowserViewViewState(value);
    if (!viewState) {
      throw new Error(`Browser view '${id}' received an invalid view state.`);
    }
    const metadata = getBrowserViewTargetMetadata(id);
    const entry = getBrowserViewTargetEntry(id);
    if (!metadata.visible || !metadata.bounds || metadata.bounds.width <= 1 || metadata.bounds.height <= 1) {
      throw new Error(`Browser view '${id}' must be visible and laid out before restoring view state.`);
    }
    if (viewState.url !== entry.view.webContents.getURL()) {
      throw new Error(`Browser view '${id}' cannot restore view state for a different document.`);
    }
    if (entry.view.webContents.isLoadingMainFrame()) {
      throw new Error(`Browser view '${id}' cannot restore view state while its document is loading.`);
    }
    const generation = metadata.navigationGeneration;
    const result = await entry.view.webContents.executeJavaScript(
      createBrowserViewStateRestoreScript(viewState),
      true,
    );
    if (metadata.navigationGeneration !== generation) {
      throw new Error(`Browser view '${id}' navigated while its view state was being restored.`);
    }
    if (typeof result !== 'boolean') {
      throw new Error(`Browser view '${id}' returned an invalid restoration result.`);
    }
    if (result) {
      publishBrowserViewViewState(id, viewState);
    }
    return result;
  }

  async loadURL(id: string, url: string): Promise<void> {
    getBrowserViewTargetMetadata(id);
    await navigateWebContentTarget(url, id, 'browser');
  }

  async getURL(id: string): Promise<string> {
    return toBrowserViewState(id).url;
  }

  async goBack(id: string): Promise<void> {
    getBrowserViewTargetMetadata(id);
    goBackWebContent(id);
  }

  async goForward(id: string): Promise<void> {
    getBrowserViewTargetMetadata(id);
    goForwardWebContent(id);
  }

  async reload(id: string, hard?: boolean): Promise<void> {
    getBrowserViewTargetMetadata(id);
    if (hard) {
      hardReloadWebContent(id);
      return;
    }
    reloadWebContent(id);
  }

  async toggleDevTools(id: string): Promise<void> {
    const webContents = getBrowserViewTargetEntry(id).view.webContents;
    if (webContents.isDevToolsOpened()) {
      webContents.closeDevTools();
      return;
    }
    webContents.openDevTools({ mode: 'detach' });
  }

  async canGoBack(id: string): Promise<boolean> {
    return toBrowserViewState(id).canGoBack;
  }

  async canGoForward(id: string): Promise<boolean> {
    return toBrowserViewState(id).canGoForward;
  }

  async captureScreenshot(
    id: string,
    options: IBrowserViewCaptureScreenshotOptions = {},
  ): Promise<VSBuffer> {
    const metadata = getBrowserViewTargetMetadata(id);
		const entry = getBrowserViewTargetEntry(id);
		const display = screen.getDisplayMatching(getWebContentOwnerWindow().getBounds());
		const screenshot = await entry.screenshot.capture(
			options,
			metadata.emulationScaleFactor,
			display.scaleFactor,
		);
		if (!options.screenRect && !options.pageRect) {
			metadata.lastScreenshot = screenshot;
		}
		return screenshot;
  }

  async focus(id: string, force?: boolean): Promise<void> {
    const entry = getBrowserViewTargetEntry(id);
    if (force) {
      webContentWindow?.focus();
    }
    entry.view.webContents.focus();
  }

  async findInPage(
    id: string,
    text: string,
    options: IBrowserViewFindInPageOptions = {},
  ): Promise<void> {
    getBrowserViewTargetEntry(id).view.webContents.findInPage(text, {
      forward: options.forward,
      findNext: options.recompute !== true,
      matchCase: options.matchCase,
    });
  }

  async stopFindInPage(id: string, keepSelection?: boolean): Promise<void> {
    getBrowserViewTargetEntry(id).view.webContents.stopFindInPage(
      keepSelection ? 'keepSelection' : 'clearSelection',
    );
  }

  async getSelectedText(id: string): Promise<string> {
    return (await getWebContentSelection(id))?.text ?? '';
  }

  async clearGlobalStorage(): Promise<void> {
    await session.fromPartition(WORKBENCH_SHARED_WEB_PARTITION).clearStorageData();
  }

  async clearWorkspaceStorage(_workspaceId: string): Promise<void> {
    throw new Error('Workspace-scoped browser storage is not supported.');
  }

  async clearStorage(id: string): Promise<void> {
    await getBrowserViewTargetEntry(id).view.webContents.session.clearStorageData();
  }

  async setBrowserZoomIndex(id: string, zoomIndex: number): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    metadata.browserZoomIndex = normalizeBrowserZoomIndex(zoomIndex);
    getBrowserViewTargetEntry(id).view.webContents.setZoomFactor(
      browserZoomFactors[metadata.browserZoomIndex],
    );
  }

  async setDeviceEmulation(
    id: string,
    device: IBrowserDeviceProfile | undefined,
  ): Promise<void> {
	applyBrowserViewDeviceEmulation(id, device);
  }

  async trustCertificate(_id: string, _host: string, _fingerprint: string): Promise<void> {
    throw new Error('Integrated browser certificate exceptions are not supported.');
  }

  async untrustCertificate(_id: string, _host: string, _fingerprint: string): Promise<void> {
    throw new Error('Integrated browser certificate exceptions are not supported.');
  }

  async setPermissions(
    id: string,
    origin: string,
    grants: readonly IPermissionCategoryState[],
  ): Promise<void> {
    const metadata = getBrowserViewTargetMetadata(id);
    const nextOrigin = { ...(metadata.permissions.origins[origin] ?? {}) };
    for (const grant of grants) {
      if (grant.state === null) {
        delete nextOrigin[grant.category];
      } else {
        nextOrigin[grant.category] = grant.state;
      }
    }
    metadata.permissions = {
      origins: {
        ...metadata.permissions.origins,
        [origin]: nextOrigin,
      },
    };
    metadata.events.onDidChangePermissions.fire(metadata.permissions);
  }

  async selectDevice(_id: string, _requestId: string, _deviceId: string | null): Promise<void> {
    throw new Error('Integrated browser device selection is not active.');
  }

  async getConsoleLogs(id: string): Promise<string> {
    return getBrowserViewTargetMetadata(id).consoleLogs.join('\n');
  }

  async toggleElementSelection(id: string, enabled?: boolean): Promise<void> {
		await getBrowserViewTargetEntry(id).inspector.toggleElementSelection(enabled);
  }

  async toggleAreaSelection(id: string, enabled?: boolean): Promise<void> {
		await getBrowserViewTargetEntry(id).inspector.toggleAreaSelection(enabled);
  }

  async updateWindowConfiguration(
    windowId: number,
    config: IBrowserViewWindowConfiguration,
  ): Promise<void> {
    browserViewWindowConfigurations.set(windowId, config);
		for (const [targetId, metadata] of browserViewTargetMetadata) {
			if (metadata.owner.mainWindowId === windowId) {
				webContentTargets.get(targetId)?.inspector.setTheme(config.theme);
			}
		}
  }

  dispose(): void {
    for (const id of [...browserViewTargetMetadata.keys()]) {
      disposeWebContentTargetEntry(id);
    }
    browserViewWindowConfigurations.clear();
    browserViewCreatedEmitter.dispose();
  }
}
