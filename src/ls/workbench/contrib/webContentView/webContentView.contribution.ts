import {
  getWorkbenchBrowserTabKeepAliveLimit,
  subscribeWorkbenchWebContentRetention,
} from 'ls/workbench/browser/webContentRetentionState';
import {
  getWorkbenchPartDomSnapshot,
  subscribeWorkbenchPartDom,
  WORKBENCH_PART_IDS,
} from 'ls/workbench/browser/layout';
import {
  combineDisposables,
  LifecycleStore,
  MutableLifecycle,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';
import type {
  WebContentBridgeCommand,
  WebContentLayoutPhase,
  WebContentNavigationMode,
  WebContentState,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostService';
import { WORKBENCH_SHARED_WEB_PARTITION } from 'ls/platform/native/electron-main/sharedWebSession';
import type { Disposable } from 'ls/workbench/contrib/workbench/workbench.contribution';
import {
  defaultBrowserTabKeepAliveLimit,
  normalizeBrowserTabKeepAliveLimit,
} from 'ls/workbench/services/webContent/webContentRetentionConfig';

const DEFAULT_WEB_CONTENT_TARGET_ID = '__shared__';
const WEB_CONTENT_BRIDGE_KEY = '__lsWebContentBridge';
const WEB_CONTENT_ROOT_ID = 'ls-webcontent-root';
const RETAINED_WEB_CONTENT_TARGET_TTL_MS = 3 * 60 * 1000;

type WebContentLayoutSnapshot = {
  visible: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
};

type WebContentTargetSnapshot = Pick<
  WebContentState,
  | 'url'
  | 'pageTitle'
  | 'faviconUrl'
  | 'canGoBack'
  | 'canGoForward'
  | 'isLoading'
>;

type WebContentTargetMetadataPhase = 'idle' | 'loading' | 'ready';

type WebContentTargetMetadataMachine = {
  phase: WebContentTargetMetadataPhase;
  comparableUrl: string;
  pendingPageTitle: string;
  pendingFaviconUrl: string;
};

type ManagedWebviewElement = HTMLElement & {
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  clearHistory?: () => void;
  executeJavaScript?: <T = unknown>(
    code: string,
    userGesture?: boolean,
  ) => Promise<T>;
  getURL?: () => string;
  getTitle?: () => string;
  goBack?: () => void;
  goForward?: () => void;
  isLoading?: () => boolean;
  loadURL?: (url: string) => Promise<void>;
  printToPDF?: (options?: unknown) => Promise<Uint8Array>;
  reloadIgnoringCache?: () => void;
  reload?: () => void;
  stop?: () => void;
};

type ManagedWebviewEntry = {
  cleanup: Array<() => void>;
  domReady: boolean;
  domReadyPromise: Promise<void>;
  hasCommittedNavigation: boolean;
  metadataMachine: WebContentTargetMetadataMachine;
  rejectDomReady: (error?: unknown) => void;
  resolveDomReady: () => void;
  state: WebContentTargetSnapshot;
  targetId: string;
  webview: ManagedWebviewElement;
};

type RetainedTargetEntry = {
  releasedAt: number;
};

type BridgeExecuteTimeout = {
  __lsTimedOut: true;
};

type WebContentDomBridge = {
  activateTarget: (targetId?: string | null) => Promise<WebContentState>;
  clearHistory: (targetId?: string | null) => Promise<WebContentState>;
  disposeTarget: (targetId?: string | null) => Promise<void>;
  executeJavaScript: (
    targetId: string | null | undefined,
    script: string,
    timeoutMs?: number,
  ) => Promise<unknown | BridgeExecuteTimeout | null>;
  getState: (targetId?: string | null) => Promise<WebContentState>;
  goBack: (targetId?: string | null) => Promise<WebContentState>;
  goForward: (targetId?: string | null) => Promise<WebContentState>;
  hardReload: (targetId?: string | null) => Promise<WebContentState>;
  navigateTo: (
    url: string,
    targetId?: string | null,
    mode?: WebContentNavigationMode,
  ) => Promise<WebContentState>;
  printToPDF: (
    targetId?: string | null,
    options?: unknown,
  ) => Promise<string>;
  releaseTarget: (targetId?: string | null) => Promise<void>;
  reload: (targetId?: string | null) => Promise<WebContentState>;
};

type RendererWindow = Window &
  typeof globalThis & {
    [WEB_CONTENT_BRIDGE_KEY]?: WebContentDomBridge;
  };

function readWebContentViewLayout(webContentViewHostElement: HTMLElement | null) {
  if (!webContentViewHostElement) {
    return {
      visible: false,
      bounds: null,
    };
  }

  if (webContentViewHostElement.dataset.webcontentActive !== 'true') {
    return {
      visible: false,
      bounds: null,
    };
  }

  const rect = webContentViewHostElement.getBoundingClientRect();
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);

  if (width <= 0 || height <= 0) {
    return {
      visible: false,
      bounds: null,
    };
  }

  return {
    visible: true,
    bounds: {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width,
      height,
    },
  };
}

function areBoundsEqual(
  left: WebContentLayoutSnapshot['bounds'],
  right: WebContentLayoutSnapshot['bounds'],
) {
  return (
    left?.x === right?.x &&
    left?.y === right?.y &&
    left?.width === right?.width &&
    left?.height === right?.height
  );
}

function areLayoutSnapshotsEqual(
  left: WebContentLayoutSnapshot | null,
  right: WebContentLayoutSnapshot | null,
) {
  if (!left || !right) {
    return left === right;
  }

  return left.visible === right.visible && areBoundsEqual(left.bounds, right.bounds);
}

function addDisposableListener(
  target: EventTarget,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function normalizeWebContentTargetId(targetId?: string | null) {
  const normalized = String(targetId ?? '').trim();
  return normalized || DEFAULT_WEB_CONTENT_TARGET_ID;
}

function createDefaultTargetSnapshot(): WebContentTargetSnapshot {
  return {
    url: '',
    pageTitle: '',
    faviconUrl: '',
    canGoBack: false,
    canGoForward: false,
    isLoading: false,
  };
}

function sanitizeWebContentFaviconUrl(value: unknown) {
  return String(value ?? '').trim();
}

function resolveWebContentTargetMetadataPhase(
  comparableUrl: string,
  isLoading: boolean,
): WebContentTargetMetadataPhase {
  if (!comparableUrl || isWebContentFailureUrl(comparableUrl)) {
    return 'idle';
  }

  return isLoading ? 'loading' : 'ready';
}

function createDefaultTargetMetadataMachine(): WebContentTargetMetadataMachine {
  return {
    phase: 'idle',
    comparableUrl: '',
    pendingPageTitle: '',
    pendingFaviconUrl: '',
  };
}

function createDefaultWebContentState(targetId?: string | null): WebContentState {
  const normalizedTargetId = normalizeWebContentTargetId(targetId);
  return {
    ...createDefaultTargetSnapshot(),
    targetId:
      normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
    activeTargetId: null,
    ownership: 'inactive',
    layoutPhase: 'hidden',
    visible: false,
  };
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

function resolveWebContentFaviconUrl(event: Event) {
  const faviconCandidates = (event as Event & { favicons?: unknown }).favicons;
  if (!Array.isArray(faviconCandidates)) {
    return '';
  }

  for (const candidate of faviconCandidates) {
    const faviconUrl = String(candidate ?? '').trim();
    if (faviconUrl) {
      return faviconUrl;
    }
  }

  return '';
}

function resolveWebContentPageTitle(event: Event) {
  return String((event as Event & { title?: unknown }).title ?? '').trim();
}

function sanitizeWebContentPageTitle(
  pageTitle: string,
  currentUrl: string,
) {
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

  return coerceWebviewNavigationUrl(currentUrl) === 'about:blank'
    ? ''
    : normalizedPageTitle;
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

function coerceWebviewNavigationUrl(value: string) {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  if (/^about:blank$/i.test(normalized) || /^https?:\/\/about:blank$/i.test(normalized)) {
    return 'about:blank';
  }

  return normalized;
}

function isAbortLikeWebContentNavigationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /\bERR_ABORTED\b/i.test(message) || /\(-3\)\s+loading\b/i.test(message);
}

function isWebContentFailureUrl(url: string) {
  return /^about:blank$/i.test(url) || /^chrome-error:\/\//i.test(url);
}

function shouldUseWebviewSrcNavigation(currentUrl: string) {
  return !currentUrl || isWebContentFailureUrl(currentUrl);
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

function delay(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function bufferToBase64(buffer: Uint8Array) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, Math.min(bytes.length, index + chunkSize));
    binary += String.fromCharCode(...chunk);
  }

  return window.btoa(binary);
}

class WebContentDomManager {
  private activeTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
  private lastReportedState: WebContentState = createDefaultWebContentState();
  private layoutPhase: WebContentLayoutPhase = 'hidden';
  private rootElement: HTMLElement | null = null;
  private surfaceBounds: WebContentLayoutSnapshot['bounds'] = null;
  private surfaceVisible = false;
  private readonly targetEntries = new Map<string, ManagedWebviewEntry>();
  private readonly retainedTargetEntries = new Map<string, RetainedTargetEntry>();
  private retentionSweepTimer: number | null = null;
  private browserTabKeepAliveLimit = defaultBrowserTabKeepAliveLimit;
  private readonly bridge: WebContentDomBridge;

  constructor() {
    this.bridge = {
      activateTarget: (targetId) => this.activateTarget(targetId),
      clearHistory: (targetId) => this.clearHistory(targetId),
      disposeTarget: (targetId) => this.disposeTargetImmediately(targetId),
      executeJavaScript: (targetId, script, timeoutMs) =>
        this.executeTargetScript(targetId, script, timeoutMs),
      getState: (targetId) => this.getState(targetId),
      goBack: (targetId) => this.goBack(targetId),
      goForward: (targetId) => this.goForward(targetId),
      hardReload: (targetId) => this.hardReload(targetId),
      navigateTo: (url, targetId, mode) => this.navigateTo(url, targetId, mode),
      printToPDF: (targetId, options) => this.printToPDF(targetId, options),
      releaseTarget: (targetId) => this.releaseTarget(targetId),
      reload: (targetId) => this.reload(targetId),
    };
    this.installBridge();
  }

  dispose() {
    const rendererWindow = window as RendererWindow;
    if (rendererWindow[WEB_CONTENT_BRIDGE_KEY] === this.bridge) {
      delete rendererWindow[WEB_CONTENT_BRIDGE_KEY];
    }

    this.clearRetentionSweepTimer();
    this.retainedTargetEntries.clear();
    for (const targetId of [...this.targetEntries.keys()]) {
      this.disposeTarget(targetId);
    }

    this.targetEntries.clear();
    this.rootElement?.remove();
    this.rootElement = null;
  }

  setBrowserTabKeepAliveLimit(limit: unknown) {
    const nextLimit = normalizeBrowserTabKeepAliveLimit(
      limit,
      this.browserTabKeepAliveLimit,
    );
    if (nextLimit === this.browserTabKeepAliveLimit) {
      return;
    }

    this.browserTabKeepAliveLimit = nextLimit;
    this.sweepReleasedTargets(Date.now());
  }

  private clearRetentionSweepTimer() {
    if (this.retentionSweepTimer === null) {
      return;
    }

    window.clearTimeout(this.retentionSweepTimer);
    this.retentionSweepTimer = null;
  }

  private scheduleRetentionSweep(nextSweepDelayMs: number | null) {
    this.clearRetentionSweepTimer();
    if (nextSweepDelayMs === null || this.retainedTargetEntries.size === 0) {
      return;
    }

    this.retentionSweepTimer = window.setTimeout(() => {
      this.retentionSweepTimer = null;
      this.sweepReleasedTargets(Date.now());
    }, nextSweepDelayMs);
  }

  private markTargetAsRetained(targetId: string, now = Date.now()) {
    if (
      targetId === DEFAULT_WEB_CONTENT_TARGET_ID ||
      !this.targetEntries.has(targetId)
    ) {
      this.retainedTargetEntries.delete(targetId);
      return;
    }

    this.retainedTargetEntries.set(targetId, { releasedAt: now });
  }

  private markTargetAsActive(targetId: string) {
    this.retainedTargetEntries.delete(targetId);
  }

  private sweepReleasedTargets(now = Date.now()) {
    this.retainedTargetEntries.delete(this.activeTargetId);

    for (const targetId of [...this.retainedTargetEntries.keys()]) {
      if (!this.targetEntries.has(targetId)) {
        this.retainedTargetEntries.delete(targetId);
      }
    }

    const evictedTargetIds: string[] = [];
    for (const [targetId, retentionEntry] of this.retainedTargetEntries) {
      if (now - retentionEntry.releasedAt < RETAINED_WEB_CONTENT_TARGET_TTL_MS) {
        continue;
      }

      evictedTargetIds.push(targetId);
    }

    if (this.retainedTargetEntries.size - evictedTargetIds.length > this.browserTabKeepAliveLimit) {
      const overflowCount =
        this.retainedTargetEntries.size -
        evictedTargetIds.length -
        this.browserTabKeepAliveLimit;
      if (overflowCount > 0) {
        const overflowEvictions = [...this.retainedTargetEntries.entries()]
          .filter(([targetId]) => !evictedTargetIds.includes(targetId))
          .sort(
            ([, left], [, right]) =>
              left.releasedAt - right.releasedAt,
          )
          .slice(0, overflowCount)
          .map(([targetId]) => targetId);
        evictedTargetIds.push(...overflowEvictions);
      }
    }

    if (evictedTargetIds.length > 0) {
      for (const targetId of evictedTargetIds) {
        this.retainedTargetEntries.delete(targetId);
        this.disposeTarget(targetId);
      }
    }

    let nextSweepDelayMs: number | null = null;
    for (const retentionEntry of this.retainedTargetEntries.values()) {
      const delayMs = Math.max(
        0,
        retentionEntry.releasedAt + RETAINED_WEB_CONTENT_TARGET_TTL_MS - now,
      );
      nextSweepDelayMs =
        nextSweepDelayMs === null ? delayMs : Math.min(nextSweepDelayMs, delayMs);
    }

    this.scheduleRetentionSweep(nextSweepDelayMs);
    this.syncDomPlacement();
  }

  setSurfaceState(
    visible: boolean,
    layoutPhase: WebContentLayoutPhase,
    bounds: WebContentLayoutSnapshot['bounds'],
  ) {
    this.surfaceVisible = visible;
    this.layoutPhase = layoutPhase;
    this.surfaceBounds = bounds;
    this.syncDomPlacement();
    this.reportActiveState();
  }

  private installBridge() {
    (window as RendererWindow)[WEB_CONTENT_BRIDGE_KEY] = this.bridge;
  }

  invokeBridgeCommand(
    method: WebContentBridgeCommand['method'],
    args: unknown[] = [],
  ) {
    const bridgeMethod = this.bridge[method] as (...bridgeArgs: unknown[]) => Promise<unknown>;
    return bridgeMethod(...args);
  }

  private ensureRootElement() {
    if (this.rootElement) {
      return this.rootElement;
    }

    const rootElement = document.createElement('div');
    rootElement.id = WEB_CONTENT_ROOT_ID;
    rootElement.setAttribute('aria-hidden', 'true');
    rootElement.style.cssText = [
      'position: fixed',
      'inset: 0',
      'pointer-events: none',
      'overflow: hidden',
      'z-index: 0',
    ].join(';');
    document.body.append(rootElement);
    this.rootElement = rootElement;
    return rootElement;
  }

  private shouldShowActiveTarget() {
    return Boolean(
      this.surfaceBounds &&
        this.surfaceVisible &&
        this.layoutPhase === 'visible',
    );
  }

  private applyMountedWebviewStyle(webview: ManagedWebviewElement) {
    const bounds = this.surfaceBounds;
    if (!bounds) {
      this.applyHiddenWebviewStyle(webview);
      return;
    }

    webview.style.cssText = [
      'position: fixed',
      `left: ${bounds.x}px`,
      `top: ${bounds.y}px`,
      `width: ${bounds.width}px`,
      `height: ${bounds.height}px`,
      'flex: 0 0 auto',
      'display: flex',
      'min-width: 0',
      'min-height: 0',
      'border: none',
      'outline: none',
      'opacity: 1',
      'pointer-events: auto',
      'visibility: visible',
      'z-index: 1',
    ].join(';');
  }

  private applyHiddenWebviewStyle(webview: ManagedWebviewElement) {
    webview.style.cssText = [
      'position: fixed',
      'left: -20000px',
      'top: 0',
      'width: 1px',
      'height: 1px',
      'flex: 0 0 auto',
      'display: flex',
      'min-width: 0',
      'min-height: 0',
      'border: none',
      'outline: none',
      'opacity: 0',
      'pointer-events: none',
      'visibility: hidden',
      'z-index: 0',
    ].join(';');
  }

  private syncDomPlacement() {
    const shouldShowActiveTarget = this.shouldShowActiveTarget();
    const rootElement = this.ensureRootElement();

    for (const [targetId, entry] of this.targetEntries) {
      if (entry.webview.parentElement !== rootElement) {
        rootElement.append(entry.webview);
      }

      if (shouldShowActiveTarget && targetId === this.activeTargetId) {
        this.applyMountedWebviewStyle(entry.webview);
      } else {
        this.applyHiddenWebviewStyle(entry.webview);
      }
    }
  }

  private createWebviewElement() {
    const webview = document.createElement('webview') as ManagedWebviewElement;
    webview.className = 'browser-frame browser-frame-webview';
    webview.setAttribute('partition', WORKBENCH_SHARED_WEB_PARTITION);
    webview.setAttribute(
      'webpreferences',
      'contextIsolation=yes, nodeIntegration=no, sandbox=yes',
    );
    webview.setAttribute('allowpopups', 'true');
    this.applyHiddenWebviewStyle(webview);
    return webview;
  }

  private resetTargetDomReadyState(entry: ManagedWebviewEntry) {
    entry.rejectDomReady(new Error('webview guest reset before dom-ready.'));
    entry.domReady = false;
    const domReadyPromise = new Promise<void>((resolve, reject) => {
      entry.resolveDomReady = resolve;
      entry.rejectDomReady = reject;
    });
    domReadyPromise.catch(() => undefined);
    entry.domReadyPromise = domReadyPromise;
  }

  private async waitForTargetDomReady(targetId?: string | null, timeoutMs = 8000) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const startedAt = Date.now();

    while (Date.now() - startedAt < Math.max(0, timeoutMs)) {
      const entry = this.targetEntries.get(normalizedTargetId);
      if (!entry) {
        throw new Error('webview target is unavailable.');
      }

      if (entry.domReady) {
        return;
      }

      await Promise.race([
        entry.domReadyPromise.catch(() => undefined),
        delay(100),
      ]);
    }

    throw new Error('Timed out while waiting for webview dom-ready.');
  }

  private ensureTargetEntry(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const existingEntry = this.targetEntries.get(normalizedTargetId);
    if (existingEntry) {
      return existingEntry;
    }

    const webview = this.createWebviewElement();
    const entry: ManagedWebviewEntry = {
      cleanup: [],
      domReady: false,
      domReadyPromise: Promise.resolve(),
      hasCommittedNavigation: false,
      metadataMachine: createDefaultTargetMetadataMachine(),
      rejectDomReady: (_error?: unknown) => {},
      resolveDomReady: () => {},
      state: createDefaultTargetSnapshot(),
      targetId: normalizedTargetId,
      webview,
    };
    this.resetTargetDomReadyState(entry);

    const syncState = () => {
      void this.syncTargetState(normalizedTargetId);
    };

    const events = [
      'did-start-loading',
      'did-stop-loading',
      'did-finish-load',
      'did-navigate',
      'did-navigate-in-page',
      'dom-ready',
      'did-fail-load',
    ];

    for (const eventName of events) {
      const disposable = addDisposableListener(webview, eventName, syncState);
      entry.cleanup.push(() => disposable.dispose());
    }

    const faviconUpdatedDisposable = addDisposableListener(
      webview,
      'page-favicon-updated',
      (event: Event) => {
        const faviconUrl = sanitizeWebContentFaviconUrl(
          resolveWebContentFaviconUrl(event),
        );
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
        syncState();
      },
    );
    entry.cleanup.push(() => faviconUpdatedDisposable.dispose());

    const pageTitleUpdatedDisposable = addDisposableListener(
      webview,
      'page-title-updated',
      (event: Event) => {
        const pageTitle = resolveWebContentPageTitle(event);
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
        syncState();
      },
    );
    entry.cleanup.push(() => pageTitleUpdatedDisposable.dispose());

    const domReadyDisposable = addDisposableListener(webview, 'dom-ready', () => {
      if (!entry.domReady) {
        entry.domReady = true;
        entry.resolveDomReady();
      }
    });
    entry.cleanup.push(() => domReadyDisposable.dispose());

    const destroyedDisposable = addDisposableListener(webview, 'destroyed', () => {
      if (!this.targetEntries.has(normalizedTargetId)) {
        return;
      }

      this.resetTargetDomReadyState(entry);
      void this.syncTargetState(normalizedTargetId);
    });
    entry.cleanup.push(() => destroyedDisposable.dispose());

    this.targetEntries.set(normalizedTargetId, entry);
    this.syncDomPlacement();
    return entry;
  }

  private disposeTarget(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    this.retainedTargetEntries.delete(normalizedTargetId);
    const entry = this.targetEntries.get(normalizedTargetId);
    if (!entry) {
      return;
    }

    this.targetEntries.delete(normalizedTargetId);
    entry.rejectDomReady(new Error('webview target was disposed.'));
    for (const cleanup of entry.cleanup) {
      cleanup();
    }

    try {
      entry.webview.stop?.();
    } catch {
      // Ignore stop failures during teardown.
    }

    entry.webview.remove();
  }

  private async syncTargetState(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.targetEntries.get(normalizedTargetId);
    if (!entry) {
      return createDefaultTargetSnapshot();
    }

    let nextState = createDefaultTargetSnapshot();
    try {
      const previousState = entry.state;
      const previousMetadataMachine = entry.metadataMachine;
      const nextUrl = String(entry.webview.getURL?.() ?? '').trim();
      const nextComparableUrl = normalizeComparableWebContentUrl(nextUrl);
      const nextIsLoading = Boolean(entry.webview.isLoading?.());
      const isNavigationTargetChanged =
        nextComparableUrl !== previousMetadataMachine.comparableUrl;

      const nextMetadataPhase = resolveWebContentTargetMetadataPhase(
        nextComparableUrl,
        nextIsLoading,
      );
      const pendingPageTitle = isNavigationTargetChanged
        ? ''
        : sanitizeWebContentPageTitle(
            previousMetadataMachine.pendingPageTitle,
            nextUrl,
          );
      const pendingFaviconUrl = isNavigationTargetChanged
        ? ''
        : sanitizeWebContentFaviconUrl(
            previousMetadataMachine.pendingFaviconUrl,
          );
      const sampledPageTitle = sanitizeWebContentPageTitle(
        String(entry.webview.getTitle?.() ?? '').trim(),
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
        phase: nextMetadataPhase,
        comparableUrl: nextComparableUrl,
        pendingPageTitle: canApplyPendingPageTitle ? '' : pendingPageTitle,
        pendingFaviconUrl: canApplyPendingFaviconUrl ? '' : pendingFaviconUrl,
      };
      nextState = {
        url: nextUrl,
        pageTitle: resolvedPageTitle,
        faviconUrl: resolvedFaviconUrl,
        canGoBack: Boolean(entry.webview.canGoBack?.()),
        canGoForward: Boolean(entry.webview.canGoForward?.()),
        isLoading: nextIsLoading,
      };
    } catch {
      nextState = createDefaultTargetSnapshot();
      entry.metadataMachine = createDefaultTargetMetadataMachine();
    }

    entry.state = nextState;
    if (shouldUseWebviewSrcNavigation(normalizeComparableWebContentUrl(nextState.url))) {
      entry.hasCommittedNavigation = false;
    } else if (nextState.url) {
      entry.hasCommittedNavigation = true;
    }
    if (normalizedTargetId === this.activeTargetId) {
      this.reportActiveState();
    }
    return nextState;
  }

  private buildState(targetId?: string | null): WebContentState {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const activeTargetId = normalizeWebContentTargetId(this.activeTargetId);
    const entry = this.targetEntries.get(normalizedTargetId);
    const snapshot = entry?.state ?? createDefaultTargetSnapshot();
    const isActiveTarget = normalizedTargetId === activeTargetId;

    return {
      ...snapshot,
      targetId:
        normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : normalizedTargetId,
      activeTargetId:
        activeTargetId === DEFAULT_WEB_CONTENT_TARGET_ID ? null : activeTargetId,
      ownership: isActiveTarget ? 'active' : 'inactive',
      layoutPhase: isActiveTarget ? this.layoutPhase : 'hidden',
      visible: isActiveTarget ? this.surfaceVisible : false,
    };
  }

  private reportActiveState() {
    const reportState = nativeHostService.webContent?.reportState;
    if (typeof reportState !== 'function') {
      return;
    }

    const nextState = this.buildState(this.activeTargetId);
    if (areWebContentStatesEqual(this.lastReportedState, nextState)) {
      return;
    }

    this.lastReportedState = nextState;
    reportState(nextState);
  }

  private async activateTarget(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    this.ensureTargetEntry(normalizedTargetId);
    this.markTargetAsActive(normalizedTargetId);
    this.activeTargetId = normalizedTargetId;
    this.syncDomPlacement();
    await this.syncTargetState(normalizedTargetId);
    return this.buildState(normalizedTargetId);
  }

  private async releaseTarget(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
      return;
    }

    if (this.activeTargetId === normalizedTargetId) {
      this.activeTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
    }
    this.markTargetAsRetained(normalizedTargetId);
    this.sweepReleasedTargets(Date.now());

    this.syncDomPlacement();
    this.reportActiveState();
  }

  private async disposeTargetImmediately(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    if (normalizedTargetId === DEFAULT_WEB_CONTENT_TARGET_ID) {
      return;
    }

    this.retainedTargetEntries.delete(normalizedTargetId);
    this.disposeTarget(normalizedTargetId);
    if (this.activeTargetId === normalizedTargetId) {
      this.activeTargetId = DEFAULT_WEB_CONTENT_TARGET_ID;
    }

    this.syncDomPlacement();
    this.reportActiveState();
  }

  private async getState(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    if (this.targetEntries.has(normalizedTargetId)) {
      await this.syncTargetState(normalizedTargetId);
    }
    return this.buildState(normalizedTargetId);
  }

  private async navigateTo(
    url: string,
    targetId?: string | null,
    mode: WebContentNavigationMode = 'browser',
  ) {
    const resolvedUrl = coerceWebviewNavigationUrl(url);
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.ensureTargetEntry(normalizedTargetId);
    this.markTargetAsActive(normalizedTargetId);
    this.activeTargetId = normalizedTargetId;
    this.syncDomPlacement();
    await this.syncTargetState(normalizedTargetId);

    const initialUrl = normalizeComparableWebContentUrl(this.buildState(normalizedTargetId).url);
    const normalizedTargetUrl = normalizeComparableWebContentUrl(resolvedUrl);
    if (normalizedTargetUrl === 'about:blank') {
      entry.webview.setAttribute('src', 'about:blank');
      entry.state = createDefaultTargetSnapshot();
      entry.state.url = 'about:blank';
      entry.metadataMachine = createDefaultTargetMetadataMachine();
      this.reportActiveState();
      return this.buildState(normalizedTargetId);
    }

    let navigationFailure: unknown = null;

    try {
      let currentUrl = '';
      if (entry.domReady || entry.hasCommittedNavigation) {
        try {
          currentUrl = normalizeComparableWebContentUrl(
            String(entry.webview.getURL?.() ?? '').trim(),
          );
        } catch {
          currentUrl = '';
        }
      }
      const shouldUseSrcNavigation =
        !entry.hasCommittedNavigation ||
        !entry.domReady ||
        shouldUseWebviewSrcNavigation(currentUrl);

      if (shouldUseSrcNavigation) {
        const assignedUrl = normalizeComparableWebContentUrl(
          String(entry.webview.getAttribute('src') ?? '').trim(),
        );
        if (assignedUrl !== normalizedTargetUrl) {
          entry.webview.setAttribute('src', resolvedUrl);
        }
        if (!entry.domReady) {
          await this.waitForTargetDomReady(normalizedTargetId, 12000);
        }
      } else {
        if (typeof entry.webview.loadURL !== 'function') {
          throw new Error('webview.loadURL is unavailable.');
        }

        void entry.webview.loadURL(resolvedUrl).catch((error) => {
          if (isAbortLikeWebContentNavigationError(error)) {
            return;
          }
          navigationFailure = error;
        });
      }
    } catch (error) {
      navigationFailure = error;
    }

    const startedAt = Date.now();
    const timeoutMs = 12000;
    while (Date.now() - startedAt < timeoutMs) {
      if (navigationFailure) {
        throw navigationFailure;
      }

      const currentState = await this.getState(normalizedTargetId);
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
  }

  private async reload(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.ensureTargetEntry(normalizedTargetId);
    this.markTargetAsActive(normalizedTargetId);
    this.activeTargetId = normalizedTargetId;
    this.syncDomPlacement();
    entry.webview.reload?.();
    await this.syncTargetState(normalizedTargetId);
    return this.buildState(normalizedTargetId);
  }

  private async hardReload(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.ensureTargetEntry(normalizedTargetId);
    this.markTargetAsActive(normalizedTargetId);
    this.activeTargetId = normalizedTargetId;
    this.syncDomPlacement();
    entry.webview.reloadIgnoringCache?.();
    await this.syncTargetState(normalizedTargetId);
    return this.buildState(normalizedTargetId);
  }

  private async clearHistory(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.ensureTargetEntry(normalizedTargetId);
    this.markTargetAsActive(normalizedTargetId);
    this.activeTargetId = normalizedTargetId;
    this.syncDomPlacement();
    entry.webview.clearHistory?.();
    await this.syncTargetState(normalizedTargetId);
    return this.buildState(normalizedTargetId);
  }

  private async goBack(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.ensureTargetEntry(normalizedTargetId);
    this.markTargetAsActive(normalizedTargetId);
    this.activeTargetId = normalizedTargetId;
    this.syncDomPlacement();
    if (entry.webview.canGoBack?.()) {
      entry.webview.goBack?.();
    }
    await this.syncTargetState(normalizedTargetId);
    return this.buildState(normalizedTargetId);
  }

  private async goForward(targetId?: string | null) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.ensureTargetEntry(normalizedTargetId);
    this.markTargetAsActive(normalizedTargetId);
    this.activeTargetId = normalizedTargetId;
    this.syncDomPlacement();
    if (entry.webview.canGoForward?.()) {
      entry.webview.goForward?.();
    }
    await this.syncTargetState(normalizedTargetId);
    return this.buildState(normalizedTargetId);
  }

  private async executeTargetScript(
    targetId: string | null | undefined,
    script: string,
    timeoutMs = 0,
  ) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.targetEntries.get(normalizedTargetId);
    if (!entry || typeof entry.webview.executeJavaScript !== 'function') {
      return null;
    }

    const execution = entry.webview.executeJavaScript(script, true);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      return await execution;
    }

    return await Promise.race([
      execution,
      new Promise<BridgeExecuteTimeout>((resolve) => {
        window.setTimeout(() => resolve({ __lsTimedOut: true }), timeoutMs);
      }),
    ]);
  }

  private async printToPDF(targetId?: string | null, options?: unknown) {
    const normalizedTargetId = normalizeWebContentTargetId(targetId);
    const entry = this.targetEntries.get(normalizedTargetId);
    if (!entry || typeof entry.webview.printToPDF !== 'function') {
      throw new Error('webview.printToPDF is unavailable.');
    }

    const pdfBuffer = await entry.webview.printToPDF(options);
    return bufferToBase64(pdfBuffer);
  }
}

