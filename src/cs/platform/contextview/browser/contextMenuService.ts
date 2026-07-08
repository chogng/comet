import { ContextMenuHandler } from 'cs/platform/contextview/browser/contextMenuHandler';
import type {
  ContextMenuDelegate,
  ContextMenuListener,
  ContextMenuListenerDisposable,
  ContextMenuService,
} from 'cs/platform/contextview/browser/contextView';
import { PlatformContextViewService } from 'cs/platform/contextview/browser/contextViewService';

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

class PlatformContextMenuService implements ContextMenuService {
  private readonly contextViewService = new PlatformContextViewService();
  private readonly contextMenuHandler = new ContextMenuHandler(this.contextViewService);
  private readonly didShowEmitter = new ListenerEmitter();
  private readonly didHideEmitter = new ListenerEmitter();

  readonly onDidShowContextMenu = this.didShowEmitter.event;
  readonly onDidHideContextMenu = this.didHideEmitter.event;

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
    this.contextViewService.dispose();
    this.didShowEmitter.dispose();
    this.didHideEmitter.dispose();
  };
}

export function createPlatformContextMenuService(): ContextMenuService {
  return new PlatformContextMenuService();
}
