import './sash.css';
import {
  DisposableStore,
  MutableDisposable,
  combinedDisposable,
  toDisposable,
  type DisposableLike,
} from 'ls/base/common/lifecycle';
import { EventEmitter } from 'ls/base/common/event';

type Listener<T> = (event: T) => void;

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
): DisposableLike {
  target.addEventListener(type, listener, options);
  return toDisposable(() => {
    target.removeEventListener(type, listener, options);
  });
}

export const enum Orientation {
  VERTICAL,
  HORIZONTAL,
}

export const enum SashState {
  Disabled,
  AtMinimum,
  AtMaximum,
  Enabled,
}

export const DEFAULT_SASH_SIZE = 4;
export const DEFAULT_SASH_HOVER_SIZE = 4;
export const DEFAULT_SASH_HOVER_DELAY = 300;

let globalSashSize = DEFAULT_SASH_SIZE;
let globalSashHoverSize = DEFAULT_SASH_HOVER_SIZE;
let globalSashHoverDelay = DEFAULT_SASH_HOVER_DELAY;

function applyGlobalSashStyles() {
  if (typeof document === 'undefined') {
    return;
  }

  document.documentElement.style.setProperty('--sash-size', `${globalSashSize}px`);
  document.documentElement.style.setProperty(
    '--sash-hover-size',
    `${globalSashHoverSize}px`,
  );
}

export function getGlobalSashSize() {
  return globalSashSize;
}

export function getGlobalSashHoverDelay() {
  return globalSashHoverDelay;
}

export function setGlobalSashSize(
  size: number,
  hoverSize = size,
) {
  globalSashSize = size;
  globalSashHoverSize = hoverSize;
  applyGlobalSashStyles();
}

export function setGlobalSashHoverDelay(delay: number) {
  globalSashHoverDelay = delay;
}

export function initializeGlobalSashStyles() {
  applyGlobalSashStyles();
}

export type ISashEvent = {
  startX: number;
  currentX: number;
  startY: number;
  currentY: number;
  altKey: boolean;
};

type SashOptions = {
  size?: number;
  offsetMode?: 'start' | 'center' | 'end';
};

function getPointerPosition(event: MouseEvent | PointerEvent) {
  const x =
    Number.isFinite(event.pageX) && (event.pageX !== 0 || event.clientX === 0)
      ? event.pageX
      : event.clientX;
  const y =
    Number.isFinite(event.pageY) && (event.pageY !== 0 || event.clientY === 0)
      ? event.pageY
      : event.clientY;

  return {
    x,
    y,
  };
}

export class Sash {
  private readonly element = document.createElement('div');
  private readonly onDidStartEmitter = new EventEmitter<ISashEvent>();
  private readonly onDidChangeEmitter = new EventEmitter<ISashEvent>();
  private readonly onDidResetEmitter = new EventEmitter<void>();
  private readonly onDidEndEmitter = new EventEmitter<void>();
  private readonly explicitSize: number | undefined;
  private readonly offsetMode: 'start' | 'center' | 'end';
  private readonly prefersPointerEvents =
    typeof window !== 'undefined' && typeof window.PointerEvent !== 'undefined';
  private state = SashState.Enabled;
  private active = false;
  private hoverDelay = globalSashHoverDelay;
  private hoverTimeout: number | undefined;
  private readonly disposables = new DisposableStore();
  private readonly dragListeners = new MutableDisposable<DisposableLike>();

  constructor(
    private readonly container: HTMLElement,
    private readonly orientation: Orientation,
    options: SashOptions = {},
  ) {
    this.explicitSize = options.size;
    this.offsetMode = options.offsetMode ?? 'start';
    this.element.className = [
      'sash',
      this.orientation === Orientation.VERTICAL ? 'vertical' : 'horizontal',
    ].join(' ');
    if (typeof options.size === 'number') {
      this.element.style.setProperty('--sash-size', `${options.size}px`);
    }
    this.container.append(this.element);

    if (this.prefersPointerEvents) {
      this.disposables.add(
        addDisposableListener(this.element, 'pointerdown', this.handlePointerDown),
      );
    } else {
      this.disposables.add(
        addDisposableListener(this.element, 'mousedown', this.handleMouseDown),
      );
    }

    this.disposables.add(
      addDisposableListener(this.element, 'mouseenter', this.handleMouseEnter),
    );
    this.disposables.add(
      addDisposableListener(this.element, 'mouseleave', this.handleMouseLeave),
    );
    this.disposables.add(
      addDisposableListener(this.element, 'dblclick', this.handleDoubleClick),
    );
  }

  getElement() {
    return this.element;
  }

  onDidStart(listener: Listener<ISashEvent>) {
    return this.onDidStartEmitter.event(listener);
  }

  onDidChange(listener: Listener<ISashEvent>) {
    return this.onDidChangeEmitter.event(listener);
  }

  onDidReset(listener: Listener<void>) {
    return this.onDidResetEmitter.event(listener);
  }

