import { withSeverityPrefix } from 'ls/platform/notification/common/notification';
import type { NotificationViewItem } from 'ls/workbench/common/notifications';
import { getNotificationSourceLabel } from 'ls/workbench/browser/parts/notifications/notificationsViewer';

export function getNotificationAccessibleLabel(item: NotificationViewItem) {
  const source = getNotificationSourceLabel(item);
  const message = source ? `${item.messageText}. Source: ${source}` : item.messageText;
  return withSeverityPrefix(message, item.severity);
}

export function getNotificationsAccessibleSummary(
  items: readonly NotificationViewItem[],
) {
  if (items.length === 0) {
    return 'No notifications';
  }

  return items.map(getNotificationAccessibleLabel).join('\n');
}
