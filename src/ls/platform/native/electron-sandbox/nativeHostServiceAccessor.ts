import { INativeHostService } from 'ls/platform/native/common/native';
import { nativeHostService } from 'ls/platform/native/electron-sandbox/nativeHostServiceProxy';
import { getWorkbenchInstantiationService } from 'ls/workbench/services/instantiation/browser/workbenchInstantiationService';

export function getNativeHostService(): INativeHostService {
  try {
    return getWorkbenchInstantiationService().invokeFunction((accessor) =>
      accessor.get(INativeHostService),
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === `Unknown service '${INativeHostService}'.`
    ) {
      return nativeHostService;
    }

    throw error;
  }
}
