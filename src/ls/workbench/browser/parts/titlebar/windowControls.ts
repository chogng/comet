import type { WindowControlAction } from 'ls/base/parts/sandbox/common/desktopTypes';
import { createButtonView } from 'ls/base/browser/ui/button/button';
import { getHoverService } from 'ls/base/browser/ui/hover/hover';
import { createLxIcon } from 'ls/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicons/lxiconsSemantic';

export type WindowControlsAction = Extract<
  WindowControlAction,
  'minimize' | 'toggle-maximize' | 'close'
>;

export type WindowControlsItem = WindowControlsAction;

export type WindowControlsLabels = {
  controlsAriaLabel?: string;
  minimizeLabel?: string;
  maximizeLabel?: string;
  restoreLabel?: string;
  closeLabel?: string;
};

export type WindowControlsGroupProps = {
  labels?: WindowControlsLabels;
  isWindowMaximized?: boolean;
  className?: string;
  onWindowControl: (action: WindowControlsAction) => void;
};

const DEFAULT_CONTROL_LABELS: Required<
  Omit<WindowControlsLabels, 'controlsAriaLabel'>
> = {
  minimizeLabel: 'Minimize',
  maximizeLabel: 'Maximize',
  restoreLabel: 'Restore',
  closeLabel: 'Close',
};

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

export class WindowControlsView {
  private props: WindowControlsGroupProps;
  private readonly element = createElement('div');
  private readonly controlViews: Array<ReturnType<typeof createButtonView>> = [];

  constructor(props: WindowControlsGroupProps) {
    this.props = props;
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: WindowControlsGroupProps) {
    this.props = props;
    this.render();
  }

  dispose() {
    this.disposeControlViews();
    this.element.replaceChildren();
  }

  private render() {
    const {
      labels,
      isWindowMaximized = false,
      className = 'titlebar-window-controls',
      onWindowControl,
    } = this.props;
    const resolvedLabels = {
      ...DEFAULT_CONTROL_LABELS,
      ...labels,
    };
    const hoverService = getHoverService();

    this.element.className = className;
    this.element.setAttribute('role', 'group');
    this.element.setAttribute(
      'aria-label',
      labels?.controlsAriaLabel ?? resolvedLabels.closeLabel,
    );
    this.disposeControlViews();

    const minimizeButton = this.trackControlView(
      createButtonView({
        className: 'titlebar-btn titlebar-btn-window',
        variant: 'ghost',
        size: 'md',
        mode: 'icon',
        ariaLabel: resolvedLabels.minimizeLabel,
        title: resolvedLabels.minimizeLabel,
        hoverService,
        content: '-',
        onClick: () => onWindowControl('minimize'),
      }),
    );
    const maximizeButton = this.trackControlView(
      createButtonView({
        className: 'titlebar-btn titlebar-btn-window',
        variant: 'ghost',
        size: 'md',
        mode: 'icon',
        ariaLabel: isWindowMaximized
          ? resolvedLabels.restoreLabel
          : resolvedLabels.maximizeLabel,
        title: isWindowMaximized
          ? resolvedLabels.restoreLabel
          : resolvedLabels.maximizeLabel,
        hoverService,
        content: isWindowMaximized ? 'o' : '[]',
        onClick: () => onWindowControl('toggle-maximize'),
      }),
    );
    const closeButton = this.trackControlView(
      createButtonView({
        className: 'titlebar-btn titlebar-btn-window titlebar-btn-close',
        variant: 'ghost',
        size: 'md',
        mode: 'icon',
        ariaLabel: resolvedLabels.closeLabel,
        title: resolvedLabels.closeLabel,
        hoverService,
        content: createLxIcon(lxIconSemanticMap.windowControls.close),
        onClick: () => onWindowControl('close'),
      }),
    );

    this.element.replaceChildren(
      minimizeButton.getElement(),
      maximizeButton.getElement(),
      closeButton.getElement(),
    );
  }

  private trackControlView(view: ReturnType<typeof createButtonView>) {
    this.controlViews.push(view);
    return view;
  }

  private disposeControlViews() {
    while (this.controlViews.length > 0) {
      this.controlViews.pop()?.dispose();
    }
  }
}

export function createWindowControlsView(props: WindowControlsGroupProps) {
  return new WindowControlsView(props);
}
