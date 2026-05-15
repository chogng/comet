import * as DOM from 'ls/base/browser/dom';
import type {
  ContextMenuAction,
  ContextMenuService,
} from 'ls/base/browser/contextmenu';
import {
  ActionViewItem,
  BaseActionViewItem,
} from 'ls/base/browser/ui/actionbar/actionViewItems';
import { createContextViewController } from 'ls/base/browser/ui/contextview/contextview';
import type {
  ActionBarActionItem,
  ActionBarActionMode,
  ActionView,
  ActionBarMenuItem,
  ActionBarRenderable,
} from 'ls/base/browser/ui/actionbar/actionbar';
import type { HoverService } from 'ls/base/browser/ui/hover/hover';
import { createPlatformContextMenuService } from 'ls/platform/contextview/browser/contextMenuService';

export type DropdownMenuActionAlignment = 'start' | 'end';
export type DropdownMenuActionPosition = 'auto' | 'above' | 'below';
export type DropdownMenuActionAlignmentPolicy =
  | 'strict-start'
  | 'strict-end'
  | 'prefer-start'
  | 'prefer-end'
  | 'edge-aware';
export type DropdownMenuActionAlignmentProvider = (
  anchor: HTMLElement,
) => DropdownMenuActionAlignment | undefined;
type ResolvedDropdownMenuActionAlignment = DropdownMenuActionAlignment;

export type DropdownMenuActionOverlayContext = {
  hide: () => void;
};

export type DropdownMenuHeaderContext = {
  updateMenu: (menu: readonly ActionBarMenuItem[]) => void;
  hide: () => void;
};

export type DropdownMenuHeader = {
  className?: string;
  autoFocusOnShow?: boolean;
  render: (context: DropdownMenuHeaderContext) => HTMLElement;
};

export type DropdownMenuActionViewItemOptions = {
  id?: string;
  label: string;
  title?: string;
  content?: ActionBarRenderable;
  disabled?: boolean;
  active?: boolean;
  checked?: boolean;
  mode?: ActionBarActionMode;
  className?: string;
  buttonClassName?: string;
  buttonAttributes?: Record<string, string | null | undefined | false>;
  hover?: import('ls/base/browser/ui/hover/hover').HoverInput;
  menu?: readonly ActionBarMenuItem[];
  menuHeader?: DropdownMenuHeader;
  renderOverlay?: (context: DropdownMenuActionOverlayContext) => HTMLElement;
  overlayRole?: string;
  menuClassName?: string;
  menuData?: string;
  minWidth?: number;
  hoverService?: HoverService;
  contextMenuService?: ContextMenuService;
  overlayAlignment?: DropdownMenuActionAlignment;
  overlayAlignmentPolicy?: DropdownMenuActionAlignmentPolicy;
  overlayAlignmentProvider?: DropdownMenuActionAlignmentProvider;
  overlayPosition?: DropdownMenuActionPosition;
  offset?: number;
};

export type ActionWithDropdownActionViewItemOptions = {
  primary: Omit<
    ActionBarActionItem,
    | 'menu'
    | 'renderOverlay'
    | 'overlayRole'
    | 'menuClassName'
    | 'minWidth'
    | 'contextMenuService'
    | 'overlayAlignment'
    | 'overlayPosition'
  >;
  dropdown: DropdownMenuActionViewItemOptions;
  className?: string;
};

type DropdownActionOverlayRequest = {
  anchor: HTMLElement;
  className?: string;
  minWidth?: number;
  alignment?: ResolvedDropdownMenuActionAlignment;
  position?: DropdownMenuActionPosition;
  offset?: number;
  render: (context: DropdownMenuActionOverlayContext) => HTMLElement;
  onHide: () => void;
};

type DropdownMenuOpenSource = 'keyboard' | 'pointer';
const VIEWPORT_MARGIN_PX = 8;
const DEFAULT_MENU_MIN_WIDTH_PX = 180;

