import {
  InstantiationType,
  registerSingleton,
} from 'cs/platform/instantiation/common/extensions';
import {
  IWorkbenchEnvironmentService,
  type WorkbenchEnvironmentSnapshot,
  type WorkbenchRuntimeKind,
} from 'cs/workbench/services/environment/common/environmentService';

type WorkbenchEnvironmentGlobals = Window & {
  electronAPI?: {
    invoke?: unknown;
    webContent?: {
      navigate?: unknown;
    };
  };
};

function resolveRuntimeKind(): WorkbenchRuntimeKind {
  if (typeof window === 'undefined') {
    return 'web';
  }

  const globals = window as WorkbenchEnvironmentGlobals;
  return typeof globals.electronAPI?.invoke === 'function' ? 'desktop' : 'web';
}

function resolveDevelopment() {
  if (typeof import.meta !== 'undefined' && import.meta.env.DEV) {
    return true;
  }

  if (typeof window === 'undefined') {
    return false;
  }

  return /^(localhost|127\.0\.0\.1|\[::1\])$/.test(window.location.hostname);
}

function resolveWebContentRuntime() {
  if (typeof window === 'undefined') {
    return false;
  }

  const globals = window as WorkbenchEnvironmentGlobals;
  return typeof globals.electronAPI?.webContent?.navigate === 'function';
}

export class BrowserWorkbenchEnvironmentService
  implements IWorkbenchEnvironmentService
{
  declare readonly _serviceBrand: undefined;

  get runtimeKind() {
    return resolveRuntimeKind();
  }

  get development() {
    return resolveDevelopment();
  }

  get webContentRuntime() {
    return resolveWebContentRuntime();
  }

  getSnapshot(): WorkbenchEnvironmentSnapshot {
    return {
      runtimeKind: this.runtimeKind,
      development: this.development,
      webContentRuntime: this.webContentRuntime,
    };
  }
}

export function createWorkbenchEnvironmentService(): IWorkbenchEnvironmentService {
  return new BrowserWorkbenchEnvironmentService();
}

registerSingleton(
  IWorkbenchEnvironmentService,
  BrowserWorkbenchEnvironmentService,
  InstantiationType.Delayed,
);

export {
  IWorkbenchEnvironmentService,
} from 'cs/workbench/services/environment/common/environmentService';
export type {
  WorkbenchEnvironmentSnapshot,
  WorkbenchRuntimeKind,
} from 'cs/workbench/services/environment/common/environmentService';
