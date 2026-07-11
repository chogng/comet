/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { SerializedEditorInput } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { EditorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { EditorGroup } from 'cs/workbench/browser/parts/editor/editorGroup';
import { EditorGroups } from 'cs/workbench/browser/parts/editor/editorGroups';

export interface SerializedEditorGroup {
	readonly id: string;
	readonly editors: readonly SerializedEditorInput[];
	readonly mostRecentlyActiveEditorIndexes: readonly number[];
	readonly activeEditorIndex: number | null;
}

export interface SerializedEditorGroups {
	readonly groups: readonly SerializedEditorGroup[];
	readonly activeGroupId: string;
}

export function serializeEditorGroup(
	group: EditorGroup,
	serializers: EditorInputSerializerRegistry,
): SerializedEditorGroup {
	const editors = group.getEditors();
	return {
		id: group.id,
		editors: editors.map(editor => serializers.serialize(editor)),
		mostRecentlyActiveEditorIndexes: group
			.getMostRecentlyActiveEditors()
			.map(editor => editors.indexOf(editor)),
		activeEditorIndex: group.active ? editors.indexOf(group.active) : null,
	};
}

export function deserializeEditorGroup(
	serialized: SerializedEditorGroup,
	serializers: EditorInputSerializerRegistry,
	instantiationService: IInstantiationService,
): EditorGroup {
	const group = new EditorGroup(serialized.id);
	const editors = serialized.editors.map(editor =>
		serializers.deserialize(editor, instantiationService),
	);
	for (const editor of editors) {
		group.openEditor(editor, { active: false });
	}
	for (const editorIndex of [...serialized.mostRecentlyActiveEditorIndexes].reverse()) {
		const editor = editors[editorIndex];
		if (editor) {
			group.setActive(editor);
		}
	}
	if (serialized.activeEditorIndex !== null) {
		const activeEditor = editors[serialized.activeEditorIndex];
		if (activeEditor) {
			group.setActive(activeEditor);
		}
	}
	return group;
}

export function serializeEditorGroups(
	groups: EditorGroups,
	serializers: EditorInputSerializerRegistry,
): SerializedEditorGroups {
	return {
		groups: groups.getGroups().map(group => serializeEditorGroup(group, serializers)),
		activeGroupId: groups.active.id,
	};
}

export function deserializeEditorGroups(
	serialized: SerializedEditorGroups,
	serializers: EditorInputSerializerRegistry,
	instantiationService: IInstantiationService,
): EditorGroups {
	const groups = new EditorGroups(false);
	for (const serializedGroup of serialized.groups) {
		groups.addGroup(deserializeEditorGroup(serializedGroup, serializers, instantiationService));
	}
	const activeGroup = groups.getGroup(serialized.activeGroupId);
	if (!activeGroup) {
		throw new Error(`Serialized active editor group '${serialized.activeGroupId}' does not exist.`);
	}
	groups.activateGroup(activeGroup);
	return groups;
}
