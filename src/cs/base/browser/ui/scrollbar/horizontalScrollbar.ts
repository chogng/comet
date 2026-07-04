import 'cs/base/browser/ui/scrollbar/media/horizontalScrollbar.css';
import { HorizontalScrollbarState } from 'cs/base/browser/ui/scrollbar/scrollbarState';
import {
  Disposable,
  MutableDisposable,
  combinedDisposable,
  toDisposable,
  type DisposableLike,
} from 'cs/base/common/lifecycle';

const MIN_THUMB_SIZE = 24;
const ACTIVE_CLASS_TIMEOUT = 900;
const WHEEL_LINE_SIZE = 16;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

export type HorizontalScrollbarOptions = {
  activeItem?: HTMLElement | null;
  initialScrollLeft?: number;
  onScrollLeftChange?: (scrollLeft: number) => void;
  handleMouseWheel?: boolean;
  mouseWheelSmoothScroll?: boolean;
  flipAxes?: boolean;
  scrollYToX?: boolean;
  consumeMouseWheelIfScrollbarIsNeeded?: boolean;
  alwaysConsumeMouseWheel?: boolean;
  mouseWheelScrollSensitivity?: number;
  fastScrollSensitivity?: number;
  scrollPredominantAxis?: boolean;
};

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

export class HorizontalScrollbar extends Disposable {
  private readonly host: HTMLElement;
  private readonly strip: HTMLElement;
  private readonly track: HTMLElement;
  private readonly thumb: HTMLElement;
  private readonly activeItem: HTMLElement | null;
  private readonly onScrollLeftChange?: (scrollLeft: number) => void;
  private readonly handleMouseWheel: boolean;
  private readonly mouseWheelSmoothScroll: boolean;
  private readonly flipAxes: boolean;
  private readonly scrollYToX: boolean;
  private readonly consumeMouseWheelIfScrollbarIsNeeded: boolean;
  private readonly alwaysConsumeMouseWheel: boolean;
  private readonly mouseWheelScrollSensitivity: number;
  private readonly fastScrollSensitivity: number;
  private readonly scrollPredominantAxis: boolean;
  private readonly scrollbarState: HorizontalScrollbarState;
  private readonly activeClassTimeout = new MutableDisposable<DisposableLike>();
  private readonly animationFrame = new MutableDisposable<DisposableLike>();
  private readonly dragListeners = new MutableDisposable<DisposableLike>();
  private dragPointerId: number | null = null;
  private dragStartClientX = 0;
  private dragStartScrollLeft = 0;
  private disposed = false;

  constructor(
    host: HTMLElement,
    strip: HTMLElement,
    track: HTMLElement,
    thumb: HTMLElement,
    options: HorizontalScrollbarOptions = {},
  ) {
    super();
    this.host = host;
    this.strip = strip;
    this.track = track;
    this.thumb = thumb;
    this.activeItem = options.activeItem ?? null;
    this.onScrollLeftChange = options.onScrollLeftChange;
    this.handleMouseWheel = options.handleMouseWheel ?? true;
    this.mouseWheelSmoothScroll = options.mouseWheelSmoothScroll ?? true;
    this.flipAxes = options.flipAxes ?? false;
    this.scrollYToX = options.scrollYToX ?? false;
    this.consumeMouseWheelIfScrollbarIsNeeded =
      options.consumeMouseWheelIfScrollbarIsNeeded ?? false;
    this.alwaysConsumeMouseWheel = options.alwaysConsumeMouseWheel ?? false;
    this.mouseWheelScrollSensitivity = options.mouseWheelScrollSensitivity ?? 1;
    this.fastScrollSensitivity = options.fastScrollSensitivity ?? 5;
    this.scrollPredominantAxis = options.scrollPredominantAxis ?? true;
    this.scrollbarState = new HorizontalScrollbarState({
      arrowSize: 0,
      scrollbarSize: this.track.clientHeight,
      oppositeScrollbarSize: 0,
      visibleSize: this.strip.clientWidth,
      scrollSize: this.strip.scrollWidth,
      scrollPosition: this.strip.scrollLeft,
    });

    if (
      typeof options.initialScrollLeft === 'number' &&
      options.initialScrollLeft > 0
    ) {
      this.strip.scrollLeft = options.initialScrollLeft;
    }

    this._register(this.activeClassTimeout);
    this._register(this.animationFrame);
    this._register(this.dragListeners);
    this._register(addDisposableListener(this.track, 'pointerdown', this.handleTrackPointerDown));
    this._register(addDisposableListener(this.thumb, 'pointerdown', this.handleThumbPointerDown));
    this._register(
      addDisposableListener(this.strip, 'wheel', this.handleScrollbarWheel, {
        passive: false,
      }),
    );
    this._register(
      addDisposableListener(this.track, 'wheel', this.handleScrollbarWheel, {
        passive: false,
      }),
    );
    this._register(
      addDisposableListener(this.thumb, 'wheel', this.handleScrollbarWheel, {
        passive: false,
      }),
    );
    this._register(
      addDisposableListener(this.strip, 'scroll', this.handleStripScroll, {
        passive: true,
      }),
    );

    if (typeof ResizeObserver !== 'undefined') {
      const resizeObserver = new ResizeObserver(() => {
        this.scheduleRender();
      });
      resizeObserver.observe(this.host);
      resizeObserver.observe(this.strip);
      resizeObserver.observe(this.track);
      this._register(
        toDisposable(() => {
          resizeObserver.disconnect();
        }),
      );
    } else {
      this._register(addDisposableListener(window, 'resize', this.scheduleRender));
    }

    this.scheduleInitialLayout();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.clearActiveClassTimeout();
    this.animationFrame.clear();
    this.endDrag();
    super.dispose();
  }

