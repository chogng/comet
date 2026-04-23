import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
  ElectronAPI,
  WebContentBridgeCommand,
  WebContentBridgeResponse,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createWorkbenchWebContentViewContribution: typeof import('ls/workbench/contrib/webContentView/webContentView.contribution').createWorkbenchWebContentViewContribution;
let registerWorkbenchPartDomNode: typeof import('ls/workbench/browser/layout').registerWorkbenchPartDomNode;
let WORKBENCH_PART_IDS: typeof import('ls/workbench/browser/layout').WORKBENCH_PART_IDS;
let resetWorkbenchBrowserTabKeepAliveLimit: typeof import('ls/workbench/browser/webContentRetentionState').resetWorkbenchBrowserTabKeepAliveLimit;
let setWorkbenchBrowserTabKeepAliveLimit: typeof import('ls/workbench/browser/webContentRetentionState').setWorkbenchBrowserTabKeepAliveLimit;

function installResizeObserverSpy() {
  let activeObservers = 0;
  const previousResizeObserver = globalThis.ResizeObserver;

  class FakeResizeObserver implements ResizeObserver {
    private observing = false;

    disconnect() {
      if (!this.observing) {
        return;
      }

      this.observing = false;
      activeObservers -= 1;
    }

    observe() {
      if (this.observing) {
        return;
      }

      this.observing = true;
      activeObservers += 1;
    }

    unobserve() {}
  }

  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: FakeResizeObserver,
  });

  return {
    getActiveObservers() {
      return activeObservers;
    },
    restore() {
      if (previousResizeObserver === undefined) {
        Reflect.deleteProperty(globalThis, 'ResizeObserver');
        return;
      }

      Object.defineProperty(globalThis, 'ResizeObserver', {
        configurable: true,
        writable: true,
        value: previousResizeObserver,
      });
    },
  };
}

function installAnimationFrameSpy() {
  const previousRequestAnimationFrame = window.requestAnimationFrame;
  const previousCancelAnimationFrame = window.cancelAnimationFrame;
  let nextHandle = 1;
  const callbacks = new Map<number, FrameRequestCallback>();
  const canceledHandles: number[] = [];

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((handle: number) => {
    canceledHandles.push(handle);
    callbacks.delete(handle);
  }) as typeof window.cancelAnimationFrame;

  return {
    flushAll(timestamp = 0) {
      const pendingCallbacks = [...callbacks.values()];
      callbacks.clear();
      for (const callback of pendingCallbacks) {
        callback(timestamp);
      }
    },
    flushUntilIdle(maxRounds = 10) {
      let rounds = 0;
      while (callbacks.size > 0) {
        if (rounds >= maxRounds) {
          throw new Error('requestAnimationFrame queue did not settle.');
        }
        this.flushAll(rounds);
        rounds += 1;
      }
    },
    getCanceledHandles() {
      return [...canceledHandles];
    },
    getPendingHandleCount() {
      return callbacks.size;
    },
    restore() {
      window.requestAnimationFrame = previousRequestAnimationFrame;
      window.cancelAnimationFrame = previousCancelAnimationFrame;
    },
  };
}

function createDomRect(x: number, y: number, width: number, height: number) {
  return {
    x,
    y,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    width,
    height,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

async function waitForCondition(
  condition: () => boolean,
  options?: {
    timeoutMs?: number;
    stepMs?: number;
  },
) {
  const timeoutMs = options?.timeoutMs ?? 1000;
  const stepMs = options?.stepMs ?? 0;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) {
      return;
    }
    await new Promise((resolve) => {
      setTimeout(resolve, stepMs);
    });
  }

  throw new Error('Timed out while waiting for test condition.');
}

type TestWebviewElement = HTMLElement & {
  __domReady: boolean;
  __history: string[];
  __historyIndex: number;
  __loadURLCalls: string[];
  __loading: boolean;
  __title: string;
  canGoBack?: () => boolean;
  canGoForward?: () => boolean;
  executeJavaScript?: <T = unknown>(
    code: string,
    userGesture?: boolean,
  ) => Promise<T>;
  getTitle?: () => string;
  getURL?: () => string;
  goBack?: () => void;
  goForward?: () => void;
  isLoading?: () => boolean;
  loadURL?: (url: string) => Promise<void>;
  printToPDF?: (options?: unknown) => Promise<Uint8Array>;
  reload?: () => void;
  stop?: () => void;
};

