import 'cs/workbench/browser/parts/notifications/media/notificationsCenter.css';
import 'cs/workbench/browser/parts/notifications/media/notificationsActions.css';
import { NotificationsList } from 'cs/workbench/browser/parts/notifications/notificationsList';
import type {
  INotificationChangeEvent,
  NotificationsModel,
} from 'cs/workbench/common/notifications';

export class NotificationsCenter {
  private readonly element = document.createElement('section');
  private readonly titleElement = document.createElement('strong');
  private readonly toolbarElement = document.createElement('div');
  private readonly listHost = document.createElement('div');
  private readonly list: NotificationsList;
  private visible = false;
  private disposed = false;
  private readonly modelDisposable;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: NotificationsModel,
  ) {
    this.element.className = 'notifications-center bottom-right';
    const header = document.createElement('header');
    header.className = 'notifications-center-header';
    this.titleElement.className = 'notifications-center-header-title';
    this.toolbarElement.className = 'notifications-center-header-toolbar';

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'notifications-action';
    clearButton.textContent = 'Clear All';
    clearButton.addEventListener('click', () => this.model.clearAll());

    const hideButton = document.createElement('button');
    hideButton.type = 'button';
    hideButton.className = 'notifications-action';
    hideButton.textContent = 'Hide';
    hideButton.addEventListener('click', () => this.hide());

    this.toolbarElement.append(clearButton, hideButton);
    header.append(this.titleElement, this.toolbarElement);
    this.element.append(header, this.listHost);
    this.container.append(this.element);
    this.list = new NotificationsList(this.listHost, this.model, {
      emptyMessage: 'No new notifications',
    });
    this.modelDisposable = this.model.onDidChangeNotification(
      this.handleNotificationChange,
    );
    this.updateTitle();
  }

  get isVisible() {
    return this.visible;
  }

  getElement() {
    return this.element;
  }

  show() {
    if (this.disposed) {
      return;
    }

    this.visible = true;
    this.element.classList.add('visible');
    for (const item of this.model.notifications) {
      item.updateVisibility(true);
    }
    this.list.focusFirst();
  }

  hide() {
    if (this.disposed) {
      return;
    }

    this.visible = false;
    this.element.classList.remove('visible');
    for (const item of this.model.notifications) {
      item.updateVisibility(false);
    }
  }

  toggle() {
    if (this.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.modelDisposable.dispose();
    this.list.dispose();
    this.element.remove();
  }

  private readonly handleNotificationChange = (_event: INotificationChangeEvent) => {
    this.updateTitle();
    if (this.visible && this.model.notifications.length === 0) {
      this.hide();
    }
  };

  private updateTitle() {
    const count = this.model.notifications.length;
    this.titleElement.textContent =
      count === 0 ? 'No new notifications' : `Notifications (${count})`;
  }
}

export function createNotificationsCenter(
  container: HTMLElement,
  model: NotificationsModel,
) {
  return new NotificationsCenter(container, model);
}
