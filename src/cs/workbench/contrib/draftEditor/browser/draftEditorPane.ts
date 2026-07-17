/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from 'cs/base/browser/dom';
import {
	isDraftEditorCommandEnabled,
	type DraftEditorCommandId,
} from 'cs/editor/browser/text/editorCommandRegistry';
import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import { ProseMirrorEditor } from 'cs/editor/browser/text/editor';
import { EditorPane } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createDraftEditorCommandAction } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import type { DraftEditorSurfaceActionId } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import type { WritingEditorSurfaceViewState } from 'cs/editor/browser/text/editor';
import { IContextMenuService, IContextViewService } from 'cs/platform/contextview/browser/contextView';
import { IDialogService } from 'cs/workbench/services/dialogs/common/dialogService';
import type { WritingEditorDocument } from 'cs/editor/common/writingEditorDocument';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { Emitter, type Event } from 'cs/base/common/event';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import { createDraftEditorPaneState } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPaneState';
import { DisposableStore, MutableDisposable, toDisposable } from 'cs/base/common/lifecycle';
import type { DraftEditorSelectionSnapshot } from 'cs/workbench/contrib/draftEditor/common/draftEditorInput';
import type { CancellationToken } from 'cs/base/common/cancellation';
import type { IEditorOpenContext, IEditorOptions } from 'cs/workbench/common/editor';
import { IWorkbenchLanguageService } from 'cs/workbench/services/language/common/languageService';
import { IWorkbenchLocaleService } from 'cs/workbench/services/localization/common/locale';
import type { LocaleMessages } from 'language/locales';
import {
	IEditorDraftStyleService,
	type IEditorDraftStyleService as EditorDraftStyleService,
} from 'cs/editor/browser/services/editorDraftStyleService';

