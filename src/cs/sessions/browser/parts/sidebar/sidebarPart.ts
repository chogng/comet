import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';
import { $ } from 'cs/base/browser/dom';

import 'cs/workbench/browser/parts/sidebar/media/sidebar.css';
import 'cs/sessions/browser/parts/sidebar/media/sidebarPart.css';

export type SessionSidebarLabels = {
	homeTitle: string;
	homeNavNewChat: string;
	homeNavProjects: string;
	homeNavArtifacts: string;
	homeNavCustomize: string;
	recentsTitle: string;
};

export type SessionSidebarProps = {
	labels: SessionSidebarLabels;
	accountLabel?: string;
	moreLabel?: string;
	settingsLabel?: string;
	titlebarActionsElement?: HTMLElement | null;
	footerActionsElement?: HTMLElement | null;
};

export type SessionSidebarViewProps = SessionSidebarProps & {
	isCollapsed: boolean;
};

let panelIdPool = 0;

export class SessionSidebar {
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
	private readonly tabActionsElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-tab-actions');

	//#endregion

	private readonly contentHostElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-content-host');
	private readonly homeSection = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-tab-panel.comet-sidebar-home-panel');
	private readonly homeNavElement = $<HTMLElementTagNameMap['nav']>('nav.comet-sidebar-home-nav');
	private readonly recentsElement = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-recents');
	private disposed = false;

	constructor(props: SessionSidebarViewProps) {
		this.props = props;
		this.tabListElement.setAttribute('role', 'tablist');
		this.tabListElement.setAttribute('aria-label', props.labels.homeTitle);
		this.homeTabButton.type = 'button';
		this.homeTabButton.setAttribute('role', 'tab');
		this.homeTabButton.classList.add('comet-sidebar-home-tab');
		this.homeSection.id = `session-sidebar-home-panel-${panelIdPool}`;
		panelIdPool += 1;
		this.homeTabButton.setAttribute('aria-controls', this.homeSection.id);
		this.homeSection.append(this.homeNavElement, this.recentsElement);
		this.tabListElement.append(this.homeTabButton);
		this.titlebarElement.append(this.titlebarActionsElement);
		this.headerElement.append(this.tabListElement, this.tabActionsElement);
		this.contentElement.append(
			this.headerElement,
			this.contentHostElement,
			this.footerElement,
		);
		this.element.append(this.contentElement);
		this.render();
	}

	getElement() {
		return this.element;
	}

	getTitlebarElement() {
		return this.titlebarElement;
	}

	setProps(props: SessionSidebarViewProps) {
		if (this.disposed) {
			return;
		}

		this.props = props;
		this.render();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.element.replaceChildren();
	}

	private render() {
		const { labels } = this.props;
		const isCollapsed = this.props.isCollapsed;
		this.element.classList.toggle('comet-is-collapsed', isCollapsed);
		this.contentElement.hidden = isCollapsed;
		this.footerElement.hidden = isCollapsed;
		this.homeTabButton.textContent = labels.homeTitle;
		this.tabListElement.setAttribute('aria-label', labels.homeTitle);
		this.renderHomeNav();
		this.renderRecents();
		this.syncModeContent();
		this.syncTitlebarActions(this.props.titlebarActionsElement ?? null);
		this.syncFooterActions(this.props.footerActionsElement ?? null);
		this.syncTabs();
	}

	private syncModeContent() {
		this.headerElement.hidden = false;
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
		if (!this.contentHostElement.isConnected) {
			return;
		}

		if (this.contentHostElement.firstElementChild !== this.homeSection) {
			this.contentHostElement.replaceChildren(this.homeSection);
		}

		const { labels } = this.props;
		this.renderTabButton(
			this.homeTabButton,
			labels.homeTitle,
			'projects-filled',
		);
		this.homeTabButton.classList.add('comet-is-active');
		this.homeTabButton.setAttribute('aria-selected', 'true');
		this.homeTabButton.tabIndex = 0;

		if (this.tabActionsElement.firstElementChild) {
			this.tabActionsElement.replaceChildren();
		}
	}

	private renderHomeNav() {
		const { labels } = this.props;
		const homeNavItems: { label: string; iconName: LxIconName }[] = [
			{ label: labels.homeNavNewChat, iconName: 'add' },
			{ label: labels.homeNavProjects, iconName: 'projects' },
			{ label: labels.homeNavArtifacts, iconName: 'archive' },
			{ label: labels.homeNavCustomize, iconName: 'customize' },
		];
		this.homeNavElement.setAttribute('aria-label', labels.homeTitle);
		this.homeNavElement.replaceChildren(
			...homeNavItems.map(({ label, iconName }) => {
				const button = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-home-nav-item');
				button.type = 'button';
				button.title = label;
				const labelElement = $<HTMLElementTagNameMap['span']>('span.comet-sidebar-home-nav-label');
				labelElement.textContent = label;
				button.replaceChildren(createLxIcon(iconName, 'comet-sidebar-home-nav-icon'), labelElement);
				return button;
			}),
		);
	}

	private renderRecents() {
		const { labels } = this.props;
		const titleElement = $<HTMLElementTagNameMap['h2']>('h2.comet-sidebar-recents-title');
		titleElement.textContent = labels.recentsTitle;
		const bodyElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-recents-body');
		this.recentsElement.setAttribute('aria-label', labels.recentsTitle);
		this.recentsElement.replaceChildren(titleElement, bodyElement);
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

export class SessionSidebarPartView {
	readonly id = SESSION_PART_IDS.sidebar;

	private readonly element = $<HTMLElementTagNameMap['section']>('section.comet-session-sidebar-part');
	private readonly sidebar: SessionSidebar;

	constructor(props: SessionSidebarViewProps) {
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, this.element);
		this.sidebar = new SessionSidebar(props);
		this.element.append(
			this.sidebar.getTitlebarElement(),
			this.sidebar.getElement(),
		);
		this.syncCollapsedState(props);
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionSidebarViewProps) {
		this.syncCollapsedState(props);
		this.sidebar.setProps(props);
	}

	dispose() {
		this.sidebar.dispose();
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, null);
		this.element.replaceChildren();
	}

	private syncCollapsedState(props: SessionSidebarViewProps) {
		this.element.classList.toggle('comet-is-collapsed', props.isCollapsed);
	}
}

export function createSessionSidebarPartView(props: SessionSidebarViewProps) {
	return new SessionSidebarPartView(props);
}
