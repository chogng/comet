import type { DraftEditorSurfaceActionId } from 'cs/workbench/browser/parts/editor/activeDraftEditorCommandExecutor';
import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';
import {
	EditorGroupView,
} from 'cs/workbench/browser/parts/editor/editorGroupView';
import type {
	EditorPartProps,
} from 'cs/workbench/browser/parts/editor/editorPartView';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';

import 'cs/workbench/browser/parts/editor/media/editor.css';
import 'cs/sessions/browser/parts/editor/media/editorPart.css';
import 'cs/workbench/browser/parts/editor/media/editorToolbar.css';
import 'cs/workbench/browser/parts/editor/media/editorBrowserLibraryPanel.css';
import 'cs/workbench/browser/parts/editor/media/tabsTitleControl.css';

export type SessionEditorPartProps = EditorPartProps;

export class SessionEditorPartView {
	readonly id = SESSION_PART_IDS.editor;

	private readonly element = document.createElement('section');
	private readonly groupView: EditorGroupView;

	constructor(props: SessionEditorPartProps) {
		this.element.className = 'comet-panel comet-editor-panel comet-session-editor-panel';
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, this.element);
		this.groupView = new EditorGroupView(props);
		this.element.append(this.groupView.getElement());
	}

	getElement() {
		return this.element;
	}

	executeActiveDraftCommand(commandId: DraftEditorCommandId) {
		return this.groupView.executeActiveDraftCommand(commandId);
	}

	canExecuteActiveDraftCommand(commandId: DraftEditorCommandId) {
		return this.groupView.canExecuteActiveDraftCommand(commandId);
	}

	runActiveDraftEditorAction(actionId: DraftEditorSurfaceActionId) {
		return this.groupView.runActiveDraftEditorAction(actionId);
	}

	getActiveDraftStableSelectionTarget() {
		return this.groupView.getActiveDraftStableSelectionTarget();
	}

	whenEditorTabViewStateSettled(tabId: string) {
		return this.groupView.whenTabViewStateSettled(tabId);
	}

	focusPrimaryInput() {
		this.groupView.focusPrimaryInput();
	}

	setProps(props: SessionEditorPartProps) {
		this.groupView.setProps(props);
	}

	dispose() {
		this.groupView.dispose();
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, null);
		this.element.replaceChildren();
	}
}

export function createSessionEditorPartView(props: SessionEditorPartProps) {
	return new SessionEditorPartView(props);
}
