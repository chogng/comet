import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
  ILifecycleService,
  LifecyclePhase,
  WorkbenchLifecycleService,
  type IWorkbenchLifecycleService,
} from 'cs/workbench/services/lifecycle/common/lifecycle';

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
} from 'cs/workbench/services/lifecycle/common/lifecycle';
export type {
  ILifecycleService as LifecycleService,
  IWorkbenchLifecycleService,
} from 'cs/workbench/services/lifecycle/common/lifecycle';
