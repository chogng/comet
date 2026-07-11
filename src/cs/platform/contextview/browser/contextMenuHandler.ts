import type {
  ContextMenuDelegate,
} from 'cs/base/browser/contextmenu';
import { addDisposableListener, EventType, getWindow } from 'cs/base/browser/dom';
import {
  Menu,
  type MenuAction,
  type MenuHeaderOptions,
  type MenuOptions,
} from 'cs/base/browser/ui/menu/menu';
import { StandardMouseEvent } from 'cs/base/browser/mouseEvent';
import {
  ActionRunner,
  type IAction,
  type IActionRunner,
} from 'cs/base/common/actions';
import type { IContextViewService } from 'cs/platform/contextview/browser/contextView';
import {
  AnchorAlignment,
  AnchorAxisAlignment,
  AnchorPosition,
  getAnchorRect,
  type IAnchor,
} from 'cs/base/browser/ui/contextview/contextview';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';

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

function resolveContextViewAnchor(delegate: ContextMenuDelegate): HTMLElement | IAnchor {
  const anchor = delegate.getAnchor();
  if (!(anchor instanceof HTMLElement)) {
    return anchor;
  }

  const rect = getAnchorRect(anchor);
  const offset = resolveContextMenuOffset(delegate);
  return {
    x: rect.left,
    y: rect.top - offset,
    width: rect.width,
    height: rect.height + offset * 2,
  };
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
    const menu = this.renderMenu(options, delegate, header, actionRunner);

    this.contextViewService.showContextView({
      getAnchor: () => resolveContextViewAnchor(delegate),
      canRelayout: false,
      anchorAlignment: delegate.anchorAlignment === 'right' || delegate.alignment === 'end'
        ? AnchorAlignment.RIGHT
        : AnchorAlignment.LEFT,
      anchorAxisAlignment: delegate.anchorAxisAlignment === 'horizontal'
        ? AnchorAxisAlignment.HORIZONTAL
        : AnchorAxisAlignment.VERTICAL,
      anchorPosition: delegate.position === 'above'
        ? AnchorPosition.ABOVE
        : AnchorPosition.BELOW,
      render: (container) => {
        const menuDisposables = new DisposableStore();
        container.classList.add('comet-actionbar-context-view');
        const menuClassName = delegate.getMenuClassName?.();
        if (menuClassName) {
          container.classList.add(menuClassName);
        }
        container.append(menu.getElement());
        const targetWindow = getWindow(container);
        menuDisposables.add(addDisposableListener(targetWindow, EventType.MOUSE_DOWN, (browserEvent: MouseEvent) => {
          if (browserEvent.defaultPrevented) {
            return;
          }

          const event = new StandardMouseEvent(targetWindow, browserEvent);
          if (event.rightButton || (event.target && container.contains(event.target))) {
            return;
          }

          this.contextViewService.hideContextView({ didCancel: true });
        }));
        menuDisposables.add(toDisposable(() => {
          menu.dispose();
          if (!delegate.actionRunner) {
            actionRunner.dispose();
          }
        }));
        return menuDisposables;
      },
      focus: () => {
        if (header?.autoFocusOnShow) {
          return;
        }

        if (shouldAutoFocusOnShow) {
          menu.focusSelectedOrFirstEnabled();
          return;
        }

        menu.getElement().focus();
      },
      onHide: (data) => {
        this.visible = false;
        const payload = data as ContextMenuHidePayload | undefined;
        delegate.onHide?.(payload?.didCancel ?? true);
        if (shouldRestoreFocusOnHide) {
          this.focusToReturn?.focus();
        }
        this.focusToReturn = null;
      },
    });
    this.visible = true;

    menu.setOptions(this.createMenuOptions(
      () => menu,
      options,
      delegate,
      header,
      actionRunner,
      this.contextViewService.getContextViewElement().classList.contains('top') ? 'top' : 'bottom',
    ));
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
    let menu: Menu;
    menu = new Menu(this.createMenuOptions(
      () => menu,
      options,
      delegate,
      header,
      actionRunner,
      delegate.position === 'above' ? 'top' : 'bottom',
    ));

    return menu;
  }

  private createMenuOptions(
    getMenu: () => Menu,
    items: readonly IAction[],
    delegate: ContextMenuDelegate,
    header: MenuHeaderOptions | undefined,
    actionRunner: IActionRunner,
    placement: 'top' | 'bottom',
  ): MenuOptions {
    const dataMenu = delegate.getMenuData?.();
    return {
      items,
      dataMenu,
      role: 'menu',
      placement,
      header,
      onSelect: ({ action }) => {
        const runResult = actionRunner.run(action, delegate.getActionsContext?.());
        if ((action as MenuAction).keepOpenOnClick) {
          void Promise.resolve(runResult).then(() => {
            const menu = getMenu();
            menu.setOptions(this.createMenuOptions(
              getMenu,
              delegate.getActions(),
              delegate,
              header,
              actionRunner,
              menu.getElement().classList.contains('comet-dropdown-menu-top')
                ? 'top'
                : 'bottom',
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
    };
  }
}
