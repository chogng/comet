/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { CancellationToken } from 'cs/base/common/cancellation';
import { Event, type Event as EventType } from 'cs/base/common/event';
import type { IEditorOpenContext, IEditorOptions } from 'cs/workbench/common/editor';

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
	readonly onDidChangeViewState: EventType<TViewState> = Event.None;
	abstract getElement(): HTMLElement;
	abstract setInput(
		input: TInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): void | Promise<void>;
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
