import { SimpleTree } from 'cs/base/browser/ui/tree/simpleTree';
import type { SimpleTreeOptions, SimpleTreeRenderer } from 'cs/base/browser/ui/tree/simpleTree';

import type { DataTreeDataSource } from 'cs/base/browser/ui/tree/treeTypes';

export class DataTree<TInput, TNode> {
  private input: TInput | null = null;
  private readonly tree: SimpleTree<TNode>;
  private disposed = false;

  constructor(
    private readonly dataSource: DataTreeDataSource<TInput, TNode>,
    renderer: SimpleTreeRenderer<TNode>,
    options: SimpleTreeOptions<TNode>,
  ) {
    this.tree = new SimpleTree(
      {
        hasChildren: (node) => this.dataSource.hasChildren(node),
        getChildren: (node) => this.dataSource.getChildren(node),
      },
      renderer,
      options,
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

  getInput() {
    return this.input;
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

  setInput(input: TInput | null) {
    if (this.disposed) {
      return;
    }

    this.input = input;
    if (input === null) {
      this.tree.setInput(null);
      return;
    }

    this.tree.setInput(this.dataSource.getRoot(input));
  }

  refresh(node?: TNode) {
    if (this.disposed) {
      return;
    }

    void node;
    this.tree.rerender();
  }

  rerender() {
    if (this.disposed) {
      return;
    }

    if (this.input === null) {
      return;
    }

    this.tree.setInput(this.dataSource.getRoot(this.input));
  }
}
