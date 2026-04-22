import 'ls/base/browser/ui/actionbar/actionbar.css';
import * as DOM from 'ls/base/browser/dom';
import type { BaseAction } from 'ls/base/common/actions';
import { LifecycleOwner } from 'ls/base/common/lifecycle';
import {
  ActionViewItem,
  BaseActionViewItem,
  type ActionViewItemOptions,
} from 'ls/base/browser/ui/actionbar/actionViewItems';
import { createActionWithDropdownActionViewItem } from 'ls/base/browser/ui/dropdown/dropdownActionViewItem';
import type { HoverInput, HoverService } from 'ls/base/browser/ui/hover/hover';
import type { LxIconName } from 'ls/base/browser/ui/lxicon/lxicon';

export type ActionBarOrientation = 'horizontal' | 'vertical';
export type ActionBarActionMode = 'icon' | 'text' | 'custom';
export type ActionBarRenderable = string | Node | (() => string | Node);
export type ActionBarMenuItem = BaseAction & {
  icon?: LxIconName;
  submenu?: readonly ActionBarMenuItem[];
  onClick?: (event: MouseEvent) => void;
};

export interface ActionView {
  render: (container?: HTMLElement) => void;
  getElement: () => HTMLElement;
  dispose: () => void;
  focus?: () => void;
  blur?: () => void;
  getFocusableElement?: () => HTMLElement | null;
}

export type ActionBarActionItem = BaseAction & {
  type?: 'action';
  content?: ActionBarRenderable;
  hover?: HoverInput;
  active?: boolean;
  mode?: ActionBarActionMode;
  className?: string;
  buttonClassName?: string;
  buttonAttributes?: Record<string, string | null | undefined | false>;
  onClick?: (event: MouseEvent) => void;
  hoverService?: HoverService;
};

export type ActionBarSeparatorItem = {
  type: 'separator';
  id?: string;
  className?: string;
};

export type ActionBarSplitItem = {
  type: 'split';
  id?: string;
  className?: string;
  primary: ActionBarActionItem;
  dropdown: ActionBarActionItem & {
    menu?: readonly ActionBarMenuItem[];
    renderOverlay?: (context: { hide: () => void }) => HTMLElement;
    overlayRole?: string;
    menuClassName?: string;
    menuData?: string;
    minWidth?: number;
    overlayAlignment?: 'start' | 'end';
    overlayAlignmentPolicy?:
      | 'strict-start'
      | 'strict-end'
      | 'prefer-start'
      | 'prefer-end'
      | 'edge-aware';
    overlayAlignmentProvider?: (anchor: HTMLElement) => 'start' | 'end' | undefined;
    overlayPosition?: 'auto' | 'above' | 'below';
  };
};

export type ActionBarItem = ActionBarActionItem | ActionBarSeparatorItem | ActionBarSplitItem | ActionView;

export type ActionBarProps = {
  items?: readonly ActionBarItem[];
  className?: string;
  orientation?: ActionBarOrientation;
  ariaLabel?: string;
  ariaRole?: string;
  hoverService?: HoverService;
};

function isActionItem(item: ActionBarItem): item is ActionBarActionItem {
  return !isViewItem(item) && item.type !== 'separator' && item.type !== 'split';
}

function isSplitItem(item: ActionBarItem): item is ActionBarSplitItem {
  return !isViewItem(item) && item.type === 'split';
}

function isViewItem(item: ActionBarItem): item is ActionView {
  if (item instanceof BaseActionViewItem) {
    return true;
  }

  return (
    typeof item === 'object' &&
    item !== null &&
    'render' in item &&
    typeof item.render === 'function' &&
    'getElement' in item &&
    typeof item.getElement === 'function' &&
    'dispose' in item &&
    typeof item.dispose === 'function'
  );
}

function createDefaultActionViewItem(
  item: ActionBarActionItem,
  hoverService?: HoverService,
): ActionView {
  // Plain actionbar items are rendered with the default action view implementation.
  const options: ActionViewItemOptions = {
    hoverService: item.hoverService ?? hoverService,
  };

  return new ActionViewItem(item, options);
}

type RenderedItem = {
  button: HTMLElement;
  dispose: () => void;
};

export class ActionBarView extends LifecycleOwner {
  private props: ActionBarProps;
  private readonly element = document.createElement('div');
  private readonly actionsContainer = document.createElement('div');
  private readonly renderedItems: RenderedItem[] = [];
  private disposed = false;

  constructor(props: ActionBarProps = {}) {
    super();
    this.props = this.normalizeProps(props);
    this.actionsContainer.className = 'actionbar-actions-container';
    this.element.append(this.actionsContainer);
    this.register(DOM.addDisposableListener(this.element, 'keydown', this.handleKeyDown));
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: ActionBarProps = {}) {
    if (this.disposed) {
      return;
    }
    this.props = this.normalizeProps(props);
    this.render();
  }

  focusFirst() {
    this.getFocusableButtons().at(0)?.focus();
  }

  focusLast() {
    this.getFocusableButtons().at(-1)?.focus();
  }

