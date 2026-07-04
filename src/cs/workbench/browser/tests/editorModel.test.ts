import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWritingEditorDocumentFromPlainText,
  writingEditorDocumentToPlainText,
} from 'cs/editor/common/writingEditorDocument';
import { DEFAULT_EDITOR_GROUP_ID } from 'cs/workbench/browser/editorGroupIdentity';
import {
  EMPTY_BROWSER_TAB_URL,
  EMPTY_PDF_TAB_URL,
} from 'cs/workbench/browser/parts/editor/editorInput';
import { createEditorModel } from 'cs/workbench/browser/parts/editor/editorModel';

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

test('editor model restores draft documents from persisted input and draft-state records', () => {
  const localStorage = createLocalStorage({
    'cs.writingWorkspace.state': JSON.stringify({
      groups: [
        {
          groupId: 'editor-group-a',
          inputs: [
            {
              id: 'draft-a',
              kind: 'draft',
              title: 'Draft A',
              viewMode: 'draft',
            },
            {
              id: 'browser-a',
              kind: 'browser',
              title: 'Example',
              url: 'https://example.com/article',
            },
          ],
          activeTabId: 'draft-a',
          mruTabIds: ['draft-a', 'browser-a'],
        },
      ],
      activeGroupId: 'editor-group-a',
      draftStateByInputId: {
        'draft-a': {
          title: 'Recovered Draft',
          viewMode: 'draft',
          document: {
            type: 'doc',
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'restored body' }],
              },
            ],
          },
        },
      },
      viewStateEntries: [
        {
          key: {
            groupId: 'editor-group-a',
            paneId: 'draft',
            resourceKey: 'draft:draft-a',
          },
          state: {
            scrollPosition: {
              scrollLeft: 0,
              scrollTop: 24,
            },
          },
        },
      ],
    }),
  });
  const restoreWindow = installMockWindow(localStorage);

  try {
    const model = createEditorModel();
    const snapshot = model.getSnapshot();
    const draftTab = snapshot.tabs.find((tab) => tab.id === 'draft-a');

    assert.ok(draftTab);
    assert.equal(draftTab.kind, 'draft');
    assert.equal(draftTab.title, 'Recovered Draft');
    assert.equal(writingEditorDocumentToPlainText(draftTab.document), 'restored body');
    assert.equal(snapshot.activeGroupId, 'editor-group-a');
    assert.equal(snapshot.groupId, 'editor-group-a');
    assert.equal(snapshot.activeTab?.id, 'draft-a');
    assert.equal(snapshot.groups.length, 1);
    assert.deepEqual(snapshot.viewStateEntries, [
      {
        key: {
          groupId: 'editor-group-a',
          paneId: 'draft',
          resourceKey: 'draft:draft-a',
        },
        state: {
          scrollPosition: {
            scrollLeft: 0,
            scrollTop: 24,
          },
        },
      },
    ]);
    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor model flattens the active group while preserving grouped workspace state', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: 'editor-group-a',
        tabs: [
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Draft A',
            document: createWritingEditorDocumentFromPlainText('alpha'),
            viewMode: 'draft',
          },
        ],
        activeTabId: 'draft-a',
        mruTabIds: ['draft-a'],
      },
      {
        groupId: 'editor-group-b',
        tabs: [
          {
            id: 'browser-b',
            kind: 'browser',
            title: 'Browser B',
            url: 'https://example.com/b',
          },
        ],
        activeTabId: 'browser-b',
        mruTabIds: ['browser-b'],
      },
    ],
    activeGroupId: 'editor-group-b',
    viewStateEntries: [
      {
        key: {
          groupId: 'editor-group-a',
          paneId: 'draft',
          resourceKey: 'draft:draft-a',
        },
        state: {
          scrollPosition: {
            scrollLeft: 0,
            scrollTop: 12,
          },
        },
      },
      {
        key: {
          groupId: 'editor-group-b',
          paneId: 'browser',
          resourceKey: 'browser:https://example.com/b',
        },
        state: {
          scrollY: 48,
        },
      },
    ],
  });

  try {
    const snapshot = model.getSnapshot();
    assert.equal(snapshot.activeGroupId, 'editor-group-b');
    assert.equal(snapshot.groupId, 'editor-group-b');
    assert.equal(snapshot.activeTabId, 'browser-b');
    assert.equal(snapshot.activeTab?.kind, 'browser');
    assert.equal(snapshot.tabs.length, 3);
    assert.equal(snapshot.tabs.some((tab) => tab.id === 'browser-b'), true);
    assert.equal(snapshot.groups.length, 2);
    assert.equal(snapshot.viewStateEntries.length, 2);
  } finally {
    model.dispose();
  }
});

