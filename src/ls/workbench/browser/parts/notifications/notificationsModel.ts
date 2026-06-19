import { Action, type IAction } from 'ls/base/common/actions';
import { EventEmitter } from 'ls/base/common/event';
import {
  Disposable,
  DisposableStore,
  toDisposable,
} from 'ls/base/common/lifecycle';
import {
  NotificationPriority,
  NotificationsFilter,
  Severity,
  type INotification,
  type INotificationActions,
  type INotificationHandle,
  type INotificationProgress,
  type INotificationProgressProperties,
  type INotificationService,
  type INotificationSource,
  type INotificationSourceFilter,
  type IPromptChoice,
  type IPromptChoiceWithMenu,
  type IPromptOptions,
  type IStatusHandle,
  type IStatusMessageOptions,
  type NotificationMessage,
} from 'ls/platform/notification/common/notification';

export type NotificationContentChangeKind =
  | 'severity'
  | 'message'
  | 'actions'
  | 'progress'
  | 'visibility';

export type NotificationModelChange =
  | {
      kind: 'add';
      item: WorkbenchNotificationItem;
      index: number;
    }
  | {
      kind: 'change';
      item: WorkbenchNotificationItem;
      index: number;
      detail: NotificationContentChangeKind;
    }
  | {
      kind: 'remove';
      item: WorkbenchNotificationItem;
      index: number;
    };

export type StatusMessageChange =
  | {
      kind: 'add';
      item: WorkbenchStatusMessageItem;
    }
  | {
      kind: 'remove';
      item: WorkbenchStatusMessageItem;
    };

export type NotificationFilterChange = {
  global: NotificationsFilter;
  sources?: Map<string, NotificationsFilter>;
};

type WorkbenchNotificationProgressState = {
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

class WorkbenchNotificationProgress implements INotificationProgress {
  private stateValue: WorkbenchNotificationProgressState = {};

  constructor(
    initialState: INotificationProgressProperties | undefined,
    private readonly onDidChange: () => void,
  ) {
    if (initialState) {
      this.stateValue = { ...initialState };
    }
  }

  get state(): WorkbenchNotificationProgressState {
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

export class WorkbenchNotificationItem
  extends Disposable
  implements INotificationHandle
{
  readonly sequence = ++notificationSequence;
  readonly createdAt = Date.now();
  readonly progress: WorkbenchNotificationProgress;
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
    new EventEmitter<NotificationContentChangeKind>(),
  );
  readonly onDidChangeContent = this.onDidChangeContentEmitter.event;

  constructor(
    notification: INotification,
    private readonly onDidMutate: (
      item: WorkbenchNotificationItem,
      detail: NotificationContentChangeKind,
    ) => void,
    private readonly onDidRequestClose: (item: WorkbenchNotificationItem) => void,
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
    this.progress = new WorkbenchNotificationProgress(notification.progress, () =>
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

  private fireContentChange(detail: NotificationContentChangeKind) {
    this.onDidChangeContentEmitter.fire(detail);
    this.onDidMutate(this, detail);
  }
}

export class WorkbenchStatusMessageItem implements IStatusHandle {
  readonly id = ++statusMessageSequence;
  readonly message: NotificationMessage;
  readonly messageText: string;
  readonly options: IStatusMessageOptions | undefined;

  private closed = false;

  constructor(
    message: NotificationMessage,
    options: IStatusMessageOptions | undefined,
    private readonly onDidRequestClose: (item: WorkbenchStatusMessageItem) => void,
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

export class WorkbenchNotificationsModel extends Disposable {
  private notificationItems: WorkbenchNotificationItem[] = [];
  private statusMessageItem: WorkbenchStatusMessageItem | null = null;
  private globalFilter = NotificationsFilter.OFF;
  private readonly sourceFilters = new Map<string, INotificationSourceFilter>();

  private readonly onDidChangeNotificationEmitter = this._register(
    new EventEmitter<NotificationModelChange>(),
  );
  readonly onDidChangeNotification = this.onDidChangeNotificationEmitter.event;

  private readonly onDidChangeStatusMessageEmitter = this._register(
    new EventEmitter<StatusMessageChange>(),
  );
  readonly onDidChangeStatusMessage = this.onDidChangeStatusMessageEmitter.event;

  private readonly onDidChangeFilterEmitter = this._register(
    new EventEmitter<NotificationFilterChange>(),
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

  addNotification(notification: INotification): WorkbenchNotificationItem {
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

    const item = new WorkbenchNotificationItem(
      notification,
      this.handleNotificationMutation,
      this.removeNotification,
    );
    this.notificationItems = [item, ...this.notificationItems];
    this.onDidChangeNotificationEmitter.fire({ kind: 'add', item, index: 0 });
    return item;
  }

  setStatusMessage(
    message: NotificationMessage,
    options?: IStatusMessageOptions,
  ): WorkbenchStatusMessageItem {
    this.statusMessageItem?.close();
    const item = new WorkbenchStatusMessageItem(
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
    item: WorkbenchNotificationItem,
    detail: NotificationContentChangeKind,
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

  private readonly removeNotification = (item: WorkbenchNotificationItem) => {
    const index = this.notificationItems.indexOf(item);
    if (index < 0) {
      return;
    }

    this.notificationItems = this.notificationItems.filter((candidate) => candidate !== item);
    this.onDidChangeNotificationEmitter.fire({ kind: 'remove', item, index });
  };

  private readonly removeStatusMessage = (item: WorkbenchStatusMessageItem) => {
    if (this.statusMessageItem !== item) {
      return;
    }

    this.statusMessageItem = null;
    this.onDidChangeStatusMessageEmitter.fire({ kind: 'remove', item });
  };
}

export class WorkbenchNotificationService
  extends Disposable
  implements INotificationService
{
  declare readonly _serviceBrand: undefined;

  private readonly statusTimers = this._register(new DisposableStore());
  private readonly onDidChangeFilterEmitter = this._register(
    new EventEmitter<void>(),
  );
  readonly onDidChangeFilter = this.onDidChangeFilterEmitter.event;

  constructor(readonly model = new WorkbenchNotificationsModel()) {
    super();
    this._register(model);
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
    const primary: IAction[] = [];
    const secondary: IAction[] = [];

    choices.forEach((choice, index) => {
      const action = new Action(
        `workbench.notification.prompt.${index}`,
        choice.label,
        undefined,
        true,
        () => {
          choice.run();
          if (!choice.keepOpen) {
            handle?.close();
          }
        },
      );
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

    if (options?.onCancel) {
      const disposable = handle.onDidClose(options.onCancel);
      this._register(disposable);
    }

    return handle;
  }

  status(message: NotificationMessage, options?: IStatusMessageOptions): IStatusHandle {
    const item = this.model.setStatusMessage(message, options);
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
    const item = new WorkbenchNotificationItem(
      notification,
      () => {},
      () => {},
    );
    item.close();
    return item;
  }
}

export function createWorkbenchNotificationService() {
  return new WorkbenchNotificationService();
}

export type WorkbenchNotificationServiceInstance = WorkbenchNotificationService;
