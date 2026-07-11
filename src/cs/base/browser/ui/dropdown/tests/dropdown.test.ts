import assert from 'node:assert/strict';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';

let cleanupDomEnvironment: (() => void) | null = null;
let restoreComputedStyle: (() => void) | null = null;
let createDropdownView: typeof import('cs/base/browser/ui/dropdown/dropdown').createDropdownView;
let createDomDropdownMenuPresenter: typeof import('cs/base/browser/ui/dropdown/dropdown').createDomDropdownMenuPresenter;
let DropdownMenuActionViewItem: typeof import('cs/base/browser/ui/dropdown/dropdownActionViewItem').DropdownMenuActionViewItem;
let dropdownServices: DropdownContextServices & { dispose(): void };

type RectInit = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function createDomRect({ x, y, width, height }: RectInit) {
  return {
    x,
    y,
    width,
    height,
    top: y,
    left: x,
    right: x + width,
    bottom: y + height,
    toJSON() {
      return this;
    },
  } as DOMRect;
}

function installStableComputedStyleZoom() {
  const originalGetComputedStyle = window.getComputedStyle;
  window.getComputedStyle = ((element: Element) => {
    const style = originalGetComputedStyle.call(window, element);
    if (style.zoom) {
      return style;
    }

    return new Proxy(style, {
      get(target, property, receiver) {
        if (property === 'zoom') {
          return '1';
        }

        return Reflect.get(target, property, receiver);
      },
    }) as CSSStyleDeclaration;
  }) as typeof window.getComputedStyle;

  return () => {
    window.getComputedStyle = originalGetComputedStyle;
  };
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  restoreComputedStyle = installStableComputedStyleZoom();
  ({
    createDropdownView,
    createDomDropdownMenuPresenter,
  } = await import('cs/base/browser/ui/dropdown/dropdown'));
  ({ DropdownMenuActionViewItem } = await import('cs/base/browser/ui/dropdown/dropdownActionViewItem'));
});

after(() => {
  restoreComputedStyle?.();
  restoreComputedStyle = null;
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

beforeEach(async () => {
  dropdownServices = await createDropdownTestServices();
});

afterEach(() => {
  dropdownServices.dispose();
});

test('dropdown portal menu renders in document.body and follows the trigger rect', () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 720,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      if (this.classList.contains('comet-dropdown-menu')) {
        const minWidth = Number.parseInt(
          (this as HTMLElement).style.minWidth || '0',
          10,
        );
        return Math.max(Number.isNaN(minWidth) ? 0 : minWidth, 140);
      }
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.classList.contains('comet-dropdown-menu')) {
        return 84;
      }
      return 0;
    },
  });

  try {
    const menuPresenter = createDomDropdownMenuPresenter({ layer: 'portal' });
    const dropdownView = createDropdownView({
      menuPresenter,
      value: 'nature',
      options: [
        { value: 'nature', label: 'Nature' },
        { value: 'science', label: 'Science' },
      ],
    });
    const dropdown = dropdownView.getElement();
    dropdown.getBoundingClientRect = () =>
      createDomRect({ x: 40, y: 120, width: 96, height: 32 });
    document.body.append(dropdown);

    dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const contextView = document.body.querySelector('.comet-context-view');
    const contextViewContent = document.body.querySelector('.comet-context-view-content');
    const menu = document.body.querySelector('.comet-dropdown-menu-portal');
    assert(contextView instanceof HTMLElement);
    assert(contextViewContent instanceof HTMLElement);
    assert(menu instanceof HTMLElement);
    assert.equal(dropdown.contains(menu), false);
    assert.equal(contextView.style.left, '40px');
    assert.equal(contextView.style.top, '156px');
    assert.equal(contextViewContent.style.minWidth, '96px');
    assert.equal(menu.style.minWidth, '100%');
    assert.equal(menu.classList.contains('comet-dropdown-menu-bottom'), true);

    menuPresenter.dispose();
    dropdownView.dispose();
  } finally {
    document.body.replaceChildren();
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
  }
});

test('dropdown renders option icons in both trigger field and portal menu items', () => {
  const dropdownView = createDropdownView({
    value: 'science',
    options: [
      { value: 'nature', label: 'Nature', icon: 'openai' },
      { value: 'science', label: 'Science', icon: 'model' },
    ],
  });
  const dropdown = dropdownView.getElement();
  document.body.append(dropdown);

  try {
    const triggerIcon = dropdown.querySelector('.comet-dropdown-field .comet-dropdown-option-icon');
    assert(triggerIcon instanceof HTMLElement);

    dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const menuIcon = document.body.querySelector('.comet-dropdown-menu-portal .comet-dropdown-option-icon');
    assert(menuIcon instanceof HTMLElement);
  } finally {
    dropdownView.dispose();
    document.body.replaceChildren();
  }
});

