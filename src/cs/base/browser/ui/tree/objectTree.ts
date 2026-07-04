import { DataTree } from 'cs/base/browser/ui/tree/dataTree';
import type {
  SimpleTreeOptions,
  SimpleTreeRenderer,
} from 'cs/base/browser/ui/tree/simpleTree';
import type {
  DataTreeDataSource,
  ObjectTreeElement,
} from 'cs/base/browser/ui/tree/treeTypes';

type ObjectTreeNode<T> =
  | {
      kind: 'root';
      children: ObjectTreeElement<T>[];
    }
  | {
      kind: 'element';
      element: T;
      children: ObjectTreeElement<T>[];
    };

function createNode<T>(element: ObjectTreeElement<T>): ObjectTreeNode<T> {
  return {
    kind: 'element',
    element: element.element,
    children: element.children ?? [],
  };
}

export class ObjectTree<T> {
  private readonly tree: DataTree<ObjectTreeElement<T>[], ObjectTreeNode<T>>;
  private readonly dataSource: DataTreeDataSource<
    ObjectTreeElement<T>[],
    ObjectTreeNode<T>
  > = {
    getRoot: (input) => ({
      kind: 'root',
      children: input,
    }),
    hasChildren: (node) => node.children.length > 0,
    getChildren: (node) => node.children.map((child) => createNode(child)),
  };

  constructor(
    renderer: SimpleTreeRenderer<ObjectTreeNode<T>>,
    options: SimpleTreeOptions<ObjectTreeNode<T>>,
  ) {
    this.tree = new DataTree(this.dataSource, renderer, options);
  }

  getElement() {
    return this.tree.getElement();
  }

  setAriaLabel(label: string) {
    this.tree.setAriaLabel(label);
  }

  focus() {
    this.tree.focus();
  }

  refresh() {
    this.tree.refresh();
  }

  setChildren(children: ObjectTreeElement<T>[]) {
    this.tree.setInput(children);
  }
}
