import { EventEmitter, type Event } from 'cs/base/common/event';
import {
  Disposable,
  type IDisposable,
} from 'cs/base/common/lifecycle';

export interface ITelemetryData {
  readonly from?: string;
  readonly target?: string;
  [key: string]: unknown;
}

export type WorkbenchActionExecutedEvent = {
  id: string;
  from: string;
  detail?: string;
};

export interface IAction {
  readonly id: string;
  label: string;
  tooltip: string;
  class: string | undefined;
  enabled: boolean;
  checked?: boolean;
  run(...args: unknown[]): unknown;
}

// Existing Comet Studio browser controls use this lighter contract.
export interface BaseAction {
  id?: string;
  label: string;
  title?: string;
  disabled?: boolean;
  checked?: boolean;
  run?: (...args: unknown[]) => unknown;
}

export interface IActionChangeEvent {
  readonly label?: string;
  readonly tooltip?: string;
  readonly class?: string;
  readonly enabled?: boolean;
  readonly checked?: boolean;
}

export class Action extends Disposable implements IAction {
  private readonly onDidChangeEmitter = this._register(
    new EventEmitter<IActionChangeEvent>(),
  );

  readonly onDidChange: Event<IActionChangeEvent> =
    this.onDidChangeEmitter.event;

  protected readonly _id: string;
  protected _label: string;
  protected _tooltip: string | undefined;
  protected _cssClass: string | undefined;
  protected _enabled: boolean;
  protected _checked?: boolean;
  protected readonly _actionCallback?: (
    event?: unknown,
    data?: ITelemetryData,
  ) => unknown;

  constructor(
    id: string,
    label = '',
    cssClass = '',
    enabled = true,
    actionCallback?: (event?: unknown, data?: ITelemetryData) => unknown,
  ) {
    super();
    this._id = id;
    this._label = label;
    this._cssClass = cssClass;
    this._enabled = enabled;
    this._actionCallback = actionCallback;
  }

  get id(): string {
    return this._id;
  }

  get label(): string {
    return this._label;
  }

  set label(value: string) {
    if (this._label === value) {
      return;
    }

    this._label = value;
    this.onDidChangeEmitter.fire({ label: value });
  }

  get tooltip(): string {
    return this._tooltip ?? '';
  }

  set tooltip(value: string) {
    if (this._tooltip === value) {
      return;
    }

    this._tooltip = value;
    this.onDidChangeEmitter.fire({ tooltip: value });
  }

  get class(): string | undefined {
    return this._cssClass;
  }

  set class(value: string | undefined) {
    if (this._cssClass === value) {
      return;
    }

    this._cssClass = value;
    this.onDidChangeEmitter.fire({ class: value });
  }

  get enabled(): boolean {
    return this._enabled;
  }

  set enabled(value: boolean) {
    if (this._enabled === value) {
      return;
    }

    this._enabled = value;
    this.onDidChangeEmitter.fire({ enabled: value });
  }

  get checked(): boolean | undefined {
    return this._checked;
  }

  set checked(value: boolean | undefined) {
    if (this._checked === value) {
      return;
    }

    this._checked = value;
    this.onDidChangeEmitter.fire({ checked: value });
  }

  async run(event?: unknown, data?: ITelemetryData): Promise<void> {
    if (this._actionCallback) {
      await this._actionCallback(event, data);
    }
  }
}

export interface IRunEvent {
  readonly action: IAction;
  readonly error?: unknown;
}

export interface IActionRunner extends IDisposable {
  readonly onDidRun: Event<IRunEvent>;
  readonly onWillRun: Event<IRunEvent>;
  run(action: IAction, context?: unknown): unknown;
}

export class ActionRunner extends Disposable implements IActionRunner {
  private readonly onWillRunEmitter = this._register(
    new EventEmitter<IRunEvent>(),
  );

  readonly onWillRun = this.onWillRunEmitter.event;

  private readonly onDidRunEmitter = this._register(
    new EventEmitter<IRunEvent>(),
  );

  readonly onDidRun = this.onDidRunEmitter.event;

  async run(action: IAction, context?: unknown): Promise<void> {
    if (!action.enabled) {
      return;
    }

    this.onWillRunEmitter.fire({ action });

    let error: unknown;
    try {
      await this.runAction(action, context);
    } catch (caughtError) {
      error = caughtError;
    }

    this.onDidRunEmitter.fire({ action, error });

    if (error) {
      throw error;
    }
  }

  protected async runAction(action: IAction, context?: unknown): Promise<void> {
    await action.run(context);
  }
}

export class Separator implements IAction {
  static readonly ID = 'vs.actions.separator';

  static join(...actionLists: readonly IAction[][]): IAction[] {
    let result: IAction[] = [];
    for (const actions of actionLists) {
      if (actions.length === 0) {
        continue;
      }

      result =
        result.length === 0
          ? [...actions]
          : [...result, new Separator(), ...actions];
    }

    return result;
  }

  static clean(actions: IAction[]): IAction[] {
    while (actions[0]?.id === Separator.ID) {
      actions.shift();
    }

    while (actions[actions.length - 1]?.id === Separator.ID) {
      actions.pop();
    }

    for (let index = actions.length - 2; index >= 0; index -= 1) {
      if (
        actions[index].id === Separator.ID &&
        actions[index + 1].id === Separator.ID
      ) {
        actions.splice(index + 1, 1);
      }
    }

    return actions;
  }

  readonly id = Separator.ID;
  readonly label = '';
  readonly tooltip = '';
  readonly class = 'separator';
  readonly enabled = false;
  readonly checked = undefined;

  async run(): Promise<void> {}
}

export class SubmenuAction implements IAction {
  readonly tooltip = '';
  readonly enabled = true;
  readonly checked = undefined;

  constructor(
    readonly id: string,
    readonly label: string,
    readonly actions: readonly IAction[],
    private readonly cssClass?: string,
  ) {}

  get class(): string | undefined {
    return this.cssClass;
  }

  async run(): Promise<void> {}
}

export class EmptySubmenuAction extends Action {
  static readonly ID = 'vs.actions.empty';

  constructor() {
    super(EmptySubmenuAction.ID, '(empty)', undefined, false);
  }
}

export function toAction(props: {
  id: string;
  label: string;
  tooltip?: string;
  enabled?: boolean;
  checked?: boolean;
  class?: string;
  run: (...args: unknown[]) => unknown;
}): IAction {
  return {
    id: props.id,
    label: props.label,
    tooltip: props.tooltip ?? props.label,
    class: props.class,
    enabled: props.enabled ?? true,
    checked: props.checked,
    run: async (...args: unknown[]) => props.run(...args),
  };
}