test('editor model restores legacy flat workspace payloads into a default group', () => {
  const localStorage = createLocalStorage({
    'cs.writingWorkspace.state': JSON.stringify({
      groupId: 'editor-group-legacy',
      inputs: [
        {
          id: 'draft-a',
          kind: 'draft',
          title: 'Draft A',
          viewMode: 'draft',
        },
      ],
      activeTabId: 'draft-a',
      mruTabIds: ['draft-a'],
    }),
  });
  const restoreWindow = installMockWindow(localStorage);

  try {
    const model = createEditorModel();
    const snapshot = model.getSnapshot();
    assert.equal(snapshot.activeGroupId, 'editor-group-legacy');
    assert.equal(snapshot.groupId, 'editor-group-legacy');
    assert.equal(snapshot.groups.length, 1);
    assert.equal(snapshot.groups[0].groupId, 'editor-group-legacy');
    assert.equal(snapshot.groups[0].tabs[0]?.id, 'draft-a');
    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor model can create and activate explicit editor groups', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Draft A',
            document: createWritingEditorDocumentFromPlainText('alpha'),
            viewMode: 'draft',
          },
        ],
        activeTabId: 'draft-a',
        mruTabIds: ['draft-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    const nextGroupId = model.createGroup({
      groupId: 'editor-group-b',
      activate: false,
    });
    let snapshot = model.getSnapshot();

    assert.equal(nextGroupId, 'editor-group-b');
    assert.equal(snapshot.activeGroupId, DEFAULT_EDITOR_GROUP_ID);
    assert.equal(snapshot.groups.length, 2);
    assert.equal(
      snapshot.groups.some((group) => group.groupId === 'editor-group-b'),
      true,
    );

    model.activateGroup(nextGroupId);
    snapshot = model.getSnapshot();
    assert.equal(snapshot.activeGroupId, 'editor-group-b');
    assert.equal(snapshot.groupId, 'editor-group-b');
    assert.equal(snapshot.tabs.length, 3);
    assert.equal(snapshot.activeTabId, snapshot.tabs[0]?.id ?? null);
  } finally {
    model.dispose();
  }
});

test('editor model can open the same browser resource into another group without changing the active group', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: 'editor-group-a',
        tabs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'Article',
            url: 'https://example.com/article',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a'],
      },
      {
        groupId: 'editor-group-b',
        tabs: [],
        activeTabId: null,
        mruTabIds: [],
      },
    ],
    activeGroupId: 'editor-group-a',
    viewStateEntries: [],
  });

  try {
    model.createBrowserTab('https://example.com/article', {
      groupId: 'editor-group-b',
      activateGroup: false,
    });

    const snapshot = model.getSnapshot();
    const firstGroup = snapshot.groups.find((group) => group.groupId === 'editor-group-a');
    const secondGroup = snapshot.groups.find((group) => group.groupId === 'editor-group-b');

    assert(firstGroup);
    assert(secondGroup);
    assert.equal(snapshot.activeGroupId, 'editor-group-a');
    assert.equal(snapshot.groupId, 'editor-group-a');
    assert.equal(snapshot.activeTab?.id, 'browser-a');
    assert.equal(firstGroup.tabs.length, 3);
    assert.equal(secondGroup.tabs.length, 4);
    const firstGroupBrowser = firstGroup.tabs.find(
      (tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article',
    );
    const secondGroupBrowser = secondGroup.tabs.find(
      (tab) => tab.kind === 'browser' && tab.url === 'https://example.com/article',
    );
    assert.equal(secondGroup.activeTabId, secondGroupBrowser?.id ?? null);
    assert.equal(secondGroupBrowser?.kind, 'browser');
    assert.equal(secondGroupBrowser?.url, 'https://example.com/article');
    assert.notEqual(firstGroupBrowser?.id, secondGroupBrowser?.id);
  } finally {
    model.dispose();
  }
});

