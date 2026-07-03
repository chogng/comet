import type { AppSettings, NativeToastOptions, NativeToastType } from 'ls/base/parts/sandbox/common/sandboxTypes';

export type NotificationRoutingSettings = Pick<
  AppSettings,
  | 'systemNotificationsEnabled'
  | 'warningNotificationsEnabled'
  | 'completionNotificationsEnabled'
>;

export type SystemNotificationPayload = {
  title: string;
  body: string;
};

export function normalizeNativeToastType(value: unknown): NativeToastType {
  switch (value) {
    case 'success':
    case 'error':
    case 'warning':
      return value;
    default:
      return 'info';
  }
}

export function shouldEmitSystemNotification(
  type: NativeToastType,
  settings: NotificationRoutingSettings,
) {
  if (!settings.systemNotificationsEnabled) {
    return false;
  }

  if (
    (type === 'warning' || type === 'error') &&
    !settings.warningNotificationsEnabled
  ) {
    return false;
  }

  if (type === 'success' && !settings.completionNotificationsEnabled) {
    return false;
  }

  return true;
}

function resolveSystemNotificationTitle(type: NativeToastType) {
  switch (type) {
    case 'error':
      return 'Literature Studio Error';
    case 'warning':
      return 'Literature Studio Warning';
    case 'success':
      return 'Literature Studio Completed';
    default:
      return 'Literature Studio';
  }
}

export function resolveSystemNotificationPayloadFromToast(
  options: NativeToastOptions,
  settings: NotificationRoutingSettings,
): SystemNotificationPayload | null {
  const body = typeof options.message === 'string' ? options.message.trim() : '';
  if (!body) {
    return null;
  }

  const type = normalizeNativeToastType(options.type);
  if (!shouldEmitSystemNotification(type, settings)) {
    return null;
  }

  return {
    title: resolveSystemNotificationTitle(type),
    body,
  };
}
