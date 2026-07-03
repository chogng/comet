import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import type { SidebarProps } from 'ls/workbench/browser/parts/sidebar/sidebar';

let cleanupDomEnvironment: (() => void) | null = null;
let createSidebar: typeof import('ls/workbench/browser/parts/sidebar/sidebar').createSidebar;
let SidebarFooterActionsView: typeof import('ls/workbench/browser/parts/sidebar/sidebarFooterActions').SidebarFooterActionsView;

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProps(): SidebarProps {
  const labels = {
    libraryTitle: 'Library',
    fetchTitle: 'Fetch',
    selectionModeEnterMulti: 'Select multiple',
    selectionModeSelectAll: 'Select all',
    selectionModeExit: 'Exit selection',
    fetchLatest: 'Fetch latest',
    fetchLatestBusy: 'Fetching latest',
  } as SidebarProps['labels'];

  const fetchPaneProps = {
    articles: [],
    hasData: false,
    locale: 'en',
    labels,
    onFocusWebUrlInput: () => {},
    fetchStartDate: '',
    onFetchStartDateChange: () => {},
    fetchEndDate: '',
    onFetchEndDateChange: () => {},
    onFetch: () => {},
    onDownloadPdf: async () => {},
    onOpenArticleDetails: () => {},
    isFetchLoading: false,
    isSelectionModeEnabled: false,
    selectionModePhase: 'off',
    selectedArticleKeys: new Set<string>(),
    onToggleSelectionMode: () => {},
    onToggleArticleSelected: () => {},
  } as SidebarProps['fetchPaneProps'];

  return {
    labels,
    fetchPaneProps,
    librarySnapshot: {
      items: [],
      totalCount: 0,
      fileCount: 0,
      queuedJobCount: 0,
      libraryDbFile: '',
      defaultManagedDirectory: '',
      ragCacheDir: '',
    },
    isLibraryLoading: false,
  };
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createSidebar } = await import('ls/workbench/browser/parts/sidebar/sidebar'));
  ({ SidebarFooterActionsView } = await import('ls/workbench/browser/parts/sidebar/sidebarFooterActions'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('sidebar renders without a topbar', () => {
  const sidebar = createSidebar(createProps());
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    assert.equal(element.querySelector('.sidebar-topbar'), null);
    assert.equal(element.firstElementChild, element.querySelector('.sidebar-switcher'));
  } finally {
    sidebar.dispose();
  }
});

test('sidebar renders library and fetch as switcher tabs', () => {
  const props = createProps();
  props.fetchPaneProps.articles = [
    {
      title: 'Example article',
      articleType: 'Article',
      doi: null,
      authors: [],
      abstractText: null,
      descriptionText: null,
      publishedAt: '2026-07-01',
      sourceUrl: 'https://www.nature.com/articles/example',
      fetchedAt: '2026-07-03T00:00:00.000Z',
      journalTitle: 'Research Articles',
    },
  ];
  const sidebar = createSidebar(props);
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const libraryTab = element.querySelector('.sidebar-library-tab');
    const fetchTab = element.querySelector('.sidebar-fetch-tab');
    assert(libraryTab instanceof HTMLButtonElement);
    assert(fetchTab instanceof HTMLButtonElement);
    assert.equal(libraryTab.textContent, 'Library');
    assert.equal(fetchTab.textContent, 'Fetch');
    assert(libraryTab.querySelector('.lx-icon-projects-filled') instanceof HTMLElement);
    assert(fetchTab.querySelector('.lx-icon-customize') instanceof HTMLElement);
    assert.equal(libraryTab.getAttribute('aria-selected'), 'true');
    assert.equal(fetchTab.getAttribute('aria-selected'), 'false');
    assert(element.querySelector('.sidebar-library-panel') instanceof HTMLElement);
    assert.equal(element.querySelector('.sidebar-fetch-panel'), null);
    assert.equal(element.querySelector('.sidebar-tab-actions .fetch-pane-actionbar'), null);

    fetchTab.click();

    assert.equal(libraryTab.getAttribute('aria-selected'), 'false');
    assert.equal(fetchTab.getAttribute('aria-selected'), 'true');
    assert(libraryTab.querySelector('.lx-icon-projects') instanceof HTMLElement);
    assert(fetchTab.querySelector('.lx-icon-customize-filled') instanceof HTMLElement);
    assert(element.querySelector('.sidebar-fetch-panel') instanceof HTMLElement);
    assert.equal(element.querySelector('.sidebar-library-panel'), null);
    assert.equal(element.querySelector('.sidebar-tab-actions .fetch-pane-actionbar'), null);
    assert(
      element.querySelector('.fetch-tree-folder-row .fetch-pane-actionbar') instanceof HTMLElement,
    );
  } finally {
    sidebar.dispose();
  }
});

test('sidebar renders a footer at the bottom and mounts footer content', () => {
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
  });
  const sidebar = createSidebar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const footer = element.querySelector('.sidebar-footer');
    assert(footer instanceof HTMLElement);
    assert.equal(element.lastElementChild, footer);
    assert.equal(
      footer.querySelector('.sidebar-footer-actions-host'),
      footerActionsView.getElement(),
    );
    assert.equal(
      footer.querySelector('.sidebar-footer-account-label')?.textContent,
      'Literature Studio',
    );
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});

test('sidebar footer settings action dispatches the provided handler', () => {
  let triggered = false;
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
    onOpenSettings: () => {
      triggered = true;
    },
  });
  const sidebar = createSidebar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const settingsButton = element.querySelector(
      '.sidebar-footer .sidebar-footer-settings-btn',
    );
    assert(settingsButton instanceof HTMLButtonElement);
    assert.equal(settingsButton.getAttribute('aria-label'), 'Settings');
    settingsButton.click();
    assert.equal(triggered, true);
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});

