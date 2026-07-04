import { DisposableStore } from 'cs/base/common/lifecycle';
import { NotificationsAlerts } from 'cs/workbench/browser/parts/notifications/notificationsAlerts';
import { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';
import { NotificationsStatus } from 'cs/workbench/browser/parts/notifications/notificationsStatus';
import { NotificationsToasts } from 'cs/workbench/browser/parts/notifications/notificationsToasts';
import type { NotificationService } from 'cs/workbench/services/notification/common/notificationService';

export class NotificationsPart {
  private readonly element = document.createElement('div');
  private readonly store = new DisposableStore();

  readonly center: NotificationsCenter;
  readonly toasts: NotificationsToasts;
  readonly status: NotificationsStatus;
  readonly alerts: NotificationsAlerts;

  constructor(
    private readonly container: HTMLElement,
    private readonly notificationService: NotificationService,
  ) {
    this.element.className = 'comet-notifications-part';
    this.container.append(this.element);
    this.center = this.store.add(
      new NotificationsCenter(this.element, this.notificationService.model),
    );
    this.toasts = this.store.add(
      new NotificationsToasts(this.element, this.notificationService.model),
    );
    this.status = this.store.add(
      new NotificationsStatus(
        this.element,
        this.notificationService.model,
        this.center,
      ),
    );
    this.alerts = this.store.add(
      new NotificationsAlerts(this.element, this.notificationService.model),
    );
  }

  getElement() {
    return this.element;
  }

  dispose() {
    this.store.dispose();
    this.element.remove();
  }
}

export function createNotificationsPart(
  container: HTMLElement,
  notificationService: NotificationService,
) {
  return new NotificationsPart(container, notificationService);
}
