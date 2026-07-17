/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { DisposableHandle } from 'cs/base/common/lifecycle';
import type {
	EditorDraftDefaultBodyStyle,
	EditorDraftStyleSettings,
} from 'cs/base/common/editorDraftStyle';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export interface EditorDraftStyleOption {
	readonly value: string;
	readonly label: string;
	readonly title?: string;
}

export type EditorDraftStyleServiceSnapshot = EditorDraftStyleSettings & {
	readonly fontFamilyPresets: readonly EditorDraftStyleOption[];
	readonly fontSizePresets: readonly EditorDraftStyleOption[];
};

export type EditorDraftStyleServiceInput =
	| EditorDraftStyleSettings
	| EditorDraftStyleServiceSnapshot;

export interface IEditorDraftStyleService {
	readonly _serviceBrand: undefined;

	getSnapshot(): EditorDraftStyleServiceSnapshot;
	subscribe(listener: () => void): DisposableHandle;
	setSnapshot(nextSnapshot: EditorDraftStyleServiceInput): void;
	setDefaultBodyStyle(nextDefaultBodyStyle: EditorDraftDefaultBodyStyle): void;
}

export const IEditorDraftStyleService =
	createDecorator<IEditorDraftStyleService>('editorDraftStyleService');
