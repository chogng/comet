import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';

export type EditorPaneTabState = {
	readonly hasLocalHistory: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
};

export type EditorPaneRuntimeState = {
	readonly status: EditorStatusState;
	readonly tab?: EditorPaneTabState;
	readonly metadata?: {
		readonly kind: string;
		readonly value: unknown;
	};
};

export type EditorPaneLayout = {
  width: number;
  height: number;
};

export abstract class EditorPane<TInput extends EditorInput = EditorInput, TViewState = unknown> {
	abstract getElement(): HTMLElement;
	abstract setInput(input: TInput): void;
	abstract dispose(): void;

  getToolbarElement(): HTMLElement | null {
    return null;
  }

  clearInput() {}

  focus() {}

	focusPrimaryInput() {
		this.focus();
	}

  layout(_layout: EditorPaneLayout) {}

  getViewState(): TViewState | undefined {
    return undefined;
  }

  captureViewState(): Promise<TViewState | undefined> {
    return Promise.resolve(this.getViewState());
  }

  restoreViewState(_state: TViewState | undefined) {}
}

export type AnyEditorPane = EditorPane<EditorInput, unknown>;

export type EditorPaneResolution<
  TPane extends AnyEditorPane = AnyEditorPane,
  TPaneId extends string = string,
> = {
  paneId: TPaneId;
	paneKey: string;
	contentClassNames: readonly string[];
	createPane: () => TPane;
	setInput: (pane: TPane) => void;
};

export type EditorPaneDescriptor<
	TInput extends EditorInput,
	TContext,
	TPane extends EditorPane<TInput, unknown> = EditorPane<TInput, unknown>,
	TPaneId extends string = string,
> = {
	paneId: TPaneId;
	acceptsInput: (input: EditorInput) => input is TInput;
  resolvePane: (
    input: TInput,
    context: TContext,
  ) => EditorPaneResolution<TPane, TPaneId>;
};
