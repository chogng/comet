import { EventEmitter } from 'cs/base/common/event';
import { type CodeWindow, mainWindow } from 'cs/base/browser/window';

type TrustedTypePolicyOptions = {
  createHTML?: unknown;
  createScript?: unknown;
  createScriptURL?: unknown;
};

type TrustedTypePolicy = {
  name: string;
  createHTML?: unknown;
  createScript?: unknown;
  createScriptURL?: unknown;
};

class WindowManager {
  static readonly INSTANCE = new WindowManager();

  private readonly mapWindowIdToZoomLevel = new Map<number, number>();
  private readonly zoomLevelEmitter = new EventEmitter<number>();
  readonly onDidChangeZoomLevel = this.zoomLevelEmitter.event;

  getZoomLevel(targetWindow: Window): number {
    return this.mapWindowIdToZoomLevel.get(this.getWindowId(targetWindow)) ?? 0;
  }

  setZoomLevel(zoomLevel: number, targetWindow: Window): void {
    if (this.getZoomLevel(targetWindow) === zoomLevel) {
      return;
    }

    const targetWindowId = this.getWindowId(targetWindow);
    this.mapWindowIdToZoomLevel.set(targetWindowId, zoomLevel);
    this.zoomLevelEmitter.fire(targetWindowId);
  }

  private readonly mapWindowIdToZoomFactor = new Map<number, number>();

  getZoomFactor(targetWindow: Window): number {
    return this.mapWindowIdToZoomFactor.get(this.getWindowId(targetWindow)) ?? 1;
  }

  setZoomFactor(zoomFactor: number, targetWindow: Window): void {
    this.mapWindowIdToZoomFactor.set(this.getWindowId(targetWindow), zoomFactor);
  }

  private readonly fullscreenEmitter = new EventEmitter<number>();
  readonly onDidChangeFullscreen = this.fullscreenEmitter.event;

  private readonly mapWindowIdToFullScreen = new Map<number, boolean>();

  setFullscreen(fullscreen: boolean, targetWindow: Window): void {
    if (this.isFullscreen(targetWindow) === fullscreen) {
      return;
    }

    const windowId = this.getWindowId(targetWindow);
    this.mapWindowIdToFullScreen.set(windowId, fullscreen);
    this.fullscreenEmitter.fire(windowId);
  }

  isFullscreen(targetWindow: Window): boolean {
    return !!this.mapWindowIdToFullScreen.get(this.getWindowId(targetWindow));
  }

  private getWindowId(targetWindow: Window): number {
    return (targetWindow as CodeWindow).vscodeWindowId;
  }
}

export function addMatchMediaChangeListener(
  targetWindow: Window,
  query: string | MediaQueryList,
  callback: (this: MediaQueryList, ev: MediaQueryListEvent) => unknown,
): void {
  const mediaQueryList =
    typeof query === 'string' ? targetWindow.matchMedia(query) : query;
  mediaQueryList.addEventListener('change', callback);
}

export function setZoomLevel(zoomLevel: number, targetWindow: Window): void {
  WindowManager.INSTANCE.setZoomLevel(zoomLevel, targetWindow);
}

export function getZoomLevel(targetWindow: Window): number {
  return WindowManager.INSTANCE.getZoomLevel(targetWindow);
}

export const onDidChangeZoomLevel = WindowManager.INSTANCE.onDidChangeZoomLevel;

export function getZoomFactor(targetWindow: Window): number {
  return WindowManager.INSTANCE.getZoomFactor(targetWindow);
}

export function setZoomFactor(zoomFactor: number, targetWindow: Window): void {
  WindowManager.INSTANCE.setZoomFactor(zoomFactor, targetWindow);
}

export function setFullscreen(fullscreen: boolean, targetWindow: Window): void {
  WindowManager.INSTANCE.setFullscreen(fullscreen, targetWindow);
}

export function isFullscreen(targetWindow: Window): boolean {
  return WindowManager.INSTANCE.isFullscreen(targetWindow);
}

export const onDidChangeFullscreen = WindowManager.INSTANCE.onDidChangeFullscreen;

const userAgent = navigator.userAgent;

export const isFirefox = userAgent.includes('Firefox');
export const isWebKit = userAgent.includes('AppleWebKit');
export const isChrome = userAgent.includes('Chrome');
export const isSafari = !isChrome && userAgent.includes('Safari');
export const isWebkitWebView = !isChrome && !isSafari && isWebKit;
export const isElectron = userAgent.includes('Electron/');
export const isAndroid = userAgent.includes('Android');

let standalone = false;
if (typeof mainWindow.matchMedia === 'function') {
  const standaloneMatchMedia = mainWindow.matchMedia(
    '(display-mode: standalone) or (display-mode: window-controls-overlay)',
  );
  const fullScreenMatchMedia = mainWindow.matchMedia('(display-mode: fullscreen)');
  standalone = standaloneMatchMedia.matches;
  addMatchMediaChangeListener(mainWindow, standaloneMatchMedia, ({ matches }) => {
    if (standalone && fullScreenMatchMedia.matches) {
      return;
    }

    standalone = matches;
  });
}

export function isStandalone(): boolean {
  return standalone;
}

export function isWCOEnabled(): boolean {
  return !!(
    navigator as Navigator & {
      windowControlsOverlay?: {
        visible: boolean;
      };
    }
  ).windowControlsOverlay?.visible;
}

export function getWCOTitlebarAreaRect(targetWindow: Window): DOMRect | undefined {
  return (
    targetWindow.navigator as Navigator & {
      windowControlsOverlay?: {
        getTitlebarAreaRect: () => DOMRect;
      };
    }
  ).windowControlsOverlay?.getTitlebarAreaRect();
}

export interface IMonacoEnvironment {
  createTrustedTypesPolicy?<Options extends TrustedTypePolicyOptions>(
    policyName: string,
    policyOptions?: Options,
  ): undefined | Pick<
    TrustedTypePolicy,
    'name' | Extract<keyof Options, keyof TrustedTypePolicyOptions>
  >;

  getWorker?(moduleId: string, label: string): Worker | Promise<Worker>;

  getWorkerUrl?(moduleId: string, label: string): string;

  globalAPI?: boolean;
}

interface GlobalWithMonacoEnvironment {
  MonacoEnvironment?: IMonacoEnvironment;
}

export function getMonacoEnvironment(): IMonacoEnvironment | undefined {
  return (globalThis as GlobalWithMonacoEnvironment).MonacoEnvironment;
}
