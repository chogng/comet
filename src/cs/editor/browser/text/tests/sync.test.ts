import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveWritingEditorSurfaceSyncPlan } from 'cs/editor/browser/text/sync';

test('surface sync defers updates while composition is active', () => {
  const plan = resolveWritingEditorSurfaceSyncPlan({
    currentDocumentKey: 'current',
    nextDocumentKey: 'next',
    pendingDocumentSyncKey: 'pending',
    isComposing: true,
    shouldRefreshPlaceholder: false,
    shouldRefreshToolbarChrome: true,
  });

  assert.deepEqual(plan, {
    kind: 'defer-while-composing',
    shouldRefreshToolbarChrome: true,
    shouldClearPendingDocumentSync: false,
  });
});

test('surface sync preserves local state when stale props arrive before model echo', () => {
  const plan = resolveWritingEditorSurfaceSyncPlan({
    currentDocumentKey: 'local',
    nextDocumentKey: 'stale',
    pendingDocumentSyncKey: 'pending-local',
    isComposing: false,
    shouldRefreshPlaceholder: false,
    shouldRefreshToolbarChrome: false,
  });

  assert.deepEqual(plan, {
    kind: 'preserve-local-state',
    shouldRefreshToolbarChrome: false,
    shouldClearPendingDocumentSync: false,
    shouldRefreshPlaceholder: false,
  });
});

test('surface sync refreshes placeholder without replacing state when only placeholder changes', () => {
  const plan = resolveWritingEditorSurfaceSyncPlan({
    currentDocumentKey: 'same',
    nextDocumentKey: 'same',
    pendingDocumentSyncKey: null,
    isComposing: false,
    shouldRefreshPlaceholder: true,
    shouldRefreshToolbarChrome: false,
  });

  assert.deepEqual(plan, {
    kind: 'refresh-placeholder',
    shouldRefreshToolbarChrome: false,
    shouldClearPendingDocumentSync: false,
  });
});

test('surface sync preserves local state and still refreshes placeholder when props are stale', () => {
  const plan = resolveWritingEditorSurfaceSyncPlan({
    currentDocumentKey: 'local',
    nextDocumentKey: 'stale',
    pendingDocumentSyncKey: 'pending-local',
    isComposing: false,
    shouldRefreshPlaceholder: true,
    shouldRefreshToolbarChrome: false,
  });

  assert.deepEqual(plan, {
    kind: 'preserve-local-state',
    shouldRefreshToolbarChrome: false,
    shouldClearPendingDocumentSync: false,
    shouldRefreshPlaceholder: true,
  });
});

test('surface sync replaces from props when an external document really changed', () => {
  const plan = resolveWritingEditorSurfaceSyncPlan({
    currentDocumentKey: 'current',
    nextDocumentKey: 'external',
    pendingDocumentSyncKey: null,
    isComposing: false,
    shouldRefreshPlaceholder: false,
    shouldRefreshToolbarChrome: true,
  });

  assert.deepEqual(plan, {
    kind: 'replace-state',
    shouldRefreshToolbarChrome: true,
    shouldClearPendingDocumentSync: false,
    documentSource: 'props',
  });
});

test('surface sync clears pending key when the model echoes the latest document back', () => {
  const plan = resolveWritingEditorSurfaceSyncPlan({
    currentDocumentKey: 'echoed',
    nextDocumentKey: 'echoed',
    pendingDocumentSyncKey: 'echoed',
    isComposing: false,
    shouldRefreshPlaceholder: false,
    shouldRefreshToolbarChrome: false,
  });

  assert.deepEqual(plan, {
    kind: 'sync-current-state',
    shouldRefreshToolbarChrome: false,
    shouldClearPendingDocumentSync: true,
  });
});
