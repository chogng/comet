import { clearNode } from 'ls/base/browser/dom';
import { LifecycleStore } from 'ls/base/common/lifecycle';
import { renderNotificationItem } from 'ls/workbench/browser/parts/notifications/notificationsViewer';
import type {
  NotificationModelChange,
  WorkbenchNotificationItem,
  WorkbenchNotificationsModel,
} from 'ls/workbench/browser/parts/notifications/notificationsModel';

export type NotificationsListOptions = {
  compact?: boolean;
  emptyMessage?: string;
};

export class NotificationsList {
  private readonly listElement: HTMLDivElement;
  private readonly renderDisposables = new LifecycleStore();
  private items: WorkbenchNotificationItem[] = [];
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: WorkbenchNotificationsModel,
    private readonly options: NotificationsListOptions = {},
  ) {
    this.container.classList.add('notifications-list-container');
    this.listElement = document.createElement('div');
    this.listElement.className = 'notifications-list';
    this.container.append(this.listElement);
    this.renderDisposables.add(
      this.model.onDidChangeNotification(this.handleNotificationChange),
    );
    this.setNotifications(this.model.notifications);
  }

  getElement() {
    return this.listElement;
  }

  setNotifications(items: WorkbenchNotificationItem[]) {
    if (this.disposed) {
      return;
    }

    this.items = [...items];
    this.render();
  }

  focusFirst() {
    const focusTarget = this.listElement.querySelector<HTMLElement>('button');
    focusTarget?.focus();
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.renderDisposables.dispose();
    this.container.classList.remove('notifications-list-container');
    this.container.replaceChildren();
  }

  private readonly handleNotificationChange = (event: NotificationModelChange) => {
    switch (event.kind) {
      case 'add':
        this.items = [event.item, ...this.items.filter((item) => item !== event.item)];
        break;
      case 'remove':
        this.items = this.items.filter((item) => item !== event.item);
        break;
      case 'change':
        if (!this.items.includes(event.item)) {
          this.items = [event.item, ...this.items];
        }
        break;
    }
    this.render();
  };

  private render() {
    clearNode(this.listElement);
    if (this.items.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'notifications-list-empty';
      empty.textContent = this.options.emptyMessage ?? 'No notifications';
      this.listElement.append(empty);
      return;
    }

    for (const item of this.items) {
      const element = document.createElement('article');
      renderNotificationItem(item, element, {
        compact: this.options.compact,
        onDidRunAction: () => {
          if (!item.hasProgress) {
            item.close();
          }
        },
      });
      this.listElement.append(element);
    }
  }
}

export function createNotificationsList(
  container: HTMLElement,
  model: WorkbenchNotificationsModel,
  options?: NotificationsListOptions,
) {
  return new NotificationsList(container, model, options);
}
