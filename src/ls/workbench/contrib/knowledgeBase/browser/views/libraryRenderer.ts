import type { LibraryDocumentsResult } from 'ls/base/parts/sandbox/common/desktopTypes';
import { createMouseContextMenuAnchor } from 'ls/base/browser/contextmenu';
import { applyHover } from 'ls/base/browser/ui/hover/hover';
import type { SimpleTreeRenderContext } from 'ls/base/browser/ui/tree/simpleTree';
import { createLxIcon } from 'ls/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicons/lxiconsSemantic';
import { resolveLibraryDocumentStatusLabel } from 'ls/workbench/contrib/knowledgeBase/common/libraryTreeModel';
import type { LibraryTreeLabels, LibraryTreeFolderNode, LibraryTreeNode } from 'ls/workbench/contrib/knowledgeBase/common/libraryTreeModel';

import { LibraryDataSource } from 'ls/workbench/contrib/knowledgeBase/browser/views/libraryDataSource';
import { LibraryDelegate } from 'ls/workbench/contrib/knowledgeBase/browser/views/libraryDelegate';
import type { LibraryDragAndDrop } from 'ls/workbench/contrib/knowledgeBase/browser/views/libraryDragAndDrop';
import { createContextMenuService } from 'ls/workbench/services/contextmenu/electron-sandbox/contextmenuService';

export type LibraryRendererLabels = LibraryTreeLabels & {
  unknown: string;
  contextRename: string;
  contextEditSourceUrl: string;
  contextDelete: string;
};

export type LibraryRendererProps = {
  labels: LibraryRendererLabels;
  dragAndDrop: LibraryDragAndDrop;
  delegate: LibraryDelegate;
  dataSource: LibraryDataSource;
  onDocumentRename?: (document: LibraryDocumentsResult['items'][number]) => void;
  onDocumentEditSourceUrl?: (
    document: LibraryDocumentsResult['items'][number],
  ) => void;
  onDocumentDelete?: (document: LibraryDocumentsResult['items'][number]) => void;
};

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
) {
  const element = document.createElement(tagName);
  if (className) {
    element.className = className;
  }
  return element;
}

export class LibraryRenderer {
  private props: LibraryRendererProps;
  private readonly contextMenuService = createContextMenuService();

  constructor(props: LibraryRendererProps) {
    this.props = props;
  }

  setProps(props: LibraryRendererProps) {
    this.props = props;
  }

  dispose() {
    this.contextMenuService.dispose();
  }

  renderElement(
    node: LibraryTreeNode,
    context: SimpleTreeRenderContext,
  ): HTMLElement {
    if (node.kind === 'document') {
      return this.renderDocumentRow(node.document, context);
    }

    const button = createElement(
      'button',
      'library-tree-row library-tree-row-folder btn-base btn-ghost btn-md',
    );
    button.type = 'button';
    button.style.paddingLeft = this.props.delegate.getNodePaddingLeft(
      context.depth,
    );
    button.setAttribute('role', 'treeitem');
    button.setAttribute('aria-expanded', String(context.isExpanded));
    button.addEventListener('click', () => {
      context.toggleExpanded();
    });

    const label = createElement('span', 'library-tree-folder-label');
    label.textContent = node.name;
    button.append(
      createLxIcon(
        context.isExpanded
          ? lxIconSemanticMap.library.folderExpanded
          : lxIconSemanticMap.library.folderCollapsed,
        'library-tree-chevron',
      ),
      label,
    );
    if (node.id === 'root') {
      const count = createElement('span', 'library-tree-folder-count');
      count.textContent = String(
        this.props.dataSource.getDocumentCount(node as LibraryTreeFolderNode),
      );
      button.append(count);
    }
    return button;
  }

  private renderDocumentRow(
    document: LibraryDocumentsResult['items'][number],
    context: SimpleTreeRenderContext,
  ) {
    const title = document.title?.trim() || this.props.labels.untitled;
    const authors =
      document.authors.length > 0
        ? document.authors.join(', ')
        : this.props.labels.unknown;
    const statusLabel = resolveLibraryDocumentStatusLabel(
      this.props.labels,
      document,
    );

    const row = createElement(
      'div',
      'library-tree-row library-tree-row-document',
    );
    row.setAttribute('role', 'treeitem');
    row.style.paddingLeft = this.props.delegate.getNodePaddingLeft(context.depth);
    row.draggable = true;
    row.addEventListener('dragstart', (event) => {
      this.props.dragAndDrop.handleDocumentDragStart(event, document);
    });
    row.addEventListener('dblclick', () => {
      context.open();
    });
    row.addEventListener('contextmenu', (event) => {
      event.preventDefault();
      context.select();
      this.openDocumentContextMenu(event, document);
    });

    const titleElement = createElement('span', 'library-tree-document-title');
    titleElement.textContent = title;
    applyHover(titleElement, title);

    const metaElement = createElement('span', 'library-tree-document-meta');
    metaElement.textContent = authors;
    applyHover(metaElement, authors);

    const statusElement = createElement(
      'span',
      `library-doc-status library-doc-status-${document.ingestStatus}`,
    );
    statusElement.textContent = statusLabel;

    const main = createElement('div', 'library-tree-document-main');
    main.append(titleElement, metaElement);

    const aside = createElement('div', 'library-tree-document-aside');
    aside.append(statusElement);

    row.append(main, aside);
    return row;
  }

  private openDocumentContextMenu(
    event: MouseEvent,
    document: LibraryDocumentsResult['items'][number],
  ) {
    const actions = new Map<string, () => void>();
    const options: Array<{
      value: string;
      label: string;
    }> = [];

    if (this.props.onDocumentRename) {
      options.push({
        value: 'rename',
        label: this.props.labels.contextRename,
      });
      actions.set('rename', () => {
        this.props.onDocumentRename?.(document);
      });
    }

    if (this.props.onDocumentEditSourceUrl) {
      options.push({
        value: 'edit-source-url',
        label: this.props.labels.contextEditSourceUrl,
      });
      actions.set('edit-source-url', () => {
        this.props.onDocumentEditSourceUrl?.(document);
      });
    }

    if (this.props.onDocumentDelete) {
      options.push({
        value: 'delete',
        label: this.props.labels.contextDelete,
      });
      actions.set('delete', () => {
        this.props.onDocumentDelete?.(document);
      });
    }

    if (options.length === 0) {
      return;
    }

    this.contextMenuService.showContextMenu({
      getAnchor: () => createMouseContextMenuAnchor(event),
      getActions: () => options,
      getMenuData: () => 'knowledge-library-document',
      alignment: 'start',
      onSelect: (value) => {
        actions.get(value)?.();
      },
    });
  }
}