test('sidebar footer renders more action to the left of settings', () => {
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
  });
  const sidebar = createSidebar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const actions = Array.from(
      element.querySelectorAll('.sidebar-footer .actionbar-action'),
    );
    assert.equal(actions.length >= 2, true);
    assert.equal(actions[0]?.classList.contains('sidebar-footer-more-btn'), true);
    assert.equal(
      actions[0]?.querySelector('.lx-icon')?.classList.contains('lx-icon-more-2'),
      true,
    );
    assert.equal(actions[1]?.classList.contains('sidebar-footer-settings-btn'), true);
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});

test('sidebar footer more action exposes agent and flow layout actions', async () => {
  let appliedAgentLayoutCount = 0;
  let appliedFlowLayoutCount = 0;
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
    onApplyLayoutAgent: () => {
      appliedAgentLayoutCount += 1;
    },
    onApplyLayoutFlow: () => {
      appliedFlowLayoutCount += 1;
    },
  });
  const sidebar = createSidebar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const moreButton = element.querySelector(
      '.sidebar-footer .sidebar-footer-more-btn',
    );
    assert(moreButton instanceof HTMLButtonElement);
    assert.equal(moreButton.getAttribute('aria-label'), 'More');

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector(
      '.actionbar-context-view.sidebar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'sidebar-footer-more');
    assert.equal(moreButton.getAttribute('aria-expanded'), 'true');

    const layoutItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Layout'),
    );
    assert(layoutItem instanceof HTMLElement);
    assert(layoutItem.querySelector('.dropdown-option-icon.lx-icon-layout') instanceof HTMLElement);
    layoutItem.click();
    await delay(0);
    const submenu = document.body.querySelector(
      '.actionbar-context-view.sidebar-footer-more-menu-overlay .ls-menu-submenu',
    );
    assert(submenu instanceof HTMLElement);
    const submenuLabels = Array.from(
      submenu.querySelectorAll('.dropdown-menu-item .dropdown-menu-item-content'),
    ).map((node) => node.textContent?.trim());
    assert.deepEqual(submenuLabels, ['Agent', 'Flow']);

    const agentItem = Array.from(
      submenu.querySelectorAll<HTMLElement>('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Agent'));
    assert(agentItem instanceof HTMLElement);
    agentItem.click();
    await delay(0);
    assert.equal(appliedAgentLayoutCount, 1);

    moreButton.click();
    await delay(0);
    const reopenedMenu = document.body.querySelector(
      '.actionbar-context-view.sidebar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(reopenedMenu instanceof HTMLElement);
    const reopenedLayoutItem = Array.from(
      reopenedMenu.querySelectorAll('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Layout'));
    assert(reopenedLayoutItem instanceof HTMLElement);
    reopenedLayoutItem.click();
    await delay(0);
    const reopenedSubmenu = document.body.querySelector(
      '.actionbar-context-view.sidebar-footer-more-menu-overlay .ls-menu-submenu',
    );
    assert(reopenedSubmenu instanceof HTMLElement);
    const flowItem = Array.from(
      reopenedSubmenu.querySelectorAll<HTMLElement>('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Flow'));
    assert(flowItem instanceof HTMLElement);
    flowItem.click();
    await delay(0);
    assert.equal(appliedFlowLayoutCount, 1);

    assert.equal(
      document.body.querySelector(
        '.actionbar-context-view.sidebar-footer-more-menu-overlay .dropdown-menu',
      ),
      null,
    );
    assert.equal(moreButton.getAttribute('aria-expanded'), 'false');
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});

test('sidebar footer layout submenu marks the active layout', async () => {
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
    activeLayoutMode: 'agent',
  });
  const sidebar = createSidebar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const moreButton = element.querySelector(
      '.sidebar-footer .sidebar-footer-more-btn',
    );
    assert(moreButton instanceof HTMLButtonElement);

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector(
      '.actionbar-context-view.sidebar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(menu instanceof HTMLElement);
    const layoutItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Layout'),
    );
    assert(layoutItem instanceof HTMLElement);
    layoutItem.click();
    await delay(0);

    const submenu = document.body.querySelector(
      '.actionbar-context-view.sidebar-footer-more-menu-overlay .ls-menu-submenu',
    );
    assert(submenu instanceof HTMLElement);
    const agentItem = Array.from(
      submenu.querySelectorAll<HTMLElement>('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Agent'));
    const flowItem = Array.from(
      submenu.querySelectorAll<HTMLElement>('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Flow'));
    assert(agentItem instanceof HTMLElement);
    assert(flowItem instanceof HTMLElement);
    assert.equal(agentItem.classList.contains('selected'), true);
    assert.equal(
      agentItem.querySelector('.dropdown-menu-item-check svg') instanceof SVGElement,
      true,
    );
    assert.equal(flowItem.classList.contains('selected'), false);
    assert.equal(
      flowItem.querySelector('.dropdown-menu-item-check.placeholder') instanceof HTMLElement,
      true,
    );
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});

test('sidebar footer settings action keeps active styling when settings is active', () => {
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
    isSettingsActive: true,
  });
  const sidebar = createSidebar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const settingsButton = element.querySelector(
      '.sidebar-footer .sidebar-footer-settings-btn',
    );
    assert(settingsButton instanceof HTMLButtonElement);
    const settingsItem = settingsButton.closest('.actionbar-item');
    assert(settingsItem instanceof HTMLElement);
    assert.equal(settingsItem.classList.contains('is-active'), true);
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});
