import { RequestErrorCode, isRequestError, requestError } from 'cs/platform/request/common/requestErrors';

type BrowserRequestSession = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  partition: string;
};

type BrowserDidFailLoadListener = (
  event: unknown,
  errorCode: number,
  errorDescription: string,
  validatedURL: string,
  isMainFrame?: boolean,
) => void;

type BrowserRendererWebContents = {
  isDestroyed: () => boolean;
  loadURL: (url: string, options?: { userAgent?: string; extraHeaders?: string }) => Promise<unknown>;
  executeJavaScript: (code: string, userGesture?: boolean) => Promise<unknown>;
  stop: () => void;
  setWindowOpenHandler?: (handler: () => { action: 'deny' }) => void;
  getURL?: () => string;
  on(event: 'did-fail-load', listener: BrowserDidFailLoadListener): void;
  on(event: string, listener: (...args: unknown[]) => void): void;
  off?(event: 'did-fail-load', listener: BrowserDidFailLoadListener): void;
  off?(event: string, listener: (...args: unknown[]) => void): void;
  removeListener?(event: 'did-fail-load', listener: BrowserDidFailLoadListener): void;
  removeListener?(event: string, listener: (...args: unknown[]) => void): void;
};

type BrowserHtmlRenderer = {
  window: {
    isDestroyed: () => boolean;
    destroy: () => void;
    webContents: BrowserRendererWebContents;
  };
  partition: string;
};

const browserRequestPromises = new Map<string, Promise<BrowserRequestSession | null>>();
const unsupportedBrowserRequestPartitions = new Set<string>();
const browserRendererPromises = new Map<string, Promise<BrowserHtmlRenderer | null>>();
const unsupportedBrowserRendererPartitions = new Set<string>();
// A single hidden BrowserWindow is shared per partition and must run tasks sequentially.
const browserRendererQueues = new Map<string, Promise<void>>();

