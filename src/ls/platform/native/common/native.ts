import type {
  ElectronFetchApi,
  ElectronDocumentApi,
  ElectronInvoke,
  ElectronIpcApi,
  ElectronModalApi,
  ElectronToastApi,
  ElectronWebContentApi,
  ElectronWindowControls,
} from 'ls/base/parts/sandbox/common/desktopTypes';
import { createDecorator } from 'ls/platform/instantiation/common/instantiation';

export const INativeHostService =
  createDecorator<INativeHostService>('nativeHostService');

export interface INativeHostService {
  readonly _serviceBrand: undefined;
  canInvoke(): boolean;
  invoke: ElectronInvoke;
  readonly ipc: ElectronIpcApi | undefined;
  readonly windowControls: ElectronWindowControls | undefined;
  readonly webContent: ElectronWebContentApi | undefined;
  readonly fetch: ElectronFetchApi | undefined;
  readonly document: ElectronDocumentApi | undefined;
  readonly modal: ElectronModalApi | undefined;
  readonly toast: ElectronToastApi | undefined;
}
