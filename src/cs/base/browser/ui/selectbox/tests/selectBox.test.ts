import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let restoreComputedStyle: (() => void) | null = null;
let SelectBox: typeof import('cs/base/browser/ui/selectbox/selectBox').SelectBox;

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
    undefined,
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
    undefined,
    {},
    { useCustomDrawn: true },
  );

  try {
    selectBox.render(container);
    selectBox.domNode.getBoundingClientRect = () => createDomRect(48, 96, 140, 24);

    selectBox.domNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    const contextViewContent = document.body.querySelector('.comet-context-view-content');
    const menu = document.body.querySelector('.comet-menu[role="listbox"]');
    if (!(contextViewContent instanceof HTMLElement)) {
      throw new Error('Expected selectbox context view content.');
    }
    if (!(menu instanceof HTMLElement)) {
      throw new Error('Expected selectbox listbox menu.');
    }

    assert.equal(contextViewContent.style.minWidth, '140px');
    assert.equal(menu.classList.contains('comet-menu-root'), true);
  } finally {
    selectBox.dispose();
    document.body.replaceChildren();
  }
});
