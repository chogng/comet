import type { PdfAnnotationEditorViewState } from 'ls/editor/browser/pdf/pdfAnnotationEditor';
import type { PdfSelection } from 'ls/editor/browser/pdf/pdfSelection';
import type { EditorWorkspacePdfTab } from 'ls/workbench/browser/parts/editor/editorModel';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import { EditorPane } from 'ls/workbench/browser/parts/editor/panes/editorPane';

export type PdfEditorPaneProps = {
  labels: EditorPartLabels;
  pdfTab: EditorWorkspacePdfTab;
  viewPartProps: ViewPartProps;
};

class PdfEditorPaneStateController {
  private viewState: PdfAnnotationEditorViewState = {
    selection: null,
    draftComment: '',
  };

  getViewState() {
    return this.viewState;
  }

  restoreViewState(viewState: PdfAnnotationEditorViewState | undefined) {
    this.viewState = viewState
      ? {
        selection: viewState.selection,
        draftComment: viewState.draftComment,
      }
      : {
        selection: null,
        draftComment: '',
      };
  }

  setSelection(selection: PdfSelection | null) {
    this.viewState = {
      ...this.viewState,
      selection,
    };
  }
}

export class PdfEditorPane extends EditorPane<
  PdfEditorPaneProps,
  PdfAnnotationEditorViewState
> {
  private props: PdfEditorPaneProps;
  private readonly element = document.createElement('div');
  private readonly bodyElement = document.createElement('div');
  private readonly editor = new PdfEditorPaneStateController();

  constructor(props: PdfEditorPaneProps) {
    super();
    this.props = props;
    this.element.className = 'editor-pdf-pane';
    this.bodyElement.className = 'editor-pdf-body';
    this.element.append(this.bodyElement);
  }

  override getElement() {
    return this.element;
  }

  override setProps(props: PdfEditorPaneProps) {
    this.props = props;
  }

  override getViewState() {
    return this.editor.getViewState();
  }

  override restoreViewState(viewState: PdfAnnotationEditorViewState | undefined) {
    this.editor.restoreViewState(viewState);
  }

  override dispose() {
    this.element.replaceChildren();
  }
}

export function createPdfEditorPane(props: PdfEditorPaneProps) {
  return new PdfEditorPane(props);
}

export default PdfEditorPane;