  renderNow() {
    this.animationFrame.clear();
    this.render();
  }

  private readonly scheduleInitialLayout = () => {
    this.scheduleAnimationFrame(() => {
      this.revealActiveItem();
      this.render();
    });
  };

  private readonly scheduleRender = () => {
    if (this.animationFrame.value) {
      return;
    }

    this.scheduleAnimationFrame(() => {
      this.render();
    });
  };

  private render() {
    const visibleWidth = this.strip.clientWidth;
    const scrollWidth = this.strip.scrollWidth;
    const maxScrollLeft = Math.max(0, scrollWidth - visibleWidth);
    const trackWidth = this.track.clientWidth;
    const isScrollable = visibleWidth > 0 && trackWidth > 0 && maxScrollLeft > 0;
    this.scrollbarState.setScrollbarSize(this.track.clientHeight);
    this.scrollbarState.setDimensions(trackWidth, scrollWidth);
    this.scrollbarState.setScrollLeft(this.strip.scrollLeft);

    this.host.classList.toggle('horizontal-scrollbar-host', true);
    this.host.classList.toggle('is-scrollable', isScrollable);
    if (!isScrollable) {
      this.thumb.style.width = '0px';
      this.thumb.style.transform = 'translate3d(0, 0, 0)';
      this.host.classList.remove('is-scrollbar-active');
      this.host.classList.remove('is-scrollbar-dragging');
      this.emitScrollLeft();
      return;
    }

    const thumbSize = Math.max(MIN_THUMB_SIZE, this.scrollbarState.getSliderSize());
    const thumbOffset = this.scrollbarState.getSliderPosition();

    this.thumb.style.width = `${thumbSize}px`;
    this.thumb.style.transform = `translate3d(${thumbOffset}px, 0, 0)`;
    this.emitScrollLeft();
  }

  private revealActiveItem() {
    if (!this.activeItem) {
      return;
    }
    this.activeItem.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  }

  private emitScrollLeft() {
    this.onScrollLeftChange?.(this.strip.scrollLeft);
  }

  private readonly handleStripScroll = () => {
    this.showScrollbarTemporarily();
    this.scheduleRender();
  };

  private readonly handleTrackPointerDown = (event: PointerEvent) => {
    if (
      event.button !== 0 ||
      event.target !== this.track ||
      !this.host.classList.contains('is-scrollable')
    ) {
      return;
    }

    event.preventDefault();
    const trackRect = this.track.getBoundingClientRect();
    const targetOffset = event.clientX - trackRect.left;
    this.strip.scrollLeft =
      this.scrollbarState.getDesiredScrollPositionFromOffset(targetOffset);
    this.scheduleRender();
    this.showScrollbarTemporarily();
  };

