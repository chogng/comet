// LEGACY: retained only as a compatibility implementation while titlebar code is retired.
import {
  createActionBarView,
  type ActionBarItem,
  type ActionBarMenuItem,
} from 'ls/base/browser/ui/actionbar/actionbar';
import {
  createDropdownMenuActionViewItem,
  type DropdownMenuActionOverlayContext,
} from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import { createLxIcon } from 'ls/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'ls/base/browser/ui/lxicons/lxicons';

import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicons/lxiconsSemantic';
import { getHoverService } from 'ls/base/browser/ui/hover/hover';
import { getWindowChromeLayout } from 'ls/platform/window/common/window';

import {
  requestExportTitlebarDocx,
  requestTitlebarNavigateBack,
  requestTitlebarNavigateForward,
  requestToggleTitlebarPrimarySidebar,
  requestToggleTitlebarAgentSidebar,
  requestToggleTitlebarSettings,
  subscribeTitlebarUiActions,
} from 'ls/workbench/browser/parts/titlebar/titlebarActions';
import { createWindowControlsView } from 'ls/workbench/browser/parts/titlebar/windowControls';
import type { WindowControlsAction } from 'ls/workbench/browser/parts/titlebar/windowControls';

import 'ls/workbench/browser/parts/titlebar/media/titlebar.css';

export type TitlebarAction = WindowControlsAction;

export type TitlebarLabels = {
  controlsAriaLabel: string;
  settingsLabel: string;
  minimizeLabel: string;
  maximizeLabel: string;
  restoreLabel: string;
  closeLabel: string;
  backLabel: string;
  forwardLabel: string;
  refreshLabel: string;
  showPrimarySidebarLabel: string;
  hidePrimarySidebarLabel: string;
  showAssistantLabel: string;
  hideAssistantLabel: string;
  exportDocxLabel: string;
  noExportableArticlesLabel: string;
};

export type TitlebarProps = {
  appName?: string;
  labels: TitlebarLabels;
  isWindowMaximized: boolean;
  onWindowControl: (action: TitlebarAction) => void;
  isPrimarySidebarOpen?: boolean;
  primarySidebarToggleLabel?: string;
  onTogglePrimarySidebar?: () => void;
  isAgentSidebarOpen?: boolean;
  agentSidebarToggleLabel?: string;
  onToggleAgentSidebar?: () => void;
  onToggleSettings?: () => void;
  browserUrl?: string;
  canGoBack?: boolean;
  canGoForward?: boolean;
  canExportDocx?: boolean;
  onNavigateBack?: () => void;
  onNavigateForward?: () => void;
  onNavigateRefresh?: () => void;
};

const DEFAULT_TITLEBAR_LABELS: TitlebarLabels = {
  controlsAriaLabel: '',
  settingsLabel: '',
  minimizeLabel: '',
  maximizeLabel: '',
  restoreLabel: '',
  closeLabel: '',
  backLabel: '',
  forwardLabel: '',
  refreshLabel: '',
  showPrimarySidebarLabel: '',
  hidePrimarySidebarLabel: '',
  showAssistantLabel: '',
  hideAssistantLabel: '',
  exportDocxLabel: '',
  noExportableArticlesLabel: '',
};

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();
function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function composeClassName(parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join(' ');
}

type TitlebarIconActionItem = {
  className: string;
  label: string;
  icon: LxIconName;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
  menu?: readonly ActionBarMenuItem[];
  renderOverlay?: (context: DropdownMenuActionOverlayContext) => HTMLElement;
  overlayRole?: string;
  menuClassName?: string;
  menuData?: string;
  minWidth?: number;
};

