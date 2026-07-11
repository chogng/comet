/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { EditorGroupModel } from 'cs/workbench/common/editor/editorGroupModel';
import type { SerializedEditorInput } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import { EditorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import type { IEditorGroup, IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';

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
	group: IEditorGroup,
	serializers: EditorInputSerializerRegistry,
): SerializedEditorGroup {
	const editors = group.getEditors();
	return {
		id: group.id,
		editors: editors.map(editor => serializers.serialize(editor)),
		mostRecentlyActiveEditorIndexes: group
			.getMostRecentlyActiveEditors()
			.map(editor => editors.indexOf(editor)),
		activeEditorIndex: group.activeEditor ? editors.indexOf(group.activeEditor) : null,
	};
}

export function deserializeEditorGroup(
	serialized: SerializedEditorGroup,
	serializers: EditorInputSerializerRegistry,
	instantiationService: IInstantiationService,
): EditorGroupModel {
	const group = new EditorGroupModel(serialized.id);
	const editors = serialized.editors.map(editor => serializers.deserialize(editor, instantiationService));
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
	groups: IEditorGroupsService,
	serializers: EditorInputSerializerRegistry,
): SerializedEditorGroups {
	return {
		groups: groups.getGroups().map(group => serializeEditorGroup(group, serializers)),
		activeGroupId: groups.activeGroup.id,
	};
}

export function deserializeEditorGroups(
	serialized: SerializedEditorGroups,
	serializers: EditorInputSerializerRegistry,
	instantiationService: IInstantiationService,
): { readonly groups: readonly EditorGroupModel[]; readonly activeGroupId: string } {
	return {
		groups: serialized.groups.map(group => deserializeEditorGroup(group, serializers, instantiationService)),
		activeGroupId: serialized.activeGroupId,
	};
}