function resolvePolicyAlignment(options: {
  anchor: HTMLElement;
  minWidth?: number;
  policy: DropdownMenuActionAlignmentPolicy;
}): ResolvedDropdownMenuActionAlignment {
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  if (viewportWidth <= 0) {
    return options.policy === 'strict-end' || options.policy === 'prefer-end'
      ? 'end'
      : 'start';
  }

  const anchorRect = options.anchor.getBoundingClientRect();
  const estimatedWidth = Math.max(options.minWidth ?? DEFAULT_MENU_MIN_WIDTH_PX, 1);
  const spaceToRight = viewportWidth - anchorRect.left - VIEWPORT_MARGIN_PX;
  const spaceToLeft = anchorRect.right - VIEWPORT_MARGIN_PX;
  const canFitStart = spaceToRight >= estimatedWidth;
  const canFitEnd = spaceToLeft >= estimatedWidth;

  if (options.policy === 'strict-start') {
    return 'start';
  }

  if (options.policy === 'strict-end') {
    return 'end';
  }

  if (options.policy === 'prefer-start') {
    return canFitStart || !canFitEnd ? 'start' : 'end';
  }

  if (options.policy === 'prefer-end') {
    return canFitEnd || !canFitStart ? 'end' : 'start';
  }

  if (canFitStart && !canFitEnd) {
    return 'start';
  }

  if (canFitEnd && !canFitStart) {
    return 'end';
  }

  if (canFitStart && canFitEnd) {
    return 'start';
  }

  return spaceToRight >= spaceToLeft ? 'start' : 'end';
}

function resolveDropdownAlignment(
  options: Pick<
    DropdownMenuActionViewItemOptions,
    'overlayAlignment' | 'overlayAlignmentPolicy' | 'overlayAlignmentProvider' | 'minWidth'
  >,
  anchor: HTMLElement,
): ResolvedDropdownMenuActionAlignment {
  const providedAlignment = options.overlayAlignmentProvider?.(anchor);
  if (providedAlignment) {
    return providedAlignment;
  }

  if (options.overlayAlignment) {
    return options.overlayAlignment;
  }

  const policy = options.overlayAlignmentPolicy;
  if (!policy) {
    return 'start';
  }

  return resolvePolicyAlignment({
    anchor,
    minWidth: options.minWidth,
    policy,
  });
}

function createContextMenuValue(
  action: Pick<ActionBarMenuItem, 'id'>,
  fallbackValue: string,
) {
  return action.id ?? fallbackValue;
}

function toContextMenuActions(
  menuItems: readonly ActionBarMenuItem[],
  valueToMenuItem: Map<string, ActionBarMenuItem>,
  parentKey = 'dropdown-menu-action-option',
): ContextMenuAction[] {
  return menuItems.map((menuItem, index) => {
    const value = createContextMenuValue(
      menuItem,
      `${parentKey}-${index}`,
    );
    valueToMenuItem.set(value, menuItem);

    return {
      value,
      label: menuItem.label,
      title: menuItem.title,
      icon: menuItem.icon,
      description: menuItem.description,
      disabled: menuItem.disabled,
      checked: menuItem.checked,
      checkedDisplay: menuItem.checkedDisplay,
      keepOpenOnClick: menuItem.keepOpenOnClick,
      run: menuItem.run,
      submenu: menuItem.submenu
        ? toContextMenuActions(
            menuItem.submenu,
            valueToMenuItem,
            `${parentKey}-${index}`,
          )
        : undefined,
    };
  });
}

function runContextMenuAction(
  valueToMenuItem: ReadonlyMap<string, ActionBarMenuItem>,
  value: string,
) {
  const menuItem = valueToMenuItem.get(value) ?? null;
  if (!menuItem || menuItem.disabled) {
    return;
  }

  if (menuItem.onClick) {
    menuItem.onClick(new MouseEvent('click'));
    return;
  }

  menuItem.run?.();
}

class DomDropdownActionOverlayPresenter {
  private readonly contextView = createContextViewController();
  private overlayView: HTMLElement | null = null;
  private currentRequest: DropdownActionOverlayRequest | null = null;
  private placementSyncFrame: number | null = null;

