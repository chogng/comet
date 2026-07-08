import type {
  ContextMenuDelegate as BaseContextMenuDelegate,
  ContextMenuService as BaseContextMenuService,
} from 'cs/base/browser/contextmenu';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type {
  AnchorAlignment,
  AnchorAxisAlignment,
  AnchorPosition,
  ContextViewAnchor,
  ContextViewAlignment,
  ContextViewPosition,
} from 'cs/base/browser/ui/contextview/contextview';

export type ContextViewRenderResult =
  | void
  | (() => void)
  | {
    dispose: () => void;
  };

export interface ContextViewDelegate {
  canRelayout?: boolean;
  getAnchor: () => ContextViewAnchor;
  render: (container: HTMLElement) => ContextViewRenderResult;
  onHide?: (data?: unknown) => void;
  className?: string;
  anchorAlignment?: AnchorAlignment;
  anchorPosition?: AnchorPosition;
  anchorAxisAlignment?: AnchorAxisAlignment;
  alignment?: ContextViewAlignment;
  position?: ContextViewPosition;
  offset?: number;
  matchAnchorWidth?: boolean;
  minWidth?: number;
}

export const IContextViewService =
  createDecorator<IContextViewService>('contextViewService');

export interface ContextViewDisposable {
  dispose: () => void;
}

export interface IContextViewService {
  readonly _serviceBrand: undefined;
  showContextView: (delegate: ContextViewDelegate) => ContextViewDisposable;
  hideContextView: (data?: unknown) => void;
  getContextViewElement: () => HTMLElement;
  layout: () => void;
  isVisible: () => boolean;
  dispose: () => void;
}

export type ContextMenuDelegate = BaseContextMenuDelegate;

export type ContextMenuListener = () => void;
export interface ContextMenuListenerDisposable {
  dispose: () => void;
}

export interface ContextMenuService extends BaseContextMenuService {
  onDidShowContextMenu: (listener: ContextMenuListener) => ContextMenuListenerDisposable;
  onDidHideContextMenu: (listener: ContextMenuListener) => ContextMenuListenerDisposable;
  dispose: () => void;
}
