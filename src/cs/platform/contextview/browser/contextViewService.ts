import { createContextViewController } from 'cs/base/browser/ui/contextview/contextview';
import type {
  ContextViewDelegate,
  ContextViewDisposable,
  ContextViewService,
} from 'cs/platform/contextview/browser/contextView';

class PlatformContextViewService implements ContextViewService {
  private readonly contextView = createContextViewController();
  private currentDelegate: ContextViewDelegate | null = null;
  private currentRenderDisposable: ContextViewDisposable | (() => void) | null = null;

  showContextView(delegate: ContextViewDelegate): ContextViewDisposable {
    this.hideContextView();

    this.currentDelegate = delegate;

    const container = document.createElement('div');
    const renderDisposable = delegate.render(container);
    this.currentRenderDisposable = renderDisposable ?? null;

    this.contextView.show({
      anchor: delegate.getAnchor(),
      className: delegate.className,
      render: () => container,
      onHide: this.handleHide,
      anchorAlignment: delegate.anchorAlignment,
      anchorPosition: delegate.anchorPosition,
      anchorAxisAlignment: delegate.anchorAxisAlignment,
      alignment: delegate.alignment,
      position: delegate.position,
      offset: delegate.offset,
      matchAnchorWidth: delegate.matchAnchorWidth,
      minWidth: delegate.minWidth,
    });

    return {
      dispose: () => {
        if (this.currentDelegate === delegate) {
          this.hideContextView();
        }
      },
    };
  }

  hideContextView(data?: unknown) {
    if (!this.contextView.isVisible()) {
      this.cleanupCurrentView();
      return;
    }

    this.contextView.hide(data);
  }

  getContextViewElement = () => this.contextView.getViewElement();

  layout = () => {
    if (this.currentDelegate?.canRelayout === false) {
      return;
    }

    this.contextView.layout();
  };

  isVisible = () => this.contextView.isVisible();

  dispose = () => {
    this.hideContextView();
    this.contextView.dispose();
  };

  private cleanupCurrentView() {
    const renderDisposable = this.currentRenderDisposable;
    this.currentRenderDisposable = null;
    if (typeof renderDisposable === 'function') {
      renderDisposable();
    } else {
      renderDisposable?.dispose();
    }
    this.currentDelegate = null;
  }

  private readonly handleHide = (data?: unknown) => {
    const delegate = this.currentDelegate;
    this.cleanupCurrentView();
    delegate?.onHide?.(data);
  };
}

export function createContextViewService(): ContextViewService {
  return new PlatformContextViewService();
}