function installWebviewSpy() {
  const previousCreateElement = document.createElement.bind(document);
  const createdWebviews: TestWebviewElement[] = [];

  const commitNavigation = (
    webview: TestWebviewElement,
    url: string,
    emitDomReady: boolean,
  ) => {
    webview.__loading = true;
    queueMicrotask(() => {
      webview.__loading = false;
      webview.__domReady = true;
      webview.__title = '';

      if (webview.__history[webview.__historyIndex] !== url) {
        webview.__history = webview.__history.slice(0, webview.__historyIndex + 1);
        webview.__history.push(url);
        webview.__historyIndex = webview.__history.length - 1;
      }

      webview.dispatchEvent(new Event('did-start-loading'));
      if (emitDomReady) {
        webview.dispatchEvent(new Event('dom-ready'));
      }
      webview.dispatchEvent(new Event('did-navigate'));
      webview.dispatchEvent(new Event('did-stop-loading'));
      webview.dispatchEvent(new Event('did-finish-load'));
    });
  };

  document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    const element = previousCreateElement(tagName, options) as HTMLElement;
    if (tagName.toLowerCase() !== 'webview') {
      return element;
    }

    const webview = element as TestWebviewElement;
    webview.__domReady = false;
    webview.__history = [];
    webview.__historyIndex = -1;
    webview.__loadURLCalls = [];
    webview.__loading = false;
    webview.__title = '';

    const originalSetAttribute = webview.setAttribute.bind(webview);
    webview.setAttribute = ((name: string, value: string) => {
      originalSetAttribute(name, value);
      if (name === 'src' && value && value !== 'about:blank') {
        commitNavigation(webview, value, true);
      }
    }) as typeof webview.setAttribute;

    webview.getURL = () => {
      if (webview.__historyIndex >= 0) {
        return webview.__history[webview.__historyIndex];
      }
      return String(webview.getAttribute('src') ?? '').trim();
    };
    webview.getTitle = () => webview.__title;
    webview.isLoading = () => webview.__loading;
    webview.canGoBack = () => webview.__historyIndex > 0;
    webview.canGoForward = () => webview.__historyIndex < webview.__history.length - 1;
    webview.loadURL = async (url: string) => {
      webview.__loadURLCalls.push(url);
      if (!webview.__domReady) {
        throw new Error(
          'The WebView must be attached to the DOM and the dom-ready event emitted before this method can be called.',
        );
      }
      commitNavigation(webview, url, false);
    };
    webview.goBack = () => {
      if (!webview.canGoBack?.()) {
        return;
      }
      webview.__historyIndex -= 1;
    };
    webview.goForward = () => {
      if (!webview.canGoForward?.()) {
        return;
      }
      webview.__historyIndex += 1;
    };
    webview.reload = () => {
      const currentUrl = webview.getURL?.();
      if (currentUrl) {
        commitNavigation(webview, currentUrl, false);
      }
    };
    webview.stop = () => {};
    webview.executeJavaScript = async () => undefined as never;
    webview.printToPDF = async () => new Uint8Array();
    createdWebviews.push(webview);
    return webview;
  }) as typeof document.createElement;

  return {
    getCreatedWebviews() {
      return createdWebviews;
    },
    restore() {
      document.createElement = previousCreateElement;
    },
  };
}

function createElectronApi(overrides: Partial<ElectronAPI>): ElectronAPI {
  return {
    invoke: (async () => {
      throw new Error('Unexpected invoke in web content contribution test.');
    }) as ElectronAPI['invoke'],
    ...overrides,
  };
}

