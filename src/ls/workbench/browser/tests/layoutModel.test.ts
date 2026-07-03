import assert from 'node:assert/strict';
import test from 'node:test';

import { Orientation } from 'ls/base/browser/ui/grid/gridview';
import {
  createLayoutTree,
  reconcileLayoutTree,
  updateLeaf,
} from 'ls/workbench/browser/layoutModel';
import {
  cloneLayoutTree,
  findLeafPath,
  getNodeAtPath,
  insertLeaf,
  removeLeaf,
  serializeLayoutTree,
  splitLeaf,
  updateNodeAtPath,
} from 'ls/workbench/browser/tests/layoutTreeOps';

function createDefaultTree() {
  return createLayoutTree({
    orientation: Orientation.VERTICAL,
    isPrimarySidebarVisible: true,
    isEditorVisible: true,
    isAgentSidebarVisible: true,
    primarySidebarSize: 320,
    agentSidebarSize: 260,
    editorSize: 640,
  });
}

test('layout model creates the current shell topology', () => {
  const tree = createDefaultTree();

  assert.equal(tree.type, 'branch');
  assert.equal(tree.orientation, Orientation.VERTICAL);
  assert.equal(tree.size, 1220);
  assert.equal(tree.children.length, 3);
  assert.equal(tree.children[0]?.type, 'leaf');
  assert.equal(tree.children[1]?.type, 'leaf');
  assert.equal(tree.children[2]?.type, 'leaf');
  assert.deepEqual(findLeafPath(tree, 'primarySidebar'), [0]);
  assert.deepEqual(findLeafPath(tree, 'editor'), [1]);
  assert.deepEqual(findLeafPath(tree, 'agentSidebar'), [2]);
});

test('layout model clone and serialize do not mutate the source tree', () => {
  const tree = createDefaultTree();
  const clonedTree = cloneLayoutTree(tree);
  const serializedTree = serializeLayoutTree(tree);

  assert.deepEqual(clonedTree, tree);
  assert.deepEqual(serializedTree, tree);
  assert.notEqual(clonedTree, tree);
  assert.notEqual(serializedTree, tree);

  const updatedTree = updateLeaf(clonedTree, 'primarySidebar', {
    size: 360,
    visible: false,
  });

  assert.deepEqual(findLeafPath(updatedTree, 'primarySidebar'), [0]);
  assert.equal(tree.type, 'branch');
  assert.equal(tree.children[0]?.type, 'leaf');
  assert.equal(tree.children[0].size, 320);
  assert.equal(tree.children[0].visible, true);
});

test('layout model can split a leaf into a new branch', () => {
  const tree = removeLeaf(createDefaultTree(), 'agentSidebar');
  assert(tree);

  const splitTree = splitLeaf(tree, {
    targetId: 'editor',
    orientation: Orientation.HORIZONTAL,
    side: 'before',
    targetSize: 420,
    newLeaf: {
      type: 'leaf',
      id: 'agentSidebar',
      size: 220,
      visible: true,
    },
  });

  assert.equal(splitTree.type, 'branch');
  assert.equal(splitTree.children[1]?.type, 'branch');
  if (splitTree.children[1]?.type !== 'branch') {
    throw new Error('Expected editor split branch');
  }
  assert.equal(splitTree.children[1].orientation, Orientation.HORIZONTAL);
  assert.equal(splitTree.children[1].children.length, 2);
  assert.equal(splitTree.children[1].children[0]?.type, 'leaf');
  assert.equal(splitTree.children[1].children[1]?.type, 'leaf');
  assert.equal(splitTree.children[1].children[0].id, 'agentSidebar');
  assert.equal(splitTree.children[1].children[0].size, 220);
  assert.equal(splitTree.children[1].children[1].id, 'editor');
  assert.equal(splitTree.children[1].children[1].size, 420);
  assert.deepEqual(findLeafPath(splitTree, 'editor'), [1, 1]);
});

test('layout model removes leaves and collapses redundant branches', () => {
  const treeWithoutPrimary = removeLeaf(
    createLayoutTree({
      orientation: Orientation.VERTICAL,
      isPrimarySidebarVisible: false,
      isEditorVisible: true,
      isAgentSidebarVisible: false,
      primarySidebarSize: 0,
      agentSidebarSize: 0,
      editorSize: 640,
    }),
    'primarySidebar',
  );
  assert(treeWithoutPrimary);
  const onlyEditor = removeLeaf(treeWithoutPrimary, 'agentSidebar');

  assert(onlyEditor);
  assert.equal(onlyEditor.type, 'leaf');
  assert.equal(onlyEditor.id, 'editor');
});

test('layout model updates leaf data immutably', () => {
  const tree = createDefaultTree();
  assert.equal(tree.type, 'branch');
  const updatedTree = updateLeaf(tree, 'agentSidebar', {
    size: 300,
    visible: false,
    flex: false,
  });

  assert.equal(updatedTree.type, 'branch');
  const updatedAuxiliary = updatedTree.children[2];
  assert(updatedAuxiliary);
  assert.equal(updatedAuxiliary.type, 'leaf');
  assert.equal(updatedAuxiliary.size, 300);
  assert.equal(updatedAuxiliary.visible, false);
  assert.equal(updatedAuxiliary.flex, false);

  const originalAuxiliary = tree.children[2];
  assert(originalAuxiliary);
  assert.equal(originalAuxiliary.type, 'leaf');
  assert.equal(originalAuxiliary.size, 260);
  assert.equal(originalAuxiliary.visible, true);
  assert.equal(originalAuxiliary.flex, false);
});