  dispose() {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.clearRenderedItems();
    super.dispose();
    this.element.replaceChildren();
  }

  private normalizeProps(props: ActionBarProps): ActionBarProps {
    return {
      items: props.items ?? [],
      className: props.className ?? '',
      orientation: props.orientation ?? 'horizontal',
      ariaLabel: props.ariaLabel,
      ariaRole: props.ariaRole ?? 'toolbar',
      hoverService: props.hoverService,
    };
  }

  private render() {
    this.clearRenderedItems();
    this.element.className = DOM.composeClassName([
      'actionbar',
      this.props.orientation === 'vertical' ? 'is-vertical' : 'is-horizontal',
      this.props.className,
    ]);
    const role = this.props.ariaRole ?? 'toolbar';
    this.element.setAttribute('role', role);
    if (role === 'toolbar') {
      this.element.setAttribute('aria-orientation', this.props.orientation ?? 'horizontal');
    } else {
      this.element.removeAttribute('aria-orientation');
    }

    if (this.props.ariaLabel) {
      this.element.setAttribute('aria-label', this.props.ariaLabel);
    } else {
      this.element.removeAttribute('aria-label');
    }

    const nodes = (this.props.items ?? []).map((item) => this.renderItem(item));
    this.actionsContainer.replaceChildren(...nodes);
  }

  private clearRenderedItems() {
    while (this.renderedItems.length) {
      this.renderedItems.pop()?.dispose();
    }
    this.actionsContainer.replaceChildren();
  }

  private renderItem(item: ActionBarItem) {
    if (isViewItem(item)) {
      item.render();
      const element = item.getElement();
      this.renderedItems.push({
        button: item.getFocusableElement?.() ?? element,
        dispose: () => {
          item.dispose();
        },
      });
      return element;
    }

    if (!isActionItem(item)) {
      if (isSplitItem(item)) {
        const viewItem = createActionWithDropdownActionViewItem({
          className: item.className,
          primary: {
            ...item.primary,
            hoverService: item.primary.hoverService ?? this.props.hoverService,
          },
          dropdown: {
            ...item.dropdown,
            hoverService: item.dropdown.hoverService ?? this.props.hoverService,
          },
        });
        viewItem.render();
        const element = viewItem.getElement();
        if (item.id) {
          element.dataset.actionbarItemId = item.id;
        }
        this.renderedItems.push({
          button: viewItem.getFocusableElement?.() ?? element,
          dispose: () => {
            viewItem.dispose();
          },
        });
        return element;
      }

      const itemElement = document.createElement('div');
      itemElement.className = DOM.composeClassName([
        'actionbar-item',
        'is-separator',
        item.className,
      ]);
      if (item.id) {
        itemElement.dataset.actionbarItemId = item.id;
      }
      const separator = document.createElement('div');
      separator.className = 'actionbar-separator';
      separator.setAttribute('aria-hidden', 'true');
      itemElement.append(separator);
      return itemElement;
    }

    const viewItem = createDefaultActionViewItem(item, item.hoverService ?? this.props.hoverService);
    viewItem.render();
    const element = viewItem.getElement();
    if (item.id) {
      element.dataset.actionbarItemId = item.id;
    }
    this.renderedItems.push({
      button: viewItem.getFocusableElement?.() ?? element,
      dispose: () => {
        viewItem.dispose();
      },
    });
    return element;
  }

  private getFocusableButtons() {
    return this.renderedItems
      .map((action) => action.button)
      .filter((button) => {
        if (!(button instanceof HTMLElement)) {
          return false;
        }
        if (button instanceof HTMLButtonElement) {
          return !button.disabled;
        }
        return button.tabIndex >= 0 || typeof (button as HTMLElement).focus === 'function';
      });
  }

  private moveFocus(direction: -1 | 1) {
    const buttons = this.getFocusableButtons();
    if (buttons.length === 0) {
      return;
    }

    const currentIndex = buttons.findIndex((button) => button === document.activeElement);
    const fallbackIndex = direction > 0 ? 0 : buttons.length - 1;
    const nextIndex =
      currentIndex === -1
        ? fallbackIndex
        : (currentIndex + direction + buttons.length) % buttons.length;
    buttons[nextIndex]?.focus();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (!(event.target instanceof HTMLElement)) {
      return;
    }

    const orientation = this.props.orientation ?? 'horizontal';
    const isHorizontal = orientation === 'horizontal';
    const key = event.key;

    if (
      (isHorizontal && key === 'ArrowRight') ||
      (!isHorizontal && key === 'ArrowDown')
    ) {
      event.preventDefault();
      this.moveFocus(1);
      return;
    }

    if (
      (isHorizontal && key === 'ArrowLeft') ||
      (!isHorizontal && key === 'ArrowUp')
    ) {
      event.preventDefault();
      this.moveFocus(-1);
      return;
    }

    if (key === 'Home') {
      event.preventDefault();
      this.focusFirst();
      return;
    }

    if (key === 'End') {
      event.preventDefault();
      this.focusLast();
    }
  };
}

export function createActionBarView(props: ActionBarProps = {}) {
  return new ActionBarView(props);
}
