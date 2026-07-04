import type {
	LibraryDocumentSummary,
	LibraryDocumentsResult,
} from 'cs/base/parts/sandbox/common/sandboxTypes';
import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { WORKBENCH_PART_IDS, registerWorkbenchPartDomNode } from 'cs/workbench/browser/layout';
import { LibraryView } from 'cs/workbench/contrib/knowledgeBase/browser/views/libraryView';
import {
	FetchPaneContentView,
	type FetchPaneProps,
	type SidebarLabels as FetchPaneSidebarLabels,
} from 'cs/workbench/browser/parts/sidebar/fetchPanePart';
import { SESSION_PART_IDS } from 'cs/sessions/browser/parts/parts';

import 'cs/workbench/browser/parts/sidebar/media/sidebar.css';
import 'cs/sessions/browser/parts/sidebar/media/sidebarPart.css';

export type SessionSidebarLabels = FetchPaneSidebarLabels;

export type SessionSidebarProps = {
	mode?: 'content' | 'settings';
	labels: SessionSidebarLabels;
	accountLabel?: string;
	moreLabel?: string;
	settingsLabel?: string;
	fetchPaneProps: FetchPaneProps;
	librarySnapshot: LibraryDocumentsResult;
	isLibraryLoading: boolean;
	onRefreshLibrary?: () => void;
	onDownloadPdf?: () => void;
	onDocumentDragStart?: (documentId: string) => void;
	onDocumentSelect?: (document: LibraryDocumentSummary | null) => void;
	onDocumentOpen?: (document: LibraryDocumentSummary) => void;
	onDocumentRename?: (document: LibraryDocumentSummary) => void;
	onDocumentEditSourceUrl?: (document: LibraryDocumentSummary) => void;
	onDocumentDelete?: (document: LibraryDocumentSummary) => void;
	settingsNavigationElement?: HTMLElement | null;
	footerActionsElement?: HTMLElement | null;
};

type SessionSidebarContentTab = 'library' | 'fetch';

let panelIdPool = 0;

function createElement<K extends keyof HTMLElementTagNameMap>(
	tagName: K,
	className?: string,
) {
	const element = document.createElement(tagName);
	if (className) {
		element.className = className;
	}
	return element;
}

export class SessionSidebar {
	private props: SessionSidebarProps;
	private readonly element = createElement(
		'div',
		'session-sidebar-root sidebar-root',
	);
	private readonly contentElement = createElement('div', 'sidebar-content');
	private readonly footerElement = createElement(
		'footer',
		'sidebar-footer',
	);
	private readonly switcherElement = createElement('div', 'sidebar-switcher');
	private readonly tabListElement = createElement('div', 'sidebar-tab-list');
	private readonly libraryTabButton = createElement('button', 'sidebar-tab');
	private readonly fetchTabButton = createElement('button', 'sidebar-tab');
	private readonly tabActionsElement = createElement('div', 'sidebar-tab-actions');
	private readonly contentHostElement = createElement('div', 'sidebar-content-host');
	private readonly librarySection = createElement(
		'section',
		'sidebar-tab-panel sidebar-library-panel',
	);
	private readonly fetchSection = createElement(
		'section',
		'sidebar-tab-panel sidebar-fetch-panel',
	);
	private readonly libraryView: LibraryView;
	private readonly fetchContentView: FetchPaneContentView;
	private activeTab: SessionSidebarContentTab = 'library';
	private disposed = false;

