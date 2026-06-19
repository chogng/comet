import type {
  EditorWorkspaceDraftTab,
  WritingEditorDocument,
} from 'ls/workbench/browser/parts/editor/editorModel';
import { getLocaleMessages } from 'language/i18n';
import { isDraftEditorCommandEnabled } from 'ls/editor/browser/text/editorCommandRegistry';
import type { DraftEditorStatusState } from 'ls/editor/browser/text/draftEditorStatusState';
import { ProseMirrorEditor } from 'ls/editor/browser/text/editor';
import { localeService } from 'ls/workbench/services/localization/browser/localeService';
import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import { EditorPane } from 'ls/workbench/browser/parts/editor/panes/editorPane';
import { createDraftEditorCommandAction } from 'ls/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { DraftEditorCommandId } from 'ls/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { DraftEditorSurfaceActionId } from 'ls/workbench/browser/parts/editor/activeDraftEditorCommandExecutor';
import type { WritingEditorSurfaceViewState } from 'ls/editor/browser/text/editor';

import { showWorkbenchTextInputModal } from 'ls/workbench/browser/workbenchEditorModals';

export type DraftEditorPaneProps = {
  labels: EditorPartLabels;
  draftTab: EditorWorkspaceDraftTab;
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
    this.element.className = 'editor-draft-pane';
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
      showWorkbenchTextInputModal({
        title: this.props.labels.draftMode,
        label: message,
        defaultValue,
        ui: getLocaleMessages(localeService.getLocale()),
      }),
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
