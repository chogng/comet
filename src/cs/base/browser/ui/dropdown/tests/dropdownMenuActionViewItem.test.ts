import assert from 'node:assert/strict';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';

let cleanupDomEnvironment: (() => void) | null = null;
let restoreComputedStyle: (() => void) | null = null;
let restoreElementDimensions: (() => void) | null = null;
let ActionWithDropdownActionViewItem:
  typeof import('cs/base/browser/ui/dropdown/dropdownActionViewItem').ActionWithDropdownActionViewItem;
let createDropdownMenuActionViewItem:
  typeof import('cs/base/browser/ui/dropdown/dropdownActionViewItem').createDropdownMenuActionViewItem;
let DropdownMenuActionViewItem:
  typeof import('cs/base/browser/ui/dropdown/dropdownActionViewItem').DropdownMenuActionViewItem;
let dropdownServices: DropdownContextServices & { dispose(): void };

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

function installElementDimensionsFromClientRect() {
  const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const originalOffsetHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperties(HTMLElement.prototype, {
    offsetWidth: {
      configurable: true,
      get() {
        return this.getBoundingClientRect().width;
      },
    },
    offsetHeight: {
      configurable: true,
      get() {
        return this.getBoundingClientRect().height;
      },
    },
  });

  return () => {
    if (originalOffsetWidth) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth);
    }
    if (originalOffsetHeight) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', originalOffsetHeight);
    }
  };
}

before(async () => {
  if (typeof document !== 'undefined') {
    restoreComputedStyle = installStableComputedStyleZoom();
    restoreElementDimensions = installElementDimensionsFromClientRect();
    ({
      ActionWithDropdownActionViewItem,
      createDropdownMenuActionViewItem,
      DropdownMenuActionViewItem,
    } = await import('cs/base/browser/ui/dropdown/dropdownActionViewItem'));
    return;
  }

  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  restoreComputedStyle = installStableComputedStyleZoom();
  restoreElementDimensions = installElementDimensionsFromClientRect();
  ({
    ActionWithDropdownActionViewItem,
    createDropdownMenuActionViewItem,
    DropdownMenuActionViewItem,
  } = await import('cs/base/browser/ui/dropdown/dropdownActionViewItem'));
});

after(() => {
  restoreComputedStyle?.();
  restoreComputedStyle = null;
  restoreElementDimensions?.();
  restoreElementDimensions = null;
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

beforeEach(async () => {
  dropdownServices = await createDropdownTestServices();
});

afterEach(() => {
  dropdownServices.dispose();
});

test('createDropdownMenuActionViewItem returns a dropdown action view item', () => {
  const item = createDropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    buttonClassName: 'example-action',
    menuClassName: 'example-menu',
    menu: [
      { label: 'Rename' },
      { label: 'Delete', disabled: true },
    ],
  });

  assert(item instanceof DropdownMenuActionViewItem);
});

test('DropdownMenuActionViewItem renders and opens a menu overlay', async () => {
  let selected = '';
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    menu: [
      {
        label: 'Archive',
        onClick: () => {
          selected = 'archive';
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
    const actionItem = host;
    assert.equal(actionItem.classList.contains('comet-actionbar-item'), true);

    button.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);
    assert.equal(document.activeElement, menu);
    assert.equal(actionItem.classList.contains('comet-is-active'), true);

    const archiveItem = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Archive'),
    );
    assert(archiveItem instanceof HTMLElement);
    archiveItem.click();
    await delay(0);

    assert.equal(selected, 'archive');
    assert.equal(button.getAttribute('aria-expanded'), 'false');
    assert.equal(actionItem.classList.contains('comet-is-active'), false);
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('shared context services transfer dropdown ownership without cross-closing', async () => {
  const firstItem = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'First',
    menu: [{ label: 'First action' }],
  });
  const secondItem = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'Second',
    menu: [{ label: 'Second action' }],
  });
  const firstHost = document.body.appendChild(document.createElement('div'));
  const secondHost = document.body.appendChild(document.createElement('div'));

  try {
    firstItem.render(firstHost);
    secondItem.render(secondHost);
    const firstButton = firstHost.querySelector('button');
    const secondButton = secondHost.querySelector('button');
    assert(firstButton instanceof HTMLButtonElement);
    assert(secondButton instanceof HTMLButtonElement);

    firstButton.click();
    assert.equal(firstButton.getAttribute('aria-expanded'), 'true');

    secondButton.click();
    assert.equal(firstButton.getAttribute('aria-expanded'), 'false');
    assert.equal(secondButton.getAttribute('aria-expanded'), 'true');
    assert.equal(dropdownServices.contextMenuService.isVisible(), true);
    assert.match(document.body.querySelector('.comet-dropdown-menu')?.textContent ?? '', /Second action/);

    firstItem.dispose();
    assert.equal(secondButton.getAttribute('aria-expanded'), 'true');
    assert.equal(dropdownServices.contextMenuService.isVisible(), true);
    assert.match(document.body.querySelector('.comet-dropdown-menu')?.textContent ?? '', /Second action/);
  } finally {
    firstItem.dispose();
    secondItem.dispose();
    document.body.replaceChildren();
  }
});

