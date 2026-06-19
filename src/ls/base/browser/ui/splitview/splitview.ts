import {
  getGlobalSashSize,
  ISashEvent,
  Orientation,
  Sash,
  SashState,
} from 'ls/base/browser/ui/sash/sash';

import 'ls/base/browser/ui/splitview/splitview.css';
import { EventEmitter } from 'ls/base/common/event';

export { Orientation } from 'ls/base/browser/ui/sash/sash';

export const enum LayoutPriority {
  Normal,
  Low,
  High,
}

type SplitViewStyleColor = {
  isTransparent?(): boolean;
  toString(): string;
};

export interface ISplitViewStyles {
  readonly separatorBorder: SplitViewStyleColor;
}

export interface IView<TLayoutContext = undefined> {
  readonly element: HTMLElement;
  readonly minimumSize: number;
  readonly maximumSize: number;
  readonly priority?: LayoutPriority;
  readonly proportionalLayout?: boolean;
  readonly snap?: boolean;
  layout(size: number, offset: number, context: TLayoutContext | undefined): void;
  setVisible?(visible: boolean): void;
}

type AddViewOptions = {
  visible?: boolean;
  flex?: boolean;
  index?: number;
};

export interface ISplitViewDescriptor<
  TLayoutContext = undefined,
  TView extends IView<TLayoutContext> = IView<TLayoutContext>,
> {
  size: number;
  views: Array<{
    view: TView;
    size: number;
    visible?: boolean;
  }>;
}

export interface ISplitViewOptions<
  TLayoutContext = undefined,
  TView extends IView<TLayoutContext> = IView<TLayoutContext>,
> {
  readonly orientation?: Orientation;
  readonly styles?: ISplitViewStyles;
  readonly proportionalLayout?: boolean;
  readonly descriptor?: ISplitViewDescriptor<TLayoutContext, TView>;
  readonly inverseAltBehavior?: boolean;
  readonly getSashOrthogonalSize?: () => number;
}

export type DistributeSizing = { type: 'distribute' };
export type SplitSizing = { type: 'split'; index: number };
export type AutoSizing = { type: 'auto'; index: number };
export type InvisibleSizing = { type: 'invisible'; cachedVisibleSize: number };
export type Sizing =
  | DistributeSizing
  | SplitSizing
  | AutoSizing
  | InvisibleSizing;

export namespace Sizing {
  export const Distribute: DistributeSizing = { type: 'distribute' };

  export function Split(index: number): SplitSizing {
    return { type: 'split', index };
  }

  export function Auto(index: number): AutoSizing {
    return { type: 'auto', index };
  }

  export function Invisible(cachedVisibleSize: number): InvisibleSizing {
    return { type: 'invisible', cachedVisibleSize };
  }
}

type ViewItem<TLayoutContext> = {
  view: IView<TLayoutContext>;
  container: HTMLElement;
  size: number;
  cachedVisibleSize: number;
  visible: boolean;
  flex: boolean;
  snap: boolean;
};

type SashItem = {
  leftItemIndex: number;
  rightItemIndex: number;
  separator: HTMLElement;
  sash: Sash;
  dispose: () => void;
};

type SashDragSnapState = {
  itemIndex: number;
  limitDelta: number;
  size: number;
};

type SashDragState = {
  sashIndex: number;
  start: number;
  sizes: number[];
  minDelta: number;
  maxDelta: number;
  snapBefore: SashDragSnapState | undefined;
  snapAfter: SashDragSnapState | undefined;
};

export type SplitViewSashChangeEvent = {
  sashIndex: number;
  leftItemIndex: number;
  rightItemIndex: number;
  minDelta: number;
  maxDelta: number;
  rawDelta: number;
  constrainedDelta: number;
  sashEvent: ISashEvent;
};

