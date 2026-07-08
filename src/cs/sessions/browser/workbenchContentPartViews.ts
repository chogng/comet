import './media/style.css';

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
	SESSION_PART_IDS,
	type SessionPartId,
} from 'cs/sessions/browser/parts/parts';
import {
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
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';

export type SessionWorkbenchContentPartViewsProps = {
	isPrimarySidebarVisible: boolean;
	isEditorVisible: boolean;
	sidebarProps: SessionSidebarProps;
	sessionChatProps: SessionChatViewProps;
	editorPartProps: EditorPartProps;
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

	constructor(
		props: SessionWorkbenchContentPartViewsProps,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
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
		return this.sessionsView?.getElement() ?? null;
	}

	getEditorElement() {
		return this.editorView?.getElement() ?? null;
	}

	getPart(partId: typeof SESSION_PART_IDS.sidebar): SessionSidebarPartView | null;
	getPart(partId: typeof SESSION_PART_IDS.sessions): SessionsPartView | null;
	getPart(partId: typeof SESSION_PART_IDS.editor): SessionEditorPartView | null;
	getPart(partId: SessionPartId) {
		switch (partId) {
			case SESSION_PART_IDS.sidebar:
				return this.sidebarView;
			case SESSION_PART_IDS.sessions:
				return this.sessionsView;
			case SESSION_PART_IDS.editor:
				return this.props.isEditorVisible ? this.editorView : null;
		}

		return null;
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
		this.disposeSessionsView();
		this.retiredEditorView = this.editorView;
		this.retiredEditorView?.dispose();
		this.sidebarView = null;
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
			footerActionsElement: this.props.sidebarFooterActionsElement,
		};

		if (!this.sidebarView) {
			this.sidebarView = createSessionSidebarPartView(nextProps);
			return;
		}

		this.sidebarView.setProps(nextProps);
	}

	private renderSessions() {
		const nextProps = {
			chatProps: this.props.sessionChatProps,
			headerTrailingActionsElement:
				this.props.isEditorVisible
					? null
					: (this.props.editorHeaderActionsElement ?? null),
		};

		if (!this.sessionsView) {
			this.sessionsView = this.instantiationService.createInstance(
				SessionsPartView,
				nextProps,
			);
			return;
		}

		this.sessionsView.setProps(nextProps);
	}

	private renderEditor() {
		if (!this.props.isEditorVisible) {
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

	private disposeSessionsView() {
		this.sessionsView?.dispose();
		this.sessionsView = null;
	}

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
