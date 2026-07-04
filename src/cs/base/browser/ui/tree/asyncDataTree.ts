import { SimpleTree } from 'cs/base/browser/ui/tree/simpleTree';
import type { SimpleTreeOptions, SimpleTreeRenderer } from 'cs/base/browser/ui/tree/simpleTree';

import type { AsyncDataTreeDataSource } from 'cs/base/browser/ui/tree/treeTypes';

export class AsyncDataTree<TInput, TNode> {
  private input: TInput | null = null;
  private root: TNode | null = null;
  private readonly childrenCache = new Map<string, TNode[]>();
  private readonly pendingChildren = new Map<string, Promise<void>>();
  private readonly loadingIds = new Set<string>();
  private readonly loadErrors = new Map<string, unknown>();
  private rootLoading = false;
  private rootError: unknown = null;
  private readonly tree: SimpleTree<TNode>;
  private disposed = false;

  constructor(
    private readonly dataSource: AsyncDataTreeDataSource<TInput, TNode>,
    private readonly getId: (node: TNode) => string,
    renderer: SimpleTreeRenderer<TNode>,
    options: SimpleTreeOptions<TNode>,
  ) {
    const getNodeState = options.getNodeState;
    this.tree = new SimpleTree(
      {
        hasChildren: (node) => this.dataSource.hasChildren(node),
        getChildren: (node) => this.getChildren(node),
      },
      renderer,
      {
        ...options,
        getNodeState: (node) => ({
          ...getNodeState?.(node),
          loading: this.loadingIds.has(this.getId(node)),
          error: this.loadErrors.has(this.getId(node)),
        }),
      },
    );
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

    return this.tree.getSelection();
  }

  setSelection(node: TNode | null) {
    if (this.disposed) {
      return;
    }

    this.tree.setSelection(node);
  }

  getFocus() {
    if (this.disposed) {
      return null;
    }

    return this.tree.getFocus();
  }

  setFocus(node: TNode | null) {
    if (this.disposed) {
      return;
    }

    this.tree.setFocus(node);
  }

  async setInput(input: TInput | null) {
    if (this.disposed) {
      return;
    }

    this.input = input;
    this.childrenCache.clear();
    this.pendingChildren.clear();
    this.loadingIds.clear();
    this.loadErrors.clear();
    this.root = null;
    if (input === null) {
      this.rootLoading = false;
      this.rootError = null;
      this.tree.getElement().dataset['treeRootState'] = 'idle';
      this.tree.setInput(null);
      return;
    }

    this.rootLoading = true;
    this.rootError = null;
    this.tree.getElement().dataset['treeRootState'] = 'loading';
    try {
      this.root = await this.dataSource.getRoot(input);
      if (this.disposed) {
        return;
      }
      this.rootLoading = false;
      this.tree.getElement().dataset['treeRootState'] = 'ready';
      this.tree.setInput(this.root);
    } catch (error) {
      if (this.disposed) {
        return;
      }
      this.rootLoading = false;
      this.rootError = error;
      this.tree.getElement().dataset['treeRootState'] = 'error';
      this.tree.getElement().replaceChildren();
    }
  }

  async refresh(node?: TNode) {
    if (this.disposed) {
      return;
    }

    if (!this.input) {
      return;
    }

    if (!node) {
      await this.setInput(this.input);
      return;
    }

    this.childrenCache.delete(this.getId(node));
    this.pendingChildren.delete(this.getId(node));
    this.loadingIds.delete(this.getId(node));
    this.loadErrors.delete(this.getId(node));
    this.tree.rerender();
  }

  isRootLoading() {
    return this.rootLoading;
  }

  getRootError() {
    return this.rootError;
  }

  isNodeLoading(node: TNode) {
    return this.loadingIds.has(this.getId(node));
  }

  getNodeError(node: TNode) {
    return this.loadErrors.get(this.getId(node)) ?? null;
  }

  private getChildren(node: TNode): TNode[] {
    if (this.disposed) {
      return [];
    }

    const nodeId = this.getId(node);
    const cached = this.childrenCache.get(nodeId);
    if (cached) {
      return cached;
    }

    if (!this.pendingChildren.has(nodeId)) {
      this.loadingIds.add(nodeId);
      this.loadErrors.delete(nodeId);
      const loadPromise = Promise.resolve(this.dataSource.getChildren(node))
        .then((children) => {
          if (this.disposed) {
            return;
          }
          this.loadingIds.delete(nodeId);
          this.childrenCache.set(nodeId, children);
          this.pendingChildren.delete(nodeId);
          this.tree.rerender();
        })
        .catch((error) => {
          if (this.disposed) {
            return;
          }
          this.loadingIds.delete(nodeId);
          this.loadErrors.set(nodeId, error);
          this.pendingChildren.delete(nodeId);
          this.tree.rerender();
        });
      this.pendingChildren.set(nodeId, loadPromise);
      this.tree.rerender();
    }

    return [];
  }
}
