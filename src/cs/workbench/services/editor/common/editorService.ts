/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type { IEditorOpenContext, IEditorOptions, IEditorPane, IUntypedEditorInput } from 'cs/workbench/common/editor';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export type PreferredGroup = number | 'active' | 'side' | 'auxiliary' | 'modal';

export interface IEditorIdentifier {
	readonly groupId: string;
	readonly editor: EditorInput;
}

export interface IEditorOpenOptions {
	readonly groupId?: string;
	readonly active?: boolean;
	readonly editorOptions?: IEditorOptions;
	readonly context?: IEditorOpenContext;
}

export type EditorOpenHandler = (
	input: EditorInput | IUntypedEditorInput,
	options?: IEditorOpenOptions,
) => Promise<EditorInput> | void;

export const IEditorService = createDecorator<IEditorService>('editorService');

export interface IEditorService {
	readonly _serviceBrand: undefined;
	readonly activeEditorPane: IEditorPane | undefined;
	readonly activeEditor: EditorInput | undefined;
	openEditor(input: EditorInput | IUntypedEditorInput, options?: IEditorOpenOptions): Promise<EditorInput>;
	activateEditor(editor: EditorInput): Promise<void>;
	closeEditor(editor: EditorInput): Promise<boolean>;
	getEditors(): readonly IEditorIdentifier[];
	getActiveGroupId(): string;
}
