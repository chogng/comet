import type {
  PdfDocumentReaderViewState,
  PdfReaderRuntimeStatus,
} from 'ls/editor/browser/pdf/pdfDocumentReader';
import {
  createPdfDocumentReader,
} from 'ls/editor/browser/pdf/pdfDocumentReader';
import type { PdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import { createAnnotationId } from 'ls/editor/common/annotation';
import type { Annotation } from 'ls/editor/common/annotation';
import { createPdfAnnotationAnchorFromSelection } from 'ls/editor/browser/pdf/pdfAnnotationAnchor';
import {
  readStoredPdfAnnotations,
  writeStoredPdfAnnotations,
} from 'ls/editor/browser/pdf/pdfAnnotationPersistence';
import {
  createPdfReaderDocumentSource,
  createPdfReaderSnapshot,
  normalizePdfReaderViewState,
} from 'ls/editor/browser/pdf/pdfReaderState';
import type {
  PdfReaderSnapshot,
  PdfReaderViewState,
} from 'ls/editor/browser/pdf/pdfReaderState';
import { EMPTY_PDF_TAB_URL } from 'ls/workbench/browser/parts/editor/editorInput';
import type { EditorWorkspacePdfTab } from 'ls/workbench/browser/parts/editor/editorModel';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import type { EditorOpenHandler } from 'ls/workbench/services/editor/common/editorOpenTypes';
import { EditorPane } from 'ls/workbench/browser/parts/editor/panes/editorPane';
import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostService';
import { toFileUrl } from 'ls/workbench/common/fileUrl';

export type PdfEditorPaneViewState = PdfDocumentReaderViewState & {
  reader: PdfReaderViewState;
};

export type PdfEditorPaneProps = {
  labels: EditorPartLabels;
  pdfTab: EditorWorkspacePdfTab;
  viewPartProps: ViewPartProps;
  onOpenEditor?: EditorOpenHandler;
  onReaderStatusChange?: (
    tabId: string,
    status: PdfReaderRuntimeStatus,
  ) => void;
};

class PdfEditorPaneStateController {
  private viewState: PdfEditorPaneViewState = {
    selection: null,
    draftComment: '',
    reader: normalizePdfReaderViewState(null),
  };

  getViewState() {
    return this.viewState;
  }

  restoreViewState(viewState: Partial<PdfEditorPaneViewState> | undefined) {
    this.viewState = viewState
      ? {
        selection: viewState.selection ?? null,
        draftComment: viewState.draftComment ?? '',
        reader: normalizePdfReaderViewState(viewState.reader),
      }
      : {
        selection: null,
        draftComment: '',
        reader: normalizePdfReaderViewState(null),
      };
  }

  setSelection(selection: PdfSelection | null) {
    this.viewState = {
      ...this.viewState,
      selection,
    };
  }

  setDocumentReaderViewState(viewState: PdfDocumentReaderViewState) {
    this.viewState = {
      ...this.viewState,
      selection: viewState.selection,
      draftComment: viewState.draftComment,
    };
  }
}

export class PdfEditorPane extends EditorPane<
  PdfEditorPaneProps,
  PdfEditorPaneViewState
> {
  private props: PdfEditorPaneProps;
  private readonly element = document.createElement('div');
  private readonly bodyElement = document.createElement('div');
  private readonly editor = new PdfEditorPaneStateController();
  private readerSnapshot: PdfReaderSnapshot;
  private documentReader: ReturnType<typeof createPdfDocumentReader> | null = null;

  constructor(props: PdfEditorPaneProps) {
    super();
    this.props = props;
    this.readerSnapshot = this.createReaderSnapshot(props);
    this.element.className = 'editor-pdf-pane';
    this.bodyElement.className = 'editor-pdf-body';
    this.element.append(this.bodyElement);
    this.render();
  }

  override getElement() {
    return this.element;
  }

  override setProps(props: PdfEditorPaneProps) {
    this.props = props;
    this.readerSnapshot = this.createReaderSnapshot(props);
    this.render();
  }

  override getViewState() {
    return this.editor.getViewState();
  }

  override restoreViewState(viewState: PdfEditorPaneViewState | undefined) {
    this.editor.restoreViewState(viewState);
    this.documentReader?.restoreViewState(this.editor.getViewState());
  }

  addHighlightFromSelection() {
    return this.addAnnotationFromSelection('highlight');
  }

  addNoteFromSelection() {
    return this.addAnnotationFromSelection('note');
  }

  updatePdfAnnotation(annotation: Annotation) {
    const targetId = this.getAnnotationTargetId();
    const annotations = readStoredPdfAnnotations(targetId);
    const nextAnnotations = annotations.map((storedAnnotation) => {
      return storedAnnotation.id === annotation.id
        ? annotation
        : storedAnnotation;
    });
    writeStoredPdfAnnotations(targetId, nextAnnotations);
    this.render();
  }

  deletePdfAnnotation(annotationId: string) {
    const targetId = this.getAnnotationTargetId();
    const annotations = readStoredPdfAnnotations(targetId).filter((annotation) => {
      return annotation.id !== annotationId;
    });
    writeStoredPdfAnnotations(targetId, annotations);
    this.render();
  }

  override dispose() {
    this.documentReader?.dispose();
    this.documentReader = null;
    this.element.replaceChildren();
  }

  private createReaderSnapshot(props: PdfEditorPaneProps) {
    return createPdfReaderSnapshot({
      source: createPdfReaderDocumentSource({
        url: props.pdfTab.url,
        title: props.pdfTab.title,
        emptyUrl: EMPTY_PDF_TAB_URL,
      }),
      viewState: this.editor.getViewState().reader,
    });
  }

  private createReaderViewPartProps(props: PdfEditorPaneProps): ViewPartProps {
    const { source } = this.readerSnapshot;
    return {
      ...props.viewPartProps,
      browserUrl: source.kind === 'url' ? source.url : '',
      browserPageTitle: source.kind === 'url' ? source.title : undefined,
      browserFaviconUrl: '',
    };
  }

  private getAnnotationTargetId() {
    return this.readerSnapshot.source.kind === 'url'
      ? this.readerSnapshot.source.url
      : this.props.pdfTab.id;
  }

  private addAnnotationFromSelection(mode: NonNullable<Annotation['mode']>) {
    const selection = this.editor.getViewState().selection;
    if (!selection || !selection.text.trim()) {
      return false;
    }

    const targetId = this.getAnnotationTargetId();
    const now = new Date().toISOString();
    const annotation: Annotation = {
      id: createAnnotationId(`pdf_${mode}`),
      kind: 'pdf',
      mode,
      targetId,
      anchor: createPdfAnnotationAnchorFromSelection(selection),
      comment: mode === 'note'
        ? this.editor.getViewState().draftComment.trim()
        : '',
      createdAt: now,
      updatedAt: now,
    };

    writeStoredPdfAnnotations(targetId, [
      ...readStoredPdfAnnotations(targetId),
      annotation,
    ]);
    this.render();
    return true;
  }

  private render() {
    const annotations = readStoredPdfAnnotations(this.getAnnotationTargetId());
    const readerProps = {
      url: this.readerSnapshot.source.kind === 'url'
        ? this.readerSnapshot.source.url
        : '',
      targetId: this.props.pdfTab.id,
      annotationTargetId: this.getAnnotationTargetId(),
      labels: {
        title: this.props.labels.pdfTitle,
        emptyState: this.props.labels.emptyWorkspaceBody,
        openPdfFile: this.props.labels.pdfOpenFile,
      },
      viewPartProps: this.createReaderViewPartProps(this.props),
      annotations,
      selection: this.editor.getViewState().selection,
      onViewStateChange: (viewState: PdfDocumentReaderViewState) => {
        this.editor.setDocumentReaderViewState(viewState);
      },
      onAnnotationChange: (annotation: Annotation) => {
        this.updatePdfAnnotation(annotation);
      },
      onAnnotationDelete: (annotationId: string) => {
        this.deletePdfAnnotation(annotationId);
      },
      onReaderStatusChange: (status: PdfReaderRuntimeStatus) => {
        this.props.onReaderStatusChange?.(this.props.pdfTab.id, status);
      },
      onOpenPdfFile: this.handleOpenPdfFile,
    };

    if (!this.documentReader) {
      this.documentReader = createPdfDocumentReader(readerProps);
      this.bodyElement.replaceChildren(this.documentReader.getElement());
      return;
    }

    this.documentReader.setProps(readerProps);
  }

  private readonly handleOpenPdfFile = async () => {
    try {
      const filePath = await nativeHostService.invoke('pick_pdf_file');
      const fileUrl = toFileUrl(filePath ?? '');
      if (!fileUrl) {
        return;
      }

      await this.props.onOpenEditor?.({
        kind: 'pdf',
        disposition: 'reveal-or-open',
        url: fileUrl,
      });
    } catch (error) {
      console.error('Failed to open PDF file.', error);
    }
  };
}

export function createPdfEditorPane(props: PdfEditorPaneProps) {
  return new PdfEditorPane(props);
}

export default PdfEditorPane;