function isAbortError(error: unknown) {
  return Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveBrowserRequestSession(partition: string) {
  if (!partition || unsupportedBrowserRequestPartitions.has(partition)) {
    return null;
  }

  if (!browserRequestPromises.has(partition)) {
    browserRequestPromises.set(partition, (async () => {
      try {
        const electronModule = (await import('electron')) as {
          app?: { isReady?: () => boolean };
          session?: {
            fromPartition?: (
              targetPartition: string,
            ) => {
              fetch?: (url: string, init: RequestInit) => Promise<Response>;
            };
          };
        };
        const electronApp = electronModule.app;
        const electronSession = electronModule.session;
        if (!electronApp || typeof electronApp.isReady !== 'function') {
          unsupportedBrowserRequestPartitions.add(partition);
          return null;
        }
        if (!electronApp.isReady()) {
          return null;
        }
        if (!electronSession || typeof electronSession.fromPartition !== 'function') {
          unsupportedBrowserRequestPartitions.add(partition);
          return null;
        }

        const chromiumSession = electronSession.fromPartition(partition);
        if (!chromiumSession || typeof chromiumSession.fetch !== 'function') {
          unsupportedBrowserRequestPartitions.add(partition);
          return null;
        }

        return {
          fetch: chromiumSession.fetch.bind(chromiumSession),
          partition,
        } satisfies BrowserRequestSession;
      } catch {
        unsupportedBrowserRequestPartitions.add(partition);
        return null;
      }
    })());
  }

  const resolved = await browserRequestPromises.get(partition)!;
  if (!resolved && !unsupportedBrowserRequestPartitions.has(partition)) {
    browserRequestPromises.delete(partition);
  }

  return resolved;
}

export type PreferredRequestTransport = 'node' | 'browser';

export type BrowserHtmlRenderLoadFailure = {
  partition: string;
  requestedUrl: string;
  currentUrl: string;
  failedUrl: string;
  errorCode: number;
  errorDescription: string;
  isMainFrame: boolean;
};

type PreferredBrowserRequestOptions = {
  enabled?: boolean;
  partition: string;
  onFallback?: (details: {
    url: string;
    partition: string;
    message: string;
  }) => void;
};

type PreferredRequestOptions = {
  url: string;
  signal: AbortSignal;
  headers?: RequestInit['headers'];
  browser?: PreferredBrowserRequestOptions;
};

type BrowserHtmlRenderOptions = {
  url: string;
  partition: string;
  timeoutMs: number;
  settleMs?: number;
  signal?: AbortSignal;
  userAgent?: string;
  acceptHeader?: string;
  onDidFailLoad?: (details: BrowserHtmlRenderLoadFailure) => void;
};

async function resolveBrowserHtmlRenderer(partition: string) {
  if (!partition || unsupportedBrowserRendererPartitions.has(partition)) {
    return null;
  }

  if (!browserRendererPromises.has(partition)) {
    browserRendererPromises.set(partition, (async () => {
      try {
        const electronModule = (await import('electron')) as {
          app?: { isReady?: () => boolean };
          BrowserWindow?: new (options?: Record<string, unknown>) => BrowserHtmlRenderer['window'];
        };
        const electronApp = electronModule.app;
        const ElectronBrowserWindow = electronModule.BrowserWindow;
        if (!electronApp || typeof electronApp.isReady !== 'function') {
          unsupportedBrowserRendererPartitions.add(partition);
          return null;
        }
        if (!electronApp.isReady()) {
          return null;
        }
        if (!ElectronBrowserWindow) {
          unsupportedBrowserRendererPartitions.add(partition);
          return null;
        }

        const window = new ElectronBrowserWindow({
          show: false,
          width: 1280,
          height: 900,
          autoHideMenuBar: true,
          webPreferences: {
            partition,
            sandbox: true,
            contextIsolation: true,
            nodeIntegration: false,
            backgroundThrottling: false,
          },
        });
        window.webContents.setWindowOpenHandler?.(() => ({ action: 'deny' }));

        return {
          window,
          partition,
        } satisfies BrowserHtmlRenderer;
      } catch {
        unsupportedBrowserRendererPartitions.add(partition);
        return null;
      }
    })());
  }

  const resolved = await browserRendererPromises.get(partition)!;
  if (!resolved && !unsupportedBrowserRendererPartitions.has(partition)) {
    browserRendererPromises.delete(partition);
    return null;
  }
  if (resolved?.window.isDestroyed()) {
    browserRendererPromises.delete(partition);
    return resolveBrowserHtmlRenderer(partition);
  }

  return resolved;
}

async function runBrowserHtmlRenderTask<T>(partition: string, task: () => Promise<T>) {
  // Queue tasks per partition to avoid concurrent navigations on the same hidden renderer window.
  const previousTask = (browserRendererQueues.get(partition) ?? Promise.resolve()).catch(() => undefined);
  const currentTask = previousTask.then(task);
  browserRendererQueues.set(
    partition,
    currentTask.then(
      () => undefined,
      () => undefined,
    ),
  );
  return currentTask;
}

export async function requestWithPreferredTransport({
  url,
  signal,
  headers,
  browser,
}: PreferredRequestOptions): Promise<{ response: Response; transport: PreferredRequestTransport }> {
  // Prefer Chromium-session fetch when enabled, then transparently fall back to Node fetch.
  if (browser && browser.enabled !== false) {
    const browserRequestSession = await resolveBrowserRequestSession(browser.partition);
    if (browserRequestSession) {
      try {
        const response = await browserRequestSession.fetch(url, {
          signal,
          headers,
        });
        return {
          response,
          transport: 'browser',
        };
      } catch (error) {
        if (isAbortError(error)) {
          throw error;
        }

        browser.onFallback?.({
          url,
          partition: browserRequestSession.partition,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  const response = await fetch(url, {
    signal,
    headers,
  });
  return {
    response,
    transport: 'node',
  };
}

export async function renderHtmlWithBrowserWindow({
  url,
  partition,
  timeoutMs,
  settleMs = 0,
  signal,
  userAgent,
  acceptHeader,
  onDidFailLoad,
}: BrowserHtmlRenderOptions): Promise<{ html: string; finalUrl: string; partition: string }> {
  const renderer = await resolveBrowserHtmlRenderer(partition);
  if (!renderer) {
    throw requestError(RequestErrorCode.HttpRequestFailed, {
      status: 'RENDER_UNAVAILABLE',
      statusText: 'Browser renderer unavailable',
      url,
    });
  }

  return runBrowserHtmlRenderTask(partition, async () => {
    const { window } = renderer;
    if (window.isDestroyed() || window.webContents.isDestroyed()) {
      browserRendererPromises.delete(partition);
      throw requestError(RequestErrorCode.HttpRequestFailed, {
        status: 'RENDER_UNAVAILABLE',
        statusText: 'Browser renderer destroyed',
        url,
      });
    }

    let abortedByExternalSignal = false;
    let timedOut = false;
    const stopLoading = () => {
      if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
        try {
          window.webContents.stop();
        } catch {
          // Ignore stop failures while tearing down a hidden renderer window.
        }
      }
    };
    const abortFromExternalSignal = () => {
      abortedByExternalSignal = true;
      stopLoading();
    };

    if (signal?.aborted) {
      abortFromExternalSignal();
    } else if (signal) {
      signal.addEventListener('abort', abortFromExternalSignal, { once: true });
    }

    const timeoutId = setTimeout(() => {
      timedOut = true;
      stopLoading();
    }, timeoutMs);
    const didFailLoad = (
      _event: unknown,
      errorCode: number,
      errorDescription: string,
      validatedURL: string,
      isMainFrame = false,
    ) => {
      onDidFailLoad?.({
        partition,
        requestedUrl: url,
        currentUrl: window.webContents.getURL?.() ?? '',
        failedUrl: validatedURL,
        errorCode,
        errorDescription,
        isMainFrame,
      });
    };
    const detachDidFailLoad = () => {
      if (typeof window.webContents.off === 'function') {
        window.webContents.off('did-fail-load', didFailLoad);
        return;
      }
      if (typeof window.webContents.removeListener === 'function') {
        window.webContents.removeListener('did-fail-load', didFailLoad);
      }
    };
    window.webContents.on('did-fail-load', didFailLoad);

    try {
      const extraHeaders = acceptHeader ? `accept: ${acceptHeader}\n` : undefined;
      await window.webContents.loadURL(url, {
        userAgent,
        extraHeaders,
      });
      if (settleMs > 0) {
        await sleep(settleMs);
      }

      // Read the fully rendered DOM after optional settle delay for JS-heavy pages.
      const html = await window.webContents.executeJavaScript(
        `(() => {
          try {
            return document.documentElement ? document.documentElement.outerHTML : '';
          } catch {
            return '';
          }
        })()`,
        true,
      );
      const normalizedHtml = typeof html === 'string' ? html : '';
      if (!normalizedHtml.trim()) {
        throw requestError(RequestErrorCode.HttpRequestFailed, {
          status: 'EMPTY_RENDERED_HTML',
          statusText: 'Rendered page returned empty HTML',
          url,
        });
      }

      return {
        html: normalizedHtml,
        finalUrl: window.webContents.getURL?.() ?? url,
        partition,
      };
    } catch (error) {
      if (isRequestError(error)) {
        throw error;
      }

      if (abortedByExternalSignal) {
        throw requestError(RequestErrorCode.HttpRequestFailed, {
          status: 'ABORTED',
          statusText: 'Request aborted',
          url,
        });
      }

      if (timedOut) {
        throw requestError(RequestErrorCode.HttpRequestFailed, {
          status: 'TIMEOUT',
          statusText: `Rendered request timed out after ${timeoutMs}ms`,
          url,
        });
      }

      throw requestError(RequestErrorCode.HttpRequestFailed, {
        status: 'NETWORK_ERROR',
        statusText: error instanceof Error ? error.message : String(error),
        url,
      });
    } finally {
      detachDidFailLoad();
      if (signal) {
        signal.removeEventListener('abort', abortFromExternalSignal);
      }
      clearTimeout(timeoutId);
    }
  });
}
