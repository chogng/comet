/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Event } from 'cs/base/common/event';
import type {
	EditorGroupModelChangeEvent,
	EditorGroupModelOpenOptions,
} from 'cs/workbench/common/editor/editorGroupModel';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { IEditorOpenContext, IEditorOptions, IEditorPane } from 'cs/workbench/common/editor';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export interface IEditorGroup {
	readonly id: string;
	readonly count: number;
	readonly activeEditor: EditorInput | null;
	readonly onDidModelChange: Event<EditorGroupModelChangeEvent>;
	getEditors(): readonly EditorInput[];
	getMostRecentlyActiveEditors(): readonly EditorInput[];
	contains(editor: EditorInput): boolean;
	openEditor(editor: EditorInput, options?: EditorGroupModelOpenOptions): EditorInput;
	closeEditor(editor: EditorInput): Promise<boolean>;
	moveEditor(editor: EditorInput, targetIndex: number): void;
	setActive(editor: EditorInput): void;
}

export interface IEditorGroupsChangeEvent {
	readonly kind: EditorGroupsChangeKind;
	readonly group: IEditorGroup;
	readonly groupChange?: EditorGroupModelChangeEvent;
}

export const enum EditorGroupsChangeKind {
	GroupAdd,
	GroupRemove,
	GroupActivate,
	GroupModel,
}

export interface IEditorGroupsOpenOptions {
	readonly groupId?: string;
	readonly active?: boolean;
}

export interface IEditorGroupsOpenResult {
	readonly editor: EditorInput;
	readonly group: IEditorGroup;
	readonly newInGroup: boolean;
}

export const IEditorGroupsService = createDecorator<IEditorGroupsService>('editorGroupsService');

export interface IEditorPartHost {
	readonly activeEditorPane: IEditorPane | undefined;
	openEditor(editor: EditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext): Promise<void>;
	revealEditor(expandedEditorSize?: number): void;
	focusPrimaryInput(): void;
}

export interface IEditorGroupsService {
	readonly _serviceBrand: undefined;
	readonly mainPart: IEditorPartHost;
	readonly onDidChange: Event<IEditorGroupsChangeEvent>;
	readonly activeGroup: IEditorGroup;
	initialize(): void;
	getGroups(): readonly IEditorGroup[];
	getGroup(groupId: string): IEditorGroup | undefined;
	createGroup(groupId?: string): IEditorGroup;
	removeGroup(group: IEditorGroup): void;
	activateGroup(group: IEditorGroup): void;
	findEditor(editor: EditorInput): { group: IEditorGroup; editor: EditorInput } | undefined;
	openEditor(editor: EditorInput, options?: IEditorGroupsOpenOptions): IEditorGroupsOpenResult;
	closeEditor(editor: EditorInput): Promise<boolean>;
}
