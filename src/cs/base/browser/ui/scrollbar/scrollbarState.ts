const MINIMUM_SLIDER_SIZE = 20;

export interface ScrollbarStateSnapshot {
  arrowSize: number;
  scrollbarSize: number;
  oppositeScrollbarSize: number;
  visibleSize: number;
  scrollSize: number;
  scrollPosition: number;
}

type ComputedScrollbarState = {
  availableSize: number;
  isNeeded: boolean;
  sliderSize: number;
  sliderRatio: number;
  sliderPosition: number;
};

export class ScrollbarState {
  private scrollbarSize: number;
  private oppositeScrollbarSize: number;
  private readonly arrowSize: number;
  private visibleSize: number;
  private scrollSize: number;
  private scrollPosition: number;
  private computedState: ComputedScrollbarState;

  constructor({
    arrowSize,
    scrollbarSize,
    oppositeScrollbarSize,
    visibleSize,
    scrollSize,
    scrollPosition,
  }: ScrollbarStateSnapshot) {
    this.arrowSize = Math.round(arrowSize);
    this.scrollbarSize = Math.round(scrollbarSize);
    this.oppositeScrollbarSize = Math.round(oppositeScrollbarSize);
    this.visibleSize = Math.round(visibleSize);
    this.scrollSize = Math.round(scrollSize);
    this.scrollPosition = Math.round(scrollPosition);
    this.computedState = ScrollbarState.computeValues(
      this.oppositeScrollbarSize,
      this.arrowSize,
      this.visibleSize,
      this.scrollSize,
      this.scrollPosition,
    );
  }

  clone() {
    return new ScrollbarState(this.getSnapshot());
  }

  getSnapshot(): ScrollbarStateSnapshot {
    return {
      arrowSize: this.arrowSize,
      scrollbarSize: this.scrollbarSize,
      oppositeScrollbarSize: this.oppositeScrollbarSize,
      visibleSize: this.visibleSize,
      scrollSize: this.scrollSize,
      scrollPosition: this.scrollPosition,
    };
  }

  setVisibleSize(visibleSize: number) {
    const nextVisibleSize = Math.round(visibleSize);
    if (this.visibleSize === nextVisibleSize) {
      return false;
    }

    this.visibleSize = nextVisibleSize;
    this.refreshComputedValues();
    return true;
  }

  setScrollSize(scrollSize: number) {
    const nextScrollSize = Math.round(scrollSize);
    if (this.scrollSize === nextScrollSize) {
      return false;
    }

    this.scrollSize = nextScrollSize;
    this.refreshComputedValues();
    return true;
  }

  setScrollPosition(scrollPosition: number) {
    const nextScrollPosition = Math.round(scrollPosition);
    if (this.scrollPosition === nextScrollPosition) {
      return false;
    }

    this.scrollPosition = nextScrollPosition;
    this.refreshComputedValues();
    return true;
  }

  setScrollbarSize(scrollbarSize: number) {
    this.scrollbarSize = Math.round(scrollbarSize);
  }

  setOppositeScrollbarSize(oppositeScrollbarSize: number) {
    const nextOppositeScrollbarSize = Math.round(oppositeScrollbarSize);
    if (this.oppositeScrollbarSize === nextOppositeScrollbarSize) {
      return false;
    }

    this.oppositeScrollbarSize = nextOppositeScrollbarSize;
    this.refreshComputedValues();
    return true;
  }

  getArrowSize() {
    return this.arrowSize;
  }

  getScrollPosition() {
    return this.scrollPosition;
  }

  getRectangleLargeSize() {
    return this.computedState.availableSize;
  }

  getRectangleSmallSize() {
    return this.scrollbarSize;
  }

  isNeeded() {
    return this.computedState.isNeeded;
  }

  getSliderSize() {
    return this.computedState.sliderSize;
  }

  getSliderPosition() {
    return this.computedState.sliderPosition;
  }

  getDesiredScrollPositionFromOffset(offset: number) {
    if (!this.computedState.isNeeded) {
      return 0;
    }

    const desiredSliderPosition =
      offset - this.arrowSize - this.computedState.sliderSize / 2;
    return Math.round(desiredSliderPosition / this.computedState.sliderRatio);
  }

  getDesiredScrollPositionFromOffsetPaged(offset: number) {
    if (!this.computedState.isNeeded) {
      return 0;
    }

    const correctedOffset = offset - this.arrowSize;
    if (correctedOffset < this.computedState.sliderPosition) {
      return this.scrollPosition - this.visibleSize;
    }

    return this.scrollPosition + this.visibleSize;
  }

  getDesiredScrollPositionFromDelta(delta: number) {
    if (!this.computedState.isNeeded) {
      return 0;
    }

    const desiredSliderPosition = this.computedState.sliderPosition + delta;
    return Math.round(desiredSliderPosition / this.computedState.sliderRatio);
  }

  private refreshComputedValues() {
    this.computedState = ScrollbarState.computeValues(
      this.oppositeScrollbarSize,
      this.arrowSize,
      this.visibleSize,
      this.scrollSize,
      this.scrollPosition,
    );
  }

  private static computeValues(
    oppositeScrollbarSize: number,
    arrowSize: number,
    visibleSize: number,
    scrollSize: number,
    scrollPosition: number,
  ): ComputedScrollbarState {
    const availableSize = Math.max(0, visibleSize - oppositeScrollbarSize);
    const representableSize = Math.max(0, availableSize - 2 * arrowSize);
    const isNeeded = scrollSize > 0 && scrollSize > visibleSize;

    if (!isNeeded) {
      return {
        availableSize: Math.round(availableSize),
        isNeeded,
        sliderSize: Math.round(representableSize),
        sliderRatio: 0,
        sliderPosition: 0,
      };
    }

    const sliderSize = Math.round(
      Math.max(
        MINIMUM_SLIDER_SIZE,
        Math.floor((visibleSize * representableSize) / scrollSize),
      ),
    );
    const sliderRatio =
      (representableSize - sliderSize) / (scrollSize - visibleSize);
    const sliderPosition = Math.round(scrollPosition * sliderRatio);

    return {
      availableSize: Math.round(availableSize),
      isNeeded,
      sliderSize,
      sliderRatio,
      sliderPosition,
    };
  }
}

export class HorizontalScrollbarState extends ScrollbarState {
  setDimensions(width: number, scrollWidth: number) {
    const widthChanged = this.setVisibleSize(width);
    const scrollWidthChanged = this.setScrollSize(scrollWidth);
    return widthChanged || scrollWidthChanged;
  }

  setScrollLeft(scrollLeft: number) {
    return this.setScrollPosition(scrollLeft);
  }
}

export class VerticalScrollbarState extends ScrollbarState {
  setDimensions(height: number, scrollHeight: number) {
    const heightChanged = this.setVisibleSize(height);
    const scrollHeightChanged = this.setScrollSize(scrollHeight);
    return heightChanged || scrollHeightChanged;
  }

  setScrollTop(scrollTop: number) {
    return this.setScrollPosition(scrollTop);
  }
}
