import type {
  WindowControlAction,
  WindowState,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import type {
  WindowStateListener,
} from 'ls/base/parts/sandbox/common/electronTypes';
import { EventEmitter } from 'ls/base/common/event';
import { combinedDisposable, toDisposable } from 'ls/base/common/lifecycle';

export type WorkbenchWindowControlAction = 'minimize' | 'toggle-maximize' | 'close';

type WindowStateSnapshot = {
  isMaximized: boolean;
  isFullscreen: boolean;
};

type WorkbenchWindowControlsProvider = {
  getState: () => Promise<WindowState>;
  onStateChange: (listener: WindowStateListener) => () => void;
  perform: (action: WindowControlAction) => void;
};

const DEFAULT_WINDOW_STATE: WindowStateSnapshot = {
  isMaximized: false,
  isFullscreen: false,
};

let workbenchWindowControlsProvider: WorkbenchWindowControlsProvider | null = null;

let windowStateSnapshot = DEFAULT_WINDOW_STATE;
const onDidChangeWindowStateEmitter = new EventEmitter<void>();

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

function setWindowState(nextState: WindowStateSnapshot) {
  if (
    windowStateSnapshot.isMaximized === nextState.isMaximized &&
    windowStateSnapshot.isFullscreen === nextState.isFullscreen
  ) {
    return;
  }

  windowStateSnapshot = nextState;
  onDidChangeWindowStateEmitter.fire();
}

export function registerWorkbenchWindowControlsProvider(
  provider: WorkbenchWindowControlsProvider,
) {
  workbenchWindowControlsProvider = provider;
}

export function getWorkbenchWindowControlsProvider() {
  return workbenchWindowControlsProvider;
}

export function hasWorkbenchWindowControlsProvider() {
  return Boolean(workbenchWindowControlsProvider);
}

export function subscribeWindowState(listener: () => void) {
  return onDidChangeWindowStateEmitter.event(listener);
}

export function getWindowStateSnapshot() {
  return windowStateSnapshot;
}

function normalizeWindowState(state: Partial<WindowStateSnapshot> | null | undefined) {
  return {
    isMaximized: Boolean(state?.isMaximized),
    isFullscreen: Boolean(state?.isFullscreen),
  } satisfies WindowStateSnapshot;
}

function getNavigatorPlatform() {
  if (typeof navigator === 'undefined') {
    return '';
  }

  return String(navigator.platform ?? '').toLowerCase();
}

function detectBrowserFullscreen() {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return false;
  }

  const fullscreenDocument = document as Document & {
    webkitFullscreenElement?: Element | null;
    webkitIsFullScreen?: boolean;
  };

  if (
    fullscreenDocument.fullscreenElement ||
    fullscreenDocument.webkitFullscreenElement ||
    fullscreenDocument.webkitIsFullScreen
  ) {
    return true;
  }

  if (typeof screen === 'undefined') {
    return false;
  }

  if (window.innerHeight === screen.height) {
    return true;
  }

  const navigatorPlatform = getNavigatorPlatform();
  const isMac = navigatorPlatform.includes('mac');

  return (
    isMac &&
    window.outerHeight === screen.height &&
    window.outerWidth === screen.width
  );
}

export function connectWorkbenchWindowControls(electronRuntime: boolean) {
  const controls = electronRuntime ? getWorkbenchWindowControlsProvider() : null;
  if (!controls) {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      setWindowState(DEFAULT_WINDOW_STATE);
      return () => {};
    }

    const syncBrowserWindowState = () => {
      setWindowState({
        ...DEFAULT_WINDOW_STATE,
        isFullscreen: detectBrowserFullscreen(),
      });
    };

    syncBrowserWindowState();
    const listeners = combinedDisposable(
      addDisposableListener(document, 'fullscreenchange', syncBrowserWindowState),
      addDisposableListener(document, 'webkitfullscreenchange', syncBrowserWindowState),
      addDisposableListener(window, 'resize', syncBrowserWindowState),
    );

    return () => {
      listeners.dispose();
      setWindowState(DEFAULT_WINDOW_STATE);
    };
  }

  let mounted = true;

  void controls
    .getState()
    .then((state) => {
      if (mounted) {
        setWindowState(normalizeWindowState(state));
      }
    })
    .catch(() => {
      if (mounted) {
        setWindowState(DEFAULT_WINDOW_STATE);
      }
    });

  const unsubscribe = controls.onStateChange((state) => {
    setWindowState(normalizeWindowState(state));
  });

  return () => {
    mounted = false;
    unsubscribe();
    setWindowState(DEFAULT_WINDOW_STATE);
  };
}

export function performWorkbenchWindowControl(action: WorkbenchWindowControlAction) {
  getWorkbenchWindowControlsProvider()?.perform(action);
}
