import assert from 'node:assert/strict';
import test, { after, afterEach, before } from 'node:test';

import type {
  ArticleDetailsModalLabels,
  ElectronAPI,
  NativeModalState,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { installDomTestEnvironment } from 'ls/editor/browser/text/tests/domTestUtils';

let cleanupDomEnvironment: (() => void) | null = null;
let createArticleDetailsModalWindowView: typeof import('ls/workbench/browser/articleDetailsModalWindow').createArticleDetailsModalWindowView;
let getWorkbenchWindowControlsProvider: typeof import('ls/workbench/browser/window').getWorkbenchWindowControlsProvider;
let registerWorkbenchWindowControlsProvider: typeof import('ls/workbench/browser/window').registerWorkbenchWindowControlsProvider;

let previousWindowControlsProvider:
  | ReturnType<typeof getWorkbenchWindowControlsProvider>
  | null = null;
let originalDocumentTitle = '';
let originalDocumentLanguage = '';

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });

  return { promise, resolve, reject };
}

function createLabels(overrides: Partial<ArticleDetailsModalLabels> = {}): ArticleDetailsModalLabels {
  return {
    untitled: 'Untitled',
    unknown: 'Unknown',
    articleType: 'Type',
    authors: 'Authors',
    abstract: 'Abstract',
    description: 'Description',
    publishedAt: 'Published',
    source: 'Source',
    fetchedAt: 'Fetched',
    archiveHtmlPath: 'Archived HTML',
    archiveTextPath: 'Extracted text',
    archivePdfPath: 'Archived PDF',
    revealPath: 'Show in Finder',
    controlsAriaLabel: 'Window controls',
    minimize: 'Minimize',
    maximize: 'Maximize',
    restore: 'Restore',
    close: 'Close',
    ...overrides,
  };
}

function createArticleDetailsModalState(
  overrides: Partial<Extract<NativeModalState, { kind: 'article-details' }>> = {},
): Extract<NativeModalState, { kind: 'article-details' }> {
  return {
    kind: 'article-details',
    locale: 'en',
    article: {
      title: 'Understanding Lifecycle Stores',
      articleType: 'Research Article',
      doi: '10.1000/lifecycle',
      authors: ['Ada Lovelace', 'Grace Hopper'],
      abstractText: 'Abstract text',
      descriptionText: 'Description text',
      publishedAt: '2025-01-15',
      sourceUrl: 'https://example.com/article',
      fetchedAt: '2025-01-16T08:00:00.000Z',
      archiveHtmlPath: null,
      archiveTextPath: null,
      archivePdfPath: null,
    },
    labels: createLabels(),
    ...overrides,
  };
}

function createFakeModalApi(getState: () => Promise<NativeModalState | null>) {
  let stateListener: ((state: NativeModalState | null) => void) | undefined;
  let removed = false;

  return {
    api: {
      getState,
      onStateChange(
        listener: (state: NativeModalState | null) => void,
      ) {
        stateListener = listener;
        return () => {
          removed = true;
          if (stateListener === listener) {
            stateListener = undefined;
          }
        };
      },
    },
    emitState(state: NativeModalState | null) {
      if (!stateListener) {
        throw new Error('Expected modal state listener to be registered.');
      }

      stateListener(state);
    },
    wasRemoved() {
      return removed;
    },
  };
}

function createWindowControlsProvider() {
  let stateListener: ((state: { isMaximized: boolean; isFullscreen: boolean }) => void) | undefined;
  let removed = false;

  return {
    provider: {
      getState: async () => ({
        isMaximized: true,
        isFullscreen: false,
      }),
      onStateChange(listener: (state: { isMaximized: boolean; isFullscreen: boolean }) => void) {
        stateListener = listener;
        return () => {
          removed = true;
          if (stateListener === listener) {
            stateListener = undefined;
          }
        };
      },
      perform() {},
    },
    emitState(state: { isMaximized: boolean; isFullscreen: boolean }) {
      if (!stateListener) {
        throw new Error('Expected window state listener to be registered.');
      }

      stateListener(state);
    },
    wasRemoved() {
      return removed;
    },
  };
}

function createElectronApi(overrides: Partial<ElectronAPI>): ElectronAPI {
  return {
    invoke: (async () => {
      throw new Error('Unexpected invoke in article details modal window test.');
    }) as ElectronAPI['invoke'],
    ...overrides,
  };
}

async function withElectronApi<T>(
  electronAPI: ElectronAPI | undefined,
  run: () => Promise<T> | T,
): Promise<T> {
  const testWindow = window as typeof window & {
    electronAPI?: ElectronAPI;
  };
  const previousElectronApi = testWindow.electronAPI;
  testWindow.electronAPI = electronAPI;

  try {
    return await run();
  } finally {
    testWindow.electronAPI = previousElectronApi;
  }
}

