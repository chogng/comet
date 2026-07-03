import {
  getWorkbenchShellClassName,
  registerWorkbenchPartDomNode,
  WORKBENCH_PART_IDS,
} from 'ls/workbench/browser/layout';
import { getWindowChromeLayout } from 'ls/platform/window/common/window';
import 'ls/workbench/browser/parts/titlebar/media/titlebarpart.css';

export type TitlebarPartPage = 'content' | 'settings';

export type TitlebarPartSyncParams = {
  electronRuntime: boolean;
  useMica: boolean;
  statusbarVisible: boolean;
  activePage: TitlebarPartPage;
  isPrimarySidebarVisible: boolean;
  isAgentSidebarVisible: boolean;
  isEditorCollapsed: boolean;
  primaryTopbarElement: HTMLElement | null;
  editorTopbarElement: HTMLElement | null;
  agentTopbarElement: HTMLElement | null;
};

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export function resolveWorkbenchStatusbarVisibility(statusbarVisible: boolean) {
  return statusbarVisible;
}

export class TitlebarPart {
  private readonly titlebarElement = document.createElement('section');
  private readonly titlebarContainerElement = document.createElement('div');
  private readonly dragRegionElement = document.createElement('div');
  private readonly leftElement = document.createElement('div');
  private readonly centerElement = document.createElement('div');
  private readonly rightElement = document.createElement('div');

  constructor(
    private readonly containerElement: HTMLElement,
    private readonly shellElement: HTMLElement,
    private readonly statusbarElement: HTMLElement,
  ) {
    this.titlebarElement.className = 'titlebar';
    this.titlebarContainerElement.className = 'titlebar-container';
    this.dragRegionElement.className = 'titlebar-drag-region';
    this.leftElement.className = 'titlebar-left';
    this.centerElement.className = 'titlebar-center';
    this.rightElement.className = 'titlebar-right';
    this.titlebarContainerElement.append(
      this.dragRegionElement,
      this.leftElement,
      this.centerElement,
      this.rightElement,
    );
    this.titlebarElement.append(this.titlebarContainerElement);
  }

  getElement() {
    return this.titlebarElement;
  }

  sync(params: TitlebarPartSyncParams) {
    const { electronRuntime, useMica, statusbarVisible, activePage } = params;
    const isStatusbarVisible =
      resolveWorkbenchStatusbarVisibility(statusbarVisible);
    const hasNativeWindowControlsOverlay =
      electronRuntime && WINDOW_CHROME_LAYOUT.nativeWindowControlsOverlay;

    this.containerElement.className = [
      'app-window',
      'has-titlebar',
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
    this.syncTitlebar(params);
    this.syncStatusbarVisibility(isStatusbarVisible);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, this.titlebarElement);
  }

  dispose() {
    this.leftElement.replaceChildren();
    this.centerElement.replaceChildren();
    this.rightElement.replaceChildren();
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, null);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
  }

  private syncTitlebar(params: TitlebarPartSyncParams) {
    this.syncTitlebarSlot(
      this.leftElement,
      params.isPrimarySidebarVisible ? params.primaryTopbarElement : null,
    );
    this.syncTitlebarSlot(
      this.centerElement,
      params.isEditorCollapsed ? null : params.editorTopbarElement,
    );
    this.syncTitlebarSlot(
      this.rightElement,
      params.isAgentSidebarVisible ? params.agentTopbarElement : null,
    );

    const hasCenter = !params.isEditorCollapsed && Boolean(params.editorTopbarElement);
    this.titlebarContainerElement.classList.toggle('has-center', hasCenter);
    this.leftElement.hidden = !params.isPrimarySidebarVisible;
    this.centerElement.hidden = !hasCenter;
    this.rightElement.hidden = !params.isAgentSidebarVisible;
  }

  private syncTitlebarSlot(slotElement: HTMLElement, topbarElement: HTMLElement | null) {
    if (topbarElement) {
      if (slotElement.firstElementChild !== topbarElement || slotElement.childNodes.length !== 1) {
        slotElement.replaceChildren(topbarElement);
      }
      return;
    }

    if (slotElement.childNodes.length > 0) {
      slotElement.replaceChildren();
    }
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
