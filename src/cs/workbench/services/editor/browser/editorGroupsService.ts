/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, type Event } from 'cs/base/common/event';
import { Disposable, DisposableStore } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from 'cs/platform/storage/common/storage';
import { createEditorGroupId, DEFAULT_EDITOR_GROUP_ID } from 'cs/workbench/common/editor/editorGroupIdentity';
import { EditorGroupModel, EditorGroupModelChangeKind } from 'cs/workbench/common/editor/editorGroupModel';
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
	type IEditorPartHost,
	type IEditorGroupsChangeEvent,
	type IEditorGroupsOpenOptions,
	type IEditorGroupsOpenResult,
	EditorGroupsChangeKind,
} from 'cs/workbench/services/editor/common/editorGroupsService';

const EditorGroupsStorageKey = 'workbench.editorGroups';

export abstract class EditorGroupsService extends Disposable implements IEditorGroupsService {
	declare readonly _serviceBrand: undefined;
	abstract readonly mainPart: IEditorPartHost;

	private readonly groups = new Map<string, EditorGroupModel>();
	private readonly groupListeners = new Map<string, DisposableStore>();
	private active!: EditorGroupModel;
	private readonly changeEmitter = this._register(new Emitter<IEditorGroupsChangeEvent>());
	private initialized = false;
	private shutdownStarted = false;

	readonly onDidChange: Event<IEditorGroupsChangeEvent> = this.changeEmitter.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
	) {
		super();
		this._register(this.storageService.onWillSaveState(event => {
			if (!this.initialized || this.shutdownStarted) {
				return;
			}
			if (event.reason === WillSaveStateReason.SHUTDOWN) {
				this.shutdownStarted = true;
				return;
			}
			this.persist();
		}));
	}

	initialize(): void {
		if (this.initialized) {
			throw new Error('Editor groups have already been initialized.');
		}
		this.restore();
		this.initialized = true;
	}

	get activeGroup(): IEditorGroup {
		this.assertInitialized();
		return this.active;
	}

	getGroups(): readonly IEditorGroup[] {
		this.assertInitialized();
		return [...this.groups.values()];
	}

	getGroup(groupId: string): IEditorGroup | undefined {
		this.assertInitialized();
		return this.groups.get(groupId);
	}

	createGroup(groupId = createEditorGroupId()): IEditorGroup {
		this.assertInitialized();
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
		this.assertInitialized();
		const registered = this.groups.get(group.id);
		if (registered !== group) {
			throw new Error(`Editor group '${group.id}' is not registered.`);
		}
		if (this.active === group) {
			return;
		}
		this.active = registered;
		this.changeEmitter.fire({ kind: EditorGroupsChangeKind.GroupActivate, group });
		this.persist();
	}

	removeGroup(group: IEditorGroup): void {
		this.assertInitialized();
		const registered = this.groups.get(group.id);
		if (registered !== group) {
			throw new Error(`Editor group '${group.id}' is not registered.`);
		}
		if (this.groups.size === 1) {
			throw new Error('The last editor group cannot be removed.');
		}
		const editors = registered.getEditors();
		this.groupListeners.get(group.id)?.dispose();
		this.groupListeners.delete(group.id);
		this.groups.delete(group.id);
		registered.dispose();
		if (this.active === registered) {
			const nextActiveGroup = this.groups.values().next().value;
			if (!nextActiveGroup) {
				throw new Error('Removing an editor group left no active group.');
			}
			this.active = nextActiveGroup;
			this.changeEmitter.fire({ kind: EditorGroupsChangeKind.GroupActivate, group: this.active });
		}
		this.changeEmitter.fire({ kind: EditorGroupsChangeKind.GroupRemove, group });
		for (const editor of editors) {
			this.disposeEditorIfUnreferenced(editor);
		}
		this.persist();
	}

	findEditor(editor: EditorInput): { group: IEditorGroup; editor: EditorInput } | undefined {
		this.assertInitialized();
		for (const group of this.getGroupsByActiveOrder()) {
			if (group.getEditors().includes(editor)) {
				return { group, editor };
			}
		}
		for (const group of this.getGroupsByActiveOrder()) {
			const existing = group.getEditors().find(candidate => candidate.matches(editor));
			if (existing) {
				return { group, editor: existing };
			}
		}
		return undefined;
	}

	openEditor(editor: EditorInput, options: IEditorGroupsOpenOptions = {}): IEditorGroupsOpenResult {
		this.assertInitialized();
		const targetGroup = options.groupId ? this.getGroup(options.groupId) : undefined;
		const targetExisting = targetGroup?.getEditors().find(candidate => candidate.matches(editor));
		const existing = options.groupId
			? targetGroup && targetExisting ? { group: targetGroup, editor: targetExisting } : undefined
			: this.findEditor(editor);
		if (existing) {
			existing.group.openEditor(existing.editor, { active: options.active });
			if (options.active !== false) {
				this.activateGroup(existing.group);
			}
			if (existing.editor !== editor) {
				editor.dispose();
			}
			return {
				editor: existing.editor,
				group: existing.group,
				newInGroup: false,
			};
		}

		editorInputSerializerRegistry.serialize(editor);
		const group = options.groupId
			? targetGroup ?? this.createGroup(options.groupId)
			: this.active;
		const opened = group.openEditor(editor, { active: options.active });
		if (options.active !== false) {
			this.activateGroup(group);
		}
		return {
			editor: opened,
			group,
			newInGroup: true,
		};
	}

	async closeEditor(editor: EditorInput): Promise<boolean> {
		this.assertInitialized();
		const existing = this.findEditor(editor);
		return existing ? existing.group.closeEditor(existing.editor) : false;
	}

	override dispose(): void {
		for (const listeners of this.groupListeners.values()) {
			listeners.dispose();
		}
		this.groupListeners.clear();
		const editors = new Set<EditorInput>();
		for (const group of this.groups.values()) {
			for (const editor of group.getEditors()) {
				editors.add(editor);
			}
			group.dispose();
		}
		this.groups.clear();
		for (const editor of editors) {
			editor.dispose();
		}
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
			this.changeEmitter.fire({ kind: EditorGroupsChangeKind.GroupModel, group, groupChange });
			if (groupChange.kind === EditorGroupModelChangeKind.EditorClose && !groupChange.editorWillDispose) {
				this.disposeEditorIfUnreferenced(groupChange.editor);
			}
			this.persist();
		}));
		this.groups.set(group.id, group);
		this.groupListeners.set(group.id, listeners);
		if (!this.active) {
			this.active = group;
		}
		this.changeEmitter.fire({ kind: EditorGroupsChangeKind.GroupAdd, group });
	}

	private disposeEditorIfUnreferenced(editor: EditorInput): void {
		const isReferenced = [...this.groups.values()].some(group =>
			group.getEditors().includes(editor),
		);
		if (!isReferenced) {
			editor.dispose();
		}
	}

	private getGroupsByActiveOrder(): readonly EditorGroupModel[] {
		return [
			this.active,
			...[...this.groups.values()].filter(group => group !== this.active),
		];
	}

	private persist(): void {
		if (this.shutdownStarted) {
			return;
		}
		this.storageService.store(
			EditorGroupsStorageKey,
			JSON.stringify(serializeEditorGroups(this, editorInputSerializerRegistry)),
			StorageScope.WORKSPACE,
			StorageTarget.MACHINE,
		);
	}

	private assertInitialized(): void {
		if (!this.initialized) {
			throw new Error('Editor groups have not been initialized.');
		}
	}
}