function createNoopWindowControlsProvider() {
  return {
    getState: async () => ({
      isMaximized: false,
      isFullscreen: false,
    }),
    onStateChange: () => () => {},
    perform: () => {},
  };
}

async function flushMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

before(async () => {
  const domEnvironment = installDomTestEnvironment();
  cleanupDomEnvironment = domEnvironment.cleanup;
  ({ createArticleDetailsModalWindowView } = await import(
    'ls/workbench/browser/articleDetailsModalWindow'
  ));
  ({
    getWorkbenchWindowControlsProvider,
    registerWorkbenchWindowControlsProvider,
  } = await import('ls/workbench/browser/window'));
  previousWindowControlsProvider = getWorkbenchWindowControlsProvider();
  originalDocumentTitle = document.title;
  originalDocumentLanguage = document.documentElement.lang;
});

after(() => {
  cleanupDomEnvironment?.();
  cleanupDomEnvironment = null;
});

afterEach(() => {
  registerWorkbenchWindowControlsProvider(
    previousWindowControlsProvider ?? createNoopWindowControlsProvider(),
  );
  document.title = originalDocumentTitle;
  document.documentElement.lang = originalDocumentLanguage;
  document.body.replaceChildren();
});

test('article details modal view renders native state and updates document metadata', async () => {
  const fakeModal = createFakeModalApi(async () =>
    createArticleDetailsModalState(),
  );
  const fakeWindowControls = createWindowControlsProvider();
  registerWorkbenchWindowControlsProvider(fakeWindowControls.provider);

  await withElectronApi(createElectronApi({
    modal: fakeModal.api,
    windowControls: {
      perform() {},
      getState: async () => ({
        isMaximized: false,
        isFullscreen: false,
      }),
      onStateChange: () => () => {},
    } as unknown as NonNullable<ElectronAPI['windowControls']>,
  }), async () => {
    const view = createArticleDetailsModalWindowView();
    document.body.append(view.getElement());

    try {
      await flushMicrotasks();

      const title = view.getElement().querySelector('.child-window-shell-titlebar-title');
      const detailValues = Array.from(
        view.getElement().querySelectorAll('.article-details-grid dd'),
      ).map((node) => node.textContent);

      assert.equal(title?.textContent, 'Understanding Lifecycle Stores');
      assert.equal(detailValues[0], '10.1000/lifecycle');
      assert.equal(document.title, 'Understanding Lifecycle Stores');
      assert.equal(document.documentElement.lang, 'en');
    } finally {
      view.dispose();
    }
  });
});

test('article details modal view renders archived artifact paths when available', async () => {
  const fakeModal = createFakeModalApi(async () =>
    createArticleDetailsModalState({
      article: {
        title: 'Archived Page',
        articleType: 'Research Article',
        doi: '10.1000/archive',
        authors: ['Ada Lovelace'],
        abstractText: 'Abstract text',
        descriptionText: 'Description text',
        publishedAt: '2025-01-15',
        sourceUrl: 'https://example.com/archive',
        fetchedAt: '2025-01-16T08:00:00.000Z',
        archiveHtmlPath: '/tmp/archive/page.html',
        archiveTextPath: '/tmp/archive/page.txt',
        archivePdfPath: '/tmp/archive/page.pdf',
      },
    }),
  );
  const fakeWindowControls = createWindowControlsProvider();
  registerWorkbenchWindowControlsProvider(fakeWindowControls.provider);

  await withElectronApi(createElectronApi({
    modal: fakeModal.api,
    windowControls: {
      perform() {},
      getState: async () => ({
        isMaximized: false,
        isFullscreen: false,
      }),
      onStateChange: () => () => {},
    } as unknown as NonNullable<ElectronAPI['windowControls']>,
  }), async () => {
    const view = createArticleDetailsModalWindowView();
    document.body.append(view.getElement());

    try {
      await flushMicrotasks();

      const detailRows = Array.from(
        view.getElement().querySelectorAll('.article-details-grid .article-details-row'),
      ).map((row) => ({
        label: row.querySelector('dt')?.textContent?.trim(),
        value: row.querySelector('.article-details-row-text')?.textContent?.trim(),
      }));

      assert.equal(
        detailRows.some((row) => row.label === 'Archived HTML' && row.value === '/tmp/archive/page.html'),
        true,
      );
      assert.equal(
        detailRows.some((row) => row.label === 'Extracted text' && row.value === '/tmp/archive/page.txt'),
        true,
      );
      assert.equal(
        detailRows.some((row) => row.label === 'Archived PDF' && row.value === '/tmp/archive/page.pdf'),
        true,
      );
    } finally {
      view.dispose();
    }
  });
});

