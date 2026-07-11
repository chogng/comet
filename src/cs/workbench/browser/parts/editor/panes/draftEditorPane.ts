import type {
  EditorWorkspaceDraftTab,
  WritingEditorDocument,
} from 'cs/workbench/browser/parts/editor/editorModel';
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

export type DraftEditorPaneProps = DropdownContextServices & {
  labels: EditorPartLabels;
  draftTab: EditorWorkspaceDraftTab;
  dialogService: IDialogService;
  onDraftDocumentChange: (value: WritingEditorDocument) => void;
  onStatusChange?: (status: DraftEditorStatusState) => void;
};

export class DraftEditorPane extends EditorPane<
  DraftEditorPaneProps,
  WritingEditorSurfaceViewState
> {
  private props: DraftEditorPaneProps;
  private readonly element = document.createElement('div');
  private readonly editor: ProseMirrorEditor;

  constructor(props: DraftEditorPaneProps) {
    super();
    this.props = props;
    this.element.className = 'comet-editor-draft-pane';
    this.editor = new ProseMirrorEditor(this.toEditorProps(props));
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

  override setProps(props: DraftEditorPaneProps) {
    this.props = props;
    this.editor.setProps(this.toEditorProps(props));
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
      citationPrompt: this.props.labels.citationPrompt,
      figureUrlPrompt: this.props.labels.figureUrlPrompt,
      figureCaptionPrompt: this.props.labels.figureCaptionPrompt,
      figureRefPrompt: this.props.labels.figureRefPrompt,
    },
    prompt: (message: string, defaultValue: string) =>
      this.props.dialogService.input({
        title: this.props.labels.draftMode,
        message,
        value: defaultValue,
        primaryButton: this.props.labels.editorModalConfirm,
        cancelButton: this.props.labels.editorModalCancel,
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

  private toEditorProps(props: DraftEditorPaneProps) {
    return {
      contextMenuService: props.contextMenuService,
      contextViewProvider: props.contextViewProvider,
      document: props.draftTab.document,
      placeholder: props.labels.draftBodyPlaceholder,
      statusLabels: {
        blockFigure: props.labels.status.blockFigure,
      },
      labels: {
        toolbarMore: props.labels.toolbarMore,
        textGroup: props.labels.textGroup,
        formatGroup: props.labels.formatGroup,
        insertGroup: props.labels.insertGroup,
        historyGroup: props.labels.historyGroup,
        paragraph: props.labels.paragraph,
        heading1: props.labels.heading1,
        heading2: props.labels.heading2,
        heading3: props.labels.heading3,
        bold: props.labels.bold,
        italic: props.labels.italic,
        underline: props.labels.underline,
        fontFamily: props.labels.fontFamily,
        fontSize: props.labels.fontSize,
        defaultTextStyle: props.labels.defaultTextStyle,
        alignLeft: props.labels.alignLeft,
        alignCenter: props.labels.alignCenter,
        alignRight: props.labels.alignRight,
        clearInlineStyles: props.labels.clearInlineStyles,
        bulletList: props.labels.bulletList,
        orderedList: props.labels.orderedList,
        blockquote: props.labels.blockquote,
        undo: props.labels.undo,
        redo: props.labels.redo,
        insertCitation: props.labels.insertCitation,
        insertFigure: props.labels.insertFigure,
        insertFigureRef: props.labels.insertFigureRef,
        citationPrompt: props.labels.citationPrompt,
        figureUrlPrompt: props.labels.figureUrlPrompt,
        figureCaptionPrompt: props.labels.figureCaptionPrompt,
        figureRefPrompt: props.labels.figureRefPrompt,
        fontFamilyPrompt: props.labels.fontFamilyPrompt,
        fontSizePrompt: props.labels.fontSizePrompt,
      },
      onInsertCitation: this.handleInsertCitation,
      onInsertFigure: this.handleInsertFigure,
      onInsertFigureRef: this.handleInsertFigureRef,
      onDocumentChange: props.onDraftDocumentChange,
      onStatusChange: props.onStatusChange,
    };
  }
}

export function createDraftEditorPane(props: DraftEditorPaneProps) {
  return new DraftEditorPane(props);
}

export default DraftEditorPane;