test('DropdownMenuActionViewItem can render a custom overlay', async () => {
  let closed = 0;
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'History',
    content: 'History',
    overlayRole: 'dialog',
    renderOverlay: ({ hide }) => {
      const overlay = document.createElement('div');
      overlay.className = 'custom-history-overlay';
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = 'Close';
      button.addEventListener('click', () => {
        closed += 1;
        hide();
      });
      overlay.append(button);
      return overlay;
    },
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const trigger = host.querySelector('button');
    assert(trigger instanceof HTMLButtonElement);
    const actionItem = host;
    assert.equal(actionItem.classList.contains('comet-actionbar-item'), true);

    trigger.click();
    await delay(0);

    const overlay = document.body.querySelector('.custom-history-overlay');
    assert(overlay instanceof HTMLElement);
    const contextViewContent = document.body.querySelector('.context-view');
    assert(contextViewContent instanceof HTMLElement);
    assert.equal(trigger.getAttribute('aria-haspopup'), 'dialog');
    assert.equal(trigger.getAttribute('aria-expanded'), 'true');
    assert.equal(contextViewContent.style.minWidth, '');
    assert.equal(actionItem.classList.contains('comet-is-active'), true);

    const closeButton = overlay.querySelector('button');
    assert(closeButton instanceof HTMLButtonElement);
    closeButton.click();
    await delay(0);

    assert.equal(closed, 1);
    assert.equal(trigger.getAttribute('aria-expanded'), 'false');
    assert.equal(actionItem.classList.contains('comet-is-active'), false);
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('DropdownMenuActionViewItem syncs custom overlay placement class from the resolved context view position', async () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 300,
  });

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('context-view')) {
      return {
        x: 8,
        y: 8,
        width: 180,
        height: 120,
        top: 8,
        left: 8,
        right: 188,
        bottom: 128,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    if (this.tagName === 'BUTTON') {
      return {
        x: 40,
        y: 260,
        width: 24,
        height: 24,
        top: 260,
        left: 40,
        right: 64,
        bottom: 284,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'History',
    content: 'History',
    overlayRole: 'dialog',
    renderOverlay: () => {
      const overlay = document.createElement('div');
      overlay.className = 'custom-history-overlay';
      return overlay;
    },
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const trigger = host.querySelector('button');
    assert(trigger instanceof HTMLButtonElement);

    trigger.click();
    await delay(0);
    await delay(0);

    const contextView = document.body.querySelector('.context-view');
    const overlay = document.body.querySelector('.custom-history-overlay');
    assert(contextView instanceof HTMLElement);
    assert(overlay instanceof HTMLElement);
    assert.equal(contextView.classList.contains('top'), true, contextView.outerHTML);
    assert.equal(overlay.classList.contains('comet-dropdown-menu-top'), true, overlay.outerHTML);
    assert.equal(overlay.classList.contains('comet-dropdown-menu-bottom'), false);
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
  }
});

test('DropdownMenuActionViewItem delegates menu lifecycle to an injected context menu service', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  let visible = false;
  let hideCount = 0;
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      visible = true;
      delegates.push(delegate);
    },
    hideContextMenu() {
      if (!visible) {
        return;
      }
      visible = false;
      hideCount += 1;
      delegates.at(-1)?.onHide?.(true);
    },
    isVisible() {
      return visible;
    },
    dispose() {
      visible = false;
    },
  };
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    contextMenuService,
    menuData: 'draft-toolbar-overflow',
    menu: [
      {
        label: 'Archive',
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

    assert.equal(document.body.querySelector('.comet-dropdown-menu'), null);
    assert.equal(delegates.length, 1);
    assert.equal(delegates[0]?.getAnchor(), button);
    assert.equal(delegates[0]?.offset, undefined);
    assert.equal(delegates[0]?.minWidth, undefined);
    assert.equal(delegates[0]?.position, 'below');
    assert.equal(delegates[0]?.autoFocusOnShow, false);
    assert.equal(delegates[0]?.restoreFocusOnHide, false);
    assert.equal(delegates[0]?.getMenuData?.(), 'draft-toolbar-overflow');
    assert.equal(button.getAttribute('aria-expanded'), 'true');

    button.click();
    await delay(0);

    assert.equal(hideCount, 1);
    assert.equal(button.getAttribute('aria-expanded'), 'false');
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('DropdownMenuActionViewItem requests focus restoration when opened from keyboard', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return false;
    },
    dispose() {},
  };
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    contextMenuService,
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await delay(0);

    assert.equal(delegates.length, 1);
    assert.equal(delegates[0]?.autoFocusOnShow, true);
    assert.equal(delegates[0]?.restoreFocusOnHide, true);
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('DropdownMenuActionViewItem forwards a custom offset to the context menu service', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return false;
    },
    dispose() {},
  };
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    contextMenuService,
    offset: 12,
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);

    assert.equal(delegates.length, 1);
    assert.equal(delegates[0]?.offset, 12);
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('DropdownMenuActionViewItem forwards requested menu position to the context menu service', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return false;
    },
    dispose() {},
  };
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    contextMenuService,
    overlayPosition: 'above',
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);

    assert.equal(delegates.length, 1);
    assert.equal(delegates[0]?.position, 'above');
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('DropdownMenuActionViewItem forwards menu header and supports dynamic menu updates', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return false;
    },
    dispose() {},
  };
  let selected = '';
  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'History',
    content: 'History',
    contextMenuService,
    menu: [
      {
        id: 'alpha',
        label: 'Alpha',
        onClick: () => {
          selected = 'alpha';
        },
      },
    ],
    menuHeader: {
      className: 'history-header',
      autoFocusOnShow: true,
      render: ({ updateMenu }) => {
        updateMenu([
          {
            id: 'beta',
            label: 'Beta',
            onClick: () => {
              selected = 'beta';
            },
          },
        ]);
        const header = document.createElement('div');
        header.className = 'history-header-node';
        return header;
      },
    },
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);

    assert.equal(delegates.length, 1);
    const delegate = delegates[0];
    assert.equal(delegate.getActions().at(0)?.label, 'Alpha');

    const header = delegate.getMenuHeader?.();
    assert(header);
    assert.equal(header.autoFocusOnShow, true);
    assert.equal(header.className, 'history-header');

    let updatedActions: readonly import('cs/base/common/actions').IAction[] = [];
    const headerNode = header.render({
      updateItems: (actions) => {
        updatedActions = actions;
      },
      hide: () => {},
    });
    assert.equal(headerNode.classList.contains('history-header-node'), true);
    assert.equal(updatedActions.length, 1);
    assert.equal(updatedActions[0]?.label, 'Beta');

    await delegate.actionRunner?.run(updatedActions[0]!);
    assert.equal(selected, 'beta');
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('DropdownMenuActionViewItem syncs menu placement class from the resolved context view position', async () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 300,
  });

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('context-view')) {
      return {
        x: 8,
        y: 8,
        width: 180,
        height: 120,
        top: 8,
        left: 8,
        right: 188,
        bottom: 128,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    if (this.tagName === 'BUTTON') {
      return {
        x: 40,
        y: 260,
        width: 24,
        height: 24,
        top: 260,
        left: 40,
        right: 64,
        bottom: 284,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    overlayPosition: 'above',
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);
    await delay(0);

    const contextView = document.body.querySelector('.context-view');
    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(contextView instanceof HTMLElement);
    assert(menu instanceof HTMLElement);
    assert.equal(contextView.classList.contains('top'), true);
    assert.equal(menu.classList.contains('comet-dropdown-menu-top'), true);
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
  }
});