async function withElectronApi<T>(
  electronAPI: ElectronAPI | undefined,
  run: () => T | Promise<T>,
): Promise<T> {
  const testWindow = window as typeof window & {
    electronAPI?: ElectronAPI;
  };
  const previousElectronApi = testWindow.electronAPI;
  testWindow.electronAPI = electronAPI;

  try {
    return await run();
  } finally {
    testWindow.electronAPI = previousElectronApi;
  }
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createWorkbenchWebContentViewContribution } = await import(
    'ls/workbench/contrib/webContentView/webContentView.contribution'
  ));
  ({ registerWorkbenchPartDomNode, WORKBENCH_PART_IDS } = await import(
    'ls/workbench/browser/layout'
  ));
  ({
    resetWorkbenchBrowserTabKeepAliveLimit,
    setWorkbenchBrowserTabKeepAliveLimit,
  } = await import('ls/workbench/browser/webContentRetentionState'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

afterEach(() => {
  resetWorkbenchBrowserTabKeepAliveLimit();
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, null);
  document.body.replaceChildren();
});

test('web content contribution installs the renderer bridge and cleans up lifecycle handles on dispose', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const reportedStates: DesktopWebContentState[] = [];
  const bridgeResponses: WebContentBridgeResponse[] = [];
  let bridgeReadyReports = 0;
  let bridgeCommandListener: ((command: WebContentBridgeCommand) => void) | null = null;
  const host = document.createElement('div');
  const activeObserversBeforeCreate = resizeObserverSpy.getActiveObservers();

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(12, 24, 320, 180),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          reportState(state: DesktopWebContentState) {
            reportedStates.push(state);
          },
          onBridgeCommand(listener: (command: WebContentBridgeCommand) => void) {
            bridgeCommandListener = listener;
            return () => {
              if (bridgeCommandListener === listener) {
                bridgeCommandListener = null;
              }
            };
          },
          respondToBridgeCommand(response: WebContentBridgeResponse) {
            bridgeResponses.push(response);
          },
          reportBridgeReady() {
            bridgeReadyReports += 1;
          },
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);

        animationFrameSpy.flushUntilIdle();
        assert.equal(
          resizeObserverSpy.getActiveObservers(),
          activeObserversBeforeCreate + 1,
        );
        assert.equal(bridgeReadyReports, 1);
        assert(bridgeCommandListener);

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            activateTarget: (targetId?: string | null) => Promise<DesktopWebContentState>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.activateTarget('target-1');
        bridgeCommandListener({
          requestId: 'bridge-request-1',
          method: 'activateTarget',
          args: ['target-2'],
        });
        await waitForCondition(() =>
          bridgeResponses.some((response) => response.requestId === 'bridge-request-1'),
        );

        const webContentRoot = document.getElementById('ls-webcontent-root');
        assert.equal(webContentRoot?.querySelector('webview')?.tagName, 'WEBVIEW');
        assert.equal(reportedStates.at(-1)?.targetId, 'target-2');
        assert.equal(reportedStates.at(-1)?.activeTargetId, 'target-2');
        assert.equal(reportedStates.at(-1)?.ownership, 'active');
        assert.equal(reportedStates.at(-1)?.visible, true);
        assert.deepEqual(bridgeResponses.at(-1), {
          requestId: 'bridge-request-1',
          ok: true,
          result: reportedStates.at(-1),
        } satisfies WebContentBridgeResponse);

        const canceledHandlesBeforeDispose =
          animationFrameSpy.getCanceledHandles().length;
        contribution.dispose();

        assert.equal(
          (window as typeof window & { __lsWebContentBridge?: unknown }).__lsWebContentBridge,
          undefined,
        );
        assert.equal(host.childElementCount, 0);
        assert.equal(document.getElementById('ls-webcontent-root'), null);
        assert.equal(
          resizeObserverSpy.getActiveObservers(),
          activeObserversBeforeCreate,
        );
        assert.equal(animationFrameSpy.getPendingHandleCount(), 0);
        assert.equal(
          animationFrameSpy.getCanceledHandles().length,
          canceledHandlesBeforeDispose,
        );
        assert.equal(bridgeCommandListener, null);
      },
    );
  } finally {
    animationFrameSpy.restore();
    resizeObserverSpy.restore();
  }
});

test('web content contribution enables plugins on managed webviews for PDF display', async () => {
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 320, 180),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            throw new Error('Unexpected native navigation in webview plugin test.');
          },
          reportBridgeReady() {},
          reportState() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            navigateTo: (url: string, targetId?: string | null) => Promise<unknown>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.navigateTo('file:///tmp/test.pdf', 'pdf-tab');
        animationFrameSpy.flushUntilIdle();

        const [webview] = webviewSpy.getCreatedWebviews();
        assert(webview);
        assert.equal(webview.getAttribute('plugins'), 'true');

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});

test('web content contribution uses src for the first navigation before webview dom-ready', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          onBridgeCommand() {
            return () => {};
          },
          respondToBridgeCommand() {},
          reportBridgeReady() {},
          reportState() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        const firstState = await bridge.navigateTo(
          'https://example.com/first',
          'target-1',
          'browser',
        );
        const testWebview = webviewSpy.getCreatedWebviews()[0];
        assert(testWebview);
        assert.deepEqual(testWebview.__loadURLCalls, []);
        assert.equal(firstState.url, 'https://example.com/first');

        const secondState = await bridge.navigateTo(
          'https://example.com/second',
          'target-1',
          'browser',
        );
        assert.deepEqual(testWebview.__loadURLCalls, ['https://example.com/second']);
        assert.equal(secondState.url, 'https://example.com/second');

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    animationFrameSpy.restore();
    resizeObserverSpy.restore();
  }
});

