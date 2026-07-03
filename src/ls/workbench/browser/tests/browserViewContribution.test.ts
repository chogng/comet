/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Literature Studio. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
  WebContentBounds,
  WebContentLayoutPhase,
  WebContentState,
} from 'ls/platform/browserView/common/browserView';
import type { ElectronAPI } from 'ls/base/parts/sandbox/common/electronTypes';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createWorkbenchBrowserViewContribution: typeof import('ls/workbench/contrib/browserView/electron-browser/browserView.contribution').createWorkbenchBrowserViewContribution;
let registerWorkbenchPartDomNode: typeof import('ls/workbench/browser/layout').registerWorkbenchPartDomNode;
let WORKBENCH_PART_IDS: typeof import('ls/workbench/browser/layout').WORKBENCH_PART_IDS;
let resetWorkbenchBrowserTabKeepAliveLimit: typeof import('ls/workbench/browser/webContentRetentionState').resetWorkbenchBrowserTabKeepAliveLimit;
let setWorkbenchBrowserTabKeepAliveLimit: typeof import('ls/workbench/browser/webContentRetentionState').setWorkbenchBrowserTabKeepAliveLimit;

type SurfaceState = {
  bounds: WebContentBounds | null;
  visible: boolean;
  phase: WebContentLayoutPhase;
};

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

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const handle = nextHandle;
    nextHandle += 1;
    callbacks.set(handle, callback);
    return handle;
  }) as typeof window.requestAnimationFrame;

  window.cancelAnimationFrame = ((handle: number) => {
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

function createDefaultWebContentState(): WebContentState {
  return {
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
  };
}

function installWebContentApiSpy() {
  const retentionLimits: number[] = [];
  const surfaceStates: SurfaceState[] = [];
  let currentBounds: WebContentBounds | null = null;
  let currentVisible = false;

  const webContent: NonNullable<ElectronAPI['webContent']> = {
    activate() {},
    dispose() {},
    release() {},
    async navigate() {
      return createDefaultWebContentState();
    },
    async getState() {
      return createDefaultWebContentState();
    },
    setBounds(bounds) {
      currentBounds = bounds;
    },
    setVisible(visible) {
      currentVisible = visible;
    },
    setLayoutPhase(phase) {
      surfaceStates.push({
        bounds: currentBounds,
        visible: currentVisible,
        phase,
      });
    },
    setRetentionLimit(limit) {
      retentionLimits.push(limit);
    },
    clearHistory() {},
    hardReload() {},
    reload() {},
    goBack() {},
    goForward() {},
    async getSelection() {
      return null;
    },
    onStateChange() {
      return () => {};
    },
  };

  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    writable: true,
    value: {
      async invoke() {
        return undefined;
      },
      webContent,
    } satisfies ElectronAPI,
  });

  return {
    retentionLimits,
    surfaceStates,
  };
}

function createHost(bounds: WebContentBounds, active = true) {
  const host = document.createElement('div');
  host.dataset.webcontentActive = active ? 'true' : 'false';
  Object.defineProperty(host, 'getBoundingClientRect', {
    configurable: true,
    value: () => createDomRect(bounds.x, bounds.y, bounds.width, bounds.height),
  });
  document.body.append(host);
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, host);
  return host;
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({
    createWorkbenchBrowserViewContribution,
  } = await import('ls/workbench/contrib/browserView/electron-browser/browserView.contribution'));
  ({
    registerWorkbenchPartDomNode,
    WORKBENCH_PART_IDS,
  } = await import('ls/workbench/browser/layout'));
  ({
    resetWorkbenchBrowserTabKeepAliveLimit,
    setWorkbenchBrowserTabKeepAliveLimit,
  } = await import('ls/workbench/browser/webContentRetentionState'));
});

afterEach(() => {
  registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.webContentViewHost, null);
  resetWorkbenchBrowserTabKeepAliveLimit();
  Reflect.deleteProperty(window, 'electronAPI');
  document.body.replaceChildren();
});

after(() => {
  cleanupDomEnvironment?.();
});

test('browser view contribution sends stable BrowserView bounds after measuring', () => {
  const resizeObserver = installResizeObserverSpy();
  const animationFrame = installAnimationFrameSpy();
  const api = installWebContentApiSpy();
  createHost({ x: 10, y: 20, width: 300, height: 200 });

  try {
    const contribution = createWorkbenchBrowserViewContribution();
    assert(contribution);

    animationFrame.flushAll();
    assert.deepEqual(api.surfaceStates.at(-1), {
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      visible: true,
      phase: 'measuring',
    });

    animationFrame.flushAll();
    assert.deepEqual(api.surfaceStates.at(-1), {
      bounds: { x: 10, y: 20, width: 300, height: 200 },
      visible: true,
      phase: 'visible',
    });
    assert.equal(resizeObserver.getActiveObservers(), 1);

    contribution.dispose();
    assert.deepEqual(api.surfaceStates.at(-1), {
      bounds: null,
      visible: false,
      phase: 'hidden',
    });
    assert.equal(resizeObserver.getActiveObservers(), 0);
  } finally {
    animationFrame.restore();
    resizeObserver.restore();
  }
});

test('browser view contribution hides BrowserView when host is inactive', () => {
  const resizeObserver = installResizeObserverSpy();
  const animationFrame = installAnimationFrameSpy();
  const api = installWebContentApiSpy();
  createHost({ x: 8, y: 12, width: 240, height: 180 }, false);

  try {
    const contribution = createWorkbenchBrowserViewContribution();
    assert(contribution);

    animationFrame.flushUntilIdle();
    assert.deepEqual(api.surfaceStates.at(-1), {
      bounds: null,
      visible: false,
      phase: 'hidden',
    });

    contribution.dispose();
  } finally {
    animationFrame.restore();
    resizeObserver.restore();
  }
});

test('browser view contribution forwards retention limit changes', () => {
  const resizeObserver = installResizeObserverSpy();
  const animationFrame = installAnimationFrameSpy();
  const api = installWebContentApiSpy();
  createHost({ x: 0, y: 0, width: 100, height: 100 });

  try {
    const contribution = createWorkbenchBrowserViewContribution();
    assert(contribution);

    assert.deepEqual(api.retentionLimits, [2]);
    setWorkbenchBrowserTabKeepAliveLimit(1);
    assert.deepEqual(api.retentionLimits, [2, 1]);

    contribution.dispose();
  } finally {
    animationFrame.restore();
    resizeObserver.restore();
  }
});

test('browser view contribution does not create renderer webview elements', () => {
  const resizeObserver = installResizeObserverSpy();
  const animationFrame = installAnimationFrameSpy();
  const previousCreateElement = document.createElement.bind(document);
  let createdWebviewCount = 0;
  document.createElement = ((tagName: string, options?: ElementCreationOptions) => {
    if (tagName.toLowerCase() === 'webview') {
      createdWebviewCount += 1;
    }
    return previousCreateElement(tagName, options);
  }) as typeof document.createElement;

  installWebContentApiSpy();
  createHost({ x: 0, y: 0, width: 100, height: 100 });

  try {
    const contribution = createWorkbenchBrowserViewContribution();
    assert(contribution);
    animationFrame.flushUntilIdle();
    assert.equal(createdWebviewCount, 0);
    contribution.dispose();
  } finally {
    document.createElement = previousCreateElement;
    animationFrame.restore();
    resizeObserver.restore();
  }
});
