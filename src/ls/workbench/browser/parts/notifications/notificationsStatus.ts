import 'ls/workbench/browser/parts/notifications/media/notificationsActions.css';
import { LifecycleStore, toDisposable } from 'ls/base/common/lifecycle';
import type {
  StatusMessageChange,
  WorkbenchNotificationsModel,
} from 'ls/workbench/browser/parts/notifications/notificationsModel';
import type { NotificationsCenter } from 'ls/workbench/browser/parts/notifications/notificationsCenter';

export class NotificationsStatus {
  private readonly element = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly statusMessageElement = document.createElement('span');
  private readonly disposables = new LifecycleStore();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: WorkbenchNotificationsModel,
    private readonly center: NotificationsCenter,
  ) {
    this.element.className = 'notifications-status is-hidden';
    this.button.type = 'button';
    this.button.className = 'notifications-status-button';
    this.button.addEventListener('click', this.handleToggleCenter);
    this.statusMessageElement.className = 'notifications-status-message';
    this.element.append(this.statusMessageElement, this.button);
    this.container.append(this.element);

    this.disposables.add(
      toDisposable(() => {
        this.button.removeEventListener('click', this.handleToggleCenter);
      }),
    );
    this.disposables.add(
      this.model.onDidChangeNotification(() => this.update()),
    );
    this.disposables.add(
      this.model.onDidChangeStatusMessage(this.handleStatusMessageChange),
    );
    this.update();
  }

  getElement() {
    return this.element;
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.disposables.dispose();
    this.element.remove();
  }

  private readonly handleToggleCenter = () => {
    this.center.toggle();
  };

  private readonly handleStatusMessageChange = (_event: StatusMessageChange) => {
    this.update();
  };

  private update() {
    const count = this.model.notifications.length;
    const statusMessage = this.model.statusMessage?.messageText ?? '';
    this.statusMessageElement.textContent = statusMessage;
    this.button.textContent = count > 0 ? `Notifications (${count})` : 'Notifications';
    this.button.title = count > 0 ? `${count} notifications` : 'No notifications';
    this.button.classList.toggle('has-notifications', count > 0);
    this.element.classList.toggle('is-hidden', count === 0 && statusMessage.length === 0);
  }
}

export function createNotificationsStatus(
  container: HTMLElement,
  model: WorkbenchNotificationsModel,
  center: NotificationsCenter,
) {
  return new NotificationsStatus(container, model, center);
}
