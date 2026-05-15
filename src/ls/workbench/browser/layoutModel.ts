import { Orientation } from 'ls/base/browser/ui/grid/gridview';

export type LayoutLeafId =
  | 'primarySidebar'
  | 'editor'
  | 'agentSidebar';

export type LayoutLeafNode = {
  type: 'leaf';
  id: LayoutLeafId;
  size: number;
  visible: boolean;
  flex?: boolean;
};

export type LayoutBranchNode = {
  type: 'branch';
  orientation: Orientation;
  size: number;
  children: LayoutNode[];
};

export type LayoutNode =
  | LayoutBranchNode
  | LayoutLeafNode;

export type LayoutTreeParams = {
  orientation: Orientation;
  isPrimarySidebarVisible: boolean;
  isEditorVisible: boolean;
  isAgentSidebarVisible: boolean;
  primarySidebarSize: number;
  agentSidebarSize: number;
  editorSize: number;
};

export type LayoutFlexState = {
  agentSidebarFlex: boolean;
  editorFlex: boolean;
};

const CANONICAL_LEAF_ORDER: readonly LayoutLeafId[] = [
  'primarySidebar',
  'agentSidebar',
  'editor',
];

function mapNode(
  node: LayoutNode,
  visit: (node: LayoutNode) => LayoutNode | null,
): LayoutNode | null {
  const nextNode =
    node.type === 'branch'
      ? {
          type: 'branch' as const,
          orientation: node.orientation,
          size: node.size,
          children: node.children
            .map((child) => mapNode(child, visit))
            .filter((child): child is LayoutNode => Boolean(child)),
        }
      : { ...node };

  return visit(nextNode);
}

function getRootSize(params: LayoutTreeParams) {
  return (
    (params.isPrimarySidebarVisible ? params.primarySidebarSize : 0) +
    (params.isEditorVisible ? params.editorSize : 0) +
    (params.isAgentSidebarVisible ? params.agentSidebarSize : 0)
  );
}

function createCanonicalLayoutTree(params: LayoutTreeParams): LayoutBranchNode {
  const flexState = resolveFlexState({
    isAgentSidebarVisible: params.isAgentSidebarVisible,
    isEditorVisible: params.isEditorVisible,
  });

  return {
    type: 'branch',
    orientation: params.orientation,
    size: getRootSize(params),
    children: [
      {
        type: 'leaf',
        id: 'primarySidebar',
        size: params.primarySidebarSize,
        visible: params.isPrimarySidebarVisible,
      },
      {
        type: 'leaf',
        id: 'agentSidebar',
        size: params.agentSidebarSize,
        visible: params.isAgentSidebarVisible,
        flex: flexState.agentSidebarFlex,
      },
      {
        type: 'leaf',
        id: 'editor',
        size: params.editorSize,
        visible: params.isEditorVisible,
        flex: flexState.editorFlex,
      },
    ],
  };
}

function isCanonicalLayoutTree(tree: LayoutNode): tree is LayoutBranchNode {
  if (tree.type !== 'branch' || tree.children.length !== CANONICAL_LEAF_ORDER.length) {
    return false;
  }

  return tree.children.every(
    (child, index) =>
      child.type === 'leaf' && child.id === CANONICAL_LEAF_ORDER[index],
  );
}

function isLayoutTreeEqual(left: LayoutNode, right: LayoutNode): boolean {
  if (left.type !== right.type) {
    return false;
  }

  if (left.type === 'leaf' && right.type === 'leaf') {
    return (
      left.id === right.id &&
      left.size === right.size &&
      left.visible === right.visible &&
      left.flex === right.flex
    );
  }

  if (left.type === 'branch' && right.type === 'branch') {
    if (
      left.orientation !== right.orientation ||
      left.size !== right.size ||
      left.children.length !== right.children.length
    ) {
      return false;
    }

    for (let index = 0; index < left.children.length; index += 1) {
      const leftChild = left.children[index];
      const rightChild = right.children[index];
      if (!leftChild || !rightChild || !isLayoutTreeEqual(leftChild, rightChild)) {
        return false;
      }
    }

    return true;
  }

  return false;
}

export function resolveFlexState(params: {
  isAgentSidebarVisible: boolean;
  isEditorVisible: boolean;
}): LayoutFlexState {
  const editorFlex = params.isEditorVisible;
  const agentSidebarFlex =
    params.isAgentSidebarVisible && !params.isEditorVisible;
  return {
    agentSidebarFlex,
    editorFlex,
  };
}

export function createLayoutTree({
  orientation,
  isPrimarySidebarVisible,
  isEditorVisible,
  isAgentSidebarVisible,
  primarySidebarSize,
  agentSidebarSize,
  editorSize,
}: LayoutTreeParams): LayoutNode {
  return createCanonicalLayoutTree({
    orientation,
    isPrimarySidebarVisible,
    isEditorVisible,
    isAgentSidebarVisible,
    primarySidebarSize,
    agentSidebarSize,
    editorSize,
  });
}

export function updateLeaf(
  tree: LayoutNode,
  targetId: LayoutLeafId,
  patch: Partial<Omit<LayoutLeafNode, 'type' | 'id'>>,
): LayoutNode {
  return mapNode(tree, (node) => {
    if (node.type === 'leaf' && node.id === targetId) {
      return {
        ...node,
        ...patch,
      };
    }
    return node;
  }) as LayoutNode;
}

export function reconcileLayoutTree(
  tree: LayoutNode | null,
  params: LayoutTreeParams,
): LayoutNode {
  const nextTree = createCanonicalLayoutTree(params);

  if (!tree || !isCanonicalLayoutTree(tree)) {
    return nextTree;
  }

  return isLayoutTreeEqual(tree, nextTree) ? tree : nextTree;
}
