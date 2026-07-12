/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'node:assert/strict';
import test, { after, afterEach, before, beforeEach } from 'node:test';
import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import { createDropdownTestServices } from 'cs/base/test/browser/dropdownTestServices';
import type { DropdownContextServices } from 'cs/base/browser/ui/dropdown/dropdownActionViewItem';

let cleanupDomEnvironment: (() => void) | null = null;
let restoreComputedStyle: (() => void) | null = null;
let SelectBox: typeof import('cs/base/browser/ui/selectbox/selectBox').SelectBox;
let dropdownServices: DropdownContextServices & { dispose(): void };

function createDomRect(x: number, y: number, width: number, height: number) {
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
  ({ SelectBox } = await import('cs/base/browser/ui/selectbox/selectBox'));
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

test('selectbox renders a native select with configured options', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const selectBox = new SelectBox(
    [
      { text: 'System', value: 'system' },
      { text: 'Light', value: 'light', isDisabled: true },
      { text: 'Dark', value: 'dark' },
    ],
    2,
    undefined,
  );

  try {
    selectBox.render(container);

    const select = container.querySelector('select');
    if (!(select instanceof HTMLElement)) {
      throw new Error('Expected a native select element.');
    }
    const decorator = container.querySelector('.comet-select-box-decorator');
    if (!(decorator instanceof HTMLElement)) {
      throw new Error('Expected select trigger decorator icon element.');
    }
    assert.equal(decorator.querySelector('.lx-icon-unfold') instanceof HTMLElement, true);

    assert.equal(select.classList.contains('comet-select-box'), true);
    assert.equal(select.getAttribute('aria-label'), null);
    assert.equal((select as HTMLSelectElement).options.length, 3);
    assert.equal((select as HTMLSelectElement).selectedIndex, 2);
    assert.equal((select as HTMLSelectElement).options[1]?.disabled, true);
  } finally {
    selectBox.dispose();
    document.body.replaceChildren();
  }
});

test('selectbox fires onDidSelect when the selected option changes', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const selectBox = new SelectBox(
    [
      { text: 'Chinese', value: 'zh-CN' },
      { text: 'English', value: 'en-US' },
    ],
    0,
    undefined,
  );
  const events: Array<{ index: number; selected: string }> = [];
  const subscription = selectBox.onDidSelect((event) => {
    events.push(event);
  });

  try {
    selectBox.render(container);
    const select = selectBox.domNode;
    select.selectedIndex = 1;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    assert.deepEqual(events, [{ index: 1, selected: 'en-US' }]);
  } finally {
    subscription.dispose();
    selectBox.dispose();
    document.body.replaceChildren();
  }
});

test('selectbox keeps selected index in range when options change', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const selectBox = new SelectBox(
    [
      { text: 'A' },
      { text: 'B' },
    ],
    0,
    undefined,
  );

  try {
    selectBox.render(container);
    selectBox.select(9);
    assert.equal(selectBox.domNode.selectedIndex, 1);

    selectBox.setOptions([{ text: 'Only' }]);
    assert.equal(selectBox.domNode.options.length, 1);
    assert.equal(selectBox.domNode.selectedIndex, 0);
  } finally {
    selectBox.dispose();
    document.body.replaceChildren();
  }
});

test('selectbox supports style() and setFocusable()', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const selectBox = new SelectBox([{ text: 'Default' }], 0, undefined);

  try {
    selectBox.render(container);
    selectBox.style({
      selectBackground: 'rgb(1, 2, 3)',
      selectForeground: 'rgb(4, 5, 6)',
      selectBorder: 'rgb(7, 8, 9)',
      focusBorder: 'rgb(10, 11, 12)',
    });

    assert.equal(selectBox.domNode.style.backgroundColor, 'rgb(1, 2, 3)');
    assert.equal(selectBox.domNode.style.color, 'rgb(4, 5, 6)');
    assert.equal(selectBox.domNode.style.borderColor, 'rgb(7, 8, 9)');
    assert.equal(
      selectBox.domNode.style.getPropertyValue('--cs-select-focusBorder'),
      'rgb(10, 11, 12)',
    );

    selectBox.setFocusable(false);
    assert.equal(selectBox.domNode.tabIndex, -1);
    selectBox.setFocusable(true);
    assert.equal(selectBox.domNode.tabIndex, 0);
  } finally {
    selectBox.dispose();
    document.body.replaceChildren();
  }
});

