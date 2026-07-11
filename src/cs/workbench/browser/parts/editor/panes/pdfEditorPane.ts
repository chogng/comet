import type {
  PdfDocumentReaderViewState,
  PdfReaderRuntimeStatus,
} from 'cs/editor/browser/pdf/pdfDocumentReader';
import {
  createPdfDocumentReader,
} from 'cs/editor/browser/pdf/pdfDocumentReader';
import type { PdfSelection } from 'cs/editor/browser/pdf/pdfSelection';
import { createAnnotationId } from 'cs/editor/common/annotation';
import type { Annotation } from 'cs/editor/common/annotation';
import { createPdfAnnotationAnchorFromSelection } from 'cs/editor/browser/pdf/pdfAnnotationAnchor';
import {
  readStoredPdfAnnotations,
  writeStoredPdfAnnotations,
} from 'cs/editor/browser/pdf/pdfAnnotationPersistence';
import {
  createPdfReaderDocumentSource,
  createPdfReaderSnapshot,
  normalizePdfReaderViewState,
} from 'cs/editor/browser/pdf/pdfReaderState';
import type {
  PdfReaderSnapshot,
  PdfReaderViewState,
} from 'cs/editor/browser/pdf/pdfReaderState';
import type { ViewPartProps } from 'cs/workbench/browser/parts/views/viewPartView';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { URI } from 'cs/base/common/uri';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { EmptyEditorUrl } from 'cs/workbench/common/editor/editorResources';

export interface PdfEditorPaneInput extends EditorInput {
  readonly id: string;
  readonly url: string;
}

export type PdfEditorPaneViewState = PdfDocumentReaderViewState & {
  reader: PdfReaderViewState;
};

export type PdfEditorPaneContext = {
  labels: EditorPartLabels;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  onOpenEditor?: EditorOpenHandler;
  onReaderStatusChange?: (
    input: PdfEditorPaneInput,
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
  PdfEditorPaneInput,
  PdfEditorPaneViewState
> {
  private input: PdfEditorPaneInput;
  private readonly element = document.createElement('div');
  private readonly bodyElement = document.createElement('div');
  private readonly editor = new PdfEditorPaneStateController();
  private readerSnapshot: PdfReaderSnapshot;
  private documentReader: ReturnType<typeof createPdfDocumentReader> | null = null;

  constructor(input: PdfEditorPaneInput, private readonly context: PdfEditorPaneContext) {
    super();
    this.input = input;
    this.readerSnapshot = this.createReaderSnapshot(input);
    this.element.className = 'comet-editor-pdf-pane';
    this.bodyElement.className = 'comet-editor-pdf-body';
    this.element.append(this.bodyElement);
    this.render();
  }

  override getElement() {
    return this.element;
  }

  override setInput(input: PdfEditorPaneInput) {
    this.input = input;
    this.readerSnapshot = this.createReaderSnapshot(input);
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

  private createReaderSnapshot(input: PdfEditorPaneInput) {
    return createPdfReaderSnapshot({
      source: createPdfReaderDocumentSource({
        url: input.url,
        title: input.getName(),
        emptyUrl: EmptyEditorUrl,
      }),
      viewState: this.editor.getViewState().reader,
    });
  }

  private createReaderViewPartProps(): ViewPartProps {
    const { source } = this.readerSnapshot;
    return {
      ...this.context.viewPartProps,
      browserUrl: source.kind === 'url' ? source.url : '',
      browserPageTitle: source.kind === 'url' ? source.title : undefined,
      browserFaviconUrl: '',
    };
  }

  private getAnnotationTargetId() {
    return this.readerSnapshot.source.kind === 'url'
      ? this.readerSnapshot.source.url
      : this.input.id;
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
      targetId: this.input.id,
      annotationTargetId: this.getAnnotationTargetId(),
      labels: {
        title: this.context.labels.pdfTitle,
        emptyState: this.context.labels.emptyWorkspaceBody,
        openPdfFile: this.context.labels.pdfOpenFile,
      },
      viewPartProps: this.createReaderViewPartProps(),
      nativeHost: this.context.nativeHost,
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
        this.context.onReaderStatusChange?.(this.input, status);
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
      const resource = await this.context.nativeHost.invoke('pick_pdf_file');
      if (!resource) {
        return;
      }
      const uri = URI.revive(resource);

      await this.context.onOpenEditor?.({
        resource: uri,
        options: {
          viewState: {
            url: uri.toString(),
          },
        },
      });
    } catch (error) {
      console.error('Failed to open PDF file.', error);
    }
  };
}

export function createPdfEditorPane(input: PdfEditorPaneInput, context: PdfEditorPaneContext) {
  return new PdfEditorPane(input, context);
}

export default PdfEditorPane;
