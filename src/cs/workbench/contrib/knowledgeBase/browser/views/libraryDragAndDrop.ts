import type { LibraryDocumentsResult } from 'cs/base/parts/sandbox/common/sandboxTypes';
import {
  createLibraryTreeDragPayload,
  LIBRARY_TREE_DRAG_MIME,
  serializeLibraryTreeDragPayload,
} from 'cs/workbench/contrib/knowledgeBase/common/libraryTreeModel';

export type LibraryDragAndDropProps = {
  onDocumentDragStart?: (documentId: string) => void;
};

export class LibraryDragAndDrop {
  private props: LibraryDragAndDropProps;

  constructor(props: LibraryDragAndDropProps) {
    this.props = props;
  }

  setProps(props: LibraryDragAndDropProps) {
    this.props = props;
  }

  handleDocumentDragStart(
    event: DragEvent,
    document: LibraryDocumentsResult['items'][number],
  ) {
    const { dataTransfer } = event;
    if (!dataTransfer) {
      return;
    }

    const payload = createLibraryTreeDragPayload([document]);
    dataTransfer.effectAllowed = 'copy';
    dataTransfer.setData(
      LIBRARY_TREE_DRAG_MIME,
      serializeLibraryTreeDragPayload(payload),
    );

    const primaryRef = payload.documents[0];
    const textValue =
      primaryRef.title ||
      primaryRef.latestFilePath ||
      primaryRef.sourceUrl ||
      primaryRef.documentId;
    dataTransfer.setData('text/plain', textValue);

    const uriValue = primaryRef.latestFilePath || primaryRef.sourceUrl;
    if (uriValue) {
      dataTransfer.setData('text/uri-list', uriValue);
    }

    this.props.onDocumentDragStart?.(document.documentId);
  }
}
