import { ContextMenuHandler } from 'cs/platform/contextview/browser/contextMenuHandler';
import type { ContextMenuDelegate } from 'cs/base/browser/contextmenu';
import {
  IContextMenuService,
  IContextViewService,
  type IContextMenuService as IContextMenuServiceShape,
  type ContextMenuListener,
  type ContextMenuListenerDisposable,
} from 'cs/platform/contextview/browser/contextView';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';

class ListenerEmitter {
  private readonly listeners = new Set<ContextMenuListener>();

  event = (listener: ContextMenuListener): ContextMenuListenerDisposable => {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  };

  fire() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  dispose() {
    this.listeners.clear();
  }
}

export class PlatformContextMenuService implements IContextMenuServiceShape {
  declare readonly _serviceBrand: undefined;

  private readonly contextMenuHandler: ContextMenuHandler;
  private readonly didShowEmitter = new ListenerEmitter();
  private readonly didHideEmitter = new ListenerEmitter();

  readonly onDidShowContextMenu = this.didShowEmitter.event;
  readonly onDidHideContextMenu = this.didHideEmitter.event;

  constructor(
    @IContextViewService contextViewService: IContextViewService,
  ) {
    this.contextMenuHandler = new ContextMenuHandler(contextViewService);
  }

  showContextMenu(delegate: ContextMenuDelegate) {
    this.contextMenuHandler.showContextMenu({
      ...delegate,
      onHide: (didCancel) => {
        delegate.onHide?.(didCancel);
        this.didHideEmitter.fire();
      },
    });
    this.didShowEmitter.fire();
  }

  hideContextMenu = () => {
    this.contextMenuHandler.hideContextMenu();
  };

  isVisible = () => this.contextMenuHandler.isVisible();

  dispose = () => {
    this.contextMenuHandler.dispose();
    this.didShowEmitter.dispose();
    this.didHideEmitter.dispose();
  };
}

registerSingleton(IContextMenuService, PlatformContextMenuService, InstantiationType.Delayed);
