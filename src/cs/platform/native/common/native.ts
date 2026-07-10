import type {
  ElectronDocumentApi,
  ElectronInvoke,
  ElectronIpcApi,
  ElectronWebContentApi,
  ElectronWindowControls,
} from 'cs/base/parts/sandbox/common/electronTypes';
import { createDecorator } from 'cs/platform/instantiation/common/instantiation';

export const INativeHostService =
  createDecorator<INativeHostService>('nativeHostService');

export interface INativeHostService {
  readonly _serviceBrand: undefined;
  canInvoke(): boolean;
  invoke: ElectronInvoke;
  readonly ipc: ElectronIpcApi | undefined;
  readonly windowControls: ElectronWindowControls | undefined;
  readonly webContent: ElectronWebContentApi | undefined;
  readonly document: ElectronDocumentApi | undefined;
}
