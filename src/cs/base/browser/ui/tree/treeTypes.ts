export type TreeChildrenProvider<TNode> = {
  hasChildren(node: TNode): boolean;
  getChildren(node: TNode): TNode[] | Promise<TNode[]>;
};

export type DataTreeDataSource<TInput, TNode> = {
  getRoot(input: TInput): TNode;
  hasChildren(node: TNode): boolean;
  getChildren(node: TNode): TNode[];
};

export type AsyncDataTreeDataSource<TInput, TNode> =
  TreeChildrenProvider<TNode> & {
    getRoot(input: TInput): Promise<TNode> | TNode;
  };

export type ObjectTreeElement<T> = {
  element: T;
  children?: ObjectTreeElement<T>[];
};

export type IndexTreeElement<T> = {
  element: T;
  children?: IndexTreeElement<T>[];
  collapsible?: boolean;
  collapsed?: boolean;
};
