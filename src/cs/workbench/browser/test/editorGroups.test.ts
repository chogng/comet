/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test from 'node:test';

import { Event } from 'cs/base/common/event';
import { URI } from 'cs/base/common/uri';
import { InstantiationService } from 'cs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'cs/platform/instantiation/common/serviceCollection';
import type { IStorageService } from 'cs/platform/storage/common/storage';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { EditorGroupsService } from 'cs/workbench/services/editor/browser/editorGroupsService';

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

editorInputSerializerRegistry.register('test.editorInput', {
	canSerialize: (input): input is TestEditorInput => input instanceof TestEditorInput,
	serialize: input => input instanceof TestEditorInput ? input.resource.toString() : undefined,
	deserialize: (_instantiationService, value) => new TestEditorInput(URI.parse(value)),
});

function createStorageService(values = new Map<string, string>()): IStorageService {
	return {
		_serviceBrand: undefined,
		applicationStorage: undefined,
		onDidChangeValue: Event.None,
		onDidChangeTarget: Event.None,
		onWillSaveState: Event.None,
		init: async () => {},
		close: async () => {},
		get: (key: string) => values.get(key),
		getBoolean: () => undefined,
		getNumber: () => undefined,
		getObject: () => undefined,
		store(key: string, value: unknown) {
			if (typeof value !== 'string') {
				throw new Error(`Expected string storage value for '${key}'.`);
			}
			values.set(key, value);
		},
		storeAll() {},
		remove() {},
		keys: () => [],
		log() {},
		optimize: async () => {},
		flush: async () => {},
	} as unknown as IStorageService;
}

function createEditorGroupsService(): EditorGroupsService {
	return new EditorGroupsService(
		createStorageService(),
		new InstantiationService(new ServiceCollection()),
	);
}

function createPersistedEditorGroupsService(values: Map<string, string>): EditorGroupsService {
	return new EditorGroupsService(
		createStorageService(values),
		new InstantiationService(new ServiceCollection()),
	);
}

test('EditorGroups opens inputs into groups and activates the target group', () => {
	const groups = createEditorGroupsService();
	const secondGroup = groups.createGroup('group-b');
	const input = new TestEditorInput(URI.parse('test:/editor'));

	groups.openEditor(input, { groupId: secondGroup.id });
	assert.equal(groups.activeGroup, secondGroup);
	assert.equal(secondGroup.activeEditor, input);
	assert.deepEqual(secondGroup.getEditors(), [input]);
	groups.dispose();
});

test('EditorGroups reveals matching resource identity where it already lives', () => {
	const groups = createEditorGroupsService();
	const firstGroup = groups.activeGroup;
	const secondGroup = groups.createGroup('group-b');
	const first = new TestEditorInput(URI.parse('test:/same'));
	const matching = new TestEditorInput(URI.parse('test:/same'));
	groups.openEditor(first);
	groups.activateGroup(secondGroup);

	assert.equal(groups.openEditor(matching), first);
	assert.equal(groups.activeGroup, firstGroup);
	assert.deepEqual(firstGroup.getEditors(), [first]);
	assert.deepEqual(secondGroup.getEditors(), []);
	groups.dispose();
	matching.dispose();
});

test('EditorGroupsService restores group ownership and active group from storage', () => {
	const values = new Map<string, string>();
	const groups = createPersistedEditorGroupsService(values);
	groups.openEditor(new TestEditorInput(URI.parse('test:/first')));
	const secondGroup = groups.createGroup('group-b');
	groups.openEditor(new TestEditorInput(URI.parse('test:/second')), { groupId: secondGroup.id });
	groups.dispose();

	const restored = createPersistedEditorGroupsService(values);
	assert.equal(restored.activeGroup.id, 'group-b');
	assert.deepEqual(
		restored.getGroups().map(group => group.getEditors().map(editor => editor.resource?.path)),
		[['/first'], ['/second']],
	);
	restored.dispose();
});
