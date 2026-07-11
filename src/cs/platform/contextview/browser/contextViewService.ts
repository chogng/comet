import {
  ContextViewDOMPosition as DOMPosition,
  createContextViewController,
} from 'cs/base/browser/ui/contextview/contextview';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import type {
  ContextViewDelegate,
  ContextViewDisposable,
} from 'cs/platform/contextview/browser/contextView';
import { IContextViewService } from 'cs/platform/contextview/browser/contextView';

export class PlatformContextViewService implements IContextViewService {
  declare readonly _serviceBrand: undefined;

  private readonly contextView = createContextViewController();
  private currentDelegate: ContextViewDelegate | null = null;
  private currentRenderDisposable: ContextViewDisposable | (() => void) | null = null;

  showContextView(
    delegate: ContextViewDelegate,
    container?: HTMLElement,
    shadowRoot = false,
  ): ContextViewDisposable {
    this.hideContextView();

    this.currentDelegate = delegate;

    const domPosition = !container || container === document.body
      ? DOMPosition.Absolute
      : shadowRoot
        ? DOMPosition.FixedShadow
        : DOMPosition.Fixed;
    this.contextView.setContainer(container ?? document.body, domPosition);

    const renderContainer = document.createElement('div');
    const renderDisposable = delegate.render(renderContainer);
    this.currentRenderDisposable = renderDisposable ?? null;

    this.contextView.show({
      canRelayout: delegate.canRelayout,
      anchor: delegate.getAnchor(),
      className: delegate.className,
      render: () => renderContainer,
      focus: delegate.focus,
      layout: delegate.layout,
      onDOMEvent: delegate.onDOMEvent,
      onHide: this.handleHide,
      anchorAlignment: delegate.anchorAlignment,
      anchorPosition: delegate.anchorPosition,
      anchorAxisAlignment: delegate.anchorAxisAlignment,
      alignment: delegate.alignment,
      position: delegate.position,
      offset: delegate.offset,
      matchAnchorWidth: delegate.matchAnchorWidth,
      minWidth: delegate.minWidth,
      layer: delegate.layer,
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

registerSingleton(
  IContextViewService,
  PlatformContextViewService,
  InstantiationType.Delayed,
);
