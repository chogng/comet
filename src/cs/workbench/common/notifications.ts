/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EventEmitter } from 'cs/base/common/event';
import { Disposable } from 'cs/base/common/lifecycle';
import {
  NotificationPriority,
  NotificationsFilter,
  Severity,
  type INotification,
  type INotificationActions,
  type INotificationHandle,
  type INotificationProgress,
  type INotificationProgressProperties,
  type INotificationSource,
  type INotificationSourceFilter,
  type IStatusHandle,
  type IStatusMessageOptions,
  type NotificationMessage,
} from 'cs/platform/notification/common/notification';

export type NotificationViewItemContentChangeKind =
  | 'severity'
  | 'message'
  | 'actions'
  | 'progress'
  | 'visibility';

export type INotificationChangeEvent =
  | {
      kind: 'add';
      item: NotificationViewItem;
      index: number;
    }
  | {
      kind: 'change';
      item: NotificationViewItem;
      index: number;
      detail: NotificationViewItemContentChangeKind;
    }
  | {
      kind: 'remove';
      item: NotificationViewItem;
      index: number;
    };

export type IStatusMessageChangeEvent =
  | {
      kind: 'add';
      item: StatusMessageViewItem;
    }
  | {
      kind: 'remove';
      item: StatusMessageViewItem;
    };

export interface INotificationsFilter {
  readonly global: NotificationsFilter;
  readonly sources: Map<string, NotificationsFilter>;
}

type NotificationProgressState = {
  infinite?: boolean;
  total?: number;
  worked?: number;
  done?: boolean;
};

let notificationSequence = 0;
let statusMessageSequence = 0;

function messageToString(message: NotificationMessage) {
  return typeof message === 'string' ? message : message.message;
}

class NotificationViewItemProgress implements INotificationProgress {
  private stateValue: NotificationProgressState = {};

  constructor(
    initialState: INotificationProgressProperties | undefined,
    private readonly onDidChange: () => void,
  ) {
    if (initialState) {
      this.stateValue = { ...initialState };
    }
  }

  get state(): NotificationProgressState {
    return { ...this.stateValue };
  }

  get hasProgress() {
    return Boolean(
      this.stateValue.infinite ||
        typeof this.stateValue.total === 'number' ||
        typeof this.stateValue.worked === 'number',
    ) && !this.stateValue.done;
  }

  infinite(): void {
    this.stateValue = { infinite: true, done: false };
    this.onDidChange();
  }

  total(value: number): void {
    this.stateValue = { ...this.stateValue, total: value, done: false };
    this.onDidChange();
  }

  worked(value: number): void {
    this.stateValue = { ...this.stateValue, worked: value, done: false };
    this.onDidChange();
  }

  done(): void {
    this.stateValue = { done: true };
    this.onDidChange();
  }
}

export class NotificationViewItem
  extends Disposable
  implements INotificationHandle
{
  readonly sequence = ++notificationSequence;
  readonly createdAt = Date.now();
  readonly progress: NotificationViewItemProgress;
  readonly source?: string | INotificationSource;
  readonly sourceId?: string;
  readonly sticky?: boolean;
  readonly priority: NotificationPriority;
  readonly notificationId?: string;

  private severityValue: Severity;
  private messageValue: NotificationMessage;
  private actionsValue: INotificationActions | undefined;
  private visible = false;
  private closed = false;

  private readonly onDidCloseEmitter = this._register(new EventEmitter<void>());
  readonly onDidClose = this.onDidCloseEmitter.event;

  private readonly onDidChangeVisibilityEmitter = this._register(
    new EventEmitter<boolean>(),
  );
  readonly onDidChangeVisibility = this.onDidChangeVisibilityEmitter.event;

  private readonly onDidChangeContentEmitter = this._register(
    new EventEmitter<NotificationViewItemContentChangeKind>(),
  );
  readonly onDidChangeContent = this.onDidChangeContentEmitter.event;

  constructor(
    notification: INotification,
    private readonly onDidMutate: (
      item: NotificationViewItem,
      detail: NotificationViewItemContentChangeKind,
    ) => void,
    private readonly onDidRequestClose: (item: NotificationViewItem) => void,
  ) {
    super();
    this.notificationId = notification.id;
    this.severityValue = notification.severity;
    this.messageValue = notification.message;
    this.actionsValue = notification.actions;
    this.source = notification.source;
    this.sourceId =
      typeof notification.source === 'string'
        ? notification.source
        : notification.source?.id;
    this.sticky = notification.sticky;
    this.priority = notification.priority ?? NotificationPriority.DEFAULT;
    this.progress = new NotificationViewItemProgress(notification.progress, () =>
      this.fireContentChange('progress'),
    );
  }

  get severity() {
    return this.severityValue;
  }

  get message() {
    return this.messageValue;
  }

  get messageText() {
    return messageToString(this.messageValue);
  }

  get actions() {
    return this.actionsValue;
  }

  get isVisible() {
    return this.visible;
  }

  get isClosed() {
    return this.closed;
  }

  get hasProgress() {
    return this.progress.hasProgress;
  }

  updateSeverity(severity: Severity): void {
    if (this.closed || this.severityValue === severity) {
      return;
    }

    this.severityValue = severity;
    this.fireContentChange('severity');
  }

  updateMessage(message: NotificationMessage): void {
    if (this.closed || this.messageValue === message) {
      return;
    }

    this.messageValue = message;
    this.fireContentChange('message');
  }

  updateActions(actions?: INotificationActions): void {
    if (this.closed || this.actionsValue === actions) {
      return;
    }

    this.actionsValue = actions;
    this.fireContentChange('actions');
  }

  updateVisibility(visible: boolean): void {
    if (this.closed || this.visible === visible) {
      return;
    }

    this.visible = visible;
    this.onDidChangeVisibilityEmitter.fire(visible);
    this.fireContentChange('visibility');
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.onDidRequestClose(this);
    this.onDidCloseEmitter.fire();
  }

  private fireContentChange(detail: NotificationViewItemContentChangeKind) {
    this.onDidChangeContentEmitter.fire(detail);
    this.onDidMutate(this, detail);
  }
}

