export const SHOW_NOTIFICATIONS_CENTER = 'notifications.showList';
export const HIDE_NOTIFICATIONS_CENTER = 'notifications.hideList';
export const TOGGLE_NOTIFICATIONS_CENTER = 'notifications.toggleList';
export const CLEAR_ALL_NOTIFICATIONS = 'notifications.clearAll';
export const FOCUS_NOTIFICATION_TOAST = 'notifications.focusToasts';

export interface INotificationsCenterController {
  readonly isVisible: boolean;
  show(): void;
  hide(): void;
  toggle(): void;
}

export interface INotificationsToastController {
  hide(): void;
}