  show(request: DropdownActionOverlayRequest) {
    this.currentRequest = request;
    const overlay = request.render({
      hide: () => this.hide(),
    });
    this.overlayView?.remove();
    this.overlayView = overlay;
    this.contextView.show({
      anchor: request.anchor,
      className: request.className,
      render: () => overlay,
      onHide: this.handleHide,
      position: request.position ?? 'below',
      alignment: request.alignment ?? 'start',
      offset: request.offset,
      minWidth: request.minWidth,
    });
    this.syncOverlayPlacementClass();
    this.schedulePlacementClassSync();
  }

  hide = () => {
    this.contextView.hide();
  };

  dispose() {
    if (this.placementSyncFrame !== null) {
      cancelAnimationFrame(this.placementSyncFrame);
      this.placementSyncFrame = null;
    }
    this.overlayView?.remove();
    this.overlayView = null;
    this.currentRequest = null;
    this.contextView.dispose();
  }

  private readonly handleHide = () => {
    if (this.placementSyncFrame !== null) {
      cancelAnimationFrame(this.placementSyncFrame);
      this.placementSyncFrame = null;
    }
    const request = this.currentRequest;
    this.overlayView = null;
    this.currentRequest = null;
    request?.onHide();
  };

  private schedulePlacementClassSync() {
    if (this.placementSyncFrame !== null) {
      cancelAnimationFrame(this.placementSyncFrame);
    }

    this.placementSyncFrame = requestAnimationFrame(() => {
      this.placementSyncFrame = null;
      this.syncOverlayPlacementClass();
    });
  }

  private syncOverlayPlacementClass() {
    const overlay = this.overlayView;
    if (!overlay) {
      return;
    }

    const contextViewElement = this.contextView.getViewElement();
    overlay.classList.toggle('dropdown-menu-top', contextViewElement.classList.contains('top'));
    overlay.classList.toggle('dropdown-menu-bottom', contextViewElement.classList.contains('bottom'));
  }
}

class ContextMenuDropdownActionPresenter {
  private defaultContextMenuService: ContextMenuService | null = null;

  constructor(
    private readonly getOptions: () => DropdownMenuActionViewItemOptions,
    private readonly getAnchor: () => HTMLElement,
    private readonly onHide: () => void,
  ) {}

  show = (source: DropdownMenuOpenSource) => {
    const options = this.getOptions();
    const anchor = this.getAnchor();
    const resolvedAlignment = resolveDropdownAlignment(
      options,
      anchor,
    );
    let valueToMenuItem = new Map<string, ActionBarMenuItem>();
    let menuActions = toContextMenuActions(options.menu ?? [], valueToMenuItem);
    const menuHeader = options.menuHeader;
    const menuData = options.menuData?.trim();
    const openedFromKeyboard = source === 'keyboard';
    if (menuActions.length === 0 && !menuHeader) {
      return;
    }

    this.getOrCreateContextMenuService().showContextMenu({
      getAnchor: () => anchor,
      getActions: () => menuActions,
      getMenuHeader: menuHeader
        ? () => ({
            className: menuHeader.className,
            autoFocusOnShow: menuHeader.autoFocusOnShow,
            render: ({ updateActions, hide }) =>
              menuHeader.render({
                hide,
                updateMenu: (nextMenuItems) => {
                  valueToMenuItem = new Map<string, ActionBarMenuItem>();
                  menuActions = toContextMenuActions(
                    nextMenuItems,
                    valueToMenuItem,
                  );
                  updateActions(menuActions);
                },
              }),
          })
        : undefined,
      getMenuClassName: options.menuClassName ? () => options.menuClassName! : undefined,
      getMenuData: menuData ? () => menuData : undefined,
      anchorAlignment: resolvedAlignment === 'end' ? 'right' : 'left',
      alignment: resolvedAlignment,
      position: options.overlayPosition ?? 'below',
      offset: options.offset,
      minWidth: options.minWidth,
      autoFocusOnShow: openedFromKeyboard,
      restoreFocusOnHide: openedFromKeyboard,
      onHide: this.onHide,
      onSelect: (value: string) => {
        const selectedMenuItem = valueToMenuItem.get(value) ?? null;
        runContextMenuAction(valueToMenuItem, value);
        if (selectedMenuItem?.keepOpenOnClick) {
          valueToMenuItem = new Map<string, ActionBarMenuItem>();
          menuActions = toContextMenuActions(
            this.getOptions().menu ?? [],
            valueToMenuItem,
          );
        }
      },
    });
  };

