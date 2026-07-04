import type {
  LibraryDocumentSummary,
  LibraryDocumentsResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { LibraryViewer } from 'cs/workbench/contrib/knowledgeBase/browser/views/libraryViewer';
import type { LibraryViewerLabels } from 'cs/workbench/contrib/knowledgeBase/browser/views/libraryViewer';

import 'cs/workbench/contrib/knowledgeBase/browser/media/libraryView.css';

export type LibraryViewLabels = LibraryViewerLabels;

export type LibraryViewProps = {
  labels: LibraryViewLabels;
  librarySnapshot: LibraryDocumentsResult;
  onDocumentDragStart?: (documentId: string) => void;
  onDocumentSelect?: (document: LibraryDocumentSummary | null) => void;
  onDocumentOpen?: (document: LibraryDocumentSummary) => void;
  onDocumentRename?: (document: LibraryDocumentSummary) => void;
  onDocumentEditSourceUrl?: (document: LibraryDocumentSummary) => void;
  onDocumentDelete?: (document: LibraryDocumentSummary) => void;
};

export class LibraryView {
  private props: LibraryViewProps;
  private readonly element = document.createElement('div');
  private readonly viewer: LibraryViewer;

  constructor(props: LibraryViewProps) {
    this.props = props;
    this.element.className = 'comet-library-tree';
    this.viewer = new LibraryViewer({
      labels: props.labels,
      librarySnapshot: props.librarySnapshot,
      onDocumentDragStart: props.onDocumentDragStart,
      onDocumentSelect: props.onDocumentSelect,
      onDocumentOpen: props.onDocumentOpen,
      onDocumentRename: props.onDocumentRename,
      onDocumentEditSourceUrl: props.onDocumentEditSourceUrl,
      onDocumentDelete: props.onDocumentDelete,
    });
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: LibraryViewProps) {
    this.props = props;
    this.viewer.setProps({
      labels: props.labels,
      librarySnapshot: props.librarySnapshot,
      onDocumentDragStart: props.onDocumentDragStart,
      onDocumentSelect: props.onDocumentSelect,
      onDocumentOpen: props.onDocumentOpen,
      onDocumentRename: props.onDocumentRename,
      onDocumentEditSourceUrl: props.onDocumentEditSourceUrl,
      onDocumentDelete: props.onDocumentDelete,
    });
    this.render();
  }

  dispose() {
    this.viewer.dispose();
    this.element.replaceChildren();
  }

  private render() {
    const { labels } = this.props;
    this.element.setAttribute('aria-label', labels.libraryTitle);
    const treeElement = this.viewer.render();
    treeElement.setAttribute('aria-label', labels.libraryTitle);
    this.element.replaceChildren(treeElement);
  }
}

export function createLibraryView(props: LibraryViewProps) {
  return new LibraryView(props);
}
