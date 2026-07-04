import type {
  IView as ISplitView,
  LayoutPriority,
  Sizing,
  SplitViewSashChangeEvent,
  SplitViewSashSnapEvent,
} from 'cs/base/browser/ui/splitview/splitview';
import { getGlobalSashSize } from 'cs/base/browser/ui/sash/sash';
import { EventEmitter } from 'cs/base/common/event';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { Orientation, SplitView } from 'cs/base/browser/ui/splitview/splitview';

import 'cs/base/browser/ui/grid/gridview.css';

export { Orientation } from 'cs/base/browser/ui/splitview/splitview';
export { LayoutPriority, Sizing } from 'cs/base/browser/ui/splitview/splitview';

export interface IGridViewStyles {}

export interface IViewSize {
  readonly width: number;
  readonly height: number;
}

export interface IGridView {
  readonly element: HTMLElement;
  readonly minimumWidth: number;
  readonly maximumWidth: number;
  readonly minimumHeight: number;
  readonly maximumHeight: number;
  readonly priority?: LayoutPriority;
  readonly proportionalLayout?: boolean;
  readonly snap?: boolean;
  layout(width: number, height: number): void;
  setVisible?(visible: boolean): void;
}

export interface IView extends IGridView {}

export interface ISerializableView extends IView {
  toJSON(): object;
}

export interface IViewDeserializer<T extends ISerializableView> {
  fromJSON(json: unknown): T;
}

export interface ISerializedLeafNode {
  type: 'leaf';
  data: unknown;
  size: number;
  visible?: boolean;
  maximized?: boolean;
}

export interface ISerializedBranchNode {
  type: 'branch';
  data: ISerializedNode[];
  size: number;
  visible?: boolean;
}

export type ISerializedNode = ISerializedLeafNode | ISerializedBranchNode;

export interface ISerializedGridView {
  root: ISerializedNode;
  orientation: Orientation;
  width: number;
  height: number;
}

export type GridChild = {
  view: IGridView;
  size: number | Sizing;
  visible?: boolean;
  flex?: boolean;
};

export type GridLocation = number[];
export type GridSashChangeEvent = SplitViewSashChangeEvent & {
  location: GridLocation;
};
export type GridSashSnapEvent = SplitViewSashSnapEvent & {
  location: GridLocation;
};
export type AddGridChildOptions = {
  visible?: boolean;
  flex?: boolean;
  splitOrientation?: Orientation;
};

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function minFinite(values: number[]) {
  return values.some((value) => !Number.isFinite(value))
    ? Number.POSITIVE_INFINITY
    : Math.min(...values);
}

export function orthogonal(orientation: Orientation): Orientation {
  return orientation === Orientation.VERTICAL
    ? Orientation.HORIZONTAL
    : Orientation.VERTICAL;
}

class GridChildAdapter implements ISplitView {
  constructor(
    private readonly orientation: Orientation,
    private readonly owner: GridBranchView,
    readonly view: IGridView,
  ) {}

  get element() {
    return this.view.element;
  }

  get minimumSize() {
    return this.orientation === Orientation.VERTICAL
      ? this.view.minimumWidth
      : this.view.minimumHeight;
  }

  get maximumSize() {
    return this.orientation === Orientation.VERTICAL
      ? this.view.maximumWidth
      : this.view.maximumHeight;
  }

  get snap() {
    return this.view.snap;
  }

  get priority() {
    return this.view.priority;
  }

  get proportionalLayout() {
    return this.view.proportionalLayout;
  }

  layout(size: number, offset: number) {
    const childLeft =
      this.orientation === Orientation.VERTICAL ? this.owner.left + offset : this.owner.left;
    const childTop =
      this.orientation === Orientation.HORIZONTAL ? this.owner.top + offset : this.owner.top;
    const childWidth =
      this.orientation === Orientation.VERTICAL ? size : this.owner.width;
    const childHeight =
      this.orientation === Orientation.HORIZONTAL ? size : this.owner.height;

    if (this.view instanceof GridBranchView) {
      this.view.layoutBounds(
        childWidth,
        childHeight,
        childTop,
        childLeft,
        this.owner.rootWidth,
        this.owner.rootHeight,
      );
      return;
    }

    if (this.orientation === Orientation.VERTICAL) {
      this.view.layout(childWidth, childHeight);
      return;
    }

    this.view.layout(childWidth, childHeight);
  }

