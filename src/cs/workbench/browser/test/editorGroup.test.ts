/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { URI } from 'cs/base/common/uri';
import { EditorInput, type IEditorCloseHandler } from 'cs/workbench/common/editor/editorInput';
import {
	EditorGroupModel,
	EditorGroupModelChangeKind,
} from 'cs/workbench/common/editor/editorGroupModel';

class TestEditorInput extends EditorInput {
	private dirty = false;
	disposeCount = 0;

	constructor(
		readonly resource: URI,
		readonly closeHandler?: IEditorCloseHandler,
	) {
		super();
	}

	get typeId(): string {
		return 'test.editorInput';
	}

	override getName(): string {
		return this.resource.path;
	}

	override matches(otherInput: EditorInput): boolean {
		return otherInput instanceof TestEditorInput && this.resource.toString() === otherInput.resource.toString();
	}

	override isDirty(): boolean {
		return this.dirty;
	}

	setDirty(dirty: boolean): void {
		if (this.dirty === dirty) {
			return;
		}
		this.dirty = dirty;
		this._onDidChangeDirty.fire();
	}

	setLabelChanged(): void {
		this._onDidChangeLabel.fire();
	}

	override dispose(): void {
		this.disposeCount += 1;
		super.dispose();
	}
}

test('EditorGroup owns open, active, MRU, move, and close state for generic inputs', async () => {
	const group = new EditorGroupModel('group-a');
	const first = new TestEditorInput(URI.parse('test:/first'));
	const second = new TestEditorInput(URI.parse('test:/second'));
	const changes: EditorGroupModelChangeKind[] = [];
	group.onDidModelChange(event => changes.push(event.kind));

	group.openEditor(first);
	group.openEditor(second);
	assert.deepEqual(group.getEditors(), [first, second]);
	assert.equal(group.activeEditor, second);
	assert.deepEqual(group.getMostRecentlyActiveEditors(), [second, first]);

	group.setActive(first);
	group.moveEditor(first, 1);
	assert.deepEqual(group.getEditors(), [second, first]);
	assert.equal(group.activeEditor, first);
	assert.deepEqual(group.getMostRecentlyActiveEditors(), [first, second]);

	assert.equal(await group.closeEditor(first), true);
	assert.equal(first.disposeCount, 1);
	assert.equal(group.activeEditor, second);
	assert.deepEqual(group.getEditors(), [second]);
	assert.equal(changes.includes(EditorGroupModelChangeKind.EditorOpen), true);
	assert.equal(changes.includes(EditorGroupModelChangeKind.EditorActivate), true);
	assert.equal(changes.includes(EditorGroupModelChangeKind.EditorMove), true);
	assert.equal(changes.includes(EditorGroupModelChangeKind.EditorClose), true);
	group.dispose();
});

test('EditorGroup reuses matching input identity without adding another tab', () => {
	const group = new EditorGroupModel('group-a');
	const first = new TestEditorInput(URI.parse('test:/same'));
	const matching = new TestEditorInput(URI.parse('test:/same'));

	assert.equal(group.openEditor(first), first);
	assert.equal(group.openEditor(matching), first);
	assert.deepEqual(group.getEditors(), [first]);
	assert.equal(group.activeEditor, first);
	group.dispose();
	matching.dispose();
});

test('EditorGroup delegates close confirmation to the input', async () => {
	let canClose = false;
	const input = new TestEditorInput(URI.parse('test:/dirty'), {
		confirmClose: async () => canClose,
	});
	const group = new EditorGroupModel('group-a');
	group.openEditor(input);

	assert.equal(await group.closeEditor(input), false);
	assert.equal(group.contains(input), true);
	assert.equal(input.disposeCount, 0);

	canClose = true;
	assert.equal(await group.closeEditor(input), true);
	assert.equal(group.contains(input), false);
	assert.equal(input.disposeCount, 1);
	group.dispose();
});

test('EditorGroup removes an input that is disposed by its feature owner', () => {
	const group = new EditorGroupModel('group-a');
	const input = new TestEditorInput(URI.parse('test:/external-close'));
	group.openEditor(input);

	input.dispose();
	assert.equal(group.count, 0);
	assert.equal(group.activeEditor, null);
	group.dispose();
});

test('EditorGroup forwards input label and dirty changes without knowing input type', () => {
	const group = new EditorGroupModel('group-a');
	const input = new TestEditorInput(URI.parse('test:/state'));
	const changes: EditorGroupModelChangeKind[] = [];
	group.onDidModelChange(event => changes.push(event.kind));
	group.openEditor(input);

	input.setLabelChanged();
	input.setDirty(true);
	assert.deepEqual(changes.slice(-2), [
		EditorGroupModelChangeKind.EditorLabel,
		EditorGroupModelChangeKind.EditorDirty,
	]);
	group.dispose();
});
