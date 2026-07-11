import { isDraftEditorCommandEnabled } from 'cs/editor/browser/text/editorCommandRegistry';
import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import { ProseMirrorEditor } from 'cs/editor/browser/text/editor';
import type { EditorPartLabels } from 'cs/workbench/browser/parts/editor/editorPartView';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createDraftEditorCommandAction } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { DraftEditorSurfaceActionId } from 'cs/workbench/browser/parts/editor/activeDraftEditorCommandExecutor';
import type { WritingEditorSurfaceViewState } from 'cs/editor/browser/text/editor';
import type { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export interface DraftEditorPaneInput extends EditorInput {
  readonly document: WritingEditorDocument;
  setDocument(value: WritingEditorDocument): void;
}

export type DraftEditorPaneContext = DropdownContextServices & {
  labels: EditorPartLabels;
  dialogService: IDialogService;
  onStatusChange?: (input: DraftEditorPaneInput, status: DraftEditorStatusState) => void;
};

export class DraftEditorPane extends EditorPane<
  DraftEditorPaneInput,
  WritingEditorSurfaceViewState
> {
  private input: DraftEditorPaneInput;
  private readonly element = document.createElement('div');
  private readonly editor: ProseMirrorEditor;

  constructor(input: DraftEditorPaneInput, private readonly context: DraftEditorPaneContext) {
    super();
    this.input = input;
    this.element.className = 'comet-editor-draft-pane';
    this.editor = new ProseMirrorEditor(this.toEditorProps());
    this.element.append(this.editor.getElement());
  }

  override getElement() {
    return this.element;
  }

  override getToolbarElement() {
    return this.editor.getToolbarElement();
  }

  getStableSelectionTarget() {
    return this.editor.getStableSelectionTarget();
  }

  canExecuteCommand(commandId: DraftEditorCommandId) {
    return isDraftEditorCommandEnabled(commandId, {
      availableFigureIds: this.editor.getAvailableFigureIds(),
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
        return this.editor.undo();
      case 'redo':
        return this.editor.redo();
    }
  }

  override setInput(input: DraftEditorPaneInput) {
    this.input = input;
    this.editor.setProps(this.toEditorProps());
  }

  override focus() {
    this.editor.focus();
  }

  override getViewState() {
    return this.editor.getViewState();
  }

  override restoreViewState(viewState: WritingEditorSurfaceViewState | undefined) {
    this.editor.restoreViewState(viewState);
  }

  override dispose() {
    this.editor.dispose();
    this.element.replaceChildren();
  }

  private createCommandContext = () => ({
    editor: this.editor,
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
        this.context.onStatusChange?.(input, status);
      },
    };
  }
}

export function createDraftEditorPane(input: DraftEditorPaneInput, context: DraftEditorPaneContext) {
  return new DraftEditorPane(input, context);
}

export default DraftEditorPane;