test('editor model reveals an existing browser tab inside the target group and can activate that group', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: 'editor-group-a',
        tabs: [
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Draft A',
            document: createWritingEditorDocumentFromPlainText('alpha'),
            viewMode: 'draft',
          },
        ],
        activeTabId: 'draft-a',
        mruTabIds: ['draft-a'],
      },
      {
        groupId: 'editor-group-b',
        tabs: [
          {
            id: 'browser-b',
            kind: 'browser',
            title: 'Article',
            url: 'https://example.com/article',
          },
        ],
        activeTabId: null,
        mruTabIds: [],
      },
    ],
    activeGroupId: 'editor-group-a',
    viewStateEntries: [],
  });

  try {
    model.createBrowserTab('https://example.com/article', {
      groupId: 'editor-group-b',
      activateGroup: true,
    });

    const snapshot = model.getSnapshot();
    const secondGroup = snapshot.groups.find((group) => group.groupId === 'editor-group-b');

    assert(secondGroup);
    assert.equal(snapshot.activeGroupId, 'editor-group-b');
    assert.equal(snapshot.groupId, 'editor-group-b');
    assert.equal(snapshot.activeTabId, 'browser-b');
    assert.equal(snapshot.activeTab?.id, 'browser-b');
    assert.equal(secondGroup.tabs.length, 3);
    assert.equal(secondGroup.mruTabIds[0], 'browser-b');
  } finally {
    model.dispose();
  }
});

test('editor model can close other tabs, rename a tab, preserve a custom title, and close all tabs', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Draft A',
            document: createWritingEditorDocumentFromPlainText('alpha'),
            viewMode: 'draft',
          },
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'example.com/article',
            url: 'https://example.com/article',
          },
          {
            id: 'pdf-a',
            kind: 'pdf',
            title: 'example.com/paper.pdf',
            url: 'https://example.com/paper.pdf',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a', 'pdf-a', 'draft-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.closeOtherTabs('browser-a');
    let snapshot = model.getSnapshot();

    assert.equal(snapshot.tabs.some((tab) => tab.id === 'browser-a'), true);
    assert.equal(snapshot.activeTabId, 'browser-a');
    assert.equal(snapshot.mruTabIds[0], 'browser-a');

    model.renameTab('browser-a', 'Pinned Article');
    model.updateActiveContentTabUrl('https://example.com/next');
    snapshot = model.getSnapshot();

    assert.equal(snapshot.tabs[0]?.title, 'Pinned Article');
    assert.equal(snapshot.tabs[0]?.kind, 'browser');
    assert.equal(snapshot.tabs[0]?.url, 'https://example.com/next');

    model.closeAllTabs();
    snapshot = model.getSnapshot();

    assert.equal(snapshot.tabs.length, 3);
    assert.equal(snapshot.activeTabId, snapshot.tabs[0]?.id ?? null);
    assert.equal(snapshot.activeTab?.residency, 'resident');
    assert.equal(snapshot.mruTabIds[0], snapshot.tabs[0]?.id ?? null);
    assert.equal(snapshot.mruTabIds.length, snapshot.tabs.length);
  } finally {
    model.dispose();
  }
});

test('editor model resets the last browser tab to an empty resident tab when closed', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'example.com/article',
            url: 'https://example.com/article',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.closeTab('browser-a');
    const snapshot = model.getSnapshot();

    assert.equal(snapshot.tabs.length, 3);
    const nextBrowser = snapshot.tabs.find((tab) => tab.kind === 'browser');
    assert.equal(nextBrowser?.residency, 'resident');
    assert.equal(nextBrowser?.title, '');
    assert.equal(nextBrowser?.url, EMPTY_BROWSER_TAB_URL);
    assert.equal(snapshot.activeTabId, nextBrowser?.id ?? null);
    assert.notEqual(nextBrowser?.id, 'browser-a');
  } finally {
    model.dispose();
  }
});

