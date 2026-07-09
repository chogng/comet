import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import {
  createWritingEditorDocumentFromPlainText,
  writingEditorDocumentToPlainText,
} from 'cs/editor/common/writingEditorDocument';
import { createEditorStorage } from 'cs/workbench/browser/parts/editor/editorStorage';

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

test('editor storage debounces draft persistence and keeps the latest state', async () => {
  const localStorage = createLocalStorage();
  const restoreWindow = installMockWindow(localStorage);
  const storage = createEditorStorage({ debounceMs: 10 });

  storage.scheduleSave({
    workspaceState: {
      groups: [
        {
          groupId: 'editor-group-a',
          tabs: [],
          activeTabId: null,
          mruTabIds: [],
        },
      ],
      activeGroupId: 'editor-group-a',
      viewStateEntries: [],
    },
    contextDraftTab: {
      id: 'draft-a',
      kind: 'draft',
      title: 'First',
      document: createWritingEditorDocumentFromPlainText('alpha'),
      viewMode: 'draft',
    },
    savedDraftStateByInputId: {},
  });

  storage.scheduleSave({
    workspaceState: {
      groups: [
        {
          groupId: 'editor-group-a',
          tabs: [],
          activeTabId: null,
          mruTabIds: [],
        },
      ],
      activeGroupId: 'editor-group-a',
      viewStateEntries: [],
    },
    contextDraftTab: {
      id: 'draft-b',
      kind: 'draft',
      title: 'Second',
      document: createWritingEditorDocumentFromPlainText('beta'),
      viewMode: 'draft',
    },
    savedDraftStateByInputId: {},
  });

  await delay(25);

  assert.equal(localStorage.getItem('cs.writingDraft.title'), 'Second');
  assert.equal(localStorage.getItem('cs.writingDraft.body'), 'beta');

  try {
    storage.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor storage reads the legacy draft payload from local storage', () => {
  const localStorage = createLocalStorage({
    'cs.writingDraft.title': 'Draft',
    'cs.writingDraft.body': 'legacy body',
    'cs.writingDraft.viewMode': 'split',
  });
  const restoreWindow = installMockWindow(localStorage);
  const storage = createEditorStorage();

  const draftState = storage.readLegacyDraftState();

  assert.equal(draftState.title, 'Draft');
  assert.equal(writingEditorDocumentToPlainText(draftState.document), 'legacy body');
  assert.equal(draftState.viewMode, 'draft');

  try {
    storage.dispose();
  } finally {
    restoreWindow();
  }
});

test('editor storage persists editor inputs separately from draft state payload', () => {
  const localStorage = createLocalStorage();
  const restoreWindow = installMockWindow(localStorage);
  const storage = createEditorStorage();

  storage.save({
    workspaceState: {
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
              url: 'https://example.com/article',
            },
          ],
          activeTabId: 'draft-a',
          mruTabIds: ['draft-a', 'browser-a'],
        },
      ],
      activeGroupId: 'editor-group-a',
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
    },
    contextDraftTab: {
      id: 'draft-a',
      kind: 'draft',
      title: 'Draft A',
      document: createWritingEditorDocumentFromPlainText('alpha'),
      viewMode: 'draft',
    },
    savedDraftStateByInputId: {
      'draft-a': {
        title: 'Draft A',
        documentKey: JSON.stringify(
          createWritingEditorDocumentFromPlainText('alpha'),
        ),
        viewMode: 'draft',
      },
    },
  });

  const rawWorkspace = localStorage.getItem('cs.writingWorkspace.state');
  assert.ok(rawWorkspace);
  const storedWorkspace = JSON.parse(rawWorkspace) as {
    groups: Array<{
      groupId: string;
      inputs: Array<{
        id: string;
        kind: string;
        title: string;
        viewMode?: string;
        url?: string;
        document?: unknown;
      }>;
      activeTabId: string | null;
      mruTabIds: string[];
    }>;
    activeGroupId: string;
    draftStateByInputId: Record<string, { document: unknown }>;
    savedDraftStateByInputId: Record<string, {
      title: string;
      documentKey: string;
      viewMode: string;
    }>;
    viewStateEntries: unknown[];
    inputs?: unknown;
    groupId?: unknown;
  };

  assert.equal(Array.isArray(storedWorkspace.groups), true);
  assert.equal(storedWorkspace.inputs, undefined);
  assert.equal(storedWorkspace.groupId, undefined);
  assert.equal(storedWorkspace.activeGroupId, 'editor-group-a');
  assert.deepEqual(storedWorkspace.groups[0], {
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
        title: 'Browser A',
        url: 'https://example.com/article',
      },
    ],
    activeTabId: 'draft-a',
    mruTabIds: ['draft-a', 'browser-a'],
  });
  assert.deepEqual(storedWorkspace.groups[0].inputs[0], {
    id: 'draft-a',
    kind: 'draft',
    title: 'Draft A',
    viewMode: 'draft',
  });
  const storedDraftInput = storedWorkspace.groups[0].inputs[0] as {
    document?: unknown;
  };
  assert.equal(storedDraftInput.document, undefined);
  assert.equal(
    writingEditorDocumentToPlainText(
      storedWorkspace.draftStateByInputId['draft-a']
        .document as import('cs/editor/common/writingEditorDocument').WritingEditorDocument,
    ),
    'alpha',
  );
  assert.equal(storedWorkspace.savedDraftStateByInputId['draft-a'].title, 'Draft A');
  assert.equal(storedWorkspace.savedDraftStateByInputId['draft-a'].viewMode, 'draft');
  assert.equal(
    writingEditorDocumentToPlainText(
      JSON.parse(
        storedWorkspace.savedDraftStateByInputId['draft-a'].documentKey,
      ) as import('cs/editor/common/writingEditorDocument').WritingEditorDocument,
    ),
    'alpha',
  );
  assert.deepEqual(storedWorkspace.viewStateEntries, [
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

  try {
    storage.dispose();
  } finally {
    restoreWindow();
  }
});
