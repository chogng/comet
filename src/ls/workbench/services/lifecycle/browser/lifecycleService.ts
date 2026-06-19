import {
  LifecyclePhase,
  createWorkbenchLifecycleService,
  type IWorkbenchLifecycleService,
} from 'ls/workbench/services/lifecycle/common/lifecycle';

export function createBrowserWorkbenchLifecycleService(): IWorkbenchLifecycleService {
  const service = createWorkbenchLifecycleService();
  service.setPhase(LifecyclePhase.Ready);
  return service;
}

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
