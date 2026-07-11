import type {
  ContextMenuDelegate,
} from 'cs/base/browser/contextmenu';
import {
  LayoutAnchorPosition,
  layout,
  type ILayoutAnchor,
} from 'cs/base/common/layout';
import {
  Menu,
  type MenuAction,
  type MenuHeaderOptions,
  type MenuOptions,
} from 'cs/base/browser/ui/menu/menu';
import {
  ActionRunner,
  type IAction,
  type IActionRunner,
} from 'cs/base/common/actions';
import type { IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { AnchorAlignment, AnchorAxisAlignment } from 'cs/base/browser/ui/contextview/contextview';
import { toDisposable } from 'cs/base/common/lifecycle';

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
  private visible = false;

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
    const actionRunner = delegate.actionRunner ?? new ActionRunner();
    let menu: Menu | null = null;

    this.visible = true;
    this.contextViewService.showContextView({
      getAnchor: delegate.getAnchor,
      canRelayout: false,
      anchorAlignment: delegate.anchorAlignment === 'right' || delegate.alignment === 'end'
        ? AnchorAlignment.RIGHT
        : AnchorAlignment.LEFT,
      anchorAxisAlignment: delegate.anchorAxisAlignment === 'horizontal'
        ? AnchorAxisAlignment.HORIZONTAL
        : AnchorAxisAlignment.VERTICAL,
      render: (container) => {
        menu = this.renderMenu(options, delegate, header, actionRunner);
        container.classList.add('comet-actionbar-context-view');
        const menuClassName = delegate.getMenuClassName?.();
        if (menuClassName) {
          container.classList.add(menuClassName);
        }
        container.append(menu.getElement());
        return toDisposable(() => {
          menu?.dispose();
          if (!delegate.actionRunner) {
            actionRunner.dispose();
          }
          menu = null;
        });
      },
      focus: () => {
        if (!menu || header?.autoFocusOnShow) {
          return;
        }

        if (shouldAutoFocusOnShow) {
          menu.focusSelectedOrFirstEnabled();
          return;
        }

        menu.getElement().focus();
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
    this.visible = false;
    this.contextViewService.hideContextView({ didCancel });
  }

  isVisible = () => this.visible;

  dispose = () => {
    this.hideContextMenu();
  };

  private renderMenu(
    options: readonly IAction[],
    delegate: ContextMenuDelegate,
    header: MenuHeaderOptions | undefined,
    actionRunner: IActionRunner,
  ) {
    const dataMenu = delegate.getMenuData?.();
    let menu: Menu;
    const resolveCurrentPlacement = (): 'top' | 'bottom' =>
      menu.getElement().classList.contains('dropdown-menu-top')
        ? 'top'
        : 'bottom';
    const createMenuOptions = (
      items: readonly IAction[],
      placement: 'top' | 'bottom',
    ): MenuOptions => ({
      items,
      dataMenu,
      role: 'menu',
      placement,
      header,
      onSelect: ({ action }) => {
        const runResult = actionRunner.run(action, delegate.getActionsContext?.());
        if ((action as MenuAction).keepOpenOnClick) {
          void Promise.resolve(runResult).then(() => {
            menu.setOptions(createMenuOptions(
              delegate.getActions(),
              resolveCurrentPlacement(),
            ));
          });
          return;
        }
        this.contextViewService.hideContextView({
          didCancel: false,
          value: action.id,
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
