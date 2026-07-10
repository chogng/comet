import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import type { IHoverDelegate } from 'cs/base/browser/ui/hover/hover';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createActionBarView: typeof import('cs/base/browser/ui/actionbar/actionbar').createActionBarView;
let createLxIcon: typeof import('cs/base/browser/ui/lxicons/lxicons').createLxIcon;
let DropdownMenuActionViewItem: typeof import('cs/base/browser/ui/dropdown/dropdownActionViewItem').DropdownMenuActionViewItem;

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createActionBarView } = await import('cs/base/browser/ui/actionbar/actionbar'));
  ({ createLxIcon } = await import('cs/base/browser/ui/lxicons/lxicons'));
  ({ DropdownMenuActionViewItem } = await import('cs/base/browser/ui/dropdown/dropdownActionViewItem'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('comet-actionbar renders actions and separators without relying on button base classes', () => {
  let refreshClicks = 0;
  const actionBarView = createActionBarView({
    ariaLabel: 'Document actions',
    items: [
      {
        id: 'refresh',
        label: 'Refresh',
        content: createLxIcon('refresh'),
        onClick: () => {
          refreshClicks += 1;
        },
      },
      {
        type: 'separator',
      },
      {
        id: 'disabled',
        label: 'Disabled action',
        content: createLxIcon('close'),
        disabled: true,
      },
    ],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    assert.equal(element.classList.contains('comet-actionbar'), true);
    assert.equal(element.classList.contains('comet-btn-base'), false);
    assert.equal(element.getAttribute('role'), 'toolbar');
    assert.equal(element.getAttribute('aria-label'), 'Document actions');

    const buttons = element.querySelectorAll('.comet-actionbar-action');
    assert.equal(buttons.length, 2);
    assert.equal(
      element.querySelectorAll('.comet-actionbar-actions-container > .comet-actionbar-item').length,
      3,
    );
    assert(element.querySelector('.comet-actionbar-separator') instanceof HTMLElement);

    const refreshButton = buttons[0] as HTMLButtonElement;
    const disabledButton = buttons[1] as HTMLButtonElement;
    assert.equal(refreshButton.getAttribute('aria-label'), 'Refresh');
    assert.equal(refreshButton.getAttribute('title'), null);
    assert.equal(disabledButton.disabled, true);

    refreshButton.click();
    assert.equal(refreshClicks, 1);
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});

test('comet-actionbar keyboard navigation skips disabled items', () => {
  const actionBarView = createActionBarView({
    items: [
      {
        label: 'Back',
        content: createLxIcon('arrow-left'),
      },
      {
        label: 'Busy',
        content: createLxIcon('sync'),
        disabled: true,
      },
      {
        label: 'Forward',
        content: createLxIcon('arrow-right'),
      },
    ],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    const buttons = element.querySelectorAll('.comet-actionbar-action');
    const backButton = buttons[0] as HTMLButtonElement;
    const forwardButton = buttons[2] as HTMLButtonElement;

    backButton.focus();
    backButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(document.activeElement, forwardButton);

    forwardButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    assert.equal(document.activeElement, backButton);
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});

test('comet-actionbar actions use shared hover content instead of native title tooltips', () => {
  const actionBarView = createActionBarView({
    items: [
      {
        label: 'Settings',
        title: 'Settings',
        hover: {
          content: 'Settings',
          delay: 0,
        },
        content: createLxIcon('gear'),
      },
    ],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    const button = element.querySelector('.comet-actionbar-action');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected comet-actionbar button.');
    }
    assert.equal(button.getAttribute('title'), null);

    button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));

    const overlayContent = document.querySelector('.comet-hover-content');
    if (!(overlayContent instanceof HTMLElement)) {
      throw new Error('Expected hover overlay content.');
    }
    assert.equal(overlayContent.textContent, 'Settings');
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});

test('comet-actionbar binds managed hover to the outer action item', () => {
  const hoverTargets: HTMLElement[] = [];
  const hoverService: IHoverDelegate = {
    createHover(target) {
      hoverTargets.push(target);
      return {
        show() {},
        hide() {},
        update() {},
        dispose() {},
      };
    },
  };
  const actionBarView = createActionBarView({
    hoverService,
    items: [
      {
        label: 'Settings',
        title: 'Settings',
        content: createLxIcon('gear'),
      },
    ],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    const actionItem = element.querySelector('.comet-actionbar-item');
    const button = element.querySelector('.comet-actionbar-action');
    assert(actionItem instanceof HTMLElement);
    assert(button instanceof HTMLButtonElement);
    assert.equal(hoverTargets.length, 1);
    assert.equal(hoverTargets[0], actionItem);
    assert.notEqual(hoverTargets[0], button);
    assert.equal(hoverTargets[0].classList.contains('comet-is-action'), true);
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});

test('comet-actionbar forwards custom button attributes', () => {
  const actionBarView = createActionBarView({
    items: [
      {
        label: 'Details',
        content: createLxIcon('chevron-down'),
        buttonAttributes: {
          'aria-haspopup': 'dialog',
          'data-kind': 'details',
        },
      },
    ],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    const button = element.querySelector('.comet-actionbar-action');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected comet-actionbar button.');
    }

    assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(button.getAttribute('data-kind'), 'details');
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});

test('comet-actionbar can render a dropdown action view item instance', async () => {
  let selected = '';
  const dropdownItem = new DropdownMenuActionViewItem({
    label: 'More',
    content: createLxIcon('more'),
    menu: [
      {
        label: 'Archive',
        onClick: () => {
          selected = 'archive';
        },
      },
    ],
  });
  const actionBarView = createActionBarView({
    items: [dropdownItem],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    const button = element.querySelector('.comet-actionbar-action');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected comet-actionbar button.');
    }

    button.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);

    const archiveItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Archive'),
    );
    assert(archiveItem instanceof HTMLElement);
    archiveItem.click();
    await delay(0);

    assert.equal(selected, 'archive');
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});

test('comet-actionbar can render a custom overlay action view item instance', async () => {
  let closeCount = 0;
  const actionBarView = createActionBarView({
    items: [
      new DropdownMenuActionViewItem({
        label: 'History',
        content: createLxIcon('history'),
        overlayRole: 'dialog',
        renderOverlay: ({ hide }) => {
          const overlay = document.createElement('div');
          overlay.className = 'comet-actionbar-custom-overlay';
          const close = document.createElement('button');
          close.type = 'button';
          close.textContent = 'Close';
          close.addEventListener('click', () => {
            closeCount += 1;
            hide();
          });
          overlay.append(close);
          return overlay;
        },
      }),
    ],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    const button = element.querySelector('.comet-actionbar-action');
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error('Expected comet-actionbar button.');
    }

    button.click();
    await delay(0);

    const overlay = document.body.querySelector('.comet-actionbar-custom-overlay');
    assert(overlay instanceof HTMLElement);
    assert.equal(button.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(button.getAttribute('aria-expanded'), 'true');

    const closeButton = overlay.querySelector('button');
    assert(closeButton instanceof HTMLButtonElement);
    closeButton.click();
    await delay(0);

    assert.equal(closeCount, 1);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});

test('comet-actionbar can render a split action item with primary and dropdown controls', async () => {
  let primaryRuns = 0;
  let selected = '';
  const actionBarView = createActionBarView({
    items: [
      {
        type: 'split',
        className: 'comet-actionbar-split',
        primary: {
          label: 'Paragraph',
          content: 'Tx',
          mode: 'custom',
          onClick: () => {
            primaryRuns += 1;
          },
        },
        dropdown: {
          label: 'Text styles',
          content: createLxIcon('chevron-down'),
          mode: 'custom',
          menu: [
            {
              label: 'Heading 1',
              onClick: () => {
                selected = 'heading-1';
              },
            },
          ],
        },
      },
    ],
  });
  const element = actionBarView.getElement();
  document.body.append(element);

  try {
    const buttons = element.querySelectorAll('.comet-actionbar-action');
    assert.equal(buttons.length, 2);
    const splitItem = element.querySelector(
      '.comet-actionbar-actions-container > .comet-actionbar-item.comet-actionbar-split > .comet-action-dropdown-item',
    );
    assert(splitItem instanceof HTMLElement);

    const primaryButton = buttons[0] as HTMLButtonElement;
    const dropdownButton = buttons[1] as HTMLButtonElement;

    primaryButton.click();
    assert.equal(primaryRuns, 1);

    dropdownButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);

    const menuItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Heading 1'),
    );
    assert(menuItem instanceof HTMLElement);
    menuItem.click();
    await delay(0);

    assert.equal(selected, 'heading-1');
  } finally {
    actionBarView.dispose();
    document.body.replaceChildren();
  }
});
