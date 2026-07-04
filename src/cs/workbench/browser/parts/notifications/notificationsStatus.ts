import 'cs/workbench/browser/parts/notifications/media/notificationsActions.css';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import type {
  IStatusMessageChangeEvent,
  NotificationsModel,
} from 'cs/workbench/common/notifications';
import type { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';

export class NotificationsStatus {
  private readonly element = document.createElement('div');
  private readonly button = document.createElement('button');
  private readonly statusMessageElement = document.createElement('span');
  private readonly disposables = new DisposableStore();
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: NotificationsModel,
    private readonly center: NotificationsCenter,
  ) {
    this.element.className = 'comet-notifications-status is-hidden';
    this.button.type = 'button';
    this.button.className = 'comet-notifications-status-button';
    this.button.addEventListener('click', this.handleToggleCenter);
    this.statusMessageElement.className = 'comet-notifications-status-message';
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

  private readonly handleStatusMessageChange = (_event: IStatusMessageChangeEvent) => {
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
  model: NotificationsModel,
  center: NotificationsCenter,
) {
  return new NotificationsStatus(container, model, center);
}
