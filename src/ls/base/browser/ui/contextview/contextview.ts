import 'ls/base/browser/ui/contextview/contextview.css';
import {
  getDomNodePagePosition,
  getDomNodeZoomLevel,
} from 'ls/base/browser/dom';
import {
  resolveAnchoredHorizontalLeft,
  resolveAnchoredOverlayAxisPosition,
  resolveAnchoredVerticalPlacement,
  resolveAnchoredVerticalPlacementWithFallback,
  resolveAnchoredVerticalTop,
} from 'ls/base/common/layout';
import {
  LifecycleOwner,
  MutableLifecycle,
  combineDisposables,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';

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
  anchor: ContextViewAnchor;
  render: () => Node;
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
};

const VIEWPORT_MARGIN_PX = 8;
const DEFAULT_OFFSET_PX = 0;

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function rangesIntersect(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number,
) {
  return firstStart < secondEnd && secondStart < firstEnd;
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

function resolveRenderedVerticalPlacement(options: {
  anchorRect: ViewportRect;
  overlayHeight: number;
  top: number;
  fallbackPlacement: 'above' | 'below';
}) {
  const {
    anchorRect,
    overlayHeight,
    top,
    fallbackPlacement,
  } = options;

  const overlayBottom = top + overlayHeight;
  const anchorBottom = anchorRect.top + anchorRect.height;

  if (overlayBottom <= anchorRect.top) {
    return 'above' as const;
  }

  if (top >= anchorBottom) {
    return 'below' as const;
  }

  if (top < anchorRect.top) {
    return 'above' as const;
  }

  if (overlayBottom > anchorBottom) {
    return 'below' as const;
  }

  return fallbackPlacement;
}

function resolveSeparatedPlacement(options: {
  anchorRect: ViewportRect;
  overlayHeight: number;
  top: number;
}) {
  const {
    anchorRect,
    overlayHeight,
    top,
  } = options;

  const overlayBottom = top + overlayHeight;
  const anchorBottom = anchorRect.top + anchorRect.height;

  if (overlayBottom <= anchorRect.top) {
    return 'above' as const;
  }

  if (top >= anchorBottom) {
    return 'below' as const;
  }

  return null;
}

function resolveVerticalAxisLayout(options: {
  anchorRect: ViewportRect;
  overlaySize: {
    width: number;
    height: number;
  };
  viewportSize: ViewportSize;
  requestedPosition: ContextViewPosition;
  anchorAlignment: AnchorAlignment;
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
    hasExplicitAnchorAlignment,
    alignment,
    offset,
  } = options;

  const anchoredRect = {
    x: anchorRect.left,
    y: anchorRect.top,
    width: anchorRect.width,
    height: anchorRect.height,
  };
  const placementInfo = resolveAnchoredVerticalPlacement({
    anchorRect: anchoredRect,
    overlayHeight: overlaySize.height,
    viewportHeight: viewportSize.height,
    viewportMargin: VIEWPORT_MARGIN_PX,
    offset,
    preference: requestedPosition,
  });
  const resolvedPlacement = resolveAnchoredVerticalPlacementWithFallback({
    preference: requestedPosition,
    placement: placementInfo,
  });
  const top = resolveAnchoredVerticalTop({
    anchorRect: anchoredRect,
    overlayHeight: overlaySize.height,
    viewportHeight: viewportSize.height,
    viewportMargin: VIEWPORT_MARGIN_PX,
    offset,
    placement: resolvedPlacement,
  });
  const usesCenteredAlignment =
    !alignment || alignment !== 'center'
      ? false
      : !hasExplicitAnchorAlignment;
  let left: number;

  if (usesCenteredAlignment) {
    left = resolveAnchoredHorizontalLeft({
      anchorRect: anchoredRect,
      overlayWidth: overlaySize.width,
      viewportWidth: viewportSize.width,
      viewportMargin: VIEWPORT_MARGIN_PX,
      alignment: 'center',
    });
  } else {
    const overlapsAnchorVertically = rangesIntersect(
      top,
      top + overlaySize.height,
      anchorRect.top,
      anchorRect.top + anchorRect.height,
    );
    left = resolveAnchoredOverlayAxisPosition(
      viewportSize.width,
      overlaySize.width,
      {
        offset: anchorRect.left,
        size: anchorRect.width,
        position: anchorAlignment === 'left' ? 'before' : 'after',
        mode: overlapsAnchorVertically ? 'avoid' : 'align',
      },
    );
  }

  return {
    left,
    top,
    placement: resolveRenderedVerticalPlacement({
      anchorRect,
      overlayHeight: overlaySize.height,
      top,
      fallbackPlacement: resolvedPlacement,
    }),
  } as LayoutResult;
}

function resolveHorizontalAxisLayout(options: {
  anchorRect: ViewportRect;
  overlaySize: {
    width: number;
    height: number;
  };
  viewportSize: ViewportSize;
  preferredPlacement: 'above' | 'below';
  anchorAlignment: AnchorAlignment;
  offset: number;
}) {
  const {
    anchorRect,
    overlaySize,
    viewportSize,
    preferredPlacement,
    anchorAlignment,
    offset,
  } = options;

  const left = resolveAnchoredOverlayAxisPosition(
    viewportSize.width,
    overlaySize.width,
    {
      offset: anchorRect.left,
      size: anchorRect.width,
      position: anchorAlignment === 'left' ? 'before' : 'after',
    },
  );
  const overlapsAnchorHorizontally = rangesIntersect(
    left,
    left + overlaySize.width,
    anchorRect.left,
    anchorRect.left + anchorRect.width,
  );
  let top = resolveAnchoredOverlayAxisPosition(
    viewportSize.height,
    overlaySize.height,
    {
      offset: anchorRect.top,
      size: anchorRect.height,
      position: preferredPlacement === 'below' ? 'before' : 'after',
      mode: overlapsAnchorHorizontally ? 'avoid' : 'align',
    },
  );

  if (offset > 0) {
    const separatedPlacement = resolveSeparatedPlacement({
      anchorRect,
      overlayHeight: overlaySize.height,
      top,
    });
    if (separatedPlacement) {
      top = resolveAnchoredVerticalTop({
        anchorRect: {
          x: anchorRect.left,
          y: anchorRect.top,
          width: anchorRect.width,
          height: anchorRect.height,
        },
        overlayHeight: overlaySize.height,
        viewportHeight: viewportSize.height,
        viewportMargin: VIEWPORT_MARGIN_PX,
        offset,
        placement: separatedPlacement,
      });
    }
  }

  return {
    left,
    top,
    placement: resolveRenderedVerticalPlacement({
      anchorRect,
      overlayHeight: overlaySize.height,
      top,
      fallbackPlacement: preferredPlacement,
    }),
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

export class ContextViewController extends LifecycleOwner implements ContextViewHandle {
  private readonly element = createElement('div', 'ls-context-view');
  private readonly content = createElement('div', 'ls-context-view-content');
  private readonly mountedListeners = new MutableLifecycle<DisposableLike>();
  private options: ContextViewOptions | null = null;
  private visible = false;
  private disposed = false;
  private suppressHide = false;
  private pendingRelayout = false;

  constructor() {
    super();
    this.element.append(this.content);
    this.register(this.mountedListeners);
    this.register(
      addDisposableListener(this.content, 'mousedown', this.handleContentMouseDown, true),
    );
  }

  show(options: ContextViewOptions) {
    if (this.disposed) {
      return;
    }

    this.options = options;
    this.content.className = 'ls-context-view-content';
    if (options.className) {
      this.content.classList.add(...options.className.split(/\s+/).filter(Boolean));
    }
    this.content.replaceChildren(options.render());
    this.mount();
    this.layout();
    this.scheduleRelayout();
  }

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

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.options = null;
    this.visible = false;
    this.unmount();
    super.dispose();
  }

  private mount() {
    if (!this.visible) {
      this.visible = true;
      document.body.append(this.element);
      this.mountedListeners.value = combineDisposables(
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

  layout() {
    if (!this.options) {
      return;
    }

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
    const preferredPlacement =
      requestedPosition === 'above' ? 'above' : 'below';

    this.element.style.left = `${VIEWPORT_MARGIN_PX}px`;
    this.element.style.top = `${VIEWPORT_MARGIN_PX}px`;
    this.content.style.minWidth = `${Math.max(
      minWidth ?? 0,
      matchAnchorWidth ? anchorRect.width : 0,
    )}px`;

    const overlayRect = this.content.getBoundingClientRect();
    const overlaySize = {
      width: overlayRect.width,
      height: overlayRect.height,
    };
    const resolvedLayout =
      anchorAxisAlignment === 'vertical'
        ? resolveVerticalAxisLayout({
          anchorRect,
          overlaySize,
          viewportSize,
          requestedPosition,
          anchorAlignment,
          hasExplicitAnchorAlignment: Boolean(this.options.anchorAlignment),
          alignment: this.options.alignment,
          offset,
        })
        : resolveHorizontalAxisLayout({
          anchorRect,
          overlaySize,
          viewportSize,
          preferredPlacement,
          anchorAlignment,
          offset,
        });
    const left = clamp(
      resolvedLayout.left,
      VIEWPORT_MARGIN_PX,
      Math.max(
        VIEWPORT_MARGIN_PX,
        viewportSize.width - overlaySize.width - VIEWPORT_MARGIN_PX,
      ),
    );

    this.element.classList.remove('top', 'bottom', 'left', 'right');
    this.element.classList.add(
      resolvedLayout.placement === 'below' ? 'bottom' : 'top',
    );
    this.element.classList.add(anchorAlignment === 'left' ? 'left' : 'right');

    this.element.style.left = `${Math.round(left)}px`;
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
    if (event.key === 'Escape') {
      this.hide();
    }
  };

  private readonly handleDocumentScroll = () => {
    this.hide();
  };

  private readonly handleWindowResize = () => {
    this.hide();
  };

  private scheduleRelayout() {
    if (this.pendingRelayout || !this.visible) {
      return;
    }

    this.pendingRelayout = true;
    requestAnimationFrame(() => {
      this.pendingRelayout = false;
      if (!this.visible || this.disposed) {
        return;
      }
      this.layout();
    });
  }
}

export function createContextViewController() {
  return new ContextViewController();
}
