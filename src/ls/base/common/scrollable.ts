export interface IScrollDimensions {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
}

export interface IScrollPosition {
  scrollLeft: number;
  scrollTop: number;
}

export interface INewScrollDimensions {
  width?: number;
  height?: number;
  scrollWidth?: number;
  scrollHeight?: number;
}

export interface INewScrollPosition {
  scrollLeft?: number;
  scrollTop?: number;
  reuseAnimation?: boolean;
}

export interface ScrollEvent extends IScrollPosition {
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  scrollLeftChanged: boolean;
  scrollTopChanged: boolean;
  inSmoothScrolling?: boolean;
}

export const enum ScrollbarVisibility {
  Auto = 'auto',
  Visible = 'visible',
  Hidden = 'hidden',
}

export class Scrollable {
  private smoothScrollDuration = 0;
  private position: IScrollPosition = { scrollLeft: 0, scrollTop: 0 };

  constructor(options: {
    forceIntegerValues?: boolean;
    smoothScrollDuration?: number;
    scheduleAtNextAnimationFrame?: (callback: () => void) => unknown;
  } = {}) {
    void options.forceIntegerValues;
    void options.scheduleAtNextAnimationFrame;
    this.smoothScrollDuration = options.smoothScrollDuration ?? 0;
  }

  setSmoothScrollDuration(duration: number): void {
    this.smoothScrollDuration = duration;
  }

  getSmoothScrollDuration(): number {
    return this.smoothScrollDuration;
  }

  setScrollPosition(position: INewScrollPosition): void {
    this.position = {
      scrollLeft: position.scrollLeft ?? this.position.scrollLeft,
      scrollTop: position.scrollTop ?? this.position.scrollTop,
    };
  }

  getFutureScrollPosition(): IScrollPosition {
    return { ...this.position };
  }

  dispose(): void {}
}
