import type { ContextMenuService as BaseContextMenuService } from 'cs/base/browser/contextmenu';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import { ContextViewDOMPosition } from 'cs/base/browser/ui/contextview/contextview';
import type {
  ContextViewDelegate,
  ContextViewDisposable,
  ContextViewProvider,
  ContextViewRenderResult,
} from 'cs/base/browser/ui/contextview/contextview';

export { ContextViewDOMPosition };

export type {
  ContextViewDelegate,
  ContextViewDisposable,
  ContextViewRenderResult,
};

export const IContextViewService =
  createDecorator<IContextViewService>('contextViewService');

export interface IContextViewService extends ContextViewProvider {
  readonly _serviceBrand: undefined;
}

export type ContextMenuListener = () => void;
export interface ContextMenuListenerDisposable {
  dispose: () => void;
}

export interface ContextMenuService extends BaseContextMenuService {
  onDidShowContextMenu: (listener: ContextMenuListener) => ContextMenuListenerDisposable;
  onDidHideContextMenu: (listener: ContextMenuListener) => ContextMenuListenerDisposable;
  dispose: () => void;
}
