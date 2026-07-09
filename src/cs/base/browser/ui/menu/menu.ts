import 'cs/base/browser/ui/menu/menu.css';
import { $ } from 'cs/base/browser/dom';

import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import type { IAction } from 'cs/base/common/actions';
import { SubmenuAction } from 'cs/base/common/actions';
import { Disposable, DisposableStore, toDisposable } from 'cs/base/common/lifecycle';

export type MenuSelectionSource = 'keyboard' | 'pointer';

export type MenuSelectEvent = {
  value: string;
  index: number;
  action: IAction;
  source: MenuSelectionSource;
};

export type MenuAction = IAction & {
  icon?: LxIconName;
  description?: string;
  checkedDisplay?: 'check' | 'switch';
  keepOpenOnClick?: boolean;
};

export interface MenuOptions {
  items: readonly IAction[];
  className?: string;
  itemClassName?: string;
  dataMenu?: string;
  placement?: 'top' | 'bottom';
  variant?: 'root' | 'submenu';
  role?: string;
  itemRole?: 'menuitem' | 'option';
  itemId?: (index: number, item: IAction) => string;
  activeIndex?: number;
  header?: MenuHeaderOptions;
  onSelect?: (event: MenuSelectEvent) => void;
  onCancel?: () => void;
}

export interface MenuHeaderContext {
  updateItems: (items: readonly IAction[]) => void;
  hide: () => void;
}

export interface MenuHeaderOptions {
  className?: string;
  autoFocusOnShow?: boolean;
  render: (context: MenuHeaderContext) => HTMLElement;
}

const SUBMENU_OFFSET_PX = 4;
const VIEWPORT_MARGIN_PX = 8;

