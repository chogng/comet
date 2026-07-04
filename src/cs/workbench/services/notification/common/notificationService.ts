/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action, type IAction } from 'cs/base/common/actions';
import { EventEmitter } from 'cs/base/common/event';
import {
  Disposable,
  DisposableStore,
  toDisposable,
} from 'cs/base/common/lifecycle';
import {
  INotificationService,
  NotificationPriority,
  NotificationsFilter,
  Severity,
  type INotification,
  type INotificationHandle,
  type INotificationSource,
  type INotificationSourceFilter,
  type IPromptChoice,
  type IPromptChoiceWithMenu,
  type IPromptOptions,
  type IStatusHandle,
  type IStatusMessageOptions,
  type NotificationMessage,
} from 'cs/platform/notification/common/notification';
import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
  NotificationViewItem,
  NotificationsModel,
} from 'cs/workbench/common/notifications';

export class NotificationService extends Disposable implements INotificationService {
  declare readonly _serviceBrand: undefined;

  readonly model = this._register(new NotificationsModel());

  private readonly statusTimers = this._register(new DisposableStore());
  private readonly onDidChangeFilterEmitter = this._register(
    new EventEmitter<void>(),
  );
  readonly onDidChangeFilter = this.onDidChangeFilterEmitter.event;

  constructor() {
    super();
    this._register(
      this.model.onDidChangeFilter(() => {
        this.onDidChangeFilterEmitter.fire();
      }),
    );
  }

  setFilter(filter: NotificationsFilter | INotificationSourceFilter): void {
    this.model.setFilter(filter);
  }

  getFilter(source?: INotificationSource): NotificationsFilter {
    return this.model.getFilter(source);
  }

  getFilters(): INotificationSourceFilter[] {
    return this.model.getFilters();
  }

  removeFilter(sourceId: string): void {
    this.model.removeFilter(sourceId);
  }

  notify(notification: INotification): INotificationHandle {
    if (this.shouldSuppressNotification(notification)) {
      return this.createClosedHandle(notification);
    }

    return this.model.addNotification(notification);
  }

  info(message: NotificationMessage | NotificationMessage[]): void {
    this.notifyMany(Severity.Info, message);
  }

  warn(message: NotificationMessage | NotificationMessage[]): void {
    this.notifyMany(Severity.Warning, message);
  }

  error(message: NotificationMessage | NotificationMessage[]): void {
    this.notifyMany(Severity.Error, message);
  }

  prompt(
    severity: Severity,
    message: string,
    choices: (IPromptChoice | IPromptChoiceWithMenu)[],
    options?: IPromptOptions,
  ): INotificationHandle {
    let handle: INotificationHandle | null = null;
    let choiceClicked = false;
    const promptDisposables = new DisposableStore();
    const primary: IAction[] = [];
    const secondary: IAction[] = [];

    choices.forEach((choice, index) => {
      const action = promptDisposables.add(new Action(
        `workbench.notification.prompt.${index}`,
        choice.label,
        undefined,
        true,
        () => {
          choiceClicked = true;
          choice.run();
          if (!choice.keepOpen) {
            handle?.close();
          }
        },
      ));

      if (choice.isSecondary) {
        secondary.push(action);
      } else {
        primary.push(action);
      }
    });

    handle = this.notify({
      severity,
      message,
      sticky: options?.sticky,
      priority: options?.priority,
      neverShowAgain: options?.neverShowAgain,
      actions: {
        primary,
        secondary,
      },
    });

    promptDisposables.add(
      handle.onDidClose(() => {
        promptDisposables.dispose();
        if (!choiceClicked) {
          options?.onCancel?.();
        }
      }),
    );

    return handle;
  }

  status(message: NotificationMessage, options?: IStatusMessageOptions): IStatusHandle {
    const item = this.model.showStatusMessage(message, options);
    const disposables = new DisposableStore();
    this.statusTimers.add(disposables);

    if (typeof options?.showAfter === 'number' && options.showAfter > 0) {
      const handle = window.setTimeout(() => {}, options.showAfter);
      disposables.add(toDisposable(() => window.clearTimeout(handle)));
    }

    if (typeof options?.hideAfter === 'number' && options.hideAfter > 0) {
      const handle = window.setTimeout(() => item.close(), options.hideAfter);
      disposables.add(toDisposable(() => window.clearTimeout(handle)));
    }

    return {
      close: () => {
        disposables.dispose();
        item.close();
      },
    };
  }

  private notifyMany(
    severity: Severity,
    messages: NotificationMessage | NotificationMessage[],
  ) {
    for (const message of Array.isArray(messages) ? messages : [messages]) {
      this.notify({ severity, message });
    }
  }

  private shouldSuppressNotification(notification: INotification) {
    if (notification.priority === NotificationPriority.URGENT) {
      return false;
    }

    if (this.model.getFilter() === NotificationsFilter.ERROR) {
      return notification.severity !== Severity.Error;
    }

    const source =
      typeof notification.source === 'string'
        ? { id: notification.source, label: notification.source }
        : notification.source;
    return Boolean(
      source &&
        this.model.getFilter(source) === NotificationsFilter.ERROR &&
        notification.severity !== Severity.Error,
    );
  }

  private createClosedHandle(notification: INotification): INotificationHandle {
    const item = new NotificationViewItem(
      notification,
      () => {},
      () => {},
    );
    item.close();
    return item;
  }
}

registerSingleton(INotificationService, NotificationService, InstantiationType.Delayed);