  hide = () => {
    this.resolveContextMenuService(this.getOptions())?.hideContextMenu();
  };

  dispose = () => {
    this.hide();
    this.defaultContextMenuService?.dispose?.();
    this.defaultContextMenuService = null;
  };

  syncOptions(previousOptions: DropdownMenuActionViewItemOptions) {
    const previousContextMenuService = this.resolveContextMenuService(previousOptions);
    const nextContextMenuService = this.resolveContextMenuService(this.getOptions());
    if (previousContextMenuService && previousContextMenuService !== nextContextMenuService) {
      previousContextMenuService.hideContextMenu();
    }
  }

  private getOrCreateContextMenuService() {
    const options = this.getOptions();
    if (options.contextMenuService) {
      return options.contextMenuService;
    }

    this.defaultContextMenuService ??= createPlatformContextMenuService();
    return this.defaultContextMenuService;
  }

  private resolveContextMenuService(options: DropdownMenuActionViewItemOptions) {
    return options.contextMenuService ?? this.defaultContextMenuService;
  }
}

export class DropdownMenuActionViewItem extends ActionViewItem {
  private readonly overlayPresenter = new DomDropdownActionOverlayPresenter();
  private readonly menuPresenter = new ContextMenuDropdownActionPresenter(
    () => this.options,
    () => this.anchorElement ?? this.button,
    () => {
      this.updateOpenState(false);
    },
  );
  private isOpen = false;
  anchorElement: HTMLElement | null = null;

  private get options(): DropdownMenuActionViewItemOptions {
    return this.item as DropdownMenuActionViewItemOptions;
  }

  constructor(options: DropdownMenuActionViewItemOptions) {
    super(options, options.hoverService);
    this.register(DOM.addDisposableListener(this.button, 'keydown', this.handleKeyDown));
    this.render();
  }

  setOptions(options: DropdownMenuActionViewItemOptions) {
    const previousOptions = this.options;
    const usedCustomOverlay = Boolean(previousOptions.renderOverlay);
    this.setItem(options);
    this.menuPresenter.syncOptions(previousOptions);
    if (usedCustomOverlay || this.options.renderOverlay) {
      this.overlayPresenter.hide();
    }
    this.render();
  }

  override render(container?: HTMLElement) {
    if (this.isDisposed()) {
      return;
    }

    super.render(container);
    this.button.setAttribute('aria-haspopup', this.options.overlayRole ?? 'menu');
    this.button.setAttribute('aria-expanded', String(this.isOpen));
  }

  protected override updateContainerClassName() {
    this.element.className = DOM.composeClassName([
      'actionbar-item',
      'is-action',
      this.item.disabled ? 'is-disabled' : '',
      this.item.active || this.isOpen ? 'is-active' : '',
      this.item.checked ? 'is-checked' : '',
      this.item.className,
    ]);
  }

  show(source: DropdownMenuOpenSource = 'pointer') {
    if (this.item.disabled || this.isDisposed() || this.isOpen) {
      return;
    }

    // Custom overlays are intentionally prioritized over menu mode so callers
    // can host rich panels (history/model switch/popovers) in the same trigger.
    if (this.options.renderOverlay) {
      this.updateOpenState(true);
      this.overlayPresenter.show(this.createOverlayRequest());
      return;
    }

    if ((this.options.menu?.length ?? 0) === 0 && !this.options.menuHeader) {
      return;
    }

    this.updateOpenState(true);
    this.menuPresenter.show(source);
  }

  hide() {
    if (this.options.renderOverlay) {
      this.overlayPresenter.hide();
      return;
    }

    this.menuPresenter.hide();
  }

  override dispose() {
    if (this.isDisposed()) {
      return;
    }

    this.hide();
    this.overlayPresenter.dispose();
    this.menuPresenter.dispose();
    super.dispose();
  }