test('editor model resets the last pdf tab to an empty resident tab when closed', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'pdf-a',
            kind: 'pdf',
            title: 'Paper.pdf',
            url: 'https://example.com/paper.pdf',
          },
        ],
        activeTabId: 'pdf-a',
        mruTabIds: ['pdf-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.closeTab('pdf-a');
    const snapshot = model.getSnapshot();

    assert.equal(snapshot.tabs.length, 3);
    const nextPdf = snapshot.tabs.find((tab) => tab.kind === 'pdf');
    assert.equal(nextPdf?.residency, 'resident');
    assert.equal(nextPdf?.title, '');
    assert.equal(nextPdf?.url, EMPTY_PDF_TAB_URL);
    assert.equal(snapshot.activeTabId, nextPdf?.id ?? null);
    assert.notEqual(nextPdf?.id, 'pdf-a');
  } finally {
    model.dispose();
  }
});

test('editor model resets the last draft tab to an empty resident draft when closed', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Draft A',
            document: createWritingEditorDocumentFromPlainText('alpha'),
            viewMode: 'draft',
          },
        ],
        activeTabId: 'draft-a',
        mruTabIds: ['draft-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.closeTab('draft-a');
    const snapshot = model.getSnapshot();
    const nextDraft = snapshot.tabs.find((tab) => tab.kind === 'draft');

    assert.equal(snapshot.tabs.length, 3);
    assert.equal(nextDraft?.kind, 'draft');
    assert.equal(nextDraft?.residency, 'resident');
    assert.equal(nextDraft?.title, '');
    assert.equal(
      writingEditorDocumentToPlainText(nextDraft?.document ?? createWritingEditorDocumentFromPlainText('fallback')),
      '',
    );
    assert.equal(snapshot.activeTabId, nextDraft?.id ?? null);
    assert.notEqual(nextDraft?.id, 'draft-a');
    assert.deepEqual(snapshot.dirtyDraftTabIds, []);
  } finally {
    model.dispose();
  }
});

test('editor model can reorder tabs within the active group without disturbing active or mru state', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: 'editor-group-a',
        tabs: [
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Draft A',
            document: createWritingEditorDocumentFromPlainText('alpha'),
            viewMode: 'draft',
          },
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'Browser A',
            url: 'https://example.com/a',
          },
          {
            id: 'pdf-a',
            kind: 'pdf',
            title: 'Paper A',
            url: 'https://example.com/a.pdf',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a', 'pdf-a', 'draft-a'],
      },
      {
        groupId: 'editor-group-b',
        tabs: [
          {
            id: 'browser-b',
            kind: 'browser',
            title: 'Browser B',
            url: 'https://example.com/b',
          },
        ],
        activeTabId: 'browser-b',
        mruTabIds: ['browser-b'],
      },
    ],
    activeGroupId: 'editor-group-a',
    viewStateEntries: [],
  });

  try {
    model.reorderTab('pdf-a', 0);

    const snapshot = model.getSnapshot();
    assert.deepEqual(
      snapshot.tabs.map((tab) => tab.id),
      ['pdf-a', 'draft-a', 'browser-a'],
    );
    assert.equal(snapshot.activeTabId, 'browser-a');
    assert.deepEqual(snapshot.mruTabIds, ['browser-a', 'pdf-a', 'draft-a']);
    assert.equal(snapshot.groups[1]?.tabs.some((tab) => tab.id === 'browser-b'), true);
  } finally {
    model.dispose();
  }
});

test('editor model updates active browser tab title from page title without overriding custom names', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'example.com/article',
            url: 'https://example.com/article',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.updateActiveBrowserTabPageTitle('Article Title');
    let snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'Article Title');

    model.updateActiveContentTabUrl('https://example.com/next');
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'Article Title');

    model.updateActiveBrowserTabPageTitle('Article Title v2');
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'Article Title v2');

    model.renameTab('browser-a', 'Pinned Article');
    model.updateActiveBrowserTabPageTitle('Should Not Override');
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'Pinned Article');
  } finally {
    model.dispose();
  }
});

