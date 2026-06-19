import { clearNode } from 'ls/base/browser/dom';
import type { IAction } from 'ls/base/common/actions';
import {
  Severity,
  type NotificationMessage,
} from 'ls/platform/notification/common/notification';
import type { WorkbenchNotificationItem } from 'ls/workbench/browser/parts/notifications/notificationsModel';

export function notificationMessageToString(message: NotificationMessage) {
  return typeof message === 'string' ? message : message.message;
}

export function getNotificationSeverityClassName(severity: Severity) {
  switch (severity) {
    case Severity.Error:
      return 'notification-severity-error';
    case Severity.Warning:
      return 'notification-severity-warning';
    case Severity.Info:
      return 'notification-severity-info';
    default:
      return 'notification-severity-ignore';
  }
}

export function getNotificationSeverityLabel(severity: Severity) {
  switch (severity) {
    case Severity.Error:
      return 'Error';
    case Severity.Warning:
      return 'Warning';
    case Severity.Info:
      return 'Info';
    default:
      return 'Notification';
  }
}

export function getNotificationSourceLabel(item: WorkbenchNotificationItem) {
  if (!item.source) {
    return '';
  }

  return typeof item.source === 'string' ? item.source : item.source.label;
}

function createActionButton(
  action: IAction,
  className: string,
  onDidRunAction?: (action: IAction) => void,
) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = action.label;
  button.title = action.tooltip || action.label;
  button.disabled = !action.enabled;
  button.addEventListener('click', () => {
    void Promise.resolve(action.run()).finally(() => {
      onDidRunAction?.(action);
    });
  });
  return button;
}

export type NotificationRenderOptions = {
  compact?: boolean;
  onDidRunAction?: (action: IAction) => void;
  onDidClose?: () => void;
};

export function renderNotificationItem(
  item: WorkbenchNotificationItem,
  container: HTMLElement,
  options: NotificationRenderOptions = {},
) {
  clearNode(container);
  container.className = [
    'notification-list-item',
    getNotificationSeverityClassName(item.severity),
    options.compact ? 'is-compact' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const mainRow = document.createElement('div');
  mainRow.className = 'notification-list-item-main-row';

  const icon = document.createElement('span');
  icon.className = 'notification-list-item-icon';
  icon.textContent = getNotificationSeverityLabel(item.severity).charAt(0);

  const message = document.createElement('div');
  message.className = 'notification-list-item-message';
  message.textContent = item.messageText;

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'notification-list-item-close';
  closeButton.textContent = 'x';
  closeButton.title = 'Close';
  closeButton.addEventListener('click', () => {
    options.onDidClose?.();
    item.close();
  });

  mainRow.append(icon, message, closeButton);
  container.append(mainRow);

  const sourceLabel = getNotificationSourceLabel(item);
  if (sourceLabel) {
    const source = document.createElement('div');
    source.className = 'notification-list-item-source';
    source.textContent = sourceLabel;
    container.append(source);
  }

  const primaryActions = item.actions?.primary ?? [];
  if (primaryActions.length > 0) {
    const actionBar = document.createElement('div');
    actionBar.className = 'notification-list-item-actions';
    for (const action of primaryActions) {
      actionBar.append(
        createActionButton(
          action,
          'notification-list-item-action is-primary',
          options.onDidRunAction,
        ),
      );
    }
    container.append(actionBar);
  }

  const secondaryActions = item.actions?.secondary ?? [];
  if (!options.compact && secondaryActions.length > 0) {
    const actionBar = document.createElement('div');
    actionBar.className = 'notification-list-item-actions is-secondary';
    for (const action of secondaryActions) {
      actionBar.append(
        createActionButton(
          action,
          'notification-list-item-action is-secondary',
          options.onDidRunAction,
        ),
      );
    }
    container.append(actionBar);
  }

  if (item.hasProgress) {
    const progress = document.createElement('div');
    progress.className = 'notification-list-item-progress';
    const bar = document.createElement('div');
    bar.className = 'notification-list-item-progress-bar';
    const state = item.progress.state;
    if (typeof state.total === 'number' && typeof state.worked === 'number') {
      bar.style.width = `${Math.max(0, Math.min(100, (state.worked / state.total) * 100))}%`;
    }
    progress.append(bar);
    container.append(progress);
  }

  return container;
}
