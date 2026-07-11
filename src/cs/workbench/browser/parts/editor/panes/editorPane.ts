/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { Event, type Event as EventType } from 'cs/base/common/event';

export type EditorPaneTabState = {
	readonly hasLocalHistory: boolean;
	readonly canUndo: boolean;
	readonly canRedo: boolean;
};

export type EditorPaneRuntimeState = {
	readonly status: EditorStatusState;
	readonly tab?: EditorPaneTabState;
};

export type EditorPaneLayout = {
  width: number;
  height: number;
};

export abstract class EditorPane<TInput extends EditorInput = EditorInput, TViewState = unknown> {
	readonly onDidChangeRuntimeState: EventType<EditorPaneRuntimeState> = Event.None;
	abstract getElement(): HTMLElement;
	abstract setInput(input: TInput, token?: CancellationToken): void | Promise<void>;
	abstract dispose(): void;

  getToolbarElement(): HTMLElement | null {
    return null;
  }

	getRuntimeState(): EditorPaneRuntimeState | undefined {
		return undefined;
	}

  clearInput() {}

  focus() {}

	setVisible(_visible: boolean) {}

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
	updatePane?: (pane: TPane) => void;
	setInput: (pane: TPane, token: CancellationToken) => void | Promise<void>;
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
