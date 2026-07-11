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
import type { EditorOpenHandler } from 'cs/workbench/services/editor/common/editorService';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { INativeHostService } from 'cs/platform/native/common/native';
import { URI } from 'cs/base/common/uri';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { EmptyPdfEditorUrl } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorResources';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { createEditorPdfModeToolbarContribution } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorToolbar';
import { Emitter } from 'cs/base/common/event';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createPdfEditorPaneState } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorPaneState';

export interface PdfEditorPaneInput extends EditorInput {
  readonly id: string;
  readonly url: string;
}

export interface PdfEditorPaneLabels {
	readonly toolbarSources: string;
	readonly toolbarMore: string;
	readonly pdfTitle: string;
	readonly pdfOpenFile: string;
	readonly emptyWorkspaceBody: string;
	readonly pdfMode: string;
	readonly status: {
		readonly statusbarAriaLabel: string;
		readonly url: string;
	};
}

export type PdfEditorPaneViewState = PdfDocumentReaderViewState & {
  reader: PdfReaderViewState;
};

export type PdfEditorPaneContext = DropdownContextServices & {
  labels: PdfEditorPaneLabels;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
  onOpenEditor?: EditorOpenHandler;
  onOpenSources: () => void;
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
  private input: PdfEditorPaneInput | undefined;
  private readonly element = document.createElement('div');
  private readonly bodyElement = document.createElement('div');
  private readonly editor = new PdfEditorPaneStateController();
  private readerSnapshot: PdfReaderSnapshot | undefined;
  private documentReader: ReturnType<typeof createPdfDocumentReader> | null = null;
  private readonly toolbar: ReturnType<typeof createEditorPdfModeToolbarContribution>;
  private runtimeState: EditorPaneRuntimeState | undefined;
  private readonly runtimeStateEmitter = new Emitter<EditorPaneRuntimeState>();
  override readonly onDidChangeRuntimeState = this.runtimeStateEmitter.event;

  constructor(private context: PdfEditorPaneContext) {
    super();
    this.element.className = 'comet-editor-pdf-pane';
    this.bodyElement.className = 'comet-editor-pdf-body';
    this.element.append(this.bodyElement);
    this.toolbar = createEditorPdfModeToolbarContribution(this.createToolbarContext(), context);
  }

  override getElement() {
    return this.element;
  }

  setContext(context: PdfEditorPaneContext) {
    this.context = context;
    this.toolbar.setContext(this.createToolbarContext());
  }

  override getToolbarElement() {
    return this.toolbar.getElement();
  }

  override getRuntimeState() {
    return this.runtimeState;
  }

  override setInput(input: PdfEditorPaneInput) {
    this.input = input;
    this.readerSnapshot = this.createReaderSnapshot(input);
    this.toolbar.setContext(this.createToolbarContext());
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
    this.toolbar.dispose();
    this.runtimeStateEmitter.dispose();
		this.input = undefined;
		this.readerSnapshot = undefined;
    this.element.replaceChildren();
  }

  private createToolbarContext() {
    return {
      labels: {
        toolbarSources: this.context.labels.toolbarSources,
        toolbarMore: this.context.labels.toolbarMore,
        pdfTitle: this.context.labels.pdfTitle,
      },
      onOpenSources: this.context.onOpenSources,
      onHighlightSelection: () => this.addHighlightFromSelection(),
      onNoteSelection: () => this.addNoteFromSelection(),
    };
  }

  private createReaderSnapshot(input: PdfEditorPaneInput) {
    return createPdfReaderSnapshot({
      source: createPdfReaderDocumentSource({
        url: input.url,
        title: input.getName(),
        emptyUrl: EmptyPdfEditorUrl,
      }),
      viewState: this.editor.getViewState().reader,
    });
  }

  private createReaderViewPartProps(): ViewPartProps {
		const { source } = this.getReaderSnapshot();
    return {
      ...this.context.viewPartProps,
      browserUrl: source.kind === 'url' ? source.url : '',
      browserPageTitle: source.kind === 'url' ? source.title : undefined,
      browserFaviconUrl: '',
    };
  }

  private getAnnotationTargetId() {
		const snapshot = this.getReaderSnapshot();
		return snapshot.source.kind === 'url'
			? snapshot.source.url
			: this.getInput().id;
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
		const input = this.getInput();
		const snapshot = this.getReaderSnapshot();
    const annotations = readStoredPdfAnnotations(this.getAnnotationTargetId());
    const readerProps = {
			url: snapshot.source.kind === 'url'
				? snapshot.source.url
        : '',
			targetId: input.id,
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
				this.runtimeState = createPdfEditorPaneState(input, this.context.labels, status);
        this.runtimeStateEmitter.fire(this.runtimeState);
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

	private getInput(): PdfEditorPaneInput {
		if (!this.input) {
			throw new Error('PDF editor pane has no active input.');
		}
		return this.input;
	}

	private getReaderSnapshot(): PdfReaderSnapshot {
		if (!this.readerSnapshot) {
			throw new Error('PDF editor pane has no reader snapshot.');
		}
		return this.readerSnapshot;
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

export function createPdfEditorPane(context: PdfEditorPaneContext) {
  return new PdfEditorPane(context);
}

export default PdfEditorPane;
