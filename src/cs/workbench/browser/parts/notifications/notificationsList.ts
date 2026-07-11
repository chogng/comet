/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Comet. All rights reserved.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from 'cs/base/browser/dom';
import { DisposableStore } from 'cs/base/common/lifecycle';
import { localize } from 'cs/nls';
import { renderNotificationItem } from 'cs/workbench/browser/parts/notifications/notificationsViewer';
import type {
  INotificationChangeEvent,
  NotificationViewItem,
  NotificationsModel,
} from 'cs/workbench/common/notifications';

export type NotificationsListOptions = {
  compact?: boolean;
  emptyMessage?: string;
};

export class NotificationsList {
  private readonly listElement: HTMLDivElement;
  private readonly disposables = new DisposableStore();
  private readonly renderDisposables = new DisposableStore();
  private items: NotificationViewItem[] = [];
  private disposed = false;

  constructor(
    private readonly container: HTMLElement,
    private readonly model: NotificationsModel,
    private readonly options: NotificationsListOptions = {},
  ) {
    this.container.classList.add('comet-notifications-list-container');
    this.listElement = $<HTMLDivElement>('div.comet-notifications-list');
    append(this.container, this.listElement);
    this.disposables.add(
      this.model.onDidChangeNotification(this.handleNotificationChange),
    );
    this.setNotifications(this.model.notifications);
  }

  getElement() {
    return this.listElement;
  }

  setNotifications(items: NotificationViewItem[]) {
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
    this.disposables.dispose();
    this.container.classList.remove('comet-notifications-list-container');
    this.container.replaceChildren();
  }

  private readonly handleNotificationChange = (event: INotificationChangeEvent) => {
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
    this.renderDisposables.clear();
    clearNode(this.listElement);
    if (this.items.length === 0) {
      const empty = $('div.comet-notifications-list-empty');
      empty.textContent = this.options.emptyMessage ?? localize('noNotifications', "No notifications");
      append(this.listElement, empty);
      return;
    }

    for (const item of this.items) {
      const element = $('article');
      this.renderDisposables.add(renderNotificationItem(item, element, {
        compact: this.options.compact,
        onDidRunAction: () => {
          if (!item.hasProgress) {
            item.close();
          }
        },
      }));
      append(this.listElement, element);
    }
  }
}

export function createNotificationsList(
  container: HTMLElement,
  model: NotificationsModel,
  options?: NotificationsListOptions,
) {
  return new NotificationsList(container, model, options);
}