  setVisible(visible: boolean) {
    this.view.setVisible?.(visible);
  }
}

export class GridBranchView implements IGridView {
  readonly element = document.createElement('div');
  private readonly splitView: SplitView;
  private readonly children: GridChild[] = [];
  private readonly adapters: GridChildAdapter[] = [];
  private readonly onDidSashChangeEmitter = new EventEmitter<SplitViewSashChangeEvent>();
  private readonly onDidSashSnapEmitter = new EventEmitter<SplitViewSashSnapEvent>();
  private readonly onDidSashEndEmitter = new EventEmitter<number>();
  private readonly sashSize: number | undefined;
  private readonly reserveSashSpace: boolean;
  private edgeSnappingValue = false;
  private widthValue = 0;
  private heightValue = 0;
  private topValue = 0;
  private leftValue = 0;
  private rootWidthValue = 0;
  private rootHeightValue = 0;
  private readonly splitViewDisposables = new DisposableStore();

  readonly onDidSashChange = this.onDidSashChangeEmitter.event;
  readonly onDidSashSnap = this.onDidSashSnapEmitter.event;
  readonly onDidSashEnd = this.onDidSashEndEmitter.event;

  constructor(
    readonly orientation: Orientation,
    sashSize: number | undefined,
    reserveSashSpaceOrChildren: boolean | GridChild[] = true,
    childrenArg: GridChild[] = [],
  ) {
    const reserveSashSpace = Array.isArray(reserveSashSpaceOrChildren)
      ? true
      : reserveSashSpaceOrChildren;
    const children = Array.isArray(reserveSashSpaceOrChildren)
      ? reserveSashSpaceOrChildren
      : childrenArg;
    this.sashSize = sashSize;
    this.reserveSashSpace = reserveSashSpace;
    this.element.className = [
      'comet-grid-view-branch',
      this.orientation === Orientation.VERTICAL ? 'comet-vertical' : 'comet-horizontal',
    ].join(' ');
    this.splitView = new SplitView(orientation, sashSize, reserveSashSpace);
    this.element.append(this.splitView.element);
    this.splitViewDisposables.add(
      this.splitView.onDidSashChange((event) => {
        this.onDidSashChangeEmitter.fire(event);
      }),
    );
    this.splitViewDisposables.add(
      this.splitView.onDidSashSnap((event) => {
        const child = this.children[event.itemIndex];
        if (child) {
          child.visible = event.visible;
        }
        this.onDidSashSnapEmitter.fire(event);
      }),
    );
    this.splitViewDisposables.add(
      this.splitView.onDidSashEnd((index) => {
        this.onDidSashEndEmitter.fire(index);
      }),
    );

    for (const child of children) {
      this.addChild(child);
    }
  }

  get width() {
    return this.widthValue;
  }

  get height() {
    return this.heightValue;
  }

  get top() {
    return this.topValue;
  }

  get left() {
    return this.leftValue;
  }

  get rootWidth() {
    return this.rootWidthValue;
  }

  get rootHeight() {
    return this.rootHeightValue;
  }

  get edgeSnapping() {
    return this.edgeSnappingValue;
  }

  set edgeSnapping(edgeSnapping: boolean) {
    if (this.edgeSnappingValue === edgeSnapping) {
      return;
    }

    this.edgeSnappingValue = edgeSnapping;
    for (const child of this.children) {
      if (child.view instanceof GridBranchView) {
        child.view.edgeSnapping = edgeSnapping;
      }
    }
    this.updateSplitviewEdgeSnappingEnablement();
  }

  get minimumWidth() {
    const visibleChildren = this.getVisibleChildren();
    if (visibleChildren.length === 0) {
      return 0;
    }

    if (this.orientation === Orientation.VERTICAL) {
      return (
        sum(visibleChildren.map(({ view }) => view.minimumWidth)) +
        this.getVisibleSashSpan()
      );
    }

    return Math.max(...visibleChildren.map(({ view }) => view.minimumWidth));
  }

