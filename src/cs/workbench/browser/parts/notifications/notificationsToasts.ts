/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'cs/workbench/browser/parts/notifications/media/notificationsToasts.css';
import { $, append } from 'cs/base/browser/dom';
import { DisposableStore, toDisposable } from 'cs/base/common/lifecycle';
import { NotificationPriority } from 'cs/platform/notification/common/notification';
import { renderNotificationItem } from 'cs/workbench/browser/parts/notifications/notificationsViewer';
import type {
  INotificationChangeEvent,
  NotificationViewItem,
  NotificationsModel,
} from 'cs/workbench/common/notifications';

const DEFAULT_TOAST_DURATION = 8000;
const MAX_VISIBLE_TOASTS = 3;

export class NotificationsToasts {
  private readonly element = $('div.comet-notifications-toasts.bottom-right');
  private readonly disposables = new DisposableStore();
  private readonly renderDisposables = new DisposableStore();
  private readonly toastTimers = new Map<NotificationViewItem, DisposableStore>();
  private visibleItems: NotificationViewItem[] = [];
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: NotificationsModel,
  ) {
    append(this.container, this.element);
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
    this.renderDisposables.dispose();
    this.disposables.dispose();
    this.element.remove();
  }

  private readonly handleNotificationChange = (event: INotificationChangeEvent) => {
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

  private showToast(item: NotificationViewItem) {
    if (
      item.priority === NotificationPriority.SILENT ||
      this.visibleItems.includes(item)
    ) {
      return;
    }

    const nextItems = [item, ...this.visibleItems];
    this.visibleItems = nextItems.slice(0, MAX_VISIBLE_TOASTS);
    for (const overflowItem of nextItems.slice(MAX_VISIBLE_TOASTS)) {
      this.releaseToast(overflowItem);
    }
    item.updateVisibility(true);
    this.installToastTimer(item);
    this.render();
  }

  private removeToast(item: NotificationViewItem) {
    this.releaseToast(item);
    this.visibleItems = this.visibleItems.filter((candidate) => candidate !== item);
    this.render();
  }

  private releaseToast(item: NotificationViewItem) {
    const timer = this.toastTimers.get(item);
    timer?.dispose();
    this.toastTimers.delete(item);
    item.updateVisibility(false);
  }

  private installToastTimer(item: NotificationViewItem) {
    if (item.sticky || item.hasProgress) {
      return;
    }

    const timer = new DisposableStore();
    const handle = window.setTimeout(() => this.removeToast(item), DEFAULT_TOAST_DURATION);
    timer.add(toDisposable(() => window.clearTimeout(handle)));
    this.toastTimers.set(item, timer);
  }

  private render() {
    this.renderDisposables.clear();
    this.element.replaceChildren();
    this.element.classList.toggle('visible', this.visibleItems.length > 0);
    for (const item of this.visibleItems) {
      const toast = $('section.comet-notification-toast');
      this.renderDisposables.add(renderNotificationItem(item, toast, {
        compact: true,
        onDidClose: () => this.removeToast(item),
        onDidRunAction: () => this.removeToast(item),
      }));
      append(this.element, toast);
    }
  }
}

export function createNotificationsToasts(
  container: HTMLElement,
  model: NotificationsModel,
) {
  return new NotificationsToasts(container, model);
}
