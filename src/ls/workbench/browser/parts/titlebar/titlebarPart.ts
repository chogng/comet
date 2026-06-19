import {
  getWorkbenchShellClassName,
  registerWorkbenchPartDomNode,
  WORKBENCH_PART_IDS,
} from 'ls/workbench/browser/layout';
import { getWindowChromeLayout } from 'ls/platform/window/common/window';

export type TitlebarPartPage = 'content' | 'settings';

export type TitlebarPartSyncParams = {
  electronRuntime: boolean;
  useMica: boolean;
  statusbarVisible: boolean;
  activePage: TitlebarPartPage;
};

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export function resolveWorkbenchStatusbarVisibility(statusbarVisible: boolean) {
  return statusbarVisible;
}

export class TitlebarPart {
  constructor(
    private readonly containerElement: HTMLElement,
    private readonly shellElement: HTMLElement,
    private readonly statusbarElement: HTMLElement,
  ) {}

  sync(params: TitlebarPartSyncParams) {
    const { electronRuntime, useMica, statusbarVisible, activePage } = params;
    const isStatusbarVisible =
      resolveWorkbenchStatusbarVisibility(statusbarVisible);
    const hasNativeWindowControlsOverlay =
      electronRuntime && WINDOW_CHROME_LAYOUT.nativeWindowControlsOverlay;

    this.containerElement.className = [
      'app-window',
      electronRuntime && useMica ? 'is-mica-enabled' : '',
      isStatusbarVisible ? 'has-statusbar' : '',
      hasNativeWindowControlsOverlay ? 'has-native-window-controls-overlay' : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (hasNativeWindowControlsOverlay) {
      this.containerElement.style.setProperty(
        '--workbench-window-controls-width',
        `${WINDOW_CHROME_LAYOUT.trailingWindowControlsWidthPx}px`,
      );
    } else {
      this.containerElement.style.removeProperty(
        '--workbench-window-controls-width',
      );
    }
    this.shellElement.className = getWorkbenchShellClassName({ activePage });
    this.syncStatusbarVisibility(isStatusbarVisible);
  }

  dispose() {
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
  }

  private syncStatusbarVisibility(statusbarVisible: boolean) {
    if (statusbarVisible) {
      if (!this.statusbarElement.isConnected) {
        this.containerElement.append(this.statusbarElement);
      }
      registerWorkbenchPartDomNode(
        WORKBENCH_PART_IDS.statusbar,
        this.statusbarElement,
      );
      return;
    }

    if (this.statusbarElement.parentElement === this.containerElement) {
      this.containerElement.removeChild(this.statusbarElement);
    }
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
  }
}

export function createTitlebarPart(
  containerElement: HTMLElement,
  shellElement: HTMLElement,
  statusbarElement: HTMLElement,
) {
  return new TitlebarPart(
    containerElement,
    shellElement,
    statusbarElement,
  );
}
