import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let setARIAContainer: typeof import('cs/base/browser/ui/aria/aria').setARIAContainer;
let alert: typeof import('cs/base/browser/ui/aria/aria').alert;
let status: typeof import('cs/base/browser/ui/aria/aria').status;

function getAlertRegions() {
  return Array.from(document.querySelectorAll('.comet-aria-alert')) as HTMLElement[];
}

function getStatusRegions() {
  return Array.from(document.querySelectorAll('.comet-aria-status')) as HTMLElement[];
}

function setNavigatorPlatform(platform: string) {
  Object.defineProperty(window.navigator, 'platform', {
    configurable: true,
    value: platform,
  });
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ setARIAContainer, alert, status } = await import('cs/base/browser/ui/aria/aria'));
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('setARIAContainer creates hidden live regions once per parent', () => {
  const host = document.createElement('div');
  document.body.append(host);

  setARIAContainer(host);
  setARIAContainer(host);

  const containers = host.querySelectorAll('.comet-aria-container');
  assert.equal(containers.length, 1);
  assert.equal(getAlertRegions().length, 2);
  assert.equal(getStatusRegions().length, 2);
});

test('alert alternates regions when the same message is announced repeatedly', () => {
  const host = document.createElement('div');
  document.body.append(host);
  setARIAContainer(host);

  alert('Saved');
  let [firstRegion, secondRegion] = getAlertRegions();
  assert.equal(firstRegion?.textContent, 'Saved');
  assert.equal(secondRegion?.textContent, '');

  alert('Saved');
  [firstRegion, secondRegion] = getAlertRegions();
  assert.equal(firstRegion?.textContent, '');
  assert.equal(secondRegion?.textContent, 'Saved');
});

test('status falls back to alert regions on macOS', () => {
  const host = document.createElement('div');
  document.body.append(host);
  setARIAContainer(host);
  const previousPlatform = window.navigator.platform;
  setNavigatorPlatform('MacIntel');

  try {
    status('Search complete');
  } finally {
    setNavigatorPlatform(previousPlatform);
  }

  const [firstAlertRegion, secondAlertRegion] = getAlertRegions();
  const [firstStatusRegion, secondStatusRegion] = getStatusRegions();
  assert.equal(firstAlertRegion?.textContent, 'Search complete');
  assert.equal(secondAlertRegion?.textContent, '');
  assert.equal(firstStatusRegion?.textContent, '');
  assert.equal(secondStatusRegion?.textContent, '');
});
