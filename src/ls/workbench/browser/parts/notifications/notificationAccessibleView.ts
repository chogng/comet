import { withSeverityPrefix } from 'ls/platform/notification/common/notification';
import type { WorkbenchNotificationItem } from 'ls/workbench/browser/parts/notifications/notificationsModel';
import { getNotificationSourceLabel } from 'ls/workbench/browser/parts/notifications/notificationsViewer';

export function getNotificationAccessibleLabel(item: WorkbenchNotificationItem) {
  const source = getNotificationSourceLabel(item);
  const message = source ? `${item.messageText}. Source: ${source}` : item.messageText;
  return withSeverityPrefix(message, item.severity);
}

export function getNotificationsAccessibleSummary(
  items: readonly WorkbenchNotificationItem[],
) {
  if (items.length === 0) {
    return 'No notifications';
  }

  return items.map(getNotificationAccessibleLabel).join('\n');
}