export interface DraftEditorPaneInput extends EditorInput {
  readonly document: WritingEditorDocument;
	readonly onDidChangeDocument: Event<WritingEditorDocument>;
  setDocument(value: WritingEditorDocument): void;
	setPaneSelectionSnapshot(selection: DraftEditorSelectionSnapshot | null): void;
	clearPaneSelectionSnapshot(): void;
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

function createDraftEditorPaneLabels(ui: LocaleMessages): DraftEditorPaneLabels {
	return {
		toolbarMore: ui.agentbarToolbarMore,
		draftBodyPlaceholder: ui.editorDraftBodyPlaceholder,
		draftMode: ui.editorDraftMode,
		editorModalConfirm: ui.editorModalConfirm,
		editorModalCancel: ui.editorModalCancel,
		textGroup: ui.editorRibbonText,
		formatGroup: ui.editorRibbonFormat,
		insertGroup: ui.editorRibbonInsert,
		historyGroup: ui.editorRibbonHistory,
		paragraph: ui.editorParagraph,
		heading1: ui.editorHeading1,
		heading2: ui.editorHeading2,
		heading3: ui.editorHeading3,
		bold: ui.editorBold,
		italic: ui.editorItalic,
		underline: ui.editorUnderline,
		fontFamily: ui.editorFontFamily,
		fontSize: ui.editorFontSize,
		defaultTextStyle: ui.editorDefaultTextStyle,
		alignLeft: ui.editorAlignLeft,
		alignCenter: ui.editorAlignCenter,
		alignRight: ui.editorAlignRight,
		clearInlineStyles: ui.editorClearInlineStyles,
		bulletList: ui.editorBulletList,
		orderedList: ui.editorOrderedList,
		blockquote: ui.editorBlockquote,
		undo: ui.editorUndo,
		redo: ui.editorRedo,
		insertCitation: ui.editorInsertCitation,
		insertFigure: ui.editorInsertFigure,
		insertFigureRef: ui.editorInsertFigureRef,
		citationPrompt: ui.editorCitationPrompt,
		figureUrlPrompt: ui.editorFigureUrlPrompt,
		figureCaptionPrompt: ui.editorFigureCaptionPrompt,
		figureRefPrompt: ui.editorFigureRefPrompt,
		fontFamilyPrompt: ui.editorFontFamilyPrompt,
		fontSizePrompt: ui.editorFontSizePrompt,
		status: {
			statusbarAriaLabel: ui.editorStatusbarAriaLabel,
			words: ui.editorStatusWords,
			characters: ui.editorStatusCharacters,
			paragraphs: ui.editorStatusParagraphs,
			selection: ui.editorStatusSelection,
			block: ui.editorStatusBlock,
			line: ui.editorStatusLine,
			column: ui.editorStatusColumn,
			blockFigure: ui.editorStatusFigure,
			ready: ui.statusReady,
		},
	};
}

export class DraftEditorPane extends EditorPane<
  DraftEditorPaneInput,
  WritingEditorSurfaceViewState
> {
	private readonly disposables = new DisposableStore();
	private readonly inputListener = this.disposables.add(new MutableDisposable());
  private input: DraftEditorPaneInput | undefined;
	private readonly element = $<HTMLDivElement>('div.comet-editor-draft-pane');
  private editor: ProseMirrorEditor | undefined;
	private editorStatus: DraftEditorStatusState | undefined;
  private readonly runtimeStateEmitter = new Emitter<EditorPaneRuntimeState>();
  override readonly onDidChangeRuntimeState = this.runtimeStateEmitter.event;

	constructor(
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IContextViewService private readonly contextViewService: IContextViewService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkbenchLanguageService private readonly languageService: IWorkbenchLanguageService,
		@IWorkbenchLocaleService private readonly localeService: IWorkbenchLocaleService,
		@IEditorDraftStyleService private readonly editorDraftStyleService: EditorDraftStyleService,
	) {
    super();
		this.disposables.add(toDisposable(this.localeService.subscribe(() => {
			if (this.editor) {
				this.editor.setProps(this.toEditorProps());
			}
		})));
  }

  override getElement() {
    return this.element;
  }

  override getToolbarElement() {
    return this.getEditor().getToolbarElement();
  }

  override getRuntimeState() {
		return this.editorStatus
			? createDraftEditorPaneState(this.labels, this.editorStatus)
			: undefined;
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

  override setInput(
		input: DraftEditorPaneInput,
		_options: IEditorOptions | undefined,
		_context: IEditorOpenContext,
		_token: CancellationToken,
	) {
		this.input?.clearPaneSelectionSnapshot();
		input.clearPaneSelectionSnapshot();
    this.input = input;
		this.inputListener.value = input.onDidChangeDocument(() => {
			if (this.input === input && this.editor) {
				this.editor.setProps(this.toEditorProps());
				this.updateSelectionSnapshot(input);
			}
		});
		if (this.editor) {
			this.editor.setProps(this.toEditorProps());
			this.updateSelectionSnapshot(input);
			return;
		}
		this.editor = new ProseMirrorEditor(this.toEditorProps(), this.editorDraftStyleService);
		this.element.append(this.editor.getElement());
		this.updateSelectionSnapshot(input);
  }

	override clearInput() {
		this.inputListener.clear();
		this.input?.clearPaneSelectionSnapshot();
		this.input = undefined;
		this.editor?.dispose();
		this.editor = undefined;
		this.editorStatus = undefined;
		this.element.replaceChildren();
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
		this.clearInput();
		this.disposables.dispose();
    this.runtimeStateEmitter.dispose();
  }

  private createCommandContext = () => ({
    editor: this.getEditor(),
    labels: {
			citationPrompt: this.labels.citationPrompt,
			figureUrlPrompt: this.labels.figureUrlPrompt,
			figureCaptionPrompt: this.labels.figureCaptionPrompt,
			figureRefPrompt: this.labels.figureRefPrompt,
    },
    prompt: (message: string, defaultValue: string) =>
			this.dialogService.input({
				title: this.labels.draftMode,
        message,
        value: defaultValue,
				primaryButton: this.labels.editorModalConfirm,
				cancelButton: this.labels.editorModalCancel,
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
		const labels = this.labels;
    return {
			contextMenuService: this.contextMenuService,
			contextViewProvider: this.contextViewService,
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
				this.updateSelectionSnapshot(input);
				this.editorStatus = status;
				this.runtimeStateEmitter.fire(createDraftEditorPaneState(this.labels, status));
      },
    };
  }

	private updateSelectionSnapshot(input: DraftEditorPaneInput): void {
		if (this.input !== input || !this.editor) {
			return;
		}
		const selection = this.editor.getStableSelectionTarget();
		input.setPaneSelectionSnapshot(selection ? {
			blockId: selection.blockId,
			startOffset: selection.startOffset,
			endOffset: selection.endOffset,
		} : null);
	}

	private getEditor(): ProseMirrorEditor {
		if (!this.editor) {
			throw new Error('Draft editor pane has no active input.');
		}
		return this.editor;
	}

	private get labels(): DraftEditorPaneLabels {
		return createDraftEditorPaneLabels(
			this.languageService.getLocaleMessages(this.localeService.getLocale()),
		);
	}
}
