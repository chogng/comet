import 'ls/base/browser/ui/tree/media/tree.css';

import { ListWidget, type ListKeyDownContext } from 'ls/base/browser/ui/list/listWidget';
import { LifecycleOwner } from 'ls/base/common/lifecycle';

export type SimpleTreeDataSource<T> = {
  hasChildren(node: T): boolean;
  getChildren(node: T): T[];
};

export type SimpleTreeRenderContext = {
  nodeId: string;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  isFocused: boolean;
  toggleExpanded: () => void;
  select: () => void;
  open: () => void;
};

export type SimpleTreeNodeState = {
  loading?: boolean;
  error?: boolean;
};

export type SimpleTreeRenderer<T> = {
  renderElement(node: T, context: SimpleTreeRenderContext): HTMLElement;
};

export type SimpleTreeOptions<T> = {
  getId: (node: T) => string;
  isRoot: (node: T) => boolean;
  hideRoot?: boolean;
  getLabel?: (node: T) => string;
  getNodeState?: (node: T) => SimpleTreeNodeState;
  defaultExpandedIds?: Iterable<string>;
  shouldAutoExpand?: (node: T) => boolean;
  ariaLabel?: string;
  onDidChangeSelection?: (node: T | null) => void;
  onDidOpen?: (node: T) => void;
};

type VisibleTreeNode<T> = {
  node: T;
  depth: number;
  hasChildren: boolean;
  isExpanded: boolean;
};

export class SimpleTree<T> extends LifecycleOwner {
  private readonly list: ListWidget<VisibleTreeNode<T>>;
  private input: T | null = null;
  private readonly expandedIds: Set<string>;
  private readonly autoExpandedIds = new Set<string>();
  private disposed = false;

  constructor(
    private readonly dataSource: SimpleTreeDataSource<T>,
    private readonly renderer: SimpleTreeRenderer<T>,
    private readonly options: SimpleTreeOptions<T>,
  ) {
    super();
    this.expandedIds = new Set(options.defaultExpandedIds ?? []);
    this.list = this.register(new ListWidget<VisibleTreeNode<T>>(
      {
        renderElement: (entry, context) => {
          const nodeId = this.options.getId(entry.node);
          const nodeState = this.options.getNodeState?.(entry.node) ?? {};
          const rendered = this.renderer.renderElement(entry.node, {
            nodeId,
            depth: entry.depth,
            hasChildren: entry.hasChildren,
            isExpanded: entry.isExpanded,
            isSelected: context.isSelected,
            isFocused: context.isFocused,
            toggleExpanded: () => {
              if (!entry.hasChildren || this.options.isRoot(entry.node)) {
                return;
              }

              if (this.expandedIds.has(nodeId)) {
                this.expandedIds.delete(nodeId);
              } else {
                this.expandedIds.add(nodeId);
              }

              this.rerender();
            },
            select: context.select,
            open: context.open,
          });
          rendered.dataset['simpleTreeNodeId'] = nodeId;
          rendered.classList.add('simple-tree-node');
          rendered.setAttribute('aria-level', String(entry.depth + 1));
          rendered.setAttribute('aria-selected', String(context.isSelected));
          rendered.toggleAttribute('aria-busy', Boolean(nodeState.loading));
          rendered.dataset['treeState'] = nodeState.error
            ? 'error'
            : nodeState.loading
              ? 'loading'
              : 'idle';
          if (!rendered.getAttribute('role')) {
            rendered.setAttribute('role', 'treeitem');
          }
          if (entry.hasChildren) {
            rendered.setAttribute('aria-expanded', String(entry.isExpanded));
          } else {
            rendered.removeAttribute('aria-expanded');
          }
          rendered.classList.toggle('is-loading', Boolean(nodeState.loading));
          rendered.classList.toggle('has-error', Boolean(nodeState.error));
          return rendered;
        },
      },
      {
        getId: (entry) => this.options.getId(entry.node),
        getLabel: (entry) =>
          this.options.getLabel?.(entry.node) ?? this.options.getId(entry.node),
        ariaLabel: options.ariaLabel,
        role: 'tree',
        onDidChangeSelection: (entry) => {
          this.options.onDidChangeSelection?.(entry?.node ?? null);
        },
        onDidOpen: (entry) => {
          this.options.onDidOpen?.(entry.node);
        },
        onKeyDown: (
          event: KeyboardEvent,
          context: ListKeyDownContext<VisibleTreeNode<T>>,
        ) => this.handleKeyDown(event, context),
      },
    ));
    this.list.getElement().classList.add('simple-tree');
  }

  getElement() {
    return this.list.getElement();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.input = null;
    super.dispose();
  }

