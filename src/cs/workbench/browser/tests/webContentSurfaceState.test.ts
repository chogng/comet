import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldSyncActiveContentTabMetadataFromWebContentState,
} from 'cs/workbench/contrib/browserView/browser/browserSurfaceState';
import type { WebContentSurfaceSnapshot } from 'cs/workbench/contrib/browserView/browser/browserSurfaceState';

function createSnapshot(
  value: Partial<WebContentSurfaceSnapshot>,
): WebContentSurfaceSnapshot {
  return {
    activeContentTab: null,
    activeContentTabId: null,
    activeContentTabUrl: '',
    owner: 'shared-content',
    ...value,
  };
}

test('does not sync browser metadata when active target id is stale during tab switch', () => {
  const snapshot = createSnapshot({
    owner: 'editor-content-tab',
    activeContentTabId: 'tab-a',
    activeContentTabUrl: 'https://a.test',
  });

  const shouldSync = shouldSyncActiveContentTabMetadataFromWebContentState(snapshot, {
    ownership: 'active',
    targetId: 'tab-b',
    activeTargetId: 'tab-b',
  });

  assert.equal(shouldSync, false);
});

test('syncs browser metadata only when web content state belongs to active content tab', () => {
  const snapshot = createSnapshot({
    owner: 'editor-content-tab',
    activeContentTabId: 'tab-a',
    activeContentTabUrl: 'https://a.test',
  });

  const shouldSync = shouldSyncActiveContentTabMetadataFromWebContentState(snapshot, {
    ownership: 'active',
    targetId: 'tab-a',
    activeTargetId: 'tab-a',
  });

  assert.equal(shouldSync, true);
});
