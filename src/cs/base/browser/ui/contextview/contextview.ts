import 'cs/base/browser/ui/contextview/contextview.css';
import {
  $,
  getDomNodePagePosition,
  getDomNodeZoomLevel,
} from 'cs/base/browser/dom';
import {
  AnchorAlignment as LayoutAnchorAlignment,
  AnchorAxisAlignment as LayoutAnchorAxisAlignment,
  AnchorPosition as LayoutAnchorPosition,
  layout2d,
  type IRect,
} from 'cs/base/common/layout';
import {
  Disposable,
  MutableDisposable,
  combinedDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';

export type AnchorAlignment = 'left' | 'right';
export type AnchorPosition = 'below' | 'above';
export type AnchorAxisAlignment = 'vertical' | 'horizontal';
export type ContextViewAlignment = 'start' | 'end' | 'center';
export type ContextViewPosition = 'auto' | 'above' | 'below';
export type ContextViewAnchor = HTMLElement | {
  x: number;
  y: number;
  width?: number;
  height?: number;
};

export type ContextViewOptions = {
  canRelayout?: boolean;
  anchor: ContextViewAnchor;
  render: () => Node;
  focus?: () => void;
  layout?: () => void;
  onDOMEvent?: (event: Event, activeElement: HTMLElement | null) => void;
  className?: string;
  onHide?: (data?: unknown) => void;
  anchorAlignment?: AnchorAlignment;
  anchorPosition?: AnchorPosition;
  anchorAxisAlignment?: AnchorAxisAlignment;
  alignment?: ContextViewAlignment;
  position?: ContextViewPosition;
  offset?: number;
  matchAnchorWidth?: boolean;
  minWidth?: number;
  layer?: number;
};

export type ContextViewRenderResult =
  | void
  | (() => void)
  | DisposableLike;

export type ContextViewDelegate = Omit<ContextViewOptions, 'anchor' | 'render'> & {
  getAnchor: () => ContextViewAnchor;
  render: (container: HTMLElement) => ContextViewRenderResult;
};

export type ContextViewDisposable = {
  dispose: () => void;
};

export type ContextViewProvider = {
  showContextView: (delegate: ContextViewDelegate) => ContextViewDisposable;
  hideContextView: (data?: unknown) => void;
  getContextViewElement: () => HTMLElement;
  layout: () => void;
  isVisible: () => boolean;
  dispose: () => void;
};

export type ContextViewHandle = {
  show: (options: ContextViewOptions) => void;
  hide: (data?: unknown) => void;
  isVisible: () => boolean;
  getViewElement: () => HTMLElement;
  dispose: () => void;
};

type ViewportRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type ViewportSize = {
  width: number;
  height: number;
};

type LayoutResult = {
  left: number;
  top: number;
  placement: 'above' | 'below';
  alignment: AnchorAlignment;
};

const VIEWPORT_MARGIN_PX = 8;
const DEFAULT_OFFSET_PX = 0;
export const DEFAULT_CONTEXT_VIEW_Z_INDEX = 1000;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function resolveAnchorAlignment(
  options: Pick<ContextViewOptions, 'anchorAlignment' | 'alignment'>,
) {
  if (options.anchorAlignment) {
    return options.anchorAlignment;
  }

  return options.alignment === 'end' ? 'right' : 'left';
}

function resolveAnchorPositionPreference(
  options: Pick<ContextViewOptions, 'anchorPosition' | 'position'>,
): ContextViewPosition {
  if (options.anchorPosition) {
    return options.anchorPosition;
  }

  return options.position ?? 'auto';
}

function toLayoutAnchorAlignment(anchorAlignment: AnchorAlignment) {
  return anchorAlignment === 'left'
    ? LayoutAnchorAlignment.LEFT
    : LayoutAnchorAlignment.RIGHT;
}

function toLayoutAnchorPosition(position: ContextViewPosition) {
  return position === 'above'
    ? LayoutAnchorPosition.ABOVE
    : LayoutAnchorPosition.BELOW;
}

function toLayoutAnchorAxisAlignment(anchorAxisAlignment: AnchorAxisAlignment) {
  return anchorAxisAlignment === 'horizontal'
    ? LayoutAnchorAxisAlignment.HORIZONTAL
    : LayoutAnchorAxisAlignment.VERTICAL;
}

function fromLayoutAnchorAlignment(anchorAlignment: LayoutAnchorAlignment) {
  return anchorAlignment === LayoutAnchorAlignment.LEFT ? 'left' : 'right';
}

function fromLayoutAnchorPosition(anchorPosition: LayoutAnchorPosition) {
  return anchorPosition === LayoutAnchorPosition.BELOW ? 'below' : 'above';
}

function resolveViewportAnchorRect(anchor: ContextViewAnchor): ViewportRect {
  if (!(anchor instanceof HTMLElement)) {
    return {
      left: anchor.x,
      top: anchor.y,
      width: anchor.width ?? 1,
      height: anchor.height ?? 2,
    };
  }

  const pagePosition = getDomNodePagePosition(anchor);
  const zoom = getDomNodeZoomLevel(anchor);

  return {
    left: pagePosition.left * zoom - window.scrollX,
    top: pagePosition.top * zoom - window.scrollY,
    width: pagePosition.width * zoom,
    height: pagePosition.height * zoom,
  };
}

function resolveViewportSize(): ViewportSize {
  return {
    width: window.innerWidth || document.documentElement.clientWidth || 0,
    height: window.innerHeight || document.documentElement.clientHeight || 0,
  };
}

function resolveAvailableHeight(options: {
  anchorRect: ViewportRect;
  viewportSize: ViewportSize;
  requestedPosition: ContextViewPosition;
  offset: number;
}) {
  const {
    anchorRect,
    viewportSize,
    requestedPosition,
    offset,
  } = options;
  const spaceAbove = anchorRect.top - VIEWPORT_MARGIN_PX - offset;
  const spaceBelow =
    viewportSize.height - (anchorRect.top + anchorRect.height) - VIEWPORT_MARGIN_PX - offset;

  if (requestedPosition === 'above') {
    return Math.max(0, spaceAbove);
  }

  if (requestedPosition === 'below') {
    return Math.max(0, spaceBelow);
  }

  return Math.max(0, Math.max(spaceAbove, spaceBelow));
}

function resolveOffsetAnchorRect(anchorRect: ViewportRect, offset: number): IRect {
  return {
    top: anchorRect.top - offset,
    left: anchorRect.left,
    width: anchorRect.width,
    height: anchorRect.height + offset * 2,
  };
}

function resolveCenteredLeft(options: {
  anchorRect: ViewportRect;
  overlayWidth: number;
  viewportWidth: number;
}) {
  const {
    anchorRect,
    overlayWidth,
    viewportWidth,
  } = options;

  return clamp(
    anchorRect.left + (anchorRect.width - overlayWidth) / 2,
    0,
    Math.max(0, viewportWidth - overlayWidth),
  );
}

function resolveContextViewLayout(options: {
  anchorRect: ViewportRect;
  overlaySize: {
    width: number;
    height: number;
  };
  viewportSize: ViewportSize;
  requestedPosition: ContextViewPosition;
  anchorAlignment: AnchorAlignment;
  anchorAxisAlignment: AnchorAxisAlignment;
  hasExplicitAnchorAlignment: boolean;
  alignment?: ContextViewAlignment;
  offset: number;
}) {
  const {
    anchorRect,
    overlaySize,
    viewportSize,
    requestedPosition,
    anchorAlignment,
    anchorAxisAlignment,
    hasExplicitAnchorAlignment,
    alignment,
    offset,
  } = options;
  const viewport = {
    top: 0,
    left: 0,
    width: viewportSize.width,
    height: viewportSize.height,
  };
  const layoutResult = layout2d(
    viewport,
    overlaySize,
    resolveOffsetAnchorRect(anchorRect, offset),
    {
      anchorAlignment: toLayoutAnchorAlignment(anchorAlignment),
      anchorPosition: toLayoutAnchorPosition(requestedPosition),
      anchorAxisAlignment: toLayoutAnchorAxisAlignment(anchorAxisAlignment),
    },
  );
  const usesCenteredAlignment =
    anchorAxisAlignment === 'vertical'
    && alignment === 'center'
    && !hasExplicitAnchorAlignment;
  const left = usesCenteredAlignment
    ? resolveCenteredLeft({
      anchorRect,
      overlayWidth: overlaySize.width,
      viewportWidth: viewportSize.width,
    })
    : layoutResult.left;

  return {
    left,
    top: layoutResult.top,
    placement: fromLayoutAnchorPosition(layoutResult.anchorPosition),
    alignment: fromLayoutAnchorAlignment(layoutResult.anchorAlignment),
  } as LayoutResult;
}

function addDisposableListener<K extends keyof DocumentEventMap>(
  target: Document,
  type: K,
  listener: (event: DocumentEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener<K extends keyof WindowEventMap>(
  target: Window,
  type: K,
  listener: (event: WindowEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
): DisposableLike;
function addDisposableListener(
  target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>,
  type: string,
  listener: EventListenerOrEventListenerObject,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

export class ContextViewController extends Disposable implements ContextViewHandle, ContextViewProvider {
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-context-view');
  private readonly content = $<HTMLElementTagNameMap['div']>('div.comet-context-view-content');
  private readonly mountedListeners = new MutableDisposable<DisposableLike>();
  private options: ContextViewOptions | null = null;
  private currentDelegate: ContextViewDelegate | null = null;
  private currentRenderDisposable: ContextViewRenderResult = undefined;
  private visible = false;
  private disposed = false;
  private suppressHide = false;
  private pendingRelayout = false;

  constructor() {
    super();
    this.element.append(this.content);
    this._register(this.mountedListeners);
    this._register(
      addDisposableListener(this.content, 'mousedown', this.handleContentMouseDown, true),
    );
  }

  show(options: ContextViewOptions) {
    if (this.disposed) {
      return;
    }

    this.options = options;
    this.content.className = 'comet-context-view-content';
    if (options.className) {
      this.content.classList.add(...options.className.split(/\s+/).filter(Boolean));
    }
    this.element.style.zIndex = `${DEFAULT_CONTEXT_VIEW_Z_INDEX + (options.layer ?? 0)}`;
    this.content.replaceChildren(options.render());
    this.mount();
    this.layout(false);
    options.focus?.();
    this.scheduleRelayout(false);
  }

  showContextView(delegate: ContextViewDelegate): ContextViewDisposable {
    this.hideContextView();
    this.currentDelegate = delegate;

    const container = document.createElement('div');
    this.currentRenderDisposable = delegate.render(container);
    this.show({
      ...delegate,
      anchor: delegate.getAnchor(),
      render: () => container,
      onHide: this.handleProviderHide,
    });

    return {
      dispose: () => {
        if (this.currentDelegate === delegate) {
          this.hideContextView();
        }
      },
    };
  }

  hideContextView = (data?: unknown) => {
    if (!this.visible) {
      this.cleanupCurrentView();
      return;
    }

    this.hide(data);
  };

  hide = (data?: unknown) => {
    if (!this.visible) {
      this.options = null;
      return;
    }

    const onHide = this.options?.onHide;
    this.visible = false;
    this.options = null;
    this.unmount();
    onHide?.(data);
  };

  isVisible = () => this.visible;

  getViewElement = () => this.element;

  getContextViewElement = () => this.element;

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.options = null;
    this.visible = false;
    this.unmount();
    this.cleanupCurrentView();
    super.dispose();
  }

  private cleanupCurrentView() {
    const renderDisposable = this.currentRenderDisposable;
    this.currentRenderDisposable = undefined;
    if (typeof renderDisposable === 'function') {
      renderDisposable();
    } else {
      renderDisposable?.dispose();
    }
    this.currentDelegate = null;
  }

  private readonly handleProviderHide = (data?: unknown) => {
    const delegate = this.currentDelegate;
    this.cleanupCurrentView();
    delegate?.onHide?.(data);
  };

  private mount() {
    if (!this.visible) {
      this.visible = true;
      document.body.append(this.element);
      this.mountedListeners.value = combinedDisposable(
        addDisposableListener(document, 'mousedown', this.handleDocumentMouseDown, true),
        addDisposableListener(document, 'keydown', this.handleDocumentKeyDown, true),
        addDisposableListener(document, 'scroll', this.handleDocumentScroll, true),
        addDisposableListener(window, 'resize', this.handleWindowResize),
      );
      return;
    }

    if (!this.element.isConnected) {
      document.body.append(this.element);
    }
  }

  private unmount() {
    this.element.remove();
    this.mountedListeners.clear();
    this.pendingRelayout = false;
  }

  layout(allowHide = true) {
    if (!this.options) {
      return;
    }

    if (allowHide && this.options.canRelayout === false) {
      this.hide();
      return;
    }

    this.options.layout?.();

    const {
      anchor,
      offset = DEFAULT_OFFSET_PX,
      matchAnchorWidth = false,
      minWidth,
    } = this.options;
    const anchorRect = resolveViewportAnchorRect(anchor);
    const viewportSize = resolveViewportSize();
    const anchorAlignment = resolveAnchorAlignment(this.options);
    const requestedPosition = resolveAnchorPositionPreference(this.options);
    const anchorAxisAlignment = this.options.anchorAxisAlignment ?? 'vertical';

    this.element.style.left = `${VIEWPORT_MARGIN_PX}px`;
    this.element.style.top = `${VIEWPORT_MARGIN_PX}px`;
    this.content.style.minWidth = `${Math.max(
      minWidth ?? 0,
      matchAnchorWidth ? anchorRect.width : 0,
    )}px`;
    this.content.style.setProperty(
      '--comet-context-view-available-height',
      `${Math.floor(resolveAvailableHeight({
        anchorRect,
        viewportSize,
        requestedPosition,
        offset,
      }))}px`,
    );

    const overlayRect = this.content.getBoundingClientRect();
    const overlaySize = {
      width: overlayRect.width,
      height: overlayRect.height,
    };
    const resolvedLayout = resolveContextViewLayout({
      anchorRect,
      overlaySize,
      viewportSize,
      requestedPosition,
      anchorAlignment,
      anchorAxisAlignment,
      hasExplicitAnchorAlignment: Boolean(this.options.anchorAlignment),
      alignment: this.options.alignment,
      offset,
    });

    this.element.classList.remove('top', 'bottom', 'left', 'right');
    this.element.classList.add(
      resolvedLayout.placement === 'below' ? 'bottom' : 'top',
    );
    this.element.classList.add(resolvedLayout.alignment);

    this.element.style.left = `${Math.round(resolvedLayout.left)}px`;
    this.element.style.top = `${Math.round(resolvedLayout.top)}px`;
  }

  private readonly handleContentMouseDown = () => {
    this.suppressHide = true;
    queueMicrotask(() => {
      this.suppressHide = false;
    });
  };

  private readonly handleDocumentMouseDown = (event: MouseEvent) => {
    if (this.suppressHide) {
      return;
    }

    if (this.delegateDOMEvent(event)) {
      return;
    }

    const targetNode = event.target;
    if (!(targetNode instanceof Node)) {
      this.hide();
      return;
    }

    if (this.element.contains(targetNode)) {
      return;
    }

    if (
      this.options?.anchor instanceof HTMLElement
      && this.options.anchor.contains(targetNode)
    ) {
      return;
    }

    this.hide();
  };

  private readonly handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (this.delegateDOMEvent(event)) {
      return;
    }

    if (event.key === 'Escape') {
      this.hide();
    }
  };

  private readonly handleDocumentScroll = (event: Event) => {
    if (this.delegateDOMEvent(event)) {
      return;
    }

    const targetNode = event.target;
    if (targetNode instanceof Node && this.element.contains(targetNode)) {
      return;
    }

    this.hide();
  };

  private readonly handleWindowResize = () => {
    this.layout();
  };

  private delegateDOMEvent(event: Event) {
    if (!this.options?.onDOMEvent) {
      return false;
    }

    const activeElement = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    this.options.onDOMEvent(event, activeElement);
    return true;
  }

  private scheduleRelayout(allowHide = true) {
    if (this.pendingRelayout || !this.visible) {
      return;
    }

    this.pendingRelayout = true;
    requestAnimationFrame(() => {
      this.pendingRelayout = false;
      if (!this.visible || this.disposed) {
        return;
      }
      this.layout(allowHide);
    });
  }
}

export function createContextViewController() {
  return new ContextViewController();
}
