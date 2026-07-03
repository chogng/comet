import {
  Orientation,
  Sash,
  SashState,
} from 'ls/base/browser/ui/sash/sash';
import { EventEmitter } from 'ls/base/common/event';
import { DisposableStore } from 'ls/base/common/lifecycle';

export type Dimension = {
  width: number;
  height: number;
};

export type ResizeEvent = {
  dimension: Dimension;
  done: boolean;
  north?: boolean;
  east?: boolean;
  south?: boolean;
  west?: boolean;
};

type ResizeDirection = 'north' | 'east' | 'south' | 'west';

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createDimension(width: number, height: number): Dimension {
  return {
    width: Math.max(0, Math.round(width)),
    height: Math.max(0, Math.round(height)),
  };
}

function areDimensionsEqual(previous: Dimension, next: Dimension) {
  return previous.width === next.width && previous.height === next.height;
}

export class ResizableHTMLElement {
  readonly domNode = document.createElement('div');

  private readonly onDidWillResizeEmitter = new EventEmitter<void>();
  private readonly onDidResizeEmitter = new EventEmitter<ResizeEvent>();
  private readonly northSash = new Sash(this.domNode, Orientation.HORIZONTAL);
  private readonly eastSash = new Sash(this.domNode, Orientation.VERTICAL);
  private readonly southSash = new Sash(this.domNode, Orientation.HORIZONTAL);
  private readonly westSash = new Sash(this.domNode, Orientation.VERTICAL);
  private readonly enabledSashes = {
    north: false,
    east: false,
    south: false,
    west: false,
  };
  private sizeValue = createDimension(0, 0);
  private minSizeValue = createDimension(0, 0);
  private maxSizeValue = {
    width: Number.MAX_SAFE_INTEGER,
    height: Number.MAX_SAFE_INTEGER,
  } satisfies Dimension;
  private preferredSizeValue: Dimension | undefined;
  private dragStartSize: Dimension | null = null;
  private deltaX = 0;
  private deltaY = 0;
  private resizing = false;
  private readonly disposables = new DisposableStore();

  readonly onDidWillResize = this.onDidWillResizeEmitter.event.bind(this.onDidWillResizeEmitter);
  readonly onDidResize = this.onDidResizeEmitter.event.bind(this.onDidResizeEmitter);

  constructor() {
    this.domNode.classList.add('resizable-element');
    this.domNode.style.position = 'relative';

    this.disposables.add(this.northSash.onDidStart(this.handleResizeStart));
    this.disposables.add(this.eastSash.onDidStart(this.handleResizeStart));
    this.disposables.add(this.southSash.onDidStart(this.handleResizeStart));
    this.disposables.add(this.westSash.onDidStart(this.handleResizeStart));
    this.disposables.add(this.northSash.onDidEnd(this.handleResizeEnd));
    this.disposables.add(this.eastSash.onDidEnd(this.handleResizeEnd));
    this.disposables.add(this.southSash.onDidEnd(this.handleResizeEnd));
    this.disposables.add(this.westSash.onDidEnd(this.handleResizeEnd));
    this.disposables.add(
      this.eastSash.onDidChange((event) => {
        this.deltaX = event.currentX - event.startX;
        this.applyDrag('east');
      }),
    );
    this.disposables.add(
      this.westSash.onDidChange((event) => {
        this.deltaX = -(event.currentX - event.startX);
        this.applyDrag('west');
      }),
    );
    this.disposables.add(
      this.northSash.onDidChange((event) => {
        this.deltaY = -(event.currentY - event.startY);
        this.applyDrag('north');
      }),
    );
    this.disposables.add(
      this.southSash.onDidChange((event) => {
        this.deltaY = event.currentY - event.startY;
        this.applyDrag('south');
      }),
    );
    this.disposables.add(
      this.eastSash.onDidReset(() => {
        if (!this.preferredSizeValue) {
          return;
        }

        this.layout(this.sizeValue.height, this.preferredSizeValue.width);
        this.onDidResizeEmitter.fire({
          dimension: this.size,
          done: true,
          east: true,
        });
      }),
    );
    this.disposables.add(
      this.westSash.onDidReset(() => {
        if (!this.preferredSizeValue) {
          return;
        }

        this.layout(this.sizeValue.height, this.preferredSizeValue.width);
        this.onDidResizeEmitter.fire({
          dimension: this.size,
          done: true,
          west: true,
        });
      }),
    );
    this.disposables.add(
      this.northSash.onDidReset(() => {
        if (!this.preferredSizeValue) {
          return;
        }

        this.layout(this.preferredSizeValue.height, this.sizeValue.width);
        this.onDidResizeEmitter.fire({
          dimension: this.size,
          done: true,
          north: true,
        });
      }),
    );
    this.disposables.add(
      this.southSash.onDidReset(() => {
        if (!this.preferredSizeValue) {
          return;
        }

        this.layout(this.preferredSizeValue.height, this.sizeValue.width);
        this.onDidResizeEmitter.fire({
          dimension: this.size,
          done: true,
          south: true,
        });
      }),
    );

    this.layout();
    this.applySashStates();
  }