export function createWorkbenchWebContentViewContribution(): Disposable | void {
  if (
    typeof window === 'undefined' ||
    typeof nativeHostService.webContent?.navigate !== 'function'
  ) {
    return;
  }

  const manager = new WebContentDomManager();
  manager.setBrowserTabKeepAliveLimit(getWorkbenchBrowserTabKeepAliveLimit());
  let webContentViewHostElement =
    getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.webContentViewHost];
  const contributionDisposables = new LifecycleStore();
  const hostObservers = new MutableLifecycle<DisposableLike>();
  const scheduledSync = new MutableLifecycle<DisposableLike>();
  let lastSnapshot: WebContentLayoutSnapshot | null = null;
  let layoutPhase: WebContentLayoutPhase = 'hidden';
  let measuringSnapshot: WebContentLayoutSnapshot | null = null;

  contributionDisposables.add(hostObservers);
  contributionDisposables.add(scheduledSync);
  contributionDisposables.add(
    subscribeWorkbenchWebContentRetention(() => {
      manager.setBrowserTabKeepAliveLimit(getWorkbenchBrowserTabKeepAliveLimit());
    }),
  );

  if (
    typeof nativeHostService.webContent?.onBridgeCommand === 'function' &&
    typeof nativeHostService.webContent.respondToBridgeCommand === 'function'
  ) {
    const unsubscribeBridgeCommand = nativeHostService.webContent.onBridgeCommand(
      (command) => {
        if (!command?.requestId) {
          return;
        }

        const args = Array.isArray(command.args) ? command.args : [];
        void manager
          .invokeBridgeCommand(command.method, args)
          .then((result) => {
            nativeHostService.webContent?.respondToBridgeCommand?.({
              requestId: command.requestId,
              ok: true,
              result,
            });
          })
          .catch((error) => {
            nativeHostService.webContent?.respondToBridgeCommand?.({
              requestId: command.requestId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
            });
          });
      },
    );
    contributionDisposables.add(
      toDisposable(() => {
        unsubscribeBridgeCommand();
      }),
    );
  }

  const scheduleSync = () => {
    if (scheduledSync.value) {
      return;
    }

    let frameId = 0;
    const frameDisposable = toDisposable(() => {
      window.cancelAnimationFrame(frameId);
    });
    scheduledSync.value = frameDisposable;
    frameId = window.requestAnimationFrame(() => {
      if (scheduledSync.value === frameDisposable) {
        scheduledSync.clearAndLeak();
      }
      const nextSnapshot = readWebContentViewLayout(webContentViewHostElement);

      if (!nextSnapshot.visible) {
        layoutPhase = 'hidden';
        measuringSnapshot = null;
        manager.setSurfaceState(false, 'hidden', null);
        lastSnapshot = nextSnapshot;
        return;
      }

      if (layoutPhase === 'hidden') {
        layoutPhase = 'measuring';
        measuringSnapshot = nextSnapshot;
        manager.setSurfaceState(true, 'measuring', nextSnapshot.bounds);
        scheduleSync();
        return;
      }

      if (layoutPhase === 'measuring') {
        if (areLayoutSnapshotsEqual(measuringSnapshot, nextSnapshot)) {
          layoutPhase = 'visible';
          measuringSnapshot = null;
          manager.setSurfaceState(true, 'visible', nextSnapshot.bounds);
          lastSnapshot = nextSnapshot;
          return;
        }

        measuringSnapshot = nextSnapshot;
        manager.setSurfaceState(true, 'measuring', nextSnapshot.bounds);
        scheduleSync();
        return;
      }

      if (!areLayoutSnapshotsEqual(lastSnapshot, nextSnapshot)) {
        manager.setSurfaceState(true, 'visible', nextSnapshot.bounds);
      }
      lastSnapshot = nextSnapshot;
    });
  };

  const resetObserver = () => {
    hostObservers.clear();

    if (!webContentViewHostElement) {
      return;
    }

    const mutationObserver = new MutationObserver(() => {
      layoutPhase = 'hidden';
      measuringSnapshot = null;
      scheduleSync();
    });
    mutationObserver.observe(webContentViewHostElement, {
      attributes: true,
      attributeFilter: ['data-webcontent-active'],
    });
    const observerDisposables: DisposableLike[] = [
      toDisposable(() => {
        mutationObserver.disconnect();
      }),
    ];

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => scheduleSync());
      resizeObserver.observe(webContentViewHostElement);
      observerDisposables.push(
        toDisposable(() => {
          resizeObserver.disconnect();
        }),
      );
    }

    hostObservers.value = combineDisposables(...observerDisposables);
  };

  const syncFromPartDom = () => {
    const nextWebContentViewHostElement =
      getWorkbenchPartDomSnapshot()[WORKBENCH_PART_IDS.webContentViewHost];
    if (nextWebContentViewHostElement !== webContentViewHostElement) {
      webContentViewHostElement = nextWebContentViewHostElement;
      layoutPhase = 'hidden';
      measuringSnapshot = null;
      resetObserver();
    }

    scheduleSync();
  };

  contributionDisposables.add(subscribeWorkbenchPartDom(syncFromPartDom));
  contributionDisposables.add(
    addDisposableListener(window, 'resize', () => scheduleSync()),
  );

  nativeHostService.webContent?.reportBridgeReady?.();
  resetObserver();
  scheduleSync();

  return {
    dispose: () => {
      contributionDisposables.dispose();
      manager.setSurfaceState(false, 'hidden', null);
      manager.dispose();
    },
  };
}
