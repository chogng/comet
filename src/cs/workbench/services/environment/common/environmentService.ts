import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export type WorkbenchRuntimeKind = 'desktop' | 'web';

export interface WorkbenchEnvironmentSnapshot {
  readonly runtimeKind: WorkbenchRuntimeKind;
  readonly development: boolean;
  readonly webContentRuntime: boolean;
}

export const IWorkbenchEnvironmentService =
  createDecorator<IWorkbenchEnvironmentService>(
    'workbenchEnvironmentService',
  );

export interface IWorkbenchEnvironmentService {
  readonly _serviceBrand: undefined;
  readonly runtimeKind: WorkbenchRuntimeKind;
  readonly development: boolean;
  readonly webContentRuntime: boolean;
  getSnapshot(): WorkbenchEnvironmentSnapshot;
}