function createTitlebarActionBar(params: {
  className: string;
  ariaLabel?: string;
  items: readonly TitlebarIconActionItem[];
}) {
  const hoverService = getHoverService();

  const actionBarView = createActionBarView({
    className: composeClassName(['titlebar-actionbar', params.className]),
    ariaRole: 'group',
    ariaLabel: params.ariaLabel,
    hoverService,
    items: params.items.map<ActionBarItem>((item) => {
      const baseOptions = {
        label: item.label,
        title: item.title ?? item.label,
        content: createLxIcon(item.icon),
        disabled: item.disabled,
        buttonClassName: composeClassName(['titlebar-btn', item.className]),
      };

      if (item.menu || item.renderOverlay) {
        return createDropdownMenuActionViewItem({
          ...baseOptions,
          menu: item.menu,
          renderOverlay: item.renderOverlay,
          overlayRole: item.overlayRole,
          overlayAlignment: 'end',
          menuClassName: item.menuClassName,
          menuData: item.menuData,
          minWidth: item.minWidth,
          hoverService,
        });
      }

      return {
        ...baseOptions,
        onClick: item.onClick ? () => item.onClick?.() : undefined,
      };
    }),
  });

  return {
    getElement: () => actionBarView.getElement(),
    dispose: () => {
      actionBarView.dispose();
    },
  };
}

export class TitlebarView {
  private props: TitlebarProps;
  private readonly element = createElement('header');
  private readonly leadingWindowControlsContainer = createElement('div');
  private readonly startViewportElement = createElement('div', 'titlebar-start-viewport');
  private readonly startElement = createElement('div', 'titlebar-start');
  private readonly centerElement = createElement('div', 'titlebar-center');
  private readonly controlsViewportElement = createElement('div', 'titlebar-controls-viewport');
  private readonly controlsElement = createElement('div', 'titlebar-controls');
  private readonly renderedViews: Array<{ dispose: () => void }> = [];
  private readonly unsubscribeUiActions: () => void;

  constructor(props: TitlebarProps) {
    this.props = props;
    this.startViewportElement.append(this.startElement);
    this.controlsViewportElement.append(this.controlsElement);
    this.element.append(
      this.leadingWindowControlsContainer,
      this.startViewportElement,
      this.centerElement,
      this.controlsViewportElement,
    );
    this.unsubscribeUiActions = subscribeTitlebarUiActions((action) => {
      if (action.type === 'NAVIGATE_REFRESH') {
        this.props.onNavigateRefresh?.();
      }
    });
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: TitlebarProps) {
    this.props = props;
    this.render();
  }

  dispose() {
    this.unsubscribeUiActions();
    this.disposeRenderedViews();
    this.element.replaceChildren();
  }

  private render() {
    const props: TitlebarProps = {
      ...this.props,
      labels: {
        ...DEFAULT_TITLEBAR_LABELS,
        ...(this.props.labels ?? {}),
      },
      isWindowMaximized: this.props.isWindowMaximized ?? false,
      canGoBack: this.props.canGoBack ?? false,
      canGoForward: this.props.canGoForward ?? false,
      canExportDocx: this.props.canExportDocx ?? false,
      isPrimarySidebarOpen: this.props.isPrimarySidebarOpen ?? false,
      isAgentSidebarOpen: this.props.isAgentSidebarOpen ?? false,
      onWindowControl: this.props.onWindowControl,
    };

    this.element.className = [
      'titlebar',
      `titlebar-platform-${WINDOW_CHROME_LAYOUT.platform}`,
      `titlebar-style-${WINDOW_CHROME_LAYOUT.titleBarStyle}`,
    ].join(' ');

    this.leadingWindowControlsContainer.className = [
      'titlebar-window-controls-container',
      WINDOW_CHROME_LAYOUT.windowControlsContainerMode === 'native'
        ? 'window-controls-container-native'
        : '',
    ]
      .filter(Boolean)
      .join(' ');
    if (WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx > 0) {
      this.leadingWindowControlsContainer.setAttribute(
        'style',
        `--window-controls-width: ${WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx}px`,
      );
    } else {
      this.leadingWindowControlsContainer.removeAttribute('style');
    }

    this.controlsElement.setAttribute('role', 'group');
    this.controlsElement.setAttribute('aria-label', props.labels.controlsAriaLabel);

    this.disposeRenderedViews();
    this.renderStart();
    this.renderCenter(props);
    this.renderControls(props);
  }

  private renderStart() {
    this.startElement.replaceChildren();
  }

