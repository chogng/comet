import assert from 'node:assert/strict';
import test from 'node:test';

import { createEditorModel } from 'cs/workbench/browser/parts/editor/editorModel';
import { createEditorTabInputId, EMPTY_PDF_TAB_URL } from 'cs/workbench/browser/parts/editor/editorInput';
import { BrowserViewUri } from 'cs/platform/browserView/common/browserViewUri';
import { createEditorOpenService } from 'cs/workbench/services/editor/browser/editorOpenService';
import { EditorInput } from 'cs/workbench/common/editor/editorInput';
import { EditorResolverService } from 'cs/workbench/services/editor/browser/editorResolverService';
import { RegisteredEditorPriority } from 'cs/workbench/services/editor/common/editorResolverService';
import { Schemas } from 'cs/base/common/network';
import type { URI } from 'cs/base/common/uri';

class TestBrowserEditorInput extends EditorInput {
  constructor(
    readonly resource: URI,
  ) {
    super();
  }

  get typeId(): string {
    return 'workbench.editorinputs.browser';
  }
}

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

function createBrowserEditorResolverService(resolvedResources: string[] = []) {
  const editorResolverService = new EditorResolverService();
  editorResolverService.registerEditor(
    `${Schemas.vscodeBrowser}:/**`,
    {
      id: 'workbench.editor.browser',
      label: 'Browser',
      priority: RegisteredEditorPriority.exclusive,
    },
    {
      canSupportResource: resource => resource.scheme === Schemas.vscodeBrowser,
      singlePerResource: true,
    },
    {
      createEditorInput: ({ resource, options }) => {
        resolvedResources.push(resource.toString());
        return {
          editor: new TestBrowserEditorInput(resource),
          options,
        };
      },
    },
  );
  return editorResolverService;
}

function createTestEditorOpenService(
  model: ReturnType<typeof createEditorModel>,
  resolvedResources?: string[],
) {
  return createEditorOpenService(model, createBrowserEditorResolverService(resolvedResources));
}

test('editor open service reuses the existing empty draft for reveal-or-open draft requests', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createTestEditorOpenService(model);

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
    const service = createTestEditorOpenService(model);
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
    const service = createTestEditorOpenService(model);

    service.open({
      kind: 'browser',
      disposition: 'reveal-or-open',
      options: {
        viewState: {
          url: 'https://example.com/article',
        },
      },
    });
    const newTabResource = BrowserViewUri.forId(createEditorTabInputId('browser'));
    const result = service.open({
      kind: 'browser',
      disposition: 'new-tab',
      resource: newTabResource,
      options: {
        viewState: {
          url: 'https://example.com/article',
        },
      },
    });

    const matchingBrowserTabs = model.getSnapshot().tabs.filter(
      (tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article',
    );
    assert.equal(result.handled, true);
    assert.equal(matchingBrowserTabs.length, 2);
    assert.equal(result.activeTabId, matchingBrowserTabs[1]?.id ?? null);
    assert.equal(matchingBrowserTabs[1]?.id, BrowserViewUri.getId(newTabResource));

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service resolves browser resources through the editor resolver', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const resolvedResources: string[] = [];
    const service = createTestEditorOpenService(model, resolvedResources);
    const resource = BrowserViewUri.forId('browser-resolved-a');

    const result = service.open({
      kind: 'browser',
      disposition: 'new-tab',
      resource,
      options: {
        viewState: {
          url: 'https://example.com/resolved',
        },
      },
    });

    assert.deepEqual(resolvedResources, ['vscode-browser:/browser-resolved-a']);
    assert.equal(result.handled, true);
    assert.equal(result.activeTabId, 'browser-resolved-a');
    assert.equal(model.getSnapshot().activeTab?.id, 'browser-resolved-a');

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service reveals an existing browser tab for normalized article URLs', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createTestEditorOpenService(model);

    service.open({
      kind: 'browser',
      disposition: 'reveal-or-open',
      options: {
        viewState: {
          url: 'www.nature.com/articles/example',
        },
      },
    });
    const firstArticleTab = model.getSnapshot().activeTab;
    const result = service.open({
      kind: 'browser',
      disposition: 'reveal-or-open',
      options: {
        viewState: {
          url: 'https://www.nature.com/articles/example',
        },
      },
    });

    const matchingBrowserTabs = model.getSnapshot().tabs.filter(
      (tab) =>
        tab.kind === 'browser' &&
        tab.url === 'https://www.nature.com/articles/example',
    );
    assert.equal(result.handled, true);
    assert.equal(result.activeTabId, firstArticleTab?.id ?? null);
    assert.equal(matchingBrowserTabs.length, 1);

    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor open service creates a non-reused pdf tab for pdf new-tab requests', () => {
  const restoreWindow = installMockWindow(createLocalStorage());

  try {
    const model = createEditorModel();
    const service = createTestEditorOpenService(model);

    service.open({
      kind: 'pdf',
      disposition: 'reveal-or-open',
      options: {
        viewState: {
          url: 'https://example.com/article.pdf',
        },
      },
    });
    const result = service.open({
      kind: 'pdf',
      disposition: 'new-tab',
      options: {
        viewState: {
          url: 'https://example.com/article.pdf',
        },
      },
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
    const service = createTestEditorOpenService(model);

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
    const service = createTestEditorOpenService(model);

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
