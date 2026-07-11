/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export const enum EditorGroupChangeKind {
	EditorOpen,
	EditorClose,
	EditorMove,
	EditorActivate,
	EditorLabel,
	EditorDirty,
}

export interface EditorGroupChangeEvent {
	readonly kind: EditorGroupChangeKind;
	readonly editor: EditorInput;
	readonly editorIndex: number;
	readonly oldEditorIndex?: number;
}

export interface EditorGroupOpenOptions {
	readonly active?: boolean;
	readonly index?: number;
}

export class EditorGroup extends Disposable {
	private readonly editors: EditorInput[] = [];
	private readonly mostRecentlyActiveEditors: EditorInput[] = [];
	private readonly editorListeners = new Map<EditorInput, DisposableStore>();
	private activeEditor: EditorInput | null = null;
	private readonly changeEmitter = this._register(new Emitter<EditorGroupChangeEvent>());

	readonly onDidChange: Event<EditorGroupChangeEvent> = this.changeEmitter.event;

	constructor(readonly id: string) {
		super();
	}

	get count(): number {
		return this.editors.length;
	}

	get active(): EditorInput | null {
		return this.activeEditor;
	}

	getEditors(): readonly EditorInput[] {
		return [...this.editors];
	}

	getMostRecentlyActiveEditors(): readonly EditorInput[] {
		return [...this.mostRecentlyActiveEditors];
	}

	contains(editor: EditorInput): boolean {
		return this.findEditorIndex(editor) >= 0;
	}

	openEditor(editor: EditorInput, options: EditorGroupOpenOptions = {}): EditorInput {
		const existingIndex = this.findEditorIndex(editor);
		if (existingIndex >= 0) {
			const existing = this.editors[existingIndex]!;
			if (options.active !== false) {
				this.setActive(existing);
			}
			return existing;
		}

		const editorIndex = this.resolveOpenIndex(options.index);
		this.editors.splice(editorIndex, 0, editor);
		this.registerEditorListeners(editor);
		this.changeEmitter.fire({
			kind: EditorGroupChangeKind.EditorOpen,
			editor,
			editorIndex,
		});
		if (options.active !== false) {
			this.setActive(editor);
		}
		return editor;
	}

	async closeEditor(editor: EditorInput): Promise<boolean> {
		const editorIndex = this.findEditorIndex(editor);
		if (editorIndex < 0) {
			return false;
		}
		const target = this.editors[editorIndex]!;
		if (target.closeHandler && !(await target.closeHandler.confirmClose())) {
			return false;
		}

		this.removeEditor(target, true);
		return true;
	}

	moveEditor(editor: EditorInput, targetIndex: number): void {
		const oldEditorIndex = this.findEditorIndex(editor);
		if (oldEditorIndex < 0) {
			return;
		}
		const editorIndex = Math.max(0, Math.min(targetIndex, this.editors.length - 1));
		if (editorIndex === oldEditorIndex) {
			return;
		}

		const [target] = this.editors.splice(oldEditorIndex, 1);
		this.editors.splice(editorIndex, 0, target!);
		this.changeEmitter.fire({
			kind: EditorGroupChangeKind.EditorMove,
			editor: target!,
			editorIndex,
			oldEditorIndex,
		});
	}

	setActive(editor: EditorInput): void {
		const editorIndex = this.findEditorIndex(editor);
		if (editorIndex < 0 || this.activeEditor === this.editors[editorIndex]) {
			return;
		}

		this.activeEditor = this.editors[editorIndex]!;
		this.touchMostRecentlyActive(this.activeEditor);
		this.changeEmitter.fire({
			kind: EditorGroupChangeKind.EditorActivate,
			editor: this.activeEditor,
			editorIndex,
		});
	}

	override dispose(): void {
		const editors = [...this.editors];
		for (const editor of editors) {
			this.removeEditor(editor, true);
		}
		super.dispose();
	}

	private findEditorIndex(editor: EditorInput): number {
		return this.editors.findIndex(candidate => candidate.matches(editor));
	}

	private resolveOpenIndex(index: number | undefined): number {
		if (index === undefined) {
			return this.editors.length;
		}
		return Math.max(0, Math.min(index, this.editors.length));
	}

	private registerEditorListeners(editor: EditorInput): void {
		const listeners = new DisposableStore();
		listeners.add(editor.onWillDispose(() => this.removeEditor(editor, false)));
		listeners.add(editor.onDidChangeLabel(() => this.emitEditorChange(EditorGroupChangeKind.EditorLabel, editor)));
		listeners.add(editor.onDidChangeDirty(() => this.emitEditorChange(EditorGroupChangeKind.EditorDirty, editor)));
		this.editorListeners.set(editor, listeners);
	}

	private emitEditorChange(kind: EditorGroupChangeKind, editor: EditorInput): void {
		const editorIndex = this.editors.indexOf(editor);
		if (editorIndex < 0) {
			return;
		}
		this.changeEmitter.fire({ kind, editor, editorIndex });
	}

	private removeEditor(editor: EditorInput, disposeEditor: boolean): void {
		const editorIndex = this.editors.indexOf(editor);
		if (editorIndex < 0) {
			return;
		}

		this.editorListeners.get(editor)?.dispose();
		this.editorListeners.delete(editor);
		this.editors.splice(editorIndex, 1);
		const mostRecentlyActiveIndex = this.mostRecentlyActiveEditors.indexOf(editor);
		if (mostRecentlyActiveIndex >= 0) {
			this.mostRecentlyActiveEditors.splice(mostRecentlyActiveIndex, 1);
		}
		if (this.activeEditor === editor) {
			this.activeEditor = this.mostRecentlyActiveEditors[0]
				?? this.editors[Math.min(editorIndex, this.editors.length - 1)]
				?? null;
		}
		this.changeEmitter.fire({
			kind: EditorGroupChangeKind.EditorClose,
			editor,
			editorIndex,
		});
		if (disposeEditor) {
			editor.dispose();
		}
	}

	private touchMostRecentlyActive(editor: EditorInput): void {
		const existingIndex = this.mostRecentlyActiveEditors.indexOf(editor);
		if (existingIndex >= 0) {
			this.mostRecentlyActiveEditors.splice(existingIndex, 1);
		}
		this.mostRecentlyActiveEditors.unshift(editor);
	}
}
