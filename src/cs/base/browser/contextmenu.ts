import type { IMouseEvent } from 'cs/base/browser/mouseEvent';
import { getMouseClientCoordinates } from 'cs/base/browser/mouseEvent';
import type {
  IAction,
  IActionRunner,
} from 'cs/base/common/actions';
import type { IAnchor } from 'cs/base/browser/ui/contextview/contextview';
import type { MenuHeaderOptions } from 'cs/base/browser/ui/menu/menu';

export type ContextMenuAnchor = HTMLElement | IAnchor;

export type ContextMenuAlignment = 'start' | 'end';
export type ContextMenuPosition = 'auto' | 'above' | 'below';
export type ContextMenuAnchorAlignment = 'left' | 'right';
export type ContextMenuAnchorAxisAlignment = 'vertical' | 'horizontal';

export function createMouseContextMenuAnchor(
  event: MouseEvent | IMouseEvent,
): ContextMenuAnchor {
  const { x, y } = getMouseClientCoordinates(event);
  return {
    x,
    y,
    width: 0,
    height: 0,
  };
}

export interface ContextMenuDelegate {
  getAnchor: () => ContextMenuAnchor;
  getActions: () => readonly IAction[];
  getMenuHeader?: () => MenuHeaderOptions | undefined;
  onHide?: (didCancel: boolean) => void;
  actionRunner?: IActionRunner;
  getActionsContext?: () => unknown;
  autoFocusOnShow?: boolean;
  restoreFocusOnHide?: boolean;
  getMenuClassName?: () => string;
  getMenuData?: () => string;
  anchorAlignment?: ContextMenuAnchorAlignment;
  anchorAxisAlignment?: ContextMenuAnchorAxisAlignment;
  alignment?: ContextMenuAlignment;
  position?: ContextMenuPosition;
  offset?: number;
  minWidth?: number;
}

export interface ContextMenuProvider {
  showContextMenu: (delegate: ContextMenuDelegate) => void;
}

export interface ContextMenuService extends ContextMenuProvider {
  hideContextMenu: () => void;
  isVisible: () => boolean;
  dispose?: () => void;
}
