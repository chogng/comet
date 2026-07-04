import type { EditorStatusState } from 'cs/workbench/browser/parts/editor/editorStatus';
import type { EditorPartProps } from 'cs/workbench/browser/parts/editor/editorPartView';
import type { DraftEditorCommandId } from 'cs/workbench/browser/parts/editor/panes/draftEditorCommands';
import type { SessionChatViewProps } from 'cs/sessions/browser/parts/sessions/chatView';
import {
	createSessionSidebarPartView,
	SessionSidebarPartView,
	type SessionSidebarProps,
} from 'cs/sessions/browser/parts/sidebar/sidebarPart';
import {
	createSessionsPartView,
	SessionsPartView,
} from 'cs/sessions/browser/parts/sessions/sessionsPart';
import {
	createSessionEditorPartView,
	SessionEditorPartView,
} from 'cs/sessions/browser/parts/editor/editorPart';
import {
	clearStatusbarCommandHandlers,
	initializeStatusbarState,
	setStatusbarCommandHandlers,
	updateStatusbarState,
} from 'cs/workbench/browser/parts/statusbar/statusbarActions';

export type SessionWorkbenchContentPartViewsProps = {
	mode?: 'content' | 'settings';
	isPrimarySidebarVisible: boolean;
	isEditorVisible: boolean;
	sidebarProps: SessionSidebarProps;
	sessionChatProps: SessionChatViewProps;
	editorPartProps: EditorPartProps;
	settingsNavigationElement?: HTMLElement | null;
	settingsContentElement?: HTMLElement | null;
	sidebarFooterActionsElement: HTMLElement;
	editorHeaderActionsElement?: HTMLElement | null;
};

export class SessionWorkbenchContentPartViews {
	private props: SessionWorkbenchContentPartViewsProps;
	private sidebarView: SessionSidebarPartView | null = null;
	private sessionsView: SessionsPartView | null = null;
	private editorView: SessionEditorPartView | null = null;
	private retiredEditorView: SessionEditorPartView | null = null;
	private disposed = false;

	constructor(props: SessionWorkbenchContentPartViewsProps) {
		this.props = props;
		this.render();
	}

	setProps(props: SessionWorkbenchContentPartViewsProps) {
		if (this.disposed) {
			return;
		}

		this.props = props;
		this.render();
	}

	getSidebarElement() {
		return this.sidebarView?.getElement() ?? null;
	}

	getSessionsElement() {
		if (this.props.mode === 'settings') {
			return this.props.settingsContentElement ?? null;
		}

		return this.sessionsView?.getElement() ?? null;
	}

	getEditorElement() {
		return this.editorView?.getElement() ?? null;
	}

	executeActiveDraftCommand(commandId: DraftEditorCommandId) {
		return this.editorView?.executeActiveDraftCommand(commandId) ?? false;
	}

	canExecuteActiveDraftCommand(commandId: DraftEditorCommandId) {
		return this.editorView?.canExecuteActiveDraftCommand(commandId) ?? false;
	}

	getActiveDraftStableSelectionTarget() {
		return this.editorView?.getActiveDraftStableSelectionTarget() ?? null;
	}

	focusActiveEditorPrimaryInput() {
		this.editorView?.focusPrimaryInput();
	}

	whenEditorTabViewStateSettled(tabId: string) {
		return (
			this.editorView?.whenEditorTabViewStateSettled(tabId) ??
			this.retiredEditorView?.whenEditorTabViewStateSettled(tabId) ??
			Promise.resolve()
		);
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		clearStatusbarCommandHandlers();
		this.sidebarView?.dispose();
		this.sessionsView?.dispose();
		this.retiredEditorView = this.editorView;
		this.retiredEditorView?.dispose();
		this.sidebarView = null;
		this.sessionsView = null;
		this.editorView = null;
	}

	private render() {
		initializeStatusbarState(this.props.editorPartProps.labels.status);
		this.renderSidebar();
		this.renderSessions();
		this.renderEditor();
	}

	private renderSidebar() {
		if (!this.props.isPrimarySidebarVisible) {
			this.sidebarView?.dispose();
			this.sidebarView = null;
			return;
		}

		const nextProps: SessionSidebarProps = {
			...this.props.sidebarProps,
			mode: this.props.mode === 'settings' ? 'settings' : 'content',
			settingsNavigationElement:
				this.props.mode === 'settings'
					? (this.props.settingsNavigationElement ?? null)
					: null,
			footerActionsElement: this.props.sidebarFooterActionsElement,
		};

		if (!this.sidebarView) {
			this.sidebarView = createSessionSidebarPartView(nextProps);
			return;
		}

		this.sidebarView.setProps(nextProps);
	}

	private renderSessions() {
		if (this.props.mode === 'settings') {
			this.sessionsView?.dispose();
			this.sessionsView = null;
			return;
		}

		const nextProps = {
			chatProps: this.props.sessionChatProps,
			headerTrailingActionsElement:
				this.props.isEditorVisible
					? null
					: (this.props.editorHeaderActionsElement ?? null),
		};

		if (!this.sessionsView) {
			this.sessionsView = createSessionsPartView(nextProps);
			return;
		}

		this.sessionsView.setProps(nextProps);
	}

	private renderEditor() {
		if (this.props.mode === 'settings' || !this.props.isEditorVisible) {
			this.retireEditorView();
			return;
		}

		const nextProps: EditorPartProps = {
			...this.props.editorPartProps,
			showHeaderActions: false,
			showHeaderToolbar: true,
			isEditorCollapsed: false,
			isAgentSidebarVisible: false,
			showAgentSidebarToggle: false,
			headerAuxiliaryActionsElements: this.props.editorHeaderActionsElement
				? [this.props.editorHeaderActionsElement]
				: [],
			hasLeadingWindowControlsInset: !this.props.isPrimarySidebarVisible,
			onStatusChange: this.handleEditorStatusChange,
		};

		if (!this.editorView) {
			this.editorView = createSessionEditorPartView(nextProps);
		} else {
			this.editorView.setProps(nextProps);
		}

		this.syncStatusbarCommandHandlers();
	}

	private retireEditorView() {
		if (!this.editorView) {
			clearStatusbarCommandHandlers();
			return;
		}

		this.retiredEditorView = this.editorView;
		this.retiredEditorView.dispose();
		this.editorView = null;
		clearStatusbarCommandHandlers();
	}

	private handleEditorStatusChange = (status: EditorStatusState) => {
		updateStatusbarState(status);
	};

	private syncStatusbarCommandHandlers() {
		setStatusbarCommandHandlers({
			undo: () => {
				this.editorView?.runActiveDraftEditorAction('undo');
			},
			redo: () => {
				this.editorView?.runActiveDraftEditorAction('redo');
			},
		});
	}
}

export function createSessionWorkbenchContentPartViews(
	props: SessionWorkbenchContentPartViewsProps,
) {
	return new SessionWorkbenchContentPartViews(props);
}
