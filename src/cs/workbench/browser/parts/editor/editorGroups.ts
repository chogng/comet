/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { createEditorGroupId, DEFAULT_EDITOR_GROUP_ID } from 'cs/workbench/browser/editorGroupIdentity';
import {
	EditorGroup,
	type EditorGroupChangeEvent,
} from 'cs/workbench/browser/parts/editor/editorGroup';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export interface EditorGroupsChangeEvent {
	readonly group: EditorGroup;
	readonly groupChange?: EditorGroupChangeEvent;
}

export interface EditorGroupsOpenOptions {
	readonly groupId?: string;
	readonly active?: boolean;
}

export class EditorGroups extends Disposable {
	private readonly groups = new Map<string, EditorGroup>();
	private readonly groupListeners = new Map<string, DisposableStore>();
	private activeGroup!: EditorGroup;
	private readonly changeEmitter = this._register(new Emitter<EditorGroupsChangeEvent>());

	readonly onDidChange: Event<EditorGroupsChangeEvent> = this.changeEmitter.event;

	constructor(createDefaultGroup = true) {
		super();
		if (createDefaultGroup) {
			this.activeGroup = this.createGroup(DEFAULT_EDITOR_GROUP_ID);
		}
	}

	get active(): EditorGroup {
		return this.activeGroup;
	}

	getGroups(): readonly EditorGroup[] {
		return [...this.groups.values()];
	}

	getGroup(groupId: string): EditorGroup | undefined {
		return this.groups.get(groupId);
	}

	createGroup(groupId = createEditorGroupId()): EditorGroup {
		const existing = this.groups.get(groupId);
		if (existing) {
			return existing;
		}

		const group = new EditorGroup(groupId);
		this.addGroup(group);
		return group;
	}

	addGroup(group: EditorGroup): void {
		if (this.groups.has(group.id)) {
			throw new Error(`Editor group '${group.id}' is already registered.`);
		}
		const listeners = new DisposableStore();
		listeners.add(group.onDidChange(groupChange => {
			this.changeEmitter.fire({ group, groupChange });
		}));
		this.groups.set(group.id, group);
		this.groupListeners.set(group.id, listeners);
		this.changeEmitter.fire({ group });
		if (!this.activeGroup) {
			this.activeGroup = group;
		}
	}

	activateGroup(group: EditorGroup): void {
		if (!this.groups.has(group.id)) {
			throw new Error(`Editor group '${group.id}' is not registered.`);
		}
		if (this.activeGroup === group) {
			return;
		}
		this.activeGroup = group;
		this.changeEmitter.fire({ group });
	}

	findEditor(editor: EditorInput): { group: EditorGroup; editor: EditorInput } | undefined {
		for (const group of this.groups.values()) {
			const existing = group.getEditors().find(candidate => candidate.matches(editor));
			if (existing) {
				return { group, editor: existing };
			}
		}
		return undefined;
	}

	openEditor(editor: EditorInput, options: EditorGroupsOpenOptions = {}): EditorInput {
		const existing = this.findEditor(editor);
		if (existing) {
			existing.group.setActive(existing.editor);
			if (options.active !== false) {
				this.activateGroup(existing.group);
			}
			return existing.editor;
		}

		const group = options.groupId
			? this.createGroup(options.groupId)
			: this.activeGroup;
		const opened = group.openEditor(editor, { active: options.active });
		if (options.active !== false) {
			this.activateGroup(group);
		}
		return opened;
	}

	async closeEditor(editor: EditorInput): Promise<boolean> {
		const existing = this.findEditor(editor);
		if (!existing) {
			return false;
		}
		return existing.group.closeEditor(existing.editor);
	}

	override dispose(): void {
		for (const listeners of this.groupListeners.values()) {
			listeners.dispose();
		}
		this.groupListeners.clear();
		for (const group of this.groups.values()) {
			group.dispose();
		}
		this.groups.clear();
		super.dispose();
	}
}
