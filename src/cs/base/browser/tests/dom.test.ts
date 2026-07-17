import assert from 'node:assert/strict';
import test, { after, before } from 'node:test';

import { append, clearNode, reset } from 'base/browser/dom';
import { safeSetInnerHtml, sanitizeHtml } from 'base/browser/domSanitize';
import { createFastDomNode } from 'base/browser/fastDomNode';
import { installDomTestEnvironment } from 'cs/base/test/browser/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;

before(() => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

test('reset clears existing content and appends nodes without using html strings', () => {
  const parent = document.createElement('div');
  parent.append('old');

  const child = document.createElement('span');
  child.textContent = 'new';
  reset(parent, child, ' tail');

  assert.equal(parent.textContent, 'new tail');
  assert.equal(parent.firstElementChild, child);

  clearNode(parent);
  assert.equal(parent.childNodes.length, 0);
});

test('append returns the appended node for single-node calls', () => {
  const parent = document.createElement('div');
  const child = document.createElement('button');

  assert.equal(append(parent, child), child);
  assert.equal(parent.firstElementChild, child);
});

test('safeSetInnerHtml removes scripts, event handlers, and unsafe urls', () => {
  const parent = document.createElement('div');

  safeSetInnerHtml(
    parent,
    '<p onclick="run()">Hello <a href="javascript:run()">bad</a><a href="https://example.com">ok</a><script>alert(1)</script></p>',
  );

  assert.equal(parent.querySelector('script'), null);
  assert.equal(parent.querySelector('p')?.hasAttribute('onclick'), false);
  assert.equal(parent.querySelector('a')?.hasAttribute('href'), false);
  assert.equal(parent.querySelectorAll('a')[1]?.getAttribute('href'), 'https://example.com');
});

test('sanitizeHtml supports relative links only when configured', () => {
  assert.equal(String(sanitizeHtml('<a href="/paper.pdf">paper</a>')), '<a>paper</a>');
  assert.equal(
    String(sanitizeHtml('<a href="/paper.pdf">paper</a>', { allowRelativeLinkPaths: true })),
    '<a href="/paper.pdf">paper</a>',
  );
});

test('fast dom node normalizes numeric values and skips repeated style writes', () => {
  const element = document.createElement('div');
  const fastNode = createFastDomNode(element);

  fastNode.setWidth(12);
  assert.equal(element.style.width, '12px');

  element.style.width = '24px';
  fastNode.setWidth(12);
  assert.equal(element.style.width, '24px');

  fastNode.setWidth('50%');
  assert.equal(element.style.width, '50%');
});