test('DropdownMenuActionViewItem falls back to below placement when above cannot fit', async () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 300,
  });

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('context-view')) {
      return {
        x: 8,
        y: 8,
        width: 180,
        height: 120,
        top: 8,
        left: 8,
        right: 188,
        bottom: 128,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    if (this.tagName === 'BUTTON') {
      return {
        x: 40,
        y: 20,
        width: 24,
        height: 24,
        top: 20,
        left: 40,
        right: 64,
        bottom: 44,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    overlayPosition: 'above',
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);
    await delay(0);

    const contextView = document.body.querySelector('.context-view');
    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(contextView instanceof HTMLElement);
    assert(menu instanceof HTMLElement);
    assert.equal(contextView.classList.contains('bottom'), true, contextView.outerHTML);
    assert.equal(contextView.classList.contains('top'), false);
    assert.equal(menu.classList.contains('comet-dropdown-menu-bottom'), true, menu.outerHTML);
    assert.equal(menu.classList.contains('comet-dropdown-menu-top'), false);
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
  }
});

test('DropdownMenuActionViewItem flips above when the default below placement cannot fit', async () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 300,
  });

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('context-view')) {
      return {
        x: 8,
        y: 8,
        width: 180,
        height: 120,
        top: 8,
        left: 8,
        right: 188,
        bottom: 128,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    if (this.tagName === 'BUTTON') {
      return {
        x: 40,
        y: 260,
        width: 24,
        height: 24,
        top: 260,
        left: 40,
        right: 64,
        bottom: 284,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);
    await delay(0);

    const contextView = document.body.querySelector('.context-view');
    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(contextView instanceof HTMLElement);
    assert(menu instanceof HTMLElement);
    assert.equal(contextView.classList.contains('top'), true, contextView.outerHTML);
    assert.equal(contextView.classList.contains('bottom'), false);
    assert.equal(contextView.style.top, '136px');
    assert.equal(menu.classList.contains('comet-dropdown-menu-top'), true, menu.outerHTML);
    assert.equal(menu.classList.contains('comet-dropdown-menu-bottom'), false);
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
  }
});

