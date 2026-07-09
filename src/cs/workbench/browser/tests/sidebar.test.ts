import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { SidebarProps } from 'cs/workbench/browser/parts/sidebar/sidebar';

let cleanupDomEnvironment: (() => void) | null = null;
let createSidebar: typeof import('cs/workbench/browser/parts/sidebar/sidebar').createSidebar;
let SidebarFooterActionsView: typeof import('cs/workbench/browser/parts/sidebar/sidebarFooterActions').SidebarFooterActionsView;

function delay(ms = 0) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createProps(): SidebarProps {
  const labels = {
    homeTitle: 'Home',
    homeNavNewChat: 'New chat',
    homeNavProjects: 'Projects',
    homeNavArtifacts: 'Artifacts',
    homeNavCustomize: 'Customize',
    recentsTitle: 'Recents',
  } as SidebarProps['labels'];

  return {
    labels,
  };
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createSidebar } = await import('cs/workbench/browser/parts/sidebar/sidebar'));
  ({ SidebarFooterActionsView } = await import('cs/workbench/browser/parts/sidebar/sidebarFooterActions'));
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
    assert.equal(element.querySelector('.comet-sidebar-topbar'), null);
    assert.equal(element.firstElementChild, element.querySelector('.comet-sidebar-switcher'));
  } finally {
    sidebar.dispose();
  }
});

test('sidebar renders home without fetch tab', () => {
  const props = createProps();
  const sidebar = createSidebar(props);
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const homeTab = element.querySelector('.comet-sidebar-home-tab');
    const fetchTab = element.querySelector('.comet-sidebar-fetch-tab');
    assert(homeTab instanceof HTMLButtonElement);
    assert.equal(fetchTab, null);
    assert.equal(homeTab.textContent, 'Home');
    assert(homeTab.querySelector('.lx-icon-home') instanceof HTMLElement);
    assert.equal(homeTab.getAttribute('aria-selected'), 'true');
    assert(element.querySelector('.comet-sidebar-home-panel') instanceof HTMLElement);
    assert.deepEqual(
      Array.from(element.querySelectorAll('.comet-sidebar-home-nav-item')).map(item => item.textContent),
      ['New chat', 'Projects', 'Artifacts', 'Customize'],
    );
    assert.equal(element.querySelector('.comet-sidebar-recents-title')?.textContent, 'Recents');
    assert.equal(element.querySelector('.comet-library-tree'), null);
    assert.equal(element.querySelector('.comet-sidebar-fetch-panel'), null);
  } finally {
    sidebar.dispose();
  }
});

test('sidebar renders a footer at the bottom and mounts footer content', () => {
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Comet Studio',
    settingsLabel: 'Settings',
  });
  const sidebar = createSidebar({
    ...createProps(),
    footerActionsElement: footerActionsView.getElement(),
  });
  const element = sidebar.getElement();
  document.body.append(element);

  try {
    const footer = element.querySelector('.comet-sidebar-footer');
    assert(footer instanceof HTMLElement);
    assert.equal(element.lastElementChild, footer);
    assert.equal(
      footer.querySelector('.comet-sidebar-footer-actions-host'),
      footerActionsView.getElement(),
    );
    assert.equal(
      footer.querySelector('.comet-sidebar-footer-account-label')?.textContent,
      'Comet Studio',
    );
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});

test('sidebar footer settings action dispatches the provided handler', () => {
  let triggered = false;
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Comet Studio',
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
      '.comet-sidebar-footer .comet-sidebar-footer-settings-btn',
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
    accountLabel: 'Comet Studio',
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
      element.querySelectorAll('.comet-sidebar-footer .comet-actionbar-action'),
    );
    assert.equal(actions.length >= 2, true);
    assert.equal(actions[0]?.classList.contains('comet-sidebar-footer-more-btn'), true);
    assert.equal(
      actions[0]?.querySelector('.lx-icon')?.classList.contains('lx-icon-more-2'),
      true,
    );
    assert.equal(actions[1]?.classList.contains('comet-sidebar-footer-settings-btn'), true);
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});

test('sidebar footer more action exposes agent and flow layout actions', async () => {
  let appliedAgentLayoutCount = 0;
  let appliedFlowLayoutCount = 0;
  const footerActionsView = new SidebarFooterActionsView({
    accountLabel: 'Comet Studio',
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
      '.comet-sidebar-footer .comet-sidebar-footer-more-btn',
    );
    assert(moreButton instanceof HTMLButtonElement);
    assert.equal(moreButton.getAttribute('aria-label'), 'More');

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector(
      '.comet-actionbar-context-view.comet-sidebar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(menu instanceof HTMLElement);
    assert.equal(menu.getAttribute('data-menu'), 'comet-sidebar-footer-more');
    assert.equal(moreButton.getAttribute('aria-expanded'), 'true');

    const layoutItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Layout'),
    );
    assert(layoutItem instanceof HTMLElement);
    assert(layoutItem.querySelector('.dropdown-option-icon.lx-icon-layout') instanceof HTMLElement);
    layoutItem.click();
    await delay(0);
    const submenu = document.body.querySelector(
      '.comet-actionbar-context-view.comet-sidebar-footer-more-menu-overlay .cs-menu-submenu',
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
      '.comet-actionbar-context-view.comet-sidebar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(reopenedMenu instanceof HTMLElement);
    const reopenedLayoutItem = Array.from(
      reopenedMenu.querySelectorAll('.dropdown-menu-item'),
    ).find((node) => node.textContent?.includes('Layout'));
    assert(reopenedLayoutItem instanceof HTMLElement);
    reopenedLayoutItem.click();
    await delay(0);
    const reopenedSubmenu = document.body.querySelector(
      '.comet-actionbar-context-view.comet-sidebar-footer-more-menu-overlay .cs-menu-submenu',
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
        '.comet-actionbar-context-view.comet-sidebar-footer-more-menu-overlay .dropdown-menu',
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
    accountLabel: 'Comet Studio',
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
      '.comet-sidebar-footer .comet-sidebar-footer-more-btn',
    );
    assert(moreButton instanceof HTMLButtonElement);

    moreButton.click();
    await delay(0);

    const menu = document.body.querySelector(
      '.comet-actionbar-context-view.comet-sidebar-footer-more-menu-overlay .dropdown-menu',
    );
    assert(menu instanceof HTMLElement);
    const layoutItem = Array.from(menu.querySelectorAll('.dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Layout'),
    );
    assert(layoutItem instanceof HTMLElement);
    layoutItem.click();
    await delay(0);

    const submenu = document.body.querySelector(
      '.comet-actionbar-context-view.comet-sidebar-footer-more-menu-overlay .cs-menu-submenu',
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
    accountLabel: 'Comet Studio',
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
      '.comet-sidebar-footer .comet-sidebar-footer-settings-btn',
    );
    assert(settingsButton instanceof HTMLButtonElement);
    const settingsItem = settingsButton.closest('.comet-actionbar-item');
    assert(settingsItem instanceof HTMLElement);
    assert.equal(settingsItem.classList.contains('comet-is-active'), true);
  } finally {
    sidebar.dispose();
    footerActionsView.dispose();
  }
});