test('editor model keeps browser tab title stable while web content is loading redirects', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'example.com/start',
            url: 'https://example.com/start',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.updateActiveContentTabUrl('https://example.com/redirect-a', {
      isLoading: true,
    });
    let snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'example.com/start');

    model.updateActiveContentTabUrl('https://example.com/redirect-b', {
      isLoading: true,
    });
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'example.com/start');

    model.updateActiveContentTabUrl('https://example.com/final');
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'example.com/final');
  } finally {
    model.dispose();
  }
});

test('editor model keeps auto-page browser title stable across chained url updates', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'example.com/start',
            url: 'https://example.com/start',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.updateActiveBrowserTabPageTitle('Old Article Title');
    let snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'Old Article Title');

    model.updateActiveContentTabUrl('https://example.com/redirect-a');
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'Old Article Title');

    model.updateActiveContentTabUrl('https://example.com/final');
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'Old Article Title');

    model.updateActiveBrowserTabPageTitle('New Article Title');
    snapshot = model.getSnapshot();
    assert.equal(snapshot.tabs[0]?.title, 'New Article Title');
  } finally {
    model.dispose();
  }
});

test('editor model clears browser tab title for about:blank and ignores about:blank page titles', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'example.com/article',
            url: 'https://example.com/article',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.updateActiveBrowserTabPageTitle('Article Title');
    model.updateActiveContentTabUrl('about:blank');
    let snapshot = model.getSnapshot();

    const activeTab = snapshot.tabs[0];
    assert(activeTab);
    assert.equal(activeTab.kind, 'browser');
    assert.equal(activeTab.url, 'about:blank');
    assert.equal(activeTab.title, '');

    model.updateActiveBrowserTabPageTitle('about:blank');
    snapshot = model.getSnapshot();
    const nextTab = snapshot.tabs[0];
    assert(nextTab);
    assert.equal(nextTab.kind, 'browser');
    assert.equal(nextTab.title, '');
  } finally {
    model.dispose();
  }
});

test('editor model stores favicon per browser tab and resets favicon when url changes', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'browser-a',
            kind: 'browser',
            title: 'example.com/article-a',
            url: 'https://example.com/article-a',
          },
          {
            id: 'browser-b',
            kind: 'browser',
            title: 'example.com/article-b',
            url: 'https://example.com/article-b',
          },
        ],
        activeTabId: 'browser-a',
        mruTabIds: ['browser-a', 'browser-b'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    model.updateActiveBrowserTabFaviconUrl('https://example.com/a.ico');
    let snapshot = model.getSnapshot();
    const tabA = snapshot.tabs.find((tab) => tab.id === 'browser-a');
    const tabB = snapshot.tabs.find((tab) => tab.id === 'browser-b');
    assert(tabA && tabA.kind === 'browser');
    assert(tabB && tabB.kind === 'browser');
    assert.equal(tabA.faviconUrl, 'https://example.com/a.ico');
    assert.equal(tabB.faviconUrl ?? '', '');

    model.activateTab('browser-b');
    model.updateActiveBrowserTabFaviconUrl('https://example.com/b.ico');
    snapshot = model.getSnapshot();
    const nextTabA = snapshot.tabs.find((tab) => tab.id === 'browser-a');
    const nextTabB = snapshot.tabs.find((tab) => tab.id === 'browser-b');
    assert(nextTabA && nextTabA.kind === 'browser');
    assert(nextTabB && nextTabB.kind === 'browser');
    assert.equal(nextTabA.faviconUrl, 'https://example.com/a.ico');
    assert.equal(nextTabB.faviconUrl, 'https://example.com/b.ico');

    model.activateTab('browser-a');
    model.updateActiveContentTabUrl('https://example.com/next');
    snapshot = model.getSnapshot();
    const movedTabA = snapshot.tabs.find((tab) => tab.id === 'browser-a');
    assert(movedTabA && movedTabA.kind === 'browser');
    assert.equal(movedTabA.url, 'https://example.com/next');
    assert.equal(movedTabA.faviconUrl ?? '', '');
  } finally {
    model.dispose();
  }
});