  get size() {
    return createDimension(this.sizeValue.width, this.sizeValue.height);
  }

  set minSize(value: Dimension) {
    this.minSizeValue = createDimension(value.width, value.height);
    this.layout();
  }

  get minSize() {
    return createDimension(this.minSizeValue.width, this.minSizeValue.height);
  }

  set maxSize(value: Dimension) {
    this.maxSizeValue = createDimension(value.width, value.height);
    this.layout();
  }

  get maxSize() {
    return createDimension(this.maxSizeValue.width, this.maxSizeValue.height);
  }

  set preferredSize(value: Dimension | undefined) {
    this.preferredSizeValue = value
      ? createDimension(value.width, value.height)
      : undefined;
  }

  get preferredSize() {
    return this.preferredSizeValue
      ? createDimension(this.preferredSizeValue.width, this.preferredSizeValue.height)
      : undefined;
  }

  isResizing() {
    return this.resizing;
  }

  getSashElement(direction: ResizeDirection) {
    return this.getSash(direction).getElement();
  }

  enableSashes(north: boolean, east: boolean, south: boolean, west: boolean) {
    this.enabledSashes.north = north;
    this.enabledSashes.east = east;
    this.enabledSashes.south = south;
    this.enabledSashes.west = west;
    this.applySashStates();
  }

  layout(height: number = this.sizeValue.height, width: number = this.sizeValue.width) {
    const nextSize = createDimension(
      clamp(width, this.minSizeValue.width, this.maxSizeValue.width),
      clamp(height, this.minSizeValue.height, this.maxSizeValue.height),
    );
    if (!areDimensionsEqual(this.sizeValue, nextSize)) {
      this.sizeValue = nextSize;
      this.domNode.style.width = `${this.sizeValue.width}px`;
      this.domNode.style.height = `${this.sizeValue.height}px`;
    }

    this.northSash.layout(0, this.sizeValue.width);
    this.eastSash.layout(this.sizeValue.width, this.sizeValue.height);
    this.southSash.layout(this.sizeValue.height, this.sizeValue.width);
    this.westSash.layout(0, this.sizeValue.height);
    this.applySashStates();
  }

  dispose() {
    this.disposables.dispose();
    this.northSash.dispose();
    this.eastSash.dispose();
    this.southSash.dispose();
    this.westSash.dispose();
    this.onDidWillResizeEmitter.dispose();
    this.onDidResizeEmitter.dispose();
    this.domNode.remove();
  }

  private readonly handleResizeStart = () => {
    if (this.dragStartSize) {
      return;
    }

    this.resizing = true;
    this.dragStartSize = this.size;
    this.deltaX = 0;
    this.deltaY = 0;
    this.onDidWillResizeEmitter.fire();
  };

  private readonly handleResizeEnd = () => {
    if (!this.dragStartSize) {
      return;
    }

    this.resizing = false;
    this.dragStartSize = null;
    this.deltaX = 0;
    this.deltaY = 0;
    this.onDidResizeEmitter.fire({
      dimension: this.size,
      done: true,
    });
  };

  private applyDrag(direction: ResizeDirection) {
    if (!this.dragStartSize) {
      return;
    }

    const nextWidth = this.dragStartSize.width + this.deltaX;
    const nextHeight = this.dragStartSize.height + this.deltaY;
    this.layout(nextHeight, nextWidth);
    this.onDidResizeEmitter.fire({
      dimension: this.size,
      done: false,
      [direction]: true,
    });
  }

  private applySashStates() {
    this.northSash.setState(this.enabledSashes.north ? SashState.Enabled : SashState.Disabled);
    this.eastSash.setState(this.enabledSashes.east ? SashState.Enabled : SashState.Disabled);
    this.southSash.setState(this.enabledSashes.south ? SashState.Enabled : SashState.Disabled);
    this.westSash.setState(this.enabledSashes.west ? SashState.Enabled : SashState.Disabled);
  }

  private getSash(direction: ResizeDirection) {
    switch (direction) {
      case 'north':
        return this.northSash;
      case 'east':
        return this.eastSash;
      case 'south':
        return this.southSash;
      case 'west':
        return this.westSash;
    }
  }
}
