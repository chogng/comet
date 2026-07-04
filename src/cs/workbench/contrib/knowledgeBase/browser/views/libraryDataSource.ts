import type {
  LibraryDocumentSummary,
  LibraryDocumentsResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { buildLibraryTree } from 'cs/workbench/contrib/knowledgeBase/common/libraryTreeModel';
import type { LibraryTreeFolderNode, LibraryTreeLabels, LibraryTreeNode } from 'cs/workbench/contrib/knowledgeBase/common/libraryTreeModel';

export type LibraryDataSourceLabels = LibraryTreeLabels;

export type LibraryDataSourceInput = {
  labels: LibraryDataSourceLabels;
  librarySnapshot: LibraryDocumentsResult;
};

export class LibraryDataSource {
  getRoot(input: LibraryDataSourceInput) {
    return buildLibraryTree(input.librarySnapshot, input.labels);
  }

  hasChildren(node: LibraryTreeNode) {
    return node.kind === 'folder' && (node.folders.length > 0 || node.documents.length > 0);
  }

  getChildren(node: LibraryTreeNode): LibraryTreeNode[] {
    if (node.kind !== 'folder') {
      return [];
    }

    return [
      ...node.folders,
      ...node.documents.map((document) => this.createDocumentNode(document)),
    ];
  }

  createDocumentNode(document: LibraryDocumentSummary): LibraryTreeNode {
    return {
      kind: 'document',
      id: document.documentId,
      document,
    };
  }

  getDocumentCount(node: LibraryTreeFolderNode): number {
    let total = node.documents.length;
    for (const folder of node.folders) {
      total += this.getDocumentCount(folder);
    }
    return total;
  }
}