test('web content contribution still uses src when a recreated webview is dom-ready but blank', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          onBridgeCommand() {
            return () => {};
          },
          respondToBridgeCommand() {},
          reportBridgeReady() {},
          reportState() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            activateTarget: (targetId?: string | null) => Promise<DesktopWebContentState>;
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.activateTarget('target-1');
        const testWebview = webviewSpy.getCreatedWebviews()[0];
        assert(testWebview);
        testWebview.setAttribute('src', 'about:blank');
        testWebview.dispatchEvent(new Event('dom-ready'));
        assert.equal(testWebview.getURL?.(), 'about:blank');

        const restoredState = await bridge.navigateTo(
          'https://example.com/restored',
          'target-1',
          'browser',
        );

        assert.deepEqual(testWebview.__loadURLCalls, []);
        assert.equal(
          testWebview.getAttribute('src'),
          'https://example.com/restored',
        );
        assert.equal(restoredState.url, 'https://example.com/restored');

        contribution.dispose();
      },
    );
  } finally {
    resizeObserverSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});

test('web content contribution keeps released targets warm for quick reactivation', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          onBridgeCommand() {
            return () => {};
          },
          respondToBridgeCommand() {},
          reportBridgeReady() {},
          reportState() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            activateTarget: (targetId?: string | null) => Promise<DesktopWebContentState>;
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
            releaseTarget: (targetId?: string | null) => Promise<void>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.navigateTo(
          'https://example.com/warm',
          'target-warm',
          'browser',
        );
        const [webview] = webviewSpy.getCreatedWebviews();
        assert(webview);
        assert.equal(webview.isConnected, true);

        await bridge.releaseTarget('target-warm');
        assert.equal(webview.isConnected, true);

        const state = await bridge.activateTarget('target-warm');
        assert.equal(state.url, 'https://example.com/warm');
        assert.equal(webviewSpy.getCreatedWebviews().length, 1);

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    resizeObserverSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});

test('web content contribution evicts retained targets by LRU and disposeTarget tears down immediately', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          onBridgeCommand() {
            return () => {};
          },
          respondToBridgeCommand() {},
          reportBridgeReady() {},
          reportState() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            disposeTarget: (targetId?: string | null) => Promise<void>;
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
            releaseTarget: (targetId?: string | null) => Promise<void>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.navigateTo('https://example.com/one', 'target-1', 'browser');
        await bridge.navigateTo('https://example.com/two', 'target-2', 'browser');
        await bridge.navigateTo('https://example.com/three', 'target-3', 'browser');

        const [first, second, third] = webviewSpy.getCreatedWebviews();
        assert(first && second && third);
        await bridge.releaseTarget('target-1');
        await bridge.releaseTarget('target-2');
        await bridge.releaseTarget('target-3');

        assert.equal(first.isConnected, false);
        assert.equal(second.isConnected, true);
        assert.equal(third.isConnected, true);

        await bridge.disposeTarget('target-2');
        assert.equal(second.isConnected, false);

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    resizeObserverSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});

test('web content contribution applies the configured browser tab keep-alive limit', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          onBridgeCommand() {
            return () => {};
          },
          respondToBridgeCommand() {},
          reportBridgeReady() {},
          reportState() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();
        setWorkbenchBrowserTabKeepAliveLimit(1);

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
            releaseTarget: (targetId?: string | null) => Promise<void>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.navigateTo('https://example.com/one', 'target-1', 'browser');
        await bridge.navigateTo('https://example.com/two', 'target-2', 'browser');
        await bridge.navigateTo('https://example.com/three', 'target-3', 'browser');

        const [first, second, third] = webviewSpy.getCreatedWebviews();
        assert(first && second && third);
        await bridge.releaseTarget('target-1');
        await bridge.releaseTarget('target-2');
        await bridge.releaseTarget('target-3');

        assert.equal(first.isConnected, false);
        assert.equal(second.isConnected, false);
        assert.equal(third.isConnected, true);

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    resizeObserverSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});

