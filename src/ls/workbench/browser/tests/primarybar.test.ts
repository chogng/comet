import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';
import type { PrimaryBarProps } from 'ls/workbench/browser/parts/primarybar/primarybar';
import type { SidebarTopbarActionsProps } from 'ls/workbench/browser/parts/sidebar/sidebarTopbarActions';

let cleanupDomEnvironment: (() => void) | null = null;
let createPrimaryBar: typeof import('ls/workbench/browser/parts/primarybar/primarybar').createPrimaryBar;
let SidebarTopbarActionsView: typeof import('ls/workbench/browser/parts/sidebar/sidebarTopbarActions').SidebarTopbarActionsView;
let PrimaryBarFooterActionsView: typeof import('ls/workbench/browser/parts/primarybar/primarybarFooterActions').PrimaryBarFooterActionsView;

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProps(): PrimaryBarProps {
  const labels = {
    libraryTitle: 'Library',
    fetchTitle: 'Fetch',
    selectionModeEnterMulti: 'Select multiple',
    selectionModeSelectAll: 'Select all',
    selectionModeExit: 'Exit selection',
    fetchLatest: 'Fetch latest',
    fetchLatestBusy: 'Fetching latest',
  } as PrimaryBarProps['labels'];

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
  } as PrimaryBarProps['fetchPaneProps'];

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

function createTopbarActionsProps(): SidebarTopbarActionsProps {
  return {
    isPrimarySidebarVisible: true,
    primarySidebarToggleLabel: 'Hide primary sidebar',
    addressBarLabel: 'Address bar',
  };
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createPrimaryBar } = await import('ls/workbench/browser/parts/primarybar/primarybar'));
  ({ SidebarTopbarActionsView } = await import('ls/workbench/browser/parts/sidebar/sidebarTopbarActions'));
  ({ PrimaryBarFooterActionsView } = await import('ls/workbench/browser/parts/primarybar/primarybarFooterActions'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('primary bar topbar exposes a primary sidebar toggle action', () => {
  let toggleCount = 0;
  const topbarActionsView = new SidebarTopbarActionsView({
    ...createTopbarActionsProps(),
    onTogglePrimarySidebar: () => {
      toggleCount += 1;
    },
  });
  const primaryBar = createPrimaryBar({
    ...createProps(),
    topbarActionsElement: topbarActionsView.getElement(),
  });
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    const toggleButton = element.querySelector(
      '.primarybar-topbar .sidebar-topbar-toggle-btn',
    );
    assert(toggleButton instanceof HTMLButtonElement);
    assert.equal(
      toggleButton.getAttribute('aria-label'),
      'Hide primary sidebar',
    );

    toggleButton.click();
    assert.equal(toggleCount, 1);
  } finally {
    primaryBar.dispose();
    topbarActionsView.dispose();
  }
});

test('primary bar topbar exposes an address bar action', () => {
  const topbarActionsView = new SidebarTopbarActionsView(createTopbarActionsProps());
  const primaryBar = createPrimaryBar({
    ...createProps(),
    topbarActionsElement: topbarActionsView.getElement(),
  });
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    const searchButton = element.querySelector(
      '.primarybar-topbar .sidebar-topbar-search-btn',
    );
    assert(searchButton instanceof HTMLButtonElement);
    assert.equal(searchButton.getAttribute('aria-label'), 'Address bar');
  } finally {
    primaryBar.dispose();
    topbarActionsView.dispose();
  }
});

test('primary bar library header no longer renders a draft action button', () => {
  const primaryBar = createPrimaryBar(createProps());
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    assert.equal(
      element.querySelector('.primarybar-library-pane-header .pane-header-actionbar'),
      null,
    );
    assert.equal(
      element.querySelector('.primarybar-library-pane-header .sidebar-action-btn'),
      null,
    );
  } finally {
    primaryBar.dispose();
  }
});

test('primary bar renders a footer at the bottom and mounts footer content', () => {
  const footerActionsView = new PrimaryBarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
  });
  const primaryBar = createPrimaryBar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    const footer = element.querySelector('.primarybar-footer');
    assert(footer instanceof HTMLElement);
    assert.equal(element.lastElementChild, footer);
    assert.equal(
      footer.querySelector('.primarybar-footer-actions-host'),
      footerActionsView.getElement(),
    );
    assert.equal(
      footer.querySelector('.primarybar-footer-account-label')?.textContent,
      'Literature Studio',
    );
  } finally {
    primaryBar.dispose();
    footerActionsView.dispose();
  }
});

