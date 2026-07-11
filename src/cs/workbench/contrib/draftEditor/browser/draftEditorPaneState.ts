import type { DraftEditorStatusState } from 'cs/editor/browser/text/draftEditorStatusState';
import type { EditorPaneRuntimeState } from 'cs/workbench/browser/parts/editor/panes/editorPane';
import type { DraftEditorPaneLabels } from 'cs/workbench/contrib/draftEditor/browser/draftEditorPane';
import type { EditorStatusItem } from 'cs/workbench/browser/parts/editor/editorStatus';

function formatBlockValue(status: DraftEditorStatusState): string {
	return status.activeBlockIndex
		? `${status.activeBlockLabel} #${status.activeBlockIndex}`
		: status.activeBlockLabel;
}

export function createDraftEditorPaneState(
	labels: DraftEditorPaneLabels,
	status: DraftEditorStatusState,
): EditorPaneRuntimeState {
	const leftItems: EditorStatusItem[] = [
		{ id: 'block', label: labels.status.block, value: formatBlockValue(status) },
		{ id: 'line', label: labels.status.line, value: String(status.currentLine) },
		{ id: 'column', label: labels.status.column, value: String(status.currentColumn) },
	];
	if (status.selectionCharacterCount > 0) {
		leftItems.push({
			id: 'selection',
			label: labels.status.selection,
			value: String(status.selectionCharacterCount),
			tone: 'accent',
		});
	}
	return {
		status: {
			ariaLabel: labels.status.statusbarAriaLabel,
			paneMode: 'draft',
			modeLabel: labels.draftMode,
			leftItems,
			rightItems: [
				{ id: 'words', label: labels.status.words, value: String(status.wordCount) },
				{ id: 'characters', label: labels.status.characters, value: String(status.characterCount) },
				{ id: 'paragraphs', label: labels.status.paragraphs, value: String(status.paragraphCount) },
				{ id: 'undo', label: labels.undo, value: status.canUndo ? labels.status.ready : '-', commandId: 'undo', commandEnabled: status.canUndo },
				{ id: 'redo', label: labels.redo, value: status.canRedo ? labels.status.ready : '-', commandId: 'redo', commandEnabled: status.canRedo },
			],
		},
		tab: {
			hasLocalHistory: status.canUndo || status.canRedo,
			canUndo: status.canUndo,
			canRedo: status.canRedo,
		},
	};
}
