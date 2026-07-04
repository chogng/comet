import type { LibraryDocumentsResult } from 'cs/base/parts/sandbox/common/sandboxTypes';
import type { LibraryDocumentSummary } from 'cs/base/parts/sandbox/common/sandboxTypes';
import { DataTree } from 'cs/base/browser/ui/tree/dataTree';
import type {
  LibraryTreeLabels,
  LibraryTreeNode,
} from 'cs/workbench/contrib/knowledgeBase/common/libraryTreeModel';
import { LibraryDataSource } from 'cs/workbench/contrib/knowledgeBase/browser/views/libraryDataSource';
import { LibraryDelegate } from 'cs/workbench/contrib/knowledgeBase/browser/views/libraryDelegate';
import { LibraryDragAndDrop } from 'cs/workbench/contrib/knowledgeBase/browser/views/libraryDragAndDrop';
import { LibraryRenderer } from 'cs/workbench/contrib/knowledgeBase/browser/views/libraryRenderer';

export type LibraryViewerLabels = LibraryTreeLabels & {
  unknown: string;
  contextRename: string;
  contextEditSourceUrl: string;
  contextDelete: string;
};

export type LibraryViewerProps = {
  labels: LibraryViewerLabels;
  librarySnapshot: LibraryDocumentsResult;
  onDocumentDragStart?: (documentId: string) => void;
  onDocumentSelect?: (document: LibraryDocumentSummary | null) => void;
  onDocumentOpen?: (document: LibraryDocumentSummary) => void;
  onDocumentRename?: (document: LibraryDocumentSummary) => void;
  onDocumentEditSourceUrl?: (document: LibraryDocumentSummary) => void;
  onDocumentDelete?: (document: LibraryDocumentSummary) => void;
};

export class LibraryViewer {
  private readonly dataSource: LibraryDataSource;
  private readonly delegate = new LibraryDelegate();
  private readonly dragAndDrop: LibraryDragAndDrop;
  private readonly renderer: LibraryRenderer;
  private readonly tree: DataTree<LibraryDocumentsResult, LibraryTreeNode>;
  private currentLibrarySnapshot: LibraryDocumentsResult;
  private labels: LibraryViewerLabels;
  private onDocumentSelect?: (document: LibraryDocumentSummary | null) => void;
  private onDocumentOpen?: (document: LibraryDocumentSummary) => void;

  constructor(props: LibraryViewerProps) {
    this.currentLibrarySnapshot = props.librarySnapshot;
    this.labels = props.labels;
    this.onDocumentSelect = props.onDocumentSelect;
    this.onDocumentOpen = props.onDocumentOpen;
    this.dataSource = new LibraryDataSource();
    this.dragAndDrop = new LibraryDragAndDrop({
      onDocumentDragStart: props.onDocumentDragStart,
    });
    this.renderer = new LibraryRenderer({
      labels: props.labels,
      dragAndDrop: this.dragAndDrop,
      delegate: this.delegate,
      dataSource: this.dataSource,
      onDocumentRename: props.onDocumentRename,
      onDocumentEditSourceUrl: props.onDocumentEditSourceUrl,
      onDocumentDelete: props.onDocumentDelete,
    });
    this.tree = new DataTree<LibraryDocumentsResult, LibraryTreeNode>(
      {
        getRoot: (librarySnapshot) =>
          this.dataSource.getRoot({
            labels: this.labels,
            librarySnapshot,
          }),
        hasChildren: (node) => this.dataSource.hasChildren(node),
        getChildren: (node) => this.dataSource.getChildren(node),
      },
      {
        renderElement: (node, context) =>
          this.renderer.renderElement(node, context),
      },
      {
        getId: (node) => node.id,
        isRoot: (node) => node.kind === 'folder' && node.id === 'root',
        hideRoot: true,
        getLabel: (node) =>
          node.kind === 'folder'
            ? node.name
            : node.document.title?.trim() || this.labels.untitled,
        defaultExpandedIds: ['root'],
        onDidChangeSelection: (node) => {
          this.handleSelectionChange(node);
        },
        onDidOpen: (node) => {
          this.handleOpen(node);
        },
      },
    );
  }

  setProps(props: LibraryViewerProps) {
    this.currentLibrarySnapshot = props.librarySnapshot;
    this.labels = props.labels;
    this.onDocumentSelect = props.onDocumentSelect;
    this.onDocumentOpen = props.onDocumentOpen;
    this.dragAndDrop.setProps({
      onDocumentDragStart: props.onDocumentDragStart,
    });
    this.renderer.setProps({
      labels: props.labels,
      dragAndDrop: this.dragAndDrop,
      delegate: this.delegate,
      dataSource: this.dataSource,
      onDocumentRename: props.onDocumentRename,
      onDocumentEditSourceUrl: props.onDocumentEditSourceUrl,
      onDocumentDelete: props.onDocumentDelete,
    });
  }

  getElement() {
    return this.tree.getElement();
  }

  dispose() {
    this.renderer.dispose();
  }

  render() {
    this.tree.setInput(this.currentLibrarySnapshot);
    return this.tree.getElement();
  }

  private handleSelectionChange(node: LibraryTreeNode | null) {
    this.onDocumentSelect?.(
      node?.kind === 'document' ? node.document : null,
    );
  }

  private handleOpen(node: LibraryTreeNode) {
    if (node.kind !== 'document') {
      return;
    }

    this.onDocumentOpen?.(node.document);
  }
}