test('selectbox custom drawn mode opens contextview menu and selects an option', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const selectBox = new SelectBox(
    [
      { text: 'Chinese', value: 'zh-CN' },
      { text: 'English', value: 'en-US' },
    ],
    0,
    dropdownServices.contextViewProvider,
    {},
    { useCustomDrawn: true },
  );
  const events: Array<{ index: number; selected: string }> = [];
  const subscription = selectBox.onDidSelect((event) => {
    events.push(event);
  });

  try {
    selectBox.render(container);
    selectBox.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const menu = document.body.querySelector('.comet-menu[role="listbox"]');
    if (!(menu instanceof HTMLElement)) {
      throw new Error('Expected custom drawn selectbox menu.');
    }

    const options = menu.querySelectorAll<HTMLElement>('.comet-dropdown-menu-item');
    assert.equal(options.length, 2);
    options[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    assert.equal(selectBox.domNode.value, 'en-US');
    assert.deepEqual(events, [{ index: 1, selected: 'en-US' }]);
  } finally {
    subscription.dispose();
    selectBox.dispose();
    document.body.replaceChildren();
  }
});

test('selectbox custom drawn mode keeps the popup overlay matched to the trigger width', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const selectBox = new SelectBox(
    [
      { text: 'Very long font family label', value: 'font-a' },
      { text: 'Short', value: 'font-b' },
    ],
    0,
    dropdownServices.contextViewProvider,
    {},
    { useCustomDrawn: true },
  );

  try {
    selectBox.render(container);
    selectBox.domNode.getBoundingClientRect = () => createDomRect(48, 96, 140, 24);

    selectBox.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const contextView = document.body.querySelector('.context-view.comet-select-box-context-view');
    const menu = document.body.querySelector('.comet-menu[role="listbox"]');
    if (!(contextView instanceof HTMLElement)) {
      throw new Error('Expected selectbox context view content.');
    }
    if (!(menu instanceof HTMLElement)) {
      throw new Error('Expected selectbox listbox menu.');
    }

    assert.equal(contextView.style.minWidth, '140px');
    assert.equal(menu.classList.contains('comet-menu-root'), true);
  } finally {
    selectBox.dispose();
    document.body.replaceChildren();
  }
});

test('selectbox custom drawn mode uses the provided contextview provider', () => {
  const container = document.createElement('div');
  document.body.append(container);
  let showCount = 0;
  let actualLayer: number | undefined;
  let activeView: { dispose: () => void } | null = null;
  const contextViewProvider = {
    showContextView(delegate: {
      render: (container: HTMLElement) => void;
      onHide?: () => void;
      layer?: number;
    }) {
      showCount += 1;
      actualLayer = delegate.layer;
      const viewElement = document.createElement('div');
      delegate.render(viewElement);
      document.body.append(viewElement);
      activeView = {
        dispose: () => {
          viewElement.remove();
          activeView = null;
          delegate.onHide?.();
        },
      };
      return activeView;
    },
    hideContextView() {
      activeView?.dispose();
    },
    getContextViewElement() {
      return document.body;
    },
    layout() {},
    isVisible() {
      return activeView !== null;
    },
    dispose() {
      activeView?.dispose();
    },
  };
  const selectBox = new SelectBox(
    [
      { text: 'Agent', value: 'agent' },
      { text: 'Flow', value: 'flow' },
    ],
    0,
    contextViewProvider,
    {},
    { useCustomDrawn: true, contextViewLayer: 1600 },
  );

  try {
    selectBox.render(container);
    selectBox.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    assert.equal(showCount, 1);
    assert.equal(actualLayer, 1600);
    assert.equal(document.body.querySelector('.comet-menu[role="listbox"]') instanceof HTMLElement, true);
  } finally {
    selectBox.dispose();
    document.body.replaceChildren();
  }
});

test('selectbox custom drawn mode keeps contextview open on internal scroll', () => {
  const container = document.createElement('div');
  document.body.append(container);
  const selectBox = new SelectBox(
    [
      { text: 'Chinese', value: 'zh-CN' },
      { text: 'English', value: 'en-US' },
    ],
    0,
    dropdownServices.contextViewProvider,
    {},
    { useCustomDrawn: true },
  );

  try {
    selectBox.render(container);
    selectBox.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const menu = document.body.querySelector('.comet-menu[role="listbox"]');
    if (!(menu instanceof HTMLElement)) {
      throw new Error('Expected custom drawn selectbox menu.');
    }

    menu.dispatchEvent(new Event('scroll'));
    assert.equal(document.body.querySelector('.comet-menu[role="listbox"]'), menu);

    document.body.dispatchEvent(new Event('scroll'));
    assert.equal(document.body.querySelector('.comet-menu[role="listbox"]'), null);
  } finally {
    selectBox.dispose();
    document.body.replaceChildren();
  }
});
