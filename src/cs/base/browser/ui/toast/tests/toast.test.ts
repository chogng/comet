import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createToastContainerView: typeof import('cs/base/browser/ui/toast/toast').createToastContainerView;
let registerToastBridge: typeof import('cs/base/browser/ui/toast/toast').registerToastBridge;
let toast: typeof import('cs/base/browser/ui/toast/toast').toast;

const TOAST_TEST_TIMEOUT_MS = 1000;
const TOAST_TEST_POLL_INTERVAL_MS = 10;
let activeToastIds: number[] = [];

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createToastContainerView, registerToastBridge, toast } = await import('cs/base/browser/ui/toast/toast'));
});

async function waitForCondition(
  condition: () => boolean,
  timeoutMs = TOAST_TEST_TIMEOUT_MS,
) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (condition()) {
      return;
    }

    await delay(TOAST_TEST_POLL_INTERVAL_MS);
  }

  assert.fail(`Timed out after ${timeoutMs}ms waiting for toast condition.`);
}

async function cleanupToastState() {
  registerToastBridge(null);
  const cleanupContainer = createToastContainerView();
  document.body.append(cleanupContainer.getElement());

  try {
    for (const id of activeToastIds) {
      toast.dismiss(id);
    }
    activeToastIds = [];

    await waitForCondition(
      () => cleanupContainer.getElement().querySelector('.comet-toast-item') === null,
    );
  } finally {
    cleanupContainer.dispose();
    document.body.replaceChildren();
  }
}

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('toast container renders toasts and close button dismisses them', async () => {
  const container = createToastContainerView({ closeLabel: 'Dismiss' });
  document.body.append(container.getElement());

  try {
    const id = toast.show({
      message: 'Saved',
      type: 'success',
      duration: Infinity,
    });
    activeToastIds.push(id);

    const toastItem = container.getElement().querySelector('.comet-toast-item');
    assert(toastItem instanceof HTMLElement);
    assert.equal(toastItem.textContent?.includes('Saved'), true);

    const closeButton = container.getElement().querySelector('.comet-toast-close');
    assert(closeButton instanceof HTMLButtonElement);
    assert.equal(closeButton.getAttribute('aria-label'), 'Dismiss');

    closeButton.click();
    await waitForCondition(() => container.getElement().querySelector('.comet-toast-item') === null);

    assert.equal(container.getElement().querySelector('.comet-toast-item'), null);
  } finally {
    container.dispose();
    await cleanupToastState();
  }
});

test('toast auto dismisses after the configured duration', async () => {
  const container = createToastContainerView();
  document.body.append(container.getElement());

  try {
    const id = toast.show({
      message: 'Auto hide',
      duration: 10,
    });
    activeToastIds.push(id);

    assert(container.getElement().querySelector('.comet-toast-item') instanceof HTMLElement);
    await waitForCondition(() => container.getElement().querySelector('.comet-toast-item') === null);

    assert.equal(container.getElement().querySelector('.comet-toast-item'), null);
  } finally {
    container.dispose();
    await cleanupToastState();
  }
});
