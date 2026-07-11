import type { ResolvedPos } from 'prosemirror-model';
import { EditorState, TextSelection } from 'prosemirror-state';
import { baseKeymap } from 'prosemirror-commands';
import { history } from 'prosemirror-history';
import { keymap } from 'prosemirror-keymap';
import { EditorView } from 'prosemirror-view';
import { gapCursor } from 'prosemirror-gapcursor';
import { dropCursor } from 'prosemirror-dropcursor';
import { createDraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';
import { clearFontFamilyCommand, clearFontSizeCommand, clearInlineStylesCommand, getWritingEditorToolbarState, insertCitationCommand, insertFigureCommand, insertFigureRefCommand, insertPlainTextCommand, redoCommand, runWritingEditorCommand, setFontFamilyCommand, setFontSizeCommand, setParagraphCommand, setTextAlignCommand, toggleBlockquoteCommand, toggleBoldCommand, toggleBulletListCommand, toggleHeadingCommand, toggleItalicCommand, toggleOrderedListCommand, toggleUnderlineCommand, undoCommand } from 'cs/editor/browser/text/commands';
import type { InsertFigurePayload, WritingEditorCommand, WritingEditorToolbarState } from 'cs/editor/browser/text/commands';
import { createWritingEditorKeymapBindings } from 'cs/editor/browser/text/editorCommandRegistry';
import { editorDraftStyleService } from 'cs/editor/browser/text/editorDraftStyleService';
import { collectWritingEditorDerivedLabels, createWritingEditorDocumentModel, findWritingEditorNodeByBlockId, getWritingEditorNodeText, getWritingEditorTextUnitKind, isWritingEditorPlainTextEditableNode, normalizeWritingEditorDocument, syncWritingEditorDerivedLabels } from 'cs/editor/common/writingEditorDocument';
import type { WritingEditorDocument, WritingEditorStableSelectionTarget, WritingEditorTextUnitKind } from 'cs/editor/common/writingEditorDocument';
import { $ } from 'cs/base/browser/dom';

import {
  createWritingEditorDocumentIdentityPlugin,
  createWritingEditorInputRules,
  createWritingEditorPlaceholderPlugin,
  updateWritingEditorPlaceholder,
  writingEditorSchema,
} from 'cs/editor/browser/text/schema';
import { DraftEditorToolbar } from 'cs/editor/browser/text/editorToolbar';
import { FigureNodeView } from 'cs/editor/browser/text/figureNodeView';
import { WritingEditorInputSession } from 'cs/editor/browser/text/input';
import { resolveWritingEditorSurfaceSyncPlan } from 'cs/editor/browser/text/sync';
import { DomScrollableElement } from 'cs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'cs/base/browser/ui/scrollbar/scrollableElementOptions';
import 'cs/editor/browser/text/media/editor.css';

export type WritingEditorSurfaceLabels = {
  toolbarMore: string;
  textGroup: string;
  formatGroup: string;
  insertGroup: string;
  historyGroup: string;
  paragraph: string;
  heading1: string;
  heading2: string;
  heading3: string;
  bold: string;
  italic: string;
  underline: string;
  fontFamily: string;
  fontSize: string;
  defaultTextStyle: string;
  alignLeft: string;
  alignCenter: string;
  alignRight: string;
  clearInlineStyles: string;
  bulletList: string;
  orderedList: string;
  blockquote: string;
  undo: string;
  redo: string;
  insertCitation: string;
  insertFigure: string;
  insertFigureRef: string;
  citationPrompt: string;
  figureUrlPrompt: string;
  figureCaptionPrompt: string;
  figureRefPrompt: string;
  fontFamilyPrompt: string;
  fontSizePrompt: string;
};

export type WritingEditorSurfaceHandle = {
  focus: () => void;
  insertPlainText: (text: string) => boolean;
  insertCitation: (citationIds: string[]) => boolean;
  insertFigure: (payload: InsertFigurePayload) => boolean;
  insertFigureRef: (targetId: string) => boolean;
  getAvailableFigureIds: () => readonly string[];
  getStableSelectionTarget: () => WritingEditorStableSelectionTarget | null;
};

export type WritingEditorSurfaceViewState = {
  scrollPosition: {
    scrollLeft: number;
    scrollTop: number;
  };
  selectionTarget: WritingEditorStableSelectionTarget | null;
  shouldFocus: boolean;
};

type WritingEditorSurfaceStatusLabels = {
  blockFigure: string;
};

export type WritingEditorSurfaceProps = DropdownContextServices & {
  document: WritingEditorDocument;
  placeholder: string;
  labels: WritingEditorSurfaceLabels;
  statusLabels: WritingEditorSurfaceStatusLabels;
  onInsertCitation: () => void;
  onInsertFigure: () => void;
  onInsertFigureRef: (availableFigureIds: readonly string[]) => void;
  onDocumentChange: (document: WritingEditorDocument) => void;
  onStatusChange?: (status: DraftEditorStatusState) => void;
};

type WritingEditorSurfaceSnapshot = {
  toolbarState: WritingEditorToolbarState;
};

type ResolvedSelectionTextUnit = {
  blockId: string;
  kind: WritingEditorTextUnitKind;
  node: EditorState['selection']['$from']['parent'];
  depth: number;
};

const EMPTY_TOOLBAR_STATE: WritingEditorToolbarState = {
  isParagraphActive: true,
  activeHeadingLevel: null,
  isBoldActive: false,
  isItalicActive: false,
  isUnderlineActive: false,
  fontFamily: null,
  fontSize: null,
  textAlign: 'left',
  isBulletListActive: false,
  isOrderedListActive: false,
  isBlockquoteActive: false,
  canUndo: false,
  canRedo: false,
  availableFigureIds: [],
};

function createWritingEditorState(document: WritingEditorDocument, placeholder: string) {
  const listItemType = writingEditorSchema.nodes.list_item;

  return EditorState.create({
    schema: writingEditorSchema,
    doc: writingEditorSchema.nodeFromJSON(normalizeWritingEditorDocument(document)),
    plugins: [
      createWritingEditorDocumentIdentityPlugin(),
      createWritingEditorInputRules(),
      history(),
      keymap(createWritingEditorKeymapBindings(listItemType)),
      keymap(baseKeymap),
      gapCursor(),
      dropCursor(),
      createWritingEditorPlaceholderPlugin(placeholder),
    ],
  });
}

function resolveSelectionTextUnit($pos: ResolvedPos): ResolvedSelectionTextUnit | null {
  for (let depth = $pos.depth; depth >= 0; depth -= 1) {
    const node = $pos.node(depth);
    const kind = getWritingEditorTextUnitKind(node);
    const blockId = (node.attrs as { blockId?: unknown } | null | undefined)?.blockId;
    if (kind && typeof blockId === 'string' && blockId.trim()) {
      return {
        blockId,
        kind,
        node,
        depth,
      };
    }
  }

  return null;
}

function findSelectionTextUnitPosition(
  state: EditorState,
  target: Pick<WritingEditorStableSelectionTarget, 'blockId' | 'kind'>,
): { pos: number; nodeSize: number } | null {
  let resolvedPosition: { pos: number; nodeSize: number } | null = null;

  state.doc.descendants((node, pos) => {
    const kind = getWritingEditorTextUnitKind(node);
    const blockId = (node.attrs as { blockId?: unknown } | null | undefined)?.blockId;
    if (kind === target.kind && blockId === target.blockId) {
      resolvedPosition = {
        pos,
        nodeSize: node.content.size,
      };
      return false;
    }

    return true;
  });

  return resolvedPosition;
}

function createSelectionFromStableTarget(
  state: EditorState,
  target: WritingEditorStableSelectionTarget,
) {
  const documentModel = createWritingEditorDocumentModel(
    state.doc.toJSON() as WritingEditorDocument,
  );
  const textModel = documentModel.getTextModel(target.blockId);
  const textUnitPosition = findSelectionTextUnitPosition(state, target);
  if (!textModel || !textUnitPosition) {
    return null;
  }

const offsets = textModel.getOffsetsForRange(target.range);
  const contentStart = textUnitPosition.pos + 1;
  const contentEnd = contentStart + textUnitPosition.nodeSize;
  const from = Math.min(Math.max(contentStart + offsets.startOffset, contentStart), contentEnd);
  const to = Math.min(Math.max(contentStart + offsets.endOffset, contentStart), contentEnd);

  return TextSelection.create(state.doc, from, to);
}

function createNormalizedDocumentKey(document: WritingEditorDocument) {
  return JSON.stringify(normalizeWritingEditorDocument(document));
}

function areStringArraysEqual(previous: readonly string[], next: readonly string[]) {
  return (
    previous.length === next.length &&
    previous.every((value, index) => value === next[index])
  );
}

function areToolbarStatesEqual(
  previous: WritingEditorToolbarState,
  next: WritingEditorToolbarState,
) {
  return (
    previous.isParagraphActive === next.isParagraphActive &&
    previous.activeHeadingLevel === next.activeHeadingLevel &&
    previous.isBoldActive === next.isBoldActive &&
    previous.isItalicActive === next.isItalicActive &&
    previous.isUnderlineActive === next.isUnderlineActive &&
    previous.fontFamily === next.fontFamily &&
    previous.fontSize === next.fontSize &&
    previous.textAlign === next.textAlign &&
    previous.isBulletListActive === next.isBulletListActive &&
    previous.isOrderedListActive === next.isOrderedListActive &&
    previous.isBlockquoteActive === next.isBlockquoteActive &&
    previous.canUndo === next.canUndo &&
    previous.canRedo === next.canRedo &&
    areStringArraysEqual(previous.availableFigureIds, next.availableFigureIds)
  );
}

function areSurfaceLabelsEqual(
  previous: WritingEditorSurfaceLabels,
  next: WritingEditorSurfaceLabels,
) {
  return (
    previous.toolbarMore === next.toolbarMore &&
    previous.textGroup === next.textGroup &&
    previous.formatGroup === next.formatGroup &&
    previous.insertGroup === next.insertGroup &&
    previous.historyGroup === next.historyGroup &&
    previous.paragraph === next.paragraph &&
    previous.heading1 === next.heading1 &&
    previous.heading2 === next.heading2 &&
    previous.heading3 === next.heading3 &&
    previous.bold === next.bold &&
    previous.italic === next.italic &&
    previous.underline === next.underline &&
    previous.fontFamily === next.fontFamily &&
    previous.fontSize === next.fontSize &&
    previous.defaultTextStyle === next.defaultTextStyle &&
    previous.alignLeft === next.alignLeft &&
    previous.alignCenter === next.alignCenter &&
    previous.alignRight === next.alignRight &&
    previous.clearInlineStyles === next.clearInlineStyles &&
    previous.bulletList === next.bulletList &&
    previous.orderedList === next.orderedList &&
    previous.blockquote === next.blockquote &&
    previous.undo === next.undo &&
    previous.redo === next.redo &&
    previous.insertCitation === next.insertCitation &&
    previous.insertFigure === next.insertFigure &&
    previous.insertFigureRef === next.insertFigureRef &&
    previous.citationPrompt === next.citationPrompt &&
    previous.figureUrlPrompt === next.figureUrlPrompt &&
    previous.figureCaptionPrompt === next.figureCaptionPrompt &&
    previous.figureRefPrompt === next.figureRefPrompt &&
    previous.fontFamilyPrompt === next.fontFamilyPrompt &&
    previous.fontSizePrompt === next.fontSizePrompt
  );
}

export class ProseMirrorEditor implements WritingEditorSurfaceHandle {
  private props: WritingEditorSurfaceProps;
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-pm-editor-surface');
  private readonly hostWrapperElement = $<HTMLElementTagNameMap['div']>('div.comet-pm-editor-host');
  private readonly editorRootElement = $<HTMLElementTagNameMap['div']>('div.comet-pm-editor-root');
  private readonly scrollableElement: DomScrollableElement;
  private readonly toolbar: DraftEditorToolbar;
  private readonly disposeDraftStyleServiceSubscription: () => void;
  private view: EditorView | null = null;
  // The workbench can rerender before the writing model echoes the latest local document back.
  private readonly inputSession = new WritingEditorInputSession({
    isViewComposing: () => Boolean(this.view?.composing),
    hasViewFocus: () => Boolean(this.view?.hasFocus()),
    focusView: () => {
      this.view?.focus();
    },
  });
  private snapshot: WritingEditorSurfaceSnapshot = {
    toolbarState: EMPTY_TOOLBAR_STATE,
  };

  constructor(props: WritingEditorSurfaceProps) {
    this.props = props;
    this.toolbar = new DraftEditorToolbar(this.createToolbarProps());
    this.applyDraftStyleSnapshot();
    this.disposeDraftStyleServiceSubscription = editorDraftStyleService.subscribe(
      this.handleDraftStyleServiceChange,
    );
    this.hostWrapperElement.append(this.editorRootElement);
    this.scrollableElement = new DomScrollableElement(this.hostWrapperElement, {
      className: 'comet-pm-editor-scrollable',
      useShadows: true,
      horizontal: ScrollbarVisibility.Hidden,
      vertical: ScrollbarVisibility.Auto,
      verticalScrollbarSize: 10,
    });
    this.element.append(this.scrollableElement.getDomNode());
    this.createView();
  }

  getElement() {
    return this.element;
  }

  getToolbarElement() {
    return this.toolbar.getElement();
  }

  setProps(props: WritingEditorSurfaceProps) {
    const previousProps = this.props;
    this.props = props;

    if (!this.view) {
      this.createView();
      return;
    }

const currentDocumentKey = createNormalizedDocumentKey(
      this.view.state.doc.toJSON() as WritingEditorDocument,
    );
    const nextDocumentKey = createNormalizedDocumentKey(props.document);
    const shouldRefreshPlaceholder = previousProps.placeholder !== props.placeholder;
    const shouldRefreshToolbarChrome = !areSurfaceLabelsEqual(
      previousProps.labels,
      props.labels,
    );
    const shouldRestoreFocus =
      this.view.hasFocus() || this.inputSession.shouldKeepFocus();
    const syncPlan = resolveWritingEditorSurfaceSyncPlan({
      currentDocumentKey,
      nextDocumentKey,
      pendingDocumentSyncKey: this.inputSession.getPendingDocumentSyncKey(),
      isComposing: this.view.composing,
      shouldRefreshPlaceholder,
      shouldRefreshToolbarChrome,
    });

    this.applySurfaceSyncPlan(syncPlan, props, shouldRestoreFocus);
  }

  dispose() {
    this.disposeDraftStyleServiceSubscription();
    this.inputSession.dispose();
    this.destroyView();
    this.toolbar.dispose();
    this.scrollableElement.dispose();
    this.element.replaceChildren();
  }

  focus() {
    this.view?.focus();
  }

  getViewState(): WritingEditorSurfaceViewState | undefined {
    return {
      scrollPosition: this.scrollableElement.getScrollPosition(),
      selectionTarget: this.getStableSelectionTarget(),
      shouldFocus: Boolean(this.view?.hasFocus()),
    };
  }

  restoreViewState(viewState: WritingEditorSurfaceViewState | undefined) {
    if (!this.view || !viewState) {
      return;
    }

    if (viewState.selectionTarget) {
      const selection = createSelectionFromStableTarget(
        this.view.state,
        viewState.selectionTarget,
      );
      if (selection) {
        this.view.dispatch(this.view.state.tr.setSelection(selection));
      }
    }

    this.refreshScrollableDimensions();
    this.scrollableElement.setScrollPosition(viewState.scrollPosition);

    if (viewState.shouldFocus) {
      this.focus();
    }
  }

  insertPlainText(text: string) {
    return runWritingEditorCommand(this.view, insertPlainTextCommand(text));
  }

  insertCitation(citationIds: string[]) {
    return runWritingEditorCommand(this.view, insertCitationCommand(citationIds));
  }

  insertFigure(payload: InsertFigurePayload) {
    return runWritingEditorCommand(this.view, insertFigureCommand(payload));
  }

  insertFigureRef(targetId: string) {
    return runWritingEditorCommand(this.view, insertFigureRefCommand(targetId));
  }

  getAvailableFigureIds() {
    return this.snapshot.toolbarState.availableFigureIds;
  }

  getStableSelectionTarget() {
    if (!this.view) {
      return null;
    }

const { state } = this.view;
    if (state.selection.ranges.length !== 1) {
      return null;
    }

const fromUnit = resolveSelectionTextUnit(state.selection.$from);
    const toUnit = resolveSelectionTextUnit(state.selection.$to);
    if (!fromUnit || !toUnit || fromUnit.blockId !== toUnit.blockId) {
      return null;
    }

const documentValue = state.doc.toJSON() as WritingEditorDocument;
    const documentModel = createWritingEditorDocumentModel(documentValue);
    const textModel = documentModel.getTextModel(fromUnit.blockId);
    if (!textModel) {
      return null;
    }

const targetNode = findWritingEditorNodeByBlockId(documentValue, fromUnit.blockId);
    if (!targetNode) {
      return null;
    }

const derivedLabels = collectWritingEditorDerivedLabels(state.doc);

    const selectionStartOffset = getWritingEditorNodeText(
      fromUnit.node,
      derivedLabels,
      0,
      state.selection.from - state.selection.$from.start(fromUnit.depth),
    ).length;
    const selectionEndOffset = getWritingEditorNodeText(
      toUnit.node,
      derivedLabels,
      0,
      state.selection.to - state.selection.$to.start(toUnit.depth),
    ).length;

    const startPosition = textModel.getPositionAt(selectionStartOffset);
    const endPosition = textModel.getPositionAt(selectionEndOffset);
    const range = textModel.validateRange({
      startLineNumber: startPosition.lineNumber,
      startColumn: startPosition.column,
      endLineNumber: endPosition.lineNumber,
      endColumn: endPosition.column,
    });
    const offsets = textModel.getOffsetsForRange(range);

    return {
      blockId: fromUnit.blockId,
      kind: fromUnit.kind,
      range,
      startOffset: offsets.startOffset,
      endOffset: offsets.endOffset,
      selectedText: textModel.getValue().slice(offsets.startOffset, offsets.endOffset),
      blockText: textModel.getValue(),
      isCollapsed: state.selection.empty,
      isPlainTextEditable: isWritingEditorPlainTextEditableNode(targetNode),
    };
  }

  setParagraph = () => this.runCommand(setParagraphCommand());
  toggleHeading = (level: number) => this.runCommand(toggleHeadingCommand(level));
  toggleBold = () => this.runCommand(toggleBoldCommand());
  toggleItalic = () => this.runCommand(toggleItalicCommand());
  toggleUnderline = () => this.runCommand(toggleUnderlineCommand());
  setFontFamily = (fontFamily: string | null) =>
    this.runCommand(fontFamily ? setFontFamilyCommand(fontFamily) : clearFontFamilyCommand());
  setFontSize = (fontSize: string | null) =>
    this.runCommand(fontSize ? setFontSizeCommand(fontSize) : clearFontSizeCommand());
  setTextAlign = (textAlign: 'left' | 'center' | 'right') =>
    this.runCommand(setTextAlignCommand(textAlign));
  clearInlineStyles = () => this.runCommand(clearInlineStylesCommand());
  toggleBulletList = () => this.runCommand(toggleBulletListCommand());
  toggleOrderedList = () => this.runCommand(toggleOrderedListCommand());
  toggleBlockquote = () => this.runCommand(toggleBlockquoteCommand());
  undo = () => this.runCommand(undoCommand());
  redo = () => this.runCommand(redoCommand());

  private createView() {
    this.destroyView();

    let editorView: EditorView;
    editorView = new EditorView(
      this.editorRootElement,
      {
        state: createWritingEditorState(
          this.props.document,
          this.props.placeholder,
        ),
        nodeViews: {
          figure: (node, view, getPos) => new FigureNodeView(node, view, getPos),
        },
        dispatchTransaction: (transaction) => {
          const nextState = editorView.state.apply(transaction);
          editorView.updateState(nextState);
          this.syncEditorViewState(nextState, transaction.docChanged);
          this.refreshScrollableDimensions();
        },
      },
    );

    this.view = editorView;
    this.view.dom.addEventListener('compositionstart', this.handleCompositionStart);
    this.view.dom.addEventListener('compositionend', this.handleCompositionEnd);
    this.view.dom.addEventListener('focus', this.handleFocus);
    this.view.dom.addEventListener('blur', this.handleBlur);
    this.syncEditorViewState(editorView.state, false);
    this.refreshScrollableDimensions();
  }

  private createToolbarProps() {
    return {
      contextMenuService: this.props.contextMenuService,
      contextViewProvider: this.props.contextViewProvider,
      labels: this.props.labels,
      toolbarState: this.snapshot.toolbarState,
      actions: {
        setParagraph: this.setParagraph,
        toggleHeading: this.toggleHeading,
        toggleBold: this.toggleBold,
        toggleItalic: this.toggleItalic,
        toggleUnderline: this.toggleUnderline,
        setFontFamily: this.setFontFamily,
        setFontSize: this.setFontSize,
        setTextAlign: this.setTextAlign,
        clearInlineStyles: this.clearInlineStyles,
        toggleBulletList: this.toggleBulletList,
        toggleOrderedList: this.toggleOrderedList,
        toggleBlockquote: this.toggleBlockquote,
        undo: this.undo,
        redo: this.redo,
        insertCitation: this.props.onInsertCitation,
        insertFigure: this.props.onInsertFigure,
        insertFigureRef: () =>
          this.props.onInsertFigureRef(this.snapshot.toolbarState.availableFigureIds),
      },
    };
  }

  private applyDraftStyleSnapshot() {
    const styleSnapshot = editorDraftStyleService.getSnapshot();
    const paragraphSpacingBeforePt =
      styleSnapshot.defaultBodyStyle.paragraphSpacingBeforePt;
    const paragraphSpacingAfterPt =
      styleSnapshot.defaultBodyStyle.paragraphSpacingAfterPt;
    const paragraphSpacingBetweenPt = Math.max(
      paragraphSpacingBeforePt,
      paragraphSpacingAfterPt,
    );
    this.editorRootElement.style.setProperty(
      '--cs-editor-default-color',
      styleSnapshot.defaultBodyStyle.color,
    );
    this.editorRootElement.style.setProperty(
      '--cs-editor-default-line-height',
      String(styleSnapshot.defaultBodyStyle.lineHeight),
    );
    this.editorRootElement.style.setProperty(
      '--cs-editor-default-font-family',
      styleSnapshot.defaultBodyStyle.fontFamilyValue,
    );
    this.editorRootElement.style.setProperty(
      '--cs-editor-default-font-size',
      styleSnapshot.defaultBodyStyle.fontSizeValue,
    );
    this.editorRootElement.style.setProperty(
      '--cs-editor-default-paragraph-spacing-before',
      `${paragraphSpacingBeforePt}pt`,
    );
    this.editorRootElement.style.setProperty(
      '--cs-editor-default-paragraph-spacing-after',
      `${paragraphSpacingAfterPt}pt`,
    );
    this.editorRootElement.style.setProperty(
      '--cs-editor-default-paragraph-spacing-between',
      `${paragraphSpacingBetweenPt}pt`,
    );
  }

  private runCommand(command: WritingEditorCommand) {
    return runWritingEditorCommand(this.view, command);
  }

  private destroyView() {
    this.inputSession.dispose();
    if (this.view) {
      this.view.dom.removeEventListener('compositionstart', this.handleCompositionStart);
      this.view.dom.removeEventListener('compositionend', this.handleCompositionEnd);
      this.view.dom.removeEventListener('focus', this.handleFocus);
      this.view.dom.removeEventListener('blur', this.handleBlur);
    }
    this.view?.destroy();
    this.view = null;
    this.snapshot = { toolbarState: EMPTY_TOOLBAR_STATE };
    this.editorRootElement.replaceChildren();
    this.toolbar.setProps(this.createToolbarProps());
    this.refreshScrollableDimensions();
  }

  private emitStatusChange(nextState: EditorState) {
    this.props.onStatusChange?.(
      createDraftEditorStatusState(nextState, {
        paragraph: this.props.labels.paragraph,
        heading1: this.props.labels.heading1,
        heading2: this.props.labels.heading2,
        heading3: this.props.labels.heading3,
        bulletList: this.props.labels.bulletList,
        orderedList: this.props.labels.orderedList,
        blockquote: this.props.labels.blockquote,
        blockFigure: this.props.statusLabels.blockFigure,
      }),
    );
  }

  private refreshToolbarSnapshot(nextState: EditorState) {
    const nextToolbarState = getWritingEditorToolbarState(nextState);
    if (areToolbarStatesEqual(this.snapshot.toolbarState, nextToolbarState)) {
      return;
    }

    this.snapshot = {
      toolbarState: nextToolbarState,
    };
    this.toolbar.setProps(this.createToolbarProps());
  }

  private syncEditorViewState(nextState: EditorState, emitDocumentChange: boolean) {
    if (!this.view) {
      return;
    }

const shouldRestoreFocus =
      this.view.hasFocus() || this.inputSession.shouldKeepFocus();
    syncWritingEditorDerivedLabels(this.view.dom, nextState.doc);
    if (emitDocumentChange) {
      const nextDocument = nextState.doc.toJSON() as WritingEditorDocument;
      if (this.view.composing) {
        this.inputSession.setPendingComposedDocument(nextDocument);
      } else {
        this.emitDocumentChange(nextDocument, shouldRestoreFocus);
      }
    }
    this.emitStatusChange(nextState);
    this.refreshToolbarSnapshot(nextState);
    this.inputSession.restoreFocusIfNeeded(shouldRestoreFocus);
    this.refreshScrollableDimensions();
  }

  private applySurfaceSyncPlan(
    syncPlan: ReturnType<typeof resolveWritingEditorSurfaceSyncPlan>,
    props: WritingEditorSurfaceProps,
    shouldRestoreFocus: boolean,
  ) {
    if (!this.view) {
      return;
    }

    if (syncPlan.shouldClearPendingDocumentSync) {
      this.inputSession.clearPendingDocumentSyncIfMatches(
        createNormalizedDocumentKey(props.document),
      );
    }

    switch (syncPlan.kind) {
      case 'defer-while-composing':
        this.emitStatusChange(this.view.state);
        this.refreshToolbarSnapshot(this.view.state);
        if (syncPlan.shouldRefreshToolbarChrome) {
          this.toolbar.setProps(this.createToolbarProps());
        }
        this.refreshScrollableDimensions();
        return;
      case 'preserve-local-state':
        if (syncPlan.shouldRefreshPlaceholder) {
          const updatedPlaceholder = updateWritingEditorPlaceholder(
            this.view,
            props.placeholder,
          );
          if (syncPlan.shouldRefreshToolbarChrome) {
            this.toolbar.setProps(this.createToolbarProps());
          }
          if (updatedPlaceholder) {
            this.refreshScrollableDimensions();
            return;
          }
        }

        this.emitStatusChange(this.view.state);
        this.refreshToolbarSnapshot(this.view.state);
        if (syncPlan.shouldRefreshToolbarChrome) {
          this.toolbar.setProps(this.createToolbarProps());
        }
        this.inputSession.restoreFocusIfNeeded(shouldRestoreFocus);
        this.refreshScrollableDimensions();
        return;
      case 'refresh-placeholder':
        const updatedPlaceholder = updateWritingEditorPlaceholder(
          this.view,
          props.placeholder,
        );
        if (syncPlan.shouldRefreshToolbarChrome) {
          this.toolbar.setProps(this.createToolbarProps());
        }
        if (!updatedPlaceholder) {
          this.inputSession.restoreFocusIfNeeded(shouldRestoreFocus);
        }
        this.refreshScrollableDimensions();
        return;
      case 'replace-state':
        this.view.updateState(
          createWritingEditorState(props.document, props.placeholder),
        );
        this.syncEditorViewState(this.view.state, false);
        if (syncPlan.shouldRefreshToolbarChrome) {
          this.toolbar.setProps(this.createToolbarProps());
        }
        this.refreshScrollableDimensions();
        return;
      case 'sync-current-state':
        this.emitStatusChange(this.view.state);
        this.refreshToolbarSnapshot(this.view.state);
        if (syncPlan.shouldRefreshToolbarChrome) {
          this.toolbar.setProps(this.createToolbarProps());
        }
        this.inputSession.restoreFocusIfNeeded(shouldRestoreFocus);
        this.refreshScrollableDimensions();
        return;
    }
  }

  private refreshScrollableDimensions() {
    this.scrollableElement.scanDomNode();
  }

  private emitDocumentChange(
    nextDocument: WritingEditorDocument,
    shouldRestoreFocus: boolean,
  ) {
    this.inputSession.markDocumentSyncPending(
      createNormalizedDocumentKey(nextDocument),
    );
    if (shouldRestoreFocus) {
      this.inputSession.armFocusRestore();
    } else {
      this.inputSession.clearFocusRestoreState();
    }
    this.inputSession.clearPendingComposedDocument();
    this.props.onDocumentChange(nextDocument);
  }

  private readonly handleCompositionStart = () => {
    this.inputSession.handleCompositionStart();
  };

  private readonly handleCompositionEnd = () => {
    this.inputSession.scheduleCompositionFlush(() => {
      if (!this.view) {
        return;
      }

const nextDocument =
        this.inputSession.getPendingComposedDocument() ??
        (this.view.state.doc.toJSON() as WritingEditorDocument);
      const nextDocumentKey = createNormalizedDocumentKey(nextDocument);
      const propsDocumentKey = createNormalizedDocumentKey(this.props.document);

      if (nextDocumentKey === propsDocumentKey) {
        this.inputSession.clearPendingComposedDocument();
        return;
      }

      this.emitDocumentChange(
        nextDocument,
        this.view.hasFocus() || this.inputSession.isFocusRestorePending(),
      );
    });
  };

  private readonly handleBlur = () => {
    this.inputSession.handleBlur();
  };

  private readonly handleFocus = () => {
    this.inputSession.handleFocus();
  };

  private readonly handleDraftStyleServiceChange = () => {
    this.applyDraftStyleSnapshot();
    this.toolbar.setProps(this.createToolbarProps());
  };
}

export function createProseMirrorEditor(props: WritingEditorSurfaceProps) {
  return new ProseMirrorEditor(props);
}

export default ProseMirrorEditor;
