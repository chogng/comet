import 'cs/workbench/browser/parts/notifications/media/notificationsAlerts.css';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { withSeverityPrefix } from 'cs/platform/notification/common/notification';
import type {
  INotificationChangeEvent,
  NotificationsModel,
} from 'cs/workbench/common/notifications';

export class NotificationsAlerts {
  private readonly element = document.createElement('div');
  private readonly disposables = new DisposableStore();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: NotificationsModel,
  ) {
    this.element.className = 'comet-notifications-alerts';
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

  private readonly handleNotificationChange = (event: INotificationChangeEvent) => {
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
  model: NotificationsModel,
) {
  return new NotificationsAlerts(container, model);
}