test('article details modal view reveals archived artifact paths through desktop invoke', async () => {
  const invoked: Array<{ command: string; args?: Record<string, unknown> }> = [];
  const fakeModal = createFakeModalApi(async () =>
    createArticleDetailsModalState({
      article: {
        title: 'Archived Page',
        articleType: 'Research Article',
        doi: '10.1000/archive',
        authors: ['Ada Lovelace'],
        abstractText: 'Abstract text',
        descriptionText: 'Description text',
        publishedAt: '2025-01-15',
        sourceUrl: 'https://example.com/archive',
        fetchedAt: '2025-01-16T08:00:00.000Z',
        archiveHtmlPath: '/tmp/archive/page.html',
        archiveTextPath: '/tmp/archive/page.txt',
        archivePdfPath: '/tmp/archive/page.pdf',
      },
    }),
  );
  const fakeWindowControls = createWindowControlsProvider();
  registerWorkbenchWindowControlsProvider(fakeWindowControls.provider);

  await withElectronApi(createElectronApi({
    invoke: (async (command: string, args?: Record<string, unknown>) => {
      invoked.push({
        command,
        args,
      });
      return true;
    }) as ElectronAPI['invoke'],
    modal: fakeModal.api,
    windowControls: {
      perform() {},
      getState: async () => ({
        isMaximized: false,
        isFullscreen: false,
      }),
      onStateChange: () => () => {},
    } as unknown as NonNullable<ElectronAPI['windowControls']>,
  }), async () => {
    const view = createArticleDetailsModalWindowView();
    document.body.append(view.getElement());

    try {
      await flushMicrotasks();

      const revealButtons = Array.from(
        view.getElement().querySelectorAll<HTMLButtonElement>('.article-details-reveal-button'),
      );
      assert.equal(revealButtons.length, 3);

      revealButtons[0].click();
      await flushMicrotasks();

      assert.deepEqual(invoked, [
        {
          command: 'open_path',
          args: {
            path: '/tmp/archive/page.html',
          },
        },
      ]);
    } finally {
      view.dispose();
    }
  });
});

test('article details modal view disposes modal and window subscriptions with the view', async () => {
  const fakeModal = createFakeModalApi(async () =>
    createArticleDetailsModalState(),
  );
  const fakeWindowControls = createWindowControlsProvider();
  registerWorkbenchWindowControlsProvider(fakeWindowControls.provider);

  await withElectronApi(createElectronApi({
    modal: fakeModal.api,
    windowControls: {
      perform() {},
      getState: async () => ({
        isMaximized: false,
        isFullscreen: false,
      }),
      onStateChange: () => () => {},
    } as unknown as NonNullable<ElectronAPI['windowControls']>,
  }), async () => {
    const view = createArticleDetailsModalWindowView();
    document.body.append(view.getElement());

    await flushMicrotasks();
    view.dispose();

    assert.equal(fakeModal.wasRemoved(), true);
    assert.equal(fakeWindowControls.wasRemoved(), true);
    assert.equal(view.getElement().childElementCount, 0);
  });
});

test('article details modal view ignores late initial modal state after dispose', async () => {
  const deferredState = createDeferred<NativeModalState | null>();
  const fakeModal = createFakeModalApi(() => deferredState.promise);
  const fakeWindowControls = createWindowControlsProvider();
  registerWorkbenchWindowControlsProvider(fakeWindowControls.provider);

  await withElectronApi(createElectronApi({
    modal: fakeModal.api,
    windowControls: {
      perform() {},
      getState: async () => ({
        isMaximized: false,
        isFullscreen: false,
      }),
      onStateChange: () => () => {},
    } as unknown as NonNullable<ElectronAPI['windowControls']>,
  }), async () => {
    const view = createArticleDetailsModalWindowView();
    document.body.append(view.getElement());

    view.dispose();
    deferredState.resolve(createArticleDetailsModalState({
      locale: 'zh',
      article: {
        title: '已销毁视图',
        articleType: '研究',
        doi: null,
        authors: [],
        abstractText: '摘要',
        descriptionText: '描述',
        publishedAt: null,
        sourceUrl: 'https://example.com/late',
        fetchedAt: '2025-01-16T08:00:00.000Z',
      },
    }));
    await flushMicrotasks();

    assert.equal(fakeModal.wasRemoved(), true);
    assert.equal(fakeWindowControls.wasRemoved(), true);
    assert.equal(view.getElement().childElementCount, 0);
    assert.notEqual(document.title, '已销毁视图');
  });
});
