import type {
  LibraryDocumentSummary,
  LibraryDocumentsResult,
} from 'ls/base/parts/sandbox/common/sandboxTypes';
import { createLxIcon } from 'ls/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'ls/base/browser/ui/lxicons/lxicons';
import { LibraryView } from 'ls/workbench/contrib/knowledgeBase/browser/views/libraryView';
import {
  FetchPaneContentView,
  type FetchPaneProps,
  type SidebarLabels as FetchPaneSidebarLabels,
} from 'ls/workbench/browser/parts/sidebar/fetchPanePart';

import 'ls/workbench/browser/parts/sidebar/media/sidebar.css';

export type SidebarLabels = FetchPaneSidebarLabels;

export type SidebarProps = {
  mode?: 'content' | 'settings';
  labels: SidebarLabels;
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

type SidebarContentTab = 'library' | 'fetch';

export class Sidebar {
  private props: SidebarProps;
  private readonly element = createElement('div', 'sidebar-root');
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
  private activeTab: SidebarContentTab = 'library';
  private disposed = false;

  constructor(props: SidebarProps) {
    this.props = props;
    this.tabListElement.setAttribute('role', 'tablist');
    this.tabListElement.setAttribute('aria-label', props.labels.libraryTitle);
    this.libraryTabButton.type = 'button';
    this.fetchTabButton.type = 'button';
    this.libraryTabButton.setAttribute('role', 'tab');
    this.fetchTabButton.setAttribute('role', 'tab');
    this.libraryTabButton.classList.add('sidebar-library-tab');
    this.fetchTabButton.classList.add('sidebar-fetch-tab');
    this.librarySection.id = `sidebar-library-panel-${Math.random()
      .toString(36)
      .slice(2)}`;
    this.fetchSection.id = `sidebar-fetch-panel-${Math.random()
      .toString(36)
      .slice(2)}`;
    this.libraryTabButton.setAttribute('aria-controls', this.librarySection.id);
    this.fetchTabButton.setAttribute('aria-controls', this.fetchSection.id);
    this.libraryTabButton.addEventListener('click', () => this.setActiveTab('library'));
    this.fetchTabButton.addEventListener('click', () => this.setActiveTab('fetch'));
    this.tabListElement.addEventListener('keydown', (event) => {
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

  setProps(props: SidebarProps) {
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

  private setActiveTab(tab: SidebarContentTab) {
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

export function createSidebar(props: SidebarProps) {
  return new Sidebar(props);
}

export default Sidebar;