  setAriaLabel(label: string) {
    if (this.disposed) {
      return;
    }

    this.list.setAriaLabel(label);
  }

  focus() {
    if (this.disposed) {
      return;
    }

    this.list.focus();
  }

  getSelection() {
    return this.list.getSelection()?.node ?? null;
  }

  setSelection(node: T | null) {
    if (this.disposed) {
      return;
    }

    this.list.setSelection(node ? this.findVisibleNode(node) : null);
  }

  getFocus() {
    return this.list.getFocus()?.node ?? null;
  }

  setFocus(node: T | null) {
    if (this.disposed) {
      return;
    }

    this.list.setFocus(node ? this.findVisibleNode(node) : null);
  }

  setInput(input: T | null) {
    if (this.disposed) {
      return;
    }

    this.input = input;
    if (!input) {
      this.list.setItems([]);
      return;
    }

    this.render();
  }

  rerender() {
    if (this.disposed) {
      return;
    }

    this.render();
  }

  private render() {
    this.list.setItems(this.getVisibleNodes());
  }

  private handleKeyDown(
    event: KeyboardEvent,
    context: ListKeyDownContext<VisibleTreeNode<T>>,
  ) {
    const { items: visibleNodes, activeIndex, activeItem: activeEntry } = context;

    switch (event.key) {
      case 'ArrowRight': {
        if (activeEntry.hasChildren && !activeEntry.isExpanded && !this.options.isRoot(activeEntry.node)) {
          this.expandedIds.add(this.options.getId(activeEntry.node));
          this.rerender();
        } else if (activeEntry.hasChildren) {
          const nextEntry = visibleNodes[activeIndex + 1];
          if (nextEntry) {
            context.setFocus(nextEntry);
            this.rerender();
          }
        }
        event.preventDefault();
        return true;
      }
      case 'ArrowLeft': {
        const nodeId = this.options.getId(activeEntry.node);
        if (activeEntry.hasChildren && activeEntry.isExpanded && !this.options.isRoot(activeEntry.node)) {
          this.expandedIds.delete(nodeId);
          this.rerender();
        } else {
          const parentEntry = this.findParentEntry(visibleNodes, activeIndex);
          if (parentEntry) {
            context.setFocus(parentEntry);
            this.rerender();
          }
        }
        event.preventDefault();
        return true;
      }
      case 'Enter': {
        if (activeEntry.hasChildren && !this.options.isRoot(activeEntry.node)) {
          const nodeId = this.options.getId(activeEntry.node);
          if (this.expandedIds.has(nodeId)) {
            this.expandedIds.delete(nodeId);
          } else {
            this.expandedIds.add(nodeId);
          }
        } else {
          context.setSelection(activeEntry);
          context.setFocus(activeEntry);
          context.open(activeEntry);
        }
        this.rerender();
        event.preventDefault();
        return true;
      }
      default:
        return false;
    }
  }

  private getVisibleNodes(input: T | null = this.input): VisibleTreeNode<T>[] {
    if (!input) {
      return [];
    }

    const nodes: VisibleTreeNode<T>[] = [];
    const visit = (node: T, depth: number, includeNode: boolean = true) => {
      const nodeId = this.options.getId(node);
      const hasChildren = this.dataSource.hasChildren(node);
      const isRoot = this.options.isRoot(node);
      if (
        hasChildren &&
        !isRoot &&
        this.options.shouldAutoExpand?.(node) &&
        !this.autoExpandedIds.has(nodeId)
      ) {
        this.autoExpandedIds.add(nodeId);
        this.expandedIds.add(nodeId);
      }
      const isExpanded = isRoot || (hasChildren && this.expandedIds.has(nodeId));
      if (includeNode) {
        nodes.push({ node, depth, hasChildren, isExpanded });
      }
      if (hasChildren && isExpanded) {
        for (const child of this.dataSource.getChildren(node)) {
          visit(child, includeNode ? depth + 1 : depth);
        }
      }
    };

    visit(
      input,
      0,
      !(this.options.hideRoot && this.options.isRoot(input)),
    );
    return nodes;
  }

  private findParentEntry(
    visibleNodes: readonly VisibleTreeNode<T>[],
    index: number,
  ) {
    const current = visibleNodes[index];
    if (!current) {
      return null;
    }

    for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
      const candidate = visibleNodes[cursor];
      if (candidate && candidate.depth < current.depth) {
        return candidate;
      }
    }

    return null;
  }

  private findVisibleNode(node: T) {
    const nodeId = this.options.getId(node);
    return this.getVisibleNodes().find(
      (entry) => this.options.getId(entry.node) === nodeId,
    ) ?? null;
  }
}
