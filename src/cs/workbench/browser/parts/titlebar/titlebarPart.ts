import {
  getWorkbenchShellClassName,
  registerWorkbenchPartDomNode,
  WORKBENCH_PART_IDS,
} from 'cs/workbench/browser/layout';
import { getWindowChromeLayout } from 'cs/platform/window/common/window';
import { $, append, prepend } from 'cs/base/browser/dom';
import { createActionBarView, type ActionBarItem } from 'cs/base/browser/ui/actionbar/actionbar';
import { createDropdownMenuActionViewItem } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import { isMacintosh, isWeb } from 'cs/base/common/platform';
import 'cs/workbench/browser/parts/titlebar/media/titlebarpart.css';

export type TitlebarPartPage = 'content' | 'settings';

export type TitlebarLeadingActionsProps = {
  menuLabel?: string;
  isPrimarySidebarVisible?: boolean;
  primarySidebarToggleLabel?: string;
  addressBarLabel?: string;
  onTogglePrimarySidebar?: () => void;
  onFocusAddressBar?: () => void;
};

export type TitlebarPartSyncParams = {
  electronRuntime: boolean;
  useMica: boolean;
  statusbarVisible: boolean;
  activePage: TitlebarPartPage;
  leadingActions: TitlebarLeadingActionsProps;
};

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export function resolveWorkbenchStatusbarVisibility(statusbarVisible: boolean) {
  return statusbarVisible;
}

function shouldRenderTitlebarMenuAction() {
  return !isMacintosh || isWeb;
}

export class TitlebarPart {
  private readonly titlebarElement = $<HTMLElementTagNameMap['section']>('section.comet-titlebar');
  private readonly titlebarContainerElement = append(
    this.titlebarElement,
    $<HTMLElementTagNameMap['div']>('div.comet-titlebar-container'),
  );
  private readonly leftElement = append(
    this.titlebarContainerElement,
    $<HTMLElementTagNameMap['div']>('div.comet-titlebar-left'),
  );
  private readonly leadingActionsHostElement = $<HTMLElementTagNameMap['div']>('div.comet-titlebar-leading-actions-host');
  private readonly leadingActionBarView = createActionBarView({
    className: 'comet-titlebar-leading-actions',
    ariaRole: 'group',
  });

  constructor(
    private readonly containerElement: HTMLElement,
    private readonly shellElement: HTMLElement,
    private readonly statusbarElement: HTMLElement,
  ) {
    prepend(
      this.titlebarContainerElement,
      $<HTMLElementTagNameMap['div']>('div.comet-titlebar-drag-region'),
    );
    append(this.leadingActionsHostElement, this.leadingActionBarView.getElement());
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
    const hasLeadingWindowControls =
      electronRuntime && WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx > 0;

    this.containerElement.className = [
      'comet-app-window',
      'comet-has-titlebar',
      electronRuntime && useMica ? 'comet-is-mica-enabled' : '',
      isStatusbarVisible ? 'comet-has-statusbar' : '',
      hasNativeWindowControlsOverlay ? 'comet-has-native-window-controls-overlay' : '',
      hasLeadingWindowControls ? 'comet-has-leading-window-controls' : '',
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
    if (hasLeadingWindowControls) {
      this.containerElement.style.setProperty(
        '--workbench-leading-window-controls-width',
        `${WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx}px`,
      );
    } else {
      this.containerElement.style.removeProperty(
        '--workbench-leading-window-controls-width',
      );
    }
    this.shellElement.className = getWorkbenchShellClassName({ activePage });
    this.syncTitlebar(params);
    this.syncStatusbarVisibility(isStatusbarVisible);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, this.titlebarElement);
  }

  dispose() {
    this.leftElement.replaceChildren();
    this.leadingActionBarView.dispose();
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.titlebar, null);
    registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.statusbar, null);
  }

  private syncTitlebar(params: TitlebarPartSyncParams) {
    this.syncLeadingActions(params.leadingActions);

    this.titlebarContainerElement.classList.remove('comet-has-center');
    this.leftElement.hidden = !this.leadingActionsHostElement.isConnected;
  }

  private syncLeadingActions(props: TitlebarLeadingActionsProps) {
    const headerItems = this.createLeadingActionItems(props);
    this.leadingActionBarView.setProps({
      className: 'comet-titlebar-leading-actions',
      ariaRole: 'group',
      items: headerItems,
    });

    if (headerItems.length > 0) {
      if (
        this.leftElement.firstElementChild !== this.leadingActionsHostElement ||
        this.leftElement.childNodes.length !== 1
      ) {
        this.leftElement.replaceChildren(this.leadingActionsHostElement);
      }
    } else if (this.leftElement.childNodes.length > 0) {
      this.leftElement.replaceChildren();
    }
  }

  private createLeadingActionItems(props: TitlebarLeadingActionsProps) {
    const headerItems: ActionBarItem[] = [];
    if (shouldRenderTitlebarMenuAction() && props.menuLabel) {
      headerItems.push(createDropdownMenuActionViewItem({
        label: props.menuLabel,
        title: props.menuLabel,
        mode: 'icon',
        buttonClassName: 'comet-titlebar-menu-btn',
        content: createLxIcon('three-bars'),
        renderOverlay: () => this.createEmptyMenuElement(),
        overlayRole: 'menu',
        menuClassName: 'comet-titlebar-main-menu-overlay',
        menuData: 'titlebar-main-menu',
        minWidth: 180,
        overlayAlignmentPolicy: 'prefer-start',
      }));
    }
    if (props.onTogglePrimarySidebar && props.primarySidebarToggleLabel) {
      headerItems.push({
        label: props.primarySidebarToggleLabel,
        title: props.primarySidebarToggleLabel,
        mode: 'icon',
        buttonClassName: 'comet-titlebar-primary-sidebar-toggle-btn',
        content: createLxIcon(
          props.isPrimarySidebarVisible === false
            ? 'layout-sidebar-left-off'
            : 'layout-sidebar-left',
        ),
        onClick: () => props.onTogglePrimarySidebar?.(),
      });
    }
    if (props.addressBarLabel) {
      headerItems.push({
        label: props.addressBarLabel,
        title: props.addressBarLabel,
        mode: 'icon',
        buttonClassName: 'comet-titlebar-address-bar-btn',
        content: createLxIcon('search'),
        onClick: () => props.onFocusAddressBar?.(),
      });
    }

    return headerItems;
  }

  private createEmptyMenuElement() {
    const element = $<HTMLElementTagNameMap['div']>('div.comet-titlebar-main-menu');
    element.setAttribute('role', 'menu');
    return element;
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
