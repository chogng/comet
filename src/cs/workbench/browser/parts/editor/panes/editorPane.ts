export type EditorPaneLayout = {
  width: number;
  height: number;
};

export abstract class EditorPane<TProps, TViewState = unknown> {
  abstract getElement(): HTMLElement;
  abstract setProps(props: TProps): void;
  abstract dispose(): void;

  getToolbarElement(): HTMLElement | null {
    return null;
  }

  clearInput() {}

  focus() {}

  layout(_layout: EditorPaneLayout) {}

  getViewState(): TViewState | undefined {
    return undefined;
  }

  captureViewState(): Promise<TViewState | undefined> {
    return Promise.resolve(this.getViewState());
  }

  restoreViewState(_state: TViewState | undefined) {}
}

export type AnyEditorPane = EditorPane<any, any>;

export type EditorPaneResolution<
  TPane extends AnyEditorPane = AnyEditorPane,
  TPaneId extends string = string,
> = {
  paneId: TPaneId;
  paneKey: string;
  contentClassNames: readonly string[];
  createPane: () => TPane;
  updatePane: (pane: TPane) => void;
};

export type EditorPaneDescriptor<
  TRawInput,
  TInput extends TRawInput,
  TContext,
  TPane extends AnyEditorPane = AnyEditorPane,
  TPaneId extends string = string,
> = {
  paneId: TPaneId;
  acceptsInput: (input: TRawInput) => input is TInput;
  resolvePane: (
    input: TInput,
    context: TContext,
  ) => EditorPaneResolution<TPane, TPaneId>;
};
