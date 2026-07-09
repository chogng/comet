import { ScrollbarVisibility, resolveScrollableElementOptions } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import type { ScrollableElementChangeOptions, ScrollableElementCreationOptions, ScrollableElementResolvedOptions } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import { HorizontalScrollbarState } from 'cs/base/browser/ui/scrollbar/scrollbarState';
import { ScrollbarVisibilityController } from 'cs/base/browser/ui/scrollbar/scrollbarVisibilityController';
import { VerticalScrollbar } from 'cs/base/browser/ui/scrollbar/verticalScrollbar';
import type {
  INewScrollDimensions,
  INewScrollPosition,
  IScrollDimensions,
  IScrollPosition,
  Scrollable,
  ScrollEvent,
} from 'cs/base/common/scrollable';
import { EventEmitter, type Listener } from 'cs/base/common/event';
import {
  DisposableStore,
  MutableDisposable,
  toDisposable,
  type DisposableLike,
  type IDisposable,
} from 'cs/base/common/lifecycle';

import 'cs/base/browser/ui/scrollbar/media/verticalScrollbar.css';

function addDisposableListener<K extends keyof HTMLElementEventMap>(
  target: HTMLElement,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: boolean | AddEventListenerOptions,
) {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

export class AbstractScrollableElement {
  private static readonly SCROLLBAR_REVEAL_DURATION = 500;
  private static readonly MIN_SLIDER_SIZE = 20;
  protected readonly element: HTMLElement;
  protected readonly domNode: HTMLDivElement;
  private readonly horizontalScrollbar: HTMLDivElement;
  private readonly horizontalSlider: HTMLDivElement;
  private readonly verticalScrollbarTrack: HTMLDivElement;
  private readonly verticalScrollbarThumb: HTMLDivElement;
  private readonly verticalScrollbar: VerticalScrollbar;
  protected options: ScrollableElementResolvedOptions;
  private readonly onScrollEmitter = new EventEmitter<ScrollEvent>();
  private readonly onWillScrollEmitter = new EventEmitter<ScrollEvent>();
  private readonly domDisposables = new DisposableStore();
  private readonly horizontalScrollbarState: HorizontalScrollbarState;
  private readonly horizontalVisibilityController: ScrollbarVisibilityController;
  private scrollDimensions: IScrollDimensions;
  private scrollPosition: IScrollPosition;
  private readonly scrollbarHideTimeout = new MutableDisposable<DisposableLike>();
  private isHovered = false;

  constructor(
    element: HTMLElement,
    options: ScrollableElementCreationOptions = {},
    private readonly scrollable?: Scrollable,
  ) {
    this.element = element;
    this.options = resolveScrollableElementOptions(options);
    this.domNode = document.createElement('div');
    this.domNode.className = 'comet-scrollable-element-root';
    this.horizontalScrollbar = this.createScrollbarElement('horizontal');
    this.horizontalSlider = this.createSliderElement();
    this.verticalScrollbarTrack = this.createVerticalScrollbarTrack();
    this.verticalScrollbarThumb = this.createVerticalScrollbarThumb();
    this.horizontalScrollbar.append(this.horizontalSlider);
    this.verticalScrollbarTrack.append(this.verticalScrollbarThumb);
    this.domNode.append(this.element, this.horizontalScrollbar, this.verticalScrollbarTrack);

    this.element.classList.add('comet-scrollable-content');
    this.element.classList.add('comet-vertical-scrollbar-strip');
    this.element.style.minHeight = this.element.style.minHeight || '0';
    this.element.style.minWidth = this.element.style.minWidth || '0';

    this.scrollDimensions = {
      width: this.element.clientWidth,
      height: this.element.clientHeight,
      scrollWidth: this.element.scrollWidth,
      scrollHeight: this.element.scrollHeight,
    };
    this.scrollPosition = {
      scrollLeft: this.element.scrollLeft,
      scrollTop: this.element.scrollTop,
    };
    this.horizontalScrollbarState = new HorizontalScrollbarState({
      arrowSize: 0,
      scrollbarSize:
        this.options.horizontal === ScrollbarVisibility.Hidden
          ? 0
          : this.options.horizontalScrollbarSize,
      oppositeScrollbarSize:
        this.options.vertical === ScrollbarVisibility.Hidden
          ? 0
          : this.options.verticalScrollbarSize,
      visibleSize: this.scrollDimensions.width,
      scrollSize: this.scrollDimensions.scrollWidth,
      scrollPosition: this.scrollPosition.scrollLeft,
    });
    this.horizontalVisibilityController = new ScrollbarVisibilityController(
      this.options.horizontal,
      'comet-is-horizontal-scrollbar-visible',
    );
    this.verticalScrollbar = new VerticalScrollbar(
      this.domNode,
      this.element,
      this.verticalScrollbarTrack,
      this.verticalScrollbarThumb,
      this.createVerticalScrollbarOptions(),
    );
    this.horizontalVisibilityController.setIsNeeded(this.horizontalScrollbarState.isNeeded());
    this.horizontalVisibilityController.setDomNode(this.domNode);

    this.applyOptions();
    this.domDisposables.add(this.scrollbarHideTimeout);
    this.domDisposables.add(this.verticalScrollbar);
    this.domDisposables.add(
      addDisposableListener(this.element, 'scroll', this.handleElementScroll, {
        passive: true,
      }),
    );
    this.domDisposables.add(
      addDisposableListener(this.horizontalScrollbar, 'pointerdown', this.handleHorizontalScrollbarPointerDown),
    );
    this.domDisposables.add(
      addDisposableListener(this.domNode, 'mouseenter', this.handleMouseEnter),
    );
    this.domDisposables.add(
      addDisposableListener(this.domNode, 'mouseleave', this.handleMouseLeave),
    );

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        this.scanDomNode();
      });
      resizeObserver.observe(this.element);
      resizeObserver.observe(this.domNode);
      this.domDisposables.add(
        toDisposable(() => {
          resizeObserver.disconnect();
        }),
      );
    }

    if (typeof MutationObserver !== 'undefined') {
      const mutationObserver = new MutationObserver(() => {
        this.scanDomNode();
      });
      mutationObserver.observe(this.element, {
        childList: true,
        subtree: true,
        attributes: true,
        characterData: true,
      });
      this.domDisposables.add(
        toDisposable(() => {
          mutationObserver.disconnect();
        }),
      );
    }

    this.scanDomNode();
  }

  getDomNode() {
    return this.domNode;
  }

  onScroll(listener: Listener<ScrollEvent>, thisArgs?: unknown, disposables?: IDisposable[] | DisposableStore) {
    return this.onScrollEmitter.event(listener, thisArgs, disposables);
  }

  onWillScroll(listener: Listener<ScrollEvent>, thisArgs?: unknown, disposables?: IDisposable[] | DisposableStore) {
    return this.onWillScrollEmitter.event(listener, thisArgs, disposables);
  }

  getScrollPosition(): IScrollPosition {
    return { ...this.scrollPosition };
  }

  setScrollPosition(update: INewScrollPosition) {
    const nextScrollLeft = update.scrollLeft ?? this.element.scrollLeft;
    const nextScrollTop = update.scrollTop ?? this.element.scrollTop;
    this.element.scrollLeft = nextScrollLeft;
    this.element.scrollTop = nextScrollTop;
    this.scrollable?.setScrollPosition(update);
    this.captureState();
  }

  getScrollDimensions(): IScrollDimensions {
    return { ...this.scrollDimensions };
  }

  getHorizontalScrollbarState() {
    return this.horizontalScrollbarState;
  }

  setScrollDimensions(update: INewScrollDimensions) {
    this.scrollDimensions = {
      width: update.width ?? this.element.clientWidth,
      height: update.height ?? this.element.clientHeight,
      scrollWidth: update.scrollWidth ?? this.element.scrollWidth,
      scrollHeight: update.scrollHeight ?? this.element.scrollHeight,
    };
    this.horizontalScrollbarState.setDimensions(
      this.scrollDimensions.width,
      this.scrollDimensions.scrollWidth,
    );
    this.refreshDomState();
    this.verticalScrollbar.renderNow();
    const event: ScrollEvent = {
      ...this.scrollPosition,
      ...this.scrollDimensions,
      scrollLeftChanged: false,
      scrollTopChanged: false,
      inSmoothScrolling: false,
    };
    this.onWillScrollEmitter.fire(event);
    this.onScrollEmitter.fire(event);
  }

  updateOptions(update: ScrollableElementChangeOptions) {
    this.options = {
      ...this.options,
      ...update,
    };
    this.applyOptions();
    this.refreshDomState();
  }

  scanDomNode() {
    this.captureState();
  }

  delegateScrollFromMouseWheelEvent(browserEvent: WheelEvent) {
    if (!this.options.handleMouseWheel) {
      return;
    }
    this.element.dispatchEvent(
      new WheelEvent('wheel', {
        deltaX: browserEvent.deltaX,
        deltaY: browserEvent.deltaY,
        deltaMode: browserEvent.deltaMode,
      }),
    );
  }

  delegateVerticalScrollbarPointerDown(_browserEvent: PointerEvent) {
    this.verticalScrollbar.delegatePointerDown(_browserEvent);
  }

  dispose() {
    this.clearScrollbarHideTimeout();
    this.domDisposables.dispose();
    this.horizontalVisibilityController.dispose();
    this.onScrollEmitter.dispose();
    this.onWillScrollEmitter.dispose();
  }

  private readonly handleElementScroll = () => {
    const previous = this.scrollPosition;
    const next = {
      scrollLeft: this.element.scrollLeft,
      scrollTop: this.element.scrollTop,
    };
    const event: ScrollEvent = {
      ...next,
      ...this.scrollDimensions,
      scrollLeftChanged: previous.scrollLeft !== next.scrollLeft,
      scrollTopChanged: previous.scrollTop !== next.scrollTop,
      inSmoothScrolling: false,
    };
    this.onWillScrollEmitter.fire(event);
    this.revealScrollbarsTemporarily();
    this.captureState();
    this.onScrollEmitter.fire(event);
  };

  private readonly handleMouseEnter = () => {
    this.isHovered = true;
    this.clearScrollbarHideTimeout();
    this.setScrollbarsVisible(true);
  };

  private readonly handleMouseLeave = () => {
    this.isHovered = false;
    this.scheduleScrollbarHide();
  };

  private readonly handleHorizontalScrollbarPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.horizontalScrollbarState.isNeeded()) {
      return;
    }

    event.preventDefault();
    this.setScrollbarsVisible(true);
    const sliderRect = this.horizontalSlider.getBoundingClientRect();
    const isSliderTarget = this.horizontalSlider.contains(event.target as Node);
    const offset = isSliderTarget
      ? event.clientX - sliderRect.left
      : this.horizontalSlider.offsetWidth / 2;
    this.startHorizontalScrollbarDrag(event, offset);
  };

  private applyOptions() {
    const classNames = ['comet-scrollable-element-root'];
    if (this.options.className) {
      classNames.push(this.options.className);
    }
    if (this.options.useShadows) {
      classNames.push('comet-use-shadows');
    }
    this.domNode.className = classNames.join(' ');
    this.domNode.style.setProperty(
      '--comet-scrollbar-size-vertical',
      `${this.options.verticalScrollbarSize}px`,
    );
    this.domNode.style.setProperty(
      '--comet-vertical-scrollbar-size',
      `${this.options.verticalScrollbarSize}px`,
    );
    this.domNode.style.setProperty(
      '--comet-scrollbar-size-horizontal',
      `${this.options.horizontalScrollbarSize}px`,
    );
    this.horizontalScrollbarState.setScrollbarSize(
      this.options.horizontal === ScrollbarVisibility.Hidden
        ? 0
        : this.options.horizontalScrollbarSize,
    );
    this.horizontalScrollbarState.setOppositeScrollbarSize(
      this.options.vertical === ScrollbarVisibility.Hidden
        ? 0
        : this.options.verticalScrollbarSize,
    );
    this.horizontalVisibilityController.setVisibility(this.options.horizontal);
    this.verticalScrollbar.updateOptions(this.createVerticalScrollbarOptions());
    this.syncScrollbarVisibility();
  }

  private captureState() {
    this.scrollPosition = {
      scrollLeft: this.element.scrollLeft,
      scrollTop: this.element.scrollTop,
    };
    this.scrollDimensions = {
      width: this.element.clientWidth,
      height: this.element.clientHeight,
      scrollWidth: this.element.scrollWidth,
      scrollHeight: this.element.scrollHeight,
    };
    this.horizontalScrollbarState.setDimensions(
      this.scrollDimensions.width,
      this.scrollDimensions.scrollWidth,
    );
    this.horizontalScrollbarState.setScrollLeft(this.scrollPosition.scrollLeft);
    this.refreshDomState();
    this.verticalScrollbar.renderNow();
  }

  private refreshDomState() {
    const needsVertical = this.needsVerticalScrollbar();
    const needsHorizontal = this.horizontalScrollbarState.isNeeded();
    this.horizontalVisibilityController.setIsNeeded(needsHorizontal);

    this.domNode.classList.toggle(
      'comet-is-scrollbar-needed',
      needsVertical || needsHorizontal,
    );
    this.domNode.classList.toggle(
      'comet-has-top-shadow',
      this.options.useShadows && this.scrollPosition.scrollTop > 0,
    );
    this.renderScrollbars();
    this.syncScrollbarVisibility();
  }

  private needsVerticalScrollbar() {
    return (
      this.options.vertical !== ScrollbarVisibility.Hidden
      && this.element.clientHeight > 0
      && this.element.scrollHeight > this.element.clientHeight
    );
  }

  private createScrollbarElement(orientation: 'horizontal' | 'vertical') {
    const scrollbar = document.createElement('div');
    scrollbar.className = `comet-overlay-scrollbar comet-overlay-scrollbar-${orientation}`;
    scrollbar.setAttribute('aria-hidden', 'true');
    return scrollbar;
  }

  private createVerticalScrollbarTrack() {
    const track = document.createElement('div');
    track.className = 'comet-vertical-scrollbar-track';
    track.setAttribute('aria-hidden', 'true');
    return track;
  }

  private createVerticalScrollbarThumb() {
    const thumb = document.createElement('div');
    thumb.className = 'comet-vertical-scrollbar-thumb';
    return thumb;
  }

  private createVerticalScrollbarOptions() {
    return {
      vertical: this.options.vertical,
      verticalScrollbarSize: this.options.verticalScrollbarSize,
      handleMouseWheel: this.options.handleMouseWheel,
      mouseWheelSmoothScroll: this.options.mouseWheelSmoothScroll,
      flipAxes: this.options.flipAxes,
      consumeMouseWheelIfScrollbarIsNeeded: this.options.consumeMouseWheelIfScrollbarIsNeeded,
      alwaysConsumeMouseWheel: this.options.alwaysConsumeMouseWheel,
      mouseWheelScrollSensitivity: this.options.mouseWheelScrollSensitivity,
      fastScrollSensitivity: this.options.fastScrollSensitivity,
      scrollPredominantAxis: this.options.scrollPredominantAxis,
    };
  }

  private createSliderElement() {
    const slider = document.createElement('div');
    slider.className = 'comet-overlay-scrollbar-slider';
    return slider;
  }

  private renderScrollbars() {
    this.renderHorizontalScrollbar();
  }

  private renderHorizontalScrollbar() {
    const trackSize = this.element.clientWidth;
    const scrollSize = this.element.scrollWidth;
    const scrollbarSize = this.options.horizontal === ScrollbarVisibility.Hidden
      ? 0
      : this.options.horizontalScrollbarSize;
    this.horizontalScrollbar.style.height = `${scrollbarSize}px`;

    if (!trackSize || scrollSize <= trackSize || !scrollbarSize) {
      this.horizontalSlider.style.width = '0';
      this.horizontalSlider.style.transform = 'translateX(0)';
      return;
    }

    const sliderSize = Math.max(
      AbstractScrollableElement.MIN_SLIDER_SIZE,
      Math.floor((trackSize * trackSize) / scrollSize),
    );
    const scrollRange = Math.max(1, scrollSize - trackSize);
    const sliderRange = Math.max(0, trackSize - sliderSize);
    const sliderLeft = Math.round((this.element.scrollLeft / scrollRange) * sliderRange);
    this.horizontalSlider.style.width = `${sliderSize}px`;
    this.horizontalSlider.style.transform = `translateX(${sliderLeft}px)`;
  }

  private startHorizontalScrollbarDrag(
    event: PointerEvent,
    pointerOffsetWithinSlider: number,
  ) {
    const trackSize = this.horizontalScrollbar.clientWidth;
    const sliderSize = this.horizontalSlider.offsetWidth;
    const scrollSize = this.element.scrollWidth;
    const visibleSize = this.element.clientWidth;
    const scrollbarRect = this.horizontalScrollbar.getBoundingClientRect();
    const scrollRange = Math.max(0, scrollSize - visibleSize);
    const sliderRange = Math.max(1, trackSize - sliderSize);

    const updateFromPointer = (pointerEvent: PointerEvent) => {
      const pointerPosition = pointerEvent.clientX - scrollbarRect.left;
      const sliderPosition = Math.min(
        sliderRange,
        Math.max(0, pointerPosition - pointerOffsetWithinSlider),
      );
      const scrollPosition = (sliderPosition / sliderRange) * scrollRange;
      this.element.scrollLeft = scrollPosition;
      this.captureState();
    };

    const handlePointerMove = (pointerEvent: PointerEvent) => {
      pointerEvent.preventDefault();
      updateFromPointer(pointerEvent);
    };
    const handlePointerUp = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      this.scheduleScrollbarHide();
    };

    updateFromPointer(event);
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp, { once: true });
  }

  private revealScrollbarsTemporarily() {
    this.setScrollbarsVisible(true);
    if (!this.isHovered) {
      this.scheduleScrollbarHide();
    }
  }

  private setScrollbarsVisible(visible: boolean) {
    this.horizontalVisibilityController.setShouldBeVisible(visible);
  }

  private scheduleScrollbarHide() {
    this.clearScrollbarHideTimeout();
    let timeoutHandle: number | null = null;
    this.scrollbarHideTimeout.value = toDisposable(() => {
      if (timeoutHandle !== null) {
        window.clearTimeout(timeoutHandle);
        timeoutHandle = null;
      }
    });
    timeoutHandle = window.setTimeout(() => {
      timeoutHandle = null;
      this.scrollbarHideTimeout.clear();
      if (!this.isHovered) {
        this.setScrollbarsVisible(false);
      }
    }, AbstractScrollableElement.SCROLLBAR_REVEAL_DURATION);
  }

  private clearScrollbarHideTimeout() {
    this.scrollbarHideTimeout.clear();
  }

  private syncScrollbarVisibility() {
    if (this.options.horizontal === ScrollbarVisibility.Visible) {
      this.horizontalVisibilityController.setShouldBeVisible(true);
    } else if (!this.isHovered && !this.scrollbarHideTimeout.value) {
      this.horizontalVisibilityController.setShouldBeVisible(false);
    }
  }
}

export class ScrollableElement extends AbstractScrollableElement {}

export class SmoothScrollableElement extends AbstractScrollableElement {}

export class DomScrollableElement extends AbstractScrollableElement {}
