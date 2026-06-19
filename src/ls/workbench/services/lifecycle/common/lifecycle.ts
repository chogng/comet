import { EventEmitter, type Event } from 'ls/base/common/event';
import { Disposable, type IDisposable } from 'ls/base/common/lifecycle';
import { createDecorator } from 'ls/platform/instantiation/common/instantiation';

export const ILifecycleService =
  createDecorator<ILifecycleService>('lifecycleService');

export const enum ShutdownReason {
  CLOSE = 1,
  QUIT,
  RELOAD,
  LOAD,
}

export const enum StartupKind {
  NewWindow = 1,
  ReloadedWindow = 3,
  ReopenedWindow = 4,
}

export const enum LifecyclePhase {
  Starting = 1,
  Ready = 2,
  Restored = 3,
  Eventually = 4,
}

export function lifecyclePhaseToString(phase: LifecyclePhase): string {
  switch (phase) {
    case LifecyclePhase.Starting:
      return 'Starting';
    case LifecyclePhase.Ready:
      return 'Ready';
    case LifecyclePhase.Restored:
      return 'Restored';
    case LifecyclePhase.Eventually:
      return 'Eventually';
  }
}

export function startupKindToString(startupKind: StartupKind): string {
  switch (startupKind) {
    case StartupKind.NewWindow:
      return 'NewWindow';
    case StartupKind.ReloadedWindow:
      return 'ReloadedWindow';
    case StartupKind.ReopenedWindow:
      return 'ReopenedWindow';
  }
}

export interface ILifecycleService {
  readonly _serviceBrand: undefined;
  readonly onDidChangePhase: Event<LifecyclePhase>;
  readonly phase: LifecyclePhase;
  when(phase: LifecyclePhase): Promise<void>;
}

export interface IWorkbenchLifecycleService
  extends ILifecycleService, IDisposable {
  setPhase(phase: LifecyclePhase): void;
}

export class WorkbenchLifecycleService
  extends Disposable
  implements IWorkbenchLifecycleService
{
  declare readonly _serviceBrand: undefined;

  private phaseValue = LifecyclePhase.Starting;
  private readonly didChangePhaseEmitter = this._register(
    new EventEmitter<LifecyclePhase>(),
  );

  readonly onDidChangePhase = this.didChangePhaseEmitter.event;

  get phase() {
    return this.phaseValue;
  }

  when(phase: LifecyclePhase): Promise<void> {
    if (this.phaseValue >= phase) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const listener = this.onDidChangePhase((nextPhase) => {
        if (nextPhase < phase) {
          return;
        }

        listener.dispose();
        resolve();
      });
    });
  }

  setPhase(phase: LifecyclePhase) {
    if (phase <= this.phaseValue) {
      return;
    }

    this.phaseValue = phase;
    this.didChangePhaseEmitter.fire(phase);
  }
}

export function createWorkbenchLifecycleService(): IWorkbenchLifecycleService {
  return new WorkbenchLifecycleService();
}
