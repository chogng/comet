import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';
import type { HoverInput, IHoverDelegate } from 'cs/base/browser/ui/hover/hover';

let cleanupDomEnvironment: (() => void) | null = null;
let createHoverController: typeof import('cs/base/browser/ui/hover/hoverWidget').createHoverController;
let createButtonView: typeof import('cs/base/browser/ui/button/button').createButtonView;
let InputBox: typeof import('cs/base/browser/ui/inputbox/inputBox').InputBox;
let createDropdownView: typeof import('cs/base/browser/ui/dropdown/dropdown').createDropdownView;

function dispatchPointerDown(
  target: EventTarget,
  init: MouseEventInit | PointerEventInit = {},
) {
  if (typeof window.PointerEvent === 'function') {
    target.dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, ...init }),
    );
  }

  target.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true, ...init }));
}

function dispatchPointerMove(
  target: EventTarget,
  init: MouseEventInit | PointerEventInit = {},
) {
  if (typeof window.PointerEvent === 'function') {
    target.dispatchEvent(
      new window.PointerEvent('pointermove', { bubbles: true, ...init }),
    );
  }

  target.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, ...init }));
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createHoverController } = await import('cs/base/browser/ui/hover/hoverWidget'));
  ({ createButtonView } = await import('cs/base/browser/ui/button/button'));
  ({ InputBox } = await import('cs/base/browser/ui/inputbox/inputBox'));
  ({ createDropdownView } = await import('cs/base/browser/ui/dropdown/dropdown'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('hover controller renders comet-hover-actions and runs them from the overlay', async () => {
  let actionRuns = 0;
  const target = document.createElement('button');
  document.body.append(target);

  const hover = createHoverController(target, {
    content: 'Download PDF',
    subtitle: 'Article title',
    delay: 0,
    actions: [
      {
        label: 'View details',
        run: () => {
          actionRuns += 1;
        },
      },
    ],
  });

  target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
  await delay(0);

  const overlayAction = document.querySelector('.comet-hover-action');
  assert(overlayAction instanceof HTMLButtonElement);
  assert.equal(overlayAction.textContent, 'View details');

  overlayAction.click();
  assert.equal(actionRuns, 1);
  assert.equal(document.querySelector('.comet-hover-card'), null);

  hover.dispose();
});

test('button view uses shared hover content instead of native title tooltips', async () => {
  const buttonView = createButtonView({
    mode: 'icon',
    title: 'Settings',
    hover: {
      content: 'Settings',
      delay: 0,
    },
    content: document.createTextNode('S'),
  });
  const button = buttonView.getElement();
  document.body.append(button);

  try {
    assert.equal(button.getAttribute('title'), null);

    button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);

    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'Settings');
  } finally {
    buttonView.dispose();
  }
});

test('button view can use an injected hover service delegate', async () => {
  let delegateCreateCalls = 0;
  let lastHoverTarget: HTMLElement | null = null;
  const hoverService: IHoverDelegate = {
    createHover(target: HTMLElement, input: HoverInput) {
      delegateCreateCalls += 1;
      lastHoverTarget = target;
      return createHoverController(target, input);
    },
  };
  const buttonView = createButtonView({
    mode: 'icon',
    content: document.createTextNode('H'),
    hoverService,
    hover: {
      content: 'Injected hover',
      delay: 0,
    },
  });
  const button = buttonView.getElement();
  document.body.append(button);

  try {
    assert.equal(delegateCreateCalls, 1);
    assert.equal(lastHoverTarget, button);

    button.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);

    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'Injected hover');
  } finally {
    buttonView.dispose();
  }
});

test('input box can be used with shared hover content instead of native title tooltips', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const inputBox = new InputBox(host, undefined, {
    value: 'https://example.com',
  });
  const hover = createHoverController(inputBox.element, {
    content: 'Article URL',
    delay: 0,
  });

  try {
    assert.equal(inputBox.element.getAttribute('title'), null);

    inputBox.element.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);

    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'Article URL');
  } finally {
    hover.dispose();
    inputBox.dispose();
  }
});