test('web content contribution reports favicon url from page-favicon-updated', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const reportedStates: DesktopWebContentState[] = [];
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          reportState(state: DesktopWebContentState) {
            reportedStates.push(state);
          },
          reportBridgeReady() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            activateTarget: (targetId?: string | null) => Promise<DesktopWebContentState>;
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.activateTarget('target-favicon');
        await bridge.navigateTo(
          'https://example.com/with-favicon',
          'target-favicon',
          'browser',
        );

        const [webview] = webviewSpy.getCreatedWebviews();
        assert(webview);
        webview.dispatchEvent(
          Object.assign(new Event('page-favicon-updated'), {
            favicons: ['https://example.com/favicon.ico'],
          }),
        );

        await waitForCondition(
          () =>
            reportedStates.at(-1)?.faviconUrl ===
            'https://example.com/favicon.ico',
        );
        assert.equal(
          reportedStates.at(-1)?.faviconUrl,
          'https://example.com/favicon.ico',
        );

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    resizeObserverSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});

test('web content contribution reports page title from page-title-updated', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const reportedStates: DesktopWebContentState[] = [];
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          reportState(state: DesktopWebContentState) {
            reportedStates.push(state);
          },
          reportBridgeReady() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            activateTarget: (targetId?: string | null) => Promise<DesktopWebContentState>;
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.activateTarget('target-title');
        await bridge.navigateTo(
          'https://example.com/with-title',
          'target-title',
          'browser',
        );

        const [webview] = webviewSpy.getCreatedWebviews();
        assert(webview);
        webview.dispatchEvent(
          Object.assign(new Event('page-title-updated'), {
            title: 'AI / LLM Models',
          }),
        );

        await waitForCondition(
          () => reportedStates.at(-1)?.pageTitle === 'AI / LLM Models',
        );
        assert.equal(reportedStates.at(-1)?.pageTitle, 'AI / LLM Models');

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    resizeObserverSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});

test('web content contribution ignores stale page-title updates after navigation', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const animationFrameSpy = installAnimationFrameSpy();
  const webviewSpy = installWebviewSpy();
  const reportedStates: DesktopWebContentState[] = [];
  const host = document.createElement('div');

  host.dataset.webcontentActive = 'true';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(0, 0, 480, 320),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);

  try {
    await withElectronApi(
      createElectronApi({
        webContent: {
          async navigate() {
            return {
              targetId: null,
              activeTargetId: null,
              ownership: 'inactive',
              layoutPhase: 'hidden',
              url: '',
              canGoBack: false,
              canGoForward: false,
              isLoading: false,
              visible: false,
            } satisfies DesktopWebContentState;
          },
          reportState(state: DesktopWebContentState) {
            reportedStates.push(state);
          },
          reportBridgeReady() {},
        } as unknown as NonNullable<ElectronAPI['webContent']>,
      }),
      async () => {
        const contribution = createWorkbenchWebContentViewContribution();
        assert(contribution);
        animationFrameSpy.flushUntilIdle();

        const bridge = (window as typeof window & {
          __lsWebContentBridge?: {
            activateTarget: (targetId?: string | null) => Promise<DesktopWebContentState>;
            navigateTo: (
              url: string,
              targetId?: string | null,
              mode?: 'browser' | 'strict',
            ) => Promise<DesktopWebContentState>;
          };
        }).__lsWebContentBridge;
        assert(bridge);

        await bridge.activateTarget('target-title-stale');
        await bridge.navigateTo(
          'https://example.com/first',
          'target-title-stale',
          'browser',
        );

        const [webview] = webviewSpy.getCreatedWebviews();
        assert(webview);
        webview.dispatchEvent(
          Object.assign(new Event('page-title-updated'), {
            title: 'First Title',
          }),
        );
        await waitForCondition(
          () => reportedStates.at(-1)?.pageTitle === 'First Title',
        );

        await bridge.navigateTo(
          'https://example.com/second',
          'target-title-stale',
          'browser',
        );
        webview.__title = 'Second Title';
        webview.dispatchEvent(
          Object.assign(new Event('page-title-updated'), {
            title: 'First Title',
          }),
        );

        await waitForCondition(
          () =>
            reportedStates.at(-1)?.url === 'https://example.com/second' &&
            reportedStates.at(-1)?.pageTitle === 'Second Title',
        );
        assert.equal(reportedStates.at(-1)?.pageTitle, 'Second Title');

        contribution.dispose();
      },
    );
  } finally {
    webviewSpy.restore();
    resizeObserverSpy.restore();
    animationFrameSpy.restore();
    host.remove();
  }
});
