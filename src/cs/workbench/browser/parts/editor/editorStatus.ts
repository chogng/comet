/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export type EditorStatusLabels = {
	statusbarAriaLabel: string;
	ready: string;
};

export type EditorStatusItemTone = 'default' | 'accent' | 'muted' | 'error';

export type EditorStatusItem = {
	id: string;
	label: string;
	value: string;
	tone?: EditorStatusItemTone;
	title?: string;
	commandId?: 'undo' | 'redo';
	commandEnabled?: boolean;
};

export type EditorContentStatusState = {
	message: string;
	detail?: string;
	tone?: EditorStatusItemTone;
	items?: readonly EditorStatusItem[];
};

export type EditorStatusState = {
	ariaLabel: string;
	paneMode: string;
	modeLabel?: string;
	summary?: string;
	leftItems: readonly EditorStatusItem[];
	rightItems: readonly EditorStatusItem[];
};

export function createEmptyEditorStatus(
	labels: Pick<EditorStatusLabels, 'statusbarAriaLabel' | 'ready'>,
): EditorStatusState {
	return {
		ariaLabel: labels.statusbarAriaLabel,
		paneMode: 'empty',
		summary: labels.ready,
		leftItems: [],
		rightItems: [],
	};
}