  onDidEnd(listener: Listener<void>) {
    return this.onDidEndEmitter.event(listener);
  }

  setState(state: SashState) {
    if (this.state === state) {
      return;
    }

    this.state = state;
    if (state === SashState.Disabled) {
      this.clearHoverState();
    }
    this.renderState();
  }

  layout(offset: number, orthogonalSize: number) {
    const size = this.getLayoutSize();
    const positionedOffset = this.getPositionedOffset(offset, size);

    if (this.orientation === Orientation.VERTICAL) {
      this.element.style.left = `${positionedOffset}px`;
      this.element.style.top = '0';
      this.element.style.height = `${orthogonalSize}px`;
      return;
    }

    this.element.style.left = '0';
    this.element.style.top = `${positionedOffset}px`;
    this.element.style.width = `${orthogonalSize}px`;
  }

  dispose() {
    this.clearHoverState();
    this.dragListeners.clear();

    this.dragListeners.dispose();
    this.disposables.dispose();
    this.element.remove();
    this.onDidStartEmitter.dispose();
    this.onDidChangeEmitter.dispose();
    this.onDidResetEmitter.dispose();
    this.onDidEndEmitter.dispose();
  }

  private renderState() {
    this.element.classList.toggle('disabled', this.state === SashState.Disabled);
    this.element.classList.toggle('minimum', this.state === SashState.AtMinimum);
    this.element.classList.toggle('maximum', this.state === SashState.AtMaximum);
  }

  private getLayoutSize() {
    if (typeof this.explicitSize === 'number') {
      return this.explicitSize;
    }

    return getGlobalSashSize();
  }

  private getPositionedOffset(offset: number, size: number) {
    if (this.offsetMode === 'center') {
      return offset - size / 2;
    }

    if (this.offsetMode === 'end') {
      return offset - size;
    }

    return offset;
  }

  private readonly handleMouseEnter = () => {
    if (this.state === SashState.Disabled) {
      return;
    }

    this.clearHoverTimeout();

    if (this.active) {
      this.element.classList.add('hover');
      return;
    }

    this.hoverTimeout = window.setTimeout(() => {
      this.hoverTimeout = undefined;

      if (!this.active && this.state !== SashState.Disabled) {
        this.element.classList.add('hover');
      }
    }, this.hoverDelay);
  };

  private readonly handleMouseLeave = () => {
    this.clearHoverState();
  };

  private readonly handleDoubleClick = () => {
    if (this.state === SashState.Disabled) {
      return;
    }

    this.onDidResetEmitter.fire();
  };

  private readonly handleMouseDown = (event: MouseEvent) => {
    this.beginDrag(event);
  };

  private readonly handlePointerDown = (event: PointerEvent) => {
    this.beginDrag(event);
  };

  private beginDrag(event: MouseEvent | PointerEvent) {
    if (this.state === SashState.Disabled || event.button !== 0) {
      return;
    }

    const { x: startX, y: startY } = getPointerPosition(event);
    this.dragListeners.clear();
    this.active = true;
    this.clearHoverState();
    this.element.classList.add('active');
    event.preventDefault();

    this.onDidStartEmitter.fire({
      startX,
      currentX: startX,
      startY,
      currentY: startY,
      altKey: event.altKey,
    });

    const handleMove = (nextEvent: MouseEvent | PointerEvent) => {
      const { x: currentX, y: currentY } = getPointerPosition(nextEvent);
      this.onDidChangeEmitter.fire({
        startX,
        currentX,
        startY,
        currentY,
        altKey: nextEvent.altKey,
      });
    };

    const handleEnd = () => {
      this.dragListeners.clear();
      this.active = false;
      this.element.classList.remove('active');
      this.onDidEndEmitter.fire();
    };

    if (this.prefersPointerEvents) {
      const pointerMoveListener = (nextEvent: PointerEvent) => {
        handleMove(nextEvent);
      };
      const pointerUpListener = () => {
        handleEnd();
      };

      this.dragListeners.value = combinedDisposable(
        addDisposableListener(window, 'pointermove', pointerMoveListener),
        addDisposableListener(window, 'pointerup', pointerUpListener),
        addDisposableListener(window, 'pointercancel', pointerUpListener),
      );
      return;
    }

    const mouseMoveListener = (nextEvent: MouseEvent) => {
      handleMove(nextEvent);
    };
    const mouseUpListener = () => {
      handleEnd();
    };

    this.dragListeners.value = combinedDisposable(
      addDisposableListener(window, 'mousemove', mouseMoveListener),
      addDisposableListener(window, 'mouseup', mouseUpListener),
    );
  }

  private clearHoverTimeout() {
    if (typeof this.hoverTimeout === 'number') {
      window.clearTimeout(this.hoverTimeout);
      this.hoverTimeout = undefined;
    }
  }

  private clearHoverState() {
    this.clearHoverTimeout();
    this.element.classList.remove('hover');
  }
}

export default Sash;
