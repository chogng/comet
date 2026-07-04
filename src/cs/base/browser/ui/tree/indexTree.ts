import { SimpleTree } from 'cs/base/browser/ui/tree/simpleTree';
import type { SimpleTreeOptions, SimpleTreeRenderContext } from 'cs/base/browser/ui/tree/simpleTree';

import type { IndexTreeElement } from 'cs/base/browser/ui/tree/treeTypes';

type IndexTreeNode<T> = {
  element: T;
  children: IndexTreeNode<T>[];
  location: number[];
  collapsible: boolean;
  collapsed: boolean;
  isRoot: boolean;
};

export type IndexTreeRenderer<T> = {
  renderElement(element: T, context: SimpleTreeRenderContext): HTMLElement;
};

export type IndexTreeOptions<T> = Omit<
  SimpleTreeOptions<IndexTreeNode<T>>,
  'getId' | 'isRoot' | 'getLabel' | 'getNodeState' | 'onDidChangeSelection' | 'onDidOpen'
> & {
  getId: (element: T) => string;
  getLabel?: (element: T) => string;
  getNodeState?: (element: T) => {
    loading?: boolean;
    error?: boolean;
  };
  onDidChangeSelection?: (element: T | null) => void;
  onDidOpen?: (element: T) => void;
};

function cloneLocation(location: number[]) {
  return [...location];
}

export class IndexTree<T> {
  private readonly root: IndexTreeNode<T>;
  private readonly tree: SimpleTree<IndexTreeNode<T>>;
  private disposed = false;

  constructor(
    rootElement: T,
    renderer: IndexTreeRenderer<T>,
    private readonly options: IndexTreeOptions<T>,
  ) {
    this.root = {
      element: rootElement,
      children: [],
      location: [],
      collapsible: true,
      collapsed: false,
      isRoot: true,
    };

    this.tree = new SimpleTree(
      {
        hasChildren: (node) =>
          node.collapsible && node.children.length > 0,
        getChildren: (node) =>
          node.collapsed ? [] : node.children,
      },
      {
        renderElement: (node, context) =>
          renderer.renderElement(node.element, context),
      },
      {
        ...options,
        getId: (node) =>
          node.isRoot
            ? '__index_tree_root__'
            : `${this.options.getId(node.element)}:${node.location.join('.')}`,
        isRoot: (node) => node.isRoot,
        getLabel: options.getLabel
          ? (node) => options.getLabel!(node.element)
          : undefined,
        getNodeState: options.getNodeState
          ? (node) => options.getNodeState!(node.element)
          : undefined,
        onDidChangeSelection: (node) =>
          options.onDidChangeSelection?.(node?.isRoot ? null : (node?.element ?? null)),
        onDidOpen: (node) => {
          if (!node.isRoot) {
            options.onDidOpen?.(node.element);
          }
        },
      },
    );

    this.tree.setInput(this.root);
  }

  getElement() {
    return this.tree.getElement();
  }

  setAriaLabel(label: string) {
    this.tree.setAriaLabel(label);
  }

  focus() {
    if (this.disposed) {
      return;
    }

    this.tree.focus();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.tree.dispose();
  }

  getSelection() {
    if (this.disposed) {
      return null;
    }

    return this.tree.getSelection()?.element ?? null;
  }

  setSelection(element: T | null) {
    if (this.disposed) {
      return;
    }

    this.tree.setSelection(element ? this.findNode(element) : null);
  }

  getFocus() {
    if (this.disposed) {
      return null;
    }

    return this.tree.getFocus()?.element ?? null;
  }

  setFocus(element: T | null) {
    if (this.disposed) {
      return;
    }

    this.tree.setFocus(element ? this.findNode(element) : null);
  }

  splice(
    location: number[],
    deleteCount: number,
    toInsert: Iterable<IndexTreeElement<T>> = [],
  ) {
    if (this.disposed) {
      return;
    }

    if (location.length === 0) {
      throw new Error('IndexTree splice requires a non-empty location');
    }

    const parent = this.getNode(location.slice(0, -1));
    const index = location[location.length - 1] ?? 0;
    const nextChildren = [...parent.children];
    nextChildren.splice(
      index,
      deleteCount,
      ...[...toInsert].map((element, offset) =>
        this.createNode(element, [...parent.location, index + offset]),
      ),
    );
    parent.children = nextChildren;
    this.reindexChildren(parent);
    this.tree.rerender();
  }

  rerender(location?: number[]) {
    if (this.disposed) {
      return;
    }

    void location;
    this.tree.rerender();
  }

  updateElementHeight(location: number[], height: number | undefined) {
    void location;
    void height;
  }

  private createNode(
    element: IndexTreeElement<T>,
    location: number[],
  ): IndexTreeNode<T> {
    const node: IndexTreeNode<T> = {
      element: element.element,
      children: [],
      location: cloneLocation(location),
      collapsible: element.collapsible ?? Boolean(element.children?.length),
      collapsed: element.collapsed ?? false,
      isRoot: false,
    };
    node.children = (element.children ?? []).map((child, index) =>
      this.createNode(child, [...location, index]),
    );
    return node;
  }

  private getNode(location: number[]) {
    let current = this.root;
    for (const index of location) {
      const next = current.children[index];
      if (!next) {
        throw new Error(`IndexTree location not found: ${location.join('.')}`);
      }
      current = next;
    }
    return current;
  }

  private reindexChildren(parent: IndexTreeNode<T>) {
    parent.children.forEach((child, index) => {
      child.location = [...parent.location, index];
      this.reindexChildren(child);
    });
  }

  private findNode(element: T) {
    const queue = [...this.root.children];
    while (queue.length > 0) {
      const node = queue.shift()!;
      if (node.element === element) {
        return node;
      }
      queue.push(...node.children);
    }
    return null;
  }
}
