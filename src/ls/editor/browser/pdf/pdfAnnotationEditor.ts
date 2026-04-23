import { createAnnotationId } from 'ls/editor/common/annotation';
import type { Annotation } from 'ls/editor/common/annotation';
import { ViewPartView } from 'ls/workbench/browser/parts/views/viewPartView';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import { PdfAnnotationStore } from 'ls/editor/browser/pdf/pdfAnnotationStore';
import type { PdfAnnotationStoreSnapshot } from 'ls/editor/browser/pdf/pdfAnnotationStore';
import { createPdfSelection, isPdfSelectionEmpty } from 'ls/editor/browser/pdf/pdfSelection';
import type { PdfSelection } from 'ls/editor/browser/pdf/pdfSelection';

import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostService';
import 'ls/editor/browser/pdf/media/pdfAnnotationEditor.css';

export type PdfAnnotationEditorLabels = {
  title: string;
  emptyState: string;
  openPdfFile?: string;
};

export type PdfAnnotationEditorProps = {
  url: string;
  targetId: string;
  annotationTargetId?: string;
  labels: PdfAnnotationEditorLabels;
  viewPartProps: ViewPartProps;
  annotations?: readonly Annotation[];
  selection?: PdfSelection | null;
  onAnnotationsChange?: (annotations: readonly Annotation[]) => void;
  onViewStateChange?: (viewState: PdfAnnotationEditorViewState) => void;
  onOpenPdfFile?: () => void | Promise<void>;
};

export type PdfAnnotationEditorViewState = Pick<
  PdfAnnotationStoreSnapshot,
  'selection' | 'draftComment'
>;

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

export class PdfAnnotationEditor {
  private props: PdfAnnotationEditorProps;
  private readonly element = createElement('div', 'pdf-annotation-editor');
  private readonly surfaceElement = createElement('div', 'pdf-annotation-surface');
  private readonly emptyOpenElement = createElement('div', 'pdf-annotation-open-empty');
  private readonly openPdfButton = createElement('button', 'pdf-annotation-open-btn');
  private readonly overlayElement = createElement('div', 'pdf-annotation-overlay');
  private readonly badgeElement = createElement('div', 'pdf-annotation-badge');
  private readonly hintElement = createElement('div', 'pdf-annotation-hint');
  private readonly draftSectionElement = createElement('div', 'pdf-annotation-draft');
  private readonly draftMetaElement = createElement('div', 'pdf-annotation-meta');
  private readonly draftTextElement = document.createElement('textarea');
  private readonly actionRowElement = createElement('div', 'pdf-annotation-actions');
  private readonly captureSelectionButton = createElement('button', 'pdf-annotation-btn');
  private readonly saveAnnotationButton = createElement('button', 'pdf-annotation-btn is-primary');
  private readonly listElement = createElement('div', 'pdf-annotation-list');
  private readonly viewPartView: ViewPartView;
  private readonly store = new PdfAnnotationStore();
  private readonly unsubscribeStore: () => void;

  constructor(props: PdfAnnotationEditorProps) {
    this.props = props;
    this.viewPartView = new ViewPartView(props.viewPartProps);
    this.unsubscribeStore = this.store.subscribe(() => {
      this.renderOverlay();
      this.props.onViewStateChange?.(this.getViewState());
    });
    this.draftTextElement.className = 'pdf-annotation-textarea';
    this.draftTextElement.rows = 3;
    this.draftTextElement.placeholder = 'Annotation comment';
    this.draftTextElement.addEventListener('input', this.handleDraftCommentInput);
    this.captureSelectionButton.type = 'button';
    this.captureSelectionButton.textContent = 'Capture Selection';
    this.captureSelectionButton.addEventListener('click', this.handleCaptureSelection);
    this.openPdfButton.type = 'button';
    this.openPdfButton.addEventListener('click', this.handleOpenPdfFile);
    this.saveAnnotationButton.type = 'button';
    this.saveAnnotationButton.textContent = 'Create Annotation';
    this.saveAnnotationButton.addEventListener('click', this.handleCreateAnnotation);
    this.actionRowElement.append(
      this.captureSelectionButton,
      this.saveAnnotationButton,
    );
    this.draftSectionElement.append(
      this.draftMetaElement,
      this.draftTextElement,
      this.actionRowElement,
    );
    this.emptyOpenElement.append(this.openPdfButton);
    this.surfaceElement.append(this.viewPartView.getElement(), this.emptyOpenElement);
    this.overlayElement.append(
      this.badgeElement,
      this.hintElement,
      this.draftSectionElement,
      this.listElement,
    );
    this.element.append(this.surfaceElement, this.overlayElement);
    this.setProps(props);
  }

