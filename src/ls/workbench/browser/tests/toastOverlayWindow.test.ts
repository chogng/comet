import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import type {
  NativeToastLayout,
  NativeToastState,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronAPI,
  ElectronToastApi,
} from 'ls/base/parts/sandbox/common/electronTypes';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createToastOverlayWindowView: typeof import('ls/workbench/browser/toastOverlayWindow').createToastOverlayWindowView;

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createToastOverlayWindowView } = await import('ls/workbench/browser/toastOverlayWindow'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function createToastState(overrides: Partial<NativeToastState> = {}): NativeToastState {
  return {
    items: [
      {
        id: 1,
        message: 'Saved',
        type: 'success',
      },
    ],
    ...overrides,
  };
}

function createFakeToastApi(getState: () => Promise<NativeToastState>) {
  let stateListener: ((state: NativeToastState) => void) | undefined;
  let removed = false;
  const dismissCalls: number[] = [];
  const reportedLayouts: NativeToastLayout[] = [];
  const hoveringCalls: boolean[] = [];

  const api: ElectronToastApi = {
    show() {},
    dismiss(id) {
      dismissCalls.push(id);
    },
    getState,
    onStateChange(listener) {
      stateListener = listener;
      return () => {
        removed = true;
        if (stateListener === listener) {
          stateListener = undefined;
        }
      };
    },
    reportLayout(layout) {
      reportedLayouts.push(layout);
    },
    setHovering(hovering) {
      hoveringCalls.push(hovering);
    },
  };

  return {
    api,
    dismissCalls,
    reportedLayouts,
    hoveringCalls,
    wasRemoved() {
      return removed;
    },
    emitState(state: NativeToastState) {
      if (!stateListener) {
        throw new Error('Toast state listener is unavailable.');
      }

      stateListener(state);
    },
  };
}

function createElectronApi(overrides: Partial<ElectronAPI>): ElectronAPI {
  return {
    invoke: (async () => {
      throw new Error('Unexpected invoke in toast overlay window test.');
    }) as ElectronAPI['invoke'],
    ...overrides,
  };
}

function withElectronApi<T>(electronAPI: ElectronAPI | undefined, run: () => T): T {
  const testWindow = window as typeof window & {
    electronAPI?: ElectronAPI;
  };
  const previousElectronApi = testWindow.electronAPI;

  testWindow.electronAPI = electronAPI;

  try {
    return run();
  } finally {
    testWindow.electronAPI = previousElectronApi;
  }
}

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

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

test('toast overlay window dismisses toast items through the native api', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const deferredInitialState = createDeferred<NativeToastState>();
  const fakeApi = createFakeToastApi(() => deferredInitialState.promise);

  try {
    await withElectronApi(createElectronApi({ toast: fakeApi.api }), async () => {
      const view = createToastOverlayWindowView();
      document.body.append(view.getElement());

      try {
        fakeApi.emitState(createToastState());
        await flushMicrotasks();

        const closeButton = view.getElement().querySelector('.native-toast-close');
        assert(closeButton instanceof HTMLButtonElement);

        closeButton.click();

        assert.deepEqual(fakeApi.dismissCalls, [1]);
      } finally {
        view.dispose();
      }
    });
  } finally {
    resizeObserverSpy.restore();
    document.body.replaceChildren();
  }
});

test('toast overlay window unsubscribes from state changes and disconnects resize observers on dispose', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const deferredInitialState = createDeferred<NativeToastState>();
  const fakeApi = createFakeToastApi(() => deferredInitialState.promise);

  try {
    await withElectronApi(createElectronApi({ toast: fakeApi.api }), async () => {
      const view = createToastOverlayWindowView();
      document.body.append(view.getElement());

      try {
        assert.equal(resizeObserverSpy.getActiveObservers(), 1);

        view.dispose();

        assert.equal(fakeApi.wasRemoved(), true);
        assert.equal(resizeObserverSpy.getActiveObservers(), 0);
        assert.equal(view.getElement().childElementCount, 0);
        assert.equal(fakeApi.hoveringCalls.at(-1), false);
      } finally {
        view.dispose();
      }
    });
  } finally {
    resizeObserverSpy.restore();
    document.body.replaceChildren();
  }
});

test('toast overlay window ignores late initial state after dispose', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const deferredState = createDeferred<NativeToastState>();
  const fakeApi = createFakeToastApi(() => deferredState.promise);

  try {
    await withElectronApi(createElectronApi({ toast: fakeApi.api }), async () => {
      const view = createToastOverlayWindowView();
      document.body.append(view.getElement());

      view.dispose();
      deferredState.resolve(createToastState());
      await flushMicrotasks();

      assert.equal(fakeApi.wasRemoved(), true);
      assert.equal(resizeObserverSpy.getActiveObservers(), 0);
      assert.equal(view.getElement().childElementCount, 0);
    });
  } finally {
    resizeObserverSpy.restore();
    document.body.replaceChildren();
  }
});
