/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'cs/base/common/uri';
import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';
import type { ThemeIcon } from 'cs/base/common/themables';

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

export type EditorGroupModel = {
	tabs: EditorGroupTabItem[];
	activeTabId: string | null;
	activeTab: EditorInput | null;
};

export function getEditorInputId(input: EditorInput): string {
	const resource = input.resource;
	if (!resource) {
		throw new Error(`Editor input '${input.typeId}' has no resource identity.`);
	}
	return resource.toString();
}

export function getEditorPaneMode(input: EditorInput): string {
	return input.editorId ?? input.typeId;
}

export function createEditorGroupModel({
	editors,
	activeEditor,
	draftStatusByEditorId,
}: {
	editors: readonly EditorInput[];
	activeEditor: EditorInput | null;
	draftStatusByEditorId: Readonly<Record<string, DraftEditorStatusState>>;
}): EditorGroupModel {
	const activeTabId = activeEditor ? getEditorInputId(activeEditor) : null;
	return {
		tabs: editors.map(editor => {
			const id = getEditorInputId(editor);
			const status = draftStatusByEditorId[id];
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
					hasLocalHistory: Boolean(status?.canUndo || status?.canRedo),
					canUndo: Boolean(status?.canUndo),
					canRedo: Boolean(status?.canRedo),
				},
			};
		}),
		activeTabId,
		activeTab: activeEditor,
	};
}
