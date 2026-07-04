import { INativeHostService } from 'cs/platform/native/common/native';
import { nativeHostService } from 'cs/platform/native/electron-sandbox/nativeHostServiceProxy';
import { getWorkbenchInstantiationService } from 'cs/workbench/services/instantiation/browser/workbenchInstantiationService';

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
