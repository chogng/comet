import type { EditorWorkspaceContentTab } from 'ls/workbench/browser/parts/editor/editorModel';
import { ViewPartView } from 'ls/workbench/browser/parts/views/viewPartView';
import type { ViewPartProps } from 'ls/workbench/browser/parts/views/viewPartView';
import type { INativeHostService } from 'ls/platform/native/common/native';

import type { EditorPartLabels } from 'ls/workbench/browser/parts/editor/editorPartView';
import { EditorPane } from 'ls/workbench/browser/parts/editor/panes/editorPane';
import {
  captureContentEditorPaneViewState,
  restoreContentEditorPaneViewState,
} from 'ls/workbench/browser/parts/editor/panes/contentEditorViewState';
import type { ContentEditorPaneViewState } from 'ls/workbench/browser/parts/editor/panes/contentEditorViewState';

export type ContentEditorPaneProps = {
  labels: EditorPartLabels;
  contentTab: EditorWorkspaceContentTab;
  viewPartProps: ViewPartProps;
  nativeHost: INativeHostService;
};

export class ContentEditorPane extends EditorPane<
  ContentEditorPaneProps,
  ContentEditorPaneViewState
> {
  private static readonly RESTORE_RETRY_DELAYS_MS = [0, 200, 800] as const;

  private props: ContentEditorPaneProps;
  private readonly element = document.createElement('div');
  private readonly bodyElement = document.createElement('div');
  private readonly viewPartView: ViewPartView;
  private viewState: ContentEditorPaneViewState | undefined;
  private restoreSequence = 0;
  private pendingRestoreTimer: number | null = null;

  constructor(props: ContentEditorPaneProps) {
    super();
    this.props = props;
    this.element.className = 'editor-source-pane';
    this.bodyElement.className = 'editor-source-body';
    this.viewPartView = new ViewPartView(props.viewPartProps);
    this.bodyElement.append(this.viewPartView.getElement());
    this.element.append(this.bodyElement);
  }

  override getElement() {
    return this.element;
  }

  override setProps(props: ContentEditorPaneProps) {
    if (this.props.contentTab.id !== props.contentTab.id) {
      this.cancelRestoreSequence();
    }

    this.props = props;
    this.viewPartView.setProps(props.viewPartProps);
  }

  override getViewState() {
    return this.viewState;
  }

  override async captureViewState() {
    const capturedViewState = await captureContentEditorPaneViewState(
      this.props.contentTab.id,
      this.props.nativeHost,
    );
    if (capturedViewState) {
      this.viewState = capturedViewState;
    }

    return this.viewState;
  }

  override restoreViewState(viewState: ContentEditorPaneViewState | undefined) {
    this.viewState = viewState;
    this.scheduleRestore(viewState);
  }

  override dispose() {
    this.cancelRestoreSequence();
    this.viewPartView.dispose();
    this.element.replaceChildren();
  }

  private scheduleRestore(viewState: ContentEditorPaneViewState | undefined) {
    this.cancelRestoreSequence();
    if (!viewState || typeof window === 'undefined') {
      return;
    }

    const restoreSequence = ++this.restoreSequence;
    this.scheduleRestoreAttempt(
      restoreSequence,
      this.props.contentTab.id,
      viewState,
      0,
    );
  }

  private scheduleRestoreAttempt(
    restoreSequence: number,
    targetId: string,
    viewState: ContentEditorPaneViewState,
    attemptIndex: number,
  ) {
    if (typeof window === 'undefined' || this.restoreSequence !== restoreSequence) {
      return;
    }

    const delayMs =
      ContentEditorPane.RESTORE_RETRY_DELAYS_MS[attemptIndex] ?? 0;

    const runAttempt = () => {
      this.pendingRestoreTimer = null;
      if (this.restoreSequence !== restoreSequence) {
        return;
      }

      void restoreContentEditorPaneViewState(
        targetId,
        viewState,
        this.props.nativeHost,
      ).then((restored) => {
        if (restored || this.restoreSequence !== restoreSequence) {
          return;
        }

        if (
          attemptIndex >=
          ContentEditorPane.RESTORE_RETRY_DELAYS_MS.length - 1
        ) {
          return;
        }

        this.scheduleRestoreAttempt(
          restoreSequence,
          targetId,
          viewState,
          attemptIndex + 1,
        );
      });
    };

    if (delayMs <= 0) {
      runAttempt();
      return;
    }

    this.pendingRestoreTimer = window.setTimeout(runAttempt, delayMs);
  }

  private cancelRestoreSequence() {
    this.restoreSequence += 1;
    if (this.pendingRestoreTimer !== null && typeof window !== 'undefined') {
      window.clearTimeout(this.pendingRestoreTimer);
    }

    this.pendingRestoreTimer = null;
  }
}

export function createContentEditorPane(props: ContentEditorPaneProps) {
  return new ContentEditorPane(props);
}

export default ContentEditorPane;
