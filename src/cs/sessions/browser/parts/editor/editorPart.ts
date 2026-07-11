import type { DraftEditorSurfaceActionId } from 'cs/workbench/contrib/draftEditor/browser/activeDraftEditorCommandExecutor';
import type { DraftEditorCommandId } from 'cs/workbench/contrib/draftEditor/browser/draftEditorCommands';
import { createActiveDraftEditorCommandExecutor } from 'cs/workbench/contrib/draftEditor/browser/activeDraftEditorCommandExecutor';
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
import 'cs/workbench/browser/parts/editor/media/browserHistoryAndFavoritesPanel.css';
import 'cs/workbench/browser/parts/editor/media/tabsTitleControl.css';

export type SessionEditorPartProps = EditorPartProps;

export class SessionEditorPartView {
	readonly id = SESSION_PART_IDS.editor;

	private readonly element = document.createElement('section');
	private readonly groupView: EditorGroupView;
	private readonly draftCommandExecutor: ReturnType<typeof createActiveDraftEditorCommandExecutor>;

	constructor(props: SessionEditorPartProps) {
		this.element.className = 'comet-panel comet-editor-panel comet-session-editor-panel';
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.editor, this.element);
		this.groupView = new EditorGroupView(props);
		this.draftCommandExecutor = createActiveDraftEditorCommandExecutor(() => this.groupView.getActivePane());
		this.element.append(this.groupView.getElement());
	}

	getElement() {
		return this.element;
	}

	layout(width: number, height: number) {
		this.groupView.layout(width, height);
	}

	executeActiveDraftCommand(commandId: DraftEditorCommandId) {
		return this.draftCommandExecutor.execute(commandId);
	}

	canExecuteActiveDraftCommand(commandId: DraftEditorCommandId) {
		return this.draftCommandExecutor.canExecute(commandId);
	}

	runActiveDraftEditorAction(actionId: DraftEditorSurfaceActionId) {
		return this.draftCommandExecutor.runAction(actionId);
	}

	getActiveDraftStableSelectionTarget() {
		return this.draftCommandExecutor.getStableSelectionTarget();
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
