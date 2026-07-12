/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
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
import { IEditorService } from 'cs/workbench/services/editor/common/editorService';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { INativeHostService } from 'cs/platform/native/common/native';
import { URI } from 'cs/base/common/uri';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { EmptyPdfEditorUrl } from 'cs/workbench/contrib/pdfEditor/common/pdfEditorResources';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { createEditorPdfModeToolbarContribution } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorToolbar';
import { Emitter } from 'cs/base/common/event';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createPdfEditorPaneState } from 'cs/workbench/contrib/pdfEditor/browser/pdfEditorPaneState';
import type { CancellationToken } from 'cs/base/common/cancellation';
import type { IEditorOpenContext, IEditorOptions } from 'cs/workbench/common/editor';
import { IBrowserEditorToolbarService } from 'cs/workbench/contrib/browserView/common/browserEditorToolbarService';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import type { LocaleMessages } from 'language/locales';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';

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

function createPdfEditorPaneLabels(ui: LocaleMessages): PdfEditorPaneLabels {
	return {
		toolbarSources: ui.agentbarToolbarSources,
		toolbarMore: ui.agentbarToolbarMore,
		pdfTitle: ui.editorPdfTitle,
		pdfOpenFile: ui.editorPdfOpenFile,
		emptyWorkspaceBody: ui.editorEmptyWorkspaceBody,
		pdfMode: ui.editorPdfMode,
		status: {
			statusbarAriaLabel: ui.editorStatusbarAriaLabel,
			url: ui.editorStatusUrl,
		},
	};
}

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
	private readonly disposables = new DisposableStore();
  private input: PdfEditorPaneInput | undefined;
	private readonly element = $<HTMLDivElement>('div.comet-editor-pdf-pane');
	private readonly bodyElement = $<HTMLDivElement>('div.comet-editor-pdf-body');
  private readonly editor = new PdfEditorPaneStateController();
  private readerSnapshot: PdfReaderSnapshot | undefined;
  private documentReader: ReturnType<typeof createPdfDocumentReader> | null = null;
  private readonly toolbar: ReturnType<typeof createEditorPdfModeToolbarContribution>;
	private readerStatus: PdfReaderRuntimeStatus | undefined;
  private readonly runtimeStateEmitter = new Emitter<EditorPaneRuntimeState>();
  override readonly onDidChangeRuntimeState = this.runtimeStateEmitter.event;

	constructor(
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@IEditorService private readonly editorService: IEditorService,
		@IBrowserEditorToolbarService private readonly browserEditorToolbarService: IBrowserEditorToolbarService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
	) {
    super();
    this.element.append(this.bodyElement);
		this.toolbar = createEditorPdfModeToolbarContribution(this.createToolbarContext(), {
			contextMenuService: this.contextMenuService,
			contextViewProvider: this.contextViewService,
		});
		this.disposables.add(toDisposable(this.localeService.subscribe(() => {
			this.toolbar.setContext(this.createToolbarContext());
			if (this.input) {
				this.render();
			}
		})));
  }

  override getElement() {
    return this.element;
  }

  override getToolbarElement() {
    return this.toolbar.getElement();
  }

  override getRuntimeState() {
		return this.input && this.readerStatus
			? createPdfEditorPaneState(this.input, this.labels, this.readerStatus)
			: undefined;
  }

  override setInput(
		input: PdfEditorPaneInput,
		_options: IEditorOptions | undefined,
		_context: IEditorOpenContext,
		_token: CancellationToken,
  ) {
    this.input = input;
		this.readerStatus = undefined;
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
		this.disposables.dispose();
    this.runtimeStateEmitter.dispose();
		this.input = undefined;
		this.readerSnapshot = undefined;
    this.element.replaceChildren();
  }

  private createToolbarContext() {
		const labels = this.labels;
    return {
      labels: {
				toolbarSources: labels.toolbarSources,
				toolbarMore: labels.toolbarMore,
				pdfTitle: labels.pdfTitle,
      },
			onOpenSources: () => this.browserEditorToolbarService.actions.onOpenSources(),
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
		const ui = this.languageService.getLocaleMessages(this.localeService.getLocale());
    return {
      browserUrl: source.kind === 'url' ? source.url : '',
      browserPageTitle: source.kind === 'url' ? source.title : undefined,
      browserFaviconUrl: '',
			browserIsLoading: false,
			electronRuntime: this.nativeHostService.canInvoke(),
			webContentRuntime: typeof this.nativeHostService.webContent?.navigate === 'function',
			labels: {
				emptyState: ui.emptyState,
				contentUnavailable: ui.webContentUnavailable,
				overlayPauseHeading: ui.webContentOverlayPauseHeading,
				overlayPauseDetail: ui.webContentOverlayPauseDetail,
			},
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
		const labels = this.labels;
    const annotations = readStoredPdfAnnotations(this.getAnnotationTargetId());
    const readerProps = {
			url: snapshot.source.kind === 'url'
				? snapshot.source.url
        : '',
			targetId: input.id,
      annotationTargetId: this.getAnnotationTargetId(),
      labels: {
			title: labels.pdfTitle,
			emptyState: labels.emptyWorkspaceBody,
			openPdfFile: labels.pdfOpenFile,
      },
      viewPartProps: this.createReaderViewPartProps(),
			nativeHost: this.nativeHostService,
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
				this.readerStatus = status;
				this.runtimeStateEmitter.fire(createPdfEditorPaneState(input, this.labels, status));
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
			const resource = await this.nativeHostService.invoke('pick_pdf_file');
      if (!resource) {
        return;
      }
      const uri = URI.revive(resource);

			await this.editorService.openEditor({
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

	private get labels(): PdfEditorPaneLabels {
		return createPdfEditorPaneLabels(
			this.languageService.getLocaleMessages(this.localeService.getLocale()),
		);
	}
}
