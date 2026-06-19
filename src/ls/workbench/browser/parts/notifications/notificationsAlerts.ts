import { LifecycleStore } from 'ls/base/common/lifecycle';
import { withSeverityPrefix } from 'ls/platform/notification/common/notification';
import type {
  NotificationModelChange,
  WorkbenchNotificationsModel,
} from 'ls/workbench/browser/parts/notifications/notificationsModel';

export class NotificationsAlerts {
  private readonly element = document.createElement('div');
  private readonly disposables = new LifecycleStore();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: WorkbenchNotificationsModel,
  ) {
    this.element.className = 'notifications-alerts';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-live', 'polite');
    this.container.append(this.element);
    this.disposables.add(
      this.model.onDidChangeNotification(this.handleNotificationChange),
    );
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
    this.element.remove();
  }

  private readonly handleNotificationChange = (event: NotificationModelChange) => {
    if (event.kind !== 'add') {
      return;
    }

    this.element.textContent = withSeverityPrefix(
      event.item.messageText,
      event.item.severity,
    );
  };
}

export function createNotificationsAlerts(
  container: HTMLElement,
  model: WorkbenchNotificationsModel,
) {
  return new NotificationsAlerts(container, model);
}
