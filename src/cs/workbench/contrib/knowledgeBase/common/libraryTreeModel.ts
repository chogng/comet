import type {
  LibraryDocumentSummary,
  LibraryDocumentsResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';

export type LibraryTreeLabels = {
  untitled: string;
  libraryTitle: string;
  libraryStatusRegistered: string;
  libraryStatusQueued: string;
  libraryStatusRunning: string;
  libraryStatusFailed: string;
};

export type LibraryTreeFolderNode = {
  kind: 'folder';
  id: string;
  name: string;
  folders: LibraryTreeFolderNode[];
  documents: LibraryDocumentSummary[];
};

export type LibraryTreeDocumentNode = {
  kind: 'document';
  id: string;
  document: LibraryDocumentSummary;
};

export type LibraryTreeNode =
  | LibraryTreeFolderNode
  | LibraryTreeDocumentNode;

export type LibraryTreeIndex = {
  nodesById: Map<string, LibraryTreeNode>;
  documentsById: Map<string, LibraryDocumentSummary>;
  parentFolderByNodeId: Map<string, LibraryTreeFolderNode>;
};

export type LibraryDocumentRef = {
  documentId: string;
  title: string | null;
  doi: string | null;
  sourceUrl: string | null;
  latestFilePath: string | null;
};

export type LibraryTreeSelection = {
  documentIds: string[];
  documents: LibraryDocumentSummary[];
};

export type LibraryTreeDragPayload = {
  type: 'library-documents';
  documentIds: string[];
  documents: LibraryDocumentRef[];
};

export const LIBRARY_TREE_DRAG_MIME =
  'application/vnd.comet-studio.library-documents';

export function resolveLibraryDocumentStatusLabel(
  labels: Pick<
    LibraryTreeLabels,
    | 'libraryStatusRegistered'
    | 'libraryStatusQueued'
    | 'libraryStatusRunning'
    | 'libraryStatusFailed'
  >,
  document: LibraryDocumentSummary,
) {
  if (
    document.latestJobStatus === 'failed' ||
    document.ingestStatus === 'failed'
  ) {
    return labels.libraryStatusFailed;
  }

  if (
    document.latestJobStatus === 'running' ||
    document.ingestStatus === 'indexing'
  ) {
    return labels.libraryStatusRunning;
  }

  if (
    document.latestJobStatus === 'queued' ||
    document.ingestStatus === 'queued'
  ) {
    return labels.libraryStatusQueued;
  }

  return labels.libraryStatusRegistered;
}

export function getLibraryDocumentPathSegments(
  _document: LibraryDocumentSummary,
  librarySnapshot: LibraryDocumentsResult,
) {
  void librarySnapshot;
  return [];
}

export function buildLibraryTree(
  librarySnapshot: LibraryDocumentsResult,
  labels: LibraryTreeLabels,
) {
  const root: LibraryTreeFolderNode = {
    kind: 'folder',
    id: 'root',
    name: labels.libraryTitle,
    folders: [],
    documents: [],
  };
  const folderIndex = new Map<string, LibraryTreeFolderNode>([['root', root]]);

  for (const document of librarySnapshot.items) {
    const pathSegments = getLibraryDocumentPathSegments(
      document,
      librarySnapshot,
    );
    let currentFolder = root;
    let currentPath = 'root';

    for (const segment of pathSegments) {
      currentPath = `${currentPath}/${segment}`;
      let nextFolder = folderIndex.get(currentPath);
      if (!nextFolder) {
        nextFolder = {
          kind: 'folder',
          id: currentPath,
          name: segment,
          folders: [],
          documents: [],
        };
        currentFolder.folders.push(nextFolder);
        folderIndex.set(currentPath, nextFolder);
      }
      currentFolder = nextFolder;
    }

    currentFolder.documents.push(document);
  }

  const sortFolder = (folder: LibraryTreeFolderNode) => {
    folder.folders.sort((left, right) => left.name.localeCompare(right.name));
    folder.documents.sort((left, right) =>
      (left.title?.trim() || labels.untitled).localeCompare(
        right.title?.trim() || labels.untitled,
      ),
    );
    for (const childFolder of folder.folders) {
      sortFolder(childFolder);
    }
  };

  sortFolder(root);
  return root;
}

export function getLibraryTreeDocumentCount(
  node: LibraryTreeFolderNode,
): number {
  let count = node.documents.length;
  for (const folder of node.folders) {
    count += getLibraryTreeDocumentCount(folder);
  }
  return count;
}

export function createLibraryDocumentRef(
  document: LibraryDocumentSummary,
): LibraryDocumentRef {
  return {
    documentId: document.documentId,
    title: document.title,
    doi: document.doi,
    sourceUrl: document.sourceUrl,
    latestFilePath: document.latestFilePath,
  };
}

export function createLibraryTreeSelection(
  documents: readonly LibraryDocumentSummary[],
): LibraryTreeSelection {
  return {
    documentIds: documents.map((document) => document.documentId),
    documents: [...documents],
  };
}

export function createLibraryTreeDragPayload(
  documents: readonly LibraryDocumentSummary[],
): LibraryTreeDragPayload {
  return {
    type: 'library-documents',
    documentIds: documents.map((document) => document.documentId),
    documents: documents.map(createLibraryDocumentRef),
  };
}

export function serializeLibraryTreeDragPayload(
  payload: LibraryTreeDragPayload,
): string {
  return JSON.stringify(payload);
}

export function parseLibraryTreeDragPayload(
  value: string,
): LibraryTreeDragPayload | null {
  try {
    const parsed = JSON.parse(value) as Partial<LibraryTreeDragPayload>;
    if (
      parsed.type !== 'library-documents' ||
      !Array.isArray(parsed.documentIds) ||
      !Array.isArray(parsed.documents)
    ) {
      return null;
    }

    return {
      type: 'library-documents',
      documentIds: parsed.documentIds.filter(
        (documentId): documentId is string => typeof documentId === 'string',
      ),
      documents: parsed.documents
        .map((document) => {
          if (!document || typeof document !== 'object') {
            return null;
          }

          const {
            documentId,
            title = null,
            doi = null,
            sourceUrl = null,
            latestFilePath = null,
          } = document as Partial<LibraryDocumentRef>;

          if (typeof documentId !== 'string') {
            return null;
          }

          return {
            documentId,
            title: typeof title === 'string' ? title : null,
            doi: typeof doi === 'string' ? doi : null,
            sourceUrl: typeof sourceUrl === 'string' ? sourceUrl : null,
            latestFilePath:
              typeof latestFilePath === 'string' ? latestFilePath : null,
          };
        })
        .filter((document): document is LibraryDocumentRef => document !== null),
    };
  } catch {
    return null;
  }
}

export function buildLibraryTreeIndex(
  root: LibraryTreeFolderNode,
): LibraryTreeIndex {
  const nodesById = new Map<string, LibraryTreeNode>([[root.id, root]]);
  const documentsById = new Map<string, LibraryDocumentSummary>();
  const parentFolderByNodeId = new Map<string, LibraryTreeFolderNode>();

  const visitFolder = (folder: LibraryTreeFolderNode) => {
    for (const childFolder of folder.folders) {
      nodesById.set(childFolder.id, childFolder);
      parentFolderByNodeId.set(childFolder.id, folder);
      visitFolder(childFolder);
    }

    for (const document of folder.documents) {
      const documentNode: LibraryTreeDocumentNode = {
        kind: 'document',
        id: document.documentId,
        document,
      };
      nodesById.set(documentNode.id, documentNode);
      documentsById.set(document.documentId, document);
      parentFolderByNodeId.set(documentNode.id, folder);
    }
  };

  visitFolder(root);

  return {
    nodesById,
    documentsById,
    parentFolderByNodeId,
  };
}

export function findLibraryTreeNode(
  root: LibraryTreeFolderNode,
  nodeId: string,
): LibraryTreeNode | null {
  return buildLibraryTreeIndex(root).nodesById.get(nodeId) ?? null;
}

export function findLibraryTreeDocument(
  root: LibraryTreeFolderNode,
  documentId: string,
): LibraryDocumentSummary | null {
  return buildLibraryTreeIndex(root).documentsById.get(documentId) ?? null;
}
