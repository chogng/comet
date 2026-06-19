import type {
  LibraryDocumentSummary,
  LibraryDocumentsResult,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { createActionBarView } from 'ls/base/browser/ui/actionbar/actionbar';
import { createLxIcon } from 'ls/base/browser/ui/lxicons/lxicons';
import type { LxIconName } from 'ls/base/browser/ui/lxicons/lxicons';
import { lxIconSemanticMap } from 'ls/base/browser/ui/lxicons/lxiconsSemantic';
import { LibraryView } from 'ls/workbench/contrib/knowledgeBase/browser/views/libraryView';
import {
  FetchPaneContentView,
  type FetchPaneProps,
  type SidebarLabels,
} from 'ls/workbench/browser/parts/sidebar/fetchPanePart';
import { getWindowChromeLayout } from 'ls/platform/window/common/window';

import 'ls/workbench/browser/parts/primarybar/media/primarybar.css';

const WINDOW_CHROME_LAYOUT = getWindowChromeLayout();

export type PrimaryBarLabels = SidebarLabels;

export type PrimaryBarProps = {
  mode?: 'content' | 'settings';
  labels: PrimaryBarLabels;
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
  topbarActionsElement?: HTMLElement | null;
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

type PrimaryBarContentTab = 'library' | 'fetch';

export class PrimaryBar {
  private props: PrimaryBarProps;
  private readonly element = createElement('div', 'primarybar-root');
  private readonly topbarElement = createElement(
    'div',
    'primarybar-topbar',
  );
  private readonly leadingWindowControlsSpacer = createElement(
    'div',
    'primarybar-topbar-window-controls-spacer',
  );
  private readonly contentElement = createElement('div', 'primarybar-content');
  private readonly footerElement = createElement(
    'footer',
    'primarybar-footer',
  );
  private readonly switcherElement = createElement('div', 'primarybar-switcher');
  private readonly tabListElement = createElement('div', 'primarybar-tab-list');
  private readonly libraryTabButton = createElement('button', 'primarybar-tab');
  private readonly fetchTabButton = createElement('button', 'primarybar-tab');
  private readonly tabActionsElement = createElement('div', 'primarybar-tab-actions');
  private readonly contentHostElement = createElement('div', 'primarybar-content-host');
  private readonly librarySection = createElement(
    'section',
    'primarybar-tab-panel primarybar-library-panel',
  );
  private readonly fetchSection = createElement(
    'section',
    'primarybar-tab-panel primarybar-fetch-panel',
  );
  private readonly fetchActionsView = createActionBarView({
    className: 'primarybar-tab-actionbar fetch-pane-actionbar',
    ariaRole: 'group',
  });
  private readonly libraryView: LibraryView;
  private readonly fetchContentView: FetchPaneContentView;
  private activeTab: PrimaryBarContentTab = 'library';
  private disposed = false;

  constructor(props: PrimaryBarProps) {
    this.props = props;
    this.tabListElement.setAttribute('role', 'tablist');
    this.tabListElement.setAttribute('aria-label', props.labels.libraryTitle);
    this.libraryTabButton.type = 'button';
    this.fetchTabButton.type = 'button';
    this.libraryTabButton.setAttribute('role', 'tab');
    this.fetchTabButton.setAttribute('role', 'tab');
    this.libraryTabButton.classList.add('primarybar-library-tab');
    this.fetchTabButton.classList.add('primarybar-fetch-tab');
    this.librarySection.id = `primarybar-library-panel-${Math.random()
      .toString(36)
      .slice(2)}`;
    this.fetchSection.id = `primarybar-fetch-panel-${Math.random()
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
    if (WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx > 0) {
      this.leadingWindowControlsSpacer.style.setProperty(
        '--window-controls-width',
        `${WINDOW_CHROME_LAYOUT.leadingWindowControlsWidthPx}px`,
      );
      this.topbarElement.append(this.leadingWindowControlsSpacer);
    }
    this.contentElement.append(this.contentHostElement);
    this.element.append(
      this.topbarElement,
      this.switcherElement,
      this.contentElement,
      this.footerElement,
    );
    this.render();
  }

  getElement() {
    return this.element;
  }

  setProps(props: PrimaryBarProps) {
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
    this.fetchActionsView.dispose();
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
    this.syncTopbarActions(this.props.topbarActionsElement ?? null);
    this.syncFooterActions(this.props.footerActionsElement ?? null);
    const selectionButtonLabel =
      this.props.fetchPaneProps.selectionModePhase === 'off'
        ? labels.selectionModeEnterMulti
        : this.props.fetchPaneProps.selectionModePhase === 'multi'
          ? labels.selectionModeSelectAll
          : labels.selectionModeExit;
    this.fetchActionsView.setProps({
      className: 'primarybar-tab-actionbar fetch-pane-actionbar',
      ariaRole: 'group',
      items: [
        {
          label: selectionButtonLabel,
          title: selectionButtonLabel,
          mode: 'icon',
          active: this.props.fetchPaneProps.isSelectionModeEnabled,
          checked: this.props.fetchPaneProps.isSelectionModeEnabled,
          disabled:
            !this.props.fetchPaneProps.articles.length &&
            !this.props.fetchPaneProps.isSelectionModeEnabled,
          buttonClassName: 'fetch-pane-select-action',
          content: createLxIcon(lxIconSemanticMap.sidebar.selectionMode),
          onClick: () => this.props.fetchPaneProps.onToggleSelectionMode(),
        },
        {
          label: this.props.fetchPaneProps.isFetchLoading
            ? labels.fetchLatestBusy
            : labels.fetchLatest,
          title: this.props.fetchPaneProps.isFetchLoading
            ? labels.fetchLatestBusy
            : labels.fetchLatest,
          mode: 'icon',
          disabled: this.props.fetchPaneProps.isFetchLoading,
          buttonClassName: 'sidebar-fetch-btn fetch-pane-trigger-btn',
          content: createLxIcon(
            this.props.fetchPaneProps.isFetchLoading ? 'sync' : lxIconSemanticMap.fetch.batchDownload,
          ),
          onClick: () => this.props.fetchPaneProps.onFetch(),
        },
      ],
    });
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

  private syncTopbarActions(topbarActionsElement: HTMLElement | null) {
    const currentTopbarActionsElement = this.topbarElement.querySelector(
      '.sidebar-topbar-actions-host',
    );
    if (topbarActionsElement) {
      if (currentTopbarActionsElement !== topbarActionsElement) {
        currentTopbarActionsElement?.remove();
        this.topbarElement.append(topbarActionsElement);
      }
      return;
    }

    currentTopbarActionsElement?.remove();
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

  private setActiveTab(tab: PrimaryBarContentTab) {
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

    if (!isLibraryActive) {
      if (this.tabActionsElement.firstElementChild !== this.fetchActionsView.getElement()) {
        this.tabActionsElement.replaceChildren(this.fetchActionsView.getElement());
      }
      return;
    }

    if (this.tabActionsElement.firstElementChild) {
      this.tabActionsElement.replaceChildren();
    }
  }

  private renderTabButton(
    button: HTMLButtonElement,
    label: string,
    iconName: LxIconName,
  ) {
    const labelElement = createElement('span', 'primarybar-tab-label');
    labelElement.textContent = label;
    button.replaceChildren(createLxIcon(iconName, 'primarybar-tab-icon'), labelElement);
    button.title = label;
  }
}

export function createPrimaryBar(props: PrimaryBarProps) {
  return new PrimaryBar(props);
}

export default PrimaryBar;
