import type {
  ElectronAPI,
  ElectronInvoke,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import type { INativeHostService } from 'ls/platform/native/common/native';

class ElectronSandboxNativeHostServiceProxy implements INativeHostService {
  declare readonly _serviceBrand: undefined;

  private get api(): ElectronAPI | undefined {
    if (typeof window === 'undefined') {
      return undefined;
    }

    return window.electronAPI;
  }

  canInvoke() {
    return typeof this.api?.invoke === 'function';
  }

  invoke: ElectronInvoke = (command: string, args?: Record<string, unknown>) => {
    if (!this.api?.invoke) {
      return Promise.reject(new Error('Desktop invoke bridge is unavailable.'));
    }

    return this.api.invoke(command, args);
  };

  get ipc() {
    return this.api?.ipc;
  }

  get windowControls() {
    return this.api?.windowControls;
  }

  get webContent() {
    return this.api?.webContent;
  }

  get fetch() {
    return this.api?.fetch;
  }

  get document() {
    return this.api?.document;
  }

  get toast() {
    return this.api?.toast;
  }
}

export const nativeHostService: INativeHostService =
  new ElectronSandboxNativeHostServiceProxy();
