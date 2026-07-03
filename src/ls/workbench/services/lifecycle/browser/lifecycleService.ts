import {
  InstantiationType,
  registerSingleton,
} from 'ls/platform/instantiation/common/extensions';
import {
  ILifecycleService,
  LifecyclePhase,
  WorkbenchLifecycleService,
  type IWorkbenchLifecycleService,
} from 'ls/workbench/services/lifecycle/common/lifecycle';

export class BrowserWorkbenchLifecycleService
  extends WorkbenchLifecycleService
{
  constructor() {
    super();
    this.setPhase(LifecyclePhase.Ready);
  }
}

export function createBrowserWorkbenchLifecycleService(): IWorkbenchLifecycleService {
  return new BrowserWorkbenchLifecycleService();
}

registerSingleton(
  ILifecycleService,
  BrowserWorkbenchLifecycleService,
  InstantiationType.Delayed,
);

export {
  ILifecycleService,
  LifecyclePhase,
  ShutdownReason,
  StartupKind,
  lifecyclePhaseToString,
  startupKindToString,
} from 'ls/workbench/services/lifecycle/common/lifecycle';
export type {
  ILifecycleService as LifecycleService,
  IWorkbenchLifecycleService,
} from 'ls/workbench/services/lifecycle/common/lifecycle';
