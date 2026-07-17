import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';
import {
  connectWorkbenchWindowControls,
  getWindowStateSnapshot,
  registerWorkbenchWindowControlsProvider,
  subscribeWindowState,
} from 'cs/workbench/browser/window';

let cleanupDomEnvironment: (() => void) | null = null;

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('window state tracks browser and desktop fullscreen changes', async () => {
  const originalFullscreenDescriptor = Object.getOwnPropertyDescriptor(
    document,
    'fullscreenElement',
  );
  let fullscreenElement: Element | null = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get() {
      return fullscreenElement;
    },
  });

  const browserFullscreenStates: boolean[] = [];
  const disposeBrowserListener = subscribeWindowState(() => {
    browserFullscreenStates.push(getWindowStateSnapshot().isFullscreen);
  });
  const disposeBrowserControls = connectWorkbenchWindowControls(false);

  try {
    assert.equal(getWindowStateSnapshot().isFullscreen, false);

    fullscreenElement = document.body;
    document.dispatchEvent(new Event('fullscreenchange'));
    assert.equal(getWindowStateSnapshot().isFullscreen, true);

    fullscreenElement = null;
    document.dispatchEvent(new Event('fullscreenchange'));
    assert.equal(getWindowStateSnapshot().isFullscreen, false);

    assert.deepEqual(browserFullscreenStates, [true, false]);
  } finally {
    disposeBrowserListener();
    disposeBrowserControls();
    if (originalFullscreenDescriptor) {
      Object.defineProperty(document, 'fullscreenElement', originalFullscreenDescriptor);
    } else {
      Object.defineProperty(document, 'fullscreenElement', {
        configurable: true,
        get() {
          return null;
        },
      });
    }
  }

  let emitDesktopState: (isFullscreen: boolean) => void = (_isFullscreen: boolean) => {
    throw new Error('Expected desktop window state listener to be registered.');
  };
  registerWorkbenchWindowControlsProvider({
    getState: async () => ({
      isMaximized: true,
      isFullscreen: true,
    }),
    onStateChange: (listener) => {
      emitDesktopState = (isFullscreen) => {
        listener({
          isMaximized: true,
          isFullscreen,
        });
      };

      return () => {
        emitDesktopState = (_isFullscreen: boolean) => {
          throw new Error('Desktop window state listener has been disposed.');
        };
      };
    },
    perform: () => {},
  });

  const desktopFullscreenStates: boolean[] = [];
  const disposeDesktopListener = subscribeWindowState(() => {
    desktopFullscreenStates.push(getWindowStateSnapshot().isFullscreen);
  });
  const disposeDesktopControls = connectWorkbenchWindowControls(true);

  try {
    await new Promise((resolve) => {
      setTimeout(resolve, 0);
    });

    assert.equal(getWindowStateSnapshot().isFullscreen, true);
    emitDesktopState(false);
    assert.equal(getWindowStateSnapshot().isFullscreen, false);

    assert.deepEqual(desktopFullscreenStates, [true, false]);
  } finally {
    disposeDesktopListener();
    disposeDesktopControls();
  }
});
