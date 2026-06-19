import { Action, type IAction } from 'ls/base/common/actions';
import type { Event } from 'ls/base/common/event';
import { toDisposable } from 'ls/base/common/lifecycle';
import { localize } from 'ls/nls';
import { createDecorator } from 'ls/platform/instantiation/common/instantiation';

export enum Severity {
  Ignore = 0,
  Info = 1,
  Warning = 2,
  Error = 3,
}

export const INotificationService =
  createDecorator<INotificationService>('notificationService');

export type NotificationMessage = string | Error;

export enum NotificationPriority {
  DEFAULT,
  OPTIONAL,
  SILENT,
  URGENT,
}

export interface INotificationProperties {
  readonly sticky?: boolean;
  readonly priority?: NotificationPriority;
  readonly neverShowAgain?: INeverShowAgainOptions;
}

export enum NeverShowAgainScope {
  WORKSPACE,
  PROFILE,
  APPLICATION,
}

export interface INeverShowAgainOptions {
  readonly id: string;
  readonly isSecondary?: boolean;
  readonly scope?: NeverShowAgainScope;
}

export interface INotificationSource {
  readonly id: string;
  readonly label: string;
}

export function isNotificationSource(thing: unknown): thing is INotificationSource {
  if (!thing) {
    return false;
  }

  const candidate = thing as INotificationSource;
  return typeof candidate.id === 'string' && typeof candidate.label === 'string';
}

export interface INotification extends INotificationProperties {
  readonly id?: string;
  readonly severity: Severity;
  readonly message: NotificationMessage;
  readonly source?: string | INotificationSource;
  actions?: INotificationActions;
  readonly progress?: INotificationProgressProperties;
}

export interface INotificationActions {
  readonly primary?: readonly IAction[];
  readonly secondary?: readonly IAction[];
}

export interface INotificationProgressProperties {
  readonly infinite?: boolean;
  readonly total?: number;
  readonly worked?: number;
}

export interface INotificationProgress {
  infinite(): void;
  total(value: number): void;
  worked(value: number): void;
  done(): void;
}

export interface INotificationHandle {
  readonly onDidClose: Event<void>;
  readonly onDidChangeVisibility: Event<boolean>;
  readonly progress: INotificationProgress;
  updateSeverity(severity: Severity): void;
  updateMessage(message: NotificationMessage): void;
  updateActions(actions?: INotificationActions): void;
  close(): void;
}

export interface IStatusHandle {
  close(): void;
}

interface IBasePromptChoice {
  readonly label: string;
  readonly keepOpen?: boolean;
  run: () => void;
}

export interface IPromptChoice extends IBasePromptChoice {
  readonly isSecondary?: boolean;
}

export interface IPromptChoiceWithMenu extends IPromptChoice {
  readonly menu: IBasePromptChoice[];
  readonly isSecondary: false | undefined;
}

export interface IPromptOptions extends INotificationProperties {
  onCancel?: () => void;
}

export interface IStatusMessageOptions {
  readonly showAfter?: number;
  readonly hideAfter?: number;
}

export enum NotificationsFilter {
  OFF,
  ERROR,
}

export interface INotificationSourceFilter extends INotificationSource {
  readonly filter: NotificationsFilter;
}

export interface INotificationService {
  readonly _serviceBrand: undefined;
  readonly onDidChangeFilter: Event<void>;
  setFilter(filter: NotificationsFilter | INotificationSourceFilter): void;
  getFilter(source?: INotificationSource): NotificationsFilter;
  getFilters(): INotificationSourceFilter[];
  removeFilter(sourceId: string): void;
  notify(notification: INotification): INotificationHandle;
  info(message: NotificationMessage | NotificationMessage[]): void;
  warn(message: NotificationMessage | NotificationMessage[]): void;
  error(message: NotificationMessage | NotificationMessage[]): void;
  prompt(
    severity: Severity,
    message: string,
    choices: (IPromptChoice | IPromptChoiceWithMenu)[],
    options?: IPromptOptions,
  ): INotificationHandle;
  status(message: NotificationMessage, options?: IStatusMessageOptions): IStatusHandle;
}

const NoOpEvent: Event<never> = () => toDisposable(() => {});

export class NoOpNotification implements INotificationHandle {
  readonly progress = new NoOpProgress();
  readonly onDidClose: Event<void> = NoOpEvent;
  readonly onDidChangeVisibility: Event<boolean> = NoOpEvent;

  updateSeverity(_severity: Severity): void {}
  updateMessage(_message: NotificationMessage): void {}
  updateActions(_actions?: INotificationActions): void {}
  close(): void {}
}

export class NoOpProgress implements INotificationProgress {
  infinite(): void {}
  done(): void {}
  total(_value: number): void {}
  worked(_value: number): void {}
}

export class NoOpNotificationService implements INotificationService {
  declare readonly _serviceBrand: undefined;
  readonly onDidChangeFilter: Event<void> = NoOpEvent;

  setFilter(_filter: NotificationsFilter | INotificationSourceFilter): void {}
  getFilter(): NotificationsFilter {
    return NotificationsFilter.OFF;
  }
  getFilters(): INotificationSourceFilter[] {
    return [];
  }
  removeFilter(_sourceId: string): void {}
  notify(_notification: INotification): INotificationHandle {
    return new NoOpNotification();
  }
  info(_message: NotificationMessage | NotificationMessage[]): void {}
  warn(_message: NotificationMessage | NotificationMessage[]): void {}
  error(_message: NotificationMessage | NotificationMessage[]): void {}
  prompt(
    _severity: Severity,
    _message: string,
    _choices: (IPromptChoice | IPromptChoiceWithMenu)[],
    _options?: IPromptOptions,
  ): INotificationHandle {
    return new NoOpNotification();
  }
  status(_message: NotificationMessage, _options?: IStatusMessageOptions): IStatusHandle {
    return { close() {} };
  }
}

export function withSeverityPrefix(label: string, severity: Severity): string {
  if (severity === Severity.Error) {
    return localize('severityPrefix.error', 'Error: {0}', label);
  }

  if (severity === Severity.Warning) {
    return localize('severityPrefix.warning', 'Warning: {0}', label);
  }

  return localize('severityPrefix.info', 'Info: {0}', label);
}

export function createPromptChoiceAction(
  id: string,
  choice: IPromptChoice | IPromptChoiceWithMenu,
): IAction {
  return new Action(id, choice.label, undefined, true, () => choice.run());
}