test('DropdownMenuActionViewItem uses zoom-adjusted anchor geometry for menu placement', async () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalGetComputedStyle = window.getComputedStyle;
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 300,
  });

  window.getComputedStyle = ((element: Element) => {
    if (element instanceof HTMLButtonElement) {
      return { zoom: '2' } as CSSStyleDeclaration;
    }

    return originalGetComputedStyle.call(window, element);
  }) as typeof window.getComputedStyle;

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('context-view')) {
      return {
        x: 8,
        y: 8,
        width: 120,
        height: 60,
        top: 8,
        left: 8,
        right: 128,
        bottom: 68,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    if (this.tagName === 'BUTTON') {
      return {
        x: 100,
        y: 40,
        width: 20,
        height: 20,
        top: 40,
        left: 100,
        right: 120,
        bottom: 60,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);
    await delay(0);

    const contextView = document.body.querySelector('.context-view');
    assert(contextView instanceof HTMLElement);
    assert.equal(contextView.style.left, '200px');
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    window.getComputedStyle = originalGetComputedStyle;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
  }
});

test('DropdownMenuActionViewItem can opt into end alignment for menu placement', async () => {
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  const originalGetComputedStyle = window.getComputedStyle;
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 400,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    value: 300,
  });

  window.getComputedStyle = ((element: Element) => {
    if (element instanceof HTMLButtonElement) {
      return { zoom: '2' } as CSSStyleDeclaration;
    }

    return originalGetComputedStyle.call(window, element);
  }) as typeof window.getComputedStyle;

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.classList.contains('context-view')) {
      return {
        x: 8,
        y: 8,
        width: 120,
        height: 60,
        top: 8,
        left: 8,
        right: 128,
        bottom: 68,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    if (this.tagName === 'BUTTON') {
      return {
        x: 100,
        y: 40,
        width: 20,
        height: 20,
        top: 40,
        left: 100,
        right: 120,
        bottom: 60,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    overlayAlignment: 'end',
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);
    await delay(0);

    const contextView = document.body.querySelector('.context-view');
    assert(contextView instanceof HTMLElement);
    assert.equal(contextView.style.left, '120px');
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    window.getComputedStyle = originalGetComputedStyle;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
    if (originalInnerHeight) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeight);
    }
  }
});

