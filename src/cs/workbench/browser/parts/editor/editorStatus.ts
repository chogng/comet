/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { WritingEditorSurfaceLabels } from 'cs/editor/browser/text/editor';
import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import { Verbosity } from 'cs/workbench/common/editor';
import type { EditorInput } from 'cs/workbench/common/editor/editorInput';

export type EditorStatusLabels = {
	statusbarAriaLabel: string;
	words: string;
	characters: string;
	paragraphs: string;
	selection: string;
	block: string;
	line: string;
	column: string;
	url: string;
	blockFigure: string;
	ready: string;
};

export type EditorStatusContextLabels = Pick<WritingEditorSurfaceLabels,
	'paragraph' | 'heading1' | 'heading2' | 'heading3' | 'bulletList' | 'orderedList' | 'blockquote' | 'undo' | 'redo'>
	& EditorStatusLabels
	& { draftMode: string; sourceMode: string; pdfMode: string };

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
	paneMode: 'empty' | 'draft' | 'browser' | 'pdf';
	modeLabel?: string;
	summary?: string;
	leftItems: readonly EditorStatusItem[];
	rightItems: readonly EditorStatusItem[];
};

function formatBlockValue(status: DraftEditorStatusState): string {
	return status.activeBlockIndex
		? `${status.activeBlockLabel} #${status.activeBlockIndex}`
		: status.activeBlockLabel;
}

function createDraftEditorStatus(
	labels: EditorStatusContextLabels,
	status: DraftEditorStatusState,
): EditorStatusState {
	const leftItems: EditorStatusItem[] = [
		{ id: 'block', label: labels.block, value: formatBlockValue(status) },
		{ id: 'line', label: labels.line, value: String(status.currentLine) },
		{ id: 'column', label: labels.column, value: String(status.currentColumn) },
	];
	if (status.selectionCharacterCount > 0) {
		leftItems.push({
			id: 'selection',
			label: labels.selection,
			value: String(status.selectionCharacterCount),
			tone: 'accent',
		});
	}
	return {
		ariaLabel: labels.statusbarAriaLabel,
		paneMode: 'draft',
		modeLabel: labels.draftMode,
		leftItems,
		rightItems: [
			{ id: 'words', label: labels.words, value: String(status.wordCount) },
			{ id: 'characters', label: labels.characters, value: String(status.characterCount) },
			{ id: 'paragraphs', label: labels.paragraphs, value: String(status.paragraphCount) },
			{ id: 'undo', label: labels.undo, value: status.canUndo ? labels.ready : '-', commandId: 'undo', commandEnabled: status.canUndo },
			{ id: 'redo', label: labels.redo, value: status.canRedo ? labels.ready : '-', commandId: 'redo', commandEnabled: status.canRedo },
		],
	};
}

function createContentEditorStatus(
	input: EditorInput,
	labels: EditorStatusContextLabels,
	status?: EditorContentStatusState,
): EditorStatusState {
	const paneMode = status ? 'pdf' : 'browser';
	return {
		ariaLabel: labels.statusbarAriaLabel,
		paneMode,
		modeLabel: paneMode === 'pdf' ? labels.pdfMode : labels.sourceMode,
		leftItems: status?.message
			? [{ id: 'content-status', label: labels.pdfMode, value: status.message, tone: status.tone, title: status.detail }, ...(status.items ?? [])]
			: [],
		rightItems: [{
			id: 'url',
			label: labels.url,
			value: input.getDescription(Verbosity.LONG) ?? '',
		}],
	};
}

export function createEditorStatus(
	activeInput: EditorInput | null,
	labels: EditorStatusContextLabels,
	draftStatus?: DraftEditorStatusState,
	contentStatus?: EditorContentStatusState,
): EditorStatusState {
	if (!activeInput) {
		return {
			ariaLabel: labels.statusbarAriaLabel,
			paneMode: 'empty',
			summary: labels.ready,
			leftItems: [],
			rightItems: [],
		};
	}
	return draftStatus
		? createDraftEditorStatus(labels, draftStatus)
		: createContentEditorStatus(activeInput, labels, contentStatus);
}
