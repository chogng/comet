/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { URI } from 'cs/base/common/uri';
import type { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export type GroupIdentifier = number;

export const enum Verbosity {
	SHORT,
	MEDIUM,
	LONG,
}

export const enum EditorInputCapabilities {
	None = 0,
	Readonly = 1 << 1,
	Untitled = 1 << 2,
	Singleton = 1 << 3,
	RequiresTrust = 1 << 4,
	CanSplitInGroup = 1 << 5,
	ForceDescription = 1 << 6,
	CanDropIntoEditor = 1 << 7,
	MultipleEditors = 1 << 8,
	CanSplitInGroupByDragAndDrop = 1 << 9,
	ForceReveal = 1 << 10,
	RequiresModal = 1 << 11,
}

export type IEditorOptions = {
	readonly override?: string;
	readonly viewState?: unknown;
};

export interface IUntypedEditorInput {
	readonly resource?: URI;
	readonly options?: IEditorOptions;
}

export interface IEditorSerializer {
	canSerialize(editor: EditorInput): boolean;
	serialize(editor: EditorInput): string | undefined;
	deserialize(
		instantiationService: IInstantiationService,
		serializedEditor: string,
	): EditorInput | undefined;
}

export function isEditorInput(candidate: unknown): candidate is EditorInput {
	return candidate instanceof Object && typeof (candidate as EditorInput).matches === 'function';
}

export const EditorResourceAccessor = {
	getCanonicalUri(editor: IUntypedEditorInput): URI | undefined {
		return editor.resource;
	},
};