test('editor model tracks dirty draft tabs against explicit save checkpoints', () => {
  const model = createEditorModel({
    groups: [
      {
        groupId: DEFAULT_EDITOR_GROUP_ID,
        tabs: [
          {
            id: 'draft-a',
            kind: 'draft',
            title: 'Draft A',
            document: createWritingEditorDocumentFromPlainText('alpha'),
            viewMode: 'draft',
          },
        ],
        activeTabId: 'draft-a',
        mruTabIds: ['draft-a'],
      },
    ],
    activeGroupId: DEFAULT_EDITOR_GROUP_ID,
    viewStateEntries: [],
  });

  try {
    assert.deepEqual(model.getSnapshot().dirtyDraftTabIds, []);
    assert.equal(model.canSaveActiveDraft(), true);

    model.setDraftDocument(createWritingEditorDocumentFromPlainText('beta'));
    assert.deepEqual(model.getSnapshot().dirtyDraftTabIds, ['draft-a']);
    assert.equal(model.canSaveActiveDraft(), true);

    const didSave = model.saveActiveDraft();
    assert.equal(didSave, true);
    assert.deepEqual(model.getSnapshot().dirtyDraftTabIds, []);
    assert.equal(model.canSaveActiveDraft(), true);
  } finally {
    model.dispose();
  }
});

test('editor model restores saved draft checkpoints from persisted workspace state', () => {
  const localStorage = createLocalStorage({
    'cs.writingWorkspace.state': JSON.stringify({
      groups: [
        {
          groupId: 'editor-group-a',
          inputs: [
            {
              id: 'draft-a',
              kind: 'draft',
              title: 'Draft A',
              viewMode: 'draft',
            },
          ],
          activeTabId: 'draft-a',
          mruTabIds: ['draft-a'],
        },
      ],
      activeGroupId: 'editor-group-a',
      draftStateByInputId: {
        'draft-a': {
          title: 'Draft A',
          viewMode: 'draft',
          document: createWritingEditorDocumentFromPlainText('changed'),
        },
      },
      savedDraftStateByInputId: {
        'draft-a': {
          title: 'Draft A',
          viewMode: 'draft',
          document: createWritingEditorDocumentFromPlainText('saved'),
        },
      },
      viewStateEntries: [],
    }),
  });
  const restoreWindow = installMockWindow(localStorage);

  try {
    const model = createEditorModel();
    assert.deepEqual(model.getSnapshot().dirtyDraftTabIds, ['draft-a']);
    model.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor model restores saved draft checkpoints from persisted document keys', () => {
  const localStorage = createLocalStorage({
    'cs.writingWorkspace.state': JSON.stringify({
      groups: [
        {
          groupId: 'editor-group-a',
          inputs: [
            {
              id: 'draft-a',
              kind: 'draft',
              title: 'Draft A',
              viewMode: 'draft',
            },
          ],
          activeTabId: 'draft-a',
          mruTabIds: ['draft-a'],
        },
      ],
      activeGroupId: 'editor-group-a',
      draftStateByInputId: {
        'draft-a': {
          title: 'Draft A',
          viewMode: 'draft',
          document: createWritingEditorDocumentFromPlainText('changed'),
        },
      },
      savedDraftStateByInputId: {
        'draft-a': {
          title: 'Draft A',
          viewMode: 'draft',
          documentKey: JSON.stringify(
            createWritingEditorDocumentFromPlainText('saved'),
          ),
        },
      },
      viewStateEntries: [],
    }),
  });
  const restoreWindow = installMockWindow(localStorage);

  try {
    const model = createEditorModel();
    assert.deepEqual(model.getSnapshot().dirtyDraftTabIds, ['draft-a']);
    model.dispose();
  } finally {
    restoreWindow();
  }
});
