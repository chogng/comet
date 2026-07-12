/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { createButtonView } from 'cs/base/browser/ui/button/button';
import { $, addDisposableListener, EventType } from 'cs/base/browser/dom';
import { Disposable, DisposableStore, MutableDisposable } from 'cs/base/common/lifecycle';
import { autorun } from 'cs/base/common/observable';
import { localize } from 'cs/nls';
import { IInstantiationService } from 'cs/platform/instantiation/common/instantiation';
import { INotificationService } from 'cs/platform/notification/common/notification';
import {
	IQuickInputService,
	type IQuickPickItem,
} from 'cs/platform/quickinput/common/quickInput';
import { registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import { WORKBENCH_PART_IDS } from 'cs/workbench/browser/part';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import {
	ISessionsService,
	OpenNewSessionKind,
} from 'cs/sessions/services/sessions/browser/sessionsService';
import {
	ISessionsManagementService,
	type IProviderSessionType,
} from 'cs/sessions/services/sessions/common/sessionsManagement';
import type { ISession } from 'cs/sessions/services/sessions/common/session';
import { SessionWorkspaceKind } from 'cs/sessions/services/sessions/common/session';
import { IWorkbenchSidebarEntryService } from 'cs/workbench/services/sidebar/common/sidebarEntryService';

import 'cs/workbench/browser/parts/sidebar/media/sidebar.css';
import 'cs/sessions/browser/parts/sidebar/media/sidebarPart.css';

export type SessionSidebarLabels = {
	homeTitle: string;
	codeTitle: string;
	homeNavNewChat: string;
	homeNavProjects: string;
	homeNavArtifacts: string;
	homeNavCustomize: string;
	recentsTitle: string;
};

export type SessionSidebarProps = {
	labels: SessionSidebarLabels;
};

export type SessionSidebarViewProps = SessionSidebarProps & {
	isCollapsed: boolean;
	titlebarActionsElement?: HTMLElement | null;
	footerActionsElement?: HTMLElement | null;
};

interface IRecentSessionRow {
	readonly session: ISession;
	readonly title: string;
	readonly active: boolean;
}

interface ISessionTypeQuickPickItem extends IQuickPickItem {
	readonly sessionType: IProviderSessionType;
}

let panelIdPool = 0;

class SessionSidebar extends Disposable {
	private props: SessionSidebarViewProps;
	private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-session-sidebar-root.comet-sidebar-root');
	private readonly titlebarElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-titlebar');
	private readonly titlebarActionsElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-titlebar-actions');
	private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-content');
	private readonly footerElement = $<HTMLElementTagNameMap['footer']>('footer.comet-sidebar-footer');

	//#region Sidebar header

	private readonly headerElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-header');
	private readonly tabListElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-tab-list');
	private readonly homeTabButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-tab');
	private readonly codeTabButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-tab');
	private readonly tabActionsElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-tab-actions');

	//#endregion

	private readonly contentHostElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-content-host');
	private readonly homeSection = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-tab-panel.comet-sidebar-home-panel');
	private readonly codeSection = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-tab-panel.comet-sidebar-code-panel');
	private readonly homeNavElement = $<HTMLElementTagNameMap['nav']>('nav.comet-sidebar-home-nav');
	private readonly recentsElement = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-recents');
	private readonly recentsTitleElement = $<HTMLElementTagNameMap['h2']>('h2.comet-sidebar-recents-title');
	private readonly recentsBodyElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-recents-body');
	private readonly newChatButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-home-nav-item');
	private readonly newChatLabelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-home-nav-label');
	private readonly projectsButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-home-nav-item');
	private readonly projectsLabelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-home-nav-label');
	private readonly artifactsButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-home-nav-item');
	private readonly artifactsLabelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-home-nav-label');
	private readonly customizeButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-home-nav-item');
	private readonly customizeLabelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-home-nav-label');
	private readonly recentButtons = this._register(new MutableDisposable<DisposableStore>());
	private recentSessionRows: readonly IRecentSessionRow[] = [];

	constructor(
		props: SessionSidebarViewProps,
		@ISessionsService private readonly sessionsService: ISessionsService,
		@ISessionsManagementService private readonly sessionsManagementService: ISessionsManagementService,
		@IWorkbenchSidebarEntryService private readonly sidebarEntryService: IWorkbenchSidebarEntryService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this.props = props;
		this.tabListElement.setAttribute('role', 'tablist');
		this.tabListElement.setAttribute('aria-label', props.labels.homeTitle);
		this.homeTabButton.type = 'button';
		this.homeTabButton.setAttribute('role', 'tab');
		this.homeTabButton.classList.add('comet-sidebar-home-tab');
		this._register(addDisposableListener(this.homeTabButton, EventType.CLICK, this.handleHomeTabClick));
		this.codeTabButton.type = 'button';
		this.codeTabButton.setAttribute('role', 'tab');
		this.codeTabButton.classList.add('comet-sidebar-code-tab');
		this._register(addDisposableListener(this.codeTabButton, EventType.CLICK, this.handleCodeTabClick));
		this.homeSection.id = `session-sidebar-home-panel-${panelIdPool}`;
		panelIdPool += 1;
		this.codeSection.id = `session-sidebar-code-panel-${panelIdPool}`;
		panelIdPool += 1;
		this.homeTabButton.setAttribute('aria-controls', this.homeSection.id);
		this.codeTabButton.setAttribute('aria-controls', this.codeSection.id);
		this.initializeHomeNavigationButton(this.newChatButton, this.newChatLabelElement, 'add');
		this.initializeHomeNavigationButton(this.projectsButton, this.projectsLabelElement, 'projects');
		this.initializeHomeNavigationButton(this.artifactsButton, this.artifactsLabelElement, 'archive');
		this.initializeHomeNavigationButton(this.customizeButton, this.customizeLabelElement, 'customize');
		this.homeNavElement.append(
			this.newChatButton,
			this.projectsButton,
			this.artifactsButton,
			this.customizeButton,
		);
		this.recentsElement.append(this.recentsTitleElement, this.recentsBodyElement);
		this.homeSection.append(this.homeNavElement, this.recentsElement);
		this.tabListElement.append(this.homeTabButton, this.codeTabButton);
		this.titlebarElement.append(this.titlebarActionsElement);
		this.headerElement.append(this.tabListElement, this.tabActionsElement);
		this.contentElement.append(
			this.headerElement,
			this.contentHostElement,
			this.footerElement,
		);
		this.element.append(this.contentElement);
		this._register(addDisposableListener(this.newChatButton, EventType.CLICK, this.handleNewChatClick));
		this._register(this.sidebarEntryService.onDidChangeActiveEntry(() => this.syncTabs()));
		this._register(autorun(reader => {
			const activeSessionId = this.sessionsService.activeSession.read(reader)?.sessionId;
			this.recentSessionRows = this.sessionsManagementService.sessions.read(reader).map(session => ({
				session,
				title: session.title.read(reader),
				active: session.sessionId === activeSessionId,
			}));
			this.renderRecents();
		}));
		this.render();
	}

	private readonly handleHomeTabClick = () => {
		this.sidebarEntryService.activateEntry('home');
	};

	private readonly handleCodeTabClick = () => {
		this.sidebarEntryService.activateEntry('code');
	};

	private readonly handleNewChatClick = () => {
		void this.openNewSession();
	};

	private async openNewSession(): Promise<void> {
		if (this.sessionsManagementService.draftSession.get()) {
			this.sessionsService.openNewSession({ kind: OpenNewSessionKind.Empty });
			return;
		}

		const availableTypes = this.sessionsManagementService.sessionTypes.get()
			.filter(candidate => candidate.sessionType.supportsWorkspaceLess);
		if (availableTypes.length === 0) {
			this.notificationService.error(localize(
				'sessions.newSession.unavailable',
				"No workspace-less Session type is available.",
			));
			return;
		}

		let selectedType = availableTypes[0];
		if (availableTypes.length > 1) {
			const selection = await this.quickInputService.pick<ISessionTypeQuickPickItem, object>(
				availableTypes.map(sessionType => ({
					label: sessionType.sessionType.label,
					description: sessionType.providerId,
					sessionType,
				})),
				{
					title: localize('sessions.newSession.selectType', "Select a Session type"),
				},
			);
			if (!selection) {
				return;
			}
			selectedType = selection.sessionType;
		}

		this.sessionsService.openNewSession({
			kind: OpenNewSessionKind.Draft,
			providerId: selectedType.providerId,
			draft: {
				sessionType: selectedType.sessionType.id,
				workspace: { kind: SessionWorkspaceKind.WorkspaceLess },
			},
		});
	}

	getElement() {
		return this.element;
	}

	getTitlebarElement() {
		return this.titlebarElement;
	}

	setProps(props: SessionSidebarViewProps) {
		this.props = props;
		this.render();
	}

	override dispose() {
		this.element.replaceChildren();
		super.dispose();
	}

	private render() {
		const { labels } = this.props;
		const isCollapsed = this.props.isCollapsed;
		this.element.classList.toggle('comet-is-collapsed', isCollapsed);
		this.contentElement.hidden = isCollapsed;
		this.footerElement.hidden = isCollapsed;
		this.tabListElement.setAttribute('aria-label', labels.homeTitle);
		this.codeSection.setAttribute('aria-label', labels.codeTitle);
		this.renderHomeNav();
		this.renderRecents();
		this.syncTitlebarActions(this.props.titlebarActionsElement ?? null);
		this.syncFooterActions(this.props.footerActionsElement ?? null);
		this.syncTabs();
	}

	private syncFooterActions(footerActionsElement: HTMLElement | null) {
		const currentFooterActionsElement = this.footerElement.firstElementChild;
		if (footerActionsElement) {
			if (currentFooterActionsElement !== footerActionsElement) {
				this.footerElement.replaceChildren(footerActionsElement);
			}
			return;
		}

		if (currentFooterActionsElement) {
			this.footerElement.replaceChildren();
		}
	}

	//#region Sidebar titlebar actions

	private syncTitlebarActions(actionsElement: HTMLElement | null) {
		const currentActionsElement = this.titlebarActionsElement.firstElementChild;
		if (actionsElement) {
			if (currentActionsElement !== actionsElement) {
				this.titlebarActionsElement.replaceChildren(actionsElement);
			}
			return;
		}

		if (currentActionsElement) {
			this.titlebarActionsElement.replaceChildren();
		}
	}

	//#endregion

	private syncTabs() {
		const activeEntry = this.sidebarEntryService.getActiveEntry();
		const activeSection =
			activeEntry === 'home'
				? this.homeSection
				: this.codeSection;
		if (this.contentHostElement.firstElementChild !== activeSection) {
			this.contentHostElement.replaceChildren(activeSection);
		}

		const { labels } = this.props;
		this.renderTabButton(
			this.homeTabButton,
			labels.homeTitle,
			'home',
		);
		this.renderTabButton(
			this.codeTabButton,
			labels.codeTitle,
			'code',
		);
		this.syncTabButtonState(this.homeTabButton, activeEntry === 'home');
		this.syncTabButtonState(this.codeTabButton, activeEntry === 'code');

		if (this.tabActionsElement.firstElementChild) {
			this.tabActionsElement.replaceChildren();
		}
	}

	private syncTabButtonState(button: HTMLButtonElement, isActive: boolean) {
		button.classList.toggle('comet-is-active', isActive);
		button.setAttribute('aria-selected', String(isActive));
		button.tabIndex = isActive ? 0 : -1;
	}

	private renderHomeNav() {
		const { labels } = this.props;
		this.homeNavElement.setAttribute('aria-label', labels.homeTitle);
		this.renderHomeNavigationButton(this.newChatButton, this.newChatLabelElement, labels.homeNavNewChat);
		this.renderHomeNavigationButton(this.projectsButton, this.projectsLabelElement, labels.homeNavProjects);
		this.renderHomeNavigationButton(this.artifactsButton, this.artifactsLabelElement, labels.homeNavArtifacts);
		this.renderHomeNavigationButton(this.customizeButton, this.customizeLabelElement, labels.homeNavCustomize);
	}

	private renderRecents() {
		const { labels } = this.props;
		this.recentsTitleElement.textContent = labels.recentsTitle;
		this.recentsElement.setAttribute('aria-label', labels.recentsTitle);
		const buttons = new DisposableStore();
		this.recentButtons.value = buttons;
		const elements = this.recentSessionRows.map(row => {
			const button = buttons.add(createButtonView({
				className: row.active
					? 'comet-sidebar-recent-session comet-is-active'
					: 'comet-sidebar-recent-session',
				variant: 'ghost',
				size: 'sm',
				content: row.title,
				hover: row.title,
				ariaLabel: row.title,
				onClick: () => this.sessionsService.openSession(row.session.sessionId),
			}));
			const element = button.getElement();
			element.dataset.sessionId = row.session.sessionId;
			if (row.active) {
				element.setAttribute('aria-current', 'page');
			}
			return element;
		});
		this.recentsBodyElement.replaceChildren(...elements);
	}

	private initializeHomeNavigationButton(
		button: HTMLButtonElement,
		labelElement: HTMLSpanElement,
		iconName: LxIconName,
	): void {
		button.type = 'button';
		button.replaceChildren(createLxIcon(iconName, 'comet-sidebar-home-nav-icon'), labelElement);
	}

	private renderHomeNavigationButton(
		button: HTMLButtonElement,
		labelElement: HTMLSpanElement,
		label: string,
	): void {
		button.title = label;
		labelElement.textContent = label;
	}

	private renderTabButton(
		button: HTMLButtonElement,
		label: string,
		iconName: LxIconName,
	) {
		const labelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-tab-label');
		labelElement.textContent = label;
		button.replaceChildren(createLxIcon(iconName, 'comet-sidebar-tab-icon'), labelElement);
		button.title = label;
	}
}

export class SessionSidebarPartView extends Disposable {
	readonly id = SESSION_PART_IDS.sidebar;

	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-session-sidebar-part');
	private readonly sidebar: SessionSidebar;

	constructor(
		props: SessionSidebarViewProps,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this.sidebar = this._register(instantiationService.createInstance(SessionSidebar, props));
		this.element.append(
			this.sidebar.getTitlebarElement(),
			this.sidebar.getElement(),
		);
		this.syncCollapsedState(props);
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, this.element);
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionSidebarViewProps) {
		this.syncCollapsedState(props);
		this.sidebar.setProps(props);
	}

	override dispose() {
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, null);
		this.element.replaceChildren();
		super.dispose();
	}

	private syncCollapsedState(props: SessionSidebarViewProps) {
		this.element.classList.toggle('comet-is-collapsed', props.isCollapsed);
	}
}