test('DropdownMenuActionViewItem uses edge-aware policy near viewport edge', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return false;
    },
    dispose() {},
  };
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 320,
  });

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === 'BUTTON') {
      return {
        x: 280,
        y: 40,
        width: 20,
        height: 20,
        top: 40,
        left: 280,
        right: 300,
        bottom: 60,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    contextMenuService,
    overlayAlignmentPolicy: 'edge-aware',
    minWidth: 180,
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);

    assert.equal(delegates.length, 1);
    assert.equal(delegates[0]?.alignment, 'end');
    assert.equal(delegates[0]?.anchorAlignment, 'right');
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
  }
});

test('DropdownMenuActionViewItem uses prefer-start policy to flip when start cannot fit', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return false;
    },
    dispose() {},
  };
  const originalInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;

  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    value: 320,
  });

  HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.tagName === 'BUTTON') {
      return {
        x: 280,
        y: 40,
        width: 20,
        height: 20,
        top: 40,
        left: 280,
        right: 300,
        bottom: 60,
        toJSON() {
          return this;
        },
      } as DOMRect;
    }

    return originalGetBoundingClientRect.call(this);
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    contextMenuService,
    overlayAlignmentPolicy: 'prefer-start',
    minWidth: 180,
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);

    assert.equal(delegates.length, 1);
    assert.equal(delegates[0]?.alignment, 'end');
    assert.equal(delegates[0]?.anchorAlignment, 'right');
  } finally {
    item.dispose();
    document.body.replaceChildren();
    HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
    if (originalInnerWidth) {
      Object.defineProperty(window, 'innerWidth', originalInnerWidth);
    }
  }
});

test('DropdownMenuActionViewItem allows alignment provider to override static alignment', async () => {
  const delegates: import('cs/base/browser/contextmenu').ContextMenuDelegate[] = [];
  const contextMenuService: import('cs/base/browser/contextmenu').ContextMenuService = {
    showContextMenu(delegate) {
      delegates.push(delegate);
    },
    hideContextMenu() {},
    isVisible() {
      return false;
    },
    dispose() {},
  };

  const item = new DropdownMenuActionViewItem({
    ...dropdownServices,
    label: 'More',
    content: 'More',
    contextMenuService,
    overlayAlignment: 'start',
    overlayAlignmentProvider: () => 'end',
    menu: [{ label: 'Archive' }],
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const button = host.querySelector('button');
    assert(button instanceof HTMLButtonElement);

    button.click();
    await delay(0);

    assert.equal(delegates.length, 1);
    assert.equal(delegates[0]?.alignment, 'end');
    assert.equal(delegates[0]?.anchorAlignment, 'right');
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});

test('ActionWithDropdownActionViewItem renders primary and dropdown controls', async () => {
  let primaryRan = 0;
  let selected = '';
  const item = new ActionWithDropdownActionViewItem({
    primary: {
      label: 'Run',
      content: 'Run',
      onClick: () => {
        primaryRan += 1;
      },
    },
    dropdown: {
      ...dropdownServices,
      label: 'More',
      content: 'More',
      menu: [
        {
          label: 'Run with options',
          onClick: () => {
            selected = 'options';
          },
        },
      ],
    },
  });
  const host = document.createElement('div');
  document.body.append(host);

  try {
    item.render(host);
    const buttons = host.querySelectorAll('button');
    assert.equal(buttons.length, 2);

    const primaryButton = buttons[0] as HTMLButtonElement;
    const dropdownButton = buttons[1] as HTMLButtonElement;

    primaryButton.click();
    assert.equal(primaryRan, 1);

    dropdownButton.click();
    await delay(0);

    const menu = document.body.querySelector('.comet-dropdown-menu');
    assert(menu instanceof HTMLElement);

    const option = Array.from(menu.querySelectorAll('.comet-dropdown-menu-item')).find(
      (node) => node.textContent?.includes('Run with options'),
    );
    assert(option instanceof HTMLElement);
    option.click();
    await delay(0);

    assert.equal(selected, 'options');
  } finally {
    item.dispose();
    document.body.replaceChildren();
  }
});
