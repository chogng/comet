import { isDraftEditorCommandEnabled } from 'cs/editor/browser/text/editorCommandRegistry';
import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import { ProseMirrorEditor } from 'cs/editor/browser/text/editor';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createDraftEditorCommandAction } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import type { DraftEditorCommandId } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import type { DraftEditorSurfaceActionId } from 'cs/workbench/contrib/draftEditor/browser/activeDraftEditorCommandExecutor';
import type { WritingEditorSurfaceViewState } from 'cs/editor/browser/text/editor';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { Emitter } from 'cs/base/common/event';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createDraftEditorPaneState } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPaneState';

export interface DraftEditorPaneInput extends EditorInput {
  readonly document: WritingEditorDocument;
  setDocument(value: WritingEditorDocument): void;
}

export interface DraftEditorPaneLabels {
	readonly toolbarMore: string;
	readonly draftBodyPlaceholder: string;
	readonly draftMode: string;
	readonly editorModalConfirm: string;
	readonly editorModalCancel: string;
	readonly textGroup: string;
	readonly formatGroup: string;
	readonly insertGroup: string;
	readonly historyGroup: string;
	readonly paragraph: string;
	readonly heading1: string;
	readonly heading2: string;
	readonly heading3: string;
	readonly bold: string;
	readonly italic: string;
	readonly underline: string;
	readonly fontFamily: string;
	readonly fontSize: string;
	readonly defaultTextStyle: string;
	readonly alignLeft: string;
	readonly alignCenter: string;
	readonly alignRight: string;
	readonly clearInlineStyles: string;
	readonly bulletList: string;
	readonly orderedList: string;
	readonly blockquote: string;
	readonly undo: string;
	readonly redo: string;
	readonly insertCitation: string;
	readonly insertFigure: string;
	readonly insertFigureRef: string;
	readonly citationPrompt: string;
	readonly figureUrlPrompt: string;
	readonly figureCaptionPrompt: string;
	readonly figureRefPrompt: string;
	readonly fontFamilyPrompt: string;
	readonly fontSizePrompt: string;
	readonly status: {
		readonly statusbarAriaLabel: string;
		readonly words: string;
		readonly characters: string;
		readonly paragraphs: string;
		readonly selection: string;
		readonly block: string;
		readonly line: string;
		readonly column: string;
		readonly blockFigure: string;
		readonly ready: string;
	};
}

export type DraftEditorPaneContext = DropdownContextServices & {
  labels: DraftEditorPaneLabels;
  dialogService: IDialogService;
};

export class DraftEditorPane extends EditorPane<
  DraftEditorPaneInput,
  WritingEditorSurfaceViewState
