/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { InstantiationType, registerSingleton } from 'cs/platform/instantiation/common/extensions';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget } from 'cs/platform/storage/common/storage';
import { createEditorGroupId, DEFAULT_EDITOR_GROUP_ID } from 'cs/workbench/common/editor/editorGroupIdentity';
import { EditorGroupModel } from 'cs/workbench/common/editor/editorGroupModel';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { editorInputSerializerRegistry } from 'cs/workbench/common/editor/editorInputSerializerRegistry';
import {
	deserializeEditorGroups,
	serializeEditorGroups,
	type SerializedEditorGroups,
} from 'cs/workbench/services/editor/common/editorGroupSerialization';
import {
	IEditorGroupsService,
	type IEditorGroup,
	type IEditorGroupsChangeEvent,
	type IEditorGroupsOpenOptions,
} from 'cs/workbench/services/editor/common/editorGroupsService';

const EditorGroupsStorageKey = 'workbench.editorGroups';

export class EditorGroupsService extends Disposable implements IEditorGroupsService {
	declare readonly _serviceBrand: undefined;

	private readonly groups = new Map<string, EditorGroupModel>();
	private readonly groupListeners = new Map<string, DisposableStore>();
	private active!: EditorGroupModel;
	private readonly changeEmitter = this._register(new Emitter<IEditorGroupsChangeEvent>());

	readonly onDidChange: Event<IEditorGroupsChangeEvent> = this.changeEmitter.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();
		this.restore();
	}

	get activeGroup(): IEditorGroup {
		return this.active;
	}

	getGroups(): readonly IEditorGroup[] {
		return [...this.groups.values()];
	}

	getGroup(groupId: string): IEditorGroup | undefined {
		return this.groups.get(groupId);
	}

	createGroup(groupId = createEditorGroupId()): IEditorGroup {
		const existing = this.groups.get(groupId);
		if (existing) {
			return existing;
		}

		const group = new EditorGroupModel(groupId);
		this.addGroup(group);
		this.persist();
		return group;
	}

	activateGroup(group: IEditorGroup): void {
		const registered = this.groups.get(group.id);
		if (registered !== group) {
			throw new Error(`Editor group '${group.id}' is not registered.`);
		}
		if (this.active === group) {
			return;
		}
		this.active = registered;
		this.changeEmitter.fire({ group });
		this.persist();
	}

	findEditor(editor: EditorInput): { group: IEditorGroup; editor: EditorInput } | undefined {
		for (const group of this.groups.values()) {
			const existing = group.getEditors().find(candidate => candidate.matches(editor));
			if (existing) {
				return { group, editor: existing };
			}
		}
		return undefined;
	}

	openEditor(editor: EditorInput, options: IEditorGroupsOpenOptions = {}): EditorInput {
		const existing = this.findEditor(editor);
		if (existing) {
			existing.group.setActive(existing.editor);
			if (options.active !== false) {
				this.activateGroup(existing.group);
			}
			return existing.editor;
		}

		const group = options.groupId ? this.createGroup(options.groupId) : this.active;
		const opened = group.openEditor(editor, { active: options.active });
		if (options.active !== false) {
			this.activateGroup(group);
		}
		return opened;
	}

	async closeEditor(editor: EditorInput): Promise<boolean> {
		const existing = this.findEditor(editor);
		return existing ? existing.group.closeEditor(existing.editor) : false;
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

	private restore(): void {
		const stored = this.storageService.get(EditorGroupsStorageKey, StorageScope.WORKSPACE);
		if (!stored) {
			this.addGroup(new EditorGroupModel(DEFAULT_EDITOR_GROUP_ID));
			return;
		}

		const restored = deserializeEditorGroups(
			JSON.parse(stored) as SerializedEditorGroups,
			editorInputSerializerRegistry,
			this.instantiationService,
		);
		for (const group of restored.groups) {
			this.addGroup(group);
		}
		const activeGroup = this.groups.get(restored.activeGroupId);
		if (!activeGroup) {
			throw new Error(`Stored active editor group '${restored.activeGroupId}' does not exist.`);
		}
		this.active = activeGroup;
	}

	private addGroup(group: EditorGroupModel): void {
		if (this.groups.has(group.id)) {
			throw new Error(`Editor group '${group.id}' is already registered.`);
		}
		const listeners = new DisposableStore();
		listeners.add(group.onDidModelChange(groupChange => {
			this.changeEmitter.fire({ group, groupChange });
			this.persist();
		}));
		this.groups.set(group.id, group);
		this.groupListeners.set(group.id, listeners);
		if (!this.active) {
			this.active = group;
		}
		this.changeEmitter.fire({ group });
	}

	private persist(): void {
		this.storageService.store(
			EditorGroupsStorageKey,
			JSON.stringify(serializeEditorGroups(this, editorInputSerializerRegistry)),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}
}

registerSingleton(IEditorGroupsService, EditorGroupsService, InstantiationType.Delayed);
