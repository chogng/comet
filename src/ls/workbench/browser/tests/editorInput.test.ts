import assert from 'node:assert/strict';
import test from 'node:test';
import { createWritingEditorDocumentFromPlainText } from 'ls/editor/common/writingEditorDocument';
import type { EditorWorkspaceDraftTab } from 'ls/workbench/browser/parts/editor/editorModel';
import {
  EMPTY_BROWSER_TAB_URL,
  EMPTY_PDF_TAB_URL,
  getEditorTabInputResourceKey,
  isEmptyBrowserTabInput,
  isEmptyPdfTabInput,
  normalizeEditorTabInput,
  toEditorTabInput,
} from 'ls/workbench/browser/parts/editor/editorInput';
import {
  getEditorContentDisplayUrl,
  getEditorContentTabTitle,
} from 'ls/workbench/browser/parts/editor/editorUrlPresentation';

test('toEditorTabInput strips draft-only payload from workspace tabs', () => {
  const draftTab: EditorWorkspaceDraftTab = {
    id: 'draft-a',
    kind: 'draft',
    title: 'Draft A',
    viewMode: 'draft',
    document: createWritingEditorDocumentFromPlainText('alpha'),
  };
  const input = toEditorTabInput(draftTab);

  assert.deepEqual(input, {
    id: 'draft-a',
    kind: 'draft',
    title: 'Draft A',
    viewMode: 'draft',
  });
});

test('normalizeEditorTabInput migrates legacy web inputs to browser inputs', () => {
  const input = normalizeEditorTabInput({
    id: 'browser-a',
    kind: 'web',
    title: 'Example',
    url: 'https://example.com/paper',
  });

  assert.deepEqual(input, {
    id: 'browser-a',
    kind: 'browser',
    title: 'Example',
    url: 'https://example.com/paper',
  });
});

test('getEditorTabInputResourceKey uses stable kind-aware resource keys', () => {
  assert.equal(
    getEditorTabInputResourceKey({
      id: 'draft-a',
      kind: 'draft',
      title: 'Draft A',
      viewMode: 'draft',
    }),
    'draft:draft-a',
  );

  assert.equal(
    getEditorTabInputResourceKey({
      id: 'pdf-a',
      kind: 'pdf',
      title: 'Paper PDF',
      url: ' https://example.com/paper.pdf ',
    }),
    'pdf:https://example.com/paper.pdf',
  );

  assert.equal(
    getEditorTabInputResourceKey({
      id: 'browser-a',
      kind: 'browser',
      title: 'Paper',
      url: 'https://EXAMPLE.com/paper folder?q=alpha beta',
    }),
    'browser:https://example.com/paper%20folder?q%3Dalpha%20beta',
  );
});

test('getEditorContentTabTitle treats about:blank as an empty browser tab title', () => {
  assert.equal(getEditorContentTabTitle(EMPTY_BROWSER_TAB_URL), '');
});

test('getEditorContentDisplayUrl hides about:blank from url displays', () => {
  assert.equal(getEditorContentDisplayUrl(EMPTY_BROWSER_TAB_URL), '');
  assert.equal(getEditorContentDisplayUrl(' https://example.com/paper '), 'https://example.com/paper');
});

test('isEmptyBrowserTabInput matches only browser about:blank tabs', () => {
  assert.equal(
    isEmptyBrowserTabInput({
      id: 'browser-blank',
      kind: 'browser',
      title: '',
      url: EMPTY_BROWSER_TAB_URL,
    }),
    true,
  );
  assert.equal(
    isEmptyBrowserTabInput({
      id: 'browser-filled',
      kind: 'browser',
      title: 'Example',
      url: 'https://example.com',
    }),
    false,
  );
});

test('isEmptyPdfTabInput matches only pdf about:blank tabs', () => {
  assert.equal(
    isEmptyPdfTabInput({
      id: 'pdf-blank',
      kind: 'pdf',
      title: '',
      url: EMPTY_PDF_TAB_URL,
    }),
    true,
  );
  assert.equal(
    isEmptyPdfTabInput({
      id: 'pdf-filled',
      kind: 'pdf',
      title: 'Paper.pdf',
      url: 'https://example.com/paper.pdf',
    }),
    false,
  );
});

test('normalizeEditorTabInput clears stale about:blank browser titles from persisted state', () => {
  const input = normalizeEditorTabInput({
    id: 'browser-blank',
    kind: 'browser',
    title: '/blank',
    url: 'about:blank',
  });

  assert.deepEqual(input, {
    id: 'browser-blank',
    kind: 'browser',
    title: '',
    url: 'about:blank',
  });
});