  get maximumWidth() {
    const visibleChildren = this.getVisibleChildren();
    if (visibleChildren.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    if (this.orientation === Orientation.VERTICAL) {
      return (
        sum(visibleChildren.map(({ view }) => view.maximumWidth)) +
        this.getVisibleSashSpan()
      );
    }

    return minFinite(visibleChildren.map(({ view }) => view.maximumWidth));
  }

  get minimumHeight() {
    const visibleChildren = this.getVisibleChildren();
    if (visibleChildren.length === 0) {
      return 0;
    }

    if (this.orientation === Orientation.HORIZONTAL) {
      return (
        sum(visibleChildren.map(({ view }) => view.minimumHeight)) +
        this.getVisibleSashSpan()
      );
    }

    return Math.max(...visibleChildren.map(({ view }) => view.minimumHeight));
  }

  get maximumHeight() {
    const visibleChildren = this.getVisibleChildren();
    if (visibleChildren.length === 0) {
      return Number.POSITIVE_INFINITY;
    }

    if (this.orientation === Orientation.HORIZONTAL) {
      return (
        sum(visibleChildren.map(({ view }) => view.maximumHeight)) +
        this.getVisibleSashSpan()
      );
    }

    return minFinite(visibleChildren.map(({ view }) => view.maximumHeight));
  }

  addChild(child: GridChild) {
    this.insertChild(this.children.length, child);
  }

  insertChild(index: number, child: GridChild) {
    const adapter = new GridChildAdapter(this.orientation, this, child.view);
    const normalizedIndex = Math.max(0, Math.min(index, this.children.length));
    if (child.view instanceof GridBranchView) {
      child.view.edgeSnapping = this.edgeSnappingValue;
    }
    this.children.splice(normalizedIndex, 0, {
      ...child,
      visible: child.visible !== false,
    });
    this.adapters.splice(normalizedIndex, 0, adapter);
    this.splitView.addView(adapter, child.size, {
      visible: child.visible !== false,
      flex: child.flex === true,
      index: normalizedIndex,
    });
  }

  removeChild(index: number) {
    const child = this.children[index];
    if (!child) {
      return null;
    }

    const size = this.splitView.getViewSize(index);
    this.children.splice(index, 1);
    this.adapters.splice(index, 1);
    this.splitView.removeView(index);
    return {
      ...child,
      size,
    };
  }

  replaceChild(index: number, child: GridChild) {
    this.removeChild(index);
    this.insertChild(index, child);
  }

  setChildVisible(index: number, visible: boolean) {
    const child = this.children[index];
    if (!child || child.visible === visible) {
      return;
    }

    child.visible = visible;
    this.splitView.setViewVisible(index, visible);
  }

  setChildSize(index: number, size: number) {
    this.splitView.resizeView(index, size);
  }

  getChildSize(index: number) {
    return this.splitView.getViewSize(index);
  }

  isChildVisible(index: number) {
    return this.children[index]?.visible !== false;
  }

  getChildView(index: number) {
    return this.children[index]?.view ?? null;
  }

  getChild(index: number) {
    const child = this.children[index];
    if (!child) {
      return null;
    }

    return {
      ...child,
      size: this.splitView.getViewSize(index),
    };
  }

  getChildCount() {
    return this.children.length;
  }

  getSashSize() {
    return this.sashSize ?? getGlobalSashSize();
  }

  getReserveSashSpace() {
    return this.reserveSashSpace;
  }

  layout(width: number, height: number) {
    this.layoutBounds(width, height, 0, 0, width, height);
  }

  layoutBounds(
    width: number,
    height: number,
    top: number,
    left: number,
    rootWidth: number,
    rootHeight: number,
  ) {
    this.widthValue = Math.max(0, width);
    this.heightValue = Math.max(0, height);
    this.topValue = Math.max(0, top);
    this.leftValue = Math.max(0, left);
    this.rootWidthValue = Math.max(0, rootWidth);
    this.rootHeightValue = Math.max(0, rootHeight);
    this.updateSplitviewEdgeSnappingEnablement();
    this.splitView.layout(this.widthValue, this.heightValue);
  }

  setVisible(visible: boolean) {
    this.splitView.element.classList.toggle('comet-is-hidden', !visible);
  }

  dispose() {
    this.splitViewDisposables.dispose();
    this.onDidSashChangeEmitter.dispose();
    this.onDidSashSnapEmitter.dispose();
    this.onDidSashEndEmitter.dispose();
    this.splitView.dispose();
    this.element.replaceChildren();
  }

  private getVisibleChildren() {
    return this.children.filter((child) => child.visible !== false);
  }

  private getVisibleSashSpan() {
    if (!this.reserveSashSpace) {
      return 0;
    }

    return Math.max(0, this.getVisibleChildren().length - 1) * this.getSashSize();
  }

  private updateSplitviewEdgeSnappingEnablement() {
    if (this.orientation === Orientation.VERTICAL) {
      this.splitView.startSnappingEnabled =
        this.edgeSnappingValue || this.topValue > 0;
      this.splitView.endSnappingEnabled =
        this.edgeSnappingValue ||
        this.topValue + this.heightValue < this.rootHeightValue;
      return;
    }

    this.splitView.startSnappingEnabled =
      this.edgeSnappingValue || this.leftValue > 0;
    this.splitView.endSnappingEnabled =
      this.edgeSnappingValue ||
      this.leftValue + this.widthValue < this.rootWidthValue;
  }
}

export class GridView implements IGridView {
  readonly element = document.createElement('div');
  private readonly onDidSashChangeEmitter = new EventEmitter<GridSashChangeEvent>();
  private readonly onDidSashSnapEmitter = new EventEmitter<GridSashSnapEvent>();
  private readonly onDidSashEndEmitter = new EventEmitter<GridLocation>();
  private readonly gridDisposables = new DisposableStore();
  private edgeSnappingValue = false;