test('dropdown portal menu can opt out of matching the trigger width', () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 1280,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 720,
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      if (this.classList.contains('comet-dropdown-menu')) {
        return 180;
      }
      return 0;
    },
  });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      if (this.classList.contains('comet-dropdown-menu')) {
        return 84;
      }
      return 0;
    },
  });

  try {
    const menuPresenter = createDomDropdownMenuPresenter({ layer: 'portal' });
    const dropdownView = createDropdownView({
      menuPresenter,
      matchTriggerWidth: false,
      value: 'nature',
      options: [
        { value: 'nature', label: 'Nature' },
        { value: 'science', label: 'Science and research with a longer label' },
      ],
    });
    const dropdown = dropdownView.getElement();
    dropdown.getBoundingClientRect = () =>
      createDomRect({ x: 40, y: 120, width: 96, height: 32 });
    document.body.append(dropdown);

    dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const contextViewContent = document.body.querySelector('.comet-context-view-content');
    const menu = document.body.querySelector('.comet-dropdown-menu-portal');
    assert(contextViewContent instanceof HTMLElement);
    assert(menu instanceof HTMLElement);
    assert.equal(contextViewContent.style.minWidth, '0px');
    assert.equal(menu.style.minWidth, '0px');

    menuPresenter.dispose();
    dropdownView.dispose();
  } finally {
    document.body.replaceChildren();
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
  }
});

test('dropdown delegates menu lifecycle to an injected presenter without rendering a DOM menu', () => {
  const requests: import('cs/base/browser/ui/dropdown/dropdown').DropdownMenuRequest[] = [];
  let visible = false;
  let hideCount = 0;
  const menuPresenter: import('cs/base/browser/ui/dropdown/dropdown').DropdownMenuPresenter = {
    isDetached: true,
    supportsActiveDescendant: false,
    respondsToViewportChanges: true,
    show(request) {
      visible = true;
      requests.push(request);
    },
    hide() {
      if (!visible) {
        return;
      }
      visible = false;
      hideCount += 1;
    },
    isVisible() {
      return visible;
    },
    containsTarget() {
      return false;
    },
    dispose() {
      visible = false;
    },
  };
  const dropdownView = createDropdownView({
    menuPresenter,
    value: 'nature',
    options: [
      { value: 'nature', label: 'Nature' },
      { value: 'science', label: 'Science' },
    ],
  });
  const dropdown = dropdownView.getElement();
  dropdown.getBoundingClientRect = () =>
    createDomRect({ x: 80, y: 60, width: 120, height: 32 });
  document.body.append(dropdown);

  try {
    dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    assert.equal(document.body.querySelector('.comet-dropdown-menu'), null);
    assert.equal(requests.length, 1);
    assert.equal(requests[0]?.source, 'open');
    assert.deepEqual(requests[0]?.triggerRect, {
      x: 80,
      y: 60,
      width: 120,
      height: 32,
    });
    assert.equal(requests[0]?.align, 'start');
    assert.deepEqual(requests[0]?.options, [
      { value: 'nature', label: 'Nature' },
      { value: 'science', label: 'Science' },
    ]);
    assert.equal(requests[0]?.value, 'nature');

    dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert.equal(hideCount, 1);
  } finally {
    menuPresenter.dispose();
    dropdownView.dispose();
    document.body.replaceChildren();
  }
});

test('dropdown portal menu closes when focus moves to another control', async () => {
  const menuPresenter = createDomDropdownMenuPresenter({ layer: 'portal' });
  const dropdownView = createDropdownView({
    menuPresenter,
    value: 'nature',
    options: [
      { value: 'nature', label: 'Nature' },
      { value: 'science', label: 'Science' },
    ],
  });
  const dropdown = dropdownView.getElement();
  dropdown.getBoundingClientRect = () =>
    createDomRect({ x: 24, y: 80, width: 120, height: 32 });
  const otherButton = document.createElement('button');
  otherButton.textContent = 'Other';
  document.body.append(dropdown, otherButton);

  try {
    dropdown.focus();
    dropdown.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    assert(document.body.querySelector('.comet-dropdown-menu-portal') instanceof HTMLElement);

    otherButton.focus();
    await delay(0);

    assert.equal(document.body.querySelector('.comet-dropdown-menu-portal'), null);
    assert.equal(dropdown.getAttribute('aria-expanded'), 'false');
  } finally {
    menuPresenter.dispose();
    dropdownView.dispose();
    document.body.replaceChildren();
  }
});

test('dropdown exposes basic aria metadata and keyboard selection for DOM menus', () => {
  const selections: string[] = [];
  const dropdownView = createDropdownView({
    value: 'nature',
    options: [
      { value: 'nature', label: 'Nature' },
      { value: 'science', label: 'Science' },
    ],
    onChange: ({ target }) => {
      selections.push(target.value);
    },
  });
  const dropdown = dropdownView.getElement();
  document.body.append(dropdown);

  try {
    assert.equal(dropdown.getAttribute('role'), 'combobox');
    assert.equal(dropdown.getAttribute('aria-haspopup'), 'listbox');
    assert.equal(dropdown.getAttribute('aria-expanded'), 'false');

    dropdown.focus();
    dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(dropdown.contains(menu), false);
    assert.equal(dropdown.getAttribute('aria-expanded'), 'true');
    assert.equal(dropdown.getAttribute('aria-controls'), menu.id);
    assert.equal(dropdown.getAttribute('aria-activedescendant'), `${menu.id}-option-1`);

    dropdown.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

    assert.deepEqual(selections, ['science']);
    assert.equal(document.body.querySelector('.comet-dropdown-menu'), null);
  } finally {
    dropdownView.dispose();
    document.body.replaceChildren();
  }
});

test('dropdown menu actions fall back to run when onClick is omitted', async () => {
  let runs = 0;
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    menu: [
      {
        id: 'archive',
        label: 'Archive',
        run: () => {
          runs += 1;
        },
      },
    ],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

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

    assert.equal(runs, 1);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});