test('primary bar footer settings action dispatches the provided handler', () => {
  let triggered = false;
  const footerActionsView = new PrimaryBarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
    onOpenSettings: () => {
      triggered = true;
    },
  });
  const primaryBar = createPrimaryBar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    const settingsButton = element.querySelector(
      '.primarybar-footer .primarybar-footer-settings-btn',
    );
    assert(settingsButton instanceof HTMLButtonElement);
    assert.equal(settingsButton.getAttribute('aria-label'), 'Settings');
    settingsButton.click();
    assert.equal(triggered, true);
  } finally {
    primaryBar.dispose();
    footerActionsView.dispose();
  }
});

test('primary bar footer renders more action to the left of settings', () => {
  const footerActionsView = new PrimaryBarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
  });
  const primaryBar = createPrimaryBar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    const actions = Array.from(
      element.querySelectorAll('.primarybar-footer .actionbar-action'),
    );
    assert.equal(actions.length >= 2, true);
    assert.equal(actions[0]?.classList.contains('primarybar-footer-more-btn'), true);
    assert.equal(
      actions[0]?.querySelector('.lx-icon')?.classList.contains('lx-icon-more-2'),
      true,
    );
    assert.equal(actions[1]?.classList.contains('primarybar-footer-settings-btn'), true);
  } finally {
    primaryBar.dispose();
    footerActionsView.dispose();
  }
});

test('primary bar footer more action exposes agent and flow layout actions', async () => {
  let appliedAgentLayoutCount = 0;
  let appliedFlowLayoutCount = 0;
  const footerActionsView = new PrimaryBarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
    onApplyLayoutAgent: () => {
      appliedAgentLayoutCount += 1;
    },
    onApplyLayoutFlow: () => {
      appliedFlowLayoutCount += 1;
    },
  });
  const primaryBar = createPrimaryBar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    const moreButton = element.querySelector(
      '.primarybar-footer .primarybar-footer-more-btn',
    );
    assert(moreButton instanceof HTMLButtonElement);
    assert.equal(moreButton.getAttribute('aria-label'), 'More');

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector(
      '.actionbar-context-view.primarybar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'primarybar-footer-more');
    assert.equal(moreButton.getAttribute('aria-expanded'), 'true');

    const layoutItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Layout'),
    );
    assert(layoutItem instanceof HTMLElement);
    assert(layoutItem.querySelector('.dropdown-option-icon.lx-icon-layout') instanceof HTMLElement);
    layoutItem.click();
    await delay(0);
    const submenu = document.body.querySelector(
      '.actionbar-context-view.primarybar-footer-more-menu-overlay .ls-menu-submenu',
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
      '.actionbar-context-view.primarybar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(reopenedMenu instanceof HTMLElement);
    const reopenedLayoutItem = Array.from(
      reopenedMenu.querySelectorAll('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Layout'));
    assert(reopenedLayoutItem instanceof HTMLElement);
    reopenedLayoutItem.click();
    await delay(0);
    const reopenedSubmenu = document.body.querySelector(
      '.actionbar-context-view.primarybar-footer-more-menu-overlay .ls-menu-submenu',
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
        '.actionbar-context-view.primarybar-footer-more-menu-overlay .dropdown-menu',
      ),
      null,
    );
    assert.equal(moreButton.getAttribute('aria-expanded'), 'false');
  } finally {
    primaryBar.dispose();
    footerActionsView.dispose();
  }
});

test('primary bar footer layout submenu marks the active layout', async () => {
  const footerActionsView = new PrimaryBarFooterActionsView({
    accountLabel: 'Literature Studio',
    settingsLabel: 'Settings',
    activeLayoutMode: 'agent',
  });
  const primaryBar = createPrimaryBar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = primaryBar.getElement();
  document.body.append(element);

  try {
    const moreButton = element.querySelector(
      '.primarybar-footer .primarybar-footer-more-btn',
    );
    assert(moreButton instanceof HTMLButtonElement);

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector(
      '.actionbar-context-view.primarybar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(menu instanceof HTMLElement);
    const layoutItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Layout'),
    );
    assert(layoutItem instanceof HTMLElement);
    layoutItem.click();
    await delay(0);

    const submenu = document.body.querySelector(
      '.actionbar-context-view.primarybar-footer-more-menu-overlay .ls-menu-submenu',
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
    primaryBar.dispose();
    footerActionsView.dispose();
  }
});
