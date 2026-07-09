import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import {
  FetchPaneContentView,
  type FetchPaneProps,
  type SidebarLabels as FetchPaneSidebarLabels,
} from 'cs/workbench/browser/parts/sidebar/fetchPanePart';
import { $ } from 'cs/base/browser/dom';

import 'cs/workbench/browser/parts/sidebar/media/sidebar.css';

export type SidebarLabels = FetchPaneSidebarLabels;

export type SidebarProps = {
  labels: SidebarLabels;
  accountLabel?: string;
  moreLabel?: string;
  settingsLabel?: string;
  fetchPaneProps: FetchPaneProps;
  footerActionsElement?: HTMLElement | null;
};

type SidebarContentTab = 'home' | 'fetch';

export class Sidebar {
  private props: SidebarProps;
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-root');
  private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-content');
  private readonly footerElement = $<HTMLElementTagNameMap['footer']>('footer.comet-sidebar-footer');
  private readonly switcherElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-switcher');
  private readonly tabListElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-tab-list');
  private readonly homeTabButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-tab');
  private readonly fetchTabButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-tab');
  private readonly tabActionsElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-tab-actions');
  private readonly contentHostElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-content-host');
  private readonly homeSection = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-tab-panel.comet-sidebar-home-panel');
  private readonly homeNavElement = $<HTMLElementTagNameMap['nav']>('nav.comet-sidebar-home-nav');
  private readonly recentsElement = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-recents');
  private readonly fetchSection = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-tab-panel.comet-sidebar-fetch-panel');
  private readonly fetchContentView: FetchPaneContentView;
  private activeTab: SidebarContentTab = 'home';
  private disposed = false;

  constructor(props: SidebarProps) {
    this.props = props;
    this.tabListElement.setAttribute('role', 'tablist');
    this.tabListElement.setAttribute('aria-label', props.labels.homeTitle);
    this.homeTabButton.type = 'button';
    this.fetchTabButton.type = 'button';
    this.homeTabButton.setAttribute('role', 'tab');
    this.fetchTabButton.setAttribute('role', 'tab');
    this.homeTabButton.classList.add('comet-sidebar-home-tab');
    this.fetchTabButton.classList.add('comet-sidebar-fetch-tab');
    this.homeSection.id = `comet-sidebar-home-panel-${Math.random()
      .toString(36)
      .slice(2)}`;
    this.fetchSection.id = `comet-sidebar-fetch-panel-${Math.random()
      .toString(36)
      .slice(2)}`;
    this.homeTabButton.setAttribute('aria-controls', this.homeSection.id);
    this.fetchTabButton.setAttribute('aria-controls', this.fetchSection.id);
    this.homeTabButton.addEventListener('click', () => this.setActiveTab('home'));
    this.fetchTabButton.addEventListener('click', () => this.setActiveTab('fetch'));
    this.tabListElement.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
        return;
      }

      event.preventDefault();
      this.setActiveTab(this.activeTab === 'home' ? 'fetch' : 'home');
    });
    this.fetchContentView = new FetchPaneContentView({
      ...props.fetchPaneProps,
      labels: props.labels,
    });
    this.homeSection.append(this.homeNavElement, this.recentsElement);
    this.fetchSection.append(this.fetchContentView.getElement());
    this.tabListElement.append(this.homeTabButton, this.fetchTabButton);
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
    this.fetchContentView.dispose();
    this.element.replaceChildren();
  }

  private render() {
    const { labels } = this.props;
    this.homeTabButton.textContent = labels.homeTitle;
    this.fetchTabButton.textContent = labels.fetchTitle;
    this.tabListElement.setAttribute(
      'aria-label',
      `${labels.homeTitle} / ${labels.fetchTitle}`,
    );
    this.renderHomeNav();
    this.renderRecents();
    this.syncModeContent();
    this.syncFooterActions(this.props.footerActionsElement ?? null);
    this.syncTabs();
  }

  private syncModeContent() {
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
    if (this.contentElement.firstElementChild !== this.contentHostElement) {
      return;
    }

    const activePanel =
      this.activeTab === 'home' ? this.homeSection : this.fetchSection;
    if (this.contentHostElement.firstElementChild !== activePanel) {
      this.contentHostElement.replaceChildren(activePanel);
    }

    const isHomeActive = this.activeTab === 'home';
    const { labels } = this.props;
    this.renderTabButton(
      this.homeTabButton,
      labels.homeTitle,
      isHomeActive ? 'projects-filled' : 'projects',
    );
    this.renderTabButton(
      this.fetchTabButton,
      labels.fetchTitle,
      isHomeActive ? 'customize' : 'customize-filled',
    );
    this.homeTabButton.classList.toggle('comet-is-active', isHomeActive);
    this.fetchTabButton.classList.toggle('comet-is-active', !isHomeActive);
    this.homeTabButton.setAttribute('aria-selected', String(isHomeActive));
    this.fetchTabButton.setAttribute('aria-selected', String(!isHomeActive));
    this.homeTabButton.tabIndex = isHomeActive ? 0 : -1;
    this.fetchTabButton.tabIndex = isHomeActive ? -1 : 0;

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

export function createSidebar(props: SidebarProps) {
  return new Sidebar(props);
}

export default Sidebar;
