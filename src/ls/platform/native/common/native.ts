import type {
  ElectronFetchApi,
  ElectronDocumentApi,
  ElectronInvoke,
  ElectronIpcApi,
  ElectronToastApi,
  ElectronWebContentApi,
  ElectronWindowControls,
} from 'ls/base/parts/sandbox/common/electronTypes';
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
  readonly toast: ElectronToastApi | undefined;
}
