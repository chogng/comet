import type {
  ContextMenuAction,
  ContextMenuHeader,
} from 'ls/base/browser/contextmenu';
import {
  resolveAnchoredVerticalPlacement,
  resolveAnchoredVerticalPlacementWithFallback,
  type AnchoredRect,
} from 'ls/base/browser/ui/contextview/contextview';
import { Menu } from 'ls/base/browser/ui/menu/menu';
import type {
  ContextMenuDelegate,
  ContextViewService,
} from 'ls/platform/contextview/browser/contextView';

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

function resolveAnchorRect(delegate: ContextMenuDelegate): AnchoredRect {
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

function resolveMenuPlacement(
  delegate: ContextMenuDelegate,
  menuHeight: number,
): 'top' | 'bottom' {
  const viewportHeight =
    window.innerHeight || document.documentElement.clientHeight || 0;
  const placement = resolveAnchoredVerticalPlacement({
    anchorRect: resolveAnchorRect(delegate),
    overlayHeight: menuHeight,
    viewportHeight,
    viewportMargin: 8,
    offset: resolveContextMenuOffset(delegate),
    preference: delegate.position ?? 'auto',
  });
  const resolvedPlacement = resolveAnchoredVerticalPlacementWithFallback({
    preference: delegate.position ?? 'auto',
    placement,
  });
  return resolvedPlacement === 'above' ? 'top' : 'bottom';
}

export class ContextMenuHandler {
  private focusToReturn: HTMLElement | null = null;

  constructor(private readonly contextViewService: ContextViewService) {}

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
        'actionbar-context-view',
        delegate.getMenuClassName?.(),
      ]),
      anchorAlignment: delegate.anchorAlignment
        ?? (delegate.alignment === 'start' ? 'left' : 'right'),
      anchorPosition: delegate.position === 'above' ? 'above' : 'below',
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
    const menu = new Menu({
      items: options,
      dataMenu,
      role: 'menu',
      placement: delegate.position === 'above' ? 'top' : 'bottom',
      header: menuHeader,
      onSelect: ({ value }) => {
        delegate.onSelect?.(value);
        this.contextViewService.hideContextView({
          didCancel: false,
          value,
        });
      },
      onCancel: () => {
        this.contextViewService.hideContextView({ didCancel: true });
      },
    });

    queueMicrotask(() => {
      const placement = resolveMenuPlacement(
        delegate,
        menu.getElement().getBoundingClientRect().height,
      );
      menu.setOptions({
        items: options,
        dataMenu,
        role: 'menu',
        placement,
        header: menuHeader,
        onSelect: ({ value }) => {
          delegate.onSelect?.(value);
          this.contextViewService.hideContextView({
            didCancel: false,
            value,
          });
        },
        onCancel: () => {
          this.contextViewService.hideContextView({ didCancel: true });
        },
      });
    });

    return menu;
  }
}
