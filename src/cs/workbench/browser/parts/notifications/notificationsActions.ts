import { Action } from 'cs/base/common/actions';
import {
  CLEAR_ALL_NOTIFICATIONS,
  HIDE_NOTIFICATIONS_CENTER,
  SHOW_NOTIFICATIONS_CENTER,
  TOGGLE_NOTIFICATIONS_CENTER,
} from 'cs/workbench/browser/parts/notifications/notificationsCommands';
import type { NotificationsCenter } from 'cs/workbench/browser/parts/notifications/notificationsCenter';
import type { NotificationsModel } from 'cs/workbench/common/notifications';

export class ShowNotificationsCenterAction extends Action {
  static readonly ID = SHOW_NOTIFICATIONS_CENTER;
  static readonly LABEL = 'Show Notifications';

  constructor(private readonly center: NotificationsCenter) {
    super(ShowNotificationsCenterAction.ID, ShowNotificationsCenterAction.LABEL);
  }

  override async run(): Promise<void> {
    this.center.show();
  }
}

export class HideNotificationsCenterAction extends Action {
  static readonly ID = HIDE_NOTIFICATIONS_CENTER;
  static readonly LABEL = 'Hide Notifications';

  constructor(private readonly center: NotificationsCenter) {
    super(HideNotificationsCenterAction.ID, HideNotificationsCenterAction.LABEL);
  }

  override async run(): Promise<void> {
    this.center.hide();
  }
}

export class ToggleNotificationsCenterAction extends Action {
  static readonly ID = TOGGLE_NOTIFICATIONS_CENTER;
  static readonly LABEL = 'Toggle Notifications';

  constructor(private readonly center: NotificationsCenter) {
    super(ToggleNotificationsCenterAction.ID, ToggleNotificationsCenterAction.LABEL);
  }

  override async run(): Promise<void> {
    this.center.toggle();
  }
}

export class ClearAllNotificationsAction extends Action {
  static readonly ID = CLEAR_ALL_NOTIFICATIONS;
  static readonly LABEL = 'Clear All Notifications';

  constructor(private readonly model: NotificationsModel) {
    super(ClearAllNotificationsAction.ID, ClearAllNotificationsAction.LABEL);
  }

  override async run(): Promise<void> {
    this.model.clearAll();
  }
}