test('input box exposes focus state and supports ranged selection', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const inputBox = new InputBox(host, undefined, {
    value: 'https://example.com/article',
  });

  try {
    assert.equal(inputBox.hasFocus(), false);

    inputBox.focus();
    assert.equal(inputBox.hasFocus(), true);

    inputBox.select({ start: 8, end: 19 });
    assert.equal(inputBox.inputElement.selectionStart, 8);
    assert.equal(inputBox.inputElement.selectionEnd, 19);

    inputBox.blur();
    assert.equal(inputBox.hasFocus(), false);
  } finally {
    inputBox.dispose();
  }
});

test('dropdown view uses shared hover content instead of native title tooltips', async () => {
  const dropdownView = createDropdownView({
    title: 'Quick access source',
    value: 'nature',
    options: [
      {
        value: 'nature',
        label: 'Nature',
      },
    ],
  });
  const dropdown = dropdownView.getElement();
  document.body.append(dropdown);

  try {
    assert.equal(dropdown.getAttribute('title'), null);

    dropdown.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(650);

    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'Quick access source');
  } finally {
    dropdownView.dispose();
  }
});

test('string hover input hides when the pointer leaves the target', async () => {
  const target = document.createElement('button');
  document.body.append(target);

  const hover = createHoverController(target, {
    content: 'Plain hover',
    delay: 0,
  });

  try {
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);
    assert(document.querySelector('.comet-hover-card') instanceof HTMLElement);

    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await delay(40);
    assert(document.querySelector('.comet-hover-card') instanceof HTMLElement);
    await delay(120);
    await delay(0);
    assert.equal(document.querySelector('.comet-hover-card'), null);
  } finally {
    hover.dispose();
  }
});

test('hover with comet-hover-actions stays open when the pointer moves into the overlay', async () => {
  const target = document.createElement('button');
  document.body.append(target);

  const hover = createHoverController(target, {
    content: 'Action hover',
    delay: 0,
    actions: [
      {
        label: 'Run',
        run: () => {},
      },
    ],
  });

  try {
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);

    const overlay = document.querySelector('.comet-hover-card');
    assert(overlay instanceof HTMLElement);

    target.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    overlay.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);

    assert(document.querySelector('.comet-hover-card') instanceof HTMLElement);
  } finally {
    hover.dispose();
  }
});

test('comet-is-compact hover applies the comet-is-compact class', async () => {
  const target = document.createElement('button');
  document.body.append(target);

  const hover = createHoverController(target, {
    content: 'Compact hover',
    compact: true,
    delay: 0,
  });

  try {
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);

    const overlay = document.querySelector('.comet-hover-card');
    assert(overlay instanceof HTMLElement);
    assert.equal(overlay.classList.contains('comet-is-compact'), true);
  } finally {
    hover.dispose();
  }
});

test('plain hover waits for the higher default mouse delay', async () => {
  const target = document.createElement('button');
  document.body.append(target);

  const hover = createHoverController(target, 'Delayed hover');

  try {
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(450);
    assert.equal(document.querySelector('.comet-hover-card'), null);

    await delay(220);
    const overlay = document.querySelector('.comet-hover-card');
    assert(overlay instanceof HTMLElement);
  } finally {
    hover.dispose();
  }
});

test('focus shows hover immediately without waiting for mouse intent delay', async () => {
  const target = document.createElement('button');
  document.body.append(target);

  const hover = createHoverController(target, 'Focus hover');

  try {
    document.dispatchEvent(new window.KeyboardEvent('keydown', { bubbles: true, key: 'Tab' }));
    target.dispatchEvent(new window.FocusEvent('focus', { bubbles: true }));
    await delay(0);

    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'Focus hover');
  } finally {
    hover.dispose();
  }
});