  private renderCenter(props: TitlebarProps & { labels: TitlebarLabels }) {
    this.centerElement.replaceChildren();

    const navItems: TitlebarIconActionItem[] = [
      {
        className: 'titlebar-btn-nav',
        label: props.labels.backLabel,
        icon: lxIconSemanticMap.titlebar.navigateBack,
        onClick: requestTitlebarNavigateBack,
        disabled: !props.browserUrl || !props.canGoBack,
      },
      {
        className: 'titlebar-btn-nav',
        label: props.labels.forwardLabel,
        icon: lxIconSemanticMap.titlebar.navigateForward,
        onClick: requestTitlebarNavigateForward,
        disabled: !props.browserUrl || !props.canGoForward,
      },
    ];

    if (props.onNavigateRefresh) {
      navItems.push({
        className: 'titlebar-btn-nav titlebar-btn-refresh',
        label: props.labels.refreshLabel,
        icon: lxIconSemanticMap.titlebar.refresh,
        onClick: () => props.onNavigateRefresh?.(),
        disabled: !props.browserUrl,
      });
    }

    const navGroup = this.trackView(
      createTitlebarActionBar({
        className: 'titlebar-nav-group',
        items: navItems,
      }),
    );

    this.centerElement.append(navGroup.getElement());
  }

  private renderControls(props: TitlebarProps & { labels: TitlebarLabels }) {
    this.controlsElement.replaceChildren();
    const actionItems: TitlebarIconActionItem[] = [];

    if (props.onTogglePrimarySidebar && props.primarySidebarToggleLabel) {
      actionItems.push({
        className: 'titlebar-btn-primary',
        label: props.primarySidebarToggleLabel,
        icon: props.isPrimarySidebarOpen
          ? lxIconSemanticMap.titlebar.primarySidebarOpen
          : lxIconSemanticMap.titlebar.primarySidebarClosed,
        onClick: requestToggleTitlebarPrimarySidebar,
      });
    }

    if (props.onToggleAgentSidebar && props.agentSidebarToggleLabel) {
      actionItems.push({
        className: 'titlebar-btn-agent',
        label: props.agentSidebarToggleLabel,
        icon: props.isAgentSidebarOpen
          ? lxIconSemanticMap.titlebar.agentSidebarOpen
          : lxIconSemanticMap.titlebar.agentSidebarClosed,
        onClick: requestToggleTitlebarAgentSidebar,
      });
    }

    actionItems.push(
      {
        className: 'titlebar-btn-export',
        label: props.labels.exportDocxLabel,
        icon: lxIconSemanticMap.titlebar.exportDocx,
        onClick: requestExportTitlebarDocx,
        disabled: !props.canExportDocx,
        title: props.canExportDocx
          ? props.labels.exportDocxLabel
          : props.labels.noExportableArticlesLabel,
      },
      {
        className: 'titlebar-btn-settings',
        label: props.labels.settingsLabel,
        icon: lxIconSemanticMap.titlebar.settings,
        onClick: requestToggleTitlebarSettings,
      },
    );

    const actionGroup = this.trackView(
      createTitlebarActionBar({
        className: 'titlebar-controls-group',
        ariaLabel: props.labels.controlsAriaLabel,
        items: actionItems,
      }),
    );

    this.controlsElement.append(actionGroup.getElement());

    if (WINDOW_CHROME_LAYOUT.renderCustomWindowControls) {
      const windowControls = this.trackView(
        createWindowControlsView({
          className: 'titlebar-window-controls',
          labels: {
            controlsAriaLabel: props.labels.controlsAriaLabel,
            minimizeLabel: props.labels.minimizeLabel,
            maximizeLabel: props.labels.maximizeLabel,
            restoreLabel: props.labels.restoreLabel,
            closeLabel: props.labels.closeLabel,
          },
          isWindowMaximized: props.isWindowMaximized,
          onWindowControl: props.onWindowControl,
        }),
      );
      this.controlsElement.append(windowControls.getElement());
    }
  }

  private trackView<T extends { dispose: () => void }>(view: T) {
    this.renderedViews.push(view);
    return view;
  }

  private disposeRenderedViews() {
    while (this.renderedViews.length > 0) {
      this.renderedViews.pop()?.dispose();
    }
  }
}

export function createTitlebarView(props: TitlebarProps) {
  return new TitlebarView(props);
}

export default TitlebarView;
