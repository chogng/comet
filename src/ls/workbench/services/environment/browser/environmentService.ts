import type {
  IWorkbenchEnvironmentService,
  WorkbenchEnvironmentSnapshot,
  WorkbenchRuntimeKind,
} from 'ls/workbench/services/environment/common/environmentService';

type WorkbenchEnvironmentGlobals = Window & {
  electronAPI?: unknown;
  __LS_WEB_CONTENT_RUNTIME__?: boolean;
};

function resolveRuntimeKind(): WorkbenchRuntimeKind {
  if (typeof window === 'undefined') {
    return 'web';
  }

  const globals = window as WorkbenchEnvironmentGlobals;
  return globals.electronAPI ? 'desktop' : 'web';
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
  return Boolean(globals.__LS_WEB_CONTENT_RUNTIME__ ?? globals.electronAPI);
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

export {
  IWorkbenchEnvironmentService,
} from 'ls/workbench/services/environment/common/environmentService';
export type {
  WorkbenchEnvironmentSnapshot,
  WorkbenchRuntimeKind,
} from 'ls/workbench/services/environment/common/environmentService';