export class StatusMessageViewItem implements IStatusHandle {
  readonly id = ++statusMessageSequence;
  readonly message: NotificationMessage;
  readonly messageText: string;
  readonly options: IStatusMessageOptions | undefined;

  private closed = false;

  constructor(
    message: NotificationMessage,
    options: IStatusMessageOptions | undefined,
    private readonly onDidRequestClose: (item: StatusMessageViewItem) => void,
  ) {
    this.message = message;
    this.messageText = messageToString(message);
    this.options = options;
  }

  close(): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.onDidRequestClose(this);
  }
}

export class NotificationsModel extends Disposable {
  private notificationItems: NotificationViewItem[] = [];
  private statusMessageItem: StatusMessageViewItem | null = null;
  private globalFilter = NotificationsFilter.OFF;
  private readonly sourceFilters = new Map<string, INotificationSourceFilter>();

  private readonly onDidChangeNotificationEmitter = this._register(
    new EventEmitter<INotificationChangeEvent>(),
  );
  readonly onDidChangeNotification = this.onDidChangeNotificationEmitter.event;

  private readonly onDidChangeStatusMessageEmitter = this._register(
    new EventEmitter<IStatusMessageChangeEvent>(),
  );
  readonly onDidChangeStatusMessage = this.onDidChangeStatusMessageEmitter.event;

  private readonly onDidChangeFilterEmitter = this._register(
    new EventEmitter<Partial<INotificationsFilter>>(),
  );
  readonly onDidChangeFilter = this.onDidChangeFilterEmitter.event;

  get notifications() {
    return [...this.notificationItems];
  }

  get statusMessage() {
    return this.statusMessageItem;
  }

  getFilter(source?: INotificationSource): NotificationsFilter {
    if (source) {
      return this.sourceFilters.get(source.id)?.filter ?? this.globalFilter;
    }

    return this.globalFilter;
  }

  getFilters(): INotificationSourceFilter[] {
    return [...this.sourceFilters.values()];
  }

  setFilter(filter: NotificationsFilter | INotificationSourceFilter): void {
    if (typeof filter === 'number') {
      if (this.globalFilter === filter) {
        return;
      }

      this.globalFilter = filter;
      this.onDidChangeFilterEmitter.fire({ global: this.globalFilter });
      return;
    }

    const previous = this.sourceFilters.get(filter.id);
    if (previous?.filter === filter.filter && previous.label === filter.label) {
      return;
    }

    this.sourceFilters.set(filter.id, filter);
    this.onDidChangeFilterEmitter.fire({
      global: this.globalFilter,
      sources: new Map([[filter.id, filter.filter]]),
    });
  }

  removeFilter(sourceId: string): void {
    if (!this.sourceFilters.delete(sourceId)) {
      return;
    }

    this.onDidChangeFilterEmitter.fire({
      global: this.globalFilter,
      sources: new Map([[sourceId, NotificationsFilter.OFF]]),
    });
  }

  addNotification(notification: INotification): NotificationViewItem {
    const duplicateIndex = notification.id
      ? this.notificationItems.findIndex((item) => item.notificationId === notification.id)
      : -1;
    if (duplicateIndex >= 0) {
      const duplicate = this.notificationItems[duplicateIndex];
      duplicate.updateSeverity(notification.severity);
      duplicate.updateMessage(notification.message);
      duplicate.updateActions(notification.actions);
      return duplicate;
    }

    const item = new NotificationViewItem(
      notification,
      this.handleNotificationMutation,
      this.removeNotification,
    );
    this.notificationItems = [item, ...this.notificationItems];
    this.onDidChangeNotificationEmitter.fire({ kind: 'add', item, index: 0 });
    return item;
  }

  showStatusMessage(
    message: NotificationMessage,
    options?: IStatusMessageOptions,
  ): StatusMessageViewItem {
    this.statusMessageItem?.close();
    const item = new StatusMessageViewItem(
      message,
      options,
      this.removeStatusMessage,
    );
    this.statusMessageItem = item;
    this.onDidChangeStatusMessageEmitter.fire({ kind: 'add', item });
    return item;
  }

  clearAll() {
    for (const item of [...this.notificationItems]) {
      if (!item.hasProgress) {
        item.close();
      }
    }
  }

  private readonly handleNotificationMutation = (
    item: NotificationViewItem,
    detail: NotificationViewItemContentChangeKind,
  ) => {
    const index = this.notificationItems.indexOf(item);
    if (index < 0) {
      return;
    }

    this.onDidChangeNotificationEmitter.fire({
      kind: 'change',
      item,
      index,
      detail,
    });
  };

  private readonly removeNotification = (item: NotificationViewItem) => {
    const index = this.notificationItems.indexOf(item);
    if (index < 0) {
      return;
    }

    this.notificationItems = this.notificationItems.filter((candidate) => candidate !== item);
    this.onDidChangeNotificationEmitter.fire({ kind: 'remove', item, index });
  };

  private readonly removeStatusMessage = (item: StatusMessageViewItem) => {
    if (this.statusMessageItem !== item) {
      return;
    }

    this.statusMessageItem = null;
    this.onDidChangeStatusMessageEmitter.fire({ kind: 'remove', item });
  };
}