  readonly onDidSashChange = this.onDidSashChangeEmitter.event;
  readonly onDidSashSnap = this.onDidSashSnapEmitter.event;
  readonly onDidSashEnd = this.onDidSashEndEmitter.event;

  constructor(readonly root: GridBranchView) {
    this.element.className = 'comet-grid-view-root';
    this.element.append(root.element);
    this.bindBranchEvents(root, []);
  }

  get minimumWidth() {
    return this.root.minimumWidth;
  }

  get maximumWidth() {
    return this.root.maximumWidth;
  }

  get minimumHeight() {
    return this.root.minimumHeight;
  }

  get maximumHeight() {
    return this.root.maximumHeight;
  }

  get edgeSnapping() {
    return this.edgeSnappingValue;
  }

  set edgeSnapping(edgeSnapping: boolean) {
    this.edgeSnappingValue = edgeSnapping;
    this.root.edgeSnapping = edgeSnapping;
  }

  layout(width: number, height: number) {
    this.root.layout(width, height);
  }

  setVisible(visible: boolean) {
    this.root.setVisible?.(visible);
  }

  addView(
    view: IGridView,
    size: number | Sizing,
    location: readonly number[],
    options: AddGridChildOptions = {},
  ) {
    if (location.length === 0) {
      return;
    }

    const index = location[location.length - 1] ?? 0;
    const targetLocation = location.slice(0, -1);
    const target = this.getView(targetLocation);

    if (target instanceof GridBranchView) {
      target.insertChild(index, {
        view,
        size,
        visible: options.visible,
        flex: options.flex,
      });
      this.rebindBranchEvents();
      return;
    }

    const parent = this.getParentBranch(targetLocation);
    if (!parent || typeof options.splitOrientation === 'undefined') {
      return;
    }

    const existingChild = parent.branch.getChild(parent.index);
    if (!existingChild) {
      return;
    }

    const parentSize = parent.branch.getChildSize(parent.index);
    const availableSize = Math.max(0, parentSize - parent.branch.getSashSize());
    const requestedSize = typeof size === 'number' ? size : Math.floor(availableSize / 2);
    const newChildSize = Math.min(requestedSize, availableSize);
    const existingSize = Math.max(0, availableSize - newChildSize);
    const branch = new GridBranchView(
      options.splitOrientation,
      parent.branch.getSashSize(),
      parent.branch.getReserveSashSpace(),
      [],
    );
    branch.edgeSnapping = parent.branch.edgeSnapping;
    const nextChildren =
      index === 0
        ? [
            {
              view,
              size: newChildSize,
              visible: options.visible,
              flex: options.flex,
            },
            {
              view: existingChild.view,
              size: existingSize,
              visible: existingChild.visible,
              flex: existingChild.flex,
            },
          ]
        : [
            {
              view: existingChild.view,
              size: existingSize,
              visible: existingChild.visible,
              flex: existingChild.flex,
            },
            {
              view,
              size: newChildSize,
              visible: options.visible,
              flex: options.flex,
            },
          ];

    for (const child of nextChildren) {
      branch.addChild(child);
    }

    parent.branch.replaceChild(parent.index, {
      view: branch,
      size: parentSize,
      visible: existingChild.visible,
    });
    this.rebindBranchEvents();
  }

