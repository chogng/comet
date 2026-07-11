/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export const enum EditorGroupModelChangeKind {
	EditorOpen,
	EditorClose,
	EditorMove,
	EditorActivate,
	EditorLabel,
	EditorDirty,
}

export interface EditorGroupModelChangeEvent {
	readonly kind: EditorGroupModelChangeKind;
	readonly editor: EditorInput;
	readonly editorIndex: number;
	readonly oldEditorIndex?: number;
}

export interface EditorGroupModelOpenOptions {
	readonly active?: boolean;
	readonly index?: number;
}

export class EditorGroupModel extends Disposable {
	private readonly editors: EditorInput[] = [];
	private readonly mostRecentlyActiveEditors: EditorInput[] = [];
	private readonly editorListeners = new Map<EditorInput, DisposableStore>();
	private activeInput: EditorInput | null = null;
	private readonly modelChangeEmitter = this._register(new Emitter<EditorGroupModelChangeEvent>());

	readonly onDidModelChange: Event<EditorGroupModelChangeEvent> = this.modelChangeEmitter.event;

	constructor(readonly id: string) {
		super();
	}

	get count(): number {
		return this.editors.length;
	}

	get activeEditor(): EditorInput | null {
		return this.activeInput;
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

	openEditor(editor: EditorInput, options: EditorGroupModelOpenOptions = {}): EditorInput {
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
		this.modelChangeEmitter.fire({
			kind: EditorGroupModelChangeKind.EditorOpen,
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
		this.modelChangeEmitter.fire({
			kind: EditorGroupModelChangeKind.EditorMove,
			editor: target!,
			editorIndex,
			oldEditorIndex,
		});
	}

	setActive(editor: EditorInput): void {
		const editorIndex = this.findEditorIndex(editor);
		if (editorIndex < 0 || this.activeInput === this.editors[editorIndex]) {
			return;
		}
		this.activeInput = this.editors[editorIndex]!;
		this.touchMostRecentlyActive(this.activeInput);
		this.modelChangeEmitter.fire({
			kind: EditorGroupModelChangeKind.EditorActivate,
			editor: this.activeInput,
			editorIndex,
		});
	}

	override dispose(): void {
		for (const editor of [...this.editors]) {
			this.removeEditor(editor, true);
		}
		super.dispose();
	}

	private findEditorIndex(editor: EditorInput): number {
		return this.editors.findIndex(candidate => candidate.matches(editor));
	}

	private resolveOpenIndex(index: number | undefined): number {
		return index === undefined
			? this.editors.length
			: Math.max(0, Math.min(index, this.editors.length));
	}

	private registerEditorListeners(editor: EditorInput): void {
		const listeners = new DisposableStore();
		listeners.add(editor.onWillDispose(() => this.removeEditor(editor, false)));
		listeners.add(editor.onDidChangeLabel(() => this.emitEditorChange(EditorGroupModelChangeKind.EditorLabel, editor)));
		listeners.add(editor.onDidChangeDirty(() => this.emitEditorChange(EditorGroupModelChangeKind.EditorDirty, editor)));
		this.editorListeners.set(editor, listeners);
	}

	private emitEditorChange(kind: EditorGroupModelChangeKind, editor: EditorInput): void {
		const editorIndex = this.editors.indexOf(editor);
		if (editorIndex >= 0) {
			this.modelChangeEmitter.fire({ kind, editor, editorIndex });
		}
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
		if (this.activeInput === editor) {
			this.activeInput = this.mostRecentlyActiveEditors[0]
				?? this.editors[Math.min(editorIndex, this.editors.length - 1)]
				?? null;
		}
		this.modelChangeEmitter.fire({
			kind: EditorGroupModelChangeKind.EditorClose,
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
