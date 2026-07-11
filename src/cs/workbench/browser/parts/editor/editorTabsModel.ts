/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { ThemeIcon } from 'cs/base/common/themables';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { getEditorInputId } from 'cs/workbench/common/editor/editorInputIdentity';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';

export type EditorGroupTabState = {
	isActive: boolean;
	isClosable: boolean;
	isDirty: boolean;
	hasLocalHistory: boolean;
	canUndo: boolean;
	canRedo: boolean;
};

export type EditorGroupTabItem = {
	id: string;
	paneMode: string;
	label: string;
	title: string;
	faviconUrl?: string;
	icon?: ThemeIcon;
	state: EditorGroupTabState;
};

export type EditorTabsModel = {
	tabs: EditorGroupTabItem[];
	activeTabId: string | null;
	activeTab: EditorInput | null;
};

export function getEditorPaneMode(input: EditorInput): string {
	return input.editorId ?? input.typeId;
}

export function createEditorTabsModel({
	editors,
	activeEditor,
	runtimeStateByEditorId,
}: {
	editors: readonly EditorInput[];
	activeEditor: EditorInput | null;
	runtimeStateByEditorId: Readonly<Record<string, EditorPaneRuntimeState>>;
}): EditorTabsModel {
	const activeTabId = activeEditor ? getEditorInputId(activeEditor) : null;
	return {
		tabs: editors.map(editor => {
			const id = getEditorInputId(editor);
			const tabState = runtimeStateByEditorId[id]?.tab;
			const icon = editor.getIcon();
			return {
				id,
				paneMode: getEditorPaneMode(editor),
				label: editor.getName(),
				title: editor.getTitle(),
				faviconUrl: icon instanceof URI ? icon.toString() : undefined,
				icon: icon instanceof URI ? undefined : icon,
				state: {
					isActive: id === activeTabId,
					isClosable: true,
					isDirty: editor.isDirty(),
					hasLocalHistory: Boolean(tabState?.hasLocalHistory),
					canUndo: Boolean(tabState?.canUndo),
					canRedo: Boolean(tabState?.canRedo),
				},
			};
		}),
		activeTabId,
		activeTab: activeEditor,
	};
}
