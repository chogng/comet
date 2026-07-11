/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'cs/platform/instantiation/common/instantiation';
import type {
	EditorOpenRequest,
	EditorOpenResult,
} from 'cs/workbench/services/editor/common/editorOpenTypes';

export type PreferredGroup = number | 'active' | 'side' | 'auxiliary' | 'modal';

export interface IEditorServiceEntry {
	readonly groupId: string;
	readonly id: string;
	readonly kind: 'draft' | 'browser' | 'pdf';
	readonly title: string;
	readonly url?: string;
}

export const IEditorService = createDecorator<IEditorService>('editorService');

export interface IEditorService {
	readonly _serviceBrand: undefined;
	openEditor(request: EditorOpenRequest): EditorOpenResult | Promise<EditorOpenResult>;
	activateEditor(editorId: string): void;
	closeEditor(editorId: string): Promise<boolean>;
	getEditors(): readonly IEditorServiceEntry[];
	getActiveGroupId(): string;
}