  private createOverlayRequest(): DropdownActionOverlayRequest {
    const anchor = this.anchorElement ?? this.button;
    const resolvedAlignment = resolveDropdownAlignment(
      this.options,
      anchor,
    );

    return {
      anchor,
      className: DOM.composeClassName(['actionbar-context-view', this.options.menuClassName]),
      minWidth: this.options.minWidth,
      alignment: resolvedAlignment,
      position: this.options.overlayPosition ?? 'below',
      offset: this.options.offset,
      render: (context) => this.options.renderOverlay?.(context) ?? DOM.createElement('div'),
      onHide: () => {
        this.updateOpenState(false);
      },
    };
  }

  private updateOpenState(isOpen: boolean) {
    this.isOpen = isOpen;
    this.button.setAttribute('aria-expanded', String(isOpen));
    this.updateContainerClassName();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') {
      return;
    }

    event.preventDefault();
    this.show('keyboard');
  };

  protected override readonly handleClick = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (this.isOpen) {
      this.hide();
      return;
    }
    this.show('pointer');
  };
}

export class ActionWithDropdownActionViewItem extends BaseActionViewItem {
  private readonly primaryItem: ActionViewItem;
  protected readonly dropdownMenuActionViewItem: DropdownMenuActionViewItem;
  private readonly separator = DOM.createElement('div', 'action-dropdown-item-separator');

  constructor(options: ActionWithDropdownActionViewItemOptions) {
    super(DOM.createElement('div', 'actionbar-item is-action action-dropdown-item'));
    const hoverService = options.primary.hoverService ?? options.dropdown.hoverService;
    this.primaryItem = new ActionViewItem(options.primary, hoverService);
    this.dropdownMenuActionViewItem = new DropdownMenuActionViewItem({
      ...options.dropdown,
      hoverService: options.dropdown.hoverService ?? hoverService,
    });
    // Anchor the dropdown menu to the whole split button container so the
    // popup aligns with the combined primary+chevron visual unit.
    this.dropdownMenuActionViewItem.anchorElement = this.element;
    if (options.className) {
      this.element.classList.add(...options.className.split(/\s+/).filter(Boolean));
    }
    this.separator.append(DOM.createElement('div'));
    this.primaryItem.render(this.element);
    this.element.append(this.separator);
    this.dropdownMenuActionViewItem.render(this.element);
    this.register(DOM.addDisposableListener(this.element, 'keydown', this.handleKeyDown));
  }

  override render(container?: HTMLElement) {
    if (this.isDisposed()) {
      return;
    }

    super.render(container);
    this.primaryItem.render(this.element);
    this.dropdownMenuActionViewItem.render(this.element);
  }

  override dispose() {
    if (this.isDisposed()) {
      return;
    }

    this.primaryItem.dispose();
    this.dropdownMenuActionViewItem.dispose();
    super.dispose();
  }

  focus() {
    this.primaryItem.focus();
  }

  blur() {
    this.primaryItem.blur();
    this.dropdownMenuActionViewItem.blur();
  }

  getFocusableElement() {
    return this.primaryItem.getFocusableElement?.() ?? this.primaryItem.getElement();
  }

  private readonly handleKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowRight' && document.activeElement === this.primaryItem.getFocusableElement?.()) {
      event.preventDefault();
      this.primaryItem.blur();
      this.dropdownMenuActionViewItem.focus();
      return;
    }

    if (
      event.key === 'ArrowLeft' &&
      document.activeElement === this.dropdownMenuActionViewItem.getFocusableElement?.()
    ) {
      event.preventDefault();
      this.dropdownMenuActionViewItem.blur();
      this.primaryItem.focus();
    }
  };
}

export function createDropdownMenuActionViewItem(
  options: DropdownMenuActionViewItemOptions,
): ActionView {
  return new DropdownMenuActionViewItem({
    ...options,
    menu: options.menu ? [...options.menu] : undefined,
  });
}

export function createActionWithDropdownActionViewItem(
  options: ActionWithDropdownActionViewItemOptions,
): ActionWithDropdownActionViewItem {
  return new ActionWithDropdownActionViewItem(options);
}