test('pointer-driven focus does not show hover immediately', async () => {
  const target = document.createElement('button');
  document.body.append(target);

  const hover = createHoverController(target, 'Pointer focus hover');

  try {
    dispatchPointerDown(document);
    target.dispatchEvent(new window.FocusEvent('focus', { bubbles: true }));
    await delay(0);

    assert.equal(document.querySelector('.comet-hover-card'), null);
  } finally {
    hover.dispose();
  }
});

test('pointer down suppresses hover while the pointer stays on the target', async () => {
  const target = document.createElement('button');
  document.body.append(target);
  target.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 10,
      right: 50,
      bottom: 40,
      width: 40,
      height: 30,
      x: 10,
      y: 10,
      toJSON() {
        return this;
      },
    }) as DOMRect;

  const hover = createHoverController(target, {
    content: 'Suppressed hover',
    delay: 0,
  });

  try {
    dispatchPointerDown(target);
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(200);

    assert.equal(document.querySelector('.comet-hover-card'), null);

    await delay(600);
    assert.equal(document.querySelector('.comet-hover-card'), null);

    dispatchPointerMove(document, {
      clientX: 80,
      clientY: 80,
    });
    target.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);

    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'Suppressed hover');
  } finally {
    hover.dispose();
  }
});

test('pointer down suppression carries across a recreated hover target', async () => {
  const firstTarget = document.createElement('button');
  document.body.append(firstTarget);
  firstTarget.getBoundingClientRect = () =>
    ({
      left: 10,
      top: 10,
      right: 50,
      bottom: 40,
      width: 40,
      height: 30,
      x: 10,
      y: 10,
      toJSON() {
        return this;
      },
    }) as DOMRect;

  const firstHover = createHoverController(firstTarget, {
    content: 'First target',
    delay: 0,
  });

  try {
    dispatchPointerDown(firstTarget);

    const secondTarget = document.createElement('button');
    document.body.append(secondTarget);
    secondTarget.getBoundingClientRect = () =>
      ({
        left: 10,
        top: 10,
        right: 50,
        bottom: 40,
        width: 40,
        height: 30,
        x: 10,
        y: 10,
        toJSON() {
          return this;
        },
      }) as DOMRect;
    const secondHover = createHoverController(secondTarget, {
      content: 'Second target',
      delay: 0,
    });

    try {
      secondTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await delay(200);
      assert.equal(document.querySelector('.comet-hover-card'), null);

      await delay(600);
      assert.equal(document.querySelector('.comet-hover-card'), null);

      dispatchPointerMove(document, {
        clientX: 80,
        clientY: 80,
      });
      secondTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
      await delay(0);

      const overlayContent = document.querySelector('.comet-hover-content');
      assert(overlayContent instanceof HTMLElement);
      assert.equal(overlayContent.textContent, 'Second target');
    } finally {
      secondHover.dispose();
    }
  } finally {
    firstHover.dispose();
  }
});

test('plain hover applies cooldown before reopening on a nearby target', async () => {
  const firstTarget = document.createElement('button');
  const secondTarget = document.createElement('button');
  document.body.append(firstTarget, secondTarget);

  const firstHover = createHoverController(firstTarget, {
    content: 'First hover',
    delay: 0,
  });
  const secondHover = createHoverController(secondTarget, 'Second hover');

  try {
    firstTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(0);
    assert(document.querySelector('.comet-hover-card') instanceof HTMLElement);

    firstTarget.dispatchEvent(new MouseEvent('mouseleave', { bubbles: true }));
    await delay(140);
    assert.equal(document.querySelector('.comet-hover-card'), null);

    secondTarget.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
    await delay(250);
    assert.equal(document.querySelector('.comet-hover-card'), null);

    await delay(420);
    const overlayContent = document.querySelector('.comet-hover-content');
    assert(overlayContent instanceof HTMLElement);
    assert.equal(overlayContent.textContent, 'Second hover');
  } finally {
    firstHover.dispose();
    secondHover.dispose();
  }
});
