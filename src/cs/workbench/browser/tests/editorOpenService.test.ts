import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import { EMPTY_PDF_TAB_URL } from 'cs/workbench/browser/parts/editor/editorInput';
import { createEditorOpenService } from 'cs/workbench/services/editor/browser/editorOpenService';

type MockStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

type MockWindow = Pick<Window, 'localStorage' | 'setTimeout' | 'clearTimeout'>;

const globalWindow = globalThis as {
  window?: MockWindow;
};

function createLocalStorage(initialValues: Record<string, string> = {}): MockStorage {
  const values = new Map(Object.entries(initialValues));

  return {
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

function installMockWindow(localStorage: MockStorage) {
  const previousWindow = globalWindow.window;
  globalWindow.window = {
    localStorage: localStorage as Storage,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };

  return () => {
    globalWindow.window = previousWindow;
  };
}

test('editor open service reuses the existing empty draft for reveal-or-open draft requests', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createEditorOpenService(model);

    const initialDraftTabId = model.getSnapshot().activeTab?.id ?? null;
    const result = service.open({
      kind: 'draft',
      disposition: 'reveal-or-open',
    });

    assert.equal(result.handled, true);
    assert.equal(result.activeTabId, initialDraftTabId);
    assert.equal(
      model.getSnapshot().tabs.filter((tab) => tab.kind === 'draft').length,
      1,
    );

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service creates a fresh draft tab for new-tab draft requests', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createEditorOpenService(model);
    const initialDraftTabId = model.getSnapshot().activeTab?.id ?? null;

    const result = service.open({
      kind: 'draft',
      disposition: 'new-tab',
    });

    assert.equal(result.handled, true);
    assert.notEqual(result.activeTabId, initialDraftTabId);
    assert.equal(
      model.getSnapshot().tabs.filter((tab) => tab.kind === 'draft').length,
      2,
    );

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service creates a non-reused browser tab for browser new-tab requests', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createEditorOpenService(model);

    service.open({
      kind: 'browser',
      disposition: 'reveal-or-open',
      url: 'https://example.com/article',
    });
    const result = service.open({
      kind: 'browser',
      disposition: 'new-tab',
      url: 'https://example.com/article',
    });

    const matchingBrowserTabs = model.getSnapshot().tabs.filter(
      (tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article',
    );
    assert.equal(result.handled, true);
    assert.equal(matchingBrowserTabs.length, 2);
    assert.equal(result.activeTabId, matchingBrowserTabs[1]?.id ?? null);

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service creates a non-reused pdf tab for pdf new-tab requests', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createEditorOpenService(model);

    service.open({
      kind: 'pdf',
      disposition: 'reveal-or-open',
      url: 'https://example.com/article.pdf',
    });
    const result = service.open({
      kind: 'pdf',
      disposition: 'new-tab',
      url: 'https://example.com/article.pdf',
    });

    const matchingPdfTabs = model.getSnapshot().tabs.filter(
      (tab) => tab.kind === 'pdf' && tab.url === 'https://example.com/article.pdf',
    );
    assert.equal(result.handled, true);
    assert.equal(matchingPdfTabs.length, 2);
    assert.equal(result.activeTabId, matchingPdfTabs[1]?.id ?? null);

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service reuses the existing empty pdf for reveal-or-open pdf requests', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createEditorOpenService(model);

    const firstResult = service.open({
      kind: 'pdf',
      disposition: 'reveal-or-open',
    });
    const initialPdfTabId = firstResult.activeTabId;
    const secondResult = service.open({
      kind: 'pdf',
      disposition: 'reveal-or-open',
    });

    assert.equal(firstResult.handled, true);
    assert.equal(secondResult.handled, true);
    assert.equal(secondResult.activeTabId, initialPdfTabId);
    assert.equal(
      model.getSnapshot().tabs.filter(
        (tab) => tab.kind === 'pdf' && tab.url === EMPTY_PDF_TAB_URL,
      ).length,
      1,
    );

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service creates a fresh empty pdf tab for new-tab pdf requests without a url', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createEditorOpenService(model);

    service.open({
      kind: 'pdf',
      disposition: 'reveal-or-open',
    });
    const result = service.open({
      kind: 'pdf',
      disposition: 'new-tab',
    });

    const emptyPdfTabs = model.getSnapshot().tabs.filter(
      (tab) => tab.kind === 'pdf' && tab.url === EMPTY_PDF_TAB_URL,
    );
    assert.equal(result.handled, true);
    assert.equal(emptyPdfTabs.length, 2);
    assert.equal(result.activeTabId, emptyPdfTabs[1]?.id ?? null);

    model.dispose();
  } finally {
    restoreWindow();
  }
});
