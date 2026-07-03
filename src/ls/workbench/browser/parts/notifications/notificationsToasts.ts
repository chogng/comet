import 'ls/workbench/browser/parts/notifications/media/notificationsToasts.css';
import { DisposableStore, toDisposable } from 'ls/base/common/lifecycle';
import { NotificationPriority } from 'ls/platform/notification/common/notification';
import { renderNotificationItem } from 'ls/workbench/browser/parts/notifications/notificationsViewer';
import type {
  NotificationModelChange,
  WorkbenchNotificationItem,
  WorkbenchNotificationsModel,
} from 'ls/workbench/browser/parts/notifications/notificationsModel';

const DEFAULT_TOAST_DURATION = 8000;
const MAX_VISIBLE_TOASTS = 3;

export class NotificationsToasts {
  private readonly element = document.createElement('div');
  private readonly disposables = new DisposableStore();
  private readonly toastTimers = new Map<WorkbenchNotificationItem, DisposableStore>();
  private visibleItems: WorkbenchNotificationItem[] = [];
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: WorkbenchNotificationsModel,
  ) {
    this.element.className = 'notifications-toasts bottom-right';
    this.container.append(this.element);
    this.disposables.add(
      this.model.onDidChangeNotification(this.handleNotificationChange),
    );
    for (const item of this.model.notifications.slice(0, MAX_VISIBLE_TOASTS)) {
      this.showToast(item);
    }
  }

  getElement() {
    return this.element;
  }

  hide() {
    for (const item of [...this.visibleItems]) {
      this.removeToast(item);
    }
  }

  dispose() {
    if (this.disposed) {
      return;
    }

    this.disposed = true;
    this.hide();
    this.disposables.dispose();
    this.element.remove();
  }

  private readonly handleNotificationChange = (event: NotificationModelChange) => {
    if (event.kind === 'add') {
      this.showToast(event.item);
      return;
    }

    if (event.kind === 'remove') {
      this.removeToast(event.item);
      return;
    }

    this.render();
  };

  private showToast(item: WorkbenchNotificationItem) {
    if (
      item.priority === NotificationPriority.SILENT ||
      this.visibleItems.includes(item)
    ) {
      return;
    }

    this.visibleItems = [item, ...this.visibleItems].slice(0, MAX_VISIBLE_TOASTS);
    item.updateVisibility(true);
    this.installToastTimer(item);
    this.render();
  }

  private removeToast(item: WorkbenchNotificationItem) {
    const timer = this.toastTimers.get(item);
    timer?.dispose();
    this.toastTimers.delete(item);
    this.visibleItems = this.visibleItems.filter((candidate) => candidate !== item);
    item.updateVisibility(false);
    this.render();
  }

  private installToastTimer(item: WorkbenchNotificationItem) {
    if (item.sticky || item.hasProgress) {
      return;
    }

    const timer = new DisposableStore();
    const handle = window.setTimeout(() => this.removeToast(item), DEFAULT_TOAST_DURATION);
    timer.add(toDisposable(() => window.clearTimeout(handle)));
    this.toastTimers.set(item, timer);
  }

  private render() {
    this.element.replaceChildren();
    this.element.classList.toggle('visible', this.visibleItems.length > 0);
    for (const item of this.visibleItems) {
      const toast = document.createElement('section');
      toast.className = 'notification-toast';
      renderNotificationItem(item, toast, {
        compact: true,
        onDidClose: () => this.removeToast(item),
        onDidRunAction: () => this.removeToast(item),
      });
      this.element.append(toast);
    }
  }
}

export function createNotificationsToasts(
  container: HTMLElement,
  model: WorkbenchNotificationsModel,
) {
  return new NotificationsToasts(container, model);
}
