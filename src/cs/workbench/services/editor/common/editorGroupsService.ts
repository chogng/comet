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
	readonly group: IEditorGroup;
	readonly groupChange?: EditorGroupModelChangeEvent;
}

export interface IEditorGroupsOpenOptions {
	readonly groupId?: string;
	readonly active?: boolean;
}

export const IEditorGroupsService = createDecorator<IEditorGroupsService>('editorGroupsService');

export interface IEditorGroupsService {
	readonly _serviceBrand: undefined;
	readonly onDidChange: Event<IEditorGroupsChangeEvent>;
	readonly activeGroup: IEditorGroup;
	getGroups(): readonly IEditorGroup[];
	getGroup(groupId: string): IEditorGroup | undefined;
	createGroup(groupId?: string): IEditorGroup;
	activateGroup(group: IEditorGroup): void;
	findEditor(editor: EditorInput): { group: IEditorGroup; editor: EditorInput } | undefined;
	openEditor(editor: EditorInput, options?: IEditorGroupsOpenOptions): EditorInput;
	closeEditor(editor: EditorInput): Promise<boolean>;
}