test('layout model keeps editor flexible when editor and agent sidebar are both visible', () => {
  const tree = createDefaultTree();
  assert.equal(tree.type, 'branch');

  const primarySidebar = tree.children[0];
  const editor = tree.children[1];
  const agentSidebar = tree.children[2];

  assert(primarySidebar?.type === 'leaf');
  assert(agentSidebar?.type === 'leaf');
  assert(editor?.type === 'leaf');
  assert.equal(primarySidebar.flex, undefined);
  assert.equal(agentSidebar.flex, false);
  assert.equal(editor.flex, true);
});

test('layout model can read and update the root branch by path', () => {
  const tree = createDefaultTree();
  const rootBranch = getNodeAtPath(tree, []);

  assert(rootBranch);
  assert.equal(rootBranch.type, 'branch');
  assert.equal(rootBranch.size, 1220);

  const updatedTree = updateNodeAtPath(tree, [], (node) => {
    assert.equal(node.type, 'branch');
    return {
      ...node,
      size: 1600,
    };
  });

  const updatedRootBranch = getNodeAtPath(updatedTree, []);
  assert(updatedRootBranch);
  assert.equal(updatedRootBranch.type, 'branch');
  assert.equal(updatedRootBranch.size, 1600);

  const originalRootBranch = getNodeAtPath(tree, []);
  assert(originalRootBranch);
  assert.equal(originalRootBranch.type, 'branch');
  assert.equal(originalRootBranch.size, 1220);
});

test('layout model can insert a sibling leaf next to editor without wrapping a new branch', () => {
  const tree = removeLeaf(createDefaultTree(), 'agentSidebar');
  assert(tree);

  const nextTree = insertLeaf(
    tree,
    'editor',
    {
      type: 'leaf',
      id: 'agentSidebar',
      size: 280,
      visible: true,
    },
    'after',
  );

  assert.equal(nextTree.type, 'branch');
  assert.deepEqual(findLeafPath(nextTree, 'editor'), [1]);
  assert.deepEqual(findLeafPath(nextTree, 'agentSidebar'), [2]);
});

test('layout model reconcile keeps three top-level panes and updates visibility', () => {
  const baseTree = createDefaultTree();
  const hiddenTree = reconcileLayoutTree(baseTree, {
    orientation: Orientation.VERTICAL,
    isPrimarySidebarVisible: true,
    isEditorVisible: true,
    isAgentSidebarVisible: false,
    primarySidebarSize: 320,
    agentSidebarSize: 260,
    editorSize: 640,
  });

  assert.equal(hiddenTree.type, 'branch');
  assert.equal(hiddenTree.children.length, 3);
  assert.deepEqual(findLeafPath(hiddenTree, 'primarySidebar'), [0]);
  assert.deepEqual(findLeafPath(hiddenTree, 'editor'), [1]);
  assert.deepEqual(findLeafPath(hiddenTree, 'agentSidebar'), [2]);
  assert.equal(hiddenTree.children[0]?.type, 'leaf');
  assert.equal(hiddenTree.children[1]?.type, 'leaf');
  assert.equal(hiddenTree.children[2]?.type, 'leaf');
  assert.equal(hiddenTree.children[0].visible, true);
  assert.equal(hiddenTree.children[2].visible, false);

  const restoredTree = reconcileLayoutTree(hiddenTree, {
    orientation: Orientation.HORIZONTAL,
    isPrimarySidebarVisible: true,
    isEditorVisible: true,
    isAgentSidebarVisible: true,
    primarySidebarSize: 340,
    agentSidebarSize: 280,
    editorSize: 700,
  });

  assert.deepEqual(findLeafPath(restoredTree, 'primarySidebar'), [0]);
  assert.deepEqual(findLeafPath(restoredTree, 'editor'), [1]);
  assert.deepEqual(findLeafPath(restoredTree, 'agentSidebar'), [2]);
  assert.equal(restoredTree.type, 'branch');
  assert.equal(restoredTree.orientation, Orientation.HORIZONTAL);
  assert.equal(restoredTree.children.length, 3);
  assert.equal(restoredTree.children[0]?.type, 'leaf');
  assert.equal(restoredTree.children[1]?.type, 'leaf');
  assert.equal(restoredTree.children[2]?.type, 'leaf');
  assert.equal(restoredTree.children[0].visible, true);
  assert.equal(restoredTree.children[2].visible, true);
});

test('layout model reconcile reuses canonical tree when params are unchanged', () => {
  const tree = createDefaultTree();

  const nextTree = reconcileLayoutTree(tree, {
    orientation: Orientation.VERTICAL,
    isPrimarySidebarVisible: true,
    isEditorVisible: true,
    isAgentSidebarVisible: true,
    primarySidebarSize: 320,
    agentSidebarSize: 260,
    editorSize: 640,
  });

  assert.equal(nextTree, tree);
});
