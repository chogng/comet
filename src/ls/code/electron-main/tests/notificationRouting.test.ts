import assert from 'node:assert/strict';
import test from 'node:test';

import type { NativeToastOptions, NativeToastType } from 'ls/base/parts/sandbox/common/sandboxTypes';
import {
  normalizeNativeToastType,
  resolveSystemNotificationPayloadFromToast,
  shouldEmitSystemNotification,
  type NotificationRoutingSettings,
} from 'ls/code/electron-main/notificationRouting';

function createSettings(
  overrides: Partial<NotificationRoutingSettings> = {},
): NotificationRoutingSettings {
  return {
    systemNotificationsEnabled: true,
    warningNotificationsEnabled: true,
    completionNotificationsEnabled: true,
    ...overrides,
  };
}

test('normalizeNativeToastType falls back to info for unsupported values', () => {
  assert.equal(normalizeNativeToastType('success'), 'success');
  assert.equal(normalizeNativeToastType('warning'), 'warning');
  assert.equal(normalizeNativeToastType('not-supported'), 'info');
  assert.equal(normalizeNativeToastType(undefined), 'info');
});

test('shouldEmitSystemNotification respects the master switch', () => {
  const settings = createSettings({ systemNotificationsEnabled: false });

  assert.equal(shouldEmitSystemNotification('info', settings), false);
  assert.equal(shouldEmitSystemNotification('success', settings), false);
  assert.equal(shouldEmitSystemNotification('warning', settings), false);
  assert.equal(shouldEmitSystemNotification('error', settings), false);
});

test('shouldEmitSystemNotification filters warning and error when warning switch is disabled', () => {
  const settings = createSettings({ warningNotificationsEnabled: false });

  assert.equal(shouldEmitSystemNotification('info', settings), true);
  assert.equal(shouldEmitSystemNotification('success', settings), true);
  assert.equal(shouldEmitSystemNotification('warning', settings), false);
  assert.equal(shouldEmitSystemNotification('error', settings), false);
});

test('shouldEmitSystemNotification filters success when completion switch is disabled', () => {
  const settings = createSettings({ completionNotificationsEnabled: false });

  assert.equal(shouldEmitSystemNotification('info', settings), true);
  assert.equal(shouldEmitSystemNotification('warning', settings), true);
  assert.equal(shouldEmitSystemNotification('error', settings), true);
  assert.equal(shouldEmitSystemNotification('success', settings), false);
});

test('resolveSystemNotificationPayloadFromToast trims message and maps titles by type', () => {
  const settings = createSettings();
  const byType = new Map<NativeToastType, string>([
    ['info', 'Literature Studio'],
    ['success', 'Literature Studio Completed'],
    ['warning', 'Literature Studio Warning'],
    ['error', 'Literature Studio Error'],
  ]);

  for (const [type, expectedTitle] of byType) {
    const payload = resolveSystemNotificationPayloadFromToast(
      {
        type,
        message: '  Task finished  ',
      } satisfies NativeToastOptions,
      settings,
    );

    assert.deepEqual(payload, {
      title: expectedTitle,
      body: 'Task finished',
    });
  }
});

test('resolveSystemNotificationPayloadFromToast returns null when message is blank', () => {
  const settings = createSettings();

  assert.equal(
    resolveSystemNotificationPayloadFromToast(
      { type: 'success', message: '   ' },
      settings,
    ),
    null,
  );
});

test('resolveSystemNotificationPayloadFromToast returns null when routed out by settings', () => {
  const warningSuppressed = createSettings({ warningNotificationsEnabled: false });
  const completionSuppressed = createSettings({ completionNotificationsEnabled: false });
  const allSuppressed = createSettings({ systemNotificationsEnabled: false });

  assert.equal(
    resolveSystemNotificationPayloadFromToast({ type: 'warning', message: 'Heads up' }, warningSuppressed),
    null,
  );
  assert.equal(
    resolveSystemNotificationPayloadFromToast({ type: 'error', message: 'Failed' }, warningSuppressed),
    null,
  );
  assert.equal(
    resolveSystemNotificationPayloadFromToast(
      { type: 'success', message: 'Done' },
      completionSuppressed,
    ),
    null,
  );
  assert.equal(
    resolveSystemNotificationPayloadFromToast({ type: 'info', message: 'Notice' }, allSuppressed),
    null,
  );
});