  private readonly handleThumbPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.host.classList.contains('is-scrollable')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.dragPointerId = event.pointerId;
    this.dragStartClientX = event.clientX;
    this.dragStartScrollLeft = this.strip.scrollLeft;
    this.host.classList.add('is-scrollbar-active');
    this.host.classList.add('is-scrollbar-dragging');
    this.thumb.setPointerCapture?.(event.pointerId);
    this.dragListeners.value = combinedDisposable(
      addDisposableListener(window, 'pointermove', this.handleWindowPointerMove),
      addDisposableListener(window, 'pointerup', this.handleWindowPointerUp),
      addDisposableListener(window, 'pointercancel', this.handleWindowPointerUp),
    );
  };

  private readonly handleWindowPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }

    if (!this.scrollbarState.isNeeded()) {
      return;
    }

    const deltaX = event.clientX - this.dragStartClientX;
    this.strip.scrollLeft = this.dragStartScrollLeft;
    this.scrollbarState.setScrollLeft(this.dragStartScrollLeft);
    this.strip.scrollLeft =
      this.scrollbarState.getDesiredScrollPositionFromDelta(deltaX);
    this.scheduleRender();
  };

  private readonly handleWindowPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.dragPointerId) {
      return;
    }

    this.endDrag();
    this.showScrollbarTemporarily();
  };

  private endDrag() {
    if (this.dragPointerId !== null) {
      this.thumb.releasePointerCapture?.(this.dragPointerId);
    }
    this.dragPointerId = null;
    this.dragListeners.clear();
    this.host.classList.remove('is-scrollbar-dragging');
  }

  private readonly handleScrollbarWheel = (event: WheelEvent) => {
    if (!this.handleMouseWheel) {
      return;
    }

    const isScrollable = this.host.classList.contains('is-scrollable');
    if (!isScrollable) {
      if (this.alwaysConsumeMouseWheel) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    const wheelDelta = this.getHorizontalWheelDelta(event);
    const currentScrollLeft = this.strip.scrollLeft;
    const maxScrollLeft = Math.max(0, this.strip.scrollWidth - this.strip.clientWidth);
    const nextScrollLeft = Math.min(
      maxScrollLeft,
      Math.max(0, currentScrollLeft + wheelDelta),
    );
    const didScroll = nextScrollLeft !== currentScrollLeft;

    if (
      this.alwaysConsumeMouseWheel ||
      (this.consumeMouseWheelIfScrollbarIsNeeded && isScrollable) ||
      didScroll
    ) {
      event.preventDefault();
      event.stopPropagation();
    }

    if (!didScroll) {
      return;
    }

    this.setScrollLeft(nextScrollLeft);
    this.scheduleRender();
    this.showScrollbarTemporarily();
  };

  private getHorizontalWheelDelta(event: WheelEvent) {
    let deltaX = event.deltaX * this.mouseWheelScrollSensitivity;
    let deltaY = event.deltaY * this.mouseWheelScrollSensitivity;

    if (this.scrollPredominantAxis) {
      if (Math.abs(deltaY) >= Math.abs(deltaX)) {
        deltaX = 0;
      } else {
        deltaY = 0;
      }
    }

    if (this.flipAxes) {
      [deltaY, deltaX] = [deltaX, deltaY];
    }

    if ((this.scrollYToX || event.shiftKey) && deltaX === 0) {
      deltaX = deltaY;
      deltaY = 0;
    }

    if (event.altKey) {
      deltaX *= this.fastScrollSensitivity;
      deltaY *= this.fastScrollSensitivity;
    }

    if (deltaX === 0) {
      return 0;
    }

    if (event.deltaMode === DOM_DELTA_LINE) {
      return deltaX * WHEEL_LINE_SIZE;
    }

    if (event.deltaMode === DOM_DELTA_PAGE) {
      return deltaX * this.strip.clientWidth;
    }

    return deltaX;
  }

  private setScrollLeft(scrollLeft: number) {
    if (this.mouseWheelSmoothScroll && typeof this.strip.scrollTo === 'function') {
      this.strip.scrollTo({
        left: scrollLeft,
        behavior: 'smooth',
      });
      return;
    }

    this.strip.scrollLeft = scrollLeft;
  }

  private showScrollbarTemporarily() {
    if (!this.host.classList.contains('is-scrollable')) {
      return;
    }

    this.host.classList.add('is-scrollbar-active');
    this.clearActiveClassTimeout();
    let timeoutId = 0;
    const timeoutHandle = toDisposable(() => {
      window.clearTimeout(timeoutId);
    });
    timeoutId = window.setTimeout(() => {
      if (this.activeClassTimeout.value === timeoutHandle) {
        this.activeClassTimeout.clear();
      }
      if (this.dragPointerId === null) {
        this.host.classList.remove('is-scrollbar-active');
      }
    }, ACTIVE_CLASS_TIMEOUT);
    this.activeClassTimeout.value = timeoutHandle;
  }

  private clearActiveClassTimeout() {
    this.activeClassTimeout.clear();
  }

  private scheduleAnimationFrame(callback: () => void) {
    if (this.disposed) {
      return;
    }

    let frameId = 0;
    const frameHandle = toDisposable(() => {
      window.cancelAnimationFrame(frameId);
    });
    frameId = window.requestAnimationFrame(() => {
      if (this.animationFrame.value === frameHandle) {
        this.animationFrame.clear();
      }
      if (!this.disposed) {
        callback();
      }
    });
    this.animationFrame.value = frameHandle;
  }
}

export default HorizontalScrollbar;
