import { createLxIcon } from 'cs/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'cs/base/browser/ui/lxicons/lxicons';
import { $ } from 'cs/base/browser/dom';

import 'cs/workbench/browser/parts/sidebar/media/sidebar.css';

export type SidebarLabels = {
  homeTitle: string;
  homeNavNewChat: string;
  homeNavProjects: string;
  homeNavArtifacts: string;
  homeNavCustomize: string;
  recentsTitle: string;
};

export type SidebarProps = {
  labels: SidebarLabels;
  accountLabel?: string;
  moreLabel?: string;
  settingsLabel?: string;
  footerActionsElement?: HTMLElement | null;
};

export class Sidebar {
  private props: SidebarProps;
  private readonly element = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-root');
  private readonly contentElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-content');
  private readonly footerElement = $<HTMLElementTagNameMap['footer']>('footer.comet-sidebar-footer');
  private readonly switcherElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-switcher');
  private readonly tabListElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-tab-list');
  private readonly homeTabButton = $<HTMLElementTagNameMap['button']>('button.comet-sidebar-tab');
  private readonly tabActionsElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-tab-actions');
  private readonly contentHostElement = $<HTMLElementTagNameMap['div']>('div.comet-sidebar-content-host');
  private readonly homeSection = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-tab-panel.comet-sidebar-home-panel');
  private readonly homeNavElement = $<HTMLElementTagNameMap['nav']>('nav.comet-sidebar-home-nav');
  private readonly recentsElement = $<HTMLElementTagNameMap['section']>('section.comet-sidebar-recents');
  private disposed = false;

  constructor(props: SidebarProps) {
    this.props = props;
    this.tabListElement.setAttribute('role', 'tablist');
    this.tabListElement.setAttribute('aria-label', props.labels.homeTitle);
    this.homeTabButton.type = 'button';
    this.homeTabButton.setAttribute('role', 'tab');
    this.homeTabButton.classList.add('comet-sidebar-home-tab');
    this.homeSection.id = `comet-sidebar-home-panel-${Math.random()
      .toString(36)
      .slice(2)}`;
    this.homeTabButton.setAttribute('aria-controls', this.homeSection.id);
    this.homeSection.append(this.homeNavElement, this.recentsElement);
    this.tabListElement.append(this.homeTabButton);
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
    this.homeTabButton.textContent = labels.homeTitle;
    this.tabListElement.setAttribute('aria-label', labels.homeTitle);
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

  private syncTabs() {
    if (this.contentElement.firstElementChild !== this.contentHostElement) {
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

export function createSidebar(props: SidebarProps) {
  return new Sidebar(props);
}

export default Sidebar;