	constructor(props: SessionSidebarProps) {
		this.props = props;
		this.tabListElement.setAttribute('role', 'tablist');
		this.tabListElement.setAttribute('aria-label', props.labels.libraryTitle);
		this.libraryTabButton.type = 'button';
		this.fetchTabButton.type = 'button';
		this.libraryTabButton.setAttribute('role', 'tab');
		this.fetchTabButton.setAttribute('role', 'tab');
		this.libraryTabButton.classList.add('sidebar-library-tab');
		this.fetchTabButton.classList.add('sidebar-fetch-tab');
		this.librarySection.id = `session-sidebar-library-panel-${panelIdPool}`;
		this.fetchSection.id = `session-sidebar-fetch-panel-${panelIdPool}`;
		panelIdPool += 1;
		this.libraryTabButton.setAttribute('aria-controls', this.librarySection.id);
		this.fetchTabButton.setAttribute('aria-controls', this.fetchSection.id);
		this.libraryTabButton.addEventListener('click', () => this.setActiveTab('library'));
		this.fetchTabButton.addEventListener('click', () => this.setActiveTab('fetch'));
		this.tabListElement.addEventListener('keydown', event => {
			if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
				return;
			}

			event.preventDefault();
			this.setActiveTab(this.activeTab === 'library' ? 'fetch' : 'library');
		});
		this.libraryView = new LibraryView({
			labels: props.labels,
			librarySnapshot: props.librarySnapshot,
			onDocumentDragStart: props.onDocumentDragStart,
			onDocumentSelect: props.onDocumentSelect,
			onDocumentOpen: props.onDocumentOpen,
			onDocumentRename: props.onDocumentRename,
			onDocumentEditSourceUrl: props.onDocumentEditSourceUrl,
			onDocumentDelete: props.onDocumentDelete,
		});
		this.fetchContentView = new FetchPaneContentView({
			...props.fetchPaneProps,
			labels: props.labels,
		});
		this.librarySection.append(this.libraryView.getElement());
		this.fetchSection.append(this.fetchContentView.getElement());
		this.tabListElement.append(this.libraryTabButton, this.fetchTabButton);
		this.switcherElement.append(this.tabListElement, this.tabActionsElement);
		this.contentElement.append(this.contentHostElement);
		this.element.append(
			this.switcherElement,
			this.contentElement,
			this.footerElement,
		);
		this.render();
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionSidebarProps) {
		if (this.disposed) {
			return;
		}

		this.props = props;
		this.libraryView.setProps({
			labels: props.labels,
			librarySnapshot: props.librarySnapshot,
			onDocumentDragStart: props.onDocumentDragStart,
			onDocumentSelect: props.onDocumentSelect,
			onDocumentOpen: props.onDocumentOpen,
			onDocumentRename: props.onDocumentRename,
			onDocumentEditSourceUrl: props.onDocumentEditSourceUrl,
			onDocumentDelete: props.onDocumentDelete,
		});
		this.fetchContentView.setProps({
			...props.fetchPaneProps,
			labels: props.labels,
		});
		this.render();
	}

	dispose() {
		if (this.disposed) {
			return;
		}

		this.disposed = true;
		this.libraryView.dispose();
		this.fetchContentView.dispose();
		this.element.replaceChildren();
	}

	private render() {
		const { labels } = this.props;
		this.libraryTabButton.textContent = labels.libraryTitle;
		this.fetchTabButton.textContent = labels.fetchTitle;
		this.tabListElement.setAttribute(
			'aria-label',
			`${labels.libraryTitle} / ${labels.fetchTitle}`,
		);
		this.syncModeContent();
		this.syncFooterActions(this.props.footerActionsElement ?? null);
		this.syncTabs();
	}

	private syncModeContent() {
		if (this.props.mode === 'settings') {
			this.switcherElement.hidden = true;
			const settingsNavigationElement = this.props.settingsNavigationElement ?? null;
			if (settingsNavigationElement) {
				if (this.contentElement.firstElementChild !== settingsNavigationElement) {
					this.contentElement.replaceChildren(settingsNavigationElement);
				}
			} else if (this.contentElement.firstElementChild) {
				this.contentElement.replaceChildren();
			}
			return;
		}

		this.switcherElement.hidden = false;
		if (this.contentElement.firstElementChild !== this.contentHostElement) {
			this.contentElement.replaceChildren(this.contentHostElement);
		}
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

	private setActiveTab(tab: SessionSidebarContentTab) {
		if (this.disposed || this.activeTab === tab) {
			return;
		}

		this.activeTab = tab;
		this.syncTabs();
	}

	private syncTabs() {
		if (this.props.mode === 'settings') {
			return;
		}

		if (this.contentElement.firstElementChild !== this.contentHostElement) {
			return;
		}

		const activePanel =
			this.activeTab === 'library' ? this.librarySection : this.fetchSection;
		if (this.contentHostElement.firstElementChild !== activePanel) {
			this.contentHostElement.replaceChildren(activePanel);
		}

		const isLibraryActive = this.activeTab === 'library';
		const { labels } = this.props;
		this.renderTabButton(
			this.libraryTabButton,
			labels.libraryTitle,
			isLibraryActive ? 'projects-filled' : 'projects',
		);
		this.renderTabButton(
			this.fetchTabButton,
			labels.fetchTitle,
			isLibraryActive ? 'customize' : 'customize-filled',
		);
		this.libraryTabButton.classList.toggle('is-active', isLibraryActive);
		this.fetchTabButton.classList.toggle('is-active', !isLibraryActive);
		this.libraryTabButton.setAttribute('aria-selected', String(isLibraryActive));
		this.fetchTabButton.setAttribute('aria-selected', String(!isLibraryActive));
		this.libraryTabButton.tabIndex = isLibraryActive ? 0 : -1;
		this.fetchTabButton.tabIndex = isLibraryActive ? -1 : 0;

		if (this.tabActionsElement.firstElementChild) {
			this.tabActionsElement.replaceChildren();
		}
	}

	private renderTabButton(
		button: HTMLButtonElement,
		label: string,
		iconName: LxIconName,
	) {
		const labelElement = createElement('span', 'sidebar-tab-label');
		labelElement.textContent = label;
		button.replaceChildren(createLxIcon(iconName, 'sidebar-tab-icon'), labelElement);
		button.title = label;
	}
}

export class SessionSidebarPartView {
	readonly id = SESSION_PART_IDS.sidebar;

	private readonly element = createElement(
		'section',
		'session-sidebar-part',
	);
	private readonly sidebar: SessionSidebar;

	constructor(props: SessionSidebarProps) {
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, this.element);
		this.sidebar = new SessionSidebar(props);
		this.element.append(this.sidebar.getElement());
	}

	getElement() {
		return this.element;
	}

	setProps(props: SessionSidebarProps) {
		this.sidebar.setProps(props);
	}

	dispose() {
		this.sidebar.dispose();
		registerWorkbenchPartDomNode(WORKBENCH_PART_IDS.sidebar, null);
		this.element.replaceChildren();
	}
}

export function createSessionSidebarPartView(props: SessionSidebarProps) {
	return new SessionSidebarPartView(props);
}
