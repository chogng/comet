import type { IDisposable } from 'ls/base/common/lifecycle';
import { IMainProcessService } from 'ls/platform/ipc/common/mainProcessService';
import { createElectronMainProcessService } from 'ls/platform/ipc/electron-browser/mainProcessService';
import { INativeHostService } from 'ls/platform/native/common/native';
import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceProxy';
import { registerWorkbenchContribution } from 'ls/workbench/contrib/workbench/workbench.contribution';
import {
  registerWorkbenchDisposable,
  registerWorkbenchService,
} from 'ls/workbench/services/instantiation/browser/workbenchInstantiationService';

export function createWorkbenchDesktopIpcContribution(): IDisposable | void {
  registerWorkbenchService(INativeHostService, nativeHostService);

  const mainProcessService = createElectronMainProcessService(nativeHostService.ipc);
  if (!mainProcessService) {
    return undefined;
  }

  registerWorkbenchService(IMainProcessService, mainProcessService);
  registerWorkbenchDisposable(mainProcessService);

  return {
    dispose() {
      mainProcessService.dispose?.();
    },
  };
}

registerWorkbenchContribution(createWorkbenchDesktopIpcContribution);
