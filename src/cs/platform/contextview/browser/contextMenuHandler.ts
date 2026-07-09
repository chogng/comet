import type {
  ContextMenuAction,
  ContextMenuHeader,
} from 'cs/base/browser/contextmenu';
import {
  LayoutAnchorPosition,
  layout,
  type ILayoutAnchor,
} from 'cs/base/common/layout';
import { Menu, type MenuOptions } from 'cs/base/browser/ui/menu/menu';
import type {
  ContextMenuDelegate,
  IContextViewService,
} from 'cs/platform/contextview/browser/contextView';

function composeClassName(parts: Array<string | undefined | null | false>) {
  return parts.filter(Boolean).join(' ');
}

type ContextMenuHidePayload = {
  didCancel: boolean;
  value?: string;
};

const ELEMENT_CONTEXT_MENU_OFFSET_PX = 4;

function resolveContextMenuOffset(delegate: ContextMenuDelegate) {
  if (typeof delegate.offset === 'number') {
    return delegate.offset;
  }

  return delegate.getAnchor() instanceof HTMLElement
    ? ELEMENT_CONTEXT_MENU_OFFSET_PX
    : 0;
}

function resolveAnchorRect(delegate: ContextMenuDelegate) {
  const anchor = delegate.getAnchor();
  if (anchor instanceof HTMLElement) {
    const rect = anchor.getBoundingClientRect();
    return {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    };
  }

  return {
    x: anchor.x,
    y: anchor.y,
    width: anchor.width ?? 0,
    height: anchor.height ?? 0,
  };
}

function resolveVerticalAnchor(
  delegate: ContextMenuDelegate,
  offset: number,
): ILayoutAnchor {
  const anchorRect = resolveAnchorRect(delegate);
  return {
    offset: anchorRect.y - offset,
    size: anchorRect.height + offset * 2,
    position: delegate.position === 'above'
      ? LayoutAnchorPosition.After
      : LayoutAnchorPosition.Before,
  };
}

function resolveMenuPlacement(
  delegate: ContextMenuDelegate,
  menuHeight: number,
): 'top' | 'bottom' {
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;
  const anchor = resolveVerticalAnchor(delegate, resolveContextMenuOffset(delegate));
  const result = layout(viewportHeight, menuHeight, anchor);
  return result.position + menuHeight <= anchor.offset ? 'top' : 'bottom';
}

export class ContextMenuHandler {
  private focusToReturn: HTMLElement | null = null;

  constructor(private readonly contextViewService: IContextViewService) {}

  showContextMenu(delegate: ContextMenuDelegate) {
    const options = [...delegate.getActions()];
    const header = delegate.getMenuHeader?.();
    if (options.length === 0 && !header) {
      return;
    }

    const shouldRestoreFocusOnHide = delegate.restoreFocusOnHide ?? true;
    const shouldAutoFocusOnShow = delegate.autoFocusOnShow ?? true;
    this.focusToReturn =
      shouldRestoreFocusOnHide && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    this.contextViewService.showContextView({
      getAnchor: delegate.getAnchor,
      canRelayout: false,
      className: composeClassName([
        'comet-actionbar-context-view',
        delegate.getMenuClassName?.(),
      ]),
      anchorAlignment: delegate.anchorAlignment
        ?? (delegate.alignment === 'end' ? 'right' : 'left'),
      position: delegate.position ?? 'auto',
      anchorAxisAlignment: delegate.anchorAxisAlignment ?? 'vertical',
      offset: resolveContextMenuOffset(delegate),
      minWidth: delegate.minWidth,
      render: (container) => {
        const menu = this.renderMenu(options, delegate, header);
        container.append(menu.getElement());
        queueMicrotask(() => {
          if (header?.autoFocusOnShow) {
            return;
          }
          if (shouldAutoFocusOnShow) {
            menu.focusSelectedOrFirstEnabled();
            return;
          }
          // For pointer-triggered menus, keep focus inside the menu surface
          // without forcing item-level focus rings.
          menu.getElement().focus();
        });
        return () => {
          menu.dispose();
        };
      },
      onHide: (data) => {
        const payload = data as ContextMenuHidePayload | undefined;
        delegate.onHide?.(payload?.didCancel ?? true);
        if (shouldRestoreFocusOnHide) {
          this.focusToReturn?.focus();
        }
        this.focusToReturn = null;
      },
    });
  }

  hideContextMenu(didCancel = true) {
    this.contextViewService.hideContextView({ didCancel });
  }

  isVisible = () => this.contextViewService.isVisible();

  dispose = () => {
    this.hideContextMenu();
  };

  private renderMenu(
    options: readonly ContextMenuAction[],
    delegate: ContextMenuDelegate,
    header?: ContextMenuHeader,
  ) {
    const dataMenu = delegate.getMenuData?.();
    const menuHeader = header
      ? {
          className: header.className,
          autoFocusOnShow: header.autoFocusOnShow,
          render: ({ updateItems, hide }: { updateItems: (items: readonly ContextMenuAction[]) => void; hide: () => void }) =>
            header.render({
              updateActions: updateItems,
              hide,
            }),
        }
      : undefined;
    let menu: Menu;
    const resolveCurrentPlacement = (): 'top' | 'bottom' =>
      menu.getElement().classList.contains('dropdown-menu-top')
        ? 'top'
        : 'bottom';
    const createMenuOptions = (
      items: readonly ContextMenuAction[],
      placement: 'top' | 'bottom',
    ): MenuOptions => ({
        items,
        dataMenu,
        role: 'menu',
        placement,
        header: menuHeader,
        onSelect: ({ value, item }) => {
        delegate.onSelect?.(value);
        if (item.keepOpenOnClick) {
          menu.setOptions(createMenuOptions(
            delegate.getActions(),
            resolveCurrentPlacement(),
          ));
          return;
        }
        this.contextViewService.hideContextView({
          didCancel: false,
          value,
        });
      },
      onCancel: () => {
        this.contextViewService.hideContextView({ didCancel: true });
      },
    });
    menu = new Menu(createMenuOptions(
      options,
      delegate.position === 'above' ? 'top' : 'bottom',
    ));

    queueMicrotask(() => {
      const placement = resolveMenuPlacement(
        delegate,
        menu.getElement().getBoundingClientRect().height,
      );
      menu.setOptions(createMenuOptions(options, placement));
    });

    return menu;
  }
}