> {
  private input: DraftEditorPaneInput | undefined;
  private readonly element = document.createElement('div');
  private editor: ProseMirrorEditor | undefined;
  private runtimeState: EditorPaneRuntimeState | undefined;
  private readonly runtimeStateEmitter = new Emitter<EditorPaneRuntimeState>();
  override readonly onDidChangeRuntimeState = this.runtimeStateEmitter.event;

  constructor(private context: DraftEditorPaneContext) {
    super();
    this.element.className = 'comet-editor-draft-pane';
  }

  override getElement() {
    return this.element;
  }

  setContext(context: DraftEditorPaneContext) {
    this.context = context;
  }

  override getToolbarElement() {
    return this.getEditor().getToolbarElement();
  }

  override getRuntimeState() {
    return this.runtimeState;
  }

  getStableSelectionTarget() {
    return this.getEditor().getStableSelectionTarget();
  }

  canExecuteCommand(commandId: DraftEditorCommandId) {
    return isDraftEditorCommandEnabled(commandId, {
      availableFigureIds: this.getEditor().getAvailableFigureIds(),
    });
  }

  executeCommand(commandId: DraftEditorCommandId) {
    if (!this.canExecuteCommand(commandId)) {
      return false;
    }

    switch (commandId) {
      case 'insertCitation':
        this.handleInsertCitation();
        return true;
      case 'insertFigure':
        this.handleInsertFigure();
        return true;
      case 'insertFigureRef':
        this.handleInsertFigureRef();
        return true;
    }
  }

  executeEditorAction(actionId: DraftEditorSurfaceActionId) {
    switch (actionId) {
      case 'undo':
        return this.getEditor().undo();
      case 'redo':
        return this.getEditor().redo();
    }
  }

  override setInput(input: DraftEditorPaneInput) {
    this.input = input;
		if (this.editor) {
			this.editor.setProps(this.toEditorProps());
			return;
		}
		this.editor = new ProseMirrorEditor(this.toEditorProps());
		this.element.append(this.editor.getElement());
  }

  override focus() {
    this.getEditor().focus();
  }

  override getViewState() {
    return this.getEditor().getViewState();
  }

  override restoreViewState(viewState: WritingEditorSurfaceViewState | undefined) {
    this.getEditor().restoreViewState(viewState);
  }

  override dispose() {
		this.editor?.dispose();
		this.editor = undefined;
		this.input = undefined;
    this.runtimeStateEmitter.dispose();
    this.element.replaceChildren();
  }

  private createCommandContext = () => ({
    editor: this.getEditor(),
    labels: {
      citationPrompt: this.context.labels.citationPrompt,
      figureUrlPrompt: this.context.labels.figureUrlPrompt,
      figureCaptionPrompt: this.context.labels.figureCaptionPrompt,
      figureRefPrompt: this.context.labels.figureRefPrompt,
    },
    prompt: (message: string, defaultValue: string) =>
      this.context.dialogService.input({
        title: this.context.labels.draftMode,
        message,
        value: defaultValue,
        primaryButton: this.context.labels.editorModalConfirm,
        cancelButton: this.context.labels.editorModalCancel,
      }).then(result => result.value ?? null),
  });

  private readonly handleInsertCitation = createDraftEditorCommandAction(
    'insertCitation',
    this.createCommandContext,
  );

  private readonly handleInsertFigure = createDraftEditorCommandAction(
    'insertFigure',
    this.createCommandContext,
  );

  private readonly handleInsertFigureRef = createDraftEditorCommandAction(
    'insertFigureRef',
    this.createCommandContext,
  );

  private toEditorProps() {
		const input = this.input;
		if (!input) {
			throw new Error('Draft editor pane requires an input before creating editor props.');
		}
    const { labels } = this.context;
    return {
      contextMenuService: this.context.contextMenuService,
      contextViewProvider: this.context.contextViewProvider,
      document: input.document,
      placeholder: labels.draftBodyPlaceholder,
      statusLabels: {
        blockFigure: labels.status.blockFigure,
      },
      labels: {
        toolbarMore: labels.toolbarMore,
        textGroup: labels.textGroup,
        formatGroup: labels.formatGroup,
        insertGroup: labels.insertGroup,
        historyGroup: labels.historyGroup,
        paragraph: labels.paragraph,
        heading1: labels.heading1,
        heading2: labels.heading2,
        heading3: labels.heading3,
        bold: labels.bold,
        italic: labels.italic,
        underline: labels.underline,
        fontFamily: labels.fontFamily,
        fontSize: labels.fontSize,
        defaultTextStyle: labels.defaultTextStyle,
        alignLeft: labels.alignLeft,
        alignCenter: labels.alignCenter,
        alignRight: labels.alignRight,
        clearInlineStyles: labels.clearInlineStyles,
        bulletList: labels.bulletList,
        orderedList: labels.orderedList,
        blockquote: labels.blockquote,
        undo: labels.undo,
        redo: labels.redo,
        insertCitation: labels.insertCitation,
        insertFigure: labels.insertFigure,
        insertFigureRef: labels.insertFigureRef,
        citationPrompt: labels.citationPrompt,
        figureUrlPrompt: labels.figureUrlPrompt,
        figureCaptionPrompt: labels.figureCaptionPrompt,
        figureRefPrompt: labels.figureRefPrompt,
        fontFamilyPrompt: labels.fontFamilyPrompt,
        fontSizePrompt: labels.fontSizePrompt,
      },
      onInsertCitation: this.handleInsertCitation,
      onInsertFigure: this.handleInsertFigure,
      onInsertFigureRef: this.handleInsertFigureRef,
      onDocumentChange: (value: WritingEditorDocument) => input.setDocument(value),
      onStatusChange: (status: DraftEditorStatusState) => {
        this.runtimeState = createDraftEditorPaneState(this.context.labels, status);
        this.runtimeStateEmitter.fire(this.runtimeState);
      },
    };
  }

	private getEditor(): ProseMirrorEditor {
		if (!this.editor) {
			throw new Error('Draft editor pane has no active input.');
		}
		return this.editor;
	}
}

export function createDraftEditorPane(context: DraftEditorPaneContext) {
  return new DraftEditorPane(context);
}

export default DraftEditorPane;
