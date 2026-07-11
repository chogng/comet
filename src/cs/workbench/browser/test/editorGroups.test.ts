/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { URI } from 'cs/base/common/uri';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { EditorGroups } from 'cs/workbench/browser/parts/editor/editorGroups';

class TestEditorInput extends EditorInput {
	constructor(readonly resource: URI) {
		super();
	}

	get typeId(): string {
		return 'test.editorInput';
	}

	override matches(otherInput: EditorInput): boolean {
		return otherInput instanceof TestEditorInput
			&& this.resource.toString() === otherInput.resource.toString();
	}
}

test('EditorGroups opens inputs into groups and activates the target group', () => {
	const groups = new EditorGroups();
	const secondGroup = groups.createGroup('group-b');
	const input = new TestEditorInput(URI.parse('test:/editor'));

	groups.openEditor(input, { groupId: secondGroup.id });
	assert.equal(groups.active, secondGroup);
	assert.equal(secondGroup.active, input);
	assert.deepEqual(secondGroup.getEditors(), [input]);
	groups.dispose();
});

test('EditorGroups reveals matching resource identity where it already lives', () => {
	const groups = new EditorGroups();
	const firstGroup = groups.active;
	const secondGroup = groups.createGroup('group-b');
	const first = new TestEditorInput(URI.parse('test:/same'));
	const matching = new TestEditorInput(URI.parse('test:/same'));
	groups.openEditor(first);
	groups.activateGroup(secondGroup);

	assert.equal(groups.openEditor(matching), first);
	assert.equal(groups.active, firstGroup);
	assert.deepEqual(firstGroup.getEditors(), [first]);
	assert.deepEqual(secondGroup.getEditors(), []);
	groups.dispose();
	matching.dispose();
});