  getElement() {
    return this.element;
  }

  getSnapshot(): PdfAnnotationStoreSnapshot {
    return this.store.getSnapshot();
  }

  getViewState(): PdfAnnotationEditorViewState {
    const snapshot = this.store.getSnapshot();
    return {
      selection: snapshot.selection,
      draftComment: snapshot.draftComment,
    };
  }

  setProps(props: PdfAnnotationEditorProps) {
    this.props = props;
    this.store.setTarget(props.annotationTargetId ?? props.targetId);
    this.store.setAnnotations(props.annotations ?? []);
    this.store.setSelection(props.selection ?? null);
    this.viewPartView.setProps(props.viewPartProps);
    this.renderOverlay();
  }

  setSelection(selection: PdfSelection | null) {
    this.store.setSelection(selection);
  }

  restoreViewState(viewState: PdfAnnotationEditorViewState | undefined) {
    if (!viewState) {
      return;
    }

    this.store.setSelection(viewState.selection);
    this.store.setDraftComment(viewState.draftComment);
  }

  dispose() {
    this.unsubscribeStore();
    this.viewPartView.dispose();
    this.element.replaceChildren();
  }

  private renderOverlay() {
    const snapshot = this.store.getSnapshot();
    this.emptyOpenElement.hidden = Boolean(this.props.url.trim());
    this.openPdfButton.textContent = this.props.labels.openPdfFile ?? 'Open PDF';
    this.badgeElement.textContent = `${this.props.labels.title} Annotation`;
    this.hintElement.textContent =
      snapshot.annotations.length > 0
        ? `${snapshot.annotations.length} annotations`
        : this.props.labels.emptyState;

    const hasSelection = !isPdfSelectionEmpty(snapshot.selection);
    this.draftMetaElement.textContent = hasSelection
      ? `Page ${snapshot.selection?.page ?? 1} selected`
      : 'No PDF selection yet';
    this.draftTextElement.value = snapshot.draftComment;
    this.saveAnnotationButton.disabled =
      !hasSelection || !snapshot.draftComment.trim();
    this.renderAnnotationList(snapshot);
  }

  private renderAnnotationList(snapshot: PdfAnnotationStoreSnapshot) {
    this.listElement.replaceChildren();

    if (snapshot.annotations.length === 0) {
      const emptyElement = createElement('div', 'pdf-annotation-list-empty');
      emptyElement.textContent = 'Annotations will appear here.';
      this.listElement.append(emptyElement);
      return;
    }

    for (const annotation of snapshot.annotations) {
      const itemElement = createElement('div', 'pdf-annotation-item');
      const titleElement = createElement('div', 'pdf-annotation-item-title');
      const bodyElement = createElement('div', 'pdf-annotation-item-body');
      titleElement.textContent = `Page ${annotation.anchor.page}`;
      bodyElement.textContent = annotation.comment;
      itemElement.append(titleElement, bodyElement);
      this.listElement.append(itemElement);
    }
  }

  private readonly handleDraftCommentInput = () => {
    this.store.setDraftComment(this.draftTextElement.value);
  };

  private readonly handleCaptureSelection = async () => {
    const selectionSnapshot = await nativeHostService.webContent?.getSelection?.(
      this.props.targetId,
    );
    if (!selectionSnapshot || !selectionSnapshot.text.trim()) {
      this.store.setSelection(null);
      return;
    }

    this.store.setSelection(
      createPdfSelection({
        page: 1,
        rects: selectionSnapshot.rects,
        text: selectionSnapshot.text,
      }),
    );
  };

  private readonly handleOpenPdfFile = () => {
    void this.props.onOpenPdfFile?.();
  };

  private readonly handleCreateAnnotation = () => {
    const snapshot = this.store.getSnapshot();
    const selection = snapshot.selection;
    if (!snapshot.targetId || isPdfSelectionEmpty(selection) || !selection) {
      return;
    }

    const now = new Date().toISOString();
    const nextAnnotation: Annotation = {
      id: createAnnotationId('pdf_annotation'),
      kind: 'pdf',
      targetId: snapshot.targetId,
      anchor: {
        page: selection.page,
        rects: [...selection.rects],
        quote: selection.text.trim() || undefined,
      },
      comment: snapshot.draftComment.trim(),
      createdAt: now,
      updatedAt: now,
    };

    const nextAnnotations = [...snapshot.annotations, nextAnnotation];
    this.store.setAnnotations(nextAnnotations);
    this.store.setDraftComment('');
    this.store.setSelection(null);
    this.props.onAnnotationsChange?.(nextAnnotations);
  }
}

export function createPdfAnnotationEditor(props: PdfAnnotationEditorProps) {
  return new PdfAnnotationEditor(props);
}
