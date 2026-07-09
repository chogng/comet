import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import type {
  NativeToastLayout,
  NativeToastState,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import type {
  ElectronToastApi,
} from 'cs/base/parts/sandbox/common/electronTypes';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let ToastOverlayWindowView: typeof import('cs/workbench/browser/toastOverlayWindow').ToastOverlayWindowView;

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ ToastOverlayWindowView } = await import('cs/workbench/browser/toastOverlayWindow'));
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

function createNativeHostService(
  overrides: Partial<INativeHostService> = {},
): INativeHostService {
  return {
    _serviceBrand: undefined,
    canInvoke: () => true,
    invoke: (async () => {
      throw new Error('Unexpected invoke in toast overlay window test.');
    }) as INativeHostService['invoke'],
    ipc: undefined,
    windowControls: undefined,
    webContent: undefined,
    fetch: undefined,
    document: undefined,
    toast: undefined,
    ...overrides,
  };
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
  const nativeHostService = createNativeHostService({ toast: fakeApi.api });

  try {
    const view = new ToastOverlayWindowView(nativeHostService);
    document.body.append(view.getElement());

    try {
      fakeApi.emitState(createToastState());
      await flushMicrotasks();

      const closeButton = view.getElement().querySelector('.comet-native-toast-close');
      assert(closeButton instanceof HTMLButtonElement);
      assert(view.getElement().querySelector('.comet-actionbar .comet-native-toast-close') instanceof HTMLButtonElement);
      assert(view.getElement().querySelector('.comet-toast-icon .lx-icon') instanceof HTMLElement);

      closeButton.click();

      assert.deepEqual(fakeApi.dismissCalls, [1]);
    } finally {
      view.dispose();
    }
  } finally {
    resizeObserverSpy.restore();
    document.body.replaceChildren();
  }
});

test('toast overlay window unsubscribes from state changes and disconnects resize observers on dispose', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const deferredInitialState = createDeferred<NativeToastState>();
  const fakeApi = createFakeToastApi(() => deferredInitialState.promise);
  const nativeHostService = createNativeHostService({ toast: fakeApi.api });

  try {
    const view = new ToastOverlayWindowView(nativeHostService);
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
  } finally {
    resizeObserverSpy.restore();
    document.body.replaceChildren();
  }
});

test('toast overlay window ignores late initial state after dispose', async () => {
  const resizeObserverSpy = installResizeObserverSpy();
  const deferredState = createDeferred<NativeToastState>();
  const fakeApi = createFakeToastApi(() => deferredState.promise);
  const nativeHostService = createNativeHostService({ toast: fakeApi.api });

  try {
    const view = new ToastOverlayWindowView(nativeHostService);
    document.body.append(view.getElement());

    view.dispose();
    deferredState.resolve(createToastState());
    await flushMicrotasks();

    assert.equal(fakeApi.wasRemoved(), true);
    assert.equal(resizeObserverSpy.getActiveObservers(), 0);
    assert.equal(view.getElement().childElementCount, 0);
  } finally {
    resizeObserverSpy.restore();
    document.body.replaceChildren();
  }
});
