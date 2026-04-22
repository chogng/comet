import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let Menu: typeof import('ls/base/browser/ui/menu/menu').Menu;

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ Menu } = await import('ls/base/browser/ui/menu/menu'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('menu renders requested placement class', () => {
  const menu = new Menu({
    items: [
      { value: 'alpha', label: 'Alpha' },
    ],
    placement: 'top',
  });
  document.body.append(menu.getElement());

  try {
    assert.equal(menu.getElement().classList.contains('ls-menu-root'), true);
    assert.equal(menu.getElement().classList.contains('dropdown-menu-top'), true);
    assert.equal(menu.getElement().classList.contains('dropdown-menu-bottom'), false);
  } finally {
    menu.dispose();
    document.body.replaceChildren();
  }
});

test('menu uses roving item focus for keyboard navigation', () => {
  const menu = new Menu({
    items: [
      { value: 'alpha', label: 'Alpha', disabled: true },
      { value: 'beta', label: 'Beta' },
      { value: 'gamma', label: 'Gamma' },
    ],
  });
  document.body.append(menu.getElement());

  try {
    const menuItems = Array.from(
      menu.getElement().querySelectorAll<HTMLDivElement>('.dropdown-menu-item'),
    );
    assert.equal(menuItems.length, 3);

    menu.focusSelectedOrFirstEnabled();
    assert.equal(document.activeElement, menuItems[1]);
    assert.equal(menuItems[0]?.tabIndex, -1);
    assert.equal(menuItems[1]?.tabIndex, 0);
    assert.equal(menuItems[2]?.tabIndex, -1);

    menuItems[1]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    assert.equal(document.activeElement, menuItems[2]);
    assert.equal(menuItems[1]?.tabIndex, -1);
    assert.equal(menuItems[2]?.tabIndex, 0);
  } finally {
    menu.dispose();
    document.body.replaceChildren();
  }
});

test('menu applies and clears the data-menu attribute from options', () => {
  const menu = new Menu({
    items: [
      { value: 'alpha', label: 'Alpha' },
    ],
    dataMenu: 'editor-tab-context',
  });
  document.body.append(menu.getElement());

  try {
    assert.equal(menu.getElement().getAttribute('data-menu'), 'editor-tab-context');

    menu.setOptions({
      items: [
        { value: 'alpha', label: 'Alpha' },
      ],
    });

    assert.equal(menu.getElement().hasAttribute('data-menu'), false);
  } finally {
    menu.dispose();
    document.body.replaceChildren();
  }
});

test('menu header can update menu items and request hide', () => {
  let cancelCount = 0;
  const menu = new Menu({
    items: [
      { value: 'alpha', label: 'Alpha' },
    ],
    header: {
      className: 'menu-header-test',
      render: ({ updateItems, hide }) => {
        const input = document.createElement('input');
        input.className = 'menu-header-input';
        input.addEventListener('input', () => {
          updateItems([
            { value: 'beta', label: 'Beta' },
          ]);
        });
        input.addEventListener('keydown', (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            hide();
          }
        });
        return input;
      },
    },
    onCancel: () => {
      cancelCount += 1;
    },
  });
  document.body.append(menu.getElement());

  try {
    const input = menu.getElement().querySelector('.ls-menu-header.menu-header-test.menu-header-input');
    assert(input instanceof HTMLInputElement);
    input.value = 'b';
    input.dispatchEvent(new Event('input', { bubbles: true }));

    const menuItems = Array.from(
      menu.getElement().querySelectorAll<HTMLDivElement>('.dropdown-menu-item'),
    );
    assert.equal(menuItems.some((item) => item.textContent?.includes('Beta')), true);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(cancelCount, 1);
  } finally {
    menu.dispose();
    document.body.replaceChildren();
  }
});

test('menu opens submenu with ArrowRight and selects submenu action', () => {
  const selections: string[] = [];
  const menu = new Menu({
    items: [
      {
        value: 'parent',
        label: 'Parent',
        submenu: [
          { value: 'child', label: 'Child' },
        ],
      },
      { value: 'other', label: 'Other' },
    ],
    onSelect: (event) => {
      selections.push(event.value);
    },
  });
  document.body.append(menu.getElement());

  try {
    const menuItems = Array.from(
      menu.getElement().querySelectorAll<HTMLDivElement>('.dropdown-menu-item'),
    );
    assert.equal(menuItems.length, 2);
    menu.focusSelectedOrFirstEnabled();
    assert.equal(document.activeElement, menuItems[0]);

    menuItems[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const submenu = document.body.querySelector('.ls-menu-submenu');
    assert(submenu instanceof HTMLElement);
    assert.equal(submenu.classList.contains('ls-menu-submenu'), true);
    const submenuItems = Array.from(
      submenu.querySelectorAll<HTMLDivElement>('.dropdown-menu-item'),
    );
    assert.equal(submenuItems.length, 1);
    assert.equal(document.activeElement, submenuItems[0]);

    submenuItems[0]?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.deepEqual(selections, ['child']);
  } finally {
    menu.dispose();
    document.body.replaceChildren();
  }
});

test('menu closes only submenu on first Escape and root menu on second Escape', () => {
  let cancelCount = 0;
  const menu = new Menu({
    items: [
      {
        value: 'parent',
        label: 'Parent',
        submenu: [
          { value: 'child', label: 'Child' },
        ],
      },
    ],
    onCancel: () => {
      cancelCount += 1;
    },
  });
  document.body.append(menu.getElement());

  try {
    menu.focusSelectedOrFirstEnabled();
    const parentItem = menu.getElement().querySelector('.dropdown-menu-item');
    assert(parentItem instanceof HTMLDivElement);

    parentItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    const submenuItem = document.body.querySelector('.ls-menu-submenu .dropdown-menu-item');
    assert(submenuItem instanceof HTMLDivElement);
    assert.equal(document.activeElement, submenuItem);

    submenuItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(document.body.querySelector('.ls-menu-submenu'), null);
    assert.equal(cancelCount, 0);
    assert.equal(document.activeElement, parentItem);

    parentItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(cancelCount, 1);
  } finally {
    menu.dispose();
    document.body.replaceChildren();
  }
});