export type SplitViewSashSnapEvent = {
  sashIndex: number;
  itemIndex: number;
  visible: boolean;
  sashEvent: ISashEvent;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function range(from: number, to: number) {
  const values: number[] = [];
  const step = from < to ? 1 : -1;
  for (let value = from; value !== to; value += step) {
    values.push(value);
  }
  return values;
}

function insertElementAt(
  parent: HTMLElement,
  child: HTMLElement,
  index: number,
) {
  const target = parent.children.item(index);
  if (target) {
    parent.insertBefore(child, target);
    return;
  }

  parent.append(child);
}

export class SplitView<TLayoutContext = undefined> {
  readonly element = document.createElement('div');
  private readonly viewContainer = document.createElement('div');
  private readonly sashContainer = document.createElement('div');
  private readonly items: ViewItem<TLayoutContext>[] = [];
  private readonly onDidSashChangeEmitter = new EventEmitter<SplitViewSashChangeEvent>();
  private readonly onDidSashSnapEmitter = new EventEmitter<SplitViewSashSnapEvent>();
  private readonly onDidSashResetEmitter = new EventEmitter<number>();
  private readonly onDidSashEndEmitter = new EventEmitter<number>();
  private sashItems: SashItem[] = [];
  private dragState: SashDragState | null = null;
  private width = 0;
  private height = 0;
  private layoutContext: TLayoutContext | undefined;
  private startSnappingEnabledValue = true;
  private endSnappingEnabledValue = true;
  private readonly explicitSashSize: number | undefined;

  readonly onDidSashChange = this.onDidSashChangeEmitter.event;
  readonly onDidSashSnap = this.onDidSashSnapEmitter.event;
  readonly onDidSashReset = this.onDidSashResetEmitter.event;
  readonly onDidSashEnd = this.onDidSashEndEmitter.event;

  get startSnappingEnabled() {
    return this.startSnappingEnabledValue;
  }

  set startSnappingEnabled(enabled: boolean) {
    if (this.startSnappingEnabledValue === enabled) {
      return;
    }

    this.startSnappingEnabledValue = enabled;
    this.updateSashStates();
  }

  get endSnappingEnabled() {
    return this.endSnappingEnabledValue;
  }

  set endSnappingEnabled(enabled: boolean) {
    if (this.endSnappingEnabledValue === enabled) {
      return;
    }

    this.endSnappingEnabledValue = enabled;
    this.updateSashStates();
  }

  constructor(
    readonly orientation: Orientation = Orientation.VERTICAL,
    sashSize?: number,
    private readonly reserveSashSpace = true,
  ) {
    this.explicitSashSize = sashSize;
    this.element.className = [
      'split-view',
      this.orientation === Orientation.VERTICAL ? 'vertical' : 'horizontal',
    ].join(' ');
    this.viewContainer.className = 'split-view-container';
    this.sashContainer.className = 'sash-container';
    this.element.append(this.viewContainer, this.sashContainer);
  }

  get length() {
    return this.items.length;
  }

  get minimumSize() {
    return (
      this.getVisibleItemIndices().reduce(
        (total, index) => total + this.items[index].view.minimumSize,
        0,
      ) + this.getReservedSashSpace()
    );
  }

  get maximumSize() {
    const visibleIndices = this.getVisibleItemIndices();
    if (visibleIndices.some((index) => !Number.isFinite(this.items[index].view.maximumSize))) {
      return Number.POSITIVE_INFINITY;
    }

    return (
      visibleIndices.reduce(
        (total, index) => total + this.items[index].view.maximumSize,
        0,
      ) + this.getReservedSashSpace()
    );
  }

  addView(
    view: IView<TLayoutContext>,
    size: number | Sizing,
    index?: number,
    skipLayout?: boolean,
  ): void;
  addView(
    view: IView<TLayoutContext>,
    size: number | Sizing,
    options?: AddViewOptions,
  ): void;
  addView(
    view: IView<TLayoutContext>,
    size: number | Sizing,
    indexOrOptions: number | AddViewOptions = {},
    skipLayout = false,
  ) {
    const options =
      typeof indexOrOptions === 'number'
        ? { index: indexOrOptions }
        : indexOrOptions;
    const index = options.index ?? this.items.length;
    const resolvedSizing = this.resolveAddViewSizing(view, size, index);
    const visible = options.visible !== false && resolvedSizing.visible !== false;
    const initialSize = this.clampSize(view, resolvedSizing.size);
    const container = document.createElement('div');
    container.className = 'split-view-view';
    if (visible) {
      container.classList.add('visible');
    }
    container.append(view.element);

    insertElementAt(this.viewContainer, container, index);
    this.items.splice(index, 0, {
      view,
      container,
      size: visible ? initialSize : 0,
      cachedVisibleSize: initialSize,
      visible,
      flex: options.flex === true,
      snap: view.snap === true,
    });
    view.setVisible?.(visible);
    this.rebuildSashes();
    if (resolvedSizing.distribute) {
      this.distributeViewSizes();
    }
    if (!skipLayout) {
      this.applyLayout();
    }
  }

  removeView(index: number, sizing?: Sizing) {
    const item = this.items[index];
    if (!item) {
      return null;
    }

    if (this.dragState) {
      this.dragState = null;
    }

    item.container.remove();
    this.items.splice(index, 1);
    this.rebuildSashes();
    this.applyRemoveSizing(sizing, item);
    this.applyLayout();

    return item.view;
  }

  moveView(from: number, to: number): void {
    if (from === to) {
      return;
    }

    const cachedVisibleSize = this.getViewCachedVisibleSize(from);
    const size =
      typeof cachedVisibleSize === 'number'
        ? Sizing.Invisible(cachedVisibleSize)
        : this.getViewSize(from);
    const view = this.removeView(from);
    if (!view) {
      return;
    }

    this.addView(view, size, to);
  }

  swapViews(from: number, to: number): void {
    if (from === to) {
      return;
    }

    if (from > to) {
      this.swapViews(to, from);
      return;
    }

    const fromSize = this.getViewSize(from);
    const toSize = this.getViewSize(to);
    const toView = this.removeView(to);
    const fromView = this.removeView(from);
    if (!fromView || !toView) {
      return;
    }

    this.addView(toView, fromSize, from);
    this.addView(fromView, toSize, to);
  }

  distributeViewSizes(): void {
    const visibleIndices = this.getVisibleItemIndices();
    if (visibleIndices.length === 0) {
      return;
    }

    const primarySize =
      this.orientation === Orientation.VERTICAL ? this.width : this.height;
    const availableSize = Math.max(0, primarySize - this.getReservedSashSpace());
    if (availableSize <= 0) {
      return;
    }

    const flexibleIndices = visibleIndices.filter((index) => {
      const item = this.items[index];
      return item.view.maximumSize - item.view.minimumSize > 0;
    });
    const targetIndices = flexibleIndices.length > 0 ? flexibleIndices : visibleIndices;
    const reservedSize = visibleIndices
      .filter((index) => !targetIndices.includes(index))
      .reduce((total, index) => total + this.items[index].size, 0);
    const targetSize = Math.max(0, availableSize - reservedSize);
    const baseSize = Math.floor(targetSize / targetIndices.length);
    let remainder = targetSize - baseSize * targetIndices.length;

    for (const index of targetIndices) {
      const item = this.items[index];
      const nextSize = this.clampSize(item.view, baseSize + (remainder > 0 ? 1 : 0));
      remainder -= 1;
      item.size = nextSize;
      item.cachedVisibleSize = nextSize;
    }
  }

  setViewVisible(index: number, visible: boolean) {
    if (!this.setItemVisible(index, visible)) {
      return;
    }
    this.applyLayout();
  }

  setViewSize(index: number, size: number) {
    const item = this.items[index];
    if (!item) {
      return;
    }

    const nextSize = this.clampSize(item.view, size);
    item.cachedVisibleSize = nextSize;
    if (item.visible) {
      item.size = nextSize;
    }
    this.applyLayout();
  }

  resizeView(index: number, size: number) {
    const item = this.items[index];
    if (!item) {
      return;
    }

    const nextSize = this.clampSize(item.view, size);
    item.cachedVisibleSize = nextSize;
    if (!item.visible) {
      return;
    }

    const visibleIndices = this.getVisibleItemIndices();
    const targetVisibleIndex = visibleIndices.indexOf(index);
    if (targetVisibleIndex < 0) {
      return;
    }

    const sizes = visibleIndices.map((itemIndex) => this.items[itemIndex].size);
    const currentSize = sizes[targetVisibleIndex];
    if (currentSize === nextSize) {
      return;
    }

    sizes[targetVisibleIndex] = nextSize;

    if (nextSize > currentSize) {
      const overflow = this.rebalanceViewSizes(
        visibleIndices,
        sizes,
        targetVisibleIndex,
        nextSize - currentSize,
        'shrink',
      );
      if (overflow > 0) {
        sizes[targetVisibleIndex] = Math.max(
          item.view.minimumSize,
          sizes[targetVisibleIndex] - overflow,
        );
      }
    } else {
      const remaining = this.rebalanceViewSizes(
        visibleIndices,
        sizes,
        targetVisibleIndex,
        currentSize - nextSize,
        'grow',
      );
      if (remaining > 0) {
        sizes[targetVisibleIndex] = this.clampSize(
          item.view,
          sizes[targetVisibleIndex] + remaining,
        );
      }
    }

    visibleIndices.forEach((itemIndex, visibleIndex) => {
      const targetItem = this.items[itemIndex];
      targetItem.size = sizes[visibleIndex];
      targetItem.cachedVisibleSize = sizes[visibleIndex];
    });
    this.applyLayout();
  }

  getViewSize(index: number) {
    const item = this.items[index];
    if (!item) {
      return 0;
    }

    return item.visible ? item.size : item.cachedVisibleSize;
  }

  getViewCachedVisibleSize(index: number) {
    const item = this.items[index];
    if (!item || item.visible) {
      return undefined;
    }

    return item.cachedVisibleSize;
  }

  isViewVisible(index: number) {
    return this.items[index]?.visible ?? false;
  }

  layout(width: number, height: number, context?: TLayoutContext) {
    this.width = Math.max(0, width);
    this.height = Math.max(0, height);
    this.layoutContext = context;
    this.applyLayout();
  }

  style(styles: ISplitViewStyles): void {
    if (styles.separatorBorder.isTransparent?.() === true) {
      this.element.classList.remove('separator-border');
      this.element.style.removeProperty('--separator-border');
      return;
    }

    this.element.classList.add('separator-border');
    this.element.style.setProperty(
      '--separator-border',
      styles.separatorBorder.toString(),
    );
  }

  dispose() {
    this.dragState = null;
    for (const sashItem of this.sashItems) {
      sashItem.dispose();
    }
    this.sashItems = [];
    this.onDidSashChangeEmitter.dispose();
    this.onDidSashSnapEmitter.dispose();
    this.onDidSashResetEmitter.dispose();
    this.onDidSashEndEmitter.dispose();
    this.element.replaceChildren();
  }

  private resolveAddViewSizing(
    view: IView<TLayoutContext>,
    size: number | Sizing,
    index: number,
  ): { size: number; visible?: boolean; distribute?: boolean } {
    if (typeof size === 'number') {
      return { size };
    }

    if (size.type === 'invisible') {
      return {
        size: this.clampSize(view, size.cachedVisibleSize),
        visible: false,
      };
    }

    if (size.type === 'distribute') {
      const primarySize =
        this.orientation === Orientation.VERTICAL ? this.width : this.height;
      const availableSize = Math.max(0, primarySize - this.getReservedSashSpace());
      return {
        size:
          availableSize > 0
            ? Math.max(view.minimumSize, Math.floor(availableSize / (this.items.length + 1)))
            : view.minimumSize,
        distribute: true,
      };
    }

    const referenceIndex = Math.max(0, Math.min(size.index, this.items.length - 1));
    const referenceItem = this.items[referenceIndex];
    if (!referenceItem) {
      return { size: view.minimumSize };
    }

    const referenceSize = referenceItem.visible
      ? referenceItem.size
      : referenceItem.cachedVisibleSize;
    const newSize = this.clampSize(view, Math.floor(referenceSize / 2));
    const nextReferenceSize = this.clampSize(
      referenceItem.view,
      Math.max(0, referenceSize - newSize),
    );
    referenceItem.cachedVisibleSize = nextReferenceSize;
    if (referenceItem.visible) {
      referenceItem.size = nextReferenceSize;
    }

    if (size.type === 'auto' && index === referenceIndex + 1) {
      return { size: newSize };
    }

    return { size: newSize };
  }

  private applyRemoveSizing(
    sizing: Sizing | undefined,
    removedItem: ViewItem<TLayoutContext>,
  ) {
    if (!sizing) {
      return;
    }

    if (sizing.type === 'distribute' || sizing.type === 'auto') {
      this.distributeViewSizes();
      return;
    }

    if (sizing.type !== 'split') {
      return;
    }

    const referenceItem = this.items[sizing.index];
    if (!referenceItem) {
      return;
    }

    const restoredSize =
      (referenceItem.visible ? referenceItem.size : referenceItem.cachedVisibleSize) +
      (removedItem.visible ? removedItem.size : removedItem.cachedVisibleSize);
    referenceItem.cachedVisibleSize = this.clampSize(referenceItem.view, restoredSize);
    if (referenceItem.visible) {
      referenceItem.size = referenceItem.cachedVisibleSize;
    }
  }

  private rebuildSashes() {
    for (const sashItem of this.sashItems) {
      sashItem.dispose();
    }
    this.sashItems = [];
    this.sashContainer.replaceChildren();

    for (let index = 0; index < this.items.length - 1; index += 1) {
      const leftItemIndex = index;
      const rightItemIndex = index + 1;
      const separator = document.createElement('div');
      separator.className = [
        'split-view-separator',
        this.orientation === Orientation.VERTICAL ? 'vertical' : 'horizontal',
      ].join(' ');
      separator.setAttribute('aria-hidden', 'true');
      this.sashContainer.append(separator);
      const sash = new Sash(this.sashContainer, this.orientation, {
        size: this.explicitSashSize,
        offsetMode: this.reserveSashSpace ? 'start' : 'end',
      });
      const disposeStart = sash.onDidStart((event) => {
        this.handleSashStart(index, leftItemIndex, rightItemIndex, event);
      });
      const disposeChange = sash.onDidChange((event) => {
        this.handleSashChange(index, event);
      });
      const disposeReset = sash.onDidReset(() => {
        this.onDidSashResetEmitter.fire(index);
      });
      const disposeEnd = sash.onDidEnd(() => {
        this.handleSashEnd(index);
      });

      this.sashItems.push({
        leftItemIndex,
        rightItemIndex,
        separator,
        sash,
        dispose: () => {
          disposeStart();
          disposeChange();
          disposeReset();
          disposeEnd();
          separator.remove();
          sash.dispose();
        },
      });
    }
  }

  private handleSashStart(
    sashIndex: number,
    _leftItemIndex: number,
    _rightItemIndex: number,
    event: ISashEvent,
  ) {
    if (sashIndex < 0 || sashIndex >= this.items.length - 1) {
      this.dragState = null;
      return;
    }

    const sizes = this.items.map((item) => item.size);
    const upIndexes = range(sashIndex, -1);
    const downIndexes = range(sashIndex + 1, this.items.length);
    const minDeltaUp = upIndexes.reduce(
      (total, index) => total + (this.getItemMinimumSize(this.items[index]) - sizes[index]),
      0,
    );
    const maxDeltaUp = upIndexes.reduce(
      (total, index) => total + (this.getItemMaximumSize(this.items[index]) - sizes[index]),
      0,
    );
    const maxDeltaDown =
      downIndexes.length === 0
        ? Number.POSITIVE_INFINITY
        : downIndexes.reduce(
            (total, index) =>
              total + (sizes[index] - this.getItemMinimumSize(this.items[index])),
            0,
          );
    const minDeltaDown =
      downIndexes.length === 0
        ? Number.NEGATIVE_INFINITY
        : downIndexes.reduce(
            (total, index) =>
              total + (sizes[index] - this.getItemMaximumSize(this.items[index])),
            0,
          );
    const minDelta = Math.max(minDeltaUp, minDeltaDown);
    const maxDelta = Math.min(maxDeltaDown, maxDeltaUp);

    const snapBeforeIndex = this.findFirstSnapIndex(upIndexes);
    const snapAfterIndex = this.findFirstSnapIndex(downIndexes);
    let snapBefore: SashDragSnapState | undefined;
    let snapAfter: SashDragSnapState | undefined;

    if (typeof snapBeforeIndex === 'number') {
      const viewItem = this.items[snapBeforeIndex];
      const halfSize = this.getSnapThreshold(viewItem);
      snapBefore = {
        itemIndex: snapBeforeIndex,
        limitDelta: viewItem.visible ? minDelta - halfSize : minDelta + halfSize,
        size: viewItem.size,
      };
    }

    if (typeof snapAfterIndex === 'number') {
      const viewItem = this.items[snapAfterIndex];
      const halfSize = this.getSnapThreshold(viewItem);
      snapAfter = {
        itemIndex: snapAfterIndex,
        limitDelta: viewItem.visible ? maxDelta + halfSize : maxDelta - halfSize,
        size: viewItem.size,
      };
    }

    this.dragState = {
      sashIndex,
      start:
        this.orientation === Orientation.VERTICAL ? event.startX : event.startY,
      sizes,
      minDelta,
      maxDelta,
      snapBefore,
      snapAfter,
    };
  }

  private handleSashChange(sashIndex: number, event: ISashEvent) {
    const dragState = this.dragState;
    if (!dragState || dragState.sashIndex !== sashIndex) {
      return;
    }

    const leftItem = this.items[sashIndex];
    const rightItem = this.items[sashIndex + 1];
    if (!leftItem || !rightItem) {
      return;
    }

    const delta =
      this.orientation === Orientation.VERTICAL
        ? event.currentX - dragState.start
        : event.currentY - dragState.start;
    const { delta: constrainedDelta, snapped } = this.resize(
      sashIndex,
      delta,
      dragState.sizes,
      dragState.snapBefore,
      dragState.snapAfter,
    );
    this.applyLayout();
    if (snapped) {
      this.onDidSashSnapEmitter.fire({
        sashIndex,
        itemIndex: snapped.itemIndex,
        visible: snapped.visible,
        sashEvent: event,
      });
    }
    this.onDidSashChangeEmitter.fire({
      sashIndex,
      leftItemIndex: sashIndex,
      rightItemIndex: sashIndex + 1,
      minDelta: dragState.minDelta,
      maxDelta: dragState.maxDelta,
      rawDelta: delta,
      constrainedDelta,
      sashEvent: event,
    });
  }

  private handleSashEnd(sashIndex: number) {
    if (this.dragState?.sashIndex === sashIndex) {
      this.dragState = null;
    }
    this.onDidSashEndEmitter.fire(sashIndex);
  }

  private applyLayout() {
    if (this.width <= 0 || this.height <= 0) {
      return;
    }

    const primarySize =
      this.orientation === Orientation.VERTICAL ? this.width : this.height;
    const orthogonalSize =
      this.orientation === Orientation.VERTICAL ? this.height : this.width;
    const visibleIndices = this.getVisibleItemIndices();
    const availableSize = Math.max(
      0,
      primarySize - this.getReservedSashSpace(),
    );

    this.resolveViewSizes(visibleIndices, availableSize);

    let offset = 0;
    for (let index = 0; index < this.items.length; index += 1) {
      const item = this.items[index];
      item.container.classList.toggle('visible', item.visible);
      if (this.orientation === Orientation.VERTICAL) {
        item.container.style.left = `${offset}px`;
        item.container.style.top = '0';
        item.container.style.width = `${item.size}px`;
        item.container.style.height = `${orthogonalSize}px`;
      } else {
        item.container.style.left = '0';
        item.container.style.top = `${offset}px`;
        item.container.style.width = `${orthogonalSize}px`;
        item.container.style.height = `${item.size}px`;
      }

      item.view.layout(item.size, offset, this.layoutContext);
      offset += item.size;

      if (index < this.sashItems.length) {
        this.layoutSeparator(index, offset, orthogonalSize);
        this.sashItems[index].sash.layout(offset, orthogonalSize);
        if (this.hasReservedGapAfter(index)) {
          offset += this.getSashSize();
        }
      }
    }

    this.updateSashStates();
  }

  private resolveViewSizes(visibleIndices: readonly number[], availableSize: number) {
    if (visibleIndices.length === 0) {
      return;
    }

    const sizes = visibleIndices.map((itemIndex) => {
      const item = this.items[itemIndex];
      const baseSize =
        item.size > 0 ? item.size : Math.max(item.cachedVisibleSize, item.view.minimumSize);
      return this.clampSize(item.view, baseSize);
    });
    let totalSize = sizes.reduce((sum, size) => sum + size, 0);

    if (totalSize < availableSize) {
      let remaining = availableSize - totalSize;
      remaining = this.growViewSizes(visibleIndices, sizes, remaining, true);
      remaining = this.growViewSizes(visibleIndices, sizes, remaining, false);
      if (remaining > 0) {
        const lastIndex = sizes.length - 1;
        sizes[lastIndex] += remaining;
      }
    } else if (totalSize > availableSize) {
      let overflow = totalSize - availableSize;
      overflow = this.shrinkViewSizes(visibleIndices, sizes, overflow, true);
      overflow = this.shrinkViewSizes(visibleIndices, sizes, overflow, false);
      if (overflow > 0) {
        const lastIndex = sizes.length - 1;
        sizes[lastIndex] = Math.max(0, sizes[lastIndex] - overflow);
      }
    }

    totalSize = sizes.reduce((sum, size) => sum + size, 0);
    if (totalSize !== availableSize && sizes.length > 0) {
      sizes[sizes.length - 1] += availableSize - totalSize;
    }

    visibleIndices.forEach((itemIndex, index) => {
      const item = this.items[itemIndex];
      item.size = Math.max(0, sizes[index]);
      item.cachedVisibleSize = item.size;
    });
  }

  private growViewSizes(
    visibleIndices: readonly number[],
    sizes: number[],
    remaining: number,
    flexOnly: boolean,
  ) {
    if (remaining <= 0) {
      return 0;
    }

    for (let index = 0; index < visibleIndices.length; index += 1) {
      const item = this.items[visibleIndices[index]];
      if (item.flex !== flexOnly) {
        continue;
      }

      const maxSize = item.view.maximumSize;
      const growable = Number.isFinite(maxSize)
        ? Math.max(0, maxSize - sizes[index])
        : remaining;
      if (growable <= 0) {
        continue;
      }

      const delta = Math.min(remaining, growable);
      sizes[index] += delta;
      remaining -= delta;
      if (remaining <= 0) {
        return 0;
      }
    }

    return remaining;
  }

  private shrinkViewSizes(
    visibleIndices: readonly number[],
    sizes: number[],
    overflow: number,
    flexOnly: boolean,
  ) {
    if (overflow <= 0) {
      return 0;
    }

    for (let index = 0; index < visibleIndices.length; index += 1) {
      const item = this.items[visibleIndices[index]];
      if (item.flex !== flexOnly) {
        continue;
      }

      const shrinkable = Math.max(0, sizes[index] - item.view.minimumSize);
      if (shrinkable <= 0) {
        continue;
      }

      const delta = Math.min(overflow, shrinkable);
      sizes[index] -= delta;
      overflow -= delta;
      if (overflow <= 0) {
        return 0;
      }
    }

    return overflow;
  }

  private rebalanceViewSizes(
    visibleIndices: readonly number[],
    sizes: number[],
    targetIndex: number,
    delta: number,
    mode: 'grow' | 'shrink',
  ) {
    if (delta <= 0) {
      return 0;
    }

    const candidateOrder = [
      ...sizes.map((_, index) => index).filter((index) => index > targetIndex),
      ...sizes
        .map((_, index) => index)
        .filter((index) => index < targetIndex)
        .reverse(),
    ];

    for (const sizeIndex of candidateOrder) {
      const item = this.items[visibleIndices[sizeIndex]];
      const capacity =
        mode === 'grow'
          ? Number.isFinite(item.view.maximumSize)
            ? Math.max(0, item.view.maximumSize - sizes[sizeIndex])
            : delta
          : Math.max(0, sizes[sizeIndex] - item.view.minimumSize);
      if (capacity <= 0) {
        continue;
      }

      const adjustment = Math.min(delta, capacity);
      sizes[sizeIndex] += mode === 'grow' ? adjustment : -adjustment;
      delta -= adjustment;
      if (delta <= 0) {
        return 0;
      }
    }

    return delta;
  }

  private updateSashStates() {
    const contentSize = this.getContentSize();
    let previous = false;
    const collapsesDown = this.items.map(
      (item) => (previous = item.size - this.getItemMinimumSize(item) > 0 || previous),
    );

    previous = false;
    const expandsDown = this.items.map(
      (item) => (previous = this.getItemMaximumSize(item) - item.size > 0 || previous),
    );

    const reversedItems = [...this.items].reverse();
    previous = false;
    const collapsesUp = reversedItems
      .map((item) => (previous = item.size - this.getItemMinimumSize(item) > 0 || previous))
      .reverse();

    previous = false;
    const expandsUp = reversedItems
      .map((item) => (previous = this.getItemMaximumSize(item) - item.size > 0 || previous))
      .reverse();

    let position = 0;
    for (let index = 0; index < this.sashItems.length; index += 1) {
      const sashItem = this.sashItems[index];
      const sash = sashItem.sash;
      const leftVisible = this.items[sashItem.leftItemIndex]?.visible === true;
      const hasVisibleAfter = this.items
        .slice(sashItem.leftItemIndex + 1)
        .some((item) => item.visible === true);
      sashItem.separator.classList.toggle('visible', leftVisible && hasVisibleAfter);
      position += this.items[index].size;

      const min = !(collapsesDown[index] && expandsUp[index + 1]);
      const max = !(expandsDown[index] && collapsesUp[index + 1]);

      if (min && max) {
        const upIndexes = range(index, -1);
        const downIndexes = range(index + 1, this.items.length);
        const snapBeforeIndex = this.findFirstSnapIndex(upIndexes);
        const snapAfterIndex = this.findFirstSnapIndex(downIndexes);
        const snappedBefore =
          typeof snapBeforeIndex === 'number' && !this.items[snapBeforeIndex].visible;
        const snappedAfter =
          typeof snapAfterIndex === 'number' && !this.items[snapAfterIndex].visible;

        if (
          snappedBefore &&
          collapsesUp[index] &&
          (position > 0 || this.startSnappingEnabledValue)
        ) {
          sash.setState(SashState.AtMinimum);
        } else if (
          snappedAfter &&
          collapsesDown[index] &&
          (position < contentSize || this.endSnappingEnabledValue)
        ) {
          sash.setState(SashState.AtMaximum);
        } else {
          sash.setState(SashState.Disabled);
        }
      } else if (min && !max) {
        sash.setState(SashState.AtMinimum);
      } else if (!min && max) {
        sash.setState(SashState.AtMaximum);
      } else {
        sash.setState(SashState.Enabled);
      }

      if (this.hasReservedGapAfter(index)) {
        position += this.getSashSize();
      }
    }
  }

  private getVisibleItemIndices() {
    return this.items.flatMap((item, index) => (item.visible ? [index] : []));
  }

  private hasReservedGapAfter(index: number) {
    if (!this.reserveSashSpace) {
      return false;
    }

    return this.items[index]?.visible === true && this.items[index + 1]?.visible === true;
  }

  private layoutSeparator(
    index: number,
    offset: number,
    orthogonalSize: number,
  ) {
    const separator = this.sashItems[index]?.separator;
    if (!separator) {
      return;
    }

    const dividerOffset = this.hasReservedGapAfter(index)
      ? offset + this.getSashSize() / 2
      : offset;

    if (this.orientation === Orientation.VERTICAL) {
      separator.style.left = `${dividerOffset - 0.5}px`;
      separator.style.top = '0';
      separator.style.width = '1px';
      separator.style.height = `${orthogonalSize}px`;
      return;
    }

    separator.style.left = '0';
    separator.style.top = `${dividerOffset - 0.5}px`;
    separator.style.width = `${orthogonalSize}px`;
    separator.style.height = '1px';
  }

  private getReservedSashSpace() {
    let count = 0;
    for (let index = 0; index < this.items.length - 1; index += 1) {
      if (this.hasReservedGapAfter(index)) {
        count += 1;
      }
    }
    return count * this.getSashSize();
  }

  private getSashSize() {
    return this.explicitSashSize ?? getGlobalSashSize();
  }

  private getContentSize() {
    return (
      this.items.reduce((total, item) => total + item.size, 0) +
      this.getReservedSashSpace()
    );
  }

  private clampSize(
    view: Pick<IView<TLayoutContext>, 'minimumSize' | 'maximumSize'>,
    size: number,
  ) {
    return clamp(size, view.minimumSize, view.maximumSize);
  }

  private setItemVisible(
    index: number,
    visible: boolean,
    cachedVisibleSize?: number,
  ) {
    const item = this.items[index];
    if (!item || item.visible === visible) {
      return false;
    }

    item.visible = visible;
    if (visible) {
      item.size = this.clampSize(item.view, item.cachedVisibleSize);
    } else {
      item.cachedVisibleSize =
        typeof cachedVisibleSize === 'number' ? cachedVisibleSize : item.size;
      item.size = 0;
    }

    item.container.classList.toggle('visible', visible);
    item.view.setVisible?.(visible);
    return true;
  }

  private resize(
    sashIndex: number,
    delta: number,
    sizes: readonly number[],
    snapBefore?: SashDragSnapState,
    snapAfter?: SashDragSnapState,
  ): { delta: number; snapped?: { itemIndex: number; visible: boolean } } {
    if (sashIndex < 0 || sashIndex >= this.items.length - 1) {
      return { delta: 0 };
    }

    const upIndexes = range(sashIndex, -1);
    const downIndexes = range(sashIndex + 1, this.items.length);
    const minDeltaUp = upIndexes.reduce(
      (total, index) => total + (this.getItemMinimumSize(this.items[index]) - sizes[index]),
      0,
    );
    const maxDeltaUp = upIndexes.reduce(
      (total, index) => total + (this.getItemMaximumSize(this.items[index]) - sizes[index]),
      0,
    );
    const maxDeltaDown =
      downIndexes.length === 0
        ? Number.POSITIVE_INFINITY
        : downIndexes.reduce(
            (total, index) =>
              total + (sizes[index] - this.getItemMinimumSize(this.items[index])),
            0,
          );
    const minDeltaDown =
      downIndexes.length === 0
        ? Number.NEGATIVE_INFINITY
        : downIndexes.reduce(
            (total, index) =>
              total + (sizes[index] - this.getItemMaximumSize(this.items[index])),
            0,
          );
    const minDelta = Math.max(minDeltaUp, minDeltaDown);
    const maxDelta = Math.min(maxDeltaDown, maxDeltaUp);

    if (snapBefore) {
      const snapView = this.items[snapBefore.itemIndex];
      const visible = delta >= snapBefore.limitDelta;
      if (snapView && visible !== snapView.visible) {
        this.setItemVisible(snapBefore.itemIndex, visible, snapBefore.size);
        return {
          ...this.resize(sashIndex, delta, sizes, snapBefore, snapAfter),
          snapped: {
            itemIndex: snapBefore.itemIndex,
            visible,
          },
        };
      }
    }

    if (snapAfter) {
      const snapView = this.items[snapAfter.itemIndex];
      const visible = delta < snapAfter.limitDelta;
      if (snapView && visible !== snapView.visible) {
        this.setItemVisible(snapAfter.itemIndex, visible, snapAfter.size);
        return {
          ...this.resize(sashIndex, delta, sizes, snapBefore, snapAfter),
          snapped: {
            itemIndex: snapAfter.itemIndex,
            visible,
          },
        };
      }
    }

    const constrainedDelta = clamp(delta, minDelta, maxDelta);
    for (let index = 0, deltaUp = constrainedDelta; index < upIndexes.length; index += 1) {
      const itemIndex = upIndexes[index];
      const item = this.items[itemIndex];
      const size = clamp(
        sizes[itemIndex] + deltaUp,
        this.getItemMinimumSize(item),
        this.getItemMaximumSize(item),
      );
      const viewDelta = size - sizes[itemIndex];
      deltaUp -= viewDelta;
      item.size = size;
      if (item.visible) {
        item.cachedVisibleSize = size;
      }
    }

    for (
      let index = 0, deltaDown = constrainedDelta;
      index < downIndexes.length;
      index += 1
    ) {
      const itemIndex = downIndexes[index];
      const item = this.items[itemIndex];
      const size = clamp(
        sizes[itemIndex] - deltaDown,
        this.getItemMinimumSize(item),
        this.getItemMaximumSize(item),
      );
      const viewDelta = size - sizes[itemIndex];
      deltaDown += viewDelta;
      item.size = size;
      if (item.visible) {
        item.cachedVisibleSize = size;
      }
    }

    return { delta: constrainedDelta };
  }

  private getItemMinimumSize(item: ViewItem<TLayoutContext>) {
    return item.visible ? item.view.minimumSize : 0;
  }

  private getItemMaximumSize(item: ViewItem<TLayoutContext>) {
    return item.visible ? item.view.maximumSize : 0;
  }

  private findFirstSnapIndex(indexes: readonly number[]) {
    for (const index of indexes) {
      const item = this.items[index];
      if (!item?.visible) {
        continue;
      }
      if (item.snap) {
        return index;
      }
    }

    for (const index of indexes) {
      const item = this.items[index];
      if (!item) {
        continue;
      }
      if (item.visible && this.getItemMaximumSize(item) - this.getItemMinimumSize(item) > 0) {
        return undefined;
      }
      if (!item.visible && item.snap) {
        return index;
      }
    }

    return undefined;
  }

  private getSnapThreshold(item: Pick<ViewItem<TLayoutContext>, 'view'>) {
    return Math.floor(item.view.minimumSize / 2);
  }
}

export default SplitView;
