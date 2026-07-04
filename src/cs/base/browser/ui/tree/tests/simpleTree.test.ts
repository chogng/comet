import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let SimpleTree: typeof import('cs/base/browser/ui/tree/simpleTree').SimpleTree;

type TreeNode = {
  id: string;
  label: string;
  children?: TreeNode[];
};

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ SimpleTree } = await import('cs/base/browser/ui/tree/simpleTree'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

function createTree(selected: string[] = []) {
  const root: TreeNode = {
    id: 'root',
    label: 'Root',
    children: [
      { id: 'alpha', label: 'Alpha' },
      { id: 'beta', label: 'Beta' },
    ],
  };

  const tree = new SimpleTree<TreeNode>(
    {
      hasChildren: (node) => (node.children?.length ?? 0) > 0,
      getChildren: (node) => node.children ?? [],
    },
    {
      renderElement: (node) => {
        const element = document.createElement('div');
        element.textContent = node.label;
        return element;
      },
    },
    {
      getId: (node) => node.id,
      getLabel: (node) => node.label,
      isRoot: (node) => node.id === 'root',
      hideRoot: true,
      onDidChangeSelection: (node) => {
        selected.push(node?.id ?? 'null');
      },
    },
  );

  return { root, tree };
}

test('simple tree typeahead focuses the matching node and click selects it', () => {
  const selected: string[] = [];
  const { root, tree } = createTree(selected);
  document.body.append(tree.getElement());
  tree.setInput(root);

  try {
    tree.getElement().dispatchEvent(new window.FocusEvent('focus'));
    tree.getElement().dispatchEvent(new window.KeyboardEvent('keydown', {
      bubbles: true,
      key: 'b',
    }));

    const betaNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="beta"]',
    );
    assert(betaNode instanceof HTMLElement);
    assert.equal(betaNode.classList.contains('is-focused'), true);

    betaNode.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));

    assert.equal(tree.getSelection()?.id, 'beta');
    assert.deepEqual(selected, ['beta']);
  } finally {
    tree.dispose();
    document.body.replaceChildren();
  }
});

test('simple tree dispose clears the DOM and ignores later updates', () => {
  const { root, tree } = createTree();
  document.body.append(tree.getElement());
  tree.setInput(root);

  try {
    assert.equal(tree.getElement().childElementCount > 0, true);

    tree.dispose();
    tree.setInput(root);
    tree.rerender();

    assert.equal(tree.getElement().childElementCount, 0);
    assert.equal(tree.getSelection(), null);
  } finally {
    document.body.replaceChildren();
  }
});

test('simple tree arrow navigation expands and collapses parents', () => {
  const root: TreeNode = {
    id: 'root',
    label: 'Root',
    children: [
      {
        id: 'folder',
        label: 'Folder',
        children: [{ id: 'leaf', label: 'Leaf' }],
      },
    ],
  };
  const tree = new SimpleTree<TreeNode>(
    {
      hasChildren: (node) => (node.children?.length ?? 0) > 0,
      getChildren: (node) => node.children ?? [],
    },
    {
      renderElement: (node) => {
        const element = document.createElement('div');
        element.textContent = node.label;
        return element;
      },
    },
    {
      getId: (node) => node.id,
      getLabel: (node) => node.label,
      isRoot: (node) => node.id === 'root',
      hideRoot: true,
    },
  );
  document.body.append(tree.getElement());
  tree.setInput(root);

  try {
    tree.getElement().dispatchEvent(new window.FocusEvent('focus'));

    const folderNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="folder"]',
    );
    assert(folderNode instanceof HTMLElement);
    assert.equal(folderNode.getAttribute('aria-expanded'), 'false');

    tree.getElement().dispatchEvent(new window.KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Enter',
    }));

    const expandedFolderNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="folder"]',
    );
    const leafNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="leaf"]',
    );
    assert(expandedFolderNode instanceof HTMLElement);
    assert.equal(expandedFolderNode.getAttribute('aria-expanded'), 'true');
    assert(leafNode instanceof HTMLElement);

    tree.getElement().dispatchEvent(new window.KeyboardEvent('keydown', {
      bubbles: true,
      key: 'ArrowRight',
    }));

    const focusedLeafNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="leaf"]',
    );
    assert(focusedLeafNode instanceof HTMLElement);
    assert.equal(focusedLeafNode.classList.contains('is-focused'), true);

    tree.getElement().dispatchEvent(new window.KeyboardEvent('keydown', {
      bubbles: true,
      key: 'ArrowLeft',
    }));

    const refocusedFolderNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="folder"]',
    );
    assert(refocusedFolderNode instanceof HTMLElement);
    assert.equal(refocusedFolderNode.classList.contains('is-focused'), true);

    tree.getElement().dispatchEvent(new window.KeyboardEvent('keydown', {
      bubbles: true,
      key: 'ArrowLeft',
    }));

    const collapsedFolderNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="folder"]',
    );
    const collapsedLeafNode = tree.getElement().querySelector<HTMLElement>(
      '[data-simple-tree-node-id="leaf"]',
    );
    assert(collapsedFolderNode instanceof HTMLElement);
    assert.equal(collapsedFolderNode.getAttribute('aria-expanded'), 'false');
    assert.equal(collapsedLeafNode, null);
  } finally {
    tree.dispose();
    document.body.replaceChildren();
  }
});
