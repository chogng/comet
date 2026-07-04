import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WritingEditorInputSession } from 'cs/editor/browser/text/input';

function createHarness() {
  let composing = false;
  let focused = false;
  let now = 0;
  let focusCalls = 0;

  const session = new WritingEditorInputSession({
    isViewComposing: () => composing,
    hasViewFocus: () => focused,
    focusView: () => {
      focused = true;
      focusCalls += 1;
    },
    getNow: () => now,
  });

  return {
    session,
    setComposing(value: boolean) {
      composing = value;
    },
    setFocused(value: boolean) {
      focused = value;
    },
    setNow(value: number) {
      now = value;
    },
    getFocusCalls() {
      return focusCalls;
    },
  };
}

test('input session restores focus after blur while a document sync is pending', async () => {
  const harness = createHarness();
  harness.setFocused(true);

  harness.session.handleCompositionStart();
  harness.session.markDocumentSyncPending('doc_1');
  harness.setFocused(false);
  harness.session.handleBlur();

  await delay(25);

  assert.equal(harness.getFocusCalls(), 1);
});

test('input session does not restore focus after the keep-focus window expires', async () => {
  const harness = createHarness();
  harness.setFocused(true);

  harness.session.handleCompositionStart();
  harness.setNow(401);
  harness.setFocused(false);
  harness.session.handleBlur();

  await delay(25);

  assert.equal(harness.getFocusCalls(), 0);
  assert.equal(harness.session.shouldKeepFocus(), false);
});

test('input session clears pending sync keys only when the echoed document matches', () => {
  const harness = createHarness();

  harness.session.markDocumentSyncPending('doc_a');
  harness.session.clearPendingDocumentSyncIfMatches('doc_b');
  assert.equal(harness.session.hasPendingDocumentSync(), true);

  harness.session.clearPendingDocumentSyncIfMatches('doc_a');
  assert.equal(harness.session.hasPendingDocumentSync(), false);
});

test('input session skips composition flushes while composing and runs them after composition ends', async () => {
  const harness = createHarness();
  let flushCalls = 0;

  harness.setComposing(true);
  harness.session.scheduleCompositionFlush(() => {
    flushCalls += 1;
  });

  await delay(10);
  assert.equal(flushCalls, 0);

  harness.setComposing(false);
  harness.session.scheduleCompositionFlush(() => {
    flushCalls += 1;
  });

  await delay(10);
  assert.equal(flushCalls, 1);
});

test('input session dispose cancels pending timers', async () => {
  const harness = createHarness();
  let flushCalls = 0;

  harness.setFocused(true);
  harness.session.handleCompositionStart();
  harness.session.scheduleCompositionFlush(() => {
    flushCalls += 1;
  }, 10);
  harness.setFocused(false);
  harness.session.markDocumentSyncPending('doc_1');
  harness.session.handleBlur();
  harness.session.dispose();

  await delay(30);

  assert.equal(flushCalls, 0);
  assert.equal(harness.getFocusCalls(), 0);
});
