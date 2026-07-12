/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import './media/style.css';

import { Disposable } from 'cs/base/common/lifecycle';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import {
	SessionSidebarPartView,
	type SessionSidebarProps,
	type SessionSidebarViewProps,
} from 'cs/sessions/browser/parts/sidebar/sidebarPart';
import {
	SessionsPart,
} from 'cs/sessions/browser/parts/sessions/sessionsPart';
import type { SessionsMainEditorPart } from 'cs/sessions/browser/parts/editor/editorPart';
import { SessionsEditorParts } from 'cs/sessions/browser/parts/editor/editorParts';
import { ISessionsPartService } from 'cs/sessions/services/sessions/browser/sessionsPartService';
import {
	ISessionsService,
	OpenNewSessionKind,
} from 'cs/sessions/services/sessions/browser/sessionsService';
import { ISessionsManagementService } from 'cs/sessions/services/sessions/common/sessionsManagement';
import { SessionWorkspaceKind } from 'cs/sessions/services/sessions/common/session';
import { isNewSessionSlot } from 'cs/sessions/services/sessions/common/sessionsView';
import { IEditorGroupsService } from 'cs/workbench/services/editor/common/editorGroupsService';
import { ISessionsLayoutService } from 'cs/sessions/services/layout/browser/layoutService';

export type SessionWorkbenchContentPartViewsProps = {
	sidebarProps: SessionSidebarProps;
	leadingTitlebarActionsElement?: HTMLElement | null;
	sidebarFooterActionsElement: HTMLElement;
	collapsedEditorTitlebarActionsElement: HTMLElement;
};

export class SessionWorkbenchContentPartViews extends Disposable {
	private props: SessionWorkbenchContentPartViewsProps;
	private sidebarView: SessionSidebarPartView | null = null;
	private readonly editorPart: SessionsMainEditorPart;
	private disposed = false;

	constructor(
		props: SessionWorkbenchContentPartViewsProps,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ISessionsPartService private readonly sessionsView: SessionsPart,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IEditorGroupsService editorParts: SessionsEditorParts,
		@ISessionsLayoutService private readonly layoutService: ISessionsLayoutService,
	) {
		super();
		this.props = props;
		this.editorPart = editorParts.mainPart;
		this.editorPart.initialize();
		this._register(this.layoutService.onDidChangeLayoutState(this.render, this));
		this.openInitialDraftIfUnambiguous();
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
		return this.sessionsView.getElement();
	}

	getEditorElement() {
		return this.editorPart.getElement();
	}

	layoutEditor(width: number, height: number) {
		this.editorPart.layout(width, height);
	}

	layoutSessions(width: number, height: number) {
		this.sessionsView.layout(width, height);
	}

	override dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.sidebarView?.dispose();
		this.sidebarView = null;
		super.dispose();
	}

	private render() {
		const state = this.layoutService.getLayoutState();
		this.renderSidebar(state.isSidebarVisible);
		this.renderSessions(!state.isEditorCollapsed);
	}

	//#region Column titlebar routing

	private renderSidebar(isSidebarVisible: boolean) {
		const nextProps: SessionSidebarViewProps = {
			...this.props.sidebarProps,
			isCollapsed: !isSidebarVisible,
			titlebarActionsElement: this.props.leadingTitlebarActionsElement ?? null,
			footerActionsElement: this.props.sidebarFooterActionsElement,
		};

		if (!this.sidebarView) {
			this.sidebarView = this.instantiationService.createInstance(SessionSidebarPartView, nextProps);
			return;
		}

		this.sidebarView.setProps(nextProps);
	}

	private renderSessions(isEditorVisible: boolean) {
		this.sessionsView.setTitlebarActions(
			null,
			isEditorVisible
				? null
				: this.props.collapsedEditorTitlebarActionsElement,
		);
	}

	//#endregion

	private openInitialDraftIfUnambiguous(): void {
		if (this.sessionsManagementService.draftSession.get()
			|| this.sessionsManagementService.getSessions().length > 0
			|| !this.sessionsService.visibleSessions.get().some(isNewSessionSlot)) {
			return;
		}
		const sessionTypes = this.sessionsManagementService.sessionTypes.get();
		if (sessionTypes.length !== 1 || !sessionTypes[0].sessionType.supportsWorkspaceLess) {
			return;
		}
		const [{ providerId, sessionType }] = sessionTypes;
		this.sessionsService.openNewSession({
			kind: OpenNewSessionKind.Draft,
			providerId,
			draft: {
				sessionType: sessionType.id,
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
			preserveFocus: true,
		});
	}
}