  getView(location: readonly number[] = []) {
    let current: IGridView | null = this.root;

    for (const index of location) {
      if (!(current instanceof GridBranchView)) {
        return null;
      }
      current = current.getChildView(index);
    }

    return current;
  }

  setViewVisible(location: readonly number[], visible: boolean) {
    const parent = this.getParentBranch(location);
    if (!parent) {
      return;
    }

    parent.branch.setChildVisible(parent.index, visible);
  }

  setViewSize(location: readonly number[], size: number) {
    const parent = this.getParentBranch(location);
    if (!parent) {
      return;
    }

    parent.branch.setChildSize(parent.index, size);
  }

  getViewSize(location: readonly number[]) {
    const parent = this.getParentBranch(location);
    if (!parent) {
      return 0;
    }

    return parent.branch.getChildSize(parent.index);
  }

  isViewVisible(location: readonly number[]) {
    const parent = this.getParentBranch(location);
    if (!parent) {
      return false;
    }

    return parent.branch.isChildVisible(parent.index);
  }

  removeView(location: readonly number[]) {
    const parent = this.getParentBranch(location);
    if (!parent) {
      return null;
    }

    const removedChild = parent.branch.removeChild(parent.index);
    if (!removedChild) {
      return null;
    }

    const parentLocation = location.slice(0, -1);
    if (parentLocation.length > 0) {
      const collapsedParent = this.getView(parentLocation);
      if (
        collapsedParent instanceof GridBranchView &&
        collapsedParent.getChildCount() === 1
      ) {
        const grandParent = this.getParentBranch(parentLocation);
        const onlyChild = collapsedParent.getChild(0);
        if (grandParent && onlyChild) {
          const branchSize = grandParent.branch.getChildSize(grandParent.index);
          grandParent.branch.replaceChild(grandParent.index, {
            ...onlyChild,
            size: branchSize,
          });
          collapsedParent.dispose();
        }
      }
    }

    this.rebindBranchEvents();
    return removedChild.view;
  }

  dispose() {
    this.gridDisposables.dispose();
    this.onDidSashChangeEmitter.dispose();
    this.onDidSashSnapEmitter.dispose();
    this.onDidSashEndEmitter.dispose();
    this.root.dispose();
    this.element.replaceChildren();
  }

  private rebindBranchEvents() {
    this.gridDisposables.clear();
    this.bindBranchEvents(this.root, []);
  }

  private bindBranchEvents(branch: GridBranchView, path: GridLocation) {
    this.gridDisposables.add(
      branch.onDidSashChange((event) => {
        this.onDidSashChangeEmitter.fire({
          ...event,
          location: [...path, event.sashIndex],
        });
      }),
    );
    this.gridDisposables.add(
      branch.onDidSashSnap((event) => {
        this.onDidSashSnapEmitter.fire({
          ...event,
          location: [...path, event.sashIndex],
        });
      }),
    );
    this.gridDisposables.add(
      branch.onDidSashEnd((index) => {
        this.onDidSashEndEmitter.fire([...path, index]);
      }),
    );

    let childIndex = 0;
    let child = branch.getChildView(childIndex);
    while (child) {
      if (child instanceof GridBranchView) {
        this.bindBranchEvents(child, [...path, childIndex]);
      }
      childIndex += 1;
      child = branch.getChildView(childIndex);
    }
  }

  private getParentBranch(location: readonly number[]) {
    if (location.length === 0) {
      return null;
    }

    const index = location[location.length - 1] ?? 0;
    const parentLocation = location.slice(0, -1);
    const parent = this.getView(parentLocation);
    if (!(parent instanceof GridBranchView)) {
      return null;
    }

    return {
      branch: parent,
      index,
    };
  }
}