function composeClassName(parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join(' ');
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function createCheckSlot(isSelected: boolean) {
  const slot = $<HTMLElementTagNameMap['span']>('span.comet-dropdown-menu-item-check');
  slot.setAttribute('aria-hidden', 'true');

  if (isSelected) {
    slot.append(createLxIcon('check'));
  } else {
    slot.classList.add('placeholder');
  }

  return slot;
}

function createSwitchSlot(isSelected: boolean) {
  const slot = $<HTMLElementTagNameMap['span']>('span.comet-dropdown-menu-item-switch');
  slot.setAttribute('aria-hidden', 'true');
  slot.classList.toggle('checked', isSelected);

  const thumb = $<HTMLElementTagNameMap['span']>('span.comet-dropdown-menu-item-switch-thumb');
  slot.append(thumb);
  return slot;
}

function asMenuAction(action: IAction): MenuAction {
  return action as MenuAction;
}

function getSubmenuActions(action: IAction | undefined): readonly IAction[] | undefined {
  return action instanceof SubmenuAction ? action.actions : undefined;
}

function hasSubmenu(action: IAction | undefined): action is IAction {
  const actions = getSubmenuActions(action);
  return Boolean(actions && actions.length > 0);
}

function createSubmenuIndicator() {
  const slot = $<HTMLElementTagNameMap['span']>('span.comet-dropdown-menu-item-submenu-indicator');
  slot.setAttribute('aria-hidden', 'true');
  slot.append(createLxIcon('chevron-right'));
  return slot;
}

function createTrailingSlot(action: IAction, isSelected: boolean) {
  const menuAction = asMenuAction(action);
  const trailing = $<HTMLElementTagNameMap['span']>('span.comet-dropdown-menu-item-trailing');
  trailing.append(
    menuAction.checkedDisplay === 'switch'
      ? createSwitchSlot(isSelected)
      : createCheckSlot(isSelected),
  );
  if (hasSubmenu(action)) {
    trailing.append(createSubmenuIndicator());
  }
  return trailing;
}

function createMenuItemContent(action: IAction) {
  const menuAction = asMenuAction(action);
  const content = $<HTMLElementTagNameMap['div']>('div.comet-dropdown-option-content');
  const textWrap = $<HTMLElementTagNameMap['div']>('div.comet-dropdown-menu-item-text');
  const label = $<HTMLElementTagNameMap['div']>('div.comet-dropdown-menu-item-content', undefined, action.label);
  textWrap.append(label);
  if (menuAction.description) {
    textWrap.append($<HTMLElementTagNameMap['div']>('div.comet-dropdown-menu-item-description', undefined, menuAction.description));
  }
  if (menuAction.icon) {
    content.append(createLxIcon(menuAction.icon, 'comet-dropdown-option-icon'));
  }
  content.append(textWrap);
  return content;
}

function isActionEnabled(action: IAction | undefined) {
  return Boolean(action?.enabled);
}

function resolvePlacement(options: MenuOptions) {
  return options.placement ?? 'bottom';
}

function resolveVariant(options: MenuOptions) {
  return options.variant ?? 'root';
}

function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

function isEditableElement(target: EventTarget | null): target is HTMLElement {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  if (target instanceof HTMLTextAreaElement) {
    return !target.readOnly && !target.disabled;
  }

  if (target instanceof HTMLInputElement) {
    if (target.readOnly || target.disabled) {
      return false;
    }
    return ![
      'button',
      'checkbox',
      'color',
      'file',
      'hidden',
      'image',
      'radio',
      'range',
      'reset',
      'submit',
    ].includes(target.type);
  }

  return false;
}

export class Menu extends Disposable {
  private readonly element = $<HTMLElementTagNameMap['div']>('div');
  private readonly renderDisposables = new DisposableStore();
  private options: MenuOptions;
  private itemElements: HTMLDivElement[] = [];
  private submenuState: {
    parentIndex: number;
    parentElement: HTMLDivElement;
    menu: Menu;
    element: HTMLElement;
    listeners: Array<{ dispose: () => void }>;
    source: MenuSelectionSource;
  } | null = null;
  private activeIndex = -1;
  private disposed = false;
  private submenuCloseTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: MenuOptions) {
    super();
    this._register(this.renderDisposables);
    this.options = options;
    this._register(addDisposableListener(this.element, 'keydown', this.handleKeyDown));
    this._register(addDisposableListener(this.element, 'mouseenter', this.cancelSubmenuClose));
    this._register(addDisposableListener(this.element, 'mouseleave', this.handleRootMouseLeave));
    this.render();
  }

  getElement() {
    return this.element;
  }

  getActiveIndex() {
    return this.activeIndex;
  }

  setOptions(options: MenuOptions) {
    if (this.disposed) {
      return;
    }

    this.options = options;
    this.render();
  }

  focus() {
    if (this.disposed) {
      return;
    }

    this.focusActiveOrContainer();
  }

  focusFirst() {
    if (this.disposed) {
      return;
    }

    this.focusByIndex(this.findNextEnabledIndex(-1, 1, false));
  }

  focusSelectedOrFirstEnabled() {
    if (this.disposed) {
      return;
    }

const selectedIndex = this.findSelectedEnabledIndex();
    if (selectedIndex >= 0) {
      this.focusByIndex(selectedIndex);
      return;
    }

    this.focusFirst();
  }

  focusLast() {
    if (this.disposed) {
      return;
    }

    this.focusByIndex(this.findNextEnabledIndex(this.options.items.length, -1, false));
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.cancelSubmenuClose();
    this.closeSubmenu();
    super.dispose();
    this.element.replaceChildren();
    this.itemElements = [];
    this.activeIndex = -1;
    this.element.remove();
  }

  private cancelSubmenuClose = () => {
    if (this.submenuCloseTimer === null) {
      return;
    }

    clearTimeout(this.submenuCloseTimer);
    this.submenuCloseTimer = null;
  };

  private scheduleSubmenuClose() {
    if (!this.submenuState || this.submenuState.source !== 'pointer') {
      return;
    }

    this.cancelSubmenuClose();
    this.submenuCloseTimer = setTimeout(() => {
      this.submenuCloseTimer = null;
      this.closeSubmenu();
    }, 120);
  }

  private readonly handleRootMouseLeave = (event: MouseEvent) => {
    if (!this.submenuState) {
      return;
    }

const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Node
      && this.submenuState.element.contains(relatedTarget)
    ) {
      return;
    }

    this.scheduleSubmenuClose();
  };

  private readonly handleSubmenuMouseLeave = (event: MouseEvent) => {
    if (!this.submenuState) {
      return;
    }

const relatedTarget = event.relatedTarget;
    if (
      relatedTarget instanceof Node
      && (this.element.contains(relatedTarget)
        || this.submenuState.element.contains(relatedTarget))
    ) {
      return;
    }

    this.scheduleSubmenuClose();
  };

  private render() {
    this.closeSubmenu();
    this.renderDisposables.clear();
    this.element.className = composeClassName([
      'comet-menu',
      `comet-menu-${resolveVariant(this.options)}`,
      'comet-dropdown-menu',
      `comet-dropdown-menu-${resolvePlacement(this.options)}`,
      this.options.className,
    ]);
    this.element.setAttribute('role', this.options.role ?? 'menu');
    const dataMenu = this.options.dataMenu?.trim();
    if (dataMenu) {
      this.element.setAttribute('data-menu', dataMenu);
    } else {
      this.element.removeAttribute('data-menu');
    }
    this.element.tabIndex = 0;

    const headerNode = this.renderHeader();
    this.applyItemNodes(this.buildItemNodes(), {
      headerNode,
      preserveExistingHeader: false,
    });
    this.syncInitialActiveIndex();
  }

  private renderHeader() {
    const header = this.options.header;
    if (!header) {
      return null;
    }

const node = header.render({
      updateItems: (items) => {
        if (this.disposed) {
          return;
        }
        this.options = {
          ...this.options,
          items: [...items],
        };
        this.closeSubmenu();
        this.renderDisposables.clear();
        this.applyItemNodes(this.buildItemNodes(), {
          preserveExistingHeader: true,
        });
        this.syncInitialActiveIndex();
      },
      hide: () => {
        this.options.onCancel?.();
      },
    });
    node.classList.add('comet-menu-header');
    if (header.className) {
      node.classList.add(...header.className.split(/\s+/).filter(Boolean));
    }
    return node;
  }

  private syncInitialActiveIndex() {
    const configuredActiveIndex = this.resolveConfiguredActiveIndex();
    if (configuredActiveIndex >= 0) {
      this.setActiveIndex(configuredActiveIndex, false, false);
      return;
    }

const selectedIndex = this.findSelectedEnabledIndex();
    if (selectedIndex >= 0) {
      this.setActiveIndex(selectedIndex, false, false);
      return;
    }

    this.setActiveIndex(this.findNextEnabledIndex(-1, 1, false), false, false);
  }

  private buildItemNodes() {
    const nodes: HTMLDivElement[] = [];
    const itemRole =
      this.options.itemRole
      ?? (this.options.role === 'listbox' ? 'option' : 'menuitem');
    for (let index = 0; index < this.options.items.length; index += 1) {
      const item = this.options.items[index];
      const menuAction = asMenuAction(item);
      const selected = Boolean(item.checked);
      const enabled = isActionEnabled(item);
      const node = $<HTMLElementTagNameMap['div']>('div', { class: composeClassName([
          'comet-dropdown-menu-item',
          this.options.itemClassName,
          hasSubmenu(item) ? 'comet-has-submenu' : '',
          menuAction.checkedDisplay === 'switch' && menuAction.description ? 'comet-has-description-switch' : '',
          selected ? 'selected' : '',
          enabled ? '' : 'disabled',
        ]) });
      node.tabIndex = -1;
      node.dataset.index = String(index);
      node.setAttribute('role', itemRole);
      node.setAttribute('aria-disabled', enabled ? 'false' : 'true');
      if (menuAction.checkedDisplay === 'switch') {
        node.setAttribute('role', 'menuitemcheckbox');
        node.setAttribute('aria-checked', selected ? 'true' : 'false');
      } else {
        node.removeAttribute('aria-checked');
      }
      if (itemRole === 'option') {
        node.setAttribute('aria-selected', selected ? 'true' : 'false');
      } else {
        node.removeAttribute('aria-selected');
      }

const itemId = this.options.itemId?.(index, item) ?? '';
      if (itemId) {
        node.id = itemId;
      } else {
        node.removeAttribute('id');
      }
      if (hasSubmenu(item)) {
        node.setAttribute('aria-haspopup', 'menu');
        node.setAttribute('aria-expanded', 'false');
      } else {
        node.removeAttribute('aria-haspopup');
        node.removeAttribute('aria-expanded');
      }
      node.append(createMenuItemContent(item), createTrailingSlot(item, selected));
      this.renderDisposables.add(
        addDisposableListener(node, 'mouseenter', () => {
          if (!enabled) {
            this.closeSubmenu();
            return;
          }
          this.setActiveIndex(index, false);
          if (hasSubmenu(item)) {
            this.openSubmenu(index, 'pointer');
          } else {
            this.closeSubmenu();
          }
        }),
      );
      this.renderDisposables.add(
        addDisposableListener(node, 'click', (event) => {
          event.stopPropagation();
          if (hasSubmenu(item)) {
            this.setActiveIndex(index, false, true);
            this.openSubmenu(index, 'pointer');
            return;
          }
          this.selectByIndex(index, 'pointer');
        }),
      );
      nodes.push(node);
    }
    return nodes;
  }

  private resolveConfiguredActiveIndex() {
    const configuredIndex = this.options.activeIndex;
    if (typeof configuredIndex !== 'number') {
      return -1;
    }

    if (
      configuredIndex < 0 ||
      configuredIndex >= this.options.items.length ||
      !isActionEnabled(this.options.items[configuredIndex])
    ) {
      return -1;
    }

    return configuredIndex;
  }

  private applyItemNodes(
    nodes: HTMLDivElement[],
    options?: {
      headerNode?: HTMLElement | null;
      preserveExistingHeader?: boolean;
    },
  ) {
    this.itemElements = nodes;

    const explicitHeaderNode = options?.headerNode ?? null;
    const preservedHeaderNode = options?.preserveExistingHeader
      ? this.element.querySelector(':scope > .comet-menu-header')
      : null;
    const headerNode = explicitHeaderNode ?? preservedHeaderNode;

    if (headerNode instanceof HTMLElement) {
      this.element.replaceChildren(headerNode, ...nodes);
      return;
    }

    this.element.replaceChildren(...nodes);
  }

  private setActiveIndex(index: number, reveal = true, focus = false) {
    const normalizedIndex =
      index < 0 || index >= this.itemElements.length ? -1 : index;
    if (normalizedIndex === this.activeIndex) {
      if (focus) {
        this.focusActiveOrContainer();
      }
      return;
    }

    if (this.activeIndex >= 0) {
      const previousElement = this.itemElements[this.activeIndex];
      previousElement?.classList.remove('hovered');
      if (previousElement) {
        previousElement.tabIndex = -1;
      }
    }

    this.activeIndex = normalizedIndex;

    if (this.activeIndex >= 0) {
      const activeElement = this.itemElements[this.activeIndex];
      activeElement.classList.add('hovered');
      activeElement.tabIndex = 0;
      if (this.submenuState && this.submenuState.parentIndex !== this.activeIndex) {
        this.closeSubmenu();
      }
      if (reveal) {
        activeElement.scrollIntoView({ block: 'nearest' });
      }
      if (focus) {
        activeElement.focus();
      }
      return;
    }

    if (focus) {
      this.element.focus();
    }
  }

  private findSelectedEnabledIndex() {
    return this.options.items.findIndex((item) => item.checked && isActionEnabled(item));
  }

  private focusByIndex(index: number) {
    this.setActiveIndex(index, true, true);
  }

  private focusActiveOrContainer() {
    if (this.activeIndex >= 0) {
      this.itemElements[this.activeIndex]?.focus();
      return;
    }

    this.element.focus();
  }

  private findNextEnabledIndex(
    fromIndex: number,
    direction: 1 | -1,
    wrap = true,
  ) {
    const size = this.options.items.length;
    if (size === 0) {
      return -1;
    }

    let candidate = fromIndex;
    for (let step = 0; step < size; step += 1) {
      if (wrap) {
        candidate = (candidate + direction + size) % size;
      } else {
        candidate += direction;
      }

      if (candidate < 0 || candidate >= size) {
        break;
      }

      if (isActionEnabled(this.options.items[candidate])) {
        return candidate;
      }
    }

    return -1;
  }

  private selectByIndex(index: number, source: MenuSelectionSource) {
    const item = this.options.items[index];
    if (!item || !isActionEnabled(item)) {
      return;
    }

    this.options.onSelect?.({
      value: item.id,
      index,
      action: item,
      source,
    });
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented) {
      return;
    }

    if (isEditableElement(event.target)) {
      if (event.key === 'Tab') {
        event.preventDefault();
        return;
      }

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const nextIndex = this.findNextEnabledIndex(
          clamp(this.activeIndex, -1, this.options.items.length - 1),
          1,
        );
        this.focusByIndex(nextIndex);
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const startIndex =
          this.activeIndex === -1 ? this.options.items.length : this.activeIndex;
        const nextIndex = this.findNextEnabledIndex(
          clamp(startIndex, 0, this.options.items.length),
          -1,
        );
        this.focusByIndex(nextIndex);
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        if (this.submenuState) {
          this.closeSubmenu();
          this.focusActiveOrContainer();
          return;
        }
        this.options.onCancel?.();
      }
      return;
    }

    if (event.key === 'Tab') {
      event.preventDefault();
      return;
    }

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      const nextIndex = this.findNextEnabledIndex(
        clamp(this.activeIndex, -1, this.options.items.length - 1),
        1,
      );
      this.focusByIndex(nextIndex);
      return;
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      const startIndex =
        this.activeIndex === -1 ? this.options.items.length : this.activeIndex;
      const nextIndex = this.findNextEnabledIndex(
        clamp(startIndex, 0, this.options.items.length),
        -1,
      );
      this.focusByIndex(nextIndex);
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      this.focusByIndex(this.findNextEnabledIndex(-1, 1, false));
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      this.focusByIndex(this.findNextEnabledIndex(this.options.items.length, -1, false));
      return;
    }

    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (this.activeIndex >= 0) {
        if (hasSubmenu(this.options.items[this.activeIndex])) {
          this.openSubmenu(this.activeIndex, 'keyboard');
          return;
        }
        this.selectByIndex(this.activeIndex, 'keyboard');
      }
      return;
    }

    if (event.key === 'ArrowRight') {
      if (this.activeIndex >= 0 && hasSubmenu(this.options.items[this.activeIndex])) {
        event.preventDefault();
        this.openSubmenu(this.activeIndex, 'keyboard');
      }
      return;
    }

    if (event.key === 'ArrowLeft') {
      if (this.submenuState) {
        event.preventDefault();
        this.closeSubmenu();
        this.focusActiveOrContainer();
        return;
      }
      event.preventDefault();
      this.options.onCancel?.();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      if (this.submenuState) {
        this.closeSubmenu();
        this.focusActiveOrContainer();
        return;
      }
      this.options.onCancel?.();
    }
  };

  private openSubmenu(index: number, source: MenuSelectionSource) {
    const item = this.options.items[index];
    const parentElement = this.itemElements[index];
    if (!item || !parentElement || !isActionEnabled(item) || !hasSubmenu(item)) {
      return;
    }

    if (this.submenuState?.parentIndex === index) {
      this.cancelSubmenuClose();
      if (source === 'keyboard') {
        this.submenuState.menu.focusSelectedOrFirstEnabled();
      }
      return;
    }

    this.closeSubmenu();

    const submenu = new Menu({
      items: getSubmenuActions(item) ?? [],
      variant: 'submenu',
      role: 'menu',
      onSelect: (nextEvent) => {
        this.options.onSelect?.(nextEvent);
      },
      onCancel: () => {
        this.closeSubmenu();
        parentElement.focus();
      },
    });
    const submenuElement = submenu.getElement();
    submenuElement.classList.add('comet-menu-submenu');
    const submenuListeners = [
      addDisposableListener(submenuElement, 'mouseenter', this.cancelSubmenuClose),
      addDisposableListener(submenuElement, 'mouseleave', this.handleSubmenuMouseLeave),
    ];
    const host = this.element.parentElement ?? this.element;
    host.append(submenuElement);
    this.layoutSubmenu(submenuElement, parentElement);
    parentElement.setAttribute('aria-expanded', 'true');
    this.submenuState = {
      parentIndex: index,
      parentElement,
      menu: submenu,
      element: submenuElement,
      listeners: submenuListeners,
      source,
    };
    if (source === 'keyboard') {
      submenu.focusSelectedOrFirstEnabled();
    }
  }

  private closeSubmenu() {
    if (!this.submenuState) {
      return;
    }

    this.cancelSubmenuClose();
    this.submenuState.parentElement.setAttribute('aria-expanded', 'false');
    for (const listener of this.submenuState.listeners) {
      listener.dispose();
    }
    this.submenuState.menu.dispose();
    this.submenuState = null;
  }

  private layoutSubmenu(submenuElement: HTMLElement, parentElement: HTMLElement) {
    const parentRect = parentElement.getBoundingClientRect();
    const submenuRect = submenuElement.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;

    const opensToLeft =
      parentRect.right + SUBMENU_OFFSET_PX + submenuRect.width > viewportWidth - VIEWPORT_MARGIN_PX;
    const left = opensToLeft
      ? Math.max(
          VIEWPORT_MARGIN_PX,
          parentRect.left - SUBMENU_OFFSET_PX - submenuRect.width,
        )
      : parentRect.right + SUBMENU_OFFSET_PX;
    const maxTop = Math.max(
      VIEWPORT_MARGIN_PX,
      viewportHeight - submenuRect.height - VIEWPORT_MARGIN_PX,
    );
    const top = clamp(parentRect.top, VIEWPORT_MARGIN_PX, maxTop);

    submenuElement.classList.toggle('comet-is-left', opensToLeft);
    submenuElement.classList.toggle('comet-is-right', !opensToLeft);
    submenuElement.style.position = 'fixed';
    submenuElement.style.left = `${Math.round(left)}px`;
    submenuElement.style.top = `${Math.round(top)}px`;
  }
}
